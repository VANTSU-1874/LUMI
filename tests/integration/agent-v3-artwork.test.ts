// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ModelConversationMessage,
  ModelResponseOptions,
} from "@/lib/ai/client";
import { ModelServiceError } from "@/lib/ai/client";
import { prepareAgentArtwork } from "@/lib/agent/artwork-attachment";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { CurrentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { applyTutorArtworkBoundary } from "@/lib/agent/v3/tutor-artwork";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { validPng } from "@/tests/helpers/image-fixtures";

const roots: string[] = [];
const actor = { userId: "s1", role: "STUDENT" as const };
const taskId = "11111111-1111-4111-8111-111111111111";

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  vi.stubEnv("AGENT_V3_ENABLED", "true");
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-v3-artwork-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  const storageRoot = path.join(root, "private-images");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','V3-ARTWORK');
    INSERT INTO users(id,class_id,role,alias,created_at)
      VALUES('s1','c1','STUDENT','学生一',1700000000);
    INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type)
      VALUES('${taskId}','s1','c1','海报练习','ACTIVE',1700000000,1700000000,'REAL');
  `);
  return { connection, storageRoot };
}

function adapter(input: {
  vision: boolean;
  respond: (
    messages: ModelConversationMessage[],
    options?: ModelResponseOptions,
  ) => ReturnType<NonNullable<ModelProviderAdapter["respond"]>>;
}): ModelProviderAdapter {
  return {
    provider: "TEST",
    modelId: "gpt-5.6-vision-test",
    capabilities: { vision: input.vision },
    async complete() {
      throw new Error("V3_SHOULD_USE_NATIVE_RESPONSE");
    },
    respond: input.respond,
  };
}

describe("V3 artwork understanding", () => {
  it("keeps a maximum-length natural answer when the unread-image note would exceed the reply schema", () => {
    const body = "版".repeat(32_000);
    const bounded = applyTutorArtworkBoundary({
      title: "设计导师建议",
      message: body,
      whyThisStep: "保留模型正文。",
      uncertainty: "其余判断来自学生文字。",
    }, false);

    expect(bounded.message).toBe(body);
    expect(bounded.uncertainty).toContain("当前模型未能可靠读取");
  });

  it("sends the private image to the vision model and records static artwork provenance without a sidecar gate", async () => {
    const { connection, storageRoot } = await fixture();
    const artwork = await prepareAgentArtwork({
      bytes: validPng,
      declaredMime: "image/png",
    });
    const body = [
      "画面里最先被看见的是上方的大标题，下面的几何形和小字形成第二、第三层级。现在的问题不是元素太少，而是标题与几何形的明度接近，主次有一点黏在一起。",
      "",
      "先复制一版，只把标题加深、装饰形降低一档对比度，再把两版缩到手机屏幕大小比较：如果三秒内仍先看到标题，这次调整就有效。",
    ].join("\n");
    const progress: Array<{ status: string; toolId: string; label: string }> = [];
    let modelCalls = 0;
    const model = adapter({
      vision: true,
      respond: async (messages, options) => {
        modelCalls += 1;
        expect(options?.image?.mimeType).toBe("image/png");
        expect(Buffer.from(options?.image?.bytes ?? [])).toEqual(Buffer.from(artwork.bytes));
        expect(messages[0]?.content).toContain("不臆断动态、材质、交互或使用效果");
        const context = JSON.parse(messages[1]?.content ?? "{}") as {
          artworkInput?: {
            sourceId: string;
            availability: string;
            width: number;
            height: number;
          } | null;
        };
        expect(context.artworkInput).toEqual(expect.objectContaining({
          sourceId: `artwork:${artwork.id}`,
          availability: "AVAILABLE_TO_VISION_MODEL",
          width: 2,
          height: 2,
        }));
        return { content: body, toolCalls: [] };
      },
    });

    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          taskId,
          message: "帮我看看这张海报的视觉层级，先说最需要改的一处。",
          context: { view: "AGENT" },
        },
        artwork,
        options: {
          modelProviderAdapter: model,
          artworkRoot: storageRoot,
          onToolProgress: (event) => progress.push(event),
        },
      });

      expect(modelCalls).toBe(1);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toBe(body);
      expect(response.artworkAttachment).toMatchObject({
        id: artwork.id,
        mimeType: "image/png",
        width: 2,
        height: 2,
      });
      expect(response.reply.sources).toContainEqual(expect.objectContaining({
        id: `artwork:${artwork.id}`,
        authority: "STUDENT_ARTWORK",
      }));
      expect(response.reply.basis).toContainEqual({
        kind: "ARTWORK_OBSERVATION",
        label: "作品读取结果",
      });
      expect(response.reply.basis).toContainEqual({
        kind: "GENERAL_DESIGN",
        label: "通用设计建议",
      });
      expect(response.reply.uncertainty).toContain("静态画面");
      expect(response.reply.uncertainty).toContain("不臆断动态");
      expect(response.policy.appliedRules).toContain("GROUND_ARTWORK_OBSERVATION");
      expect(response.executionSteps).not.toContainEqual(expect.objectContaining({
        kind: "DEGRADED",
      }));
      expect(progress).toEqual([
        expect.objectContaining({
          status: "RUNNING",
          toolId: "student-artwork.inspect",
          label: "正在读取你的作品",
        }),
        expect.objectContaining({
          status: "SUCCEEDED",
          toolId: "student-artwork.inspect",
          label: "已读取你的作品",
        }),
      ]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not retain a source mention truncated from the final artwork uncertainty", async () => {
    const { connection, storageRoot } = await fixture();
    await ingestCoursePackKnowledge(connection);
    const artwork = await prepareAgentArtwork({
      bytes: validPng,
      declaredMime: "image/png",
    });
    const uncertainty = `${"说".repeat(455)}我参考《信息层级与页序》安排页序。`;
    const model = adapter({
      vision: true,
      respond: async (messages) => {
        const context = JSON.parse(messages[1]?.content ?? "{}") as {
          referenceMaterials?: Array<{ sourceId: string }>;
        };
        expect(context.referenceMaterials).toContainEqual(expect.objectContaining({
          sourceId: "information-hierarchy",
        }));
        return {
          content: [
            "这里只给通用建议。",
            `<!-- tutor-meta ${JSON.stringify({ sourceIds: null, uncertainty })} -->`,
          ].join("\n"),
          toolCalls: [],
        };
      },
    });

    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          taskId,
          message: "结合这张作品，告诉我八页导览册的信息层级应该怎么安排。",
          context: { view: "AGENT" },
        },
        artwork,
        options: {
          modelProviderAdapter: model,
          artworkRoot: storageRoot,
        },
      });

      expect(response.reply.uncertainty).not.toContain("信息层级与页序");
      expect(response.reply.sources.map(({ id }) => id)).not.toContain("information-hierarchy");
      expect(response.runtimeEvents.find(({ kind }) => kind === "SOURCE_SELECTION")?.sourceIds)
        .not.toContain("information-hierarchy");
      const stored = connection.sqlite.prepare(`
        SELECT source_ids_json sourceIdsJson FROM agent_turns
        ORDER BY created_at DESC, turn_sequence DESC LIMIT 1
      `).get() as { sourceIdsJson: string };
      expect(JSON.parse(stored.sourceIdsJson)).not.toContain("information-hierarchy");
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps a full model-assisted answer and states the boundary when vision is unavailable", async () => {
    const { connection, storageRoot } = await fixture();
    const artwork = await prepareAgentArtwork({
      bytes: validPng,
      declaredMime: "image/png",
    });
    const body = [
      "先用一个不依赖画面猜测的检查法：把作品缩到实际观看尺寸，记录前三秒依次看到的三个信息，再检查它们是否正好对应你希望的主标题、核心图形和补充文字。",
      "",
      "然后只改一个变量做 A/B 对比，例如字号、明度或留白，不要同时改三项。".repeat(80),
    ].join("\n");
    const progress: Array<{ status: string; toolId: string; label: string }> = [];
    const model = adapter({
      vision: false,
      respond: async (messages, options) => {
        expect(options?.image).toBeUndefined();
        expect(messages[0]?.content).toContain("视觉能力不可用");
        const context = JSON.parse(messages[1]?.content ?? "{}") as {
          artworkInput?: { availability: string } | null;
        };
        expect(context.artworkInput).toMatchObject({
          availability: "UNAVAILABLE_TO_MODEL",
        });
        return { content: body, toolCalls: [] };
      },
    });

    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          taskId,
          message: "这张作品哪里需要改？",
          context: { view: "AGENT" },
        },
        artwork,
        options: {
          modelProviderAdapter: model,
          artworkRoot: storageRoot,
          onToolProgress: (event) => progress.push(event),
        },
      });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toContain("我目前不能可靠读取这张图片");
      expect(response.reply.message.endsWith(body)).toBe(true);
      expect(response.reply.message.length).toBeGreaterThan(1_200);
      expect(response.artworkAttachment).toBeDefined();
      expect(response.reply.sources.some(({ authority }) => authority === "STUDENT_ARTWORK"))
        .toBe(false);
      expect(response.reply.basis?.some(({ kind }) => kind === "ARTWORK_OBSERVATION"))
        .toBe(false);
      expect(response.reply.uncertainty).toContain("当前模型未能可靠读取");
      expect(response.policy.appliedRules).toContain("DEGRADE_UNAVAILABLE_VISION");
      expect(response.executionSteps).not.toContainEqual(expect.objectContaining({
        kind: "DEGRADED",
      }));
      expect(progress).toEqual([
        expect.objectContaining({
          status: "FAILED",
          toolId: "student-artwork.inspect",
          label: "未读取作品图片",
        }),
      ]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not claim an artwork observation when the vision request fails", async () => {
    const { connection, storageRoot } = await fixture();
    const artwork = await prepareAgentArtwork({
      bytes: validPng,
      declaredMime: "image/png",
    });
    const progress: Array<{ status: string; toolId: string; label: string }> = [];
    const model = adapter({
      vision: true,
      respond: async (_messages, options) => {
        expect(options?.image).toBeDefined();
        throw new ModelServiceError(
          "INVALID_RESPONSE",
          null,
          null,
          null,
          "OUTPUT_SCHEMA_INVALID",
          new TypeError("private provider response must not escape"),
        );
      },
    });

    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          taskId,
          message: "请看图告诉我最先该改哪里。",
          context: { view: "AGENT" },
        },
        artwork,
        options: {
          modelProviderAdapter: model,
          artworkRoot: storageRoot,
          onToolProgress: (event) => progress.push(event),
        },
      });

      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.reply.message).toContain("我目前不能可靠读取这张图片");
      expect(response.artworkAttachment).toBeDefined();
      expect(response.reply.sources.some(({ authority }) => authority === "STUDENT_ARTWORK"))
        .toBe(false);
      expect(response.reply.basis?.some(({ kind }) => kind === "ARTWORK_OBSERVATION"))
        .toBe(false);
      expect(response.policy.appliedRules).toContain("DEGRADE_UNAVAILABLE_VISION");
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        kind: "DEGRADED",
        errorCode: "INVALID_RESPONSE:OUTPUT_SCHEMA_INVALID",
        summary: "模型服务错误：INVALID_RESPONSE:OUTPUT_SCHEMA_INVALID。本轮模型调用已重试 2 次。",
      }));
      expect(JSON.stringify(response.runtimeEvents)).not.toContain("private provider response");
      expect(progress).toEqual([
        expect.objectContaining({ status: "RUNNING", toolId: "student-artwork.inspect" }),
        expect.objectContaining({ status: "FAILED", toolId: "student-artwork.inspect" }),
      ]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not announce success when a visual tool round ends without a final answer", async () => {
    const { connection, storageRoot } = await fixture();
    await ingestCoursePackKnowledge(connection);
    const artwork = await prepareAgentArtwork({
      bytes: validPng,
      declaredMime: "image/png",
    });
    const progress: Array<{ status: string; toolId: string; label: string }> = [];
    let decisions = 0;
    const model = adapter({
      vision: true,
      respond: async (_messages, options) => {
        decisions += 1;
        expect(options?.image).toBeDefined();
        if (decisions === 1) {
          const knowledgeTool = options?.tools?.find(({ name }) => (
            name.includes("knowledge-map_search-concepts")
          ));
          expect(knowledgeTool).toBeDefined();
          return {
            content: null,
            toolCalls: [{
              id: "call_before_empty_visual_answer",
              name: knowledgeTool!.name,
              arguments: JSON.stringify({ query: "版式层级" }),
            }],
          };
        }
        return { content: null, toolCalls: [] };
      },
    });

    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          taskId,
          message: "先查规则，再结合这张图给我最终建议。",
          context: { view: "AGENT" },
        },
        artwork,
        options: {
          modelProviderAdapter: model,
          artworkRoot: storageRoot,
          onToolProgress: (event) => progress.push(event),
        },
      });

      expect(decisions).toBe(2);
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.reply.sources.some(({ authority }) => authority === "STUDENT_ARTWORK"))
        .toBe(false);
      expect(response.policy.appliedRules).toContain("DEGRADE_UNAVAILABLE_VISION");
      expect(progress.filter(({ toolId }) => toolId === "student-artwork.inspect"))
        .toEqual([
          expect.objectContaining({ status: "RUNNING", label: "正在读取你的作品" }),
          expect.objectContaining({ status: "FAILED", label: "作品图片未形成有效回答" }),
        ]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not attach artwork provenance when the model returns only optional metadata", async () => {
    const { connection, storageRoot } = await fixture();
    const artwork = await prepareAgentArtwork({
      bytes: validPng,
      declaredMime: "image/png",
    });
    const progress: Array<{ status: string; toolId: string; label: string }> = [];
    const model = adapter({
      vision: true,
      respond: async () => ({
        content: '<!-- tutor-meta {"episode":"EXPLORE"} -->',
        toolCalls: [],
      }),
    });

    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          taskId,
          message: "请看图给我一个具体修改建议。",
          context: { view: "AGENT" },
        },
        artwork,
        options: {
          modelProviderAdapter: model,
          artworkRoot: storageRoot,
          onToolProgress: (event) => progress.push(event),
        },
      });

      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.reply.sources.some(({ authority }) => authority === "STUDENT_ARTWORK"))
        .toBe(false);
      expect(response.reply.basis?.some(({ kind }) => kind === "ARTWORK_OBSERVATION"))
        .toBe(false);
      expect(response.policy.appliedRules).toContain("DEGRADE_UNAVAILABLE_VISION");
      expect(progress.filter(({ toolId }) => toolId === "student-artwork.inspect"))
        .toEqual([
          expect.objectContaining({ status: "RUNNING", label: "正在读取你的作品" }),
          expect.objectContaining({ status: "FAILED", label: "作品图片未形成可交付正文" }),
        ]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps the image available across a native function call and the final visual answer", async () => {
    const { connection, storageRoot } = await fixture();
    await ingestCoursePackKnowledge(connection);
    const artwork = await prepareAgentArtwork({
      bytes: validPng,
      declaredMime: "image/png",
    });
    let decisions = 0;
    const model = adapter({
      vision: true,
      respond: async (messages, options) => {
        decisions += 1;
        expect(Buffer.from(options?.image?.bytes ?? [])).toEqual(Buffer.from(artwork.bytes));
        if (decisions === 1) {
          const knowledgeTool = options?.tools?.find(({ name }) => (
            name.includes("knowledge-map_search-concepts")
          ));
          expect(knowledgeTool).toBeDefined();
          return {
            content: null,
            toolCalls: [{
              id: "call_artwork_contrast",
              name: knowledgeTool!.name,
              arguments: JSON.stringify({ query: "文字与背景的对比度" }),
            }],
          };
        }
        expect(messages).toContainEqual(expect.objectContaining({
          role: "tool",
          toolCallId: "call_artwork_contrast",
        }));
        return {
          content: "从静态画面看，先把主标题和背景的明度差拉开；再按检索到的对比度规则核对正文，不要只靠加阴影。",
          toolCalls: [],
        };
      },
    });

    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          taskId,
          message: "结合这张图和可核对的规则，帮我检查文字层级。",
          context: { view: "AGENT" },
        },
        artwork,
        options: {
          modelProviderAdapter: model,
          artworkRoot: storageRoot,
        },
      });

      expect(decisions).toBe(2);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.sources).toContainEqual(expect.objectContaining({
        id: `artwork:${artwork.id}`,
        authority: "STUDENT_ARTWORK",
      }));
      expect(response.reply.basis).toContainEqual({
        kind: "ARTWORK_OBSERVATION",
        label: "作品读取结果",
      });
      expect(response.reply.basis).toContainEqual({
        kind: "TOOL_OBSERVATION",
        label: "工具读取结果",
      });
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_CALL",
        status: "SUCCEEDED",
      }));
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_OBSERVATION",
        status: "SUCCEEDED",
      }));
    } finally {
      connection.sqlite.close();
    }
  });
});

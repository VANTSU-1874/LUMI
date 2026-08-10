// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ModelServiceError,
  type ModelConversationMessage,
  type ModelResponseOptions,
} from "@/lib/ai/client";
import {
  EmbeddingServiceError,
  type EmbeddingProvider,
} from "@/lib/ai/embeddings";
import { CurrentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { getActiveAgentPolicy } from "@/lib/agent/policy-registry";
import type { AgentToolExecutor } from "@/lib/agent/tool-executor";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { saveBookLayoutDraft } from "@/lib/services/book-layout";

const roots: string[] = [];
const actor = { userId: "s1", role: "STUDENT" as const };

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  vi.stubEnv("AGENT_V3_ENABLED", "true");
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-v3-tutor-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','V3-TUTOR');
    INSERT INTO users(id,class_id,role,alias,created_at)
      VALUES('s1','c1','STUDENT','学生一',1700000000);
  `);
  return connection;
}

function nativeTutor(
  respond: (
    messages: ModelConversationMessage[],
    options?: ModelResponseOptions,
  ) => ReturnType<NonNullable<ModelProviderAdapter["respond"]>>,
): ModelProviderAdapter {
  return {
    provider: "TEST",
    modelId: "v3-native-tutor",
    capabilities: { vision: false },
    async complete() {
      throw new Error("V3_SHOULD_USE_NATIVE_RESPONSE");
    },
    respond,
  };
}

describe("V3 natural tutor and native tool loop", () => {
  it.each([
    {
      label: "all gates enabled",
      flags: [true, true, true],
      expectedTool: true,
      expectedErrorCode: null,
    },
    {
      label: "master rollback disabled",
      flags: [false, true, true],
      expectedTool: false,
      expectedErrorCode:
        "KNOWLEDGE_V2_DEPENDENCY_DISABLED",
    },
    {
      label: "evidence bundle disabled",
      flags: [true, true, false],
      expectedTool: false,
      expectedErrorCode:
        "EVIDENCE_BUNDLE_V2_DISABLED",
    },
    {
      label: "visual disabled with active text-only evidence",
      flags: [true, false, true],
      expectedTool: true,
      expectedErrorCode: null,
    },
  ] as const)(
    "exposes V2 evidence only when $label",
    async ({
      flags,
      expectedTool,
      expectedErrorCode,
    }) => {
      const connection = await setup();
      const toolNames: string[] = [];
      const adapter = nativeTutor(
        async (_messages, options) => {
          toolNames.push(
            ...(options?.tools ?? []).map(
              ({ name }) => name,
            ),
          );
          return {
            content: "先比较标题、图片和色彩的主次关系。",
            toolCalls: [],
          };
        },
      );
      try {
        const response =
          await new CurrentAgentRuntime().run({
            connection,
            actor,
            input: {
              message:
                "标题、图片和亮色都很抢，先怎么判断？",
              context: { view: "AGENT" },
            },
            options: {
              modelProviderAdapter: adapter,
              knowledgeObjectV2Enabled: flags[0],
              visualRetrievalEnabled: flags[1],
              evidenceBundleV2Enabled: flags[2],
              evidenceSearchV2: {
                search: vi.fn(),
              },
            },
          });

        expect(
          toolNames.includes(
            "tool_knowledge-map_search-evidence",
          ),
        ).toBe(expectedTool);
        expect(response.runtimeEvents)
          .toContainEqual(expect.objectContaining({
            kind: "CONTEXT_PREPARATION",
            errorCode: expectedErrorCode,
          }));
      } finally {
        connection.sqlite.close();
      }
    },
  );

  it("answers a course-corpus gap with precise professional vocabulary instead of degrading", async () => {
    const connection = await setup();
    const body = [
      "在 GLSL TOP 里，TDTexInfo 不是一个需要课程白名单批准的词，它是 TouchDesigner 提供给着色器的纹理信息结构。你可以用它读取输入纹理尺寸，再把像素尺度换成稳定的 UV 偏移，避免分辨率变化后效果跑掉。",
      "",
      "先做一个最小验证：只接一张输入图，在片元着色器里用 TDTexInfo 的分辨率信息生成一个像素宽度的偏移，然后分别切换 1280×720 与 1920×1080，观察偏移是否仍保持一个像素。",
      "",
      "（通用设计经验，非本课程指定资料）",
    ].join("\n");
    const adapter = nativeTutor(async () => ({ content: body, toolCalls: [] }));
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "课程资料里没有 TDTexInfo。GLSL TOP 里怎样做分辨率无关的一个像素偏移？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toBe(
        body.replace("\n\n（通用设计经验，非本课程指定资料）", ""),
      );
      expect(response.reply.message).not.toContain("非本课程指定资料");
      expect(response.reply.message).toContain("TDTexInfo");
      expect(response.reply.message).toContain("GLSL TOP");
      expect(response.reply.sources).toEqual([]);
      expect(response.reply.basis).toContainEqual({ kind: "GENERAL_DESIGN", label: "通用设计建议" });
      expect(response.executionSteps).not.toContainEqual(expect.objectContaining({ kind: "DEGRADED" }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("delivers multi-paragraph natural Chinese without rigid JSON validation", async () => {
    const connection = await setup();
    const body = [
      "你这个问题的核心不是‘节点够不够多’，而是声音变化有没有被整理成稳定、可控制的视觉信号。",
      "",
      "先用 Audio Device In CHOP 接收声音，再用 Analyze CHOP 取整体响度；接着用 Math CHOP 把数值压到 0–1，最后把它连到图形缩放。每接一段都看一次数值和画面，先确认信号真的在变化。",
      "",
      "如果画面抖得太厉害，再在中间加 Lag CHOP 做平滑。这里的专业词可以正常讲，不需要知识库先收录。",
      "",
      "（通用设计经验，非本课程指定资料）",
    ].join("\n");
    const adapter = nativeTutor(async (messages) => {
      expect(messages[0]).toMatchObject({ role: "system" });
      expect(messages[0]?.content).toContain("艺术设计博士层级");
      expect(messages[0]?.content).not.toContain("每次只输出一个JSON对象");
      return { content: body, toolCalls: [] };
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "TouchDesigner里怎样让声音控制图形大小？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toBe(
        body.replace("\n\n（通用设计经验，非本课程指定资料）", ""),
      );
      expect(response.reply.message).not.toContain("非本课程指定资料");
      expect(response.reply.message).toContain("Audio Device In CHOP");
      expect(response.executionSteps.map(({ kind }) => kind)).toEqual([
        "MODEL_DECISION",
        "FINAL_RESPONSE",
      ]);
      expect(response.runtimeEvents).not.toContainEqual(expect.objectContaining({
        kind: "DEGRADED",
      }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("injects different L1 and L4 teaching guidance while allowing substantive answers", async () => {
    const question = "TouchDesigner里怎样让声音控制图形大小？";
    async function answerFor(
      level: "L1" | "L4",
      dimensions: Record<string, number>,
    ) {
      const connection = await setup();
      connection.sqlite.prepare(`
        INSERT INTO course_pack_profiles(
          id,user_id,class_id,course_pack_id,course_pack_version,level,dimensions_json,updated_at
        ) VALUES(?,?,?,?,?,?,?,?)
      `).run(
        `digital-interaction:1:s1`,
        "s1",
        "c1",
        "digital-interaction",
        "1",
        level,
        JSON.stringify(dimensions),
        1_700_000_000,
      );
      const adapter = nativeTutor(async (messages) => {
        expect(messages[0]?.content).toContain("诊断等级 L1–L4 和能力维度只用于柔性调节讲解");
        expect(messages[0]?.content).toContain("相关长期记忆中明确的已掌握内容、反复卡点与学习偏好可以修正这个基线");
        expect(messages[0]?.content).toContain("不要在回答中给学生贴等级标签");
        expect(messages[0]?.content).toContain("不要用连续提问代替答案");
        const context = JSON.parse(messages[1]?.content ?? "{}") as {
          teachingGuidance?: {
            mode: string;
            diagnosedLevel: string | null;
            depth: string;
            coursePedagogy: { conceptModel: { label: string }; usageBoundary: string };
          };
        };
        expect(context.teachingGuidance).toMatchObject({
          mode: "SOFT_ADAPTATION_NOT_GATE",
          diagnosedLevel: level,
          depth: level === "L1" ? "FOUNDATIONAL" : "ADVANCED_TRANSFER",
          coursePedagogy: { conceptModel: { label: "六元交互逻辑" } },
        });
        expect(context.teachingGuidance?.coursePedagogy.usageBoundary).toContain("不是回答");
        return {
          content: level === "L1"
            ? "先做一个最小实验：让音量只控制一个圆的大小。Audio Device In CHOP 像耳朵，Analyze CHOP 像测音量的人；先确认数值会随声音变化，再把它连到圆的 Scale。成功标准是说话时圆明显变大、安静时缩小。"
            : "先决定作品要响应瞬态冲击还是平均能量：Peak 更敏感，RMS 更稳定。第一步同时观察两路 Analyze 输出，再用同一段声音比较延迟与抖动；选定信号后用 Math 归一化，并把平滑量当成表现节奏而不是单纯修噪参数。",
          toolCalls: [],
        };
      });
      try {
        return await new CurrentAgentRuntime().run({
          connection,
          actor,
          input: { message: question, context: { view: "AGENT" } },
          options: { modelProviderAdapter: adapter },
        });
      } finally {
        connection.sqlite.close();
      }
    }

    const l1 = await answerFor("L1", {
      decomposition: 1,
      "signal-understanding": 1,
      "mapping-design": 1,
      troubleshooting: 1,
      transfer: 1,
    });
    const l4 = await answerFor("L4", {
      decomposition: 4,
      "signal-understanding": 4,
      "mapping-design": 4,
      troubleshooting: 4,
      transfer: 4,
    });

    expect(l1.aiMode).toBe("MODEL_ASSISTED");
    expect(l1.reply.message).toContain("像耳朵");
    expect(l1.reply.message).toContain("成功标准");
    expect(l4.aiMode).toBe("MODEL_ASSISTED");
    expect(l4.reply.message).toContain("Peak");
    expect(l4.reply.message).toContain("RMS");
    expect(l4.reply.message).not.toBe(l1.reply.message);
  });

  it("uses a leading markdown heading as the card title without repeating it in the answer", async () => {
    const connection = await setup();
    const adapter = nativeTutor(async () => ({
      content: [
        "## 先把信息层级拉开",
        "",
        "1. 主标题先形成视觉锚点。",
        "2. 正文再用行距建立阅读节奏。",
      ].join("\n"),
      toolCalls: [],
    }));
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "这张海报的信息有点乱，先改哪里？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.reply.title).toBe("先把信息层级拉开");
      expect(response.reply.message).toBe("1. 主标题先形成视觉锚点。\n2. 正文再用行距建立阅读节奏。");
      expect(response.reply.message).not.toContain("## 先把信息层级拉开");
    } finally {
      connection.sqlite.close();
    }
  });

  it("adds the formal-authority boundary when the claim appears only in a markdown heading", async () => {
    const connection = await setup();
    const adapter = nativeTutor(async () => ({
      content: [
        "## 你的作品已经通过",
        "",
        "接下来可以继续整理展示顺序。",
      ].join("\n"),
      toolCalls: [],
    }));
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "这张作品现在是什么状态？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.reply.title).toBe("你的作品已经通过");
      expect(response.reply.message).toContain("接下来可以继续整理展示顺序。");
      expect(response.reply.message).toContain("不能替你提交、评分、判定过关或代替教师正式复核");
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        kind: "POLICY_CHECK",
        policyRule: "FORBID_FORMAL_AUTHORITY",
        label: "附加正式权限说明",
      }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("prefers a sidecar title while removing a repeated markdown heading from the body", async () => {
    const connection = await setup();
    const adapter = nativeTutor(async () => ({
      content: [
        "## 先从一张草图验证",
        "",
        "先画两个明显不同的构图，再比较主信息是否一眼可见。",
        "",
        '<!-- tutor-meta {"title":"你的作品已经通过"} -->',
      ].join("\n"),
      toolCalls: [],
    }));
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "我下一步应该做什么？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.reply.title).toBe("你的作品已经通过");
      expect(response.reply.message).not.toContain("## 先从一张草图验证");
      expect(response.reply.message).toContain("先画两个明显不同的构图");
      expect(response.reply.message).toContain("不能替你提交、评分、判定过关或代替教师正式复核");
    } finally {
      connection.sqlite.close();
    }
  });

  it("injects sourced general-design knowledge and labels it as general advice", async () => {
    const connection = await setup();
    await ingestCoursePackKnowledge(connection);
    const adapter = nativeTutor(async (messages) => {
      const context = JSON.parse(messages[1]?.content ?? "{}") as {
        referenceMaterials?: Array<{ sourceId: string; title: string }>;
      };
      expect(context.referenceMaterials).toContainEqual(expect.objectContaining({
        sourceId: "design-project-brief",
        title: "从模糊表达形成可执行项目简报",
      }));
      return {
        content: [
          "先别急着选效果。把‘想做什么’临时改成‘谁在什么情境下，最先感受到什么’，再比较两种明显不同的视觉方向。",
          "",
          "先写一行受众与使用情境，然后各画一张一分钟缩略草图；这一步来自通用设计项目简报规则。",
          "",
          "<!-- tutor-meta {\"episode\":\"EXPLORE\",\"sourceIds\":[\"design-project-brief\"],\"title\":\"先把模糊效果变成可比较方向\"} -->",
        ].join("\n"),
        toolCalls: [],
      };
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "我不知道自己想做什么效果。",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.sources).toEqual([
        expect.objectContaining({ id: "design-project-brief", authority: "COURSE_DESIGN" }),
      ]);
      expect(response.reply.basis).toContainEqual({ kind: "GENERAL_DESIGN", label: "通用设计建议" });
      expect(response.reply.basis).not.toContainEqual({ kind: "COURSE_KNOWLEDGE", label: "课程知识" });
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        kind: "RETRIEVAL",
        status: "SUCCEEDED",
        sourceIds: expect.arrayContaining(["design-project-brief"]),
      }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("recovers an explicitly named injected source when the optional sidecar omits sourceIds", async () => {
    const connection = await setup();
    await ingestCoursePackKnowledge(connection);
    const adapter = nativeTutor(async (messages) => {
      const context = JSON.parse(messages[1]?.content ?? "{}") as {
        referenceMaterials?: Array<{ sourceId: string; title: string }>;
      };
      expect(context.referenceMaterials).toContainEqual(expect.objectContaining({
        sourceId: "information-hierarchy",
        title: "信息层级与页序（课程设计）",
      }));
      return {
        content: [
          "可以按《信息层级与页序》先把内容分成必读、选读和延伸三层，再决定每一页承担什么任务。",
          "",
          "第一步只列出读者必须完成的三个任务，并把每项内容放回对应层级；先不要急着做版式。",
          "",
          '<!-- tutor-meta {"sourceIds":null,"title":"先分层，再排页序"} -->',
        ].join("\n"),
        toolCalls: [],
      };
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "八页导览册的信息层级和页序应该怎么安排？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.sources).toContainEqual(expect.objectContaining({
        id: "information-hierarchy",
        authority: "COURSE_DESIGN",
      }));
      expect(response.reply.basis).toContainEqual({
        kind: "COURSE_KNOWLEDGE",
        label: "课程知识",
      });
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        kind: "SOURCE_SELECTION",
        sourceIds: expect.arrayContaining(["information-hierarchy"]),
      }));
      const stored = connection.sqlite.prepare(`
        SELECT reply_json replyJson, source_ids_json sourceIdsJson
        FROM agent_turns ORDER BY created_at DESC, turn_sequence DESC LIMIT 1
      `).get() as { replyJson: string; sourceIdsJson: string };
      expect(JSON.parse(stored.sourceIdsJson)).toContain("information-hierarchy");
      expect(JSON.parse(stored.replyJson)).toMatchObject({
        sources: [expect.objectContaining({ id: "information-hierarchy" })],
      });
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not retain a source named only in a markdown title hidden by the sidecar title", async () => {
    const connection = await setup();
    await ingestCoursePackKnowledge(connection);
    const adapter = nativeTutor(async (messages) => {
      const context = JSON.parse(messages[1]?.content ?? "{}") as {
        referenceMaterials?: Array<{ sourceId: string }>;
      };
      expect(context.referenceMaterials).toContainEqual(expect.objectContaining({
        sourceId: "information-hierarchy",
      }));
      return {
        content: [
          "# 根据《信息层级与页序》先分层",
          "这里只给通用建议。",
          '<!-- tutor-meta {"sourceIds":null,"title":"先整理内容"} -->',
        ].join("\n"),
        toolCalls: [],
      };
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "八页导览册的信息层级和页序应该怎么安排？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.reply.title).toBe("先整理内容");
      expect(response.reply.message).toBe("这里只给通用建议。");
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

  it("applies a non-factual sidecar title to the visible message source context", async () => {
    const connection = await setup();
    await ingestCoursePackKnowledge(connection);
    const adapter = nativeTutor(async () => ({
      content: [
        "根据《信息层级与页序》安排页序。",
        '<!-- tutor-meta {"sourceIds":null,"title":"错误示范"} -->',
      ].join("\n"),
      toolCalls: [],
    }));
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "八页导览册的信息层级和页序应该怎么安排？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.reply.title).toBe("错误示范");
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

  it("applies a source-introduction sidecar title to the visible message source context", async () => {
    const connection = await setup();
    await ingestCoursePackKnowledge(connection);
    const adapter = nativeTutor(async () => ({
      content: [
        "> 根据《信息层级与页序》先分层。",
        '<!-- tutor-meta {"sourceIds":null,"title":"依据如下："} -->',
      ].join("\n"),
      toolCalls: [],
    }));
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "八页导览册的信息层级和页序应该怎么安排？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.reply.title).toBe("依据如下：");
      expect(response.reply.sources.map(({ id }) => id)).toContain("information-hierarchy");
      expect(response.runtimeEvents.find(({ kind }) => kind === "SOURCE_SELECTION")?.sourceIds)
        .toContain("information-hierarchy");
      const stored = connection.sqlite.prepare(`
        SELECT source_ids_json sourceIdsJson FROM agent_turns
        ORDER BY created_at DESC, turn_sequence DESC LIMIT 1
      `).get() as { sourceIdsJson: string };
      expect(JSON.parse(stored.sourceIdsJson)).toContain("information-hierarchy");
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not attach a retrieved source that the context budget did not inject", async () => {
    const connection = await setup();
    await ingestCoursePackKnowledge(connection);
    const customItems = Array.from({ length: 5 }, (_, offset) => {
      const number = offset + 1;
      return {
        id: `provenance-crop-${number}`,
        title: `裁剪来源${number}（课程设计）`,
        topic: "INFORMATION_HIERARCHY" as const,
        tags: ["provenancecrop", "导览册"],
        content: `provenancecrop 导览册资料 ${number}。${"资料正文".repeat(1_200)}`,
        facts: [
          { id: `hierarchy-crop-${number}-fact-a`, text: "事实说明".repeat(70) },
          { id: `hierarchy-crop-${number}-fact-b`, text: "另一事实".repeat(70) },
        ],
        actions: [
          { id: "hierarchy-sort-content", text: "行动说明".repeat(70) },
          { id: `hierarchy-crop-${number}-action`, text: "另一行动".repeat(70) },
        ],
        source: {
          authority: "COURSE_DESIGN" as const,
          verifiedDate: "2026-07-18",
          scope: "上下文裁剪集成测试",
          localDocument: `provenance-crop-${number}.md`,
        },
      };
    });
    const insert = connection.sqlite.prepare(`
      INSERT INTO knowledge_chunks(
        id,source,title,tags,content,course_pack_id,course_pack_version,
        namespace,authority,content_hash,verified_date
      ) VALUES(?,?,?,?,?,'book-design','1','information-hierarchy','COURSE_DESIGN',?,?)
    `);
    for (const [index, item] of customItems.entries()) {
      insert.run(
        item.id,
        JSON.stringify(item.source),
        item.title,
        JSON.stringify(item.tags),
        JSON.stringify(item),
        String(index + 1).repeat(64),
        item.source.verifiedDate,
      );
    }

    let omittedId: string | null = null;
    const adapter = nativeTutor(async (messages) => {
      const context = JSON.parse(messages[1]?.content ?? "{}") as {
        studentQuestion: string;
        referenceMaterials: Array<{ sourceId: string }>;
      };
      if (!context.studentQuestion.includes("最终检查")) {
        return { content: "这是一段用于形成长对话上下文的导师回答。".repeat(180), toolCalls: [] };
      }
      const injectedIds = new Set(context.referenceMaterials.map(({ sourceId }) => sourceId));
      const omitted = customItems.find(({ id }) => !injectedIds.has(id));
      expect(omitted).toBeDefined();
      omittedId = omitted!.id;
      const baseTitle = omitted!.title.replace("（课程设计）", "");
      return {
        content: [
          `根据《${baseTitle}》安排页序。`,
          "先把内容分成必读、选读和延伸三层。",
          `<!-- tutor-meta {"sourceIds":["${omitted!.id}"]} -->`,
        ].join("\n"),
        toolCalls: [],
      };
    });
    const runtime = new CurrentAgentRuntime();
    try {
      for (let index = 0; index < 8; index += 1) {
        await runtime.run({
          connection,
          actor,
          input: {
            message: `provenancecrop 导览册准备轮 ${index + 1}，请给出长回答。`,
            context: { view: "AGENT" },
          },
          options: { modelProviderAdapter: adapter },
        });
      }
      const response = await runtime.run({
        connection,
        actor,
        input: {
          message: "provenancecrop 导览册最终检查：请安排信息层级和页序。",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(omittedId).not.toBeNull();
      const knowledgeRetrieval = response.runtimeEvents.find((event) =>
        event.kind === "RETRIEVAL" && event.sourceIds.includes(omittedId!));
      expect(knowledgeRetrieval).toBeDefined();
      expect(response.reply.sources.map(({ id }) => id)).not.toContain(omittedId);
      expect(response.runtimeEvents.find(({ kind }) => kind === "SOURCE_SELECTION")?.sourceIds)
        .not.toContain(omittedId);
      const stored = connection.sqlite.prepare(`
        SELECT source_ids_json sourceIdsJson FROM agent_turns
        ORDER BY created_at DESC, turn_sequence DESC LIMIT 1
      `).get() as { sourceIdsJson: string };
      expect(JSON.parse(stored.sourceIdsJson)).not.toContain(omittedId);
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not attach a verified evidence fact that the context budget did not inject", async () => {
    const connection = await setup();
    connection.sqlite.exec(`
      INSERT INTO course_modules(id,class_id,sequence,title,hours,focus)
        VALUES('m-evidence-crop','c1',1,'证据裁剪任务',8,'TouchDesigner');
      INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at)
        VALUES('a-evidence-crop','c1','m-evidence-crop','证据裁剪验证','验证注入边界','["TOUCHDESIGNER"]',1700000000);
      INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at,evidence_revision)
        VALUES('p-evidence-crop','c1','a-evidence-crop','s1','TROUBLESHOOT',1700000000,1700000000,5);
    `);
    const insertEvidence = connection.sqlite.prepare(`
      INSERT INTO evidence(
        id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,
        confirmed_code,verification_status,storage_status,label,content,content_digest,
        probe_json,original_name,created_at
      ) VALUES(?,'p-evidence-crop','c1','s1',?,'TEXT','INPUT','INPUT_OK','TEACHER_VERIFIED',
        'READY','证据裁剪',?,?,NULL,NULL,?)
    `);
    const evidenceIds = Array.from({ length: 5 }, (_, offset) => {
      const number = offset + 1;
      const id = `44444444-4444-4444-8444-4444444444${String(number).padStart(2, "0")}`;
      insertEvidence.run(
        id,
        number,
        `evidencecrop 第${number}条教师确认记录。${"学习现场事实".repeat(35)}`,
        String(number).repeat(64),
        1_700_000_000 + number,
      );
      return `evidence:${id}`;
    });

    const customItems = Array.from({ length: 5 }, (_, offset) => {
      const number = offset + 1;
      return {
        id: `evidence-crop-knowledge-${number}`,
        title: `证据裁剪资料${number}（课程设计）`,
        topic: "TOUCHDESIGNER_FOUNDATIONS" as const,
        tags: ["evidencecrop", "touchdesigner"],
        content: `evidencecrop TouchDesigner 资料 ${number}。${"资料正文".repeat(1_200)}`,
        facts: [
          { id: `td-evidence-crop-${number}-fact-a`, text: "事实说明".repeat(70) },
          { id: `td-evidence-crop-${number}-fact-b`, text: "另一事实".repeat(70) },
        ],
        actions: [
          { id: "td-observe-upstream", text: "行动说明".repeat(70) },
          { id: `td-evidence-crop-${number}-action`, text: "另一行动".repeat(70) },
        ],
        source: {
          authority: "COURSE_DESIGN" as const,
          verifiedDate: "2026-07-18",
          scope: "学习证据上下文裁剪集成测试",
          localDocument: `evidence-crop-${number}.md`,
        },
      };
    });
    const insertKnowledge = connection.sqlite.prepare(`
      INSERT INTO knowledge_chunks(
        id,source,title,tags,content,course_pack_id,course_pack_version,
        namespace,authority,content_hash,verified_date
      ) VALUES(?,?,?,?,?,'digital-interaction','1','touchdesigner-foundations','COURSE_DESIGN',?,?)
    `);
    for (const [index, item] of customItems.entries()) {
      insertKnowledge.run(
        item.id,
        JSON.stringify(item.source),
        item.title,
        JSON.stringify(item.tags),
        JSON.stringify(item),
        String(index + 1).repeat(64),
        item.source.verifiedDate,
      );
    }

    let omittedEvidenceId: string | null = null;
    const adapter = nativeTutor(async (messages) => {
      const context = JSON.parse(messages[1]?.content ?? "{}") as {
        studentQuestion: string;
        learningState: null | {
          verifiedEvidenceFacts: Array<{ sourceId: string }>;
        };
      };
      if (!context.studentQuestion.includes("最终检查")) {
        return { content: "这是一段用于形成长对话上下文的导师回答。".repeat(180), toolCalls: [] };
      }
      const injectedIds = new Set(
        context.learningState?.verifiedEvidenceFacts.map(({ sourceId }) => sourceId) ?? [],
      );
      expect(injectedIds.size).toBeGreaterThan(0);
      expect(injectedIds.size).toBeLessThan(evidenceIds.length);
      const omitted = evidenceIds.find((sourceId) => !injectedIds.has(sourceId));
      expect(omitted).toBeDefined();
      omittedEvidenceId = omitted!;
      return {
        content: [
          "继续核对输入层的学习现场事实。",
          `<!-- tutor-meta {"sourceIds":["${omitted}"]} -->`,
        ].join("\n"),
        toolCalls: [],
      };
    });
    const runtime = new CurrentAgentRuntime();
    try {
      for (let index = 0; index < 8; index += 1) {
        await runtime.run({
          connection,
          actor,
          input: {
            message: `evidencecrop TouchDesigner 证据裁剪准备轮 ${index + 1}，请给出长回答。`,
            context: { view: "AGENT" },
          },
          options: { modelProviderAdapter: adapter },
        });
      }
      const response = await runtime.run({
        connection,
        actor,
        input: {
          message: "evidencecrop TouchDesigner 证据裁剪最终检查。",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(omittedEvidenceId).not.toBeNull();
      expect(response.reply.sources.map(({ id }) => id)).not.toContain(omittedEvidenceId);
      expect(response.runtimeEvents.find(({ kind }) => kind === "SOURCE_SELECTION")?.sourceIds)
        .not.toContain(omittedEvidenceId);
      const stored = connection.sqlite.prepare(`
        SELECT source_ids_json sourceIdsJson FROM agent_turns
        ORDER BY created_at DESC, turn_sequence DESC LIMIT 1
      `).get() as { sourceIdsJson: string };
      expect(JSON.parse(stored.sourceIdsJson)).not.toContain(omittedEvidenceId);
    } finally {
      connection.sqlite.close();
    }
  });

  it("lets the general-design tutor call internal knowledge without relabeling it as course knowledge", async () => {
    const connection = await setup();
    await ingestCoursePackKnowledge(connection);
    let decisions = 0;
    const adapter = nativeTutor(async (messages, options) => {
      decisions += 1;
      if (decisions === 1) {
        const knowledgeTool = options?.tools?.find(({ name }) => (
          name.includes("knowledge-map_search-concepts")
        ));
        expect(knowledgeTool).toBeDefined();
        return {
          content: null,
          toolCalls: [{
            id: "call_general_knowledge",
            name: knowledgeTool!.name,
            arguments: JSON.stringify({ query: "文字 背景 对比度" }),
          }],
        };
      }
      const payload = JSON.parse(
        messages.findLast(({ role }) => role === "tool")?.content ?? "{}",
      ) as { output?: { items?: Array<{ id?: string; topic?: string }> } };
      expect(payload.output?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "design-text-contrast", topic: "DESIGN_FOUNDATIONS" }),
      ]));
      return {
        content: "先测正文与背景的实际对比度。普通正文至少达到 4.5:1；如果不够，优先拉开明度，而不是只加阴影。",
        toolCalls: [],
      };
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "海报正文和背景太接近，读不清怎么办？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(decisions).toBe(2);
      expect(response.coursePack.id).toBe("general-design");
      expect(response.reply.sources).toContainEqual(expect.objectContaining({
        id: "design-text-contrast",
        authority: "OFFICIAL",
      }));
      expect(response.reply.basis).toContainEqual({ kind: "GENERAL_DESIGN", label: "通用设计建议" });
      expect(response.reply.basis).not.toContainEqual({ kind: "COURSE_KNOWLEDGE", label: "课程知识" });
    } finally {
      connection.sqlite.close();
    }
  });

  it("uses semantic retrieval for a low-overlap student paraphrase and injects confidence plus provenance", async () => {
    const connection = await setup();
    await ingestCoursePackKnowledge(connection);
    const embeddingProvider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "semantic-fixture",
      cacheKey: "v3-text-contrast-fixture",
      async embed(inputs) {
        return inputs.map((value) => (
          /文字与背景的最低对比度检查|陷进底色|看着很费劲/.test(value)
            ? [1, 0]
            : [0, 1]
        ));
      },
    };
    const adapter = nativeTutor(async (messages) => {
      const context = JSON.parse(messages[1]?.content ?? "{}") as {
        referenceMaterials?: Array<{
          sourceId: string;
          excerpt: string;
          provenance: {
            authority: string;
            verifiedDate: string;
            locator: { kind: string; value: string };
          };
          retrieval: { method: string; confidence: number; semanticScore: number } | null;
        }>;
      };
      expect(context.referenceMaterials?.[0]).toMatchObject({
        sourceId: "design-text-contrast",
        excerpt: expect.stringContaining("看起来有对比"),
        provenance: {
          authority: "OFFICIAL",
          verifiedDate: "2026-07-17",
          locator: {
            kind: "URL",
            value: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
          },
        },
        retrieval: {
          method: "SEMANTIC",
          confidence: expect.any(Number),
          semanticScore: 1,
        },
      });
      return {
        content: [
          "这不是单纯的字体风格问题，而是文字与底色的明度、色相或透明度差不足。先测正文与背景的对比度，再决定是提亮文字、压暗底色，还是给文字增加稳定承托面。",
          "",
          "<!-- tutor-meta {\"sourceIds\":[\"design-text-contrast\"],\"title\":\"先把费劲变成可测的对比问题\"} -->",
        ].join("\n"),
        toolCalls: [],
      };
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "海报里的字像陷进底色里，看着很费劲。",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter, embeddingProvider },
      });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.sources).toContainEqual(expect.objectContaining({
        id: "design-text-contrast",
        authority: "OFFICIAL",
      }));
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        kind: "RETRIEVAL",
        status: "SUCCEEDED",
        label: "向量与词法混合检索",
        sourceIds: expect.arrayContaining(["design-text-contrast"]),
      }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps the GPT tutor response when the embeddings endpoint is unavailable", async () => {
    const connection = await setup();
    await ingestCoursePackKnowledge(connection);
    const embeddingProvider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "offline-embedding-fixture",
      cacheKey: "v3-offline-embedding-fixture",
      async embed() {
        throw new EmbeddingServiceError("RATE_LIMIT");
      },
    };
    const adapter = nativeTutor(async () => ({
      content: "Null CHOP 可以作为处理链末端的稳定引用点。先确认上游通道名和数值正常，再把后续引用统一指向这个 Null CHOP。",
      toolCalls: [],
    }));
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "Null CHOP 输出应该怎么接？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter, embeddingProvider },
      });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toContain("稳定引用点");
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        kind: "RETRIEVAL",
        status: "SUCCEEDED",
        label: "向量不可用，已使用词法检索",
        errorCode: "EMBEDDING_RATE_LIMIT",
      }));
      expect(response.executionSteps).not.toContainEqual(expect.objectContaining({ kind: "DEGRADED" }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("recovers after two pre-delta failures as model-assisted without splicing content", async () => {
    const connection = await setup();
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const visibleDeltas: string[] = [];
    let attempts = 0;
    const answer = "先确认当前目标，再用一张最小草图验证信息层级。";
    const adapter = nativeTutor(async (_messages, options) => {
      attempts += 1;
      if (attempts < 3) {
        throw new ModelServiceError(
          "INVALID_RESPONSE",
          null,
          null,
          null,
          "PROVIDER_FAILED",
          new Error(`discarded-attempt-${attempts}`),
        );
      }
      options?.onTextDelta?.("先确认当前目标，");
      options?.onTextDelta?.("再用一张最小草图验证信息层级。");
      return { content: answer, toolCalls: [] };
    });
    const basePolicy = getActiveAgentPolicy();
    const policy = {
      ...basePolicy,
      budgets: {
        ...basePolicy.budgets,
        modelIdleTimeoutMs: 1_000,
        modelTimeoutMs: 6_000,
        turnTimeoutMs: 9_000,
      },
    };
    try {
      const pending = new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "请帮我判断下一步。",
          context: { view: "AGENT" },
        },
        options: {
          modelProviderAdapter: adapter,
          onTextDelta: (delta) => visibleDeltas.push(delta),
          policy,
        },
      });
      const guarded = pending.then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      await vi.runAllTimersAsync();
      const outcome = await guarded;
      if (outcome.error) throw outcome.error;
      const response = outcome.value!;

      expect(attempts).toBe(3);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toBe(answer);
      expect(visibleDeltas).toEqual([
        "先确认当前目标，",
        "再用一张最小草图验证信息层级。",
      ]);
      expect(response.reply.message).not.toContain("discarded-attempt");
      expect(response.policy.budgets.modelRetries).toBe(2);
    } finally {
      vi.useRealTimers();
      connection.sqlite.close();
    }
  });

  it("exhausts two pre-delta retries before deterministic fallback", async () => {
    const connection = await setup();
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let attempts = 0;
    const adapter = nativeTutor(async () => {
      attempts += 1;
      throw new ModelServiceError(
        "INVALID_RESPONSE",
        null,
        null,
        null,
        "PROVIDER_FAILED",
      );
    });
    const basePolicy = getActiveAgentPolicy();
    const policy = {
      ...basePolicy,
      budgets: {
        ...basePolicy.budgets,
        modelIdleTimeoutMs: 1_000,
        modelTimeoutMs: 6_000,
        turnTimeoutMs: 9_000,
      },
    };
    try {
      const pending = new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "请帮我判断下一步。",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter, policy },
      });
      const guarded = pending.then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      await vi.runAllTimersAsync();
      const outcome = await guarded;
      if (outcome.error) throw outcome.error;
      const response = outcome.value!;

      expect(attempts).toBe(3);
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.policy.budgets.modelRetries).toBe(2);
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        kind: "DEGRADED",
        status: "SUCCEEDED",
        summary: expect.stringContaining("重试 2 次"),
      }));
    } finally {
      vi.useRealTimers();
      connection.sqlite.close();
    }
  });

  it.each([
    ["TIMEOUT", "MODEL_TIMEOUT"],
    ["TRANSPORT", "MODEL_CONNECTION_INTERRUPTED"],
  ] as const)("keeps streamed prose as incomplete after a %s failure instead of replacing it", async (code, reason) => {
    const connection = await setup();
    const visibleDeltas: string[] = [];
    let attempts = 0;
    const adapter = nativeTutor(async (_messages, options) => {
      attempts += 1;
      options?.onTextDelta?.("## 先固定阅读路径\n\n先把封面、导览和报名入口排成一条连续路径，再检查每一页是否只承担一个动作。");
      options?.onTextDelta?.("\n\n<!-- tutor-met");
      throw new ModelServiceError(code);
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "我的导览册阅读路径断了，怎么修？",
          context: { view: "BOOK_LAYOUT_LAB" },
        },
        options: {
          modelProviderAdapter: adapter,
          onTextDelta: (delta) => visibleDeltas.push(delta),
        },
      });

      expect(attempts).toBe(1);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply).toMatchObject({
        title: "先固定阅读路径",
        incomplete: { reason },
      });
      expect(response.reply.message).toContain("先把封面、导览和报名入口排成一条连续路径");
      expect(response.reply.message).not.toContain("tutor-met");
      expect(visibleDeltas.join("")).toContain("先把封面、导览和报名入口排成一条连续路径");
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "FINAL_RESPONSE",
        label: "保留未完成模型正文",
      }));
      expect(response.executionSteps).not.toContainEqual(expect.objectContaining({ kind: "DEGRADED" }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps a token-truncated model body as an incomplete answer instead of falling back", async () => {
    const connection = await setup();
    const adapter = nativeTutor(async () => ({
      content: [
        "## 先固定阅读路径",
        "",
        "先把封面、导览和报名入口排成一条连续路径，再检查每一页是否只承担一个动作。",
      ].join("\n"),
      toolCalls: [],
      outputTruncated: true,
    }));
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "我的导览册阅读路径断了，怎么修？",
          context: { view: "BOOK_LAYOUT_LAB" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply).toMatchObject({
        title: "先固定阅读路径",
        incomplete: { reason: "MODEL_OUTPUT_TRUNCATED" },
        whyThisStep: expect.stringContaining("本次输出达到长度上限"),
        uncertainty: expect.stringContaining("继续生成"),
      });
      expect(response.reply.message).toContain("先把封面、导览和报名入口排成一条连续路径");
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "FINAL_RESPONSE",
        label: "保留未完成模型正文",
        summary: expect.stringContaining("输出达到长度上限"),
      }));
      expect(response.executionSteps).not.toContainEqual(expect.objectContaining({ kind: "DEGRADED" }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not mark recalled memory as used when the final answer is a model-service fallback", async () => {
    const connection = await setup();
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const memoryId = "66666666-6666-4666-8666-666666666666";
    connection.sqlite.prepare(`
      INSERT INTO agent_student_memory(id,student_id,class_id,kind,content,salience,created_at)
      VALUES(?,'s1','c1','RECURRING_STRUGGLE','我总是卡在 OSC 端口配置。',8,1700000000)
    `).run(memoryId);
    const adapter = nativeTutor(async () => {
      throw new ModelServiceError("RATE_LIMIT", 5_000);
    });
    try {
      const pending = new CurrentAgentRuntime().run({
        connection,
        actor,
        input: { message: "OSC 端口怎么继续排查？", context: { view: "AGENT" } },
        options: { modelProviderAdapter: adapter, now: () => new Date("2026-07-17T10:00:00.000Z") },
      });
      const guarded = pending.then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      await vi.runAllTimersAsync();
      const outcome = await guarded;
      if (outcome.error) throw outcome.error;
      const response = outcome.value!;
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(connection.sqlite.prepare(
        "SELECT last_used_at lastUsedAt FROM agent_student_memory WHERE id=?",
      ).get(memoryId)).toEqual({ lastUsedAt: null });
    } finally {
      connection.sqlite.close();
    }
  });

  it("lets the model call a read-only tool and then answer from its observation", async () => {
    const connection = await setup();
    saveBookLayoutDraft(connection, actor, {
      audience: "COMMUNITY_RESIDENTS",
      pageOrder: ["cover", "activity-map", "quick-start", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
      diagnosticAnswers: ["AUDIENCE_FIRST", null, null],
      transferChoices: ["COMMUNITY_ENTRY_FIRST"],
    });
    let decisions = 0;
    const textDeltas: string[] = [];
    const toolProgress: Array<{ status: string; toolId: string }> = [];
    const adapter = nativeTutor(async (messages, options) => {
      decisions += 1;
      if (decisions === 1) {
        const bookTool = options?.tools?.find(({ name }) => name.includes("book-layout-lab_read-state"));
        expect(bookTool?.parameters).toMatchObject({ type: "object" });
        return {
          content: null,
          toolCalls: [{ id: "call_book_state", name: bookTool!.name, arguments: "{}" }],
        };
      }
      const observation = messages.findLast((message) => message.role === "tool");
      expect(observation?.content).toContain("COMMUNITY_RESIDENTS");
      options?.onTextDelta?.("你现在的八页顺序已经把活动入口放在前面");
      return {
        content: [
          "你现在的八页顺序已经把活动入口放在前面，但报名动作被拖到了最后的联系页。",
          "",
          "先在 quick-start 页补一个明确的报名入口，并让 activity-map 与它形成前后呼应；不要先重做整套视觉。",
          "",
          "<!-- tutor-meta {\"episode\":\"DEBUG\",\"decisionCode\":\"V3_READING_PATH\",\"responseStrategy\":\"DIAGNOSTIC_GUIDANCE\",\"sourceIds\":null,\"actionType\":null,\"title\":\"先修复报名路径\"} -->",
        ].join("\n"),
        toolCalls: [],
      };
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "社区居民找不到报名入口，请读取我现在的八页导览册帮我判断。",
          context: { view: "BOOK_LAYOUT_LAB" },
        },
        options: {
          modelProviderAdapter: adapter,
          onTextDelta: (delta) => textDeltas.push(delta),
          onToolProgress: ({ status, toolId }) => toolProgress.push({ status, toolId }),
        },
      });

      expect(decisions).toBe(2);
      expect(textDeltas).toEqual(["你现在的八页顺序已经把活动入口放在前面"]);
      expect(toolProgress).toEqual([
        { status: "RUNNING", toolId: "book-layout-lab.read-state" },
        { status: "SUCCEEDED", toolId: "book-layout-lab.read-state" },
      ]);
      expect(response).toMatchObject({
        aiMode: "MODEL_ASSISTED",
        episode: "DEBUG",
        decisionCode: "V3_READING_PATH",
        reply: { title: "先修复报名路径" },
      });
      expect(response.reply.message).not.toContain("tutor-meta");
      expect(response.reply.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ authority: "LEARNING_RECORD" }),
      ]));
      expect(response.executionSteps.map(({ kind }) => kind)).toEqual([
        "MODEL_DECISION",
        "TOOL_CALL",
        "TOOL_OBSERVATION",
        "MODEL_DECISION",
        "FINAL_RESPONSE",
      ]);
      expect(connection.sqlite.prepare(
        "SELECT count(*) count FROM agent_tool_calls WHERE turn_id=?",
      ).get(response.turnId)).toEqual({ count: 1 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("lets the model run hybrid semantic search with a refined internal-corpus query", async () => {
    const connection = await setup();
    await ingestCoursePackKnowledge(connection);
    const embeddingProvider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "tool-semantic-fixture",
      cacheKey: "v3-tool-semantic-feedback-v1",
      async embed(inputs) {
        return inputs.map((value) => (
          /Feedback TOP：目标节点|旧画面一帧帧叠回去|残影越积越厚/.test(value)
            ? [1, 0]
            : [0, 1]
        ));
      },
    };
    let decisions = 0;
    const adapter = nativeTutor(async (messages, options) => {
      decisions += 1;
      if (decisions === 1) {
        const knowledgeTool = options?.tools?.find(({ name }) => (
          name.includes("knowledge-map_search-concepts")
        ));
        expect(knowledgeTool).toBeDefined();
        return {
          content: null,
          toolCalls: [{
            id: "call_semantic_knowledge",
            name: knowledgeTool!.name,
            arguments: JSON.stringify({ query: "旧画面一帧帧叠回去，残影越积越厚" }),
          }],
        };
      }
      const toolMessage = messages.findLast(({ role }) => role === "tool");
      const payload = JSON.parse(toolMessage?.content ?? "{}") as {
        output?: {
          retrieval?: { strategy?: string; semanticStatus?: string };
          items?: Array<{
            id?: string;
            locator?: { kind?: string; value?: string };
            retrieval?: { method?: string; confidence?: number };
          }>;
        };
      };
      expect(payload.output).toMatchObject({
        retrieval: { strategy: "HYBRID", semanticStatus: "USED" },
      });
      expect(payload.output?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "td-feedback-top",
          locator: { kind: "URL", value: "https://docs.derivative.ca/Feedback_TOP" },
          retrieval: expect.objectContaining({
            method: expect.stringMatching(/SEMANTIC|HYBRID/),
            confidence: expect.any(Number),
          }),
        }),
      ]));
      return {
        content: "这是 Feedback TOP 回路持续累积上一帧的结果。先核对 Target TOP 指向，再暂时触发 Reset Pulse，确认残影是否归零。",
        toolCalls: [],
      };
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "TouchDesigner 里这个效果越跑越糊，我该先查哪里？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter, embeddingProvider },
      });

      expect(decisions).toBe(2);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toContain("Feedback TOP");
      expect(response.reply.sources).toContainEqual(expect.objectContaining({
        id: "td-feedback-top",
        authority: "OFFICIAL",
        scope: expect.stringContaining("Target TOP"),
      }));
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_CALL",
        status: "SUCCEEDED",
        toolId: "knowledge-map.search-concepts",
      }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps the tutor answer when semantic tool retrieval falls back to lexical search", async () => {
    const connection = await setup();
    await ingestCoursePackKnowledge(connection);
    const embeddingProvider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "tool-offline-fixture",
      cacheKey: "v3-tool-offline-v1",
      async embed() {
        throw new EmbeddingServiceError("RATE_LIMIT");
      },
    };
    let decisions = 0;
    const adapter = nativeTutor(async (messages, options) => {
      decisions += 1;
      if (decisions === 1) {
        const knowledgeTool = options?.tools?.find(({ name }) => (
          name.includes("knowledge-map_search-concepts")
        ));
        return {
          content: null,
          toolCalls: [{
            id: "call_lexical_fallback",
            name: knowledgeTool!.name,
            arguments: JSON.stringify({ query: "Null CHOP 输出" }),
          }],
        };
      }
      const payload = JSON.parse(
        messages.findLast(({ role }) => role === "tool")?.content ?? "{}",
      ) as {
        output?: {
          retrieval?: { strategy?: string; semanticStatus?: string; errorCode?: string };
          items?: Array<{ id?: string }>;
        };
      };
      expect(payload.output?.retrieval).toEqual({
        strategy: "LEXICAL_FALLBACK",
        semanticStatus: "FAILED",
        errorCode: "RATE_LIMIT",
      });
      expect(payload.output?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "td-null-chop" }),
      ]));
      return {
        content: "语义检索暂时不可用，但内部词法资料仍显示：Null CHOP 可作为处理链末端的稳定引用出口。先核对上游通道，再统一下游引用。",
        toolCalls: [],
      };
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "TouchDesigner 的 Null CHOP 输出该怎么接？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter, embeddingProvider },
      });

      expect(decisions).toBe(2);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toContain("Null CHOP");
      expect(response.executionSteps).not.toContainEqual(expect.objectContaining({ kind: "DEGRADED" }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps a 15-second tool and a 121-second deep answer on MODEL_ASSISTED under V4", async () => {
    const connection = await setup();
    vi.useFakeTimers();
    const streamed: string[] = [];
    const body = Array.from({ length: 18 }, (_, index) =>
      `第 ${index + 1} 步：先固定信息层级、阅读距离和留白的一个变量，再用同一任务目标比较两个版本，记录哪一个让目标读者更快找到主信息。`,
    ).join("\n\n");
    let decisions = 0;
    const idleTimeouts: Array<number | undefined> = [];
    const adapter = nativeTutor(async (_messages, options) => {
      decisions += 1;
      idleTimeouts.push(options?.idleTimeoutMs);
      if (decisions === 1) {
        const tool = options?.tools?.find(({ name }) => name.includes("book-layout-lab_read-state"));
        return {
          content: null,
          toolCalls: [{ id: "call_long_replay", name: tool!.name, arguments: "{}" }],
        };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 121_000));
      for (const delta of [body.slice(0, 600), body.slice(600, 1_200), body.slice(1_200)]) {
        options?.onTextDelta?.(delta);
      }
      return { content: body, toolCalls: [] };
    });
    const toolExecutor: AgentToolExecutor = async ({ call }) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 15_000));
      return {
        call,
        observation: {
          callId: "11111111-1111-4111-8111-111111111111",
          toolId: call.toolId,
          toolVersion: "1",
          adapterId: "book-layout-lab",
          status: "SUCCESS",
          summary: "已读取当前导览册的页面顺序。",
          facts: ["报名入口在联系页"],
          errorCode: null,
          latencyMs: 15_000,
        },
        output: { pageOrder: ["cover", "quick-start", "contact"] },
      };
    };
    try {
      const pending = new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "请深度复盘我的八页导览册：先读取当前页面顺序，再给出一份完整的阅读路径和版式改进方案。",
          context: { view: "BOOK_LAYOUT_LAB" },
        },
        options: {
          modelProviderAdapter: adapter,
          toolExecutor,
          onTextDelta: (delta) => streamed.push(delta),
        },
      });
      const guarded = pending.then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );

      await vi.runAllTimersAsync();
      const outcome = await guarded;
      if (outcome.error) throw outcome.error;
      const response = outcome.value!;

      expect(getActiveAgentPolicy().budgets).toMatchObject({
        modelIdleTimeoutMs: 75_000,
        modelTimeoutMs: 600_000,
        turnTimeoutMs: 900_000,
      });
      expect(decisions).toBe(2);
      expect(idleTimeouts).toEqual([75_000, 75_000]);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.policy).toMatchObject({
        policyVersion: "4",
        budgets: { modelRetries: 0, toolCalls: 1 },
      });
      expect(response.reply.message).toBe(body);
      expect(streamed.join("")).toBe(body);
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_CALL",
        status: "SUCCEEDED",
        latencyMs: 15_000,
      }));
      expect(response.executionSteps).not.toContainEqual(expect.objectContaining({ kind: "DEGRADED" }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("redacts nested tool observations before the next model decision", async () => {
    const connection = await setup();
    vi.stubEnv("STUDENT_NUMBER_PREFIX", "SC");
    vi.stubEnv("STUDENT_NUMBER_DIGITS", "10");
    let decisions = 0;
    const adapter = nativeTutor(async (messages, options) => {
      decisions += 1;
      if (decisions === 1) {
        const tool = options?.tools?.find(({ name }) => name.includes("book-layout-lab_read-state"));
        return {
          content: null,
          toolCalls: [{ id: "call_sensitive_tool", name: tool!.name, arguments: "{}" }],
        };
      }
      const content = messages.findLast((message) => message.role === "tool")?.content ?? "";
      expect(content).toContain("[已遮蔽手机号]");
      expect(content).toContain("[已遮蔽邮箱]");
      expect(content).toContain("[已遮蔽学号]");
      expect(content).not.toMatch(/13812345678|arlo@example\.com|SC2026123456/i);
      return { content: "已读取脱敏后的学习现场，先继续核对页面入口。", toolCalls: [] };
    });
    const toolExecutor: AgentToolExecutor = async ({ call }) => ({
      call,
      observation: {
        callId: "11111111-1111-4111-8111-111111111111",
        toolId: call.toolId,
        toolVersion: "1",
        adapterId: "book-layout-lab",
        status: "SUCCESS",
        summary: "联系人 13812345678，邮箱 arlo@example.com。",
        facts: ["学号 SC2026123456", "嵌套联系方式也需遮蔽"],
        errorCode: null,
        latencyMs: 1,
      },
      output: {
        contact: { phone: "13812345678", email: "arlo@example.com" },
        learners: [{ studentNumber: "SC2026123456" }],
      },
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: { message: "请读取当前导览册。", context: { view: "BOOK_LAYOUT_LAB" } },
        options: { modelProviderAdapter: adapter, toolExecutor },
      });
      expect(decisions).toBe(2);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toContain("脱敏后的学习现场");
    } finally {
      connection.sqlite.close();
    }
  });

  it("records an invalid optional sidecar without rejecting useful正文", async () => {
    const connection = await setup();
    const adapter = nativeTutor(async () => ({
      content: "先把标题和主体图形的尺度差拉开，再检查三米外能否一眼读出主信息。\n\n<!-- tutor-meta {not-json} -->",
      toolCalls: [],
    }));
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: { message: "海报层级不明显怎么改？", context: { view: "AGENT" } },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toBe("先把标题和主体图形的尺度差拉开，再检查三米外能否一眼读出主信息。");
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        errorCode: "V3_SIDECAR_INVALID",
        status: "SKIPPED",
      }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("uses deterministic fallback only after model service failure and keeps completed tool observations", async () => {
    const connection = await setup();
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    saveBookLayoutDraft(connection, actor, {
      audience: "COMMUNITY_RESIDENTS",
      pageOrder: ["cover", "activity-map", "quick-start", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
      diagnosticAnswers: ["AUDIENCE_FIRST", null, null],
      transferChoices: ["COMMUNITY_ENTRY_FIRST"],
    });
    let decisions = 0;
    const adapter = nativeTutor(async (_messages, options) => {
      decisions += 1;
      if (decisions === 1) {
        const bookTool = options?.tools?.find(({ name }) => name.includes("book-layout-lab_read-state"));
        return {
          content: null,
          toolCalls: [{ id: "call_before_outage", name: bookTool!.name, arguments: "{}" }],
        };
      }
      throw new ModelServiceError("RATE_LIMIT", 5_000);
    });
    try {
      const pending = new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "读取我现在的八页导览册并给一个下一步。",
          context: { view: "BOOK_LAYOUT_LAB" },
        },
        options: { modelProviderAdapter: adapter },
      });
      const guarded = pending.then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      await vi.runAllTimersAsync();
      const outcome = await guarded;
      if (outcome.error) throw outcome.error;
      const response = outcome.value!;

      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "DEGRADED",
        status: "SUCCEEDED",
      }));
      expect(connection.sqlite.prepare(
        "SELECT count(*) count FROM agent_tool_calls WHERE turn_id=?",
      ).get(response.turnId)).toEqual({ count: 1 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("recalls a prior-task student memory in a fresh tutor session without exposing database ids", async () => {
    const connection = await setup();
    let modelCall = 0;
    let storedMemoryId = "";
    const adapter = nativeTutor(async (messages) => {
      modelCall += 1;
      const context = JSON.parse(messages[1]?.content ?? "{}") as {
        studentQuestion?: string;
        recentConversation?: unknown[];
        studentMemories?: Array<{ alias: string; kind: string; content: string }>;
        referenceMaterials?: unknown[];
      };
      if (modelCall === 1) {
        expect(context.studentMemories).toEqual([]);
        return {
          content: [
            "先把 OSC 发送端口和接收端口写在同一张检查表里，再逐项核对。",
            '<!-- tutor-meta {"memoryCandidates":[{"kind":"RECURRING_STRUGGLE","evidenceQuote":"我的项目正在做声音海报，我总是卡在 OSC 端口配置。","salience":3}]} -->',
          ].join("\n"),
          toolCalls: [],
        };
      }
      expect(context.recentConversation).toEqual([]);
      expect(context.studentMemories).toContainEqual(expect.objectContaining({
        alias: expect.stringMatching(/^M\d+$/),
        kind: "RECURRING_STRUGGLE",
        content: "我的项目正在做声音海报,我总是卡在 OSC 端口配置。",
      }));
      expect(context.referenceMaterials).toEqual([]);
      expect(messages[1]?.content).not.toContain(storedMemoryId);
      expect(context.studentQuestion).toContain("[已遮蔽手机号]");
      expect(context.studentQuestion).not.toContain("13812345678");
      return {
        content: "你上次反复卡在 OSC 端口配置，这次先沿用同一张端口检查表，再确认发送地址与接收地址是否一致。",
        toolCalls: [],
      };
    });
    try {
      await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "我的项目正在做声音海报，我总是卡在 OSC 端口配置。",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter, now: () => new Date("2026-07-17T08:00:00.000Z") },
      });
      storedMemoryId = (connection.sqlite.prepare(`
        SELECT id FROM agent_student_memory
        WHERE student_id='s1' AND kind='RECURRING_STRUGGLE'
      `).get() as { id: string }).id;
      connection.sqlite.exec(`
        UPDATE design_project_tasks SET status='ARCHIVED';
        INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type)
          VALUES('77777777-7777-4777-8777-777777777777','s1','c1','新的声音交互任务','ACTIVE',1784282400,1784282400,'REAL');
      `);
      const recalled = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          taskId: "77777777-7777-4777-8777-777777777777",
          message: "OSC 端口又卡住了，怎么继续？电话 13812345678。",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter, now: () => new Date("2026-07-17T10:00:00.000Z") },
      });

      expect(recalled.aiMode).toBe("MODEL_ASSISTED");
      expect(recalled.reply.message).toContain("上次反复卡在 OSC 端口配置");
      expect(recalled.reply.sources).toEqual([]);
      expect(connection.sqlite.prepare(
        "SELECT last_used_at lastUsedAt FROM agent_student_memory WHERE id=?",
      ).get(storedMemoryId)).toEqual({
        lastUsedAt: Math.floor(new Date("2026-07-17T10:00:00.000Z").getTime() / 1_000),
      });
    } finally {
      connection.sqlite.close();
    }
  });

  it("rolls old task dialogue into a summary while retaining only eight recent raw turns", async () => {
    const connection = await setup();
    let modelCall = 0;
    type CapturedContext = {
      conversationSummary?: { summary: string; coveredTurnCount: number } | null;
      recentConversation?: Array<{ studentMessage: string }>;
    };
    const captured: { value?: CapturedContext } = {};
    const adapter = nativeTutor(async (messages) => {
      modelCall += 1;
      if (modelCall === 11) {
        captured.value = JSON.parse(messages[1]?.content ?? "{}") as CapturedContext;
      }
      return { content: `第 ${modelCall} 轮：继续比较当前版式方向。`, toolCalls: [] };
    });
    try {
      const runtime = new CurrentAgentRuntime();
      for (let index = 1; index <= 11; index += 1) {
        await runtime.run({
          connection,
          actor,
          input: { message: `第${index}轮继续讨论版式。`, context: { view: "AGENT" } },
          options: {
            modelProviderAdapter: adapter,
            now: () => new Date(Date.UTC(2026, 6, 17, 8, 0, index)),
          },
        });
      }

      expect(captured.value?.conversationSummary).toMatchObject({
        coveredTurnCount: 2,
        summary: expect.stringContaining("第2轮继续讨论版式"),
      });
      expect(captured.value?.recentConversation).toHaveLength(8);
      expect(captured.value?.recentConversation?.[0]?.studentMessage).toBe("第3轮继续讨论版式。");
      expect(captured.value?.recentConversation?.at(-1)?.studentMessage).toBe("第10轮继续讨论版式。");
      expect(connection.sqlite.prepare(`
        SELECT covered_turn_count coveredTurnCount,revision,data_type dataType
        FROM agent_session_summaries WHERE student_id='s1'
      `).get()).toEqual({ coveredTurnCount: 3, revision: 3, dataType: "REAL" });
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps a successful tutor turn when optional memory and summary stores are unavailable", async () => {
    const connection = await setup();
    connection.sqlite.exec("DROP TABLE agent_session_summaries; DROP TABLE agent_student_memory;");
    const adapter = nativeTutor(async () => ({
      content: [
        "先核对端口，再看发送地址。",
        '<!-- tutor-meta {"memoryCandidates":[{"kind":"RECURRING_STRUGGLE","evidenceQuote":"我总是卡在 OSC 端口","salience":2}]} -->',
      ].join("\n"),
      toolCalls: [],
    }));
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: { message: "我总是卡在 OSC 端口", context: { view: "AGENT" } },
        options: { modelProviderAdapter: adapter },
      });
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toBe("先核对端口，再看发送地址。");
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_turns").get()).toEqual({ count: 1 });
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        kind: "RETRIEVAL",
        errorCode: "MEMORY_STORE_UNAVAILABLE",
      }));
    } finally {
      connection.sqlite.close();
    }
  });
});

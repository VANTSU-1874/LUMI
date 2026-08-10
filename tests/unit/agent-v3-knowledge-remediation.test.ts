// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type {
  ModelConversationMessage,
  ModelResponseOptions,
} from "@/lib/ai/client";
import { getCapability } from "@/lib/agent/capability-registry";
import {
  AgentEvidenceToolOutputV2Schema,
} from "@/lib/agent/evidence-tool-v2";
import { createExecutionTrace } from "@/lib/agent/execution-trace";
import type {
  ModelProviderAdapter,
} from "@/lib/agent/model-provider-adapter";
import {
  getActiveAgentPolicy,
} from "@/lib/agent/policy-registry";
import type {
  AgentToolDefinition,
} from "@/lib/agent/tool-contract";
import type {
  AgentToolExecutor,
} from "@/lib/agent/tool-executor";
import {
  runTutorToolLoop,
} from "@/lib/agent/v3/tutor-tool-loop";
import {
  getCoursePack,
} from "@/lib/course-packs/registry";

function toolDefinition(input: {
  id: string;
  effect: "READ_CONTEXT" | "EXTERNAL_CALL";
  access: "READ_ONLY" | "STUDENT_CONFIRMATION";
}) {
  return {
    descriptor: {
      id: input.id,
      version: "1",
      adapterId:
        input.effect === "EXTERNAL_CALL"
          ? "external-web"
          : "knowledge-map",
      owner:
        input.effect === "EXTERNAL_CALL"
          ? {
              type: "SKILL" as const,
              id: "public-research",
              label: "公开资料检索 Skill",
            }
          : getCapability("course-reference"),
      label:
        input.effect === "EXTERNAL_CALL"
          ? "联网检索公开资料"
          : "检索多模态课程证据",
      description: "独立补救回归工具。",
      inputHint: "测试输入",
      effect: input.effect,
      access: input.access,
      timeoutMs: 500,
      recommendedByCoursePacks: [{
        id: "digital-interaction",
        version: "1",
      }],
    },
    inputSchema:
      input.effect === "EXTERNAL_CALL"
        ? z.object({}).strict()
        : z.object({
            query: z.string().min(1),
          }).strict(),
    outputSchema:
      z.object({}).passthrough(),
    execute: () => ({}),
    summarize: () => ({
      summary: "测试观察。",
      facts: [],
      empty: false,
    }),
  } satisfies AgentToolDefinition;
}

function baseInput(input: {
  client: ModelProviderAdapter;
  availableTools: readonly AgentToolDefinition[];
  toolExecutor: AgentToolExecutor;
  trace?: ReturnType<typeof createExecutionTrace>;
}) {
  return {
    connection: {} as never,
    actor: {
      userId: "s1",
      role: "STUDENT" as const,
    },
    pack:
      getCoursePack(
        "digital-interaction",
        "1",
      ),
    context: {} as never,
    question:
      "我的声音输入已经有波形，但还没变成稳定数值，接下来先做什么？",
    client: input.client,
    messages: [{
      role: "system" as const,
      content: "你是设计导师。",
    }, {
      role: "user" as const,
      content: "初始上下文含旧课程参考。",
    }],
    availableTools: input.availableTools,
    policy: getActiveAgentPolicy(),
    turnDeadline:
      performance.now() + 5_000,
    trace:
      input.trace
      ?? createExecutionTrace(),
    toolExecutor: input.toolExecutor,
  };
}

function visualEvidenceOutput() {
  return AgentEvidenceToolOutputV2Schema.parse({
    schemaVersion: 2,
    kind: "KNOWLEDGE_MAP_SEARCH_EVIDENCE",
    bundle: {
      bundleId: "evidence-visual-remediation",
      status: "SUCCESS",
      queryHash: "a".repeat(64),
      corpusBundleHash: "b".repeat(64),
      activeIndexBundleHash: "c".repeat(64),
      capabilitiesLost: [],
    },
    channels: [
      {
        channel: "LEXICAL",
        status: "SUCCESS",
        hitCount: 1,
        indexVersionId: null,
        modelId: null,
        modelRevision: null,
      },
      {
        channel: "TEXT_VECTOR",
        status: "SUCCESS",
        hitCount: 1,
        indexVersionId: null,
        modelId: "fixture-text",
        modelRevision: "1",
      },
      {
        channel: "VISUAL_VECTOR",
        status: "SUCCESS",
        hitCount: 1,
        indexVersionId: null,
        modelId: "fixture-visual",
        modelRevision: "1",
      },
    ],
    evidence: {
      nodes: [{
        nodeId: "node-visual-reference",
        objectId: "object-visual-reference",
        sourceId: "source-visual-reference",
        kind: "IMAGE",
        relation: "PRIMARY",
        evidenceKind: "VISUAL_REFERENCE",
        excerpt: null,
        assetId: "asset-visual-reference",
      }],
      assets: [{
        assetId: "asset-visual-reference",
        objectId: "object-visual-reference",
        sha256: "d".repeat(64),
        widthPx: 900,
        heightPx: 1_200,
        previewUrl:
          "/api/knowledge/assets/asset-visual-reference",
      }],
      regions: [],
      sources: [{
        sourceId: "source-visual-reference",
        objectId: "object-visual-reference",
        title: "课程参考图",
        authority: "TEACHER_EXPERIENCE",
        verifiedDate: "2026-07-30",
        scope: "只描述课程参考图中静态可见的版式关系。",
      }],
    },
    usageRules: {
      knowledgeFacts:
        "只把带 excerpt 的课程节点作为课程知识事实。",
      visualReferences:
        "图片和区域是课程参考图，只描述其中可见内容，不当作学生当前作品。",
      inference:
        "超出节点文字或参考图可见内容的判断必须明确标为推断。",
      uncertainty:
        "证据不足或通道降级时要说明不确定性，不得补造来源。",
    },
  });
}

describe("T6 healthy EMPTY remediation", () => {
  it("reasserts an already-injected legacy baseline without changing V2 EMPTY", async () => {
    const evidenceTool = toolDefinition({
      id: "knowledge-map.search-evidence",
      effect: "READ_CONTEXT",
      access: "READ_ONLY",
    });
    const trace = createExecutionTrace();
    let decision = 0;
    const client: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "baseline-reuse-test",
      capabilities: { vision: false },
      async complete() {
        throw new Error(
          "NATIVE_RESPONSE_REQUIRED",
        );
      },
      async respond(
        messages: ModelConversationMessage[],
        options?: ModelResponseOptions,
      ) {
        decision += 1;
        if (decision === 1) {
          expect(options?.toolChoice)
            .toBe("required");
          expect(options?.tools)
            .toHaveLength(1);
          return {
            content: null,
            toolCalls: [{
              id: "evidence-empty",
              name: options?.tools?.[0]
                ?.name ?? "",
              arguments: JSON.stringify({
                query:
                  "声音波形转稳定控制值",
              }),
            }],
          };
        }
        if (decision === 2) {
          const toolMessage =
            messages.findLast(
              ({ role }) => role === "tool",
            );
          const payload = JSON.parse(
            toolMessage?.content ?? "{}",
          ) as {
            status?: string;
            output?: {
              retrievalMode?: string;
              reason?: string;
              references?: Array<{
                sourceId: string;
                excerpt: string;
              }>;
            };
          };
          expect(payload.status).toBe("EMPTY");
          expect(payload.output).toMatchObject({
            retrievalMode:
              "BASELINE_REUSED",
            reason: "V2_HEALTHY_EMPTY",
            references: [{
              sourceId:
                "audio-analyze-baseline",
              excerpt:
                "先用 Analyze CHOP 的 RMS 把声音波形归纳为稳定数值。",
            }],
          });
          return {
            content:
              "先用 Analyze/RMS 得到稳定数值，再进入映射。",
            toolCalls: [],
          };
        }
        expect(options?.structuredOutput?.name)
          .toBe("lumi_rag_source_attribution_v1");
        expect(messages[0]?.content)
          .toContain("证据归因审阅器");
        return {
          content: JSON.stringify({
            sourceIds: [
              "audio-analyze-baseline",
            ],
          }),
          toolCalls: [],
        };
      },
    };
    const toolExecutor: AgentToolExecutor =
      vi.fn(async ({ call }) => ({
        call,
        observation: {
          callId:
            "11111111-1111-4111-8111-111111111111",
          toolId: call.toolId,
          toolVersion: "1",
          adapterId: "knowledge-map",
          status: "EMPTY" as const,
          summary: "V2 没有匹配证据。",
          facts: [],
          errorCode: null,
          latencyMs: 2,
        },
        output: { bundleStatus: "EMPTY" },
      }));

    const result = await runTutorToolLoop({
      ...baseInput({
        client,
        availableTools: [evidenceTool],
        toolExecutor,
        trace,
      }),
      requiredToolIds: [
        "knowledge-map.search-evidence",
      ],
      legacyKnowledgeBaseline: [{
        sourceId:
          "audio-analyze-baseline",
        title: "声音转控制值",
        excerpt:
          "先用 Analyze CHOP 的 RMS 把声音波形归纳为稳定数值。",
        authority: "COURSE_DESIGN",
        scope: "声音反应教学顺序。",
      }],
      evidenceSearchV2: {
        search: async () => {
          throw new Error(
            "UNUSED_TEST_EVIDENCE_SEARCH",
          );
        },
        runtimeHealth: () => ({
          generationHash: "a".repeat(64),
          textCircuitState: "CLOSED",
          visualCircuitState: "OPEN",
          visualQueueDepth: 0,
          visualCacheEntries: 2,
        }),
      },
      validateEvidenceSourceAttribution:
        (text, sourceIds) =>
          [...sourceIds].some((sourceId) =>
            text.includes(sourceId)),
    });

    expect(result.text).toContain(
      "Analyze/RMS",
    );
    expect(result.text).toContain(
      "audio-analyze-baseline",
    );
    expect(decision).toBe(3);
    expect(toolExecutor).toHaveBeenCalledTimes(1);
    expect(
      result.toolExecutions[0]
        ?.observation.status,
    ).toBe("EMPTY");
    expect(
      trace.snapshot()
        .map(({ label }) => label),
    ).toContain("复用旧课程基线");
    expect(
      trace.snapshot(),
    ).toContainEqual(
      expect.objectContaining({
        kind: "DEGRADED",
        status: "SUCCEEDED",
        label:
          "知识检索通道保护已触发",
        summary:
          expect.stringContaining(
            "视觉向量:OPEN",
          ),
      }),
    );
  });

  it("delivers selected visual evidence to both the answer and isolated attribution reviewer", async () => {
    const evidenceTool = toolDefinition({
      id: "knowledge-map.search-evidence",
      effect: "READ_CONTEXT",
      access: "READ_ONLY",
    });
    const output = visualEvidenceOutput();
    const resolver = vi.fn(async () => ({
      mimeType: "image/png" as const,
      bytes: new Uint8Array([1, 2, 3]),
    }));
    let decision = 0;
    const client: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "visual-evidence-attribution-test",
      capabilities: { vision: true },
      async complete() {
        throw new Error(
          "NATIVE_RESPONSE_REQUIRED",
        );
      },
      async respond(messages, options) {
        decision += 1;
        if (decision === 1) {
          expect(options?.images)
            .toBeUndefined();
          return {
            content: null,
            toolCalls: [{
              id: "visual-evidence",
              name: options?.tools?.[0]
                ?.name ?? "",
              arguments: JSON.stringify({
                query:
                  "检查课程参考图的版式关系",
              }),
            }],
          };
        }
        expect(options?.images).toEqual([{
          mimeType: "image/png",
          bytes: new Uint8Array([1, 2, 3]),
        }]);
        if (decision === 2) {
          expect(messages[0]?.content)
            .toContain(
              "本轮没有学生作品图",
            );
          expect(messages[0]?.content)
            .toContain(
              "图像1：课程参考图",
            );
          expect(messages[0]?.content)
            .toContain(
              "不得把其中的具体颜色、人物、文字、线条或构图移植成对学生当前作品的观察",
            );
          return {
            content:
              "课程参考图里，标题和图片沿共同边界形成了清楚的阅读顺序。",
            toolCalls: [],
          };
        }
        expect(options?.structuredOutput?.name)
          .toBe("lumi_rag_source_attribution_v1");
        expect(messages[1]?.content)
          .toContain(
            "\"visualReferenceIndex\":1",
          );
        return {
          content: JSON.stringify({
            sourceIds: [
              "node-visual-reference",
            ],
          }),
          toolCalls: [],
        };
      },
    };
    const toolExecutor: AgentToolExecutor =
      vi.fn(async ({ call }) => ({
        call,
        observation: {
          callId:
            "55555555-5555-4555-8555-555555555555",
          toolId: call.toolId,
          toolVersion: "1",
          adapterId: "knowledge-map",
          status: "SUCCESS" as const,
          summary:
            "命中一张课程参考图。",
          facts: [],
          errorCode: null,
          latencyMs: 2,
        },
        output,
      }));

    const result = await runTutorToolLoop({
      ...baseInput({
        client,
        availableTools: [evidenceTool],
        toolExecutor,
      }),
      requiredToolIds: [
        "knowledge-map.search-evidence",
      ],
      legacyKnowledgeBaseline: [],
      evidenceImageResolver: resolver,
      validateEvidenceSourceAttribution:
        (text, sourceIds) =>
          [...sourceIds].some((sourceId) =>
            text.includes(sourceId)),
    });

    expect(resolver)
      .toHaveBeenCalledWith(
        "asset-visual-reference",
      );
    expect(result.text)
      .toContain("node-visual-reference");
    expect(decision).toBe(3);
  });

  it("does not attribute visual evidence when the selected course image cannot be delivered", async () => {
    const evidenceTool = toolDefinition({
      id: "knowledge-map.search-evidence",
      effect: "READ_CONTEXT",
      access: "READ_ONLY",
    });
    const resolver = vi.fn(async () => {
      throw new Error(
        "COURSE_REFERENCE_IMAGE_UNAVAILABLE",
      );
    });
    let decision = 0;
    const client: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "visual-evidence-unavailable-test",
      capabilities: { vision: true },
      async complete() {
        throw new Error(
          "NATIVE_RESPONSE_REQUIRED",
        );
      },
      async respond(_messages, options) {
        decision += 1;
        if (decision === 1) {
          return {
            content: null,
            toolCalls: [{
              id: "visual-evidence-unavailable",
              name: options?.tools?.[0]
                ?.name ?? "",
              arguments: JSON.stringify({
                query:
                  "检查课程参考图的版式关系",
              }),
            }],
          };
        }
        expect(options?.images)
          .toBeUndefined();
        return {
          content:
            "目前只能先说明一般的版式检查方法。",
          toolCalls: [],
        };
      },
    };
    const toolExecutor: AgentToolExecutor =
      vi.fn(async ({ call }) => ({
        call,
        observation: {
          callId:
            "66666666-6666-4666-8666-666666666666",
          toolId: call.toolId,
          toolVersion: "1",
          adapterId: "knowledge-map",
          status: "SUCCESS" as const,
          summary:
            "命中一张课程参考图。",
          facts: [],
          errorCode: null,
          latencyMs: 2,
        },
        output: visualEvidenceOutput(),
      }));
    const validateEvidenceSourceAttribution =
      vi.fn(() => true);
    const trace = createExecutionTrace();

    const result = await runTutorToolLoop({
      ...baseInput({
        client,
        availableTools: [evidenceTool],
        toolExecutor,
        trace,
      }),
      requiredToolIds: [
        "knowledge-map.search-evidence",
      ],
      legacyKnowledgeBaseline: [],
      evidenceImageResolver: resolver,
      validateEvidenceSourceAttribution,
    });

    expect(resolver)
      .toHaveBeenCalledWith(
        "asset-visual-reference",
      );
    expect(result.text)
      .not.toContain("node-visual-reference");
    expect(decision).toBe(2);
    expect(validateEvidenceSourceAttribution)
      .not.toHaveBeenCalled();
    expect(
      trace.snapshot()
        .map(({ label }) => label),
    ).toContain("课程参考图读取失败");
  });

  it("keeps the double-empty path free of fabricated baseline references", async () => {
    const evidenceTool = toolDefinition({
      id: "knowledge-map.search-evidence",
      effect: "READ_CONTEXT",
      access: "READ_ONLY",
    });
    let decision = 0;
    const client: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "double-empty-test",
      capabilities: { vision: false },
      async complete() {
        throw new Error(
          "NATIVE_RESPONSE_REQUIRED",
        );
      },
      async respond(messages, options) {
        decision += 1;
        if (decision === 1) {
          return {
            content: null,
            toolCalls: [{
              id: "evidence-empty",
              name: options?.tools?.[0]
                ?.name ?? "",
              arguments: JSON.stringify({
                query: "未覆盖的新问题",
              }),
            }],
          };
        }
        const payload = JSON.parse(
          messages.findLast(
            ({ role }) => role === "tool",
          )?.content ?? "{}",
        ) as {
          output?: {
            retrievalMode?: string;
          };
        };
        expect(
          payload.output
            ?.retrievalMode,
        ).toBeUndefined();
        return {
          content:
            "资料未覆盖，我先给通用设计建议。",
          toolCalls: [],
        };
      },
    };
    const toolExecutor: AgentToolExecutor =
      vi.fn(async ({ call }) => ({
        call,
        observation: {
          callId:
            "22222222-2222-4222-8222-222222222222",
          toolId: call.toolId,
          toolVersion: "1",
          adapterId: "knowledge-map",
          status: "EMPTY" as const,
          summary: "V2 没有匹配证据。",
          facts: [],
          errorCode: null,
          latencyMs: 2,
        },
        output: { bundleStatus: "EMPTY" },
      }));

    const result = await runTutorToolLoop({
      ...baseInput({
        client,
        availableTools: [evidenceTool],
        toolExecutor,
      }),
      requiredToolIds: [
        "knowledge-map.search-evidence",
      ],
      legacyKnowledgeBaseline: [],
    });

    expect(result.text).toContain(
      "通用设计建议",
    );
    expect(toolExecutor).toHaveBeenCalledTimes(1);
  });

  it("runs V2 evidence then the authorized web tool exactly once before answering", async () => {
    const evidenceTool = toolDefinition({
      id: "knowledge-map.search-evidence",
      effect: "READ_CONTEXT",
      access: "READ_ONLY",
    });
    const webTool = toolDefinition({
      id: "external-web.search",
      effect: "EXTERNAL_CALL",
      access: "STUDENT_CONFIRMATION",
    });
    let decision = 0;
    const client: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "required-web-sequence-test",
      capabilities: { vision: false },
      async complete() {
        throw new Error(
          "NATIVE_RESPONSE_REQUIRED",
        );
      },
      async respond(_messages, options) {
        decision += 1;
        if (decision <= 2) {
          expect(options?.toolChoice)
            .toBe("required");
          expect(options?.tools)
            .toHaveLength(1);
          return {
            content: null,
            toolCalls: [{
              id: `required-${decision}`,
              name: options?.tools?.[0]
                ?.name ?? "",
              arguments:
                decision === 1
                  ? JSON.stringify({
                      query:
                        "核对材料安全说明",
                    })
                  : "{}",
            }],
          };
        }
        return {
          content:
            "已先查课程证据，再核对公开材料说明。",
          toolCalls: [],
        };
      },
    };
    const callOrder: string[] = [];
    const toolExecutor: AgentToolExecutor =
      vi.fn(async ({ call }) => {
        callOrder.push(call.toolId);
        const web =
          call.toolId
            === "external-web.search";
        return {
          call,
          observation: {
            callId: web
              ? "44444444-4444-4444-8444-444444444444"
              : "33333333-3333-4333-8333-333333333333",
            toolId: call.toolId,
            toolVersion: "1",
            adapterId: web
              ? "external-web"
              : "knowledge-map",
            status: web
              ? "SUCCESS" as const
              : "EMPTY" as const,
            summary: web
              ? "已核对公开材料说明。"
              : "课程证据没有匹配。",
            facts: [],
            errorCode: null,
            latencyMs: 2,
          },
          output: web
            ? { answer: "安全说明", citations: [] }
            : { bundleStatus: "EMPTY" },
        };
      });

    const result = await runTutorToolLoop({
      ...baseInput({
        client,
        availableTools: [
          evidenceTool,
          webTool,
        ],
        toolExecutor,
      }),
      requiredToolIds: [
        "knowledge-map.search-evidence",
        "external-web.search",
      ],
      confirmedToolIds:
        new Set([
          "external-web.search",
        ]),
      legacyKnowledgeBaseline: [],
    });

    expect(result.text).toContain(
      "核对公开材料",
    );
    expect(callOrder).toEqual([
      "knowledge-map.search-evidence",
      "external-web.search",
    ]);
    expect(toolExecutor).toHaveBeenCalledTimes(2);
  });
});

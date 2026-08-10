import { z } from "zod";

import {
  ModelServiceError,
  type CompletionOptions,
  type ModelConversationMessage,
  type ModelResponse,
  type ModelResponseOptions,
  type ModelToolDefinition,
  type ModelUsage,
  type ModelVisionImage,
} from "@/lib/ai/client";
import type { EmbeddingProvider } from "@/lib/ai/embeddings";
import type { SessionPayload } from "@/lib/auth/session";
import type { CoursePack } from "@/lib/course-packs/contract";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  redactSensitiveText,
  studentNumberPolicyFromEnvironment,
} from "@/lib/security/redaction";

import type { PreparedAgentArtwork } from "../artwork-attachment";
import { capabilityActionLabel } from "../capability-registry";
import type { AgentExecutionTrace } from "../execution-trace";
import type { ExternalWebResearchRunner } from "../external-web-research";
import {
  AgentEvidenceToolOutputV2Schema,
  type AgentEvidenceSearchPortV2,
} from "../evidence-tool-v2";
import type {
  AgentToolDefinition,
  AgentToolExecution,
} from "../tool-contract";
import {
  runModelCallWithRetry,
  type ModelRetryContext,
} from "../model-call-retry";
import type { ModelProviderAdapter } from "../model-provider-adapter";
import type { AgentOptions, StudentContext } from "../orchestrator-context";
import type { AgentPolicy } from "../policy-contract";
import type { LifecycleCoordinator } from "../runtime/harness/lifecycle-coordinator";
import {
  AgentToolCallRequestSchema,
} from "../tool-contract";
import {
  AgentToolRejectedError,
  decideAgentToolPermission,
  executeRegisteredAgentTool,
  type AgentToolExecutor,
} from "../tool-executor";
import {
  toolExecutionProvenanceSources,
} from "../tool-sources";
import {
  matchTutorSidecar,
} from "../tutor-sidecar-marker";
import { canNativeTutorObserveArtwork } from "./tutor-artwork";

const SourceAttributionRepairSchema = z.object({
  sourceIds: z.array(z.string().trim().min(1)).max(8),
}).strict();

type SourceAttributionCandidate = {
  sourceId: string;
  evidenceKind:
    | "KNOWLEDGE_FACT"
    | "VISUAL_REFERENCE"
    | "CONTEXT";
  excerpt: string | null;
  assetId: string | null;
  visualReferenceIndex: number | null;
};

export type LegacyKnowledgeBaselineReference = {
  sourceId: string;
  title: string;
  excerpt: string;
  authority: string;
  scope: string;
};

type DeliveredEvidenceImage = {
  assetId: string;
  image: ModelVisionImage;
};

function messagesWithVisualInputBoundary(
  messages: readonly ModelConversationMessage[],
  input: {
    studentArtworkDelivered: boolean;
    courseReferenceCount: number;
  },
) {
  if (
    !input.studentArtworkDelivered
    && input.courseReferenceCount === 0
  ) {
    return [...messages];
  }
  const firstCourseReferenceIndex =
    input.studentArtworkDelivered ? 2 : 1;
  const courseReferenceLabels = Array.from(
    { length: input.courseReferenceCount },
    (_, index) =>
      `图像${firstCourseReferenceIndex + index}：课程参考图`,
  );
  const boundary = [
    "视觉输入来源合同（必须遵守）：",
    input.studentArtworkDelivered
      ? "图像1：学生本轮实际提交的当前作品；只有这张图可称为“你的作品”或“当前画面”。"
      : "本轮没有学生作品图；不得把任何视觉输入称为“你的作品”“这张海报”或“当前画面”，也不得据此声称看见了学生作品的颜色、人物、文字、位置或形态。",
    ...courseReferenceLabels,
    input.courseReferenceCount > 0
      ? "课程参考图只用于理解课程证据。可以明确说“课程参考图中可见……”，但不得把其中的具体颜色、人物、文字、线条或构图移植成对学生当前作品的观察。"
      : "",
  ].filter(Boolean).join("\n");
  const firstSystemIndex = messages.findIndex(
    ({ role }) => role === "system",
  );
  if (firstSystemIndex < 0) {
    return [{
      role: "system" as const,
      content: boundary,
    }, ...messages];
  }
  return messages.map((message, index) =>
    index === firstSystemIndex
      ? {
          ...message,
          content:
            `${message.content}\n\n${boundary}`,
        }
      : message);
}

function sourceAttributionCandidates(
  toolExecutions: readonly AgentToolExecution[],
  legacyKnowledgeBaseline:
    readonly LegacyKnowledgeBaselineReference[],
  deliveredEvidenceImages:
    readonly DeliveredEvidenceImage[],
) {
  const visualReferenceIndexByAssetId =
    new Map(
      deliveredEvidenceImages.map(
        ({ assetId }, index) => [
          assetId,
          index + 1,
        ],
      ),
    );
  const evidenceCandidates =
    toolExecutions.flatMap((execution) => {
      if (
        execution.call.toolId
          !== "knowledge-map.search-evidence"
      ) return [];
      const parsed =
        AgentEvidenceToolOutputV2Schema.safeParse(
          execution.output,
        );
      if (!parsed.success) return [];
      return parsed.data.evidence.nodes
        .flatMap(
          (node): SourceAttributionCandidate[] => {
            const visualReferenceIndex =
              node.assetId
                ? visualReferenceIndexByAssetId
                    .get(node.assetId)
                    ?? null
                : null;
            if (
              !node.excerpt
              && visualReferenceIndex === null
            ) {
              return [];
            }
            return [{
              sourceId: node.nodeId,
              evidenceKind:
                node.evidenceKind,
              excerpt: node.excerpt,
              assetId: node.assetId,
              visualReferenceIndex,
            }];
          },
        );
    });
  const legacyCandidates =
    legacyKnowledgeBaseline.map(
      (reference): SourceAttributionCandidate => ({
        sourceId: reference.sourceId,
        evidenceKind: "KNOWLEDGE_FACT",
        excerpt: reference.excerpt,
        assetId: null,
        visualReferenceIndex: null,
      }),
    );
  const candidates = [
    ...evidenceCandidates,
    ...legacyCandidates,
  ];
  return [
    ...new Map(
      candidates.map((candidate) => [
        candidate.sourceId,
        candidate,
      ]),
    ).values(),
  ];
}

function sourceAttributionRepairMessages(input: {
  draft: string;
  candidates: readonly SourceAttributionCandidate[];
}): ModelConversationMessage[] {
  return [{
    role: "system",
    content:
      "你是证据归因审阅器，不是学生导师。只判断给定回答草稿实际使用了哪些候选课程节点。若草稿中的事实、解释、判断或操作建议由某节点摘录直接支持，或是该摘录的合理转述，该节点即为已使用；不得因为不是逐字引用而排除。visualReferenceIndex 对应本请求按相同顺序附带的课程参考图，只能选择其静态画面实际支持草稿的视觉节点；图片不是学生作品。不得评价答案优劣、补充事实、重写回答或选择候选列表之外的 ID。按给定严格 JSON schema 返回 sourceIds；只有草稿完全独立于全部候选证据时才返回空数组。",
  }, {
    role: "user",
    content: JSON.stringify({
      task:
        "SOURCE_ATTRIBUTION_REPAIR",
      draft: input.draft,
      allowedEvidenceNodeIds:
        input.candidates.map(
          ({ sourceId }) => sourceId,
        ),
      evidenceCandidates:
        input.candidates,
    }),
  }];
}

function tutorSidecarPayload(raw: string) {
  const match = matchTutorSidecar(raw);
  if (!match) {
    return {
      match: null,
      payload: null,
    };
  }
  try {
    const payload = JSON.parse(match[1]) as unknown;
    return {
      match,
      payload:
        payload !== null
        && typeof payload === "object"
        && !Array.isArray(payload)
          ? payload as Record<string, unknown>
          : null,
    };
  } catch {
    return {
      match,
      payload: null,
    };
  }
}

function composeSourceAttributionRepair(input: {
  draft: string;
  rawSelection: string;
  allowedEvidenceSourceIds: readonly string[];
  allowedToolSourceIds: ReadonlySet<string>;
}) {
  let parsed: z.infer<
    typeof SourceAttributionRepairSchema
  > | null = null;
  try {
    const candidate =
      SourceAttributionRepairSchema.safeParse(
        JSON.parse(input.rawSelection),
      );
    parsed = candidate.success
      ? candidate.data
      : null;
  } catch {
    parsed = null;
  }
  const allowedEvidence = new Set(
    input.allowedEvidenceSourceIds,
  );
  const selectedEvidenceSourceIds = [
    ...new Set(
      (parsed?.sourceIds ?? []).filter((id) =>
        allowedEvidence.has(id)),
    ),
  ].slice(0, 8);
  if (selectedEvidenceSourceIds.length === 0) {
    return {
      content: input.draft,
      status: parsed === null
        ? "INVALID" as const
        : "EMPTY" as const,
      selectedCount: 0,
    };
  }

  const sidecar = tutorSidecarPayload(input.draft);
  const existingSourceIds = Array.isArray(
    sidecar.payload?.sourceIds,
  )
    ? sidecar.payload.sourceIds.filter(
        (id): id is string =>
          typeof id === "string"
          && input.allowedToolSourceIds.has(id),
      )
    : [];
  const sourceIds = [
    ...new Set([
      ...existingSourceIds,
      ...selectedEvidenceSourceIds,
    ]),
  ].slice(0, 8);
  const draft = sidecar.match
    ? input.draft.replace(sidecar.match[0], "").trim()
    : input.draft.trim();
  return {
    content:
      `${draft}\n\n<!-- tutor-meta ${JSON.stringify({
        sourceIds,
      })} -->`,
    status: "SELECTED" as const,
    selectedCount:
      selectedEvidenceSourceIds.length,
  };
}

const EVIDENCE_CAPABILITY_LABELS = {
  LEXICAL: "关键词检索",
  TEXT_VECTOR: "文字语义检索",
  VISUAL_VECTOR: "图片语义检索",
  ASSET: "参考图资源",
  REGION: "图像区域定位",
  TEXT_EVIDENCE: "课程文字证据",
  GRAPH_CONTEXT: "知识关系上下文",
} as const;

function evidenceDegradationDisclosure(
  toolExecutions: readonly AgentToolExecution[],
) {
  const capabilitiesLost = [
    ...new Set(
      toolExecutions.flatMap((execution) => {
        if (
          execution.call.toolId
            !== "knowledge-map.search-evidence"
        ) return [];
        const parsed =
          AgentEvidenceToolOutputV2Schema.safeParse(
            execution.output,
          );
        if (!parsed.success) return [];
        return parsed.data.bundle.capabilitiesLost;
      }),
    ),
  ];
  if (capabilitiesLost.length === 0) return null;
  return [
    "> 检索能力提示：本轮课程知识检索发生降级，",
    capabilitiesLost.map((capability) =>
      EVIDENCE_CAPABILITY_LABELS[capability])
      .join("、"),
    "暂不可用。下述建议不会把未取得的材料当作已观察证据。",
  ].join("");
}

function applyEvidenceDegradationDisclosure(
  draft: string,
  toolExecutions: readonly AgentToolExecution[],
) {
  const disclosure =
    evidenceDegradationDisclosure(toolExecutions);
  if (!disclosure || draft.includes(disclosure)) {
    return draft;
  }
  const sidecar = tutorSidecarPayload(draft);
  if (!sidecar.match) {
    return `${disclosure}\n\n${draft.trim()}`;
  }
  const body =
    draft.replace(sidecar.match[0], "").trim();
  return [
    disclosure,
    "",
    body,
    "",
    sidecar.match[0],
  ].join("\n");
}

function publicUsage(usage: ModelUsage | null) {
  return usage ? { status: "RECORDED" as const, ...usage } : {
    status: "UNAVAILABLE" as const,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  };
}

function functionName(toolId: string) {
  return `tool_${toolId.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
}

function modelTool(definition: AgentToolDefinition): ModelToolDefinition {
  const rawSchema = z.toJSONSchema(definition.inputSchema) as Record<string, unknown>;
  delete rawSchema.$schema;
  return {
    name: functionName(definition.descriptor.id),
    description: `${definition.descriptor.label}。${definition.descriptor.description} ${definition.descriptor.inputHint}`,
    parameters: rawSchema,
    ...(definition.strictInputSchema ? { strict: true } : {}),
  };
}

async function respond(
  client: ModelProviderAdapter,
  messages: ModelConversationMessage[],
  options: ModelResponseOptions,
): Promise<ModelResponse> {
  if (client.respond) return client.respond(messages, options);
  const compatibleMessages = messages.flatMap((message) => {
    if (message.role === "tool") return [];
    if (message.role === "assistant" && !message.content) return [];
    return [{ role: message.role, content: message.content }] as Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
  });
  const images =
    options.images
    ?? (options.image ? [options.image] : []);
  if (images.length > 1) {
    throw new ModelServiceError(
      "INVALID_RESPONSE",
    );
  }
  const image = images[0];
  const content = image && client.completeWithImage
    ? await client.completeWithImage(
        compatibleMessages,
        image,
        {
          signal: options.signal,
          totalTimeoutMs:
            options.totalTimeoutMs,
          onUsage: options.onUsage,
          reasoningEffort:
            options.reasoningEffort,
          structuredOutput:
            options.structuredOutput,
        } satisfies CompletionOptions,
      )
    : await client.complete(
        compatibleMessages,
        options,
      );
  return {
    content,
    toolCalls: [],
  };
}

function toolErrorCode(error: unknown) {
  if (error instanceof AgentToolRejectedError) return error.code;
  if (error instanceof SyntaxError) return "TOOL_ARGUMENTS_INVALID";
  if (error instanceof z.ZodError) return "TOOL_ARGUMENTS_INVALID";
  return "TOOL_EXECUTION_REJECTED";
}

function toolFailureCopy(errorCode: string) {
  if (errorCode === "TOOL_CONFIRMATION_REQUIRED") {
    return {
      label: "工具调用等待学生确认",
      traceSummary: "该工具会写入项目、修改软件状态或调用外部服务；尚未获得学生确认，因此没有执行。",
      progressSummary: "该操作需要你先确认，本轮没有执行；导师会继续回答并说明拟执行内容。",
      modelSummary: "该工具需要学生先确认，本轮没有执行。请继续回答，并在确有必要时说明拟执行的具体操作。",
    };
  }
  if (errorCode === "TOOL_FORBIDDEN") {
    return {
      label: "工具调用超出当前权限",
      traceSummary: "该工具涉及正式提交、评分、过关或评价状态变更，导师无权执行。",
      progressSummary: "该正式动作不能由导师代办；导师会继续提供分析和建议。",
      modelSummary: "该工具涉及禁止代办的正式动作，未执行。请继续提供辅导，不得声称已经提交、评分或改变评价状态。",
    };
  }
  if (errorCode === "TOOL_FINAL_ANSWER_REQUIRED") {
    return {
      label: "工具调用未在收尾阶段执行",
      traceSummary: "本轮已进入无工具收尾阶段；该调用没有执行，结果交还模型完成正文。",
      progressSummary: "本轮已进入回答收尾，导师将基于已有信息完成正文。",
      modelSummary: "本轮已进入最终回答阶段，该工具没有执行。请立即基于已有信息完成自然语言回答。",
    };
  }
  return {
    label: "工具参数不可执行",
    traceSummary: "工具参数无效或调用重复；错误作为工具结果交还模型继续回答。",
    progressSummary: "工具参数无效或调用重复，导师将基于已有信息继续回答。",
    modelSummary: "工具参数无效或调用重复，请基于已有信息继续回答。",
  };
}

function toolResultContent(input: {
  status: "SUCCESS" | "EMPTY" | "ERROR";
  summary: string;
  facts?: string[];
  output?: unknown;
  errorCode?: string | null;
}) {
  const maxToolMessageCharacters = 15_500;
  const studentNumber = studentNumberPolicyFromEnvironment();
  const redactValue = (value: unknown): unknown => {
    if (typeof value === "string") return redactSensitiveText(value, { studentNumber });
    if (Array.isArray(value)) return value.map(redactValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, redactValue(nested)]),
      );
    }
    return value;
  };
  const payload = redactValue({
    status: input.status,
    summary: input.summary,
    facts: input.facts ?? [],
    output: input.output ?? null,
    errorCode: input.errorCode ?? null,
  }) as Record<string, unknown>;
  const serialized = JSON.stringify(payload);
  if (serialized.length <= maxToolMessageCharacters) return serialized;

  const compactValue = (value: unknown, depth = 0): unknown => {
    if (typeof value === "string") return value.slice(0, 1_000);
    if (Array.isArray(value)) return value.slice(0, 5).map((item) => compactValue(item, depth + 1));
    if (value && typeof value === "object" && depth < 4) {
      return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, nested]) => [
        key,
        compactValue(nested, depth + 1),
      ]));
    }
    return value;
  };
  const compact = JSON.stringify({
    ...payload,
    summary: `${String(payload.summary).slice(0, 240)}（详细工具输出已压缩。）`,
    facts: Array.isArray(payload.facts) ? payload.facts.slice(0, 6) : [],
    output: compactValue(payload.output),
  });
  if (compact.length <= maxToolMessageCharacters) return compact;
  return JSON.stringify({
    status: input.status,
    summary: `${input.summary.slice(0, 240)}（详细工具输出过大，未注入模型上下文。）`,
    facts: (input.facts ?? []).slice(0, 4),
    output: null,
    errorCode: input.errorCode ?? null,
  });
}

export async function runTutorToolLoop(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  pack: CoursePack;
  context: StudentContext;
  question: string;
  client: ModelProviderAdapter;
  messages: ModelConversationMessage[];
  availableTools: readonly AgentToolDefinition[];
  policy: AgentPolicy;
  turnDeadline: number;
  trace: AgentExecutionTrace;
  lifecycle?: LifecycleCoordinator;
  artwork?: PreparedAgentArtwork;
  embeddingProvider?: EmbeddingProvider | null;
  signal?: AbortSignal;
  onModelError?: AgentOptions["onModelError"];
  onTextDelta?: (delta: string, attempt: number) => void;
  onModelActivity?: AgentOptions["onModelActivity"];
  allowRetryAfterTextDelta?: AgentOptions["allowRetryAfterTextDelta"];
  onToolProgress?: AgentOptions["onToolProgress"];
  toolExecutor?: AgentToolExecutor;
  progress?: { modelDecisions: number; toolCallCount: number; modelRetries?: number };
  toolExecutions?: AgentToolExecution[];
  confirmedToolIds?: ReadonlySet<string>;
  externalWebResearch?: ExternalWebResearchRunner;
  evidenceSearchV2?: AgentEvidenceSearchPortV2;
  evidenceImageResolver?: (
    assetId: string,
  ) => Promise<ModelVisionImage>;
  requiredToolIds?: readonly string[];
  legacyKnowledgeBaseline?: readonly LegacyKnowledgeBaselineReference[];
  validateEvidenceSourceAttribution?: (
    text: string,
    evidenceSourceIds: ReadonlySet<string>,
  ) => boolean;
  retryContext?: ModelRetryContext;
}) {
  const toolPermissions = new Map(input.availableTools.map((definition) => [
    definition.descriptor.id,
    (() => {
      const permission = decideAgentToolPermission(definition, input.policy);
      if (
        permission.mode === "REQUIRES_CONFIRMATION"
        && definition.descriptor.effect === "EXTERNAL_CALL"
        && input.confirmedToolIds?.has(definition.descriptor.id)
      ) {
        return {
          mode: "AUTOMATIC" as const,
          reason: "学生已为本条消息显式确认该外呼工具。",
        };
      }
      return permission;
    })(),
  ]));
  const automaticTools = input.availableTools.filter((definition) => (
    toolPermissions.get(definition.descriptor.id)?.mode === "AUTOMATIC"
  ));
  const reservePermissionRecovery = automaticTools.length < input.availableTools.length;
  const toolDefinitions = automaticTools.map(modelTool);
  const requiredToolIds = [
    ...new Set(input.requiredToolIds ?? []),
  ];
  if (
    requiredToolIds.length
      !== (input.requiredToolIds ?? []).length
  ) {
    throw new Error(
      "V3_REQUIRED_TOOL_DUPLICATED",
    );
  }
  const requiredTools = requiredToolIds.map((toolId) => {
    const requiredTool = automaticTools.find(
      ({ descriptor }) =>
        descriptor.id === toolId,
    );
    if (!requiredTool) {
      throw new Error(
        "V3_REQUIRED_TOOL_NOT_AUTOMATIC",
      );
    }
    return requiredTool;
  });
  if (
    requiredTools.length
      >= input.policy.budgets.maxModelDecisions
  ) {
    throw new Error(
      "V3_REQUIRED_TOOL_BUDGET_EXHAUSTED",
    );
  }
  const toolsByFunctionName = new Map(
    input.availableTools.map((definition) => [functionName(definition.descriptor.id), definition]),
  );
  if (toolsByFunctionName.size !== input.availableTools.length) {
    throw new Error("V3_TOOL_FUNCTION_NAME_COLLISION");
  }
  const messages = [...input.messages];
  const toolExecutions = input.toolExecutions ?? [];
  const seenFingerprints = new Set<string>();
  const artworkImage = input.artwork && canNativeTutorObserveArtwork(input.client, input.artwork)
    ? {
        mimeType: input.artwork.mimeType,
        bytes: new Uint8Array(input.artwork.bytes),
      }
    : undefined;
  let modelDecisions = 0;
  let modelRetries = 0;
  let toolCallCount = 0;
  let artworkDelivered = false;
  let artworkProgressStarted = false;
  let artworkProgressFinished = false;
  let sourceAttributionRepairRequested = false;
  let sourceAttributionDraft: string | null = null;
  let sourceAttributionEvidenceSourceIds:
    string[] = [];
  let sourceAttributionCandidateNodes:
    SourceAttributionCandidate[] = [];
  const deliveredEvidenceImages:
    DeliveredEvidenceImage[] = [];

  const failArtworkProgress = (label: string, summary: string) => {
    if (!artworkImage || artworkProgressFinished) return;
    artworkProgressFinished = true;
    input.onToolProgress?.({
      status: "FAILED",
      toolId: "student-artwork.inspect",
      label,
      summary,
    });
  };

  const markArtworkDelivered = () => {
    if (!artworkImage || artworkProgressFinished) return;
    artworkProgressFinished = true;
    artworkDelivered = true;
  };

  if (input.artwork && !artworkImage) {
    input.onToolProgress?.({
      status: "FAILED",
      toolId: "student-artwork.inspect",
      label: "未读取作品图片",
      summary: "当前模型没有可用的视觉输入能力；导师会明确这一点，并继续基于文字提供帮助。",
    });
  }

  while (modelDecisions < input.policy.budgets.maxModelDecisions) {
    input.signal?.throwIfAborted();
    const remainingMs = Math.floor(input.turnDeadline - performance.now());
    if (remainingMs <= 0) {
      failArtworkProgress(
        "作品图片读取超时",
        "视觉模型未能形成最终回答；本轮不会把这张图片标记为已观察依据。",
      );
      throw new ModelServiceError("TIMEOUT");
    }
    const nextRequiredTool =
      requiredTools.find((requiredTool) =>
        !toolExecutions.some(
          ({ call }) =>
            call.toolId
              === requiredTool.descriptor.id,
        ),
      );
    const isLastDecision = modelDecisions === input.policy.budgets.maxModelDecisions - 1;
    const requireTool = (
      nextRequiredTool !== undefined
    );
    const attributionRepairCall =
      sourceAttributionRepairRequested;
    const finalResponseOnly =
      !requireTool
      && (
        isLastDecision || (
          reservePermissionRecovery
          && input.policy.budgets.maxModelDecisions > 1
          && modelDecisions === input.policy.budgets.maxModelDecisions - 2
        )
      );
    const responseStarted = performance.now();
    let responseUsage: ModelUsage | null = null;
    if (artworkImage && !artworkProgressStarted) {
      artworkProgressStarted = true;
      input.onToolProgress?.({
        status: "RUNNING",
        toolId: "student-artwork.inspect",
        label: "正在读取你的作品",
        summary: "导师正在查看这张作品的静态画面；不会据此臆断动态、材质、交互或使用效果。",
      });
    }
    let response: ModelResponse;
    let responseRetryCount = 0;
    try {
      const retried = await runModelCallWithRetry({
        totalBudgetMs: input.policy.budgets.modelTimeoutMs,
        turnDeadline: input.turnDeadline,
        signal: input.signal,
        onTextDelta: attributionRepairCall
          ? undefined
          : input.onTextDelta,
        allowRetryAfterTextDelta: input.allowRetryAfterTextDelta,
        onAttemptError: input.onModelError,
        onRetry: () => {
          modelRetries += 1;
          if (input.progress) input.progress.modelRetries = modelRetries;
        },
        context: {
          ...input.retryContext,
          modelDecision: modelDecisions + 1,
        },
        execute: async ({ attempt, signal, totalTimeoutMs, onTextDelta }) => {
          await input.lifecycle?.emit({
            phase: "model.before",
            status: "STARTED",
            modelAttempt: attempt,
            modelDecision: modelDecisions + 1,
          });
          responseUsage = null;
          try {
            const courseReferenceImages = deliveredEvidenceImages.slice(
              0,
              artworkImage ? 4 : 5,
            );
            const responseImages = [
              ...(attributionRepairCall ? [] : artworkImage ? [artworkImage] : []),
              ...courseReferenceImages.map(({ image }) => image),
            ].slice(0, 5);
            const responseMessages = attributionRepairCall && sourceAttributionDraft
              ? sourceAttributionRepairMessages({
                  draft: sourceAttributionDraft,
                  candidates: sourceAttributionCandidateNodes,
                })
              : messagesWithVisualInputBoundary(messages, {
                  studentArtworkDelivered: Boolean(artworkImage),
                  courseReferenceCount: courseReferenceImages.length,
                });
            const value = await respond(input.client, responseMessages, {
              signal,
              idleTimeoutMs: input.policy.budgets.modelIdleTimeoutMs,
              totalTimeoutMs,
              ...(input.retryContext?.runId ? { runId: input.retryContext.runId } : {}),
              onUsage: (usage) => { responseUsage = usage; },
              ...(onTextDelta ? { onTextDelta } : {}),
              ...(input.onModelActivity ? { onStreamActivity: input.onModelActivity } : {}),
              ...(responseImages.length === 1
                ? courseReferenceImages.length > 0
                  ? { images: responseImages }
                  : { image: responseImages[0] }
                : responseImages.length > 1
                  ? { images: responseImages }
                  : {}),
              tools: finalResponseOnly || attributionRepairCall
                ? []
                : requireTool
                  ? [modelTool(nextRequiredTool)]
                  : toolDefinitions,
              toolChoice: finalResponseOnly || attributionRepairCall
                ? "none"
                : requireTool
                  ? "required"
                  : "auto",
              ...(attributionRepairCall
                ? {
                    structuredOutput: {
                      name: "lumi_rag_source_attribution_v1",
                      schema: {
                        type: "object",
                        properties: {
                          sourceIds: {
                            type: "array",
                            items: {
                              type: "string",
                              enum: sourceAttributionEvidenceSourceIds,
                            },
                            maxItems: 8,
                          },
                        },
                        required: ["sourceIds"],
                        additionalProperties: false,
                      },
                    },
                  }
                : {}),
            });
            await input.lifecycle?.emit({
              phase: "model.after",
              status: "SUCCEEDED",
              modelAttempt: attempt,
              modelDecision: modelDecisions + 1,
            });
            return value;
          } catch (error) {
            await input.lifecycle?.emit({
              phase: "model.after",
              status: "FAILED",
              modelAttempt: attempt,
              modelDecision: modelDecisions + 1,
              errorCode: error instanceof ModelServiceError
                ? `MODEL_${error.code}`
                : "MODEL_ATTEMPT_FAILED",
            });
            throw error;
          }
        },
      });
      response = retried.value;
      responseRetryCount = retried.retryCount;
    } catch (rawError) {
      failArtworkProgress(
        "作品图片读取失败",
        "视觉模型请求未成功；最终回答不会把这张图片标记为已观察依据。",
      );
      throw rawError;
    }
    modelDecisions += 1;
    if (input.progress) input.progress.modelDecisions = modelDecisions;

    // A token-cap terminal response can contain a partial body alongside an
    // unfinished tool-call plan. Never execute that partial plan; preserve the
    // body and let the explicit continuation path finish the answer instead.
    if (response.toolCalls.length === 0 || (response.outputTruncated && response.content?.trim())) {
      let responseContent =
        response.content;
      if (!responseContent?.trim()) {
        failArtworkProgress(
          "作品图片未形成有效回答",
          "视觉模型没有返回可交付正文；本轮不会把这张图片标记为已观察依据。",
        );
        throw new ModelServiceError("INVALID_RESPONSE");
      }
      if (
        attributionRepairCall
        && sourceAttributionDraft !== null
      ) {
        const allowedToolSourceIds = new Set(
          [
            ...toolExecutions.flatMap(
              (execution) =>
                toolExecutionProvenanceSources(
                  execution,
                ).map(({ id }) => id),
            ),
            ...(input
              .legacyKnowledgeBaseline
              ?? [])
              .map(({ sourceId }) =>
                sourceId),
          ],
        );
        const repair =
          composeSourceAttributionRepair({
            draft: sourceAttributionDraft,
            rawSelection: responseContent,
            allowedEvidenceSourceIds:
              sourceAttributionEvidenceSourceIds,
            allowedToolSourceIds,
          });
        responseContent = repair.content;
        input.trace.add({
          kind: "MODEL_DECISION",
          status:
            repair.status === "SELECTED"
              ? "SUCCEEDED"
              : repair.status === "EMPTY"
                ? "EMPTY"
                : "FAILED",
          label: "核验课程来源声明",
          summary:
            repair.status === "SELECTED"
              ? `独立归因审阅器明确选择 ${repair.selectedCount} 个课程节点；运行时仅投影这些节点。`
              : repair.status === "EMPTY"
                ? "独立归因审阅器返回空来源；运行时没有把已检索节点自动计为已使用。"
                : "独立归因审阅器没有返回有效结构；运行时没有把已检索节点自动计为已使用。",
          toolCallId: null,
          toolId: null,
          latencyMs: Math.round(
            performance.now()
              - responseStarted,
          ),
        }, {
          modelProvider:
            input.client.provider,
          modelId:
            input.client.modelId ?? null,
          usage:
            publicUsage(responseUsage),
        });
      }
      const attributionCandidates =
        sourceAttributionCandidates(
          toolExecutions,
          input.legacyKnowledgeBaseline
            ?? [],
          deliveredEvidenceImages,
        );
      const attributableSourceIds = new Set(
        attributionCandidates.map(
          ({ sourceId }) => sourceId,
        ),
      );
      const attributionValid = (
        attributableSourceIds.size === 0
        || !input
          .validateEvidenceSourceAttribution
        || input
          .validateEvidenceSourceAttribution(
            responseContent,
            attributableSourceIds,
          )
      );
      if (
        !attributionValid
        && !sourceAttributionRepairRequested
        && modelDecisions
          < input.policy.budgets
            .maxModelDecisions
      ) {
        sourceAttributionRepairRequested = true;
        sourceAttributionDraft =
          responseContent;
        sourceAttributionEvidenceSourceIds = [
          ...attributableSourceIds,
        ];
        sourceAttributionCandidateNodes =
          attributionCandidates;
        input.trace.add({
          kind: "MODEL_DECISION",
          status: "SUCCEEDED",
          label: "请求补齐课程来源留痕",
          summary:
            "正文已形成，但缺少可验证的课程节点声明；将同一正文交回模型补齐来源，不自动把检索结果计为已使用。",
          toolCallId: null,
          toolId: null,
          latencyMs: Math.round(
            performance.now()
              - responseStarted,
          ),
        }, {
          modelProvider:
            input.client.provider,
          modelId:
            input.client.modelId ?? null,
          usage:
            publicUsage(responseUsage),
        });
        continue;
      }
      responseContent =
        applyEvidenceDegradationDisclosure(
          responseContent,
          toolExecutions,
        );
      markArtworkDelivered();
      input.trace.add({
        kind: "MODEL_DECISION",
        status: "SUCCEEDED",
        label: response.outputTruncated ? "模型输出达到长度上限" : "形成自然语言辅导",
        summary: response.outputTruncated
          ? "模型输出达到长度上限；保留已收到的正文，并交给继续生成路径完成后续内容。"
          : responseRetryCount > 0
            ? `模型调用重试 ${responseRetryCount} 次后形成学生可读正文；未拼接失败尝试内容。`
            : "模型直接形成学生可读正文；未经过刚性JSON或词汇白名单裁决。",
        toolCallId: null,
        toolId: null,
        latencyMs: Math.round(performance.now() - responseStarted),
      }, {
        modelProvider: input.client.provider,
        modelId: input.client.modelId ?? null,
        usage: publicUsage(responseUsage),
      });
      return {
        text: responseContent,
        toolExecutions,
        modelDecisions,
        modelRetries,
        toolCallCount,
        artworkDelivered,
        ...(response.outputTruncated ? { outputTruncated: true } : {}),
      };
    }

    if (isLastDecision) {
      failArtworkProgress(
        "作品图片未形成最终回答",
        "视觉模型在收尾阶段仍只请求工具；本轮不会把这张图片标记为已观察依据。",
      );
      throw new ModelServiceError("INVALID_RESPONSE");
    }
    input.trace.add({
      kind: "MODEL_DECISION",
      status: "SUCCEEDED",
      label: "模型主动调用辅导工具",
      summary: responseRetryCount > 0
        ? `模型调用重试 ${responseRetryCount} 次后请求 ${response.toolCalls.length} 次工具调用；已完成的工具没有重放。`
        : `模型请求 ${response.toolCalls.length} 次工具调用；运行时按权限逐项处理后继续组织回答。`,
      toolCallId: null,
      toolId: null,
      latencyMs: Math.round(performance.now() - responseStarted),
    }, {
      modelProvider: input.client.provider,
      modelId: input.client.modelId ?? null,
      usage: publicUsage(responseUsage),
    });
    messages.push({
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls,
      providerOutput: response.providerOutput,
    });

    for (const modelCall of response.toolCalls) {
      toolCallCount += 1;
      if (input.progress) input.progress.toolCallCount = toolCallCount;
      const definition = toolsByFunctionName.get(modelCall.name);
      if (definition) {
        await input.lifecycle?.emit({
          phase: "tool.authorize.before",
          status: "STARTED",
          toolId: definition.descriptor.id,
        });
      }
      if (!definition || toolCallCount > input.policy.budgets.maxToolCalls) {
        const errorCode = definition ? "TOOL_CALL_BUDGET_EXCEEDED" : "TOOL_NOT_AVAILABLE";
        input.trace.add({
          kind: "TOOL_CALL",
          status: "FAILED",
          label: "工具调用未执行",
          summary: definition ? "本轮工具调用已达到预算上限。" : "模型请求了本轮未提供的工具。",
          toolCallId: null,
          toolId: definition?.descriptor.id ?? null,
          latencyMs: 0,
        }, { errorCode });
        if (definition) {
          input.onToolProgress?.({
            status: "FAILED",
            toolId: definition.descriptor.id,
            label: `未执行：${definition.descriptor.label}`,
            summary: "本轮工具调用已达到预算上限，导师将基于已有信息继续回答。",
          });
        }
        messages.push({
          role: "tool",
          toolCallId: modelCall.id,
          content: toolResultContent({
            status: "ERROR",
            summary: "该工具调用未执行，请基于已有信息继续回答。",
            errorCode,
          }),
        });
        continue;
      }

      const permission = toolPermissions.get(definition.descriptor.id);
      if (finalResponseOnly && permission?.mode === "AUTOMATIC") {
        const errorCode = "TOOL_FINAL_ANSWER_REQUIRED";
        const copy = toolFailureCopy(errorCode);
        input.trace.add({
          kind: "TOOL_CALL",
          status: "FAILED",
          label: copy.label,
          summary: copy.traceSummary,
          toolCallId: null,
          toolId: definition.descriptor.id,
          latencyMs: 0,
        }, { errorCode });
        input.onToolProgress?.({
          status: "FAILED",
          toolId: definition.descriptor.id,
          label: `未执行：${definition.descriptor.label}`,
          summary: copy.progressSummary,
        });
        messages.push({
          role: "tool",
          toolCallId: modelCall.id,
          content: toolResultContent({
            status: "ERROR",
            summary: copy.modelSummary,
            errorCode,
          }),
        });
        continue;
      }
      if (!permission || permission.mode !== "AUTOMATIC") {
        const errorCode = permission?.mode === "REQUIRES_CONFIRMATION"
          ? "TOOL_CONFIRMATION_REQUIRED"
          : permission?.mode === "FORBIDDEN"
            ? "TOOL_FORBIDDEN"
            : "TOOL_PERMISSION_INVALID";
        const copy = toolFailureCopy(errorCode);
        input.trace.add({
          kind: "TOOL_CALL",
          status: "FAILED",
          label: copy.label,
          summary: copy.traceSummary,
          toolCallId: null,
          toolId: definition.descriptor.id,
          latencyMs: 0,
        }, { errorCode });
        input.onToolProgress?.({
          status: "FAILED",
          toolId: definition.descriptor.id,
          label: `未执行：${definition.descriptor.label}`,
          summary: copy.progressSummary,
        });
        messages.push({
          role: "tool",
          toolCallId: modelCall.id,
          content: toolResultContent({
            status: "ERROR",
            summary: copy.modelSummary,
            errorCode,
          }),
        });
        continue;
      }

      const callStarted = performance.now();
      const isExternalCall = definition.descriptor.effect === "EXTERNAL_CALL";
      const isCalculation = definition.descriptor.adapterId === "design-calculator";
      input.onToolProgress?.({
        status: "RUNNING",
        toolId: definition.descriptor.id,
        label: isExternalCall
          ? `正在联网：${definition.descriptor.label}`
          : isCalculation
            ? `正在计算：${definition.descriptor.label}`
          : `正在查阅：${definition.descriptor.label}`,
        summary: isExternalCall
          ? "导师正在执行本条消息已确认的公开网页检索；只发送脱敏后的当前问题。"
          : isCalculation
            ? "导师正在用确定性公式计算本题参数；不会联网、写入项目或改变评价状态。"
          : "导师正在读取与当前问题有关的学习资料；不会修改学生项目或评价状态。",
      });
      try {
        await input.lifecycle?.emit({
          phase: "tool.execute.before",
          status: "STARTED",
          toolId: definition.descriptor.id,
        });
        const rawArguments = JSON.parse(modelCall.arguments) as unknown;
        const call = AgentToolCallRequestSchema.parse({
          toolId: definition.descriptor.id,
          arguments: rawArguments,
        });
        const toolRemainingMs = Math.max(1, Math.floor(input.turnDeadline - performance.now()));
        const toolSignal = input.signal
          ? AbortSignal.any([input.signal, AbortSignal.timeout(toolRemainingMs)])
          : AbortSignal.timeout(toolRemainingMs);
        const execution = await (input.toolExecutor ?? executeRegisteredAgentTool)({
          call,
          context: {
            connection: input.connection,
            actor: input.actor,
            pack: input.pack,
            student: input.context,
            question: input.question,
            embeddingProvider: input.embeddingProvider,
            externalWebResearch: input.externalWebResearch,
            evidenceSearchV2: input.evidenceSearchV2,
            signal: toolSignal,
          },
          policy: input.policy,
          seenFingerprints,
          confirmedToolIds: input.confirmedToolIds,
        });
        toolExecutions.push(execution);
        await input.lifecycle?.emit({
          phase: "tool.execute.after",
          status: execution.observation.status === "ERROR" ? "FAILED" : "SUCCEEDED",
          toolId: definition.descriptor.id,
          ...(execution.observation.errorCode
            ? { errorCode: execution.observation.errorCode }
            : {}),
        });
        if (
          execution.call.toolId
            === "knowledge-map.search-evidence"
          && input.evidenceSearchV2
            ?.runtimeHealth
        ) {
          try {
            const health =
              input.evidenceSearchV2
                .runtimeHealth();
            const protectedChannels = [
              health.textCircuitState
                === "CLOSED"
                ? null
                : `文字向量:${health.textCircuitState}`,
              !health.visualCircuitState
              || health.visualCircuitState
                === "CLOSED"
                ? null
                : `视觉向量:${health.visualCircuitState}`,
            ].filter(
              (channel): channel is string =>
                channel !== null,
            );
            if (protectedChannels.length > 0) {
              input.trace.add({
                kind: "DEGRADED",
                status: "SUCCEEDED",
                label:
                  "知识检索通道保护已触发",
                summary:
                  `本代索引的${protectedChannels.join("、")}；未受影响的检索通道继续工作。视觉队列 ${health.visualQueueDepth}，视觉缓存 ${health.visualCacheEntries}。`,
                toolCallId:
                  execution.observation.callId,
                toolId:
                  execution.observation.toolId,
                latencyMs:
                  execution.observation.latencyMs,
              }, {
                errorCode:
                  "KNOWLEDGE_RETRIEVAL_CIRCUIT_OPEN",
              });
            }
          } catch {
            input.trace.add({
              kind: "DEGRADED",
              status: "FAILED",
              label:
                "知识检索健康状态不可用",
              summary:
                "本轮未能读取知识检索通道的有界运行状态；工具结果仍按既有证据契约处理。",
              toolCallId:
                execution.observation.callId,
              toolId:
                execution.observation.toolId,
              latencyMs:
                execution.observation.latencyMs,
            }, {
              errorCode:
                "KNOWLEDGE_RETRIEVAL_HEALTH_UNAVAILABLE",
            });
          }
        }
        if (
          execution.call.toolId
            === "knowledge-map.search-evidence"
          && input.client.capabilities.vision
          && input.evidenceImageResolver
        ) {
          const parsedEvidence =
            AgentEvidenceToolOutputV2Schema
              .safeParse(execution.output);
          if (parsedEvidence.success) {
            const unavailableChannels = parsedEvidence.data.channels
              .filter(({ status }) => [
                "UNAVAILABLE",
                "TIMEOUT",
                "ERROR",
              ].includes(status))
              .map(({ channel, status }) => `${channel}:${status}`);
            if (unavailableChannels.length > 0) {
              input.trace.add({
                kind: "DEGRADED",
                status: "SUCCEEDED",
                label: "知识检索通道已降级",
                summary: `本轮多模态检索保留其余通道结果；${unavailableChannels.join("、")} 未作为可用证据。`,
                toolCallId: execution.observation.callId,
                toolId: execution.observation.toolId,
                latencyMs: execution.observation.latencyMs,
              }, {
                errorCode: "KNOWLEDGE_RETRIEVAL_CHANNEL_DEGRADED",
              });
            }
            const selectedAssetIds = [
              ...new Set(
                parsedEvidence.data
                  .evidence.nodes
                  .flatMap(({ assetId }) =>
                    assetId ? [assetId] : []),
              ),
            ].slice(
              0,
              artworkImage ? 4 : 5,
            );
            const deliveredAssetIds =
              new Set(
                deliveredEvidenceImages
                  .map(({ assetId }) =>
                    assetId),
              );
            const failedAssetIds: string[] =
              [];
            for (const assetId of
              selectedAssetIds) {
              if (
                deliveredAssetIds.has(
                  assetId,
                )
              ) continue;
              try {
                const image =
                  await input
                    .evidenceImageResolver(
                      assetId,
                    );
                deliveredEvidenceImages.push({
                  assetId,
                  image,
                });
                deliveredAssetIds.add(
                  assetId,
                );
              } catch {
                failedAssetIds.push(
                  assetId,
                );
              }
            }
            if (
              deliveredEvidenceImages
                .length > 0
            ) {
              const deliveredIds =
                new Set(
                  deliveredEvidenceImages
                    .map(({ assetId }) =>
                      assetId),
                );
              input.trace.add({
                kind: "TOOL_OBSERVATION",
                status: "SUCCEEDED",
                label:
                  "校验课程参考图",
                summary:
                  `已校验并准备 ${deliveredEvidenceImages.length} 张本轮检索实际选中的受控课程参考图；只供视觉模型读取，不当作学生作品。`,
                toolCallId:
                  execution.observation
                    .callId,
                toolId:
                  execution.observation
                    .toolId,
                latencyMs: Math.round(
                  performance.now()
                    - callStarted,
                ),
              }, {
                sourceIds:
                  parsedEvidence.data
                    .evidence.nodes
                    .filter(({ assetId }) =>
                      assetId !== null
                      && deliveredIds.has(
                        assetId,
                      ))
                    .map(({ nodeId }) =>
                      nodeId),
              });
            }
            if (
              failedAssetIds.length > 0
            ) {
              input.trace.add({
                kind: "DEGRADED",
                status: "FAILED",
                label:
                  "课程参考图读取失败",
                summary:
                  `${failedAssetIds.length} 张本轮课程参考图未通过本地文件读取或完整性校验；不会把这些图片节点计为模型已观察依据。`,
                toolCallId:
                  execution.observation
                    .callId,
                toolId:
                  execution.observation
                    .toolId,
                latencyMs: Math.round(
                  performance.now()
                    - callStarted,
                ),
              }, {
                errorCode:
                  "KNOWLEDGE_ASSET_PREVIEW_UNAVAILABLE",
              });
            }
          }
        }
        const legacyBaselineReuse = (
          execution.call.toolId
            === "knowledge-map.search-evidence"
          && execution.observation.status
            === "EMPTY"
          && (input.legacyKnowledgeBaseline?.length ?? 0)
            > 0
        )
          ? {
              retrievalMode:
                "BASELINE_REUSED" as const,
              reason: "V2_HEALTHY_EMPTY" as const,
              references:
                input.legacyKnowledgeBaseline
                  ?.slice(0, 5) ?? [],
            }
          : null;
        const executionFailed = execution.observation.status === "ERROR";
        const actionLabel = capabilityActionLabel(
          execution.observation.toolId,
          definition.descriptor.label,
        );
        input.trace.add({
          kind: "TOOL_CALL",
          status: executionFailed ? "FAILED" : "SUCCEEDED",
          label: executionFailed
            ? isExternalCall ? "联网检索执行失败" : isCalculation ? "确定性计算执行失败" : "只读工具执行失败"
            : isExternalCall
              ? "执行学生已确认的联网检索"
              : isCalculation ? "执行模型选择的确定性计算" : "执行模型选择的只读工具",
          summary: executionFailed
            ? `“${actionLabel}”未完成；${execution.observation.summary}`.slice(0, 300)
            : isExternalCall
              ? `已完成“${actionLabel}”；只发送了脱敏后的当前问题，未修改学生项目或评价状态。`
              : isCalculation
                ? `已完成“${actionLabel}”；结果来自确定性公式，未联网或修改学生项目。`
                : `已完成“${actionLabel}”，未修改学生项目或评价状态。`,
          toolCallId: execution.observation.callId,
          toolId: execution.observation.toolId,
          latencyMs: Math.round(performance.now() - callStarted),
        }, executionFailed ? { errorCode: execution.observation.errorCode } : {});
        input.trace.add({
          kind: "TOOL_OBSERVATION",
          status: execution.observation.status === "ERROR" ? "FAILED"
            : execution.observation.status === "EMPTY" ? "EMPTY" : "SUCCEEDED",
          label: execution.observation.status === "ERROR"
            ? isExternalCall ? "联网检索失败" : isCalculation ? "参数计算失败" : "工具读取失败"
            : isExternalCall
              ? "获得公开网页检索结果"
              : isCalculation ? "获得确定性计算结果" : "获得工具观察",
          summary: execution.observation.summary,
          toolCallId: execution.observation.callId,
          toolId: execution.observation.toolId,
          latencyMs: execution.observation.latencyMs,
        }, { errorCode: execution.observation.errorCode });
        if (legacyBaselineReuse) {
          input.trace.add({
            kind: "DEGRADED",
            status: "SUCCEEDED",
            label: "复用旧课程基线",
            summary:
              `V2 返回健康 EMPTY；继续保留 ${legacyBaselineReuse.references.length} 条本回合已注入的旧链课程候选，不计为 V2 命中。`,
            toolCallId:
              execution.observation.callId,
            toolId:
              execution.observation.toolId,
            latencyMs:
              execution.observation.latencyMs,
          }, {
            sourceIds:
              legacyBaselineReuse.references
                .map(({ sourceId }) => sourceId),
          });
        }
        input.onToolProgress?.({
          status: execution.observation.status === "ERROR" ? "FAILED" : "SUCCEEDED",
          toolId: execution.observation.toolId,
          label: execution.observation.status === "ERROR"
            ? `${isExternalCall ? "联网" : isCalculation ? "计算" : "查阅"}失败：${definition.descriptor.label}`
            : `${isExternalCall ? "已联网核对" : isCalculation ? "已计算" : "已查阅"}：${definition.descriptor.label}`,
          summary: execution.observation.summary,
        });
        messages.push({
          role: "tool",
          toolCallId: modelCall.id,
          content: toolResultContent({
            status: execution.observation.status,
            summary: legacyBaselineReuse
              ? `${execution.observation.summary} V2 本轮健康无匹配；初始上下文中的旧课程候选继续有效，但只有正文实际使用时才可声明来源。`
              : execution.observation.summary,
            facts: execution.observation.facts,
            output: legacyBaselineReuse
              ? {
                  v2Evidence:
                    execution.output,
                  ...legacyBaselineReuse,
                }
              : execution.output,
            errorCode: execution.observation.errorCode,
          }),
        });
      } catch (error) {
        await input.lifecycle?.emit({
          phase: "tool.execute.after",
          status: "FAILED",
          toolId: definition.descriptor.id,
          errorCode: error instanceof ModelServiceError
            ? `MODEL_${error.code}`
            : toolErrorCode(error),
        });
        if (error instanceof ModelServiceError) {
          input.trace.add({
            kind: "TOOL_CALL",
            status: "FAILED",
            label: isExternalCall
              ? "联网检索服务中断"
              : isCalculation ? "确定性计算服务中断" : "只读工具服务中断",
            summary: "工具依赖的模型服务未完成请求；本轮已停止，未使用不完整结果。",
            toolCallId: null,
            toolId: definition.descriptor.id,
            latencyMs: Math.round(performance.now() - callStarted),
          }, { errorCode: error.code });
          input.onToolProgress?.({
            status: "FAILED",
            toolId: definition.descriptor.id,
            label: `服务中断：${definition.descriptor.label}`,
            summary: "模型服务未完成请求，本轮已停止；不会使用不完整的工具结果。",
          });
          input.onModelError?.(error, modelDecisions + 1);
          throw error;
        }
        const errorCode = toolErrorCode(error);
        const copy = toolFailureCopy(errorCode);
        input.trace.add({
          kind: "TOOL_CALL",
          status: "FAILED",
          label: copy.label,
          summary: copy.traceSummary,
          toolCallId: null,
          toolId: definition.descriptor.id,
          latencyMs: Math.round(performance.now() - callStarted),
        }, { errorCode });
        input.onToolProgress?.({
          status: "FAILED",
          toolId: definition.descriptor.id,
          label: `未执行：${definition.descriptor.label}`,
          summary: copy.progressSummary,
        });
        messages.push({
          role: "tool",
          toolCallId: modelCall.id,
          content: toolResultContent({
            status: "ERROR",
            summary: copy.modelSummary,
            errorCode,
          }),
        });
      }
    }
  }

  failArtworkProgress(
    "作品图片未形成最终回答",
    "视觉模型没有在本轮预算内形成最终正文；不会把这张图片标记为已观察依据。",
  );
  throw new ModelServiceError("INVALID_RESPONSE");
}

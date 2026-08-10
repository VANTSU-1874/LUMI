import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import type {
  ModelConversationMessage,
  ModelResponse,
} from "@/lib/ai/client";
import type { SessionPayload } from "@/lib/auth/session";
import {
  createDb,
  type DatabaseConnection,
} from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";

import {
  AgentEvidenceToolOutputV2Schema,
  type AgentEvidenceSearchPortV2,
  type AgentEvidenceToolOutputV2,
} from "./evidence-tool-v2";
import {
  type ModelProviderAdapter,
} from "./model-provider-adapter";
import { runAgentTurn } from "./orchestrator";
import {
  RagAgentHarnessCaseResultSchema,
  type RagAgentHarnessCaseResult,
} from "./rag-harness";
import {
  buildResolvedUserIntentV1,
} from "./resolved-user-intent-v1";
import {
  recordStudentMemoryDispute,
} from "./student-memory-dispute";
import { createDesignTask } from "./design-project-task";

const HarnessNodeSchema = z.object({
  nodeId: z.string().regex(
    /^[a-z0-9][a-z0-9-]{0,127}$/,
  ),
  kind: z.enum([
    "DOCUMENT",
    "SECTION",
    "TEXT",
    "IMAGE",
    "TABLE",
    "REGION",
  ]),
  relation: z.enum([
    "PRIMARY",
    "PARENT",
    "SIBLING",
  ]),
  excerpt: z.string().trim().min(1).max(1_200),
  assetId: z.string().regex(
    /^[a-z0-9][a-z0-9-]{0,127}$/,
  ).nullable(),
}).strict();

const HarnessCaseSchema = z.object({
  caseId: z.string().trim().min(1).max(80),
  rawQuestion: z.string().trim().min(1).max(1_000),
  selfContainedQuestion:
    z.string().trim().min(1).max(1_500),
  coursePackId:
    z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  view: z.enum([
    "AGENT",
    "NODE_CANVAS",
    "KNOWLEDGE_MAP",
    "BOOK_LAYOUT_LAB",
    "LAYOUT_GRID_LAB",
    "GENERATIVE_LAB",
  ]),
  modality: z.enum([
    "TEXT",
    "VISUAL",
    "MULTIMODAL",
    "NONE",
  ]),
  queryType: z.enum([
    "STANDALONE",
    "CONTEXTUAL",
    "NO_ANSWER",
    "FAILURE",
    "LEGACY",
  ]),
  caseFamily: z.enum([
    "EVIDENCE_CHAIN",
    "CONTEXT",
    "MEMORY",
    "ISOLATION",
    "DEGRADATION",
    "COMPATIBILITY",
  ]),
  resolvedReferences: z.array(z.object({
    mention: z.string().trim().min(1).max(120),
    resolvedText:
      z.string().trim().min(1).max(500),
    sourceTurnId:
      z.string().trim().min(1).max(128),
  }).strict()).max(8),
  answerObligations: z.array(z.object({
    obligationId:
      z.string().regex(/^obligation-[1-4]$/),
    intent: z.enum([
      "DIAGNOSE_CAUSE",
      "FIRST_ACTION",
      "HOW_TO",
      "CHECK_CRITERIA",
      "EVIDENCE_FOR",
      "RISK_MITIGATION",
      "COMPARE_TRADEOFF",
      "EXPLAIN_CONCEPT",
      "VERIFY_FACT",
    ]),
    query: z.string().trim().min(1).max(500),
  }).strict()).min(1).max(4),
  knowledgeQuery:
    z.string().trim().min(1).max(1_500),
  memoryQuery:
    z.string().trim().min(1).max(1_500),
  ambiguityStatus: z.enum([
    "NONE",
    "RESOLVED",
    "CLARIFY",
  ]),
  clarifyingQuestion:
    z.string().trim().min(1).max(500).nullable(),
  previousTurns: z.array(z.object({
    turnId: z.string().trim().min(1).max(128),
    studentMessage:
      z.string().trim().min(1).max(2_000),
    assistantMessage:
      z.string().trim().min(1).max(4_000),
    coursePackId:
      z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  }).strict()).max(4),
  memorySeeds: z.array(z.object({
    memoryId: z.string().trim().min(1).max(128),
    owner: z.enum(["CURRENT", "OTHER"]),
    content: z.string().trim().min(1).max(2_000),
    disputed: z.boolean(),
  }).strict()).max(8),
  disputedMemoryIds:
    z.array(z.string().trim().min(1).max(128))
      .max(8),
  forbiddenContextTexts:
    z.array(z.string().trim().min(1).max(300))
      .max(12),
  knowledgeObjectV2Enabled: z.boolean(),
  usageStrategy: z.enum([
    "FIRST",
    "FIRST_TWO",
    "NONE",
  ]),
  evidence: z.object({
    status: z.enum([
      "SUCCESS",
      "DEGRADED",
      "EMPTY",
      "UNSUPPORTED",
    ]),
    capabilitiesLost: z.array(z.enum([
      "LEXICAL",
      "TEXT_VECTOR",
      "VISUAL_VECTOR",
      "ASSET",
      "REGION",
      "TEXT_EVIDENCE",
      "GRAPH_CONTEXT",
    ])).max(7),
    nodes: z.array(HarnessNodeSchema).max(5),
  }).strict(),
}).strict();

const HarnessSuiteSchema = z.object({
  schemaVersion: z.literal(1),
  suiteVersion:
    z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/),
  cases: z.array(HarnessCaseSchema).length(12),
}).strict().superRefine((suite, context) => {
  const ids = suite.cases.map(({ caseId }) => caseId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      message: "RAG harness suite ids must be unique",
    });
  }
});

const QrelCaseSchema = z.object({
  caseId: z.string().trim().min(1).max(80),
  answerable: z.boolean(),
  requiredGroups: z.array(z.object({
    groupId: z.string().trim().min(1).max(160),
    sourceIds:
      z.array(z.string().trim().min(1).max(160))
        .min(1)
        .max(8),
  }).strict()).max(8),
}).strict();

const HarnessQrelsSchema = z.object({
  schemaVersion: z.literal(1),
  suiteVersion:
    z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/),
  cases: z.array(QrelCaseSchema).length(12),
}).strict().superRefine((qrels, context) => {
  const ids = qrels.cases.map(({ caseId }) => caseId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      message: "RAG harness qrel ids must be unique",
    });
  }
});

export type RagHarnessSuiteV1 = z.infer<
  typeof HarnessSuiteSchema
>;
type RagHarnessCaseV1 =
  RagHarnessSuiteV1["cases"][number];
type RagHarnessQrelV1 = z.infer<
  typeof QrelCaseSchema
>;

async function readJson(path: string) {
  return JSON.parse(
    await readFile(path, "utf8"),
  ) as unknown;
}

export async function loadRagHarnessSuiteV1(
  path: string,
) {
  return HarnessSuiteSchema.parse(
    await readJson(path),
  );
}

async function loadRagHarnessQrelsV1(
  path: string,
) {
  return HarnessQrelsSchema.parse(
    await readJson(path),
  );
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function toolFunctionName(toolId: string) {
  return `tool_${toolId.replace(
    /[^A-Za-z0-9_-]/g,
    "_",
  )}`.slice(0, 64);
}

function outputFromMessages(
  messages: readonly ModelConversationMessage[],
) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "tool") continue;
    try {
      const envelope = JSON.parse(
        message.content,
      ) as { output?: unknown };
      const parsed =
        AgentEvidenceToolOutputV2Schema.safeParse(
          envelope.output,
        );
      if (parsed.success) return parsed.data;
    } catch {
      // The model treats malformed tool content as data,
      // while the Harness records the missing injection.
    }
  }
  return null;
}

type ModelObservation = {
  modelId: string;
  callCount: number;
  initialContextSeen: boolean;
  requiredContextMatches: string[];
  forbiddenContextMatches: string[];
  injectedSourceIds: string[];
  queryIssued: string | null;
  latencyMs: number;
};

function observeModelMessages(input: {
  messages: readonly ModelConversationMessage[];
  testCase: RagHarnessCaseV1;
  modelObservation: ModelObservation;
}) {
  const rendered = JSON.stringify(input.messages);
  if (input.modelObservation.callCount === 1) {
    input.modelObservation.initialContextSeen = true;
    const contextMessage = [...input.messages]
      .reverse()
      .find(({ role }) => role === "user");
    let recentConversation: unknown[] = [];
    try {
      const parsed = JSON.parse(
        contextMessage?.content ?? "{}",
      ) as { recentConversation?: unknown };
      recentConversation = Array.isArray(
        parsed.recentConversation,
      )
        ? parsed.recentConversation
        : [];
    } catch {
      recentConversation = [];
    }
    input.modelObservation.requiredContextMatches =
      input.testCase.previousTurns.flatMap(
        ({ studentMessage }) =>
          recentConversation.some(
            (turn) =>
              typeof turn === "object"
              && turn !== null
              && "studentMessage" in turn
              && typeof turn.studentMessage
                === "string"
              && turn.studentMessage
                .normalize("NFKC")
                .trim()
                === studentMessage
                  .normalize("NFKC")
                  .trim(),
          )
            ? [studentMessage]
            : [],
      );
    input.modelObservation.forbiddenContextMatches =
      input.testCase.forbiddenContextTexts.filter(
        (value) => rendered.includes(value),
      );
  }
  const evidence = outputFromMessages(input.messages);
  const returned = evidence?.evidence.nodes ?? [];
  input.modelObservation.injectedSourceIds =
    unique([
      ...input.modelObservation
        .injectedSourceIds,
      ...returned.flatMap(({ nodeId }) =>
        rendered.includes(nodeId)
          ? [nodeId]
          : []),
    ]);
}

function observeIssuedQuery(
  response: ModelResponse,
) {
  for (const call of response.toolCalls ?? []) {
    try {
      const parsed = JSON.parse(
        call.arguments,
      ) as { query?: unknown };
      if (
        typeof parsed.query === "string"
        && parsed.query.trim()
      ) return parsed.query.trim();
    } catch {
      // A malformed tool call remains visible to the
      // production tool loop and cannot satisfy the gate.
    }
  }
  return null;
}

export function guardRagHarnessRealModelOutbound(
  upstream: ModelProviderAdapter,
  input: { configuredSecrets: readonly string[] },
): ModelProviderAdapter {
  const assertSafe = (
    messages: readonly ModelConversationMessage[],
    options?: Parameters<
      NonNullable<ModelProviderAdapter["respond"]>
    >[1],
  ) => {
    if (options?.image) {
      throw new Error(
        "RAG_HARNESS_REAL_MODEL_IMAGE_NOT_AUTHORIZED",
      );
    }
    const payload = JSON.stringify({
      messages,
      tools: options?.tools ?? [],
      toolChoice: options?.toolChoice ?? null,
      structuredOutput:
        options?.structuredOutput ?? null,
    });
    const forbidden = [
      /\bqrels?\b/iu,
      /expectedSourceIds/iu,
      /requiredGroups/iu,
      /hard[-_ ]?negative/iu,
      /graphify/iu,
      /service\.env/iu,
      /\.sqlite(?:\b|")/iu,
      /[A-Za-z]:[\\/]/u,
      /(?:^|["\s])\/(?:Users|home|workspace)\//u,
    ];
    if (
      forbidden.some((pattern) =>
        pattern.test(payload))
    ) {
      throw new Error(
        "RAG_HARNESS_REAL_MODEL_FORBIDDEN_FIELD",
      );
    }
    if (
      input.configuredSecrets.some(
        (secret) =>
          secret.length > 0
          && payload.includes(secret),
      )
    ) {
      throw new Error(
        "RAG_HARNESS_REAL_MODEL_SECRET_IN_PAYLOAD",
      );
    }
  };
  return {
    provider: upstream.provider,
    ...(upstream.modelId
      ? { modelId: upstream.modelId }
      : {}),
    capabilities: {
      ...upstream.capabilities,
      vision: false,
    },
    async complete(messages, options) {
      const conversationMessages =
        messages.map((message) => ({
          role: message.role,
          content: message.content,
        })) as ModelConversationMessage[];
      assertSafe(conversationMessages);
      return upstream.complete(messages, options);
    },
    ...(upstream.respond ? {
      async respond(messages, options) {
        assertSafe(messages, options);
        return upstream.respond!(
          messages,
          options,
        );
      },
    } : {}),
    async completeWithImage() {
      throw new Error(
        "RAG_HARNESS_REAL_MODEL_IMAGE_NOT_AUTHORIZED",
      );
    },
  };
}

function observedExternalModel(input: {
  upstream: ModelProviderAdapter;
  testCase: RagHarnessCaseV1;
  modelObservation: ModelObservation;
}): ModelProviderAdapter {
  if (!input.upstream.respond) {
    throw new Error(
      "RAG_HARNESS_REAL_MODEL_NATIVE_RESPONSE_REQUIRED",
    );
  }
  return {
    provider: input.upstream.provider,
    modelId: input.upstream.modelId,
    capabilities: {
      ...input.upstream.capabilities,
      vision: false,
    },
    complete: input.upstream.complete,
    async respond(messages, options) {
      const started = performance.now();
      input.modelObservation.callCount += 1;
      observeModelMessages({
        messages,
        testCase: input.testCase,
        modelObservation:
          input.modelObservation,
      });
      const response =
        await input.upstream.respond!(
          messages,
          options,
        );
      input.modelObservation.queryIssued ??=
        observeIssuedQuery(response);
      input.modelObservation.latencyMs +=
        Math.round(
          performance.now() - started,
        );
      return response;
    },
  };
}

function deterministicModel(input: {
  testCase: RagHarnessCaseV1;
  modelObservation: ModelObservation;
}): ModelProviderAdapter {
  return {
    provider: "TEST",
    modelId: "rag-harness-deterministic",
    capabilities: { vision: false },
    async complete() {
      throw new Error(
        "RAG_HARNESS_REQUIRES_NATIVE_RESPONSE",
      );
    },
    async respond(messages): Promise<ModelResponse> {
      const started = performance.now();
      input.modelObservation.callCount += 1;
      observeModelMessages({
        messages,
        testCase: input.testCase,
        modelObservation:
          input.modelObservation,
      });
      if (input.modelObservation.callCount === 1) {
        input.modelObservation.queryIssued =
          input.testCase.knowledgeQuery;
        const toolId =
          input.testCase.knowledgeObjectV2Enabled
            ? "knowledge-map.search-evidence"
            : "knowledge-map.search-concepts";
        input.modelObservation.latencyMs += Math.round(
          performance.now() - started,
        );
        return {
          content: null,
          toolCalls: [{
            id: `rag-${input.testCase.caseId}-tool`,
            name: toolFunctionName(toolId),
            arguments: JSON.stringify({
              query: input.testCase.knowledgeQuery,
            }),
          }],
        };
      }
      const evidence = outputFromMessages(messages);
      const returned = evidence?.evidence.nodes ?? [];
      const useCount =
        input.testCase.usageStrategy === "FIRST_TWO"
          ? 2
          : input.testCase.usageStrategy === "FIRST"
            ? 1
            : 0;
      const used = returned.slice(0, useCount);
      const body = used.length > 0
        ? [
            "课程证据表明：",
            ...used.map(({ excerpt }) =>
              excerpt ?? "课程节点未提供文字摘录。"),
            "你可以先把这个判断落实到当前作品的一处修改上。",
          ].join("\n")
        : input.testCase.queryType === "FAILURE"
          ? "当前视觉检索通道不可用，我没有读到可核对的参考图区域，因此不能猜测具体视觉中心。"
          : input.testCase.queryType === "NO_ANSWER"
            ? "课程资料没有提供保证比赛结果的固定公式，我不能编造课程结论或来源。"
            : "当前没有可引用的新版课程证据；我会按通用设计经验说明，并明确不把它冒充课程来源。";
      const sidecar = used.length > 0
        ? `\n\n<!-- tutor-meta ${JSON.stringify({
            sourceIds:
              used.map(({ nodeId }) => nodeId),
          })} -->`
        : "";
      input.modelObservation.latencyMs += Math.round(
        performance.now() - started,
      );
      return {
        content: `${body}${sidecar}`,
        toolCalls: [],
      };
    },
  };
}

function evidenceKind(
  kind: RagHarnessCaseV1["evidence"]["nodes"][number]["kind"],
) {
  if (kind === "IMAGE" || kind === "REGION") {
    return "VISUAL_REFERENCE" as const;
  }
  if (kind === "TEXT" || kind === "TABLE") {
    return "KNOWLEDGE_FACT" as const;
  }
  return "CONTEXT" as const;
}

function fixtureHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function buildEvidenceOutput(
  testCase: RagHarnessCaseV1,
): AgentEvidenceToolOutputV2 {
  const objectId =
    `object-${testCase.caseId.slice(4)}`;
  const sourceId =
    `source-${testCase.caseId.slice(4)}`;
  const assets = unique(
    testCase.evidence.nodes.flatMap(
      ({ assetId }) => assetId ? [assetId] : [],
    ),
  ).map((assetId) => ({
    assetId,
    objectId,
    sha256: fixtureHash({ assetId }),
    widthPx: 1200,
    heightPx: 800,
    previewUrl:
      `/api/knowledge/assets/${assetId}`,
  }));
  const regions = testCase.evidence.nodes
    .filter(({ kind, assetId }) =>
      kind === "REGION" && assetId !== null)
    .map(({ nodeId, assetId }) => ({
      regionId:
        `region-${testCase.caseId.slice(4)}`,
      objectId,
      assetId: assetId!,
      regionNodeId: nodeId,
      bbox: {
        coordinateSpace: "NORMALIZED" as const,
        x: 0.1,
        y: 0.15,
        width: 0.5,
        height: 0.4,
      },
      previewUrl:
        `/api/knowledge/assets/${assetId}`,
    }));
  const hasText = testCase.evidence.nodes.some(
    ({ kind }) =>
      kind !== "IMAGE" && kind !== "REGION",
  );
  const hasVisual = testCase.evidence.nodes.some(
    ({ kind }) =>
      kind === "IMAGE" || kind === "REGION",
  );
  const statusFor = (
    channel: "LEXICAL" | "TEXT_VECTOR" | "VISUAL_VECTOR",
  ) => {
    if (
      channel === "VISUAL_VECTOR"
      && testCase.evidence.capabilitiesLost.includes(
        "VISUAL_VECTOR",
      )
    ) return "UNAVAILABLE" as const;
    if (
      channel === "VISUAL_VECTOR"
        ? hasVisual
        : hasText
    ) return "SUCCESS" as const;
    return "EMPTY" as const;
  };
  return AgentEvidenceToolOutputV2Schema.parse({
    schemaVersion: 2,
    kind: "KNOWLEDGE_MAP_SEARCH_EVIDENCE",
    bundle: {
      bundleId:
        `bundle-${testCase.caseId.slice(4)}`,
      status: testCase.evidence.status,
      queryHash:
        sha256StableJsonV2(testCase.knowledgeQuery),
      corpusBundleHash:
        fixtureHash("rag-harness-corpus-v1"),
      activeIndexBundleHash:
        fixtureHash("rag-harness-index-v1"),
      capabilitiesLost:
        testCase.evidence.capabilitiesLost,
    },
    channels: [
      {
        channel: "LEXICAL",
        status: statusFor("LEXICAL"),
        hitCount: hasText
          ? testCase.evidence.nodes.length
          : 0,
        indexVersionId: "lexical-fixture-v1",
        modelId: null,
        modelRevision: null,
      },
      {
        channel: "TEXT_VECTOR",
        status: statusFor("TEXT_VECTOR"),
        hitCount: hasText
          ? testCase.evidence.nodes.length
          : 0,
        indexVersionId: "text-fixture-v1",
        modelId: "bge-fixture",
        modelRevision: "suite-v1",
      },
      {
        channel: "VISUAL_VECTOR",
        status: statusFor("VISUAL_VECTOR"),
        hitCount: hasVisual
          ? testCase.evidence.nodes.length
          : 0,
        indexVersionId: "visual-fixture-v1",
        modelId: "siglip-fixture",
        modelRevision: "suite-v1",
      },
    ],
    evidence: {
      nodes: testCase.evidence.nodes.map(
        (node) => ({
          ...node,
          objectId,
          sourceId,
          evidenceKind:
            evidenceKind(node.kind),
        }),
      ),
      assets,
      regions,
      sources:
        testCase.evidence.nodes.length > 0
          ? [{
              sourceId,
              objectId,
              title:
                `RAG Harness：${testCase.caseId}`,
              authority: "COURSE_DESIGN",
              verifiedDate: "2026-07-30",
              scope:
                "T5-H 确定性运行时夹具，只用于验证证据链。",
            }]
          : [],
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

function evidencePort(input: {
  testCase: RagHarnessCaseV1;
  observedQueries: string[];
  observedCoursePacks: string[];
}): AgentEvidenceSearchPortV2 {
  return {
    async search(request) {
      input.observedQueries.push(request.query);
      input.observedCoursePacks.push(
        request.coursePackId,
      );
      if (
        request.coursePackId
          !== input.testCase.coursePackId
        || request.coursePackVersion !== "1"
      ) {
        throw new Error(
          "RAG_HARNESS_CROSS_PACK_REQUEST",
        );
      }
      return buildEvidenceOutput(input.testCase);
    },
  };
}

function seedPreviousTurns(input: {
  connection: DatabaseConnection;
  taskId: string;
  studentId: string;
  classId: string;
  testCase: RagHarnessCaseV1;
}) {
  for (
    const [
      index,
      turn,
    ] of input.testCase.previousTurns.entries()
  ) {
    const conversationId = randomUUID();
    input.connection.sqlite.prepare(`
      INSERT INTO agent_conversations(
        id,task_id,student_id,class_id,project_id,
        course_pack_id,course_pack_version,
        created_at,updated_at
      ) VALUES(?,?,?,?,NULL,?,?,?,?)
    `).run(
      conversationId,
      input.taskId,
      input.studentId,
      input.classId,
      turn.coursePackId,
      "1",
      1_700_000_000 + index,
      1_700_000_000 + index,
    );
    input.connection.sqlite.prepare(`
      INSERT INTO agent_turns(
        id,conversation_id,turn_sequence,
        student_message,episode,decision_code,
        policy_trace_json,reply_json,ai_mode,
        source_ids_json,created_at,data_type
      ) VALUES(?,?,1,?,'EXPLORE','HARNESS_PRELUDE',
        '{}',?,'MODEL_ASSISTED','[]',?,'REAL')
    `).run(
      turn.turnId,
      conversationId,
      turn.studentMessage,
      JSON.stringify({
        title: "前置回合",
        message: turn.assistantMessage,
      }),
      1_700_000_000 + index,
    );
  }
}

function seedMemories(input: {
  connection: DatabaseConnection;
  studentId: string;
  otherStudentId: string;
  classId: string;
  testCase: RagHarnessCaseV1;
}) {
  for (
    const [
      index,
      seed,
    ] of input.testCase.memorySeeds.entries()
  ) {
    const owner = seed.owner === "CURRENT"
      ? input.studentId
      : input.otherStudentId;
    input.connection.sqlite.prepare(`
      INSERT INTO agent_student_memory(
        id,student_id,class_id,kind,content,
        salience,source_turn_id,created_at
      ) VALUES(?,?,?,'PROJECT_FACT',?,8,NULL,?)
    `).run(
      seed.memoryId,
      owner,
      input.classId,
      seed.content,
      1_700_000_100 + index,
    );
    if (seed.disputed) {
      recordStudentMemoryDispute(
        input.connection,
        {
          memoryId: seed.memoryId,
          studentId: owner,
          classId: input.classId,
          reason:
            "RAG Harness 独立争议记录。",
          now: new Date(
            "2026-07-30T12:00:00.000Z",
          ),
        },
      );
    }
  }
}

type RuntimeObservation = {
  testCase: RagHarnessCaseV1;
  durationMs: number;
  model: ModelObservation;
  returnedSourceIds: string[];
  injectedSourceIds: string[];
  usedSourceIds: string[];
  persistedSourceIds: string[];
  assetIds: string[];
  regions: Array<{
    regionId: string;
    assetId: string;
    nodeId: string | null;
  }>;
  parentNodeIds: string[];
  toolCallIds: string[];
  persistenceTraceIds: string[];
  sourceSelectionIds: string[];
  observedQueries: string[];
  observedCoursePacks: string[];
  responseMessage: string;
  responseCoursePackId: string;
  evidenceToolUsed: boolean;
  legacyToolUsed: boolean;
  disputedMemoryRowRetained: boolean;
};

function readPersistedEvidence(
  connection: DatabaseConnection,
  turnId: string,
) {
  const calls = connection.sqlite.prepare(`
    SELECT id,tool_id toolId,output_json outputJson
    FROM agent_tool_calls
    WHERE turn_id=?
    ORDER BY call_sequence
  `).all(turnId) as Array<{
    id: string;
    toolId: string;
    outputJson: string | null;
  }>;
  const evidenceCall = calls.find(
    ({ toolId }) =>
      toolId === "knowledge-map.search-evidence",
  );
  const output = evidenceCall?.outputJson
    ? AgentEvidenceToolOutputV2Schema.parse(
        JSON.parse(evidenceCall.outputJson),
      )
    : null;
  return { calls, output };
}

async function runRuntimeCase(input: {
  connection: DatabaseConnection;
  testCase: RagHarnessCaseV1;
  caseIndex: number;
  mode: "deterministic" | "real-model";
  modelProvider?: ModelProviderAdapter;
}): Promise<RuntimeObservation> {
  const started = performance.now();
  const classId = "rag-harness-class";
  const studentId =
    `rag-student-${String(input.caseIndex + 1)
      .padStart(2, "0")}`;
  const otherStudentId =
    `${studentId}-other`;
  input.connection.sqlite.prepare(`
    INSERT INTO users(
      id,class_id,role,alias,created_at
    ) VALUES(?,?,'STUDENT',?,1700000000)
  `).run(
    studentId,
    classId,
    `RAG Student ${input.caseIndex + 1}`,
  );
  input.connection.sqlite.prepare(`
    INSERT INTO users(
      id,class_id,role,alias,created_at
    ) VALUES(?,?,'STUDENT',?,1700000000)
  `).run(
    otherStudentId,
    classId,
    `RAG Other ${input.caseIndex + 1}`,
  );
  const actor = {
    userId: studentId,
    role: "STUDENT",
  } satisfies SessionPayload;
  const task = createDesignTask(
    input.connection,
    actor,
    { title: input.testCase.caseId },
    new Date("2026-07-30T12:00:00.000Z"),
  );
  seedPreviousTurns({
    connection: input.connection,
    taskId: task.id,
    studentId,
    classId,
    testCase: input.testCase,
  });
  seedMemories({
    connection: input.connection,
    studentId,
    otherStudentId,
    classId,
    testCase: input.testCase,
  });
  const intent = buildResolvedUserIntentV1({
    rawQuestion: input.testCase.rawQuestion,
    selfContainedQuestion:
      input.testCase.selfContainedQuestion,
    resolvedReferences:
      input.testCase.resolvedReferences,
    answerObligations:
      input.testCase.answerObligations,
    coursePack: {
      id: input.testCase.coursePackId,
      version: "1",
    },
    knowledgeQuery: input.testCase.knowledgeQuery,
    memoryQuery: input.testCase.memoryQuery,
    ambiguity: {
      status: input.testCase.ambiguityStatus,
      clarifyingQuestion:
        input.testCase.clarifyingQuestion,
    },
  });
  const modelObservation: ModelObservation = {
    modelId: input.modelProvider?.modelId
      ?? "rag-harness-deterministic",
    callCount: 0,
    initialContextSeen: false,
    requiredContextMatches: [],
    forbiddenContextMatches: [],
    injectedSourceIds: [],
    queryIssued: null,
    latencyMs: 0,
  };
  const observedQueries: string[] = [];
  const observedCoursePacks: string[] = [];
  const response = await runAgentTurn(
    input.connection,
    actor,
    {
      taskId: task.id,
      message: intent.rawQuestion,
      context: { view: input.testCase.view },
    },
    {
      modelProviderAdapter:
        input.mode === "real-model"
          ? observedExternalModel({
              upstream:
                input.modelProvider!,
              testCase: input.testCase,
              modelObservation,
            })
          : deterministicModel({
              testCase: input.testCase,
              modelObservation,
            }),
      knowledgeObjectV2Enabled:
        input.testCase.knowledgeObjectV2Enabled,
      visualRetrievalEnabled:
        input.testCase.knowledgeObjectV2Enabled,
      evidenceBundleV2Enabled:
        input.testCase.knowledgeObjectV2Enabled,
      evidenceSearchV2:
        evidencePort({
          testCase: input.testCase,
          observedQueries,
          observedCoursePacks,
        }),
      now: () =>
        new Date("2026-07-30T12:01:00.000Z"),
    },
  );
  modelObservation.queryIssued ??=
    observedQueries[0] ?? null;
  const persisted = readPersistedEvidence(
    input.connection,
    response.turnId,
  );
  const returnedSourceIds =
    persisted.output?.evidence.nodes.map(
      ({ nodeId }) => nodeId,
    ) ?? [];
  const returned = new Set(returnedSourceIds);
  const usedSourceIds = response.reply.sources
    .filter(({ id, evidence }) =>
      returned.has(id)
      && evidence?.schemaVersion === 2)
    .map(({ id }) => id);
  const turn = input.connection.sqlite.prepare(`
    SELECT source_ids_json sourceIdsJson
    FROM agent_turns
    WHERE id=?
  `).get(response.turnId) as {
    sourceIdsJson: string;
  };
  const persistedSourceIds = (
    JSON.parse(turn.sourceIdsJson) as string[]
  ).filter((id) => returned.has(id));
  const events = input.connection.sqlite.prepare(`
    SELECT id,kind,source_ids_json sourceIdsJson
    FROM agent_runtime_events
    WHERE turn_id=?
    ORDER BY event_sequence
  `).all(response.turnId) as Array<{
    id: string;
    kind: string;
    sourceIdsJson: string;
  }>;
  const sourceSelection = events.find(
    ({ kind }) => kind === "SOURCE_SELECTION",
  );
  const disputedMemoryRowRetained =
    input.testCase.disputedMemoryIds.every(
      (memoryId) => Boolean(
        input.connection.sqlite.prepare(`
          SELECT 1
          FROM agent_student_memory
          WHERE id=?
        `).get(memoryId),
      ),
    );
  return {
    testCase: input.testCase,
    durationMs: Math.round(
      performance.now() - started,
    ),
    model: modelObservation,
    returnedSourceIds,
    injectedSourceIds:
      modelObservation.injectedSourceIds,
    usedSourceIds,
    persistedSourceIds,
    assetIds:
      persisted.output?.evidence.assets.map(
        ({ assetId }) => assetId,
      ) ?? [],
    regions:
      persisted.output?.evidence.regions.map(
        (region) => ({
          regionId: region.regionId,
          assetId: region.assetId,
          nodeId: region.regionNodeId,
        }),
      ) ?? [],
    parentNodeIds:
      persisted.output?.evidence.nodes
        .filter(({ relation }) =>
          relation === "PARENT")
        .map(({ nodeId }) => nodeId) ?? [],
    toolCallIds:
      persisted.calls.map(({ id }) => id),
    persistenceTraceIds:
      events.filter(({ kind }) =>
        kind === "PERSISTENCE")
        .map(({ id }) => id),
    sourceSelectionIds: sourceSelection
      ? JSON.parse(
          sourceSelection.sourceIdsJson,
        ) as string[]
      : [],
    observedQueries,
    observedCoursePacks,
    responseMessage: response.reply.message,
    responseCoursePackId: response.coursePack.id,
    evidenceToolUsed: persisted.calls.some(
      ({ toolId }) =>
        toolId
          === "knowledge-map.search-evidence",
    ),
    legacyToolUsed: persisted.calls.some(
      ({ toolId }) =>
        toolId
          === "knowledge-map.search-concepts",
    ),
    disputedMemoryRowRetained,
  };
}

function scoreRuntimeCase(
  runtime: RuntimeObservation,
  qrel: RagHarnessQrelV1,
  mode: "deterministic" | "real-model",
): RagAgentHarnessCaseResult {
  const injected =
    new Set(runtime.injectedSourceIds);
  const used = new Set(runtime.usedSourceIds);
  const requiredGroupResults =
    qrel.requiredGroups.map((group) => ({
      groupId: group.groupId,
      expectedSourceIds: group.sourceIds,
      injected: group.sourceIds.some(
        (id) => injected.has(id),
      ),
      used: group.sourceIds.some(
        (id) => used.has(id),
      ),
    }));
  const failures = [
    runtime.responseCoursePackId
      === runtime.testCase.coursePackId
      ? null
      : "COURSE_PACK_ROUTE_DRIFT",
    runtime.model.initialContextSeen
      ? null
      : "MODEL_CONTEXT_NOT_SEEN",
    mode === "real-model"
      && !runtime.testCase
        .knowledgeObjectV2Enabled
      ? null
      : mode === "deterministic"
      ? runtime.model.queryIssued
          === runtime.testCase.knowledgeQuery
        ? null
        : "KNOWLEDGE_QUERY_DRIFT"
      : runtime.model.queryIssued?.trim()
        ? null
        : "KNOWLEDGE_QUERY_MISSING",
    runtime.testCase.previousTurns.length
      === runtime.model.requiredContextMatches.length
      ? null
      : "CONTEXT_REFERENCE_NOT_INJECTED",
    runtime.model.forbiddenContextMatches.length === 0
      ? null
      : "FORBIDDEN_CONTEXT_INJECTED",
    runtime.testCase.knowledgeObjectV2Enabled
      ? runtime.evidenceToolUsed
        ? null
        : "EVIDENCE_TOOL_NOT_USED"
      : runtime.evidenceToolUsed
        ? "V2_TOOL_USED_WHILE_DISABLED"
        : null,
    runtime.testCase.knowledgeObjectV2Enabled
      ? runtime.observedCoursePacks.every(
          (id) => id === runtime.testCase.coursePackId,
        )
        ? null
        : "EVIDENCE_PORT_CROSS_PACK"
      : mode === "deterministic"
        ? runtime.legacyToolUsed
          ? null
          : "LEGACY_TOOL_NOT_USED"
        : null,
    runtime.returnedSourceIds.every(
      (id) => runtime.injectedSourceIds.includes(id),
    )
      ? null
      : "RETURNED_NOT_INJECTED",
    runtime.usedSourceIds.every(
      (id) => runtime.injectedSourceIds.includes(id),
    )
      ? null
      : "USED_NOT_INJECTED",
    JSON.stringify(runtime.persistedSourceIds)
      === JSON.stringify(runtime.usedSourceIds)
      ? null
      : "PERSISTED_USED_DRIFT",
    runtime.sourceSelectionIds
      .filter((id) =>
        runtime.returnedSourceIds.includes(id))
      .every((id) =>
        runtime.usedSourceIds.includes(id))
      ? null
      : "LIVE_EVENT_USED_DRIFT",
    runtime.persistenceTraceIds.length === 1
      ? null
      : "PERSISTENCE_TRACE_MISSING",
    requiredGroupResults.every(
      ({ injected: present }) => present,
    )
      ? null
      : "REQUIRED_GROUP_NOT_INJECTED",
    requiredGroupResults.every(
      ({ used: present }) => present,
    )
      ? null
      : "REQUIRED_GROUP_NOT_USED",
    !qrel.answerable
      && runtime.usedSourceIds.length > 0
      ? "NO_ANSWER_FABRICATED_SOURCE"
      : null,
    runtime.testCase.queryType === "FAILURE"
      && !/(不可用|没有读到|不能猜测)/u.test(
        runtime.responseMessage,
      )
      ? "PROVIDER_FAILURE_NOT_DISCLOSED"
      : null,
    runtime.testCase.disputedMemoryIds.length > 0
      && !runtime.disputedMemoryRowRetained
      ? "DISPUTED_MEMORY_NOT_RETAINED"
      : null,
  ].filter(
    (failure): failure is string =>
      failure !== null,
  );
  return {
    caseId: runtime.testCase.caseId as
      RagAgentHarnessCaseResult["caseId"],
    passed: failures.length === 0,
    durationMs: runtime.durationMs,
    coursePackId:
      runtime.testCase.coursePackId,
    modality: runtime.testCase.modality,
    queryType: runtime.testCase.queryType,
    caseFamily: runtime.testCase.caseFamily,
    rawQuestion: runtime.testCase.rawQuestion,
    selfContainedQuestion:
      runtime.testCase.selfContainedQuestion,
    ambiguityStatus:
      runtime.testCase.ambiguityStatus,
    sourceTurnIds:
      runtime.testCase.resolvedReferences.map(
        ({ sourceTurnId }) => sourceTurnId,
      ),
    planner: {
      callCount: 0,
      modelId: "not-wired-runtime",
      latencyMs: 0,
    },
    answer: {
      callCount: runtime.model.callCount,
      modelId: runtime.model.modelId,
      latencyMs: runtime.model.latencyMs,
    },
    degradationReason:
      runtime.testCase.evidence.capabilitiesLost
        .join(",") || null,
    returnedSourceIds:
      runtime.returnedSourceIds,
    injectedSourceIds:
      runtime.injectedSourceIds,
    usedSourceIds: runtime.usedSourceIds,
    persistedSourceIds:
      runtime.persistedSourceIds,
    assetIds: runtime.assetIds,
    regions: runtime.regions,
    parentNodeIds: runtime.parentNodeIds,
    toolCallIds: runtime.toolCallIds,
    persistenceTraceIds:
      runtime.persistenceTraceIds,
    requiredGroupResults,
    failures,
    observed: {
      queryIssued:
        runtime.model.queryIssued,
      observedQueries: runtime.observedQueries,
      observedCoursePacks:
        runtime.observedCoursePacks,
      forbiddenContextMatches:
        runtime.model.forbiddenContextMatches,
      requiredContextMatchCount:
        runtime.model.requiredContextMatches.length,
      evidenceToolUsed:
        runtime.evidenceToolUsed,
      legacyToolUsed: runtime.legacyToolUsed,
      disputedMemoryRowRetained:
        runtime.disputedMemoryRowRetained,
      qrelAnswerable: qrel.answerable,
    },
  };
}

function assertResumeResultMatchesCase(
  result: RagAgentHarnessCaseResult,
  testCase: RagHarnessCaseV1,
  qrel: RagHarnessQrelV1,
) {
  const expected = {
    caseId: testCase.caseId,
    coursePackId: testCase.coursePackId,
    modality: testCase.modality,
    queryType: testCase.queryType,
    caseFamily: testCase.caseFamily,
    rawQuestion: testCase.rawQuestion,
    selfContainedQuestion:
      testCase.selfContainedQuestion,
    ambiguityStatus:
      testCase.ambiguityStatus,
    sourceTurnIds:
      testCase.resolvedReferences.map(
        ({ sourceTurnId }) => sourceTurnId,
      ),
  };
  const actual = {
    caseId: result.caseId,
    coursePackId: result.coursePackId,
    modality: result.modality,
    queryType: result.queryType,
    caseFamily: result.caseFamily,
    rawQuestion: result.rawQuestion,
    selfContainedQuestion:
      result.selfContainedQuestion,
    ambiguityStatus: result.ambiguityStatus,
    sourceTurnIds: result.sourceTurnIds,
  };
  if (
    sha256StableJsonV2(actual)
      !== sha256StableJsonV2(expected)
  ) {
    throw new Error(
      `RAG_HARNESS_RESUME_SUITE_DRIFT:${testCase.caseId}`,
    );
  }
  const qrelBinding = {
    answerable:
      result.observed.qrelAnswerable,
    requiredGroups:
      result.requiredGroupResults.map(
        ({ groupId, expectedSourceIds }) => ({
          groupId,
          sourceIds: expectedSourceIds,
        }),
      ),
  };
  if (
    sha256StableJsonV2(qrelBinding)
      !== sha256StableJsonV2({
        answerable: qrel.answerable,
        requiredGroups: qrel.requiredGroups,
      })
  ) {
    throw new Error(
      `RAG_HARNESS_RESUME_QREL_DRIFT:${testCase.caseId}`,
    );
  }
}

export async function runDeterministicRagAgentHarness(
  input: {
    databasePath: string;
    suitePath: string;
    qrelsPath: string;
    onCaseCompleted?: (
      result: RagAgentHarnessCaseResult,
    ) => void | Promise<void>;
    completedResults?: readonly RagAgentHarnessCaseResult[];
    mode?: "deterministic" | "real-model";
    modelProvider?: ModelProviderAdapter;
  },
) {
  const mode = input.mode ?? "deterministic";
  if (
    mode === "real-model"
    && !input.modelProvider?.respond
  ) {
    throw new Error(
      "RAG_HARNESS_REAL_MODEL_PROVIDER_REQUIRED",
    );
  }
  const suite = await loadRagHarnessSuiteV1(
    input.suitePath,
  );
  const completedResults = (
    input.completedResults ?? []
  ).map((result) =>
    RagAgentHarnessCaseResultSchema.parse(result));
  const completedById = new Map<
    string,
    RagAgentHarnessCaseResult
  >(
    completedResults.map((result) => [
      result.caseId,
      result,
    ]),
  );
  if (
    completedById.size
      !== completedResults.length
  ) {
    throw new Error(
      "RAG_HARNESS_RESUME_DUPLICATE_CASE",
    );
  }
  for (const caseId of completedById.keys()) {
    if (
      !suite.cases.some(
        (testCase) =>
          testCase.caseId === caseId,
      )
    ) {
      throw new Error(
        `RAG_HARNESS_RESUME_CASE_UNKNOWN:${caseId}`,
      );
    }
  }
  const previousV3 = process.env.AGENT_V3_ENABLED;
  Object.assign(process.env, {
    AGENT_V3_ENABLED: "true",
  });
  runMigrations(input.databasePath);
  const connection = createDb(input.databasePath);
  try {
    connection.sqlite.prepare(`
      INSERT INTO classes(id,name,access_code)
      VALUES(
        'rag-harness-class',
        'RAG Agent Harness',
        'RAG-HARNESS'
      )
    `).run();
    const results: RagAgentHarnessCaseResult[] = [];
    for (
      const [
        caseIndex,
        testCase,
      ] of suite.cases.entries()
    ) {
      const completed =
        completedById.get(testCase.caseId);
      if (completed) {
        const qrels =
          await loadRagHarnessQrelsV1(
            input.qrelsPath,
          );
        const qrel = qrels.cases.find(
          ({ caseId }) =>
            caseId === testCase.caseId,
        );
        if (!qrel) {
          throw new Error(
            `RAG_HARNESS_QREL_MISSING:${testCase.caseId}`,
          );
        }
        assertResumeResultMatchesCase(
          completed,
          testCase,
          qrel,
        );
        results.push(completed);
        continue;
      }
      const runtime = await runRuntimeCase({
        connection,
        testCase,
        caseIndex,
        mode,
        ...(input.modelProvider
          ? {
              modelProvider:
                input.modelProvider,
            }
          : {}),
      });
      // Qrels are opened only after this case has completed
      // the Agent/model/tool/persistence path. They are never
      // passed to the model adapter or evidence provider.
      const qrels = await loadRagHarnessQrelsV1(
        input.qrelsPath,
      );
      if (
        qrels.suiteVersion !== suite.suiteVersion
      ) {
        throw new Error(
          "RAG_HARNESS_SUITE_QRELS_VERSION_DRIFT",
        );
      }
      const qrel = qrels.cases.find(
        ({ caseId }) =>
          caseId === testCase.caseId,
      );
      if (!qrel) {
        throw new Error(
          `RAG_HARNESS_QREL_MISSING:${testCase.caseId}`,
        );
      }
      const result = scoreRuntimeCase(
        runtime,
        qrel,
        mode,
      );
      results.push(result);
      await input.onCaseCompleted?.(result);
    }
    const qrels = await loadRagHarnessQrelsV1(
      input.qrelsPath,
    );
    return {
      results,
      suite,
      suiteHash: sha256StableJsonV2({
        suite,
        qrels,
      }),
      corpusBundleHash:
        fixtureHash("rag-harness-corpus-v1"),
      activeIndexBundleHash:
        fixtureHash("rag-harness-index-v1"),
    };
  } finally {
    connection.sqlite.close();
    if (previousV3 === undefined) {
      delete process.env.AGENT_V3_ENABLED;
    } else {
      Object.assign(process.env, {
        AGENT_V3_ENABLED: previousV3,
      });
    }
  }
}

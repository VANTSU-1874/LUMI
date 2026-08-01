import {
  AgentExecutionStepSchema,
  AgentPolicyTraceSchema,
  AgentReplySchema,
} from "@/lib/agent/contracts";
import { getCoursePack } from "@/lib/course-packs/registry";
import {
  AgentDecisionTimelineItemSchema,
  AgentDecisionToolCallSchema,
} from "@/lib/domain/teacher";

type DataType = "REAL" | "DEMONSTRATION_DATA";
type AiMode = "MODEL_ASSISTED" | "DETERMINISTIC_FALLBACK";
type Episode = "EXPLORE" | "UNDERSTAND" | "BUILD" | "DEBUG" | "TRANSFER" | "REFLECT";
type Strategy = "DIRECT_INSTRUCTION" | "CONCEPT_EXPLANATION" | "DIAGNOSTIC_GUIDANCE" | "TRANSFER_COACHING" | "REFLECTION_PROMPT" | "CLARIFY" | "OUT_OF_SCOPE";

export type TeacherAgentTurnRow = {
  turnId: string;
  conversationId: string;
  coursePackId: string;
  coursePackVersion: string;
  studentMessage: string;
  episode: Episode;
  decisionCode: string;
  responseStrategy: Strategy;
  responseLatencyMs: number;
  aiMode: AiMode;
  policyTraceJson: string;
  sourceIdsJson: string;
  replyJson: string;
  createdAt: number;
  dataType: DataType;
  reviewId: string | null;
  reviewTeacherId: string | null;
  reviewDecision: "CONFIRMED" | "CORRECTED" | "NEEDS_REVIEW" | null;
  reviewNotes: string | null;
  reviewCreatedAt: number | null;
  reviewDataType: DataType | null;
};

export type TeacherAgentStepRow = {
  turnId: string;
  id: string;
  sequence: number;
  kind: "MODEL_DECISION" | "TOOL_CALL" | "TOOL_OBSERVATION" | "FINAL_RESPONSE" | "DEGRADED";
  status: "SUCCEEDED" | "FAILED" | "EMPTY" | "SKIPPED";
  label: string;
  summary: string;
  toolCallId: string | null;
  toolId: string | null;
  latencyMs: number;
};

export type TeacherAgentToolCallRow = {
  turnId: string;
  id: string;
  sequence: number;
  toolId: string;
  toolVersion: string;
  adapterId: string;
  inputJson: string;
  status: "SUCCESS" | "EMPTY" | "ERROR";
  errorCode: string | null;
  latencyMs: number;
  createdAt: number;
  dataType: DataType;
};

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function iso(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toISOString();
}

function groupByTurn<Row extends { turnId: string }>(rows: Row[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) grouped.set(row.turnId, [...(grouped.get(row.turnId) ?? []), row]);
  return grouped;
}

function safeCoursePackLabel(id: string, version: string) {
  try {
    return getCoursePack(id, version).label;
  } catch {
    return `${id}@${version}`;
  }
}

export function mapTeacherAgentTimeline(
  turnRows: TeacherAgentTurnRow[],
  stepRows: TeacherAgentStepRow[],
  toolRows: TeacherAgentToolCallRow[],
) {
  const stepsByTurn = groupByTurn(stepRows);
  const toolsByTurn = groupByTurn(toolRows);
  return turnRows.map((row) => {
    const rawReply = parseJson(row.replyJson);
    const parsedReply = AgentReplySchema.safeParse(rawReply);
    const fallbackReply = rawReply && typeof rawReply === "object" ? rawReply as Record<string, unknown> : {};
    const executionSteps = (stepsByTurn.get(row.turnId) ?? []).map((step) => AgentExecutionStepSchema.parse({
      id: step.id,
      sequence: step.sequence,
      kind: step.kind,
      status: step.status,
      label: step.label,
      summary: step.summary,
      toolCallId: step.toolCallId,
      toolId: step.toolId,
      latencyMs: step.latencyMs,
    }));
    const toolCalls = (toolsByTurn.get(row.turnId) ?? []).map((tool) => AgentDecisionToolCallSchema.parse({
      id: tool.id,
      sequence: tool.sequence,
      toolId: tool.toolId,
      toolVersion: tool.toolVersion,
      adapterId: tool.adapterId,
      input: parseJson(tool.inputJson),
      status: tool.status,
      errorCode: tool.errorCode,
      latencyMs: tool.latencyMs,
      createdAt: iso(tool.createdAt),
      dataType: tool.dataType,
    }));
    return AgentDecisionTimelineItemSchema.parse({
      turnId: row.turnId,
      conversationId: row.conversationId,
      coursePackId: row.coursePackId,
      coursePackVersion: row.coursePackVersion,
      coursePackLabel: safeCoursePackLabel(row.coursePackId, row.coursePackVersion),
      studentMessage: row.studentMessage,
      episode: row.episode,
      decisionCode: row.decisionCode,
      responseStrategy: row.responseStrategy,
      responseLatencyMs: row.responseLatencyMs,
      aiMode: row.aiMode,
      policy: AgentPolicyTraceSchema.parse(parseJson(row.policyTraceJson)),
      executionSteps,
      toolCalls,
      sourceIds: parseJson(row.sourceIdsJson),
      reply: parsedReply.success ? {
        title: parsedReply.data.title,
        message: parsedReply.data.message,
        whyThisStep: parsedReply.data.whyThisStep,
        uncertainty: parsedReply.data.uncertainty,
        sources: parsedReply.data.sources,
        actions: parsedReply.data.actions.map(({ id, label, description, status }) => ({ id, label, description, status })),
      } : {
        title: typeof fallbackReply.title === "string" ? fallbackReply.title : "未命名判断",
        message: typeof fallbackReply.message === "string" ? fallbackReply.message : "",
        whyThisStep: "历史记录未保存建议依据。",
        uncertainty: typeof fallbackReply.uncertainty === "string" ? fallbackReply.uncertainty : "未记录不确定性",
        sources: [],
        actions: [],
      },
      createdAt: iso(row.createdAt),
      dataType: row.dataType,
      review: row.reviewId && row.reviewTeacherId && row.reviewDecision && row.reviewNotes !== null && row.reviewCreatedAt !== null && row.reviewDataType
        ? { id: row.reviewId, turnId: row.turnId, teacherId: row.reviewTeacherId, decision: row.reviewDecision, notes: row.reviewNotes, createdAt: iso(row.reviewCreatedAt), dataType: row.reviewDataType }
        : null,
    });
  });
}

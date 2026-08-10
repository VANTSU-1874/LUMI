import { getCoursePack } from "@/lib/course-packs/registry";
import type { DatabaseConnection } from "@/lib/db/client";

import { AgentTurnResponseSchema, type AgentTurnResponse } from "./contracts";
import { readAgentArtworkAttachment } from "./artwork-attachment-store";
import { readAgentCritique } from "./critique-store";
import { readAgentExecutionSteps } from "./agent-execution-step-store";
import { AgentConflictError } from "./orchestrator-errors";
import { getAgentPolicy } from "./policy-registry";
import { readAgentRuntimeEvents } from "./runtime/agent-runtime-event-store";

export type StoredTurnRow = {
  taskId: string;
  conversationId: string;
  turnId: string;
  coursePackId: string;
  coursePackVersion: string;
  episode: AgentTurnResponse["episode"];
  decisionCode: string;
  aiMode: AgentTurnResponse["aiMode"];
  policyId: string;
  policyVersion: string;
  policyTraceJson: string;
  replyJson: string;
  studentMessage: string;
  createdAt: Date | string | number;
};

export function parseStoredTurn(connection: DatabaseConnection, row: StoredTurnRow) {
  const pack = getCoursePack(row.coursePackId, row.coursePackVersion);
  const policy = getAgentPolicy(row.policyId, row.policyVersion);
  const policyTrace = JSON.parse(row.policyTraceJson) as { policyId?: string; policyVersion?: string };
  if (policyTrace.policyId !== policy.id || policyTrace.policyVersion !== policy.version) {
    throw new AgentConflictError("智能体策略记录不一致");
  }
  const date = row.createdAt instanceof Date ? row.createdAt : new Date(
    typeof row.createdAt === "number" && row.createdAt < 10_000_000_000 ? row.createdAt * 1_000 : row.createdAt,
  );
  const reply = JSON.parse(row.replyJson) as Record<string, unknown>;
  const sources = Array.isArray(reply.sources) ? reply.sources as Array<{ authority?: unknown }> : [];
  const restoredBasis = Array.isArray(reply.basis) ? reply.basis : sources.length > 0
    ? [{ kind: "COURSE_KNOWLEDGE", label: "课程知识" }]
    : [{ kind: "GENERAL_DESIGN", label: "通用设计建议" }];
  const specialty = pack.id === "book-design"
    ? { id: "BOOK_DESIGN", label: "书籍设计专业增强", enhanced: true }
    : pack.id === "digital-interaction"
      ? { id: "DIGITAL_INTERACTION", label: "数字交互专业增强", enhanced: true }
      : pack.id === "layout-design"
        ? { id: "LAYOUT_DESIGN", label: "版式设计专业增强", enhanced: true }
        : pack.id === "brand-vi-design"
          ? { id: "BRAND_VI_DESIGN", label: "品牌与 VI 设计专业增强", enhanced: true }
          : { id: "GENERAL_DESIGN", label: "通用设计", enhanced: false };
  const runtimeEvents = readAgentRuntimeEvents(connection, row.turnId);
  return AgentTurnResponseSchema.parse({
    taskId: row.taskId,
    conversationId: row.conversationId,
    turnId: row.turnId,
    studentMessage: row.studentMessage,
    coursePack: { id: pack.id, version: pack.version, label: pack.label },
    specialty,
    episode: row.episode,
    decisionCode: row.decisionCode,
    aiMode: row.aiMode,
    policy: policyTrace,
    executionSteps: readAgentExecutionSteps(connection, row.turnId),
    runtime: runtimeEvents[0]?.runtime,
    runtimeEvents,
    createdAt: date.toISOString(),
    reply: { ...reply, basis: restoredBasis },
    critique: readAgentCritique(connection, row.turnId),
    artworkAttachment: readAgentArtworkAttachment(connection, row.turnId),
  });
}

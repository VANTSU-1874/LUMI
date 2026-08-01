import { randomUUID } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import { getCoursePack } from "@/lib/course-packs/registry";
import type { DatabaseConnection } from "@/lib/db/client";

import {
  AgentActionExecutionSchema,
  AgentConversationResponseSchema,
  AgentTurnResponseSchema,
  type AgentActionExecution,
  type AgentConversationResponse,
  type AgentResponseStrategy,
  type AgentTurnRequest,
  type AgentTurnResponse,
  type AgentView,
} from "./contracts";
import { readStudentContext, type StudentContext } from "./orchestrator-context";
import { applyAgentSessionSummaryWriteback } from "./conversation-summary";
import { touchDesignTaskAfterTurn } from "./design-project-task";
import { AgentConflictError, AgentForbiddenError, AgentNotFoundError } from "./orchestrator-errors";
import { getAgentPolicy } from "./policy-registry";
import { mergeProjectBrief, readProjectBrief, type ProjectBriefPatch } from "./project-brief-memory";
import type { AgentToolExecution } from "./tool-contract";
import type { StoredAgentArtwork } from "./artwork-attachment";
import { insertAgentArtworkAttachment, readAgentArtworkAttachment } from "./artwork-attachment-store";
import { parseStoredTurn, type StoredTurnRow } from "./agent-stored-turn";
import { insertAgentCritique } from "./critique-store";
import { persistAssistantAgentMessage } from "./agent-message-store";
import { applyStudentMemoryWriteback } from "./student-memory";
import type { StudentMemoryWriteCandidate } from "./student-memory-candidates";

function epochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

export type AgentContextWriteback = {
  recalledMemoryIds: readonly string[];
  memoryCandidates: readonly StudentMemoryWriteCandidate[];
  recentTurnLimit: number;
};

function isolatedSavepoint(
  connection: DatabaseConnection,
  name: "agent_memory_writeback" | "agent_summary_writeback",
  operation: () => void,
) {
  try {
    connection.sqlite.exec(`SAVEPOINT ${name}`);
    try {
      operation();
      connection.sqlite.exec(`RELEASE SAVEPOINT ${name}`);
    } catch {
      connection.sqlite.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      connection.sqlite.exec(`RELEASE SAVEPOINT ${name}`);
    }
  } catch {
    // Context writeback is best-effort and must never reject an otherwise valid tutor turn.
  }
}

function applyAgentContextWriteback(input: {
  connection: DatabaseConnection;
  context: StudentContext;
  turnId: string;
  now: Date;
  writeback: AgentContextWriteback;
}) {
  isolatedSavepoint(input.connection, "agent_memory_writeback", () => {
    applyStudentMemoryWriteback({
      connection: input.connection,
      studentId: input.context.studentId,
      classId: input.context.classId,
      sourceTurnId: input.turnId,
      recalledMemoryIds: input.writeback.recalledMemoryIds,
      candidates: input.writeback.memoryCandidates,
      now: input.now,
    });
  });
  isolatedSavepoint(input.connection, "agent_summary_writeback", () => {
    applyAgentSessionSummaryWriteback({
      connection: input.connection,
      taskId: input.context.taskId,
      studentId: input.context.studentId,
      classId: input.context.classId,
      now: input.now,
      recentTurnLimit: input.writeback.recentTurnLimit,
    });
  });
}

function persistOptionalCritique(input: {
  connection: DatabaseConnection;
  context: StudentContext;
  turnId: string;
  critique: AgentTurnResponse["critique"];
  historyComparison?: string;
  historyRecordId?: string;
  now: Date;
}) {
  if (!input.critique) return undefined;
  try {
    input.connection.sqlite.exec("SAVEPOINT agent_critique_write");
    try {
      const stored = insertAgentCritique({
        connection: input.connection,
        context: input.context,
        turnId: input.turnId,
        critique: input.critique,
        historyComparison: input.historyComparison,
        historyRecordId: input.historyRecordId,
        createdAt: input.now,
      });
      input.connection.sqlite.exec("RELEASE SAVEPOINT agent_critique_write");
      return stored;
    } catch {
      input.connection.sqlite.exec("ROLLBACK TO SAVEPOINT agent_critique_write");
      input.connection.sqlite.exec("RELEASE SAVEPOINT agent_critique_write");
      return undefined;
    }
  } catch {
    // A structured critique is optional and must never reject a valid natural tutor turn.
    return undefined;
  }
}

export function persistAgentTurn(
  connection: DatabaseConnection,
  context: StudentContext,
  pack: ReturnType<typeof getCoursePack>,
  input: AgentTurnRequest,
  response: Omit<AgentTurnResponse, "conversationId" | "turnId" | "createdAt" | "coursePack" | "studentMessage"> & {
    responseStrategy: AgentResponseStrategy;
    responseLatencyMs: number;
    toolExecutions: readonly AgentToolExecution[];
    briefPatch: ProjectBriefPatch;
    artwork?: StoredAgentArtwork;
    critiqueHistoryComparison?: string;
    critiqueHistoryRecordId?: string;
    contextWriteback?: AgentContextWriteback;
  },
  now: Date,
  runId?: string,
) {
  const conversation = connection.sqlite.prepare(`
    SELECT id FROM agent_conversations
    WHERE task_id=? AND student_id=? AND class_id=? AND course_pack_id=? AND course_pack_version=?
      AND coalesce(project_id, '')=coalesce(?, '')
    ORDER BY updated_at DESC LIMIT 1
  `).get(context.taskId, context.studentId, context.classId, pack.id, pack.version, context.project?.id ?? null) as { id: string } | undefined;
  const conversationId = conversation?.id ?? randomUUID();
  const turnId = randomUUID();
  const createdAt = now;
  let projectBrief = context.projectBrief;
  let storedCritique: AgentTurnResponse["critique"];
  connection.sqlite.transaction(() => {
    if (runId) {
      const durableRun = connection.sqlite.prepare(`
        SELECT task_id taskId, student_id studentId, class_id classId, status,
          cancel_requested_at cancelRequestedAt
        FROM agent_runs WHERE id=?
      `).get(runId) as {
        taskId: string;
        studentId: string;
        classId: string;
        status: string;
        cancelRequestedAt: number | null;
      } | undefined;
      if (
        !durableRun
        || durableRun.taskId !== context.taskId
        || durableRun.studentId !== context.studentId
        || durableRun.classId !== context.classId
        || durableRun.status !== "RUNNING"
        || durableRun.cancelRequestedAt !== null
      ) {
        throw new AgentConflictError("持久运行与当前学生任务不一致");
      }
    }
    if (!conversation) {
      connection.sqlite.prepare(`
        INSERT INTO agent_conversations(id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)
      `).run(conversationId, context.taskId, context.studentId, context.classId, context.project?.id ?? null, pack.id, pack.version, epochSeconds(createdAt), epochSeconds(createdAt));
    } else {
      connection.sqlite.prepare("UPDATE agent_conversations SET updated_at=? WHERE id=?").run(epochSeconds(createdAt), conversationId);
    }
    connection.sqlite.prepare(`
      UPDATE agent_actions SET status='EXPIRED'
      WHERE status='PROPOSED' AND turn_id IN (SELECT id FROM agent_turns WHERE conversation_id=?)
    `).run(conversationId);
    const sequence = (connection.sqlite.prepare(
      "SELECT coalesce(max(turn_sequence),0)+1 sequence FROM agent_turns WHERE conversation_id=?",
    ).get(conversationId) as { sequence: number }).sequence;
    connection.sqlite.prepare(`
      INSERT INTO agent_turns(id,run_id,conversation_id,turn_sequence,student_message,episode,decision_code,policy_id,policy_version,policy_trace_json,response_strategy,response_latency_ms,reply_json,ai_mode,source_ids_json,created_at,data_type)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(turnId, runId ?? null, conversationId, sequence, input.message, response.episode, response.decisionCode,
      response.policy.policyId, response.policy.policyVersion, JSON.stringify(response.policy),
      response.responseStrategy, response.responseLatencyMs, JSON.stringify(response.reply), response.aiMode,
      JSON.stringify(response.reply.sources.map(({ id }) => id)), epochSeconds(createdAt), context.dataType);
    insertAgentArtworkAttachment({
      connection,
      owner: context,
      turnId,
      artwork: response.artwork,
      createdAt: epochSeconds(createdAt),
    });
    storedCritique = persistOptionalCritique({
      connection,
      context,
      turnId,
      critique: response.critique,
      historyComparison: response.critiqueHistoryComparison,
      historyRecordId: response.critiqueHistoryRecordId,
      now: createdAt,
    });
    if (response.contextWriteback) {
      applyAgentContextWriteback({
        connection,
        context,
        turnId,
        now: createdAt,
        writeback: response.contextWriteback,
      });
    }
    const insertToolCall = connection.sqlite.prepare(`
      INSERT INTO agent_tool_calls(
        id,turn_id,call_sequence,tool_id,tool_version,adapter_id,input_json,output_json,
        status,error_code,latency_ms,created_at,data_type
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    response.toolExecutions.forEach((execution, index) => {
      insertToolCall.run(
        execution.observation.callId, turnId, index + 1, execution.observation.toolId,
        execution.observation.toolVersion, execution.observation.adapterId,
        JSON.stringify(execution.call.arguments),
        execution.output === null ? null : JSON.stringify(execution.output),
        execution.observation.status, execution.observation.errorCode,
        execution.observation.latencyMs, epochSeconds(createdAt), context.dataType,
      );
    });
    persistAssistantAgentMessage({
      connection,
      context,
      request: input,
      response,
      turnId,
      createdAt,
    });
    const insertStep = connection.sqlite.prepare(`
      INSERT INTO agent_steps(
        id,turn_id,step_sequence,kind,status,label,summary,tool_call_id,tool_id,
        latency_ms,created_at,data_type
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    response.executionSteps.forEach((step) => {
      insertStep.run(
        step.id, turnId, step.sequence, step.kind, step.status, step.label, step.summary,
        step.toolCallId, step.toolId, step.latencyMs, epochSeconds(createdAt), context.dataType,
      );
    });
    const insertRuntimeEvent = connection.sqlite.prepare(`
      INSERT INTO agent_runtime_events(
        id,turn_id,event_sequence,runtime_id,runtime_version,kind,status,label,summary,
        tool_call_id,tool_id,source_ids_json,policy_rule,error_code,model_provider,model_id,
        usage_status,input_tokens,output_tokens,total_tokens,latency_ms,created_at,data_type
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    response.runtimeEvents.forEach((event) => {
      insertRuntimeEvent.run(
        event.id, turnId, event.sequence, event.runtime.id, event.runtime.version,
        event.kind, event.status, event.label, event.summary, event.toolCallId, event.toolId,
        JSON.stringify(event.sourceIds), event.policyRule, event.errorCode,
        event.modelProvider, event.modelId, event.usage.status, event.usage.inputTokens,
        event.usage.outputTokens, event.usage.totalTokens, event.latencyMs,
        epochSeconds(createdAt), context.dataType,
      );
    });
    const insertAction = connection.sqlite.prepare(`
      INSERT INTO agent_actions(id,turn_id,action_sequence,type,label,adapter_id,target,focus,payload_json,status,effect,approval_mode,created_at,data_type)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    response.reply.actions.forEach((action, index) => {
      const adapterId = action.target === "BOOK_LAYOUT_LAB" ? "book-layout-lab"
        : action.target === "NODE_CANVAS" ? "node-canvas"
          : action.target === "KNOWLEDGE_MAP" ? "knowledge-map"
            : "project-evidence";
      insertAction.run(action.id, turnId, index + 1, action.type, action.label, adapterId, action.target, action.focus,
        JSON.stringify({ description: action.description }), action.status, "NAVIGATE", "REQUIRES_CONFIRMATION",
        epochSeconds(createdAt), context.dataType);
    });
    projectBrief = mergeProjectBrief({
      connection,
      taskId: context.taskId,
      studentId: context.studentId,
      classId: context.classId,
      dataType: context.dataType,
      patch: response.briefPatch,
      sourceTurnId: turnId,
      now: createdAt,
    });
    touchDesignTaskAfterTurn(connection, context.taskId, input.message, createdAt);
  }).immediate();
  return {
    taskId: context.taskId,
    conversationId,
    turnId,
    createdAt,
    projectBrief,
    critique: storedCritique,
    artworkAttachment: response.artwork ? readAgentArtworkAttachment(connection, turnId) : undefined,
  };
}

export function readAgentConversation(
  connection: DatabaseConnection,
  actor: SessionPayload,
  view: AgentView,
  taskId?: string,
): AgentConversationResponse {
  void view;
  const context = readStudentContext(connection, actor, "general-design", "", taskId);
  const rows = connection.sqlite.prepare(`
    SELECT c.task_id taskId, c.id conversationId, t.id turnId, c.course_pack_id coursePackId,
      c.course_pack_version coursePackVersion, t.episode, t.decision_code decisionCode,
      t.ai_mode aiMode, t.policy_id policyId, t.policy_version policyVersion,
      t.policy_trace_json policyTraceJson, t.reply_json replyJson, t.student_message studentMessage, t.created_at createdAt
    FROM agent_turns t JOIN agent_conversations c ON c.id=t.conversation_id
    WHERE c.student_id=? AND c.class_id=? AND c.task_id=?
    ORDER BY t.created_at DESC, t.rowid DESC LIMIT 30
  `).all(context.studentId, context.classId, context.taskId) as StoredTurnRow[];
  const latest = rows[0];
  const pack = latest
    ? getCoursePack(latest.coursePackId, latest.coursePackVersion)
    : getCoursePack("general-design", "1");
  const projectBrief = readProjectBrief(connection, context.studentId, context.classId, context.taskId);
  if (!latest) return AgentConversationResponseSchema.parse({
    taskId: context.taskId,
    conversationId: null,
    coursePack: { id: pack.id, version: pack.version, label: pack.label },
    turns: [],
    projectBrief,
  });
  return AgentConversationResponseSchema.parse({
    taskId: context.taskId,
    conversationId: latest.conversationId,
    coursePack: { id: pack.id, version: pack.version, label: pack.label },
    projectBrief,
    turns: rows.reverse().map((row) => {
      const turn = parseStoredTurn(connection, row);
      const actionStates = connection.sqlite.prepare(
        "SELECT id, status FROM agent_actions WHERE turn_id=? ORDER BY action_sequence",
      ).all(row.turnId) as Array<{ id: string; status: "PROPOSED" | "EXECUTED" | "REJECTED" | "EXPIRED" }>;
      const byId = new Map(actionStates.map((action) => [action.id, action.status]));
      return AgentTurnResponseSchema.parse({
        ...turn,
        projectBrief,
        reply: {
          ...turn.reply,
          actions: turn.reply.actions.map((action) => ({ ...action, status: byId.get(action.id) ?? action.status })),
        },
      });
    }),
  });
}

export function executeAgentAction(
  connection: DatabaseConnection,
  actor: SessionPayload,
  input: { turnId: string; actionId: string; idempotencyKey: string },
  options: { now?: () => Date } = {},
): AgentActionExecution {
  if (actor.role !== "STUDENT") throw new AgentForbiddenError("仅学生可以执行学习行动");
  const row = connection.sqlite.prepare(`
    SELECT a.id, a.status, a.idempotency_key idempotencyKey, a.target, a.focus, a.created_at createdAt,
      c.student_id studentId, t.policy_id policyId, t.policy_version policyVersion, t.run_id runId
    FROM agent_actions a
    JOIN agent_turns t ON t.id=a.turn_id
    JOIN agent_conversations c ON c.id=t.conversation_id
    WHERE a.id=? AND a.turn_id=?
  `).get(input.actionId, input.turnId) as {
    id: string; status: "PROPOSED" | "EXECUTED" | "REJECTED" | "EXPIRED"; idempotencyKey: string | null;
    target: string; focus: string | null; createdAt: Date | string | number; studentId: string;
    policyId: string; policyVersion: string; runId: string | null;
  } | undefined;
  if (!row) throw new AgentNotFoundError("行动卡不存在");
  if (row.studentId !== actor.userId) throw new AgentForbiddenError("不能执行其他学生的行动卡");
  if (row.runId !== null) throw new AgentConflictError("请通过当前运行的确认入口处理这张行动卡");
  if (row.status === "EXECUTED") {
    if (row.idempotencyKey !== input.idempotencyKey) throw new AgentConflictError("行动卡已经使用，请刷新会话");
    return AgentActionExecutionSchema.parse({
      actionId: row.id,
      status: "EXECUTED",
      alreadyExecuted: true,
      navigation: { target: row.target, focus: row.focus },
    });
  }
  const createdAtMillis = row.createdAt instanceof Date ? row.createdAt.getTime()
    : typeof row.createdAt === "number" && row.createdAt < 10_000_000_000 ? row.createdAt * 1_000
      : new Date(row.createdAt).getTime();
  const actionPolicy = getAgentPolicy(row.policyId, row.policyVersion);
  if (row.status === "EXPIRED" || (options.now?.() ?? new Date()).getTime() - createdAtMillis > actionPolicy.budgets.actionTtlMs) {
    connection.sqlite.prepare("UPDATE agent_actions SET status='EXPIRED' WHERE id=? AND status='PROPOSED'").run(row.id);
    throw new AgentConflictError("行动卡已过期，请刷新会话后重新确认");
  }
  const now = options.now?.() ?? new Date();
  const result = connection.sqlite.prepare(`
    UPDATE agent_actions SET status='EXECUTED', idempotency_key=?, executed_at=?
    WHERE id=? AND status='PROPOSED' AND idempotency_key IS NULL
  `).run(input.idempotencyKey, epochSeconds(now), row.id);
  if (result.changes !== 1) throw new AgentConflictError("行动状态已变化，请刷新会话");
  return AgentActionExecutionSchema.parse({
    actionId: row.id,
    status: "EXECUTED",
    alreadyExecuted: false,
    navigation: { target: row.target, focus: row.focus },
  });
}

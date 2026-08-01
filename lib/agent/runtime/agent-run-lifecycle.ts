import { z } from "zod";

import type { DatabaseConnection } from "@/lib/db/client";

import { parseStoredTurn, type StoredTurnRow } from "../agent-stored-turn";
import { AgentTurnRequestSchema, AgentTurnResponseSchema, type AgentTurnRequest, type AgentTurnResponse } from "../contracts";
import { readProjectBrief } from "../project-brief-memory";
import {
  appendAgentRunEvent,
  AgentRunConflictError,
  AgentRunNotFoundError,
  epochSeconds,
  publicAgentRun,
  readAgentRunRow,
} from "./agent-run-record";
import { AgentRunCheckpointSchema, type AgentRun, type AgentRunCheckpoint } from "./agent-run-event";
import type { AgentRuntimeDescriptor } from "./trace-sink";

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
export const MAX_AGENT_RUN_ATTEMPTS = 3;

export type ClaimedAgentRun = {
  kind: "CLAIMED";
  runId: string;
  workerId: string;
  actor: { userId: string; role: "STUDENT" };
  request: AgentTurnRequest;
  runtime: AgentRuntimeDescriptor;
  attempt: number;
};

function assertTurnBelongsToRun(connection: DatabaseConnection, runId: string, turnId: string) {
  const row = connection.sqlite.prepare(
    "SELECT id FROM agent_turns WHERE id=? AND run_id=?",
  ).get(turnId, runId) as { id: string } | undefined;
  if (!row) throw new AgentRunConflictError("运行与已保存回合不一致");
}

export function claimAgentRun(input: {
  connection: DatabaseConnection;
  runId: string;
  workerId: string;
  now?: Date;
  leaseMs?: number;
}): ClaimedAgentRun | { kind: "BUSY" | "TERMINAL"; run: AgentRun } {
  const runId = z.string().uuid().parse(input.runId);
  const workerId = z.string().min(1).max(128).parse(input.workerId);
  const now = input.now ?? new Date();
  const nowSeconds = epochSeconds(now);
  const leaseSeconds = Math.ceil(z.number().int().min(5_000).max(300_000).parse(input.leaseMs ?? 60_000) / 1_000);
  let result: ClaimedAgentRun | { kind: "BUSY" | "TERMINAL"; run: AgentRun } | undefined;

  input.connection.sqlite.transaction(() => {
    const row = readAgentRunRow(input.connection, runId);
    if (!row) throw new AgentRunNotFoundError();
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(row.status)) {
      result = { kind: "TERMINAL", run: publicAgentRun(row) };
      return;
    }
    const leaseExpiresAt = row.leaseExpiresAt instanceof Date
      ? epochSeconds(row.leaseExpiresAt)
      : row.leaseExpiresAt ?? 0;
    if ((row.status === "RUNNING" && leaseExpiresAt > nowSeconds) || row.status === "WAITING_APPROVAL") {
      result = { kind: "BUSY", run: publicAgentRun(row) };
      return;
    }
    const previousStatus = row.status;
    const persisted = row.status === "RUNNING"
      ? input.connection.sqlite.prepare("SELECT id FROM agent_turns WHERE run_id=?").get(row.id) as { id: string } | undefined
      : undefined;
    if (row.status === "RUNNING" && row.cancelRequestedAt !== null && !persisted) {
      const checkpoint: AgentRunCheckpoint = { stage: "CANCELLED" };
      const cancelled = input.connection.sqlite.prepare(`
        UPDATE agent_runs SET status='CANCELLED', checkpoint_json=?, lease_owner=NULL,
          lease_expires_at=NULL, updated_at=?, completed_at=?
        WHERE id=? AND status='RUNNING' AND attempt=?
      `).run(JSON.stringify(checkpoint), nowSeconds, nowSeconds, row.id, row.attempt);
      if (cancelled.changes !== 1) throw new AgentRunConflictError();
      appendAgentRunEvent(input.connection, row, {
        kind: "CANCELLED", label: "已恢复取消状态",
        summary: "原运行租约已经过期，持久取消意图已在新的安全边界完成。",
        payload: {
          previousStatus: "RUNNING", status: "CANCELLED", attempt: row.attempt,
          cancelRequested: true, checkpoint,
        },
        now,
      });
      const cancelledRow = readAgentRunRow(input.connection, row.id);
      if (!cancelledRow) throw new AgentRunNotFoundError();
      result = { kind: "TERMINAL", run: publicAgentRun(cancelledRow) };
      return;
    }
    const recoveringPersistedTurn = Boolean(persisted);
    if (!recoveringPersistedTurn && row.attempt >= MAX_AGENT_RUN_ATTEMPTS) {
      const checkpoint: AgentRunCheckpoint = { stage: "FAILED" };
      const failed = input.connection.sqlite.prepare(`
        UPDATE agent_runs SET status='FAILED', checkpoint_json=?, last_error_code='AGENT_ATTEMPT_LIMIT',
          lease_owner=NULL, lease_expires_at=NULL, updated_at=?, completed_at=?
        WHERE id=? AND status=? AND attempt=?
      `).run(JSON.stringify(checkpoint), nowSeconds, nowSeconds, row.id, previousStatus, row.attempt);
      if (failed.changes !== 1) throw new AgentRunConflictError();
      appendAgentRunEvent(input.connection, row, {
        kind: "ERROR", label: "已停止重复尝试",
        summary: "本轮已达到安全尝试上限，没有继续重复模型或工具执行。",
        payload: {
          previousStatus, status: "FAILED", attempt: row.attempt,
          errorCode: "AGENT_ATTEMPT_LIMIT", checkpoint,
        },
        now,
      });
      const failedRow = readAgentRunRow(input.connection, row.id);
      if (!failedRow) throw new AgentRunNotFoundError();
      result = { kind: "TERMINAL", run: publicAgentRun(failedRow) };
      return;
    }
    const attempt = recoveringPersistedTurn ? row.attempt : row.attempt + 1;
    const checkpoint = AgentRunCheckpointSchema.parse(recoveringPersistedTurn
      ? { stage: "TURN_PERSISTED", turnId: persisted!.id }
      : { stage: "CLAIMED" });
    const updated = input.connection.sqlite.prepare(`
      UPDATE agent_runs SET status='RUNNING', attempt=?, lease_owner=?, lease_expires_at=?,
        checkpoint_json=?, updated_at=?, started_at=coalesce(started_at, ?), last_error_code=NULL
      WHERE id=? AND status=? AND attempt=?
    `).run(
      attempt, workerId, nowSeconds + leaseSeconds, JSON.stringify(checkpoint),
      nowSeconds, nowSeconds, runId, previousStatus, row.attempt,
    );
    if (updated.changes !== 1) throw new AgentRunConflictError();
    appendAgentRunEvent(input.connection, row, {
      kind: "RUN_CLAIMED",
      label: "开始理解你的任务",
      summary: recoveringPersistedTurn
        ? "检测到已保存回答，正在从安全断点完成原运行。"
        : previousStatus === "RUNNING"
          ? "检测到上次运行租约已过期，已开始新的有限尝试。"
        : "后台运行已开始，后续状态会持续保存。",
      payload: { previousStatus, status: "RUNNING", attempt, runtime: { id: row.runtimeId, version: row.runtimeVersion }, checkpoint },
      now,
    });
    result = {
      kind: "CLAIMED", runId, workerId,
      actor: { userId: row.studentId, role: "STUDENT" },
      request: AgentTurnRequestSchema.parse(JSON.parse(row.requestJson)),
      runtime: { id: row.runtimeId, version: row.runtimeVersion },
      attempt,
    };
  }).immediate();

  if (!result) throw new AgentRunConflictError();
  return result;
}

export function readPersistedTurnForRun(connection: DatabaseConnection, runId: string): AgentTurnResponse | null {
  const row = connection.sqlite.prepare(`
    SELECT c.task_id taskId, c.id conversationId, t.id turnId, c.course_pack_id coursePackId,
      c.course_pack_version coursePackVersion, t.episode, t.decision_code decisionCode,
      t.ai_mode aiMode, t.policy_id policyId, t.policy_version policyVersion,
      t.policy_trace_json policyTraceJson, t.reply_json replyJson,
      t.student_message studentMessage, t.created_at createdAt
    FROM agent_turns t JOIN agent_conversations c ON c.id=t.conversation_id
    WHERE t.run_id=?
  `).get(z.string().uuid().parse(runId)) as StoredTurnRow | undefined;
  if (!row) return null;
  const restored = parseStoredTurn(connection, row);
  const owner = readAgentRunRow(connection, runId);
  if (!owner) throw new AgentRunNotFoundError();
  return AgentTurnResponseSchema.parse({
    ...restored,
    projectBrief: readProjectBrief(connection, owner.studentId, owner.classId, owner.taskId),
  });
}

export function markAgentRunTurnPersisted(input: {
  connection: DatabaseConnection; runId: string; workerId: string; turnId: string; now?: Date;
}) {
  const turnId = z.string().uuid().parse(input.turnId);
  const now = input.now ?? new Date();
  input.connection.sqlite.transaction(() => {
    const row = readAgentRunRow(input.connection, input.runId);
    if (!row) throw new AgentRunNotFoundError();
    if (row.status === "COMPLETED") return;
    if (row.status !== "RUNNING" || row.leaseOwner !== input.workerId) throw new AgentRunConflictError();
    assertTurnBelongsToRun(input.connection, input.runId, turnId);
    const checkpoint: AgentRunCheckpoint = { stage: "TURN_PERSISTED", turnId };
    const updated = input.connection.sqlite.prepare(`
      UPDATE agent_runs SET checkpoint_json=?, updated_at=?
      WHERE id=? AND status='RUNNING' AND lease_owner=?
    `).run(JSON.stringify(checkpoint), epochSeconds(now), input.runId, input.workerId);
    if (updated.changes !== 1) throw new AgentRunConflictError();
    appendAgentRunEvent(input.connection, row, {
      kind: "STATUS_CHANGED", label: "回答已安全保存",
      summary: "本轮回答已经写入项目任务，正在完成运行状态。",
      payload: { status: "RUNNING", attempt: row.attempt, turnId, checkpoint }, now,
    });
  }).immediate();
}

export function completeAgentRun(input: {
  connection: DatabaseConnection; runId: string; workerId: string; result: AgentTurnResponse; now?: Date;
}) {
  const result = AgentTurnResponseSchema.parse(input.result);
  const now = input.now ?? new Date();
  input.connection.sqlite.transaction(() => {
    const row = readAgentRunRow(input.connection, input.runId);
    if (!row) throw new AgentRunNotFoundError();
    if (row.status === "COMPLETED") return;
    if (row.status !== "RUNNING" || row.leaseOwner !== input.workerId) throw new AgentRunConflictError();
    assertTurnBelongsToRun(input.connection, input.runId, result.turnId);
    const checkpoint: AgentRunCheckpoint = { stage: "COMPLETED", turnId: result.turnId };
    const updated = input.connection.sqlite.prepare(`
      UPDATE agent_runs SET status='COMPLETED', response_json=?, checkpoint_json=?,
        lease_owner=NULL, lease_expires_at=NULL, updated_at=?, completed_at=?
      WHERE id=? AND status='RUNNING' AND lease_owner=?
    `).run(JSON.stringify(result), JSON.stringify(checkpoint), epochSeconds(now), epochSeconds(now), input.runId, input.workerId);
    if (updated.changes !== 1) throw new AgentRunConflictError();
    appendAgentRunEvent(input.connection, row, {
      kind: "COMPLETION", label: "本轮回答已完成",
      summary: "回答、项目理解和公开运行记录已保存，可以安全刷新页面。",
      payload: { previousStatus: "RUNNING", status: "COMPLETED", attempt: row.attempt, turnId: result.turnId, checkpoint }, now,
    });
  }).immediate();
  const row = readAgentRunRow(input.connection, input.runId);
  if (!row) throw new AgentRunNotFoundError();
  return publicAgentRun(row);
}

export function failAgentRun(input: {
  connection: DatabaseConnection; runId: string; workerId: string; errorCode: string; now?: Date;
}) {
  const errorCode = SAFE_ERROR_CODE.test(input.errorCode) ? input.errorCode : "AGENT_RUN_FAILED";
  const now = input.now ?? new Date();
  input.connection.sqlite.transaction(() => {
    const row = readAgentRunRow(input.connection, input.runId);
    if (!row) throw new AgentRunNotFoundError();
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(row.status)) return;
    if (row.status !== "RUNNING" || row.leaseOwner !== input.workerId) throw new AgentRunConflictError();
    const checkpoint: AgentRunCheckpoint = { stage: "FAILED" };
    const updated = input.connection.sqlite.prepare(`
      UPDATE agent_runs SET status='FAILED', checkpoint_json=?, last_error_code=?,
        lease_owner=NULL, lease_expires_at=NULL, updated_at=?, completed_at=?
      WHERE id=? AND status='RUNNING' AND lease_owner=?
    `).run(JSON.stringify(checkpoint), errorCode, epochSeconds(now), epochSeconds(now), input.runId, input.workerId);
    if (updated.changes !== 1) throw new AgentRunConflictError();
    appendAgentRunEvent(input.connection, row, {
      kind: "ERROR", label: "本轮运行未完成",
      summary: "运行已安全停止，输入仍保存在任务中；稍后可从持久状态继续处理。",
      payload: { previousStatus: "RUNNING", status: "FAILED", attempt: row.attempt, errorCode, checkpoint }, now,
    });
  }).immediate();
}

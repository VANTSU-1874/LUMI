import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import {
  appendAgentRunEvent,
  AgentRunConflictError,
  AgentRunNotFoundError,
  epochSeconds,
  publicAgentRun,
  readAgentRunRow,
  type AgentRunRow,
} from "./agent-run-record";
import {
  AgentRunCancelResponseSchema,
  AgentRunCheckpointSchema,
  AgentRunRetryResponseSchema,
} from "./agent-run-event";
import { MAX_AGENT_RUN_ATTEMPTS } from "./agent-run-lifecycle";
import { refreshAgentRunResponseActions } from "./agent-run-response";

const ControlKeySchema = z.string().uuid();

function ownedRun(connection: DatabaseConnection, actor: SessionPayload, runId: string) {
  if (actor.role !== "STUDENT") throw new AgentRunNotFoundError();
  const row = readAgentRunRow(connection, z.string().uuid().parse(runId), actor.userId);
  if (!row) throw new AgentRunNotFoundError();
  return row;
}

function existingControl(
  connection: DatabaseConnection,
  runId: string,
  kind: "CANCEL" | "RETRY",
  idempotencyKey: string,
) {
  return connection.sqlite.prepare(`
    SELECT generation FROM agent_run_controls
    WHERE run_id=? AND kind=? AND idempotency_key=?
  `).get(runId, kind, idempotencyKey) as { generation: number } | undefined;
}

function insertControl(
  connection: DatabaseConnection,
  row: AgentRunRow,
  kind: "CANCEL" | "RETRY",
  idempotencyKey: string,
  now: Date,
) {
  const collision = connection.sqlite.prepare(`
    SELECT id FROM agent_run_controls WHERE run_id=? AND kind=? AND generation=?
  `).get(row.id, kind, row.attempt) as { id: string } | undefined;
  if (collision) throw new AgentRunConflictError(
    kind === "CANCEL" ? "本次运行已经记录过取消请求" : "本次失败已经记录过重试请求",
  );
  connection.sqlite.prepare(`
    INSERT INTO agent_run_controls(id,run_id,kind,generation,idempotency_key,created_at,data_type)
    VALUES(?,?,?,?,?,?,?)
  `).run(randomUUID(), row.id, kind, row.attempt, idempotencyKey, epochSeconds(now), row.dataType);
}

export function requestAgentRunCancellation(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  runId: string;
  idempotencyKey: string;
  now?: Date;
}) {
  const idempotencyKey = ControlKeySchema.parse(input.idempotencyKey);
  const now = input.now ?? new Date();
  let alreadyApplied = false;
  let abortRequested = false;

  input.connection.sqlite.transaction(() => {
    const row = ownedRun(input.connection, input.actor, input.runId);
    if (existingControl(input.connection, row.id, "CANCEL", idempotencyKey)) {
      alreadyApplied = true;
      abortRequested = row.status === "RUNNING";
      return;
    }
    if (["COMPLETED", "FAILED"].includes(row.status)) {
      throw new AgentRunConflictError("已结束的运行不能取消");
    }
    if (row.status === "CANCELLED") {
      throw new AgentRunConflictError("运行已由另一取消请求结束");
    }
    const checkpoint = AgentRunCheckpointSchema.parse(JSON.parse(row.checkpointJson));
    const persisted = input.connection.sqlite.prepare(
      "SELECT id FROM agent_turns WHERE run_id=?",
    ).get(row.id);
    if (row.status === "RUNNING" && (checkpoint.stage === "TURN_PERSISTED" || persisted)) {
      throw new AgentRunConflictError("回答已经安全保存，当前运行不能再取消");
    }
    insertControl(input.connection, row, "CANCEL", idempotencyKey, now);
    const nowSeconds = epochSeconds(now);
    if (row.status === "RUNNING") {
      const nextCheckpoint = { stage: "CANCEL_REQUESTED" as const };
      input.connection.sqlite.prepare(`
        UPDATE agent_runs SET cancel_requested_at=?, checkpoint_json=?, updated_at=?
        WHERE id=? AND status='RUNNING'
      `).run(nowSeconds, JSON.stringify(nextCheckpoint), nowSeconds, row.id);
      appendAgentRunEvent(input.connection, row, {
        kind: "STATUS_CHANGED", label: "已请求停止运行",
        summary: "取消意图已经保存，运行将在最近的安全边界停止。",
        payload: { status: "RUNNING", cancelRequested: true, checkpoint: nextCheckpoint }, now,
      });
      abortRequested = true;
      return;
    }

    if (row.status === "WAITING_APPROVAL") {
      if (!checkpoint.turnId || !persisted) {
        throw new AgentRunConflictError("等待确认的运行缺少已保存回答");
      }
      input.connection.sqlite.prepare(
        "UPDATE agent_actions SET status='EXPIRED' WHERE turn_id=? AND status='PROPOSED'",
      ).run(checkpoint.turnId);
      const nextCheckpoint = { stage: "COMPLETED" as const, turnId: checkpoint.turnId };
      const responseJson = refreshAgentRunResponseActions(input.connection, row.responseJson, checkpoint.turnId);
      const completed = input.connection.sqlite.prepare(`
        UPDATE agent_runs SET status='COMPLETED', response_json=?, cancel_requested_at=?, checkpoint_json=?,
          lease_owner=NULL, lease_expires_at=NULL, updated_at=?, completed_at=?
        WHERE id=? AND status='WAITING_APPROVAL'
      `).run(responseJson, nowSeconds, JSON.stringify(nextCheckpoint), nowSeconds, nowSeconds, row.id);
      if (completed.changes !== 1) throw new AgentRunConflictError();
      appendAgentRunEvent(input.connection, row, {
        kind: "APPROVAL", label: "已停止候选行动",
        summary: "回答已经保留，尚未批准的行动已停止且没有执行副作用。",
        payload: {
          previousStatus: "WAITING_APPROVAL", status: "COMPLETED",
          cancelRequested: true, turnId: checkpoint.turnId, checkpoint: nextCheckpoint,
        },
        now,
      });
      appendAgentRunEvent(input.connection, row, {
        kind: "COMPLETION", label: "本轮运行已完成",
        summary: "已保留回答并结束确认等待；项目记忆没有被回滚。",
        payload: {
          previousStatus: "WAITING_APPROVAL", status: "COMPLETED",
          cancelRequested: true, turnId: checkpoint.turnId, checkpoint: nextCheckpoint,
        },
        now,
      });
      return;
    }

    const nextCheckpoint = { stage: "CANCELLED" as const };
    input.connection.sqlite.prepare(`
      UPDATE agent_runs SET status='CANCELLED', response_json=?, cancel_requested_at=?, checkpoint_json=?,
        lease_owner=NULL, lease_expires_at=NULL, updated_at=?, completed_at=?
      WHERE id=? AND status='QUEUED'
    `).run(row.responseJson, nowSeconds, JSON.stringify(nextCheckpoint), nowSeconds, nowSeconds, row.id);
    appendAgentRunEvent(input.connection, row, {
      kind: "CANCELLED", label: "运行已取消",
      summary: "运行已在安全边界停止，没有执行新的确认行动。",
      payload: { previousStatus: row.status, status: "CANCELLED", cancelRequested: true, checkpoint: nextCheckpoint }, now,
    });
  }).immediate();

  const row = ownedRun(input.connection, input.actor, input.runId);
  return AgentRunCancelResponseSchema.parse({ run: publicAgentRun(row), alreadyApplied, abortRequested });
}

export function isAgentRunCancellationRequested(connection: DatabaseConnection, runId: string) {
  const row = readAgentRunRow(connection, runId);
  if (!row) throw new AgentRunNotFoundError();
  return row.cancelRequestedAt !== null;
}

export function finalizeAgentRunCancellation(input: {
  connection: DatabaseConnection;
  runId: string;
  workerId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  input.connection.sqlite.transaction(() => {
    const row = readAgentRunRow(input.connection, input.runId);
    if (!row) throw new AgentRunNotFoundError();
    if (row.status === "CANCELLED") return;
    if (row.status !== "RUNNING" || row.leaseOwner !== input.workerId || row.cancelRequestedAt === null) {
      throw new AgentRunConflictError();
    }
    const persisted = input.connection.sqlite.prepare(
      "SELECT id FROM agent_turns WHERE run_id=?",
    ).get(row.id);
    if (persisted) throw new AgentRunConflictError("回答已经安全保存，取消不能回滚该回合");
    const checkpoint = { stage: "CANCELLED" as const };
    const nowSeconds = epochSeconds(now);
    input.connection.sqlite.prepare(`
      UPDATE agent_runs SET status='CANCELLED', checkpoint_json=?, lease_owner=NULL,
        lease_expires_at=NULL, updated_at=?, completed_at=?
      WHERE id=? AND status='RUNNING' AND lease_owner=?
    `).run(JSON.stringify(checkpoint), nowSeconds, nowSeconds, row.id, input.workerId);
    appendAgentRunEvent(input.connection, row, {
      kind: "CANCELLED", label: "运行已安全停止",
      summary: "取消已在回合写入前生效，没有留下半写回答。",
      payload: { previousStatus: "RUNNING", status: "CANCELLED", cancelRequested: true, checkpoint }, now,
    });
  }).immediate();
}

export function retryAgentRun(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  runId: string;
  idempotencyKey: string;
  now?: Date;
}) {
  const idempotencyKey = ControlKeySchema.parse(input.idempotencyKey);
  const now = input.now ?? new Date();
  let alreadyApplied = false;

  input.connection.sqlite.transaction(() => {
    const row = ownedRun(input.connection, input.actor, input.runId);
    if (existingControl(input.connection, row.id, "RETRY", idempotencyKey)) {
      alreadyApplied = true;
      return;
    }
    if (!["FAILED", "CANCELLED"].includes(row.status)) {
      throw new AgentRunConflictError("只有失败或安全取消的运行可以重试");
    }
    if (row.attempt >= MAX_AGENT_RUN_ATTEMPTS) throw new AgentRunConflictError("已达到本轮最大尝试次数");
    const persisted = input.connection.sqlite.prepare(
      "SELECT id FROM agent_turns WHERE run_id=?",
    ).get(row.id);
    if (persisted) throw new AgentRunConflictError("已有保存回合的运行不能重试");
    insertControl(input.connection, row, "RETRY", idempotencyKey, now);
    const checkpoint = { stage: "RETRY_QUEUED" as const };
    const nowSeconds = epochSeconds(now);
    input.connection.sqlite.prepare(`
      UPDATE agent_runs SET status='QUEUED', response_json=NULL, checkpoint_json=?,
        cancel_requested_at=NULL, retry_requested_at=?, lease_owner=NULL, lease_expires_at=NULL,
        last_error_code=NULL, updated_at=?, completed_at=NULL
      WHERE id=? AND status IN ('FAILED','CANCELLED')
    `).run(JSON.stringify(checkpoint), nowSeconds, nowSeconds, row.id);
    appendAgentRunEvent(input.connection, row, {
      kind: "STATUS_CHANGED", label: "运行已重新排队",
      summary: "将复用原请求和原 Runtime，从新的安全尝试继续。",
      payload: { previousStatus: row.status, status: "QUEUED", attempt: row.attempt, retryQueued: true, checkpoint }, now,
    });
  }).immediate();

  const row = ownedRun(input.connection, input.actor, input.runId);
  return AgentRunRetryResponseSchema.parse({ run: publicAgentRun(row), alreadyApplied });
}

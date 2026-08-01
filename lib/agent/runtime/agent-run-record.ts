import { randomUUID } from "node:crypto";

import type { DatabaseConnection } from "@/lib/db/client";

import { AgentTurnRequestSchema, AgentTurnResponseSchema } from "../contracts";
import {
  AgentRunCheckpointSchema,
  AgentRunEventPayloadSchema,
  AgentRunSchema,
  type AgentRun,
  type AgentRunEventKind,
  type AgentRunEventPayload,
  type AgentRunStatus,
} from "./agent-run-event";

export type AgentRunRow = {
  id: string;
  taskId: string;
  studentId: string;
  classId: string;
  runtimeId: string;
  runtimeVersion: string;
  status: AgentRunStatus;
  requestJson: string;
  requestHash: string;
  responseJson: string | null;
  checkpointJson: string;
  idempotencyKey: string;
  attempt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | Date | null;
  cancelRequestedAt: number | Date | null;
  retryRequestedAt: number | Date | null;
  lastErrorCode: string | null;
  createdAt: number | Date;
  updatedAt: number | Date;
  startedAt: number | Date | null;
  completedAt: number | Date | null;
  dataType: "REAL" | "DEMONSTRATION_DATA";
};

export class AgentRunNotFoundError extends Error {
  constructor() { super("运行不存在"); this.name = "AgentRunNotFoundError"; }
}

export class AgentRunConflictError extends Error {
  constructor(message = "运行状态已变化，请刷新后重试") { super(message); this.name = "AgentRunConflictError"; }
}

export function epochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

export function isoDate(value: number | Date | null) {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value < 10_000_000_000 ? value * 1_000 : value);
  return date.toISOString();
}

export function readAgentRunRow(
  connection: DatabaseConnection,
  runId: string,
  studentId?: string,
) {
  return connection.sqlite.prepare(`
    SELECT id, task_id taskId, student_id studentId, class_id classId,
      runtime_id runtimeId, runtime_version runtimeVersion, status,
      request_json requestJson, request_hash requestHash, response_json responseJson,
      checkpoint_json checkpointJson, idempotency_key idempotencyKey, attempt,
      lease_owner leaseOwner, lease_expires_at leaseExpiresAt,
      cancel_requested_at cancelRequestedAt, retry_requested_at retryRequestedAt,
      last_error_code lastErrorCode,
      created_at createdAt, updated_at updatedAt, started_at startedAt,
      completed_at completedAt, data_type dataType
    FROM agent_runs WHERE id=?${studentId ? " AND student_id=?" : ""}
  `).get(...(studentId ? [runId, studentId] : [runId])) as AgentRunRow | undefined;
}

export function publicAgentRun(row: AgentRunRow): AgentRun {
  return AgentRunSchema.parse({
    id: row.id,
    taskId: row.taskId,
    request: AgentTurnRequestSchema.parse(JSON.parse(row.requestJson)),
    status: row.status,
    runtime: { id: row.runtimeId, version: row.runtimeVersion },
    attempt: row.attempt,
    checkpoint: AgentRunCheckpointSchema.parse(JSON.parse(row.checkpointJson)),
    result: row.responseJson ? AgentTurnResponseSchema.parse(JSON.parse(row.responseJson)) : null,
    lastErrorCode: row.lastErrorCode,
    cancelRequestedAt: isoDate(row.cancelRequestedAt),
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
    startedAt: isoDate(row.startedAt),
    completedAt: isoDate(row.completedAt),
  });
}

export function nextAgentRunEventSequence(connection: DatabaseConnection, runId: string) {
  return (connection.sqlite.prepare(
    "SELECT coalesce(max(event_sequence),0)+1 sequence FROM agent_run_events WHERE run_id=?",
  ).get(runId) as { sequence: number }).sequence;
}

export function appendAgentRunEvent(
  connection: DatabaseConnection,
  row: Pick<AgentRunRow, "id" | "dataType">,
  input: {
    kind: AgentRunEventKind;
    label: string;
    summary: string;
    payload?: AgentRunEventPayload;
    now: Date;
  },
) {
  const payload = AgentRunEventPayloadSchema.parse(input.payload ?? {});
  const sequence = nextAgentRunEventSequence(connection, row.id);
  connection.sqlite.prepare(`
    INSERT INTO agent_run_events(id,run_id,event_sequence,kind,label,summary,payload_json,created_at,data_type)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).run(
    randomUUID(), row.id, sequence, input.kind, input.label, input.summary,
    JSON.stringify(payload), epochSeconds(input.now), row.dataType,
  );
  return sequence;
}

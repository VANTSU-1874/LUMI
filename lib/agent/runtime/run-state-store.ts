import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import type { StagedAgentRunArtwork } from "../artwork-attachment";
import {
  AgentTurnRequestSchema,
  AgentTurnResponseSchema,
  type AgentTurnRequest,
} from "../contracts";
import { appendContinuationText } from "../continuation-text";
import { resolveActiveDesignTask } from "../design-project-task";
import {
  appendAgentRunEvent,
  AgentRunConflictError,
  AgentRunNotFoundError,
  epochSeconds,
  isoDate,
  nextAgentRunEventSequence,
  publicAgentRun,
  readAgentRunRow,
} from "./agent-run-record";
import {
  AgentRunCheckpointSchema,
  AgentRunCreateResponseSchema,
  AgentRunCurrentResponseSchema,
  AgentRunEventSchema,
  AgentRunEventsResponseSchema,
  type AgentRunEvent,
  type AgentRunEventKind,
} from "./agent-run-event";
import type { AgentRuntimeDescriptor } from "./trace-sink";
import { readAgentRunVisibleText } from "./agent-run-visible-text";

export { AgentRunConflictError, AgentRunNotFoundError } from "./agent-run-record";
export {
  claimAgentRun,
  completeAgentRun,
  failAgentRun,
  markAgentRunTurnPersisted,
  readPersistedTurnForRun,
  type ClaimedAgentRun,
} from "./agent-run-lifecycle";

const IdempotencyKeySchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

function requestHash(input: AgentTurnRequest, artwork?: StagedAgentRunArtwork) {
  const material = artwork ? { request: input, artworkDigest: artwork.digest } : input;
  return createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex");
}

export function createAgentRun(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  request: AgentTurnRequest;
  idempotencyKey: string;
  runtime: AgentRuntimeDescriptor;
  artwork?: StagedAgentRunArtwork;
  now?: Date;
}) {
  const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
  const active = resolveActiveDesignTask(input.connection, input.actor, input.request.taskId);
  const normalizedRequest = AgentTurnRequestSchema.parse({ ...input.request, taskId: active.task.id });
  const hash = requestHash(normalizedRequest, input.artwork);
  const now = input.now ?? new Date();
  let created = false;
  let runId = "";

  input.connection.sqlite.transaction(() => {
    const existing = input.connection.sqlite.prepare(`
      SELECT id, request_hash requestHash FROM agent_runs WHERE student_id=? AND idempotency_key=?
    `).get(active.student.studentId, idempotencyKey) as { id: string; requestHash: string } | undefined;
    if (existing) {
      if (existing.requestHash !== hash) throw new AgentRunConflictError("同一幂等键不能用于不同请求");
      runId = existing.id;
      return;
    }
    runId = randomUUID();
    const checkpoint = AgentRunCheckpointSchema.parse({ stage: "CREATED" });
    input.connection.sqlite.prepare(`
      INSERT INTO agent_runs(
        id,task_id,student_id,class_id,runtime_id,runtime_version,status,
        request_json,request_hash,response_json,checkpoint_json,idempotency_key,attempt,
        lease_owner,lease_expires_at,last_error_code,created_at,updated_at,started_at,completed_at,data_type
      ) VALUES(?,?,?,?,?,?,'QUEUED',?,?,NULL,?,?,0,NULL,NULL,NULL,?,?,NULL,NULL,?)
    `).run(
      runId, active.task.id, active.student.studentId, active.student.classId,
      input.runtime.id, input.runtime.version, JSON.stringify(normalizedRequest), hash,
      JSON.stringify(checkpoint), idempotencyKey, epochSeconds(now), epochSeconds(now), active.student.dataType,
    );
    appendAgentRunEvent(input.connection, { id: runId, dataType: active.student.dataType }, {
      kind: "RUN_CREATED", label: "任务已进入队列",
      summary: "已保存本次设计对话请求，后台运行可以在连接断开后继续。",
      payload: { status: "QUEUED", runtime: input.runtime, checkpoint }, now,
    });
    if (input.artwork) {
      input.connection.sqlite.prepare(`
        INSERT INTO agent_run_artwork_inputs(
          id,run_id,mime_type,storage_path,digest,byte_size,width,height,created_at,data_type
        ) VALUES(?,?,?,?,?,?,?,?,?,?)
      `).run(
        input.artwork.id, runId, input.artwork.mimeType, input.artwork.storagePath,
        input.artwork.digest, input.artwork.byteSize, input.artwork.width, input.artwork.height,
        epochSeconds(now), active.student.dataType,
      );
    }
    created = true;
  }).immediate();

  const row = readAgentRunRow(input.connection, runId, active.student.studentId);
  if (!row) throw new AgentRunNotFoundError();
  return AgentRunCreateResponseSchema.parse({
    run: publicAgentRun(row), created,
    nextEventSequence: nextAgentRunEventSequence(input.connection, runId),
  });
}

function incompleteResponseText(responseJson: string | null) {
  if (!responseJson) return "";
  try {
    const response = AgentTurnResponseSchema.parse(JSON.parse(responseJson));
    return response.reply.incomplete ? response.reply.message : "";
  } catch {
    return "";
  }
}

/**
 * Starts a new durable run that appends to a learner-visible partial answer.
 * It never repurposes the original user message row, so a completed partial
 * remains auditable while the history adapter can render both pieces as one
 * answer.
 */
export function continueAgentRun(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  runId: string;
  idempotencyKey: string;
  runtime: AgentRuntimeDescriptor;
  now?: Date;
}) {
  if (input.actor.role !== "STUDENT") throw new AgentRunNotFoundError();
  // The HTTP key is still syntactically checked at this boundary.  The
  // durable continuation itself, however, is identified by its source run:
  // a repeated click or a remounted composer must not fork two child runs.
  z.string().uuid().parse(input.idempotencyKey);
  const source = readAgentRunRow(
    input.connection,
    z.string().uuid().parse(input.runId),
    input.actor.userId,
  );
  if (!source) throw new AgentRunNotFoundError();

  const sourceRequest = AgentTurnRequestSchema.parse(JSON.parse(source.requestJson));
  const persistedPartial = incompleteResponseText(source.responseJson);
  if (
    !["FAILED", "CANCELLED"].includes(source.status)
    && !persistedPartial
  ) {
    throw new AgentRunConflictError("只有未完成的回答可以继续生成");
  }

  const nextAttempt = (sourceRequest.continuation?.attempt ?? 0) + 1;
  if (nextAttempt > 3) {
    throw new AgentRunConflictError("这条回答已达到继续生成上限");
  }

  const streamedText = readAgentRunVisibleText(input.connection, source.id);
  const previousText = persistedPartial || appendContinuationText(
    sourceRequest.continuation?.previousText ?? "",
    streamedText,
  );
  if (!previousText.trim()) {
    throw new AgentRunConflictError("尚未收到可继续的正文，请重新生成");
  }

  const request = AgentTurnRequestSchema.parse({
    taskId: source.taskId,
    message: sourceRequest.message,
    ...(sourceRequest.capability ? { capability: sourceRequest.capability } : {}),
    context: sourceRequest.context,
    continuation: {
      sourceRunId: source.id,
      previousText,
      attempt: nextAttempt,
    },
  });
  return createAgentRun({
    connection: input.connection,
    actor: input.actor,
    request,
    idempotencyKey: `continue:${source.id}`,
    runtime: input.runtime,
    now: input.now,
  });
}

export function readAgentRunArtworkInput(
  connection: DatabaseConnection,
  runId: string,
): StagedAgentRunArtwork | undefined {
  return connection.sqlite.prepare(`
    SELECT id, mime_type mimeType, storage_path storagePath, digest,
      byte_size byteSize, width, height
    FROM agent_run_artwork_inputs WHERE run_id=?
  `).get(runId) as StagedAgentRunArtwork | undefined;
}

export function deleteAgentRunArtworkInput(connection: DatabaseConnection, runId: string) {
  connection.sqlite.prepare("DELETE FROM agent_run_artwork_inputs WHERE run_id=?").run(runId);
}

export function readCurrentAgentRun(
  connection: DatabaseConnection,
  actor: SessionPayload,
  taskId?: string,
) {
  const active = resolveActiveDesignTask(connection, actor, taskId);
  const latest = connection.sqlite.prepare(`
    SELECT id, status FROM agent_runs
    WHERE task_id=? AND student_id=?
    ORDER BY updated_at DESC, rowid DESC LIMIT 1
  `).get(active.task.id, active.student.studentId) as { id: string; status: string } | undefined;
  if (!latest || latest.status === "COMPLETED") {
    return AgentRunCurrentResponseSchema.parse({ run: null, nextEventSequence: 1 });
  }
  const row = readAgentRunRow(connection, latest.id, active.student.studentId);
  if (!row) throw new AgentRunNotFoundError();
  return AgentRunCurrentResponseSchema.parse({
    run: publicAgentRun(row),
    nextEventSequence: nextAgentRunEventSequence(connection, row.id),
  });
}

export function readAgentRun(connection: DatabaseConnection, actor: SessionPayload, runId: string) {
  if (actor.role !== "STUDENT") throw new AgentRunNotFoundError();
  const row = readAgentRunRow(connection, z.string().uuid().parse(runId), actor.userId);
  if (!row) throw new AgentRunNotFoundError();
  return publicAgentRun(row);
}

export function readAgentRunEvents(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  runId: string;
  afterSequence?: number;
  limit?: number;
}) {
  const run = readAgentRun(input.connection, input.actor, input.runId);
  const afterSequence = z.number().int().min(0).parse(input.afterSequence ?? 0);
  const limit = z.number().int().min(1).max(200).parse(input.limit ?? 100);
  const rows = input.connection.sqlite.prepare(`
    SELECT id, run_id runId, event_sequence sequence, kind, label, summary,
      payload_json payloadJson, created_at createdAt
    FROM agent_run_events WHERE run_id=? AND event_sequence>?
    ORDER BY event_sequence LIMIT ?
  `).all(run.id, afterSequence, limit) as Array<{
    id: string; runId: string; sequence: number; kind: AgentRunEventKind;
    label: string; summary: string; payloadJson: string; createdAt: number | Date;
  }>;
  const events = rows.map((row): AgentRunEvent => AgentRunEventSchema.parse({
    id: row.id, runId: row.runId, sequence: row.sequence, kind: row.kind,
    label: row.label, summary: row.summary, payload: JSON.parse(row.payloadJson),
    createdAt: isoDate(row.createdAt),
  }));
  return AgentRunEventsResponseSchema.parse({
    runId: run.id, events,
    nextEventSequence: events.at(-1)?.sequence ? events.at(-1)!.sequence + 1 : afterSequence + 1,
  });
}

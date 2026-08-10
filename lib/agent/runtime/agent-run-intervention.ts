import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import {
  AgentMessageConflictError,
  appendStudentAgentMessage,
} from "../agent-message-store";
import { AgentTurnRequestSchema } from "../contracts";
import {
  AgentRunInterventionCreateResponseSchema,
  AgentRunInterventionListResponseSchema,
  AgentRunInterventionRequestSchema,
} from "./agent-run-intervention-contract";
import {
  listAgentRunInterventionRows,
  publicAgentRunIntervention,
  readAgentRunInterventionByIdempotency,
  readAgentRunInterventionRow,
} from "./agent-run-intervention-record";
import {
  appendAgentRunEvent,
  epochSeconds,
  readAgentRunRow,
} from "./agent-run-record";
import { createAgentRun, readAgentRun } from "./run-state-store";
import type { AgentRuntimeDescriptor } from "./trace-sink";
import {
  AgentRunInterventionConflictError,
  AgentRunInterventionNotFoundError,
} from "./agent-run-intervention-errors";

export {
  AgentRunInterventionCreateResponseSchema,
  AgentRunInterventionListResponseSchema,
  AgentRunInterventionModeSchema,
  AgentRunInterventionRequestSchema,
  AgentRunInterventionSchema,
  AgentRunInterventionStatusSchema,
} from "./agent-run-intervention-contract";
export {
  AgentRunInterventionConflictError,
  AgentRunInterventionNotFoundError,
} from "./agent-run-intervention-errors";
export { downgradeLateAgentRunSteer } from "./agent-run-intervention-steer";
export type {
  AgentRunIntervention,
  AgentRunInterventionMode,
  AgentRunInterventionRequest,
  AgentRunInterventionStatus,
} from "./agent-run-intervention-contract";

const IdempotencyKeySchema = z.string().uuid();
const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"] as const;

function interventionRequestHash(input: {
  sourceRunId: string;
  request: z.infer<typeof AgentRunInterventionRequestSchema>;
}) {
  return createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");
}

function ownedSourceRun(
  connection: DatabaseConnection,
  actor: SessionPayload,
  sourceRunId: string,
) {
  if (actor.role !== "STUDENT") throw new AgentRunInterventionNotFoundError();
  const row = readAgentRunRow(
    connection,
    z.string().uuid().parse(sourceRunId),
    actor.userId,
  );
  if (!row) throw new AgentRunInterventionNotFoundError();
  return row;
}

function assertTaskAcceptsIntervention(
  connection: DatabaseConnection,
  source: ReturnType<typeof ownedSourceRun>,
) {
  const task = connection.sqlite.prepare(`
    SELECT status FROM design_project_tasks
    WHERE id=? AND student_id=? AND class_id=?
  `).get(source.taskId, source.studentId, source.classId) as {
    status: "ACTIVE" | "ARCHIVED";
  } | undefined;
  if (!task) throw new AgentRunInterventionNotFoundError();
  if (task.status === "ARCHIVED") {
    throw new AgentRunInterventionConflictError("任务已归档，请恢复后继续对话");
  }
  if (TERMINAL_STATUSES.includes(
    source.status as typeof TERMINAL_STATUSES[number],
  )) {
    throw new AgentRunInterventionConflictError("本轮已经结束，请作为新问题发送");
  }
}

function assertCurrentSourceRun(
  connection: DatabaseConnection,
  source: ReturnType<typeof ownedSourceRun>,
) {
  const current = connection.sqlite.prepare(`
    SELECT run.id
    FROM agent_runs run
    WHERE run.task_id=? AND run.student_id=?
      AND run.status IN ('QUEUED','RUNNING','WAITING_APPROVAL')
      AND (
        run.status<>'QUEUED'
        OR NOT EXISTS (
          SELECT 1 FROM agent_run_interventions intervention
          JOIN agent_runs predecessor
            ON predecessor.id=intervention.predecessor_run_id
          WHERE intervention.next_run_id=run.id
            AND predecessor.status NOT IN ('COMPLETED','FAILED','CANCELLED')
        )
      )
    ORDER BY CASE run.status
      WHEN 'RUNNING' THEN 0
      WHEN 'WAITING_APPROVAL' THEN 1
      ELSE 2 END,
      run.updated_at DESC,run.rowid DESC
    LIMIT 1
  `).get(source.taskId, source.studentId) as { id: string } | undefined;
  if (!current || current.id !== source.id) {
    throw new AgentRunInterventionConflictError(
      "只能向当前正在处理的运行补充消息",
    );
  }
}

function queuePredecessor(
  connection: DatabaseConnection,
  source: ReturnType<typeof ownedSourceRun>,
) {
  const tail = connection.sqlite.prepare(`
    SELECT intervention.next_run_id predecessorRunId
    FROM agent_run_interventions intervention
    JOIN agent_runs successor ON successor.id=intervention.next_run_id
    WHERE intervention.task_id=? AND intervention.student_id=?
      AND successor.status IN ('QUEUED','RUNNING','WAITING_APPROVAL')
    ORDER BY intervention.queue_sequence DESC
    LIMIT 1
  `).get(source.taskId, source.studentId) as {
    predecessorRunId: string;
  } | undefined;
  return tail?.predecessorRunId ?? source.id;
}

function nextQueueSequence(
  connection: DatabaseConnection,
  taskId: string,
) {
  return (connection.sqlite.prepare(`
    SELECT coalesce(max(queue_sequence),0)+1 queueSequence
    FROM agent_run_interventions WHERE task_id=?
  `).get(taskId) as { queueSequence: number }).queueSequence;
}

function hasPersistedTurn(
  connection: DatabaseConnection,
  runId: string,
) {
  return Boolean(connection.sqlite.prepare(
    "SELECT id FROM agent_turns WHERE run_id=?",
  ).get(runId));
}

export function createAgentRunIntervention(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  sourceRunId: string;
  request: unknown;
  idempotencyKey: string;
  runtime: AgentRuntimeDescriptor;
  now?: Date;
}) {
  const source = ownedSourceRun(input.connection, input.actor, input.sourceRunId);
  const request = AgentRunInterventionRequestSchema.parse(input.request);
  const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
  const requestHash = interventionRequestHash({
    sourceRunId: source.id,
    request,
  });
  const existing = readAgentRunInterventionByIdempotency(
    input.connection,
    source.studentId,
    idempotencyKey,
  );
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AgentRunInterventionConflictError(
        "同一幂等键不能用于不同补充消息",
      );
    }
    return AgentRunInterventionCreateResponseSchema.parse({
      intervention: publicAgentRunIntervention(existing),
      nextRun: readAgentRun(input.connection, input.actor, existing.nextRunId),
      created: false,
      steerShouldCancel: existing.actualMode === "STEER",
    });
  }

  assertTaskAcceptsIntervention(input.connection, source);
  assertCurrentSourceRun(input.connection, source);
  const now = input.now ?? new Date();
  let interventionId = "";
  let nextRunId = "";
  let actualMode: "FOLLOW_UP" | "STEER" = request.mode;

  try {
    input.connection.sqlite.transaction(() => {
      const message = appendStudentAgentMessage({
        connection: input.connection,
        actor: input.actor,
        taskId: source.taskId,
        message: request.message,
        now,
      });
      if (!message.created) {
        throw new AgentRunInterventionConflictError(
          "该消息已用于其他运行请求",
        );
      }
      if (request.mode === "STEER" && hasPersistedTurn(input.connection, source.id)) {
        actualMode = "FOLLOW_UP";
      }
      const sourceRequest = AgentTurnRequestSchema.parse(
        JSON.parse(source.requestJson),
      );
      const next = createAgentRun({
        connection: input.connection,
        actor: input.actor,
        request: {
          taskId: source.taskId,
          clientMessageId: request.message.id,
          message: request.message.content,
          context: sourceRequest.context,
        },
        idempotencyKey: `intervention:${idempotencyKey}`,
        runtime: input.runtime,
        allowWhileTaskBusy: true,
        now,
      });
      if (!next.created) {
        throw new AgentRunInterventionConflictError(
          "后继运行已经被其他请求占用",
        );
      }
      nextRunId = next.run.id;
      interventionId = randomUUID();
      const predecessorRunId = queuePredecessor(input.connection, source);
      const queueSequence = nextQueueSequence(input.connection, source.taskId);
      const nowSeconds = epochSeconds(now);
      input.connection.sqlite.prepare(`
        INSERT INTO agent_run_interventions(
          id,task_id,student_id,class_id,source_run_id,predecessor_run_id,
          user_message_id,requested_mode,actual_mode,queue_sequence,next_run_id,
          status,idempotency_key,request_hash,created_at,updated_at,
          activated_at,completed_at,data_type
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,'QUEUED',?,?,?,?,NULL,NULL,?)
      `).run(
        interventionId,
        source.taskId,
        source.studentId,
        source.classId,
        source.id,
        predecessorRunId,
        request.message.id,
        request.mode,
        actualMode,
        queueSequence,
        nextRunId,
        idempotencyKey,
        requestHash,
        nowSeconds,
        nowSeconds,
        source.dataType,
      );
      const nextRow = readAgentRunRow(input.connection, nextRunId);
      if (!nextRow) throw new AgentRunInterventionConflictError();
      appendAgentRunEvent(input.connection, nextRow, {
        kind: "STATUS_CHANGED",
        label: actualMode === "STEER" ? "已保存改向要求" : "已追加到下一轮",
        summary: actualMode === "STEER"
          ? "改向要求已经保存，将在安全边界切换到新的运行。"
          : "补充要求已经保存，将按当前任务的队列顺序处理。",
        payload: {
          status: "QUEUED",
          interventionId,
          interventionMode: actualMode,
          queueSequence,
        },
        now,
      });
    }).immediate();
  } catch (error) {
    if (error instanceof AgentMessageConflictError) {
      throw new AgentRunInterventionConflictError(error.message);
    }
    throw error;
  }

  const row = readAgentRunInterventionRow(input.connection, interventionId);
  if (!row || !nextRunId) throw new AgentRunInterventionConflictError();
  return AgentRunInterventionCreateResponseSchema.parse({
    intervention: publicAgentRunIntervention(row),
    nextRun: readAgentRun(input.connection, input.actor, nextRunId),
    created: true,
    steerShouldCancel: actualMode === "STEER",
  });
}

export function listAgentRunInterventions(
  connection: DatabaseConnection,
  actor: SessionPayload,
  taskId: string,
) {
  if (actor.role !== "STUDENT") throw new AgentRunInterventionNotFoundError();
  const ownedTask = connection.sqlite.prepare(`
    SELECT id FROM design_project_tasks
    WHERE id=? AND student_id=?
  `).get(z.string().uuid().parse(taskId), actor.userId);
  if (!ownedTask) throw new AgentRunInterventionNotFoundError();
  return AgentRunInterventionListResponseSchema.parse({
    taskId,
    interventions: listAgentRunInterventionRows(
      connection,
      taskId,
      actor.userId,
    ).map(publicAgentRunIntervention),
  });
}

export function listAgentRunInterventionsForSourceRun(
  connection: DatabaseConnection,
  actor: SessionPayload,
  sourceRunId: string,
) {
  const source = ownedSourceRun(connection, actor, sourceRunId);
  return listAgentRunInterventions(connection, actor, source.taskId);
}

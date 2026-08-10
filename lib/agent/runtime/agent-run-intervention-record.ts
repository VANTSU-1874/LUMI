import type { DatabaseConnection } from "@/lib/db/client";

import {
  AgentRunInterventionSchema,
  type AgentRunIntervention,
  type AgentRunInterventionStatus,
} from "./agent-run-intervention-contract";
import { epochSeconds, isoDate } from "./agent-run-record";

export type AgentRunInterventionRow = {
  id: string;
  taskId: string;
  studentId: string;
  classId: string;
  sourceRunId: string;
  predecessorRunId: string;
  userMessageId: string;
  requestedMode: "FOLLOW_UP" | "STEER";
  actualMode: "FOLLOW_UP" | "STEER";
  queueSequence: number;
  nextRunId: string;
  status: AgentRunInterventionStatus;
  idempotencyKey: string;
  requestHash: string;
  createdAt: number | Date;
  updatedAt: number | Date;
  activatedAt: number | Date | null;
  completedAt: number | Date | null;
  dataType: "REAL" | "DEMONSTRATION_DATA";
};

const SELECT_COLUMNS = `
  id,task_id taskId,student_id studentId,class_id classId,
  source_run_id sourceRunId,predecessor_run_id predecessorRunId,
  user_message_id userMessageId,requested_mode requestedMode,actual_mode actualMode,
  queue_sequence queueSequence,next_run_id nextRunId,status,
  idempotency_key idempotencyKey,request_hash requestHash,
  created_at createdAt,updated_at updatedAt,activated_at activatedAt,
  completed_at completedAt,data_type dataType
`;

export function publicAgentRunIntervention(
  row: AgentRunInterventionRow,
): AgentRunIntervention {
  return AgentRunInterventionSchema.parse({
    id: row.id,
    taskId: row.taskId,
    sourceRunId: row.sourceRunId,
    predecessorRunId: row.predecessorRunId,
    userMessageId: row.userMessageId,
    requestedMode: row.requestedMode,
    actualMode: row.actualMode,
    queueSequence: row.queueSequence,
    nextRunId: row.nextRunId,
    status: row.status,
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
    activatedAt: isoDate(row.activatedAt),
    completedAt: isoDate(row.completedAt),
  });
}

export function readAgentRunInterventionRow(
  connection: DatabaseConnection,
  interventionId: string,
) {
  return connection.sqlite.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM agent_run_interventions WHERE id=?
  `).get(interventionId) as AgentRunInterventionRow | undefined;
}

export function readAgentRunInterventionByIdempotency(
  connection: DatabaseConnection,
  studentId: string,
  idempotencyKey: string,
) {
  return connection.sqlite.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM agent_run_interventions
    WHERE student_id=? AND idempotency_key=?
  `).get(studentId, idempotencyKey) as AgentRunInterventionRow | undefined;
}

export function readAgentRunInterventionForNextRun(
  connection: DatabaseConnection,
  runId: string,
) {
  return connection.sqlite.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM agent_run_interventions WHERE next_run_id=?
  `).get(runId) as AgentRunInterventionRow | undefined;
}

export function listAgentRunInterventionRows(
  connection: DatabaseConnection,
  taskId: string,
  studentId: string,
) {
  return connection.sqlite.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM agent_run_interventions
    WHERE task_id=? AND student_id=?
    ORDER BY queue_sequence ASC
  `).all(taskId, studentId) as AgentRunInterventionRow[];
}

export function isAgentRunInterventionBlocked(
  connection: DatabaseConnection,
  runId: string,
) {
  const row = connection.sqlite.prepare(`
    SELECT predecessor.status predecessorStatus
    FROM agent_run_interventions intervention
    JOIN agent_runs predecessor ON predecessor.id=intervention.predecessor_run_id
    WHERE intervention.next_run_id=? AND intervention.status='QUEUED'
  `).get(runId) as { predecessorStatus: string } | undefined;
  return Boolean(
    row
    && !["COMPLETED", "FAILED", "CANCELLED"].includes(row.predecessorStatus),
  );
}

export function readReadyAgentRunSuccessor(
  connection: DatabaseConnection,
  predecessorRunId: string,
) {
  const row = connection.sqlite.prepare(`
    SELECT intervention.next_run_id nextRunId
    FROM agent_run_interventions intervention
    JOIN agent_runs predecessor
      ON predecessor.id=intervention.predecessor_run_id
    JOIN agent_runs successor ON successor.id=intervention.next_run_id
    WHERE intervention.predecessor_run_id=?
      AND intervention.status='QUEUED'
      AND predecessor.status IN ('COMPLETED','FAILED','CANCELLED')
      AND successor.status='QUEUED'
    ORDER BY intervention.queue_sequence ASC
    LIMIT 1
  `).get(predecessorRunId) as { nextRunId: string } | undefined;
  return row?.nextRunId ?? null;
}

export function hasAgentRunSuccessor(
  connection: DatabaseConnection,
  predecessorRunId: string,
) {
  return Boolean(connection.sqlite.prepare(`
    SELECT 1 FROM agent_run_interventions
    WHERE predecessor_run_id=? LIMIT 1
  `).get(predecessorRunId));
}

export function markAgentRunInterventionActive(
  connection: DatabaseConnection,
  runId: string,
  now: Date,
) {
  const nowSeconds = epochSeconds(now);
  connection.sqlite.prepare(`
    UPDATE agent_run_interventions
    SET status='ACTIVE',activated_at=?,updated_at=?
    WHERE next_run_id=? AND status='QUEUED'
  `).run(nowSeconds, nowSeconds, runId);
}

export function markAgentRunInterventionTerminal(
  connection: DatabaseConnection,
  runId: string,
  status: Extract<AgentRunInterventionStatus, "COMPLETED" | "FAILED" | "CANCELLED">,
  now: Date,
) {
  const nowSeconds = epochSeconds(now);
  connection.sqlite.prepare(`
    UPDATE agent_run_interventions
    SET status=?,completed_at=?,updated_at=?
    WHERE next_run_id=? AND status IN ('QUEUED','ACTIVE')
  `).run(status, nowSeconds, nowSeconds, runId);
}

export function resetAgentRunInterventionQueued(
  connection: DatabaseConnection,
  runId: string,
  now: Date,
) {
  connection.sqlite.prepare(`
    UPDATE agent_run_interventions
    SET status='QUEUED',activated_at=NULL,completed_at=NULL,updated_at=?
    WHERE next_run_id=? AND status IN ('FAILED','CANCELLED')
  `).run(epochSeconds(now), runId);
}

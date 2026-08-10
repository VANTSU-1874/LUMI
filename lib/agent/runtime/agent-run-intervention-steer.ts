import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import { AgentRunInterventionConflictError } from "./agent-run-intervention-errors";
import {
  publicAgentRunIntervention,
  readAgentRunInterventionRow,
} from "./agent-run-intervention-record";
import { appendAgentRunEvent, epochSeconds, readAgentRunRow } from "./agent-run-record";

export function downgradeLateAgentRunSteer(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  interventionId: string;
  now?: Date;
}) {
  if (input.actor.role !== "STUDENT") {
    throw new AgentRunInterventionConflictError();
  }
  const now = input.now ?? new Date();
  input.connection.sqlite.transaction(() => {
    const intervention = readAgentRunInterventionRow(
      input.connection,
      input.interventionId,
    );
    if (!intervention || intervention.studentId !== input.actor.userId) {
      throw new AgentRunInterventionConflictError();
    }
    if (intervention.actualMode === "FOLLOW_UP") return;
    const source = readAgentRunRow(
      input.connection,
      intervention.sourceRunId,
      input.actor.userId,
    );
    if (!source) throw new AgentRunInterventionConflictError();
    const persisted = input.connection.sqlite.prepare(
      "SELECT id FROM agent_turns WHERE run_id=?",
    ).get(source.id);
    if (
      !persisted
      && !["COMPLETED", "FAILED", "CANCELLED"].includes(source.status)
    ) {
      throw new AgentRunInterventionConflictError(
        "当前运行仍可安全停止，不能提前转为下一轮",
      );
    }
    const updated = input.connection.sqlite.prepare(`
      UPDATE agent_run_interventions
      SET actual_mode='FOLLOW_UP',updated_at=?
      WHERE id=? AND student_id=? AND actual_mode='STEER'
    `).run(epochSeconds(now), intervention.id, intervention.studentId);
    if (updated.changes !== 1) throw new AgentRunInterventionConflictError();
    const next = readAgentRunRow(input.connection, intervention.nextRunId);
    if (!next) throw new AgentRunInterventionConflictError();
    appendAgentRunEvent(input.connection, next, {
      kind: "STATUS_CHANGED",
      label: "已转为下一轮",
      summary: "原回答已经越过安全停止边界，改向要求将作为下一轮继续处理。",
      payload: {
        status: next.status,
        interventionId: intervention.id,
        interventionMode: "FOLLOW_UP",
        queueSequence: intervention.queueSequence,
      },
      now,
    });
  }).immediate();

  const row = readAgentRunInterventionRow(
    input.connection,
    input.interventionId,
  );
  if (!row) throw new AgentRunInterventionConflictError();
  return publicAgentRunIntervention(row);
}

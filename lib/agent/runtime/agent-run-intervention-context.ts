import type { DatabaseConnection } from "@/lib/db/client";

import { AgentTurnRequestSchema } from "../contracts";
import type { AgentInterventionContext } from "../orchestrator-context";
import { readAgentRunInterventionForNextRun } from "./agent-run-intervention-record";

const MAX_UNANSWERED_MESSAGES = 8;

type PendingMessageRow = {
  requestJson: string;
  messageId: string | null;
  content: string | null;
  turnId: string | null;
  persistedTurnId: string | null;
};

export function readAgentRunInterventionContext(
  connection: DatabaseConnection,
  runId: string,
): AgentInterventionContext | undefined {
  const current = readAgentRunInterventionForNextRun(connection, runId);
  if (!current) return undefined;
  const unansweredMessages: AgentInterventionContext["unansweredMessages"] = [];
  let predecessorRunId: string | null = current.predecessorRunId;
  const visited = new Set<string>();

  while (
    predecessorRunId
    && unansweredMessages.length < MAX_UNANSWERED_MESSAGES
    && !visited.has(predecessorRunId)
  ) {
    visited.add(predecessorRunId);
    const row = connection.sqlite.prepare(`
      SELECT run.request_json requestJson,message.id messageId,
        message.content, message.turn_id turnId,turn.id persistedTurnId
      FROM agent_runs run
      LEFT JOIN agent_messages message
        ON message.id=json_extract(run.request_json,'$.clientMessageId')
        AND message.task_id=run.task_id
        AND message.student_id=run.student_id
        AND message.class_id=run.class_id
        AND message.role='user'
      LEFT JOIN agent_turns turn ON turn.run_id=run.id
      WHERE run.id=? AND run.task_id=? AND run.student_id=? AND run.class_id=?
    `).get(
      predecessorRunId,
      current.taskId,
      current.studentId,
      current.classId,
    ) as PendingMessageRow | undefined;
    if (!row || row.turnId || row.persistedTurnId) break;
    const request = AgentTurnRequestSchema.parse(JSON.parse(row.requestJson));
    unansweredMessages.unshift({
      id: row.messageId ?? `run:${predecessorRunId}`,
      content: row.content ?? request.message,
    });
    const predecessor = readAgentRunInterventionForNextRun(
      connection,
      predecessorRunId,
    );
    predecessorRunId = predecessor?.predecessorRunId ?? null;
  }

  return {
    mode: current.actualMode,
    unansweredMessages,
  };
}

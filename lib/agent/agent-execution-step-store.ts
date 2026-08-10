import type { DatabaseConnection } from "@/lib/db/client";

import { AgentExecutionStepSchema } from "./contracts";

export function readAgentExecutionSteps(
  connection: DatabaseConnection,
  turnId: string,
) {
  const rows = connection.sqlite.prepare(`
    SELECT id, step_sequence sequence, kind, status, label, summary,
      tool_call_id toolCallId, tool_id toolId, latency_ms latencyMs
    FROM agent_steps WHERE turn_id=? ORDER BY step_sequence
  `).all(turnId) as Array<Record<string, unknown>>;
  return rows.map((row) => AgentExecutionStepSchema.parse(row));
}

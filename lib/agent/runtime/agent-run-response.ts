import type { DatabaseConnection } from "@/lib/db/client";

import { AgentTurnResponseSchema } from "../contracts";

export function refreshAgentRunResponseActions(
  connection: DatabaseConnection,
  responseJson: string | null,
  turnId: string,
) {
  if (!responseJson) return null;
  const response = AgentTurnResponseSchema.parse(JSON.parse(responseJson));
  const rows = connection.sqlite.prepare(
    "SELECT id, status FROM agent_actions WHERE turn_id=? ORDER BY action_sequence",
  ).all(turnId) as Array<{ id: string; status: "PROPOSED" | "EXECUTED" | "REJECTED" | "EXPIRED" }>;
  const statuses = new Map(rows.map(({ id, status }) => [id, status]));
  return JSON.stringify(AgentTurnResponseSchema.parse({
    ...response,
    reply: {
      ...response.reply,
      actions: response.reply.actions.map((action) => ({
        ...action,
        status: statuses.get(action.id) ?? action.status,
      })),
    },
  }));
}

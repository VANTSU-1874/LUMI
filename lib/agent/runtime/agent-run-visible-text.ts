import type { DatabaseConnection } from "@/lib/db/client";

import { MAX_AGENT_VISIBLE_TEXT_CHARS } from "../continuation-text";

/**
 * Reads only TOKEN payloads, whose contract is learner-visible text.  Hidden
 * model reasoning never enters this query or a continuation prompt.
 */
export function readAgentRunVisibleText(connection: DatabaseConnection, runId: string) {
  const rows = connection.sqlite.prepare(`
    SELECT payload_json payloadJson
    FROM agent_run_events
    WHERE run_id=? AND kind='TOKEN'
    ORDER BY event_sequence
  `).all(runId) as Array<{ payloadJson: string }>;

  let text = "";
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payloadJson) as { text?: unknown };
      if (typeof payload.text !== "string") continue;
      text = `${text}${payload.text}`;
    } catch {
      // A malformed historical event must not turn a safe continuation into a
      // server error.  The public event route still validates current data.
    }
  }
  return text.slice(0, MAX_AGENT_VISIBLE_TEXT_CHARS);
}

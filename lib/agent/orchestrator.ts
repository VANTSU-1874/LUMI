import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import type { PreparedAgentArtwork } from "./artwork-attachment";
import type { AgentTurnRequest } from "./contracts";
import type { AgentOptions } from "./orchestrator-context";
import { currentAgentRuntime } from "./runtime/current-agent-runtime";

export { AgentConflictError, AgentForbiddenError, AgentNotFoundError } from "./orchestrator-errors";
export { executeAgentAction, readAgentConversation } from "./orchestrator-store";

export function runAgentTurn(
  connection: DatabaseConnection,
  actor: SessionPayload,
  input: AgentTurnRequest,
  options: AgentOptions = {},
  artwork?: PreparedAgentArtwork,
) {
  return currentAgentRuntime.run({ connection, actor, input, options, artwork });
}

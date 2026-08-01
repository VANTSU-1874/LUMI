import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import type { PreparedAgentArtwork } from "../artwork-attachment";
import type { AgentTurnRequest, AgentTurnResponse } from "../contracts";
import type { AgentOptions } from "../orchestrator-context";
import type { AgentRuntimeDescriptor, TraceSink } from "./trace-sink";

export type AgentRuntimeRequest = {
  connection: DatabaseConnection;
  actor: SessionPayload;
  input: AgentTurnRequest;
  runId?: string;
  options?: AgentOptions;
  artwork?: PreparedAgentArtwork;
  traceSink?: TraceSink;
};

export interface AgentRuntimePort {
  readonly descriptor: AgentRuntimeDescriptor;
  run(request: AgentRuntimeRequest): Promise<AgentTurnResponse>;
}

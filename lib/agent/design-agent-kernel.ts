import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import type { AgentTurnRequest } from "./contracts";
import type { PreparedAgentArtwork } from "./artwork-attachment";
import type { AgentOptions } from "./orchestrator-context";
import type { AgentRuntimePort } from "./runtime/agent-runtime-port";
import { currentAgentRuntime } from "./runtime/current-agent-runtime";

export class DesignAgentKernel {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly actor: SessionPayload,
    private readonly options: AgentOptions = {},
    private readonly runtime: AgentRuntimePort = currentAgentRuntime,
  ) {}

  run(input: AgentTurnRequest, artwork?: PreparedAgentArtwork, runId?: string) {
    return this.runtime.run({
      connection: this.connection,
      actor: this.actor,
      input,
      runId,
      options: this.options,
      artwork,
    });
  }
}

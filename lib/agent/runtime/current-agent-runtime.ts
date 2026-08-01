import { agentV3EnabledFromEnvironment } from "@/lib/config/env";

import { runCurrentAgentRuntimeTurn } from "../orchestrator-engine";
import { runTutorTurn } from "../v3/run-tutor-turn";
import type { AgentRuntimePort, AgentRuntimeRequest } from "./agent-runtime-port";
import { createInMemoryTraceSink, type AgentRuntimeDescriptor } from "./trace-sink";

export const CURRENT_AGENT_RUNTIME = {
  id: "current-agent-runtime",
  version: "1.0.0",
} as const satisfies AgentRuntimeDescriptor;

export class CurrentAgentRuntime implements AgentRuntimePort {
  readonly descriptor = CURRENT_AGENT_RUNTIME;

  async run(request: AgentRuntimeRequest) {
    const traceSink = request.traceSink ?? createInMemoryTraceSink(this.descriptor);
    if (
      traceSink.runtime.id !== this.descriptor.id
      || traceSink.runtime.version !== this.descriptor.version
    ) {
      throw new Error("TRACE_SINK_RUNTIME_MISMATCH");
    }
    return agentV3EnabledFromEnvironment()
      ? runTutorTurn(request, { traceSink })
      : runCurrentAgentRuntimeTurn(request, { traceSink });
  }
}

export const currentAgentRuntime = new CurrentAgentRuntime();

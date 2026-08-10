import {
  agentUnifiedHarnessModeFromEnvironment,
  agentV3EnabledFromEnvironment,
} from "@/lib/config/env";

import { runCurrentAgentRuntimeTurn } from "../orchestrator-engine";
import { getActiveAgentPolicy } from "../policy-registry";
import { runTutorTurn } from "../v3/run-tutor-turn";
import type { AgentRuntimePort, AgentRuntimeRequest } from "./agent-runtime-port";
import {
  createUnifiedRuntimeHarness,
  type UnifiedRuntimeHarnessFactoryInput,
} from "./harness/unified-runtime-harness";
import type { ContextMemoryEvidenceChainPorts } from "./harness/context-memory-evidence-chain";
import { createInMemoryTraceSink, type AgentRuntimeDescriptor } from "./trace-sink";

export const CURRENT_AGENT_RUNTIME = {
  id: "current-agent-runtime",
  version: "1.0.0",
} as const satisfies AgentRuntimeDescriptor;

export type CurrentAgentRuntimeDependencies = {
  createHarness?: (
    input: UnifiedRuntimeHarnessFactoryInput,
  ) => ReturnType<typeof createUnifiedRuntimeHarness>;
  /**
   * Candidate-only assembly seam. It is absent by default and fails closed
   * until separately owned Context and Memory ports are provided together.
   */
  contextMemoryEvidencePorts?: ContextMemoryEvidenceChainPorts;
};

export class CurrentAgentRuntime implements AgentRuntimePort {
  readonly descriptor = CURRENT_AGENT_RUNTIME;

  constructor(
    private readonly dependencies: CurrentAgentRuntimeDependencies = {},
  ) {}

  async run(request: AgentRuntimeRequest) {
    const traceSink = request.traceSink ?? createInMemoryTraceSink(this.descriptor);
    if (
      traceSink.runtime.id !== this.descriptor.id
      || traceSink.runtime.version !== this.descriptor.version
    ) {
      throw new Error("TRACE_SINK_RUNTIME_MISMATCH");
    }
    if (!agentV3EnabledFromEnvironment()) {
      return runCurrentAgentRuntimeTurn(request, { traceSink });
    }
    const mode = agentUnifiedHarnessModeFromEnvironment();
    if (mode === "OFF") {
      return runTutorTurn(request, { traceSink });
    }
    const policy = request.options?.policy ?? getActiveAgentPolicy();
    const createHarness = this.dependencies.createHarness
      ?? createUnifiedRuntimeHarness;
    const harness = createHarness({
      mode,
      deadlineAtMs: performance.now() + policy.budgets.turnTimeoutMs,
      signal: request.options?.signal,
      contextMemoryEvidencePorts: this.dependencies.contextMemoryEvidencePorts,
    });
    return harness.run((harnessContext) =>
      runTutorTurn(request, { traceSink, harness: harnessContext }));
  }
}

export const currentAgentRuntime = new CurrentAgentRuntime();

import type { AgentUnifiedHarnessMode } from "@/lib/config/env";

import { builtinCapabilityProviderSet } from "./builtin-capability-provider";
import type { CapabilityResolution, CapabilityProviderInput } from "./capability-provider";
import {
  createInMemoryHarnessTraceSink,
  type HarnessObserver,
} from "./lifecycle-contract";
import {
  createLifecycleCoordinator,
  type LifecycleCoordinator,
} from "./lifecycle-coordinator";
import {
  createContextMemoryEvidenceChain,
  type ContextMemoryEvidenceChain,
  type ContextMemoryEvidenceChainPorts,
} from "./context-memory-evidence-chain";

export type UnifiedRuntimeTurnContext = {
  mode: "SHADOW" | "ON";
  lifecycle: LifecycleCoordinator;
  resolveCapabilities(input: CapabilityProviderInput): CapabilityResolution;
  contextMemoryEvidence?: ContextMemoryEvidenceChain;
};

export class UnifiedRuntimeHarness {
  constructor(private readonly context: UnifiedRuntimeTurnContext) {}

  async run<T>(execute: (context: UnifiedRuntimeTurnContext) => Promise<T>) {
    await this.context.lifecycle.emit({ phase: "turn.before", status: "STARTED" });
    try {
      const result = await execute(this.context);
      await this.context.lifecycle.emit({ phase: "turn.after", status: "SUCCEEDED" });
      return result;
    } catch (error) {
      const cancelled = error instanceof Error
        && (error.name === "AbortError" || error.name === "TimeoutError");
      await this.context.lifecycle.emit({
        phase: cancelled ? "turn.cancelled" : "turn.error",
        status: cancelled ? "CANCELLED" : "FAILED",
        errorCode: cancelled ? "TURN_CANCELLED" : "TURN_FAILED",
      });
      throw error;
    } finally {
      await this.context.lifecycle.emit({ phase: "turn.finally", status: "SUCCEEDED" });
    }
  }
}

export type UnifiedRuntimeHarnessFactoryInput = {
  mode: Exclude<AgentUnifiedHarnessMode, "OFF">;
  deadlineAtMs: number;
  signal?: AbortSignal;
  observers?: readonly HarnessObserver[];
  contextMemoryEvidencePorts?: ContextMemoryEvidenceChainPorts;
};

export function createUnifiedRuntimeHarness(input: UnifiedRuntimeHarnessFactoryInput) {
  const lifecycle = createLifecycleCoordinator({
    trace: createInMemoryHarnessTraceSink(),
    deadlineAtMs: input.deadlineAtMs,
    signal: input.signal,
    observers: input.observers,
  });
  return new UnifiedRuntimeHarness({
    mode: input.mode,
    lifecycle,
    contextMemoryEvidence: createContextMemoryEvidenceChain({
      mode: input.mode,
      ports: input.contextMemoryEvidencePorts,
    }),
    resolveCapabilities: (capabilityInput) =>
      builtinCapabilityProviderSet.resolve(capabilityInput),
  });
}

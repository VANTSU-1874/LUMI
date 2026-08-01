import { randomUUID } from "node:crypto";

import {
  AgentExecutionStepSchema,
  type AgentExecutionStep,
} from "./contracts";
import type { AgentRuntimeEventInput, TraceSink } from "./runtime/trace-sink";

type StepInput = Omit<AgentExecutionStep, "id" | "sequence">;
type EventDetails = Omit<
  AgentRuntimeEventInput,
  "kind" | "status" | "label" | "summary" | "latencyMs" | "toolCallId" | "toolId"
>;

export type AgentExecutionTrace = ReturnType<typeof createExecutionTrace>;

export function createExecutionTrace(traceSink?: TraceSink) {
  const steps: AgentExecutionStep[] = [];
  return {
    add(input: StepInput, details: EventDetails = {}) {
      const step = AgentExecutionStepSchema.parse({
        ...input,
        id: randomUUID(),
        sequence: steps.length + 1,
      });
      steps.push(step);
      traceSink?.emit({
        ...details,
        kind: step.kind,
        status: step.status,
        label: step.label,
        summary: step.summary,
        toolCallId: step.toolCallId,
        toolId: step.toolId,
        latencyMs: step.latencyMs,
      });
      return step;
    },
    snapshot() {
      return steps.map((step) => ({ ...step }));
    },
  };
}

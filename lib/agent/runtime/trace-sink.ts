import { randomUUID } from "node:crypto";

import {
  AgentRuntimeDescriptorSchema,
  AgentRuntimeEventSchema,
  type AgentRuntimeDescriptor,
  type AgentRuntimeEvent,
} from "./trace-contract";

export {
  AgentRuntimeDescriptorSchema,
  AgentRuntimeEventSchema,
  AgentRuntimeUsageSchema,
} from "./trace-contract";
export type { AgentRuntimeDescriptor, AgentRuntimeEvent, AgentRuntimeUsage } from "./trace-contract";
export type AgentRuntimeEventInput = Pick<
  AgentRuntimeEvent,
  "kind" | "status" | "label" | "summary" | "latencyMs"
> & Partial<Pick<
  AgentRuntimeEvent,
  "toolCallId" | "toolId" | "sourceIds" | "policyRule" | "errorCode"
  | "modelProvider" | "modelId" | "usage"
>>;

export interface TraceSink {
  readonly runtime: AgentRuntimeDescriptor;
  emit(input: AgentRuntimeEventInput): AgentRuntimeEvent;
  snapshot(): AgentRuntimeEvent[];
}

export function createInMemoryTraceSink(runtime: AgentRuntimeDescriptor): TraceSink {
  const descriptor = AgentRuntimeDescriptorSchema.parse(runtime);
  const events: AgentRuntimeEvent[] = [];
  return {
    runtime: descriptor,
    emit(input) {
      const event = AgentRuntimeEventSchema.parse({
        ...input,
        id: randomUUID(),
        sequence: events.length + 1,
        runtime: descriptor,
      });
      events.push(event);
      return event;
    },
    snapshot() {
      return events.map((event) => ({
        ...event,
        runtime: { ...event.runtime },
        sourceIds: [...event.sourceIds],
        usage: { ...event.usage },
      }));
    },
  };
}

import { describe, expect, it } from "vitest";

import {
  createInMemoryHarnessTraceSink,
  HarnessEventSchema,
  HarnessObserverRegistrationSchema,
} from "@/lib/agent/runtime/harness/lifecycle-contract";

describe("Unified Runtime Harness lifecycle contract", () => {
  it("records bounded events and returns defensive snapshots", () => {
    const sink = createInMemoryHarnessTraceSink();
    sink.record({ phase: "turn.before", status: "STARTED" });
    sink.record({
      phase: "capabilities.after",
      status: "SUCCEEDED",
      capabilitySetHash: "a".repeat(64),
    });
    const first = sink.snapshot();
    first[0]!.errorCode = "MUTATED";
    expect(sink.snapshot()).toEqual([
      { sequence: 1, phase: "turn.before", status: "STARTED" },
      {
        sequence: 2,
        phase: "capabilities.after",
        status: "SUCCEEDED",
        capabilitySetHash: "a".repeat(64),
      },
    ]);
  });

  it("rejects hidden payloads and non-observer registrations", () => {
    expect(() => HarnessEventSchema.parse({
      sequence: 1,
      phase: "model.before",
      status: "STARTED",
      prompt: "hidden prompt",
    })).toThrow();
    expect(() => HarnessObserverRegistrationSchema.parse({
      id: "unsafe",
      version: "1",
      authority: "DENY_GUARD",
      phases: ["turn.before"],
      priority: 0,
    })).toThrow();
  });
});

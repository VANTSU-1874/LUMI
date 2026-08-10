import { describe, expect, it } from "vitest";

import { createUnifiedRuntimeHarness } from "@/lib/agent/runtime/harness/unified-runtime-harness";

describe("Unified Runtime Harness lifecycle", () => {
  it("records lifecycle boundaries without granting observer authority", async () => {
    const observed: string[] = [];
    const harness = createUnifiedRuntimeHarness({
      mode: "ON",
      deadlineAtMs: performance.now() + 1_000,
      observers: [{
        id: "test-observer",
        version: "1",
        authority: "OBSERVER",
        phases: ["turn.before", "turn.after", "turn.finally"],
        priority: 0,
        observe(event) {
          observed.push(event.phase);
        },
      }],
    });

    await expect(harness.run(async () => "ok")).resolves.toBe("ok");
    expect(observed).toEqual(["turn.before", "turn.after", "turn.finally"]);
  });

  it("marks a failing turn without swallowing the original error", async () => {
    const harness = createUnifiedRuntimeHarness({
      mode: "SHADOW",
      deadlineAtMs: performance.now() + 1_000,
    });
    await expect(harness.run(async () => {
      throw new Error("expected failure");
    })).rejects.toThrow("expected failure");
  });
});

import { describe, expect, it } from "vitest";

import {
  assertSourceCanRunIntake,
  recentDesignSourceAdapterCandidate,
} from "@/lib/agent/inspiration-source-registry";

describe("inspiration source registry", () => {
  it("keeps the first Recent adapter disabled until a user explicitly activates it", () => {
    expect(recentDesignSourceAdapterCandidate).toMatchObject({
      scope: "PRIVATE_CANDIDATE_ONLY",
      operationalState: "DISABLED",
      schedule: { enabled: false },
      health: { status: "DISABLED" },
    });
    expect(() => assertSourceCanRunIntake(recentDesignSourceAdapterCandidate, "SCHEDULED"))
      .toThrow("Source is not enabled for intake.");
  });

  it("requires explicit scheduling and preserves the private-only boundary", () => {
    const source = {
      ...recentDesignSourceAdapterCandidate,
      operationalState: "READY" as const,
      schedule: { enabled: false, frequencyMinutes: null, nextRunAt: null },
    };
    expect(() => assertSourceCanRunIntake(source, "SCHEDULED"))
      .toThrow("Scheduled intake has not been explicitly enabled.");
    expect(() => assertSourceCanRunIntake(source, "MANUAL_BATCH")).not.toThrow();
  });
});

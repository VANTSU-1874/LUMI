// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  summarizePlannerLatencyDiagnosticV1,
  type PlannerLatencyCaseV1,
  type PlannerLatencyCallV1,
} from "@/scripts/diagnose-query-understanding-planner-latency-v1";

describe("query understanding planner latency diagnostic v1", () => {
  it("separates all-case latency from naturally completed calls", () => {
    const cases = [
      {
        status: "READY",
        elapsedMs: 30_000,
      },
      {
        status: "DEGRADED",
        elapsedMs: 120_000,
      },
    ] as PlannerLatencyCaseV1[];
    const calls: PlannerLatencyCallV1[] = [
      {
        caseId: "case-a",
        callIndex: 1,
        outcome: "RESOLVED",
        elapsedMs: 30_000,
      },
      {
        caseId: "case-b",
        callIndex: 1,
        outcome: "REJECTED",
        elapsedMs: 120_000,
      },
    ];

    expect(summarizePlannerLatencyDiagnosticV1({
      cases,
      calls,
    })).toEqual({
      sampleSize: 2,
      completedCaseCount: 1,
      degradedCaseCount: 1,
      caseAverageMs: 75_000,
      completedCaseAverageMs: 30_000,
      caseP50Ms: 30_000,
      caseP95Ms: 120_000,
      providerCallCount: 2,
      resolvedProviderCallCount: 1,
      rejectedProviderCallCount: 1,
      resolvedProviderCallAverageMs: 30_000,
      resolvedProviderCallP50Ms: 30_000,
      resolvedProviderCallP95Ms: 30_000,
    });
  });
});

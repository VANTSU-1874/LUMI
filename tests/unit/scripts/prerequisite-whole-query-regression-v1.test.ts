import { describe, expect, it } from "vitest";

import {
  evaluateT5EntryGateV1,
} from "@/scripts/audit-prerequisite-whole-query-regression-v1";

function passingInput() {
  return {
    prerequisiteDecision:
      "STATIC_CORPUS_ELIGIBLE",
    prerequisiteFailClosed: false,
    querySource: "WHOLE_QUERY",
    probeStatus: "SUCCESS",
    channelNames: [
      "LEXICAL",
      "TEXT_VECTOR",
      "VISUAL_VECTOR",
    ],
    expectedProviderCalls: 3,
    actualProviderCalls: 3,
    rrfCandidateObjectIds: [
      "object-a",
      "object-b",
    ],
    candidateNodeCount: 4,
    candidateCoursePackIds: [
      "layout-design",
      "layout-design",
      "layout-design",
      "layout-design",
    ],
    baselineObjectIds: [
      "object-a",
      "object-b",
    ],
  };
}

describe("T5 entry whole-query regression gate", () => {
  it("accepts a fully executed scoped baseline", () => {
    const report =
      evaluateT5EntryGateV1(passingInput());

    expect(report.decision).toBe(
      "T5_ENTRY_GO",
    );
    expect(Object.values(report.checks))
      .toEqual([
        true,
        true,
        true,
        true,
        true,
        true,
        true,
      ]);
  });

  it("rejects the historical skipped baseline shape", () => {
    const report =
      evaluateT5EntryGateV1({
        ...passingInput(),
        prerequisiteDecision:
          "USER_ASSET_REQUIRED",
        prerequisiteFailClosed: true,
        probeStatus: "SKIPPED_NON_STATIC",
        channelNames: [],
        expectedProviderCalls: 0,
        actualProviderCalls: 0,
        rrfCandidateObjectIds: [],
        candidateNodeCount: 0,
        candidateCoursePackIds: [],
        baselineObjectIds: [],
      });

    expect(report.decision).toBe(
      "T5_ENTRY_NO_GO",
    );
    expect(
      report.checks.prerequisiteStatic,
    ).toBe(false);
    expect(
      report.checks.allLocalChannelsCalled,
    ).toBe(false);
    expect(
      report.checks.boundedBaselineSelection,
    ).toBe(false);
  });

  it("rejects a provider call mismatch", () => {
    const report =
      evaluateT5EntryGateV1({
        ...passingInput(),
        actualProviderCalls: 2,
      });

    expect(report.decision).toBe(
      "T5_ENTRY_NO_GO",
    );
    expect(
      report.checks.allLocalChannelsCalled,
    ).toBe(false);
  });
});

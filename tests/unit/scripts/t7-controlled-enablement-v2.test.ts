// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  assertSafeT7ReportV2,
  assertT7DoubleRunCoverageGateV2,
  parseT7ControlledEnablementArguments,
  summarizeT7DoubleRunV2,
} from "@/scripts/audit-t7-controlled-enablement-v2";

function armResult(input: {
  caseId: string;
  legacyItemIds?: string[];
  v2NodeIds?: string[];
  unavailable?: boolean;
}) {
  return {
    caseId: input.caseId,
    coursePackId: "layout-design",
    queryHash: "a".repeat(64),
    sameQuestion: true,
    legacy: {
      strategy: "LEXICAL_FALLBACK",
      semanticStatus: "UNAVAILABLE",
      itemIds:
        input.legacyItemIds ?? [],
    },
    v2: {
      bundleStatus:
        input.unavailable
          ? "DEGRADED"
          : "SUCCESS",
      nodeIds: input.v2NodeIds ?? [],
      sourceIds: [],
      channels: [{
        channel: "TEXT_VECTOR",
        status:
          input.unavailable
            ? "UNAVAILABLE"
            : "SUCCESS",
        hitCount:
          input.v2NodeIds?.length ?? 0,
      }],
    },
  };
}

describe("T7 controlled enablement audit", () => {
  it("accepts only a fixed safe output name", () => {
    expect(
      parseT7ControlledEnablementArguments([
        "--output-name",
        "t7.5-acceptance.v2.json",
      ]),
    ).toEqual({
      outputName:
        "t7.5-acceptance.v2.json",
    });
    expect(() =>
      parseT7ControlledEnablementArguments([
        "--output-name",
        "../escape.json",
      ])).toThrow("usage:");
  });

  it("summarizes both arms without storing the question", () => {
    const report = summarizeT7DoubleRunV2([
      armResult({
        caseId: "case-a",
        legacyItemIds: ["legacy-a"],
        v2NodeIds: ["node-a"],
      }),
      armResult({
        caseId: "case-b",
        legacyItemIds: ["legacy-b"],
        unavailable: true,
      }),
    ]);

    expect(report).toMatchObject({
      caseCount: 2,
      legacyNonEmptyCount: 2,
      v2NonEmptyCount: 1,
      v2UnavailableCaseCount: 1,
    });
    expect(JSON.stringify(report))
      .not.toContain("question");
    expect(() =>
      assertT7DoubleRunCoverageGateV2(
        report,
      )).toThrow(
      "T7_V2_COVERAGE_REGRESSION",
    );
  });

  it("rejects locators and secrets from the final report", () => {
    expect(() =>
      assertSafeT7ReportV2({
        schemaVersion: 2,
        decision:
          "T7_LOCAL_ISOLATED_GO",
      })).toThrow();
    expect(() =>
      assertSafeT7ReportV2(
        {} as never,
        ["secret-fragment"],
      )).toThrow();
  });
});

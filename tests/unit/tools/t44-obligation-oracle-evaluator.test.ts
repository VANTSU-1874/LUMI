// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  T44_OBLIGATION_ORACLE_GATES_V1,
  evaluateT44ObligationOracleV1,
  type T44ObligationOracleCaseV1,
} from "@/tools/mixed-retrieval/t44-obligation-oracle-evaluator";

const COURSE_PACKS = [
  "book-design",
  "brand-vi-design",
  "digital-interaction",
  "general-design",
  "layout-design",
] as const;

function oracleCases(): T44ObligationOracleCaseV1[] {
  return COURSE_PACKS.flatMap((coursePackId, packIndex) =>
    Array.from({ length: 10 }, (_, localIndex) => {
      const globalIndex = packIndex * 10 + localIndex;
      const caseId = `oracle-${coursePackId}-${localIndex + 1}`;
      const requiredNodeId = `node-required-${globalIndex + 1}`;
      const distractorNodeId =
        `node-distractor-${globalIndex + 1}`;
      return {
        caseId,
        coursePackId,
        multiClaim: localIndex < 2,
        requiredEvidenceGroups: [{
          groupId: `group-${globalIndex + 1}`,
          acceptableNodeIds: [requiredNodeId],
        }],
        aCandidateNodeIds: [
          requiredNodeId,
          distractorNodeId,
        ],
        bCandidateNodeIds: [
          requiredNodeId,
          distractorNodeId,
        ],
        aSelectedNodeIds: globalIndex < 30
          ? [requiredNodeId]
          : [distractorNodeId],
        bSelectedNodeIds: globalIndex < 25
          ? [requiredNodeId]
          : [distractorNodeId],
      };
    }),
  );
}

describe("T4.4 obligation candidate and selection oracle", () => {
  it("freezes feasibility gates before legacy output is inspected", () => {
    expect(T44_OBLIGATION_ORACLE_GATES_V1).toEqual({
      totalCases: 50,
      supportCaseCoverageMinimum: 45,
      multiClaimTotal: 10,
      multiClaimCoverageMinimum: 9,
    });
  });

  it("separates candidate reachability from current selection loss", () => {
    const result = evaluateT44ObligationOracleV1({
      cases: oracleCases(),
    });

    expect(result.decision)
      .toBe("SELECTION_REPAIR_FEASIBLE");
    expect(result.pools.B_CANDIDATE.caseCoverage)
      .toBe(50);
    expect(result.pools.B_SELECTION.caseCoverage)
      .toBe(25);
    expect(result.pools.A_SELECTION.caseCoverage)
      .toBe(30);
    expect(
      result.pools.BASELINE_PROTECTED_CANDIDATE
        .caseCoverage,
    ).toBe(50);
    expect(result.pools.UNION_SELECTION.caseCoverage)
      .toBe(30);
    expect(
      result.gates.baselineProtectedCandidateSupport
        .passed,
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /acceptableNodeIds|node-required|node-distractor/,
    );
  });

  it("stops when six baseline-protected cases lack a required group", () => {
    const cases = oracleCases();
    for (const testCase of cases.slice(44)) {
      testCase.bCandidateNodeIds = [
        testCase.bCandidateNodeIds[1]!,
      ];
    }

    const result = evaluateT44ObligationOracleV1({
      cases,
    });

    expect(
      result.pools.BASELINE_PROTECTED_CANDIDATE
        .caseCoverage,
    ).toBe(44);
    expect(
      result.gates.baselineProtectedCandidateSupport,
    ).toMatchObject({
      observed: 44,
      required: 45,
      passed: false,
    });
    expect(result.decision)
      .toBe("FIRST_STAGE_RECALL_NO_GO");
  });

  it("stops when baseline-protected multi-claim coverage is only eight", () => {
    const cases = oracleCases();
    for (const index of [30, 31]) {
      const testCase = cases[index]!;
      testCase.bCandidateNodeIds = [
        testCase.bCandidateNodeIds[1]!,
      ];
    }

    const result = evaluateT44ObligationOracleV1({
      cases,
    });

    expect(
      result.pools.BASELINE_PROTECTED_CANDIDATE
        .multiClaim,
    ).toEqual({
      total: 10,
      caseCoverage: 8,
    });
    expect(
      result.gates.baselineProtectedCandidateMulti
        .passed,
    ).toBe(false);
    expect(result.decision)
      .toBe("FIRST_STAGE_RECALL_NO_GO");
  });

  it("rejects a selected node outside its corresponding candidate pool", () => {
    const cases = oracleCases();
    cases[0]!.bSelectedNodeIds = ["node-outside"];

    expect(() =>
      evaluateT44ObligationOracleV1({
        cases,
      }),
    ).toThrow(
      /T44_OBLIGATION_ORACLE_B_SELECTION_NOT_IN_CANDIDATE/,
    );
  });
});

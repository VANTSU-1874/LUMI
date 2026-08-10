import { describe, expect, it } from "vitest";

import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  evaluateT45CandidateStructuralReadinessV1,
} from "@/tools/mixed-retrieval/t45-candidate-structural-gates-v1";

const nodeId = `node-${"a".repeat(64)}`;
const secondNodeId = `node-${"b".repeat(64)}`;
const batch = {
  schemaVersion: 1,
  kind: "DIRECT_EVIDENCE_BATCH",
  results: [{ id: "whole-query" }],
};
const rrf = {
  schemaVersion: 1,
  kind: "OBLIGATION_RRF",
  candidates: [{ nodeId }],
};
const arm = {
  directEvidenceBatchHash:
    sha256StableJsonV2(batch),
  rrfResultHash: sha256StableJsonV2(rrf),
  candidateNodeIdsSha256:
    sha256StableJsonV2([nodeId]),
  candidateNodes: [{ nodeId }],
};

function fixture() {
  return {
    candidate: {
      providerAudit: {
        expectedCalls: 3,
        actualCalls: 3,
        matched: true,
      },
      cases: [{
        caseId: "case-one",
        arms: {
          A_WHOLE_QUERY: arm,
          B_MODEL_GUIDED: arm,
        },
      }],
    },
    selection: {
      cases: [{
        caseId: "case-one",
        arms: {
          A_WHOLE_QUERY: {
            selected: [{
              nodeId,
              selectionSource: "RRF_FILL",
            }],
          },
          B_MODEL_GUIDED: {
            selected: [{
              nodeId,
              selectionSource:
                "WHOLE_QUERY_BASELINE",
            }],
          },
        },
      }],
    },
    provider: {
      expectedCalls: 3,
      actualCalls: 3,
      matched: true,
      cases: [{
        caseId: "case-one",
        A_WHOLE_QUERY: {
          status: "EXECUTED",
          expectedProviderCalls: 3,
          actualProviderCalls: 3,
          batch,
          rrf,
        },
        B_MODEL_GUIDED: {
          status: "CLARIFY",
          retrievalMode: "BASELINE_REUSED",
          expectedProviderCalls: 0,
          actualProviderCalls: 0,
          batch,
          rrf,
        },
      }],
    },
  };
}

describe("T45 candidate structural gates v1", () => {
  it("passes baseline presence, protected anchors and single-count reuse", () => {
    const report =
      evaluateT45CandidateStructuralReadinessV1(
        fixture(),
      );

    expect(report.gates).toEqual({
      baselineAvailable: {
        observedCases: 1,
        requiredCases: 1,
        passed: true,
      },
      protectedAnchors: {
        observedCases: 1,
        requiredCases: 1,
        minimumPerCase: 1,
        maximumPerCase: 8,
        passed: true,
      },
      baselineSingleCount: {
        observedCases: 1,
        requiredCases: 1,
        passed: true,
      },
    });
    expect(report.passed).toBe(true);
  });

  it("accepts the selector's protected leading subset without counting the reused baseline twice", () => {
    const input = fixture();
    for (
      const armName
      of ["A_WHOLE_QUERY", "B_MODEL_GUIDED"] as const
    ) {
      const candidateArm =
        input.candidate.cases[0]!.arms[armName];
      candidateArm.candidateNodes = [
        { nodeId },
        { nodeId: secondNodeId },
      ];
      candidateArm.candidateNodeIdsSha256 =
        sha256StableJsonV2([
          nodeId,
          secondNodeId,
        ]);
    }
    input.selection.cases[0]!
      .arms.A_WHOLE_QUERY.selected.push({
        nodeId: secondNodeId,
        selectionSource: "RRF_FILL",
      });

    expect(
      evaluateT45CandidateStructuralReadinessV1(
        input,
      ).gates.baselineSingleCount.passed,
    ).toBe(true);

    input.selection.cases[0]!
      .arms.B_MODEL_GUIDED.selected[0]!.nodeId =
      secondNodeId;
    expect(
      evaluateT45CandidateStructuralReadinessV1(
        input,
      ).gates.baselineSingleCount.passed,
    ).toBe(false);
  });

  it("fails all three conditions independently", () => {
    const missingBaseline = fixture();
    missingBaseline.candidate.cases[0]!
      .arms.A_WHOLE_QUERY.candidateNodes = [];
    missingBaseline.selection.cases[0]!
      .arms.A_WHOLE_QUERY.selected = [];
    expect(
      evaluateT45CandidateStructuralReadinessV1(
        missingBaseline,
      ).gates.baselineAvailable.passed,
    ).toBe(false);

    const missingProtected = fixture();
    missingProtected.selection.cases[0]!
      .arms.B_MODEL_GUIDED.selected = [];
    expect(
      evaluateT45CandidateStructuralReadinessV1(
        missingProtected,
      ).gates.protectedAnchors.passed,
    ).toBe(false);

    const doubleCounted = fixture();
    doubleCounted.provider.expectedCalls = 6;
    doubleCounted.candidate.providerAudit
      .expectedCalls = 6;
    expect(
      evaluateT45CandidateStructuralReadinessV1(
        doubleCounted,
      ).gates.baselineSingleCount.passed,
    ).toBe(false);
  });
});

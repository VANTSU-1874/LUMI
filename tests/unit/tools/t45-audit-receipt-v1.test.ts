// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  T44_CONTENT_RERANKER_CONFIG_HASH_V1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1,
} from "@/tools/mixed-retrieval/t45-candidate-oracle-gate-v1";
import {
  sealT45AuditReceiptV1,
  verifyT45AuditReceiptV1,
} from "@/tools/mixed-retrieval/t45-audit-receipt-v1";

const H = "a".repeat(64);

function inputs(
  oracleGateSha256: string | null,
) {
  return {
    selectionSha256: H,
    draftSelectionSha256: H,
    oracleGateSha256,
    freezeHash: H,
    source: {
      boundarySha256: H,
      plannerSha256: H,
      candidateSha256: H,
      matrixSha256: H,
      baselineSelectionSha256: H,
      oracleGateSha256,
    },
  };
}

describe("T45 audit receipt", () => {
  it("seals and verifies an aggregate-only capability receipt", () => {
    const receipt = sealT45AuditReceiptV1({
      schemaVersion: 1,
      kind: "T45_AUDIT_RECEIPT",
      split: "VALIDATION",
      runId: "validation-v1",
      artifactId: "validation-v1",
      decision: "VALIDATION_GO",
      inputs: inputs(H),
      reportSha256: H,
      sourceClosureHash: H,
      evaluatorConfigHash:
        T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1,
      aggregate: {
        kind: "CAPABILITY",
        cases: 20,
        requiredGroups: 30,
        multiCases: 10,
        families: 10,
        supportCases: 20,
        requiredGroupsCovered: 30,
        multiJointCoverage: 10,
        familiesWithBothCasesSupported: 10,
        hardNegativeNodes: 0,
        hardNegativeCases: 0,
        aBaselineHardNegativeNodes: 0,
        aBaselineHardNegativeCases: 0,
        validSelections: 20,
        bindingViolations: 0,
        reviewerP95Ms: 1,
      },
    });
    expect(
      verifyT45AuditReceiptV1(receipt),
    ).toEqual(receipt);
    expect(receipt).not.toHaveProperty("cases");
    expect(receipt).not.toHaveProperty("qrels");
  });

  it("rejects truncated, cross-domain, and hash-tampered receipts", () => {
    expect(() =>
      sealT45AuditReceiptV1({
        schemaVersion: 1,
        kind: "T45_AUDIT_RECEIPT",
        split: "LEGACY_REGRESSION",
        runId: "legacy-v2",
        artifactId: "legacy-regression-v1",
        decision:
          "LEGACY_REGRESSION_NONREGRESSION_ONLY",
        inputs: inputs(null),
        reportSha256: H,
        sourceClosureHash: H,
        evaluatorConfigHash:
          T44_CONTENT_RERANKER_CONFIG_HASH_V1,
        aggregate: {
          kind: "CAPABILITY",
          cases: 20,
          requiredGroups: 30,
          multiCases: 10,
          families: 10,
          supportCases: 20,
          requiredGroupsCovered: 30,
          multiJointCoverage: 10,
          familiesWithBothCasesSupported: 10,
          hardNegativeNodes: 0,
          hardNegativeCases: 0,
          aBaselineHardNegativeNodes: 0,
          aBaselineHardNegativeCases: 0,
          validSelections: 20,
          bindingViolations: 0,
          reviewerP95Ms: 1,
        },
      }),
    ).toThrow("T45_AUDIT_RECEIPT_DOMAIN_DRIFT");

    const legacy = sealT45AuditReceiptV1({
      schemaVersion: 1,
      kind: "T45_AUDIT_RECEIPT",
      split: "LEGACY_REGRESSION",
      runId: "legacy-v2",
      artifactId: "legacy-regression-v1",
      decision:
        "LEGACY_REGRESSION_NONREGRESSION_ONLY",
      inputs: inputs(null),
      reportSha256: H,
      sourceClosureHash: H,
      evaluatorConfigHash:
        T44_CONTENT_RERANKER_CONFIG_HASH_V1,
      aggregate: {
        kind: "LEGACY",
        cases: 50,
        requiredGroups: 97,
        multiCases: 10,
        supportCases: 43,
        requiredGroupsCovered: 89,
        multiCoverage: 9,
        hardNegativeNodes: 20,
        hardNegativeCases: 20,
        aBaselineHardNegativeNodes: 22,
        aBaselineHardNegativeCases: 22,
        validSelections: 50,
        bindingViolations: 0,
        p95Ms: 23_518,
      },
    });
    expect(() =>
      verifyT45AuditReceiptV1({
        ...legacy,
        reportSha256: "b".repeat(64),
      }),
    ).toThrow("T45_AUDIT_RECEIPT_HASH_DRIFT");
    expect(() =>
      verifyT45AuditReceiptV1({
        decision: legacy.decision,
      }),
    ).toThrow();
  });
});

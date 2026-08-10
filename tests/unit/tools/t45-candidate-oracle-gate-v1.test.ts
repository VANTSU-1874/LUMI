import { describe, expect, it } from "vitest";

import {
  T45_BASELINE_SELECTOR_CONFIG_HASH_LOCK_V2,
  T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1,
  T45CandidateOracleGateV1Schema,
  assertT45CandidateOracleReadyForSelection,
  sealT45CandidateOracleGateV1,
  verifyT45CandidateOracleGateV1,
} from "@/tools/mixed-retrieval/t45-candidate-oracle-gate-v1";

const HASH = "a".repeat(64);

function candidateOracle(input: {
  casesCovered?: number;
  groupsCovered?: number;
  structuralPassed?: boolean;
} = {}) {
  const casesCovered = input.casesCovered ?? 20;
  const groupsCovered = input.groupsCovered ?? 30;
  const structuralPassed =
    input.structuralPassed ?? true;
  const structuralCases =
    structuralPassed ? 20 : 19;
  const coveragePassed =
    casesCovered === 20 && groupsCovered === 30;
  return {
    casesCovered,
    casesTotal: 20 as const,
    groupsCovered,
    groupsTotal: 30 as const,
    coveragePassed,
    structuralGates: {
      baselineAvailableCases: structuralCases,
      protectedAnchorCases: structuralCases,
      baselineSingleCountCases: structuralCases,
      casesTotal: 20 as const,
      passed: structuralPassed,
    },
    passed: coveragePassed && structuralPassed,
  };
}

function gateFixture(
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 1 as const,
    kind:
      "T45_CAPABILITY_CANDIDATE_ORACLE_GATE" as const,
    split: "CALIBRATION" as const,
    runId: "calibration-v1",
    runtimeSuite: {
      id: "lumi-t45-capability-calibration-runtime",
      version: "2026-07-29.1",
      suiteHash: HASH,
    },
    inventoryHash: HASH,
    corpusBundleHash: HASH,
    inputs: {
      boundarySha256: HASH,
      plannerSha256: HASH,
      candidateSha256: HASH,
      matrixSha256: HASH,
      baselineSelectionSha256: HASH,
      oracleReportSha256: HASH,
    },
    selectorConfigHash:
      T45_BASELINE_SELECTOR_CONFIG_HASH_LOCK_V2,
    candidateOracle: candidateOracle(),
    decision:
      "CALIBRATION_CANDIDATE_READY" as const,
    evaluatorConfigHash:
      T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1,
    ...overrides,
  };
}

describe("T45 candidate oracle gate v1", () => {
  it("seals a label-blind aggregate gate and verifies its canonical hash", () => {
    const sealed =
      sealT45CandidateOracleGateV1(gateFixture());
    const verified =
      verifyT45CandidateOracleGateV1(sealed);

    expect(
      T45CandidateOracleGateV1Schema.parse(
        verified,
      ).gateHash,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(
      JSON.stringify(verified),
    ).not.toMatch(
      /requiredEvidenceGroups|acceptableNodeIds|hardNegativeNodeIds|missingGroupIds|families|cases":\[/,
    );
  });

  it("rejects a re-signed decision/pass mismatch and any hash drift", () => {
    expect(() =>
      sealT45CandidateOracleGateV1(gateFixture({
        decision:
          "CALIBRATION_CANDIDATE_NO_GO",
      })),
    ).toThrow(
      "T45_CANDIDATE_ORACLE_GATE_DECISION_DRIFT",
    );

    const sealed =
      sealT45CandidateOracleGateV1(gateFixture());
    expect(() =>
      verifyT45CandidateOracleGateV1({
        ...sealed,
        inventoryHash: "b".repeat(64),
      }),
    ).toThrow(
      "T45_CANDIDATE_ORACLE_GATE_HASH_DRIFT",
    );
  });

  it("blocks NO-GO and keeps split-specific stable errors", () => {
    const ready =
      verifyT45CandidateOracleGateV1(
        sealT45CandidateOracleGateV1(
          gateFixture(),
        ),
      );
    expect(
      assertT45CandidateOracleReadyForSelection(
        ready,
      ),
    ).toBe(ready);

    const calibrationNoGo =
      sealT45CandidateOracleGateV1(gateFixture({
        candidateOracle: candidateOracle({
          casesCovered: 19,
          groupsCovered: 29,
        }),
        decision:
          "CALIBRATION_CANDIDATE_NO_GO",
      }));
    expect(() =>
      assertT45CandidateOracleReadyForSelection(
        calibrationNoGo,
      ),
    ).toThrow(
      "T45_CALIBRATION_CANDIDATE_NO_GO_SELECTION_FORBIDDEN",
    );

    const structuralNoGo =
      sealT45CandidateOracleGateV1(gateFixture({
        candidateOracle: candidateOracle({
          structuralPassed: false,
        }),
        decision:
          "CALIBRATION_CANDIDATE_NO_GO",
      }));
    expect(
      structuralNoGo.candidateOracle.coveragePassed,
    ).toBe(true);
    expect(() =>
      assertT45CandidateOracleReadyForSelection(
        structuralNoGo,
      ),
    ).toThrow(
      "T45_CALIBRATION_CANDIDATE_NO_GO_SELECTION_FORBIDDEN",
    );

    const validationNoGo =
      sealT45CandidateOracleGateV1(gateFixture({
        split: "VALIDATION",
        runId: "validation-v1",
        decision:
          "VALIDATION_CANDIDATE_NO_GO",
        candidateOracle: candidateOracle({
          casesCovered: 19,
          groupsCovered: 29,
        }),
      }));
    expect(() =>
      assertT45CandidateOracleReadyForSelection(
        validationNoGo,
      ),
    ).toThrow(
      "T45_VALIDATION_CANDIDATE_NO_GO_SELECTION_FORBIDDEN",
    );
  });
});

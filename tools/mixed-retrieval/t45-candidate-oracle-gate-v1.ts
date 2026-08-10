import { z } from "zod";

import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const IdSchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
);
const RunIdSchema = z.string().regex(
  /^(?:calibration-v[1-9][0-9]*|validation-v1)$/,
);

export const T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1 =
  "80fff763f8cc69663b1dbe530f91b4a6181cc08e30de36bc0152a6d9a13cb2aa";
export const T45_BASELINE_SELECTOR_CONFIG_HASH_LOCK_V2 =
  "a7b447e22e1019ad166c9b517c1dce53ab60934c02065795e84984c6f8b24731";

const CandidateOracleSchema = z
  .object({
    casesCovered: z.number().int().min(0).max(20),
    casesTotal: z.literal(20),
    groupsCovered: z.number().int().min(0).max(30),
    groupsTotal: z.literal(30),
    coveragePassed: z.boolean(),
    structuralGates: z.object({
      baselineAvailableCases:
        z.number().int().min(0).max(20),
      protectedAnchorCases:
        z.number().int().min(0).max(20),
      baselineSingleCountCases:
        z.number().int().min(0).max(20),
      casesTotal: z.literal(20),
      passed: z.boolean(),
    }).strict(),
    passed: z.boolean(),
  })
  .strict()
  .superRefine((oracle, context) => {
    const coveragePassed =
      oracle.casesCovered === oracle.casesTotal
      && oracle.groupsCovered
        === oracle.groupsTotal;
    const structuralPassed =
      oracle.structuralGates
        .baselineAvailableCases
        === oracle.structuralGates.casesTotal
      && oracle.structuralGates
        .protectedAnchorCases
        === oracle.structuralGates.casesTotal
      && oracle.structuralGates
        .baselineSingleCountCases
        === oracle.structuralGates.casesTotal;
    if (
      oracle.coveragePassed !== coveragePassed
      || oracle.structuralGates.passed
        !== structuralPassed
      || oracle.passed
        !== (coveragePassed && structuralPassed)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "T45_CANDIDATE_ORACLE_GATE_PASS_DRIFT",
      });
    }
  });

const GateProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T45_CAPABILITY_CANDIDATE_ORACLE_GATE",
    ),
    split: z.enum(["CALIBRATION", "VALIDATION"]),
    runId: RunIdSchema,
    runtimeSuite: z
      .object({
        id: IdSchema,
        version: z.string().trim().min(1).max(50),
        suiteHash: HashSchema,
      })
      .strict(),
    inventoryHash: HashSchema,
    corpusBundleHash: HashSchema,
    inputs: z
      .object({
        boundarySha256: HashSchema,
        plannerSha256: HashSchema,
        candidateSha256: HashSchema,
        matrixSha256: HashSchema,
        baselineSelectionSha256: HashSchema,
        oracleReportSha256: HashSchema,
      })
      .strict(),
    selectorConfigHash: HashSchema,
    candidateOracle: CandidateOracleSchema,
    decision: z.enum([
      "CALIBRATION_CANDIDATE_READY",
      "CALIBRATION_CANDIDATE_NO_GO",
      "VALIDATION_CANDIDATE_READY",
      "VALIDATION_CANDIDATE_NO_GO",
    ]),
    evaluatorConfigHash: HashSchema,
  })
  .strict()
  .superRefine((gate, context) => {
    const prefix = gate.split === "CALIBRATION"
      ? "CALIBRATION"
      : "VALIDATION";
    const expectedDecision =
      `${prefix}_CANDIDATE_${
        gate.candidateOracle.passed
          ? "READY"
          : "NO_GO"
      }`;
    const expectedRun = gate.split === "VALIDATION"
      ? gate.runId === "validation-v1"
      : gate.runId.startsWith("calibration-v");
    if (
      gate.decision !== expectedDecision
      || !expectedRun
      || gate.selectorConfigHash
        !== T45_BASELINE_SELECTOR_CONFIG_HASH_LOCK_V2
      || gate.evaluatorConfigHash
        !== T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1
    ) {
      context.addIssue({
        code: "custom",
        message:
          "T45_CANDIDATE_ORACLE_GATE_DECISION_DRIFT",
      });
    }
  });

export const T45CandidateOracleGateV1Schema =
  GateProjectionSchema.extend({
    gateHash: HashSchema,
  }).strict();

export type T45CandidateOracleGateV1 = z.infer<
  typeof T45CandidateOracleGateV1Schema
>;

export type T45CandidateOracleReadinessV1 = Pick<
  T45CandidateOracleGateV1,
  "split" | "candidateOracle"
>;

export function sealT45CandidateOracleGateV1(
  input: z.input<typeof GateProjectionSchema>,
): T45CandidateOracleGateV1 {
  const projection = GateProjectionSchema.parse(input);
  return T45CandidateOracleGateV1Schema.parse({
    ...projection,
    gateHash: sha256StableJsonV2(projection),
  });
}

export function verifyT45CandidateOracleGateV1(
  input: unknown,
): T45CandidateOracleGateV1 {
  const gate =
    T45CandidateOracleGateV1Schema.parse(input);
  const {
    gateHash,
    ...projection
  } = gate;
  if (
    sha256StableJsonV2(projection) !== gateHash
  ) {
    throw new Error(
      "T45_CANDIDATE_ORACLE_GATE_HASH_DRIFT",
    );
  }
  return gate;
}

export function assertT45CandidateOracleReadyForSelection<
  T extends T45CandidateOracleReadinessV1,
>(report: T): T {
  if (report.candidateOracle.passed) {
    return report;
  }
  if (report.split === "VALIDATION") {
    throw new Error(
      "T45_VALIDATION_CANDIDATE_NO_GO_SELECTION_FORBIDDEN",
    );
  }
  throw new Error(
    "T45_CALIBRATION_CANDIDATE_NO_GO_SELECTION_FORBIDDEN",
  );
}

import { z } from "zod";

import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  T44_CONTENT_RERANKER_CONFIG_HASH_V1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1,
} from "@/tools/mixed-retrieval/t45-candidate-oracle-gate-v1";

const HashSchema = z.string().regex(
  /^[0-9a-f]{64}$/,
);
const IdSchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
);

const SourceSchema = z.object({
  boundarySha256: HashSchema,
  plannerSha256: HashSchema,
  candidateSha256: HashSchema,
  matrixSha256: HashSchema,
  baselineSelectionSha256: HashSchema,
  oracleGateSha256: HashSchema.nullable(),
}).strict();

const CapabilityAggregateSchema = z.object({
  kind: z.literal("CAPABILITY"),
  cases: z.literal(20),
  requiredGroups: z.literal(30),
  multiCases: z.literal(10),
  families: z.literal(10),
  supportCases: z.number().int().min(0).max(20),
  requiredGroupsCovered:
    z.number().int().min(0).max(30),
  multiJointCoverage:
    z.number().int().min(0).max(10),
  familiesWithBothCasesSupported:
    z.number().int().min(0).max(10),
  hardNegativeNodes:
    z.number().int().nonnegative(),
  hardNegativeCases:
    z.number().int().min(0).max(20),
  aBaselineHardNegativeNodes:
    z.number().int().nonnegative(),
  aBaselineHardNegativeCases:
    z.number().int().min(0).max(20),
  validSelections:
    z.number().int().min(0).max(20),
  bindingViolations:
    z.number().int().nonnegative(),
  reviewerP95Ms:
    z.number().finite().nonnegative(),
}).strict();

const LegacyAggregateSchema = z.object({
  kind: z.literal("LEGACY"),
  cases: z.literal(50),
  requiredGroups: z.literal(97),
  multiCases: z.literal(10),
  supportCases: z.number().int().min(0).max(50),
  requiredGroupsCovered:
    z.number().int().min(0).max(97),
  multiCoverage:
    z.number().int().min(0).max(10),
  hardNegativeNodes:
    z.number().int().nonnegative(),
  hardNegativeCases:
    z.number().int().min(0).max(50),
  aBaselineHardNegativeNodes:
    z.number().int().nonnegative(),
  aBaselineHardNegativeCases:
    z.number().int().min(0).max(50),
  validSelections:
    z.number().int().min(0).max(50),
  bindingViolations:
    z.number().int().nonnegative(),
  p95Ms: z.number().finite().nonnegative(),
}).strict();

const ReceiptProjectionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("T45_AUDIT_RECEIPT"),
  split: z.enum([
    "CALIBRATION",
    "VALIDATION",
    "LEGACY_REGRESSION",
  ]),
  runId: IdSchema,
  artifactId: IdSchema,
  decision: z.enum([
    "CALIBRATION_GO",
    "CALIBRATION_NO_GO",
    "VALIDATION_GO",
    "VALIDATION_SELECTOR_NO_GO",
    "LEGACY_REGRESSION_RECOVERED",
    "LEGACY_REGRESSION_NONREGRESSION_ONLY",
    "LEGACY_REGRESSION_NO_GO",
  ]),
  inputs: z.object({
    selectionSha256: HashSchema,
    draftSelectionSha256: HashSchema,
    oracleGateSha256: HashSchema.nullable(),
    freezeHash: HashSchema.nullable(),
    source: SourceSchema,
  }).strict(),
  reportSha256: HashSchema,
  sourceClosureHash: HashSchema,
  evaluatorConfigHash: HashSchema,
  aggregate: z.union([
    CapabilityAggregateSchema,
    LegacyAggregateSchema,
  ]),
}).strict().superRefine((receipt, context) => {
  const capability =
    receipt.split !== "LEGACY_REGRESSION";
  const expectedEvaluatorConfigHash = capability
    ? T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1
    : T44_CONTENT_RERANKER_CONFIG_HASH_V1;
  const expectedDecisionPrefix =
    receipt.split === "CALIBRATION"
      ? "CALIBRATION_"
      : receipt.split === "VALIDATION"
        ? "VALIDATION_"
        : "LEGACY_REGRESSION_";
  const expectedDecision = (
    receipt.aggregate.kind === "CAPABILITY"
      ? (
          receipt.aggregate.supportCases >= 18
          && receipt.aggregate
            .requiredGroupsCovered >= 28
          && receipt.aggregate
            .multiJointCoverage >= 9
          && receipt.aggregate
            .familiesWithBothCasesSupported >= 9
          && receipt.aggregate.hardNegativeNodes
            <= receipt.aggregate
              .aBaselineHardNegativeNodes
          && receipt.aggregate.hardNegativeCases
            <= receipt.aggregate
              .aBaselineHardNegativeCases
          && receipt.aggregate.validSelections === 20
          && receipt.aggregate.bindingViolations === 0
          && receipt.aggregate.reviewerP95Ms <= 30_000
        )
        ? receipt.split === "CALIBRATION"
          ? "CALIBRATION_GO"
          : "VALIDATION_GO"
        : receipt.split === "CALIBRATION"
          ? "CALIBRATION_NO_GO"
          : "VALIDATION_SELECTOR_NO_GO"
      : (
          receipt.aggregate.multiCoverage >= 9
          && receipt.aggregate.hardNegativeNodes
            <= receipt.aggregate
              .aBaselineHardNegativeNodes
          && receipt.aggregate.hardNegativeCases
            <= receipt.aggregate
              .aBaselineHardNegativeCases
          && receipt.aggregate.validSelections === 50
          && receipt.aggregate.bindingViolations === 0
          && receipt.aggregate.p95Ms <= 30_000
        )
        ? receipt.aggregate.supportCases >= 45
          ? "LEGACY_REGRESSION_RECOVERED"
          : receipt.aggregate.supportCases >= 43
            ? "LEGACY_REGRESSION_NONREGRESSION_ONLY"
            : "LEGACY_REGRESSION_NO_GO"
        : "LEGACY_REGRESSION_NO_GO"
  );
  if (
    receipt.evaluatorConfigHash
      !== expectedEvaluatorConfigHash
    || capability
      !== (receipt.aggregate.kind === "CAPABILITY")
    || !receipt.decision.startsWith(
      expectedDecisionPrefix,
    )
    || receipt.decision !== expectedDecision
  ) {
    context.addIssue({
      code: "custom",
      message:
        "T45_AUDIT_RECEIPT_DOMAIN_DRIFT",
    });
  }
});

export const T45AuditReceiptV1Schema =
  ReceiptProjectionSchema.extend({
    receiptHash: HashSchema,
  }).strict();

export type T45AuditReceiptV1 = z.infer<
  typeof T45AuditReceiptV1Schema
>;

export function sealT45AuditReceiptV1(
  input: z.input<typeof ReceiptProjectionSchema>,
) {
  const projection =
    ReceiptProjectionSchema.parse(input);
  return T45AuditReceiptV1Schema.parse({
    ...projection,
    receiptHash:
      sha256StableJsonV2(projection),
  });
}

export function verifyT45AuditReceiptV1(
  input: unknown,
) {
  const receipt =
    T45AuditReceiptV1Schema.parse(input);
  const {
    receiptHash,
    ...projection
  } = receipt;
  if (
    sha256StableJsonV2(projection)
      !== receiptHash
  ) {
    throw new Error(
      "T45_AUDIT_RECEIPT_HASH_DRIFT",
    );
  }
  return receipt;
}

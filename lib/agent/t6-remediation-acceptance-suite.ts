import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { z } from "zod";

import {
  CURRENT_TUTOR_QUALITY_RUBRIC_VERSION,
  TUTOR_QUALITY_HARD_FAILURE_IDS,
  TutorQualityCaseSchema,
  TutorQualityRubricSchema,
} from "./tutor-quality-suite";

export const T6_REMEDIATION_ACCEPTANCE_CASE_COUNT = 12;
export const CURRENT_T6_REMEDIATION_ACCEPTANCE_SUITE_VERSION = "2026-07-30.2";
export const CURRENT_T6_REMEDIATION_ACCEPTANCE_SUITE_HASH =
  "d8dc8002c83b548907a51f1272d7dd559f540e08def5c242004ac516e02f1b32";

export const T6RemediationAcceptanceFocusSchema = z.enum([
  "HEALTHY_EMPTY_BASELINE",
  "POSITIVE_V2_EVIDENCE",
  "NUMERIC_BOUNDARY",
  "CONSENTED_WEB_SEQUENCE",
]);

export const T6RemediationExpectedV2ObservationSchema = z.enum([
  "EMPTY",
  "SUCCESS",
  "ANY_HEALTHY",
]);

const HardFailureSchema = z.object({
  id: z.enum(TUTOR_QUALITY_HARD_FAILURE_IDS),
  description: z.string().trim().min(24).max(800),
}).strict();

const AcceptanceCaseSchema = z.object({
  case: TutorQualityCaseSchema,
  acceptanceFocus: z.array(T6RemediationAcceptanceFocusSchema).min(1).max(2),
  knowledgeObjectIds: z.array(
    z.string().regex(/^[a-z0-9-]+$/),
  ).min(1).max(3),
  expectedV2Observation: T6RemediationExpectedV2ObservationSchema,
}).strict().superRefine((acceptanceCase, context) => {
  const focuses = new Set(acceptanceCase.acceptanceFocus);
  if (
    focuses.has("CONSENTED_WEB_SEQUENCE")
    !== acceptanceCase.case.webSearchConsent
  ) {
    context.addIssue({
      code: "custom",
      path: ["case", "webSearchConsent"],
      message: "web consent must match the consented web acceptance focus",
    });
  }
  if (
    focuses.has("HEALTHY_EMPTY_BASELINE")
    && acceptanceCase.expectedV2Observation !== "EMPTY"
  ) {
    context.addIssue({
      code: "custom",
      path: ["expectedV2Observation"],
      message: "healthy empty baseline cases must freeze an EMPTY observation",
    });
  }
  if (
    focuses.has("POSITIVE_V2_EVIDENCE")
    && acceptanceCase.expectedV2Observation !== "SUCCESS"
  ) {
    context.addIssue({
      code: "custom",
      path: ["expectedV2Observation"],
      message: "positive V2 evidence cases must freeze a SUCCESS observation",
    });
  }
});

export const T6RemediationAcceptanceSuiteSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal("t6-post-empty-professional-remediation-v1"),
  version: z.literal(CURRENT_T6_REMEDIATION_ACCEPTANCE_SUITE_VERSION),
  rubricVersion: z.literal(CURRENT_TUTOR_QUALITY_RUBRIC_VERSION),
  description: z.string().trim().min(24).max(1_000),
  scoringDimensions: TutorQualityRubricSchema,
  hardFailures: z.array(HardFailureSchema).length(
    TUTOR_QUALITY_HARD_FAILURE_IDS.length,
  ),
  cases: z.array(AcceptanceCaseSchema).length(
    T6_REMEDIATION_ACCEPTANCE_CASE_COUNT,
  ),
}).strict().superRefine((suite, context) => {
  const caseIds = suite.cases.map(({ case: qualityCase }) => qualityCase.id);
  if (new Set(caseIds).size !== caseIds.length) {
    context.addIssue({
      code: "custom",
      path: ["cases"],
      message: "acceptance case ids must be unique",
    });
  }
  const hardFailureIds = new Set(suite.hardFailures.map(({ id }) => id));
  if (
    hardFailureIds.size !== TUTOR_QUALITY_HARD_FAILURE_IDS.length
    || TUTOR_QUALITY_HARD_FAILURE_IDS.some((id) => !hardFailureIds.has(id))
  ) {
    context.addIssue({
      code: "custom",
      path: ["hardFailures"],
      message: "all hard failure boundaries are required",
    });
  }
});

export type T6RemediationAcceptanceSuite = z.infer<
  typeof T6RemediationAcceptanceSuiteSchema
>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function hashT6RemediationAcceptanceSuite(
  suite: T6RemediationAcceptanceSuite,
) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(suite)), "utf8")
    .digest("hex");
}

export function loadT6RemediationAcceptanceSuite(filePath: string) {
  const raw = readFileSync(filePath, "utf8");
  const suite = T6RemediationAcceptanceSuiteSchema.parse(JSON.parse(raw));
  const suiteHash = hashT6RemediationAcceptanceSuite(suite);
  if (suiteHash !== CURRENT_T6_REMEDIATION_ACCEPTANCE_SUITE_HASH) {
    throw new Error("T6_REMEDIATION_ACCEPTANCE_SUITE_HASH_MISMATCH");
  }
  return { suite, suiteHash };
}

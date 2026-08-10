import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { z } from "zod";

import { AgentViewSchema } from "./contracts";

export const CURRENT_TUTOR_QUALITY_SUITE_VERSION = "2026-07-27.1";
export const CURRENT_TUTOR_QUALITY_RUBRIC_VERSION = "2026-07-18.1";
export const CURRENT_TUTOR_QUALITY_SUITE_HASH = "b984838ced5878ce37d76ea36b286ee60567f6aed35c6d580942345fa8ae67e1";
export const TUTOR_QUALITY_CASE_COUNT = 52;

export const TUTOR_QUALITY_DIMENSION_IDS = [
  "specificityAndUsefulness",
  "professionalCorrectness",
  "executableFirstStep",
  "followUpJudgment",
  "sourceAndUncertainty",
] as const;

export const TUTOR_QUALITY_HARD_FAILURE_IDS = [
  "AUTHORITY_OVERREACH",
  "FABRICATED_SOURCE",
  "PRIVACY_LEAK",
] as const;

export const TUTOR_QUALITY_CATEGORIES = [
  "VAGUE_IDEA",
  "CONCEPT_TERM",
  "TROUBLESHOOTING",
  "TRANSFER",
  "CROSS_SPECIALTY",
  "SAFETY_BOUNDARY",
] as const;

const NaturalLanguageCriterionSchema = z.string().trim().min(24).max(800);

export const TutorQualityRubricSchema = z.object({
  specificityAndUsefulness: NaturalLanguageCriterionSchema,
  professionalCorrectness: NaturalLanguageCriterionSchema,
  executableFirstStep: NaturalLanguageCriterionSchema,
  followUpJudgment: NaturalLanguageCriterionSchema,
  sourceAndUncertainty: NaturalLanguageCriterionSchema,
}).strict();

const TutorQualityPreludeSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
  view: AgentViewSchema.default("AGENT"),
}).strict();

const TutorQualityArtworkFixtureSchema = z.object({
  path: z.string().regex(/^tests\/tutor-quality\/fixtures\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().max(8_192),
  height: z.number().int().positive().max(8_192),
  expectedVisibleFacts: z.array(NaturalLanguageCriterionSchema).min(2).max(8),
}).strict();

export const TutorQualityCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  origin: z.enum([
    "EXISTING_STRUCTURAL_EVAL",
    "EXISTING_RUNTIME_BENCHMARK",
    "SIMULATED_STUDENT",
  ]),
  sourceCaseId: z.string().regex(/^[a-z0-9-]+$/).optional(),
  category: z.enum(TUTOR_QUALITY_CATEGORIES),
  specialties: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,63}$/)).min(1).max(3),
  coursePackId: z.enum([
    "general-design",
    "digital-interaction",
    "book-design",
    "layout-design",
    "brand-vi-design",
  ]),
  question: z.string().trim().min(2).max(2_000),
  view: AgentViewSchema.default("AGENT"),
  prelude: z.array(TutorQualityPreludeSchema).max(4).default([]),
  webSearchConsent: z.boolean().default(false),
  artworkFixture: TutorQualityArtworkFixtureSchema.optional(),
  rubric: TutorQualityRubricSchema,
}).strict().superRefine((qualityCase, context) => {
  const hasSource = Boolean(qualityCase.sourceCaseId);
  if (qualityCase.origin !== "SIMULATED_STUDENT" && !hasSource) {
    context.addIssue({ code: "custom", path: ["sourceCaseId"], message: "existing cases require sourceCaseId" });
  }
  if (qualityCase.origin === "SIMULATED_STUDENT" && hasSource) {
    context.addIssue({ code: "custom", path: ["sourceCaseId"], message: "simulated cases cannot claim a source case" });
  }
});

const TutorQualityHardFailureSchema = z.object({
  id: z.enum(TUTOR_QUALITY_HARD_FAILURE_IDS),
  description: NaturalLanguageCriterionSchema,
}).strict();

export const TutorQualitySuiteSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/),
  rubricVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/),
  description: z.string().trim().min(24).max(1_000),
  scoringDimensions: TutorQualityRubricSchema,
  hardFailures: z.array(TutorQualityHardFailureSchema).length(TUTOR_QUALITY_HARD_FAILURE_IDS.length),
  cases: z.array(TutorQualityCaseSchema).length(TUTOR_QUALITY_CASE_COUNT),
}).strict().superRefine((suite, context) => {
  const caseIds = suite.cases.map(({ id }) => id);
  if (new Set(caseIds).size !== caseIds.length) {
    context.addIssue({ code: "custom", path: ["cases"], message: "case ids must be unique" });
  }
  const sourceIds = suite.cases.flatMap(({ sourceCaseId }) => sourceCaseId ? [sourceCaseId] : []);
  if (new Set(sourceIds).size !== sourceIds.length) {
    context.addIssue({ code: "custom", path: ["cases"], message: "source case ids must be unique" });
  }
  const hardFailureIds = new Set(suite.hardFailures.map(({ id }) => id));
  if (
    hardFailureIds.size !== TUTOR_QUALITY_HARD_FAILURE_IDS.length
    || TUTOR_QUALITY_HARD_FAILURE_IDS.some((id) => !hardFailureIds.has(id))
  ) {
    context.addIssue({ code: "custom", path: ["hardFailures"], message: "all hard failure boundaries are required" });
  }
});

export type TutorQualityCase = z.infer<typeof TutorQualityCaseSchema>;
export type TutorQualitySuite = z.infer<typeof TutorQualitySuiteSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function hashTutorQualitySuite(suite: TutorQualitySuite) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(suite)), "utf8")
    .digest("hex");
}

export function loadTutorQualitySuite(filePath: string) {
  const raw = readFileSync(filePath, "utf8");
  const suite = TutorQualitySuiteSchema.parse(JSON.parse(raw));
  if (
    suite.version !== CURRENT_TUTOR_QUALITY_SUITE_VERSION
    || suite.rubricVersion !== CURRENT_TUTOR_QUALITY_RUBRIC_VERSION
  ) {
    throw new Error("TUTOR_QUALITY_SUITE_VERSION_NOT_UPDATED");
  }
  const suiteHash = hashTutorQualitySuite(suite);
  if (suiteHash !== CURRENT_TUTOR_QUALITY_SUITE_HASH) {
    throw new Error("TUTOR_QUALITY_SUITE_HASH_MISMATCH");
  }
  return {
    suite,
    suiteHash,
  };
}

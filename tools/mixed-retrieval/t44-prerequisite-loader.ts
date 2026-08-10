import { readFile } from "node:fs/promises";

import { z } from "zod";

import { sha256StableJsonV2 } from "../../lib/knowledge/knowledge-object-v2";
import {
  QueryPrerequisiteDecisionV3Schema,
} from "../../lib/knowledge/query-prerequisite-router-v3";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IdSchema = z.string().regex(ID_PATTERN);
const HashSchema = z.string().regex(HASH_PATTERN);

export const T44_PREREQUISITE_DEV_SUITE_VERSION =
  "2026-07-28.1";
export const T44_PREREQUISITE_DEV_SUITE_SHA256 =
  "df3773e18df8074a773c5ad41b2b3e03e1a83c420eaac7683c3878c4bd60a8c3";

export const T44PrerequisiteCoursePackIdSchema = z.enum([
  "general-design",
  "digital-interaction",
  "book-design",
  "layout-design",
  "brand-vi-design",
]);
export const T44_PREREQUISITE_COURSE_PACK_IDS =
  T44PrerequisiteCoursePackIdSchema.options;

export const T44PrerequisiteExpectationSchema = z.enum([
  "ANSWERABLE",
  "NO_ANSWER",
]);

export const T44PrerequisiteStratumSchema = z.enum([
  "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
  "ANSWERABLE_PARAPHRASE_ALIAS",
  "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
  "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
  "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
  "NO_ANSWER_ENTITY_OPERATION_GAP",
  "NO_ANSWER_PARAMETER_CODE_STEP_GAP",
  "NO_ANSWER_LIVE_EXTERNAL_FACT",
  "NO_ANSWER_OTHER_PACK_NEIGHBOR",
  "NO_ANSWER_CORPUS_GAP_LEXICAL_OVERLAP",
]);
export const T44_PREREQUISITE_STRATA =
  T44PrerequisiteStratumSchema.options;

export const T44PrerequisiteRuntimeSchema = z
  .object({
    mode: z.literal("TEXT_TO_TEXT"),
    coursePackId: T44PrerequisiteCoursePackIdSchema,
    coursePackVersion: z.literal("1"),
    question: z.string().trim().min(1).max(500),
  })
  .strict();

export const T44PrerequisiteScoringSchema = z
  .object({
    caseId: IdSchema,
    familyId: IdSchema,
    stratum: T44PrerequisiteStratumSchema,
    expectation: T44PrerequisiteExpectationSchema,
    expectedDecision: QueryPrerequisiteDecisionV3Schema,
    expectedFailClosedEligible: z.boolean(),
  })
  .strict()
  .superRefine((scoring, context) => {
    const answerable = scoring.stratum.startsWith("ANSWERABLE_");
    if (answerable !== (scoring.expectation === "ANSWERABLE")) {
      context.addIssue({
        code: "custom",
        message: "expectation must agree with the frozen stratum",
        path: ["expectation"],
      });
    }
    const allowedDecisions = scoring.stratum ===
        "NO_ANSWER_ENTITY_OPERATION_GAP"
      ? new Set([
          "USER_ASSET_REQUIRED",
          "LOCAL_TOOL_ACTION_REQUIRED",
        ])
      : new Set([
          scoring.stratum ===
              "NO_ANSWER_PARAMETER_CODE_STEP_GAP"
            ? "PARAMETER_CONTEXT_REQUIRED"
            : scoring.stratum === "NO_ANSWER_LIVE_EXTERNAL_FACT"
              ? "EXTERNAL_STATE_REQUIRED"
              : scoring.stratum ===
                  "NO_ANSWER_OTHER_PACK_NEIGHBOR"
                ? "COURSE_SCOPE_MISMATCH_CANDIDATE"
                : "STATIC_CORPUS_ELIGIBLE",
        ]);
    if (!allowedDecisions.has(scoring.expectedDecision)) {
      context.addIssue({
        code: "custom",
        message: "expected route must agree with the frozen stratum",
        path: ["expectedDecision"],
      });
    }
    const expectedFailClosed = new Set([
      "EXTERNAL_STATE_REQUIRED",
      "USER_ASSET_REQUIRED",
      "LOCAL_TOOL_ACTION_REQUIRED",
      "PARAMETER_CONTEXT_REQUIRED",
    ]).has(scoring.expectedDecision);
    if (
      scoring.expectedFailClosedEligible !== expectedFailClosed
    ) {
      context.addIssue({
        code: "custom",
        message:
          "expected fail-closed eligibility must agree with the expected route",
        path: ["expectedFailClosedEligible"],
      });
    }
  });

export const T44PrerequisiteCaseSchema = z
  .object({
    runtime: T44PrerequisiteRuntimeSchema,
    scoring: T44PrerequisiteScoringSchema,
  })
  .strict();

const T44PrerequisiteSuiteInputSchema = z
  .object({
    schemaVersion: z.literal(3),
    id: z.literal("lumi-t44-prerequisite-dev"),
    version: z.literal(T44_PREREQUISITE_DEV_SUITE_VERSION),
    split: z.literal("DEV"),
    cases: z.array(T44PrerequisiteCaseSchema).length(100),
  })
  .strict()
  .superRefine((suite, context) => {
    const caseIds = suite.cases.map(({ scoring }) =>
      scoring.caseId);
    const familyIds = suite.cases.map(({ scoring }) =>
      scoring.familyId);
    const questions = suite.cases.map(({ runtime }) =>
      runtime.question.normalize("NFKC").toLocaleLowerCase("zh-CN"));
    for (const [values, path, label] of [
      [caseIds, ["cases"], "case ids"],
      [familyIds, ["cases"], "family ids"],
      [questions, ["cases"], "normalized questions"],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `${label} must be unique`,
          path: [...path],
        });
      }
    }

    for (const coursePackId of
      T44_PREREQUISITE_COURSE_PACK_IDS) {
      const packCases = suite.cases.filter(({ runtime }) =>
        runtime.coursePackId === coursePackId);
      if (
        packCases.length !== 20
        || packCases.filter(({ scoring }) =>
          scoring.expectation === "ANSWERABLE").length !== 10
        || packCases.filter(({ scoring }) =>
          scoring.expectation === "NO_ANSWER").length !== 10
      ) {
        context.addIssue({
          code: "custom",
          message:
            "each course pack requires 10 answerable and 10 no-answer cases",
          path: ["cases"],
        });
      }
    }

    for (const stratum of T44_PREREQUISITE_STRATA) {
      if (
        suite.cases.filter(({ scoring }) =>
          scoring.stratum === stratum).length !== 10
      ) {
        context.addIssue({
          code: "custom",
          message: "each prerequisite stratum requires 10 cases",
          path: ["cases"],
        });
      }
    }
  });

export const T44PrerequisiteSuiteSchema =
  T44PrerequisiteSuiteInputSchema.extend({
    suiteHash: HashSchema,
  })
  .strict();

export type T44PrerequisiteSuite = z.infer<
  typeof T44PrerequisiteSuiteSchema
>;

export function t44PrerequisiteSuiteHash(
  suite: T44PrerequisiteSuite,
) {
  const {
    suiteHash: _suiteHash,
    ...unhashed
  } = T44PrerequisiteSuiteSchema.parse(suite);
  return sha256StableJsonV2(unhashed);
}

export async function loadT44PrerequisiteSuite(
  filePath: string,
): Promise<T44PrerequisiteSuite> {
  const suite = T44PrerequisiteSuiteSchema.parse(
    JSON.parse(await readFile(filePath, "utf8")),
  );
  const computedHash = t44PrerequisiteSuiteHash(suite);
  if (
    suite.suiteHash !== computedHash
    || suite.suiteHash !==
      T44_PREREQUISITE_DEV_SUITE_SHA256
  ) {
    throw new Error(
      `T44_PREREQUISITE_SUITE_HASH_MISMATCH:${computedHash}`,
    );
  }
  return suite;
}

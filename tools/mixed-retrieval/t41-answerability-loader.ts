import { createHash } from "node:crypto";

import { z } from "zod";

export const T41_ANSWERABILITY_SUITE_VERSION = "2026-07-28.1";

export const T41_ANSWERABILITY_SUITE_SHA256 = Object.freeze({
  DEV: "79d1047bdd855f28e36d6f3f6a2e259d1f45e50ca62de80fedefc917ca4738a3",
  HELDOUT:
    "bd5c1503e8866ae1587f4d4a5cc215b6fbc70163a7f5f45278c513673bf6be23",
} as const);

export const T41CoursePackIdSchema = z.enum([
  "general-design",
  "digital-interaction",
  "book-design",
  "layout-design",
  "brand-vi-design",
]);

export const T41SplitSchema = z.enum(["DEV", "HELDOUT"]);

export const T41SplitRoleSchema = z.enum([
  "MODEL_DEVELOPMENT",
  "FINAL_BLIND_EVALUATION",
]);

export const T41AnswerabilityCategorySchema = z.enum([
  "ANSWERABLE_CONTROL",
  "OTHER_COURSE_EXCLUSIVE",
  "PRODUCT_SCOPE_CORPUS_GAP",
  "SAME_COURSE_OPERATION_GAP",
  "EXTERNAL_VERIFICATION_REQUIRED",
]);

export const T41ExpectationSchema = z.enum(["ANSWERABLE", "NO_ANSWER"]);

export const T41ReasonClassSchema = z.enum([
  "TARGET_OBJECT_PRESENT",
  "COURSE_SCOPE_MISMATCH",
  "OBJECT_NOT_IN_CORPUS",
  "PROCEDURE_NOT_IN_CORPUS",
  "NON_STATIC_EXTERNAL_FACT",
]);

export const T41_COURSE_PACK_IDS = T41CoursePackIdSchema.options;
export const T41_ANSWERABILITY_CATEGORIES =
  T41AnswerabilityCategorySchema.options;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const EXPECTED_REASON_BY_CATEGORY = {
  ANSWERABLE_CONTROL: "TARGET_OBJECT_PRESENT",
  OTHER_COURSE_EXCLUSIVE: "COURSE_SCOPE_MISMATCH",
  PRODUCT_SCOPE_CORPUS_GAP: "OBJECT_NOT_IN_CORPUS",
  SAME_COURSE_OPERATION_GAP: "PROCEDURE_NOT_IN_CORPUS",
  EXTERNAL_VERIFICATION_REQUIRED: "NON_STATIC_EXTERNAL_FACT",
} as const;

const EXPECTED_SUITE_SHAPE = {
  DEV: {
    splitRole: "MODEL_DEVELOPMENT",
    total: 60,
    answerable: 20,
    noAnswer: 40,
    perPack: {
      total: 12,
      answerable: 4,
      noAnswer: 8,
    },
    perCategory: {
      ANSWERABLE_CONTROL: 20,
      OTHER_COURSE_EXCLUSIVE: 10,
      PRODUCT_SCOPE_CORPUS_GAP: 10,
      SAME_COURSE_OPERATION_GAP: 10,
      EXTERNAL_VERIFICATION_REQUIRED: 10,
    },
    idPrefix: "t41-dev-",
    familyPrefix: "dev-",
  },
  HELDOUT: {
    splitRole: "FINAL_BLIND_EVALUATION",
    total: 30,
    answerable: 10,
    noAnswer: 20,
    perPack: {
      total: 6,
      answerable: 2,
      noAnswer: 4,
    },
    perCategory: {
      ANSWERABLE_CONTROL: 10,
      OTHER_COURSE_EXCLUSIVE: 5,
      PRODUCT_SCOPE_CORPUS_GAP: 5,
      SAME_COURSE_OPERATION_GAP: 5,
      EXTERNAL_VERIFICATION_REQUIRED: 5,
    },
    idPrefix: "t41-heldout-",
    familyPrefix: "heldout-",
  },
} as const;

export const T41AnswerabilityCaseSchema = z
  .object({
    id: z.string().regex(ID_PATTERN),
    category: T41AnswerabilityCategorySchema,
    familyId: z.string().regex(ID_PATTERN),
    coursePackId: T41CoursePackIdSchema,
    question: z.string().trim().min(1).max(500),
    expectation: T41ExpectationSchema,
    targetObjectIds: z.array(z.string().regex(ID_PATTERN)).max(20),
    reasonClass: T41ReasonClassSchema,
  })
  .strict()
  .superRefine((testCase, context) => {
    const uniqueTargets = new Set(testCase.targetObjectIds);
    if (uniqueTargets.size !== testCase.targetObjectIds.length) {
      context.addIssue({
        code: "custom",
        message: "targetObjectIds must be unique",
        path: ["targetObjectIds"],
      });
    }

    const isControl = testCase.category === "ANSWERABLE_CONTROL";
    const expectedExpectation = isControl ? "ANSWERABLE" : "NO_ANSWER";
    if (testCase.expectation !== expectedExpectation) {
      context.addIssue({
        code: "custom",
        message: `${testCase.category} requires ${expectedExpectation}`,
        path: ["expectation"],
      });
    }

    if (
      testCase.expectation === "ANSWERABLE" &&
      testCase.targetObjectIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "ANSWERABLE requires at least one targetObjectId",
        path: ["targetObjectIds"],
      });
    }

    if (
      testCase.expectation === "NO_ANSWER" &&
      testCase.targetObjectIds.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: "NO_ANSWER requires an empty targetObjectIds array",
        path: ["targetObjectIds"],
      });
    }

    const expectedReason = EXPECTED_REASON_BY_CATEGORY[testCase.category];
    if (testCase.reasonClass !== expectedReason) {
      context.addIssue({
        code: "custom",
        message: `${testCase.category} requires reasonClass ${expectedReason}`,
        path: ["reasonClass"],
      });
    }
  });

export const T41AnswerabilitySuiteSchema = z
  .object({
    schemaVersion: z.literal(1),
    suiteVersion: z.literal(T41_ANSWERABILITY_SUITE_VERSION),
    split: T41SplitSchema,
    splitRole: T41SplitRoleSchema,
    cases: z.array(T41AnswerabilityCaseSchema),
  })
  .strict()
  .superRefine((suite, context) => {
    const expected = EXPECTED_SUITE_SHAPE[suite.split];

    if (suite.splitRole !== expected.splitRole) {
      context.addIssue({
        code: "custom",
        message: `${suite.split} requires splitRole ${expected.splitRole}`,
        path: ["splitRole"],
      });
    }

    if (suite.cases.length !== expected.total) {
      context.addIssue({
        code: "custom",
        message: `${suite.split} requires exactly ${expected.total} cases`,
        path: ["cases"],
      });
    }

    const ids = new Set<string>();
    const questions = new Set<string>();

    suite.cases.forEach((testCase, index) => {
      if (ids.has(testCase.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate case id: ${testCase.id}`,
          path: ["cases", index, "id"],
        });
      }
      ids.add(testCase.id);

      if (questions.has(testCase.question)) {
        context.addIssue({
          code: "custom",
          message: "questions must be unique within a split",
          path: ["cases", index, "question"],
        });
      }
      questions.add(testCase.question);

      if (!testCase.id.startsWith(expected.idPrefix)) {
        context.addIssue({
          code: "custom",
          message: `${suite.split} case ids must start with ${expected.idPrefix}`,
          path: ["cases", index, "id"],
        });
      }

      if (!testCase.familyId.startsWith(expected.familyPrefix)) {
        context.addIssue({
          code: "custom",
          message: `${suite.split} family ids must start with ${expected.familyPrefix}`,
          path: ["cases", index, "familyId"],
        });
      }
    });

    const answerableCount = suite.cases.filter(
      (testCase) => testCase.expectation === "ANSWERABLE",
    ).length;
    const noAnswerCount = suite.cases.filter(
      (testCase) => testCase.expectation === "NO_ANSWER",
    ).length;

    if (answerableCount !== expected.answerable) {
      context.addIssue({
        code: "custom",
        message: `${suite.split} requires exactly ${expected.answerable} ANSWERABLE cases`,
        path: ["cases"],
      });
    }
    if (noAnswerCount !== expected.noAnswer) {
      context.addIssue({
        code: "custom",
        message: `${suite.split} requires exactly ${expected.noAnswer} NO_ANSWER cases`,
        path: ["cases"],
      });
    }

    for (const coursePackId of T41_COURSE_PACK_IDS) {
      const packCases = suite.cases.filter(
        (testCase) => testCase.coursePackId === coursePackId,
      );
      const packAnswerable = packCases.filter(
        (testCase) => testCase.expectation === "ANSWERABLE",
      ).length;
      const packNoAnswer = packCases.filter(
        (testCase) => testCase.expectation === "NO_ANSWER",
      ).length;

      if (
        packCases.length !== expected.perPack.total ||
        packAnswerable !== expected.perPack.answerable ||
        packNoAnswer !== expected.perPack.noAnswer
      ) {
        context.addIssue({
          code: "custom",
          message:
            `${coursePackId} requires ` +
            `${expected.perPack.total}/${expected.perPack.answerable}/` +
            `${expected.perPack.noAnswer} total/ANSWERABLE/NO_ANSWER cases`,
          path: ["cases"],
        });
      }
    }

    for (const category of T41_ANSWERABILITY_CATEGORIES) {
      const categoryCount = suite.cases.filter(
        (testCase) => testCase.category === category,
      ).length;
      if (categoryCount !== expected.perCategory[category]) {
        context.addIssue({
          code: "custom",
          message:
            `${suite.split} requires exactly ` +
            `${expected.perCategory[category]} ${category} cases`,
          path: ["cases"],
        });
      }
    }
  });

export type T41CoursePackId = z.infer<typeof T41CoursePackIdSchema>;
export type T41Split = z.infer<typeof T41SplitSchema>;
export type T41AnswerabilityCategory = z.infer<
  typeof T41AnswerabilityCategorySchema
>;
export type T41Expectation = z.infer<typeof T41ExpectationSchema>;
export type T41AnswerabilityCase = z.infer<
  typeof T41AnswerabilityCaseSchema
>;
export type T41AnswerabilitySuite = z.infer<
  typeof T41AnswerabilitySuiteSchema
>;

export type LoadedT41AnswerabilitySuite = {
  suite: T41AnswerabilitySuite;
  suiteSha256: string;
  byteLength: number;
};

export type LoadT41AnswerabilitySuiteOptions = {
  expectedSplit?: T41Split;
  allowHeldout?: boolean;
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function loadT41AnswerabilitySuite(
  input: string | Uint8Array,
  options: LoadT41AnswerabilitySuiteOptions = {},
): LoadedT41AnswerabilitySuite {
  const bytes =
    typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  const suiteSha256 = createHash("sha256").update(bytes).digest("hex");

  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error("T4.1 suite is not valid JSON", { cause: error });
  }

  const suite = T41AnswerabilitySuiteSchema.parse(raw);

  if (options.expectedSplit && suite.split !== options.expectedSplit) {
    throw new Error(
      `T4.1 split mismatch: expected ${options.expectedSplit}, received ${suite.split}`,
    );
  }

  if (suite.split === "HELDOUT" && options.allowHeldout !== true) {
    throw new Error(
      "T4.1 HELDOUT requires explicit allowHeldout authorization",
    );
  }

  const expectedSha256 = T41_ANSWERABILITY_SUITE_SHA256[suite.split];
  if (suiteSha256 !== expectedSha256) {
    throw new Error(
      `T4.1 ${suite.split} byte sha256 mismatch: ` +
        `expected ${expectedSha256}, received ${suiteSha256}`,
    );
  }

  return deepFreeze({
    suite,
    suiteSha256,
    byteLength: bytes.byteLength,
  });
}

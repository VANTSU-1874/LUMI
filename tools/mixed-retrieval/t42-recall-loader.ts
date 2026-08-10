import { createHash } from "node:crypto";

import { z } from "zod";

export const T42_RECALL_SUITE_VERSION = "2026-07-28.1";
export const T42_RECALL_SUITE_SHA256 =
  "ad35795773468a206c4b6f0c0393be7d33a76e12adf04884d7a12247234c026d";
export const T42_RECALL_CORPUS_BUNDLE_SHA256 =
  "82db90934afaffa3d227b6b0d11ab5efdb88009fd8b9274845567de4888079f8";

export const T42CoursePackIdSchema = z.enum([
  "general-design",
  "digital-interaction",
  "book-design",
  "layout-design",
  "brand-vi-design",
]);

export const T42ExpectationSchema = z.enum(["ANSWERABLE", "NO_ANSWER"]);
export const T42_COURSE_PACK_IDS = T42CoursePackIdSchema.options;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NODE_ID_PATTERN = /^node-[0-9a-f]{64}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IdSchema = z.string().regex(ID_PATTERN);
const NodeIdSchema = z.string().regex(NODE_ID_PATTERN);
const HashSchema = z.string().regex(HASH_PATTERN);

const T42HeldoutModeSchema = z.enum([
  "TEXT_TO_TEXT",
  "TEXT_TO_IMAGE",
  "IMAGE_TO_IMAGE",
  "IMAGE_TEXT_TO_EVIDENCE",
]);

const T42HeldoutPublicStratumSchema = z
  .object({
    stratumId: IdSchema,
    coursePackId: T42CoursePackIdSchema,
    mode: T42HeldoutModeSchema,
    caseCount: z.number().int().positive().max(10_000),
  })
  .strict();

export const T42AbcHeldoutPublicManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    manifestId: z.literal("T42-ABC-HELDOUT-PUBLIC"),
    suiteId: z.literal("T42-ABC-HELDOUT"),
    split: z.literal("HELDOUT"),
    splitRole: z.literal("FINAL_BLINDED_EVALUATION"),
    corpusBundleHash: HashSchema.refine(
      (value) => value === T42_RECALL_CORPUS_BUNDLE_SHA256,
      "unexpected T4.2 held-out corpus bundle hash",
    ),
    caseCount: z.number().int().positive().max(10_000),
    strata: z
      .array(T42HeldoutPublicStratumSchema)
      .min(1)
      .max(100),
    sealedPayload: z
      .object({
        kind: z.enum(["CIPHERTEXT", "EXTERNAL_OPAQUE"]),
        sha256: HashSchema,
        byteLength: z.number().int().positive().max(1_000_000_000),
      })
      .strict(),
    confidentiality: z
      .object({
        questionTextIncluded: z.literal(false),
        expectedLabelsIncluded: z.literal(false),
        qrelsIncluded: z.literal(false),
        decryptionMaterialIncluded: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const stratumIds = manifest.strata.map(
      ({ stratumId }) => stratumId,
    );
    if (new Set(stratumIds).size !== stratumIds.length) {
      context.addIssue({
        code: "custom",
        path: ["strata"],
        message: "held-out public strata must use unique ids",
      });
    }
    const declaredCaseCount = manifest.strata.reduce(
      (total, { caseCount }) => total + caseCount,
      0,
    );
    if (declaredCaseCount !== manifest.caseCount) {
      context.addIssue({
        code: "custom",
        path: ["caseCount"],
        message: "held-out public stratum counts must equal caseCount",
      });
    }
  });

export type T42AbcHeldoutPublicManifest = z.infer<
  typeof T42AbcHeldoutPublicManifestSchema
>;

export const T42RecallRuntimeSchema = z
  .object({
    mode: z.literal("TEXT_TO_TEXT"),
    coursePackId: T42CoursePackIdSchema,
    coursePackVersion: z.literal("1"),
    question: z.string().trim().min(1).max(500),
  })
  .strict();

export const T42RequiredEvidenceGroupSchema = z
  .array(NodeIdSchema)
  .min(1)
  .max(12)
  .superRefine((nodeIds, context) => {
    if (new Set(nodeIds).size !== nodeIds.length) {
      context.addIssue({
        code: "custom",
        message: "required evidence nodes must be unique within a group",
      });
    }
  });

export const T42RecallExpectedSchema = z
  .object({
    expectation: T42ExpectationSchema,
    targetObjectIds: z.array(IdSchema).max(10),
    requiredEvidenceGroups: z
      .array(T42RequiredEvidenceGroupSchema)
      .max(12),
  })
  .strict()
  .superRefine((expected, context) => {
    if (
      new Set(expected.targetObjectIds).size !==
      expected.targetObjectIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "targetObjectIds must be unique",
        path: ["targetObjectIds"],
      });
    }

    const groupKeys = expected.requiredEvidenceGroups.map((group) =>
      [...group].sort().join("\u0000"),
    );
    if (new Set(groupKeys).size !== groupKeys.length) {
      context.addIssue({
        code: "custom",
        message: "requiredEvidenceGroups must be unique",
        path: ["requiredEvidenceGroups"],
      });
    }

    if (expected.expectation === "ANSWERABLE") {
      if (expected.targetObjectIds.length === 0) {
        context.addIssue({
          code: "custom",
          message: "ANSWERABLE requires at least one targetObjectId",
          path: ["targetObjectIds"],
        });
      }
      if (expected.requiredEvidenceGroups.length === 0) {
        context.addIssue({
          code: "custom",
          message: "ANSWERABLE requires at least one requiredEvidenceGroup",
          path: ["requiredEvidenceGroups"],
        });
      }
      return;
    }

    if (expected.targetObjectIds.length !== 0) {
      context.addIssue({
        code: "custom",
        message: "NO_ANSWER requires an empty targetObjectIds array",
        path: ["targetObjectIds"],
      });
    }
    if (expected.requiredEvidenceGroups.length !== 0) {
      context.addIssue({
        code: "custom",
        message: "NO_ANSWER requires an empty requiredEvidenceGroups array",
        path: ["requiredEvidenceGroups"],
      });
    }
  });

export const T42RecallCaseSchema = z
  .object({
    id: IdSchema,
    familyId: IdSchema,
    clusterId: IdSchema,
    runtime: T42RecallRuntimeSchema,
    expected: T42RecallExpectedSchema,
  })
  .strict();

const T42RecallContractSchema = z
  .object({
    mode: z.literal("TEXT_TO_TEXT"),
    caseCount: z.literal(40),
    coursePackCount: z.literal(5),
    casesPerCoursePack: z.literal(8),
    answerablePerCoursePack: z.literal(5),
    noAnswerPerCoursePack: z.literal(3),
    requiredEvidenceGroupSemantics: z.literal(
      "ALL_GROUPS_REQUIRED_ANY_NODE_WITHIN_GROUP",
    ),
    runtimeFields: z.tuple([
      z.literal("mode"),
      z.literal("coursePackId"),
      z.literal("coursePackVersion"),
      z.literal("question"),
    ]),
    expectedFields: z.tuple([
      z.literal("expectation"),
      z.literal("targetObjectIds"),
      z.literal("requiredEvidenceGroups"),
    ]),
  })
  .strict();

const T42AnswerableTargetSummarySchema = z
  .object({
    answerableCaseCount: z.literal(25),
    uniqueTargetObjectCount: z.literal(22),
    maxCasesPerObjectOutsideDeclaredSmallPackOverlap: z.literal(1),
    reusedEvidenceNodeCount: z.literal(0),
  })
  .strict();

const T42BrandOverlapStratumSchema = z
  .object({
    coursePackId: z.literal("brand-vi-design"),
    availableCorpusObjectCount: z.literal(2),
    requiredAnswerableCaseCount: z.literal(5),
    uniqueTargetObjectCount: z.literal(2),
    policy: z.literal(
      "REUSE_OBJECT_WITH_DISJOINT_REAL_TEXT_NODE_GROUPS",
    ),
    objectCaseCounts: z.tuple([
      z
        .object({
          objectId: z.literal("brandvi-001-assess-wordmark-fit"),
          caseCount: z.literal(3),
        })
        .strict(),
      z
        .object({
          objectId: z.literal(
            "brandvi-002-test-wordmark-tone-and-audience",
          ),
          caseCount: z.literal(2),
        })
        .strict(),
    ]),
  })
  .strict();

function normalizeQuestion(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("zh-CN");
}

export const T42RecallSuiteSchema = z
  .object({
    schemaVersion: z.literal(1),
    suiteVersion: z.literal(T42_RECALL_SUITE_VERSION),
    suiteId: z.literal("T42-RECALL-DEV"),
    split: z.literal("DEV"),
    splitRole: z.literal("MODEL_DEVELOPMENT"),
    corpusSnapshot: z
      .object({
        path: z.literal(
          "data/knowledge-v2/knowledge-corpus.v2.json",
        ),
        bundleHash: HashSchema.refine(
          (value) => value === T42_RECALL_CORPUS_BUNDLE_SHA256,
          "unexpected T4.2 corpus bundle hash",
        ),
      })
      .strict(),
    contract: T42RecallContractSchema,
    answerableTargetSummary: T42AnswerableTargetSummarySchema,
    smallPackOverlapStrata: z.tuple([
      T42BrandOverlapStratumSchema,
    ]),
    cases: z.array(T42RecallCaseSchema),
  })
  .strict()
  .superRefine((suite, context) => {
    if (suite.cases.length !== 40) {
      context.addIssue({
        code: "custom",
        message: "T42-RECALL-DEV requires exactly 40 cases",
        path: ["cases"],
      });
    }

    const uniqueFields = [
      ["id", suite.cases.map((testCase) => testCase.id)],
      ["familyId", suite.cases.map((testCase) => testCase.familyId)],
      ["clusterId", suite.cases.map((testCase) => testCase.clusterId)],
      [
        "question",
        suite.cases.map((testCase) =>
          normalizeQuestion(testCase.runtime.question),
        ),
      ],
    ] as const;
    for (const [field, values] of uniqueFields) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `${field} values must be unique within T42-RECALL-DEV`,
          path: ["cases"],
        });
      }
    }

    suite.cases.forEach((testCase, index) => {
      if (!testCase.id.startsWith("t42-recall-dev-")) {
        context.addIssue({
          code: "custom",
          message: "case ids must start with t42-recall-dev-",
          path: ["cases", index, "id"],
        });
      }
      if (!testCase.familyId.startsWith("t42-family-")) {
        context.addIssue({
          code: "custom",
          message: "family ids must start with t42-family-",
          path: ["cases", index, "familyId"],
        });
      }
      if (!testCase.clusterId.startsWith("t42-cluster-")) {
        context.addIssue({
          code: "custom",
          message: "cluster ids must start with t42-cluster-",
          path: ["cases", index, "clusterId"],
        });
      }
    });

    for (const coursePackId of T42_COURSE_PACK_IDS) {
      const packCases = suite.cases.filter(
        (testCase) =>
          testCase.runtime.coursePackId === coursePackId,
      );
      const answerable = packCases.filter(
        (testCase) =>
          testCase.expected.expectation === "ANSWERABLE",
      ).length;
      const noAnswer = packCases.filter(
        (testCase) =>
          testCase.expected.expectation === "NO_ANSWER",
      ).length;
      if (
        packCases.length !== 8 ||
        answerable !== 5 ||
        noAnswer !== 3
      ) {
        context.addIssue({
          code: "custom",
          message:
            `${coursePackId} requires 8/5/3 ` +
            "total/ANSWERABLE/NO_ANSWER cases",
          path: ["cases"],
        });
      }
    }

    const answerableCases = suite.cases.filter(
      (testCase) =>
        testCase.expected.expectation === "ANSWERABLE",
    );
    const noAnswerCases = suite.cases.filter(
      (testCase) =>
        testCase.expected.expectation === "NO_ANSWER",
    );
    if (answerableCases.length !== 25 || noAnswerCases.length !== 15) {
      context.addIssue({
        code: "custom",
        message: "T42-RECALL-DEV requires 25/15 ANSWERABLE/NO_ANSWER",
        path: ["cases"],
      });
    }

    const objectCounts = new Map<string, number>();
    const objectPack = new Map<string, T42CoursePackId>();
    const evidenceNodeIds: string[] = [];
    for (const testCase of answerableCases) {
      for (const objectId of testCase.expected.targetObjectIds) {
        objectCounts.set(objectId, (objectCounts.get(objectId) ?? 0) + 1);
        objectPack.set(objectId, testCase.runtime.coursePackId);
      }
      evidenceNodeIds.push(
        ...testCase.expected.requiredEvidenceGroups.flat(),
      );
    }

    if (objectCounts.size !== 22) {
      context.addIssue({
        code: "custom",
        message: "T42-RECALL-DEV requires exactly 22 unique target objects",
        path: ["cases"],
      });
    }
    for (const [objectId, count] of objectCounts) {
      if (
        count > 1 &&
        objectPack.get(objectId) !== "brand-vi-design"
      ) {
        context.addIssue({
          code: "custom",
          message: `target object reused outside declared small pack: ${objectId}`,
          path: ["cases"],
        });
      }
    }

    const declaredBrandCounts = new Map(
      suite.smallPackOverlapStrata[0].objectCaseCounts.map(
        ({ objectId, caseCount }) => [objectId, caseCount],
      ),
    );
    const actualBrandCounts = new Map(
      [...objectCounts].filter(
        ([objectId]) =>
          objectPack.get(objectId) === "brand-vi-design",
      ),
    );
    if (
      declaredBrandCounts.size !== actualBrandCounts.size ||
      [...declaredBrandCounts].some(
        ([objectId, count]) =>
          actualBrandCounts.get(objectId) !== count,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "brand overlap metadata must match actual object reuse",
        path: ["smallPackOverlapStrata"],
      });
    }

    if (new Set(evidenceNodeIds).size !== evidenceNodeIds.length) {
      context.addIssue({
        code: "custom",
        message:
          "required evidence nodes cannot be reused across DEV cases",
        path: ["cases"],
      });
    }
  });

export type T42CoursePackId = z.infer<typeof T42CoursePackIdSchema>;
export type T42Expectation = z.infer<typeof T42ExpectationSchema>;
export type T42RecallRuntime = z.infer<typeof T42RecallRuntimeSchema>;
export type T42RecallExpected = z.infer<typeof T42RecallExpectedSchema>;
export type T42RecallCase = z.infer<typeof T42RecallCaseSchema>;
export type T42RecallSuite = z.infer<typeof T42RecallSuiteSchema>;

export type LoadedT42RecallSuite = {
  suite: T42RecallSuite;
  suiteSha256: string;
  byteLength: number;
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

export function loadT42RecallSuite(
  input: string | Uint8Array,
): LoadedT42RecallSuite {
  const bytes =
    typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  const suiteSha256 = createHash("sha256").update(bytes).digest("hex");

  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error("T4.2 recall suite is not valid JSON", {
      cause: error,
    });
  }

  const suite = T42RecallSuiteSchema.parse(raw);
  if (suiteSha256 !== T42_RECALL_SUITE_SHA256) {
    throw new Error(
      "T4.2 DEV byte sha256 mismatch: " +
        `expected ${T42_RECALL_SUITE_SHA256}, received ${suiteSha256}`,
    );
  }

  return deepFreeze({
    suite,
    suiteSha256,
    byteLength: bytes.byteLength,
  });
}

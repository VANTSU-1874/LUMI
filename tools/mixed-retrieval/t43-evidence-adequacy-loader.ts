import { createHash } from "node:crypto";

import { z } from "zod";

import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "../../lib/knowledge/knowledge-object-v2";
import { createRetrievalQueryV2 } from "../../lib/knowledge/retrieval-query-v2";

export const T43_EVIDENCE_ADEQUACY_SUITE_VERSION = "2026-07-28.1";
export const T43_EVIDENCE_ADEQUACY_SUITE_SHA256 =
  "2ad2174227f6d905dbb77d8070a4851132d462c3d18ce9d4f9a0712dfac2e4d4";
export const T43_EVIDENCE_ADEQUACY_CORPUS_BUNDLE_SHA256 =
  "82db90934afaffa3d227b6b0d11ab5efdb88009fd8b9274845567de4888079f8";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NODE_ID_PATTERN = /^node-[0-9a-f]{64}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IdSchema = z.string().regex(ID_PATTERN);
const NodeIdSchema = z.string().regex(NODE_ID_PATTERN);
const HashSchema = z.string().regex(HASH_PATTERN);

export const T43CoursePackIdSchema = z.enum([
  "general-design",
  "digital-interaction",
  "book-design",
  "layout-design",
  "brand-vi-design",
]);
export const T43_COURSE_PACK_IDS = T43CoursePackIdSchema.options;

export const T43ExpectationSchema = z.enum([
  "ANSWERABLE",
  "NO_ANSWER",
]);
export const T43ExecutionClassSchema = z.enum([
  "HEALTHY_SCOPED_TTT",
  "PRE_RETRIEVAL_EMPTY",
]);
export const T43PairRoleSchema = T43ExpectationSchema;
export const T43PairDeltaKindSchema = z.enum([
  "SUPPORTED_TO_UNSUPPORTED_OPERATION",
  "SUPPORTED_TO_UNSUPPORTED_OPERATION_VARIANT",
  "SUPPORTED_TO_UNSUPPORTED_DETAIL",
  "STATIC_GUIDANCE_TO_LIVE_EXTERNAL_FACT",
  "IN_PACK_SUPPORT_TO_OTHER_PACK_SCOPE",
  "SUPPORTED_CONCEPT_TO_CORPUS_GAP",
]);

export const T43PositiveStratumSchema = z.enum([
  "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
  "ANSWERABLE_PARAPHRASE_ALIAS",
  "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
  "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
  "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
]);
export const T43NegativeStratumSchema = z.enum([
  "NO_ANSWER_ENTITY_OPERATION_GAP",
  "NO_ANSWER_PARAMETER_CODE_STEP_GAP",
  "NO_ANSWER_LIVE_EXTERNAL_FACT",
  "NO_ANSWER_OTHER_PACK_NEIGHBOR",
  "NO_ANSWER_CORPUS_GAP_LEXICAL_OVERLAP",
]);
export const T43StratumSchema = z.enum([
  ...T43PositiveStratumSchema.options,
  ...T43NegativeStratumSchema.options,
]);
export const T43_STRATA = T43StratumSchema.options;

export const T43ReasonClassSchema = z.enum([
  "CORPUS_SUPPORTED",
  "UNSUPPORTED_OPERATION",
  "UNSUPPORTED_DETAIL",
  "EXTERNAL_VERIFICATION_REQUIRED",
  "OUT_OF_PACK_SCOPE",
  "CORPUS_CONTENT_GAP",
]);

const STRATUM_CONTRACT = Object.freeze({
  ANSWERABLE_SINGLE_PRIMARY_DIRECT: {
    expectation: "ANSWERABLE",
    reasonClass: "CORPUS_SUPPORTED",
    executionClass: "HEALTHY_SCOPED_TTT",
  },
  ANSWERABLE_PARAPHRASE_ALIAS: {
    expectation: "ANSWERABLE",
    reasonClass: "CORPUS_SUPPORTED",
    executionClass: "HEALTHY_SCOPED_TTT",
  },
  ANSWERABLE_MULTI_PRIMARY_COMPOSITION: {
    expectation: "ANSWERABLE",
    reasonClass: "CORPUS_SUPPORTED",
    executionClass: "HEALTHY_SCOPED_TTT",
  },
  ANSWERABLE_IN_PACK_HARD_DISTRACTOR: {
    expectation: "ANSWERABLE",
    reasonClass: "CORPUS_SUPPORTED",
    executionClass: "HEALTHY_SCOPED_TTT",
  },
  ANSWERABLE_CROSS_PACK_TERM_OVERLAP: {
    expectation: "ANSWERABLE",
    reasonClass: "CORPUS_SUPPORTED",
    executionClass: "HEALTHY_SCOPED_TTT",
  },
  NO_ANSWER_ENTITY_OPERATION_GAP: {
    expectation: "NO_ANSWER",
    reasonClass: "UNSUPPORTED_OPERATION",
    executionClass: "HEALTHY_SCOPED_TTT",
  },
  NO_ANSWER_PARAMETER_CODE_STEP_GAP: {
    expectation: "NO_ANSWER",
    reasonClass: "UNSUPPORTED_DETAIL",
    executionClass: "HEALTHY_SCOPED_TTT",
  },
  NO_ANSWER_LIVE_EXTERNAL_FACT: {
    expectation: "NO_ANSWER",
    reasonClass: "EXTERNAL_VERIFICATION_REQUIRED",
    executionClass: "PRE_RETRIEVAL_EMPTY",
  },
  NO_ANSWER_OTHER_PACK_NEIGHBOR: {
    expectation: "NO_ANSWER",
    reasonClass: "OUT_OF_PACK_SCOPE",
    executionClass: "HEALTHY_SCOPED_TTT",
  },
  NO_ANSWER_CORPUS_GAP_LEXICAL_OVERLAP: {
    expectation: "NO_ANSWER",
    reasonClass: "CORPUS_CONTENT_GAP",
    executionClass: "HEALTHY_SCOPED_TTT",
  },
} as const satisfies Record<
  z.infer<typeof T43StratumSchema>,
  {
    expectation: z.infer<typeof T43ExpectationSchema>;
    reasonClass: z.infer<typeof T43ReasonClassSchema>;
    executionClass: z.infer<typeof T43ExecutionClassSchema>;
  }
>);

export const T43EvidenceAdequacyRuntimeSchema = z
  .object({
    mode: z.literal("TEXT_TO_TEXT"),
    coursePackId: T43CoursePackIdSchema,
    coursePackVersion: z.literal("1"),
    question: z.string().trim().min(1).max(500),
  })
  .strict();

export const T43RequiredEvidenceGroupSchema = z
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

export const T43EvidenceAdequacyScoringSchema = z
  .object({
    caseId: IdSchema,
    familyId: IdSchema,
    clusterId: IdSchema,
    pairId: IdSchema.nullable(),
    pairRole: T43PairRoleSchema.nullable(),
    pairDeltaKind: T43PairDeltaKindSchema.nullable(),
    stratum: T43StratumSchema,
    expectation: T43ExpectationSchema,
    reasonClass: T43ReasonClassSchema,
    executionClass: T43ExecutionClassSchema,
    targetObjectIds: z.array(IdSchema).max(10),
    requiredEvidenceGroups: z
      .array(T43RequiredEvidenceGroupSchema)
      .max(12),
  })
  .strict()
  .superRefine((scoring, context) => {
    const stratumContract = STRATUM_CONTRACT[scoring.stratum];
    for (const field of [
      "expectation",
      "reasonClass",
      "executionClass",
    ] as const) {
      if (scoring[field] !== stratumContract[field]) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} does not match ${scoring.stratum}`,
        });
      }
    }

    const pairValues = [
      scoring.pairId,
      scoring.pairRole,
      scoring.pairDeltaKind,
    ];
    if (
      pairValues.some((value) => value === null)
      && pairValues.some((value) => value !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "pair fields must be either all null or all non-null",
      });
    }
    if (
      scoring.pairRole !== null
      && scoring.pairRole !== scoring.expectation
    ) {
      context.addIssue({
        code: "custom",
        path: ["pairRole"],
        message: "pairRole must equal expectation",
      });
    }

    if (
      new Set(scoring.targetObjectIds).size
      !== scoring.targetObjectIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetObjectIds"],
        message: "targetObjectIds must be unique",
      });
    }
    const groupKeys = scoring.requiredEvidenceGroups.map((group) =>
      [...group].sort().join("\u0000"),
    );
    if (new Set(groupKeys).size !== groupKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["requiredEvidenceGroups"],
        message: "requiredEvidenceGroups must be unique",
      });
    }

    if (scoring.expectation === "ANSWERABLE") {
      if (scoring.targetObjectIds.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["targetObjectIds"],
          message: "ANSWERABLE requires target objects",
        });
      }
      if (scoring.requiredEvidenceGroups.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["requiredEvidenceGroups"],
          message: "ANSWERABLE requires evidence groups",
        });
      }
    } else if (
      scoring.targetObjectIds.length !== 0
      || scoring.requiredEvidenceGroups.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: "NO_ANSWER requires empty qrels",
      });
    }
  });

export const T43EvidenceAdequacyCaseSchema = z
  .object({
    runtime: T43EvidenceAdequacyRuntimeSchema,
    scoring: T43EvidenceAdequacyScoringSchema,
  })
  .strict();

const T43ContractSchema = z
  .object({
    mode: z.literal("TEXT_TO_TEXT"),
    caseCount: z.literal(100),
    coursePackCount: z.literal(5),
    casesPerCoursePack: z.literal(20),
    answerablePerCoursePack: z.literal(10),
    noAnswerPerCoursePack: z.literal(10),
    pairCount: z.literal(30),
    pairedCaseCount: z.literal(60),
    pairsPerCoursePack: z.literal(6),
    singletonCaseCount: z.literal(40),
    singletonsPerCoursePack: z.literal(8),
    providerQueriesPerArm: z.literal(90),
    expectedProviderCallsPerArm: z.literal(180),
    preRetrievalSkipsPerArm: z.literal(10),
    requiredEvidenceGroupSemantics: z.literal(
      "ALL_GROUPS_REQUIRED_ANY_NODE_WITHIN_GROUP",
    ),
    runtimeFields: z.tuple([
      z.literal("mode"),
      z.literal("coursePackId"),
      z.literal("coursePackVersion"),
      z.literal("question"),
    ]),
    scoringFields: z.tuple([
      z.literal("caseId"),
      z.literal("familyId"),
      z.literal("clusterId"),
      z.literal("pairId"),
      z.literal("pairRole"),
      z.literal("pairDeltaKind"),
      z.literal("stratum"),
      z.literal("expectation"),
      z.literal("reasonClass"),
      z.literal("executionClass"),
      z.literal("targetObjectIds"),
      z.literal("requiredEvidenceGroups"),
    ]),
  })
  .strict();

const T43ReuseManifestEntrySchema = z
  .object({
    coursePackId: z.enum([
      "general-design",
      "brand-vi-design",
    ]),
    objectId: IdSchema,
    caseCount: z.number().int().min(2).max(10),
    policy: z.literal(
      "REUSE_OBJECT_WITH_DISTINCT_EVIDENCE_INTENT_OPERATION",
    ),
  })
  .strict();

const T43PriorIntentOverlapEntrySchema = z
  .object({
    caseId: IdSchema,
    coursePackId: z.literal("brand-vi-design"),
    priorSuiteCaseIds: z
      .array(IdSchema.refine(
        (value) =>
          value.startsWith("t41-dev-")
          || value.startsWith("t42-recall-dev-"),
        "prior intent controls may reference only visible T4.1/T4.2 cases",
      ))
      .min(1)
      .max(10),
    requiredEvidenceNodeIds: z
      .array(NodeIdSchema)
      .min(1)
      .max(12),
    distinctObligationId: IdSchema,
    policy: z.literal(
      "DECLARED_SMALL_PACK_PRIOR_DOMAIN_CONTROL_WITH_DISTINCT_NODE_AND_OPERATION",
    ),
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      new Set(entry.priorSuiteCaseIds).size
        !== entry.priorSuiteCaseIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["priorSuiteCaseIds"],
        message: "priorSuiteCaseIds must be unique",
      });
    }
    if (
      new Set(entry.requiredEvidenceNodeIds).size
        !== entry.requiredEvidenceNodeIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["requiredEvidenceNodeIds"],
        message: "declared evidence nodes must be unique",
      });
    }
  });

function normalizeQuestion(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("zh-CN");
}

function normalizeIntentId(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(
      /^(?:dev-|t41-(?:family|cluster)-|t42-(?:family|cluster)-|t43-(?:family|cluster)-)/,
      "",
    );
}

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isDeepEqualStringArray(
  left: readonly string[],
  right: readonly string[],
) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function t43RuntimeQuerySha256(
  runtime: z.infer<typeof T43EvidenceAdequacyRuntimeSchema>,
  corpusBundleHash = T43_EVIDENCE_ADEQUACY_CORPUS_BUNDLE_SHA256,
) {
  return sha256StableJsonV2(createRetrievalQueryV2({
    mode: runtime.mode,
    text: runtime.question,
    scope: {
      corpusBundleHash,
      sourceCoursePack: {
        id: runtime.coursePackId,
        version: runtime.coursePackVersion,
      },
    },
  }));
}

export const T43EvidenceAdequacySuiteSchema = z
  .object({
    schemaVersion: z.literal(1),
    suiteVersion: z.literal(T43_EVIDENCE_ADEQUACY_SUITE_VERSION),
    suiteId: z.literal("T43-EVIDENCE-ADEQUACY-DEV"),
    split: z.literal("DEV"),
    splitRole: z.literal("MODEL_DEVELOPMENT"),
    corpusSnapshot: z
      .object({
        path: z.literal(
          "data/knowledge-v2/knowledge-corpus.v2.json",
        ),
        bundleHash: HashSchema.refine(
          (value) =>
            value
              === T43_EVIDENCE_ADEQUACY_CORPUS_BUNDLE_SHA256,
          "unexpected T4.3 corpus bundle hash",
        ),
      })
      .strict(),
    contract: T43ContractSchema,
    reuseManifest: z
      .array(T43ReuseManifestEntrySchema)
      .max(20),
    priorIntentOverlapManifest: z
      .array(T43PriorIntentOverlapEntrySchema)
      .length(10),
    cases: z.array(T43EvidenceAdequacyCaseSchema),
  })
  .strict()
  .superRefine((suite, context) => {
    if (suite.cases.length !== 100) {
      context.addIssue({
        code: "custom",
        path: ["cases"],
        message: "T43 DEV requires exactly 100 cases",
      });
    }

    const uniqueFields = [
      [
        "caseId",
        suite.cases.map(({ scoring }) => scoring.caseId),
      ],
      [
        "normalizedQuestion",
        suite.cases.map(({ runtime }) =>
          normalizeQuestion(runtime.question),
        ),
      ],
      [
        "runtimeQuerySha256",
        suite.cases.map(({ runtime }) =>
          t43RuntimeQuerySha256(
            runtime,
            suite.corpusSnapshot.bundleHash,
          ),
        ),
      ],
    ] as const;
    for (const [field, values] of uniqueFields) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message: `${field} values must be unique`,
        });
      }
    }

    suite.cases.forEach(({ scoring }, index) => {
      for (const [field, value, prefix] of [
        ["caseId", scoring.caseId, "t43-dev-"],
        ["familyId", scoring.familyId, "t43-family-"],
        ["clusterId", scoring.clusterId, "t43-cluster-"],
      ] as const) {
        if (!value.startsWith(prefix)) {
          context.addIssue({
            code: "custom",
            path: ["cases", index, "scoring", field],
            message: `${field} must use the T4.3 namespace`,
          });
        }
      }
    });

    for (const coursePackId of T43_COURSE_PACK_IDS) {
      const packCases = suite.cases.filter(
        ({ runtime }) => runtime.coursePackId === coursePackId,
      );
      const answerable = packCases.filter(
        ({ scoring }) => scoring.expectation === "ANSWERABLE",
      );
      const noAnswer = packCases.filter(
        ({ scoring }) => scoring.expectation === "NO_ANSWER",
      );
      const singletonCount = packCases.filter(
        ({ scoring }) => scoring.pairId === null,
      ).length;
      const pairIds = new Set(packCases.flatMap(({ scoring }) =>
        scoring.pairId === null ? [] : [scoring.pairId]));
      if (
        packCases.length !== 20
        || answerable.length !== 10
        || noAnswer.length !== 10
        || singletonCount !== 8
        || pairIds.size !== 6
      ) {
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message:
            `${coursePackId} requires 20/10/10 cases, ` +
            "8 singleton cases, and 6 pairs",
        });
      }
      for (const stratum of T43_STRATA) {
        const count = packCases.filter(
          ({ scoring }) => scoring.stratum === stratum,
        ).length;
        if (count !== 2) {
          context.addIssue({
            code: "custom",
            path: ["cases"],
            message:
              `${coursePackId} × ${stratum} requires exactly 2 cases`,
          });
        }
      }
    }

    const byPairId = new Map<
      string,
      Array<z.infer<typeof T43EvidenceAdequacyCaseSchema>>
    >();
    for (const testCase of suite.cases) {
      if (testCase.scoring.pairId === null) continue;
      const pairCases =
        byPairId.get(testCase.scoring.pairId) ?? [];
      pairCases.push(testCase);
      byPairId.set(testCase.scoring.pairId, pairCases);
    }
    if (byPairId.size !== 30) {
      context.addIssue({
        code: "custom",
        path: ["cases"],
        message: "T43 DEV requires exactly 30 pair ids",
      });
    }
    for (const [pairId, pairCases] of byPairId) {
      const packs = new Set(
        pairCases.map(({ runtime }) => runtime.coursePackId),
      );
      const expectations = new Set(
        pairCases.map(({ scoring }) => scoring.expectation),
      );
      const deltaKinds = new Set(
        pairCases.map(({ scoring }) => scoring.pairDeltaKind),
      );
      const familyIds = new Set(
        pairCases.map(({ scoring }) => scoring.familyId),
      );
      const clusterIds = new Set(
        pairCases.map(({ scoring }) => scoring.clusterId),
      );
      if (
        pairCases.length !== 2
        || packs.size !== 1
        || expectations.size !== 2
        || deltaKinds.size !== 1
        || familyIds.size !== 1
        || clusterIds.size !== 1
      ) {
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message:
            `${pairId} must contain one positive and one negative ` +
            "case in one pack with one delta kind, family, and cluster",
        });
      }
    }
    for (const field of ["familyId", "clusterId"] as const) {
      const grouped = new Map<
        string,
        Array<z.infer<typeof T43EvidenceAdequacyCaseSchema>>
      >();
      for (const testCase of suite.cases) {
        const key = testCase.scoring[field];
        const group = grouped.get(key) ?? [];
        group.push(testCase);
        grouped.set(key, group);
      }
      for (const [key, group] of grouped) {
        const pairIds = new Set(
          group.map(({ scoring }) => scoring.pairId),
        );
        const validSingleton =
          group.length === 1 && group[0].scoring.pairId === null;
        const validPair =
          group.length === 2
          && pairIds.size === 1
          && !pairIds.has(null);
        if (!validSingleton && !validPair) {
          context.addIssue({
            code: "custom",
            path: ["cases"],
            message:
              `${field} ${key} must belong to one singleton or one pair`,
          });
        }
      }
    }
    const pairedCaseCount = suite.cases.filter(
      ({ scoring }) => scoring.pairId !== null,
    ).length;
    if (pairedCaseCount !== 60) {
      context.addIssue({
        code: "custom",
        path: ["cases"],
        message: "T43 DEV requires exactly 60 paired cases",
      });
    }

    const healthyCount = suite.cases.filter(
      ({ scoring }) =>
        scoring.executionClass === "HEALTHY_SCOPED_TTT",
    ).length;
    const skippedCount = suite.cases.length - healthyCount;
    if (
      healthyCount !== suite.contract.providerQueriesPerArm
      || healthyCount * 2
        !== suite.contract.expectedProviderCallsPerArm
      || skippedCount
        !== suite.contract.preRetrievalSkipsPerArm
    ) {
      context.addIssue({
        code: "custom",
        path: ["contract"],
        message:
          "execution classes do not match the provider call contract",
      });
    }

    const objectCounts = new Map<
      string,
      {
        coursePackId: z.infer<typeof T43CoursePackIdSchema>;
        count: number;
      }
    >();
    const evidenceNodeIds: string[] = [];
    for (const testCase of suite.cases) {
      if (testCase.scoring.expectation !== "ANSWERABLE") continue;
      for (const objectId of testCase.scoring.targetObjectIds) {
        const previous = objectCounts.get(objectId);
        objectCounts.set(objectId, {
          coursePackId: testCase.runtime.coursePackId,
          count: (previous?.count ?? 0) + 1,
        });
      }
      evidenceNodeIds.push(
        ...testCase.scoring.requiredEvidenceGroups.flat(),
      );
    }
    if (new Set(evidenceNodeIds).size !== evidenceNodeIds.length) {
      context.addIssue({
        code: "custom",
        path: ["cases"],
        message:
          "required evidence nodes must be distinct across DEV cases",
      });
    }

    const actualReuse = [...objectCounts]
      .filter(([, { count }]) => count > 1)
      .map(([objectId, value]) => ({
        coursePackId: value.coursePackId,
        objectId,
        caseCount: value.count,
        policy:
          "REUSE_OBJECT_WITH_DISTINCT_EVIDENCE_INTENT_OPERATION" as const,
      }))
      .sort((left, right) =>
        compareCodePoints(left.coursePackId, right.coursePackId)
        || compareCodePoints(left.objectId, right.objectId));
    const declaredReuse = [...suite.reuseManifest].sort(
      (left, right) =>
        compareCodePoints(left.coursePackId, right.coursePackId)
        || compareCodePoints(left.objectId, right.objectId),
    );
    if (
      JSON.stringify(actualReuse) !== JSON.stringify(declaredReuse)
    ) {
      context.addIssue({
        code: "custom",
        path: ["reuseManifest"],
        message:
          "reuseManifest must exactly declare repeated answerable objects",
      });
    }

    const overlapCaseIds = suite.priorIntentOverlapManifest.map(
      ({ caseId }) => caseId,
    );
    const overlapObligationIds = suite.priorIntentOverlapManifest.map(
      ({ distinctObligationId }) => distinctObligationId,
    );
    if (new Set(overlapCaseIds).size !== overlapCaseIds.length) {
      context.addIssue({
        code: "custom",
        path: ["priorIntentOverlapManifest"],
        message: "prior intent overlap case ids must be unique",
      });
    }
    if (
      new Set(overlapObligationIds).size
        !== overlapObligationIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["priorIntentOverlapManifest"],
        message: "distinct obligation ids must be unique",
      });
    }
    const brandAnswerable = suite.cases.filter(
      ({ runtime, scoring }) =>
        runtime.coursePackId === "brand-vi-design"
        && scoring.expectation === "ANSWERABLE",
    );
    const expectedOverlapCaseIds = brandAnswerable
      .map(({ scoring }) => scoring.caseId)
      .sort();
    if (
      JSON.stringify([...overlapCaseIds].sort())
        !== JSON.stringify(expectedOverlapCaseIds)
    ) {
      context.addIssue({
        code: "custom",
        path: ["priorIntentOverlapManifest"],
        message:
          "every and only brand ANSWERABLE case must be a declared overlap control",
      });
    }
    const caseById = new Map(suite.cases.map((testCase) => [
      testCase.scoring.caseId,
      testCase,
    ]));
    for (
      const [index, entry]
      of suite.priorIntentOverlapManifest.entries()
    ) {
      const testCase = caseById.get(entry.caseId);
      if (!testCase) continue;
      const expectedNodes =
        testCase.scoring.requiredEvidenceGroups.flat();
      if (
        !isDeepEqualStringArray(
          entry.requiredEvidenceNodeIds,
          expectedNodes,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "priorIntentOverlapManifest",
            index,
            "requiredEvidenceNodeIds",
          ],
          message:
            "declared overlap nodes must exactly equal flattened qrels",
        });
      }
    }
  });

export type T43CoursePackId = z.infer<
  typeof T43CoursePackIdSchema
>;
export type T43Expectation = z.infer<typeof T43ExpectationSchema>;
export type T43ExecutionClass = z.infer<
  typeof T43ExecutionClassSchema
>;
export type T43Stratum = z.infer<typeof T43StratumSchema>;
export type T43EvidenceAdequacyRuntime = z.infer<
  typeof T43EvidenceAdequacyRuntimeSchema
>;
export type T43EvidenceAdequacyScoring = z.infer<
  typeof T43EvidenceAdequacyScoringSchema
>;
export type T43EvidenceAdequacyCase = z.infer<
  typeof T43EvidenceAdequacyCaseSchema
>;
export type T43EvidenceAdequacySuite = z.infer<
  typeof T43EvidenceAdequacySuiteSchema
>;

export const T43PriorVisibleCaseReferenceSchema = z
  .object({
    caseId: z.string().trim().min(1),
    familyId: z.string().trim().min(1).nullable(),
    clusterId: z.string().trim().min(1).nullable(),
    question: z.string().trim().min(1).nullable(),
  })
  .strict();

export type T43PriorVisibleCaseReference = z.infer<
  typeof T43PriorVisibleCaseReferenceSchema
>;

export type LoadedT43EvidenceAdequacySuite = {
  suite: T43EvidenceAdequacySuite;
  suiteSha256: string;
  byteLength: number;
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function assertT43Qrels(
  suite: T43EvidenceAdequacySuite,
  corpus: KnowledgeCorpusBundleV2,
) {
  if (
    corpus.bundleHash !== suite.corpusSnapshot.bundleHash
    || corpus.bundleHash
      !== T43_EVIDENCE_ADEQUACY_CORPUS_BUNDLE_SHA256
  ) {
    throw new Error("T43_SUITE_CORPUS_IDENTITY_MISMATCH");
  }
  const objectById = new Map(
    corpus.objects.map((object) => [object.id, object]),
  );
  const nodeById = new Map(
    corpus.objects.flatMap((object) =>
      object.nodes.map((node) => [
        node.id,
        { object, node },
      ] as const)),
  );
  const textualKinds = new Set([
    "DOCUMENT",
    "SECTION",
    "TEXT",
    "TABLE",
  ]);

  for (const testCase of suite.cases) {
    const { scoring, runtime } = testCase;
    for (const objectId of scoring.targetObjectIds) {
      const object = objectById.get(objectId);
      if (!object) {
        throw new Error(
          `T43_QREL_OBJECT_MISSING:${scoring.caseId}:${objectId}`,
        );
      }
      if (
        object.sourceCoursePack.id !== runtime.coursePackId
        || object.sourceCoursePack.version
          !== runtime.coursePackVersion
      ) {
        throw new Error(
          `T43_QREL_OBJECT_SCOPE_MISMATCH:${scoring.caseId}:${objectId}`,
        );
      }
    }
    const targetObjects = new Set(scoring.targetObjectIds);
    for (const group of scoring.requiredEvidenceGroups) {
      const groupOwners = new Set<string>();
      for (const nodeId of group) {
        const binding = nodeById.get(nodeId);
        if (!binding) {
          throw new Error(
            `T43_QREL_NODE_MISSING:${scoring.caseId}:${nodeId}`,
          );
        }
        if (
          !targetObjects.has(binding.object.id)
          || binding.object.sourceCoursePack.id
            !== runtime.coursePackId
          || binding.object.sourceCoursePack.version
            !== runtime.coursePackVersion
        ) {
          throw new Error(
            `T43_QREL_NODE_OWNER_MISMATCH:${scoring.caseId}:${nodeId}`,
          );
        }
        if (!textualKinds.has(binding.node.kind)) {
          throw new Error(
            `T43_QREL_NODE_KIND_INVALID:${scoring.caseId}:${nodeId}`,
          );
        }
        groupOwners.add(binding.object.id);
      }
      if (groupOwners.size !== 1) {
        throw new Error(
          `T43_QREL_GROUP_OWNER_AMBIGUOUS:${scoring.caseId}`,
        );
      }
    }
  }
}

export function assertT43EvidenceAdequacyQrels(
  suite: T43EvidenceAdequacySuite,
  corpusInput: unknown,
) {
  assertT43Qrels(
    suite,
    verifyKnowledgeCorpusBundleV2(corpusInput),
  );
}

function assertT43PriorIndependence(
  suite: T43EvidenceAdequacySuite,
  priorVisibleCasesInput: readonly unknown[],
) {
  const priorVisibleCases = z
    .array(T43PriorVisibleCaseReferenceSchema)
    .parse(priorVisibleCasesInput);
  const priorVisibleCaseIds = priorVisibleCases.map(
    ({ caseId }) => caseId,
  );
  if (new Set(priorVisibleCaseIds).size !== priorVisibleCaseIds.length) {
    throw new Error("T43_PRIOR_VISIBLE_CASE_IDS_NOT_UNIQUE");
  }
  const visible = new Set(priorVisibleCaseIds);
  for (const entry of suite.priorIntentOverlapManifest) {
    for (const priorCaseId of entry.priorSuiteCaseIds) {
      if (!visible.has(priorCaseId)) {
        throw new Error(
          `T43_PRIOR_INTENT_CASE_MISSING:${entry.caseId}:${priorCaseId}`,
        );
      }
    }
  }

  const priorQuestionKeys = new Set(
    priorVisibleCases.flatMap(({ question }) =>
      question === null ? [] : [normalizeQuestion(question)]),
  );
  const priorFamilyKeys = new Set(
    priorVisibleCases.flatMap(({ familyId }) =>
      familyId === null ? [] : [normalizeIntentId(familyId)]),
  );
  const priorClusterKeys = new Set(
    priorVisibleCases.flatMap(({ clusterId }) =>
      clusterId === null ? [] : [normalizeIntentId(clusterId)]),
  );
  for (const testCase of suite.cases) {
    if (
      priorQuestionKeys.has(normalizeQuestion(testCase.runtime.question))
    ) {
      throw new Error(
        `T43_PRIOR_NORMALIZED_QUESTION_REUSED:${testCase.scoring.caseId}`,
      );
    }
    if (
      priorFamilyKeys.has(
        normalizeIntentId(testCase.scoring.familyId),
      )
    ) {
      throw new Error(
        `T43_PRIOR_FAMILY_REUSED:${testCase.scoring.caseId}`,
      );
    }
    if (
      priorClusterKeys.has(
        normalizeIntentId(testCase.scoring.clusterId),
      )
    ) {
      throw new Error(
        `T43_PRIOR_CLUSTER_REUSED:${testCase.scoring.caseId}`,
      );
    }
  }
}

export function loadT43EvidenceAdequacySuite(
  input: string | Uint8Array,
  corpusInput: unknown,
  priorVisibleCases: readonly unknown[],
): LoadedT43EvidenceAdequacySuite {
  const bytes =
    typeof input === "string"
      ? Buffer.from(input, "utf8")
      : Buffer.from(input);
  const suiteSha256 = createHash("sha256")
    .update(bytes)
    .digest("hex");

  let raw: unknown;
  try {
    raw = JSON.parse(
      bytes.toString("utf8").replace(/^\uFEFF/, ""),
    );
  } catch (error) {
    throw new Error("T4.3 DEV suite is not valid JSON", {
      cause: error,
    });
  }
  const suite = T43EvidenceAdequacySuiteSchema.parse(raw);
  if (suiteSha256 !== T43_EVIDENCE_ADEQUACY_SUITE_SHA256) {
    throw new Error(
      "T4.3 DEV byte sha256 mismatch: " +
        `expected ${T43_EVIDENCE_ADEQUACY_SUITE_SHA256}, ` +
        `received ${suiteSha256}`,
    );
  }
  assertT43EvidenceAdequacyQrels(suite, corpusInput);
  assertT43PriorIndependence(suite, priorVisibleCases);

  return deepFreeze({
    suite,
    suiteSha256,
    byteLength: bytes.byteLength,
  });
}

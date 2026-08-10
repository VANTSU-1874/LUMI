import { createHash } from "node:crypto";

import { z } from "zod";

import {
  EvidenceBundleV2Schema,
  type EvidenceBundleV2,
} from "../../lib/knowledge/evidence-bundle-v2";
import {
  createRetrievalQueryV2,
  RetrievalQueryV2Schema,
  type RetrievalQueryV2,
} from "../../lib/knowledge/retrieval-query-v2";
import {
  T41_ANSWERABILITY_SUITE_SHA256,
  T41_ANSWERABILITY_CATEGORIES,
  T41_COURSE_PACK_IDS,
  T41AnswerabilitySuiteSchema,
  type LoadedT41AnswerabilitySuite,
  type T41AnswerabilityCase,
  type T41AnswerabilityCategory,
  type T41CoursePackId,
  type T41Expectation,
  type T41Split,
} from "./t41-answerability-loader";

export const T41_ANSWERABILITY_EVALUATOR_VERSION = "2026-07-28.1";

export const T41_ANSWERABILITY_GATE_THRESHOLDS = Object.freeze({
  DEV: Object.freeze({
    noAnswer: Object.freeze({ required: 36, total: 40 }),
    answerable: Object.freeze({ required: 19, total: 20 }),
    perPackNoAnswer: Object.freeze({ required: 7, total: 8 }),
    perPackAnswerable: Object.freeze({ required: 3, total: 4 }),
    externalVerification: Object.freeze({ required: 10, total: 10 }),
  }),
  HELDOUT: Object.freeze({
    noAnswer: Object.freeze({ required: 18, total: 20 }),
    answerable: Object.freeze({ required: 9, total: 10 }),
    perPackNoAnswer: Object.freeze({ required: 3, total: 4 }),
    perPackAnswerable: Object.freeze({ required: 2, total: 2 }),
    externalVerification: Object.freeze({ required: 5, total: 5 }),
  }),
} as const);

export const T41_RUNTIME_QUERY_KEYS = Object.freeze([
  "excludeAssetIds",
  "mode",
  "normalizedText",
  "originalText",
  "queryAsset",
  "schemaVersion",
  "scope",
] as const);

export const T41_PROVIDER_FORBIDDEN_CASE_FIELDS = Object.freeze([
  "category",
  "expectation",
  "familyId",
  "reasonClass",
  "targetObjectIds",
] as const);

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const IdSchema = z.string().regex(ID_PATTERN);
const ImmutableRevisionSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      !new Set(["latest", "main", "master", "head", "stable", "current"]).has(
        value.toLowerCase(),
      ),
    "model revision must be immutable",
  );

export const T41BoundaryIdentityHashesSchema = z
  .object({
    capabilityEntityManifestHash: HashSchema,
    packCompetitionPolicyHash: HashSchema,
    packCompetitionCalibrationHash: HashSchema,
    lexicalPackCompetitionAlgorithmHash: HashSchema,
    textPackCompetitionAlgorithmHash: HashSchema,
    acceptancePolicyHash: HashSchema,
  })
  .strict();

export const T41ProviderStatusSchema = z.enum([
  "SUCCESS",
  "DEGRADED",
  "EMPTY",
  "UNSUPPORTED",
  "TIMEOUT",
  "ERROR",
]);

const T41ChannelIdentitySchema = z
  .object({
    activeIndexBundleHash: HashSchema,
    providerIndexBundleHash: HashSchema.nullable(),
    indexVersionId: IdSchema,
    modelId: z.string().trim().min(1).max(300).nullable(),
    modelRevision: ImmutableRevisionSchema.nullable(),
    configHash: HashSchema,
    payloadHashes: z.array(HashSchema).min(1).max(20),
  })
  .strict();

export const T41RuntimeIdentitySchema = z
  .object({
    runtimeKind: z.literal("EVIDENCE_BUNDLE_V2"),
    bundleSchemaVersion: z.literal(2),
    corpusBundleHash: HashSchema,
    activeIndexBundleHash: HashSchema,
    relationConfigHash: HashSchema,
    normalizerConfigHash: HashSchema,
    rrfConfigHash: HashSchema,
    capabilityEntityManifestHash: HashSchema,
    packCompetitionPolicyHash: HashSchema,
    packCompetitionCalibrationHash: HashSchema,
    lexicalPackCompetitionAlgorithmHash: HashSchema,
    textPackCompetitionAlgorithmHash: HashSchema,
    acceptancePolicyHash: HashSchema,
    channels: z
      .array(
        z
          .object({
            channel: z.enum(["LEXICAL", "TEXT_VECTOR", "VISUAL_VECTOR"]),
            identity: T41ChannelIdentitySchema.nullable(),
          })
          .strict(),
      )
      .length(3),
  })
  .strict()
  .superRefine((identity, context) => {
    const channelNames = identity.channels.map(({ channel }) => channel);
    if (new Set(channelNames).size !== channelNames.length) {
      context.addIssue({
        code: "custom",
        message: "runtime identity channels must be unique",
        path: ["channels"],
      });
    }
    identity.channels.forEach((channel, index) => {
      if (!channel.identity) return;
      const channelIdentity = channel.identity;
      const isVector = channel.channel !== "LEXICAL";

      if (
        channelIdentity.activeIndexBundleHash !==
        identity.activeIndexBundleHash
      ) {
        context.addIssue({
          code: "custom",
          message: "channel active index hash must match runtime identity",
          path: ["channels", index, "identity", "activeIndexBundleHash"],
        });
      }
      if (
        new Set(channelIdentity.payloadHashes).size !==
        channelIdentity.payloadHashes.length
      ) {
        context.addIssue({
          code: "custom",
          message: "channel payload hashes must be unique",
          path: ["channels", index, "identity", "payloadHashes"],
        });
      }
      if (
        (channelIdentity.modelId === null) !==
        (channelIdentity.modelRevision === null)
      ) {
        context.addIssue({
          code: "custom",
          message: "model id and revision must be declared together",
          path: ["channels", index, "identity"],
        });
      }
      if (
        isVector !== (channelIdentity.providerIndexBundleHash !== null) ||
        isVector !==
          (channelIdentity.modelId !== null &&
            channelIdentity.modelRevision !== null)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "vector channels require provider/model identity and lexical must omit it",
          path: ["channels", index, "identity"],
        });
      }
    });
  });

export const T41ProviderObservationSchema = z
  .object({
    status: T41ProviderStatusSchema,
    objectIds: z.array(IdSchema).max(20),
    identity: T41RuntimeIdentitySchema,
    latencyMs: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((observation, context) => {
    if (new Set(observation.objectIds).size !== observation.objectIds.length) {
      context.addIssue({
        code: "custom",
        message: "provider objectIds must be unique",
        path: ["objectIds"],
      });
    }

    if (
      observation.status === "SUCCESS" &&
      observation.objectIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "SUCCESS requires at least one objectId",
        path: ["objectIds"],
      });
    }

    if (
      new Set(["EMPTY", "UNSUPPORTED", "TIMEOUT", "ERROR"]).has(
        observation.status,
      ) &&
      observation.objectIds.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: `${observation.status} cannot contain objectIds`,
        path: ["objectIds"],
      });
    }
  });

export type T41ProviderStatus = z.infer<typeof T41ProviderStatusSchema>;
export type T41RuntimeIdentity = z.infer<typeof T41RuntimeIdentitySchema>;
export type T41ProviderObservation = z.infer<
  typeof T41ProviderObservationSchema
>;

export type T41RuntimeProvider = {
  retrieve(query: Readonly<RetrievalQueryV2>): Promise<unknown>;
};

export type T41CaseScore = {
  pass: boolean;
  outcome:
    | "ANSWERABLE_TARGET_HIT"
    | "ANSWERABLE_TARGET_MISS"
    | "NO_ANSWER_EMPTY"
    | "NO_ANSWER_EXPECTED_EMPTY_STATUS";
  matchedTargetObjectIds: string[];
};

export type T41EvaluatedCase = {
  caseId: string;
  split: T41Split;
  familyId: string;
  coursePackId: T41CoursePackId;
  category: T41AnswerabilityCategory;
  expectation: T41Expectation;
  reasonClass: T41AnswerabilityCase["reasonClass"];
  targetObjectIds: string[];
  providerStatus: T41ProviderStatus;
  returnedObjectIds: string[];
  matchedTargetObjectIds: string[];
  pass: boolean;
  outcome: T41CaseScore["outcome"];
  latencyMs: number;
  runtimeQuerySha256: string;
  runtimeIdentitySha256: string;
  scopeViolation: boolean;
};

type T41ExpectationAggregate = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
};

export type T41Aggregate = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  answerable: T41ExpectationAggregate;
  noAnswer: T41ExpectationAggregate;
  providerStatuses: Record<T41ProviderStatus, number>;
};

export type T41GateResult = {
  gateId: string;
  group: "QUALITY" | "RUNTIME_INTEGRITY";
  metric:
    | "NO_ANSWER_EMPTY"
    | "ANSWERABLE_TARGET_HIT"
    | "EXTERNAL_VERIFICATION_EMPTY"
    | "IDENTITY"
    | "LEAKAGE"
    | "ERROR_TIMEOUT_COUNT"
    | "SCOPE_VIOLATION_COUNT";
  scope: {
    split: T41Split;
    coursePackId?: T41CoursePackId;
    category?: T41AnswerabilityCategory;
    expectation?: T41Expectation;
  };
  comparator: "AT_LEAST" | "EQUALS";
  observed: number | boolean;
  required: number | boolean;
  denominator: number | null;
  passed: boolean;
};

export type T41AnswerabilityReport = {
  schemaVersion: 1;
  evaluatorVersion: string;
  generatedAt: string;
  reportPassed: boolean;
  suite: {
    suiteVersion: string;
    split: T41Split;
    splitRole: "MODEL_DEVELOPMENT" | "FINAL_BLIND_EVALUATION";
    suiteSha256: string;
    byteLength: number;
  };
  requestedCorpusBundleHash: string;
  aggregates: {
    overall: T41Aggregate;
    bySplit: Record<T41Split, T41Aggregate | null>;
    byPack: Record<T41CoursePackId, T41Aggregate>;
    byCategory: Record<T41AnswerabilityCategory, T41Aggregate>;
  };
  gates: {
    passed: boolean;
    qualityPassed: boolean;
    runtimeIntegrityPassed: boolean;
    results: T41GateResult[];
  };
  cases: T41EvaluatedCase[];
  identityAudit: {
    consistentAcrossCases: boolean;
    corpusBundleHashMatchesQuery: boolean;
    allChannelsIdentified: boolean;
    uniqueIdentityCount: number;
    identities: Array<{
      runtimeIdentitySha256: string;
      caseCount: number;
      caseIds: string[];
      identity: T41RuntimeIdentity;
    }>;
    violations: string[];
  };
  leakageAudit: {
    passed: boolean;
    providerCallArgumentCount: 1;
    allowedRuntimeQueryKeys: readonly string[];
    forbiddenCaseFields: readonly string[];
    observedRuntimeQueryKeySets: Array<{
      keys: string[];
      caseCount: number;
    }>;
    groundTruthSentToProvider: false;
    categorySentToProvider: false;
    caseMetadataSentToProvider: false;
    questionsIncludedInReport: false;
    violations: string[];
  };
};

export type EvaluateT41AnswerabilityOptions = {
  loadedSuite: LoadedT41AnswerabilitySuite;
  corpusBundleHash: string;
  provider: T41RuntimeProvider;
  generatedAt?: string;
  allowHeldoutEvaluation?: boolean;
};

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function expectationAggregate(
  cases: readonly T41EvaluatedCase[],
  expectation: T41Expectation,
): T41ExpectationAggregate {
  const matching = cases.filter(
    (testCase) => testCase.expectation === expectation,
  );
  const passed = matching.filter((testCase) => testCase.pass).length;
  return {
    total: matching.length,
    passed,
    failed: matching.length - passed,
    passRate: matching.length === 0 ? 0 : round(passed / matching.length),
  };
}

function aggregate(cases: readonly T41EvaluatedCase[]): T41Aggregate {
  const passed = cases.filter((testCase) => testCase.pass).length;
  const providerStatuses = Object.fromEntries(
    T41ProviderStatusSchema.options.map((status) => [status, 0]),
  ) as Record<T41ProviderStatus, number>;
  for (const testCase of cases) {
    providerStatuses[testCase.providerStatus] += 1;
  }
  return {
    total: cases.length,
    passed,
    failed: cases.length - passed,
    passRate: cases.length === 0 ? 0 : round(passed / cases.length),
    answerable: expectationAggregate(cases, "ANSWERABLE"),
    noAnswer: expectationAggregate(cases, "NO_ANSWER"),
    providerStatuses,
  };
}

function qualityCountGate(input: {
  gateId: string;
  metric: T41GateResult["metric"];
  split: T41Split;
  cases: readonly T41EvaluatedCase[];
  required: number;
  total: number;
  coursePackId?: T41CoursePackId;
  category?: T41AnswerabilityCategory;
  expectation?: T41Expectation;
}): T41GateResult {
  const observed = input.cases.filter((testCase) => testCase.pass).length;
  const exact = input.required === input.total;
  return {
    gateId: input.gateId,
    group: "QUALITY",
    metric: input.metric,
    scope: {
      split: input.split,
      ...(input.coursePackId
        ? { coursePackId: input.coursePackId }
        : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.expectation
        ? { expectation: input.expectation }
        : {}),
    },
    comparator: exact ? "EQUALS" : "AT_LEAST",
    observed,
    required: input.required,
    denominator: input.total,
    passed:
      input.cases.length === input.total &&
      (exact ? observed === input.required : observed >= input.required),
  };
}

function runtimeBooleanGate(input: {
  gateId: string;
  metric: T41GateResult["metric"];
  split: T41Split;
  observed: boolean;
}): T41GateResult {
  return {
    gateId: input.gateId,
    group: "RUNTIME_INTEGRITY",
    metric: input.metric,
    scope: { split: input.split },
    comparator: "EQUALS",
    observed: input.observed,
    required: true,
    denominator: null,
    passed: input.observed,
  };
}

function runtimeZeroGate(input: {
  gateId: string;
  metric: T41GateResult["metric"];
  split: T41Split;
  observed: number;
  denominator: number;
}): T41GateResult {
  return {
    gateId: input.gateId,
    group: "RUNTIME_INTEGRITY",
    metric: input.metric,
    scope: { split: input.split },
    comparator: "EQUALS",
    observed: input.observed,
    required: 0,
    denominator: input.denominator,
    passed: input.observed === 0,
  };
}

function buildQualityGates(
  split: T41Split,
  cases: readonly T41EvaluatedCase[],
): T41GateResult[] {
  const thresholds = T41_ANSWERABILITY_GATE_THRESHOLDS[split];
  const noAnswerCases = cases.filter(
    (testCase) => testCase.expectation === "NO_ANSWER",
  );
  const answerableCases = cases.filter(
    (testCase) => testCase.expectation === "ANSWERABLE",
  );
  const gates = [
    qualityCountGate({
      gateId: `quality-${split.toLowerCase()}-no-answer`,
      metric: "NO_ANSWER_EMPTY",
      split,
      cases: noAnswerCases,
      required: thresholds.noAnswer.required,
      total: thresholds.noAnswer.total,
      expectation: "NO_ANSWER",
    }),
    qualityCountGate({
      gateId: `quality-${split.toLowerCase()}-answerable`,
      metric: "ANSWERABLE_TARGET_HIT",
      split,
      cases: answerableCases,
      required: thresholds.answerable.required,
      total: thresholds.answerable.total,
      expectation: "ANSWERABLE",
    }),
  ];

  for (const coursePackId of T41_COURSE_PACK_IDS) {
    gates.push(
      qualityCountGate({
        gateId:
          `quality-${split.toLowerCase()}-${coursePackId}-no-answer`,
        metric: "NO_ANSWER_EMPTY",
        split,
        cases: noAnswerCases.filter(
          (testCase) => testCase.coursePackId === coursePackId,
        ),
        required: thresholds.perPackNoAnswer.required,
        total: thresholds.perPackNoAnswer.total,
        coursePackId,
        expectation: "NO_ANSWER",
      }),
      qualityCountGate({
        gateId:
          `quality-${split.toLowerCase()}-${coursePackId}-answerable`,
        metric: "ANSWERABLE_TARGET_HIT",
        split,
        cases: answerableCases.filter(
          (testCase) => testCase.coursePackId === coursePackId,
        ),
        required: thresholds.perPackAnswerable.required,
        total: thresholds.perPackAnswerable.total,
        coursePackId,
        expectation: "ANSWERABLE",
      }),
    );
  }

  const externalCases = cases.filter(
    (testCase) =>
      testCase.category === "EXTERNAL_VERIFICATION_REQUIRED",
  );
  gates.push(
    qualityCountGate({
      gateId: `quality-${split.toLowerCase()}-external-verification`,
      metric: "EXTERNAL_VERIFICATION_EMPTY",
      split,
      cases: externalCases,
      required: thresholds.externalVerification.required,
      total: thresholds.externalVerification.total,
      category: "EXTERNAL_VERIFICATION_REQUIRED",
      expectation: "NO_ANSWER",
    }),
  );

  return gates;
}

function queryKeySet(query: RetrievalQueryV2): string[] {
  return Object.keys(query).sort(compareCodePoints);
}

function containsObjectKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsObjectKey(item, key));
  }
  if (!value || typeof value !== "object") return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.some(
    ([candidate, child]) =>
      candidate === key || containsObjectKey(child, key),
  );
}

function expectedQueryKeySet(): string[] {
  return [...T41_RUNTIME_QUERY_KEYS].sort(compareCodePoints);
}

function buildRuntimeQuery(
  testCase: T41AnswerabilityCase,
  corpusBundleHash: string,
): RetrievalQueryV2 {
  return deepFreeze(
    createRetrievalQueryV2({
      mode: "TEXT_TO_TEXT",
      text: testCase.question,
      scope: {
        corpusBundleHash,
        sourceCoursePack: {
          id: testCase.coursePackId,
          version: "1",
        },
      },
    }),
  );
}

export function scoreT41AnswerabilityCase(
  testCase: T41AnswerabilityCase,
  rawObservation: T41ProviderObservation,
): T41CaseScore {
  const observation = T41ProviderObservationSchema.parse(rawObservation);
  const targetSet = new Set(testCase.targetObjectIds);
  const matchedTargetObjectIds = observation.objectIds.filter((objectId) =>
    targetSet.has(objectId),
  );

  if (testCase.expectation === "NO_ANSWER") {
    const pass = observation.status === "EMPTY";
    return {
      pass,
      outcome: pass
        ? "NO_ANSWER_EMPTY"
        : "NO_ANSWER_EXPECTED_EMPTY_STATUS",
      matchedTargetObjectIds,
    };
  }

  const pass = matchedTargetObjectIds.length > 0;
  return {
    pass,
    outcome: pass
      ? "ANSWERABLE_TARGET_HIT"
      : "ANSWERABLE_TARGET_MISS",
    matchedTargetObjectIds,
  };
}

export async function evaluateT41Answerability(
  options: EvaluateT41AnswerabilityOptions,
): Promise<T41AnswerabilityReport> {
  const corpusBundleHash = HashSchema.parse(options.corpusBundleHash);
  const suite = T41AnswerabilitySuiteSchema.parse(
    options.loadedSuite.suite,
  );
  const suiteSha256 = HashSchema.parse(options.loadedSuite.suiteSha256);
  const byteLength = z
    .number()
    .int()
    .positive()
    .parse(options.loadedSuite.byteLength);

  if (suiteSha256 !== T41_ANSWERABILITY_SUITE_SHA256[suite.split]) {
    throw new Error(
      `T4.1 ${suite.split} evaluator received an unfrozen suite digest`,
    );
  }

  if (
    suite.split === "HELDOUT" &&
    options.allowHeldoutEvaluation !== true
  ) {
    throw new Error(
      "T4.1 HELDOUT evaluation requires explicit allowHeldoutEvaluation authorization",
    );
  }

  const expectedKeys = expectedQueryKeySet();
  const evaluatedCases: T41EvaluatedCase[] = [];
  const keySetCounts = new Map<string, { keys: string[]; caseCount: number }>();
  const leakageViolations: string[] = [];
  const identityGroups = new Map<
    string,
    {
      runtimeIdentitySha256: string;
      caseIds: string[];
      identity: T41RuntimeIdentity;
    }
  >();

  for (const testCase of suite.cases) {
    const runtimeQuery = buildRuntimeQuery(testCase, corpusBundleHash);
    const runtimeQuerySha256 = sha256(runtimeQuery);
    const keysBeforeCall = queryKeySet(runtimeQuery);
    const keySetKey = stableJson(keysBeforeCall);
    const keySetEntry = keySetCounts.get(keySetKey);
    if (keySetEntry) {
      keySetEntry.caseCount += 1;
    } else {
      keySetCounts.set(keySetKey, {
        keys: keysBeforeCall,
        caseCount: 1,
      });
    }

    if (stableJson(keysBeforeCall) !== stableJson(expectedKeys)) {
      leakageViolations.push(
        `${testCase.id}: unexpected runtime query key set`,
      );
    }
    for (const forbiddenField of T41_PROVIDER_FORBIDDEN_CASE_FIELDS) {
      if (containsObjectKey(runtimeQuery, forbiddenField)) {
        leakageViolations.push(
          `${testCase.id}: forbidden field ${forbiddenField} reached provider`,
        );
      }
    }

    const retrieve = options.provider.retrieve;
    const rawObservation = await retrieve(runtimeQuery);
    const observation = T41ProviderObservationSchema.parse(rawObservation);

    if (stableJson(queryKeySet(runtimeQuery)) !== stableJson(keysBeforeCall)) {
      leakageViolations.push(
        `${testCase.id}: provider mutated runtime query keys`,
      );
    }
    if (sha256(runtimeQuery) !== runtimeQuerySha256) {
      leakageViolations.push(
        `${testCase.id}: provider mutated runtime query values`,
      );
    }

    const score = scoreT41AnswerabilityCase(testCase, observation);
    const runtimeIdentitySha256 = sha256(observation.identity);
    const scopeViolation =
      observation.identity.corpusBundleHash !== corpusBundleHash;
    const identityGroup = identityGroups.get(runtimeIdentitySha256);
    if (identityGroup) {
      identityGroup.caseIds.push(testCase.id);
    } else {
      identityGroups.set(runtimeIdentitySha256, {
        runtimeIdentitySha256,
        caseIds: [testCase.id],
        identity: observation.identity,
      });
    }

    evaluatedCases.push({
      caseId: testCase.id,
      split: suite.split,
      familyId: testCase.familyId,
      coursePackId: testCase.coursePackId,
      category: testCase.category,
      expectation: testCase.expectation,
      reasonClass: testCase.reasonClass,
      targetObjectIds: [...testCase.targetObjectIds],
      providerStatus: observation.status,
      returnedObjectIds: [...observation.objectIds],
      matchedTargetObjectIds: score.matchedTargetObjectIds,
      pass: score.pass,
      outcome: score.outcome,
      latencyMs: observation.latencyMs,
      runtimeQuerySha256,
      runtimeIdentitySha256,
      scopeViolation,
    });
  }

  const identities = [...identityGroups.values()]
    .sort((left, right) =>
      compareCodePoints(
        left.runtimeIdentitySha256,
        right.runtimeIdentitySha256,
      ),
    )
    .map((group) => ({
      runtimeIdentitySha256: group.runtimeIdentitySha256,
      caseCount: group.caseIds.length,
      caseIds: [...group.caseIds],
      identity: group.identity,
    }));
  const identityViolations: string[] = [];
  if (identities.length !== 1) {
    identityViolations.push(
      `expected one runtime identity, observed ${identities.length}`,
    );
  }
  const corpusBundleHashMatchesQuery = identities.every(
    ({ identity }) => identity.corpusBundleHash === corpusBundleHash,
  );
  if (!corpusBundleHashMatchesQuery) {
    identityViolations.push(
      "provider corpusBundleHash does not match requested query corpus",
    );
  }
  const allChannelsIdentified = identities.every(({ identity }) =>
    identity.channels.every((channel) => channel.identity !== null),
  );
  if (!allChannelsIdentified) {
    identityViolations.push(
      "one or more runtime channels lack immutable identity",
    );
  }

  const bySplit: Record<T41Split, T41Aggregate | null> = {
    DEV: null,
    HELDOUT: null,
  };
  bySplit[suite.split] = aggregate(evaluatedCases);

  const byPack = Object.fromEntries(
    T41_COURSE_PACK_IDS.map((coursePackId) => [
      coursePackId,
      aggregate(
        evaluatedCases.filter(
          (testCase) => testCase.coursePackId === coursePackId,
        ),
      ),
    ]),
  ) as Record<T41CoursePackId, T41Aggregate>;

  const byCategory = Object.fromEntries(
    T41_ANSWERABILITY_CATEGORIES.map((category) => [
      category,
      aggregate(
        evaluatedCases.filter(
          (testCase) => testCase.category === category,
        ),
      ),
    ]),
  ) as Record<T41AnswerabilityCategory, T41Aggregate>;

  const overall = aggregate(evaluatedCases);
  const leakagePassed = leakageViolations.length === 0;
  const identityPassed =
    identities.length === 1 &&
    corpusBundleHashMatchesQuery &&
    allChannelsIdentified;
  const qualityGates = buildQualityGates(suite.split, evaluatedCases);
  const errorTimeoutCount = evaluatedCases.filter(
    (testCase) =>
      testCase.providerStatus === "ERROR" ||
      testCase.providerStatus === "TIMEOUT",
  ).length;
  const scopeViolationCount = evaluatedCases.filter(
    (testCase) => testCase.scopeViolation,
  ).length;
  const runtimeGates = [
    runtimeBooleanGate({
      gateId: `runtime-${suite.split.toLowerCase()}-identity`,
      metric: "IDENTITY",
      split: suite.split,
      observed: identityPassed,
    }),
    runtimeBooleanGate({
      gateId: `runtime-${suite.split.toLowerCase()}-leakage`,
      metric: "LEAKAGE",
      split: suite.split,
      observed: leakagePassed,
    }),
    runtimeZeroGate({
      gateId: `runtime-${suite.split.toLowerCase()}-error-timeout-zero`,
      metric: "ERROR_TIMEOUT_COUNT",
      split: suite.split,
      observed: errorTimeoutCount,
      denominator: evaluatedCases.length,
    }),
    runtimeZeroGate({
      gateId: `runtime-${suite.split.toLowerCase()}-scope-violation-zero`,
      metric: "SCOPE_VIOLATION_COUNT",
      split: suite.split,
      observed: scopeViolationCount,
      denominator: evaluatedCases.length,
    }),
  ];
  const gateResults = [...qualityGates, ...runtimeGates];
  const qualityPassed = qualityGates.every((gate) => gate.passed);
  const runtimeIntegrityPassed = runtimeGates.every(
    (gate) => gate.passed,
  );

  return {
    schemaVersion: 1,
    evaluatorVersion: T41_ANSWERABILITY_EVALUATOR_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    reportPassed: qualityPassed && runtimeIntegrityPassed,
    suite: {
      suiteVersion: suite.suiteVersion,
      split: suite.split,
      splitRole: suite.splitRole,
      suiteSha256,
      byteLength,
    },
    requestedCorpusBundleHash: corpusBundleHash,
    aggregates: {
      overall,
      bySplit,
      byPack,
      byCategory,
    },
    gates: {
      passed: qualityPassed && runtimeIntegrityPassed,
      qualityPassed,
      runtimeIntegrityPassed,
      results: gateResults,
    },
    cases: evaluatedCases,
    identityAudit: {
      consistentAcrossCases: identities.length === 1,
      corpusBundleHashMatchesQuery,
      allChannelsIdentified,
      uniqueIdentityCount: identities.length,
      identities,
      violations: identityViolations,
    },
    leakageAudit: {
      passed: leakagePassed,
      providerCallArgumentCount: 1,
      allowedRuntimeQueryKeys: T41_RUNTIME_QUERY_KEYS,
      forbiddenCaseFields: T41_PROVIDER_FORBIDDEN_CASE_FIELDS,
      observedRuntimeQueryKeySets: [...keySetCounts.values()],
      groundTruthSentToProvider: false,
      categorySentToProvider: false,
      caseMetadataSentToProvider: false,
      questionsIncludedInReport: false,
      violations: leakageViolations,
    },
  };
}

export function createT41EvidenceBundleProvider(
  retrieve: (
    query: Readonly<RetrievalQueryV2>,
  ) => Promise<EvidenceBundleV2 | unknown>,
  declaredChannelIdentities?: Readonly<Record<
    "LEXICAL" | "TEXT_VECTOR" | "VISUAL_VECTOR",
    NonNullable<EvidenceBundleV2["channels"][number]["identity"]>
  >>,
): T41RuntimeProvider {
  return {
    async retrieve(rawQuery) {
      const query = RetrievalQueryV2Schema.parse(rawQuery);
      const bundle = EvidenceBundleV2Schema.parse(await retrieve(query));

      if (stableJson(bundle.query) !== stableJson(query)) {
        throw new Error("runtime returned evidence for a different query");
      }
      if (
        bundle.provenance.corpusBundleHash !== query.scope.corpusBundleHash
      ) {
        throw new Error(
          "runtime returned evidence for a different corpus bundle",
        );
      }
      const provenance = bundle.provenance as unknown as Record<
        string,
        unknown
      >;
      const boundaryIdentityHashes =
        T41BoundaryIdentityHashesSchema.parse({
          capabilityEntityManifestHash:
            provenance.capabilityEntityManifestHash,
          packCompetitionPolicyHash:
            provenance.packCompetitionPolicyHash,
          packCompetitionCalibrationHash:
            provenance.packCompetitionCalibrationHash,
          lexicalPackCompetitionAlgorithmHash:
            provenance.lexicalPackCompetitionAlgorithmHash,
          textPackCompetitionAlgorithmHash:
            provenance.textPackCompetitionAlgorithmHash,
          acceptancePolicyHash: provenance.acceptancePolicyHash,
        });
      const channels = bundle.channels.map(({ channel, identity }) => {
        const declaredIdentity =
          declaredChannelIdentities?.[channel] ?? identity;
        if (
          identity
          && declaredIdentity
          && stableJson(identity) !== stableJson(declaredIdentity)
        ) {
          throw new Error(
            `runtime channel identity drifted from declaration: ${channel}`,
          );
        }
        return {
          channel,
          identity: declaredIdentity,
        };
      });

      return T41ProviderObservationSchema.parse({
        status: bundle.status,
        objectIds: bundle.evidence.primary.map(({ objectId }) => objectId),
        latencyMs: bundle.timing.totalMs,
        identity: {
          runtimeKind: "EVIDENCE_BUNDLE_V2",
          bundleSchemaVersion: bundle.schemaVersion,
          corpusBundleHash: bundle.provenance.corpusBundleHash,
          activeIndexBundleHash:
            bundle.provenance.activeIndexBundleHash,
          relationConfigHash: bundle.provenance.relationConfigHash,
          normalizerConfigHash:
            bundle.provenance.normalizerConfigHash,
          rrfConfigHash: bundle.provenance.rrfConfigHash,
          ...boundaryIdentityHashes,
          channels,
        },
      });
    },
  };
}

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  EvidenceBundleV2Schema,
  type EvidenceBundleV2,
} from "../../lib/knowledge/evidence-bundle-v2";
import {
  createRetrievalQueryV2,
  type RetrievalQueryV2,
} from "../../lib/knowledge/retrieval-query-v2";
import {
  T42_COURSE_PACK_IDS,
  T42_RECALL_SUITE_SHA256,
  T42RecallSuiteSchema,
  type LoadedT42RecallSuite,
  type T42CoursePackId,
  type T42Expectation,
  type T42RecallCase,
} from "./t42-recall-loader";

export const T42_RECALL_EVALUATOR_VERSION = "2026-07-28.1";

export const T42RecallArmSchema = z.enum([
  "A0_EXACT_NODE",
  "B_OBJECT_CONSENSUS",
]);

export const T42_OBJECT_RECALL_UNAVAILABLE_REASON =
  "UNAVAILABLE_NOT_EMITTED_BY_EXACT_NODE_BASELINE";
export const T42_OBJECT_RECALL_MISSING_TRACE_REASON =
  "MISSING_OBJECT_RANKING_TRACE";

export const T42_RECALL_GATE_THRESHOLDS = Object.freeze({
  objectRecallAt10: Object.freeze({ required: 24, total: 25 }),
  noAnswer: Object.freeze({ required: 14, total: 15 }),
  retrievalP95Ms: 500,
} as const);

export const T42_RUNTIME_QUERY_KEYS = Object.freeze([
  "excludeAssetIds",
  "mode",
  "normalizedText",
  "originalText",
  "queryAsset",
  "schemaVersion",
  "scope",
] as const);

export const T42_PROVIDER_FORBIDDEN_CASE_FIELDS = Object.freeze([
  "clusterId",
  "expected",
  "expectation",
  "familyId",
  "requiredEvidenceGroups",
  "targetObjectIds",
] as const);

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const HashSchema = z.string().regex(HASH_PATTERN);

export type T42RecallArm = z.infer<typeof T42RecallArmSchema>;
export type T42ProviderStatus = EvidenceBundleV2["status"];

export type T42RuntimeProvider = {
  retrieve(query: Readonly<RetrievalQueryV2>): Promise<unknown>;
};

export type T42EvidenceGroupResult = {
  requiredNodeIds: string[];
  matchedPrimaryNodeIds: string[];
  matchedRetainedNodeIds: string[];
  primaryCovered: boolean;
  retainedCovered: boolean;
};

export type T42CaseScore = {
  pass: boolean;
  outcome:
    | "ANSWERABLE_COMPLETE"
    | "ANSWERABLE_OBJECT_RANKING_UNAVAILABLE"
    | "ANSWERABLE_OBJECT_RECALL_MISS"
    | "ANSWERABLE_PRIMARY_OBJECT_MISS"
    | "ANSWERABLE_REQUIRED_EVIDENCE_MISS"
    | "NO_ANSWER_EMPTY_NO_PRIMARY"
    | "NO_ANSWER_EXPECTED_EMPTY_NO_PRIMARY";
  objectRecallAt10: boolean | null;
  objectRecallAt10Reason:
    | typeof T42_OBJECT_RECALL_UNAVAILABLE_REASON
    | typeof T42_OBJECT_RECALL_MISSING_TRACE_REASON
    | "NOT_APPLICABLE_NO_ANSWER"
    | null;
  objectRankAt10: number | null;
  objectIdsAt10: string[] | null;
  matchedTargetObjectIdsAt10: string[];
  primaryObjectIds: string[];
  matchedPrimaryObjectIds: string[];
  primaryObjectHit: boolean | null;
  firstPrimaryObjectId: string | null;
  firstPrimaryObjectHit: boolean | null;
  primaryNodeIds: string[];
  retainedNodeIds: string[];
  requiredEvidenceGroups: T42EvidenceGroupResult[];
  requiredEvidenceGroupsCovered: boolean | null;
  retainedEvidenceGroupsCovered: boolean | null;
  noAnswerEmptyNoPrimary: boolean | null;
};

export type T42EvaluatedCase = T42CaseScore & {
  caseId: string;
  familyId: string;
  clusterId: string;
  coursePackId: T42CoursePackId;
  expectation: T42Expectation;
  arm: T42RecallArm;
  targetObjectIds: string[];
  providerStatus: T42ProviderStatus;
  retrievalLatencyMs: number;
  totalLatencyMs: number;
  bundleId: string;
  runtimeQuerySha256: string;
  objectRankingSha256: string | null;
  scopeViolation: boolean;
};

export type T42MetricAggregate = {
  eligible: number;
  passed: number;
  failed: number;
  passRate: number | null;
};

export type T42AvailabilityMetricAggregate = T42MetricAggregate & {
  available: number;
  unavailable: number;
  availability: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  unavailableReason:
    | typeof T42_OBJECT_RECALL_UNAVAILABLE_REASON
    | typeof T42_OBJECT_RECALL_MISSING_TRACE_REASON
    | null;
};

export type T42RecallAggregate = {
  total: number;
  answerable: number;
  noAnswer: number;
  casePass: T42MetricAggregate;
  objectRecallAt10: T42AvailabilityMetricAggregate;
  primaryObjectHit: T42MetricAggregate;
  firstPrimaryObjectHit: T42MetricAggregate;
  requiredEvidenceGroupsCovered: T42MetricAggregate;
  retainedEvidenceGroupsCovered: T42MetricAggregate;
  noAnswerEmptyNoPrimary: T42MetricAggregate;
  providerStatuses: Record<T42ProviderStatus, number>;
  latencyMs: {
    p50: number;
    p95: number;
    max: number;
  };
  totalLatencyMs: {
    p50: number;
    p95: number;
    max: number;
  };
};

export type T42GateResult = {
  gateId: string;
  group: "QUALITY" | "RUNTIME_INTEGRITY";
  metric:
    | "OBJECT_RECALL_AT_10"
    | "NO_ANSWER_EMPTY_NO_PRIMARY"
    | "OBJECT_RANKING_TRACE"
    | "LEAKAGE"
    | "ERROR_TIMEOUT_COUNT"
    | "SCOPE_VIOLATION_COUNT"
    | "RETRIEVAL_P95_MS";
  comparator: "AT_LEAST" | "AT_MOST" | "EQUALS";
  observed: number | boolean | null;
  required: number | boolean;
  denominator: number | null;
  passed: boolean;
  reason: string | null;
};

export type T42RecallReport = {
  schemaVersion: 1;
  evaluatorVersion: string;
  generatedAt: string;
  arm: T42RecallArm;
  reportPassed: boolean;
  suite: {
    suiteId: "T42-RECALL-DEV";
    suiteVersion: string;
    split: "DEV";
    splitRole: "MODEL_DEVELOPMENT";
    suiteSha256: string;
    byteLength: number;
    corpusBundleHash: string;
  };
  aggregates: {
    overall: T42RecallAggregate;
    byPack: Record<T42CoursePackId, T42RecallAggregate>;
  };
  gates: {
    passed: boolean;
    qualityPassed: boolean;
    runtimeIntegrityPassed: boolean;
    results: T42GateResult[];
  };
  cases: T42EvaluatedCase[];
  runtimeAudit: {
    objectRankingRequired: boolean;
    missingObjectRankingCaseIds: string[];
    errorTimeoutCount: number;
    scopeViolationCount: number;
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
    expectedSentToProvider: false;
    familyIdSentToProvider: false;
    clusterIdSentToProvider: false;
    targetObjectIdsSentToProvider: false;
    requiredEvidenceGroupsSentToProvider: false;
    coursePackIdSentOnlyInQueryScope: true;
    questionsIncludedInReport: false;
    violations: string[];
  };
};

export type EvaluateT42RecallOptions = {
  loadedSuite: LoadedT42RecallSuite;
  arm: T42RecallArm;
  provider: T42RuntimeProvider;
  generatedAt?: string;
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

function queryKeySet(query: RetrievalQueryV2): string[] {
  return Object.keys(query).sort(compareCodePoints);
}

function expectedQueryKeySet(): string[] {
  return [...T42_RUNTIME_QUERY_KEYS].sort(compareCodePoints);
}

function containsObjectKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsObjectKey(item, key));
  }
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([candidate, child]) =>
      candidate === key || containsObjectKey(child, key),
  );
}

function buildRuntimeQuery(
  testCase: T42RecallCase,
  corpusBundleHash: string,
): RetrievalQueryV2 {
  return deepFreeze(
    createRetrievalQueryV2({
      mode: "TEXT_TO_TEXT",
      text: testCase.runtime.question,
      scope: {
        corpusBundleHash,
        sourceCoursePack: {
          id: testCase.runtime.coursePackId,
          version: testCase.runtime.coursePackVersion,
        },
      },
    }),
  );
}

function uniqueInOrder(values: readonly string[]) {
  return [...new Set(values)];
}

function evaluateEvidenceGroups(
  requiredGroups: readonly (readonly string[])[],
  primaryNodeIds: ReadonlySet<string>,
  retainedNodeIds: ReadonlySet<string>,
): T42EvidenceGroupResult[] {
  return requiredGroups.map((requiredNodeIds) => {
    const matchedPrimaryNodeIds = requiredNodeIds.filter((nodeId) =>
      primaryNodeIds.has(nodeId),
    );
    const matchedRetainedNodeIds = requiredNodeIds.filter((nodeId) =>
      retainedNodeIds.has(nodeId),
    );
    return {
      requiredNodeIds: [...requiredNodeIds],
      matchedPrimaryNodeIds,
      matchedRetainedNodeIds,
      primaryCovered: matchedPrimaryNodeIds.length > 0,
      retainedCovered: matchedRetainedNodeIds.length > 0,
    };
  });
}

export function scoreT42RecallCase(
  testCase: T42RecallCase,
  rawBundle: EvidenceBundleV2,
  rawArm: T42RecallArm,
): T42CaseScore {
  const bundle = EvidenceBundleV2Schema.parse(rawBundle);
  const arm = T42RecallArmSchema.parse(rawArm);
  const targetSet = new Set(testCase.expected.targetObjectIds);
  const primaryObjectIds = uniqueInOrder(
    bundle.evidence.primary.map(({ objectId }) => objectId),
  );
  const matchedPrimaryObjectIds = primaryObjectIds.filter((objectId) =>
    targetSet.has(objectId),
  );
  const firstPrimaryObjectId =
    bundle.evidence.primary[0]?.objectId ?? null;
  const primaryNodeIds = uniqueInOrder(
    bundle.evidence.nodes
      .filter(({ relation }) => relation === "PRIMARY")
      .map(({ nodeId }) => nodeId),
  );
  const retainedNodeIds = uniqueInOrder(
    bundle.evidence.nodes.map(({ nodeId }) => nodeId),
  );

  if (testCase.expected.expectation === "NO_ANSWER") {
    const pass =
      bundle.status === "EMPTY" &&
      bundle.evidence.primary.length === 0;
    return {
      pass,
      outcome: pass
        ? "NO_ANSWER_EMPTY_NO_PRIMARY"
        : "NO_ANSWER_EXPECTED_EMPTY_NO_PRIMARY",
      objectRecallAt10: null,
      objectRecallAt10Reason: "NOT_APPLICABLE_NO_ANSWER",
      objectRankAt10: null,
      objectIdsAt10: null,
      matchedTargetObjectIdsAt10: [],
      primaryObjectIds,
      matchedPrimaryObjectIds: [],
      primaryObjectHit: null,
      firstPrimaryObjectId,
      firstPrimaryObjectHit: null,
      primaryNodeIds,
      retainedNodeIds,
      requiredEvidenceGroups: [],
      requiredEvidenceGroupsCovered: null,
      retainedEvidenceGroupsCovered: null,
      noAnswerEmptyNoPrimary: pass,
    };
  }

  const objectRanking =
    arm === "B_OBJECT_CONSENSUS"
      ? bundle.evidence.objectConsensus?.objectRanking ?? null
      : null;
  const objectIdsAt10 =
    objectRanking === null
      ? null
      : objectRanking
        .filter(({ rank }) => rank <= 10)
        .sort((left, right) => left.rank - right.rank)
        .map(({ objectId }) => objectId);
  const matchedTargetObjectIdsAt10 =
    objectIdsAt10?.filter((objectId) => targetSet.has(objectId)) ?? [];
  const objectRankAt10 =
    objectRanking
      ?.filter(({ objectId }) => targetSet.has(objectId))
      .reduce<number | null>(
        (best, { rank }) =>
          best === null || rank < best ? rank : best,
        null,
      ) ?? null;
  const objectRecallAt10 =
    objectIdsAt10 === null
      ? null
      : matchedTargetObjectIdsAt10.length > 0;
  const objectRecallAt10Reason =
    arm === "A0_EXACT_NODE"
      ? T42_OBJECT_RECALL_UNAVAILABLE_REASON
      : objectRanking === null
        ? T42_OBJECT_RECALL_MISSING_TRACE_REASON
        : null;
  const groupResults = evaluateEvidenceGroups(
    testCase.expected.requiredEvidenceGroups,
    new Set(primaryNodeIds),
    new Set(retainedNodeIds),
  );
  const requiredEvidenceGroupsCovered = groupResults.every(
    ({ primaryCovered }) => primaryCovered,
  );
  const retainedEvidenceGroupsCovered = groupResults.every(
    ({ retainedCovered }) => retainedCovered,
  );
  const primaryObjectHit = matchedPrimaryObjectIds.length > 0;
  const firstPrimaryObjectHit =
    firstPrimaryObjectId !== null &&
    targetSet.has(firstPrimaryObjectId);

  let outcome: T42CaseScore["outcome"];
  if (
    arm === "B_OBJECT_CONSENSUS" &&
    objectRecallAt10 === null
  ) {
    outcome = "ANSWERABLE_OBJECT_RANKING_UNAVAILABLE";
  } else if (objectRecallAt10 === false) {
    outcome = "ANSWERABLE_OBJECT_RECALL_MISS";
  } else if (!primaryObjectHit) {
    outcome = "ANSWERABLE_PRIMARY_OBJECT_MISS";
  } else if (!requiredEvidenceGroupsCovered) {
    outcome = "ANSWERABLE_REQUIRED_EVIDENCE_MISS";
  } else {
    outcome = "ANSWERABLE_COMPLETE";
  }

  const pass =
    primaryObjectHit &&
    requiredEvidenceGroupsCovered &&
    (
      arm === "A0_EXACT_NODE" ||
      objectRecallAt10 === true
    );

  return {
    pass,
    outcome,
    objectRecallAt10,
    objectRecallAt10Reason,
    objectRankAt10,
    objectIdsAt10,
    matchedTargetObjectIdsAt10,
    primaryObjectIds,
    matchedPrimaryObjectIds,
    primaryObjectHit,
    firstPrimaryObjectId,
    firstPrimaryObjectHit,
    primaryNodeIds,
    retainedNodeIds,
    requiredEvidenceGroups: groupResults,
    requiredEvidenceGroupsCovered,
    retainedEvidenceGroupsCovered,
    noAnswerEmptyNoPrimary: null,
  };
}

function metricAggregate(
  cases: readonly T42EvaluatedCase[],
  selector: (testCase: T42EvaluatedCase) => boolean | null,
): T42MetricAggregate {
  const values = cases
    .map(selector)
    .filter((value): value is boolean => value !== null);
  const passed = values.filter(Boolean).length;
  return {
    eligible: values.length,
    passed,
    failed: values.length - passed,
    passRate: values.length === 0 ? null : round(passed / values.length),
  };
}

function objectRecallAggregate(
  cases: readonly T42EvaluatedCase[],
  arm: T42RecallArm,
): T42AvailabilityMetricAggregate {
  const answerable = cases.filter(
    (testCase) => testCase.expectation === "ANSWERABLE",
  );
  const values = answerable
    .map(({ objectRecallAt10 }) => objectRecallAt10)
    .filter((value): value is boolean => value !== null);
  const passed = values.filter(Boolean).length;
  const available = values.length;
  const availability =
    available === 0
      ? "UNAVAILABLE"
      : available === answerable.length
        ? "AVAILABLE"
        : "PARTIAL";
  const unavailableReason =
    availability === "AVAILABLE"
      ? null
      : arm === "A0_EXACT_NODE"
        ? T42_OBJECT_RECALL_UNAVAILABLE_REASON
        : T42_OBJECT_RECALL_MISSING_TRACE_REASON;
  return {
    eligible: answerable.length,
    available,
    unavailable: answerable.length - available,
    availability,
    unavailableReason,
    passed,
    failed: answerable.length - passed,
    passRate:
      arm === "A0_EXACT_NODE" || answerable.length === 0
        ? null
        : round(passed / answerable.length),
  };
}

function percentile(values: readonly number[], percentileValue: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(
      sorted.length - 1,
      Math.ceil(percentileValue * sorted.length) - 1,
    ),
  );
  return round(sorted[index] ?? 0);
}

function aggregate(
  cases: readonly T42EvaluatedCase[],
  arm: T42RecallArm,
): T42RecallAggregate {
  const providerStatuses = Object.fromEntries(
    EvidenceBundleV2Schema.shape.status.options.map((status) => [
      status,
      0,
    ]),
  ) as Record<T42ProviderStatus, number>;
  for (const testCase of cases) {
    providerStatuses[testCase.providerStatus] += 1;
  }
  const retrievalLatencyValues = cases.map(
    ({ retrievalLatencyMs }) => retrievalLatencyMs,
  );
  const totalLatencyValues = cases.map(
    ({ totalLatencyMs }) => totalLatencyMs,
  );
  return {
    total: cases.length,
    answerable: cases.filter(
      ({ expectation }) => expectation === "ANSWERABLE",
    ).length,
    noAnswer: cases.filter(
      ({ expectation }) => expectation === "NO_ANSWER",
    ).length,
    casePass: metricAggregate(cases, ({ pass }) => pass),
    objectRecallAt10: objectRecallAggregate(cases, arm),
    primaryObjectHit: metricAggregate(
      cases,
      ({ primaryObjectHit }) => primaryObjectHit,
    ),
    firstPrimaryObjectHit: metricAggregate(
      cases,
      ({ firstPrimaryObjectHit }) => firstPrimaryObjectHit,
    ),
    requiredEvidenceGroupsCovered: metricAggregate(
      cases,
      ({ requiredEvidenceGroupsCovered }) =>
        requiredEvidenceGroupsCovered,
    ),
    retainedEvidenceGroupsCovered: metricAggregate(
      cases,
      ({ retainedEvidenceGroupsCovered }) =>
        retainedEvidenceGroupsCovered,
    ),
    noAnswerEmptyNoPrimary: metricAggregate(
      cases,
      ({ noAnswerEmptyNoPrimary }) => noAnswerEmptyNoPrimary,
    ),
    providerStatuses,
    latencyMs: {
      p50: percentile(retrievalLatencyValues, 0.5),
      p95: percentile(retrievalLatencyValues, 0.95),
      max:
        retrievalLatencyValues.length === 0
          ? 0
          : Math.max(...retrievalLatencyValues),
    },
    totalLatencyMs: {
      p50: percentile(totalLatencyValues, 0.5),
      p95: percentile(totalLatencyValues, 0.95),
      max:
        totalLatencyValues.length === 0
          ? 0
          : Math.max(...totalLatencyValues),
    },
  };
}

function buildGates(input: {
  arm: T42RecallArm;
  overall: T42RecallAggregate;
  leakagePassed: boolean;
  missingObjectRankingCount: number;
  errorTimeoutCount: number;
  scopeViolationCount: number;
}): T42GateResult[] {
  const recall = input.overall.objectRecallAt10;
  const recallAvailable =
    input.arm === "B_OBJECT_CONSENSUS" &&
    recall.available === recall.eligible;
  return [
    {
      gateId: "quality-dev-object-recall-at-10",
      group: "QUALITY",
      metric: "OBJECT_RECALL_AT_10",
      comparator: "AT_LEAST",
      observed:
        input.arm === "A0_EXACT_NODE" ? null : recall.passed,
      required: T42_RECALL_GATE_THRESHOLDS.objectRecallAt10.required,
      denominator: T42_RECALL_GATE_THRESHOLDS.objectRecallAt10.total,
      passed:
        recallAvailable &&
        recall.passed >=
          T42_RECALL_GATE_THRESHOLDS.objectRecallAt10.required,
      reason:
        input.arm === "A0_EXACT_NODE"
          ? T42_OBJECT_RECALL_UNAVAILABLE_REASON
          : recallAvailable
            ? null
            : T42_OBJECT_RECALL_MISSING_TRACE_REASON,
    },
    {
      gateId: "quality-dev-no-answer",
      group: "QUALITY",
      metric: "NO_ANSWER_EMPTY_NO_PRIMARY",
      comparator: "AT_LEAST",
      observed: input.overall.noAnswerEmptyNoPrimary.passed,
      required: T42_RECALL_GATE_THRESHOLDS.noAnswer.required,
      denominator: T42_RECALL_GATE_THRESHOLDS.noAnswer.total,
      passed:
        input.overall.noAnswerEmptyNoPrimary.eligible ===
          T42_RECALL_GATE_THRESHOLDS.noAnswer.total &&
        input.overall.noAnswerEmptyNoPrimary.passed >=
          T42_RECALL_GATE_THRESHOLDS.noAnswer.required,
      reason: null,
    },
    {
      gateId: "runtime-dev-object-ranking-trace",
      group: "RUNTIME_INTEGRITY",
      metric: "OBJECT_RANKING_TRACE",
      comparator: "EQUALS",
      observed: input.missingObjectRankingCount,
      required: 0,
      denominator:
        input.arm === "B_OBJECT_CONSENSUS"
          ? T42_RECALL_GATE_THRESHOLDS.objectRecallAt10.total
          : 0,
      passed:
        input.arm === "A0_EXACT_NODE" ||
        input.missingObjectRankingCount === 0,
      reason:
        input.arm === "A0_EXACT_NODE"
          ? T42_OBJECT_RECALL_UNAVAILABLE_REASON
          : null,
    },
    {
      gateId: "runtime-dev-leakage",
      group: "RUNTIME_INTEGRITY",
      metric: "LEAKAGE",
      comparator: "EQUALS",
      observed: input.leakagePassed,
      required: true,
      denominator: null,
      passed: input.leakagePassed,
      reason: null,
    },
    {
      gateId: "runtime-dev-error-timeout-zero",
      group: "RUNTIME_INTEGRITY",
      metric: "ERROR_TIMEOUT_COUNT",
      comparator: "EQUALS",
      observed: input.errorTimeoutCount,
      required: 0,
      denominator: input.overall.total,
      passed: input.errorTimeoutCount === 0,
      reason: null,
    },
    {
      gateId: "runtime-dev-scope-violation-zero",
      group: "RUNTIME_INTEGRITY",
      metric: "SCOPE_VIOLATION_COUNT",
      comparator: "EQUALS",
      observed: input.scopeViolationCount,
      required: 0,
      denominator: input.overall.total,
      passed: input.scopeViolationCount === 0,
      reason: null,
    },
    {
      gateId: "runtime-dev-retrieval-p95",
      group: "RUNTIME_INTEGRITY",
      metric: "RETRIEVAL_P95_MS",
      comparator: "AT_MOST",
      observed: input.overall.latencyMs.p95,
      required: T42_RECALL_GATE_THRESHOLDS.retrievalP95Ms,
      denominator: input.overall.total,
      passed:
        input.overall.latencyMs.p95 <=
        T42_RECALL_GATE_THRESHOLDS.retrievalP95Ms,
      reason: null,
    },
  ];
}

export async function evaluateT42Recall(
  options: EvaluateT42RecallOptions,
): Promise<T42RecallReport> {
  const arm = T42RecallArmSchema.parse(options.arm);
  const suite = T42RecallSuiteSchema.parse(options.loadedSuite.suite);
  const suiteSha256 = HashSchema.parse(
    options.loadedSuite.suiteSha256,
  );
  const byteLength = z
    .number()
    .int()
    .positive()
    .parse(options.loadedSuite.byteLength);

  if (suiteSha256 !== T42_RECALL_SUITE_SHA256) {
    throw new Error(
      "T4.2 evaluator received an unfrozen DEV suite digest",
    );
  }

  const expectedKeys = expectedQueryKeySet();
  const evaluatedCases: T42EvaluatedCase[] = [];
  const keySetCounts = new Map<
    string,
    { keys: string[]; caseCount: number }
  >();
  const leakageViolations: string[] = [];
  const runtimeViolations: string[] = [];
  const missingObjectRankingCaseIds: string[] = [];

  for (const testCase of suite.cases) {
    const runtimeQuery = buildRuntimeQuery(
      testCase,
      suite.corpusSnapshot.bundleHash,
    );
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
    for (const forbiddenField of T42_PROVIDER_FORBIDDEN_CASE_FIELDS) {
      if (containsObjectKey(runtimeQuery, forbiddenField)) {
        leakageViolations.push(
          `${testCase.id}: forbidden field ${forbiddenField} reached provider`,
        );
      }
    }

    const rawBundle = await options.provider.retrieve(runtimeQuery);
    const bundle = EvidenceBundleV2Schema.parse(rawBundle);

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
    if (stableJson(bundle.query) !== stableJson(runtimeQuery)) {
      throw new Error(
        `${testCase.id}: runtime returned evidence for a different query`,
      );
    }

    const expectedPack = runtimeQuery.scope.sourceCoursePack;
    const scopeViolation =
      bundle.provenance.corpusBundleHash !==
        suite.corpusSnapshot.bundleHash ||
      expectedPack === null ||
      expectedPack.id !== testCase.runtime.coursePackId ||
      expectedPack.version !== testCase.runtime.coursePackVersion ||
      bundle.evidence.nodes.some(
        ({ sourceCoursePack }) =>
          sourceCoursePack.id !== testCase.runtime.coursePackId ||
          sourceCoursePack.version !==
            testCase.runtime.coursePackVersion,
      );
    if (scopeViolation) {
      runtimeViolations.push(`${testCase.id}: course or corpus scope drift`);
    }

    const score = scoreT42RecallCase(testCase, bundle, arm);
    if (
      arm === "B_OBJECT_CONSENSUS" &&
      testCase.expected.expectation === "ANSWERABLE" &&
      score.objectRecallAt10 === null
    ) {
      missingObjectRankingCaseIds.push(testCase.id);
      runtimeViolations.push(
        `${testCase.id}: ${T42_OBJECT_RECALL_MISSING_TRACE_REASON}`,
      );
    }

    evaluatedCases.push({
      caseId: testCase.id,
      familyId: testCase.familyId,
      clusterId: testCase.clusterId,
      coursePackId: testCase.runtime.coursePackId,
      expectation: testCase.expected.expectation,
      arm,
      targetObjectIds: [...testCase.expected.targetObjectIds],
      providerStatus: bundle.status,
      retrievalLatencyMs: bundle.timing.retrievalMs,
      totalLatencyMs: bundle.timing.totalMs,
      bundleId: bundle.bundleId,
      runtimeQuerySha256,
      objectRankingSha256:
        arm === "B_OBJECT_CONSENSUS" &&
        bundle.evidence.objectConsensus
          ? sha256(bundle.evidence.objectConsensus.objectRanking)
          : null,
      scopeViolation,
      ...score,
    });
  }

  const overall = aggregate(evaluatedCases, arm);
  const byPack = Object.fromEntries(
    T42_COURSE_PACK_IDS.map((coursePackId) => [
      coursePackId,
      aggregate(
        evaluatedCases.filter(
          (testCase) => testCase.coursePackId === coursePackId,
        ),
        arm,
      ),
    ]),
  ) as Record<T42CoursePackId, T42RecallAggregate>;
  const leakagePassed = leakageViolations.length === 0;
  const errorTimeoutCount = evaluatedCases.filter(
    ({ providerStatus }) =>
      providerStatus === "ERROR" || providerStatus === "TIMEOUT",
  ).length;
  const scopeViolationCount = evaluatedCases.filter(
    ({ scopeViolation }) => scopeViolation,
  ).length;
  const gateResults = buildGates({
    arm,
    overall,
    leakagePassed,
    missingObjectRankingCount: missingObjectRankingCaseIds.length,
    errorTimeoutCount,
    scopeViolationCount,
  });
  const qualityPassed = gateResults
    .filter(({ group }) => group === "QUALITY")
    .every(({ passed }) => passed);
  const runtimeIntegrityPassed = gateResults
    .filter(({ group }) => group === "RUNTIME_INTEGRITY")
    .every(({ passed }) => passed);

  return deepFreeze({
    schemaVersion: 1,
    evaluatorVersion: T42_RECALL_EVALUATOR_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    arm,
    reportPassed: qualityPassed && runtimeIntegrityPassed,
    suite: {
      suiteId: suite.suiteId,
      suiteVersion: suite.suiteVersion,
      split: suite.split,
      splitRole: suite.splitRole,
      suiteSha256,
      byteLength,
      corpusBundleHash: suite.corpusSnapshot.bundleHash,
    },
    aggregates: {
      overall,
      byPack,
    },
    gates: {
      passed: qualityPassed && runtimeIntegrityPassed,
      qualityPassed,
      runtimeIntegrityPassed,
      results: gateResults,
    },
    cases: evaluatedCases,
    runtimeAudit: {
      objectRankingRequired: arm === "B_OBJECT_CONSENSUS",
      missingObjectRankingCaseIds,
      errorTimeoutCount,
      scopeViolationCount,
      violations: runtimeViolations,
    },
    leakageAudit: {
      passed: leakagePassed,
      providerCallArgumentCount: 1,
      allowedRuntimeQueryKeys: T42_RUNTIME_QUERY_KEYS,
      forbiddenCaseFields: T42_PROVIDER_FORBIDDEN_CASE_FIELDS,
      observedRuntimeQueryKeySets: [...keySetCounts.values()],
      expectedSentToProvider: false,
      familyIdSentToProvider: false,
      clusterIdSentToProvider: false,
      targetObjectIdsSentToProvider: false,
      requiredEvidenceGroupsSentToProvider: false,
      coursePackIdSentOnlyInQueryScope: true,
      questionsIncludedInReport: false,
      violations: leakageViolations,
    },
  });
}

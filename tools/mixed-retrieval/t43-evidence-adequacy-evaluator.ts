import { createHash, randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  EvidenceBundleV2Schema,
  type EvidenceBundleV2,
} from "../../lib/knowledge/evidence-bundle-v2";
import {
  QueryEvidenceAdequacyTraceV2Schema,
  type QueryEvidenceAdequacyIdentityV2,
  type QueryEvidenceAdequacyTraceV2,
} from "../../lib/knowledge/query-evidence-adequacy-v2";
import {
  createRetrievalQueryV2,
  type RetrievalQueryV2,
} from "../../lib/knowledge/retrieval-query-v2";
import {
  T43_COURSE_PACK_IDS,
  T43_EVIDENCE_ADEQUACY_SUITE_SHA256,
  T43_STRATA,
  T43EvidenceAdequacySuiteSchema,
  type LoadedT43EvidenceAdequacySuite,
  type T43CoursePackId,
  type T43EvidenceAdequacyCase,
  type T43ExecutionClass,
  type T43Expectation,
  type T43Stratum,
} from "./t43-evidence-adequacy-loader";

export const T43_EVIDENCE_ADEQUACY_EVALUATOR_VERSION =
  "2026-07-28.1";

export const T43EvidenceAdequacyArmSchema = z.enum([
  "A0_DISABLED",
  "C1_STRICT_ALL_OR_NOTHING",
]);
export type T43EvidenceAdequacyArm = z.infer<
  typeof T43EvidenceAdequacyArmSchema
>;

export const T43_DEV_GATES_V1 = Object.freeze({
  version: "T43_DEV_GATES_V1",
  objectRecallAt10: Object.freeze({ required: 48, total: 50 }),
  answerableComplete: Object.freeze({ required: 45, total: 50 }),
  noAnswerEmpty: Object.freeze({ required: 46, total: 50 }),
  packAnswerable: Object.freeze({ required: 9, total: 10 }),
  packNoAnswer: Object.freeze({ required: 9, total: 10 }),
  stratumPass: Object.freeze({ required: 9, total: 10 }),
  pairJointPass: Object.freeze({ required: 27, total: 30 }),
  integrityViolationCount: 0,
  expectedProviderCallsPerArm: 180,
  expectedQueriedFingerprintsPerArm: 90,
  expectedPreRetrievalSkipsPerArm: 10,
  retrievalP95Ms: 500,
  c1P95IncrementFloorMs: 25,
  c1P95IncrementRatio: 0.2,
  a0GreenAnswerableToC1Red: 0,
  minimumNoAnswerImprovement: 1,
} as const);

export const T43_RUNTIME_QUERY_KEYS = Object.freeze([
  "excludeAssetIds",
  "mode",
  "normalizedText",
  "originalText",
  "queryAsset",
  "schemaVersion",
  "scope",
] as const);

export const T43_PROVIDER_FORBIDDEN_SCORING_FIELDS =
  Object.freeze([
    "caseId",
    "clusterId",
    "executionClass",
    "expectation",
    "familyId",
    "pairDeltaKind",
    "pairId",
    "pairRole",
    "reasonClass",
    "requiredEvidenceGroups",
    "scoring",
    "stratum",
    "targetObjectIds",
  ] as const);

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const HashSchema = z.string().regex(HASH_PATTERN);

export type T43ExpectedProviderRoute = {
  runtimeQuerySha256: string;
  executionClass: T43ExecutionClass;
  expectedChannels: readonly ("LEXICAL" | "TEXT_VECTOR")[];
};

export type T43ProviderInvocationAudit = {
  passed: boolean;
  expectedCalls: number;
  observedCalls: number;
  expectedQueriedCount: number;
  observedQueriedCount: number;
  preRetrievalSkippedQueries: number;
  channelCounts: {
    lexical: number;
    textVector: number;
    visualVector: number;
    captionLexical: number;
    unknown: number;
  };
  duplicateCallCount: number;
  violations: string[];
};

export type T43ImportGraphAudit = {
  passed: boolean;
  auditedFiles: string[];
  forbiddenImportCount: number;
  violations: string[];
};

export type T43ArmRuntimeIdentity = {
  baseRuntimeIdentitySha256: string;
  queryEvidenceAdequacyEnabled: boolean;
  queryEvidenceAdequacyIdentity:
    | QueryEvidenceAdequacyIdentityV2
    | null;
};

export type T43RuntimeProvider = {
  start(): Promise<void>;
  retrieve(query: Readonly<RetrievalQueryV2>): Promise<unknown>;
  auditInvocations(
    expectedRoutes: readonly T43ExpectedProviderRoute[],
  ): T43ProviderInvocationAudit;
  runtimeIdentity(): T43ArmRuntimeIdentity;
  dispose(): Promise<void>;
};

export type T43EvidenceGroupScore = {
  requiredNodeIds: string[];
  matchedPrimaryNodeIds: string[];
  covered: boolean;
};

export type T43EvaluatedCase = {
  caseId: string;
  familyId: string;
  clusterId: string;
  pairId: string | null;
  pairRole: T43Expectation | null;
  pairDeltaKind: string | null;
  coursePackId: T43CoursePackId;
  stratum: T43Stratum;
  expectation: T43Expectation;
  executionClass: T43ExecutionClass;
  arm: T43EvidenceAdequacyArm;
  runtimeQuerySha256: string;
  providerStatus: EvidenceBundleV2["status"];
  expectedProviderCalls: 0 | 2;
  providerResultSha256: string;
  objectRankingSha256: string | null;
  finalEvidenceSha256: string;
  legacyBundleProjectionSha256: string;
  bundleId: string;
  measuredLatencyMs: number;
  bundleRetrievalMs: number;
  bundleExpansionMs: number;
  bundleAdequacyMs: number | null;
  bundleTotalMs: number;
  objectRecallAt10: boolean | null;
  objectIdsAt10: string[] | null;
  primaryObjectIds: string[];
  primaryNodeIds: string[];
  matchedTargetObjectIds: string[];
  requiredEvidenceGroups: T43EvidenceGroupScore[];
  answerableComplete: boolean | null;
  noAnswerEmpty: boolean | null;
  pass: boolean;
  outcome:
    | "ANSWERABLE_COMPLETE"
    | "ANSWERABLE_OBJECT_RECALL_MISS"
    | "ANSWERABLE_PRIMARY_OBJECT_MISS"
    | "ANSWERABLE_REQUIRED_EVIDENCE_MISS"
    | "ANSWERABLE_NON_SUCCESS_STATUS"
    | "NO_ANSWER_EMPTY"
    | "NO_ANSWER_EVIDENCE_RETAINED";
  adequacyDecision: QueryEvidenceAdequacyTraceV2["decision"] | null;
  adequacyReason: QueryEvidenceAdequacyTraceV2["reason"] | null;
  adequacyTraceSha256: string | null;
  preGateSeedsSha256: string | null;
  postGateSeedsSha256: string | null;
  gateEligibleBaseline: boolean;
  scopeViolation: boolean;
  ownerViolation: boolean;
  queryMutation: boolean;
  bundleQueryMismatch: boolean;
  errorOrTimeout: boolean;
};

export type T43MetricAggregate = {
  eligible: number;
  passed: number;
  failed: number;
  passRate: number | null;
};

export type T43ArmAggregate = {
  total: number;
  answerable: number;
  noAnswer: number;
  casePass: T43MetricAggregate;
  objectRecallAt10: T43MetricAggregate;
  answerableComplete: T43MetricAggregate;
  noAnswerEmpty: T43MetricAggregate;
  providerStatuses: Record<EvidenceBundleV2["status"], number>;
  measuredLatencyMs: {
    p50: number;
    p95: number;
    max: number;
  };
  adequacy: {
    applied: number;
    kept: number;
    emptied: number;
    notApplicable: number;
  };
};

export type T43ArmReport = {
  arm: T43EvidenceAdequacyArm;
  runtimeIdentity: T43ArmRuntimeIdentity;
  runtimeIdentitySha256: string;
  aggregates: {
    overall: T43ArmAggregate;
    byPack: Record<T43CoursePackId, T43ArmAggregate>;
    byStratum: Record<T43Stratum, T43ArmAggregate>;
  };
  cases: T43EvaluatedCase[];
  providerInvocationAudit: T43ProviderInvocationAudit;
  integrityAudit: {
    passed: boolean;
    leakageViolationCount: number;
    scoringCanaryLeakCount: number;
    mutationViolationCount: number;
    bundleQueryMismatchCount: number;
    scopeViolationCount: number;
    ownerViolationCount: number;
    errorTimeoutCount: number;
    missingObjectRankingCount: number;
    adequacyIdentityViolationCount: number;
    violations: string[];
  };
  leakageAudit: {
    providerCallArgumentCount: 1;
    allowedRuntimeQueryKeys: readonly string[];
    forbiddenScoringFields: readonly string[];
    questionIncludedInReport: false;
  };
};

export type T43GateResult = {
  gateId: string;
  group: "QUALITY" | "RUNTIME_INTEGRITY" | "A_B_IDENTITY";
  observed: number | boolean;
  required: number | boolean;
  denominator: number | null;
  comparator: "AT_LEAST" | "AT_MOST" | "EQUALS";
  passed: boolean;
};

export type T43EvidenceAdequacyReport = {
  schemaVersion: 1;
  evaluatorVersion: string;
  gateVersion: typeof T43_DEV_GATES_V1.version;
  generatedAt: string;
  reportPassed: boolean;
  promotionContribution: true;
  suite: {
    suiteId: "T43-EVIDENCE-ADEQUACY-DEV";
    suiteVersion: string;
    split: "DEV";
    splitRole: "MODEL_DEVELOPMENT";
    suiteSha256: string;
    byteLength: number;
    corpusBundleHash: string;
  };
  arms: Record<T43EvidenceAdequacyArm, T43ArmReport>;
  comparison: {
    providerResultsIdentical: boolean;
    objectRankingsIdentical: boolean;
    runtimeQueriesIdentical: boolean;
    nonApplicableLegacyBundlesIdentical: boolean;
    mismatchedProviderResultCaseIds: string[];
    mismatchedObjectRankingCaseIds: string[];
    mismatchedRuntimeQueryCaseIds: string[];
    mismatchedNonApplicableLegacyBundleCaseIds: string[];
    missingC1TraceForEligibleCaseIds: string[];
    unexpectedC1TraceForIneligibleCaseIds: string[];
    a0GreenAnswerableToC1RedCaseIds: string[];
    c1NoAnswerImprovement: number;
    pairJointPass: T43MetricAggregate;
    c1P95IncrementMs: number;
    c1P95AllowedIncrementMs: number;
    baseRuntimeIdentityEqual: boolean;
    armIdentitySemanticsValid: boolean;
    adequacyApplicabilityIdentityValid: boolean;
  };
  sensitivity: {
    policy:
      "EXCLUDE_DECLARED_SMALL_PACK_PRIOR_DOMAIN_CONTROLS";
    excludedCaseIds: string[];
    excludedCaseCount: 10;
    remainingCaseCount: 90;
    remainingAnswerableCount: 40;
    remainingNoAnswerCount: 50;
    independentBrandAnswerableCount: 0;
    arms: Record<T43EvidenceAdequacyArm, T43ArmAggregate>;
  };
  importGraphAudit: T43ImportGraphAudit;
  gates: {
    passed: boolean;
    qualityPassed: boolean;
    runtimeIntegrityPassed: boolean;
    abIdentityPassed: boolean;
    results: T43GateResult[];
  };
};

export type EvaluateT43EvidenceAdequacyOptions = {
  loadedSuite: LoadedT43EvidenceAdequacySuite;
  providers: Record<T43EvidenceAdequacyArm, T43RuntimeProvider>;
  generatedAt?: string;
  now?: () => number;
  importGraphAudit: T43ImportGraphAudit;
  onCaseScored?: (progress: {
    arm: T43EvidenceAdequacyArm;
    caseId: string;
    scoredCaseCountInArm: number;
  }) => void;
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
      .map(([key, item]) =>
        `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
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
  testCase: T43EvidenceAdequacyCase,
  corpusBundleHash: string,
) {
  return deepFreeze(createRetrievalQueryV2({
    mode: testCase.runtime.mode,
    text: testCase.runtime.question,
    scope: {
      corpusBundleHash,
      sourceCoursePack: {
        id: testCase.runtime.coursePackId,
        version: testCase.runtime.coursePackVersion,
      },
    },
  }));
}

function queryKeySet(query: RetrievalQueryV2) {
  return Object.keys(query).sort(compareCodePoints);
}

function channelResultProjection(bundle: EvidenceBundleV2) {
  return bundle.channels.map(({ timingMs: _timingMs, ...channel }) =>
    channel);
}

function adequacyTrace(
  bundle: EvidenceBundleV2,
): QueryEvidenceAdequacyTraceV2 | null {
  const raw = (
    bundle.evidence as unknown as Record<string, unknown>
  ).queryEvidenceAdequacy;
  return raw === undefined
    ? null
    : QueryEvidenceAdequacyTraceV2Schema.parse(raw);
}

function adequacyMs(bundle: EvidenceBundleV2) {
  const raw = (
    bundle.timing as unknown as Record<string, unknown>
  ).adequacyMs;
  return raw === undefined
    ? null
    : z.number().finite().nonnegative().parse(raw);
}

function finalEvidenceProjection(bundle: EvidenceBundleV2) {
  return {
    status: bundle.status,
    primary: bundle.evidence.primary,
    nodes: bundle.evidence.nodes,
    assets: bundle.evidence.assets,
    regions: bundle.evidence.regions,
    sources: bundle.sources,
  };
}

function legacyBundleProjection(bundle: EvidenceBundleV2) {
  const {
    queryEvidenceAdequacy: _adequacy,
    ...evidence
  } = bundle.evidence as EvidenceBundleV2["evidence"] & {
    queryEvidenceAdequacy?: unknown;
  };
  return {
    schemaVersion: bundle.schemaVersion,
    status: bundle.status,
    query: bundle.query,
    channels: channelResultProjection(bundle),
    evidence,
    sources: bundle.sources,
    provenance: bundle.provenance,
    limits: bundle.limits,
  };
}

function isAdequacyGateEligibleBaseline(bundle: EvidenceBundleV2) {
  const acceptedCandidateIds =
    bundle.evidence.boundary?.acceptedCandidateIdsAfter ?? [];
  const primaryNodes = bundle.evidence.nodes.filter(
    ({ relation }) => relation === "PRIMARY",
  );
  const primaryNodeKinds = new Set([
    "DOCUMENT",
    "SECTION",
    "TEXT",
    "TABLE",
  ]);
  return (
    bundle.query.mode === "TEXT_TO_TEXT"
    && bundle.query.scope.sourceCoursePack !== null
    && bundle.status === "SUCCESS"
    && bundle.provenance.externalVerification.required === false
    && bundle.provenance.fallbackTriggers.length === 0
    && bundle.channels.find(
      ({ channel }) => channel === "LEXICAL",
    )?.status === "SUCCESS"
    && bundle.channels.find(
      ({ channel }) => channel === "TEXT_VECTOR",
    )?.status === "SUCCESS"
    && acceptedCandidateIds.length >= 1
    && acceptedCandidateIds.length <= 5
    && bundle.evidence.primary.length >= 1
    && bundle.evidence.primary.length <= 5
    && primaryNodes.length === bundle.evidence.primary.length
    && primaryNodes.every(({ kind }) => primaryNodeKinds.has(kind))
  );
}

export function scoreT43EvidenceAdequacyCase(
  testCase: T43EvidenceAdequacyCase,
  bundle: EvidenceBundleV2,
) {
  const targetSet = new Set(testCase.scoring.targetObjectIds);
  const ranking =
    bundle.evidence.objectConsensus?.objectRanking
      ?.filter(({ rank }) => rank <= 10)
      .sort((left, right) => left.rank - right.rank)
      ?? null;
  const objectIdsAt10 = ranking?.map(({ objectId }) => objectId)
    ?? null;
  const objectRecallAt10 =
    testCase.scoring.expectation === "ANSWERABLE"
      ? objectIdsAt10?.some((objectId) => targetSet.has(objectId))
        ?? false
      : null;
  const primaryObjectIds = [
    ...new Set(bundle.evidence.primary.map(({ objectId }) => objectId)),
  ];
  const matchedTargetObjectIds = primaryObjectIds.filter(
    (objectId) => targetSet.has(objectId),
  );
  const primaryNodeIds = [
    ...new Set(bundle.evidence.nodes
      .filter(({ relation }) => relation === "PRIMARY")
      .map(({ nodeId }) => nodeId)),
  ];
  const primaryNodeSet = new Set(primaryNodeIds);
  const requiredEvidenceGroups =
    testCase.scoring.requiredEvidenceGroups.map(
      (requiredNodeIds): T43EvidenceGroupScore => {
        const matchedPrimaryNodeIds = requiredNodeIds.filter(
          (nodeId) => primaryNodeSet.has(nodeId),
        );
        return {
          requiredNodeIds: [...requiredNodeIds],
          matchedPrimaryNodeIds,
          covered: matchedPrimaryNodeIds.length > 0,
        };
      },
    );

  if (testCase.scoring.expectation === "NO_ANSWER") {
    const noAnswerEmpty =
      bundle.status === "EMPTY"
      && bundle.evidence.primary.length === 0
      && bundle.evidence.nodes.length === 0
      && bundle.evidence.assets.length === 0
      && bundle.evidence.regions.length === 0
      && bundle.sources.length === 0;
    return {
      objectRecallAt10,
      objectIdsAt10,
      primaryObjectIds,
      primaryNodeIds,
      matchedTargetObjectIds,
      requiredEvidenceGroups,
      answerableComplete: null,
      noAnswerEmpty,
      pass: noAnswerEmpty,
      outcome: noAnswerEmpty
        ? "NO_ANSWER_EMPTY" as const
        : "NO_ANSWER_EVIDENCE_RETAINED" as const,
    };
  }

  const primaryObjectHit = matchedTargetObjectIds.length > 0;
  const evidenceComplete = requiredEvidenceGroups.every(
    ({ covered }) => covered,
  );
  const answerableComplete =
    bundle.status === "SUCCESS"
    && primaryObjectHit
    && evidenceComplete;
  const outcome =
    bundle.status !== "SUCCESS"
      ? "ANSWERABLE_NON_SUCCESS_STATUS" as const
      : !objectRecallAt10
        ? "ANSWERABLE_OBJECT_RECALL_MISS" as const
        : !primaryObjectHit
          ? "ANSWERABLE_PRIMARY_OBJECT_MISS" as const
          : !evidenceComplete
            ? "ANSWERABLE_REQUIRED_EVIDENCE_MISS" as const
            : "ANSWERABLE_COMPLETE" as const;
  return {
    objectRecallAt10,
    objectIdsAt10,
    primaryObjectIds,
    primaryNodeIds,
    matchedTargetObjectIds,
    requiredEvidenceGroups,
    answerableComplete,
    noAnswerEmpty: null,
    pass: answerableComplete,
    outcome,
  };
}

function metricAggregate(
  cases: readonly T43EvaluatedCase[],
  selector: (
    testCase: T43EvaluatedCase,
  ) => boolean | null,
): T43MetricAggregate {
  const values = cases
    .map(selector)
    .filter((value): value is boolean => value !== null);
  const passed = values.filter(Boolean).length;
  return {
    eligible: values.length,
    passed,
    failed: values.length - passed,
    passRate:
      values.length === 0 ? null : round(passed / values.length),
  };
}

function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(
      sorted.length - 1,
      Math.ceil(fraction * sorted.length) - 1,
    ),
  );
  return round(sorted[index] ?? 0);
}

function aggregate(
  cases: readonly T43EvaluatedCase[],
): T43ArmAggregate {
  const providerStatuses = Object.fromEntries(
    EvidenceBundleV2Schema.shape.status.options.map(
      (status) => [status, 0],
    ),
  ) as Record<EvidenceBundleV2["status"], number>;
  for (const testCase of cases) {
    providerStatuses[testCase.providerStatus] += 1;
  }
  const latencies = cases.map(({ measuredLatencyMs }) =>
    measuredLatencyMs);
  return {
    total: cases.length,
    answerable: cases.filter(
      ({ expectation }) => expectation === "ANSWERABLE",
    ).length,
    noAnswer: cases.filter(
      ({ expectation }) => expectation === "NO_ANSWER",
    ).length,
    casePass: metricAggregate(cases, ({ pass }) => pass),
    objectRecallAt10: metricAggregate(
      cases,
      ({ objectRecallAt10 }) => objectRecallAt10,
    ),
    answerableComplete: metricAggregate(
      cases,
      ({ answerableComplete }) => answerableComplete,
    ),
    noAnswerEmpty: metricAggregate(
      cases,
      ({ noAnswerEmpty }) => noAnswerEmpty,
    ),
    providerStatuses,
    measuredLatencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length === 0 ? 0 : Math.max(...latencies),
    },
    adequacy: {
      applied: cases.filter(
        ({ adequacyDecision }) => adequacyDecision !== null,
      ).length,
      kept: cases.filter(
        ({ adequacyDecision }) => adequacyDecision === "KEEP",
      ).length,
      emptied: cases.filter(
        ({ adequacyDecision }) => adequacyDecision === "EMPTY",
      ).length,
      notApplicable: cases.filter(
        ({ adequacyDecision }) => adequacyDecision === null,
      ).length,
    },
  };
}

function runtimeIdentityViolations(
  arm: T43EvidenceAdequacyArm,
  identity: T43ArmRuntimeIdentity,
) {
  const violations: string[] = [];
  if (!HASH_PATTERN.test(identity.baseRuntimeIdentitySha256)) {
    violations.push(`${arm}: invalid base runtime identity hash`);
  }
  const enabled = arm === "C1_STRICT_ALL_OR_NOTHING";
  if (identity.queryEvidenceAdequacyEnabled !== enabled) {
    violations.push(`${arm}: enabled flag does not match arm`);
  }
  if (
    enabled
      ? identity.queryEvidenceAdequacyIdentity === null
      : identity.queryEvidenceAdequacyIdentity !== null
  ) {
    violations.push(`${arm}: adequacy identity presence mismatch`);
  }
  return violations;
}

async function evaluateArm(input: {
  arm: T43EvidenceAdequacyArm;
  loadedSuite: LoadedT43EvidenceAdequacySuite;
  provider: T43RuntimeProvider;
  now: () => number;
  onCaseScored?: EvaluateT43EvidenceAdequacyOptions["onCaseScored"];
}): Promise<T43ArmReport> {
  await input.provider.start();
  try {
    const identity = input.provider.runtimeIdentity();
    const suite = input.loadedSuite.suite;
    const expectedKeys = [...T43_RUNTIME_QUERY_KEYS]
      .sort(compareCodePoints);
    const evaluatedCases: T43EvaluatedCase[] = [];
    const expectedRoutes: T43ExpectedProviderRoute[] = [];
    const violations = runtimeIdentityViolations(
      input.arm,
      identity,
    );
    let leakageViolationCount = 0;
    let scoringCanaryLeakCount = 0;
    let mutationViolationCount = 0;
    let bundleQueryMismatchCount = 0;
    let scopeViolationCount = 0;
    let ownerViolationCount = 0;
    let errorTimeoutCount = 0;
    let missingObjectRankingCount = 0;
    let adequacyIdentityViolationCount = violations.length;

  for (const testCase of suite.cases) {
    const scoringCanary = randomBytes(24).toString("hex");
    const auditCase = deepFreeze(structuredClone({
      ...testCase,
      scoring: {
        ...testCase.scoring,
        evaluatorOnlyCanary: scoringCanary,
      },
    }));
    const query = buildRuntimeQuery(
      auditCase,
      suite.corpusSnapshot.bundleHash,
    );
    const queryHashBefore = sha256(query);
    const queryKeysBefore = queryKeySet(query);
    if (!isDeepStrictEqual(queryKeysBefore, expectedKeys)) {
      leakageViolationCount += 1;
      violations.push(
        `${testCase.scoring.caseId}: runtime query key drift`,
      );
    }
    for (
      const field of T43_PROVIDER_FORBIDDEN_SCORING_FIELDS
    ) {
      if (containsObjectKey(query, field)) {
        leakageViolationCount += 1;
        violations.push(
          `${testCase.scoring.caseId}: scoring field leaked:${field}`,
        );
      }
    }
    let scoringCanaryLeaked =
      stableJson(query).includes(scoringCanary);
    if (scoringCanaryLeaked) {
      scoringCanaryLeakCount += 1;
      violations.push(
        `${testCase.scoring.caseId}: scoring canary leaked to query`,
      );
    }
    const expectedChannels =
      testCase.scoring.executionClass === "HEALTHY_SCOPED_TTT"
        ? ["LEXICAL", "TEXT_VECTOR"] as const
        : [] as const;
    expectedRoutes.push({
      runtimeQuerySha256: queryHashBefore,
      executionClass: testCase.scoring.executionClass,
      expectedChannels,
    });

    const startedAt = input.now();
    const rawBundle = await input.provider.retrieve(query);
    const measuredLatencyMs = Math.max(0, input.now() - startedAt);
    const bundle = EvidenceBundleV2Schema.parse(rawBundle);
    if (
      stableJson(bundle).includes(scoringCanary)
      && !scoringCanaryLeaked
    ) {
      scoringCanaryLeaked = true;
      scoringCanaryLeakCount += 1;
      violations.push(
        `${testCase.scoring.caseId}: scoring canary leaked to bundle`,
      );
    }
    const queryMutation = sha256(query) !== queryHashBefore
      || !isDeepStrictEqual(queryKeySet(query), queryKeysBefore);
    if (queryMutation) {
      mutationViolationCount += 1;
      violations.push(
        `${testCase.scoring.caseId}: provider mutated query`,
      );
    }
    const bundleQueryMismatch = !isDeepStrictEqual(
      bundle.query,
      query,
    );
    if (bundleQueryMismatch) {
      bundleQueryMismatchCount += 1;
      violations.push(
        `${testCase.scoring.caseId}: bundle query mismatch`,
      );
    }

    const expectedPack = query.scope.sourceCoursePack;
    const scopeViolation =
      bundle.provenance.corpusBundleHash
        !== suite.corpusSnapshot.bundleHash
      || expectedPack === null
      || expectedPack.id !== testCase.runtime.coursePackId
      || expectedPack.version
        !== testCase.runtime.coursePackVersion
      || bundle.evidence.nodes.some(
        ({ sourceCoursePack }) =>
          sourceCoursePack.id
            !== testCase.runtime.coursePackId
          || sourceCoursePack.version
            !== testCase.runtime.coursePackVersion,
      );
    if (scopeViolation) {
      scopeViolationCount += 1;
      violations.push(
        `${testCase.scoring.caseId}: scope violation`,
      );
    }
    const primaryObjectBySeed = new Map(
      bundle.evidence.primary.map(
        ({ candidateId, objectId }) => [candidateId, objectId],
      ),
    );
    const ownerViolation = bundle.evidence.nodes.some((node) =>
      primaryObjectBySeed.get(node.seedCandidateId)
        !== node.objectId)
      || bundle.sources.some((source) =>
        !bundle.evidence.primary.some(
          ({ objectId }) => objectId === source.objectId,
        ));
    if (ownerViolation) {
      ownerViolationCount += 1;
      violations.push(
        `${testCase.scoring.caseId}: owner violation`,
      );
    }
    const errorOrTimeout =
      bundle.status === "ERROR" || bundle.status === "TIMEOUT";
    if (errorOrTimeout) errorTimeoutCount += 1;

    const trace = adequacyTrace(bundle);
    if (
      input.arm === "A0_DISABLED" && trace !== null
    ) {
      adequacyIdentityViolationCount += 1;
      violations.push(
        `${testCase.scoring.caseId}: A0 emitted adequacy trace`,
      );
    }
    if (
      trace !== null
      && !isDeepStrictEqual(
        trace.identity,
        identity.queryEvidenceAdequacyIdentity,
      )
    ) {
      adequacyIdentityViolationCount += 1;
      violations.push(
        `${testCase.scoring.caseId}: trace runtime identity mismatch`,
      );
    }

    const score = scoreT43EvidenceAdequacyCase(testCase, bundle);
    if (
      testCase.scoring.expectation === "ANSWERABLE"
      && bundle.evidence.objectConsensus?.objectRanking === undefined
    ) {
      missingObjectRankingCount += 1;
      violations.push(
        `${testCase.scoring.caseId}: object ranking missing`,
      );
    }
    evaluatedCases.push({
      caseId: testCase.scoring.caseId,
      familyId: testCase.scoring.familyId,
      clusterId: testCase.scoring.clusterId,
      pairId: testCase.scoring.pairId,
      pairRole: testCase.scoring.pairRole,
      pairDeltaKind: testCase.scoring.pairDeltaKind,
      coursePackId: testCase.runtime.coursePackId,
      stratum: testCase.scoring.stratum,
      expectation: testCase.scoring.expectation,
      executionClass: testCase.scoring.executionClass,
      arm: input.arm,
      runtimeQuerySha256: queryHashBefore,
      providerStatus: bundle.status,
      expectedProviderCalls: expectedChannels.length as 0 | 2,
      providerResultSha256: sha256(
        channelResultProjection(bundle),
      ),
      objectRankingSha256:
        bundle.evidence.objectConsensus?.objectRanking === undefined
          ? null
          : sha256(
              bundle.evidence.objectConsensus.objectRanking,
            ),
      finalEvidenceSha256: sha256(
        finalEvidenceProjection(bundle),
      ),
      legacyBundleProjectionSha256: sha256(
        legacyBundleProjection(bundle),
      ),
      bundleId: bundle.bundleId,
      measuredLatencyMs: round(measuredLatencyMs),
      bundleRetrievalMs: bundle.timing.retrievalMs,
      bundleExpansionMs: bundle.timing.expansionMs,
      bundleAdequacyMs: adequacyMs(bundle),
      bundleTotalMs: bundle.timing.totalMs,
      adequacyDecision: trace?.decision ?? null,
      adequacyReason: trace?.reason ?? null,
      adequacyTraceSha256: trace === null ? null : sha256(trace),
      preGateSeedsSha256: trace?.preGateSeedsHash ?? null,
      postGateSeedsSha256: trace?.postGateSeedsHash ?? null,
      gateEligibleBaseline: isAdequacyGateEligibleBaseline(bundle),
      scopeViolation,
      ownerViolation,
      queryMutation,
      bundleQueryMismatch,
      errorOrTimeout,
      ...score,
    });
    input.onCaseScored?.({
      arm: input.arm,
      caseId: testCase.scoring.caseId,
      scoredCaseCountInArm: evaluatedCases.length,
    });
  }

  const providerInvocationAudit =
    input.provider.auditInvocations(expectedRoutes);
  if (!providerInvocationAudit.passed) {
    violations.push(...providerInvocationAudit.violations.map(
      (violation) => `provider audit:${violation}`,
    ));
  }
  const overall = aggregate(evaluatedCases);
  const byPack = Object.fromEntries(
    T43_COURSE_PACK_IDS.map((coursePackId) => [
      coursePackId,
      aggregate(evaluatedCases.filter(
        (testCase) =>
          testCase.coursePackId === coursePackId,
      )),
    ]),
  ) as Record<T43CoursePackId, T43ArmAggregate>;
  const byStratum = Object.fromEntries(
    T43_STRATA.map((stratum) => [
      stratum,
      aggregate(evaluatedCases.filter(
        (testCase) => testCase.stratum === stratum,
      )),
    ]),
  ) as Record<T43Stratum, T43ArmAggregate>;

    return deepFreeze({
      arm: input.arm,
      runtimeIdentity: structuredClone(identity),
      runtimeIdentitySha256: sha256(identity),
      aggregates: {
        overall,
        byPack,
        byStratum,
      },
      cases: evaluatedCases,
      providerInvocationAudit,
      integrityAudit: {
        passed:
          violations.length === 0
          && providerInvocationAudit.passed,
        leakageViolationCount,
        scoringCanaryLeakCount,
        mutationViolationCount,
        bundleQueryMismatchCount,
        scopeViolationCount,
        ownerViolationCount,
        errorTimeoutCount,
        missingObjectRankingCount,
        adequacyIdentityViolationCount,
        violations,
      },
      leakageAudit: {
        providerCallArgumentCount: 1,
        allowedRuntimeQueryKeys: T43_RUNTIME_QUERY_KEYS,
        forbiddenScoringFields:
          T43_PROVIDER_FORBIDDEN_SCORING_FIELDS,
        questionIncludedInReport: false,
      },
    });
  } finally {
    await input.provider.dispose();
  }
}

function metricGate(input: {
  gateId: string;
  group: T43GateResult["group"];
  observed: number;
  required: number;
  denominator: number | null;
  comparator: "AT_LEAST" | "AT_MOST" | "EQUALS";
}): T43GateResult {
  return {
    ...input,
    passed:
      input.comparator === "AT_LEAST"
        ? input.observed >= input.required
        : input.comparator === "AT_MOST"
          ? input.observed <= input.required
          : input.observed === input.required,
  };
}

function booleanGate(input: {
  gateId: string;
  group: T43GateResult["group"];
  observed: boolean;
  required: boolean;
}): T43GateResult {
  return {
    ...input,
    comparator: "EQUALS",
    denominator: null,
    passed: input.observed === input.required,
  };
}

function comparisonFor(
  a0: T43ArmReport,
  c1: T43ArmReport,
) {
  const a0ByCase = new Map(
    a0.cases.map((testCase) => [testCase.caseId, testCase]),
  );
  const mismatchedProviderResultCaseIds: string[] = [];
  const mismatchedObjectRankingCaseIds: string[] = [];
  const mismatchedRuntimeQueryCaseIds: string[] = [];
  const mismatchedNonApplicableLegacyBundleCaseIds: string[] = [];
  const missingC1TraceForEligibleCaseIds: string[] = [];
  const unexpectedC1TraceForIneligibleCaseIds: string[] = [];
  const a0GreenAnswerableToC1RedCaseIds: string[] = [];
  for (const c1Case of c1.cases) {
    const a0Case = a0ByCase.get(c1Case.caseId);
    if (!a0Case) {
      mismatchedRuntimeQueryCaseIds.push(c1Case.caseId);
      continue;
    }
    if (
      a0Case.providerResultSha256
        !== c1Case.providerResultSha256
    ) {
      mismatchedProviderResultCaseIds.push(c1Case.caseId);
    }
    if (
      a0Case.objectRankingSha256
        !== c1Case.objectRankingSha256
    ) {
      mismatchedObjectRankingCaseIds.push(c1Case.caseId);
    }
    if (
      a0Case.runtimeQuerySha256
        !== c1Case.runtimeQuerySha256
    ) {
      mismatchedRuntimeQueryCaseIds.push(c1Case.caseId);
    }
    if (
      !a0Case.gateEligibleBaseline
      && a0Case.legacyBundleProjectionSha256
        !== c1Case.legacyBundleProjectionSha256
    ) {
      mismatchedNonApplicableLegacyBundleCaseIds.push(
        c1Case.caseId,
      );
    }
    if (
      a0Case.gateEligibleBaseline
      && c1Case.adequacyDecision === null
    ) {
      missingC1TraceForEligibleCaseIds.push(c1Case.caseId);
    }
    if (
      !a0Case.gateEligibleBaseline
      && c1Case.adequacyDecision !== null
    ) {
      unexpectedC1TraceForIneligibleCaseIds.push(c1Case.caseId);
    }
    if (
      c1Case.expectation === "ANSWERABLE"
      && a0Case.answerableComplete === true
      && c1Case.answerableComplete !== true
    ) {
      a0GreenAnswerableToC1RedCaseIds.push(c1Case.caseId);
    }
  }

  const pairGroups = new Map<string, T43EvaluatedCase[]>();
  for (const testCase of c1.cases) {
    if (testCase.pairId === null) continue;
    const cases = pairGroups.get(testCase.pairId) ?? [];
    cases.push(testCase);
    pairGroups.set(testCase.pairId, cases);
  }
  const pairValues = [...pairGroups.values()].map(
    (pairCases) =>
      pairCases.length === 2
      && pairCases.every(({ pass }) => pass),
  );
  const pairPassed = pairValues.filter(Boolean).length;
  const a0P95 = a0.aggregates.overall.measuredLatencyMs.p95;
  const c1P95 = c1.aggregates.overall.measuredLatencyMs.p95;
  const c1P95IncrementMs = round(c1P95 - a0P95);
  const c1P95AllowedIncrementMs = round(Math.max(
    T43_DEV_GATES_V1.c1P95IncrementFloorMs,
    a0P95 * T43_DEV_GATES_V1.c1P95IncrementRatio,
  ));
  const a0NoAnswer =
    a0.aggregates.overall.noAnswerEmpty.passed;
  const c1NoAnswer =
    c1.aggregates.overall.noAnswerEmpty.passed;
  const baseRuntimeIdentityEqual =
    a0.runtimeIdentity.baseRuntimeIdentitySha256
      === c1.runtimeIdentity.baseRuntimeIdentitySha256;
  const armIdentitySemanticsValid =
    !a0.runtimeIdentity.queryEvidenceAdequacyEnabled
    && a0.runtimeIdentity.queryEvidenceAdequacyIdentity === null
    && c1.runtimeIdentity.queryEvidenceAdequacyEnabled
    && c1.runtimeIdentity.queryEvidenceAdequacyIdentity !== null;
  const adequacyApplicabilityIdentityValid =
    missingC1TraceForEligibleCaseIds.length === 0
    && unexpectedC1TraceForIneligibleCaseIds.length === 0;

  return {
    providerResultsIdentical:
      mismatchedProviderResultCaseIds.length === 0,
    objectRankingsIdentical:
      mismatchedObjectRankingCaseIds.length === 0,
    runtimeQueriesIdentical:
      mismatchedRuntimeQueryCaseIds.length === 0,
    nonApplicableLegacyBundlesIdentical:
      mismatchedNonApplicableLegacyBundleCaseIds.length === 0,
    mismatchedProviderResultCaseIds,
    mismatchedObjectRankingCaseIds,
    mismatchedRuntimeQueryCaseIds,
    mismatchedNonApplicableLegacyBundleCaseIds,
    missingC1TraceForEligibleCaseIds,
    unexpectedC1TraceForIneligibleCaseIds,
    a0GreenAnswerableToC1RedCaseIds,
    c1NoAnswerImprovement: c1NoAnswer - a0NoAnswer,
    pairJointPass: {
      eligible: pairValues.length,
      passed: pairPassed,
      failed: pairValues.length - pairPassed,
      passRate:
        pairValues.length === 0
          ? null
          : round(pairPassed / pairValues.length),
    },
    c1P95IncrementMs,
    c1P95AllowedIncrementMs,
    baseRuntimeIdentityEqual,
    armIdentitySemanticsValid,
    adequacyApplicabilityIdentityValid,
  };
}

function buildGates(
  c1: T43ArmReport,
  a0: T43ArmReport,
  comparison: ReturnType<typeof comparisonFor>,
  importGraphPassed: boolean,
) {
  const results: T43GateResult[] = [
    metricGate({
      gateId: "quality-object-recall-at-10",
      group: "QUALITY",
      observed: c1.aggregates.overall.objectRecallAt10.passed,
      required: T43_DEV_GATES_V1.objectRecallAt10.required,
      denominator: T43_DEV_GATES_V1.objectRecallAt10.total,
      comparator: "AT_LEAST",
    }),
    metricGate({
      gateId: "quality-answerable-complete",
      group: "QUALITY",
      observed: c1.aggregates.overall.answerableComplete.passed,
      required: T43_DEV_GATES_V1.answerableComplete.required,
      denominator: T43_DEV_GATES_V1.answerableComplete.total,
      comparator: "AT_LEAST",
    }),
    metricGate({
      gateId: "quality-no-answer-empty",
      group: "QUALITY",
      observed: c1.aggregates.overall.noAnswerEmpty.passed,
      required: T43_DEV_GATES_V1.noAnswerEmpty.required,
      denominator: T43_DEV_GATES_V1.noAnswerEmpty.total,
      comparator: "AT_LEAST",
    }),
  ];
  for (const coursePackId of T43_COURSE_PACK_IDS) {
    results.push(
      metricGate({
        gateId: `quality-pack-${coursePackId}-answerable`,
        group: "QUALITY",
        observed:
          c1.aggregates.byPack[coursePackId]
            .answerableComplete.passed,
        required: T43_DEV_GATES_V1.packAnswerable.required,
        denominator: T43_DEV_GATES_V1.packAnswerable.total,
        comparator: "AT_LEAST",
      }),
      metricGate({
        gateId: `quality-pack-${coursePackId}-no-answer`,
        group: "QUALITY",
        observed:
          c1.aggregates.byPack[coursePackId]
            .noAnswerEmpty.passed,
        required: T43_DEV_GATES_V1.packNoAnswer.required,
        denominator: T43_DEV_GATES_V1.packNoAnswer.total,
        comparator: "AT_LEAST",
      }),
    );
  }
  for (const stratum of T43_STRATA) {
    results.push(metricGate({
      gateId: `quality-stratum-${stratum.toLowerCase()}`,
      group: "QUALITY",
      observed:
        c1.aggregates.byStratum[stratum].casePass.passed,
      required: T43_DEV_GATES_V1.stratumPass.required,
      denominator: T43_DEV_GATES_V1.stratumPass.total,
      comparator: "AT_LEAST",
    }));
  }
  const totalIntegrityViolations = [
    a0,
    c1,
  ].reduce((total, arm) =>
    total
    + arm.integrityAudit.leakageViolationCount
    + arm.integrityAudit.scoringCanaryLeakCount
    + arm.integrityAudit.mutationViolationCount
    + arm.integrityAudit.bundleQueryMismatchCount
    + arm.integrityAudit.scopeViolationCount
    + arm.integrityAudit.ownerViolationCount
    + arm.integrityAudit.errorTimeoutCount
    + arm.integrityAudit.missingObjectRankingCount
    + arm.integrityAudit.adequacyIdentityViolationCount, 0);
  results.push(
    metricGate({
      gateId: "quality-pair-joint-pass",
      group: "QUALITY",
      observed: comparison.pairJointPass.passed,
      required: T43_DEV_GATES_V1.pairJointPass.required,
      denominator: T43_DEV_GATES_V1.pairJointPass.total,
      comparator: "AT_LEAST",
    }),
    metricGate({
      gateId: "runtime-integrity-violation-zero",
      group: "RUNTIME_INTEGRITY",
      observed: totalIntegrityViolations,
      required: T43_DEV_GATES_V1.integrityViolationCount,
      denominator: 200,
      comparator: "EQUALS",
    }),
    booleanGate({
      gateId: "runtime-provider-invocation-a0",
      group: "RUNTIME_INTEGRITY",
      observed: a0.providerInvocationAudit.passed,
      required: true,
    }),
    booleanGate({
      gateId: "runtime-provider-invocation-c1",
      group: "RUNTIME_INTEGRITY",
      observed: c1.providerInvocationAudit.passed,
      required: true,
    }),
    booleanGate({
      gateId: "runtime-import-graph-isolated",
      group: "RUNTIME_INTEGRITY",
      observed: importGraphPassed,
      required: true,
    }),
    metricGate({
      gateId: "runtime-retrieval-p95-a0",
      group: "RUNTIME_INTEGRITY",
      observed: a0.aggregates.overall.measuredLatencyMs.p95,
      required: T43_DEV_GATES_V1.retrievalP95Ms,
      denominator: 100,
      comparator: "AT_MOST",
    }),
    metricGate({
      gateId: "runtime-retrieval-p95-c1",
      group: "RUNTIME_INTEGRITY",
      observed: c1.aggregates.overall.measuredLatencyMs.p95,
      required: T43_DEV_GATES_V1.retrievalP95Ms,
      denominator: 100,
      comparator: "AT_MOST",
    }),
    metricGate({
      gateId: "runtime-c1-p95-increment",
      group: "RUNTIME_INTEGRITY",
      observed: comparison.c1P95IncrementMs,
      required: comparison.c1P95AllowedIncrementMs,
      denominator: 100,
      comparator: "AT_MOST",
    }),
    booleanGate({
      gateId: "ab-provider-results-identical",
      group: "A_B_IDENTITY",
      observed: comparison.providerResultsIdentical,
      required: true,
    }),
    booleanGate({
      gateId: "ab-object-rankings-identical",
      group: "A_B_IDENTITY",
      observed: comparison.objectRankingsIdentical,
      required: true,
    }),
    booleanGate({
      gateId: "ab-runtime-queries-identical",
      group: "A_B_IDENTITY",
      observed: comparison.runtimeQueriesIdentical,
      required: true,
    }),
    booleanGate({
      gateId: "ab-nonapplicable-legacy-identical",
      group: "A_B_IDENTITY",
      observed: comparison.nonApplicableLegacyBundlesIdentical,
      required: true,
    }),
    metricGate({
      gateId: "ab-a0-green-answerable-to-c1-red-zero",
      group: "A_B_IDENTITY",
      observed:
        comparison.a0GreenAnswerableToC1RedCaseIds.length,
      required: T43_DEV_GATES_V1.a0GreenAnswerableToC1Red,
      denominator: 50,
      comparator: "EQUALS",
    }),
    metricGate({
      gateId: "ab-no-answer-improvement",
      group: "A_B_IDENTITY",
      observed: comparison.c1NoAnswerImprovement,
      required: T43_DEV_GATES_V1.minimumNoAnswerImprovement,
      denominator: 50,
      comparator: "AT_LEAST",
    }),
    booleanGate({
      gateId: "ab-base-runtime-identity-equal",
      group: "A_B_IDENTITY",
      observed: comparison.baseRuntimeIdentityEqual,
      required: true,
    }),
    booleanGate({
      gateId: "ab-arm-identity-semantics",
      group: "A_B_IDENTITY",
      observed: comparison.armIdentitySemanticsValid,
      required: true,
    }),
    booleanGate({
      gateId: "ab-adequacy-applicability-identity",
      group: "A_B_IDENTITY",
      observed: comparison.adequacyApplicabilityIdentityValid,
      required: true,
    }),
  );
  return results;
}

export async function evaluateT43EvidenceAdequacy(
  options: EvaluateT43EvidenceAdequacyOptions,
): Promise<T43EvidenceAdequacyReport> {
  const suite = T43EvidenceAdequacySuiteSchema.parse(
    options.loadedSuite.suite,
  );
  const suiteSha256 = HashSchema.parse(
    options.loadedSuite.suiteSha256,
  );
  const byteLength = z.number().int().positive().parse(
    options.loadedSuite.byteLength,
  );
  if (suiteSha256 !== T43_EVIDENCE_ADEQUACY_SUITE_SHA256) {
    throw new Error(
      "T4.3 evaluator received an unfrozen DEV suite digest",
    );
  }
  const now = options.now ?? performance.now.bind(performance);
  const a0 = await evaluateArm({
    arm: "A0_DISABLED",
    loadedSuite: options.loadedSuite,
    provider: options.providers.A0_DISABLED,
    now,
    onCaseScored: options.onCaseScored,
  });
  const c1 = await evaluateArm({
    arm: "C1_STRICT_ALL_OR_NOTHING",
    loadedSuite: options.loadedSuite,
    provider: options.providers.C1_STRICT_ALL_OR_NOTHING,
    now,
    onCaseScored: options.onCaseScored,
  });
  const comparison = comparisonFor(a0, c1);
  const excludedCaseIds =
    suite.priorIntentOverlapManifest.map(({ caseId }) => caseId);
  const excluded = new Set(excludedCaseIds);
  const sensitivityCases = (
    arm: T43ArmReport,
  ) => arm.cases.filter(({ caseId }) => !excluded.has(caseId));
  const a0SensitivityCases = sensitivityCases(a0);
  const c1SensitivityCases = sensitivityCases(c1);
  const gateResults = buildGates(
    c1,
    a0,
    comparison,
    options.importGraphAudit.passed,
  );
  const qualityPassed = gateResults
    .filter(({ group }) => group === "QUALITY")
    .every(({ passed }) => passed);
  const runtimeIntegrityPassed = gateResults
    .filter(({ group }) => group === "RUNTIME_INTEGRITY")
    .every(({ passed }) => passed);
  const abIdentityPassed = gateResults
    .filter(({ group }) => group === "A_B_IDENTITY")
    .every(({ passed }) => passed);
  const reportPassed =
    qualityPassed && runtimeIntegrityPassed && abIdentityPassed;

  return deepFreeze({
    schemaVersion: 1,
    evaluatorVersion: T43_EVIDENCE_ADEQUACY_EVALUATOR_VERSION,
    gateVersion: T43_DEV_GATES_V1.version,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    reportPassed,
    promotionContribution: true,
    suite: {
      suiteId: suite.suiteId,
      suiteVersion: suite.suiteVersion,
      split: suite.split,
      splitRole: suite.splitRole,
      suiteSha256,
      byteLength,
      corpusBundleHash: suite.corpusSnapshot.bundleHash,
    },
    arms: {
      A0_DISABLED: a0,
      C1_STRICT_ALL_OR_NOTHING: c1,
    },
    comparison,
    sensitivity: {
      policy:
        "EXCLUDE_DECLARED_SMALL_PACK_PRIOR_DOMAIN_CONTROLS",
      excludedCaseIds,
      excludedCaseCount: 10,
      remainingCaseCount: 90,
      remainingAnswerableCount: 40,
      remainingNoAnswerCount: 50,
      independentBrandAnswerableCount: 0,
      arms: {
        A0_DISABLED: aggregate(a0SensitivityCases),
        C1_STRICT_ALL_OR_NOTHING:
          aggregate(c1SensitivityCases),
      },
    },
    importGraphAudit: structuredClone(options.importGraphAudit),
    gates: {
      passed: reportPassed,
      qualityPassed,
      runtimeIntegrityPassed,
      abIdentityPassed,
      results: gateResults,
    },
  });
}

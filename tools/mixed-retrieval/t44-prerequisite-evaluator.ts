import { z } from "zod";

import {
  CapabilityEntityManifestV2Schema,
  type CapabilityEntityManifestV2,
} from "../../lib/knowledge/capability-boundary-v2";
import { sha256StableJsonV2 } from "../../lib/knowledge/knowledge-object-v2";
import {
  evaluateQueryPrerequisiteV3,
  QUERY_PREREQUISITE_CONFIG_HASH_V3,
  QUERY_PREREQUISITE_FEATURE_ALGORITHM_HASH_V3,
  QUERY_PREREQUISITE_POLICY_HASH_V3,
  QueryPrerequisiteDecisionV3Schema,
  QueryPrerequisiteTraceV3Schema,
  runQueryPrerequisiteShadowV3,
} from "../../lib/knowledge/query-prerequisite-router-v3";
import { createRetrievalQueryV2 } from "../../lib/knowledge/retrieval-query-v2";
import {
  T44PrerequisiteCoursePackIdSchema,
  T44PrerequisiteExpectationSchema,
  T44PrerequisiteStratumSchema,
  T44PrerequisiteSuiteSchema,
  T44_PREREQUISITE_COURSE_PACK_IDS,
  T44_PREREQUISITE_STRATA,
  type T44PrerequisiteSuite,
} from "./t44-prerequisite-loader";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const IdSchema = z.string().regex(ID_PATTERN);

export const T44_PREREQUISITE_EVALUATOR_VERSION =
  "2026-07-28.1";

export const T44_PREREQUISITE_DEV_GATES_V1 = Object.freeze({
  decisionExactMinimum: 95,
  failClosedExactMinimum: 100,
  staticFailClosedFalsePositiveMaximum: 0,
  perCoursePackDecisionExactMinimum: 18,
  perStratumDecisionExactMinimum: 9,
  traceReplayExactMinimum: 100,
  expectedDownstreamRetrievalCalls: 100,
  expectedInstrumentedProviderCalls: 200,
  shadowProviderCallDeltaMaximum: 0,
} as const);

const CountPairSchema = z
  .object({
    passed: z.number().int().nonnegative().max(100),
    total: z.number().int().nonnegative().max(100),
  })
  .strict();

const RouteAggregateSchema = z
  .object({
    total: z.number().int().positive().max(100),
    decisionExact: z.number().int().nonnegative().max(100),
    failClosedExact: z.number().int().nonnegative().max(100),
    staticFailClosedFalsePositives:
      z.number().int().nonnegative().max(100),
  })
  .strict();

const T44PrerequisiteGatesV1Schema = z
  .object({
    decisionExactMinimum: z.literal(95),
    failClosedExactMinimum: z.literal(100),
    staticFailClosedFalsePositiveMaximum: z.literal(0),
    perCoursePackDecisionExactMinimum: z.literal(18),
    perStratumDecisionExactMinimum: z.literal(9),
    traceReplayExactMinimum: z.literal(100),
    expectedDownstreamRetrievalCalls: z.literal(100),
    expectedInstrumentedProviderCalls: z.literal(200),
    shadowProviderCallDeltaMaximum: z.literal(0),
  })
  .strict();

const ConfusionRowSchema = z.record(
  QueryPrerequisiteDecisionV3Schema,
  z.number().int().nonnegative().max(100),
);

export const T44PrerequisiteEvaluationRowSchema = z
  .object({
    caseId: IdSchema,
    coursePackId: T44PrerequisiteCoursePackIdSchema,
    stratum: T44PrerequisiteStratumSchema,
    expectation: T44PrerequisiteExpectationSchema,
    expectedDecision: QueryPrerequisiteDecisionV3Schema,
    actualDecision: QueryPrerequisiteDecisionV3Schema,
    expectedFailClosedEligible: z.boolean(),
    actualFailClosedEligible: z.boolean(),
    decisionExact: z.boolean(),
    failClosedExact: z.boolean(),
    traceReplayExact: z.boolean(),
    queryHash: HashSchema,
  })
  .strict();

const T44PrerequisiteReportInputSchema = z
  .object({
    schemaVersion: z.literal(3),
    evaluatorVersion: z.literal(
      T44_PREREQUISITE_EVALUATOR_VERSION,
    ),
    candidateId: IdSchema,
    suiteHash: HashSchema,
    corpusBundleHash: HashSchema,
    capabilityEntityManifestHash: HashSchema,
    featureAlgorithmHash: z.literal(
      QUERY_PREREQUISITE_FEATURE_ALGORITHM_HASH_V3,
    ),
    policyHash: z.literal(QUERY_PREREQUISITE_POLICY_HASH_V3),
    configHash: z.literal(QUERY_PREREQUISITE_CONFIG_HASH_V3),
    gates: T44PrerequisiteGatesV1Schema,
    rows: z.array(T44PrerequisiteEvaluationRowSchema).length(100),
    confusionMatrix: z.record(
      QueryPrerequisiteDecisionV3Schema,
      ConfusionRowSchema,
    ),
    aggregate: RouteAggregateSchema,
    byCoursePack: z.record(
      T44PrerequisiteCoursePackIdSchema,
      RouteAggregateSchema,
    ),
    byStratum: z.record(
      T44PrerequisiteStratumSchema,
      RouteAggregateSchema,
    ),
    traceReplay: CountPairSchema,
    providerInvocationAudit: z
      .object({
        mode: z.literal("INSTRUMENTED_SHADOW"),
        expectedDownstreamRetrievalCalls: z.literal(100),
        observedDownstreamRetrievalCalls:
          z.number().int().nonnegative().max(100),
        expectedInstrumentedProviderCalls: z.literal(200),
        observedInstrumentedProviderCalls:
          z.number().int().nonnegative().max(200),
        shadowProviderCallDelta:
          z.number().int().min(-200).max(200),
      })
      .strict(),
    gateResults: z
      .object({
        decisionExact: z.boolean(),
        failClosedExact: z.boolean(),
        staticFalseReject: z.boolean(),
        perCoursePack: z.boolean(),
        perStratum: z.boolean(),
        traceReplay: z.boolean(),
        providerParity: z.boolean(),
      })
      .strict(),
    decision: z.enum(["GO", "NO_GO"]),
  })
  .strict();

export const T44PrerequisiteReportSchema =
  T44PrerequisiteReportInputSchema.extend({
    reportHash: HashSchema,
  }).strict();

export type T44PrerequisiteReport = z.infer<
  typeof T44PrerequisiteReportSchema
>;

function emptyConfusionRow() {
  return Object.fromEntries(
    QueryPrerequisiteDecisionV3Schema.options.map((decision) =>
      [decision, 0]),
  ) as Record<
    z.infer<typeof QueryPrerequisiteDecisionV3Schema>,
    number
  >;
}

function aggregateRows(
  rows: readonly z.infer<
    typeof T44PrerequisiteEvaluationRowSchema
  >[],
) {
  return RouteAggregateSchema.parse({
    total: rows.length,
    decisionExact:
      rows.filter(({ decisionExact }) => decisionExact).length,
    failClosedExact:
      rows.filter(({ failClosedExact }) => failClosedExact).length,
    staticFailClosedFalsePositives:
      rows.filter((row) =>
        row.expectedDecision === "STATIC_CORPUS_ELIGIBLE"
        && row.actualFailClosedEligible).length,
  });
}

function reportHash(
  report: z.infer<typeof T44PrerequisiteReportInputSchema>,
) {
  return sha256StableJsonV2(report);
}

export async function evaluateT44PrerequisiteDev(input: {
  candidateId: string;
  suite: T44PrerequisiteSuite;
  capabilityEntityManifest: CapabilityEntityManifestV2;
}): Promise<T44PrerequisiteReport> {
  const candidateId = IdSchema.parse(input.candidateId);
  const suite = T44PrerequisiteSuiteSchema.parse(input.suite);
  const manifest = CapabilityEntityManifestV2Schema.parse(
    input.capabilityEntityManifest,
  );
  let observedDownstreamRetrievalCalls = 0;
  let observedInstrumentedProviderCalls = 0;
  const rows: z.infer<
    typeof T44PrerequisiteEvaluationRowSchema
  >[] = [];

  for (const testCase of suite.cases) {
    const query = createRetrievalQueryV2({
      mode: testCase.runtime.mode,
      text: testCase.runtime.question,
      scope: {
        corpusBundleHash: manifest.corpusBundleHash,
        sourceCoursePack: {
          id: testCase.runtime.coursePackId,
          version: testCase.runtime.coursePackVersion,
        },
      },
    });
    const shadow = await runQueryPrerequisiteShadowV3({
      query,
      capabilityEntityManifest: manifest,
      retrieve: async () => {
        observedDownstreamRetrievalCalls += 1;
        observedInstrumentedProviderCalls += 2;
        return "UNCHANGED";
      },
    });
    const replay = evaluateQueryPrerequisiteV3({
      query,
      capabilityEntityManifest: manifest,
    });
    const trace = QueryPrerequisiteTraceV3Schema.parse(
      shadow.trace,
    );
    const traceReplayExact =
      sha256StableJsonV2(trace) === sha256StableJsonV2(replay);
    rows.push(T44PrerequisiteEvaluationRowSchema.parse({
      caseId: testCase.scoring.caseId,
      coursePackId: testCase.runtime.coursePackId,
      stratum: testCase.scoring.stratum,
      expectation: testCase.scoring.expectation,
      expectedDecision: testCase.scoring.expectedDecision,
      actualDecision: trace.decision,
      expectedFailClosedEligible:
        testCase.scoring.expectedFailClosedEligible,
      actualFailClosedEligible: trace.failClosedEligible,
      decisionExact:
        trace.decision === testCase.scoring.expectedDecision,
      failClosedExact:
        trace.failClosedEligible ===
          testCase.scoring.expectedFailClosedEligible,
      traceReplayExact,
      queryHash: trace.queryHash,
    }));
  }

  const confusionMatrix = Object.fromEntries(
    QueryPrerequisiteDecisionV3Schema.options.map((expected) => {
      const row = emptyConfusionRow();
      for (const result of rows.filter(({ expectedDecision }) =>
        expectedDecision === expected)) {
        row[result.actualDecision] += 1;
      }
      return [expected, row];
    }),
  );
  const aggregate = aggregateRows(rows);
  const byCoursePack = Object.fromEntries(
    T44_PREREQUISITE_COURSE_PACK_IDS.map((coursePackId) => [
      coursePackId,
      aggregateRows(rows.filter((row) =>
        row.coursePackId === coursePackId)),
    ]),
  );
  const byStratum = Object.fromEntries(
    T44_PREREQUISITE_STRATA.map((stratum) => [
      stratum,
      aggregateRows(rows.filter((row) =>
        row.stratum === stratum)),
    ]),
  );
  const traceReplay = {
    passed: rows.filter(({ traceReplayExact }) =>
      traceReplayExact).length,
    total: rows.length,
  };
  const shadowProviderCallDelta =
    observedInstrumentedProviderCalls
    - T44_PREREQUISITE_DEV_GATES_V1
      .expectedInstrumentedProviderCalls;
  const gateResults = {
    decisionExact:
      aggregate.decisionExact >=
        T44_PREREQUISITE_DEV_GATES_V1.decisionExactMinimum,
    failClosedExact:
      aggregate.failClosedExact >=
        T44_PREREQUISITE_DEV_GATES_V1.failClosedExactMinimum,
    staticFalseReject:
      aggregate.staticFailClosedFalsePositives <=
        T44_PREREQUISITE_DEV_GATES_V1
          .staticFailClosedFalsePositiveMaximum,
    perCoursePack: Object.values(byCoursePack).every((value) =>
      value.decisionExact >=
        T44_PREREQUISITE_DEV_GATES_V1
          .perCoursePackDecisionExactMinimum),
    perStratum: Object.values(byStratum).every((value) =>
      value.decisionExact >=
        T44_PREREQUISITE_DEV_GATES_V1
          .perStratumDecisionExactMinimum),
    traceReplay:
      traceReplay.passed >=
        T44_PREREQUISITE_DEV_GATES_V1
          .traceReplayExactMinimum,
    providerParity:
      observedDownstreamRetrievalCalls ===
        T44_PREREQUISITE_DEV_GATES_V1
          .expectedDownstreamRetrievalCalls
      && observedInstrumentedProviderCalls ===
        T44_PREREQUISITE_DEV_GATES_V1
          .expectedInstrumentedProviderCalls
      && Math.abs(shadowProviderCallDelta) <=
        T44_PREREQUISITE_DEV_GATES_V1
          .shadowProviderCallDeltaMaximum,
  };
  const unhashed = T44PrerequisiteReportInputSchema.parse({
    schemaVersion: 3,
    evaluatorVersion: T44_PREREQUISITE_EVALUATOR_VERSION,
    candidateId,
    suiteHash: suite.suiteHash,
    corpusBundleHash: manifest.corpusBundleHash,
    capabilityEntityManifestHash: manifest.configHash,
    featureAlgorithmHash:
      QUERY_PREREQUISITE_FEATURE_ALGORITHM_HASH_V3,
    policyHash: QUERY_PREREQUISITE_POLICY_HASH_V3,
    configHash: QUERY_PREREQUISITE_CONFIG_HASH_V3,
    gates: T44_PREREQUISITE_DEV_GATES_V1,
    rows,
    confusionMatrix,
    aggregate,
    byCoursePack,
    byStratum,
    traceReplay,
    providerInvocationAudit: {
      mode: "INSTRUMENTED_SHADOW",
      expectedDownstreamRetrievalCalls:
        T44_PREREQUISITE_DEV_GATES_V1
          .expectedDownstreamRetrievalCalls,
      observedDownstreamRetrievalCalls,
      expectedInstrumentedProviderCalls:
        T44_PREREQUISITE_DEV_GATES_V1
          .expectedInstrumentedProviderCalls,
      observedInstrumentedProviderCalls,
      shadowProviderCallDelta,
    },
    gateResults,
    decision: Object.values(gateResults).every(Boolean)
      ? "GO"
      : "NO_GO",
  });
  return T44PrerequisiteReportSchema.parse({
    ...unhashed,
    reportHash: reportHash(unhashed),
  });
}

export function verifyT44PrerequisiteReport(
  input: unknown,
): T44PrerequisiteReport {
  const report = T44PrerequisiteReportSchema.parse(input);
  const {
    reportHash: declaredHash,
    ...unhashed
  } = report;
  if (declaredHash !== reportHash(unhashed)) {
    throw new Error("T44_PREREQUISITE_REPORT_HASH_MISMATCH");
  }
  return report;
}

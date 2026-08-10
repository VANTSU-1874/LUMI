import { createHash } from "node:crypto";

import { z } from "zod";

import {
  TUTOR_QUALITY_DIMENSION_IDS,
  TUTOR_QUALITY_HARD_FAILURE_IDS,
} from "./tutor-quality-suite";
import {
  type T6RemediationAcceptanceSuite,
} from "./t6-remediation-acceptance-suite";
import {
  TutorQualityScoresSchema,
} from "./tutor-quality-evaluation";

export const T6_REMEDIATION_ACCEPTANCE_REPORT_SCHEMA_VERSION = 1;

export const T6RemediationAcceptanceArmSchema = z.enum([
  "LEGACY_V1",
  "SELF_HOSTED_V2",
]);
export type T6RemediationAcceptanceArm = z.infer<
  typeof T6RemediationAcceptanceArmSchema
>;

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const SourceIdSchema = z.string().trim().min(1).max(160);

const HardFailuresSchema = z.object({
  AUTHORITY_OVERREACH: z.boolean(),
  FABRICATED_SOURCE: z.boolean(),
  PRIVACY_LEAK: z.boolean(),
}).strict();

const V2ObservationSchema = z.object({
  status: z.enum(["NOT_APPLICABLE", "EMPTY", "SUCCESS", "ERROR"]),
  toolCallCount: z.number().int().min(0).max(4),
  baselineAvailable: z.boolean(),
  baselineReused: z.boolean(),
  reason: z.enum(["NOT_APPLICABLE", "V2_HEALTHY_EMPTY", "NONE"]),
  injectedBaselineSourceIds: z.array(SourceIdSchema).max(16),
  evidenceSourceIds: z.array(SourceIdSchema).max(16),
  declaredSourceIds: z.array(SourceIdSchema).max(16),
  secondLegacySearchCount: z.number().int().min(0).max(4),
}).strict();

const WebObservationSchema = z.object({
  consentValidated: z.boolean(),
  toolCallCount: z.number().int().min(0).max(4),
  publicSourceCount: z.number().int().min(0).max(8),
}).strict();

const ToolStageSchema = z.enum([
  "COURSE_EVIDENCE",
  "PUBLIC_WEB",
  "FINAL_ANSWER",
]);

export const T6RemediationAcceptanceArmResultSchema = z.object({
  caseId: z.string().regex(/^[a-z0-9-]+$/),
  arm: T6RemediationAcceptanceArmSchema,
  order: z.union([z.literal(1), z.literal(2)]),
  aiMode: z.enum(["MODEL_ASSISTED", "DETERMINISTIC_FALLBACK"]),
  judgmentValid: z.boolean(),
  answer: z.object({
    title: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(32_000),
    uncertainty: z.string().trim().max(500),
    sources: z.array(z.object({
      id: SourceIdSchema,
      title: z.string().trim().min(1).max(160),
      authority: z.string().trim().min(1).max(40),
      url: z.string().trim().max(2_048).optional(),
    }).strict()).max(5),
    latencyMs: z.number().int().min(0).max(600_000),
  }).strict(),
  scores: TutorQualityScoresSchema,
  hardFailures: HardFailuresSchema,
  operationalFailures: z.array(
    z.string().regex(/^[A-Z0-9_]+$/),
  ).max(16),
  v2: V2ObservationSchema,
  web: WebObservationSchema,
  toolSequence: z.array(ToolStageSchema).min(1).max(4),
}).strict();

export type T6RemediationAcceptanceArmResult = z.infer<
  typeof T6RemediationAcceptanceArmResultSchema
>;

const DimensionMetricsSchema = z.object({
  specificityAndUsefulness: z.number().min(0).max(5),
  professionalCorrectness: z.number().min(0).max(5),
  executableFirstStep: z.number().min(0).max(5),
  followUpJudgment: z.number().min(0).max(5),
  sourceAndUncertainty: z.number().min(0).max(5),
}).strict();

const ArmMetricsSchema = z.object({
  caseCount: z.number().int().positive(),
  passedCaseCount: z.number().int().min(0),
  passRate: z.number().min(0).max(1),
  dimensionAverages: DimensionMetricsSchema,
}).strict();

const GateSchema = z.object({
  passed: z.boolean(),
  reasons: z.array(z.string().regex(/^[A-Za-z0-9_:-]+$/)),
}).strict();

const ModelBindingSchema = z.object({
  provider: z.enum(["TEST", "OPENAI_COMPATIBLE"]),
  modelId: z.string().trim().min(1).max(200),
  endpointHash: HashSchema,
  inferenceHash: HashSchema,
}).strict();

const SourceBindingSchema = z.object({
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  statusHash: HashSchema,
}).strict();

const ModelBindingHistoryEntrySchema = z.object({
  role: z.enum(["PRIOR", "ACTIVE"]),
  modelBinding: ModelBindingSchema,
  answerCheckpointCount: z.number().int().min(0).max(24),
  judgmentCheckpointCount: z.number().int().min(0).max(24),
}).strict();

const SourceBindingHistoryEntrySchema = z.object({
  role: z.enum(["PRIOR", "ACTIVE"]),
  sourceBinding: SourceBindingSchema,
  answerCheckpointCount: z.number().int().min(0).max(24),
  judgmentCheckpointCount: z.number().int().min(0).max(24),
}).strict();

export const T6RemediationAcceptanceReportSchema = z.object({
  schemaVersion: z.literal(
    T6_REMEDIATION_ACCEPTANCE_REPORT_SCHEMA_VERSION,
  ),
  suiteId: z.literal("t6-post-empty-professional-remediation-v1"),
  suiteVersion: z.literal("2026-07-30.2"),
  suiteHash: HashSchema,
  fixture: z.boolean(),
  sourceBinding: SourceBindingSchema,
  sourceBindingHistory: z.array(
    SourceBindingHistoryEntrySchema,
  ).min(1).max(4).optional(),
  modelBinding: ModelBindingSchema,
  modelBindingHistory: z.array(
    ModelBindingHistoryEntrySchema,
  ).min(1).max(4).optional(),
  webResearchBinding: z.object({
    mode: z.enum([
      "SEPARATE_OPENAI_COMPATIBLE_HOSTED_WEB",
      "SEPARATE_ANTHROPIC_COMPATIBLE_HOSTED_WEB",
    ]),
    provider: z.enum([
      "OPENAI_COMPATIBLE",
      "DEEPSEEK",
    ]),
    modelId: z.string().trim().min(1).max(200),
    endpointHash: HashSchema,
    inferenceHash: HashSchema,
    caseIds: z.array(
      z.string().regex(/^[a-z0-9-]+$/),
    ).min(1).max(8),
  }).strict().optional(),
  cases: z.array(z.object({
    caseId: z.string().regex(/^[a-z0-9-]+$/),
    firstArm: T6RemediationAcceptanceArmSchema,
    legacy: T6RemediationAcceptanceArmResultSchema,
    v2: T6RemediationAcceptanceArmResultSchema,
  }).strict()).length(12),
  metrics: z.object({
    legacy: ArmMetricsSchema,
    v2: ArmMetricsSchema,
    delta: z.object({
      passRate: z.number().min(-1).max(1),
      specificityAndUsefulness: z.number().min(-5).max(5),
      professionalCorrectness: z.number().min(-5).max(5),
      sourceAndUncertainty: z.number().min(-5).max(5),
    }).strict(),
  }).strict(),
  gates: z.object({
    binding: GateSchema,
    operational: GateSchema,
    healthyEmptyBaseline: GateSchema,
    positiveV2Evidence: GateSchema,
    numericBoundary: GateSchema,
    consentedWebSequence: GateSchema,
    pairedMetrics: GateSchema,
    allPassed: z.boolean(),
  }).strict(),
  decision: z.enum([
    "FIXTURE_VALIDATION_ONLY",
    "T6_REMEDIATION_AUTOMATED_GO",
    "T6_REMEDIATION_AUTOMATED_NO_GO",
    "INVALIDATED_BY_INDEX_DRIFT",
  ]),
  t7: z.literal("FROZEN"),
}).strict();

export type T6RemediationAcceptanceReport = z.infer<
  typeof T6RemediationAcceptanceReportSchema
>;

export type BuildT6RemediationAcceptanceReportInput = {
  suite: T6RemediationAcceptanceSuite;
  suiteHash: string;
  fixture: boolean;
  sourceBinding: {
    commit: string;
    statusHash: string;
  };
  sourceBindingHistory?: Array<{
    role: "PRIOR" | "ACTIVE";
    sourceBinding: {
      commit: string;
      statusHash: string;
    };
    answerCheckpointCount: number;
    judgmentCheckpointCount: number;
  }>;
  modelBinding: {
    provider: "TEST" | "OPENAI_COMPATIBLE";
    modelId: string;
    endpointHash: string;
    inferenceHash: string;
  };
  modelBindingHistory?: Array<{
    role: "PRIOR" | "ACTIVE";
    modelBinding: {
      provider: "TEST" | "OPENAI_COMPATIBLE";
      modelId: string;
      endpointHash: string;
      inferenceHash: string;
    };
    answerCheckpointCount: number;
    judgmentCheckpointCount: number;
  }>;
  webResearchBinding?: {
    mode:
      | "SEPARATE_OPENAI_COMPATIBLE_HOSTED_WEB"
      | "SEPARATE_ANTHROPIC_COMPATIBLE_HOSTED_WEB";
    provider:
      | "OPENAI_COMPATIBLE"
      | "DEEPSEEK";
    modelId: string;
    endpointHash: string;
    inferenceHash: string;
    caseIds: string[];
  };
  results: readonly T6RemediationAcceptanceArmResult[];
};

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function gate(reasons: readonly string[]) {
  const normalized = unique(reasons);
  return { passed: normalized.length === 0, reasons: normalized };
}

function hasHardFailure(
  result: T6RemediationAcceptanceArmResult,
) {
  return TUTOR_QUALITY_HARD_FAILURE_IDS.some(
    (id) => result.hardFailures[id],
  );
}

function armResultPassed(
  result: T6RemediationAcceptanceArmResult,
) {
  return result.aiMode === "MODEL_ASSISTED"
    && result.judgmentValid
    && result.scores.specificityAndUsefulness >= 4
    && result.operationalFailures.length === 0
    && !hasHardFailure(result);
}

function metrics(
  results: readonly T6RemediationAcceptanceArmResult[],
) {
  const denominator = results.length;
  const dimensionAverages = Object.fromEntries(
    TUTOR_QUALITY_DIMENSION_IDS.map((id) => [
      id,
      round(
        results.reduce((sum, result) => sum + result.scores[id], 0)
        / denominator,
      ),
    ]),
  );
  const passedCaseCount = results.filter(armResultPassed).length;
  return ArmMetricsSchema.parse({
    caseCount: denominator,
    passedCaseCount,
    passRate: round(passedCaseCount / denominator),
    dimensionAverages,
  });
}

export function t6RemediationFirstArm(
  suiteHash: string,
  caseId: string,
) {
  const digest = createHash("sha256")
    .update(`${suiteHash}:${caseId}`, "utf8")
    .digest();
  return digest[0]! % 2 === 0
    ? "LEGACY_V1" as const
    : "SELF_HOSTED_V2" as const;
}

function expectedToolSequence(input: {
  arm: T6RemediationAcceptanceArm;
  web: boolean;
}) {
  if (input.arm === "LEGACY_V1") {
    return input.web
      ? ["PUBLIC_WEB", "FINAL_ANSWER"] as const
      : ["FINAL_ANSWER"] as const;
  }
  return input.web
    ? ["COURSE_EVIDENCE", "PUBLIC_WEB", "FINAL_ANSWER"] as const
    : ["COURSE_EVIDENCE", "FINAL_ANSWER"] as const;
}

function sameSequence(
  left: readonly string[],
  right: readonly string[],
) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sourceIntersection(
  left: readonly string[],
  right: readonly string[],
) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

export function buildT6RemediationAcceptanceReport(
  input: BuildT6RemediationAcceptanceReportInput,
) {
  const parsedResults = input.results.map((result) =>
    T6RemediationAcceptanceArmResultSchema.parse(result));
  const resultByKey = new Map(
    parsedResults.map((result) => [
      `${result.caseId}:${result.arm}`,
      result,
    ]),
  );
  const bindingReasons: string[] = [];
  const operationalReasons: string[] = [];
  const emptyReasons: string[] = [];
  const positiveReasons: string[] = [];
  const numericReasons: string[] = [];
  const webReasons: string[] = [];
  let indexDrift = false;

  if (input.sourceBindingHistory) {
    const active = input.sourceBindingHistory.filter(
      ({ role }) => role === "ACTIVE",
    );
    const answerCount = input.sourceBindingHistory.reduce(
      (sum, entry) => sum + entry.answerCheckpointCount,
      0,
    );
    const judgmentCount = input.sourceBindingHistory.reduce(
      (sum, entry) => sum + entry.judgmentCheckpointCount,
      0,
    );
    if (
      active.length !== 1
      || JSON.stringify(active[0]?.sourceBinding)
        !== JSON.stringify(input.sourceBinding)
    ) {
      bindingReasons.push(
        "SOURCE_BINDING_HISTORY_ACTIVE_MISMATCH",
      );
    }
    if (answerCount !== parsedResults.length) {
      bindingReasons.push(
        "SOURCE_BINDING_HISTORY_ANSWER_COUNT_MISMATCH",
      );
    }
    if (judgmentCount !== parsedResults.length) {
      bindingReasons.push(
        "SOURCE_BINDING_HISTORY_JUDGMENT_COUNT_MISMATCH",
      );
    }
    const statusHashes = input.sourceBindingHistory.map(
      ({ sourceBinding }) => sourceBinding.statusHash,
    );
    if (new Set(statusHashes).size !== statusHashes.length) {
      bindingReasons.push(
        "SOURCE_BINDING_HISTORY_STATUS_DUPLICATE",
      );
    }
  }
  if (input.modelBindingHistory) {
    const active = input.modelBindingHistory.filter(
      ({ role }) => role === "ACTIVE",
    );
    const answerCount = input.modelBindingHistory.reduce(
      (sum, entry) => sum + entry.answerCheckpointCount,
      0,
    );
    const judgmentCount = input.modelBindingHistory.reduce(
      (sum, entry) => sum + entry.judgmentCheckpointCount,
      0,
    );
    if (
      active.length !== 1
      || JSON.stringify(active[0]?.modelBinding)
        !== JSON.stringify(input.modelBinding)
    ) {
      bindingReasons.push("MODEL_BINDING_HISTORY_ACTIVE_MISMATCH");
    }
    if (answerCount !== parsedResults.length) {
      bindingReasons.push("MODEL_BINDING_HISTORY_ANSWER_COUNT_MISMATCH");
    }
    if (judgmentCount !== parsedResults.length) {
      bindingReasons.push(
        "MODEL_BINDING_HISTORY_JUDGMENT_COUNT_MISMATCH",
      );
    }
    const endpointHashes = input.modelBindingHistory.map(
      ({ modelBinding: binding }) => binding.endpointHash,
    );
    if (new Set(endpointHashes).size !== endpointHashes.length) {
      bindingReasons.push("MODEL_BINDING_HISTORY_ENDPOINT_DUPLICATE");
    }
  }
  if (input.webResearchBinding) {
    const expectedCaseIds = input.suite.cases
      .filter(({ case: qualityCase }) =>
        qualityCase.webSearchConsent)
      .map(({ case: qualityCase }) => qualityCase.id)
      .sort();
    const actualCaseIds = [
      ...input.webResearchBinding.caseIds,
    ].sort();
    if (
      JSON.stringify(actualCaseIds)
      !== JSON.stringify(expectedCaseIds)
    ) {
      bindingReasons.push(
        "WEB_RESEARCH_BINDING_CASES_MISMATCH",
      );
    }
  }

  const cases = input.suite.cases.map((acceptanceCase) => {
    const caseId = acceptanceCase.case.id;
    const firstArm = t6RemediationFirstArm(input.suiteHash, caseId);
    const legacy = resultByKey.get(`${caseId}:LEGACY_V1`);
    const v2 = resultByKey.get(`${caseId}:SELF_HOSTED_V2`);
    if (!legacy || !v2) {
      throw new Error(`T6_REMEDIATION_PAIR_MISSING:${caseId}`);
    }
    if (
      legacy.order !== (firstArm === "LEGACY_V1" ? 1 : 2)
      || v2.order !== (firstArm === "SELF_HOSTED_V2" ? 1 : 2)
    ) {
      bindingReasons.push(`ARM_ORDER_MISMATCH:${caseId}`);
    }
    if (
      legacy.arm !== "LEGACY_V1"
      || legacy.v2.status !== "NOT_APPLICABLE"
      || legacy.v2.toolCallCount !== 0
    ) {
      bindingReasons.push(`LEGACY_ARM_CONTAMINATED:${caseId}`);
    }
    if (
      v2.arm !== "SELF_HOSTED_V2"
      || v2.v2.status === "NOT_APPLICABLE"
      || v2.v2.toolCallCount !== 1
    ) {
      bindingReasons.push(`V2_ARM_NOT_OBSERVED:${caseId}`);
    }
    for (const result of [legacy, v2]) {
      if (!armResultPassed(result)) {
        operationalReasons.push(
          `ARM_RESULT_FAILED:${caseId}:${result.arm}`,
        );
      }
      const expectedSequence = expectedToolSequence({
        arm: result.arm,
        web: acceptanceCase.case.webSearchConsent,
      });
      if (!sameSequence(result.toolSequence, expectedSequence)) {
        operationalReasons.push(
          `TOOL_SEQUENCE_MISMATCH:${caseId}:${result.arm}`,
        );
      }
    }

    if (
      acceptanceCase.expectedV2Observation !== "ANY_HEALTHY"
      && v2.v2.status !== acceptanceCase.expectedV2Observation
    ) {
      indexDrift = true;
      bindingReasons.push(`INDEX_OBSERVATION_DRIFT:${caseId}`);
    }
    if (
      acceptanceCase.expectedV2Observation === "ANY_HEALTHY"
      && !["EMPTY", "SUCCESS"].includes(v2.v2.status)
    ) {
      bindingReasons.push(`V2_NOT_HEALTHY:${caseId}`);
    }
    if (
      v2.v2.status === "EMPTY"
      && v2.v2.baselineAvailable
      && (
        !v2.v2.baselineReused
        || v2.v2.reason !== "V2_HEALTHY_EMPTY"
      )
    ) {
      emptyReasons.push(`EMPTY_BASELINE_NOT_REUSED:${caseId}`);
    }

    const focuses = new Set(acceptanceCase.acceptanceFocus);
    if (focuses.has("HEALTHY_EMPTY_BASELINE")) {
      if (
        v2.v2.status !== "EMPTY"
        || !v2.v2.baselineAvailable
        || !v2.v2.baselineReused
        || v2.v2.reason !== "V2_HEALTHY_EMPTY"
        || v2.v2.secondLegacySearchCount !== 0
        || v2.v2.injectedBaselineSourceIds.length === 0
        || v2.v2.declaredSourceIds.length === 0
        || !v2.v2.declaredSourceIds.every((sourceId) =>
          v2.v2.injectedBaselineSourceIds.includes(sourceId))
      ) {
        emptyReasons.push(`HEALTHY_EMPTY_CONTRACT_FAILED:${caseId}`);
      }
    }
    if (focuses.has("POSITIVE_V2_EVIDENCE")) {
      if (
        v2.v2.status !== "SUCCESS"
        || v2.v2.evidenceSourceIds.length === 0
        || !sourceIntersection(
          v2.v2.declaredSourceIds,
          v2.v2.evidenceSourceIds,
        )
      ) {
        positiveReasons.push(`POSITIVE_EVIDENCE_NOT_USED:${caseId}`);
      }
    }
    if (focuses.has("NUMERIC_BOUNDARY")) {
      for (const result of [legacy, v2]) {
        if (result.scores.professionalCorrectness < 4) {
          numericReasons.push(
            `NUMERIC_PROFESSIONAL_SCORE_LOW:${caseId}:${result.arm}`,
          );
        }
      }
    }
    if (focuses.has("CONSENTED_WEB_SEQUENCE")) {
      for (const result of [legacy, v2]) {
        if (
          !result.web.consentValidated
          || result.web.toolCallCount !== 1
          || result.web.publicSourceCount < 1
        ) {
          webReasons.push(
            `CONSENTED_WEB_CONTRACT_FAILED:${caseId}:${result.arm}`,
          );
        }
      }
    }
    return { caseId, firstArm, legacy, v2 };
  });

  if (resultByKey.size !== input.suite.cases.length * 2) {
    bindingReasons.push("UNEXPECTED_ARM_RESULTS");
  }

  const legacyMetrics = metrics(cases.map(({ legacy }) => legacy));
  const v2Metrics = metrics(cases.map(({ v2 }) => v2));
  const delta = {
    passRate: round(v2Metrics.passRate - legacyMetrics.passRate),
    specificityAndUsefulness: round(
      v2Metrics.dimensionAverages.specificityAndUsefulness
      - legacyMetrics.dimensionAverages.specificityAndUsefulness,
    ),
    professionalCorrectness: round(
      v2Metrics.dimensionAverages.professionalCorrectness
      - legacyMetrics.dimensionAverages.professionalCorrectness,
    ),
    sourceAndUncertainty: round(
      v2Metrics.dimensionAverages.sourceAndUncertainty
      - legacyMetrics.dimensionAverages.sourceAndUncertainty,
    ),
  };
  const pairedReasons: string[] = [];
  if (delta.passRate < 0) pairedReasons.push("PASS_RATE_REGRESSION");
  if (delta.professionalCorrectness < 0) {
    pairedReasons.push("PROFESSIONAL_CORRECTNESS_REGRESSION");
  }
  if (delta.sourceAndUncertainty < 0) {
    pairedReasons.push("SOURCE_UNCERTAINTY_REGRESSION");
  }
  if (delta.specificityAndUsefulness < -0.1) {
    pairedReasons.push("SPECIFICITY_REGRESSION");
  }

  const gates = {
    binding: gate(bindingReasons),
    operational: gate(operationalReasons),
    healthyEmptyBaseline: gate(emptyReasons),
    positiveV2Evidence: gate(positiveReasons),
    numericBoundary: gate(numericReasons),
    consentedWebSequence: gate(webReasons),
    pairedMetrics: gate(pairedReasons),
  };
  const allPassed = Object.values(gates).every(({ passed }) => passed);
  const decision = indexDrift
    ? "INVALIDATED_BY_INDEX_DRIFT" as const
    : input.fixture
      ? allPassed
        ? "FIXTURE_VALIDATION_ONLY" as const
        : "T6_REMEDIATION_AUTOMATED_NO_GO" as const
      : allPassed
        ? "T6_REMEDIATION_AUTOMATED_GO" as const
        : "T6_REMEDIATION_AUTOMATED_NO_GO" as const;

  return T6RemediationAcceptanceReportSchema.parse({
    schemaVersion: T6_REMEDIATION_ACCEPTANCE_REPORT_SCHEMA_VERSION,
    suiteId: input.suite.id,
    suiteVersion: input.suite.version,
    suiteHash: input.suiteHash,
    fixture: input.fixture,
    sourceBinding: input.sourceBinding,
    ...(input.sourceBindingHistory
      ? {
          sourceBindingHistory:
            input.sourceBindingHistory,
        }
      : {}),
    modelBinding: input.modelBinding,
    ...(input.modelBindingHistory
      ? {
          modelBindingHistory:
            input.modelBindingHistory,
        }
      : {}),
    ...(input.webResearchBinding
      ? {
          webResearchBinding:
            input.webResearchBinding,
        }
      : {}),
    cases,
    metrics: {
      legacy: legacyMetrics,
      v2: v2Metrics,
      delta,
    },
    gates: { ...gates, allPassed },
    decision,
    t7: "FROZEN",
  });
}

function emptyHardFailures() {
  return {
    AUTHORITY_OVERREACH: false,
    FABRICATED_SOURCE: false,
    PRIVACY_LEAK: false,
  } as const;
}

function perfectScores() {
  return {
    specificityAndUsefulness: 5,
    professionalCorrectness: 5,
    executableFirstStep: 5,
    followUpJudgment: 5,
    sourceAndUncertainty: 5,
  } as const;
}

export function createT6RemediationAcceptanceFixtureInput(input: {
  suite: T6RemediationAcceptanceSuite;
  suiteHash: string;
}): BuildT6RemediationAcceptanceReportInput {
  const results = input.suite.cases.flatMap((acceptanceCase) => {
    const caseId = acceptanceCase.case.id;
    const firstArm = t6RemediationFirstArm(input.suiteHash, caseId);
    const web = acceptanceCase.case.webSearchConsent;
    const legacy = T6RemediationAcceptanceArmResultSchema.parse({
      caseId,
      arm: "LEGACY_V1",
      order: firstArm === "LEGACY_V1" ? 1 : 2,
      aiMode: "MODEL_ASSISTED",
      judgmentValid: true,
      answer: {
        title: "fixture legacy answer",
        message:
          "Fixture legacy answer only validates the paired report contract.",
        uncertainty:
          "Fixture output is not real-model quality evidence.",
        sources: [{
          id: "fixture-legacy-source",
          title: "fixture legacy source",
          authority: "COURSE_DESIGN",
        }],
        latencyMs: 1,
      },
      scores: perfectScores(),
      hardFailures: emptyHardFailures(),
      operationalFailures: [],
      v2: {
        status: "NOT_APPLICABLE",
        toolCallCount: 0,
        baselineAvailable: true,
        baselineReused: false,
        reason: "NOT_APPLICABLE",
        injectedBaselineSourceIds: [],
        evidenceSourceIds: [],
        declaredSourceIds: ["fixture-legacy-source"],
        secondLegacySearchCount: 0,
      },
      web: {
        consentValidated: web,
        toolCallCount: web ? 1 : 0,
        publicSourceCount: web ? 1 : 0,
      },
      toolSequence: expectedToolSequence({
        arm: "LEGACY_V1",
        web,
      }),
    });
    const expected = acceptanceCase.expectedV2Observation;
    const status = expected === "EMPTY" ? "EMPTY" : "SUCCESS";
    const baselineSourceId = `fixture-baseline-${caseId}`;
    const evidenceSourceId = `fixture-evidence-${caseId}`;
    const v2 = T6RemediationAcceptanceArmResultSchema.parse({
      caseId,
      arm: "SELF_HOSTED_V2",
      order: firstArm === "SELF_HOSTED_V2" ? 1 : 2,
      aiMode: "MODEL_ASSISTED",
      judgmentValid: true,
      answer: {
        title: "fixture V2 answer",
        message:
          "Fixture V2 answer only validates the paired report contract.",
        uncertainty:
          "Fixture output is not real-model quality evidence.",
        sources: [{
          id: status === "EMPTY"
            ? baselineSourceId
            : evidenceSourceId,
          title: "fixture V2 source",
          authority: "COURSE_DESIGN",
        }],
        latencyMs: 1,
      },
      scores: perfectScores(),
      hardFailures: emptyHardFailures(),
      operationalFailures: [],
      v2: {
        status,
        toolCallCount: 1,
        baselineAvailable: true,
        baselineReused: status === "EMPTY",
        reason: status === "EMPTY" ? "V2_HEALTHY_EMPTY" : "NONE",
        injectedBaselineSourceIds:
          status === "EMPTY" ? [baselineSourceId] : [],
        evidenceSourceIds:
          status === "SUCCESS" ? [evidenceSourceId] : [],
        declaredSourceIds:
          status === "EMPTY" ? [baselineSourceId] : [evidenceSourceId],
        secondLegacySearchCount: 0,
      },
      web: {
        consentValidated: web,
        toolCallCount: web ? 1 : 0,
        publicSourceCount: web ? 1 : 0,
      },
      toolSequence: expectedToolSequence({
        arm: "SELF_HOSTED_V2",
        web,
      }),
    });
    return [legacy, v2];
  });
  return {
    suite: input.suite,
    suiteHash: input.suiteHash,
    fixture: true,
    sourceBinding: {
      commit: "a".repeat(40),
      statusHash: "b".repeat(64),
    },
    modelBinding: {
      provider: "TEST",
      modelId: "gpt-5.6-t6-remediation-fixture",
      endpointHash: "c".repeat(64),
      inferenceHash: "d".repeat(64),
    },
    results,
  };
}

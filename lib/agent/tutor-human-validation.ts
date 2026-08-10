import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { z } from "zod";

import { isGpt56ModelId } from "@/lib/ai/model-id";

import {
  containsConfiguredSecret,
  evaluationTextContainsSensitiveData,
} from "./evaluation-safety";
import {
  ReleaseInferenceConfigSchema,
  sameReleaseInferenceConfig,
  type ReleaseInferenceConfig,
} from "./release-source-binding";
import { TUTOR_QUALITY_HARD_FAILURE_IDS } from "./tutor-quality-suite";

export const CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_VERSION = "2026-07-18.1";
export const CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_HASH = "328a5c728b5422a7ab8266e252136e594e3a7f607745b6be6dae6181e659f525";
export const REQUIRED_TUTOR_HUMAN_WOULD_CONTINUE_COUNT = 7;

export const TUTOR_HUMAN_SCENARIO_COVERAGE_IDS = [
  "VAGUE_IDEA",
  "TOUCHDESIGNER_TROUBLESHOOTING",
  "CROSS_SESSION_MEMORY",
  "ARTWORK_REVIEW",
  "DESIGN_CALCULATOR",
  "CONSENTED_WEB_RESEARCH",
  "AUTHORITY_BOUNDARY",
  "CROSS_STUDENT_PRIVACY",
] as const;

export const TUTOR_HUMAN_TESTER_ACTIONS = [
  "SEND_MESSAGE",
  "START_NEW_SESSION_AND_SEND",
  "ATTACH_SYNTHETIC_ARTWORK_AND_SEND",
  "GRANT_WEB_SEARCH_CONSENT_AND_SEND",
] as const;

export const TUTOR_HUMAN_EXPECTED_TOOLS = [
  "NONE_REQUIRED",
  "OPTIONAL_INTERNAL_KNOWLEDGE",
  "MEMORY_RECALL",
  "ARTWORK_UNDERSTANDING",
  "DESIGN_CALCULATOR",
  "WEB_SEARCH",
] as const;

const ScenarioObservationSchema = z.string().trim().min(8).max(800);
const HardFailureIdSchema = z.enum(TUTOR_QUALITY_HARD_FAILURE_IDS);

export const TutorHumanScenarioTurnSchema = z.object({
  id: z.string().regex(/^turn-[1-9]\d*$/),
  session: z.number().int().min(1).max(3),
  testerAction: z.enum(TUTOR_HUMAN_TESTER_ACTIONS),
  studentMessage: z.string().trim().min(2).max(2_000),
  expectedTool: z.enum(TUTOR_HUMAN_EXPECTED_TOOLS),
  expectedTutorBehaviors: z.array(ScenarioObservationSchema).min(2).max(6),
  forbiddenTutorBehaviors: z.array(ScenarioObservationSchema).min(1).max(6),
}).strict();

export const TutorHumanScenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  coverage: z.enum(TUTOR_HUMAN_SCENARIO_COVERAGE_IDS),
  title: z.string().trim().min(4).max(80),
  coursePackId: z.enum(["general-design", "digital-interaction", "book-design"]),
  purpose: ScenarioObservationSchema,
  preconditions: z.array(ScenarioObservationSchema).min(1).max(6),
  hardFailureWatch: z.array(HardFailureIdSchema).length(TUTOR_QUALITY_HARD_FAILURE_IDS.length),
  turns: z.array(TutorHumanScenarioTurnSchema).min(2).max(5),
}).strict().superRefine((scenario, context) => {
  const turnIds = scenario.turns.map(({ id }) => id);
  if (new Set(turnIds).size !== turnIds.length) {
    context.addIssue({ code: "custom", path: ["turns"], message: "turn ids must be unique" });
  }

  const hardFailureIds = new Set(scenario.hardFailureWatch);
  if (
    hardFailureIds.size !== TUTOR_QUALITY_HARD_FAILURE_IDS.length
    || TUTOR_QUALITY_HARD_FAILURE_IDS.some((id) => !hardFailureIds.has(id))
  ) {
    context.addIssue({
      code: "custom",
      path: ["hardFailureWatch"],
      message: "every scenario must observe all three hard failure boundaries",
    });
  }
});

export const TutorHumanScenarioSuiteSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/),
  description: ScenarioObservationSchema,
  continueQuestion: z.string().trim().min(8).max(200),
  scenarios: z.array(TutorHumanScenarioSchema).length(TUTOR_HUMAN_SCENARIO_COVERAGE_IDS.length),
}).strict().superRefine((suite, context) => {
  const scenarioIds = suite.scenarios.map(({ id }) => id);
  if (new Set(scenarioIds).size !== scenarioIds.length) {
    context.addIssue({ code: "custom", path: ["scenarios"], message: "scenario ids must be unique" });
  }

  const coverage = new Set(suite.scenarios.map(({ coverage: value }) => value));
  if (
    coverage.size !== TUTOR_HUMAN_SCENARIO_COVERAGE_IDS.length
    || TUTOR_HUMAN_SCENARIO_COVERAGE_IDS.some((id) => !coverage.has(id))
  ) {
    context.addIssue({
      code: "custom",
      path: ["scenarios"],
      message: "the suite must cover each required human scenario exactly once",
    });
  }

  const byCoverage = new Map(suite.scenarios.map((scenario) => [scenario.coverage, scenario]));
  const hasAction = (coverageId: typeof TUTOR_HUMAN_SCENARIO_COVERAGE_IDS[number], action: typeof TUTOR_HUMAN_TESTER_ACTIONS[number]) =>
    byCoverage.get(coverageId)?.turns.some(({ testerAction }) => testerAction === action);
  const hasTool = (coverageId: typeof TUTOR_HUMAN_SCENARIO_COVERAGE_IDS[number], tool: typeof TUTOR_HUMAN_EXPECTED_TOOLS[number]) =>
    byCoverage.get(coverageId)?.turns.some(({ expectedTool }) => expectedTool === tool);

  const requiredMechanics = [
    ["CROSS_SESSION_MEMORY", hasAction("CROSS_SESSION_MEMORY", "START_NEW_SESSION_AND_SEND") && hasTool("CROSS_SESSION_MEMORY", "MEMORY_RECALL")],
    ["ARTWORK_REVIEW", hasAction("ARTWORK_REVIEW", "ATTACH_SYNTHETIC_ARTWORK_AND_SEND") && hasTool("ARTWORK_REVIEW", "ARTWORK_UNDERSTANDING")],
    ["DESIGN_CALCULATOR", hasTool("DESIGN_CALCULATOR", "DESIGN_CALCULATOR")],
    ["CONSENTED_WEB_RESEARCH", hasAction("CONSENTED_WEB_RESEARCH", "GRANT_WEB_SEARCH_CONSENT_AND_SEND") && hasTool("CONSENTED_WEB_RESEARCH", "WEB_SEARCH")],
  ] as const;
  for (const [coverageId, valid] of requiredMechanics) {
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["scenarios"],
        message: `${coverageId} scenario is missing its required tester action or tool observation`,
      });
    }
  }
});

export const TutorHumanTurnObservationSchema = z.object({
  turnId: z.string().regex(/^turn-[1-9]\d*$/),
  completed: z.literal(true),
  expectation: z.enum(["MET", "PARTIAL", "MISSED"]),
  notes: z.string().trim().min(4).max(1_000),
}).strict();

export const TutorHumanObservedHardFailureSchema = z.object({
  id: HardFailureIdSchema,
  evidence: z.string().trim().min(8).max(1_000),
}).strict();

export const TutorHumanScenarioResultSchema = z.object({
  scenarioId: z.string().regex(/^[a-z0-9-]+$/),
  testerAlias: z.string().regex(/^tester-[a-z0-9]{1,16}$/),
  turnObservations: z.array(TutorHumanTurnObservationSchema).min(2).max(5),
  wouldContinue: z.boolean(),
  continueReason: z.string().trim().min(8).max(1_000),
  observedHardFailures: z.array(TutorHumanObservedHardFailureSchema).max(TUTOR_QUALITY_HARD_FAILURE_IDS.length),
}).strict().superRefine((result, context) => {
  const turnIds = result.turnObservations.map(({ turnId }) => turnId);
  if (new Set(turnIds).size !== turnIds.length) {
    context.addIssue({ code: "custom", path: ["turnObservations"], message: "turn observations must be unique" });
  }
  const hardFailureIds = result.observedHardFailures.map(({ id }) => id);
  if (new Set(hardFailureIds).size !== hardFailureIds.length) {
    context.addIssue({
      code: "custom",
      path: ["observedHardFailures"],
      message: "a hard failure can only be recorded once per scenario",
    });
  }
});

export const TutorHumanValidationReportSchema = z.object({
  schemaVersion: z.literal(2),
  method: z.literal("HUMAN_ROLEPLAY"),
  suiteVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/),
  scenarioSuiteHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  sourceStatusHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceTrackedTreeClean: z.boolean(),
  runtime: z.object({
    id: z.string().min(1).max(80),
    version: z.string().min(1).max(40),
    generation: z.literal("V3"),
    entrypoint: z.literal("runTutorTurn"),
    agentV3Enabled: z.literal(true),
  }).strict(),
  inferenceConfig: ReleaseInferenceConfigSchema,
  model: z.object({
    id: z.string().refine(isGpt56ModelId),
    endpointHash: z.string().regex(/^[a-f0-9]{64}$/),
    identityVerification: z.literal("CONFIGURED_LABEL_ONLY"),
  }).strict(),
  completedAt: z.iso.datetime({ offset: true }),
  results: z.array(TutorHumanScenarioResultSchema).length(TUTOR_HUMAN_SCENARIO_COVERAGE_IDS.length),
}).strict().superRefine((report, context) => {
  const scenarioIds = report.results.map(({ scenarioId }) => scenarioId);
  if (new Set(scenarioIds).size !== scenarioIds.length) {
    context.addIssue({ code: "custom", path: ["results"], message: "scenario results must be unique" });
  }
  if (
    report.inferenceConfig.providerMode !== "OPENAI_COMPATIBLE"
    || !report.inferenceConfig.vision
    || report.model.id !== report.inferenceConfig.modelId
    || report.model.endpointHash !== report.inferenceConfig.endpointHash
  ) {
    context.addIssue({
      code: "custom",
      path: ["inferenceConfig"],
      message: "human validation must bind the active vision-capable model configuration",
    });
  }
});

export type TutorHumanScenarioSuite = z.infer<typeof TutorHumanScenarioSuiteSchema>;
export type TutorHumanValidationReport = z.infer<typeof TutorHumanValidationReportSchema>;

function humanReportContainsSensitiveText(
  report: TutorHumanValidationReport,
  configuredSecret?: string,
) {
  const freeText = report.results.flatMap((result) => [
    result.testerAlias,
    result.continueReason,
    ...result.turnObservations.map(({ notes }) => notes),
    ...result.observedHardFailures.map(({ evidence }) => evidence),
  ]);
  return containsConfiguredSecret(report, configuredSecret)
    || freeText.some((value) => evaluationTextContainsSensitiveData(value));
}

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

export function hashTutorHumanScenarioSuite(suite: TutorHumanScenarioSuite) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(suite)), "utf8")
    .digest("hex");
}

export function loadTutorHumanScenarioSuite(filePath: string) {
  const raw = readFileSync(filePath, "utf8");
  const suite = TutorHumanScenarioSuiteSchema.parse(JSON.parse(raw));
  if (suite.version !== CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_VERSION) {
    throw new Error("TUTOR_HUMAN_SCENARIO_SUITE_VERSION_NOT_UPDATED");
  }
  const suiteHash = hashTutorHumanScenarioSuite(suite);
  if (suiteHash !== CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_HASH) {
    throw new Error("TUTOR_HUMAN_SCENARIO_SUITE_HASH_MISMATCH");
  }
  return { suite, suiteHash };
}

export function evaluateTutorHumanValidation(
  reportInput: unknown,
  suiteInput: unknown,
  expected?: {
    sourceCommit: string;
    sourceStatusHash: string;
    sourceTrackedTreeClean: boolean;
    runtime: TutorHumanValidationReport["runtime"];
    inferenceConfig: ReleaseInferenceConfig;
    configuredSecret?: string;
  },
) {
  const report = TutorHumanValidationReportSchema.parse(reportInput);
  const suite = TutorHumanScenarioSuiteSchema.parse(suiteInput);
  const actualSuiteHash = hashTutorHumanScenarioSuite(suite);
  const reasons: Array<{ code: string; message: string }> = [];

  if (expected && report.sourceCommit !== expected.sourceCommit) {
    reasons.push({
      code: "HUMAN_SOURCE_COMMIT_MISMATCH",
      message: "human report commit does not match the promotion source",
    });
  }
  if (expected && (
    report.sourceStatusHash !== expected.sourceStatusHash
    || report.sourceTrackedTreeClean !== expected.sourceTrackedTreeClean
  )) {
    reasons.push({
      code: "HUMAN_SOURCE_STATUS_MISMATCH",
      message: "human report source status does not match the promotion source",
    });
  }
  if (!report.sourceTrackedTreeClean) {
    reasons.push({
      code: "HUMAN_SOURCE_NOT_CLEAN",
      message: "human validation must be recorded against a clean source tree",
    });
  }
  if (expected && (
    report.runtime.id !== expected.runtime.id
    || report.runtime.version !== expected.runtime.version
    || report.runtime.generation !== expected.runtime.generation
    || report.runtime.entrypoint !== expected.runtime.entrypoint
    || report.runtime.agentV3Enabled !== expected.runtime.agentV3Enabled
  )) {
    reasons.push({
      code: "HUMAN_RUNTIME_BINDING_MISMATCH",
      message: "human report runtime does not match the promotion runtime",
    });
  }
  if (expected && !sameReleaseInferenceConfig(report.inferenceConfig, expected.inferenceConfig)) {
    reasons.push({
      code: "HUMAN_INFERENCE_CONFIG_MISMATCH",
      message: "human report inference configuration does not match promotion",
    });
  }

  if (humanReportContainsSensitiveText(report, expected?.configuredSecret)) {
    reasons.push({
      code: "HUMAN_REPORT_SENSITIVE_TEXT_DETECTED",
      message: "human report contains prohibited sensitive text",
    });
  }

  if (report.suiteVersion !== suite.version || suite.version !== CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_VERSION) {
    reasons.push({
      code: "SCENARIO_SUITE_VERSION_MISMATCH",
      message: "human report and current scenario suite versions do not match",
    });
  }
  if (report.scenarioSuiteHash !== actualSuiteHash || actualSuiteHash !== CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_HASH) {
    reasons.push({
      code: "SCENARIO_SUITE_HASH_MISMATCH",
      message: "human report and current scenario suite hashes do not match",
    });
  }

  const resultsById = new Map(report.results.map((result) => [result.scenarioId, result]));
  const expectedScenarioIds = new Set(suite.scenarios.map(({ id }) => id));
  const unexpectedScenarioIds = report.results
    .map(({ scenarioId }) => scenarioId)
    .filter((scenarioId) => !expectedScenarioIds.has(scenarioId));
  const missingScenarioIds = suite.scenarios
    .map(({ id }) => id)
    .filter((scenarioId) => !resultsById.has(scenarioId));
  if (unexpectedScenarioIds.length > 0 || missingScenarioIds.length > 0) {
    reasons.push({
      code: "SCENARIO_RESULTS_INCOMPLETE",
      message: `missing=${missingScenarioIds.join(",") || "none"}; unexpected=${unexpectedScenarioIds.join(",") || "none"}`,
    });
  }

  for (const scenario of suite.scenarios) {
    const result = resultsById.get(scenario.id);
    if (!result) continue;
    const expectedTurnIds = scenario.turns.map(({ id }) => id);
    const observedTurnIds = result.turnObservations.map(({ turnId }) => turnId);
    if (
      expectedTurnIds.length !== observedTurnIds.length
      || expectedTurnIds.some((turnId) => !observedTurnIds.includes(turnId))
    ) {
      reasons.push({
        code: "SCENARIO_TURNS_INCOMPLETE",
        message: `${scenario.id}: expected=${expectedTurnIds.join(",")}; observed=${observedTurnIds.join(",")}`,
      });
    }
  }

  const wouldContinueCount = report.results.filter(({ wouldContinue }) => wouldContinue).length;
  if (wouldContinueCount < REQUIRED_TUTOR_HUMAN_WOULD_CONTINUE_COUNT) {
    reasons.push({
      code: "WOULD_CONTINUE_THRESHOLD_NOT_MET",
      message: `observed=${wouldContinueCount}; required=${REQUIRED_TUTOR_HUMAN_WOULD_CONTINUE_COUNT}`,
    });
  }

  const hardFailureCounts = Object.fromEntries(
    TUTOR_QUALITY_HARD_FAILURE_IDS.map((id) => [id, 0]),
  ) as Record<typeof TUTOR_QUALITY_HARD_FAILURE_IDS[number], number>;
  for (const result of report.results) {
    for (const failure of result.observedHardFailures) hardFailureCounts[failure.id] += 1;
  }
  for (const id of TUTOR_QUALITY_HARD_FAILURE_IDS) {
    if (hardFailureCounts[id] > 0) {
      reasons.push({
        code: `HARD_FAILURE_OBSERVED_${id}`,
        message: `${id} observed=${hardFailureCounts[id]}; required=0`,
      });
    }
  }

  return {
    passed: reasons.length === 0,
    completedScenarioCount: report.results.length - missingScenarioIds.length,
    requiredScenarioCount: TUTOR_HUMAN_SCENARIO_COVERAGE_IDS.length,
    wouldContinueCount,
    requiredWouldContinueCount: REQUIRED_TUTOR_HUMAN_WOULD_CONTINUE_COUNT,
    hardFailureCounts,
    reasons,
  };
}

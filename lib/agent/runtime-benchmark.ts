import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { z } from "zod";

import { LearningEpisodeSchema } from "@/lib/course-packs/contract";

import { REQUIRED_AGENT_HARNESS_CASES } from "./harness";

export const REQUIRED_DESIGN_DISCIPLINES = [
  "visual-communication",
  "brand-design",
  "packaging-design",
  "ui-ux",
  "product-design",
  "spatial-design",
  "fashion-design",
  "jewelry-design",
  "video-design",
  "animation-design",
  "craft-design",
] as const;

const DesignDisciplineSchema = z.enum(REQUIRED_DESIGN_DISCIPLINES);
const BenchmarkTurnSchema = z.object({ message: z.string().trim().min(1).max(2_000) }).strict();

function includesNormalized(haystack: string, needle: string) {
  return haystack.normalize("NFKC").toLowerCase().includes(needle.normalize("NFKC").toLowerCase());
}

const DesignCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  discipline: DesignDisciplineSchema,
  message: z.string().trim().min(1).max(2_000),
  expected: z.object({
    episodes: z.array(LearningEpisodeSchema).min(1).max(3),
    conceptGroups: z.array(z.array(z.string().trim().min(1)).min(1)).min(1).max(5),
    minimumConceptGroups: z.number().int().min(1).max(5).default(2),
    forbiddenTerms: z.array(z.string().trim().min(1)).max(12).default([]),
    maxQuestions: z.number().int().min(0).max(1).default(1),
  }).strict().superRefine((expected, context) => {
    if (expected.minimumConceptGroups > expected.conceptGroups.length) {
      context.addIssue({ code: "custom", path: ["minimumConceptGroups"], message: "minimum exceeds concept groups" });
    }
  }),
}).strict().superRefine((benchmarkCase, context) => {
  benchmarkCase.expected.conceptGroups.forEach((group, index) => {
    if (group.every((term) => includesNormalized(benchmarkCase.message, term))) {
      context.addIssue({
        code: "custom",
        path: ["expected", "conceptGroups", index],
        message: "concept group must include a term not present in the learner prompt",
      });
    }
  });
});

const TaskScenarioSchema = z.object({
  title: z.string().trim().min(1).max(80),
  goalIncludes: z.string().trim().min(1).max(80),
  turns: z.array(BenchmarkTurnSchema).min(2).max(4),
}).strict();

export const AgentRuntimeBenchmarkSuiteSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/),
  description: z.string().trim().min(1).max(500),
  designCases: z.array(DesignCaseSchema).length(REQUIRED_DESIGN_DISCIPLINES.length),
  longSession: z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    goalIncludes: z.string().trim().min(1).max(80),
    minimumBriefFields: z.number().int().min(1).max(8),
    maxQuestionsPerTurn: z.number().int().min(0).max(1),
    turns: z.array(BenchmarkTurnSchema).length(20),
  }).strict(),
  taskIsolation: z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    taskA: TaskScenarioSchema,
    taskB: TaskScenarioSchema,
  }).strict(),
  restartRecovery: z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    goalIncludes: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(2_000),
  }).strict(),
  requiredHarnessCases: z.array(z.enum(REQUIRED_AGENT_HARNESS_CASES)).length(REQUIRED_AGENT_HARNESS_CASES.length),
}).strict().superRefine((suite, context) => {
  const disciplines = suite.designCases.map(({ discipline }) => discipline);
  const caseIds = suite.designCases.map(({ id }) => id);
  if (new Set(disciplines).size !== REQUIRED_DESIGN_DISCIPLINES.length
    || REQUIRED_DESIGN_DISCIPLINES.some((discipline) => !disciplines.includes(discipline))) {
    context.addIssue({ code: "custom", path: ["designCases"], message: "design disciplines are incomplete or duplicated" });
  }
  if (new Set(caseIds).size !== caseIds.length) {
    context.addIssue({ code: "custom", path: ["designCases"], message: "design case ids must be unique" });
  }
  const harnessIds = suite.requiredHarnessCases;
  if (new Set(harnessIds).size !== REQUIRED_AGENT_HARNESS_CASES.length
    || REQUIRED_AGENT_HARNESS_CASES.some((caseId) => !harnessIds.includes(caseId))) {
    context.addIssue({ code: "custom", path: ["requiredHarnessCases"], message: "harness cases are incomplete or duplicated" });
  }
});

export const RuntimeBenchmarkCaseResultSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(["DESIGN", "LONG_SESSION", "TASK_ISOLATION", "RESTART_RECOVERY", "FAULT_INJECTION"]),
  passed: z.boolean(),
  failures: z.array(z.string().trim().min(1).max(240)).max(30),
  latencyMs: z.number().int().nonnegative().max(1_800_000),
  observed: z.record(z.string(), z.json()),
}).strict().superRefine((result, context) => {
  if (result.passed !== (result.failures.length === 0)) {
    context.addIssue({ code: "custom", path: ["passed"], message: "passed must match failures" });
  }
  if (result.id.startsWith("harness:") !== (result.kind === "FAULT_INJECTION")) {
    context.addIssue({ code: "custom", path: ["kind"], message: "harness ids must be fault injection results" });
  }
});

const BenchmarkScorecardSchema = z.object({
  designCoverage: z.number().min(0).max(1),
  longSessionContinuity: z.number().min(0).max(1),
  taskIsolation: z.number().min(0).max(1),
  restartRecovery: z.number().min(0).max(1),
  faultContainment: z.number().min(0).max(1),
  actionSafety: z.number().min(0).max(1),
}).strict();

export const AgentRuntimeBenchmarkReportSchema = z.object({
  schemaVersion: z.literal(1),
  suiteVersion: z.string(),
  suiteHash: z.string().regex(/^[a-f0-9]{64}$/),
  runtimeId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  comparisonMode: z.enum(["REAL_MODEL_BASELINE", "DEVELOPMENT_CHECK", "FIXTURE_VALIDATION"]),
  model: z.object({ provider: z.enum(["OPENAI_COMPATIBLE", "TEST"]), id: z.string().min(1).max(120) }).strict(),
  workingTreeClean: z.boolean(),
  evaluatedAt: z.string().datetime(),
  caseCount: z.number().int().positive(),
  passedCaseCount: z.number().int().nonnegative(),
  passed: z.boolean(),
  releaseComparable: z.boolean(),
  averageLatencyMs: z.number().int().nonnegative(),
  scorecard: BenchmarkScorecardSchema,
  results: z.array(RuntimeBenchmarkCaseResultSchema),
}).strict().superRefine((report, context) => {
  const passedCaseCount = report.results.filter(({ passed }) => passed).length;
  const expectedComparable = report.comparisonMode === "REAL_MODEL_BASELINE"
    && report.workingTreeClean
    && report.model.provider === "OPENAI_COMPATIBLE";
  const expectedProvider = report.comparisonMode === "FIXTURE_VALIDATION" ? "TEST" : "OPENAI_COMPATIBLE";
  const byKind = (kind: (typeof report.results)[number]["kind"]) => report.results.filter((result) => result.kind === kind);
  const actionSafety = report.results.filter(({ id }) => [
    "harness:formal-authority-blocked",
    "harness:cross-student-action-rejected",
    "harness:action-idempotency-replay",
    "harness:write-effect-requires-confirmation",
  ].includes(id));
  const rate = (results: typeof report.results) => results.length === 0
    ? 0 : results.filter(({ passed }) => passed).length / results.length;
  const expectedScorecard = {
    designCoverage: rate(byKind("DESIGN")),
    longSessionContinuity: rate(byKind("LONG_SESSION")),
    taskIsolation: rate(byKind("TASK_ISOLATION")),
    restartRecovery: rate(byKind("RESTART_RECOVERY")),
    faultContainment: rate(byKind("FAULT_INJECTION")),
    actionSafety: rate(actionSafety),
  };
  const expectedLatency = report.results.length === 0 ? 0 : Math.round(
    report.results.reduce((sum, result) => sum + result.latencyMs, 0) / report.results.length,
  );
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
  if (report.caseCount !== report.results.length) issue(["caseCount"], "case count must match results");
  if (report.passedCaseCount !== passedCaseCount) issue(["passedCaseCount"], "passed count must match results");
  if (report.passed !== (passedCaseCount === report.results.length)) issue(["passed"], "passed must match results");
  if (report.releaseComparable !== expectedComparable) issue(["releaseComparable"], "comparison eligibility is inconsistent");
  if (report.model.provider !== expectedProvider) issue(["model", "provider"], "provider is inconsistent with comparison mode");
  if (report.averageLatencyMs !== expectedLatency) issue(["averageLatencyMs"], "average latency must match results");
  for (const [key, expected] of Object.entries(expectedScorecard)) {
    if (Math.abs(report.scorecard[key as keyof typeof expectedScorecard] - expected) > Number.EPSILON) {
      issue(["scorecard", key], "scorecard must match results");
    }
  }
});

export type AgentRuntimeBenchmarkSuite = z.infer<typeof AgentRuntimeBenchmarkSuiteSchema>;
export type RuntimeBenchmarkCaseResult = z.infer<typeof RuntimeBenchmarkCaseResultSchema>;

export function loadAgentRuntimeBenchmarkSuite(filePath: string) {
  const raw = readFileSync(filePath, "utf8");
  return {
    suite: AgentRuntimeBenchmarkSuiteSchema.parse(JSON.parse(raw)),
    suiteHash: createHash("sha256").update(raw, "utf8").digest("hex"),
  };
}

function passRate(results: RuntimeBenchmarkCaseResult[]) {
  return results.length === 0 ? 0 : results.filter(({ passed }) => passed).length / results.length;
}

export function buildAgentRuntimeBenchmarkReport(input: {
  suite: AgentRuntimeBenchmarkSuite;
  suiteHash: string;
  runtimeId: string;
  commit: string;
  comparisonMode: "REAL_MODEL_BASELINE" | "DEVELOPMENT_CHECK" | "FIXTURE_VALIDATION";
  model: { provider: "OPENAI_COMPATIBLE" | "TEST"; id: string };
  workingTreeClean: boolean;
  results: RuntimeBenchmarkCaseResult[];
  evaluatedAt?: Date;
}) {
  if (input.comparisonMode === "REAL_MODEL_BASELINE" && !input.workingTreeClean) {
    throw new Error("RUNTIME_BENCHMARK_BASELINE_REQUIRES_CLEAN_TREE");
  }
  if (input.comparisonMode === "REAL_MODEL_BASELINE" && input.model.provider !== "OPENAI_COMPATIBLE") {
    throw new Error("RUNTIME_BENCHMARK_BASELINE_REQUIRES_REAL_MODEL");
  }
  const expectedIds = [
    ...input.suite.designCases.map(({ id }) => id),
    input.suite.longSession.id,
    input.suite.taskIsolation.id,
    input.suite.restartRecovery.id,
    ...input.suite.requiredHarnessCases.map((id) => `harness:${id}`),
  ];
  const actualIds = input.results.map(({ id }) => id);
  if (actualIds.length !== expectedIds.length || new Set(actualIds).size !== expectedIds.length
    || expectedIds.some((id) => !actualIds.includes(id))) {
    throw new Error("RUNTIME_BENCHMARK_RESULTS_INCOMPLETE");
  }
  const expectedKinds = new Map<string, RuntimeBenchmarkCaseResult["kind"]>([
    ...input.suite.designCases.map(({ id }) => [id, "DESIGN"] as const),
    [input.suite.longSession.id, "LONG_SESSION"],
    [input.suite.taskIsolation.id, "TASK_ISOLATION"],
    [input.suite.restartRecovery.id, "RESTART_RECOVERY"],
    ...input.suite.requiredHarnessCases.map((id) => [`harness:${id}`, "FAULT_INJECTION"] as const),
  ]);
  if (input.results.some(({ id, kind }) => expectedKinds.get(id) !== kind)) {
    throw new Error("RUNTIME_BENCHMARK_RESULT_KIND_MISMATCH");
  }
  const byKind = (kind: RuntimeBenchmarkCaseResult["kind"]) => input.results.filter((result) => result.kind === kind);
  const actionSafety = input.results.filter(({ id }) => [
    "harness:formal-authority-blocked",
    "harness:cross-student-action-rejected",
    "harness:action-idempotency-replay",
    "harness:write-effect-requires-confirmation",
  ].includes(id));
  const passedCaseCount = input.results.filter(({ passed }) => passed).length;
  return AgentRuntimeBenchmarkReportSchema.parse({
    schemaVersion: 1,
    suiteVersion: input.suite.version,
    suiteHash: input.suiteHash,
    runtimeId: input.runtimeId,
    commit: input.commit,
    comparisonMode: input.comparisonMode,
    model: input.model,
    workingTreeClean: input.workingTreeClean,
    evaluatedAt: (input.evaluatedAt ?? new Date()).toISOString(),
    caseCount: input.results.length,
    passedCaseCount,
    passed: passedCaseCount === input.results.length,
    releaseComparable: input.comparisonMode === "REAL_MODEL_BASELINE",
    averageLatencyMs: Math.round(input.results.reduce((sum, result) => sum + result.latencyMs, 0) / input.results.length),
    scorecard: {
      designCoverage: passRate(byKind("DESIGN")),
      longSessionContinuity: passRate(byKind("LONG_SESSION")),
      taskIsolation: passRate(byKind("TASK_ISOLATION")),
      restartRecovery: passRate(byKind("RESTART_RECOVERY")),
      faultContainment: passRate(byKind("FAULT_INJECTION")),
      actionSafety: passRate(actionSafety),
    },
    results: input.results,
  });
}

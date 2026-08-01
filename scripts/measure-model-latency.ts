import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  MODEL_PROTOCOL_FAILURE_CODES,
  MODEL_TRANSPORT_FAILURE_CODES,
  ModelServiceError,
  type ModelProtocolFailureCode,
  type ModelTransportFailureCode,
} from "@/lib/ai/client";
import {
  AgentEvaluationReportSchema,
  loadAgentEvaluationSuite,
} from "@/lib/agent/evaluation";
import {
  summarizeAgentEvaluationLatencies,
  type EvaluationLatencyDistribution,
} from "@/lib/agent/evaluation-latency-distribution";
import {
  assertEvaluationTextSafe,
  guardModelProviderSecretOutputs,
} from "@/lib/agent/evaluation-safety";
import { createOpenAICompatibleModelProvider } from "@/lib/agent/model-provider-adapter";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import {
  getActiveAgentPolicy,
  resolveAgentPolicyTimeouts,
} from "@/lib/agent/policy-registry";
import { readReleaseSourceBinding } from "@/lib/agent/release-source-binding";
import { readEnv } from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
  writeEffectiveModelConfigNotice,
} from "@/lib/config/runtime-environment";
import { createDb } from "@/lib/db/client";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { seedDemoDatabase } from "@/scripts/seed-demo";

const STUDENT = { userId: "demo-student-e", role: "STUDENT" as const };
const EVALUATION_SUITE_PATH = path.resolve("data/evals/agent-core.json");
const DEFAULT_EVALUATION_REPORT_PATH = path.join(".runtime", "agent-eval", "latest.json");
const SAFE_MODEL_ERROR_CODES = [
  "MODEL_RATE_LIMIT",
  "MODEL_PROVIDER_STATUS",
  "MODEL_TIMEOUT",
  "MODEL_CANCELLED",
  "MODEL_TRANSPORT",
  "MODEL_INVALID_RESPONSE",
  "MODEL_VALIDATION",
] as const;
const SAFE_FATAL_ERROR_CODES = [
  "MODEL_LATENCY_CONFIGURATION_REQUIRED",
  "MODEL_LATENCY_OUTPUT_CONTRACT_FAILED",
  "MODEL_LATENCY_PROBE_CASE_MISSING",
  "MODEL_LATENCY_SENSITIVE_OUTPUT_BLOCKED",
] as const;

type SafeModelErrorCode = (typeof SAFE_MODEL_ERROR_CODES)[number];
type ExecutionStage =
  | "BOOT"
  | "LOAD_ENVIRONMENT"
  | "READ_SOURCE_REPORT_AND_PROBE"
  | "PREPARE_DATABASE"
  | "INGEST_KNOWLEDGE"
  | "CREATE_MODEL_PROVIDER"
  | "RUN_AGENT_TURN"
  | "VALIDATE_OUTPUT"
  | "WRITE_OUTPUT"
  | "CLEANUP"
  | "SELF_TEST";

type EvaluationSummary =
  | { status: "NOT_FOUND" }
  | { status: "INVALID" }
  | {
      status: "AVAILABLE";
      evaluatedAt: string;
      sourceCommit: string;
      sourceTrackedTreeClean: boolean;
      suiteVersion: string;
      caseCount: number;
      passedCaseCount: number;
      passRate: number;
      passed: boolean;
      modelAssistedRate: number;
      metrics: {
        routing: number;
        answerRelevance: number;
        sourcePrecision: number;
        actionSafety: number;
        safety: number;
      };
      latencyMs: EvaluationLatencyDistribution;
    };

type ExpectedEvaluationReport = {
  suiteVersion: string;
  suiteHash: string;
  caseCount: number;
};

type EvaluationReportIntegrity = ExpectedEvaluationReport & {
  resultsLength: number;
  averageLatencyMs: number;
  derivedAverageLatencyMs: number | null;
  passedCaseCount: number;
  derivedPassedCaseCount: number;
};

type ProbeOutput = {
  schemaVersion: 1;
  status: "SUCCEEDED" | "FAILED";
  errorCode: null | "AGENT_LATENCY_DETERMINISTIC_FALLBACK";
  measuredAt: string;
  sourceCommit: string;
  sourceTrackedTreeClean: boolean;
  modelId: string;
  endpointHash: string;
  maxOutputTokens: number;
  probeProfile: "EVALUATION";
  requestMode: "AGENT_STREAMING";
  probeCaseId: string;
  probeSuiteVersion: string;
  probeSuiteHash: string;
  modelIdleTimeoutMs: number;
  modelTotalTimeoutMs: number;
  turnTotalTimeoutMs: number;
  onlineModelIdleTimeoutMs: number;
  onlineModelTotalTimeoutMs: number;
  onlineTurnTotalTimeoutMs: number;
  firstVisibleTextMs: number | null;
  totalMs: number;
  visibleDeltaCount: number;
  visibleCharacterCount: number;
  aiMode: "MODEL_ASSISTED" | "DETERMINISTIC_FALLBACK";
  modelErrorCodes: SafeModelErrorCode[];
  modelTransportErrorCodes: ModelTransportFailureCode[];
  modelProtocolErrorCodes: ModelProtocolFailureCode[];
  evaluation: EvaluationSummary;
};

let executionStage: ExecutionStage = "BOOT";

function roundedElapsed(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function exactKeys(value: object, allowed: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");
  }
}

function assertSafeInteger(value: unknown, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");
  }
}

function assertSafeNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");
  }
}

function assertHash(value: unknown, length: 40 | 64) {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`).test(value)) {
    throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");
  }
}

function assertSafeLabel(value: unknown, maximumLength = 200) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximumLength
    || !/^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/.test(value)
    || value.includes("://")
    || value.includes("..")
    || value.includes("\\")
  ) {
    throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");
  }
}

function assertLatencyDistribution(value: EvaluationLatencyDistribution) {
  exactKeys(value, [
    "percentileMethod",
    "count",
    "minMs",
    "p50Ms",
    "p90Ms",
    "p95Ms",
    "maxMs",
    "averageMs",
    "totalMs",
  ]);
  if (value.percentileMethod !== "NEAREST_RANK") {
    throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");
  }
  assertSafeInteger(value.count);
  assertSafeInteger(value.minMs, true);
  assertSafeInteger(value.p50Ms, true);
  assertSafeInteger(value.p90Ms, true);
  assertSafeInteger(value.p95Ms, true);
  assertSafeInteger(value.maxMs, true);
  assertSafeInteger(value.averageMs, true);
  assertSafeInteger(value.totalMs);
}

function assertEvaluationSummary(value: EvaluationSummary) {
  if (value.status === "NOT_FOUND" || value.status === "INVALID") {
    exactKeys(value, ["status"]);
    return;
  }
  exactKeys(value, [
    "status",
    "evaluatedAt",
    "sourceCommit",
    "sourceTrackedTreeClean",
    "suiteVersion",
    "caseCount",
    "passedCaseCount",
    "passRate",
    "passed",
    "modelAssistedRate",
    "metrics",
    "latencyMs",
  ]);
  if (!Number.isFinite(Date.parse(value.evaluatedAt))) {
    throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");
  }
  assertHash(value.sourceCommit, 40);
  assertSafeLabel(value.suiteVersion, 80);
  assertSafeInteger(value.caseCount);
  assertSafeInteger(value.passedCaseCount);
  assertSafeNumber(value.passRate);
  assertSafeNumber(value.modelAssistedRate);
  exactKeys(value.metrics, [
    "routing",
    "answerRelevance",
    "sourcePrecision",
    "actionSafety",
    "safety",
  ]);
  Object.values(value.metrics).forEach(assertSafeNumber);
  assertLatencyDistribution(value.latencyMs);
}

function evaluationReportMatchesCurrentSuite(
  report: EvaluationReportIntegrity,
  expected: ExpectedEvaluationReport,
) {
  return report.suiteVersion === expected.suiteVersion
    && report.suiteHash === expected.suiteHash
    && report.caseCount === expected.caseCount
    && report.resultsLength === expected.caseCount
    && report.derivedAverageLatencyMs === report.averageLatencyMs
    && report.derivedPassedCaseCount === report.passedCaseCount;
}

function assertProbeOutputContract(value: ProbeOutput, configuredSecret?: string) {
  exactKeys(value, [
    "schemaVersion",
    "status",
    "errorCode",
    "measuredAt",
    "sourceCommit",
    "sourceTrackedTreeClean",
    "modelId",
    "endpointHash",
    "maxOutputTokens",
    "probeProfile",
    "requestMode",
    "probeCaseId",
    "probeSuiteVersion",
    "probeSuiteHash",
    "modelIdleTimeoutMs",
    "modelTotalTimeoutMs",
    "turnTotalTimeoutMs",
    "onlineModelIdleTimeoutMs",
    "onlineModelTotalTimeoutMs",
    "onlineTurnTotalTimeoutMs",
    "firstVisibleTextMs",
    "totalMs",
    "visibleDeltaCount",
    "visibleCharacterCount",
    "aiMode",
    "modelErrorCodes",
    "modelTransportErrorCodes",
    "modelProtocolErrorCodes",
    "evaluation",
  ]);
  if (value.schemaVersion !== 1 || !["SUCCEEDED", "FAILED"].includes(value.status)) {
    throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");
  }
  if (
    (value.status === "SUCCEEDED" && value.errorCode !== null)
    || (value.status === "FAILED" && value.errorCode !== "AGENT_LATENCY_DETERMINISTIC_FALLBACK")
  ) {
    throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");
  }
  if (!Number.isFinite(Date.parse(value.measuredAt))) {
    throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");
  }
  assertHash(value.sourceCommit, 40);
  assertSafeLabel(value.modelId);
  assertHash(value.endpointHash, 64);
  assertSafeLabel(value.probeCaseId, 120);
  assertSafeLabel(value.probeSuiteVersion, 80);
  assertHash(value.probeSuiteHash, 64);
  [
    value.maxOutputTokens,
    value.modelIdleTimeoutMs,
    value.modelTotalTimeoutMs,
    value.turnTotalTimeoutMs,
    value.onlineModelIdleTimeoutMs,
    value.onlineModelTotalTimeoutMs,
    value.onlineTurnTotalTimeoutMs,
    value.totalMs,
    value.visibleDeltaCount,
    value.visibleCharacterCount,
  ].forEach((number) => assertSafeInteger(number));
  assertSafeInteger(value.firstVisibleTextMs, true);
  if (
    value.probeProfile !== "EVALUATION"
    || value.requestMode !== "AGENT_STREAMING"
    || !["MODEL_ASSISTED", "DETERMINISTIC_FALLBACK"].includes(value.aiMode)
    || value.modelErrorCodes.some((code) => !SAFE_MODEL_ERROR_CODES.includes(code))
    || value.modelTransportErrorCodes.some((code) => !MODEL_TRANSPORT_FAILURE_CODES.includes(code))
    || value.modelProtocolErrorCodes.some((code) => !MODEL_PROTOCOL_FAILURE_CODES.includes(code))
  ) {
    throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");
  }
  assertEvaluationSummary(value.evaluation);
  assertEvaluationTextSafe(
    value,
    configuredSecret,
    "MODEL_LATENCY_SENSITIVE_OUTPUT_BLOCKED",
  );
}

async function evaluationSummary(
  environment: Record<string, string | undefined>,
  expected: ExpectedEvaluationReport,
): Promise<EvaluationSummary> {
  const reportPath = path.resolve(
    environment.AGENT_EVAL_REPORT_PATH?.trim() || DEFAULT_EVALUATION_REPORT_PATH,
  );
  if (!existsSync(reportPath)) return { status: "NOT_FOUND" };
  try {
    const report = AgentEvaluationReportSchema.parse(
      JSON.parse(await readFile(reportPath, "utf8")),
    );
    const latencyMs = summarizeAgentEvaluationLatencies(report.results);
    const integrity: EvaluationReportIntegrity = {
      suiteVersion: report.suiteVersion,
      suiteHash: report.suiteHash,
      caseCount: report.caseCount,
      resultsLength: report.results.length,
      averageLatencyMs: report.averageLatencyMs,
      derivedAverageLatencyMs: latencyMs.averageMs,
      passedCaseCount: report.passedCaseCount,
      derivedPassedCaseCount: report.results.filter((result) => result.passed).length,
    };
    if (!evaluationReportMatchesCurrentSuite(integrity, expected)) {
      return { status: "INVALID" };
    }
    return {
      status: "AVAILABLE",
      evaluatedAt: report.evaluatedAt,
      sourceCommit: report.sourceCommit,
      sourceTrackedTreeClean: report.sourceTrackedTreeClean,
      suiteVersion: report.suiteVersion,
      caseCount: report.caseCount,
      passedCaseCount: report.passedCaseCount,
      passRate: report.passedCaseCount / report.caseCount,
      passed: report.passed,
      modelAssistedRate: report.modelAssistedRate,
      metrics: report.metrics,
      latencyMs,
    };
  } catch {
    return { status: "INVALID" };
  }
}

function safeModelErrorCode(error: unknown): SafeModelErrorCode {
  if (error instanceof ModelServiceError) {
    const code = `MODEL_${error.code}` as SafeModelErrorCode;
    if (SAFE_MODEL_ERROR_CODES.includes(code)) return code;
  }
  return "MODEL_VALIDATION";
}

function safeFatalErrorCode(error: unknown) {
  if (error instanceof ModelServiceError) return `MODEL_LATENCY_MODEL_${error.code}`;
  const message = error instanceof Error ? error.message : "";
  return SAFE_FATAL_ERROR_CODES.includes(message as (typeof SAFE_FATAL_ERROR_CODES)[number])
    ? message
    : "MODEL_LATENCY_FAILED";
}

async function main() {
  executionStage = "LOAD_ENVIRONMENT";
  const loadedEnvironment = await loadRuntimeEnvironment({
    mode: "SERVICE_OPTIONAL",
    nodeEnv: "test",
  });
  const environment = loadedEnvironment.environment;
  const config = readEnv(environment);
  writeEffectiveModelConfigNotice(config, loadedEnvironment.provenance);
  if (!config.ai.enabled) throw new Error("MODEL_LATENCY_CONFIGURATION_REQUIRED");

  executionStage = "READ_SOURCE_REPORT_AND_PROBE";
  const source = readReleaseSourceBinding();
  const { suite, suiteHash } = loadAgentEvaluationSuite(EVALUATION_SUITE_PATH);
  const evaluation = await evaluationSummary(environment, {
    suiteVersion: suite.version,
    suiteHash,
    caseCount: suite.cases.length,
  });
  const probeCase = suite.cases[0];
  if (!probeCase) throw new Error("MODEL_LATENCY_PROBE_CASE_MISSING");

  const databasePath = path.resolve(
    ".runtime",
    `model-latency-test-${process.pid}.sqlite`,
  );
  const artworkRoot = path.resolve(
    ".runtime",
    `model-latency-artworks-${process.pid}`,
  );
  let connection: ReturnType<typeof createDb> | null = null;
  let v3EnvironmentChanged = false;
  const previousV3 = process.env.AGENT_V3_ENABLED;
  try {
    executionStage = "PREPARE_DATABASE";
    await mkdir(path.dirname(databasePath), { recursive: true });
    await rm(databasePath, { force: true });
    await rm(artworkRoot, { recursive: true, force: true });
    await seedDemoDatabase({
      databasePath,
      artworkRoot,
      identityCodePepper: config.identityCodePepper,
      allowDemoSeed: true,
      nodeEnv: "test",
    });
    connection = createDb(databasePath);
    Object.assign(process.env, { AGENT_V3_ENABLED: "true" });
    v3EnvironmentChanged = true;

    executionStage = "INGEST_KNOWLEDGE";
    await ingestCoursePackKnowledge(connection);
    const policy = resolveAgentPolicyTimeouts(
      getActiveAgentPolicy(),
      config.agentTimeouts.evaluation,
    );

    executionStage = "CREATE_MODEL_PROVIDER";
    const modelProviderAdapter = guardModelProviderSecretOutputs(
      createOpenAICompatibleModelProvider({
        baseUrl: config.ai.baseUrl!,
        apiKey: config.ai.apiKey!,
        model: config.ai.model!,
        maxOutputTokens: config.ai.maxOutputTokens,
        idleTimeoutMs: policy.budgets.modelIdleTimeoutMs,
        totalTimeoutMs: policy.budgets.modelTimeoutMs,
        vision: config.ai.vision ?? false,
      }),
      config.ai.apiKey!,
    );

    const startedAt = performance.now();
    let firstVisibleTextMs: number | null = null;
    let visibleDeltaCount = 0;
    let visibleCharacterCount = 0;
    const modelErrorCodes: SafeModelErrorCode[] = [];
    const modelTransportErrorCodes: ModelTransportFailureCode[] = [];
    const modelProtocolErrorCodes: ModelProtocolFailureCode[] = [];

    executionStage = "RUN_AGENT_TURN";
    const response = await runAgentTurn(
      connection,
      STUDENT,
      {
        message: probeCase.message,
        context: { view: probeCase.view },
      },
      {
        ai: config.ai,
        modelProviderAdapter,
        policy,
        onTextDelta(delta) {
          visibleDeltaCount += 1;
          visibleCharacterCount += [...delta].length;
          if (firstVisibleTextMs === null && delta.trim()) {
            firstVisibleTextMs = roundedElapsed(startedAt);
          }
        },
        onModelError(error) {
          modelErrorCodes.push(safeModelErrorCode(error));
          if (error instanceof ModelServiceError && error.transportCode) {
            modelTransportErrorCodes.push(error.transportCode);
          }
          if (error instanceof ModelServiceError && error.protocolCode) {
            modelProtocolErrorCodes.push(error.protocolCode);
          }
        },
      },
    );
    const status = response.aiMode === "MODEL_ASSISTED" ? "SUCCEEDED" : "FAILED";
    const result: ProbeOutput = {
      schemaVersion: 1,
      status,
      errorCode: status === "SUCCEEDED"
        ? null
        : "AGENT_LATENCY_DETERMINISTIC_FALLBACK",
      measuredAt: new Date().toISOString(),
      sourceCommit: source.sourceCommit,
      sourceTrackedTreeClean: source.sourceTrackedTreeClean,
      modelId: config.ai.model!,
      endpointHash: createHash("sha256")
        .update(new URL(config.ai.baseUrl!).toString(), "utf8")
        .digest("hex"),
      maxOutputTokens: config.ai.maxOutputTokens,
      probeProfile: "EVALUATION",
      requestMode: "AGENT_STREAMING",
      probeCaseId: probeCase.id,
      probeSuiteVersion: suite.version,
      probeSuiteHash: suiteHash,
      modelIdleTimeoutMs: policy.budgets.modelIdleTimeoutMs,
      modelTotalTimeoutMs: policy.budgets.modelTimeoutMs,
      turnTotalTimeoutMs: policy.budgets.turnTimeoutMs,
      onlineModelIdleTimeoutMs: config.agentTimeouts.online.modelIdleTimeoutMs,
      onlineModelTotalTimeoutMs: config.agentTimeouts.online.modelTotalTimeoutMs,
      onlineTurnTotalTimeoutMs: config.agentTimeouts.online.turnTotalTimeoutMs,
      firstVisibleTextMs,
      totalMs: roundedElapsed(startedAt),
      visibleDeltaCount,
      visibleCharacterCount,
      aiMode: response.aiMode,
      modelErrorCodes: modelErrorCodes.slice(0, 4),
      modelTransportErrorCodes: modelTransportErrorCodes.slice(0, 4),
      modelProtocolErrorCodes: modelProtocolErrorCodes.slice(0, 4),
      evaluation,
    };
    executionStage = "VALIDATE_OUTPUT";
    assertProbeOutputContract(result, config.ai.apiKey);
    executionStage = "WRITE_OUTPUT";
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (status === "FAILED") process.exitCode = 75;
  } finally {
    const stageBeforeCleanup = executionStage;
    executionStage = "CLEANUP";
    if (v3EnvironmentChanged) {
      if (previousV3 === undefined) delete process.env.AGENT_V3_ENABLED;
      else Object.assign(process.env, { AGENT_V3_ENABLED: previousV3 });
    }
    if (connection?.sqlite.open) connection.sqlite.close();
    await Promise.all([
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
    ].map((item) => rm(item, { force: true })));
    await rm(artworkRoot, { recursive: true, force: true });
    executionStage = stageBeforeCleanup;
  }
}

async function selfTest() {
  executionStage = "SELF_TEST";
  const { suite, suiteHash } = loadAgentEvaluationSuite(EVALUATION_SUITE_PATH);
  const probeCase = suite.cases[0];
  if (!probeCase) throw new Error("MODEL_LATENCY_PROBE_CASE_MISSING");
  const fixtureLatencyMs = summarizeAgentEvaluationLatencies(
    Array.from({ length: 37 }, (_, index) => ({ observed: { latencyMs: index + 1 } })),
  );
  const expectedEvaluation = {
    suiteVersion: suite.version,
    suiteHash,
    caseCount: 37,
  };
  const validIntegrity: EvaluationReportIntegrity = {
    ...expectedEvaluation,
    resultsLength: 37,
    averageLatencyMs: fixtureLatencyMs.averageMs!,
    derivedAverageLatencyMs: fixtureLatencyMs.averageMs,
    passedCaseCount: 37,
    derivedPassedCaseCount: 37,
  };
  if (
    !evaluationReportMatchesCurrentSuite(validIntegrity, expectedEvaluation)
    || evaluationReportMatchesCurrentSuite(
      { ...validIntegrity, resultsLength: 36 },
      expectedEvaluation,
    )
    || evaluationReportMatchesCurrentSuite(
      { ...validIntegrity, averageLatencyMs: validIntegrity.averageLatencyMs + 1 },
      expectedEvaluation,
    )
  ) throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");
  const fixture: ProbeOutput = {
    schemaVersion: 1,
    status: "SUCCEEDED",
    errorCode: null,
    measuredAt: "2000-01-01T00:00:00.000Z",
    sourceCommit: "0".repeat(40),
    sourceTrackedTreeClean: true,
    modelId: "self-test-model",
    endpointHash: "1".repeat(64),
    maxOutputTokens: 2048,
    probeProfile: "EVALUATION",
    requestMode: "AGENT_STREAMING",
    probeCaseId: probeCase.id,
    probeSuiteVersion: suite.version,
    probeSuiteHash: suiteHash,
    modelIdleTimeoutMs: 120_000,
    modelTotalTimeoutMs: 600_000,
    turnTotalTimeoutMs: 900_000,
    onlineModelIdleTimeoutMs: 45_000,
    onlineModelTotalTimeoutMs: 120_000,
    onlineTurnTotalTimeoutMs: 180_000,
    firstVisibleTextMs: 1,
    totalMs: 2,
    visibleDeltaCount: 2,
    visibleCharacterCount: 3,
    aiMode: "MODEL_ASSISTED",
    modelErrorCodes: [],
    modelTransportErrorCodes: [],
    modelProtocolErrorCodes: [],
    evaluation: {
      status: "AVAILABLE",
      evaluatedAt: "2000-01-01T00:00:00.000Z",
      sourceCommit: "0".repeat(40),
      sourceTrackedTreeClean: true,
      suiteVersion: suite.version,
      caseCount: 37,
      passedCaseCount: 37,
      passRate: 1,
      passed: true,
      modelAssistedRate: 1,
      metrics: {
        routing: 1,
        answerRelevance: 1,
        sourcePrecision: 1,
        actionSafety: 1,
        safety: 1,
      },
      latencyMs: fixtureLatencyMs,
    },
  };
  assertProbeOutputContract(fixture, "self-test-secret");

  let rejectedExtraField = false;
  try {
    assertProbeOutputContract({ ...fixture, prompt: "forbidden" } as ProbeOutput);
  } catch {
    rejectedExtraField = true;
  }
  if (!rejectedExtraField) throw new Error("MODEL_LATENCY_OUTPUT_CONTRACT_FAILED");

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    status: "SELF_TEST_PASSED",
    probeCaseId: probeCase.id,
    probeSuiteVersion: suite.version,
    probeSuiteHash: suiteHash,
    fixtureCaseCount: fixtureLatencyMs.count,
    fixtureP95Ms: fixtureLatencyMs.p95Ms,
  })}\n`);
}

const execution = process.argv.includes("--self-test") ? selfTest() : main();
execution.catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    status: "FAILED",
    errorCode: safeFatalErrorCode(error),
    executionStage,
  })}\n`);
  process.exitCode = 1;
});

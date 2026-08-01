import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  AgentEvaluationCaseResultSchema,
  buildAgentEvaluationReport,
  DETERMINISTIC_AGENT_EVAL_ENDPOINT_HASH,
  DETERMINISTIC_AGENT_EVAL_MODEL_ID,
  evaluateAgentResponse,
  loadAgentEvaluationSuite,
  type AgentEvaluationCaseResult,
} from "@/lib/agent/evaluation";
import type { AgentTurnResponse } from "@/lib/agent/contracts";
import {
  acquireAgentEvaluationRunLock,
  clearAgentEvaluationProgress,
  agentEvaluationProgressMatches,
  readAgentEvaluationProgress,
  releaseAgentEvaluationRunLock,
  writeAgentEvaluationLatest,
  writeAgentEvaluationProgress,
  type AgentEvaluationProgress,
} from "@/lib/agent/evaluation-progress";
import {
  agentEvaluationServiceInterruption,
  resumableAgentEvaluationInterruption,
  type AgentEvaluationServiceInterruption,
} from "@/lib/agent/evaluation-service-interruption";
import {
  consoleModelErrorDiagnostics,
  createLocalModelErrorDiagnosticLog,
  createModelErrorDiagnostics,
  type ModelErrorDiagnosticsSnapshot,
} from "@/lib/agent/model-error-diagnostics";
import {
  assertEvaluationTextSafe,
  guardModelProviderSecretOutputs,
  safeEvaluationErrorCode,
} from "@/lib/agent/evaluation-safety";
import { ModelServiceError } from "@/lib/ai/client";
import { createOpenAICompatibleModelProvider } from "@/lib/agent/model-provider-adapter";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import {
  getActiveAgentPolicy,
  resolveAgentPolicyTimeouts,
} from "@/lib/agent/policy-registry";
import {
  readReleaseSourceBinding,
  sameReleaseSourceBinding,
} from "@/lib/agent/release-source-binding";
import { CURRENT_AGENT_RUNTIME } from "@/lib/agent/runtime/current-agent-runtime";
import { readEnv } from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
  writeEffectiveModelConfigNotice,
} from "@/lib/config/runtime-environment";
import { createDb } from "@/lib/db/client";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { seedDemoDatabase } from "@/scripts/seed-demo";

const STUDENT = { userId: "demo-student-e", role: "STUDENT" as const };
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const SAFE_AGENT_EVAL_ERROR_CODES = [
  "AGENT_EVAL_NO_RESULT",
  "AGENT_EVAL_PROGRESS_SENSITIVE_TEXT_DETECTED",
  "AGENT_EVAL_REPORT_SENSITIVE_TEXT_DETECTED",
  "AGENT_EVAL_ALREADY_RUNNING",
  "AGENT_EVAL_LOCK_ACQUIRE_FAILED",
  "AGENT_EVAL_PRELUDE_DETERMINISTIC_FALLBACK",
  "AGENT_EVAL_REQUIRES_MODEL_CONFIG",
  "AGENT_EVAL_RESULT_SENSITIVE_TEXT_DETECTED",
  "AGENT_EVAL_SOURCE_CHANGED_DURING_RUN",
] as const;

function failedResult(
  caseId: string,
  latencyMs: number,
  error: unknown,
  modelErrors: readonly string[] = [],
  modelRetryCount = 0,
) {
  const reason = safeEvaluationErrorCode(
    error,
    "AGENT_EVAL_EXECUTION_FAILED",
    SAFE_AGENT_EVAL_ERROR_CODES,
  );
  return AgentEvaluationCaseResultSchema.parse({
    caseId,
    passed: false,
    scores: { routing: 0, answerRelevance: 0, sourcePrecision: 0, actionSafety: 0, safety: 0 },
    failures: [`EXECUTION:${reason.slice(0, 240)}`],
    advisories: [],
    observed: {
      coursePackId: "ERROR",
      specialtyId: "UNSPECIFIED",
      episode: "ERROR",
      aiMode: "DETERMINISTIC_FALLBACK",
      sourceIds: [],
      sourceTitles: [],
      sourceSelectionIds: [],
      sourceSelectionEventCount: 0,
      sourceSelectionStatus: "MISSING",
      actionTypes: [],
      actionStatuses: [],
      successfulToolIds: [],
      confirmedToolIds: [],
      appliedRules: [],
      title: "",
      message: "",
      whyThisStep: "",
      uncertainty: reason.slice(0, 240),
      modelErrors: modelErrors.slice(0, 2),
      modelRetryCount: Math.max(0, Math.min(16, Math.round(modelRetryCount))),
      latencyMs: Math.max(0, Math.round(latencyMs)),
    },
  });
}

async function main() {
  const loadedEnvironment = await loadRuntimeEnvironment({
    mode: "SERVICE_OPTIONAL",
    nodeEnv: "test",
  });
  const environment = loadedEnvironment.environment;
  const config = readEnv(environment);
  writeEffectiveModelConfigNotice(config, loadedEnvironment.provenance);
  const deterministic = process.argv.includes("--deterministic");
  const evaluationPolicy = resolveAgentPolicyTimeouts(
    getActiveAgentPolicy(),
    config.agentTimeouts.evaluation,
  );
  const configuredSecret = deterministic ? undefined : config.ai.apiKey!;
  if (!deterministic && !config.ai.enabled) {
    throw new Error("AGENT_EVAL_REQUIRES_MODEL_CONFIG; use --deterministic only for a non-release baseline");
  }

  const suitePath = path.resolve("data/evals/agent-core.json");
  const { suite, suiteHash } = loadAgentEvaluationSuite(suitePath);
  const runtimeRoot = path.resolve(".runtime/agent-eval");
  await mkdir(runtimeRoot, { recursive: true });
  const databasePath = path.join(runtimeRoot, `agent-eval-demo-${process.pid}.sqlite`);
  const artworkRoot = path.join(runtimeRoot, `agent-eval-artworks-${process.pid}`);
  const reportPath = path.resolve(environment.AGENT_EVAL_REPORT_PATH?.trim() || path.join(runtimeRoot, "latest.json"));
  const progressPath = `${reportPath}.progress.json`;
  const diagnosticLog = createLocalModelErrorDiagnosticLog({
    runner: "agent-eval",
    environment,
    repositoryRoot: process.cwd(),
  });
  const lockPath = `${reportPath}.lock.sqlite`;
  const mode = deterministic ? "DETERMINISTIC_BASELINE" : "MODEL_ASSISTED";
  const inferenceConfig = deterministic ? {
    providerMode: "DETERMINISTIC" as const,
    modelId: DETERMINISTIC_AGENT_EVAL_MODEL_ID,
    endpointHash: DETERMINISTIC_AGENT_EVAL_ENDPOINT_HASH,
    retrievalModelId: null,
    maxOutputTokens: null,
    modelIdleTimeoutMs: null,
    modelTotalTimeoutMs: null,
    turnTotalTimeoutMs: null,
    vision: false,
  } : {
    providerMode: "OPENAI_COMPATIBLE" as const,
    modelId: config.ai.model!,
    endpointHash: createHash("sha256")
      .update(new URL(config.ai.baseUrl!).toString(), "utf8")
      .digest("hex"),
    retrievalModelId: config.ai.embeddingModel ?? null,
    maxOutputTokens: config.ai.maxOutputTokens,
    modelIdleTimeoutMs: config.agentTimeouts.evaluation.modelIdleTimeoutMs,
    modelTotalTimeoutMs: config.agentTimeouts.evaluation.modelTotalTimeoutMs,
    turnTotalTimeoutMs: config.agentTimeouts.evaluation.turnTotalTimeoutMs,
    vision: config.ai.vision ?? false,
  };
  const modelId = inferenceConfig.modelId;
  const runtime = {
    ...CURRENT_AGENT_RUNTIME,
    generation: "V3" as const,
    entrypoint: "runTutorTurn" as const,
    agentV3Enabled: true as const,
  };
  const modelProviderAdapter = deterministic
    ? undefined
    : guardModelProviderSecretOutputs(createOpenAICompatibleModelProvider({
        baseUrl: config.ai.baseUrl!,
        apiKey: config.ai.apiKey!,
        model: modelId,
        maxOutputTokens: config.ai.maxOutputTokens,
        idleTimeoutMs: evaluationPolicy.budgets.modelIdleTimeoutMs,
        totalTimeoutMs: evaluationPolicy.budgets.modelTimeoutMs,
        vision: config.ai.vision ?? false,
      }), config.ai.apiKey!);
  const runLock = await acquireAgentEvaluationRunLock(lockPath);
  try {
  const startSource = readReleaseSourceBinding();
  if (process.argv.includes("--restart")) {
    await clearAgentEvaluationProgress(progressPath);
  }
  let progress = await readAgentEvaluationProgress(progressPath, { configuredSecret });
  const progressMatches = progress
    && agentEvaluationProgressMatches(progress, {
      ...startSource,
      inferenceConfig,
      runtime,
      suiteVersion: suite.version,
      suiteHash,
      mode,
    })
    && progress.results.every((result, index) => result.caseId === suite.cases[index]?.id);
  if (!progressMatches && progress) {
    await clearAgentEvaluationProgress(progressPath);
    progress = null;
  }
  if (progress?.cooldownUntil && Date.parse(progress.cooldownUntil) > Date.now()) {
    process.stdout.write(`${JSON.stringify({
      status: "RATE_LIMITED",
      progressPath,
      nextCaseIndex: progress.nextCaseIndex,
      caseCount: suite.cases.length,
      cooldownUntil: progress.cooldownUntil,
    })}\n`);
    process.exitCode = 75;
    return;
  }
  await rm(databasePath, { force: true });
  await rm(artworkRoot, { recursive: true, force: true });

  await seedDemoDatabase({
    databasePath,
    artworkRoot,
    identityCodePepper: config.identityCodePepper,
    allowDemoSeed: true,
    nodeEnv: "test",
  });
  const connection = createDb(databasePath);
  const previousV3 = process.env.AGENT_V3_ENABLED;
  try {
    Object.assign(process.env, { AGENT_V3_ENABLED: "true" });
    await ingestCoursePackKnowledge(connection);
    const results: AgentEvaluationCaseResult[] = [...(progress?.results ?? [])];
    const startedAt = progress?.startedAt ?? new Date().toISOString();
    if (results.length > 0) {
      process.stdout.write(`[resume] 已恢复 ${results.length}/${suite.cases.length} 个案例\n`);
    }
    const saveProgress = async (status: AgentEvaluationProgress["status"], cooldownUntil: string | null) => {
      assertEvaluationTextSafe(
        results,
        deterministic ? undefined : config.ai.apiKey!,
        "AGENT_EVAL_RESULT_SENSITIVE_TEXT_DETECTED",
      );
      await writeAgentEvaluationProgress(progressPath, {
        schemaVersion: 6,
        ...startSource,
        inferenceConfig,
        runtime,
        suiteVersion: suite.version,
        suiteHash,
        mode,
        status,
        startedAt,
        updatedAt: new Date().toISOString(),
        cooldownUntil,
        nextCaseIndex: results.length,
        results,
      }, { configuredSecret });
    };
    const writeCaseDiagnostics = async (input: {
      caseId: string;
      outcome: "INTERRUPTED" | "RATE_LIMITED" | "DEGRADED_CONTINUED" | "RECOVERED" | "FAILED_CONTINUED";
      errorCode: string | null;
      diagnostics: ModelErrorDiagnosticsSnapshot;
    }) => {
      const write = await diagnosticLog.append({
        recordedAt: new Date().toISOString(),
        runner: "AGENT_EVAL",
        stage: "CASE",
        caseId: input.caseId,
        outcome: input.outcome,
        errorCode: input.errorCode,
        requestMode: "AGENT_STREAMING",
        diagnostics: input.diagnostics,
      }, (text) => assertEvaluationTextSafe(
        text,
        configuredSecret,
        "AGENT_EVAL_DIAGNOSTIC_SENSITIVE_TEXT_DETECTED",
      ));
      return {
        ...consoleModelErrorDiagnostics(input.diagnostics),
        diagnosticLogStatus: write.status,
        ...(write.path ? { diagnosticLogPath: write.path } : {}),
      };
    };
    const stopForServiceInterruption = async (input: {
      failure: AgentEvaluationServiceInterruption;
      caseId: string;
      diagnostics: ModelErrorDiagnosticsSnapshot;
      diagnosticWrite?: Awaited<ReturnType<typeof writeCaseDiagnostics>>;
    }) => {
      await saveProgress("RUNNING", null);
      const diagnosticWrite = input.diagnosticWrite ?? await writeCaseDiagnostics({
        caseId: input.caseId,
        outcome: "INTERRUPTED",
        errorCode: input.failure.code,
        diagnostics: input.diagnostics,
      });
      process.stdout.write(`${JSON.stringify({
        status: "MODEL_UNAVAILABLE",
        progressPath,
        nextCaseIndex: results.length,
        caseId: input.caseId,
        completedCaseCount: results.length,
        caseCount: suite.cases.length,
        errorCode: input.failure.code,
        requestMode: "AGENT_STREAMING",
        ...diagnosticWrite,
      })}\n`);
      process.exitCode = 75;
    };
    for (let index = results.length; index < suite.cases.length; index += 1) {
      const evaluationCase = suite.cases[index];
      const modelErrors: string[] = [];
      const modelInterruptions: AgentEvaluationServiceInterruption[] = [];
      const modelDiagnostics = createModelErrorDiagnostics({
        redactValues: [configuredSecret, config.ai.baseUrl],
      });
      let current: AgentEvaluationCaseResult | null = null;
      connection.sqlite.prepare("DELETE FROM agent_project_briefs WHERE student_id=?").run(STUDENT.userId);
      connection.sqlite.prepare("DELETE FROM agent_session_summaries WHERE student_id=?").run(STUDENT.userId);
      connection.sqlite.prepare("DELETE FROM agent_student_memory WHERE student_id=?").run(STUDENT.userId);
      connection.sqlite.prepare("DELETE FROM agent_conversations WHERE student_id=?").run(STUDENT.userId);
      let rateLimitCooldownMs = 0;
      let pendingRateLimitCooldownMs = 0;
      let resumableInterruption: AgentEvaluationServiceInterruption | null = null;
      const onModelError = (error: unknown, attempt: number) => {
        const code = error instanceof ModelServiceError ? error.code : "VALIDATION";
        const message = safeEvaluationErrorCode(
          error,
          "AGENT_EVAL_MODEL_EXECUTION_FAILED",
          SAFE_AGENT_EVAL_ERROR_CODES,
        );
        modelErrors.push(`attempt-${attempt}:${code}:${message.slice(0, 140)}`);
        if (error instanceof ModelServiceError) modelDiagnostics.record(error);
        const interruption = agentEvaluationServiceInterruption(error);
        if (interruption) modelInterruptions.push(interruption);
        if (error instanceof ModelServiceError && error.code === "RATE_LIMIT") {
          pendingRateLimitCooldownMs = Math.max(
            pendingRateLimitCooldownMs,
            error.retryAfterMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS,
          );
        }
      };
      const consumeResponseInterruption = (
        response: AgentTurnResponse,
      ) => {
        const interruption = resumableAgentEvaluationInterruption({
          response,
          modelInterruptions,
        });
        modelInterruptions.length = 0;
        if (interruption?.code === "RATE_LIMIT") {
          rateLimitCooldownMs = Math.max(
            rateLimitCooldownMs,
            pendingRateLimitCooldownMs || DEFAULT_RATE_LIMIT_COOLDOWN_MS,
          );
          pendingRateLimitCooldownMs = 0;
          return null;
        }
        pendingRateLimitCooldownMs = 0;
        return interruption;
      };
      const runStarted = performance.now();
      const modelOptions = deterministic ? { policy: evaluationPolicy } : {
        ai: config.ai,
        modelProviderAdapter,
        // Keep release evaluation on the same Responses streaming transport as
        // real agent turns. Some compatible relays reset buffered responses.
        onTextDelta: () => undefined,
        allowRetryAfterTextDelta: true,
        onModelError,
        modelRetryContext: { caseId: evaluationCase.id },
        policy: evaluationPolicy,
      };
      try {
        for (const prelude of evaluationCase.prelude) {
          const response = await runAgentTurn(connection, STUDENT, {
            message: prelude.message,
            context: { view: prelude.view },
          }, modelOptions);
          resumableInterruption = consumeResponseInterruption(response);
          if (resumableInterruption || rateLimitCooldownMs > 0) break;
          if (!deterministic && response.aiMode === "DETERMINISTIC_FALLBACK") {
            current = failedResult(
              evaluationCase.id,
              performance.now() - runStarted,
              new Error("AGENT_EVAL_PRELUDE_DETERMINISTIC_FALLBACK"),
              modelErrors,
              response.policy.budgets.modelRetries,
            );
            break;
          }
        }
        if (rateLimitCooldownMs === 0 && !resumableInterruption && !current) {
          const response = await runAgentTurn(connection, STUDENT, {
            message: evaluationCase.message,
            context: { view: evaluationCase.view },
          }, modelOptions);
          resumableInterruption = consumeResponseInterruption(response);
          if (!resumableInterruption && rateLimitCooldownMs === 0) {
            current = evaluateAgentResponse(
              evaluationCase,
              response,
              performance.now() - runStarted,
              modelErrors,
            );
          }
        }
      } catch (error) {
        if (error instanceof ModelServiceError) modelDiagnostics.record(error);
        const interruption = agentEvaluationServiceInterruption(error);
        if (!deterministic && interruption?.code === "RATE_LIMIT") {
          rateLimitCooldownMs = Math.max(
            pendingRateLimitCooldownMs,
            error instanceof ModelServiceError
              ? error.retryAfterMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS
              : DEFAULT_RATE_LIMIT_COOLDOWN_MS,
          );
        } else if (!deterministic && interruption?.resumable) {
          resumableInterruption = interruption;
        } else {
          current = failedResult(
            evaluationCase.id,
            performance.now() - runStarted,
            error,
            modelErrors,
          );
        }
      }
      if (!deterministic && rateLimitCooldownMs > 0) {
        const diagnostics = modelDiagnostics.snapshot();
        const diagnosticWrite = await writeCaseDiagnostics({
          caseId: evaluationCase.id,
          outcome: "RATE_LIMITED",
          errorCode: "RATE_LIMIT",
          diagnostics,
        });
        const cooldownUntil = new Date(Date.now() + rateLimitCooldownMs).toISOString();
        await saveProgress("RATE_LIMITED", cooldownUntil);
        process.stdout.write(`${JSON.stringify({
          status: "RATE_LIMITED",
          progressPath,
          nextCaseIndex: index,
          caseId: evaluationCase.id,
          completedCaseCount: results.length,
          caseCount: suite.cases.length,
          cooldownUntil,
          requestMode: "AGENT_STREAMING",
          ...diagnosticWrite,
        })}\n`);
        process.exitCode = 75;
        return;
      }
      if (!deterministic && resumableInterruption) {
        const diagnostics = modelDiagnostics.snapshot();
        const diagnosticWrite = await writeCaseDiagnostics({
          caseId: evaluationCase.id,
          outcome: "INTERRUPTED",
          errorCode: resumableInterruption.code,
          diagnostics,
        });
        await stopForServiceInterruption({
          failure: resumableInterruption,
          caseId: evaluationCase.id,
          diagnostics,
          diagnosticWrite,
        });
        return;
      }
      current ??= failedResult(
        evaluationCase.id,
        0,
        new Error("AGENT_EVAL_NO_RESULT"),
        modelErrors,
      );
      const diagnostics = modelDiagnostics.snapshot();
      if (!deterministic && diagnostics.errorCount > 0) {
        await writeCaseDiagnostics({
          caseId: evaluationCase.id,
          outcome: current.observed.aiMode === "DETERMINISTIC_FALLBACK"
            ? "DEGRADED_CONTINUED"
            : "RECOVERED",
          errorCode: current.observed.modelErrors.at(-1)?.split(":")[1] ?? null,
          diagnostics,
        });
      }
      results.push(current);
      await saveProgress("RUNNING", null);
      process.stdout.write(`[${index + 1}/${suite.cases.length}] ${evaluationCase.id}: ${current.passed ? "PASS" : `FAIL ${current.failures.join(";")}`}\n`);
    }

    const endSource = readReleaseSourceBinding();
    if (!sameReleaseSourceBinding(startSource, endSource)) {
      throw new Error("AGENT_EVAL_SOURCE_CHANGED_DURING_RUN");
    }
    const report = buildAgentEvaluationReport({
      source: startSource,
      inferenceConfig,
      runtime,
      suiteVersion: suite.version,
      suiteHash,
      mode,
      results,
    });
    const reportJson = `${JSON.stringify(report, null, 2)}\n`;
    assertEvaluationTextSafe(
      reportJson,
      deterministic ? undefined : config.ai.apiKey!,
      "AGENT_EVAL_REPORT_SENSITIVE_TEXT_DETECTED",
    );
    await writeAgentEvaluationLatest(reportPath, reportJson);
    await clearAgentEvaluationProgress(progressPath);
    process.stdout.write(`${JSON.stringify({
      passed: report.passed,
      reportPath,
      caseCount: report.caseCount,
      passedCaseCount: report.passedCaseCount,
      metrics: report.metrics,
      modelAssistedRate: report.modelAssistedRate,
      averageLatencyMs: report.averageLatencyMs,
    })}\n`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    if (previousV3 === undefined) delete process.env.AGENT_V3_ENABLED;
    else Object.assign(process.env, { AGENT_V3_ENABLED: previousV3 });
    connection.sqlite.close();
    if (!process.argv.includes("--keep-db")) {
      await Promise.all([databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map((item) => rm(item, { force: true })));
      await rm(artworkRoot, { recursive: true, force: true });
    }
  }
  } finally {
    await releaseAgentEvaluationRunLock(runLock);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${safeEvaluationErrorCode(
    error,
    "AGENT_EVAL_EXECUTION_FAILED",
    SAFE_AGENT_EVAL_ERROR_CODES,
  )}\n`);
  process.exitCode = 1;
});

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import {
  guardModelProviderSecretOutputs,
} from "@/lib/agent/evaluation-safety";
import {
  createOpenAICompatibleModelProvider,
  type ModelProviderAdapter,
} from "@/lib/agent/model-provider-adapter";
import { isGpt56ModelId } from "@/lib/ai/model-id";
import {
  readEnv,
  resolvePlannerModelConfiguration,
} from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
} from "@/lib/config/runtime-environment";
import {
  QUERY_UNDERSTANDING_PLANNER_VERSION_V2,
  createQueryUnderstandingPlannerV1,
} from "@/lib/knowledge/query-understanding-planner-v1";
import {
  PLANNER_REPAIR_PROBE_CASES_V1,
  buildPlannerRepairProbeRequestV1,
} from "@/scripts/probe-query-understanding-planner-v1";
import {
  auditT44AnswerObligationBindingsV1,
} from "@/tools/mixed-retrieval/t44-obligation-coverage-evaluator";

export const PLANNER_LATENCY_DIAGNOSTIC_RUN_ID_V1 =
  "luna-natural-v1" as const;
export const PLANNER_LATENCY_DIAGNOSTIC_RUN_ID_V2 =
  "luna-anchor-catalog-v2" as const;
const ACTIVE_PLANNER_LATENCY_DIAGNOSTIC_RUN_ID =
  PLANNER_LATENCY_DIAGNOSTIC_RUN_ID_V2;
export const PLANNER_LATENCY_DIAGNOSTIC_TIMEOUT_MS_V1 =
  120_000;
const PLANNER_LATENCY_DIAGNOSTIC_IDLE_TIMEOUT_MS_V1 =
  PLANNER_LATENCY_DIAGNOSTIC_TIMEOUT_MS_V1 - 1;

export type PlannerLatencyCallV1 = {
  caseId: string;
  callIndex: number;
  outcome: "RESOLVED" | "REJECTED";
  elapsedMs: number;
};

export type PlannerLatencyCaseV1 = {
  caseId: string;
  coursePackId: string;
  questionHash: string;
  status: "READY" | "CLARIFY" | "DEGRADED";
  firstAttempt:
    | "VALID"
    | "INVALID"
    | "PROVIDER_ERROR"
    | "TIMEOUT"
    | "CANCELLED"
    | "NOT_USED";
  repairAttempt:
    | "VALID"
    | "INVALID"
    | "PROVIDER_ERROR"
    | "TIMEOUT"
    | "CANCELLED"
    | "NOT_USED";
  callCount: number;
  failureCategory: string | null;
  elapsedMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  bindingAudit: {
    sourceAnchor: number;
    entity: number;
    constraint: number;
  };
};

function nearestRank(
  values: readonly number[],
  percentile: number,
) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) =>
    left - right);
  return sorted[
    Math.max(0, Math.ceil(percentile * sorted.length) - 1)
  ] ?? null;
}

function average(values: readonly number[]) {
  if (values.length === 0) return null;
  return Math.round(
    values.reduce((sum, value) => sum + value, 0)
      / values.length,
  );
}

export function summarizePlannerLatencyDiagnosticV1(input: {
  cases: readonly PlannerLatencyCaseV1[];
  calls: readonly PlannerLatencyCallV1[];
}) {
  const completedCases = input.cases.filter(
    ({ status }) => status !== "DEGRADED",
  );
  const resolvedCalls = input.calls.filter(
    ({ outcome }) => outcome === "RESOLVED",
  );
  const caseElapsed = input.cases.map(
    ({ elapsedMs }) => elapsedMs,
  );
  const completedCaseElapsed = completedCases.map(
    ({ elapsedMs }) => elapsedMs,
  );
  const resolvedCallElapsed = resolvedCalls.map(
    ({ elapsedMs }) => elapsedMs,
  );
  return {
    sampleSize: input.cases.length,
    completedCaseCount: completedCases.length,
    degradedCaseCount:
      input.cases.length - completedCases.length,
    caseAverageMs: average(caseElapsed),
    completedCaseAverageMs:
      average(completedCaseElapsed),
    caseP50Ms: nearestRank(caseElapsed, 0.5),
    caseP95Ms: nearestRank(caseElapsed, 0.95),
    providerCallCount: input.calls.length,
    resolvedProviderCallCount: resolvedCalls.length,
    rejectedProviderCallCount:
      input.calls.length - resolvedCalls.length,
    resolvedProviderCallAverageMs:
      average(resolvedCallElapsed),
    resolvedProviderCallP50Ms:
      nearestRank(resolvedCallElapsed, 0.5),
    resolvedProviderCallP95Ms:
      nearestRank(resolvedCallElapsed, 0.95),
  };
}

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export async function runPlannerLatencyDiagnosticV1(
  workspaceRoot = process.cwd(),
) {
  const artifactPath = path.resolve(
    workspaceRoot,
    ".runtime/mixed-retrieval",
    `planner-latency-diagnostic-${ACTIVE_PLANNER_LATENCY_DIAGNOSTIC_RUN_ID}.json`,
  );
  try {
    await readFile(artifactPath);
    throw new Error(
      `PLANNER_LATENCY_DIAGNOSTIC_ARTIFACT_ALREADY_EXISTS:${artifactPath}`,
    );
  } catch (error) {
    if (
      !(error instanceof Error)
      || !("code" in error)
      || error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const loadedEnvironment =
    await loadRuntimeEnvironment({
      cwd: workspaceRoot,
      mode: "SERVICE_REQUIRED",
      nodeEnv: "test",
    });
  const config = readEnv(
    loadedEnvironment.environment,
  );
  const plannerConfig =
    resolvePlannerModelConfiguration(config.ai);
  if (
    !plannerConfig.enabled
    || !isGpt56ModelId(plannerConfig.model)
  ) {
    throw new Error(
      "PLANNER_LATENCY_DIAGNOSTIC_MODEL_REQUIRED",
    );
  }
  if (
    loadedEnvironment.provenance.model.source
      !== "service-env"
  ) {
    throw new Error(
      "PLANNER_LATENCY_DIAGNOSTIC_SERVICE_PROVENANCE_REQUIRED",
    );
  }

  const baseProvider = guardModelProviderSecretOutputs(
    createOpenAICompatibleModelProvider({
      baseUrl: plannerConfig.baseUrl,
      apiKey: plannerConfig.apiKey,
      model: plannerConfig.model,
      maxOutputTokens: plannerConfig.maxOutputTokens,
      idleTimeoutMs:
        PLANNER_LATENCY_DIAGNOSTIC_IDLE_TIMEOUT_MS_V1,
      totalTimeoutMs:
        PLANNER_LATENCY_DIAGNOSTIC_TIMEOUT_MS_V1,
      vision: plannerConfig.vision,
    }),
    plannerConfig.apiKey,
  );
  const calls: PlannerLatencyCallV1[] = [];
  let activeCaseId = "unassigned";
  let activeCallIndex = 0;
  const timedProvider: ModelProviderAdapter = {
    ...baseProvider,
    async complete(messages, options) {
      const caseId = activeCaseId;
      const callIndex = activeCallIndex + 1;
      activeCallIndex = callIndex;
      const startedAt = performance.now();
      try {
        const result = await baseProvider.complete(
          messages,
          options,
        );
        calls.push({
          caseId,
          callIndex,
          outcome: "RESOLVED",
          elapsedMs: Math.round(
            performance.now() - startedAt,
          ),
        });
        return result;
      } catch (error) {
        calls.push({
          caseId,
          callIndex,
          outcome: "REJECTED",
          elapsedMs: Math.round(
            performance.now() - startedAt,
          ),
        });
        throw error;
      }
    },
  };
  const planner = createQueryUnderstandingPlannerV1({
    model: timedProvider,
    plannerVersion:
      QUERY_UNDERSTANDING_PLANNER_VERSION_V2,
    totalTimeoutMs:
      PLANNER_LATENCY_DIAGNOSTIC_TIMEOUT_MS_V1,
  });
  const cases: PlannerLatencyCaseV1[] = [];
  for (const definition of PLANNER_REPAIR_PROBE_CASES_V1) {
    activeCaseId = definition.caseId;
    activeCallIndex = 0;
    const request =
      buildPlannerRepairProbeRequestV1(definition);
    const result = await planner.plan(request);
    const projected: PlannerLatencyCaseV1 = {
      caseId: definition.caseId,
      coursePackId: definition.coursePackId,
      questionHash:
        request.currentMessage.messageHash,
      status: result.obligationSet.status,
      firstAttempt: result.audit.firstAttempt,
      repairAttempt: result.audit.repairAttempt,
      callCount: result.audit.callCount,
      failureCategory:
        result.audit.failureCategory,
      elapsedMs: result.publicTrace.elapsedMs,
      usage: result.publicTrace.usage,
      bindingAudit:
        auditT44AnswerObligationBindingsV1({
          request,
          prediction: result.obligationSet,
        }),
    };
    cases.push(projected);
    process.stderr.write(`${JSON.stringify({
      event: "planner-latency-diagnostic-case",
      caseId: projected.caseId,
      status: projected.status,
      firstAttempt: projected.firstAttempt,
      repairAttempt: projected.repairAttempt,
      elapsedMs: projected.elapsedMs,
      callCount: projected.callCount,
    })}\n`);
  }
  const summary =
    summarizePlannerLatencyDiagnosticV1({
      cases,
      calls,
    });
  const report = {
    schemaVersion: 1,
    kind: "LUMI_PLANNER_LATENCY_DIAGNOSTIC",
    runId: ACTIVE_PLANNER_LATENCY_DIAGNOSTIC_RUN_ID,
    timeoutPolicy: {
      interpretation:
        "Natural-latency observation with the maximum planner safety cap; not a production SLO or GO decision.",
      safetyCapMs:
        PLANNER_LATENCY_DIAGNOSTIC_TIMEOUT_MS_V1,
    },
    model: {
      environmentMode: "SERVICE_REQUIRED",
      source: "service-env",
      providerSelection: plannerConfig.selection,
      modelId: plannerConfig.model,
      endpointHash: sha256(
        new URL(plannerConfig.baseUrl).toString(),
      ),
    },
    summary,
    cases,
    calls,
    operations: {
      database: "NOT_USED",
      qrels: "NOT_READ",
      graphify: "NOT_USED",
      web: "NOT_USED",
      deployment: "NOT_PERFORMED",
    },
    generatedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(artifactPath), {
    recursive: true,
  });
  const content = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(artifactPath, content, {
    encoding: "utf8",
    flag: "wx",
  });
  const observed = await readFile(artifactPath, "utf8");
  if (observed !== content) {
    throw new Error(
      "PLANNER_LATENCY_DIAGNOSTIC_ARTIFACT_BYTE_DRIFT",
    );
  }
  return {
    report,
    artifact: {
      path: artifactPath,
      bytes: Buffer.byteLength(observed, "utf8"),
      sha256: sha256(observed),
    },
  };
}

async function main() {
  const result = await runPlannerLatencyDiagnosticV1();
  process.stdout.write(`${JSON.stringify({
    artifact: result.artifact,
    summary: result.report.summary,
    cases: result.report.cases,
    calls: result.report.calls,
  }, null, 2)}\n`);
}

const entryPoint = process.argv[1];
if (
  entryPoint
  && import.meta.url
    === pathToFileURL(path.resolve(entryPoint)).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error
        ? error.stack ?? error.message
        : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  guardModelProviderSecretOutputs,
} from "@/lib/agent/evaluation-safety";
import {
  createOpenAICompatibleModelProvider,
  type ModelProviderAdapter,
} from "@/lib/agent/model-provider-adapter";
import {
  CURRENT_RAG_AGENT_HARNESS_VERSION,
  RagAgentHarnessCaseResultSchema,
  buildRagAgentHarnessReport,
} from "@/lib/agent/rag-harness";
import {
  parseRagAgentHarnessArgs,
  ragAgentHarnessRunPaths,
  resolveAuthorizedRagHarnessModelId,
} from "@/lib/agent/rag-harness-cli";
import {
  guardRagHarnessRealModelOutbound,
  runDeterministicRagAgentHarness,
} from "@/lib/agent/rag-harness-runner";
import {
  readReleaseSourceBinding,
  sameReleaseSourceBinding,
} from "@/lib/agent/release-source-binding";
import {
  CURRENT_AGENT_RUNTIME,
} from "@/lib/agent/runtime/current-agent-runtime";
import {
  readEnv,
  resolvePlannerModelConfiguration,
} from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
} from "@/lib/config/runtime-environment";

const CheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  harnessVersion: z.literal(
    CURRENT_RAG_AGENT_HARNESS_VERSION,
  ),
  mode: z.enum([
    "deterministic",
    "real-model",
  ]),
  caseResult:
    RagAgentHarnessCaseResultSchema,
}).strict();

async function readResumeCheckpoints(
  checkpointDirectory: string,
  mode: "deterministic" | "real-model",
) {
  const entries = await readdir(
    checkpointDirectory,
    { withFileTypes: true },
  );
  const results = [];
  for (
    const entry of entries
      .filter((candidate) =>
        candidate.isFile()
        && candidate.name.endsWith(".json"))
      .sort((left, right) =>
        left.name.localeCompare(right.name))
  ) {
    const checkpoint = CheckpointSchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            checkpointDirectory,
            entry.name,
          ),
          "utf8",
        ),
      ),
    );
    if (checkpoint.mode !== mode) {
      throw new Error(
        "RAG_AGENT_HARNESS_RESUME_MODE_DRIFT",
      );
    }
    results.push(checkpoint.caseResult);
  }
  return results;
}

async function realModelProvider() {
  const loaded = await loadRuntimeEnvironment({
    cwd: process.cwd(),
    mode: "SERVICE_REQUIRED",
    nodeEnv: "test",
  });
  if (
    loaded.provenance.model.source
      !== "service-env"
  ) {
    throw new Error(
      "RAG_AGENT_HARNESS_SERVICE_MODEL_REQUIRED",
    );
  }
  const config = readEnv(loaded.environment);
  const selected =
    resolvePlannerModelConfiguration(config.ai);
  if (
    !selected.enabled
    || selected.selection
      !== "planner-override"
  ) {
    throw new Error(
      "RAG_AGENT_HARNESS_PLANNER_OVERRIDE_REQUIRED",
    );
  }
  const modelId =
    resolveAuthorizedRagHarnessModelId(
      selected.model,
    );
  const upstream =
    createOpenAICompatibleModelProvider({
      baseUrl: selected.baseUrl,
      apiKey: selected.apiKey,
      model: modelId,
      maxOutputTokens:
        selected.maxOutputTokens,
      idleTimeoutMs:
        config.agentTimeouts.evaluation
          .modelIdleTimeoutMs,
      totalTimeoutMs:
        config.agentTimeouts.evaluation
          .modelTotalTimeoutMs,
      vision: false,
    });
  const provider =
    guardRagHarnessRealModelOutbound(
      guardModelProviderSecretOutputs(
        upstream,
        selected.apiKey,
      ),
      {
        configuredSecrets: [
          selected.apiKey,
          config.ai.apiKey ?? "",
        ],
      },
    );
  return {
    provider,
    modelId,
    configurationSource:
      loaded.provenance.model.source,
    selection: selected.selection,
  };
}

async function main() {
  const args = parseRagAgentHarnessArgs(
    process.argv.slice(2),
  );
  let modelProvider:
    ModelProviderAdapter | undefined;
  let answerModelId =
    "rag-harness-deterministic";
  let modelConfigurationSource =
    "deterministic";
  let modelSelection = "fixture";
  if (args.mode === "real-model") {
    const realModel = await realModelProvider();
    modelProvider = realModel.provider;
    answerModelId = realModel.modelId;
    modelConfigurationSource =
      realModel.configurationSource;
    modelSelection = realModel.selection;
    process.stderr.write(`${JSON.stringify({
      event:
        "rag-agent-harness-real-model-config",
      modelId: answerModelId,
      configurationSource:
        modelConfigurationSource,
      selection: modelSelection,
      vision: false,
    })}\n`);
  }
  const runtimeRoot = path.resolve(
    ".runtime/rag-agent-harness",
  );
  const paths = ragAgentHarnessRunPaths({
    runtimeRoot,
    runId: args.runId,
  });
  const latestPath = path.join(
    runtimeRoot,
    "latest.json",
  );
  const suitePath = path.resolve(
    "tests/rag-agent-harness/suite.v1.json",
  );
  const qrelsPath = path.resolve(
    "tests/rag-agent-harness/qrels.v1.json",
  );
  if (!args.resume) {
    await rm(paths.runDirectory, {
      recursive: true,
      force: true,
    });
  }
  await mkdir(paths.checkpointDirectory, {
    recursive: true,
  });
  const completedResults = args.resume
    ? await readResumeCheckpoints(
        paths.checkpointDirectory,
        args.mode,
      )
    : [];
  if (args.resume && completedResults.length === 0) {
    throw new Error(
      "RAG_AGENT_HARNESS_RESUME_CHECKPOINTS_MISSING",
    );
  }
  await Promise.all([
    paths.databasePath,
    `${paths.databasePath}-wal`,
    `${paths.databasePath}-shm`,
  ].map((databasePath) =>
    rm(databasePath, { force: true })));
  const startSource = readReleaseSourceBinding();
  const result =
    await runDeterministicRagAgentHarness({
      databasePath: paths.databasePath,
      suitePath,
      qrelsPath,
      completedResults,
      mode: args.mode,
      ...(modelProvider
        ? { modelProvider }
        : {}),
      onCaseCompleted: async (caseResult) => {
        const checkpointPath = path.join(
          paths.checkpointDirectory,
          `${caseResult.caseId}.json`,
        );
        await writeFile(
          checkpointPath,
          `${JSON.stringify(
            {
              schemaVersion: 1,
              harnessVersion:
                CURRENT_RAG_AGENT_HARNESS_VERSION,
              mode: args.mode,
              caseResult,
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
      },
    });
  const endSource = readReleaseSourceBinding();
  if (
    !sameReleaseSourceBinding(
      startSource,
      endSource,
    )
  ) {
    throw new Error(
      "RAG_AGENT_HARNESS_SOURCE_CHANGED_DURING_RUN",
    );
  }
  const report = buildRagAgentHarnessReport({
    results: result.results,
    source: startSource,
    runtime: {
      ...CURRENT_AGENT_RUNTIME,
      generation: "V3",
      entrypoint: "runTutorTurn",
      agentV3Enabled: true,
    },
    mode: args.mode,
    identity: {
      suiteHash: result.suiteHash,
      corpusBundleHash:
        result.corpusBundleHash,
      activeIndexBundleHash:
        result.activeIndexBundleHash,
      textProvider: {
        providerId: "deterministic",
        modelId: "bge-fixture",
        revision: result.suiteHash,
      },
      visualProvider: {
        providerId: "deterministic",
        modelId: "siglip-fixture",
        revision: result.suiteHash,
      },
      answerModelId:
        answerModelId,
      plannerModelId: "not-wired-runtime",
      knowledgeObjectV2Enabled: true,
    },
  });
  await writeFile(
    paths.reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await mkdir(path.dirname(latestPath), {
    recursive: true,
  });
  await copyFile(paths.reportPath, latestPath);
  if (!args.keepDb) {
    await Promise.all([
      paths.databasePath,
      `${paths.databasePath}-wal`,
      `${paths.databasePath}-shm`,
    ].map((databasePath) =>
      rm(databasePath, { force: true })));
  }
  process.stdout.write(`${JSON.stringify({
    runId: args.runId,
    mode: args.mode,
    passed: report.passed,
    caseCount: report.caseCount,
    passedCaseCount: report.passedCaseCount,
    hardFailureCount: report.hardFailureCount,
    reportPath: latestPath,
    runReportPath: paths.reportPath,
    suiteHash: report.identity.suiteHash,
    failures: report.results.flatMap(
      ({ caseId, failures }) =>
        failures.map((failure) =>
          `${caseId}:${failure}`),
    ),
  })}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error
      ? error.message
      : String(error)}\n`,
  );
  process.exitCode = 1;
});

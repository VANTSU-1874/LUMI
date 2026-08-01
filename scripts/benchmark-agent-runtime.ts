import { execFileSync } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { AgentEvalHarness } from "@/lib/agent/agent-eval-harness";
import { createOpenAICompatibleModelProvider } from "@/lib/agent/model-provider-adapter";
import {
  getActiveAgentPolicy,
  resolveAgentPolicyTimeouts,
} from "@/lib/agent/policy-registry";
import { createRuntimeBenchmarkFixtureAdapter } from "@/lib/agent/runtime-benchmark-adapter";
import { currentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { FreshProcessRecoveryResultSchema } from "@/lib/agent/runtime-benchmark-restart";
import {
  buildAgentRuntimeBenchmarkReport,
  loadAgentRuntimeBenchmarkSuite,
  type RuntimeBenchmarkCaseResult,
} from "@/lib/agent/runtime-benchmark";
import {
  harnessBenchmarkResults,
  runDesignBenchmarkCases,
  runLongSessionProbe,
  runRestartRecoveryProbe,
  runTaskIsolationProbe,
} from "@/lib/agent/runtime-benchmark-probes";
import { readEnv } from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
  writeEffectiveModelConfigNotice,
} from "@/lib/config/runtime-environment";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { saveBookLayoutDraft } from "@/lib/services/book-layout";
import { seedDemoDatabase } from "@/scripts/seed-demo";

const STUDENT = { userId: "demo-student-e", role: "STUDENT" as const };

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
}

function workingTreeStatus() {
  return execFileSync("git", ["status", "--porcelain"], { cwd: process.cwd(), encoding: "utf8" });
}

function minimalChildEnvironment() {
  const allowed = ["SystemRoot", "WINDIR", "TEMP", "TMP"] as const;
  return Object.fromEntries([
    ...allowed.flatMap((name) => process.env[name] ? [[name, process.env[name]!]] : []),
    ["NODE_ENV", "test"],
  ]);
}

function inspectRestartInFreshProcess(databasePath: string, expectation: {
  taskId: string;
  conversationId: string;
  goalIncludes: string;
}) {
  const stdout = execFileSync(process.execPath, [
    path.resolve("node_modules/tsx/dist/cli.mjs"),
    path.resolve("scripts/check-agent-runtime-restart.ts"),
    databasePath,
    STUDENT.userId,
    expectation.taskId,
    expectation.conversationId,
    expectation.goalIncludes,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: minimalChildEnvironment(),
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const output = stdout.trim().split(/\r?\n/).at(-1);
  return FreshProcessRecoveryResultSchema.parse(JSON.parse(output || "{}"));
}

function prepareHarnessData(databasePath: string) {
  const connection = createDb(databasePath);
  try {
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('harness-class','Agent Harness','HARNESS');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('harness-student','harness-class','STUDENT','Harness Student',1700000000),
        ('harness-other-student','harness-class','STUDENT','Harness Other Student',1700000000);
    `);
    saveBookLayoutDraft(connection, { userId: "harness-student", role: "STUDENT" }, {
      audience: "COMMUNITY_RESIDENTS",
      pageOrder: ["cover", "activity-map", "quick-start", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
      diagnosticAnswers: ["AUDIENCE_FIRST", "TASK_FIRST", "AUDIENCE_FIRST"],
      transferChoices: ["COMMUNITY_ENTRY_FIRST", "VOLUNTEER_CALL_TO_ACTION", "RETAIN_ACTIVITY_CORE"],
    });
  } finally {
    connection.sqlite.close();
  }
}

async function seedBenchmarkDatabase(databasePath: string, artworkRoot: string, identityCodePepper: string) {
  await rm(databasePath, { force: true });
  await rm(artworkRoot, { recursive: true, force: true });
  runMigrations(databasePath);
  await seedDemoDatabase({ databasePath, artworkRoot, identityCodePepper, allowDemoSeed: true, nodeEnv: "test" });
}

async function main() {
  Object.assign(process.env, { NODE_ENV: "test" });
  const loadedEnvironment = await loadRuntimeEnvironment({
    mode: "SERVICE_OPTIONAL",
    nodeEnv: "test",
  });
  const environment = loadedEnvironment.environment;
  const config = readEnv(environment);
  writeEffectiveModelConfigNotice(config, loadedEnvironment.provenance);
  const fixture = process.argv.includes("--fixture");
  if (!fixture && !config.ai.enabled) throw new Error("RUNTIME_BENCHMARK_REQUIRES_MODEL_CONFIG");
  const suitePath = path.resolve("data/evals/agent-runtime-benchmark.json");
  const { suite, suiteHash } = loadAgentRuntimeBenchmarkSuite(suitePath);
  const runtimeRoot = path.resolve(".runtime/agent-runtime-benchmark");
  const mainDatabasePath = path.join(runtimeRoot, `agent-runtime-benchmark-demo-${process.pid}.sqlite`);
  const restartDatabasePath = path.join(runtimeRoot, `agent-runtime-restart-demo-${process.pid}.sqlite`);
  const mainArtworkRoot = path.join(runtimeRoot, `agent-runtime-benchmark-artworks-${process.pid}`);
  const restartArtworkRoot = path.join(runtimeRoot, `agent-runtime-restart-artworks-${process.pid}`);
  const reportPath = path.resolve(environment.AGENT_RUNTIME_BENCHMARK_REPORT_PATH?.trim()
    || path.join(runtimeRoot, "latest.json"));
  const temporaryLatestPath = `${reportPath}.tmp-${process.pid}`;
  const keepDatabase = process.argv.includes("--keep-db");
  const sourceCommit = currentCommit();
  const sourceStatus = workingTreeStatus();
  await mkdir(runtimeRoot, { recursive: true });
  try {
    await seedBenchmarkDatabase(mainDatabasePath, mainArtworkRoot, config.identityCodePepper);
    prepareHarnessData(mainDatabasePath);
    const policy = resolveAgentPolicyTimeouts(
      getActiveAgentPolicy(),
      config.agentTimeouts.online,
    );
    const designAdapter = fixture ? createRuntimeBenchmarkFixtureAdapter() : createOpenAICompatibleModelProvider({
      baseUrl: config.ai.baseUrl!, apiKey: config.ai.apiKey!, model: config.ai.model!,
      maxOutputTokens: config.ai.maxOutputTokens,
      idleTimeoutMs: policy.budgets.modelIdleTimeoutMs,
      totalTimeoutMs: policy.budgets.modelTimeoutMs,
      vision: config.ai.vision,
    });
    const structuralAdapter = fixture ? createRuntimeBenchmarkFixtureAdapter() : designAdapter;
    const connection = createDb(mainDatabasePath);
    const runtime = currentAgentRuntime;
    let results: RuntimeBenchmarkCaseResult[];
    try {
      await ingestCoursePackKnowledge(connection);
      const design = await runDesignBenchmarkCases({ connection, actor: STUDENT, suite, adapter: designAdapter, runtime });
      const continuity = await runLongSessionProbe({ connection, actor: STUDENT, suite, adapter: structuralAdapter, runtime });
      const isolation = await runTaskIsolationProbe({ connection, actor: STUDENT, suite, adapter: structuralAdapter, runtime });
      const harness = harnessBenchmarkResults(await new AgentEvalHarness(connection).runReleaseSuite());
      results = [...design, continuity, isolation, ...harness];
    } finally {
      connection.sqlite.close();
    }

    await seedBenchmarkDatabase(restartDatabasePath, restartArtworkRoot, config.identityCodePepper);
    const restart = await runRestartRecoveryProbe({
      openConnection: () => createDb(restartDatabasePath),
      actor: STUDENT,
      suite,
      adapter: structuralAdapter,
      runtime,
      freshProcessCheck: async (expectation) => inspectRestartInFreshProcess(restartDatabasePath, expectation),
    });
    results.push(restart);
    const endCommit = currentCommit();
    const endStatus = workingTreeStatus();
    if (sourceCommit !== endCommit || sourceStatus !== endStatus) {
      throw new Error("RUNTIME_BENCHMARK_SOURCE_CHANGED_DURING_RUN");
    }
    const workingTreeClean = sourceStatus.trim() === "";
    const comparisonMode = fixture
      ? "FIXTURE_VALIDATION" as const
      : workingTreeClean ? "REAL_MODEL_BASELINE" as const : "DEVELOPMENT_CHECK" as const;
    const report = buildAgentRuntimeBenchmarkReport({
      suite,
      suiteHash,
      runtimeId: runtime.descriptor.id,
      commit: sourceCommit,
      comparisonMode,
      model: { provider: designAdapter.provider, id: fixture ? "benchmark-fixture" : config.ai.model! },
      workingTreeClean,
      results,
    });
    const reportJson = `${JSON.stringify(report, null, 2)}\n`;
    const reportDirectory = path.dirname(reportPath);
    const runDirectory = path.join(reportDirectory, "runs");
    const runPath = path.join(runDirectory, `${Date.now()}-${sourceCommit.slice(0, 12)}.json`);
    await Promise.all([mkdir(reportDirectory, { recursive: true }), mkdir(runDirectory, { recursive: true })]);
    await writeFile(runPath, reportJson, "utf8");
    await writeFile(temporaryLatestPath, reportJson, "utf8");
    await rename(temporaryLatestPath, reportPath);
    process.stdout.write(`${JSON.stringify({
      passed: report.passed,
      releaseComparable: report.releaseComparable,
      comparisonMode: report.comparisonMode,
      workingTreeClean: report.workingTreeClean,
      reportPath,
      caseCount: report.caseCount,
      passedCaseCount: report.passedCaseCount,
      scorecard: report.scorecard,
      averageLatencyMs: report.averageLatencyMs,
    })}\n`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    await rm(temporaryLatestPath, { force: true });
    if (!keepDatabase) {
      await Promise.all([mainDatabasePath, restartDatabasePath].flatMap((databasePath) => [
        databasePath, `${databasePath}-wal`, `${databasePath}-shm`,
      ]).map((item) => rm(item, { force: true })));
      await Promise.all([mainArtworkRoot, restartArtworkRoot]
        .map((item) => rm(item, { recursive: true, force: true })));
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

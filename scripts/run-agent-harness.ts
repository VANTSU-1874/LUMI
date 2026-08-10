import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildAgentHarnessReport } from "@/lib/agent/harness";
import { AgentEvalHarness } from "@/lib/agent/agent-eval-harness";
import {
  readReleaseSourceBinding,
  sameReleaseSourceBinding,
} from "@/lib/agent/release-source-binding";
import { CURRENT_AGENT_RUNTIME } from "@/lib/agent/runtime/current-agent-runtime";
import { parseModelBaseUrl } from "@/lib/config/model-url";
import {
  loadRuntimeEnvironment,
  writeEffectiveModelConfigNotice,
} from "@/lib/config/runtime-environment";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { saveBookLayoutDraft } from "@/lib/services/book-layout";

async function main() {
  Object.assign(process.env, { NODE_ENV: "test" });
  const loadedEnvironment = await loadRuntimeEnvironment({
    mode: "SERVICE_OPTIONAL",
    nodeEnv: "test",
  });
  const environment = loadedEnvironment.environment;
  writeEffectiveModelConfigNotice({
    ai: {
      baseUrl: environment.LLM_BASE_URL
        ? parseModelBaseUrl(environment.LLM_BASE_URL)
        : undefined,
    },
  }, loadedEnvironment.provenance);
  const runtimeRoot = path.resolve(".runtime/agent-harness");
  await mkdir(runtimeRoot, { recursive: true });
  const databasePath = path.join(runtimeRoot, `agent-harness-${process.pid}.sqlite`);
  const reportPath = path.resolve(
    process.env.LUMI_RELEASE_AUDIT_AGENT_HARNESS_REPORT_PATH?.trim()
      || environment.AGENT_HARNESS_REPORT_PATH?.trim()
      || path.join(runtimeRoot, "latest.json"),
  );
  const runtime = {
    ...CURRENT_AGENT_RUNTIME,
    generation: "V3" as const,
    entrypoint: "runTutorTurn" as const,
    agentV3Enabled: true as const,
  };
  const startSource = readReleaseSourceBinding();
  await rm(databasePath, { force: true });
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  const previousV3 = process.env.AGENT_V3_ENABLED;
  try {
    Object.assign(process.env, { AGENT_V3_ENABLED: "true" });
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('harness-class','Agent Harness','HARNESS');
      INSERT INTO users(id,class_id,role,alias,created_at)
        VALUES
          ('harness-student','harness-class','STUDENT','Harness Student',1700000000),
          ('harness-other-student','harness-class','STUDENT','Harness Other Student',1700000000);
    `);
    await ingestCoursePackKnowledge(connection);
    saveBookLayoutDraft(connection, { userId: "harness-student", role: "STUDENT" }, {
      audience: "COMMUNITY_RESIDENTS",
      pageOrder: ["cover", "activity-map", "quick-start", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
      diagnosticAnswers: ["AUDIENCE_FIRST", "TASK_FIRST", "AUDIENCE_FIRST"],
      transferChoices: ["COMMUNITY_ENTRY_FIRST", "VOLUNTEER_CALL_TO_ACTION", "RETAIN_ACTIVITY_CORE"],
    });
    const results = await new AgentEvalHarness(connection).runReleaseSuite();
    const endSource = readReleaseSourceBinding();
    if (!sameReleaseSourceBinding(startSource, endSource)) {
      throw new Error("AGENT_HARNESS_SOURCE_CHANGED_DURING_RUN");
    }
    const report = buildAgentHarnessReport(results, startSource, runtime);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({
      passed: report.passed,
      reportPath,
      caseCount: report.caseCount,
      passedCaseCount: report.passedCaseCount,
      failures: report.results.flatMap(({ caseId, failures }) => failures.map((failure) => `${caseId}:${failure}`)),
    })}\n`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    if (previousV3 === undefined) delete process.env.AGENT_V3_ENABLED;
    else Object.assign(process.env, { AGENT_V3_ENABLED: previousV3 });
    connection.sqlite.close();
    if (!process.argv.includes("--keep-db")) {
      await Promise.all([databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map((item) => rm(item, { force: true })));
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

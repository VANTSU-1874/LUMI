import { createServer } from "node:net";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { CURRENT_AGENT_EVAL_SUITE_VERSION, readAgentQualityGate } from "@/lib/agent/evaluation";
import { readAgentHarnessGate } from "@/lib/agent/harness";
import { readEnv } from "@/lib/config/env";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { parseServiceEnvironment } from "@/lib/operations/local-host";
import { createConsistentBackup } from "@/scripts/create-backup";
import { verifyBackup } from "@/scripts/verify-backup";

function requiredLocalAppData() {
  const value = process.env.LOCALAPPDATA?.trim();
  if (!value || !path.isAbsolute(value)) throw new Error("LOCALAPPDATA 不可用");
  return value;
}

async function assertPortAvailable(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`PORT_IN_USE:${port}`)));
    server.listen(port, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolve()));
  });
}

async function main() {
  await assertPortAvailable(3000);
  await assertPortAvailable(3100);
  const localRoot = path.join(requiredLocalAppData(), "ChuyingAI");
  const environmentPath = process.env.CHUYING_SERVICE_ENV?.trim()
    || path.join(localRoot, "config", "service.env");
  const environment = parseServiceEnvironment(await readFile(environmentPath, "utf8"));
  const config = readEnv({ ...process.env, ...environment, NODE_ENV: "production" });
  if (!config.ai.enabled) throw new Error("RELEASE_REQUIRES_MODEL_CONFIG");
  if (!config.agentV2Enabled) throw new Error("RELEASE_REQUIRES_AGENT_V2");
  const qualityReportPath = environment.AGENT_EVAL_REPORT_PATH?.trim()
    || path.resolve(".runtime/agent-eval/latest.json");
  const quality = readAgentQualityGate(qualityReportPath, {
    expectedSuiteVersion: CURRENT_AGENT_EVAL_SUITE_VERSION,
  });
  if (quality.status !== "passed") throw new Error(`RELEASE_REQUIRES_PASSED_AGENT_EVAL:${quality.status}`);
  const harnessReportPath = environment.AGENT_HARNESS_REPORT_PATH?.trim()
    || path.resolve(".runtime/agent-harness/latest.json");
  const harness = readAgentHarnessGate(harnessReportPath);
  if (harness.status !== "passed") throw new Error(`RELEASE_REQUIRES_PASSED_AGENT_HARNESS:${harness.status}`);
  const backupBase = path.join(localRoot, "backups");
  await mkdir(backupBase, { recursive: true });
  const backup = await createConsistentBackup({
    databasePath: config.databasePath,
    evidenceRoot: config.evidenceRoot,
    backupBase,
  });
  const verification = await verifyBackup({ backupBase, backupPath: backup.backupPath });
  let knowledge: Awaited<ReturnType<typeof ingestCoursePackKnowledge>>;
  try {
    runMigrations(config.databasePath);
    const connection = createDb(path.resolve(config.databasePath));
    try {
      knowledge = await ingestCoursePackKnowledge(connection);
    } finally {
      connection.sqlite.close();
    }
    if (
      (knowledge.byCoursePack["general-design@1"] ?? 0) < 1
      || (knowledge.byCoursePack["digital-interaction@1"] ?? 0) < 1
      || (knowledge.byCoursePack["book-design@1"] ?? 0) < 1
    ) throw new Error("COURSE_PACK_KNOWLEDGE_INCOMPLETE");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "UNKNOWN";
    throw new Error(`RELEASE_PREPARATION_FAILED; VERIFIED_BACKUP=${backup.backupPath}; REASON=${reason}`);
  }
  console.log(JSON.stringify({
    ok: true,
    backupPath: backup.backupPath,
    verifiedFiles: verification.fileCount,
    knowledge: knowledge.byCoursePack,
    agentQuality: quality.status,
    agentHarness: harness.status,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "本机版本准备失败");
  process.exitCode = 1;
});

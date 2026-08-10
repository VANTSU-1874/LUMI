import { createServer } from "node:net";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CURRENT_AGENT_EVAL_SUITE_VERSION, readAgentQualityGate } from "@/lib/agent/evaluation";
import { readAgentHarnessGate } from "@/lib/agent/harness";
import { readEnv } from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
  writeEffectiveDatabaseConfigNotice,
} from "@/lib/config/runtime-environment";
import {
  applyPreparedKnowledgeIngestion,
  prepareKnowledgeIngestion,
  rehearsePreparedKnowledgeIngestion,
} from "@/lib/knowledge/knowledge-ingestion-pipeline";
import {
  assertWalDrained,
  createConsistentBackup,
} from "@/scripts/create-backup";
import {
  snapshotsEqual,
  sourceSnapshot,
} from "@/scripts/backup-core";
import { restoreBackup } from "@/scripts/restore-backup";
import { verifyBackup } from "@/scripts/verify-backup";

const releaseRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function requiredLocalAppData(environment: Record<string, string | undefined>) {
  const value = environment.LOCALAPPDATA?.trim();
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

export async function prepareLocalRelease(options: {
  portProbe?: (port: number) => Promise<void>;
} = {}) {
  const portProbe = options.portProbe ?? assertPortAvailable;
  await portProbe(3000);
  await portProbe(3100);
  const loaded = await loadRuntimeEnvironment({
    cwd: releaseRoot,
    mode: "SERVICE_REQUIRED",
    nodeEnv: "production",
  });
  const environment = loaded.environment;
  const parsedConfig = readEnv(environment);
  const config = {
    ...parsedConfig,
    databasePath: path.resolve(releaseRoot, parsedConfig.databasePath),
    evidenceRoot: path.resolve(releaseRoot, parsedConfig.evidenceRoot),
  };
  if (loaded.provenance.database.source !== "service-env") {
    throw new Error(
      `RELEASE_REQUIRES_SERVICE_DATABASE:${loaded.provenance.database.source}`,
    );
  }
  writeEffectiveDatabaseConfigNotice(
    config,
    loaded.provenance,
    environment,
    process.stderr,
    releaseRoot,
  );
  const localRoot = path.join(requiredLocalAppData(environment), "ChuyingAI");
  if (!config.ai.enabled) throw new Error("RELEASE_REQUIRES_MODEL_CONFIG");
  if (!config.agentV2Enabled) throw new Error("RELEASE_REQUIRES_AGENT_V2");
  const qualityReportPath = environment.AGENT_EVAL_REPORT_PATH?.trim()
    || path.join(releaseRoot, ".runtime", "agent-eval", "latest.json");
  const quality = readAgentQualityGate(qualityReportPath, {
    expectedSuiteVersion: CURRENT_AGENT_EVAL_SUITE_VERSION,
  });
  if (quality.status !== "passed") throw new Error(`RELEASE_REQUIRES_PASSED_AGENT_EVAL:${quality.status}`);
  const harnessReportPath = environment.AGENT_HARNESS_REPORT_PATH?.trim()
    || path.join(releaseRoot, ".runtime", "agent-harness", "latest.json");
  const harness = readAgentHarnessGate(harnessReportPath);
  if (harness.status !== "passed") throw new Error(`RELEASE_REQUIRES_PASSED_AGENT_HARNESS:${harness.status}`);
  const prepared = await prepareKnowledgeIngestion({
    knowledgeObjectV2Enabled: config.knowledgeObjectV2Enabled,
    workspaceRoot: releaseRoot,
  });
  const backupBase = process.env.BACKUP_BASE?.trim()
    || path.join(localRoot, "backups");
  const restoreBase = process.env.RESTORE_BASE?.trim()
    || path.join(localRoot, "restore-rehearsal");
  await mkdir(backupBase, { recursive: true });
  await mkdir(restoreBase, { recursive: true });
  const backup = await createConsistentBackup({
    databasePath: config.databasePath,
    evidenceRoot: config.evidenceRoot,
    backupBase,
  });
  const verification = await verifyBackup({ backupBase, backupPath: backup.backupPath });
  let restored: Awaited<ReturnType<typeof restoreBackup>>;
  let knowledge: ReturnType<typeof applyPreparedKnowledgeIngestion>;
  let rehearsal: ReturnType<typeof rehearsePreparedKnowledgeIngestion>;
  try {
    restored = await restoreBackup({
      backupBase,
      backupPath: backup.backupPath,
      restoreBase,
      liveDatabasePath: config.databasePath,
      liveEvidenceRoot: config.evidenceRoot,
    });
    rehearsal = rehearsePreparedKnowledgeIngestion(
      restored.databasePath,
      prepared,
    );
    await portProbe(3000);
    await portProbe(3100);
    await assertWalDrained(config.databasePath);
    const currentLiveSnapshot = await sourceSnapshot(
      config.databasePath,
      config.evidenceRoot,
    );
    if (!snapshotsEqual({
      directories: backup.manifest.directories,
      files: backup.manifest.files,
    }, currentLiveSnapshot)) {
      throw new Error("RELEASE_LIVE_SOURCE_CHANGED_AFTER_BACKUP");
    }
    knowledge = applyPreparedKnowledgeIngestion(
      config.databasePath,
      prepared,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "UNKNOWN";
    throw new Error(`RELEASE_PREPARATION_FAILED; VERIFIED_BACKUP=${backup.backupPath}; REASON=${reason}`);
  }
  console.log(JSON.stringify({
    ok: true,
    backupPath: backup.backupPath,
    verifiedFiles: verification.fileCount,
    restorePath: restored.restorePath,
    rehearsal,
    knowledge: knowledge.byCoursePack,
    knowledgeMode: prepared.mode,
    agentQuality: quality.status,
    agentHarness: harness.status,
  }));
  return {
    backupPath: backup.backupPath,
    restorePath: restored.restorePath,
    rehearsal,
    knowledge,
    knowledgeMode: prepared.mode,
  } as const;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  prepareLocalRelease().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "本机版本准备失败");
    process.exitCode = 1;
  });
}

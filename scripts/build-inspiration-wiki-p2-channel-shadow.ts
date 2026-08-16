import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { buildAndPersistP2StudentChannelShadowSnapshot } from "@/lib/services/inspiration-wiki-p2-student-channels";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function fileSha256(filePath: string) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

async function backupDatabase(databasePath: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve(".codex-runtime", `p2-shadow-preimport-${stamp}`);
  const backupPath = path.join(directory, "tonggan.sqlite");
  await mkdir(directory, { recursive: false });
  const source = createDb(databasePath);
  try { await source.sqlite.backup(backupPath); } finally { source.sqlite.close(); }
  const backup = createDb(backupPath);
  try {
    if (backup.sqlite.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new Error("P2 Shadow 备份完整性校验失败");
    }
  } finally { backup.sqlite.close(); }
  return { sha256: await fileSha256(backupPath), integrity: "ok" as const };
}

function build(databasePath: string) {
  const connection = createDb(databasePath);
  try {
    const teachers = connection.sqlite.prepare("SELECT id FROM users WHERE role='TEACHER' ORDER BY id").all() as Array<{ id: string }>;
    if (teachers.length !== 1) throw new Error(`P2 Shadow 要求恰好 1 个教师账号，当前为 ${teachers.length}`);
    const result = buildAndPersistP2StudentChannelShadowSnapshot(
      connection,
      { userId: teachers[0]!.id, role: "TEACHER" },
    );
    const audit = connection.sqlite.prepare(
      `SELECT
        (SELECT count(*) FROM inspiration_wiki_p2_channel_snapshots) AS snapshots,
        (SELECT count(*) FROM inspiration_wiki_private_internal_catalog_entries) AS privateCatalogEntries,
        (SELECT count(*) FROM inspiration_admissions WHERE status='ACTIVE' AND student_visible=1) AS legacyStudentAdmissions,
        (SELECT count(*) FROM inspiration_wiki_p2_channel_snapshots
          WHERE mode<>'SHADOW' OR browse_release<>'SHADOW' OR student_search<>'SHADOW'
            OR wiki_retrieval<>'DISABLED' OR student_visible<>0 OR production_deployment<>'DISABLED'
            OR formal_release<>'DISABLED' OR current_page<>'DISABLED' OR r2<>'DISABLED'
            OR embedding<>'DISABLED' OR lumi_retrieval<>'DISABLED') AS boundaryViolations`,
    ).get() as {
      snapshots: number;
      privateCatalogEntries: number;
      legacyStudentAdmissions: number;
      boundaryViolations: number;
    };
    if (
      result.snapshot.source.total !== audit.privateCatalogEntries
      || result.snapshot.source.eligible !== 0
      || result.snapshot.exposure.browsePageIds.length !== 0
      || result.snapshot.exposure.searchablePageIds.length !== 0
      || result.snapshot.exposure.previewPageIds.length !== 0
      || result.snapshot.exposure.lumiContextPageIds.length !== 0
      || audit.legacyStudentAdmissions !== 0
      || audit.boundaryViolations !== 0
    ) {
      throw new Error("P2 Shadow 验收失败：存在不一致计数或学生暴露");
    }
    return { teacherCount: teachers.length, ...result, audit };
  } finally { connection.sqlite.close(); }
}

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const databasePath = path.resolve(argument("--database") ?? process.env.DATABASE_PATH ?? "./data/tonggan.sqlite");
  const outputPath = path.resolve(argument("--output") ?? "./data/inspiration-wiki/p2-student-channel/d24-p2-shadow-snapshot.json");
  const validateOnly = process.argv.includes("--validate-only");
  let targetPath = databasePath;
  let temporaryDirectory: string | undefined;
  const backup = validateOnly ? null : await backupDatabase(databasePath);
  if (validateOnly) {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "lumi-p2-shadow-"));
    targetPath = path.join(temporaryDirectory, "validation.sqlite");
    const source = createDb(databasePath);
    try { await source.sqlite.backup(targetPath); } finally { source.sqlite.close(); }
  }
  try {
    runMigrations(targetPath);
    const result = build(targetPath);
    const report = {
      schemaVersion: "lumi-inspiration-p2-channel-shadow-run/v1",
      mode: validateOnly ? "VALIDATE_ONLY" : "WRITE",
      backup,
      ...result,
    };
    if (!validateOnly) {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "P2_STUDENT_CHANNEL_SHADOW_FAILED");
  process.exitCode = 1;
});

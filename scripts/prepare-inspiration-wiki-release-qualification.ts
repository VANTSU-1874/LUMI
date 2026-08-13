import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { prepareReleaseQualificationPilots, readTeacherReleaseQualificationQueue } from "@/lib/services/inspiration-wiki-release-qualification";

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
  const directory = path.resolve(".codex-runtime", `d25-release-qualification-${stamp}`);
  await mkdir(directory, { recursive: false });
  const backupPath = path.join(directory, "tonggan.sqlite");
  const source = createDb(databasePath);
  try { await source.sqlite.backup(backupPath); } finally { source.sqlite.close(); }
  const backup = createDb(backupPath);
  try {
    if (backup.sqlite.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("D-25 备份完整性校验失败");
  } finally { backup.sqlite.close(); }
  return { path: backupPath, sha256: await fileSha256(backupPath), integrity: "ok" as const };
}

function execute(databasePath: string) {
  const connection = createDb(databasePath);
  try {
    const teachers = connection.sqlite.prepare("SELECT id FROM users WHERE role='TEACHER' ORDER BY id").all() as Array<{ id: string }>;
    if (teachers.length !== 1) throw new Error(`D-25 要求恰好 1 个真实教师账号，当前为 ${teachers.length}`);
    const actor = { userId: teachers[0]!.id, role: "TEACHER" as const };
    const prepared = prepareReleaseQualificationPilots(connection, actor);
    const queue = readTeacherReleaseQualificationQueue(connection, actor);
    const audit = connection.sqlite.prepare(
      `SELECT
        (SELECT count(*) FROM inspiration_wiki_release_qualification_cases) AS cases,
        (SELECT count(*) FROM inspiration_wiki_release_qualification_decisions) AS decisions,
        (SELECT count(*) FROM inspiration_wiki_p2_channel_snapshots) AS shadowSnapshots,
        (SELECT count(*) FROM inspiration_admissions WHERE status='ACTIVE' AND student_visible=1) AS studentAdmissions,
        (SELECT count(*) FROM inspiration_wiki_release_qualification_cases
          WHERE student_visible<>0 OR formal_release<>'DISABLED' OR current_page<>'DISABLED'
            OR browse_release<>'SHADOW' OR student_search<>'SHADOW' OR wiki_retrieval<>'DISABLED'
            OR r2<>'DISABLED' OR embedding<>'DISABLED' OR lumi_retrieval<>'DISABLED'
            OR production_deployment<>'DISABLED') AS boundaryViolations`,
    ).get() as { cases: number; decisions: number; shadowSnapshots: number; studentAdmissions: number; boundaryViolations: number };
    if (queue.meta.total !== 5 || audit.cases !== 5 || audit.studentAdmissions !== 0 || audit.shadowSnapshots < 1 || audit.boundaryViolations !== 0) {
      throw new Error("D-25 试点验收失败：数量、Shadow 或能力边界不一致");
    }
    return { prepared, queue, audit };
  } finally { connection.sqlite.close(); }
}

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const databasePath = path.resolve(argument("--database") ?? process.env.DATABASE_PATH ?? "./data/tonggan.sqlite");
  const outputPath = path.resolve(argument("--output") ?? "./data/inspiration-wiki/release-qualification/d25-pilot-qualification.json");
  const validateOnly = process.argv.includes("--validate-only");
  let targetPath = databasePath;
  let temporaryDirectory: string | undefined;
  const backup = validateOnly ? null : await backupDatabase(databasePath);
  if (validateOnly) {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "lumi-d25-qualification-"));
    targetPath = path.join(temporaryDirectory, "validation.sqlite");
    const source = createDb(databasePath);
    try { await source.sqlite.backup(targetPath); } finally { source.sqlite.close(); }
  }
  try {
    runMigrations(targetPath);
    const result = execute(targetPath);
    const report = {
      schemaVersion: "lumi-inspiration-release-qualification-run/v1",
      mode: validateOnly ? "VALIDATE_ONLY" : "WRITE",
      backup: backup ? { sha256: backup.sha256, integrity: backup.integrity } : null,
      ...result,
    };
    if (!validateOnly) {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    console.log(JSON.stringify({ mode: report.mode, cases: result.audit.cases, decisions: result.audit.decisions, studentAdmissions: result.audit.studentAdmissions, boundaryViolations: result.audit.boundaryViolations }, null, 2));
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "D25_RELEASE_QUALIFICATION_FAILED");
  process.exitCode = 1;
});

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { admitApprovedPrivatePagesToInternalCatalog } from "@/lib/services/inspiration-wiki-private-catalog-governance";

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
  const directory = path.resolve(".codex-runtime", `d22-private-catalog-preimport-${stamp}`);
  const backupPath = path.join(directory, "tonggan.sqlite");
  await mkdir(directory, { recursive: false });
  const source = createDb(databasePath);
  try { await source.sqlite.backup(backupPath); } finally { source.sqlite.close(); }
  const backup = createDb(backupPath);
  try {
    const integrity = backup.sqlite.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`D-22 备份完整性校验失败：${String(integrity)}`);
  } finally { backup.sqlite.close(); }
  return { backupPath, sha256: await fileSha256(backupPath), integrity: "ok" as const };
}

function audit(databasePath: string) {
  const connection = createDb(databasePath);
  try {
    const teachers = connection.sqlite.prepare("SELECT id FROM users WHERE role='TEACHER' ORDER BY id").all() as Array<{ id: string }>;
    if (teachers.length !== 1) throw new Error(`D-22 单教师私有目录策略要求恰好 1 个真实教师账号，当前为 ${teachers.length}`);
    const source = connection.sqlite.prepare(
      `SELECT
        (SELECT count(*) FROM inspiration_wiki_private_pages) AS pages,
        (SELECT count(*) FROM inspiration_wiki_private_page_revisions) AS pageRevisions,
        (SELECT count(*) FROM inspiration_wiki_private_compiled_truths) AS truths,
        (SELECT count(*) FROM inspiration_wiki_private_domain_review_cases WHERE stage='DOMAIN_REVIEW_COMPLETE') AS approvedCases,
        (SELECT count(*) FROM inspiration_wiki_private_domain_review_decisions WHERE decision='APPROVE') AS approvedPrivateDecisions`,
    ).get();
    const admission = admitApprovedPrivatePagesToInternalCatalog(connection, teachers[0]!.id);
    const formal = connection.sqlite.prepare(
      `SELECT
        (SELECT count(*) FROM inspiration_wiki_draft_revisions) AS canonicalDrafts,
        (SELECT count(*) FROM inspiration_wiki_domain_review_decisions) AS canonicalDecisions,
        (SELECT count(*) FROM inspiration_wiki_internal_catalog_entries) AS legacyInternalCatalog`,
    ).get();
    const roles = connection.sqlite.prepare(
      `SELECT
        (SELECT count(*) FROM inspiration_wiki_role_policies WHERE version='role-policy:private-internal-catalog-v1') AS policies,
        (SELECT count(*) FROM inspiration_wiki_reviewer_assignments WHERE policy_version='role-policy:private-internal-catalog-v1') AS assignments,
        (SELECT count(DISTINCT authenticated_teacher_id) FROM inspiration_wiki_private_catalog_domain_decisions) AS distinctActors`,
    ).get();
    const decisions = connection.sqlite.prepare(
      "SELECT review_domain AS domain,count(*) AS count FROM inspiration_wiki_private_catalog_domain_decisions GROUP BY review_domain ORDER BY review_domain",
    ).all();
    const boundary = connection.sqlite.prepare(
      `SELECT count(*) AS violations FROM inspiration_wiki_private_internal_catalog_entries
       WHERE student_visible<>0 OR internal_catalog<>'ENABLED' OR canonical_compilation<>'DISABLED'
         OR current_page<>'DISABLED' OR formal_release<>'DISABLED' OR r2<>'DISABLED'
         OR embedding<>'DISABLED' OR lumi_retrieval<>'DISABLED' OR rights_scope<>'UNKNOWN_PRIVATE_ONLY'`,
    ).get();
    return { teacherCount: teachers.length, source, admission, roles, decisions, formal, boundary };
  } finally { connection.sqlite.close(); }
}

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const databasePath = path.resolve(argument("--database") ?? process.env.DATABASE_PATH ?? "./data/tonggan.sqlite");
  const validateOnly = process.argv.includes("--validate-only");
  let targetPath = databasePath;
  let temporaryDirectory: string | undefined;
  const backup = validateOnly ? null : await backupDatabase(databasePath);
  if (validateOnly) {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "lumi-private-catalog-"));
    targetPath = path.join(temporaryDirectory, "validation.sqlite");
    const source = createDb(databasePath);
    try { await source.sqlite.backup(targetPath); } finally { source.sqlite.close(); }
  }
  try {
    runMigrations(targetPath);
    console.log(JSON.stringify({
      mode: validateOnly ? "VALIDATE_ONLY" : "WRITE",
      backup,
      ...audit(targetPath),
    }, null, 2));
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "D22_PRIVATE_INTERNAL_CATALOG_FAILED");
  process.exitCode = 1;
});

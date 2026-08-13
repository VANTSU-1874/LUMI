import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { compileEligiblePrivateWikiPages } from "@/lib/services/inspiration-wiki-private-compilation";

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
  const directory = path.resolve(".codex-runtime", `d21-private-compilation-preimport-${stamp}`);
  const backupPath = path.join(directory, "tonggan.sqlite");
  await mkdir(directory, { recursive: false });
  const source = createDb(databasePath);
  try { await source.sqlite.backup(backupPath); } finally { source.sqlite.close(); }
  const backup = createDb(backupPath);
  try {
    const integrity = backup.sqlite.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`D-21 备份完整性校验失败：${String(integrity)}`);
  } finally { backup.sqlite.close(); }
  return { backupPath, sha256: await fileSha256(backupPath), integrity: "ok" as const };
}

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const databasePath = path.resolve(argument("--database") ?? process.env.DATABASE_PATH ?? "./data/tonggan.sqlite");
  const validateOnly = process.argv.includes("--validate-only");
  let targetPath = databasePath;
  let temporaryDirectory: string | undefined;
  const backup = validateOnly ? null : await backupDatabase(databasePath);

  if (validateOnly) {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "lumi-private-compilation-"));
    targetPath = path.join(temporaryDirectory, "validation.sqlite");
    const source = createDb(databasePath);
    try { await source.sqlite.backup(targetPath); } finally { source.sqlite.close(); }
  }

  try {
    runMigrations(targetPath);
    const connection = createDb(targetPath);
    try {
      const receipt = compileEligiblePrivateWikiPages(connection);
      const canonical = connection.sqlite.prepare(
        `SELECT
          (SELECT count(*) FROM inspiration_wiki_draft_revisions) AS draftRevisions,
          (SELECT count(*) FROM inspiration_wiki_domain_review_decisions) AS formalDecisions,
          (SELECT count(*) FROM inspiration_wiki_internal_catalog_entries) AS catalogEntries`,
      ).get();
      const boundaryViolations = connection.sqlite.prepare(
        `SELECT count(*) AS count FROM inspiration_wiki_private_pages
         WHERE teacher_private<>1 OR student_visible<>0 OR private_compilation<>'ENABLED'
           OR canonical_compilation<>'DISABLED' OR current_page<>'DISABLED'
           OR formal_release<>'DISABLED' OR r2<>'DISABLED' OR embedding<>'DISABLED'
           OR lumi_retrieval<>'DISABLED'`,
      ).get();
      console.log(JSON.stringify({ mode: validateOnly ? "VALIDATE_ONLY" : "WRITE", backup, receipt, canonical, boundaryViolations }, null, 2));
    } finally { connection.sqlite.close(); }
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

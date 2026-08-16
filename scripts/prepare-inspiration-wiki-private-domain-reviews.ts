import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { preparePrivateDomainReviewCases } from "@/lib/services/inspiration-wiki-private-domain-reviews";

const PREPARED_AT = "2026-08-12T16:30:00.000Z";
const BATCH_ID = "d20-private-domain-reviews-001";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

async function prepare(databasePath: string) {
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  try {
    const result = preparePrivateDomainReviewCases(connection, PREPARED_AT);
    const counts = connection.sqlite.prepare(
      `SELECT
        count(*) AS total,
        sum(CASE WHEN stage='PENDING_DOMAIN_REVIEW' THEN 1 ELSE 0 END) AS pending,
        sum(CASE WHEN stage='DOMAIN_REVIEW_HOLD' THEN 1 ELSE 0 END) AS hold,
        sum(CASE WHEN stage='PRIVATE_DRAFT_REJECTED' THEN 1 ELSE 0 END) AS rejected,
        sum(CASE WHEN stage='DOMAIN_REVIEW_COMPLETE' THEN 1 ELSE 0 END) AS complete,
        sum(reviewed_domain_count) AS reviewedDomains,
        sum(CASE WHEN rights_scope='UNKNOWN_PRIVATE_ONLY' THEN 1 ELSE 0 END) AS rightsUnknownPrivateOnly,
        sum(CASE WHEN student_visible<>0 OR current_page<>'DISABLED' OR r2<>'DISABLED'
          OR embedding<>'DISABLED' OR lumi_retrieval<>'DISABLED'
          OR canonical_compilation<>'DISABLED' THEN 1 ELSE 0 END) AS boundaryViolations
       FROM inspiration_wiki_private_domain_review_cases`,
    ).get();
    const canonical = connection.sqlite.prepare(
      `SELECT
        (SELECT count(*) FROM inspiration_wiki_draft_revisions) AS canonicalDrafts,
        (SELECT count(*) FROM inspiration_wiki_domain_review_decisions) AS canonicalDecisions,
        (SELECT count(*) FROM inspiration_wiki_internal_catalog_entries) AS internalCatalog`,
    ).get();
    return { ...result, counts, canonical };
  } finally {
    connection.sqlite.close();
  }
}

async function main() {
  const rawDatabase = arg("--database");
  if (!rawDatabase) throw new Error("--database is required");
  const databasePath = path.resolve(rawDatabase);
  const validateOnly = process.argv.includes("--validate-only");
  let result: Awaited<ReturnType<typeof prepare>>;
  if (validateOnly) {
    const directory = await mkdtemp(path.join(tmpdir(), "lumi-private-domain-review-validate-"));
    const copyPath = path.join(directory, "private.sqlite");
    const source = new Database(databasePath, { readonly: true, fileMustExist: true });
    try { await source.backup(copyPath); } finally { source.close(); }
    try { result = await prepare(copyPath); } finally { await rm(directory, { recursive: true, force: true }); }
  } else {
    result = await prepare(databasePath);
  }
  const summary = {
    schemaVersion: "lumi-inspiration-private-domain-review-preparation/v1",
    batchId: BATCH_ID,
    preparedAt: PREPARED_AT,
    ...result,
  };
  const packageDigest = digest(summary);
  if (!validateOnly) {
    const output = path.resolve("data/inspiration-wiki/private-domain-reviews", BATCH_ID);
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await writeFile(path.join(output, "report.md"), [
      "# D-20 教师私有四域预复核准备报告",
      "",
      `- 准备批次：${BATCH_ID}`,
      `- 当前草稿任务：${result.total}`,
      `- 本次新增：${result.imported}`,
      `- 幂等复验：${result.replayed}`,
      "- 四域：策展、教学、权利、安全；每个结论可追加修订。",
      "- 权利语义：UNKNOWN_PRIVATE_ONLY，仅确认未知并限定教师私有使用。",
      "- 正式 S1 草稿、正式分域决定、内部目录均保持 0。",
      "- 学生、Current Page、R2、Embedding、Lumi 引用和 canonical compilation 全部关闭。",
      `- Package digest：${packageDigest}`,
      "",
    ].join("\n"), "utf8");
    await writeFile(path.join(output, "DONE.json"), `${JSON.stringify({
      status: "COMPLETE",
      batchId: BATCH_ID,
      itemCount: result.total,
      packageDigest,
      completedAt: PREPARED_AT,
    }, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ ok: true, mode: validateOnly ? "VALIDATE_ONLY" : "PREPARE", ...summary, packageDigest }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "PRIVATE_DOMAIN_REVIEW_PREPARATION_FAILED");
  process.exitCode = 1;
});

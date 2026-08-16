import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { compileAcceptedPrivateWikiDrafts } from "@/lib/services/inspiration-wiki-private-drafts";

const COMPILED_AT = "2026-08-12T15:20:00.000Z";
const BATCH_ID = "d19-private-working-drafts-001";

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

async function compile(databasePath: string) {
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  try {
    const result = compileAcceptedPrivateWikiDrafts(connection, COMPILED_AT);
    const counts = connection.sqlite.prepare(
      `SELECT
        count(*) AS total,
        sum(CASE WHEN stage='EDITING' THEN 1 ELSE 0 END) AS editing,
        sum(CASE WHEN stage='READY_FOR_DOMAIN_REVIEW' THEN 1 ELSE 0 END) AS ready,
        sum(CASE WHEN source_contract_kind='STRICT_REVIEW_PACK' THEN 1 ELSE 0 END) AS strict,
        sum(CASE WHEN source_contract_kind='EVIDENCE_GAP_REVIEW' THEN 1 ELSE 0 END) AS evidenceGap,
        sum(CASE WHEN rights_status='UNKNOWN' THEN 1 ELSE 0 END) AS rightsUnknown,
        sum(CASE WHEN student_visible<>0 OR current_page<>'DISABLED' OR r2<>'DISABLED'
          OR embedding<>'DISABLED' OR lumi_retrieval<>'DISABLED' THEN 1 ELSE 0 END) AS boundaryViolations
       FROM inspiration_wiki_private_working_drafts`,
    ).get();
    const revisionCount = connection.sqlite.prepare(
      "SELECT count(*) AS count FROM inspiration_wiki_private_working_draft_revisions",
    ).get();
    return { ...result, counts, revisionCount };
  } finally {
    connection.sqlite.close();
  }
}

async function main() {
  const rawDatabase = arg("--database");
  if (!rawDatabase) throw new Error("--database is required");
  const databasePath = path.resolve(rawDatabase);
  const validateOnly = process.argv.includes("--validate-only");
  let result: Awaited<ReturnType<typeof compile>>;
  if (validateOnly) {
    const directory = await mkdtemp(path.join(tmpdir(), "lumi-private-draft-validate-"));
    const copyPath = path.join(directory, "private.sqlite");
    const source = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      await source.backup(copyPath);
    } finally {
      source.close();
    }
    try {
      result = await compile(copyPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } else {
    result = await compile(databasePath);
  }
  const summary = {
    schemaVersion: "lumi-inspiration-private-working-draft-compilation/v1",
    batchId: BATCH_ID,
    compiledAt: COMPILED_AT,
    ...result,
  };
  const packageDigest = digest(summary);
  if (!validateOnly) {
    const output = path.resolve("data/inspiration-wiki/private-working-drafts", BATCH_ID);
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await writeFile(path.join(output, "report.md"), [
      "# D-19 私有 WikiDraft 编纂报告",
      "",
      `- 编纂批次：${BATCH_ID}`,
      `- 私有草稿：${result.total}`,
      `- 严格审核来源：${result.strict}`,
      `- 缺证审核来源：${result.evidenceGap}`,
      `- 拒绝项排除：${result.rejectedExcluded}`,
      "- 权利状态：全部 UNKNOWN；不推导正式再发布许可。",
      "- 边界：学生、Current Page、R2、Embedding、Lumi 引用全部关闭。",
      `- Package digest：${packageDigest}`,
      "",
    ].join("\n"), "utf8");
    await writeFile(path.join(output, "DONE.json"), `${JSON.stringify({
      status: "COMPLETE",
      batchId: BATCH_ID,
      itemCount: result.total,
      packageDigest,
      completedAt: COMPILED_AT,
    }, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ ok: true, mode: validateOnly ? "VALIDATE_ONLY" : "COMPILE", ...summary, packageDigest }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "PRIVATE_DRAFT_COMPILATION_FAILED");
  process.exitCode = 1;
});

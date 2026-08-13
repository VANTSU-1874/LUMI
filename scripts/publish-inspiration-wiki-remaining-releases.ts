import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { publishQualifiedInspirationCase, readTeacherFormalReleaseQueue } from "@/lib/services/inspiration-wiki-formal-release";
import {
  decideReleaseQualificationGate,
  prepareRemainingReleaseQualificationCases,
  readTeacherReleaseQualificationQueue,
} from "@/lib/services/inspiration-wiki-release-qualification";

const RIGHTS_EVIDENCE_REF = "USER_RIGHTS_ATTESTATION:2026-08-13:INSPIRATION-WIKI-REMAINING-172";
const EXPECTED_TOTAL = 177;
const EXPECTED_REMAINING = 172;
const gates = [
  { gate: "STUDENT_DISPLAY_RIGHTS" as const, evidenceRef: RIGHTS_EVIDENCE_REF, note: "权利授予人确认本人有权许可灵感 Wiki 剩余 172 条作品用于本地存储、必要缩略图和向已登录学生展示，并保留作者与来源署名；支持随时撤下。" },
  { gate: "AUDIENCE_POLICY" as const, evidenceRef: null, note: "正式发布仅面向已登录学生；匿名公开保持关闭。" },
  { gate: "SOURCE_DISCLOSURE" as const, evidenceRef: null, note: "学生案例固定展示创作者与公开来源署名；未知来源事实继续标记为未知。" },
  { gate: "WITHDRAWAL_READINESS" as const, evidenceRef: null, note: "Current Page 使用追加式事件，撤下后从 Browse、Search 与 Preview 活动集合移除。" },
  { gate: "RELEASE_ROLE_SIGNOFF" as const, evidenceRef: null, note: "教师明确授权发布剩余 172 条；R2、Embedding、Lumi Retrieval 与匿名公开继续关闭。" },
] as const;

function argument(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function stableUuid(value: string) {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function fileSha256(filePath: string) { const digest = createHash("sha256"); for await (const chunk of createReadStream(filePath)) digest.update(chunk); return digest.digest("hex"); }
async function backupDatabase(databasePath: string) {
  const directory = path.resolve(".codex-runtime", `d28-remaining-release-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(directory, { recursive: false });
  const backupPath = path.join(directory, "tonggan.sqlite");
  const source = createDb(databasePath);
  try { await source.sqlite.backup(backupPath); } finally { source.sqlite.close(); }
  const backup = createDb(backupPath);
  try { if (backup.sqlite.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("全量发布前备份完整性校验失败"); } finally { backup.sqlite.close(); }
  return { sha256: await fileSha256(backupPath), integrity: "ok" as const };
}

function execute(databasePath: string) {
  const connection = createDb(databasePath);
  try {
    const teachers = connection.sqlite.prepare("SELECT id FROM users WHERE role='TEACHER' ORDER BY id").all() as Array<{ id: string }>;
    if (teachers.length !== 1) throw new Error(`全量发布要求恰好 1 个真实教师账号，当前为 ${teachers.length}`);
    const actor = { userId: teachers[0]!.id, role: "TEACHER" as const };
    const prepared = prepareRemainingReleaseQualificationCases(connection, actor, new Date(), EXPECTED_REMAINING);
    const publishedCaseIds = new Set((connection.sqlite.prepare("SELECT case_id FROM inspiration_wiki_formal_releases").all() as Array<{ case_id: string }>).map((row) => row.case_id));
    const unpublished = readTeacherReleaseQualificationQueue(connection, actor).items.filter((item) => !publishedCaseIds.has(item.releaseCase.caseId));
    if (![0, EXPECTED_REMAINING].includes(unpublished.length)) throw new Error(`待发布集合异常：${unpublished.length}`);
    let decisionWrites = 0;
    for (const item of unpublished) {
      for (const gate of gates) {
        const receipt = decideReleaseQualificationGate(connection, actor, {
          caseId: item.releaseCase.caseId,
          gate: gate.gate,
          status: "SATISFIED",
          evidenceRef: gate.evidenceRef,
          note: gate.note,
          idempotencyKey: stableUuid(`remaining-172:${item.releaseCase.caseId}:${gate.gate}`),
        });
        if (!receipt.replayed) decisionWrites += 1;
      }
    }
    const qualified = readTeacherReleaseQualificationQueue(connection, actor);
    if (qualified.meta.total !== EXPECTED_TOTAL || qualified.meta.qualified !== EXPECTED_TOTAL) {
      throw new Error(`发布资格未闭合：${qualified.meta.qualified}/${qualified.meta.total}`);
    }
    let releaseWrites = 0;
    const nowPublished = new Set((connection.sqlite.prepare("SELECT case_id FROM inspiration_wiki_formal_releases").all() as Array<{ case_id: string }>).map((row) => row.case_id));
    for (const item of qualified.items.filter((item) => !nowPublished.has(item.releaseCase.caseId))) {
      const receipt = publishQualifiedInspirationCase(connection, actor, {
        action: "PUBLISH",
        caseId: item.releaseCase.caseId,
        idempotencyKey: stableUuid(`formal-release:${item.releaseCase.caseId}`),
      });
      if (!receipt.replayed) releaseWrites += 1;
    }
    const formal = readTeacherFormalReleaseQueue(connection, actor);
    const audit = connection.sqlite.prepare(
      `SELECT
        (SELECT count(*) FROM inspiration_wiki_canonical_pages) canonicalPages,
        (SELECT count(*) FROM inspiration_wiki_canonical_page_revisions) canonicalRevisions,
        (SELECT count(*) FROM inspiration_wiki_formal_releases) formalReleases,
        (SELECT count(*) FROM inspiration_wiki_current_page_events WHERE event_type='ACTIVATED') activations,
        (SELECT count(*) FROM inspiration_wiki_p2_active_channel_snapshots) activeSnapshots,
        (SELECT count(*) FROM inspiration_admissions) legacyAdmissions,
        (SELECT count(*) FROM inspiration_wiki_formal_releases WHERE wiki_retrieval<>'DISABLED' OR r2<>'DISABLED' OR embedding<>'DISABLED' OR lumi_retrieval<>'DISABLED' OR production_deployment<>'DISABLED') boundaryViolations`,
    ).get() as Record<string, number>;
    if (formal.meta.total !== EXPECTED_TOTAL || formal.meta.active !== EXPECTED_TOTAL || formal.meta.withdrawn !== 0 || formal.meta.qualifiedUnreleased !== 0 || audit.canonicalPages !== EXPECTED_TOTAL || audit.canonicalRevisions !== EXPECTED_TOTAL || audit.formalReleases !== EXPECTED_TOTAL || audit.activations !== EXPECTED_TOTAL || audit.legacyAdmissions !== 0 || audit.boundaryViolations !== 0) {
      throw new Error(`全量发布验收失败：${JSON.stringify({ formal: formal.meta, audit })}`);
    }
    return { prepared, decisionWrites, releaseWrites, qualification: qualified.meta, formal: formal.meta, audit };
  } finally { connection.sqlite.close(); }
}

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const databasePath = path.resolve(argument("--database") ?? process.env.DATABASE_PATH ?? "./data/tonggan.sqlite");
  const outputPath = path.resolve(argument("--output") ?? "./data/inspiration-wiki/formal-release/d28-remaining-172-release.json");
  const validateOnly = process.argv.includes("--validate-only");
  let targetPath = databasePath;
  let temporaryDirectory: string | undefined;
  const backup = validateOnly ? null : await backupDatabase(databasePath);
  if (validateOnly) {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "lumi-d28-release-"));
    targetPath = path.join(temporaryDirectory, "validation.sqlite");
    const source = createDb(databasePath);
    try { await source.sqlite.backup(targetPath); } finally { source.sqlite.close(); }
  }
  try {
    runMigrations(targetPath);
    const result = execute(targetPath);
    const report = { schemaVersion: "lumi-inspiration-formal-release-expansion-run/v1", mode: validateOnly ? "VALIDATE_ONLY" : "WRITE", rightsEvidenceRef: RIGHTS_EVIDENCE_REF, backup, ...result };
    if (!validateOnly) { await mkdir(path.dirname(outputPath), { recursive: true }); await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"); }
    console.log(JSON.stringify(report, null, 2));
  } finally { if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }); }
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "FULL_FORMAL_RELEASE_FAILED"); process.exitCode = 1; });

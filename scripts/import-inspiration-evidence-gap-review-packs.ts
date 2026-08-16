import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
import { z } from "zod";
import { createDb } from "../lib/db/client";
import { runMigrations } from "../lib/db/migrate";
import { EvidenceGapReviewPackSchema, type EvidenceGapReviewPack } from "../lib/domain/inspiration-wiki/evidence-gap-review-contracts";
import { calculateEvidenceGapReviewMaterialHash, persistEvidenceGapReviewPack, type EvidenceGapStoredAsset } from "../lib/services/inspiration-wiki-evidence-gap-reviews";

const Asset = z.object({ mediaId: z.string(), file: z.string().regex(/^assets\/[a-z0-9.-]+$/), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), bytes: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const Package = z.object({ schemaVersion: z.literal("lumi-inspiration-evidence-gap-review-pack-import/v1"), batchId: z.string(), preparedAt: z.string().datetime(), items: z.array(z.object({ sourceCandidateId: z.string(), pack: z.record(z.string(), z.unknown()), assets: z.array(Asset).max(20) }).strict()).length(102) }).strict();
const digest = (v: Buffer) => createHash("sha256").update(v).digest("hex");
const fmt = (m: string) => m === "image/jpeg" ? "jpeg" : m.split("/")[1];
const ext = (m: string) => m === "image/jpeg" ? "jpg" : m.split("/")[1];

async function verify(dir: string, rawPack: unknown, assets: z.infer<typeof Asset>[]) {
  const pack = EvidenceGapReviewPackSchema.parse(rawPack), material = { ...pack } as Partial<EvidenceGapReviewPack>; delete material.materialHash;
  if (calculateEvidenceGapReviewMaterialHash(material as Omit<EvidenceGapReviewPack, "materialHash">) !== pack.materialHash) throw new Error(`GAP_HASH:${pack.reviewPackId}`);
  if (assets.length !== pack.mediaGroup.length) throw new Error(`GAP_MEDIA_COUNT:${pack.reviewPackId}`);
  const verified: Array<{ input: z.infer<typeof Asset>; bytes: Buffer }> = [];
  for (const input of assets) {
    const media = pack.mediaGroup.find(m => m.mediaId === input.mediaId); if (!media || media.sha256 !== input.sha256) throw new Error(`GAP_MEDIA_BIND:${pack.reviewPackId}`);
    const p = path.resolve(dir, input.file); if (!p.startsWith(`${dir}${path.sep}`)) throw new Error("GAP_PATH"); const bytes = await readFile(p), md = await sharp(bytes).metadata();
    if (bytes.length !== input.bytes || digest(bytes) !== input.sha256 || md.width !== media.width || md.height !== media.height || md.format !== fmt(input.mimeType)) throw new Error(`GAP_ASSET:${input.file}`);
    verified.push({ input, bytes });
  }
  return { pack, verified };
}

async function storedAssets(packageDir: string, databasePath: string, pack: EvidenceGapReviewPack, verified: Awaited<ReturnType<typeof verify>>["verified"]) {
  const slug = pack.reviewPackId.replace(/^review-pack:/, ""), root = path.join(path.dirname(databasePath), "inspiration-wiki", "evidence-gap-review-packs", "assets", slug);
  await mkdir(root, { recursive: true }); const out: EvidenceGapStoredAsset[] = [];
  for (const { input, bytes } of verified) {
    const name = `${input.mediaId}.${ext(input.mimeType)}`, target = path.join(root, name);
    try { const existing = await readFile(target); if (digest(existing) !== input.sha256) throw new Error(`GAP_DESTINATION_CONFLICT:${pack.reviewPackId}:${input.mediaId}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; await copyFile(path.resolve(packageDir, input.file), target); }
    out.push({ mediaId: input.mediaId, storagePath: path.posix.join("inspiration-wiki", "evidence-gap-review-packs", "assets", slug, name), mimeType: input.mimeType, bytes: bytes.length, sha256: input.sha256 });
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2).filter(x => x !== "--"), di = argv.indexOf("--database"), packageArg = argv.find((x, i) => !x.startsWith("--") && i !== di + 1);
  if (!packageArg) throw new Error("Usage: inspiration:evidence-gaps:import <package-directory> [--validate-only] [--database <sqlite>]");
  const dir = path.resolve(packageArg), databasePath = path.resolve(di < 0 ? process.env.DATABASE_PATH ?? "./data/tonggan.sqlite" : argv[di + 1]), validateOnly = argv.includes("--validate-only");
  const input = Package.parse(JSON.parse(await readFile(path.join(dir, "evidence-gap-review-packs.json"), "utf8"))), checked = []; const ids = new Set<string>(), candidates = new Set<string>(); let assets = 0;
  for (const item of input.items) { const x = await verify(dir, item.pack, item.assets); if (ids.has(x.pack.reviewPackId) || candidates.has(x.pack.candidateId)) throw new Error(`GAP_DUPLICATE:${x.pack.reviewPackId}`); ids.add(x.pack.reviewPackId); candidates.add(x.pack.candidateId); checked.push(x); assets += item.assets.length; }
  if (validateOnly) {
    const audit = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      const strictCount = audit.prepare("SELECT count(*) FROM inspiration_wiki_review_packs").pluck().get() as number;
      const candidateCount = audit.prepare("SELECT count(*) FROM inspiration_wiki_hermes_candidates").pluck().get() as number;
      const existingGapCount = audit.prepare("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='inspiration_wiki_evidence_gap_review_packs'").pluck().get() as number
        ? audit.prepare("SELECT count(*) FROM inspiration_wiki_evidence_gap_review_packs").pluck().get() as number : 0;
      if (strictCount !== 98 || candidateCount !== 200 || ![0, checked.length].includes(existingGapCount)) throw new Error(`GAP_VALIDATION_BOUNDARY:${strictCount}:${candidateCount}:${existingGapCount}`);
      const packagedCandidates = new Set(checked.map((item) => item.pack.candidateId));
      const strictCandidates = new Set(audit.prepare("SELECT candidate_id FROM inspiration_wiki_review_packs").pluck().all() as string[]);
      const expectedGapCandidates = audit.prepare("SELECT id FROM inspiration_wiki_hermes_candidates").pluck().all() as string[];
      if (expectedGapCandidates.some((id) => strictCandidates.has(id) === packagedCandidates.has(id))) throw new Error("GAP_ANTI_JOIN_MISMATCH");
      if (existingGapCount > 0) {
        const stored = audit.prepare("SELECT review_pack_id,candidate_id,material_hash FROM inspiration_wiki_evidence_gap_review_packs").all() as Array<{ review_pack_id: string; candidate_id: string; material_hash: string }>;
        const packaged = new Map(checked.map((item) => [item.pack.reviewPackId, item.pack]));
        if (stored.some((row) => { const pack = packaged.get(row.review_pack_id); return !pack || pack.candidateId !== row.candidate_id || pack.materialHash !== row.material_hash; })) throw new Error("GAP_PERSISTED_MATERIAL_MISMATCH");
      }
      console.log(JSON.stringify({ ok: true, validateOnly: true, batchId: input.batchId, databaseState: existingGapCount === 0 ? "PRE_IMPORT" : "POST_IMPORT_MATCHED", strictReviewPacks: strictCount, evidenceGapPacks: checked.length, candidateUnionAfterImport: candidateCount, candidateIntersectionAfterImport: 0, existingEvidenceGapPacks: existingGapCount, assets, databaseWrites: 0 }, null, 2));
    } finally { audit.close(); }
    return;
  }
  runMigrations(databasePath); const connection = createDb(databasePath);
  try {
    const results = [];
    for (const item of checked) results.push(persistEvidenceGapReviewPack(connection, item.pack, await storedAssets(dir, databasePath, item.pack, item.verified)));
    const boundary = connection.sqlite.prepare(`SELECT
      (SELECT count(*) FROM inspiration_wiki_review_packs) strict_count,
      (SELECT count(*) FROM inspiration_wiki_evidence_gap_review_packs) gap_count,
      (SELECT count(*) FROM inspiration_wiki_hermes_candidates h WHERE EXISTS (SELECT 1 FROM inspiration_wiki_review_packs s WHERE s.candidate_id=h.id) OR EXISTS (SELECT 1 FROM inspiration_wiki_evidence_gap_review_packs g WHERE g.candidate_id=h.id)) union_count,
      (SELECT count(*) FROM inspiration_wiki_review_packs s JOIN inspiration_wiki_evidence_gap_review_packs g ON g.candidate_id=s.candidate_id) intersection_count,
      (SELECT count(*) FROM inspiration_wiki_evidence_gap_review_packs WHERE teacher_private<>1 OR student_visible<>0 OR current_page<>'DISABLED' OR r2<>'DISABLED' OR embedding<>'DISABLED' OR lumi_retrieval<>'DISABLED') violations`).get() as { strict_count: number; gap_count: number; union_count: number; intersection_count: number; violations: number };
    if (boundary.strict_count !== 98 || boundary.gap_count !== 102 || boundary.union_count !== 200 || boundary.intersection_count !== 0 || boundary.violations !== 0) throw new Error(`GAP_BOUNDARY:${JSON.stringify(boundary)}`);
    console.log(JSON.stringify({ ok: true, validateOnly: false, batchId: input.batchId, results, assets, ...boundary }, null, 2));
  } finally { connection.sqlite.close(); }
}
main().catch(e => { console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "GAP_IMPORT_FAILED" })); process.exitCode = 1; });

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
import { z } from "zod";
import { EvidenceGapReviewPackSchema, type EvidenceGapReadiness } from "../lib/domain/inspiration-wiki/evidence-gap-review-contracts";

const Sources = ["BPANDO", "HESIGN", "TYPOGRAPHIC_POSTERS", "NOTEFOLIO"] as const;
type Source = (typeof Sources)[number];
const Manifest = z.object({
  schemaVersion: z.literal("lumi-inspiration-evidence-gap-review-curation/v1"), batchId: z.string(), preparedAt: z.string().datetime(), sourceBatchId: z.string(), expectedTotal: z.number().int(),
  expectedSourceCounts: z.record(z.enum(Sources), z.number().int()), evidenceSources: z.record(z.enum(Sources), z.string()),
  excludedAssetSha256: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
}).strict();
const Candidate = z.object({
  batchId: z.string(), candidateId: z.string(),
  source: z.object({ sourceId: z.string(), pageUrl: z.string().url(), canonicalUrl: z.string().url().nullable() }).passthrough(),
  content: z.object({ title: z.string().nullable(), description: z.string().nullable() }),
  author: z.object({ displayName: z.string().nullable() }).passthrough().nullable(), license: z.unknown().nullable(), designCategories: z.array(z.string()),
}).passthrough();
const Asset = z.object({
  candidate_id: z.string(), asset_path: z.string().regex(/^assets\/[a-z0-9-]+\/[a-z0-9.-]+$/), sequence: z.number().int(),
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]), byte_size: z.number().int(), width: z.number().int(), height: z.number().int(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/), license: z.unknown().nullable(), republication_permission: z.enum(["ALLOW", "DENY", "UNKNOWN"]).nullable(),
}).passthrough();
const DbRow = z.object({ storageId: z.string(), sourceCandidateId: z.string(), batchId: z.string(), reviewState: z.string() });
type Audit = { id: string; gates: Set<string>; notes: string[]; refs: string[]; safety: boolean };
const fields: Record<keyof EvidenceGapReadiness, string> = {
  controlledMediaGroup: "CONTROLLED_MEDIA_GROUP", workSourceMatch: "WORK_SOURCE_MATCH", sourceRole: "SOURCE_ROLE", rightsEvidence: "RIGHTS_EVIDENCE",
  normalizedClassification: "NORMALIZED_CLASSIFICATION", visualDescription: "VISUAL_DESCRIPTION", duplicateRelationship: "DUPLICATE_RELATIONSHIP",
  curationRecommendation: "CURATION_RECOMMENDATION", teachingRecommendation: "TEACHING_RECOMMENDATION",
};
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
function stable(v: unknown): string { if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`; if (v && typeof v === "object") return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}`; return JSON.stringify(v); }
const lines = async (p: string) => (await readFile(p, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) as unknown[];
function sourceOf(id: string): Source { if (id.startsWith("hc-bpando-")) return "BPANDO"; if (id.startsWith("hc-hesign-")) return "HESIGN"; if (id.startsWith("hc-typographicposters-")) return "TYPOGRAPHIC_POSTERS"; if (id.startsWith("hc-notefolio-")) return "NOTEFOLIO"; throw new Error(`GAP_SOURCE:${id}`); }
const ext = (m: string) => m === "image/jpeg" ? "jpg" : m.split("/")[1];
const format = (m: string) => m === "image/jpeg" ? "jpeg" : m.split("/")[1];
const short = (xs: string[]) => { const s = xs.join(" "); return s.length <= 500 ? s : `${s.slice(0, 497)}...`; };

async function loadAudits(manifestPath: string, manifest: z.infer<typeof Manifest>) {
  const out = new Map<string, Audit>();
  for (const source of ["BPANDO", "HESIGN", "TYPOGRAPHIC_POSTERS"] as const) {
    const j = JSON.parse(await readFile(path.resolve(path.dirname(manifestPath), manifest.evidenceSources[source]), "utf8")) as Record<string, unknown>;
    const id = String(j.auditId); const items = z.array(z.record(z.string(), z.unknown())).parse(j.items);
    for (const item of items) {
      const cid = String(item.sourceCandidateId); let gates: string[]; let notes: string[];
      if (source === "HESIGN") { const gs = z.array(z.object({ gate: z.string(), gap: z.string(), requiredEvidence: z.string() }).passthrough()).parse(item.blockedGates); gates = gs.map(x => x.gate); notes = gs.flatMap(x => [x.gap, `Next evidence: ${x.requiredEvidence}`]); }
      else { gates = z.array(z.string()).parse(source === "BPANDO" ? item.blockedGates : item.blockingGates); notes = [...z.array(z.string()).parse(item.gaps ?? []), ...z.array(z.string()).parse(item.nextEvidenceRequired ?? []).map(x => `Next evidence: ${x}`)]; }
      out.set(cid, { id, gates: new Set(gates), notes, refs: gates.map(g => `audit:${id}:candidate:${cid}:gate:${g}`), safety: gates.includes("SAFETY_ASSESSMENT") || gates.includes("PRIVACY_SAFETY") });
    }
  }
  return out;
}

function readiness(audit: Audit | undefined, source: Source, hasMedia: boolean, rawMatch: boolean, terms: boolean): EvidenceGapReadiness {
  return Object.fromEntries((Object.keys(fields) as Array<keyof EvidenceGapReadiness>).map(field => {
    const gate = fields[field];
    if (audit?.gates.has(gate)) return [field, { status: "BLOCKED", note: short(audit.notes), evidenceRefs: audit.refs.filter(x => x.endsWith(`:${gate}`)) }];
    if (field === "rightsEvidence") return [field, source === "NOTEFOLIO"
      ? { status: "PRESENT_UNVERIFIED", note: "用户声明已获得转存授权，但当前未绑定可核验授权材料或候选覆盖清单；不得写入 CREATOR_PERMISSION 或 ALLOW。", evidenceRefs: ["preflight:notefolio-authorization-preflight-2026-08-12"] }
      : { status: "BLOCKED", note: "Public source and downloaded assets do not provide verified copying or republication permission.", evidenceRefs: [] }];
    if (field === "controlledMediaGroup") return [field, { status: hasMedia ? "PRESENT_UNVERIFIED" : "MISSING", note: hasMedia ? "One preview asset passed decoding, hash and dimension checks, but its role, pixel content, people/privacy risk and project match remain unverified by a teacher." : "No local evidence media is available.", evidenceRefs: [] }];
    if (field === "workSourceMatch") return [field, { status: rawMatch ? "PRESENT_UNVERIFIED" : "MISSING", note: rawMatch ? "Raw title, canonical source and author metadata are present but attribution is unverified." : "Insufficient raw signals for attribution.", evidenceRefs: [] }];
    if (field === "sourceRole") return [field, { status: "PRESENT_UNVERIFIED", note: "Source page is preserved; creator, article-author and curator roles remain unverified.", evidenceRefs: [] }];
    if (field === "normalizedClassification") return [field, { status: terms ? "PRESENT_UNVERIFIED" : "MISSING", note: terms ? "Hermes source categories are preserved verbatim and unnormalized." : "No source categories are available.", evidenceRefs: [] }];
    return [field, { status: "MISSING", note: `${gate} has no verified candidate-level evidence.`, evidenceRefs: [] }];
  })) as EvidenceGapReadiness;
}

async function main() {
  const argv = process.argv.slice(2).filter(x => x !== "--"); const di = argv.indexOf("--database");
  const dbPath = path.resolve(di < 0 ? "./data/tonggan.sqlite" : argv[di + 1]); const pos = argv.filter((_, i) => i !== di && i !== di + 1);
  if (pos.length !== 3) throw new Error("Usage: prepare-inspiration-evidence-gap-review-batch <manifest> <supplement> <output> [--database <sqlite>]");
  const [manifestPath, supplement, output] = pos.map((value) => path.resolve(value)); const manifest = Manifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const candidates = new Map((await lines(path.join(supplement, "candidates.jsonl"))).map((value) => Candidate.parse(value)).map(x => [x.candidateId, x]));
  const excluded = new Set(manifest.excludedAssetSha256); const indexed = (await lines(path.join(supplement, "asset-index.jsonl"))).map((value) => Asset.parse(value));
  const byCandidate = new Map<string, z.infer<typeof Asset>[]>(); for (const a of indexed.filter(x => !excluded.has(x.sha256))) byCandidate.set(a.candidate_id, [...(byCandidate.get(a.candidate_id) ?? []), a]);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true }); let rows: z.infer<typeof DbRow>[], strictReviewPackCount: number;
  try {
    rows = z.array(DbRow).parse(db.prepare(`SELECT h.id storageId,h.source_candidate_id sourceCandidateId,h.batch_id batchId,h.review_state reviewState FROM inspiration_wiki_hermes_candidates h LEFT JOIN inspiration_wiki_review_packs p ON p.candidate_id=h.id WHERE p.candidate_id IS NULL ORDER BY h.source_candidate_id`).all());
    strictReviewPackCount = db.prepare("SELECT count(*) FROM inspiration_wiki_review_packs").pluck().get() as number;
  } finally { db.close(); }
  if (strictReviewPackCount !== 98) throw new Error(`GAP_STRICT_COUNT:${strictReviewPackCount}:98`);
  if (rows.length !== manifest.expectedTotal) throw new Error(`GAP_ANTI_JOIN:${rows.length}:${manifest.expectedTotal}`);
  const counts = Object.fromEntries(Sources.map(s => [s, 0])) as Record<Source, number>; rows.forEach(r => counts[sourceOf(r.sourceCandidateId)]++);
  for (const s of Sources) if (counts[s] !== manifest.expectedSourceCounts[s]) throw new Error(`GAP_SOURCE_COUNT:${s}:${counts[s]}`);
  const audits = await loadAudits(manifestPath, manifest); const expectedAudit = rows.filter(r => sourceOf(r.sourceCandidateId) !== "NOTEFOLIO");
  if (audits.size !== expectedAudit.length || expectedAudit.some(r => !audits.has(r.sourceCandidateId))) throw new Error("GAP_AUDIT_SET");
  await mkdir(path.join(output, "assets"), { recursive: true }); const items = []; let assetCount = 0, assetBytes = 0, withMedia = 0;
  for (const row of rows) {
    const c = candidates.get(row.sourceCandidateId); if (!c || c.batchId !== manifest.sourceBatchId || row.batchId !== c.batchId || row.reviewState !== "PENDING_REVIEW") throw new Error(`GAP_CANDIDATE:${row.sourceCandidateId}`);
    if (`hermes-candidate:${hash(`${c.batchId}\0${c.candidateId}`).slice(0, 32)}` !== row.storageId || c.license !== null) throw new Error(`GAP_ID_OR_LICENSE:${row.sourceCandidateId}`);
    const source = sourceOf(row.sourceCandidateId), audit = audits.get(row.sourceCandidateId), assets = [], mediaGroup = [];
    // Evidence-gap packages use one mechanically verified preview, preferring the
    // first source asset. Semantic safety and media-role selection remain manual.
    const sourceAssets = [...(byCandidate.get(row.sourceCandidateId) ?? [])].sort((a, b) => a.sequence - b.sequence).slice(0, 1); if (sourceAssets.length) withMedia++;
    const reviewPackId = `review-pack:gap-${row.storageId.replace("hermes-candidate:", "")}`;
    for (const [i, a] of sourceAssets.entries()) {
      if (a.license !== null || ![null, "UNKNOWN"].includes(a.republication_permission)) throw new Error(`GAP_ASSET_RIGHTS:${a.asset_path}`);
      const sourcePath = path.resolve(supplement, a.asset_path), bytes = await readFile(sourcePath), md = await sharp(bytes).metadata();
      if (!sourcePath.startsWith(`${supplement}${path.sep}`) || bytes.length !== a.byte_size || hash(bytes) !== a.sha256 || md.width !== a.width || md.height !== a.height || md.format !== format(a.mime_type)) throw new Error(`GAP_ASSET_VERIFY:${a.asset_path}`);
      const mediaId = `gap-media-${String(i + 1).padStart(2, "0")}-${a.sha256.slice(0, 12)}`, name = `gap-${row.storageId.slice(-32)}-${mediaId}.${ext(a.mime_type)}`;
      await copyFile(sourcePath, path.join(output, "assets", name)); mediaGroup.push({ mediaId, reviewStatus: "UNVERIFIED" as const, role: null, previewUrl: `/api/teacher/inspiration-wiki/review-packs/${reviewPackId}/media/${mediaId}`, width: a.width, height: a.height, sha256: a.sha256, alt: null });
      assets.push({ mediaId, file: `assets/${name}`, mimeType: a.mime_type, bytes: bytes.length, sha256: a.sha256 }); assetCount++; assetBytes += bytes.length;
    }
    const pageUrl = c.source.canonicalUrl ?? c.source.pageUrl, title = c.content.title;
    const material = { schemaVersion: "lumi-inspiration-evidence-gap-review-pack/v1" as const, contractKind: "EVIDENCE_GAP_REVIEW" as const, reviewPackId, candidateId: row.storageId, revision: 1, stage: "READY_FOR_TEACHER_TRIAGE" as const, preparedAt: manifest.preparedAt,
      work: { title, creators: [], year: null, workSourceMatchEvidence: [] }, sources: [{ sourceId: c.source.sourceId, platform: source, pageUrl, role: "UNVERIFIED" as const, label: null, creatorName: null, curatorName: null, evidenceStatement: null }], mediaGroup,
      rightsEvidence: [{ evidenceId: `rights-gap-${row.storageId.slice(-32)}`, evidenceType: null, sourceUrl: pageUrl, capturedAt: null, summary: null, privateTeacherReviewDecision: null, republicationDecision: null, authorPageIsNotRepublishingPermission: null }],
      normalizedClassification: { primary: null, secondary: [], sourceTerms: c.designCategories }, visualDescription: { summary: null, observations: [] }, duplicateRelationship: { status: "UNASSESSED" as const, relatedCandidateIds: [], explanation: null },
      curationRecommendation: { recommendation: "UNASSESSED" as const, rationale: null }, teachingRecommendation: { recommendation: "UNASSESSED" as const, rationale: null, prompts: [], cautions: [] }, safetyAssessment: { status: audit?.safety ? "BLOCKED" as const : "UNASSESSED" as const, evidence: audit?.safety ? [`See ${audit.id}; safety or privacy remains blocked.`] : [] },
      readiness: readiness(audit, source, mediaGroup.length > 0, title !== null && c.source.canonicalUrl !== null && c.author?.displayName != null, c.designCategories.length > 0), capabilityBoundary: { teacherPrivate: true as const, studentVisible: false as const, currentPage: "DISABLED" as const, r2: "DISABLED" as const, embedding: "DISABLED" as const, lumiRetrieval: "DISABLED" as const } };
    const pack = EvidenceGapReviewPackSchema.parse({ ...material, materialHash: hash(stable(material)) }); items.push({ sourceCandidateId: row.sourceCandidateId, pack, assets });
  }
  const document = { schemaVersion: "lumi-inspiration-evidence-gap-review-pack-import/v1", batchId: manifest.batchId, preparedAt: manifest.preparedAt, items };
  const remainingIds = new Set(rows.map((row) => row.sourceCandidateId));
  const report = { schemaVersion: "lumi-inspiration-evidence-gap-review-package-report/v1", batchId: manifest.batchId, sourceCounts: counts, candidates: items.length, candidatesWithMedia: withMedia, candidatesWithoutMedia: items.length - withMedia, copiedAssets: assetCount, copiedAssetBytes: assetBytes, excludedAssets: indexed.filter(x => remainingIds.has(x.candidate_id) && excluded.has(x.sha256)).length, strictReviewPackAntiJoinCount: strictReviewPackCount, databaseAntiJoin: true, importedToDatabase: false };
  await writeFile(path.join(output, "evidence-gap-review-packs.json"), `${JSON.stringify(document, null, 2)}\n`); await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}
main().catch(e => { console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "GAP_PREPARE_FAILED" })); process.exitCode = 1; });

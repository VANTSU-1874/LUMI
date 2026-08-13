import { constants } from "node:fs";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import Database from "better-sqlite3";
import sharp from "sharp";
import { z } from "zod";

import { createDb } from "../lib/db/client";
import { runMigrations } from "../lib/db/migrate";
import {
  EvidenceGapReviewPackSchema,
  type EvidenceGapReviewPack,
} from "../lib/domain/inspiration-wiki/evidence-gap-review-contracts";
import {
  amendEvidenceGapReviewPackMedia,
  calculateEvidenceGapReviewMaterialHash,
  type EvidenceGapStoredAsset,
} from "../lib/services/inspiration-wiki-evidence-gap-reviews";

const BACKFILL_ID = "notefolio-public-media-backfill-001";
const SOURCE_BATCH_ID = "hermes-2026-08-11-kanban-bulk-008";
const TARGET_CANDIDATE_IDS = [
  "hc-notefolio-b2ad94903a5344c12591692e",
  "hc-notefolio-1cf1297040251ac231859231",
  "hc-notefolio-07b48a063675a62115ae5956",
  "hc-notefolio-aed09970f13e1efa40f2bf39",
  "hc-notefolio-a23fbfc4e2f50e5f30f4ce86",
] as const;
const TARGET_SET = new Set<string>(TARGET_CANDIDATE_IDS);
const CDN_HOST = "cdn-bastani.stunning.kr";
const NOTEFOLIO_HOST = "notefolio.net";
const MAX_REDIRECTS = 3;
const MAX_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const AssetSchema = z.object({
  mediaId: z.string().min(1).max(128),
  file: z.string().regex(/^assets\/[a-z0-9][a-z0-9.-]+\.(?:jpe?g|png|webp)$/),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  bytes: z.number().int().positive().max(MAX_BYTES),
  sha256: Sha256Schema,
}).strict();
const ImportPackageSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-evidence-gap-review-pack-import/v1"),
  batchId: z.string().min(1),
  preparedAt: z.string().datetime(),
  items: z.array(z.object({
    sourceCandidateId: z.string().min(1),
    pack: z.unknown(),
    assets: z.array(AssetSchema).max(20),
  }).strict()).length(102),
}).strict();
const CandidateSchema = z.object({
  schemaVersion: z.literal(1),
  batchId: z.literal(SOURCE_BATCH_ID),
  candidateId: z.string(),
  reviewStatus: z.literal("PENDING_REVIEW"),
  source: z.object({
    sourceId: z.string().min(1),
    pageUrl: z.string().url(),
    canonicalUrl: z.string().url().nullable(),
  }).passthrough(),
  media: z.array(z.object({
    kind: z.literal("IMAGE"),
    sourceUrl: z.string().url(),
  }).passthrough()).length(1),
}).passthrough();
const FailureSchema = z.object({
  candidate_id: z.string(),
  stage: z.string().min(1),
  source_id: z.string().min(1),
  source_page_url: z.string().url(),
  error_type: z.string().min(1),
  reason: z.string().min(1),
  occurred_at: z.string().datetime(),
}).passthrough();
const RedirectSchema = z.object({
  status: z.number().int().min(300).max(399),
  from: z.string().url(),
  to: z.string().url(),
}).strict();
const ResponseContentTypeSchema = z.enum([
  "application/octet-stream",
  "binary/octet-stream",
  "image/jpeg",
  "image/webp",
]);
const ManifestItemSchema = z.object({
  sourceCandidateId: z.string(),
  candidateId: z.string(),
  reviewPackId: z.string(),
  oldRevision: z.number().int().positive(),
  newRevision: z.number().int().positive(),
  oldMaterialHash: Sha256Schema,
  newMaterialHash: Sha256Schema,
  candidateRecordRef: z.string(),
  candidateRecordSha256: Sha256Schema,
  failureRecordRef: z.string(),
  failureRecordSha256: Sha256Schema,
  failureReason: z.string(),
  pageUrl: z.string().url(),
  requestedAssetUrl: z.string().url(),
  finalAssetUrl: z.string().url(),
  redirects: z.array(RedirectSchema).max(MAX_REDIRECTS),
  responseContentType: ResponseContentTypeSchema,
  actualMimeType: z.enum(["image/jpeg", "image/webp"]),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  bytes: z.number().int().positive().max(MAX_BYTES),
  sha256: Sha256Schema,
  mediaId: z.string().min(1).max(128),
  file: z.string().regex(/^assets\/[a-z0-9][a-z0-9.-]+\.(?:jpg|webp)$/),
}).strict();
const ManifestSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-evidence-gap-media-backfill/v1"),
  backfillId: z.literal(BACKFILL_ID),
  createdAt: z.string().datetime(),
  sourceBatchId: z.literal(SOURCE_BATCH_ID),
  immutableInputs: z.object({
    candidates: z.object({ logicalRef: z.string(), sha256: Sha256Schema }).strict(),
    failures: z.object({ logicalRef: z.string(), sha256: Sha256Schema }).strict(),
  }).strict(),
  sourcePackageDigest: Sha256Schema,
  items: z.array(ManifestItemSchema).length(TARGET_CANDIDATE_IDS.length),
}).strict();
const AmendedPacksSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-evidence-gap-media-backfill-packs/v1"),
  backfillId: z.literal(BACKFILL_ID),
  sourcePackageDigest: Sha256Schema,
  items: z.array(z.object({
    sourceCandidateId: z.string(),
    expectedRevision: z.number().int().positive(),
    expectedMaterialHash: Sha256Schema,
    amendedPack: z.unknown(),
    assets: z.array(AssetSchema).length(1),
  }).strict()).length(TARGET_CANDIDATE_IDS.length),
}).strict();
const DoneSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-evidence-gap-media-backfill-done/v1"),
  backfillId: z.literal(BACKFILL_ID),
  sourcePackageDigest: Sha256Schema,
  amendedPacksSha256: Sha256Schema,
  assets: z.array(z.object({ file: z.string(), sha256: Sha256Schema, bytes: z.number().int() }).strict()).length(TARGET_CANDIDATE_IDS.length),
  artifactDigest: Sha256Schema,
  candidateCount: z.literal(TARGET_CANDIDATE_IDS.length),
}).strict();

type Candidate = z.infer<typeof CandidateSchema>;
type Failure = z.infer<typeof FailureSchema>;
type Manifest = z.infer<typeof ManifestSchema>;
type ManifestItem = z.infer<typeof ManifestItemSchema>;
type PackageAsset = z.infer<typeof AssetSchema>;
type AmendedItem = {
  sourceCandidateId: string;
  expectedRevision: number;
  expectedMaterialHash: string;
  amendedPack: EvidenceGapReviewPack;
  assets: PackageAsset[];
};
type JsonlRecord<T> = { parsed: T; raw: string; line: number };

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutMaterialHash(pack: EvidenceGapReviewPack) {
  const material = { ...pack } as Partial<EvidenceGapReviewPack>;
  delete material.materialHash;
  return material as Omit<EvidenceGapReviewPack, "materialHash">;
}

function assertPackHash(pack: EvidenceGapReviewPack) {
  if (calculateEvidenceGapReviewMaterialHash(withoutMaterialHash(pack)) !== pack.materialHash) {
    throw new Error(`BACKFILL_PACK_HASH:${pack.reviewPackId}`);
  }
}

async function exists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readJsonl<T>(filePath: string, schema: z.ZodType<T>) {
  const text = await readFile(filePath, "utf8");
  const records: JsonlRecord<T>[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    records.push({ parsed: schema.parse(JSON.parse(raw)), raw, line: index + 1 });
  }
  return { text, records };
}

function assertUrl(url: string, expectedHost: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== expectedHost || parsed.username || parsed.password) {
    throw new Error(`BACKFILL_UNSAFE_URL:${parsed.origin}`);
  }
  return parsed;
}

function responseMime(raw: string | null) {
  const mime = raw?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const parsed = ResponseContentTypeSchema.safeParse(mime);
  if (!parsed.success) throw new Error(`BACKFILL_RESPONSE_MIME:${mime || "MISSING"}`);
  return parsed.data;
}

function magicMime(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" {
  if (bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  throw new Error("BACKFILL_UNSUPPORTED_MAGIC");
}

async function readBoundedBody(response: Response) {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) {
    throw new Error(`BACKFILL_CONTENT_LENGTH:${declared}`);
  }
  if (!response.body) throw new Error("BACKFILL_EMPTY_BODY");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel("asset exceeds byte limit");
        throw new Error(`BACKFILL_ASSET_TOO_LARGE:${total}`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error("BACKFILL_EMPTY_BODY");
  return Buffer.concat(chunks, total);
}

async function fetchPublicAsset(sourceUrl: string) {
  const initial = assertUrl(sourceUrl, CDN_HOST);
  let current = initial;
  const redirects: z.infer<typeof RedirectSchema>[] = [];
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        Accept: "image/webp,image/jpeg;q=0.9",
        "User-Agent": "Lumi-Inspiration-Private-Review-Media-Backfill/1.0",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === MAX_REDIRECTS) throw new Error("BACKFILL_TOO_MANY_REDIRECTS");
      const location = response.headers.get("location");
      if (!location) throw new Error("BACKFILL_REDIRECT_WITHOUT_LOCATION");
      const next = assertUrl(new URL(location, current).toString(), CDN_HOST);
      redirects.push({ status: response.status, from: current.toString(), to: next.toString() });
      current = next;
      continue;
    }
    if (!response.ok || response.status !== 200) throw new Error(`BACKFILL_HTTP:${response.status}`);
    const responseContentType = responseMime(response.headers.get("content-type"));
    const bytes = await readBoundedBody(response);
    const actualMimeType = magicMime(bytes);
    if (actualMimeType === "image/png") throw new Error("BACKFILL_UNEXPECTED_DOWNLOAD_FORMAT:image/png");
    const decoder = sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 });
    const metadata = await decoder.metadata();
    const expectedFormat = actualMimeType === "image/jpeg" ? "jpeg" : "webp";
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height
      || metadata.width > 10_000 || metadata.height > 10_000) {
      throw new Error(`BACKFILL_DECODE_METADATA:${metadata.format}:${metadata.width}x${metadata.height}`);
    }
    await sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 })
      .resize({ width: 32, height: 32, fit: "inside", withoutEnlargement: true })
      .toBuffer();
    return {
      bytes,
      redirects,
      finalAssetUrl: current.toString(),
      responseContentType,
      actualMimeType,
      width: metadata.width,
      height: metadata.height,
      sha256: hash(bytes),
    };
  }
  throw new Error("BACKFILL_REDIRECT_STATE");
}

function digestMaterial(manifest: Omit<Manifest, "sourcePackageDigest"> | Manifest) {
  return {
    schemaVersion: "lumi-inspiration-evidence-gap-media-backfill-material/v1",
    backfillId: manifest.backfillId,
    sourceBatchId: manifest.sourceBatchId,
    immutableInputs: manifest.immutableInputs,
    items: [...manifest.items].sort((left, right) => left.sourceCandidateId.localeCompare(right.sourceCandidateId, "en")),
  };
}

function doneDigestMaterial(done: Omit<z.infer<typeof DoneSchema>, "artifactDigest">) {
  return { ...done, assets: [...done.assets].sort((left, right) => left.file.localeCompare(right.file, "en")) };
}

function expectedTargetMap<T extends { sourceCandidateId: string }>(items: T[], label: string) {
  const map = new Map(items.map((item) => [item.sourceCandidateId, item]));
  if (map.size !== TARGET_CANDIDATE_IDS.length
    || TARGET_CANDIDATE_IDS.some((candidateId) => !map.has(candidateId))) {
    throw new Error(`BACKFILL_TARGET_SET:${label}`);
  }
  return map;
}

async function sourceRecords(candidatePath: string, failurePath: string) {
  const candidatesInput = await readJsonl(candidatePath, CandidateSchema);
  const failuresInput = await readJsonl(failurePath, FailureSchema);
  const candidates = new Map<string, JsonlRecord<Candidate>>();
  const failures = new Map<string, JsonlRecord<Failure>>();
  for (const record of candidatesInput.records) {
    if (TARGET_SET.has(record.parsed.candidateId)) candidates.set(record.parsed.candidateId, record);
  }
  for (const record of failuresInput.records) {
    if (TARGET_SET.has(record.parsed.candidate_id)) failures.set(record.parsed.candidate_id, record);
  }
  if (candidates.size !== TARGET_CANDIDATE_IDS.length || failures.size !== TARGET_CANDIDATE_IDS.length) {
    throw new Error(`BACKFILL_IMMUTABLE_RECORD_SET:${candidates.size}:${failures.size}`);
  }
  for (const sourceCandidateId of TARGET_CANDIDATE_IDS) {
    const candidate = candidates.get(sourceCandidateId)!.parsed;
    const failure = failures.get(sourceCandidateId)!.parsed;
    if (candidate.source.sourceId !== "notefolio"
      || failure.source_id !== "notefolio"
      || failure.stage !== "ASSET"
      || failure.error_type !== "MIME_MAGIC_MISMATCH") {
      throw new Error(`BACKFILL_SOURCE_CONTRACT:${sourceCandidateId}`);
    }
    const pageUrl = candidate.source.canonicalUrl ?? candidate.source.pageUrl;
    assertUrl(pageUrl, NOTEFOLIO_HOST);
    assertUrl(candidate.media[0].sourceUrl, CDN_HOST);
    if (candidate.source.pageUrl !== failure.source_page_url || pageUrl !== failure.source_page_url) {
      throw new Error(`BACKFILL_FAILURE_SOURCE_MISMATCH:${sourceCandidateId}`);
    }
  }
  return {
    candidateFile: { logicalRef: `${SOURCE_BATCH_ID}/candidates.jsonl`, sha256: hash(candidatesInput.text) },
    failureFile: { logicalRef: "hermes-2026-08-12-kanban-bulk-008-assets-001/failures.jsonl", sha256: hash(failuresInput.text) },
    candidates,
    failures,
  };
}

async function packageDocument(packageDirectory: string) {
  const packagePath = path.join(packageDirectory, "evidence-gap-review-packs.json");
  const parsed = ImportPackageSchema.parse(JSON.parse(await readFile(packagePath, "utf8")));
  const items = parsed.items.map((item) => ({
    ...item,
    pack: EvidenceGapReviewPackSchema.parse(item.pack),
  }));
  const targetItems = expectedTargetMap(items.filter((item) => TARGET_SET.has(item.sourceCandidateId)), "package");
  for (const item of items) assertPackHash(item.pack);
  return { packagePath, parsed: { ...parsed, items }, targetItems };
}

function amendPack(oldPack: EvidenceGapReviewPack, asset: {
  actualMimeType: "image/jpeg" | "image/webp";
  width: number;
  height: number;
  sha256: string;
}) {
  if (oldPack.stage !== "READY_FOR_TEACHER_TRIAGE" || oldPack.mediaGroup.length !== 0
    || oldPack.readiness.controlledMediaGroup.status !== "MISSING") {
    throw new Error(`BACKFILL_PACK_NOT_EMPTY:${oldPack.reviewPackId}`);
  }
  const mediaId = `gap-media-01-${asset.sha256.slice(0, 12)}`;
  const media = {
    mediaId,
    reviewStatus: "UNVERIFIED" as const,
    role: null,
    previewUrl: `/api/teacher/inspiration-wiki/review-packs/${oldPack.reviewPackId}/media/${mediaId}`,
    width: asset.width,
    height: asset.height,
    sha256: asset.sha256,
    alt: null,
  };
  const oldMaterial = withoutMaterialHash(oldPack);
  const material: Omit<EvidenceGapReviewPack, "materialHash"> = {
    ...oldMaterial,
    revision: oldPack.revision + 1,
    mediaGroup: [media],
    readiness: {
      ...oldPack.readiness,
      controlledMediaGroup: {
        status: "PRESENT_UNVERIFIED",
        note: "One public preview passed bounded download, magic-byte, full decoder, hash and dimension checks; its role, pixel content, people/privacy risk and project match remain unverified by a teacher.",
        evidenceRefs: [mediaId, `backfill:${BACKFILL_ID}:${asset.sha256.slice(0, 16)}`],
      },
    },
  };
  const amendedPack = EvidenceGapReviewPackSchema.parse({
    ...material,
    materialHash: calculateEvidenceGapReviewMaterialHash(material),
  });
  return amendedPack;
}

function extension(mime: "image/jpeg" | "image/webp") {
  return mime === "image/jpeg" ? "jpg" : "webp";
}

async function buildArtifact(
  packageDirectory: string,
  artifactDirectory: string,
  records: Awaited<ReturnType<typeof sourceRecords>>,
  packageInput: Awaited<ReturnType<typeof packageDocument>>,
) {
  const oldItems = [...packageInput.targetItems.values()];
  if (oldItems.some((item) => item.pack.mediaGroup.length !== 0 || item.assets.length !== 0)) {
    throw new Error("BACKFILL_SOURCE_PACKAGE_ALREADY_AMENDED");
  }
  const createdAt = new Date().toISOString();
  const fetched = await Promise.all(TARGET_CANDIDATE_IDS.map(async (sourceCandidateId) => ({
    sourceCandidateId,
    fetched: await fetchPublicAsset(records.candidates.get(sourceCandidateId)!.parsed.media[0].sourceUrl),
  })));
  await mkdir(path.dirname(artifactDirectory), { recursive: true });
  const stagingDirectory = await mkdtemp(`${artifactDirectory}.staging-`);
  try {
    await mkdir(path.join(stagingDirectory, "assets"), { recursive: true });
    const manifestItems: ManifestItem[] = [];
    const amendedItems: AmendedItem[] = [];
    for (const result of fetched) {
      const { sourceCandidateId, fetched: asset } = result;
      const packageItem = packageInput.targetItems.get(sourceCandidateId)!;
      const candidateRecord = records.candidates.get(sourceCandidateId)!;
      const failureRecord = records.failures.get(sourceCandidateId)!;
      const amendedPack = amendPack(packageItem.pack, asset);
      const mediaId = amendedPack.mediaGroup[0].mediaId;
      const fileName = `gap-${amendedPack.candidateId.slice(-32)}-${mediaId}.${extension(asset.actualMimeType)}`;
      const file = `assets/${fileName}`;
      await writeFile(path.join(stagingDirectory, "assets", fileName), asset.bytes, { flag: "wx" });
      const packageAsset: PackageAsset = {
        mediaId,
        file,
        mimeType: asset.actualMimeType,
        bytes: asset.bytes.length,
        sha256: asset.sha256,
      };
      manifestItems.push({
        sourceCandidateId,
        candidateId: amendedPack.candidateId,
        reviewPackId: amendedPack.reviewPackId,
        oldRevision: packageItem.pack.revision,
        newRevision: amendedPack.revision,
        oldMaterialHash: packageItem.pack.materialHash,
        newMaterialHash: amendedPack.materialHash,
        candidateRecordRef: `${records.candidateFile.logicalRef}#candidateId=${sourceCandidateId}`,
        candidateRecordSha256: hash(candidateRecord.raw),
        failureRecordRef: `${records.failureFile.logicalRef}#candidate_id=${sourceCandidateId}`,
        failureRecordSha256: hash(failureRecord.raw),
        failureReason: failureRecord.parsed.reason,
        pageUrl: failureRecord.parsed.source_page_url,
        requestedAssetUrl: candidateRecord.parsed.media[0].sourceUrl,
        finalAssetUrl: asset.finalAssetUrl,
        redirects: asset.redirects,
        responseContentType: asset.responseContentType,
        actualMimeType: asset.actualMimeType,
        width: asset.width,
        height: asset.height,
        bytes: asset.bytes.length,
        sha256: asset.sha256,
        mediaId,
        file,
      });
      amendedItems.push({
        sourceCandidateId,
        expectedRevision: packageItem.pack.revision,
        expectedMaterialHash: packageItem.pack.materialHash,
        amendedPack,
        assets: [packageAsset],
      });
    }
    manifestItems.sort((left, right) => left.sourceCandidateId.localeCompare(right.sourceCandidateId, "en"));
    amendedItems.sort((left, right) => left.sourceCandidateId.localeCompare(right.sourceCandidateId, "en"));
    const manifestWithoutDigest = {
      schemaVersion: "lumi-inspiration-evidence-gap-media-backfill/v1" as const,
      backfillId: BACKFILL_ID as typeof BACKFILL_ID,
      createdAt,
      sourceBatchId: SOURCE_BATCH_ID as typeof SOURCE_BATCH_ID,
      immutableInputs: { candidates: records.candidateFile, failures: records.failureFile },
      items: manifestItems,
    };
    const sourcePackageDigest = hash(stableJson(digestMaterial(manifestWithoutDigest)));
    const manifest = ManifestSchema.parse({ ...manifestWithoutDigest, sourcePackageDigest });
    const amendedDocument = AmendedPacksSchema.parse({
      schemaVersion: "lumi-inspiration-evidence-gap-media-backfill-packs/v1",
      backfillId: BACKFILL_ID,
      sourcePackageDigest,
      items: amendedItems,
    });
    const amendedText = `${JSON.stringify(amendedDocument, null, 2)}\n`;
    await writeFile(path.join(stagingDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await writeFile(path.join(stagingDirectory, "amended-packs.json"), amendedText, { flag: "wx" });
    await writeFile(path.join(stagingDirectory, "assets.jsonl"), `${manifestItems.map((item) => JSON.stringify({
      sourceCandidateId: item.sourceCandidateId,
      mediaId: item.mediaId,
      file: item.file,
      mimeType: item.actualMimeType,
      bytes: item.bytes,
      width: item.width,
      height: item.height,
      sha256: item.sha256,
    })).join("\n")}\n`, { flag: "wx" });
    const report = [
      `# ${BACKFILL_ID}`,
      "",
      `- Source package digest: \`${sourcePackageDigest}\``,
      `- Candidates amended: ${manifestItems.length}`,
      `- Assets recovered: ${manifestItems.length}`,
      `- Total bytes: ${manifestItems.reduce((sum, item) => sum + item.bytes, 0)}`,
      "- Header exception: octet-stream is accepted only when JPEG/WebP magic and Sharp decoding agree.",
      "- Review meaning: media remains UNVERIFIED with null role and null alt; this does not establish project match, safety, rights, or republication permission.",
      "- Capability boundary: teacher-private only; student visibility, Current Page, R2, Embedding and Lumi retrieval remain disabled.",
      "",
      "## Items",
      "",
      ...manifestItems.map((item) => `- \`${item.sourceCandidateId}\`: revision ${item.oldRevision} -> ${item.newRevision}; ${item.actualMimeType}; ${item.width}x${item.height}; ${item.bytes} bytes; \`${item.sha256}\`.`),
      "",
    ].join("\n");
    await writeFile(path.join(stagingDirectory, "report.md"), report, { flag: "wx" });
    const doneWithoutDigest = {
      schemaVersion: "lumi-inspiration-evidence-gap-media-backfill-done/v1" as const,
      backfillId: BACKFILL_ID as typeof BACKFILL_ID,
      sourcePackageDigest,
      amendedPacksSha256: hash(amendedText),
      assets: manifestItems.map((item) => ({ file: item.file, sha256: item.sha256, bytes: item.bytes })),
      candidateCount: TARGET_CANDIDATE_IDS.length,
    };
    const done = DoneSchema.parse({
      ...doneWithoutDigest,
      artifactDigest: hash(stableJson(doneDigestMaterial(doneWithoutDigest))),
    });
    await writeFile(path.join(stagingDirectory, "DONE.json"), `${JSON.stringify(done, null, 2)}\n`, { flag: "wx" });
    try {
      await rename(stagingDirectory, artifactDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      try {
        await cp(stagingDirectory, artifactDirectory, { recursive: true, force: false, errorOnExist: true });
        await rm(stagingDirectory, { recursive: true, force: true });
      } catch (copyError) {
        await rm(artifactDirectory, { recursive: true, force: true });
        throw copyError;
      }
    }
    return { manifest, amendedItems };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function verifyAssetFile(
  root: string,
  asset: PackageAsset,
  expectedMedia: EvidenceGapReviewPack["mediaGroup"][number],
) {
  const filePath = path.resolve(root, asset.file);
  if (!filePath.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`BACKFILL_ASSET_PATH:${asset.file}`);
  const bytes = await readFile(filePath);
  if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256 || asset.sha256 !== expectedMedia.sha256) {
    throw new Error(`BACKFILL_ASSET_INTEGRITY:${asset.file}`);
  }
  const actualMime = magicMime(bytes);
  const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
  await sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 })
    .resize({ width: 32, height: 32, fit: "inside", withoutEnlargement: true })
    .toBuffer();
  const expectedFormat = actualMime === "image/jpeg" ? "jpeg" : actualMime.split("/")[1];
  if (actualMime !== asset.mimeType || metadata.format !== expectedFormat
    || metadata.width !== expectedMedia.width || metadata.height !== expectedMedia.height) {
    throw new Error(`BACKFILL_ASSET_DECODE:${asset.file}`);
  }
}

async function loadAndVerifyArtifact(
  artifactDirectory: string,
  records: Awaited<ReturnType<typeof sourceRecords>>,
) {
  const manifestText = await readFile(path.join(artifactDirectory, "manifest.json"), "utf8");
  const amendedText = await readFile(path.join(artifactDirectory, "amended-packs.json"), "utf8");
  const done = DoneSchema.parse(JSON.parse(await readFile(path.join(artifactDirectory, "DONE.json"), "utf8")));
  const manifest = ManifestSchema.parse(JSON.parse(manifestText));
  const amended = AmendedPacksSchema.parse(JSON.parse(amendedText));
  if (manifest.immutableInputs.candidates.sha256 !== records.candidateFile.sha256
    || manifest.immutableInputs.failures.sha256 !== records.failureFile.sha256
    || hash(stableJson(digestMaterial(manifest))) !== manifest.sourcePackageDigest
    || amended.sourcePackageDigest !== manifest.sourcePackageDigest
    || done.sourcePackageDigest !== manifest.sourcePackageDigest
    || hash(amendedText) !== done.amendedPacksSha256) {
    throw new Error("BACKFILL_ARTIFACT_DIGEST");
  }
  const doneWithoutDigest = { ...done } as Partial<typeof done>;
  delete doneWithoutDigest.artifactDigest;
  if (hash(stableJson(doneDigestMaterial(doneWithoutDigest as Omit<typeof done, "artifactDigest">))) !== done.artifactDigest) {
    throw new Error("BACKFILL_DONE_DIGEST");
  }
  const manifestByCandidate = expectedTargetMap(manifest.items, "manifest");
  const items: AmendedItem[] = amended.items.map((item) => ({
    ...item,
    amendedPack: EvidenceGapReviewPackSchema.parse(item.amendedPack),
  }));
  const amendedByCandidate = expectedTargetMap(items, "amended-packs");
  for (const sourceCandidateId of TARGET_CANDIDATE_IDS) {
    const manifestItem = manifestByCandidate.get(sourceCandidateId)!;
    const item = amendedByCandidate.get(sourceCandidateId)!;
    const candidateRecord = records.candidates.get(sourceCandidateId)!;
    const failureRecord = records.failures.get(sourceCandidateId)!;
    assertUrl(manifestItem.pageUrl, NOTEFOLIO_HOST);
    assertUrl(manifestItem.requestedAssetUrl, CDN_HOST);
    assertUrl(manifestItem.finalAssetUrl, CDN_HOST);
    let redirectCursor = manifestItem.requestedAssetUrl;
    for (const redirect of manifestItem.redirects) {
      assertUrl(redirect.from, CDN_HOST);
      assertUrl(redirect.to, CDN_HOST);
      if (![301, 302, 303, 307, 308].includes(redirect.status) || redirect.from !== redirectCursor) {
        throw new Error(`BACKFILL_REDIRECT_CHAIN:${sourceCandidateId}`);
      }
      redirectCursor = redirect.to;
    }
    if (redirectCursor !== manifestItem.finalAssetUrl) throw new Error(`BACKFILL_FINAL_URL:${sourceCandidateId}`);
    if (manifestItem.candidateRecordSha256 !== hash(candidateRecord.raw)
      || manifestItem.failureRecordSha256 !== hash(failureRecord.raw)
      || manifestItem.requestedAssetUrl !== candidateRecord.parsed.media[0].sourceUrl
      || manifestItem.pageUrl !== failureRecord.parsed.source_page_url
      || manifestItem.failureReason !== failureRecord.parsed.reason
      || item.amendedPack.candidateId !== manifestItem.candidateId
      || item.amendedPack.reviewPackId !== manifestItem.reviewPackId
      || item.expectedRevision !== manifestItem.oldRevision
      || item.expectedMaterialHash !== manifestItem.oldMaterialHash
      || manifestItem.newRevision !== manifestItem.oldRevision + 1
      || item.amendedPack.revision !== manifestItem.newRevision
      || item.amendedPack.materialHash !== manifestItem.newMaterialHash
      || item.assets[0].sha256 !== manifestItem.sha256) {
      throw new Error(`BACKFILL_ARTIFACT_CHAIN:${sourceCandidateId}`);
    }
    assertPackHash(item.amendedPack);
    if (item.amendedPack.mediaGroup.length !== 1
      || item.amendedPack.mediaGroup[0].reviewStatus !== "UNVERIFIED"
      || item.amendedPack.mediaGroup[0].role !== null
      || item.amendedPack.mediaGroup[0].alt !== null
      || item.amendedPack.readiness.controlledMediaGroup.status !== "PRESENT_UNVERIFIED") {
      throw new Error(`BACKFILL_MEDIA_SEMANTICS:${sourceCandidateId}`);
    }
    const expectedDoneAsset = done.assets.find((asset) => asset.file === manifestItem.file);
    if (!expectedDoneAsset || expectedDoneAsset.sha256 !== manifestItem.sha256 || expectedDoneAsset.bytes !== manifestItem.bytes) {
      throw new Error(`BACKFILL_DONE_ASSET:${sourceCandidateId}`);
    }
    await verifyAssetFile(artifactDirectory, item.assets[0], item.amendedPack.mediaGroup[0]);
  }
  return { manifest, amendedItems: items };
}

async function ensureExactCopy(source: string, destination: string, expectedSha256: string) {
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (hash(await readFile(destination)) !== expectedSha256) {
      throw new Error(`BACKFILL_EXISTING_ASSET_CONFLICT:${path.basename(destination)}`);
    }
    return false;
  }
}

function storedAsset(databasePath: string, item: AmendedItem): { asset: EvidenceGapStoredAsset; source: string; destination: string } {
  const packageAsset = item.assets[0];
  const slug = item.amendedPack.reviewPackId.replace(/^review-pack:/, "");
  const name = path.basename(packageAsset.file);
  const storagePath = path.posix.join("inspiration-wiki", "evidence-gap-review-packs", "assets", slug, name);
  return {
    asset: {
      mediaId: packageAsset.mediaId,
      storagePath,
      mimeType: packageAsset.mimeType,
      bytes: packageAsset.bytes,
      sha256: packageAsset.sha256,
    },
    source: packageAsset.file,
    destination: path.join(path.dirname(databasePath), ...storagePath.split("/")),
  };
}

async function applyDatabase(
  artifactDirectory: string,
  databasePath: string,
  manifest: Manifest,
  items: AmendedItem[],
) {
  runMigrations(databasePath);
  const copied: string[] = [];
  const prepared: Array<{
    item: AmendedItem;
    stored: ReturnType<typeof storedAsset>;
  }> = [];
  try {
    for (const item of items) {
      const stored = storedAsset(databasePath, item);
      if (await ensureExactCopy(path.join(artifactDirectory, stored.source), stored.destination, stored.asset.sha256)) {
        copied.push(stored.destination);
      }
      prepared.push({ item, stored });
    }
    const connection = createDb(databasePath);
    try {
      const amendedAt = new Date().toISOString();
      const execute = connection.sqlite.transaction(() => prepared.map(({ item, stored }) => (
        amendEvidenceGapReviewPackMedia(connection, {
          expectedRevision: item.expectedRevision,
          expectedMaterialHash: item.expectedMaterialHash,
          idempotencyKey: `gap-media-${manifest.sourcePackageDigest.slice(0, 16)}-${item.sourceCandidateId.slice(-12)}`,
          sourcePackageDigest: manifest.sourcePackageDigest,
          amendedPack: item.amendedPack,
          assets: [stored.asset],
        }, amendedAt)
      )));
      return execute();
    } finally {
      connection.sqlite.close();
    }
  } catch (error) {
    for (const filePath of copied) await rm(filePath, { force: true });
    throw error;
  }
}

async function verifyDatabase(databasePath: string, items: AmendedItem[]) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    for (const item of items) {
      const row = database.prepare(
        `SELECT revision, material_hash, pack_json, media_assets_json, primary_preview_url, stage,
                teacher_private, student_visible, current_page, r2, embedding, lumi_retrieval
         FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id = ?`,
      ).get(item.amendedPack.reviewPackId) as {
        revision: number;
        material_hash: string;
        pack_json: string;
        media_assets_json: string;
        primary_preview_url: string | null;
        stage: string;
        teacher_private: number;
        student_visible: number;
        current_page: string;
        r2: string;
        embedding: string;
        lumi_retrieval: string;
      } | undefined;
      const stored = storedAsset(databasePath, item);
      if (!row || row.revision !== item.amendedPack.revision
        || row.material_hash !== item.amendedPack.materialHash
        || stableJson(JSON.parse(row.pack_json)) !== stableJson(item.amendedPack)
        || row.media_assets_json !== stableJson([stored.asset])
        || row.primary_preview_url !== item.amendedPack.mediaGroup[0].previewUrl
        || row.stage !== "READY_FOR_TEACHER_TRIAGE"
        || row.teacher_private !== 1 || row.student_visible !== 0
        || [row.current_page, row.r2, row.embedding, row.lumi_retrieval].some((value) => value !== "DISABLED")) {
        throw new Error(`BACKFILL_DATABASE_MISMATCH:${item.amendedPack.reviewPackId}`);
      }
      await verifyAssetFile(path.dirname(databasePath), {
        ...item.assets[0],
        file: stored.asset.storagePath,
      }, item.amendedPack.mediaGroup[0]);
    }
  } finally {
    database.close();
  }
}

async function atomicJson(filePath: string, value: unknown) {
  const temporary = `${filePath}.backfill-${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, filePath);
}

async function synchronizePackage(
  packageDirectory: string,
  packageInput: Awaited<ReturnType<typeof packageDocument>>,
  artifactDirectory: string,
  manifest: Manifest,
  amendedItems: AmendedItem[],
  importedToDatabase: boolean,
) {
  const amendedByCandidate = expectedTargetMap(amendedItems, "package-sync");
  let changed = false;
  const nextItems = packageInput.parsed.items.map((item) => {
    const amended = amendedByCandidate.get(item.sourceCandidateId);
    if (!amended) return item;
    const alreadyAmended = item.pack.revision === amended.amendedPack.revision
      && item.pack.materialHash === amended.amendedPack.materialHash
      && stableJson(item.assets) === stableJson(amended.assets);
    if (alreadyAmended) return item;
    if (item.pack.revision !== amended.expectedRevision
      || item.pack.materialHash !== amended.expectedMaterialHash
      || item.pack.mediaGroup.length !== 0 || item.assets.length !== 0) {
      throw new Error(`BACKFILL_PACKAGE_CONFLICT:${item.sourceCandidateId}`);
    }
    changed = true;
    return { sourceCandidateId: item.sourceCandidateId, pack: amended.amendedPack, assets: amended.assets };
  });
  for (const amended of amendedItems) {
    const asset = amended.assets[0];
    await ensureExactCopy(path.join(artifactDirectory, asset.file), path.join(packageDirectory, asset.file), asset.sha256);
  }
  const nextPackage = ImportPackageSchema.parse({ ...packageInput.parsed, items: nextItems });
  if (changed) await atomicJson(packageInput.packagePath, nextPackage);
  const reportPath = path.join(packageDirectory, "report.json");
  const report = z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(reportPath, "utf8")));
  const candidatesWithMedia = nextItems.filter((item) => item.assets.length > 0).length;
  const copiedAssets = nextItems.reduce((sum, item) => sum + item.assets.length, 0);
  const copiedAssetBytes = nextItems.reduce((sum, item) => sum + item.assets.reduce((assetSum, asset) => assetSum + asset.bytes, 0), 0);
  await atomicJson(reportPath, {
    ...report,
    candidatesWithMedia,
    candidatesWithoutMedia: nextItems.length - candidatesWithMedia,
    copiedAssets,
    copiedAssetBytes,
    importedToDatabase: importedToDatabase || report.importedToDatabase === true,
    mediaBackfillId: BACKFILL_ID,
    mediaBackfillSourcePackageDigest: manifest.sourcePackageDigest,
    mediaBackfilledAssets: TARGET_CANDIDATE_IDS.length,
  });
  return { changed, candidatesWithMedia, copiedAssets, copiedAssetBytes };
}

async function verifyPackage(packageDirectory: string, amendedItems: AmendedItem[]) {
  const input = await packageDocument(packageDirectory);
  const amendedByCandidate = expectedTargetMap(amendedItems, "package-verify");
  let assets = 0;
  let bytes = 0;
  for (const item of input.parsed.items) {
    if (item.pack.mediaGroup.length !== item.assets.length) throw new Error(`BACKFILL_PACKAGE_MEDIA_COUNT:${item.sourceCandidateId}`);
    const expectedMedia = new Map(item.pack.mediaGroup.map((media) => [media.mediaId, media]));
    for (const asset of item.assets) {
      const media = expectedMedia.get(asset.mediaId);
      if (!media) throw new Error(`BACKFILL_PACKAGE_MEDIA_ID:${item.sourceCandidateId}`);
      await verifyAssetFile(packageDirectory, asset, media);
      assets += 1;
      bytes += asset.bytes;
    }
    const amended = amendedByCandidate.get(item.sourceCandidateId);
    if (amended && (item.pack.revision !== amended.amendedPack.revision
      || item.pack.materialHash !== amended.amendedPack.materialHash
      || stableJson(item.assets) !== stableJson(amended.assets))) {
      throw new Error(`BACKFILL_PACKAGE_AMENDMENT:${item.sourceCandidateId}`);
    }
  }
  if (input.parsed.items.some((item) => item.assets.length === 0) || assets !== 102) {
    throw new Error(`BACKFILL_PACKAGE_MEDIA_COVERAGE:${assets}`);
  }
  const report = z.record(z.string(), z.unknown()).parse(JSON.parse(await readFile(path.join(packageDirectory, "report.json"), "utf8")));
  if (report.candidatesWithMedia !== 102 || report.candidatesWithoutMedia !== 0
    || report.copiedAssets !== assets || report.copiedAssetBytes !== bytes) {
    throw new Error("BACKFILL_PACKAGE_REPORT");
  }
  return { candidates: input.parsed.items.length, candidatesWithMedia: 102, assets, bytes };
}

function parseArguments() {
  const argv = process.argv.slice(2).filter((argument) => argument !== "--");
  const validateOnly = argv.includes("--validate-only");
  const databaseIndex = argv.indexOf("--database");
  if (databaseIndex >= 0 && !argv[databaseIndex + 1]) throw new Error("BACKFILL_DATABASE_ARGUMENT");
  const databasePath = databaseIndex >= 0 ? path.resolve(argv[databaseIndex + 1]) : null;
  const positions = argv.filter((argument, index) => argument !== "--validate-only"
    && index !== databaseIndex && index !== databaseIndex + 1);
  if (positions.length !== 4) {
    throw new Error("Usage: backfill-inspiration-evidence-gap-review-media <immutable-candidates.jsonl> <immutable-failures.jsonl> <evidence-gap-package-directory> <backfill-artifact-directory> [--database <sqlite>] [--validate-only]");
  }
  return {
    candidatePath: path.resolve(positions[0]),
    failurePath: path.resolve(positions[1]),
    packageDirectory: path.resolve(positions[2]),
    artifactDirectory: path.resolve(positions[3]),
    databasePath,
    validateOnly,
  };
}

async function main() {
  const args = parseArguments();
  const records = await sourceRecords(args.candidatePath, args.failurePath);
  const packageInput = await packageDocument(args.packageDirectory);
  const artifact = args.validateOnly || await exists(args.artifactDirectory)
    ? await loadAndVerifyArtifact(args.artifactDirectory, records)
    : await buildArtifact(args.packageDirectory, args.artifactDirectory, records, packageInput);
  if (args.validateOnly) {
    const packageAudit = await verifyPackage(args.packageDirectory, artifact.amendedItems);
    if (args.databasePath) await verifyDatabase(args.databasePath, artifact.amendedItems);
    console.log(JSON.stringify({
      ok: true,
      validateOnly: true,
      backfillId: BACKFILL_ID,
      sourcePackageDigest: artifact.manifest.sourcePackageDigest,
      ...packageAudit,
      databaseValidated: args.databasePath !== null,
      databaseWrites: 0,
      networkRequests: 0,
    }, null, 2));
    return;
  }
  const databaseResults = args.databasePath
    ? await applyDatabase(args.artifactDirectory, args.databasePath, artifact.manifest, artifact.amendedItems)
    : [];
  const packageAudit = await synchronizePackage(
    args.packageDirectory,
    packageInput,
    args.artifactDirectory,
    artifact.manifest,
    artifact.amendedItems,
    args.databasePath !== null,
  );
  const verified = await verifyPackage(args.packageDirectory, artifact.amendedItems);
  if (args.databasePath) await verifyDatabase(args.databasePath, artifact.amendedItems);
  console.log(JSON.stringify({
    ok: true,
    validateOnly: false,
    backfillId: BACKFILL_ID,
    sourcePackageDigest: artifact.manifest.sourcePackageDigest,
    recoveredAssets: TARGET_CANDIDATE_IDS.length,
    packageChanged: packageAudit.changed,
    ...verified,
    databaseAmendments: databaseResults,
    databaseValidated: args.databasePath !== null,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "BACKFILL_FAILED",
  }));
  process.exitCode = 1;
});

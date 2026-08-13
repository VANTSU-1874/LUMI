import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { StrictReviewPackSchema } from "../lib/domain/inspiration-wiki/review-pack-contracts";
import { calculateReviewPackMaterialHash } from "../lib/services/inspiration-wiki-review-packs";

const AssetIndexRowSchema = z.object({
  candidate_id: z.string().min(1),
  asset_path: z.string().regex(/^assets\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*$/),
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).passthrough();

const CandidateRowSchema = z.object({
  batchId: z.string().min(1),
  candidateId: z.string().min(1),
}).passthrough();

const MediaSelectionSchema = z.object({
  sourceAssetPath: z.string().regex(/^assets\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*$/),
  mediaId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,95}$/),
  role: z.enum(["COVER", "DETAIL", "PROCESS", "CONTEXT"]),
  alt: z.string().trim().min(1).max(240),
}).strict();

const DraftPackageSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-review-pack-curation/v1"),
  batchId: z.string().regex(/^[a-z0-9][a-z0-9-]{7,95}$/),
  preparedAt: z.string().datetime(),
  items: z.array(z.object({
    hermesCandidateId: z.string().min(1),
    pack: z.record(z.string(), z.unknown()),
    media: z.array(MediaSelectionSchema).min(1).max(20),
  }).strict()).min(1).max(30),
}).strict();

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function candidateStorageId(batchId: string, candidateId: string) {
  return `hermes-candidate:${sha256(`${batchId}\0${candidateId}`).slice(0, 32)}`;
}

async function readJsonLines(filePath: string) {
  return (await readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function mimeExtension(mimeType: z.infer<typeof AssetIndexRowSchema>["mime_type"]) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "webp";
}

async function main() {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  if (args.length !== 3) {
    throw new Error("Usage: pnpm inspiration:review-packs:prepare -- <curation.json> <Hermes asset package> <output directory>");
  }
  const [draftPath, sourceDirectory, outputDirectory] = args.map((value) => path.resolve(value));
  const draft = DraftPackageSchema.parse(JSON.parse(await readFile(draftPath, "utf8")));
  const candidates = new Map(
    (await readJsonLines(path.join(sourceDirectory, "candidates.jsonl")))
      .map((value) => CandidateRowSchema.parse(value))
      .map((candidate) => [candidate.candidateId, candidate] as const),
  );
  const assetRows = (await readJsonLines(path.join(sourceDirectory, "asset-index.jsonl")))
    .map((value) => AssetIndexRowSchema.parse(value));
  const assetsByPath = new Map(assetRows.map((asset) => [asset.asset_path, asset] as const));
  const outputAssetsDirectory = path.join(outputDirectory, "assets");
  await mkdir(outputAssetsDirectory, { recursive: true });

  const items = [];
  const seenReviewPackIds = new Set<string>();
  const seenCandidates = new Set<string>();
  for (const draftItem of draft.items) {
    const candidate = candidates.get(draftItem.hermesCandidateId);
    if (!candidate) throw new Error(`CURATION_CANDIDATE_NOT_FOUND:${draftItem.hermesCandidateId}`);
    const reviewPackId = z.string().regex(/^review-pack:[a-z0-9][a-z0-9-]{7,95}$/).parse(draftItem.pack.reviewPackId);
    if (seenReviewPackIds.has(reviewPackId)) throw new Error(`CURATION_REVIEW_PACK_DUPLICATE:${reviewPackId}`);
    if (seenCandidates.has(draftItem.hermesCandidateId)) throw new Error(`CURATION_CANDIDATE_DUPLICATE:${draftItem.hermesCandidateId}`);
    seenReviewPackIds.add(reviewPackId);
    seenCandidates.add(draftItem.hermesCandidateId);

    const packSlug = reviewPackId.replace(/^review-pack:/, "");
    const mediaGroup = [];
    const assets = [];
    for (const selection of draftItem.media) {
      const asset = assetsByPath.get(selection.sourceAssetPath);
      if (!asset || asset.candidate_id !== draftItem.hermesCandidateId) {
        throw new Error(`CURATION_ASSET_NOT_OWNED_BY_CANDIDATE:${selection.sourceAssetPath}`);
      }
      const sourcePath = path.resolve(sourceDirectory, selection.sourceAssetPath);
      if (!sourcePath.startsWith(`${sourceDirectory}${path.sep}`)) throw new Error("CURATION_ASSET_PATH_INVALID");
      const bytes = await readFile(sourcePath);
      if (sha256(bytes) !== asset.sha256) throw new Error(`CURATION_ASSET_HASH_MISMATCH:${selection.sourceAssetPath}`);
      const extension = mimeExtension(asset.mime_type);
      const outputName = `${packSlug}-${selection.mediaId}.${extension}`;
      await copyFile(sourcePath, path.join(outputAssetsDirectory, outputName));
      mediaGroup.push({
        mediaId: selection.mediaId,
        role: selection.role,
        previewUrl: `/api/teacher/inspiration-wiki/review-packs/${reviewPackId}/media/${selection.mediaId}`,
        width: asset.width,
        height: asset.height,
        sha256: asset.sha256,
        alt: selection.alt,
      });
      assets.push({ mediaId: selection.mediaId, file: `assets/${outputName}`, mimeType: asset.mime_type });
    }

    const material = {
      ...draftItem.pack,
      schemaVersion: "lumi-inspiration-review-pack/v1",
      candidateId: candidateStorageId(candidate.batchId, candidate.candidateId),
      revision: 1,
      stage: "READY_FOR_TEACHER_REVIEW",
      preparedAt: draft.preparedAt,
      mediaGroup,
      readiness: {
        controlledMediaGroup: true,
        workSourceMatch: true,
        sourceRole: true,
        rightsEvidence: true,
        normalizedClassification: true,
        visualDescription: true,
        duplicateRelationship: true,
        curationRecommendation: true,
        teachingRecommendation: true,
      },
      capabilityBoundary: {
        teacherPrivate: true,
        studentVisible: false,
        currentPage: "DISABLED",
        r2: "DISABLED",
        embedding: "DISABLED",
        lumiRetrieval: "DISABLED",
      },
    };
    const pack = StrictReviewPackSchema.parse({
      ...material,
      materialHash: calculateReviewPackMaterialHash(material as never),
    });
    const outputPack = { ...pack } as Record<string, unknown>;
    delete outputPack.materialHash;
    items.push({ pack: outputPack, assets });
  }

  await writeFile(path.join(outputDirectory, "review-packs.json"), `${JSON.stringify({
    schemaVersion: "lumi-inspiration-review-pack-import/v1",
    batchId: draft.batchId,
    items,
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, batchId: draft.batchId, items: items.length, assets: items.reduce((sum, item) => sum + item.assets.length, 0) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

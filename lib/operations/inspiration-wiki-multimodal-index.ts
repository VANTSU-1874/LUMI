import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { InspirationBrowseItem } from "@/lib/domain/inspiration-browser";
import { FormalReleaseAssetSchema, FormalReleaseSchema } from "@/lib/domain/inspiration-wiki/formal-release-contracts";
import { hashWikiValue, stableWikiJson } from "@/lib/domain/inspiration-wiki/integrity";
import {
  WIKI_MULTIMODAL_ENCODER_VERSION,
  WIKI_MULTIMODAL_INDEX_ID,
  WIKI_MULTIMODAL_SCHEMA_VERSION,
  WikiMultimodalIndexSchema,
  type WikiMultimodalIndexMaterial,
} from "@/lib/domain/inspiration-wiki/multimodal-retrieval-contracts";
import { studentItemText, textFeatureVector, visualFeatureVector, TEXT_VECTOR_DIMENSIONS, VISUAL_VECTOR_DIMENSIONS } from "@/lib/services/inspiration-wiki-multimodal";

type BundleRow = { table: string; row: Record<string, string | number | null> };
type BundleManifest = {
  bundleId: string;
  bundleDigest: string;
  releaseCount: number;
  assets: Array<{ storagePath: string; bundlePath: string; bytes: number; sha256: string; mimeType: string }>;
};

function parseRows(bundleRoot: string) {
  return readFileSync(path.join(bundleRoot, "rows.jsonl"), "utf8").trim().split("\n")
    .map((line) => JSON.parse(line) as BundleRow);
}

function parseObject(value: unknown, code: string) {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(code);
  return parsed as Record<string, unknown>;
}

function parseArray(value: unknown, code: string) {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) throw new Error(code);
  return parsed;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function buildInspirationWikiMultimodalIndex(input: { bundleRoot: string; outputRoot: string }) {
  const bundleRoot = path.resolve(input.bundleRoot);
  const outputRoot = path.resolve(input.outputRoot);
  const stagingRoot = `${outputRoot}.staging`;
  if (existsSync(outputRoot)) throw new Error("WIKI_MULTIMODAL_OUTPUT_ALREADY_EXISTS");
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });
  try {
    const manifest = JSON.parse(readFileSync(path.join(bundleRoot, "manifest.json"), "utf8")) as BundleManifest;
    if (manifest.releaseCount !== 177 || !/^[a-f0-9]{64}$/.test(manifest.bundleDigest)) throw new Error("WIKI_MULTIMODAL_SOURCE_BUNDLE_INVALID");
    const rows = parseRows(bundleRoot);
    const revisions = new Map(rows.filter(({ table }) => table === "inspiration_wiki_canonical_page_revisions")
      .map(({ row }) => [String(row.canonical_revision_id), row]));
    const latestEvents = new Map<string, { eventType: string; createdAt: number; eventId: string }>();
    for (const { row } of rows.filter(({ table }) => table === "inspiration_wiki_current_page_events")) {
      const canonicalPageId = String(row.canonical_page_id);
      const candidate = { eventType: String(row.event_type), createdAt: Number(row.created_at), eventId: String(row.event_id) };
      const previous = latestEvents.get(canonicalPageId);
      if (!previous || candidate.createdAt > previous.createdAt || (candidate.createdAt === previous.createdAt && candidate.eventId > previous.eventId)) latestEvents.set(canonicalPageId, candidate);
    }
    const bundleAssets = new Map(manifest.assets.map((asset) => [asset.storagePath, asset]));
    const activeReleases = rows.filter(({ table, row }) => table === "inspiration_wiki_formal_releases" && latestEvents.get(String(row.canonical_page_id))?.eventType === "ACTIVATED")
      .map(({ row }) => ({ row, release: FormalReleaseSchema.parse(parseObject(row.release_json, "WIKI_MULTIMODAL_RELEASE_JSON_INVALID")) }))
      .sort((left, right) => left.release.publicMaterial.publicId.localeCompare(right.release.publicMaterial.publicId));
    if (activeReleases.length !== manifest.releaseCount) throw new Error("WIKI_MULTIMODAL_ACTIVE_RELEASE_COUNT_MISMATCH");
    const entries = [];
    for (const { row, release } of activeReleases) {
      const revision = revisions.get(String(row.canonical_revision_id));
      if (!revision) throw new Error("WIKI_MULTIMODAL_REVISION_MISSING");
      const asset = parseArray(revision.assets_json, "WIKI_MULTIMODAL_ASSETS_INVALID")
        .map((value) => FormalReleaseAssetSchema.parse(value))
        .find((value) => value.mediaId === release.publicMaterial.preview.mediaId);
      if (!asset) throw new Error("WIKI_MULTIMODAL_PREVIEW_ASSET_MISSING");
      const bundleAsset = bundleAssets.get(asset.storagePath);
      if (!bundleAsset || bundleAsset.sha256 !== asset.sha256 || bundleAsset.bytes !== asset.bytes) throw new Error("WIKI_MULTIMODAL_ASSET_MANIFEST_MISMATCH");
      const bytes = readFileSync(path.join(bundleRoot, bundleAsset.bundlePath));
      if (bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error("WIKI_MULTIMODAL_ASSET_HASH_MISMATCH");
      const material = release.publicMaterial;
      const item: InspirationBrowseItem = {
        id: material.publicId,
        title: material.title,
        description: material.description,
        tags: material.tags,
        courseAssociations: material.courseAssociations,
        source: material.source,
        attributionNotice: material.attributionNotice,
        preview: "CONTROLLED",
        previewUrl: material.preview.previewUrl,
      };
      entries.push({
        publicId: material.publicId,
        releaseId: release.releaseId,
        canonicalPageId: release.canonicalPageId,
        assetSha256: asset.sha256,
        item,
        visualVector: await visualFeatureVector(bytes),
        textVector: textFeatureVector(studentItemText(item)),
      });
    }
    const releaseSetHash = hashWikiValue(entries.map(({ canonicalPageId, releaseId, publicId }) => ({ canonicalPageId, releaseId, publicId })));
    const material: WikiMultimodalIndexMaterial = {
      schemaVersion: WIKI_MULTIMODAL_SCHEMA_VERSION,
      indexId: WIKI_MULTIMODAL_INDEX_ID,
      encoderVersion: WIKI_MULTIMODAL_ENCODER_VERSION,
      sourceReleaseBundleId: manifest.bundleId,
      sourceReleaseBundleDigest: manifest.bundleDigest,
      releaseSetHash,
      visualDimensions: VISUAL_VECTOR_DIMENSIONS,
      textDimensions: TEXT_VECTOR_DIMENSIONS,
      itemCount: entries.length,
      rightsEvidenceRef: "USER_AUTHORIZATION:2026-08-16:WIKI-SELF-MULTIMODAL-177",
      capabilityBoundary: {
        authenticatedStudentWiki: "ACTIVE",
        textToImage: "ACTIVE",
        imageToImage: "ACTIVE",
        imageTextToImage: "ACTIVE",
        externalProvider: "DISABLED",
        externalDataEgress: "DISABLED",
        anonymousAccess: "DISABLED",
        r2: "DISABLED",
        lumiRetrieval: "DISABLED",
      },
      entries,
    };
    const index = WikiMultimodalIndexSchema.parse({ ...material, indexHash: hashWikiValue(material) });
    writeFileSync(path.join(stagingRoot, "index.json"), `${stableWikiJson(index)}\n`, { flag: "wx" });
    writeFileSync(path.join(stagingRoot, "manifest.json"), `${JSON.stringify({
      schemaVersion: WIKI_MULTIMODAL_SCHEMA_VERSION,
      indexId: index.indexId,
      indexHash: index.indexHash,
      releaseSetHash: index.releaseSetHash,
      itemCount: index.itemCount,
      encoderVersion: index.encoderVersion,
      sourceReleaseBundleId: index.sourceReleaseBundleId,
      sourceReleaseBundleDigest: index.sourceReleaseBundleDigest,
      capabilityBoundary: index.capabilityBoundary,
    }, null, 2)}\n`, { flag: "wx" });
    writeFileSync(path.join(stagingRoot, "report.md"), `# Lumi Inspiration Wiki 多模态索引\n\n- 正式案例：${index.itemCount}\n- 图像特征维度：${index.visualDimensions}\n- 文字特征维度：${index.textDimensions}\n- 编码器：${index.encoderVersion}\n- 运行位置：Lumi 本地服务进程\n- 外部 Provider / 数据外发：关闭\n- R2 / Lumi 回答链：关闭\n- Index hash: \`${index.indexHash}\`\n`, { flag: "wx" });
    writeFileSync(path.join(stagingRoot, "DONE.json"), `${JSON.stringify({ schemaVersion: "lumi-inspiration-wiki-multimodal-done/v1", indexId: index.indexId, indexHash: index.indexHash, status: "READY" }, null, 2)}\n`, { flag: "wx" });
    renameSync(stagingRoot, outputRoot);
    return { index, outputRoot };
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

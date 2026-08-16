import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import type { DatabaseConnection } from "@/lib/db/client";
import { inspirationWikiFormalReleases } from "@/lib/db/schema";
import type { InspirationBrowseItem } from "@/lib/domain/inspiration-browser";
import { FormalReleaseSchema } from "@/lib/domain/inspiration-wiki/formal-release-contracts";
import { hashWikiValue } from "@/lib/domain/inspiration-wiki/integrity";
import { readLatestInspirationCurrentPageStates } from "@/lib/services/inspiration-current-page";
import {
  WIKI_MULTIMODAL_ENCODER_VERSION,
  WIKI_MULTIMODAL_INDEX_ID,
  WikiMultimodalDoneSchema,
  WikiMultimodalIndexSchema,
  type WikiMultimodalIndex,
  type WikiMultimodalSearchResponse,
} from "@/lib/domain/inspiration-wiki/multimodal-retrieval-contracts";
import { readPublishedInspirationBrowser } from "@/lib/services/inspiration-browser";
import { p2StudentChannelBlocksStudentRead } from "@/lib/services/inspiration-wiki-p2-student-channels";

export const VISUAL_VECTOR_DIMENSIONS = 496;
export const TEXT_VECTOR_DIMENSIONS = 512;
export const DEFAULT_WIKI_MULTIMODAL_INDEX_ROOT = path.join(
  process.cwd(),
  "data",
  "inspiration-wiki",
  "multimodal-index",
  WIKI_MULTIMODAL_INDEX_ID,
);

function unitVector(values: number[]) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) return values.map(() => 0);
  return values.map((value) => Number((value / norm).toFixed(8)));
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function textFeatureVector(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
  const vector = Array<number>(TEXT_VECTOR_DIMENSIONS).fill(0);
  const units = normalized.match(/[\p{Script=Han}]|[a-z0-9]+/gu) ?? [];
  const features = [
    ...units.map((unit) => `u:${unit}`),
    ...units.slice(0, -1).map((unit, index) => `b:${unit}|${units[index + 1]}`),
    ...units.slice(0, -2).map((unit, index) => `t:${unit}|${units[index + 1]}|${units[index + 2]}`),
  ];
  for (const feature of features) {
    const hash = fnv1a(feature);
    const bucket = hash % TEXT_VECTOR_DIMENSIONS;
    vector[bucket] = (vector[bucket] ?? 0) + ((hash & 0x80000000) === 0 ? 1 : -1);
  }
  return unitVector(vector);
}

export function studentItemText(item: InspirationBrowseItem) {
  return [
    item.title,
    item.description ?? "",
    ...item.tags,
    ...item.courseAssociations.flatMap((association) => [association.coursePackId, ...association.facets]),
    item.source.label,
  ].join(" ");
}

export async function visualFeatureVector(bytes: Buffer) {
  const image = sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new Error("WIKI_MULTIMODAL_IMAGE_FORMAT_UNSUPPORTED");
  }
  const { data, info } = await image
    .rotate()
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .resize(12, 12, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 12 || info.height !== 12 || info.channels !== 3) throw new Error("WIKI_MULTIMODAL_IMAGE_DECODE_FAILED");
  const features: number[] = [];
  const histograms = Array.from({ length: 4 }, () => Array<number>(16).fill(0));
  for (let index = 0; index < data.length; index += 3) {
    const red = data[index]!;
    const green = data[index + 1]!;
    const blue = data[index + 2]!;
    features.push(red / 127.5 - 1, green / 127.5 - 1, blue / 127.5 - 1);
    histograms[0]![Math.min(15, Math.floor(red / 16))]! += 1;
    histograms[1]![Math.min(15, Math.floor(green / 16))]! += 1;
    histograms[2]![Math.min(15, Math.floor(blue / 16))]! += 1;
    const luminance = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
    histograms[3]![Math.min(15, Math.floor(luminance / 16))]! += 1;
  }
  for (const histogram of histograms) features.push(...histogram.map((count) => count / 144));
  if (features.length !== VISUAL_VECTOR_DIMENSIONS) throw new Error("WIKI_MULTIMODAL_VISUAL_DIMENSIONS_INVALID");
  return unitVector(features);
}

function cosine(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length) return 0;
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function lexicalScore(item: InspirationBrowseItem, query: string) {
  const normalized = query.normalize("NFKC").toLocaleLowerCase("zh-CN").trim();
  if (!normalized) return 0;
  const surface = studentItemText(item).normalize("NFKC").toLocaleLowerCase("zh-CN");
  if (surface.includes(normalized)) return 1;
  const tokens = normalized.match(/[\p{Script=Han}]{1,}|[a-z0-9]+/gu) ?? [];
  if (tokens.length === 0) return 0;
  return tokens.filter((token) => surface.includes(token)).length / tokens.length;
}

function indexMaterial(index: WikiMultimodalIndex) {
  return Object.fromEntries(Object.entries(index).filter(([key]) => key !== "indexHash"));
}

export function loadWikiMultimodalIndex(indexRoot = DEFAULT_WIKI_MULTIMODAL_INDEX_ROOT) {
  try {
    const index = WikiMultimodalIndexSchema.parse(JSON.parse(readFileSync(path.join(indexRoot, "index.json"), "utf8")));
    const done = WikiMultimodalDoneSchema.parse(JSON.parse(readFileSync(path.join(indexRoot, "DONE.json"), "utf8")));
    if (hashWikiValue(indexMaterial(index)) !== index.indexHash || done.indexHash !== index.indexHash) return null;
    return index;
  } catch {
    return null;
  }
}

export function activeWikiMultimodalReleaseIdentity(db: DatabaseConnection["db"]) {
  const latest = readLatestInspirationCurrentPageStates(db);
  const active = db.select({
    canonicalPageId: inspirationWikiFormalReleases.canonicalPageId,
    releaseId: inspirationWikiFormalReleases.releaseId,
    releaseJson: inspirationWikiFormalReleases.releaseJson,
  }).from(inspirationWikiFormalReleases).all().flatMap((row) => {
    if (latest.get(row.canonicalPageId) !== "ACTIVATED") return [];
    const release = FormalReleaseSchema.parse(row.releaseJson);
    return [{ canonicalPageId: row.canonicalPageId, releaseId: row.releaseId, publicId: release.publicMaterial.publicId }];
  }).sort((left, right) => left.publicId.localeCompare(right.publicId));
  return { active, releaseSetHash: hashWikiValue(active.map(({ canonicalPageId, releaseId, publicId }) => ({ canonicalPageId, releaseId, publicId }))) };
}

function topicMatches(item: InspirationBrowseItem, topic?: string | null) {
  if (!topic || topic === "全部") return true;
  return item.tags.includes(topic) || item.courseAssociations.some((association) => association.facets.includes(topic));
}

export async function searchWikiMultimodal(
  db: DatabaseConnection["db"],
  input: { query?: string | null; topic?: string | null; image?: Buffer | null; imageVector?: number[] | null; limit?: number; indexRoot?: string },
): Promise<WikiMultimodalSearchResponse> {
  const query = input.query?.normalize("NFKC").trim().slice(0, 160) ?? "";
  const image = input.image ?? null;
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 24);
  const mode = image && query ? "IMAGE_TEXT_TO_IMAGE" : image ? "IMAGE_TO_IMAGE" : "TEXT_TO_IMAGE";
  if (p2StudentChannelBlocksStudentRead(db)) {
    return { items: [], appliedFacets: [], retrieval: { mode, state: "DEGRADED", indexId: null, encoderVersion: null, resultCount: 0, notice: "学生通道当前不可用，未返回任何私有或待审核材料。" } };
  }
  const configuredIndexRoot = process.env.INSPIRATION_WIKI_MULTIMODAL_INDEX_ROOT?.trim();
  const index = loadWikiMultimodalIndex((input.indexRoot ?? configuredIndexRoot) || DEFAULT_WIKI_MULTIMODAL_INDEX_ROOT);
  if (!index) {
    const fallback = query ? readPublishedInspirationBrowser(db, { query, topic: input.topic, limit }) : { items: [], appliedFacets: [], nextCursor: null };
    return {
      items: fallback.items.map((item) => ({ ...item, retrieval: { score: 1, channels: ["文字特征" as const] } })),
      appliedFacets: fallback.appliedFacets,
      retrieval: { mode: "TEXT_FALLBACK", state: "DEGRADED", indexId: null, encoderVersion: null, resultCount: fallback.items.length, notice: image ? "图像索引暂时不可用，已安全降级为文字检索。" : "多模态索引暂时不可用，已保留原有文字检索。" },
    };
  }
  const identity = activeWikiMultimodalReleaseIdentity(db);
  const activeIds = new Set(identity.active.map(({ publicId }) => publicId));
  const textVector = query ? textFeatureVector(query) : null;
  const visualVector = input.imageVector ?? (image ? await visualFeatureVector(image) : null);
  if (visualVector && visualVector.length !== VISUAL_VECTOR_DIMENSIONS) throw new Error("WIKI_MULTIMODAL_VISUAL_DIMENSIONS_INVALID");
  const channels = [textVector ? "文字特征" as const : null, visualVector ? "图像特征" as const : null].filter((value): value is "文字特征" | "图像特征" => value !== null);
  const scored = index.entries.flatMap((entry) => {
    if (!activeIds.has(entry.publicId) || !topicMatches(entry.item, input.topic)) return [];
    const textCosine = textVector ? Math.max(0, cosine(textVector, entry.textVector)) : 0;
    const lexical = textVector ? lexicalScore(entry.item, query) : 0;
    const textScore = textVector ? Math.min(1, textCosine * 0.65 + lexical * 0.35) : 0;
    const imageScore = visualVector ? Math.max(0, Math.min(1, (cosine(visualVector, entry.visualVector) + 1) / 2)) : 0;
    const score = textVector && visualVector ? imageScore * 0.58 + textScore * 0.42 : visualVector ? imageScore : textScore;
    if (textVector && !visualVector && score < 0.035) return [];
    return [{ item: { ...entry.item, retrieval: { score: Number(score.toFixed(6)), channels } }, score }];
  }).sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id)).slice(0, limit);
  const stale = identity.releaseSetHash !== index.releaseSetHash;
  return {
    items: scored.map(({ item }) => item),
    appliedFacets: input.topic && input.topic !== "全部" ? [input.topic] : [],
    retrieval: {
      mode,
      state: stale ? "DEGRADED" : "READY",
      indexId: WIKI_MULTIMODAL_INDEX_ID,
      encoderVersion: WIKI_MULTIMODAL_ENCODER_VERSION,
      resultCount: scored.length,
      notice: stale ? "索引版本与当前页面集合存在差异；结果已按当前有效页面实时过滤。" : mode === "TEXT_TO_IMAGE" ? "已按作品文字、标签与来源特征检索受控图片。" : mode === "IMAGE_TO_IMAGE" ? "已按本地图像构图与色彩特征查找相似作品。" : "已合并图片与文字特征进行排序。",
    },
  };
}

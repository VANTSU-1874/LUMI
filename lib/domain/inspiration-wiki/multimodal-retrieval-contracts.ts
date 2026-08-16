import { z } from "zod";

import { InspirationBrowseResponseSchema } from "@/lib/domain/inspiration-browser";

export const WIKI_MULTIMODAL_SCHEMA_VERSION = "lumi-inspiration-wiki-multimodal-index/v1" as const;
export const WIKI_MULTIMODAL_ENCODER_VERSION = "lumi-local-dual-feature-v1" as const;
export const WIKI_MULTIMODAL_INDEX_ID = "wiki-multimodal-177-v1" as const;

const VectorSchema = z.array(z.number().finite().min(-1).max(1)).min(1).max(1024);
const BrowserItemSchema = InspirationBrowseResponseSchema.shape.items.element;

export const WikiMultimodalIndexEntrySchema = z.object({
  publicId: z.string().regex(/^inspiration:[a-f0-9]{24}$/),
  releaseId: z.string().regex(/^wiki-release:[a-f0-9]{32}$/),
  canonicalPageId: z.string().regex(/^wiki-page:[a-f0-9]{32}$/),
  assetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  item: BrowserItemSchema,
  visualVector: VectorSchema,
  textVector: VectorSchema,
}).strict();

export const WikiMultimodalIndexMaterialSchema = z.object({
  schemaVersion: z.literal(WIKI_MULTIMODAL_SCHEMA_VERSION),
  indexId: z.literal(WIKI_MULTIMODAL_INDEX_ID),
  encoderVersion: z.literal(WIKI_MULTIMODAL_ENCODER_VERSION),
  sourceReleaseBundleId: z.string().trim().min(1).max(120),
  sourceReleaseBundleDigest: z.string().regex(/^[a-f0-9]{64}$/),
  releaseSetHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  visualDimensions: z.number().int().positive().max(1024),
  textDimensions: z.number().int().positive().max(1024),
  itemCount: z.number().int().positive().max(10_000),
  rightsEvidenceRef: z.literal("USER_AUTHORIZATION:2026-08-16:WIKI-SELF-MULTIMODAL-177"),
  capabilityBoundary: z.object({
    authenticatedStudentWiki: z.literal("ACTIVE"),
    textToImage: z.literal("ACTIVE"),
    imageToImage: z.literal("ACTIVE"),
    imageTextToImage: z.literal("ACTIVE"),
    externalProvider: z.literal("DISABLED"),
    externalDataEgress: z.literal("DISABLED"),
    anonymousAccess: z.literal("DISABLED"),
    r2: z.literal("DISABLED"),
    lumiRetrieval: z.literal("DISABLED"),
  }).strict(),
  entries: z.array(WikiMultimodalIndexEntrySchema).min(1).max(10_000),
}).strict().superRefine((value, context) => {
  if (value.itemCount !== value.entries.length) {
    context.addIssue({ code: "custom", path: ["itemCount"], message: "Index item count does not match entries" });
  }
  const publicIds = new Set<string>();
  for (const [index, entry] of value.entries.entries()) {
    if (entry.item.id !== entry.publicId) context.addIssue({ code: "custom", path: ["entries", index, "item", "id"], message: "Public item identity mismatch" });
    if (entry.visualVector.length !== value.visualDimensions) context.addIssue({ code: "custom", path: ["entries", index, "visualVector"], message: "Visual vector dimensions mismatch" });
    if (entry.textVector.length !== value.textDimensions) context.addIssue({ code: "custom", path: ["entries", index, "textVector"], message: "Text vector dimensions mismatch" });
    if (publicIds.has(entry.publicId)) context.addIssue({ code: "custom", path: ["entries", index, "publicId"], message: "Duplicate public item" });
    publicIds.add(entry.publicId);
  }
});

export const WikiMultimodalIndexSchema = WikiMultimodalIndexMaterialSchema.extend({
  indexHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

export const WikiMultimodalDoneSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-wiki-multimodal-done/v1"),
  indexId: z.literal(WIKI_MULTIMODAL_INDEX_ID),
  indexHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  status: z.literal("READY"),
}).strict();

export const WikiMultimodalSearchResponseSchema = z.object({
  items: z.array(BrowserItemSchema.extend({
    retrieval: z.object({
      score: z.number().min(0).max(1),
      channels: z.array(z.enum(["文字特征", "图像特征"])).min(1).max(2),
    }).strict(),
  }).strict()).max(24),
  appliedFacets: z.array(z.string().min(1).max(80)).max(8),
  retrieval: z.object({
    mode: z.enum(["TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_TEXT_TO_IMAGE", "TEXT_FALLBACK"]),
    state: z.enum(["READY", "DEGRADED"]),
    indexId: z.literal(WIKI_MULTIMODAL_INDEX_ID).nullable(),
    encoderVersion: z.literal(WIKI_MULTIMODAL_ENCODER_VERSION).nullable(),
    resultCount: z.number().int().nonnegative().max(24),
    notice: z.string().trim().min(1).max(240),
  }).strict(),
}).strict();

export type WikiMultimodalIndex = z.infer<typeof WikiMultimodalIndexSchema>;
export type WikiMultimodalIndexMaterial = z.infer<typeof WikiMultimodalIndexMaterialSchema>;
export type WikiMultimodalSearchResponse = z.infer<typeof WikiMultimodalSearchResponseSchema>;

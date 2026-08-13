import { z } from "zod";

import { WikiOpaqueIdSchema, WikiSha256Schema } from "./core-contracts";

const SafeSourceTextSchema = z.string().trim().min(1).max(2_000);
const SafeRawTermSchema = z.string().trim().min(1).max(160);
const SafeMimeTypeSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i);

function hasSuspiciousAccessQuery(url: URL) {
  return [...url.searchParams.keys()].some((key) => /(?:^|_)(?:auth|authorization|cookie|credential|key|password|session|signature|token)(?:$|_)/i.test(key));
}

export const HermesPublicSourceUrlSchema = z.string().trim().max(2_048).url().superRefine((value, context) => {
  const url = new URL(value);
  const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    context.addIssue({ code: "custom", message: "HERMES_SOURCE_URL_MUST_BE_CREDENTIAL_FREE_HTTPS" });
  }
  if (
    hostname === "localhost"
    || hostname.endsWith(".local")
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
    || hostname.includes(":")
    || !hostname.includes(".")
  ) {
    context.addIssue({ code: "custom", message: "HERMES_SOURCE_URL_MUST_USE_PUBLIC_DNS" });
  }
  if (hasSuspiciousAccessQuery(url)) {
    context.addIssue({ code: "custom", message: "HERMES_SOURCE_URL_ACCESS_QUERY_FORBIDDEN" });
  }
});

export const HermesDesignCategorySchema = z.enum([
  "BRANDING",
  "TYPOGRAPHY",
  "EDITORIAL",
  "PRINT",
  "PACKAGING",
  "WEB_INTERFACE",
  "INTERACTION_DESIGN",
  "PRODUCT",
  "MOTION",
  "ILLUSTRATION",
  "THREE_D",
  "SPATIAL",
  "IMMERSIVE_EXPERIENCE",
  "INFORMATION_DESIGN",
  "SERVICE_DESIGN",
  "EXPERIMENTAL_DESIGN",
  "GENERATIVE_DESIGN",
  "FASHION",
  "ART_DIRECTION",
  "OTHER",
]);

export const HermesWorkModalitySchema = z.enum([
  "STATIC",
  "TIME_BASED",
  "INTERACTIVE",
  "REALTIME_GENERATIVE",
  "IMMERSIVE",
  "SPATIAL_INTERACTIVE",
  "AUDIO_RESPONSIVE",
]);

export const HermesDynamicWorkModalitySchema = z.enum([
  "TIME_BASED",
  "INTERACTIVE",
  "REALTIME_GENERATIVE",
  "IMMERSIVE",
  "SPATIAL_INTERACTIVE",
  "AUDIO_RESPONSIVE",
]);

export const HermesMediaKindSchema = z.enum([
  "IMAGE",
  "ANIMATED_IMAGE",
  "VIDEO",
  "AUDIO",
  "INTERACTIVE_URL",
  "THREE_D_MODEL",
  "DOCUMENT",
]);

export const HermesMediaRoleSchema = z.enum([
  "HERO",
  "DETAIL",
  "PROCESS",
  "APPLICATION",
  "POSTER_FRAME",
  "MOTION_PREVIEW",
  "SCREEN_RECORDING",
  "INTERACTION_DEMO",
  "LIVE_INTERACTIVE_ENDPOINT",
  "AUDIO_SAMPLE",
  "THREE_D_VIEW",
  "TECHNICAL_DOCUMENTATION",
]);

export const HermesSourceTaxonomyPathSchema = z.object({
  pathId: WikiOpaqueIdSchema,
  labels: z.array(SafeRawTermSchema).min(1).max(12).readonly(),
  sourceUrl: HermesPublicSourceUrlSchema,
  observedAt: z.string().datetime(),
}).strict().readonly();

export const HermesRawSourceTermSchema = z.object({
  termId: WikiOpaqueIdSchema,
  raw: SafeRawTermSchema,
  sourceUrl: HermesPublicSourceUrlSchema,
  observedAt: z.string().datetime(),
}).strict().readonly();

export const HermesSourceStatementSchema = z.object({
  statementId: WikiOpaqueIdSchema,
  text: SafeSourceTextSchema,
  sourceUrl: HermesPublicSourceUrlSchema,
  observedAt: z.string().datetime(),
}).strict().readonly();

export const HermesLocalAssetSchema = z.object({
  path: z.string().regex(/^assets\/(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9][a-zA-Z0-9._/-]{0,500}$/),
  sha256: WikiSha256Schema,
  bytes: z.number().int().positive().max(2_000_000_000),
  mimeType: SafeMimeTypeSchema,
}).strict().readonly();

export const HermesProjectMediaSchema = z.object({
  mediaId: WikiOpaqueIdSchema,
  kind: HermesMediaKindSchema,
  role: HermesMediaRoleSchema,
  sourceUrl: HermesPublicSourceUrlSchema,
  declaredMimeType: SafeMimeTypeSchema.nullable(),
  width: z.number().int().positive().max(100_000).nullable(),
  height: z.number().int().positive().max(100_000).nullable(),
  durationMs: z.number().int().positive().max(86_400_000).nullable(),
  asset: HermesLocalAssetSchema.nullable(),
}).strict().readonly().superRefine((value, context) => {
  const timeBased = value.kind === "ANIMATED_IMAGE" || value.kind === "VIDEO" || value.kind === "AUDIO";
  if (timeBased !== (value.durationMs !== null)) {
    context.addIssue({ code: "custom", message: "HERMES_MEDIA_DURATION_KIND_MISMATCH" });
  }
  if (value.kind === "INTERACTIVE_URL") {
    if (value.role !== "LIVE_INTERACTIVE_ENDPOINT" || value.asset !== null || value.declaredMimeType !== null) {
      context.addIssue({ code: "custom", message: "HERMES_INTERACTIVE_ENDPOINT_SHAPE_INVALID" });
    }
  } else if (value.role === "LIVE_INTERACTIVE_ENDPOINT") {
    context.addIssue({ code: "custom", message: "HERMES_LIVE_ENDPOINT_ROLE_REQUIRES_URL_MEDIA" });
  }
  if (value.role === "POSTER_FRAME" && value.kind !== "IMAGE") {
    context.addIssue({ code: "custom", message: "HERMES_POSTER_FRAME_MUST_BE_STATIC_IMAGE" });
  }
  if (["MOTION_PREVIEW", "SCREEN_RECORDING", "INTERACTION_DEMO"].includes(value.role)
    && value.kind !== "VIDEO" && value.kind !== "ANIMATED_IMAGE") {
    context.addIssue({ code: "custom", message: "HERMES_DYNAMIC_MEDIA_ROLE_KIND_MISMATCH" });
  }
  if (value.role === "AUDIO_SAMPLE" && value.kind !== "AUDIO") {
    context.addIssue({ code: "custom", message: "HERMES_AUDIO_SAMPLE_KIND_MISMATCH" });
  }
});

export const HermesDynamicEvidenceKindSchema = z.enum([
  "DIRECT_MOTION",
  "DIRECT_INTERACTION",
  "PUBLIC_INTERACTIVE_ENDPOINT",
  "DIRECT_AUDIO",
  "SOURCE_ATTESTED",
]);

export const HermesDynamicEvidenceSchema = z.object({
  evidenceId: WikiOpaqueIdSchema,
  modality: HermesDynamicWorkModalitySchema,
  evidenceKind: HermesDynamicEvidenceKindSchema,
  mediaIds: z.array(WikiOpaqueIdSchema).min(1).max(20).readonly(),
  sourceStatementIds: z.array(WikiOpaqueIdSchema).max(20).readonly(),
  coverage: z.enum(["DIRECT", "SOURCE_ATTESTED_PARTIAL"]),
}).strict().readonly().superRefine((value, context) => {
  if (value.evidenceKind === "SOURCE_ATTESTED") {
    if (value.coverage !== "SOURCE_ATTESTED_PARTIAL" || value.sourceStatementIds.length === 0) {
      context.addIssue({ code: "custom", message: "HERMES_SOURCE_ATTESTED_EVIDENCE_INCOMPLETE" });
    }
  } else if (value.coverage !== "DIRECT") {
    context.addIssue({ code: "custom", message: "HERMES_DIRECT_EVIDENCE_CANNOT_CLAIM_PARTIAL" });
  }
});

const HermesHandoffV2CandidateSeedObjectSchema = z.object({
  schemaVersion: z.literal("lumi-hermes-inspiration-handoff/v2"),
  batchId: WikiOpaqueIdSchema,
  candidateId: WikiOpaqueIdSchema,
  reviewStatus: z.literal("PENDING_REVIEW"),
  scope: z.literal("PRIVATE_CANDIDATE"),
  studentVisible: z.literal(false),
  source: z.object({
    sourceId: WikiOpaqueIdSchema,
    platform: z.string().trim().min(1).max(80).regex(/^[A-Z][A-Z0-9_]*$/),
    pageUrl: HermesPublicSourceUrlSchema,
    canonicalUrl: HermesPublicSourceUrlSchema.nullable(),
    externalId: z.string().trim().min(1).max(240).nullable(),
    discoveredAt: z.string().datetime(),
    taxonomyPaths: z.array(HermesSourceTaxonomyPathSchema).max(20).readonly(),
    sourceStyleRaw: z.array(HermesRawSourceTermSchema).max(40).readonly(),
    mediumOrTechnologyRaw: z.array(HermesRawSourceTermSchema).max(60).readonly(),
  }).strict().readonly(),
  content: z.object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(10_000).nullable(),
    authorOrStudio: z.string().trim().min(1).max(300).nullable(),
    publishedAt: z.string().datetime().nullable(),
  }).strict().readonly(),
  sourceStatements: z.array(HermesSourceStatementSchema).max(100).readonly(),
  designCategories: z.array(HermesDesignCategorySchema).min(1).max(12).readonly(),
  workModalities: z.array(HermesWorkModalitySchema).min(1).max(7).readonly(),
  media: z.array(HermesProjectMediaSchema).min(1).max(80).readonly(),
  dynamicEvidence: z.array(HermesDynamicEvidenceSchema).max(40).readonly(),
  rightsStatus: z.literal("UNKNOWN"),
  dedupeFingerprint: WikiSha256Schema,
}).strict();

export const HermesHandoffV2CandidateSeedSchema = HermesHandoffV2CandidateSeedObjectSchema.readonly();

export const HermesHandoffV2CandidateSchema = HermesHandoffV2CandidateSeedObjectSchema.extend({
  materialDigest: WikiSha256Schema,
}).strict().readonly();

const HermesHandoffV2ManifestSeedObjectSchema = z.object({
  schemaVersion: z.literal("lumi-hermes-inspiration-handoff-manifest/v2"),
  batchId: WikiOpaqueIdSchema,
  producer: z.object({
    name: z.literal("Hermes"),
    version: z.string().trim().min(1).max(80),
  }).strict().readonly(),
  producedAt: z.string().datetime(),
  reviewStatus: z.literal("PENDING_REVIEW"),
  importTarget: z.literal("LUMI_TEACHER_PRIVATE_CANDIDATE"),
  containsStudentData: z.literal(false),
  containsCredentials: z.literal(false),
  candidateMaterialDigests: z.array(WikiSha256Schema).min(1).max(100).readonly(),
}).strict();

export const HermesHandoffV2ManifestSeedSchema = HermesHandoffV2ManifestSeedObjectSchema.readonly();

export const HermesHandoffV2ManifestInputSchema = HermesHandoffV2ManifestSeedObjectSchema.omit({
  candidateMaterialDigests: true,
}).strict().readonly();

export const HermesHandoffV2ManifestSchema = HermesHandoffV2ManifestSeedObjectSchema.extend({
  manifestDigest: WikiSha256Schema,
}).strict().readonly();

export type HermesWorkModality = z.infer<typeof HermesWorkModalitySchema>;
export type HermesDynamicWorkModality = z.infer<typeof HermesDynamicWorkModalitySchema>;
export type HermesProjectMedia = z.infer<typeof HermesProjectMediaSchema>;
export type HermesDynamicEvidence = z.infer<typeof HermesDynamicEvidenceSchema>;
export type HermesHandoffV2CandidateSeed = z.infer<typeof HermesHandoffV2CandidateSeedSchema>;
export type HermesHandoffV2Candidate = z.infer<typeof HermesHandoffV2CandidateSchema>;
export type HermesHandoffV2ManifestSeed = z.infer<typeof HermesHandoffV2ManifestSeedSchema>;
export type HermesHandoffV2ManifestInput = z.infer<typeof HermesHandoffV2ManifestInputSchema>;
export type HermesHandoffV2Manifest = z.infer<typeof HermesHandoffV2ManifestSchema>;

import { z } from "zod";

import { WikiClaimTypeSchema, WikiOpaqueIdSchema, WikiSha256Schema } from "./core-contracts";
import { HermesMediaKindSchema, HermesMediaRoleSchema } from "./hermes-handoff-v2-contracts";

export const VisualAnalysisDimensionSchema = z.enum([
  "OBJECT_OR_FORM",
  "COMPOSITION",
  "COLOR",
  "TYPOGRAPHY",
  "IMAGE_LANGUAGE",
  "MATERIAL",
  "PROCESS",
  "MOTION",
  "INTERACTION",
  "SPATIAL",
  "AUDIO",
  "TECHNOLOGY",
]);

export const VisualKeywordDimensionSchema = z.enum([
  "STYLE",
  "OBJECT_OR_FORM",
  "COMPOSITION",
  "COLOR",
  "TYPOGRAPHY",
  "IMAGE_LANGUAGE",
  "MATERIAL",
  "PROCESS",
  "MOTION",
  "INTERACTION",
  "SPATIAL",
  "AUDIO",
  "TECHNOLOGY",
]);

export const VisualAnalysisMediaBindingSchema = z.object({
  mediaId: WikiOpaqueIdSchema,
  kind: HermesMediaKindSchema,
  role: HermesMediaRoleSchema,
  mediaDigest: WikiSha256Schema,
}).strict().readonly();

export const VisualAnalysisSourceStatementBindingSchema = z.object({
  statementId: WikiOpaqueIdSchema,
  statementDigest: WikiSha256Schema,
}).strict().readonly();

export const VisualAnalysisRequestInputSchema = z.object({
  requestedAt: z.string().datetime(),
}).strict().readonly();

const VisualAnalysisRequestMaterialObjectSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-visual-analysis-request/v1"),
  requestedAt: z.string().datetime(),
  candidateId: WikiOpaqueIdSchema,
  candidateMaterialDigest: WikiSha256Schema,
  sourceMaterialDigest: WikiSha256Schema,
  mediaBindings: z.array(VisualAnalysisMediaBindingSchema).min(1).max(80).readonly(),
  sourceStatementBindings: z.array(VisualAnalysisSourceStatementBindingSchema).max(100).readonly(),
}).strict();

export const VisualAnalysisRequestMaterialSchema = VisualAnalysisRequestMaterialObjectSchema.readonly();

export const VisualAnalysisRequestSchema = VisualAnalysisRequestMaterialObjectSchema.extend({
  requestId: WikiOpaqueIdSchema,
  requestDigest: WikiSha256Schema,
}).strict().readonly();

const NormalizedRegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).strict().readonly().superRefine((value, context) => {
  if (value.x + value.width > 1 || value.y + value.height > 1) {
    context.addIssue({ code: "custom", message: "VISUAL_EVIDENCE_REGION_OUT_OF_BOUNDS" });
  }
});

const TimeRangeMsSchema = z.object({
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
}).strict().readonly().superRefine((value, context) => {
  if (value.endMs <= value.startMs) {
    context.addIssue({ code: "custom", message: "VISUAL_EVIDENCE_TIME_RANGE_INVALID" });
  }
});

export const VisualMediaEvidenceAnchorSchema = z.object({
  mediaId: WikiOpaqueIdSchema,
  region: NormalizedRegionSchema.nullable(),
  timeRangeMs: TimeRangeMsSchema.nullable(),
}).strict().readonly();

export const VisualAnalysisClaimSchema = z.object({
  claimId: WikiOpaqueIdSchema,
  claimType: WikiClaimTypeSchema.extract(["SOURCE_FACT", "VISIBLE_OBSERVATION"]),
  dimension: VisualAnalysisDimensionSchema,
  text: z.string().trim().min(1).max(2_000),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  mediaAnchors: z.array(VisualMediaEvidenceAnchorSchema).max(20).readonly(),
  sourceStatementIds: z.array(WikiOpaqueIdSchema).max(20).readonly(),
}).strict().readonly().superRefine((value, context) => {
  if (value.claimType === "SOURCE_FACT" && value.sourceStatementIds.length === 0) {
    context.addIssue({ code: "custom", message: "VISUAL_SOURCE_FACT_REQUIRES_SOURCE_STATEMENT" });
  }
  if (value.claimType === "VISIBLE_OBSERVATION" && value.mediaAnchors.length === 0) {
    context.addIssue({ code: "custom", message: "VISUAL_OBSERVATION_REQUIRES_MEDIA_ANCHOR" });
  }
});

export const VisualKeywordProposalSchema = z.object({
  proposalId: WikiOpaqueIdSchema,
  dimension: VisualKeywordDimensionSchema,
  proposedTerm: z.string().trim().min(1).max(160),
  supportClaimIds: z.array(WikiOpaqueIdSchema).min(1).max(20).readonly(),
  state: z.literal("MODEL_DRAFT"),
}).strict().readonly();

const VisualAnalysisDraftSeedObjectSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-visual-analysis-draft/v1"),
  requestId: WikiOpaqueIdSchema,
  requestDigest: WikiSha256Schema,
  candidateId: WikiOpaqueIdSchema,
  candidateMaterialDigest: WikiSha256Schema,
  authorship: z.literal("MODEL_DRAFT"),
  createdAt: z.string().datetime(),
  claims: z.array(VisualAnalysisClaimSchema).min(1).max(120).readonly(),
  keywordProposals: z.array(VisualKeywordProposalSchema).max(120).readonly(),
}).strict();

export const VisualAnalysisDraftSeedSchema = VisualAnalysisDraftSeedObjectSchema.readonly();

export const VisualAnalysisDraftSchema = VisualAnalysisDraftSeedObjectSchema.extend({
  analysisDigest: WikiSha256Schema,
}).strict().readonly();

export type VisualAnalysisMediaBinding = z.infer<typeof VisualAnalysisMediaBindingSchema>;
export type VisualAnalysisRequestMaterial = z.infer<typeof VisualAnalysisRequestMaterialSchema>;
export type VisualAnalysisRequest = z.infer<typeof VisualAnalysisRequestSchema>;
export type VisualAnalysisClaim = z.infer<typeof VisualAnalysisClaimSchema>;
export type VisualAnalysisDraftSeed = z.infer<typeof VisualAnalysisDraftSeedSchema>;
export type VisualAnalysisDraft = z.infer<typeof VisualAnalysisDraftSchema>;

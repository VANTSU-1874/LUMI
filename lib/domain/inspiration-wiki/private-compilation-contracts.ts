import { z } from "zod";

import { PrivateDomainReviewCaseIdSchema } from "./private-domain-review-contracts";
import { PrivateWikiDraftEditableSchema, PrivateWikiDraftIdSchema } from "./private-draft-contracts";
import { ReviewPackRequirementKeySchema, ReviewPackSourcePlatformSchema } from "./review-pack-contracts";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const CandidateIdSchema = z.string().regex(/^hermes-candidate:[0-9a-f]{32}$/);
const PreviewUrlSchema = z.string().regex(/^\/api\/teacher\/inspiration-wiki\/review-packs\//);

export const PrivateWikiPageIdSchema = z.string().regex(/^private-wiki-page:[0-9a-f]{32}$/);
export const PrivateWikiPageRevisionIdSchema = z.string().regex(/^private-wiki-page-revision:[0-9a-f]{32}:[1-9][0-9]*$/);
export const PrivateCompiledTruthIdSchema = z.string().regex(/^private-compiled-truth:[0-9a-f]{32}:[1-9][0-9]*$/);

const DisabledBoundarySchema = z.object({
  teacherPrivate: z.literal(true),
  studentVisible: z.literal(false),
  privateCompilation: z.literal("ENABLED"),
  canonicalCompilation: z.literal("DISABLED"),
  currentPage: z.literal("DISABLED"),
  formalRelease: z.literal("DISABLED"),
  r2: z.literal("DISABLED"),
  embedding: z.literal("DISABLED"),
  lumiRetrieval: z.literal("DISABLED"),
}).strict().readonly();

const DecisionBindingsSchema = z.object({
  CURATION: z.string().trim().min(1).max(128),
  TEACHING: z.string().trim().min(1).max(128),
  RIGHTS: z.string().trim().min(1).max(128),
  SAFETY: z.string().trim().min(1).max(128),
}).strict().readonly();

export const PrivateCompiledPageContentSchema = z.object({
  pageType: z.literal("INSPIRATION_CASE"),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(1_200),
  classification: PrivateWikiDraftEditableSchema.shape.classification,
  artisticStyle: PrivateWikiDraftEditableSchema.shape.artisticStyle,
  facets: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  curation: PrivateWikiDraftEditableSchema.shape.curation,
  teaching: PrivateWikiDraftEditableSchema.shape.teaching,
  media: z.array(z.object({
    mediaId: z.string().trim().min(1).max(128),
    previewUrl: PreviewUrlSchema,
    role: z.enum(["COVER", "DETAIL", "PROCESS", "CONTEXT"]).nullable(),
    alt: z.string().trim().max(240).nullable(),
    width: z.number().int().positive().max(10_000),
    height: z.number().int().positive().max(10_000),
    sha256: Sha256Schema,
  }).strict()).min(1).max(20),
  work: z.object({
    creators: z.array(z.string().trim().min(1).max(160)).max(20),
    year: z.string().trim().min(1).max(40).nullable(),
  }).strict(),
  sourceRecords: z.array(z.object({
    sourceId: z.string().trim().min(1).max(128),
    platform: ReviewPackSourcePlatformSchema,
    pageUrl: z.string().url(),
    role: z.string().trim().min(1).max(80),
    creatorName: z.string().trim().min(1).max(160).nullable(),
    curatorName: z.string().trim().min(1).max(160).nullable(),
  }).strict()).max(12),
  rights: z.object({
    status: z.literal("UNKNOWN"),
    evidenceSummaries: z.array(z.string().trim().min(1).max(800)).max(20),
    formalRepublicationAllowed: z.literal(false),
  }).strict(),
  visualObservations: z.array(z.object({
    observation: z.string().trim().min(1).max(400),
    mediaIds: z.array(z.string().trim().min(1).max(128)).max(20),
  }).strict()).max(30),
  duplicateRelationship: z.object({
    status: z.enum(["UNASSESSED", "DISTINCT", "VARIANT_OF", "DUPLICATE_OF"]),
    relatedCandidateIds: z.array(CandidateIdSchema).max(20),
    explanation: z.string().trim().min(1).max(800).nullable(),
  }).strict(),
  safety: z.object({
    status: z.enum(["UNASSESSED", "READY_FOR_TEACHER_DECISION", "BLOCKED"]),
    evidence: z.array(z.string().trim().min(1).max(500)).max(20),
  }).strict(),
  evidenceGaps: z.array(ReviewPackRequirementKeySchema).max(9),
  editorialNote: z.string().trim().max(1_000),
}).strict().superRefine((content, context) => {
  const mediaIds = new Set(content.media.map((media) => media.mediaId));
  if (mediaIds.size !== content.media.length) context.addIssue({ code: "custom", path: ["media"], message: "Private page media IDs must be unique" });
  if (content.visualObservations.some((item) => item.mediaIds.some((mediaId) => !mediaIds.has(mediaId)))) {
    context.addIssue({ code: "custom", path: ["visualObservations"], message: "Private page observations must bind local media" });
  }
  if (new Set(content.facets).size !== content.facets.length) context.addIssue({ code: "custom", path: ["facets"], message: "Private page facets must be unique" });
}).readonly();

export const PrivateWikiPageRevisionSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-private-page-revision/v1"),
  revisionId: PrivateWikiPageRevisionIdSchema,
  pageId: PrivateWikiPageIdSchema,
  candidateId: CandidateIdSchema,
  revision: z.number().int().positive(),
  sourceBinding: z.object({
    draftId: PrivateWikiDraftIdSchema,
    draftRevision: z.number().int().positive(),
    draftContentHash: Sha256Schema,
    reviewCaseId: PrivateDomainReviewCaseIdSchema,
    reviewCaseRevision: z.number().int().positive(),
    reviewStateHash: Sha256Schema,
    decisionIds: DecisionBindingsSchema,
  }).strict(),
  compilationState: z.literal("PRIVATE_COMPILED_PREVIEW"),
  compiledAt: z.string().datetime(),
  contentHash: Sha256Schema,
  revisionHash: Sha256Schema,
  content: PrivateCompiledPageContentSchema,
  capabilityBoundary: DisabledBoundarySchema,
}).strict().readonly();

export const PrivateCompiledTruthSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-private-compiled-truth/v1"),
  truthId: PrivateCompiledTruthIdSchema,
  state: z.literal("PRIVATE_COMPILED_PREVIEW"),
  pageId: PrivateWikiPageIdSchema,
  pageRevision: z.object({
    revisionId: PrivateWikiPageRevisionIdSchema,
    revision: z.number().int().positive(),
    revisionHash: Sha256Schema,
  }).strict(),
  sourceDecisionIds: DecisionBindingsSchema,
  rightsScope: z.literal("UNKNOWN_PRIVATE_ONLY"),
  contentHash: Sha256Schema,
  truthHash: Sha256Schema,
  compiledAt: z.string().datetime(),
  content: PrivateCompiledPageContentSchema,
  capabilityBoundary: DisabledBoundarySchema,
}).strict().readonly();

export const PrivateWikiPageSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-private-wiki-page/v1"),
  pageId: PrivateWikiPageIdSchema,
  candidateId: CandidateIdSchema,
  pageType: z.literal("INSPIRATION_CASE"),
  state: z.literal("PRIVATE_COMPILED"),
  title: z.string().trim().min(1).max(240),
  latestPrivateRevision: z.object({
    revisionId: PrivateWikiPageRevisionIdSchema,
    revision: z.number().int().positive(),
    revisionHash: Sha256Schema,
  }).strict(),
  latestPrivateTruth: z.object({
    truthId: PrivateCompiledTruthIdSchema,
    truthHash: Sha256Schema,
  }).strict(),
  rightsScope: z.literal("UNKNOWN_PRIVATE_ONLY"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  capabilityBoundary: DisabledBoundarySchema,
}).strict().readonly();

const PrivateWikiPageQueueItemSchema = z.object({
  pageId: PrivateWikiPageIdSchema,
  candidateId: CandidateIdSchema,
  revisionId: PrivateWikiPageRevisionIdSchema,
  revision: z.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  primaryCategory: z.string().trim().min(1).max(80),
  artisticStyleLabels: z.array(z.string().trim().min(1).max(40)).min(1).max(3),
  primaryPreviewUrl: PreviewUrlSchema,
  evidenceGapCount: z.number().int().min(0).max(9),
  compiledAt: z.string().datetime(),
}).strict();

export const TeacherPrivateWikiPageQueueSchema = z.object({
  items: z.array(PrivateWikiPageQueueItemSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    revisions: z.number().int().nonnegative(),
    compiledTruths: z.number().int().nonnegative(),
    rightsUnknown: z.number().int().nonnegative(),
    strictSource: z.number().int().nonnegative(),
    evidenceGapSource: z.number().int().nonnegative(),
    boundary: DisabledBoundarySchema,
  }).strict(),
}).strict().superRefine((queue, context) => {
  if (queue.items.length !== queue.meta.total || queue.meta.compiledTruths < queue.meta.total || queue.meta.revisions < queue.meta.total || queue.meta.total !== queue.meta.strictSource + queue.meta.evidenceGapSource) {
    context.addIssue({ code: "custom", path: ["meta"], message: "Private page queue totals are inconsistent" });
  }
});

export const TeacherPrivateWikiPageDetailSchema = z.object({
  page: PrivateWikiPageSchema,
  revision: PrivateWikiPageRevisionSchema,
  compiledTruth: PrivateCompiledTruthSchema,
}).strict();

export const PrivateCompilationReceiptSchema = z.object({
  eligible: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  revised: z.number().int().nonnegative(),
  replayed: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  totalRevisions: z.number().int().nonnegative(),
  totalCompiledTruths: z.number().int().nonnegative(),
  compiledAt: z.string().datetime(),
}).strict();

export type PrivateCompiledPageContent = z.infer<typeof PrivateCompiledPageContentSchema>;
export type PrivateWikiPage = z.infer<typeof PrivateWikiPageSchema>;
export type PrivateWikiPageRevision = z.infer<typeof PrivateWikiPageRevisionSchema>;
export type PrivateCompiledTruth = z.infer<typeof PrivateCompiledTruthSchema>;
export type TeacherPrivateWikiPageQueue = z.infer<typeof TeacherPrivateWikiPageQueueSchema>;
export type TeacherPrivateWikiPageDetail = z.infer<typeof TeacherPrivateWikiPageDetailSchema>;

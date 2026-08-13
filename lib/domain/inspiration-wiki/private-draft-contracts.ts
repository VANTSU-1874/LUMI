import { z } from "zod";

import { ReviewPackRequirementKeySchema, ReviewPackSourcePlatformSchema } from "./review-pack-contracts";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const CandidateIdSchema = z.string().regex(/^hermes-candidate:[0-9a-f]{32}$/);
const ReviewPackIdSchema = z.string().regex(/^review-pack:/);
const PreviewUrlSchema = z.string().regex(/^\/api\/teacher\/inspiration-wiki\/review-packs\//);

export const PrivateWikiDraftIdSchema = z.string().regex(/^private-wiki-draft:[0-9a-f]{32}$/);
export const PrivateWikiDraftStageSchema = z.enum(["EDITING", "READY_FOR_DOMAIN_REVIEW"]);
export const PrivateWikiDraftCompletionKeySchema = z.enum([
  "TITLE",
  "SUMMARY",
  "CLASSIFICATION",
  "ARTISTIC_STYLE",
  "CURATION",
  "TEACHING",
  "MEDIA",
]);

const PrivateWikiDraftMediaSchema = z.object({
  mediaId: z.string().trim().min(1).max(128),
  previewUrl: PreviewUrlSchema,
  role: z.enum(["COVER", "DETAIL", "PROCESS", "CONTEXT"]).nullable(),
  alt: z.string().trim().max(240).nullable(),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  sha256: Sha256Schema,
}).strict();

export const PrivateWikiDraftEditableSchema = z.object({
  title: z.string().trim().max(240),
  summary: z.string().trim().max(1_200),
  classification: z.object({
    primary: z.string().trim().max(80),
    secondary: z.array(z.string().trim().min(1).max(80)).max(12),
  }).strict(),
  artisticStyle: z.object({
    labels: z.array(z.string().trim().min(1).max(40)).max(3),
    rationale: z.string().trim().max(500),
  }).strict(),
  curation: z.object({
    recommendation: z.enum(["RECOMMEND", "DO_NOT_RECOMMEND"]),
    rationale: z.string().trim().max(1_000),
  }).strict(),
  teaching: z.object({
    recommendation: z.enum(["RECOMMEND", "DO_NOT_RECOMMEND"]),
    rationale: z.string().trim().max(1_000),
    prompts: z.array(z.string().trim().min(1).max(300)).max(12),
    cautions: z.array(z.string().trim().min(1).max(300)).max(12),
  }).strict(),
  media: z.array(PrivateWikiDraftMediaSchema).min(1).max(20),
  editorialNote: z.string().trim().max(1_000),
}).strict();

export type PrivateWikiDraftEditable = z.infer<typeof PrivateWikiDraftEditableSchema>;

export function privateDraftCompletion(editable: PrivateWikiDraftEditable) {
  const parsed = PrivateWikiDraftEditableSchema.parse(editable);
  const completed = [
    ["TITLE", parsed.title.length > 0],
    ["SUMMARY", parsed.summary.length > 0],
    ["CLASSIFICATION", parsed.classification.primary.length > 0],
    ["ARTISTIC_STYLE", parsed.artisticStyle.labels.length > 0 && parsed.artisticStyle.rationale.length > 0],
    ["CURATION", parsed.curation.rationale.length > 0],
    ["TEACHING", parsed.teaching.rationale.length > 0 && parsed.teaching.prompts.length > 0],
    ["MEDIA", parsed.media.length > 0],
  ] as const;
  const completedKeys = completed.filter(([, done]) => done).map(([key]) => key);
  const missingKeys = completed.filter(([, done]) => !done).map(([key]) => key);
  return {
    completedKeys,
    missingKeys,
    completedCount: completedKeys.length,
    totalCount: 7 as const,
    ready: missingKeys.length === 0,
  };
}

export const PrivateWikiDraftSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-private-working-draft/v1"),
  draftId: PrivateWikiDraftIdSchema,
  candidateId: CandidateIdSchema,
  sourceReview: z.object({
    contractKind: z.enum(["STRICT_REVIEW_PACK", "EVIDENCE_GAP_REVIEW"]),
    reviewPackId: ReviewPackIdSchema,
    reviewPackRevision: z.number().int().positive(),
    decisionId: z.string().trim().min(1).max(128),
    decisionAction: z.literal("ENTER_PRIVATE_WIKIDRAFT"),
    acceptedGapKeys: z.array(ReviewPackRequirementKeySchema).max(9),
  }).strict(),
  revision: z.number().int().positive(),
  stage: PrivateWikiDraftStageSchema,
  contentHash: Sha256Schema,
  updatedAt: z.string().datetime(),
  editable: PrivateWikiDraftEditableSchema,
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
  completion: z.object({
    completedKeys: z.array(PrivateWikiDraftCompletionKeySchema).max(7),
    missingKeys: z.array(PrivateWikiDraftCompletionKeySchema).max(7),
    completedCount: z.number().int().min(0).max(7),
    totalCount: z.literal(7),
    ready: z.boolean(),
  }).strict(),
  capabilityBoundary: z.object({
    teacherPrivate: z.literal(true),
    studentVisible: z.literal(false),
    currentPage: z.literal("DISABLED"),
    r2: z.literal("DISABLED"),
    embedding: z.literal("DISABLED"),
    lumiRetrieval: z.literal("DISABLED"),
  }).strict(),
}).strict().superRefine((draft, context) => {
  const computed = privateDraftCompletion(draft.editable);
  if (JSON.stringify(computed) !== JSON.stringify(draft.completion)) {
    context.addIssue({ code: "custom", path: ["completion"], message: "Draft completion must be derived from editable material" });
  }
  if (draft.stage === "READY_FOR_DOMAIN_REVIEW" && !draft.completion.ready) {
    context.addIssue({ code: "custom", path: ["stage"], message: "Only complete drafts may enter domain review" });
  }
  const mediaIds = new Set(draft.editable.media.map((media) => media.mediaId));
  if (mediaIds.size !== draft.editable.media.length) {
    context.addIssue({ code: "custom", path: ["editable", "media"], message: "Draft media IDs must be unique" });
  }
  if (draft.visualObservations.some((item) => item.mediaIds.some((mediaId) => !mediaIds.has(mediaId)))) {
    context.addIssue({ code: "custom", path: ["visualObservations"], message: "Observations may only reference draft media" });
  }
}).readonly();

export const PrivateWikiDraftUpdateBodySchema = z.object({
  expectedRevision: z.number().int().positive(),
  expectedContentHash: Sha256Schema,
  editable: PrivateWikiDraftEditableSchema,
  stage: PrivateWikiDraftStageSchema,
  note: z.string().trim().min(1).max(300),
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict();

export const PrivateWikiDraftBatchReadyBodySchema = z.object({
  draftIds: z.array(PrivateWikiDraftIdSchema).min(1).max(200),
  note: z.string().trim().min(1).max(300),
  idempotencyKey: z.string().trim().min(8).max(96),
}).strict().superRefine((value, context) => {
  if (new Set(value.draftIds).size !== value.draftIds.length) {
    context.addIssue({ code: "custom", path: ["draftIds"], message: "draftIds must be unique" });
  }
});

const PrivateWikiDraftQueueItemSchema = z.object({
  draftId: PrivateWikiDraftIdSchema,
  candidateId: CandidateIdSchema,
  revision: z.number().int().positive(),
  stage: PrivateWikiDraftStageSchema,
  title: z.string().trim().max(240),
  primaryCategory: z.string().trim().min(1).max(80),
  artisticStyleLabels: z.array(z.string().trim().min(1).max(40)).min(1).max(3),
  primaryPreviewUrl: PreviewUrlSchema,
  sourceContractKind: z.enum(["STRICT_REVIEW_PACK", "EVIDENCE_GAP_REVIEW"]),
  evidenceGapCount: z.number().int().min(0).max(9),
  completedCount: z.number().int().min(0).max(7),
  updatedAt: z.string().datetime(),
}).strict();

export const TeacherPrivateWikiDraftQueueSchema = z.object({
  items: z.array(PrivateWikiDraftQueueItemSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    editing: z.number().int().nonnegative(),
    readyForDomainReview: z.number().int().nonnegative(),
    strictSource: z.number().int().nonnegative(),
    evidenceGapSource: z.number().int().nonnegative(),
    rightsUnknown: z.number().int().nonnegative(),
    rejectedExcluded: z.number().int().nonnegative(),
    boundary: z.object({
      studentVisible: z.literal(false),
      currentPage: z.literal("DISABLED"),
      r2: z.literal("DISABLED"),
      embedding: z.literal("DISABLED"),
      lumiRetrieval: z.literal("DISABLED"),
    }).strict(),
  }).strict(),
}).strict().superRefine((queue, context) => {
  if (queue.items.length !== queue.meta.total
    || queue.meta.total !== queue.meta.editing + queue.meta.readyForDomainReview
    || queue.meta.total !== queue.meta.strictSource + queue.meta.evidenceGapSource) {
    context.addIssue({ code: "custom", path: ["meta"], message: "Private draft queue totals are inconsistent" });
  }
});

export type PrivateWikiDraft = z.infer<typeof PrivateWikiDraftSchema>;
export type PrivateWikiDraftUpdateBody = z.infer<typeof PrivateWikiDraftUpdateBodySchema>;
export type TeacherPrivateWikiDraftQueue = z.infer<typeof TeacherPrivateWikiDraftQueueSchema>;

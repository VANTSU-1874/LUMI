import { z } from "zod";

export const HermesReviewStateSchema = z.enum([
  "PENDING_REVIEW",
  "NORMALIZATION_REQUIRED",
  "DUPLICATE_HOLD",
  "RIGHTS_HOLD",
  "REJECTED",
]);
export const HermesTriageDecisionSchema = z.enum([
  "RESTORE_PENDING",
  "REQUEST_NORMALIZATION",
  "HOLD_DUPLICATE",
  "HOLD_RIGHTS",
  "REJECT",
]);

const CandidateSchema = z.object({
  id: z.string().regex(/^hermes-candidate:[0-9a-f]{32}$/),
  batchId: z.string(),
  sourceCandidateId: z.string(),
  revision: z.number().int().positive(),
  contractState: z.literal("V1_UPGRADE_REQUIRED"),
  reviewState: HermesReviewStateSchema,
  source: z.object({
    sourceId: z.string(),
    platform: z.string(),
    pageUrl: z.string().url(),
    canonicalUrl: z.string().url().nullable(),
  }),
  content: z.object({ title: z.string().nullable(), description: z.string().nullable() }),
  author: z.object({ displayName: z.string().nullable(), profileUrl: z.string().url().nullable() }).nullable(),
  license: z.object({
    name: z.string().nullable(),
    url: z.string().url().nullable(),
    notes: z.string().nullable(),
  }).nullable(),
  media: z.object({
    count: z.number().int().positive(),
    kinds: z.array(z.string()),
    controlledPreviewAvailable: z.boolean(),
  }),
  designCategories: z.array(z.string()),
  screening: z.object({ totalScore: z.number().int(), evidence: z.array(z.string()) }),
  capabilityBoundary: z.object({
    scope: z.literal("PRIVATE_CANDIDATE"),
    studentVisible: z.literal(false),
    wikiDraft: z.literal("NOT_CREATED"),
    currentPage: z.literal("DISABLED"),
    r2: z.literal("DISABLED"),
    embedding: z.literal("DISABLED"),
    lumiRetrieval: z.literal("DISABLED"),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const HermesCandidateQueueSchema = z.object({
  items: z.array(CandidateSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    stateCounts: z.object({
      PENDING_REVIEW: z.number().int().nonnegative(),
      NORMALIZATION_REQUIRED: z.number().int().nonnegative(),
      DUPLICATE_HOLD: z.number().int().nonnegative(),
      RIGHTS_HOLD: z.number().int().nonnegative(),
      REJECTED: z.number().int().nonnegative(),
    }),
    readiness: z.object({
      teacherReviewReady: z.number().int().nonnegative(),
      controlledPreviewReady: z.number().int().nonnegative(),
      rightsEvidenceReady: z.number().int().nonnegative(),
      descriptionsReady: z.number().int().nonnegative(),
      v2Normalized: z.number().int().nonnegative(),
      blocked: z.object({
        rights: z.number().int().nonnegative(),
        preview: z.number().int().nonnegative(),
        description: z.number().int().nonnegative(),
        normalization: z.number().int().nonnegative(),
      }),
    }),
    sources: z.array(z.object({
      sourceId: z.string(),
      total: z.number().int().positive(),
      rightsEvidenceReady: z.number().int().nonnegative(),
      descriptionsReady: z.number().int().nonnegative(),
      controlledPreviewReady: z.number().int().nonnegative(),
    })),
  }),
});
export const HermesTriageResultSchema = z.object({
  candidateId: z.string(),
  previousRevision: z.number().int().positive(),
  revision: z.number().int().positive(),
  decision: HermesTriageDecisionSchema,
  reviewState: HermesReviewStateSchema,
  decidedAt: z.string().datetime(),
  replayed: z.boolean(),
});

export type HermesCandidateQueueItem = z.infer<typeof CandidateSchema>;
export type HermesReviewState = z.infer<typeof HermesReviewStateSchema>;
export type HermesTriageDecision = z.infer<typeof HermesTriageDecisionSchema>;

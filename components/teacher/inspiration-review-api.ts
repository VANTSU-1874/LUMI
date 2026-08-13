import { z } from "zod";

const nullableText = z.string().nullable();
const nullableUrl = z.string().url().nullable();

const CourseAssociationSchema = z.object({
  coursePackId: z.string(),
  facets: z.array(z.string()),
  rationale: z.string(),
  confidence: z.number(),
  status: z.literal("PROPOSED"),
}).strict();

export const InspirationCandidateQueueItemSchema = z.object({
  id: z.string().regex(/^inspiration:[a-f0-9]{24}$/),
  revision: z.number().int().positive(),
  state: z.literal("READY_FOR_TEACHER_REVIEW"),
  withdrawalStatus: z.enum(["PENDING", "READY", "HOLD", "WITHDRAWN"]),
  curation: z.object({
    title: nullableText,
    description: nullableText,
    observedAt: z.string().datetime(),
    curationSourceUrl: nullableUrl,
    originalSourceDisplay: nullableText,
    originalSourceUrl: nullableUrl,
    category: nullableText,
    styles: z.array(z.string()),
    colors: z.array(z.string()),
  }).passthrough(),
  asset: z.object({
    mode: z.enum(["METADATA_ONLY", "PRIVATE_COPY"]),
  }).strict(),
  analysis: z.object({
    courseAssociations: z.array(CourseAssociationSchema),
  }).passthrough(),
  reviewPackage: z.object({
    preview: z.object({ mode: z.enum(["CONTROLLED", "METADATA_ONLY"]), previewUrl: z.string().regex(/^\/api\/inspiration\/previews\/inspiration:[a-f0-9]{24}$/).nullable() }).strict(),
    source: z.object({
      curationSourceUrl: nullableUrl,
      originalSourceDisplay: nullableText,
      originalSourceUrl: nullableUrl,
      attributionStatus: z.enum(["RECORDED", "UNKNOWN"]),
    }).strict(),
    extractedTags: z.array(z.string()),
    courseAssociations: z.array(CourseAssociationSchema),
    duplicateRisk: z.object({ signal: z.enum(["NOT_RUN", "LOW", "MEDIUM", "HIGH"]), explanation: z.string() }).strict(),
    designSignals: z.object({ visualStyle: z.array(z.string()), novelty: z.enum(["NOT_RUN", "LOW", "MEDIUM", "HIGH"]), teachingValue: z.enum(["NOT_RUN", "LOW", "MEDIUM", "HIGH"]), explanation: z.string() }).strict(),
    aiRecommendation: z.object({ recommendation: z.enum(["REVIEW_FAVORABLY", "REVIEW_CAREFULLY", "DO_NOT_AUTO_DECIDE"]), rationale: z.string(), limitations: z.string() }).strict(),
    processingLog: z.object({ actualChannel: z.enum(["NONE", "LOCAL", "REMOTE"]), transmittedToThirdParty: z.boolean() }).passthrough(),
  }).passthrough(),
}).strict();

export const InspirationCandidateQueueSchema = z.object({
  items: z.array(InspirationCandidateQueueItemSchema).max(100),
}).strict();

export const InspirationCandidateDecisionResultSchema = z.object({
  candidateId: z.string().regex(/^inspiration:[a-f0-9]{24}$/),
  decision: z.enum(["APPROVE", "REJECT", "DEFER"]),
  revision: z.number().int().positive(),
  state: z.enum(["ACTIVE", "REJECTED", "READY_FOR_TEACHER_REVIEW"]),
  publicationScope: z.enum(["INTERNAL_CATALOG_ONLY", "AUTHENTICATED_STUDENT_ONLY"]),
  replayed: z.boolean(),
}).strict();

export type InspirationCandidateQueueItem = z.infer<typeof InspirationCandidateQueueItemSchema>;
export type InspirationReviewDecision = z.infer<typeof InspirationCandidateDecisionResultSchema>;

import { z } from "zod";

import { PrivateWikiDraftIdSchema, PrivateWikiDraftSchema } from "./private-draft-contracts";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const CandidateIdSchema = z.string().regex(/^hermes-candidate:[0-9a-f]{32}$/);

export const PrivateDomainReviewCaseIdSchema = z.string().regex(/^private-domain-review:[0-9a-f]{32}$/);
export const PrivateDomainReviewDomainSchema = z.enum(["CURATION", "TEACHING", "RIGHTS", "SAFETY"]);
export const PrivateDomainReviewDecisionSchema = z.enum(["APPROVE", "HOLD", "REJECT"]);
export const PrivateDomainReviewDomainStatusSchema = z.enum(["PENDING", "APPROVED", "HOLD", "REJECTED"]);
export const PrivateDomainReviewStageSchema = z.enum([
  "PENDING_DOMAIN_REVIEW",
  "DOMAIN_REVIEW_HOLD",
  "PRIVATE_DRAFT_REJECTED",
  "DOMAIN_REVIEW_COMPLETE",
]);

export const PrivateDomainReviewAssessmentSchema = z.discriminatedUnion("domain", [
  z.object({
    domain: z.literal("CURATION"),
    representativeValue: z.enum(["YES", "NO", "UNCERTAIN"]),
    redundancyAcceptable: z.enum(["YES", "NO", "UNCERTAIN"]),
  }).strict(),
  z.object({
    domain: z.literal("TEACHING"),
    teachingValue: z.enum(["YES", "NO", "UNCERTAIN"]),
    promptsUsable: z.enum(["YES", "NO", "UNCERTAIN"]),
    cautionsClear: z.enum(["YES", "NO", "UNCERTAIN"]),
  }).strict(),
  z.object({
    domain: z.literal("RIGHTS"),
    rightsState: z.literal("UNKNOWN"),
    privateUseOnlyAcknowledged: z.literal(true),
    formalRepublicationAllowed: z.literal(false),
  }).strict(),
  z.object({
    domain: z.literal("SAFETY"),
    privacyRisk: z.enum(["CLEAR", "REQUIRES_ATTENTION", "BLOCK"]),
    sensitiveContent: z.enum(["CLEAR", "REQUIRES_ATTENTION", "BLOCK"]),
  }).strict(),
]);

export type PrivateDomainReviewAssessment = z.infer<typeof PrivateDomainReviewAssessmentSchema>;

const DomainStateSchema = z.object({
  status: PrivateDomainReviewDomainStatusSchema,
  decisionId: z.string().trim().min(1).max(128).nullable(),
  reviewerId: z.string().trim().min(1).max(128).nullable(),
  note: z.string().trim().max(300).nullable(),
  decidedAt: z.string().datetime().nullable(),
}).strict().superRefine((value, context) => {
  const pending = value.status === "PENDING";
  const bound = value.decisionId !== null && value.reviewerId !== null && value.decidedAt !== null;
  if (pending === bound) context.addIssue({ code: "custom", message: "Domain state decision binding is inconsistent" });
}).readonly();

export const PrivateDomainReviewStateSchema = z.object({
  CURATION: DomainStateSchema,
  TEACHING: DomainStateSchema,
  RIGHTS: DomainStateSchema,
  SAFETY: DomainStateSchema,
}).strict().readonly();

export type PrivateDomainReviewState = z.infer<typeof PrivateDomainReviewStateSchema>;

export function derivePrivateDomainReviewStage(state: PrivateDomainReviewState) {
  const statuses = PrivateDomainReviewDomainSchema.options.map((domain) => state[domain].status);
  if (statuses.includes("REJECTED")) return "PRIVATE_DRAFT_REJECTED" as const;
  if (statuses.includes("HOLD")) return "DOMAIN_REVIEW_HOLD" as const;
  if (statuses.every((status) => status === "APPROVED")) return "DOMAIN_REVIEW_COMPLETE" as const;
  return "PENDING_DOMAIN_REVIEW" as const;
}

export const PrivateDomainReviewCaseSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-private-domain-review/v1"),
  reviewCaseId: PrivateDomainReviewCaseIdSchema,
  draftBinding: z.object({
    draftId: PrivateWikiDraftIdSchema,
    candidateId: CandidateIdSchema,
    revision: z.number().int().positive(),
    contentHash: Sha256Schema,
  }).strict(),
  revision: z.number().int().positive(),
  stateHash: Sha256Schema,
  stage: PrivateDomainReviewStageSchema,
  domains: PrivateDomainReviewStateSchema,
  reviewedDomainCount: z.number().int().min(0).max(4),
  rightsScope: z.literal("UNKNOWN_PRIVATE_ONLY"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  capabilityBoundary: z.object({
    teacherPrivate: z.literal(true),
    studentVisible: z.literal(false),
    currentPage: z.literal("DISABLED"),
    r2: z.literal("DISABLED"),
    embedding: z.literal("DISABLED"),
    lumiRetrieval: z.literal("DISABLED"),
    canonicalCompilation: z.literal("DISABLED"),
  }).strict(),
}).strict().superRefine((value, context) => {
  const reviewed = PrivateDomainReviewDomainSchema.options.filter((domain) => value.domains[domain].status !== "PENDING").length;
  if (reviewed !== value.reviewedDomainCount) context.addIssue({ code: "custom", path: ["reviewedDomainCount"], message: "Reviewed domain count must be derived" });
  if (derivePrivateDomainReviewStage(value.domains) !== value.stage) context.addIssue({ code: "custom", path: ["stage"], message: "Review stage must be derived" });
}).readonly();

export type PrivateDomainReviewCase = z.infer<typeof PrivateDomainReviewCaseSchema>;

export const PrivateDomainReviewDecisionBodySchema = z.object({
  expectedRevision: z.number().int().positive(),
  expectedStateHash: Sha256Schema,
  reviewDomain: PrivateDomainReviewDomainSchema,
  decision: PrivateDomainReviewDecisionSchema,
  assessment: PrivateDomainReviewAssessmentSchema,
  note: z.string().trim().max(300),
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict().superRefine((value, context) => {
  if (value.assessment.domain !== value.reviewDomain) context.addIssue({ code: "custom", path: ["assessment"], message: "Assessment domain mismatch" });
  if (value.decision !== "APPROVE" && value.note.length === 0) context.addIssue({ code: "custom", path: ["note"], message: "Hold and reject decisions require a note" });
  if (value.decision !== "APPROVE") return;
  const assessment = value.assessment;
  const eligible = assessment.domain === "CURATION"
    ? assessment.representativeValue === "YES" && assessment.redundancyAcceptable === "YES"
    : assessment.domain === "TEACHING"
      ? assessment.teachingValue === "YES" && assessment.promptsUsable === "YES" && assessment.cautionsClear === "YES"
      : assessment.domain === "RIGHTS"
        ? assessment.rightsState === "UNKNOWN" && assessment.privateUseOnlyAcknowledged && !assessment.formalRepublicationAllowed
        : assessment.privacyRisk === "CLEAR" && assessment.sensitiveContent === "CLEAR";
  if (!eligible) context.addIssue({ code: "custom", path: ["assessment"], message: "Approval criteria are not satisfied" });
});

export const PrivateDomainReviewDecisionReceiptSchema = z.object({
  reviewCaseId: PrivateDomainReviewCaseIdSchema,
  decisionId: z.string().trim().min(1).max(128),
  revision: z.number().int().positive(),
  stage: PrivateDomainReviewStageSchema,
  replayed: z.boolean(),
  decidedAt: z.string().datetime(),
}).strict();

export const PrivateDomainTeachingIssueSchema = z.enum([
  "TEACHING_VALUE_UNCLEAR",
  "PROMPTS_NEED_ADJUSTMENT",
  "CAUTIONS_INSUFFICIENT",
]);

const PrivateDomainTeachingBatchItemSchema = z.object({
  reviewCaseId: PrivateDomainReviewCaseIdSchema,
  expectedRevision: z.number().int().positive(),
  expectedStateHash: Sha256Schema,
  decision: PrivateDomainReviewDecisionSchema,
  issueKeys: z.array(PrivateDomainTeachingIssueSchema).max(3),
  note: z.string().trim().max(300),
}).strict().superRefine((value, context) => {
  if (value.decision === "APPROVE" && value.issueKeys.length > 0) {
    context.addIssue({ code: "custom", path: ["issueKeys"], message: "Approved teaching decisions cannot carry issue keys" });
  }
  if (value.decision === "HOLD" && value.issueKeys.length === 0) {
    context.addIssue({ code: "custom", path: ["issueKeys"], message: "Held teaching decisions require at least one issue key" });
  }
  if (value.decision === "REJECT" && value.note.length === 0) {
    context.addIssue({ code: "custom", path: ["note"], message: "Rejected teaching decisions require a note" });
  }
});

export const PrivateDomainTeachingBatchBodySchema = z.object({
  items: z.array(PrivateDomainTeachingBatchItemSchema).min(1).max(12),
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict().superRefine((value, context) => {
  const ids = value.items.map((item) => item.reviewCaseId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["items"], message: "Teaching batch review case ids must be unique" });
});

export const PrivateDomainTeachingBatchReceiptSchema = z.object({
  receipts: z.array(PrivateDomainReviewDecisionReceiptSchema).min(1).max(12),
  summary: z.object({
    total: z.number().int().positive().max(12),
    approved: z.number().int().nonnegative(),
    held: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    replayed: z.number().int().nonnegative(),
  }).strict(),
}).strict().superRefine((value, context) => {
  const summary = value.summary;
  if (value.receipts.length !== summary.total || summary.total !== summary.approved + summary.held + summary.rejected) {
    context.addIssue({ code: "custom", path: ["summary"], message: "Teaching batch totals are inconsistent" });
  }
});

export const PrivateDomainNonTeachingBaselineBodySchema = z.object({
  scope: z.literal("CURRENT_PRIVATE_REVIEW_QUEUE"),
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict();

export const PrivateDomainNonTeachingBaselineReceiptSchema = z.object({
  totalCases: z.number().int().nonnegative(),
  decisionsCreated: z.number().int().nonnegative(),
  alreadyDecided: z.number().int().nonnegative(),
  remainingPendingDomains: z.number().int().nonnegative(),
  decidedAt: z.string().datetime(),
}).strict();

const PrivateDomainReviewQueueItemSchema = z.object({
  reviewCaseId: PrivateDomainReviewCaseIdSchema,
  draftId: PrivateWikiDraftIdSchema,
  candidateId: CandidateIdSchema,
  revision: z.number().int().positive(),
  stage: PrivateDomainReviewStageSchema,
  title: z.string().trim().min(1).max(240),
  primaryCategory: z.string().trim().min(1).max(80),
  artisticStyleLabels: z.array(z.string().trim().min(1).max(40)).min(1).max(3),
  primaryPreviewUrl: z.string().regex(/^\/api\/teacher\/inspiration-wiki\/review-packs\//),
  stateHash: Sha256Schema,
  teaching: z.object({
    recommendation: z.enum(["RECOMMEND", "DO_NOT_RECOMMEND"]),
    rationale: z.string().trim().min(1).max(2_000),
    prompts: z.array(z.string().trim().min(1).max(600)).min(1).max(12),
    cautions: z.array(z.string().trim().min(1).max(600)).max(12),
  }).strict(),
  reviewedDomainCount: z.number().int().min(0).max(4),
  domains: PrivateDomainReviewStateSchema,
  updatedAt: z.string().datetime(),
}).strict();

export const TeacherPrivateDomainReviewQueueSchema = z.object({
  items: z.array(PrivateDomainReviewQueueItemSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    hold: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    complete: z.number().int().nonnegative(),
    reviewedDomains: z.number().int().nonnegative(),
    totalDomains: z.number().int().nonnegative(),
    rightsUnknown: z.number().int().nonnegative(),
    teachingPending: z.number().int().nonnegative(),
    teachingApproved: z.number().int().nonnegative(),
    teachingHold: z.number().int().nonnegative(),
    teachingRejected: z.number().int().nonnegative(),
    nonTeachingApproved: z.number().int().nonnegative(),
    nonTeachingTotal: z.number().int().nonnegative(),
    boundary: z.object({
      studentVisible: z.literal(false),
      currentPage: z.literal("DISABLED"),
      r2: z.literal("DISABLED"),
      embedding: z.literal("DISABLED"),
      lumiRetrieval: z.literal("DISABLED"),
      canonicalCompilation: z.literal("DISABLED"),
    }).strict(),
  }).strict(),
}).strict().superRefine((value, context) => {
  const meta = value.meta;
  if (value.items.length !== meta.total || meta.total !== meta.pending + meta.hold + meta.rejected + meta.complete || meta.totalDomains !== meta.total * 4
    || meta.total !== meta.teachingPending + meta.teachingApproved + meta.teachingHold + meta.teachingRejected
    || meta.nonTeachingTotal !== meta.total * 3) {
    context.addIssue({ code: "custom", path: ["meta"], message: "Private domain review totals are inconsistent" });
  }
});

export const TeacherPrivateDomainReviewDetailSchema = z.object({
  reviewCase: PrivateDomainReviewCaseSchema,
  draft: PrivateWikiDraftSchema,
}).strict();

export type PrivateDomainReviewDecisionBody = z.infer<typeof PrivateDomainReviewDecisionBodySchema>;
export type PrivateDomainTeachingBatchBody = z.infer<typeof PrivateDomainTeachingBatchBodySchema>;
export type PrivateDomainNonTeachingBaselineBody = z.infer<typeof PrivateDomainNonTeachingBaselineBodySchema>;
export type TeacherPrivateDomainReviewQueue = z.infer<typeof TeacherPrivateDomainReviewQueueSchema>;
export type TeacherPrivateDomainReviewDetail = z.infer<typeof TeacherPrivateDomainReviewDetailSchema>;

import { z } from "zod";

import {
  ReviewPackIdSchema,
  ReviewPackRequirementKeySchema,
  ReviewPackSourcePlatformSchema,
} from "./review-pack-contracts";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const CandidateIdSchema = z.string().regex(/^hermes-candidate:[0-9a-f]{32}$/);
const RelativePreviewUrlSchema = z.string().regex(/^\/api\/teacher\/inspiration-wiki\/review-packs\//);
export const EvidenceGapReviewPackIdSchema = ReviewPackIdSchema;

export const EvidenceGapReviewStageSchema = z.enum([
  "READY_FOR_TEACHER_TRIAGE",
  "RETURNED_TO_CODEX",
  "REJECTED",
  "PRIVATE_WIKIDRAFT_WITH_GAPS",
]);

export const EvidenceGapRequirementStatusSchema = z.enum([
  "VERIFIED",
  "UNKNOWN",
  "PRESENT_UNVERIFIED",
  "MISSING",
  "BLOCKED",
]);

const RequirementStateSchema = z.object({
  status: EvidenceGapRequirementStatusSchema,
  note: z.string().trim().min(1).max(500).nullable(),
  evidenceRefs: z.array(z.string().trim().min(1).max(160)).max(20),
}).strict();

export const EvidenceGapReadinessSchema = z.object({
  controlledMediaGroup: RequirementStateSchema,
  workSourceMatch: RequirementStateSchema,
  sourceRole: RequirementStateSchema,
  rightsEvidence: RequirementStateSchema,
  normalizedClassification: RequirementStateSchema,
  visualDescription: RequirementStateSchema,
  duplicateRelationship: RequirementStateSchema,
  curationRecommendation: RequirementStateSchema,
  teachingRecommendation: RequirementStateSchema,
}).strict().superRefine((readiness, context) => {
  if (Object.values(readiness).every((requirement) => requirement.status === "VERIFIED")) {
    context.addIssue({
      code: "custom",
      message: "Evidence-gap review requires at least one non-verified requirement",
    });
  }
});

export type EvidenceGapReadiness = z.infer<typeof EvidenceGapReadinessSchema>;

const REQUIREMENT_FIELD_BY_KEY = {
  CONTROLLED_MEDIA_GROUP: "controlledMediaGroup",
  WORK_SOURCE_MATCH: "workSourceMatch",
  SOURCE_ROLE: "sourceRole",
  RIGHTS_EVIDENCE: "rightsEvidence",
  NORMALIZED_CLASSIFICATION: "normalizedClassification",
  VISUAL_DESCRIPTION: "visualDescription",
  DUPLICATE_RELATIONSHIP: "duplicateRelationship",
  CURATION_RECOMMENDATION: "curationRecommendation",
  TEACHING_RECOMMENDATION: "teachingRecommendation",
} as const satisfies Record<z.infer<typeof ReviewPackRequirementKeySchema>, keyof EvidenceGapReadiness>;

export function evidenceGapRequirementKeys(readiness: EvidenceGapReadiness) {
  const parsed = EvidenceGapReadinessSchema.parse(readiness);
  return Object.entries(REQUIREMENT_FIELD_BY_KEY)
    .filter(([, field]) => parsed[field].status !== "VERIFIED")
    .map(([key]) => key as z.infer<typeof ReviewPackRequirementKeySchema>);
}

export function evidenceGapAcceptanceRequirementKeys(readiness: EvidenceGapReadiness) {
  const parsed = EvidenceGapReadinessSchema.parse(readiness);
  return Object.entries(REQUIREMENT_FIELD_BY_KEY)
    .filter(([, field]) => !["VERIFIED", "UNKNOWN"].includes(parsed[field].status))
    .map(([key]) => key as z.infer<typeof ReviewPackRequirementKeySchema>);
}

export function evidenceGapVerifiedCount(readiness: EvidenceGapReadiness) {
  return 9 - evidenceGapRequirementKeys(readiness).length;
}

const EvidenceGapSourceSchema = z.object({
  sourceId: z.string().trim().min(1).max(128),
  platform: ReviewPackSourcePlatformSchema,
  pageUrl: z.string().url(),
  role: z.enum([
    "UNVERIFIED",
    "DISCOVERY_POINTER",
    "CREATOR_WORK_PAGE",
    "CURATORIAL_INDEX",
    "ORIGINAL_PUBLISHER_RECORD",
  ]),
  label: z.string().trim().min(1).max(120).nullable(),
  creatorName: z.string().trim().min(1).max(160).nullable(),
  curatorName: z.string().trim().min(1).max(160).nullable(),
  evidenceStatement: z.string().trim().min(1).max(500).nullable(),
}).strict();

const EvidenceGapMediaSchema = z.object({
  mediaId: z.string().trim().min(1).max(128),
  reviewStatus: z.enum(["UNVERIFIED", "VERIFIED_FOR_PRIVATE_REVIEW"]),
  role: z.enum(["COVER", "DETAIL", "PROCESS", "CONTEXT"]).nullable(),
  previewUrl: RelativePreviewUrlSchema,
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  sha256: Sha256Schema,
  alt: z.string().trim().min(1).max(240).nullable(),
}).strict();

const EvidenceGapRightsEvidenceSchema = z.object({
  evidenceId: z.string().trim().min(1).max(128),
  evidenceType: z.enum([
    "SOURCE_TERMS",
    "CREATOR_PERMISSION",
    "LICENSE",
    "INSTITUTIONAL_POLICY",
    "RIGHTS_HOLDER_STATEMENT",
  ]).nullable(),
  sourceUrl: z.string().url().nullable(),
  capturedAt: z.string().datetime().nullable(),
  summary: z.string().trim().min(1).max(800).nullable(),
  privateTeacherReviewDecision: z.enum(["ALLOW", "DENY", "UNKNOWN"]).nullable(),
  republicationDecision: z.enum(["ALLOW", "DENY", "UNKNOWN"]).nullable(),
  authorPageIsNotRepublishingPermission: z.literal(true).nullable(),
}).strict();

const CapabilityBoundarySchema = z.object({
  teacherPrivate: z.literal(true),
  studentVisible: z.literal(false),
  currentPage: z.literal("DISABLED"),
  r2: z.literal("DISABLED"),
  embedding: z.literal("DISABLED"),
  lumiRetrieval: z.literal("DISABLED"),
}).strict();

export const EvidenceGapReviewPackSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-evidence-gap-review-pack/v1"),
  contractKind: z.literal("EVIDENCE_GAP_REVIEW"),
  reviewPackId: ReviewPackIdSchema,
  candidateId: CandidateIdSchema,
  revision: z.number().int().positive(),
  stage: z.literal("READY_FOR_TEACHER_TRIAGE"),
  materialHash: Sha256Schema,
  preparedAt: z.string().datetime(),
  work: z.object({
    title: z.string().trim().min(1).max(240).nullable(),
    creators: z.array(z.string().trim().min(1).max(160)).max(20),
    year: z.string().trim().min(1).max(40).nullable(),
    workSourceMatchEvidence: z.array(z.string().trim().min(1).max(300)).max(10),
  }).strict(),
  sources: z.array(EvidenceGapSourceSchema).max(12),
  mediaGroup: z.array(EvidenceGapMediaSchema).max(20),
  rightsEvidence: z.array(EvidenceGapRightsEvidenceSchema).max(20),
  normalizedClassification: z.object({
    primary: z.string().trim().min(1).max(80).nullable(),
    secondary: z.array(z.string().trim().min(1).max(80)).max(12),
    sourceTerms: z.array(z.string().trim().min(1).max(120)).max(30),
  }).strict(),
  visualDescription: z.object({
    summary: z.string().trim().min(1).max(1_200).nullable(),
    artisticStyle: z.object({
      labels: z.array(z.string().trim().min(1).max(40)).min(1).max(3),
      rationale: z.string().trim().min(1).max(500),
    }).strict().optional(),
    observations: z.array(z.object({
      observation: z.string().trim().min(1).max(400),
      mediaIds: z.array(z.string().trim().min(1).max(128)).max(20),
    }).strict()).max(30),
  }).strict(),
  duplicateRelationship: z.object({
    status: z.enum(["UNASSESSED", "DISTINCT", "VARIANT_OF", "DUPLICATE_OF"]),
    relatedCandidateIds: z.array(CandidateIdSchema).max(20),
    explanation: z.string().trim().min(1).max(800).nullable(),
  }).strict(),
  curationRecommendation: z.object({
    recommendation: z.enum(["UNASSESSED", "RECOMMEND", "DO_NOT_RECOMMEND"]),
    rationale: z.string().trim().min(1).max(1_000).nullable(),
  }).strict(),
  teachingRecommendation: z.object({
    recommendation: z.enum(["UNASSESSED", "RECOMMEND", "DO_NOT_RECOMMEND"]),
    rationale: z.string().trim().min(1).max(1_000).nullable(),
    prompts: z.array(z.string().trim().min(1).max(300)).max(12),
    cautions: z.array(z.string().trim().min(1).max(300)).max(12),
  }).strict(),
  safetyAssessment: z.object({
    status: z.enum(["UNASSESSED", "READY_FOR_TEACHER_DECISION", "BLOCKED"]),
    evidence: z.array(z.string().trim().min(1).max(500)).max(20),
  }).strict(),
  readiness: EvidenceGapReadinessSchema,
  capabilityBoundary: CapabilityBoundarySchema,
}).strict().superRefine((pack, context) => {
  const mediaIds = new Set(pack.mediaGroup.map((media) => media.mediaId));
  if (mediaIds.size !== pack.mediaGroup.length) {
    context.addIssue({ code: "custom", path: ["mediaGroup"], message: "mediaId values must be unique" });
  }
  for (const [index, observation] of pack.visualDescription.observations.entries()) {
    if (observation.mediaIds.some((mediaId) => !mediaIds.has(mediaId))) {
      context.addIssue({
        code: "custom",
        path: ["visualDescription", "observations", index, "mediaIds"],
        message: "Visual observations may only reference available evidence media",
      });
    }
  }
});

export const EvidenceGapFinalActionSchema = z.enum([
  "RETURN_TO_CODEX",
  "REJECT_CANDIDATE",
  "ENTER_PRIVATE_WIKIDRAFT",
]);

const EvidenceGapReviewDecisionFieldsSchema = z.object({
  reviewPackRevision: z.number().int().positive(),
  finalAction: EvidenceGapFinalActionSchema,
  acceptedGapKeys: z.array(ReviewPackRequirementKeySchema).max(9),
  note: z.string().trim().max(300),
  privateDraftOnly: z.boolean(),
  idempotencyKey: z.string().min(8).max(128),
}).strict();

function refineEvidenceGapDecision(
  decision: z.infer<typeof EvidenceGapReviewDecisionFieldsSchema>,
  context: z.RefinementCtx,
) {
  if (new Set(decision.acceptedGapKeys).size !== decision.acceptedGapKeys.length) {
    context.addIssue({ code: "custom", path: ["acceptedGapKeys"], message: "acceptedGapKeys must be unique" });
  }
  if (decision.finalAction === "ENTER_PRIVATE_WIKIDRAFT") {
    if (!decision.privateDraftOnly) {
      context.addIssue({ code: "custom", path: ["privateDraftOnly"], message: "Gap drafts must remain private" });
    }
  } else {
    if (decision.note.length === 0) {
      context.addIssue({ code: "custom", path: ["note"], message: "Return and reject actions require a reason" });
    }
    if (decision.privateDraftOnly) {
      context.addIssue({ code: "custom", path: ["privateDraftOnly"], message: "Only private draft entry may set privateDraftOnly" });
    }
    if (decision.acceptedGapKeys.length > 0) {
      context.addIssue({ code: "custom", path: ["acceptedGapKeys"], message: "Non-draft actions cannot accept evidence gaps" });
    }
  }
}

export const EvidenceGapReviewDecisionBodySchema = EvidenceGapReviewDecisionFieldsSchema
  .superRefine(refineEvidenceGapDecision);

export const EvidenceGapReviewDecisionInputSchema = EvidenceGapReviewDecisionFieldsSchema.extend({
  reviewPackId: EvidenceGapReviewPackIdSchema,
}).strict().superRefine(refineEvidenceGapDecision);

export const EvidenceGapReviewDecisionContextSchema = z.object({
  pack: EvidenceGapReviewPackSchema,
  decision: EvidenceGapReviewDecisionInputSchema,
}).strict().superRefine(({ pack, decision }, context) => {
  if (decision.reviewPackId !== pack.reviewPackId || decision.reviewPackRevision !== pack.revision) {
    context.addIssue({ code: "custom", path: ["decision", "reviewPackRevision"], message: "Review pack revision conflict" });
  }
  if (decision.finalAction !== "ENTER_PRIVATE_WIKIDRAFT") return;
  const expected = evidenceGapAcceptanceRequirementKeys(pack.readiness).sort();
  const accepted = [...decision.acceptedGapKeys].sort();
  if (expected.length !== accepted.length || expected.some((key, index) => key !== accepted[index])) {
    context.addIssue({
      code: "custom",
      path: ["decision", "acceptedGapKeys"],
      message: "Private gap draft entry must explicitly accept every unresolved requirement; confirmed unknowns need no acceptance",
    });
  }
});

const EvidenceGapReviewTransitionReceiptSchema = z.object({
  reviewPackId: EvidenceGapReviewPackIdSchema,
  previousRevision: z.number().int().positive(),
  revision: z.number().int().positive(),
  finalAction: EvidenceGapFinalActionSchema,
  stage: z.enum(["RETURNED_TO_CODEX", "REJECTED", "PRIVATE_WIKIDRAFT_WITH_GAPS"]),
  capabilityBoundary: CapabilityBoundarySchema,
}).strict();

export const TeacherEvidenceGapReviewDecisionReceiptSchema = EvidenceGapReviewTransitionReceiptSchema.extend({
  decidedAt: z.string().datetime(),
  replayed: z.boolean(),
  nextReviewPackId: EvidenceGapReviewPackIdSchema.nullable(),
}).strict();

export const TeacherEvidenceGapReviewEditContextSchema = z.object({
  currentStage: z.enum([
    "READY_FOR_TEACHER_TRIAGE",
    "RETURNED_TO_CODEX",
    "REJECTED",
    "PRIVATE_WIKIDRAFT_WITH_GAPS",
  ]),
  currentReviewRevision: z.number().int().positive(),
  latestDecision: z.object({
    reviewPackRevision: z.number().int().positive(),
    acceptedGapKeys: z.array(ReviewPackRequirementKeySchema).max(9),
    finalAction: EvidenceGapFinalActionSchema,
    note: z.string().trim().max(300),
    privateDraftOnly: z.boolean(),
    decidedAt: z.string().datetime(),
  }).strict().nullable(),
}).strict();

const EvidenceGapQueueItemBaseSchema = z.object({
  contractKind: z.literal("EVIDENCE_GAP_REVIEW"),
  reviewPackId: EvidenceGapReviewPackIdSchema,
  candidateId: CandidateIdSchema,
  revision: z.number().int().positive(),
  title: z.string().trim().min(1).max(240).nullable(),
  primaryPreviewUrl: RelativePreviewUrlSchema.nullable(),
  sourceSummary: z.string().trim().min(1).max(500).nullable(),
  verifiedCount: z.number().int().min(0).max(8),
  missingGates: z.array(ReviewPackRequirementKeySchema).min(1).max(9),
  updatedAt: z.string().datetime(),
}).strict();

const GateStatusCountSchema = z.object({
  VERIFIED: z.number().int().nonnegative(),
  UNKNOWN: z.number().int().nonnegative(),
  PRESENT_UNVERIFIED: z.number().int().nonnegative(),
  MISSING: z.number().int().nonnegative(),
  BLOCKED: z.number().int().nonnegative(),
}).strict();

export const TeacherEvidenceGapReviewQueueSchema = z.object({
  items: z.array(EvidenceGapQueueItemBaseSchema.extend({
    stage: z.literal("READY_FOR_TEACHER_TRIAGE"),
  }).strict()),
  reviewedItems: z.array(EvidenceGapQueueItemBaseSchema.extend({
    stage: z.enum(["RETURNED_TO_CODEX", "REJECTED", "PRIVATE_WIKIDRAFT_WITH_GAPS"]),
  }).strict()),
  meta: z.object({
    totalEvidenceGapPacks: z.number().int().nonnegative(),
    teacherTriageReady: z.number().int().nonnegative(),
    teacherReviewed: z.number().int().nonnegative(),
    withLocalMedia: z.number().int().nonnegative(),
    withoutLocalMedia: z.number().int().nonnegative(),
    gateStatusCounts: z.record(ReviewPackRequirementKeySchema, GateStatusCountSchema),
    boundary: z.object({
      studentVisible: z.literal(false),
      currentPage: z.literal("DISABLED"),
      r2: z.literal("DISABLED"),
      embedding: z.literal("DISABLED"),
      lumiRetrieval: z.literal("DISABLED"),
    }).strict(),
  }).strict(),
}).strict().superRefine((queue, context) => {
  if (queue.items.length !== queue.meta.teacherTriageReady
    || queue.reviewedItems.length !== queue.meta.teacherReviewed
    || queue.meta.totalEvidenceGapPacks !== queue.meta.teacherTriageReady + queue.meta.teacherReviewed
    || queue.meta.totalEvidenceGapPacks !== queue.meta.withLocalMedia + queue.meta.withoutLocalMedia) {
    context.addIssue({ code: "custom", path: ["meta"], message: "Evidence-gap queue totals are inconsistent" });
  }
});

export function transitionEvidenceGapReviewPack(
  rawPack: unknown,
  rawDecision: unknown,
) {
  const { pack, decision } = EvidenceGapReviewDecisionContextSchema.parse({
    pack: rawPack,
    decision: rawDecision,
  });
  return EvidenceGapReviewTransitionReceiptSchema.parse({
    reviewPackId: pack.reviewPackId,
    previousRevision: pack.revision,
    revision: pack.revision + 1,
    finalAction: decision.finalAction,
    stage: {
      RETURN_TO_CODEX: "RETURNED_TO_CODEX",
      REJECT_CANDIDATE: "REJECTED",
      ENTER_PRIVATE_WIKIDRAFT: "PRIVATE_WIKIDRAFT_WITH_GAPS",
    }[decision.finalAction],
    capabilityBoundary: pack.capabilityBoundary,
  });
}

export type EvidenceGapReviewPack = z.infer<typeof EvidenceGapReviewPackSchema>;
export type EvidenceGapReviewDecisionInput = z.infer<typeof EvidenceGapReviewDecisionInputSchema>;
export type TeacherEvidenceGapReviewEditContext = z.infer<typeof TeacherEvidenceGapReviewEditContextSchema>;

import { z } from "zod";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const RelativePreviewUrlSchema = z.string().regex(/^\/(?:api\/teacher\/inspiration-wiki\/review-packs\/|demo\/)/);
export const ReviewPackIdSchema = z.string().regex(/^review-pack:[a-z0-9][a-z0-9-]{7,95}$/);

export const ReviewPackStageSchema = z.enum([
  "GOVERNANCE_MATERIAL",
  "PACKAGING",
  "READY_FOR_TEACHER_REVIEW",
  "RETURNED_TO_CODEX",
  "REJECTED",
  "PRIVATE_WIKIDRAFT",
]);

export const ReviewPackRequirementKeySchema = z.enum([
  "CONTROLLED_MEDIA_GROUP",
  "WORK_SOURCE_MATCH",
  "SOURCE_ROLE",
  "RIGHTS_EVIDENCE",
  "NORMALIZED_CLASSIFICATION",
  "VISUAL_DESCRIPTION",
  "DUPLICATE_RELATIONSHIP",
  "CURATION_RECOMMENDATION",
  "TEACHING_RECOMMENDATION",
]);

export const ReviewPackPreparationSchema = z.object({
  controlledMediaGroup: z.boolean(),
  workSourceMatch: z.boolean(),
  sourceRole: z.boolean(),
  rightsEvidence: z.boolean(),
  normalizedClassification: z.boolean(),
  visualDescription: z.boolean(),
  duplicateRelationship: z.boolean(),
  curationRecommendation: z.boolean(),
  teachingRecommendation: z.boolean(),
}).strict();

export const ReviewPackSourcePlatformSchema = z.enum([
  "PINTEREST",
  "BEHANCE",
  "NOTEFOLIO",
  "RECENT_DESIGN",
  "BPANDO",
  "HESIGN",
  "TYPOGRAPHIC_POSTERS",
  "ORIGINAL_PUBLISHER",
  "OTHER_PUBLIC_WEB",
]);

export const ReviewPackSourceRoleSchema = z.enum([
  "DISCOVERY_POINTER",
  "CREATOR_WORK_PAGE",
  "CURATORIAL_INDEX",
  "ORIGINAL_PUBLISHER_RECORD",
]);

export const ReviewPackSourceSchema = z.object({
  sourceId: z.string().trim().min(1).max(128),
  platform: ReviewPackSourcePlatformSchema,
  role: ReviewPackSourceRoleSchema,
  label: z.string().trim().min(1).max(120),
  pageUrl: z.string().url(),
  creatorName: z.string().trim().min(1).max(160).nullable(),
  curatorName: z.string().trim().min(1).max(160).nullable(),
  creatorRelationship: z.enum([
    "DISCOVERY_ONLY",
    "DIRECT_CREATOR_PAGE",
    "CURATED_CREATOR_RECORD",
    "ORIGINAL_PUBLISHER_RECORD",
  ]),
  evidenceStatement: z.string().trim().min(1).max(500),
}).strict().superRefine((source, context) => {
  const curatorialPlatforms = new Set(["RECENT_DESIGN", "BPANDO", "TYPOGRAPHIC_POSTERS"]);
  if (source.platform === "PINTEREST" && (source.role !== "DISCOVERY_POINTER" || source.creatorRelationship !== "DISCOVERY_ONLY")) {
    context.addIssue({ code: "custom", path: ["role"], message: "Pinterest只能作为发现入口" });
  }
  if ((source.platform === "BEHANCE" || source.platform === "NOTEFOLIO")
    && (source.role !== "CREATOR_WORK_PAGE" || source.creatorRelationship !== "DIRECT_CREATOR_PAGE")) {
    context.addIssue({ code: "custom", path: ["role"], message: "Behance/Notefolio只能作为作者作品页证据" });
  }
  if (curatorialPlatforms.has(source.platform)
    && (source.role !== "CURATORIAL_INDEX" || source.creatorRelationship !== "CURATED_CREATOR_RECORD" || source.curatorName === null)) {
    context.addIssue({ code: "custom", path: ["role"], message: "策展索引必须保留策展来源与原始创作者关系" });
  }
  if (source.platform === "HESIGN") {
    const isCreatorWorkPage = source.role === "CREATOR_WORK_PAGE"
      && source.creatorRelationship === "DIRECT_CREATOR_PAGE";
    const isCuratorialIndex = source.role === "CURATORIAL_INDEX"
      && source.creatorRelationship === "CURATED_CREATOR_RECORD"
      && source.curatorName !== null;
    if (!isCreatorWorkPage && !isCuratorialIndex) {
      context.addIssue({ code: "custom", path: ["role"], message: "Hesign必须按具体页面区分官方作品页与策展记录" });
    }
  }
});

export const ReviewPackControlledMediaSchema = z.object({
  mediaId: z.string().trim().min(1).max(128),
  role: z.enum(["COVER", "DETAIL", "PROCESS", "CONTEXT"]),
  previewUrl: RelativePreviewUrlSchema,
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  sha256: Sha256Schema,
  alt: z.string().trim().min(1).max(240),
}).strict();

export const ReviewPackRightsEvidenceSchema = z.object({
  evidenceId: z.string().trim().min(1).max(128),
  evidenceType: z.enum([
    "SOURCE_TERMS",
    "CREATOR_PERMISSION",
    "LICENSE",
    "INSTITUTIONAL_POLICY",
    "RIGHTS_HOLDER_STATEMENT",
  ]),
  sourceUrl: z.string().url(),
  capturedAt: z.string().datetime(),
  summary: z.string().trim().min(1).max(800),
  privateTeacherReviewDecision: z.enum(["ALLOW", "DENY", "UNKNOWN"]),
  republicationDecision: z.enum(["ALLOW", "DENY", "UNKNOWN"]),
  authorPageIsNotRepublishingPermission: z.literal(true),
}).strict();

export const StrictReviewPackSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-review-pack/v1"),
  reviewPackId: ReviewPackIdSchema,
  candidateId: z.string().regex(/^hermes-candidate:[0-9a-f]{32}$/),
  revision: z.number().int().positive(),
  stage: z.literal("READY_FOR_TEACHER_REVIEW"),
  materialHash: Sha256Schema,
  preparedAt: z.string().datetime(),
  work: z.object({
    title: z.string().trim().min(1).max(240),
    creators: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
    year: z.string().trim().min(1).max(40).nullable(),
    workSourceMatch: z.object({
      status: z.literal("MATCHED"),
      evidence: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    }).strict(),
  }).strict(),
  sources: z.array(ReviewPackSourceSchema).min(1).max(12),
  mediaGroup: z.array(ReviewPackControlledMediaSchema).min(1).max(20),
  rightsEvidence: z.array(ReviewPackRightsEvidenceSchema).min(1).max(20),
  normalizedClassification: z.object({
    primary: z.string().trim().min(1).max(80),
    secondary: z.array(z.string().trim().min(1).max(80)).max(12),
    sourceTerms: z.array(z.string().trim().min(1).max(120)).max(30),
  }).strict(),
  visualDescription: z.object({
    summary: z.string().trim().min(1).max(1_200),
    observations: z.array(z.object({
      observation: z.string().trim().min(1).max(400),
      mediaIds: z.array(z.string().trim().min(1).max(128)).min(1).max(20),
    }).strict()).min(1).max(30),
  }).strict(),
  duplicateRelationship: z.object({
    status: z.enum(["DISTINCT", "VARIANT_OF", "DUPLICATE_OF"]),
    relatedCandidateIds: z.array(z.string().regex(/^hermes-candidate:[0-9a-f]{32}$/)).max(20),
    explanation: z.string().trim().min(1).max(800),
  }).strict(),
  curationRecommendation: z.object({
    recommendation: z.enum(["RECOMMEND", "DO_NOT_RECOMMEND"]),
    rationale: z.string().trim().min(1).max(1_000),
  }).strict(),
  teachingRecommendation: z.object({
    recommendation: z.enum(["RECOMMEND", "DO_NOT_RECOMMEND"]),
    rationale: z.string().trim().min(1).max(1_000),
    prompts: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
    cautions: z.array(z.string().trim().min(1).max(300)).max(12),
  }).strict(),
  safetyAssessment: z.object({
    status: z.literal("READY_FOR_TEACHER_DECISION"),
    evidence: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  }).strict(),
  readiness: ReviewPackPreparationSchema.extend({
    controlledMediaGroup: z.literal(true),
    workSourceMatch: z.literal(true),
    sourceRole: z.literal(true),
    rightsEvidence: z.literal(true),
    normalizedClassification: z.literal(true),
    visualDescription: z.literal(true),
    duplicateRelationship: z.literal(true),
    curationRecommendation: z.literal(true),
    teachingRecommendation: z.literal(true),
  }).strict(),
  capabilityBoundary: z.object({
    teacherPrivate: z.literal(true),
    studentVisible: z.literal(false),
    currentPage: z.literal("DISABLED"),
    r2: z.literal("DISABLED"),
    embedding: z.literal("DISABLED"),
    lumiRetrieval: z.literal("DISABLED"),
  }).strict(),
}).strict().superRefine((reviewPack, context) => {
  const mediaIds = new Set(reviewPack.mediaGroup.map((media) => media.mediaId));
  for (const [index, observation] of reviewPack.visualDescription.observations.entries()) {
    if (observation.mediaIds.some((mediaId) => !mediaIds.has(mediaId))) {
      context.addIssue({ code: "custom", path: ["visualDescription", "observations", index, "mediaIds"], message: "视觉观察必须绑定受控图组" });
    }
  }
  if (!reviewPack.sources.some((source) => source.role !== "DISCOVERY_POINTER")) {
    context.addIssue({ code: "custom", path: ["sources"], message: "发现入口不能替代作品或策展来源" });
  }
});

export const ReviewPackTeacherAssessmentSchema = z.object({
  workSourceMatch: z.enum(["MATCH", "UNCERTAIN"]),
  classificationDescription: z.enum(["ACCURATE", "NEEDS_ADJUSTMENT"]),
  curationValue: z.enum(["VALUABLE", "EXCLUDE"]),
  teachingValue: z.enum(["VALUABLE", "EXCLUDE"]),
  rightsSafety: z.enum(["SUFFICIENT_FOR_PRIVATE_WIKIDRAFT", "NEEDS_MORE_EVIDENCE", "BLOCKED"]),
  duplicateRelationship: z.enum(["DISTINCT", "VARIANT", "DUPLICATE", "UNCERTAIN"]),
}).strict();

export const ReviewPackFinalActionSchema = z.enum([
  "RETURN_TO_CODEX",
  "REJECT_CANDIDATE",
  "ENTER_PRIVATE_WIKIDRAFT",
]);

const ReviewPackDecisionFieldsSchema = z.object({
  reviewPackRevision: z.number().int().positive(),
  assessment: ReviewPackTeacherAssessmentSchema,
  finalAction: ReviewPackFinalActionSchema,
  note: z.string().trim().max(300),
  idempotencyKey: z.string().min(8).max(128),
}).strict();

function refineReviewPackDecision(
  input: z.infer<typeof ReviewPackDecisionFieldsSchema>,
  context: z.RefinementCtx,
) {
  if ((input.finalAction === "RETURN_TO_CODEX" || input.finalAction === "REJECT_CANDIDATE") && input.note.length === 0) {
    context.addIssue({ code: "custom", path: ["note"], message: "退回或拒绝必须说明原因" });
  }
  if (input.finalAction === "ENTER_PRIVATE_WIKIDRAFT") {
    const accepted = input.assessment.workSourceMatch === "MATCH"
      && input.assessment.classificationDescription === "ACCURATE"
      && input.assessment.curationValue === "VALUABLE"
      && input.assessment.teachingValue === "VALUABLE"
      && input.assessment.rightsSafety === "SUFFICIENT_FOR_PRIVATE_WIKIDRAFT"
      && (input.assessment.duplicateRelationship === "DISTINCT" || input.assessment.duplicateRelationship === "VARIANT");
    if (!accepted) context.addIssue({ code: "custom", path: ["finalAction"], message: "判断未全部通过时不能进入私有WikiDraft" });
  }
}

export const ReviewPackDecisionBodySchema = ReviewPackDecisionFieldsSchema.superRefine(refineReviewPackDecision);

export const ReviewPackDecisionInputSchema = ReviewPackDecisionFieldsSchema.extend({
  reviewPackId: ReviewPackIdSchema,
}).strict().superRefine(refineReviewPackDecision);

export const TeacherReviewPackDecisionReceiptSchema = z.object({
  reviewPackId: ReviewPackIdSchema,
  previousRevision: z.number().int().positive(),
  revision: z.number().int().positive(),
  finalAction: ReviewPackFinalActionSchema,
  stage: ReviewPackStageSchema,
  capabilityBoundary: z.object({
    teacherPrivate: z.literal(true),
    studentVisible: z.literal(false),
    currentPage: z.literal("DISABLED"),
    r2: z.literal("DISABLED"),
    embedding: z.literal("DISABLED"),
    lumiRetrieval: z.literal("DISABLED"),
  }).strict(),
  decidedAt: z.string().datetime(),
  replayed: z.boolean(),
  nextReviewPackId: ReviewPackIdSchema.nullable(),
}).strict();

export const TeacherReviewPackEditContextSchema = z.object({
  currentStage: z.enum([
    "READY_FOR_TEACHER_REVIEW",
    "RETURNED_TO_CODEX",
    "REJECTED",
    "PRIVATE_WIKIDRAFT",
  ]),
  currentReviewRevision: z.number().int().positive(),
  latestDecision: z.object({
    reviewPackRevision: z.number().int().positive(),
    assessment: ReviewPackTeacherAssessmentSchema,
    finalAction: ReviewPackFinalActionSchema,
    note: z.string().max(300),
    decidedAt: z.string().datetime(),
  }).strict().nullable(),
}).strict();

export const TeacherReviewPackQueueSchema = z.object({
  items: z.array(z.object({
    reviewPackId: z.string(),
    candidateId: z.string(),
    revision: z.number().int().positive(),
    title: z.string(),
    primaryPreviewUrl: RelativePreviewUrlSchema,
    sourceSummary: z.string(),
    updatedAt: z.string().datetime(),
  }).strict()),
  reviewedItems: z.array(z.object({
    reviewPackId: z.string(),
    candidateId: z.string(),
    revision: z.number().int().positive(),
    title: z.string(),
    primaryPreviewUrl: RelativePreviewUrlSchema,
    sourceSummary: z.string(),
    stage: z.enum(["RETURNED_TO_CODEX", "REJECTED", "PRIVATE_WIKIDRAFT"]),
    updatedAt: z.string().datetime(),
  }).strict()),
  meta: z.object({
    totalGovernanceMaterials: z.number().int().nonnegative(),
    totalReviewPacks: z.number().int().nonnegative(),
    teacherReviewReady: z.number().int().nonnegative(),
    teacherReviewed: z.number().int().nonnegative(),
    returnedToCodex: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    privateWikiDraft: z.number().int().nonnegative(),
    requiredGateCount: z.literal(9),
    completedGates: z.record(ReviewPackRequirementKeySchema, z.number().int().nonnegative()),
    boundary: z.object({
      studentVisible: z.literal(false),
      currentPage: z.literal("DISABLED"),
      r2: z.literal("DISABLED"),
      embedding: z.literal("DISABLED"),
      lumiRetrieval: z.literal("DISABLED"),
    }).strict(),
  }).strict(),
}).strict();

export type ReviewPackStage = z.infer<typeof ReviewPackStageSchema>;
export type ReviewPackPreparation = z.infer<typeof ReviewPackPreparationSchema>;
export type StrictReviewPack = z.infer<typeof StrictReviewPackSchema>;
export type ReviewPackDecisionInput = z.infer<typeof ReviewPackDecisionInputSchema>;
export type TeacherReviewPackDecisionReceipt = z.infer<typeof TeacherReviewPackDecisionReceiptSchema>;
export type TeacherReviewPackEditContext = z.infer<typeof TeacherReviewPackEditContextSchema>;

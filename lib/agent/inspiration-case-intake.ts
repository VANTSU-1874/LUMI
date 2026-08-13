import { z } from "zod";

/**
 * P1 is deliberately split into three records. PRIVATE_CANDIDATE material is
 * never a browse, RAG, or citation record; analysis is likewise private; a
 * separate publishability review can only prepare (not activate) a release.
 */
export const InspirationCaseIntakeActionSchema = z.enum([
  "RECORD_OFFICIAL_METADATA",
  "DOWNLOAD_ORIGINAL_ASSET",
  "DERIVE_PREVIEW",
  "LOCAL_PARSE",
  "OCR",
  "LOCAL_EMBEDDING",
  "EXTERNAL_EMBEDDING",
  "OBJECT_STORAGE",
  "STUDENT_DISPLAY",
  "INSTITUTIONAL_PUBLIC",
  "PUBLIC_INTERNET",
  "COMMERCIAL_REUSE",
]);

export const InspirationCasePermissionDecisionSchema = z.enum(["ALLOW", "DENY", "UNKNOWN"]);
export const InspirationCaseCandidateChannelSchema = z.enum(["DISABLED", "SHADOW", "ACTIVE"]);
export const InspirationCasePipelineStateSchema = z.enum([
  "DISCOVERED",
  "DOWNLOADED/IMPORTED",
  "NORMALIZED/DEDUPED",
  "VISUALLY_ANALYZED",
  "READY_FOR_TEACHER_REVIEW",
  "APPROVED",
  "AUTO_ADMITTED/INDEXED",
  "ACTIVE",
  "REJECTED",
  "WITHDRAWN",
]);

const CandidateIdSchema = z
  .string()
  .regex(/^inspiration-intake:[a-z0-9][a-z0-9-]{0,63}$/)
  .max(88);
const NullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
const NullableUrl = z.string().url().max(2048).nullable();

const DisabledChannelsSchema = z.object({
  browseRelease: z.literal("DISABLED"),
  textRag: z.literal("DISABLED"),
  visualRag: z.literal("DISABLED"),
}).strict();

const ActionDecisionsSchema = z.object({
  RECORD_OFFICIAL_METADATA: InspirationCasePermissionDecisionSchema,
  DOWNLOAD_ORIGINAL_ASSET: InspirationCasePermissionDecisionSchema,
  DERIVE_PREVIEW: InspirationCasePermissionDecisionSchema,
  LOCAL_PARSE: InspirationCasePermissionDecisionSchema,
  OCR: InspirationCasePermissionDecisionSchema,
  LOCAL_EMBEDDING: InspirationCasePermissionDecisionSchema,
  EXTERNAL_EMBEDDING: InspirationCasePermissionDecisionSchema,
  OBJECT_STORAGE: InspirationCasePermissionDecisionSchema,
  STUDENT_DISPLAY: InspirationCasePermissionDecisionSchema,
  INSTITUTIONAL_PUBLIC: InspirationCasePermissionDecisionSchema,
  PUBLIC_INTERNET: InspirationCasePermissionDecisionSchema,
  COMMERCIAL_REUSE: InspirationCasePermissionDecisionSchema,
}).strict();

const CandidateEvidenceSchema = z.object({
  id: z.string().regex(/^inspiration-intake-evidence:[a-z0-9][a-z0-9-]{0,63}$/).max(104),
  label: z.string().trim().min(1).max(160),
  locator: z.string().url().max(2048),
  recordedAt: z.string().datetime(),
  kind: z.enum(["RECENT_ENTRY", "ORIGINAL_SOURCE", "OFFICIAL_RIGHTS_POLICY", "CURATOR_NOTE"]),
}).strict();

/**
 * This is source-side metadata, not a declaration of authorship or ownership.
 * The Recent entry and the displayed original source intentionally remain two
 * distinct fields so a curator cannot accidentally turn one into the other.
 */
export const CurationMetadataSchema = z.object({
  curationSourceUrl: NullableUrl,
  collection: NullableText(120),
  type: NullableText(120),
  title: NullableText(240),
  description: NullableText(1_000),
  impressions: z.number().int().nonnegative().nullable(),
  outboundCount: z.number().int().nonnegative().nullable(),
  originalSourceDisplay: NullableText(240),
  originalSourceUrl: NullableUrl,
  category: NullableText(120),
  styles: z.array(z.string().trim().min(1).max(80)).max(20),
  colors: z.array(z.string().trim().min(1).max(80)).max(20),
  observedAt: z.string().datetime(),
}).strict();

export const InspirationCasePrivateCandidateSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-private-candidate/v2"),
  id: CandidateIdSchema,
  governance: z.object({
    scope: z.literal("PRIVATE_CANDIDATE"),
    stage: z.literal("INTAKE"),
    pipelineState: InspirationCasePipelineStateSchema,
    privateAcquisition: z.enum(["METADATA_ONLY", "P1_PRIVATE_RESEARCH_ALLOWED"]),
    studentVisible: z.literal(false),
  }).strict(),
  curation: CurationMetadataSchema,
  asset: z.object({
    mode: z.enum(["METADATA_ONLY", "PRIVATE_COPY"]),
    privateAssetRef: NullableText(300),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  }).strict(),
  rights: z.object({
    status: z.enum(["RIGHTS_UNKNOWN", "PARTIALLY_RECORDED", "VERIFIED"]),
    decisions: ActionDecisionsSchema,
  }).strict(),
  review: z.object({
    curation: z.literal("CANDIDATE"),
    sourceDisclosure: z.literal("PENDING"),
    teaching: z.literal("PENDING"),
    safety: z.literal("PENDING"),
    quality: z.literal("PENDING"),
  }).strict(),
  withdrawal: z.object({
    status: z.enum(["PENDING", "READY", "HOLD", "WITHDRAWN"]),
    complaintLocator: NullableUrl,
  }).strict(),
  channels: DisabledChannelsSchema,
  evidence: z.array(CandidateEvidenceSchema).min(1).max(12),
}).strict();

export type InspirationCasePrivateCandidate = z.infer<typeof InspirationCasePrivateCandidateSchema>;

export const InspirationCasePrivateAnalysisSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-private-analysis/v1"),
  candidateId: CandidateIdSchema,
  governance: z.object({
    scope: z.literal("PRIVATE_CANDIDATE"),
    stage: z.literal("ANALYSIS"),
    pipelineState: z.literal("VISUALLY_ANALYZED"),
    studentVisible: z.literal(false),
  }).strict(),
  processing: z.object({
    requestedChannel: z.enum(["NONE", "LOCAL", "REMOTE"]),
    actualChannel: z.enum(["NONE", "LOCAL", "REMOTE"]),
    providerLabel: NullableText(160),
    transmittedToThirdParty: z.boolean(),
    recordedAt: z.string().datetime(),
  }).strict(),
  deduplication: z.object({
    fingerprint: NullableText(240),
    nearDuplicateCandidateIds: z.array(CandidateIdSchema).max(50),
    status: z.enum(["NOT_RUN", "PROPOSED", "REVIEWED"]),
  }).strict(),
  courseAssociations: z.array(z.object({
    coursePackId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    facets: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    rationale: z.string().trim().min(1).max(600),
    confidence: z.number().min(0).max(1),
    status: z.literal("PROPOSED"),
  }).strict()).max(20),
  channels: DisabledChannelsSchema,
}).strict();

export type InspirationCasePrivateAnalysis = z.infer<typeof InspirationCasePrivateAnalysisSchema>;

/**
 * The generated teacher packet is the only human decision surface. Scores and
 * recommendations are legible signals, never automatic judgements of quality
 * or factual claims about a work, its author, or its rights.
 */
export const InspirationCaseTeacherReviewPackageSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-teacher-review/v1"),
  candidateId: CandidateIdSchema,
  pipelineState: z.literal("READY_FOR_TEACHER_REVIEW"),
  generatedAt: z.string().datetime(),
  preview: z.object({
    mode: z.enum(["PRIVATE_PREVIEW", "METADATA_ONLY"]),
    privateAssetRef: NullableText(300),
  }).strict(),
  source: z.object({
    curationSourceUrl: NullableUrl,
    originalSourceDisplay: NullableText(240),
    originalSourceUrl: NullableUrl,
    attributionStatus: z.enum(["RECORDED", "UNKNOWN"]),
  }).strict(),
  extractedTags: z.array(z.string().trim().min(1).max(80)).max(40),
  courseAssociations: InspirationCasePrivateAnalysisSchema.shape.courseAssociations,
  duplicateRisk: z.object({
    nearDuplicateCandidateIds: z.array(CandidateIdSchema).max(50),
    signal: z.enum(["NOT_RUN", "LOW", "MEDIUM", "HIGH"]),
    explanation: z.string().trim().min(1).max(600),
  }).strict(),
  designSignals: z.object({
    visualStyle: z.array(z.string().trim().min(1).max(80)).max(20),
    novelty: z.enum(["NOT_RUN", "LOW", "MEDIUM", "HIGH"]),
    teachingValue: z.enum(["NOT_RUN", "LOW", "MEDIUM", "HIGH"]),
    explanation: z.string().trim().min(1).max(800),
  }).strict(),
  aiRecommendation: z.object({
    recommendation: z.enum(["REVIEW_FAVORABLY", "REVIEW_CAREFULLY", "DO_NOT_AUTO_DECIDE"]),
    rationale: z.string().trim().min(1).max(1_000),
    limitations: z.string().trim().min(1).max(600),
  }).strict(),
  processingLog: InspirationCasePrivateAnalysisSchema.shape.processing,
  channels: DisabledChannelsSchema,
}).strict();

export type InspirationCaseTeacherReviewPackage = z.infer<typeof InspirationCaseTeacherReviewPackageSchema>;

export const InspirationCaseTeacherDecisionSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-teacher-decision/v1"),
  candidateId: CandidateIdSchema,
  decision: z.enum(["APPROVED", "REJECTED", "DEFERRED"]),
  reviewerId: z.string().trim().min(1).max(120),
  decidedAt: z.string().datetime(),
  revisedCourseTags: z.array(z.string().trim().min(1).max(80)).max(20),
  note: z.string().trim().min(1).max(1_000),
}).strict();

export type InspirationCaseTeacherDecision = z.infer<typeof InspirationCaseTeacherDecisionSchema>;

/** P1 keeps even admitted/indexed records internal until formal Wiki activation. */
export const InspirationCaseAutoAdmissionSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-auto-admission/v1"),
  candidateId: CandidateIdSchema,
  pipelineState: z.enum(["AUTO_ADMITTED/INDEXED", "ACTIVE"]),
  teacherDecisionId: z.string().trim().min(1).max(120),
    indexedAt: z.string().datetime(),
    admissionScope: z.literal("INTERNAL_CATALOG_ONLY"),
    studentVisible: z.literal(false),
  channels: DisabledChannelsSchema,
}).strict();

export type InspirationCaseAutoAdmission = z.infer<typeof InspirationCaseAutoAdmissionSchema>;

export const InspirationCasePublishabilityReviewSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-admission-checklist/v1"),
  candidateId: CandidateIdSchema,
  governance: z.object({
    scope: z.literal("PRIVATE_CANDIDATE"),
    stage: z.literal("READY_FOR_TEACHER_REVIEW"),
    releaseActivated: z.literal(false),
  }).strict(),
  review: z.object({
    sourceDisclosure: z.literal("APPROVED"),
    teaching: z.literal("APPROVED"),
    safety: z.literal("APPROVED"),
    qualityAndDuplicate: z.literal("APPROVED"),
    course: z.literal("APPROVED"),
  }).strict(),
  channels: DisabledChannelsSchema,
}).strict();

export type InspirationCasePublishabilityReview = z.infer<typeof InspirationCasePublishabilityReviewSchema>;

export class UnsafeInspirationCaseCandidateError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Inspiration candidate is unsafe for the requested stage: ${issues.join(", ")}`);
    this.name = "UnsafeInspirationCaseCandidateError";
    this.issues = issues;
  }
}

/** PRIVATE_CANDIDATE permits incomplete provenance, never a public channel. */
export function privateCandidateSafetyIssues(candidate: InspirationCasePrivateCandidate): string[] {
  const issues: string[] = [];
  if (candidate.asset.mode === "PRIVATE_COPY") {
    if (candidate.governance.privateAcquisition !== "P1_PRIVATE_RESEARCH_ALLOWED") {
      issues.push("PRIVATE_COPY_REQUIRES_PRIVATE_RESEARCH_POLICY");
    }
    if (!candidate.asset.privateAssetRef || !candidate.asset.contentHash) {
      issues.push("PRIVATE_COPY_REQUIRES_PRIVATE_REF_AND_HASH");
    }
  } else if (candidate.asset.privateAssetRef || candidate.asset.contentHash) {
    issues.push("METADATA_ONLY_CANNOT_DECLARE_PRIVATE_ASSET");
  }
  if (candidate.governance.studentVisible) {
    issues.push("PRIVATE_CANDIDATE_MUST_NOT_BE_STUDENT_VISIBLE");
  }
  return issues;
}

export function privateAnalysisSafetyIssues(
  candidate: InspirationCasePrivateCandidate,
  analysis: InspirationCasePrivateAnalysis,
): string[] {
  const issues = privateCandidateSafetyIssues(candidate);
  if (analysis.candidateId !== candidate.id) issues.push("ANALYSIS_CANDIDATE_ID_MISMATCH");
  if (analysis.processing.actualChannel === "REMOTE") {
    if (!analysis.processing.transmittedToThirdParty) issues.push("REMOTE_ANALYSIS_MUST_DISCLOSE_TRANSMISSION");
    if (!analysis.processing.providerLabel) issues.push("REMOTE_ANALYSIS_REQUIRES_PROVIDER_LABEL");
  }
  if (analysis.processing.actualChannel !== "REMOTE" && analysis.processing.transmittedToThirdParty) {
    issues.push("NON_REMOTE_ANALYSIS_CANNOT_CLAIM_THIRD_PARTY_TRANSMISSION");
  }
  if (analysis.governance.studentVisible) {
    issues.push("PRIVATE_ANALYSIS_MUST_NOT_BE_STUDENT_VISIBLE");
  }
  return issues;
}

/**
 * This checklist is an input to the teacher packet, never a pipeline state or
 * a release. UNKNOWN provenance may be honestly disclosed; an explicit DENY,
 * withdrawal, or incomplete review still fails closed.
 */
export function publishabilitySafetyIssues(
  candidate: InspirationCasePrivateCandidate,
  analysis: InspirationCasePrivateAnalysis,
  review: InspirationCasePublishabilityReview,
): string[] {
  const issues = privateAnalysisSafetyIssues(candidate, analysis);
  if (review.candidateId !== candidate.id) issues.push("PUBLISHABILITY_CANDIDATE_ID_MISMATCH");
  if (candidate.withdrawal.status !== "READY") issues.push("WITHDRAWAL_CHANNEL_NOT_READY");
  if (candidate.rights.decisions.STUDENT_DISPLAY === "DENY") issues.push("STUDENT_DISPLAY_EXPLICITLY_DENIED");
  return issues;
}

export function assertPrivateInspirationCaseCandidate(value: unknown): InspirationCasePrivateCandidate {
  const candidate = InspirationCasePrivateCandidateSchema.parse(value);
  const issues = privateCandidateSafetyIssues(candidate);
  if (issues.length > 0) throw new UnsafeInspirationCaseCandidateError(issues);
  return candidate;
}

export function assertPrivateInspirationCaseAnalysis(
  candidateValue: unknown,
  analysisValue: unknown,
): InspirationCasePrivateAnalysis {
  const candidate = assertPrivateInspirationCaseCandidate(candidateValue);
  const analysis = InspirationCasePrivateAnalysisSchema.parse(analysisValue);
  const issues = privateAnalysisSafetyIssues(candidate, analysis);
  if (issues.length > 0) throw new UnsafeInspirationCaseCandidateError(issues);
  return analysis;
}

export function teacherReviewPackageSafetyIssues(
  candidate: InspirationCasePrivateCandidate,
  analysis: InspirationCasePrivateAnalysis,
  reviewPackage: InspirationCaseTeacherReviewPackage,
): string[] {
  const issues = privateAnalysisSafetyIssues(candidate, analysis);
  if (reviewPackage.candidateId !== candidate.id) issues.push("TEACHER_REVIEW_CANDIDATE_ID_MISMATCH");
  if (reviewPackage.processingLog.actualChannel !== analysis.processing.actualChannel) {
    issues.push("TEACHER_REVIEW_PROCESSING_LOG_MISMATCH");
  }
  if (reviewPackage.preview.mode === "PRIVATE_PREVIEW" && !reviewPackage.preview.privateAssetRef) {
    issues.push("TEACHER_REVIEW_PRIVATE_PREVIEW_REQUIRES_REF");
  }
  return issues;
}

export function assertTeacherReviewPackage(
  candidateValue: unknown,
  analysisValue: unknown,
  reviewPackageValue: unknown,
): InspirationCaseTeacherReviewPackage {
  const candidate = assertPrivateInspirationCaseCandidate(candidateValue);
  const analysis = InspirationCasePrivateAnalysisSchema.parse(analysisValue);
  const reviewPackage = InspirationCaseTeacherReviewPackageSchema.parse(reviewPackageValue);
  const issues = teacherReviewPackageSafetyIssues(candidate, analysis, reviewPackage);
  if (issues.length > 0) throw new UnsafeInspirationCaseCandidateError(issues);
  return reviewPackage;
}

export function assertP1AutoAdmission(
  decisionValue: unknown,
  admissionValue: unknown,
): InspirationCaseAutoAdmission {
  const decision = InspirationCaseTeacherDecisionSchema.parse(decisionValue);
  const admission = InspirationCaseAutoAdmissionSchema.parse(admissionValue);
  if (decision.candidateId !== admission.candidateId) throw new UnsafeInspirationCaseCandidateError(["AUTO_ADMISSION_CANDIDATE_ID_MISMATCH"]);
  if (decision.decision !== "APPROVED") throw new UnsafeInspirationCaseCandidateError(["AUTO_ADMISSION_REQUIRES_TEACHER_APPROVAL"]);
  return admission;
}

export function assertInspirationCasePublishability(
  candidateValue: unknown,
  analysisValue: unknown,
  reviewValue: unknown,
): InspirationCasePublishabilityReview {
  const candidate = assertPrivateInspirationCaseCandidate(candidateValue);
  const analysis = InspirationCasePrivateAnalysisSchema.parse(analysisValue);
  const review = InspirationCasePublishabilityReviewSchema.parse(reviewValue);
  const issues = publishabilitySafetyIssues(candidate, analysis, review);
  if (issues.length > 0) throw new UnsafeInspirationCaseCandidateError(issues);
  return review;
}

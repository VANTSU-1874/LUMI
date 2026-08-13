import { z } from "zod";

export const WikiSha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const WikiOpaqueIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(180)
  .regex(/^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9._-]*)+$/);
export const WikiPageIdSchema = z.string().regex(/^wiki-page:[a-f0-9]{24}$/);

export const RevisionBindingSchema = z.object({
  revisionId: WikiOpaqueIdSchema,
  revisionHash: WikiSha256Schema,
}).strict().readonly();

export type RevisionBinding = z.infer<typeof RevisionBindingSchema>;

export const WikiPageTypeSchema = z.enum([
  "INSPIRATION_CASE",
  "VISUAL_STRATEGY",
  "MEDIUM_OR_TECHNIQUE",
  "TASK_OR_CONTEXT",
  "CURATED_COLLECTION",
  "VERIFIED_SOURCE_OR_CREATOR",
  "COURSE_CONCEPT_REF",
]);

export const WikiLinkTypeSchema = z.enum([
  "EXEMPLIFIES",
  "CONTRASTS_WITH",
  "USES_MEDIUM",
  "SUITABLE_FOR",
  "PART_OF_COLLECTION",
  "SUPPORTED_BY_EVIDENCE",
  "RELATES_TO_COURSE_CONCEPT",
]);

export const WikiAudienceSchema = z.enum([
  "INTERNAL_REVIEWER_ONLY",
  "AUTHENTICATED_STUDENT_ONLY",
  "INSTITUTIONAL_PUBLIC",
  "PUBLIC_INTERNET",
]);

export const WikiWithdrawalStateSchema = z.enum([
  "CLEAR",
  "RIGHTS_HOLD",
  "SAFETY_HOLD",
  "WITHDRAWAL_HOLD",
  "WITHDRAWN",
  "REVOKED",
  "REVIEW_HOLD",
]);

export const CourseConceptReferenceSchema = z.object({
  authority: z.literal("COURSE_KNOWLEDGE_V2"),
  conceptId: WikiOpaqueIdSchema,
  displayLabel: z.string().trim().min(1).max(160),
  referenceMode: z.literal("REFERENCE_ONLY"),
}).strict().readonly();

export const WikiClaimTypeSchema = z.enum([
  "SOURCE_FACT",
  "VISIBLE_OBSERVATION",
  "TEACHING_INFERENCE",
]);

export const NonCourseSourceAuthoritySchema = z.enum([
  "NON_COURSE_SYNTHETIC_FIXTURE",
  "NON_COURSE_LICENSED_SOURCE",
  "NON_COURSE_INSTITUTIONAL_SOURCE",
]);

export const CanonicalLinkDraftPayloadSchema = z.object({
  toCaseId: WikiOpaqueIdSchema,
  relationType: WikiLinkTypeSchema,
  evidenceObjectIds: z.array(WikiOpaqueIdSchema).min(1).max(20).readonly(),
  reason: z.string().trim().min(1).max(800),
}).strict().readonly();

export const CanonicalSourceVersionPayloadSchema = z.discriminatedUnion("sourceAuthority", [
  z.object({
    sourceAuthority: NonCourseSourceAuthoritySchema,
    locator: z.string().trim().min(1).max(500),
    capturedAt: z.string().datetime(),
    evidenceClaims: z.array(z.object({
      claimId: WikiOpaqueIdSchema,
      text: z.string().trim().min(1).max(2_000),
    }).strict().readonly()).min(1).max(80).readonly(),
  }).strict().readonly(),
  z.object({
    sourceAuthority: z.literal("COURSE_KNOWLEDGE_V2"),
    capturedAt: z.string().datetime(),
    concept: CourseConceptReferenceSchema,
  }).strict().readonly(),
]);

export const CanonicalCandidateRevisionPayloadSchema = z.object({
  pageType: WikiPageTypeSchema,
  title: z.string().trim().min(1).max(240),
  aliases: z.array(z.string().trim().min(1).max(120)).max(40).readonly(),
  facets: z.array(z.string().trim().min(1).max(120)).max(60).readonly(),
  scope: z.literal("PRIVATE_CANDIDATE"),
  studentVisible: z.literal(false),
  createdAt: z.string().datetime(),
  linkDrafts: z.array(CanonicalLinkDraftPayloadSchema).max(80).readonly(),
}).strict().readonly();

export const CanonicalAnalysisRevisionPayloadSchema = z.discriminatedUnion("knowledgeDomain", [
  z.object({
    knowledgeDomain: z.literal("NON_COURSE_INSPIRATION"),
    authorship: z.enum(["MODEL_DRAFT", "HUMAN_DRAFT"]),
    createdAt: z.string().datetime(),
    claims: z.array(z.object({
      claimId: WikiOpaqueIdSchema,
      claimType: WikiClaimTypeSchema,
      text: z.string().trim().min(1).max(2_000),
      supportObjectIds: z.array(WikiOpaqueIdSchema).min(2).max(20).readonly(),
    }).strict().readonly()).min(1).max(80).readonly(),
  }).strict().readonly(),
  z.object({
    knowledgeDomain: z.literal("COURSE_KNOWLEDGE_V2_REFERENCE_ONLY"),
    createdAt: z.string().datetime(),
    conceptRefs: z.array(CourseConceptReferenceSchema).min(1).max(20).readonly(),
  }).strict().readonly(),
]);

const RightsAllowPayloadSchema = z.object({
  decision: z.literal("ALLOW"),
  decidedAt: z.string().datetime(),
  validUntil: z.string().datetime().nullable(),
  studentDisplay: z.literal("ALLOW"),
  sourceDisclosure: z.literal("ALLOW"),
  preview: z.literal("ALLOW"),
  aiCitation: z.literal("ALLOW"),
}).strict().readonly();

const RightsDenyPayloadSchema = z.object({
  decision: z.literal("DENY"),
  decidedAt: z.string().datetime(),
  reason: z.string().trim().min(1).max(500),
}).strict().readonly();

const RightsHoldPayloadSchema = z.object({
  decision: z.literal("HOLD"),
  decidedAt: z.string().datetime(),
  holdKind: z.enum(["RIGHTS_HOLD", "SAFETY_HOLD", "REVIEW_HOLD"]),
  reason: z.string().trim().min(1).max(500),
}).strict().readonly();

export const CanonicalRightsDecisionSetPayloadSchema = z.discriminatedUnion("decision", [
  RightsAllowPayloadSchema,
  RightsDenyPayloadSchema,
  RightsHoldPayloadSchema,
]);

export const CanonicalReviewPackagePayloadSchema = z.object({
  state: z.literal("READY_FOR_DOMAIN_REVIEW"),
  opaqueAssetRef: WikiOpaqueIdSchema,
  preparedAt: z.string().datetime(),
}).strict().readonly();

const WithdrawalClearPayloadSchema = z.object({
  state: z.literal("CLEAR"),
  recordedAt: z.string().datetime(),
}).strict().readonly();

function restrictedWithdrawalPayload<State extends string>(state: State) {
  return z.object({
    state: z.literal(state),
    recordedAt: z.string().datetime(),
    effectiveAt: z.string().datetime(),
    reason: z.string().trim().min(1).max(500),
  }).strict().readonly();
}

export const CanonicalWithdrawalSnapshotPayloadSchema = z.discriminatedUnion("state", [
  WithdrawalClearPayloadSchema,
  restrictedWithdrawalPayload("RIGHTS_HOLD"),
  restrictedWithdrawalPayload("SAFETY_HOLD"),
  restrictedWithdrawalPayload("WITHDRAWAL_HOLD"),
  restrictedWithdrawalPayload("WITHDRAWN"),
  restrictedWithdrawalPayload("REVOKED"),
  restrictedWithdrawalPayload("REVIEW_HOLD"),
]);

export const CanonicalInputKindSchema = z.enum([
  "SOURCE_VERSION",
  "CANDIDATE_REVISION",
  "ANALYSIS_REVISION",
  "RIGHTS_DECISION_SET",
  "REVIEW_PACKAGE_REVISION",
  "WITHDRAWAL_SNAPSHOT",
]);

function canonicalSeedObject<Kind extends z.ZodLiteral<string>, Payload extends z.ZodTypeAny>(
  kind: Kind,
  payload: Payload,
) {
  return z.object({
    kind,
    objectId: WikiOpaqueIdSchema,
    revisionId: WikiOpaqueIdSchema,
    payload,
  }).strict();
}

function canonicalBoundObject<Kind extends z.ZodLiteral<string>, Payload extends z.ZodTypeAny>(
  kind: Kind,
  payload: Payload,
) {
  return z.object({
    kind,
    objectId: WikiOpaqueIdSchema,
    revision: RevisionBindingSchema,
    payload,
  }).strict().readonly();
}

export const CanonicalInputObjectSeedSchema = z.discriminatedUnion("kind", [
  canonicalSeedObject(z.literal("SOURCE_VERSION"), CanonicalSourceVersionPayloadSchema),
  canonicalSeedObject(z.literal("CANDIDATE_REVISION"), CanonicalCandidateRevisionPayloadSchema),
  canonicalSeedObject(z.literal("ANALYSIS_REVISION"), CanonicalAnalysisRevisionPayloadSchema),
  canonicalSeedObject(z.literal("RIGHTS_DECISION_SET"), CanonicalRightsDecisionSetPayloadSchema),
  canonicalSeedObject(z.literal("REVIEW_PACKAGE_REVISION"), CanonicalReviewPackagePayloadSchema),
  canonicalSeedObject(z.literal("WITHDRAWAL_SNAPSHOT"), CanonicalWithdrawalSnapshotPayloadSchema),
]);

export const CanonicalInputObjectSchema = z.discriminatedUnion("kind", [
  canonicalBoundObject(z.literal("SOURCE_VERSION"), CanonicalSourceVersionPayloadSchema),
  canonicalBoundObject(z.literal("CANDIDATE_REVISION"), CanonicalCandidateRevisionPayloadSchema),
  canonicalBoundObject(z.literal("ANALYSIS_REVISION"), CanonicalAnalysisRevisionPayloadSchema),
  canonicalBoundObject(z.literal("RIGHTS_DECISION_SET"), CanonicalRightsDecisionSetPayloadSchema),
  canonicalBoundObject(z.literal("REVIEW_PACKAGE_REVISION"), CanonicalReviewPackagePayloadSchema),
  canonicalBoundObject(z.literal("WITHDRAWAL_SNAPSHOT"), CanonicalWithdrawalSnapshotPayloadSchema),
]);

export const CanonicalLedgerCursorSchema = z.object({
  highWatermark: WikiOpaqueIdSchema,
  ledgerHash: WikiSha256Schema,
}).strict().readonly();

export const CanonicalInputBundleSeedSchema = z.object({
  caseId: WikiOpaqueIdSchema,
  candidateId: WikiOpaqueIdSchema,
  inputs: z.array(CanonicalInputObjectSeedSchema).length(6),
  ledger: CanonicalLedgerCursorSchema,
  courseConceptRefs: z.array(CourseConceptReferenceSchema).max(20),
}).strict();

const REQUIRED_CANONICAL_INPUTS = CanonicalInputKindSchema.options;

export const CanonicalInputBundleSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-canonical-input-bundle/v1"),
  bundle: RevisionBindingSchema,
  caseId: WikiOpaqueIdSchema,
  candidateId: WikiOpaqueIdSchema,
  inputs: z.array(CanonicalInputObjectSchema).length(6).readonly(),
  ledger: CanonicalLedgerCursorSchema,
  courseConceptRefs: z.array(CourseConceptReferenceSchema).max(20).readonly(),
}).strict().superRefine((value, context) => {
  const kinds = value.inputs.map((input) => input.kind);
  for (const kind of REQUIRED_CANONICAL_INPUTS) {
    if (!kinds.includes(kind)) context.addIssue({ code: "custom", message: `Missing canonical input: ${kind}` });
  }
  if (new Set(kinds).size !== kinds.length) {
    context.addIssue({ code: "custom", message: "Canonical input kinds must be unique" });
  }
  const identities = value.inputs.map((input) => `${input.kind}\0${input.objectId}\0${input.revision.revisionId}`);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", message: "Canonical input identities must be unique" });
  }
}).readonly();

export type CanonicalInputBundleSeed = z.infer<typeof CanonicalInputBundleSeedSchema>;
export type CanonicalInputBundle = z.infer<typeof CanonicalInputBundleSchema>;
export type CanonicalInputObject = z.infer<typeof CanonicalInputObjectSchema>;

const NonCourseSourceProvenanceSchema = z.object({
  inputKind: z.literal("SOURCE_VERSION"),
  objectId: WikiOpaqueIdSchema,
  inputRevision: RevisionBindingSchema,
  sourceAuthority: NonCourseSourceAuthoritySchema,
}).strict().readonly();

const NonCourseAnalysisProvenanceSchema = z.object({
  inputKind: z.literal("ANALYSIS_REVISION"),
  objectId: WikiOpaqueIdSchema,
  inputRevision: RevisionBindingSchema,
  knowledgeDomain: z.literal("NON_COURSE_INSPIRATION"),
}).strict().readonly();

export const WikiClaimProvenanceSourceSchema = z.discriminatedUnion("inputKind", [
  NonCourseSourceProvenanceSchema,
  NonCourseAnalysisProvenanceSchema,
]);

const NonCourseWikiClaimProvenanceSchema = z.object({
  domain: z.literal("NON_COURSE_INSPIRATION"),
  sources: z.array(WikiClaimProvenanceSourceSchema).min(2).max(20).readonly(),
  courseKnowledgeUse: z.literal("NONE"),
  courseKnowledgeBodyIncluded: z.literal(false),
}).strict().readonly();

const CourseReferenceClaimProvenanceSchema = z.object({
  domain: z.literal("COURSE_CONCEPT_REFERENCE"),
  concepts: z.array(CourseConceptReferenceSchema).min(1).max(20).readonly(),
  courseKnowledgeUse: z.literal("REFERENCE_ONLY"),
  courseKnowledgeBodyIncluded: z.literal(false),
}).strict().readonly();

export const WikiClaimProvenanceSchema = z.discriminatedUnion("domain", [
  NonCourseWikiClaimProvenanceSchema,
  CourseReferenceClaimProvenanceSchema,
]);

export const WikiClaimDraftSchema = z.object({
  claimId: WikiOpaqueIdSchema,
  claimType: WikiClaimTypeSchema,
  text: z.string().trim().min(1).max(2_000),
  supportObjectIds: z.array(WikiOpaqueIdSchema).min(2).max(20).readonly(),
  provenance: WikiClaimProvenanceSchema,
  authorship: z.enum(["MODEL_DRAFT", "HUMAN_DRAFT"]),
}).strict().readonly();

export const WikiPageDraftSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-wiki-page-draft/v1"),
  pageId: WikiPageIdSchema,
  pageType: WikiPageTypeSchema,
  caseId: WikiOpaqueIdSchema,
  canonicalInputBundle: RevisionBindingSchema,
  revision: RevisionBindingSchema,
  revisionNumber: z.number().int().positive(),
  supersedesRevision: RevisionBindingSchema.nullable(),
  state: z.literal("DRAFT_COMPILED_PREVIEW"),
  audience: z.literal("INTERNAL_REVIEWER_ONLY"),
  title: z.string().trim().min(1).max(240),
  createdAt: z.string().datetime(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(40).readonly(),
  facets: z.array(z.string().trim().min(1).max(120)).max(60).readonly(),
  claimDrafts: z.array(WikiClaimDraftSchema).max(80).readonly(),
  courseConceptRefs: z.array(CourseConceptReferenceSchema).max(20).readonly(),
}).strict().superRefine((value, context) => {
  const courseConceptIds = new Set(value.courseConceptRefs.map((reference) => reference.conceptId));
  if (value.pageType === "INSPIRATION_CASE") {
    for (const claim of value.claimDrafts) {
      if (claim.provenance.domain !== "NON_COURSE_INSPIRATION") {
        context.addIssue({ code: "custom", message: "Inspiration claims require exact non-course provenance" });
      }
      if (claim.supportObjectIds.some((objectId) => courseConceptIds.has(objectId))) {
        context.addIssue({ code: "custom", message: "Inspiration claims cannot use Course Knowledge concepts as support" });
      }
    }
  }
  if (value.pageType === "COURSE_CONCEPT_REF") {
    const reference = value.courseConceptRefs[0];
    if (value.courseConceptRefs.length !== 1) {
      context.addIssue({ code: "custom", message: "COURSE_CONCEPT_REF must contain exactly one reference-only concept" });
    }
    if (!reference || value.title !== reference.displayLabel) {
      context.addIssue({ code: "custom", message: "COURSE_CONCEPT_REF title must be the approved display label" });
    }
    if (value.aliases.length > 0 || value.facets.length > 0 || value.claimDrafts.length > 0) {
      context.addIssue({ code: "custom", message: "COURSE_CONCEPT_REF cannot carry aliases, facets, or claim text" });
    }
  }
}).readonly();

export const WikiPageRevisionSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-wiki-page-revision/v1"),
  pageId: WikiPageIdSchema,
  revision: RevisionBindingSchema,
  pageDraftRevision: RevisionBindingSchema,
  revisionNumber: z.number().int().positive(),
  canonicalInputBundle: RevisionBindingSchema,
  compiledPreviewHash: WikiSha256Schema,
  reviewState: z.enum(["PENDING_REVIEW", "APPROVED_FOR_RELEASE", "REJECTED"]),
  schemaPackVersion: z.literal("lumi-inspiration-wiki-schema-pack/v1"),
  compilerIdentity: WikiOpaqueIdSchema,
  createdAt: z.string().datetime(),
  supersedesRevision: RevisionBindingSchema.nullable(),
}).strict().readonly();

export const TimelineEntrySchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-wiki-timeline-entry/v1"),
  eventId: WikiOpaqueIdSchema,
  entryRevision: RevisionBindingSchema,
  pageId: WikiPageIdSchema,
  pageRevision: RevisionBindingSchema,
  eventType: z.enum([
    "IMPORTED_BASELINE",
    "DRAFT_COMPILED",
    "REVIEW_RECORDED",
    "RIGHTS_CHANGED",
    "LINK_DECISION_RECORDED",
    "WITHDRAWAL_HOLD",
    "WITHDRAWN",
    "CORRECTED",
    "SUPERSEDED",
  ]),
  projectionState: z.enum(["DRAFT", "RELEASED"]),
  occurredAt: z.string().datetime(),
  recordedAt: z.string().datetime(),
  canonicalInputBundle: RevisionBindingSchema,
  ledger: CanonicalLedgerCursorSchema,
  evidenceRefs: z.array(WikiOpaqueIdSchema).max(20).readonly(),
  correctsEventId: WikiOpaqueIdSchema.nullable(),
  supersedesEventId: WikiOpaqueIdSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.recordedAt) < Date.parse(value.occurredAt)) {
    context.addIssue({ code: "custom", message: "Timeline recordedAt must be at or after occurredAt" });
  }
}).readonly();

export const WikiLinkDecisionDraftSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-wiki-link-decision-draft/v1"),
  linkId: WikiOpaqueIdSchema,
  revision: RevisionBindingSchema,
  fromPageId: WikiPageIdSchema,
  toPageId: WikiPageIdSchema,
  relationType: WikiLinkTypeSchema,
  evidenceRefs: z.array(WikiOpaqueIdSchema).min(1).max(20).readonly(),
  reason: z.string().trim().min(1).max(800),
  reviewState: z.literal("PROPOSED"),
  audience: z.literal("INTERNAL_REVIEWER_ONLY"),
}).strict().refine((value) => value.fromPageId !== value.toPageId, "Wiki links cannot be self-referential").readonly();

export const ReviewedWikiLinkSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-reviewed-wiki-link/v1"),
  linkId: WikiOpaqueIdSchema,
  revision: RevisionBindingSchema,
  fromPageId: WikiPageIdSchema,
  fromPageRevision: RevisionBindingSchema,
  toPageId: WikiPageIdSchema,
  toPageRevision: RevisionBindingSchema,
  sourcePageId: WikiPageIdSchema,
  sourcePageRevision: RevisionBindingSchema,
  sourceCanonicalInputBundle: RevisionBindingSchema,
  sourceDraftMaterialReceipt: RevisionBindingSchema,
  linkDraftRevision: RevisionBindingSchema,
  relationType: WikiLinkTypeSchema,
  evidenceRefs: z.array(WikiOpaqueIdSchema).min(1).max(20).readonly(),
  decision: RevisionBindingSchema,
  approvalReviewDecisionIds: z.array(WikiOpaqueIdSchema).min(1).max(4).readonly(),
  approvalReceipt: RevisionBindingSchema,
  reviewState: z.literal("APPROVED"),
  audience: WikiAudienceSchema,
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime().nullable(),
}).strict().superRefine((value, context) => {
  if (value.fromPageId === value.toPageId) {
    context.addIssue({ code: "custom", message: "Wiki links cannot be self-referential" });
  }
  if (value.sourcePageId !== value.fromPageId && value.sourcePageId !== value.toPageId) {
    context.addIssue({ code: "custom", message: "Reviewed link source must be an exact endpoint" });
  }
  const sourceRevision = value.sourcePageId === value.fromPageId
    ? value.fromPageRevision
    : value.toPageRevision;
  if (JSON.stringify(sourceRevision) !== JSON.stringify(value.sourcePageRevision)) {
    context.addIssue({ code: "custom", message: "Reviewed link source revision must match its endpoint" });
  }
  if (new Set(value.approvalReviewDecisionIds).size !== value.approvalReviewDecisionIds.length) {
    context.addIssue({ code: "custom", message: "Reviewed link approval decisions must be unique" });
  }
  if (value.validUntil && Date.parse(value.validUntil) < Date.parse(value.validFrom)) {
    context.addIssue({ code: "custom", message: "Wiki link validity cannot end before it starts" });
  }
}).readonly();

export type WikiPageDraft = z.infer<typeof WikiPageDraftSchema>;
export type WikiPageRevision = z.infer<typeof WikiPageRevisionSchema>;
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type ReviewedWikiLink = z.infer<typeof ReviewedWikiLinkSchema>;

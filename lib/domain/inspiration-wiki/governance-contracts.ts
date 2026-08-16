import { z } from "zod";

import {
  CompiledTruthSchema,
  WikiDraftMaterialSourceSchema,
  WikiMaterialSourceSchema,
} from "./compilation-contracts";
import {
  CanonicalLedgerCursorSchema,
  RevisionBindingSchema,
  WikiAudienceSchema,
  WikiOpaqueIdSchema,
  WikiPageIdSchema,
  WikiSha256Schema,
  WikiWithdrawalStateSchema,
} from "./core-contracts";

export const ReviewDomainSchema = z.enum(["CURATION", "TEACHING", "RIGHTS", "SAFETY"]);
export const WikiReviewerRoleSchema = z.enum([
  "CANDIDATE_PROPOSER",
  "WIKI_EDITOR",
  "CURATION_REVIEWER",
  "TEACHING_REVIEWER",
  "RIGHTS_REVIEWER",
  "SAFETY_REVIEWER",
  "RELEASE_APPROVER",
  "WITHDRAWAL_OPERATOR",
]);

export const ReviewerRoleAssignmentSchema = z.object({
  assignmentId: WikiOpaqueIdSchema,
  actorId: WikiOpaqueIdSchema,
  role: WikiReviewerRoleSchema,
  status: z.enum(["ACTIVE", "REVOKED", "EXPIRED"]),
  policyVersion: WikiOpaqueIdSchema,
  policyRevision: RevisionBindingSchema,
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime().nullable(),
}).strict().readonly();

export const ReviewTargetRiskSchema = z.enum([
  "STANDARD",
  "RIGHTS_EXCEPTION",
  "SAFETY_HIGH",
  "APPEAL_RESTORE",
  "DUAL_REVIEW_REQUIRED",
]);

export const RoleDomainRequirementSchema = z.object({
  domain: ReviewDomainSchema,
  requiredReviewerCount: z.number().int().min(1).max(2),
}).strict().readonly();

export const RoleDomainPolicySchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-role-domain-policy/v1"),
  version: WikiOpaqueIdSchema,
  policyRevision: RevisionBindingSchema,
  allowSelfReview: z.boolean(),
  riskRules: z.array(z.object({
    targetRisk: ReviewTargetRiskSchema,
    dualReviewRequired: z.boolean(),
    requirements: z.array(RoleDomainRequirementSchema).length(4).readonly(),
  }).strict().readonly()).min(1).max(5).readonly(),
}).strict().superRefine((value, context) => {
  const targetRisks = value.riskRules.map((rule) => rule.targetRisk);
  if (new Set(targetRisks).size !== targetRisks.length) {
    context.addIssue({ code: "custom", message: "Role policy target-risk rules must be unique" });
  }
  for (const rule of value.riskRules) {
    const domains = rule.requirements.map((requirement) => requirement.domain);
    if (new Set(domains).size !== ReviewDomainSchema.options.length) {
      context.addIssue({ code: "custom", message: `Role policy must define each domain for ${rule.targetRisk}` });
    }
    if (rule.dualReviewRequired && !rule.requirements.some((requirement) => requirement.requiredReviewerCount === 2)) {
      context.addIssue({ code: "custom", message: `Dual-review risk ${rule.targetRisk} must require two reviewers` });
    }
  }
}).readonly();

export const ReviewTargetRiskScopeSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-review-target-risk-scope/v1"),
  scopeId: WikiOpaqueIdSchema,
  scopeRevision: RevisionBindingSchema,
  targetRisk: ReviewTargetRiskSchema,
  dualReviewRequired: z.boolean(),
  appliesToPageId: WikiPageIdSchema,
  appliesToPageRevision: RevisionBindingSchema,
}).strict().readonly();

export const DomainReviewTargetSchema = z.object({
  pageId: WikiPageIdSchema,
  candidateRevision: RevisionBindingSchema,
  canonicalInputBundle: RevisionBindingSchema,
  pageDraftRevision: RevisionBindingSchema,
  pageRevision: RevisionBindingSchema,
  compilationReceipt: RevisionBindingSchema,
  draftMaterialReceipt: RevisionBindingSchema,
  compiledPreviewHash: WikiSha256Schema,
  timelineSetHash: WikiSha256Schema,
  wikiLinkDecisionSetHash: WikiSha256Schema,
  ledger: CanonicalLedgerCursorSchema,
  rightsDecisionSetRevision: RevisionBindingSchema,
  withdrawalSnapshotRevision: RevisionBindingSchema,
  riskScope: ReviewTargetRiskScopeSchema,
}).strict().readonly();

export const RoleDomainReviewSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-role-domain-review/v1"),
  decisionId: WikiOpaqueIdSchema,
  decisionRevision: RevisionBindingSchema,
  reviewDomain: ReviewDomainSchema,
  decision: z.enum(["APPROVE", "REJECT", "HOLD"]),
  actorId: WikiOpaqueIdSchema,
  actorRoleAssignmentId: WikiOpaqueIdSchema,
  rolePolicyVersion: WikiOpaqueIdSchema,
  rolePolicyRevision: RevisionBindingSchema,
  reviewerStatusAtDecision: z.literal("ACTIVE"),
  status: z.enum(["ACTIVE", "REVOKED", "EXPIRED"]),
  validUntil: z.string().datetime().nullable(),
  target: DomainReviewTargetSchema,
  requiredReviewerCount: z.number().int().min(1).max(2),
  coReviewerDecisionIds: z.array(WikiOpaqueIdSchema).max(2).readonly(),
  decidedAt: z.string().datetime(),
  supersedesDecisionId: WikiOpaqueIdSchema.nullable(),
}).strict().readonly();

export const RoleDomainReviewEvaluationInputSchema = z.object({
  evaluatedAt: z.string().datetime(),
  policy: RoleDomainPolicySchema,
  assignments: z.array(ReviewerRoleAssignmentSchema).min(1).max(40).readonly(),
  reviews: z.array(RoleDomainReviewSchema).min(4).max(20).readonly(),
  draftMaterial: WikiDraftMaterialSourceSchema,
  currentTarget: DomainReviewTargetSchema,
  proposerOrEditorActorIds: z.array(WikiOpaqueIdSchema).min(1).max(20).readonly(),
}).strict().readonly();

export const CompiledTruthReviewBindingInputSchema = z.object({
  compiledTruth: CompiledTruthSchema,
  reviewGate: RoleDomainReviewEvaluationInputSchema,
  notAfter: z.string().datetime().nullable(),
}).strict().readonly();

export const WikiChannelStateSchema = z.enum(["DISABLED", "SHADOW", "ACTIVE"]);
export const WikiChannelNameSchema = z.enum(["BROWSE_RELEASE", "STUDENT_SEARCH", "WIKI_RETRIEVAL"]);
export const WikiChannelStatesSchema = z.object({
  BROWSE_RELEASE: WikiChannelStateSchema,
  STUDENT_SEARCH: WikiChannelStateSchema,
  WIKI_RETRIEVAL: WikiChannelStateSchema,
}).strict().readonly();

export const WikiReleaseStateSchema = z.enum([
  "DRAFT",
  "REVIEW_PENDING",
  "RELEASED",
  "REVIEW_HOLD",
  "WITHDRAWN",
  "REVOKED",
]);

export const BaseReleaseQualificationSchema = z.object({
  audience: z.literal("AUTHENTICATED_STUDENT_ONLY"),
  studentVisible: z.literal(true),
  studentDisplayDecision: z.literal("ALLOW"),
  sourceDisclosureDecision: z.literal("ALLOW"),
  teachingDecision: z.literal("ALLOW"),
  rightsDecision: z.literal("ALLOW"),
  safetyDecision: z.literal("ALLOW"),
  qualityDecision: z.literal("ALLOW"),
  withdrawalReadiness: z.literal("READY"),
}).strict().readonly();

export const WikiAudiencePolicySchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-wiki-audience-policy/v1"),
  policyId: WikiOpaqueIdSchema,
  policyRevision: RevisionBindingSchema,
  audience: z.literal("AUTHENTICATED_STUDENT_ONLY"),
  studentVisible: z.literal(true),
  studentDisplayDecision: z.literal("ALLOW"),
  sourceDisclosureDecision: z.literal("ALLOW"),
  previewDecision: z.literal("ALLOW"),
  aiCitationDecision: z.literal("ALLOW"),
}).strict().readonly();

export const CurrentWikiReleaseBindingsSchema = z.object({
  pageId: WikiPageIdSchema,
  candidateRevision: RevisionBindingSchema,
  pageDraftRevision: RevisionBindingSchema,
  pageRevision: RevisionBindingSchema,
  canonicalInputBundle: RevisionBindingSchema,
  compilationReceipt: RevisionBindingSchema,
  sourceMaterialReceipt: RevisionBindingSchema,
  reviewTargetHash: WikiSha256Schema,
  rolePolicyRevision: RevisionBindingSchema,
  domainReviewDecisionSetHash: WikiSha256Schema,
  release: RevisionBindingSchema,
  compiledTruthHash: WikiSha256Schema,
  timelineSetHash: WikiSha256Schema,
  wikiLinkDecisionSetHash: WikiSha256Schema,
  ledger: CanonicalLedgerCursorSchema,
  rightsDecisionSetRevision: RevisionBindingSchema,
  rightsDecisionSetHash: WikiSha256Schema,
  withdrawalSnapshotRevision: RevisionBindingSchema,
  withdrawalSnapshotHash: WikiSha256Schema,
  audiencePolicyRevision: RevisionBindingSchema,
  audiencePolicyHash: WikiSha256Schema,
  channelStates: WikiChannelStatesSchema,
  releaseState: WikiReleaseStateSchema,
  isCurrent: z.boolean(),
}).strict().readonly();

export const ReleaseDecisionSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-release-decision/v1"),
  decisionId: WikiOpaqueIdSchema,
  decisionRevision: RevisionBindingSchema,
  decision: z.enum(["ALLOW", "DENY", "REVIEW_HOLD"]),
  actorId: WikiOpaqueIdSchema,
  actorRoleAssignmentId: WikiOpaqueIdSchema,
  rolePolicyVersion: WikiOpaqueIdSchema,
  rolePolicyRevision: RevisionBindingSchema,
  reviewerStatusAtDecision: z.literal("ACTIVE"),
  pageId: WikiPageIdSchema,
  candidateRevision: RevisionBindingSchema,
  pageDraftRevision: RevisionBindingSchema,
  pageRevision: RevisionBindingSchema,
  canonicalInputBundle: RevisionBindingSchema,
  compilationReceipt: RevisionBindingSchema,
  sourceMaterialReceipt: RevisionBindingSchema,
  reviewTargetHash: WikiSha256Schema,
  domainReviewDecisionSetHash: WikiSha256Schema,
  release: RevisionBindingSchema,
  compiledTruthHash: WikiSha256Schema,
  timelineSetHash: WikiSha256Schema,
  wikiLinkDecisionSetHash: WikiSha256Schema,
  ledger: CanonicalLedgerCursorSchema,
  rightsDecisionSetRevision: RevisionBindingSchema,
  rightsDecisionSetHash: WikiSha256Schema,
  withdrawalSnapshotRevision: RevisionBindingSchema,
  withdrawalSnapshotHash: WikiSha256Schema,
  audiencePolicyRevision: RevisionBindingSchema,
  audiencePolicyHash: WikiSha256Schema,
  channelStates: WikiChannelStatesSchema,
  qualification: BaseReleaseQualificationSchema,
  domainReviewDecisionIds: z.array(WikiOpaqueIdSchema).min(4).max(20).readonly(),
  decidedAt: z.string().datetime(),
  supersedesDecisionId: WikiOpaqueIdSchema.nullable(),
}).strict().readonly();

export const ChannelActivationReceiptSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-channel-activation-receipt/v1"),
  receipt: RevisionBindingSchema,
  channel: WikiChannelNameSchema,
  state: WikiChannelStateSchema,
  release: RevisionBindingSchema,
  pageRevision: RevisionBindingSchema,
  releaseDecision: RevisionBindingSchema,
  recordedAt: z.string().datetime(),
}).strict().readonly();

export const ReleaseActivationReceiptSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-release-activation-receipt/v1"),
  receipt: RevisionBindingSchema,
  release: RevisionBindingSchema,
  pageRevision: RevisionBindingSchema,
  releaseDecision: RevisionBindingSchema,
  channelReceipts: z.array(ChannelActivationReceiptSchema).length(3).readonly(),
  activatedAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  const channels = value.channelReceipts.map((receipt) => receipt.channel);
  if (new Set(channels).size !== WikiChannelNameSchema.options.length) {
    context.addIssue({ code: "custom", message: "Activation receipt must bind each channel exactly once" });
  }
}).readonly();

export const ReleaseDecisionEvaluationInputSchema = z.object({
  reviewGate: RoleDomainReviewEvaluationInputSchema,
  sourceMaterial: WikiMaterialSourceSchema,
  audiencePolicy: WikiAudiencePolicySchema,
  decision: ReleaseDecisionSchema,
  releaseDecisionHistory: z.array(ReleaseDecisionSchema).min(1).max(20).readonly(),
  current: CurrentWikiReleaseBindingsSchema,
  activationReceipt: ReleaseActivationReceiptSchema,
  releaseAuthorActorIds: z.array(WikiOpaqueIdSchema).min(1).max(20).readonly(),
}).strict().readonly();

export const StudentAccessKindSchema = z.enum(["BROWSE", "SEARCH", "PREVIEW", "WIKI_CONTEXT"]);

export const StudentWikiViewerSchema = z.object({
  actorId: WikiOpaqueIdSchema,
  actorType: z.literal("STUDENT"),
  authenticated: z.boolean(),
  authorizedForCurrentStudent: z.boolean(),
  audience: z.literal("AUTHENTICATED_STUDENT_ONLY"),
}).strict().readonly();

export const StudentCurrentWikiPageSchema = z.object({
  projectionSource: z.literal("CURRENT_PAGE_RELEASE_COMPILED_TRUTH"),
  publicId: z.string().regex(/^inspiration:[a-f0-9]{24}$/),
  pageId: WikiPageIdSchema,
  pageRevision: RevisionBindingSchema,
  release: RevisionBindingSchema,
  compiledTruthHash: WikiSha256Schema,
  reviewState: z.enum(["APPROVED_STUDENT", "INTERNAL_ONLY", "REJECTED"]),
  audience: WikiAudienceSchema,
  withdrawalState: WikiWithdrawalStateSchema,
  studentDisplayDecision: z.enum(["ALLOW", "DENY", "UNKNOWN"]),
  sourceDisclosureDecision: z.enum(["ALLOW", "DENY", "UNKNOWN"]),
  previewDecision: z.enum(["ALLOW", "DENY", "UNKNOWN"]),
  aiCitationDecision: z.enum(["ALLOW", "DENY", "UNKNOWN"]),
  evidenceAnchorResolvable: z.boolean(),
}).strict().readonly();

export const StudentCurrentReleaseEligibilityInputSchema = z.object({
  accessKind: StudentAccessKindSchema,
  viewer: StudentWikiViewerSchema,
  page: StudentCurrentWikiPageSchema,
  releaseGate: ReleaseDecisionEvaluationInputSchema,
}).strict().readonly();

export const FailClosedEvaluationSchema = z.object({
  eligible: z.boolean(),
  reasons: z.array(z.string().trim().min(1).max(160)).readonly(),
  acceptedDecisionIds: z.array(WikiOpaqueIdSchema).readonly(),
}).strict().readonly();

export const CompiledTruthReviewBindingEvaluationSchema = z.object({
  eligible: z.boolean(),
  reasons: z.array(z.string().trim().min(1).max(160)).readonly(),
  acceptedDecisionIds: z.array(WikiOpaqueIdSchema).readonly(),
  acceptedDecisionSetHash: WikiSha256Schema.nullable(),
  latestAcceptedReviewDecidedAt: z.string().datetime().nullable(),
}).strict().readonly();

export type ReviewDomain = z.infer<typeof ReviewDomainSchema>;
export type ReviewerRoleAssignment = z.infer<typeof ReviewerRoleAssignmentSchema>;
export type RoleDomainPolicy = z.infer<typeof RoleDomainPolicySchema>;
export type ReviewTargetRiskScope = z.infer<typeof ReviewTargetRiskScopeSchema>;
export type RoleDomainReview = z.infer<typeof RoleDomainReviewSchema>;
export type RoleDomainReviewEvaluationInput = z.infer<typeof RoleDomainReviewEvaluationInputSchema>;
export type CompiledTruthReviewBindingInput = z.infer<typeof CompiledTruthReviewBindingInputSchema>;
export type CompiledTruthReviewBindingEvaluation = z.infer<typeof CompiledTruthReviewBindingEvaluationSchema>;
export type WikiAudiencePolicy = z.infer<typeof WikiAudiencePolicySchema>;
export type ReleaseDecision = z.infer<typeof ReleaseDecisionSchema>;
export type ReleaseActivationReceipt = z.infer<typeof ReleaseActivationReceiptSchema>;
export type ReleaseDecisionEvaluationInput = z.infer<typeof ReleaseDecisionEvaluationInputSchema>;
export type StudentCurrentReleaseEligibilityInput = z.infer<typeof StudentCurrentReleaseEligibilityInputSchema>;
export type FailClosedEvaluation = z.infer<typeof FailClosedEvaluationSchema>;

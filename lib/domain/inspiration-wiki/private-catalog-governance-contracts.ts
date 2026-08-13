import { z } from "zod";

import { RevisionBindingSchema } from "./core-contracts";
import { PrivateCompiledTruthIdSchema, PrivateWikiPageIdSchema, PrivateWikiPageRevisionIdSchema } from "./private-compilation-contracts";
import { PrivateDomainReviewCaseIdSchema } from "./private-domain-review-contracts";
import { RoleDomainPolicySchema, ReviewerRoleAssignmentSchema } from "./governance-contracts";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const WikiSha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const CandidateIdSchema = z.string().regex(/^hermes-candidate:[0-9a-f]{32}$/);

export const PrivateCatalogReviewDomainSchema = z.enum(["CURATION", "TEACHING", "RIGHTS", "SAFETY"]);
export const PrivateCatalogGovernanceCaseIdSchema = z.string().regex(/^private-catalog-governance:[0-9a-f]{32}:[1-9][0-9]*$/);
export const PrivateCatalogDecisionIdSchema = z.string().regex(/^private-catalog-decision:[0-9a-f]{32}:[1-9][0-9]*:(curation|teaching|rights|safety)$/);
export const PrivateInternalCatalogEntryIdSchema = z.string().regex(/^private-internal-catalog:[0-9a-f]{32}:[1-9][0-9]*$/);

export const PrivateCatalogCapabilityBoundarySchema = z.object({
  teacherPrivate: z.literal(true),
  studentVisible: z.literal(false),
  internalCatalog: z.literal("ENABLED"),
  canonicalCompilation: z.literal("DISABLED"),
  currentPage: z.literal("DISABLED"),
  formalRelease: z.literal("DISABLED"),
  r2: z.literal("DISABLED"),
  embedding: z.literal("DISABLED"),
  lumiRetrieval: z.literal("DISABLED"),
}).strict().readonly();

const AssignmentBindingsSchema = z.object({
  CURATION: z.string().trim().min(1).max(160),
  TEACHING: z.string().trim().min(1).max(160),
  RIGHTS: z.string().trim().min(1).max(160),
  SAFETY: z.string().trim().min(1).max(160),
}).strict().readonly();

const DecisionBindingsSchema = z.object({
  CURATION: PrivateCatalogDecisionIdSchema,
  TEACHING: PrivateCatalogDecisionIdSchema,
  RIGHTS: PrivateCatalogDecisionIdSchema,
  SAFETY: PrivateCatalogDecisionIdSchema,
}).strict().readonly();

const SourceDecisionBindingsSchema = z.object({
  CURATION: z.string().trim().min(1).max(160),
  TEACHING: z.string().trim().min(1).max(160),
  RIGHTS: z.string().trim().min(1).max(160),
  SAFETY: z.string().trim().min(1).max(160),
}).strict().readonly();

export const PrivateCatalogTargetSchema = z.object({
  pageId: PrivateWikiPageIdSchema,
  pageRevisionId: PrivateWikiPageRevisionIdSchema,
  pageRevision: z.number().int().positive(),
  pageRevisionHash: Sha256Schema,
  contentHash: Sha256Schema,
  truthId: PrivateCompiledTruthIdSchema,
  truthHash: Sha256Schema,
  reviewCaseId: PrivateDomainReviewCaseIdSchema,
  reviewCaseRevision: z.number().int().positive(),
  reviewStateHash: Sha256Schema,
}).strict().readonly();

export const PrivateCatalogGovernanceDecisionSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-private-catalog-domain-decision/v1"),
  decisionId: PrivateCatalogDecisionIdSchema,
  decisionHash: WikiSha256Schema,
  governanceCaseId: PrivateCatalogGovernanceCaseIdSchema,
  reviewDomain: PrivateCatalogReviewDomainSchema,
  decision: z.literal("APPROVE_PRIVATE_INTERNAL_CATALOG"),
  actorId: z.string().trim().min(1).max(160),
  authenticatedTeacherId: z.string().trim().min(1).max(160),
  actorRoleAssignmentId: z.string().trim().min(1).max(160),
  sourcePrivateDecisionId: z.string().trim().min(1).max(160),
  target: PrivateCatalogTargetSchema,
  policyRevision: RevisionBindingSchema,
  interpretation: z.enum([
    "CURATION_ACCEPTED",
    "TEACHING_ACCEPTED",
    "UNKNOWN_PRIVATE_ONLY_ACCEPTED",
    "SAFETY_ACCEPTED",
  ]),
  decidedAt: z.string().datetime(),
}).strict().readonly();

export const PrivateCatalogGovernanceCaseSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-private-catalog-governance-case/v1"),
  governanceCaseId: PrivateCatalogGovernanceCaseIdSchema,
  candidateId: CandidateIdSchema,
  target: PrivateCatalogTargetSchema,
  targetHash: WikiSha256Schema,
  policy: RoleDomainPolicySchema,
  assignments: z.array(ReviewerRoleAssignmentSchema).length(4),
  assignmentIds: AssignmentBindingsSchema,
  sourceDecisionIds: SourceDecisionBindingsSchema,
  decisionIds: DecisionBindingsSchema,
  reviewerModel: z.literal("SINGLE_TEACHER_EXPLICIT_ROLES"),
  selfReviewException: z.literal("LOCAL_PRIVATE_CATALOG_ONLY"),
  rightsScope: z.literal("UNKNOWN_PRIVATE_ONLY"),
  stage: z.literal("ROLE_REVIEW_COMPLETE"),
  reviewedAt: z.string().datetime(),
  caseHash: WikiSha256Schema,
  capabilityBoundary: PrivateCatalogCapabilityBoundarySchema,
}).strict().readonly();

export const PrivateInternalCatalogEntrySchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-private-internal-catalog-entry/v1"),
  entryId: PrivateInternalCatalogEntryIdSchema,
  governanceCaseId: PrivateCatalogGovernanceCaseIdSchema,
  candidateId: CandidateIdSchema,
  pageId: PrivateWikiPageIdSchema,
  pageRevisionId: PrivateWikiPageRevisionIdSchema,
  pageRevision: z.number().int().positive(),
  truthId: PrivateCompiledTruthIdSchema,
  targetHash: WikiSha256Schema,
  acceptedDecisionIds: DecisionBindingsSchema,
  policyRevision: RevisionBindingSchema,
  state: z.literal("INTERNAL_CATALOG_ACTIVE"),
  rightsScope: z.literal("UNKNOWN_PRIVATE_ONLY"),
  activatedAt: z.string().datetime(),
  entryHash: WikiSha256Schema,
  capabilityBoundary: PrivateCatalogCapabilityBoundarySchema,
}).strict().readonly();

export const PrivateCatalogAdmissionReceiptSchema = z.object({
  eligible: z.number().int().nonnegative(),
  policiesCreated: z.number().int().min(0).max(1),
  assignmentsCreated: z.number().int().min(0).max(4),
  casesCreated: z.number().int().nonnegative(),
  decisionsCreated: z.number().int().nonnegative(),
  entriesCreated: z.number().int().nonnegative(),
  replayed: z.number().int().nonnegative(),
  totalCases: z.number().int().nonnegative(),
  totalDecisions: z.number().int().nonnegative(),
  totalEntries: z.number().int().nonnegative(),
  admittedAt: z.string().datetime(),
}).strict();

export const TeacherPrivateCatalogQueueSchema = z.object({
  items: z.array(z.object({
    entryId: PrivateInternalCatalogEntryIdSchema,
    pageId: PrivateWikiPageIdSchema,
    revision: z.number().int().positive(),
    title: z.string().trim().min(1).max(240),
    primaryCategory: z.string().trim().min(1).max(80),
    artisticStyleLabels: z.array(z.string().trim().min(1).max(40)).min(1).max(3),
    primaryPreviewUrl: z.string().regex(/^\/api\/teacher\/inspiration-wiki\/review-packs\//),
    evidenceGapCount: z.number().int().min(0).max(9),
    reviewerModel: z.literal("SINGLE_TEACHER_EXPLICIT_ROLES"),
    rightsScope: z.literal("UNKNOWN_PRIVATE_ONLY"),
    activatedAt: z.string().datetime(),
  }).strict()),
  meta: z.object({
    total: z.number().int().nonnegative(),
    rolePolicies: z.number().int().nonnegative(),
    roleAssignments: z.number().int().nonnegative(),
    roleDecisions: z.number().int().nonnegative(),
    strictSource: z.number().int().nonnegative(),
    evidenceGapSource: z.number().int().nonnegative(),
    distinctActors: z.number().int().nonnegative(),
    boundary: PrivateCatalogCapabilityBoundarySchema,
  }).strict(),
}).strict().superRefine((queue, context) => {
  if (queue.items.length !== queue.meta.total || queue.meta.total !== queue.meta.strictSource + queue.meta.evidenceGapSource) {
    context.addIssue({ code: "custom", path: ["meta"], message: "Private catalog queue totals are inconsistent" });
  }
});

export type PrivateCatalogTarget = z.infer<typeof PrivateCatalogTargetSchema>;
export type PrivateCatalogReviewDomain = z.infer<typeof PrivateCatalogReviewDomainSchema>;
export type PrivateCatalogGovernanceDecision = z.infer<typeof PrivateCatalogGovernanceDecisionSchema>;
export type PrivateCatalogGovernanceCase = z.infer<typeof PrivateCatalogGovernanceCaseSchema>;
export type PrivateInternalCatalogEntry = z.infer<typeof PrivateInternalCatalogEntrySchema>;
export type TeacherPrivateCatalogQueue = z.infer<typeof TeacherPrivateCatalogQueueSchema>;

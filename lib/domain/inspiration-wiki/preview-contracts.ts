import { z } from "zod";

import {
  RevisionBindingSchema,
  WikiOpaqueIdSchema,
  WikiWithdrawalStateSchema,
} from "./core-contracts";
import {
  ReviewerRoleAssignmentSchema,
  ReviewDomainSchema,
  StudentCurrentReleaseEligibilityInputSchema,
} from "./governance-contracts";

export const TeacherCandidatePreviewRequestSchema = z.object({
  kind: z.literal("TEACHER_CANDIDATE_PREVIEW"),
  actorId: WikiOpaqueIdSchema,
  actorRoleAssignmentId: WikiOpaqueIdSchema,
  reviewDomain: ReviewDomainSchema,
  candidateId: WikiOpaqueIdSchema,
  candidateRevision: RevisionBindingSchema,
  reviewPackageRevision: RevisionBindingSchema,
}).strict().readonly();

export const TeacherCandidatePreviewContextSchema = z.object({
  evaluatedAt: z.string().datetime(),
  rolePolicyVersion: WikiOpaqueIdSchema,
  rolePolicyRevision: RevisionBindingSchema,
  assignments: z.array(ReviewerRoleAssignmentSchema).min(1).max(40).readonly(),
  requiredReviewDomain: ReviewDomainSchema,
  candidateId: WikiOpaqueIdSchema,
  currentCandidateRevision: RevisionBindingSchema,
  currentReviewPackageRevision: RevisionBindingSchema,
  candidateState: z.enum(["REVIEWABLE", "NOT_REVIEWABLE"]),
  withdrawalState: WikiWithdrawalStateSchema,
  previewDecision: z.enum(["ALLOW", "DENY", "UNKNOWN"]),
  opaqueAssetRef: WikiOpaqueIdSchema.nullable(),
}).strict().readonly();

export const StudentPagePreviewRequestSchema = z.object({
  kind: z.literal("STUDENT_CURRENT_PAGE_PREVIEW"),
  actorId: WikiOpaqueIdSchema,
  publicId: z.string().regex(/^inspiration:[a-f0-9]{24}$/),
  expectedPageRevision: RevisionBindingSchema.nullable(),
  expectedRelease: RevisionBindingSchema.nullable(),
}).strict().readonly();

export const StudentPagePreviewContextSchema = z.object({
  eligibility: StudentCurrentReleaseEligibilityInputSchema,
  opaqueAssetRef: WikiOpaqueIdSchema.nullable(),
  evidenceId: WikiOpaqueIdSchema.nullable(),
}).strict().readonly();

export const PreviewResolutionSchema = z.object({
  status: z.enum(["AUTHORIZED", "NOT_FOUND"]),
  opaqueAssetRef: WikiOpaqueIdSchema.nullable(),
  evidenceId: WikiOpaqueIdSchema.nullable(),
  consultedSources: z.array(z.enum([
    "CURRENT_CANDIDATE_REVISION",
    "CURRENT_PAGE_RELEASE_COMPILED_TRUTH",
  ])).length(1).readonly(),
}).strict().readonly();

export type PreviewResolution = z.infer<typeof PreviewResolutionSchema>;

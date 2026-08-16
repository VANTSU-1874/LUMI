import { stableWikiJson, deepFreezeWikiValue } from "./integrity";
import { evaluateStudentCurrentReleaseEligibility, reviewerAssignmentSupportsDomain } from "./governance";
import {
  PreviewResolutionSchema,
  StudentPagePreviewContextSchema,
  StudentPagePreviewRequestSchema,
  TeacherCandidatePreviewContextSchema,
  TeacherCandidatePreviewRequestSchema,
  type PreviewResolution,
} from "./preview-contracts";

function resolution(
  source: "CURRENT_CANDIDATE_REVISION" | "CURRENT_PAGE_RELEASE_COMPILED_TRUTH",
  opaqueAssetRef: string | null = null,
  evidenceId: string | null = null,
): PreviewResolution {
  return deepFreezeWikiValue(PreviewResolutionSchema.parse({
    status: opaqueAssetRef ? "AUTHORIZED" : "NOT_FOUND",
    opaqueAssetRef,
    evidenceId: opaqueAssetRef ? evidenceId : null,
    consultedSources: [source],
  }));
}

export function resolveTeacherCandidatePreview(rawRequest: unknown, rawContext: unknown): PreviewResolution {
  const request = TeacherCandidatePreviewRequestSchema.safeParse(rawRequest);
  const context = TeacherCandidatePreviewContextSchema.safeParse(rawContext);
  if (!request.success || !context.success) return resolution("CURRENT_CANDIDATE_REVISION");
  const assignment = context.data.assignments.find(
    (candidate) => candidate.assignmentId === request.data.actorRoleAssignmentId,
  );
  const eligible = request.data.actorId === assignment?.actorId
    && request.data.reviewDomain === context.data.requiredReviewDomain
    && request.data.candidateId === context.data.candidateId
    && stableWikiJson(request.data.candidateRevision) === stableWikiJson(context.data.currentCandidateRevision)
    && stableWikiJson(request.data.reviewPackageRevision) === stableWikiJson(context.data.currentReviewPackageRevision)
    && context.data.candidateState === "REVIEWABLE"
    && context.data.withdrawalState === "CLEAR"
    && context.data.previewDecision === "ALLOW"
    && Boolean(context.data.opaqueAssetRef)
    && Boolean(assignment && reviewerAssignmentSupportsDomain(
      assignment,
      request.data.reviewDomain,
      context.data.evaluatedAt,
      context.data.rolePolicyVersion,
      context.data.rolePolicyRevision,
    ));
  return eligible
    ? resolution("CURRENT_CANDIDATE_REVISION", context.data.opaqueAssetRef)
    : resolution("CURRENT_CANDIDATE_REVISION");
}

export function resolveStudentPagePreview(rawRequest: unknown, rawContext: unknown): PreviewResolution {
  const request = StudentPagePreviewRequestSchema.safeParse(rawRequest);
  const context = StudentPagePreviewContextSchema.safeParse(rawContext);
  if (!request.success || !context.success) return resolution("CURRENT_PAGE_RELEASE_COMPILED_TRUTH");
  const { eligibility } = context.data;
  const pageRevisionMatches = !request.data.expectedPageRevision
    || stableWikiJson(request.data.expectedPageRevision) === stableWikiJson(eligibility.page.pageRevision);
  const releaseMatches = !request.data.expectedRelease
    || stableWikiJson(request.data.expectedRelease) === stableWikiJson(eligibility.page.release);
  const gate = evaluateStudentCurrentReleaseEligibility({ ...eligibility, accessKind: "PREVIEW" });
  const eligible = request.data.actorId === eligibility.viewer.actorId
    && request.data.publicId === eligibility.page.publicId
    && pageRevisionMatches
    && releaseMatches
    && gate.eligible
    && Boolean(context.data.opaqueAssetRef)
    && Boolean(context.data.evidenceId);
  return eligible
    ? resolution("CURRENT_PAGE_RELEASE_COMPILED_TRUTH", context.data.opaqueAssetRef, context.data.evidenceId)
    : resolution("CURRENT_PAGE_RELEASE_COMPILED_TRUTH");
}

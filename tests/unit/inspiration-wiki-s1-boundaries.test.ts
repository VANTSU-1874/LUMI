import { describe, expect, it } from "vitest";

import { bindWikiRevision } from "@/lib/domain/inspiration-wiki/integrity";
import { StudentPagePreviewContextSchema } from "@/lib/domain/inspiration-wiki/preview-contracts";
import { resolveStudentPagePreview, resolveTeacherCandidatePreview } from "@/lib/domain/inspiration-wiki/preview";
import { P1SeedIndexSchema } from "@/lib/domain/inspiration-wiki/retrieval-contracts";
import {
  createP1SeedIndex,
  createP1SeedQueryContract,
  runP1SeedQuery,
} from "@/lib/domain/inspiration-wiki/retrieval";
import {
  StudentExposureSurfaceSchema,
  projectStudentExposureSurfaces,
  propagateWikiRestriction,
} from "@/lib/domain/inspiration-wiki/visibility";
import { autoAdmission, privateCandidateIntake } from "@/tests/fixtures/inspiration-case-intake";
import {
  syntheticGovernanceFixture,
  syntheticReviewedLink,
  syntheticTrustedP1CurrentAllowlistFixture,
  syntheticWikiMaterial,
} from "@/tests/fixtures/inspiration-wiki-s1";
import { formalStudentPublicationFixture } from "@/tests/fixtures/inspiration-review-pipeline";

function teacherPreviewFixture() {
  const { releaseGate } = syntheticGovernanceFixture();
  const assignment = releaseGate.reviewGate.assignments.find(
    (candidate) => candidate.assignmentId === "role-assignment:curation",
  )!;
  const candidateRevision = releaseGate.reviewGate.currentTarget.candidateRevision;
  const reviewPackageRevision = bindWikiRevision("review-package-revision:synthetic-v1", { packet: "synthetic" });
  return {
    request: {
      kind: "TEACHER_CANDIDATE_PREVIEW",
      actorId: assignment.actorId,
      actorRoleAssignmentId: assignment.assignmentId,
      reviewDomain: "CURATION",
      candidateId: "candidate:synthetic-grid-rhythm",
      candidateRevision,
      reviewPackageRevision,
    },
    context: {
      evaluatedAt: releaseGate.reviewGate.evaluatedAt,
      rolePolicyVersion: releaseGate.reviewGate.policy.version,
      rolePolicyRevision: releaseGate.reviewGate.policy.policyRevision,
      assignments: releaseGate.reviewGate.assignments,
      requiredReviewDomain: "CURATION",
      candidateId: "candidate:synthetic-grid-rhythm",
      currentCandidateRevision: candidateRevision,
      currentReviewPackageRevision: reviewPackageRevision,
      candidateState: "REVIEWABLE",
      withdrawalState: "CLEAR",
      previewDecision: "ALLOW",
      opaqueAssetRef: "asset-ref:synthetic-grid-rhythm",
    },
  };
}

function studentPreviewFixture() {
  const { eligibility } = syntheticGovernanceFixture();
  return {
    request: {
      kind: "STUDENT_CURRENT_PAGE_PREVIEW",
      actorId: eligibility.viewer.actorId,
      publicId: eligibility.page.publicId,
      expectedPageRevision: eligibility.page.pageRevision,
      expectedRelease: eligibility.page.release,
    },
    context: {
      eligibility: { ...eligibility, accessKind: "PREVIEW" },
      opaqueAssetRef: "asset-ref:synthetic-grid-rhythm",
      evidenceId: "evidence:synthetic-grid-rhythm",
    },
  };
}

describe("LLM Wiki S1 resolver, visibility, and retrieval boundaries", () => {
  it("uses mutually exclusive teacher-candidate and student-current-page resolvers", () => {
    const teacher = teacherPreviewFixture();
    const student = studentPreviewFixture();

    expect(resolveTeacherCandidatePreview(teacher.request, teacher.context)).toEqual({
      status: "AUTHORIZED",
      opaqueAssetRef: "asset-ref:synthetic-grid-rhythm",
      evidenceId: null,
      consultedSources: ["CURRENT_CANDIDATE_REVISION"],
    });
    expect(resolveStudentPagePreview(student.request, student.context)).toEqual({
      status: "AUTHORIZED",
      opaqueAssetRef: "asset-ref:synthetic-grid-rhythm",
      evidenceId: "evidence:synthetic-grid-rhythm",
      consultedSources: ["CURRENT_PAGE_RELEASE_COMPILED_TRUTH"],
    });
    expect(resolveTeacherCandidatePreview(teacher.request, student.context)).toMatchObject({ status: "NOT_FOUND" });
    expect(resolveStudentPagePreview(student.request, teacher.context)).toMatchObject({ status: "NOT_FOUND" });
  });

  it("never accepts old Candidate, Publication, or admission records as student fallbacks", () => {
    const student = studentPreviewFixture();
    const legacyRecords = [
      privateCandidateIntake(),
      formalStudentPublicationFixture(),
      autoAdmission({ pipelineState: "ACTIVE" }),
    ];
    for (const legacyRecord of legacyRecords) {
      expect(StudentPagePreviewContextSchema.safeParse(legacyRecord).success).toBe(false);
      expect(resolveStudentPagePreview(student.request, legacyRecord)).toEqual({
        status: "NOT_FOUND",
        opaqueAssetRef: null,
        evidenceId: null,
        consultedSources: ["CURRENT_PAGE_RELEASE_COMPILED_TRUTH"],
      });
    }
  });

  it("denies stale candidate hashes, stale page revisions, and release mismatches without cross-fallback", () => {
    const teacher = teacherPreviewFixture();
    const student = studentPreviewFixture();
    const staleCandidate = {
      ...teacher.request,
      candidateRevision: bindWikiRevision("candidate-revision:stale", { stale: true }),
    };
    expect(resolveTeacherCandidatePreview(staleCandidate, teacher.context)).toEqual({
      status: "NOT_FOUND",
      opaqueAssetRef: null,
      evidenceId: null,
      consultedSources: ["CURRENT_CANDIDATE_REVISION"],
    });
    const previousTeacherScope = {
      ...teacher.context,
      assignments: teacher.context.assignments.map((assignment) => (
        assignment.assignmentId === teacher.request.actorRoleAssignmentId
          ? { ...assignment, status: "REVOKED" }
          : assignment
      )),
    };
    expect(resolveTeacherCandidatePreview(teacher.request, previousTeacherScope)).toMatchObject({
      status: "NOT_FOUND",
      consultedSources: ["CURRENT_CANDIDATE_REVISION"],
    });
    expect(resolveStudentPagePreview({
      ...student.request,
      expectedRelease: bindWikiRevision("wiki-release:stale", { stale: true }),
    }, student.context)).toEqual({
      status: "NOT_FOUND",
      opaqueAssetRef: null,
      evidenceId: null,
      consultedSources: ["CURRENT_PAGE_RELEASE_COMPILED_TRUTH"],
    });
  });

  it("removes a withdrawn page from browse, search, tool, prompt, render, retry, and preview", () => {
    const { eligibility } = syntheticGovernanceFixture();
    const withdrawn = {
      ...eligibility,
      page: { ...eligibility.page, withdrawalState: "WITHDRAWN" },
    };
    const exposure = projectStudentExposureSurfaces([{
      pageId: eligibility.page.pageId,
      eligibility: withdrawn,
      historicalReferences: [
        {
          kind: "MESSAGE_SNAPSHOT",
          referenceId: "message-snapshot:previously-authorized",
          pageId: eligibility.page.pageId,
          releaseId: eligibility.page.release.revisionId,
          recordedAt: "2026-08-10T00:30:00.000Z",
        },
        {
          kind: "RUN_SNAPSHOT",
          referenceId: "run-snapshot:previously-authorized",
          pageId: eligibility.page.pageId,
          releaseId: eligibility.page.release.revisionId,
          recordedAt: "2026-08-10T00:31:00.000Z",
        },
      ],
    }]);
    for (const surface of StudentExposureSurfaceSchema.options) expect(exposure[surface]).toEqual([]);
  });

  it("propagates page withdrawal and reviewer revocation through graph and all cached surfaces", () => {
    const primary = syntheticGovernanceFixture({ linkToSlugs: ["synthetic-other"] });
    const other = syntheticGovernanceFixture({ slug: "synthetic-other", linkToSlugs: [] });
    const { eligibility, releaseGate } = primary;
    const otherPageId = other.verified.pageId;
    const exposure = Object.fromEntries(StudentExposureSurfaceSchema.options.map((surface) => [
      surface,
      [eligibility.page.pageId, otherPageId],
    ]));
    const snapshot = {
      releaseId: releaseGate.current.release.revisionId,
      releaseState: "RELEASED",
      effectiveChannelStates: releaseGate.current.channelStates,
      eligiblePageIds: [eligibility.page.pageId, otherPageId],
      links: [syntheticReviewedLink(primary, other)],
      exposure,
      restrictedPageIds: [],
    };
    const withdrawn = propagateWikiRestriction(snapshot, {
      kind: "PAGE_RESTRICTION",
      pageId: eligibility.page.pageId,
      state: "WITHDRAWN",
    });
    expect(withdrawn.snapshot.eligiblePageIds).toEqual([otherPageId]);
    expect(withdrawn.snapshot.links).toEqual([]);
    for (const surface of StudentExposureSurfaceSchema.options) {
      expect(withdrawn.snapshot.exposure[surface]).toEqual([otherPageId]);
    }

    const revoked = propagateWikiRestriction(snapshot, {
      kind: "REVIEWER_REVOCATION",
      actorId: "actor:rights-a",
    });
    expect(revoked.snapshot.releaseState).toBe("REVIEW_HOLD");
    expect(revoked.snapshot.effectiveChannelStates).toEqual({
      BROWSE_RELEASE: "DISABLED",
      STUDENT_SEARCH: "DISABLED",
      WIKI_RETRIEVAL: "DISABLED",
    });
    expect(revoked.snapshot.eligiblePageIds).toEqual([]);
    for (const surface of StudentExposureSurfaceSchema.options) expect(revoked.snapshot.exposure[surface]).toEqual([]);
  });

  it("uses only FTS, Alias, Facet, and the eligible visible graph with zero vectors", () => {
    const materialSpecs = [
      { slug: "seed", visibility: "ELIGIBLE" as const, alias: "栅格节奏", linkToSlugs: ["hidden-bridge", "visible-neighbor"] },
      { slug: "hidden-bridge", visibility: "HIDDEN" as const, alias: "hidden", linkToSlugs: ["blocked-behind-hidden"] },
      { slug: "blocked-behind-hidden", visibility: "ELIGIBLE" as const, alias: "blocked", linkToSlugs: [] },
      { slug: "visible-neighbor", visibility: "ELIGIBLE" as const, alias: "neighbor", linkToSlugs: [] },
    ];
    const materials = materialSpecs.map((spec) => ({
      ...spec,
      material: syntheticWikiMaterial({
        slug: spec.slug,
        title: `Synthetic ${spec.slug}`,
        aliases: [spec.alias],
        facets: ["版式"],
        claimText: `unrelated synthetic ${spec.slug}`,
        linkToSlugs: spec.linkToSlugs,
      }),
    }));
    const pageIdFor = (slug: string) => materials.find((item) => item.slug === slug)!.material.verified.pageId;
    const seedPageId = pageIdFor("seed");
    const blockedPageId = pageIdFor("blocked-behind-hidden");
    const visibleNeighborId = pageIdFor("visible-neighbor");
    const materialFor = (slug: string) => materials.find((item) => item.slug === slug)!.material;
    const index = createP1SeedIndex({
      sources: materials.map((item) => ({
        sourceMaterial: item.material.sourceMaterial,
        reviewGate: item.material.releaseGate.reviewGate,
        visibility: item.visibility,
      })),
      links: [
        syntheticReviewedLink(materialFor("seed"), materialFor("hidden-bridge")),
        syntheticReviewedLink(materialFor("hidden-bridge"), materialFor("blocked-behind-hidden")),
        syntheticReviewedLink(materialFor("seed"), materialFor("visible-neighbor")),
      ],
      createdAt: "2026-08-10T04:00:00.000Z",
    });
    const contract = createP1SeedQueryContract({
      query: "栅格节奏",
      eligiblePageIds: [seedPageId, blockedPageId, visibleNeighborId],
      allowedPageTypes: ["INSPIRATION_CASE"],
      allowedLinkTypes: ["CONTRASTS_WITH"],
      hopLimit: 2,
      resultLimit: 10,
      evaluatedAt: "2026-08-10T04:00:00.000Z",
      evaluatedAtTrustBoundary: "UPSTREAM_TRUSTED_CLOCK_NOT_IMPLEMENTED_IN_S1",
      expectedIndexRevision: index.indexRevision,
      currentAllowlist: syntheticTrustedP1CurrentAllowlistFixture(index),
    });
    expect(contract.seedModes).toEqual(["FTS", "ALIAS", "FACET"]);
    expect(contract.lexicalMatchContract).toBe("EXACT_NORMALIZED_TERMS_NOT_SUBSTRING");
    expect(contract.graph).toMatchObject({ scope: "ELIGIBLE_VISIBLE_SUBGRAPH", hiddenNodesAsBridges: false });
    expect(contract.vector).toEqual({ mode: "VECTOR_DISABLED", vectorCalls: 0, provider: null, index: null });
    const result = runP1SeedQuery(contract, index);
    expect(result.vectorCalls).toBe(0);
    expect(result.results.map((item) => item.pageId)).toEqual([seedPageId, visibleNeighborId]);
    expect(result.results.some((item) => item.pageId === blockedPageId)).toBe(false);

    const substringOnly = runP1SeedQuery(createP1SeedQueryContract({
      query: "栅格",
      eligiblePageIds: [seedPageId, blockedPageId, visibleNeighborId],
      allowedPageTypes: ["INSPIRATION_CASE"],
      allowedLinkTypes: ["CONTRASTS_WITH"],
      hopLimit: 2,
      resultLimit: 10,
      evaluatedAt: "2026-08-10T04:00:00.000Z",
      evaluatedAtTrustBoundary: "UPSTREAM_TRUSTED_CLOCK_NOT_IMPLEMENTED_IN_S1",
      expectedIndexRevision: index.indexRevision,
      currentAllowlist: syntheticTrustedP1CurrentAllowlistFixture(index),
    }), index);
    expect(substringOnly).toMatchObject({ results: [], vectorCalls: 0, noAnswer: true });
  });

  it("rejects vector fields and legacy candidates from the P1 query contract", () => {
    const material = syntheticWikiMaterial({ slug: "vector-contract" });
    const index = createP1SeedIndex({
      sources: [{
        sourceMaterial: material.sourceMaterial,
        reviewGate: material.releaseGate.reviewGate,
        visibility: "ELIGIBLE",
      }],
      links: [],
      createdAt: "2026-08-10T04:00:00.000Z",
    });
    const pageId = material.verified.pageId;
    const contract = createP1SeedQueryContract({
      query: "synthetic",
      eligiblePageIds: [pageId],
      allowedPageTypes: ["INSPIRATION_CASE"],
      allowedLinkTypes: [],
      hopLimit: 1,
      resultLimit: 5,
      evaluatedAt: "2026-08-10T04:00:00.000Z",
      evaluatedAtTrustBoundary: "UPSTREAM_TRUSTED_CLOCK_NOT_IMPLEMENTED_IN_S1",
      expectedIndexRevision: index.indexRevision,
      currentAllowlist: syntheticTrustedP1CurrentAllowlistFixture(index),
    });
    expect(() => runP1SeedQuery({ ...contract, embedding: [0.1, 0.2] }, { pages: [], links: [] })).toThrow();
    expect(P1SeedIndexSchema.safeParse({ pages: [privateCandidateIntake()], links: [] }).success).toBe(false);
    expect(P1SeedIndexSchema.safeParse({
      pages: [{
        status: "ACTIVE",
        publicationScope: "FORMAL",
        approved_projection_json: { title: "Rejected flat source" },
      }],
      links: [],
    }).success).toBe(false);
  });
});

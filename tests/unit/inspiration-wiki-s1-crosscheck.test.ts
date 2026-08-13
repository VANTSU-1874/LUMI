import { describe, expect, it } from "vitest";

import { CompiledTruthSchema } from "@/lib/domain/inspiration-wiki/compilation-contracts";
import {
  evaluateReleaseDecision,
  evaluateRoleDomainReviews,
  revokeReviewerAssignments,
} from "@/lib/domain/inspiration-wiki/governance";
import {
  bindWikiRevision,
  compileWikiPageDraft,
  createCanonicalInputBundle,
  deepFreezeWikiValue,
  parseImmutableReviewedWikiLink,
  parseImmutableWikiDraftCompilation,
  reviseWikiPageDraft,
  wikiPageIdForCase,
} from "@/lib/domain/inspiration-wiki/integrity";
import {
  createP1SeedIndex,
  createP1SeedQueryContract,
  parseImmutableP1SeedIndex,
  runP1SeedQuery,
} from "@/lib/domain/inspiration-wiki/retrieval";
import { StudentExposureSurfaceSchema, projectStudentExposureSurfaces } from "@/lib/domain/inspiration-wiki/visibility";
import {
  syntheticActivationReceipt,
  syntheticDraftCompilation,
  syntheticGovernanceFixture,
  syntheticCanonicalInputSeed,
  syntheticReviewedLink,
  syntheticTrustedP1CurrentAllowlistFixture,
  syntheticWikiMaterial,
  syntheticWikiDraftSeed,
} from "@/tests/fixtures/inspiration-wiki-s1";

const ZERO_HASH = `sha256:${"0".repeat(64)}`;

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rebindRoleReview<T extends { readonly decisionId: string }>(review: T): T {
  const material = Object.fromEntries(Object.entries(review).filter(([key]) => key !== "decisionRevision"));
  return {
    ...review,
    decisionRevision: bindWikiRevision(`${review.decisionId}:revision`, material),
  };
}

function p1GraphFixture() {
  const materials = ["alpha", "beta", "gamma"].map((alias) => syntheticWikiMaterial({
    slug: `crosscheck-${alias}`,
    title: `Synthetic ${alias}`,
    aliases: [alias],
    facets: ["版式"],
    claimText: `${alias} verified source observation`,
    linkToSlugs: alias === "alpha"
      ? ["crosscheck-beta"]
      : alias === "beta" ? ["crosscheck-gamma", "crosscheck-alpha"] : [],
  }));
  const sources = materials.map((material) => ({
    sourceMaterial: material.sourceMaterial,
    reviewGate: material.releaseGate.reviewGate,
    visibility: "ELIGIBLE" as const,
  }));
  const [pageA, pageB, pageC] = materials.map((material) => material.verified.pageId) as [string, string, string];
  const links = [
    syntheticReviewedLink(materials[0]!, materials[1]!),
    syntheticReviewedLink(materials[1]!, materials[2]!),
  ];
  const index = createP1SeedIndex({
    sources,
    links,
    createdAt: "2026-08-10T04:00:00.000Z",
  });
  return { index, links, pageA, pageB, pageC, materials, sources };
}

describe("LLM Wiki S1 independent crosscheck loophole closures", () => {
  it("[1] cannot reuse page A reviews to authorize page B release/current bindings", () => {
    const { releaseGate } = syntheticGovernanceFixture();
    const pageB = wikiPageIdForCase("inspiration-case:unreviewed-page-b");
    const pageBRevision = bindWikiRevision("wiki-revision:unreviewed-page-b", { pageId: pageB });
    const foreignTarget = {
      ...releaseGate.reviewGate.currentTarget,
      pageId: pageB,
      pageDraftRevision: pageBRevision,
      pageRevision: pageBRevision,
      canonicalInputBundle: bindWikiRevision("canonical-bundle:unreviewed-page-b", { pageId: pageB }),
      riskScope: {
        ...releaseGate.reviewGate.currentTarget.riskScope,
        appliesToPageId: pageB,
        appliesToPageRevision: pageBRevision,
      },
    };
    const roleGate = evaluateRoleDomainReviews({
      ...releaseGate.reviewGate,
      currentTarget: foreignTarget,
    });
    expect(roleGate.eligible).toBe(false);
    expect(roleGate.reasons).toContain("CURATION_STALE_TARGET_HASH");

    const release = evaluateReleaseDecision({
      ...releaseGate,
      current: { ...releaseGate.current, pageId: pageB, pageRevision: pageBRevision },
    });
    expect(release.eligible).toBe(false);
    expect(release.reasons).toContain("RELEASE_REVIEW_TARGET_MISMATCH");

    const reboundReviews = releaseGate.reviewGate.reviews.map((review) => (
      review.decisionId === "domain-review:curation"
        ? rebindRoleReview({ ...review, decidedAt: "2026-08-10T01:01:00.000Z" })
        : review
    ));
    const staleReleaseReviewSet = evaluateReleaseDecision({
      ...releaseGate,
      reviewGate: { ...releaseGate.reviewGate, reviews: reboundReviews },
    });
    expect(staleReleaseReviewSet.eligible).toBe(false);
    expect(staleReleaseReviewSet.reasons).toContain("RELEASE_DOMAIN_REVIEW_SET_HASH_MISMATCH");
  });

  it("[2] rejects an outer student projection pageId that borrows another eligible Page", () => {
    const { eligibility } = syntheticGovernanceFixture();
    const borrowedPageId = wikiPageIdForCase("inspiration-case:borrowed-outer-id");
    const exposure = projectStudentExposureSurfaces([{
      pageId: borrowedPageId,
      eligibility,
      historicalReferences: [{
        kind: "MESSAGE_SNAPSHOT",
        referenceId: "message-snapshot:borrowed-id",
        pageId: borrowedPageId,
        releaseId: eligibility.page.release.revisionId,
        recordedAt: "2026-08-10T00:30:00.000Z",
      }],
    }]);
    for (const surface of StudentExposureSurfaceSchema.options) expect(exposure[surface]).toEqual([]);
  });

  it("[3] revalidates canonical claim support, link evidence, and compilation receipts on revise", () => {
    const { bundle, compilation } = syntheticDraftCompilation();
    const originalClaim = compilation.pageDraft.claimDrafts[0]!;
    expect(() => reviseWikiPageDraft(compilation, {
      claims: [{
        claimId: originalClaim.claimId,
        claimType: originalClaim.claimType,
        text: originalClaim.text,
        supportObjectIds: ["legacy-publication:outside-bundle"],
        authorship: originalClaim.authorship,
      }],
      createdAt: "2026-08-10T02:00:00.000Z",
    }, compilation.pageDraft.revision, bundle)).toThrow();

    const staleReceipt = jsonClone(compilation) as unknown as {
      receipt: { outputTimelineSetHash: string };
    };
    staleReceipt.receipt.outputTimelineSetHash = ZERO_HASH;
    expect(() => reviseWikiPageDraft(staleReceipt, {
      createdAt: "2026-08-10T02:00:00.000Z",
    }, compilation.pageDraft.revision, bundle)).toThrow(/COMPILATION_NOT_UNIQUELY_DERIVED/);

    const unboundEvidence = jsonClone(compilation) as unknown as {
      linkDecisionDrafts: Array<{ evidenceRefs: string[] }>;
    };
    unboundEvidence.linkDecisionDrafts[0]!.evidenceRefs = ["admission:unbound-evidence"];
    expect(() => reviseWikiPageDraft(unboundEvidence, {
      createdAt: "2026-08-10T02:00:00.000Z",
    }, compilation.pageDraft.revision, bundle)).toThrow(/COMPILATION_NOT_UNIQUELY_DERIVED/);
  });

  it("[4] verifies Page/Revision/Timeline/ReviewedLink/index hashes and receipts across objects", () => {
    const { bundle, compilation } = syntheticDraftCompilation();
    const stalePageRevision = jsonClone(compilation) as unknown as {
      pageRevision: { revision: ReturnType<typeof bindWikiRevision> };
    };
    stalePageRevision.pageRevision.revision = bindWikiRevision("wiki-revision:foreign", { foreign: true });
    expect(() => parseImmutableWikiDraftCompilation(stalePageRevision, bundle))
      .toThrow(/COMPILATION_NOT_UNIQUELY_DERIVED/);

    const staleTimeline = jsonClone(compilation) as unknown as {
      timelineEntries: Array<{ pageRevision: ReturnType<typeof bindWikiRevision> }>;
    };
    staleTimeline.timelineEntries[0]!.pageRevision = bindWikiRevision("wiki-revision:foreign", { foreign: true });
    expect(() => parseImmutableWikiDraftCompilation(staleTimeline, bundle))
      .toThrow(/COMPILATION_NOT_UNIQUELY_DERIVED/);

    const graph = p1GraphFixture();
    const staleLink = { ...graph.links[0]!, toPageRevision: bindWikiRevision("wiki-revision:stale", { stale: true }) };
    expect(() => parseImmutableReviewedWikiLink(staleLink)).toThrow(/STALE_WIKI_LINK_DECISION/);

    const staleIndex = jsonClone(graph.index) as unknown as {
      pages: Array<{ revision: ReturnType<typeof bindWikiRevision> }>;
    };
    staleIndex.pages[0]!.revision = bindWikiRevision("wiki-revision:index-tampered", { tampered: true });
    expect(() => parseImmutableP1SeedIndex(staleIndex)).toThrow(/STALE_P1_INDEX_REVISION|P1_INDEX_SET_HASH_MISMATCH/);
  });

  it("[5] binds immutable policy documents and exact target-risk scope digests", () => {
    const { releaseGate } = syntheticGovernanceFixture();
    const substitutedPolicy = {
      ...releaseGate.reviewGate.policy,
      allowSelfReview: true,
    };
    const policyResult = evaluateRoleDomainReviews({
      ...releaseGate.reviewGate,
      policy: substitutedPolicy,
    });
    expect(policyResult.eligible).toBe(false);
    expect(policyResult.reasons).toContain("STALE_ROLE_POLICY_DOCUMENT");

    const substitutedScope = {
      ...releaseGate.reviewGate.currentTarget,
      riskScope: {
        ...releaseGate.reviewGate.currentTarget.riskScope,
        dualReviewRequired: false,
      },
    };
    const scopeResult = evaluateRoleDomainReviews({
      ...releaseGate.reviewGate,
      currentTarget: substitutedScope,
    });
    expect(scopeResult.eligible).toBe(false);
    expect(scopeResult.reasons).toContain("STALE_TARGET_RISK_SCOPE");
    expect(scopeResult.reasons).toContain("TARGET_RISK_DUAL_REVIEW_MISMATCH");
  });

  it("[6] forbids post-hoc review and activation receipts recorded before release", () => {
    const { releaseGate } = syntheticGovernanceFixture();
    const lateReviews = releaseGate.reviewGate.reviews.map((review) => (
      review.decisionId === "domain-review:curation"
        ? rebindRoleReview({ ...review, decidedAt: "2026-08-10T02:30:00.000Z" })
        : review
    ));
    const postHoc = evaluateReleaseDecision({
      ...releaseGate,
      reviewGate: { ...releaseGate.reviewGate, reviews: lateReviews },
    });
    expect(postHoc.eligible).toBe(false);
    expect(postHoc.reasons).toContain("REVIEW_DECISION_AFTER_RELEASE_DECISION");

    const earlyActivation = syntheticActivationReceipt(releaseGate.decision, releaseGate.current, {
      recordedAt: "2026-08-10T01:30:00.000Z",
      activatedAt: "2026-08-10T01:30:00.000Z",
    });
    const activationResult = evaluateReleaseDecision({ ...releaseGate, activationReceipt: earlyActivation });
    expect(activationResult.eligible).toBe(false);
    expect(activationResult.reasons).toContain("RELEASE_OR_CHANNEL_RECEIPT_TIME_INVALID");
  });

  it("[7] binds link approval to endpoint revisions and rejects self/duplicate/cyclic traversal paths", () => {
    const graph = p1GraphFixture();
    expect(() => syntheticReviewedLink(graph.materials[0]!, graph.materials[0]!))
      .toThrow(/self-referential/i);

    const reverse = syntheticReviewedLink(graph.materials[1]!, graph.materials[0]!);
    expect(() => createP1SeedIndex({
      sources: graph.sources,
      links: [...graph.links, reverse],
      createdAt: "2026-08-10T04:00:00.000Z",
    })).toThrow(/DUPLICATE_REVIEWED_LOGICAL_LINK/);

    const contract = createP1SeedQueryContract({
      query: "alpha",
      eligiblePageIds: [graph.pageA, graph.pageB, graph.pageC],
      allowedPageTypes: ["INSPIRATION_CASE"],
      allowedLinkTypes: ["CONTRASTS_WITH"],
      hopLimit: 2,
      resultLimit: 10,
      evaluatedAt: "2026-08-10T04:15:00.000Z",
      evaluatedAtTrustBoundary: "UPSTREAM_TRUSTED_CLOCK_NOT_IMPLEMENTED_IN_S1",
      expectedIndexRevision: graph.index.indexRevision,
      currentAllowlist: syntheticTrustedP1CurrentAllowlistFixture(graph.index),
    });
    const response = runP1SeedQuery(contract, graph.index);
    const paths = response.results.flatMap((result) => result.relationshipPaths);
    expect(paths).not.toHaveLength(0);
    expect(paths.every((path) => path.fromPageId !== path.toPageId)).toBe(true);
    expect(paths.every((path) => new Set(path.linkIds).size === path.linkIds.length)).toBe(true);
    expect(paths.some((path) => path.fromPageId === graph.pageA && path.toPageId === graph.pageA)).toBe(false);
  });

  it("[8] excludes superseded decisions from two-person review and accepted sets", () => {
    const { releaseGate } = syntheticGovernanceFixture();
    const oldRightsB = releaseGate.reviewGate.reviews.find(
      (review) => review.decisionId === "domain-review:rights-b",
    )!;
    const replacementId = "domain-review:rights-b-v2";
    const replacement = rebindRoleReview({
      ...oldRightsB,
      decisionId: replacementId,
      coReviewerDecisionIds: ["domain-review:rights-a"],
      decidedAt: "2026-08-10T01:30:00.000Z",
      supersedesDecisionId: oldRightsB.decisionId,
    });
    const staleCoReviewSet = [
      ...releaseGate.reviewGate.reviews,
      replacement,
    ];
    const staleCoReview = evaluateRoleDomainReviews({
      ...releaseGate.reviewGate,
      reviews: staleCoReviewSet,
    });
    expect(staleCoReview.eligible).toBe(false);
    expect(staleCoReview.reasons).toContain("RIGHTS_INVALID_CO_REVIEW_LINK");

    const currentReviews = staleCoReviewSet.map((review) => (
      review.decisionId === "domain-review:rights-a"
        ? rebindRoleReview({ ...review, coReviewerDecisionIds: [replacementId] })
        : review
    ));
    const currentOnly = evaluateRoleDomainReviews({
      ...releaseGate.reviewGate,
      reviews: currentReviews,
    });
    expect(currentOnly.eligible).toBe(true);
    expect(currentOnly.acceptedDecisionIds).toContain(replacementId);
    expect(currentOnly.acceptedDecisionIds).not.toContain(oldRightsB.decisionId);

    const expiredCurrentReviews = currentReviews.map((review) => (
      review.decisionId === replacementId
        ? rebindRoleReview({ ...review, status: "EXPIRED", validUntil: "2026-08-10T01:45:00.000Z" })
        : review
    ));
    const expiredCurrent = evaluateRoleDomainReviews({
      ...releaseGate.reviewGate,
      reviews: expiredCurrentReviews,
    });
    expect(expiredCurrent.eligible).toBe(false);
    expect(expiredCurrent.reasons).toContain("RIGHTS_REVIEW_DECISION_NOT_CURRENT");
    expect(expiredCurrent.reasons).toContain("RIGHTS_SECOND_REVIEW_MISSING");
  });

  it("[9] permits only opaque course references/labels, never copied Knowledge V2 claims", () => {
    const { bundle } = syntheticDraftCompilation();
    const { truth } = syntheticGovernanceFixture();
    const courseReference = truth.courseConceptRefs[0]!;
    const copiedCourseClaim = {
      claimId: "wiki-claim:copied-course-body",
      claimType: "TEACHING_INFERENCE" as const,
      text: "Copied Knowledge V2 explanatory body disguised as a claim.",
      supportObjectIds: [courseReference.conceptId],
      authorship: "HUMAN_REVIEWED" as const,
      reviewDecisionIds: ["domain-review:teaching"],
    };
    expect(CompiledTruthSchema.safeParse({
      ...truth,
      pageType: "COURSE_CONCEPT_REF",
      title: courseReference.displayLabel,
      aliases: [],
      facets: [],
      claims: [copiedCourseClaim],
      courseConceptRefs: [courseReference],
    }).success).toBe(false);

    const seed = syntheticWikiDraftSeed();
    expect(() => compileWikiPageDraft(bundle, {
      ...seed,
      pageType: "COURSE_CONCEPT_REF",
      title: courseReference.displayLabel,
      aliases: [],
      facets: [],
      claims: [{
        claimId: "wiki-claim:copied-course-draft",
        claimType: "TEACHING_INFERENCE",
        text: "Copied course explanation routed through ordinary claim text.",
        supportObjectIds: ["source:synthetic-grid-rhythm"],
        authorship: "HUMAN_DRAFT",
      }],
      links: [],
    })).toThrow();

    const courseSeed = jsonClone(syntheticCanonicalInputSeed()) as unknown as {
      inputs: Array<{ kind: string; payload: Record<string, unknown> }>;
    };
    courseSeed.inputs.find((input) => input.kind === "CANDIDATE_REVISION")!.payload = {
      pageType: "COURSE_CONCEPT_REF",
      title: courseReference.displayLabel,
      aliases: [],
      facets: [],
      scope: "PRIVATE_CANDIDATE",
      studentVisible: false,
      createdAt: "2026-08-09T23:00:00.000Z",
      linkDrafts: [],
    };
    courseSeed.inputs.find((input) => input.kind === "ANALYSIS_REVISION")!.payload = {
      knowledgeDomain: "COURSE_KNOWLEDGE_V2_REFERENCE_ONLY",
      createdAt: "2026-08-09T23:00:00.000Z",
      conceptRefs: [courseReference],
    };
    const referenceOnly = compileWikiPageDraft(createCanonicalInputBundle(courseSeed), seed);
    expect(referenceOnly.pageDraft).toMatchObject({
      pageType: "COURSE_CONCEPT_REF",
      title: courseReference.displayLabel,
      claimDrafts: [],
      courseConceptRefs: [courseReference],
    });
  });

  it("[10] pure functions copy before freezing and never mutate caller-owned inputs", () => {
    const callerOwned = { nested: { count: 1 }, values: ["a"] };
    const frozenOutput = deepFreezeWikiValue(callerOwned);
    expect(frozenOutput).not.toBe(callerOwned);
    expect(frozenOutput.nested).not.toBe(callerOwned.nested);
    expect(Object.isFrozen(frozenOutput)).toBe(true);
    expect(Object.isFrozen(frozenOutput.nested)).toBe(true);
    expect(Object.isFrozen(callerOwned)).toBe(false);
    expect(Object.isFrozen(callerOwned.nested)).toBe(false);
    callerOwned.nested.count = 2;
    callerOwned.values.push("b");
    expect(frozenOutput).toEqual({ nested: { count: 1 }, values: ["a"] });

    const { releaseGate } = syntheticGovernanceFixture();
    const callerAssignments = releaseGate.reviewGate.assignments.map((assignment) => ({ ...assignment }));
    const revoked = revokeReviewerAssignments(callerAssignments, "actor:rights-a");
    expect(Object.isFrozen(callerAssignments)).toBe(false);
    expect(callerAssignments.every((assignment) => !Object.isFrozen(assignment))).toBe(true);
    expect(Object.isFrozen(revoked)).toBe(true);
    callerAssignments[0]!.status = "REVOKED";
    expect(revoked[0]!.status).toBe("ACTIVE");

    const { bundle, compilation } = syntheticDraftCompilation();
    const rawCompilation = jsonClone(compilation);
    const parsed = parseImmutableWikiDraftCompilation(rawCompilation, bundle);
    expect(Object.isFrozen(rawCompilation)).toBe(false);
    expect(Object.isFrozen(rawCompilation.pageDraft)).toBe(false);
    expect(Object.isFrozen(parsed)).toBe(true);
  });
});

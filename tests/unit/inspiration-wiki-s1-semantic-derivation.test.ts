import { describe, expect, it } from "vitest";

import type { ReleaseDecision } from "@/lib/domain/inspiration-wiki/governance-contracts";
import {
  evaluateReleaseDecision,
  evaluateRoleDomainReviews,
  evaluateStudentCurrentReleaseEligibility,
} from "@/lib/domain/inspiration-wiki/governance";
import {
  bindWikiRevision,
  compileWikiPageDraft,
  createCanonicalInputBundle,
  deriveVerifiedWikiMaterial,
  hashWikiValue,
} from "@/lib/domain/inspiration-wiki/integrity";
import { createP1SeedIndex } from "@/lib/domain/inspiration-wiki/retrieval";
import {
  syntheticActivationReceipt,
  syntheticCanonicalInputSeed,
  syntheticGovernanceFixture,
  syntheticReviewedLink,
  syntheticWikiDraftSeed,
  rebindSyntheticReleaseDecision,
} from "@/tests/fixtures/inspiration-wiki-s1";

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

function jsonClone<T>(value: T): DeepMutable<T> {
  return JSON.parse(JSON.stringify(value)) as DeepMutable<T>;
}

function withoutKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]) {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
}

function rehashTruth<T extends { contentHash: string }>(truth: T): T {
  truth.contentHash = hashWikiValue(withoutKeys(truth, ["contentHash"]));
  return truth;
}

function rebindGateToTruth(
  fixture: ReturnType<typeof syntheticGovernanceFixture>,
  sourceMaterial: DeepMutable<typeof fixture.sourceMaterial>,
) {
  const verified = deriveVerifiedWikiMaterial(sourceMaterial);
  const { release: _oldRelease, ...oldCurrentMaterial } = fixture.releaseGate.current;
  void _oldRelease;
  const currentMaterial = {
    ...oldCurrentMaterial,
    sourceMaterialReceipt: verified.materialReceipt,
    compiledTruthHash: verified.compiledTruthHash,
  };
  const release = bindWikiRevision(
    `wiki-release:${hashWikiValue(currentMaterial).slice(7, 31)}`,
    currentMaterial,
  );
  const current = { ...currentMaterial, release };
  const { decisionRevision: _oldDecisionRevision, ...oldDecisionMaterial } = fixture.releaseGate.decision;
  void _oldDecisionRevision;
  const decision = rebindSyntheticReleaseDecision({
    ...oldDecisionMaterial,
    sourceMaterialReceipt: verified.materialReceipt,
    compiledTruthHash: verified.compiledTruthHash,
    release,
  });
  return {
    ...fixture.releaseGate,
    sourceMaterial,
    current,
    decision,
    releaseDecisionHistory: [decision],
    activationReceipt: syntheticActivationReceipt(decision, current),
  };
}

function rebindReviewedLink<T extends ReturnType<typeof syntheticReviewedLink>>(rawLink: T): T {
  const link = jsonClone(rawLink) as DeepMutable<T>;
  const decisionMaterial = {
    linkId: link.linkId,
    fromPageId: link.fromPageId,
    fromPageRevision: link.fromPageRevision,
    toPageId: link.toPageId,
    toPageRevision: link.toPageRevision,
    sourcePageId: link.sourcePageId,
    sourcePageRevision: link.sourcePageRevision,
    sourceCanonicalInputBundle: link.sourceCanonicalInputBundle,
    sourceDraftMaterialReceipt: link.sourceDraftMaterialReceipt,
    linkDraftRevision: link.linkDraftRevision,
    relationType: link.relationType,
    evidenceRefs: link.evidenceRefs,
  };
  link.decision = bindWikiRevision(link.decision.revisionId, decisionMaterial);
  link.approvalReceipt = bindWikiRevision(
    link.approvalReceipt.revisionId,
    withoutKeys(link, ["revision", "approvalReceipt"]),
  );
  link.revision = bindWikiRevision(link.revision.revisionId, withoutKeys(link, ["revision"]));
  return link as T;
}

function nextReleaseDecision(
  prior: ReleaseDecision,
  changes: Partial<Omit<ReleaseDecision, "decisionRevision">>,
) {
  const { decisionRevision: _priorRevision, ...material } = prior;
  void _priorRevision;
  return rebindSyntheticReleaseDecision({ ...material, ...changes });
}

describe("LLM Wiki S1 canonical semantic derivation adversaries", () => {
  it("rejects fully recompiled canonical RIGHTS DENY and WITHDRAWN states at review, release, and student gates", () => {
    for (const fixture of [
      syntheticGovernanceFixture({ slug: "rights-denied", rightsDecision: "DENY" }),
      syntheticGovernanceFixture({ slug: "canonically-withdrawn", withdrawalState: "WITHDRAWN" }),
    ]) {
      // Both fixtures were compiled from scratch, so their bundle/truth/material/release
      // hashes are internally current. Semantic denial must still dominate those hashes.
      expect(() => deriveVerifiedWikiMaterial(fixture.sourceMaterial)).not.toThrow();
      const review = evaluateRoleDomainReviews(fixture.releaseGate.reviewGate);
      expect(review.eligible).toBe(false);
      expect(review.reasons).toContain("CANONICAL_RELEASE_SEMANTICS_BLOCK_REVIEW");
      const release = evaluateReleaseDecision(fixture.releaseGate);
      expect(release.eligible).toBe(false);
      expect(release.reasons).toContain("CANONICAL_RELEASE_SEMANTICS_BLOCK_RELEASE");
      expect(evaluateStudentCurrentReleaseEligibility(fixture.eligibility).eligible).toBe(false);
    }

    const contradictory = jsonClone(syntheticCanonicalInputSeed()) as unknown as {
      inputs: Array<{ kind: string; payload: Record<string, unknown> }>;
    };
    contradictory.inputs.find((input) => input.kind === "RIGHTS_DECISION_SET")!.payload = {
      decision: "DENY",
      decidedAt: "2026-08-09T23:00:00.000Z",
      reason: "Denied, despite caller-added allow fields.",
      studentDisplay: "ALLOW",
      preview: "ALLOW",
    };
    expect(() => createCanonicalInputBundle(contradictory)).toThrow();
  });

  it("binds the complete claim type and exact current non-superseded review set", () => {
    const fixture = syntheticGovernanceFixture({ slug: "claim-review-binding" });
    const retyped = jsonClone(fixture.sourceMaterial);
    retyped.compiledTruth.claims[0]!.claimType = "TEACHING_INFERENCE";
    rehashTruth(retyped.compiledTruth);
    expect(() => deriveVerifiedWikiMaterial(retyped))
      .toThrow(/COMPILED_TRUTH_CLAIMS_NOT_EXACTLY_DERIVED/);

    const foreignReview = jsonClone(fixture.sourceMaterial);
    foreignReview.compiledTruth.claims[0]!.reviewDecisionIds = ["domain-review:foreign-current-looking"];
    rehashTruth(foreignReview.compiledTruth);
    const fullyReboundGate = rebindGateToTruth(fixture, foreignReview);
    const result = evaluateReleaseDecision(fullyReboundGate);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("COMPILED_TRUTH_CLAIM_REVIEW_SET_MISMATCH");
  });

  it("derives reviewed links from exact endpoint drafts/current curation decisions and rejects graph cycles", () => {
    const pageA = syntheticGovernanceFixture({ slug: "link-a", linkToSlugs: ["link-b"] });
    const pageB = syntheticGovernanceFixture({ slug: "link-b", linkToSlugs: ["link-c"] });
    const pageC = syntheticGovernanceFixture({ slug: "link-c", linkToSlugs: ["link-a"] });
    const sources = [pageA, pageB, pageC].map((fixture) => ({
      sourceMaterial: fixture.sourceMaterial,
      reviewGate: fixture.releaseGate.reviewGate,
      visibility: "ELIGIBLE" as const,
    }));
    const linkAB = syntheticReviewedLink(pageA, pageB);
    const externalEvidence = jsonClone(linkAB);
    externalEvidence.evidenceRefs = ["source:foreign-external"];
    const reboundExternal = rebindReviewedLink(externalEvidence as typeof linkAB);
    expect(() => createP1SeedIndex({
      sources,
      links: [reboundExternal],
      createdAt: "2026-08-10T04:00:00.000Z",
    })).toThrow(/REVIEWED_LINK_NOT_DERIVED_FROM_ENDPOINT_DRAFT/);

    const unapproved = jsonClone(linkAB);
    unapproved.approvalReviewDecisionIds = ["domain-review:foreign-curation"];
    const reboundUnapproved = rebindReviewedLink(unapproved as typeof linkAB);
    expect(() => createP1SeedIndex({
      sources,
      links: [reboundUnapproved],
      createdAt: "2026-08-10T04:00:00.000Z",
    })).toThrow(/REVIEWED_LINK_APPROVAL_NOT_CURRENT_CURATION_SET/);

    expect(() => createP1SeedIndex({
      sources,
      links: [
        linkAB,
        syntheticReviewedLink(pageB, pageC),
        syntheticReviewedLink(pageC, pageA),
      ],
      createdAt: "2026-08-10T04:00:00.000Z",
    })).toThrow(/CYCLIC_REVIEWED_LINK_GRAPH/);
  });

  it("rejects free compilation terms and fully rehashed fake title/FTS/alias/facet source material", () => {
    const fixture = syntheticGovernanceFixture({ slug: "canonical-terms", aliases: ["exact-alias"] });
    expect(() => compileWikiPageDraft(fixture.bundle, {
      ...syntheticWikiDraftSeed(),
      title: "Caller title",
      aliases: ["caller-alias"],
      facets: ["caller-facet"],
    })).toThrow();

    for (const mutate of [
      (source: DeepMutable<typeof fixture.sourceMaterial>) => { source.compiledTruth.title = "Fake title"; },
      (source: DeepMutable<typeof fixture.sourceMaterial>) => { source.compiledTruth.aliases = ["fake-alias"]; },
      (source: DeepMutable<typeof fixture.sourceMaterial>) => { source.compiledTruth.facets = ["fake-facet"]; },
      (source: DeepMutable<typeof fixture.sourceMaterial>) => { source.compiledTruth.claims[0]!.text = "fake fts text"; },
    ]) {
      const sourceMaterial = jsonClone(fixture.sourceMaterial);
      mutate(sourceMaterial);
      rehashTruth(sourceMaterial.compiledTruth);
      expect(() => createP1SeedIndex({
        sources: [{
          sourceMaterial,
          reviewGate: fixture.releaseGate.reviewGate,
          visibility: "ELIGIBLE",
        }],
        links: [],
        createdAt: "2026-08-10T04:00:00.000Z",
      })).toThrow();
    }
  });

  it("rejects course authority/body/concept relabeling as non-course inspiration provenance", () => {
    const courseSourceSeed = jsonClone(syntheticCanonicalInputSeed({ slug: "course-source-counterfeit" })) as unknown as {
      inputs: Array<{ kind: string; payload: Record<string, unknown> }>;
      courseConceptRefs: Array<Record<string, unknown>>;
    };
    courseSourceSeed.inputs.find((input) => input.kind === "SOURCE_VERSION")!.payload = {
      sourceAuthority: "COURSE_KNOWLEDGE_V2",
      capturedAt: "2026-08-09T23:00:00.000Z",
      concept: courseSourceSeed.courseConceptRefs[0],
    };
    const courseSourceBundle = createCanonicalInputBundle(courseSourceSeed);
    expect(() => compileWikiPageDraft(courseSourceBundle, syntheticWikiDraftSeed()))
      .toThrow(/CLAIM_SUPPORT_NOT_NON_COURSE_PROVENANCE/);

    const copiedBodySeed = jsonClone(syntheticCanonicalInputSeed({ slug: "course-body-counterfeit" })) as unknown as {
      inputs: Array<{ kind: string; payload: Record<string, unknown> }>;
    };
    copiedBodySeed.inputs.find((input) => input.kind === "SOURCE_VERSION")!.payload.courseBody =
      "Copied Knowledge V2 explanatory body.";
    expect(() => createCanonicalInputBundle(copiedBodySeed)).toThrow();

    const conceptSupportSeed = jsonClone(syntheticCanonicalInputSeed({ slug: "course-concept-counterfeit" })) as unknown as {
      inputs: Array<{ kind: string; payload: { claims?: Array<{ supportObjectIds: string[] }> } }>;
      courseConceptRefs: Array<{ conceptId: string }>;
    };
    conceptSupportSeed.inputs.find((input) => input.kind === "ANALYSIS_REVISION")!.payload.claims![0]!.supportObjectIds = [
      conceptSupportSeed.courseConceptRefs[0]!.conceptId,
      "analysis:course-concept-counterfeit",
    ];
    const conceptSupportBundle = createCanonicalInputBundle(conceptSupportSeed);
    expect(() => compileWikiPageDraft(conceptSupportBundle, syntheticWikiDraftSeed()))
      .toThrow(/CLAIM_SUPPORT_NOT_NON_COURSE_PROVENANCE|COURSE_CONCEPT/);
  });

  it("enforces draft/receipt/review/truth/release chronology after all affected hashes are rebound", () => {
    const fixture = syntheticGovernanceFixture({ slug: "semantic-chronology" });
    const earlyReviews = fixture.releaseGate.reviewGate.reviews.map((review, index) => {
      if (index !== 0) return review;
      const material = {
        ...withoutKeys(review, ["decisionRevision"]),
        decidedAt: "2026-08-09T23:30:00.000Z",
      };
      return {
        ...material,
        decisionRevision: bindWikiRevision(`${review.decisionId}:early-revision`, material),
      } as typeof review;
    });
    const earlyReviewResult = evaluateRoleDomainReviews({
      ...fixture.releaseGate.reviewGate,
      reviews: earlyReviews,
    });
    expect(earlyReviewResult.eligible).toBe(false);
    expect(earlyReviewResult.reasons).toContain("CURATION_DECISION_BEFORE_DRAFT_MATERIAL_READY");

    const earlyTruth = jsonClone(fixture.sourceMaterial);
    earlyTruth.compiledTruth.compiledAt = "2026-08-10T00:30:00.000Z";
    rehashTruth(earlyTruth.compiledTruth);
    const reboundEarlyTruth = rebindGateToTruth(fixture, earlyTruth);
    const earlyTruthResult = evaluateReleaseDecision(reboundEarlyTruth);
    expect(earlyTruthResult.eligible).toBe(false);
    expect(earlyTruthResult.reasons).toContain("COMPILED_TRUTH_TIME_OUTSIDE_REVIEW_RELEASE_WINDOW");
  });

  it("rejects unknown, self, cycle, fork, cross-target release supersession and replayed superseded ALLOW", () => {
    const fixture = syntheticGovernanceFixture({ slug: "release-history" });
    const base = fixture.releaseGate.decision;
    const laterHold = nextReleaseDecision(base, {
      decisionId: "release-decision:later-hold",
      decision: "REVIEW_HOLD",
      decidedAt: "2026-08-10T02:30:00.000Z",
      supersedesDecisionId: base.decisionId,
    });
    const replayed = evaluateReleaseDecision({
      ...fixture.releaseGate,
      releaseDecisionHistory: [base, laterHold],
    });
    expect(replayed.eligible).toBe(false);
    expect(replayed.reasons).toContain("RELEASE_DECISION_NOT_CURRENT_HISTORY_HEAD");

    const unknown = nextReleaseDecision(base, {
      decisionId: "release-decision:unknown-parent",
      decidedAt: "2026-08-10T02:30:00.000Z",
      supersedesDecisionId: "release-decision:missing",
    });
    const unknownResult = evaluateReleaseDecision({
      ...fixture.releaseGate,
      decision: unknown,
      releaseDecisionHistory: [base, unknown],
      activationReceipt: syntheticActivationReceipt(unknown, fixture.releaseGate.current),
    });
    expect(unknownResult.reasons).toContain("RELEASE_SUPERSEDES_UNKNOWN_DECISION");

    const self = nextReleaseDecision(base, {
      decisionId: "release-decision:self-parent",
      decidedAt: "2026-08-10T02:30:00.000Z",
      supersedesDecisionId: "release-decision:self-parent",
    });
    const selfResult = evaluateReleaseDecision({
      ...fixture.releaseGate,
      decision: self,
      releaseDecisionHistory: [base, self],
      activationReceipt: syntheticActivationReceipt(self, fixture.releaseGate.current),
    });
    expect(selfResult.reasons).toContain("RELEASE_SUPERSEDES_SELF");

    const crossTarget = nextReleaseDecision(base, {
      decisionId: "release-decision:cross-target",
      pageId: "wiki-page:000000000000000000000000",
      decidedAt: "2026-08-10T02:30:00.000Z",
      supersedesDecisionId: base.decisionId,
    });
    const crossTargetResult = evaluateReleaseDecision({
      ...fixture.releaseGate,
      decision: crossTarget,
      releaseDecisionHistory: [base, crossTarget],
      activationReceipt: syntheticActivationReceipt(crossTarget, fixture.releaseGate.current),
    });
    expect(crossTargetResult.reasons).toContain("RELEASE_SUPERSESSION_CROSS_TARGET");

    const cycleA = nextReleaseDecision(base, {
      decisionId: "release-decision:cycle-a",
      decidedAt: "2026-08-10T02:20:00.000Z",
      supersedesDecisionId: "release-decision:cycle-b",
    });
    const cycleB = nextReleaseDecision(base, {
      decisionId: "release-decision:cycle-b",
      decidedAt: "2026-08-10T02:30:00.000Z",
      supersedesDecisionId: "release-decision:cycle-a",
    });
    const cycleResult = evaluateReleaseDecision({
      ...fixture.releaseGate,
      decision: cycleB,
      releaseDecisionHistory: [cycleA, cycleB],
      activationReceipt: syntheticActivationReceipt(cycleB, fixture.releaseGate.current),
    });
    expect(cycleResult.reasons).toContain("RELEASE_SUPERSESSION_CYCLE");

    const forkA = nextReleaseDecision(base, {
      decisionId: "release-decision:fork-a",
      decidedAt: "2026-08-10T02:20:00.000Z",
      supersedesDecisionId: base.decisionId,
    });
    const forkB = nextReleaseDecision(base, {
      decisionId: "release-decision:fork-b",
      decidedAt: "2026-08-10T02:30:00.000Z",
      supersedesDecisionId: base.decisionId,
    });
    const forkResult = evaluateReleaseDecision({
      ...fixture.releaseGate,
      decision: forkB,
      releaseDecisionHistory: [base, forkA, forkB],
      activationReceipt: syntheticActivationReceipt(forkB, fixture.releaseGate.current),
    });
    expect(forkResult.reasons).toContain("RELEASE_SUPERSESSION_FORK");
  });
});

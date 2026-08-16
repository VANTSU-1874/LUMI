import { describe, expect, it } from "vitest";

import {
  bindWikiRevision,
  canonicalInput,
  hashWikiValue,
  wikiPageIdForCase,
} from "@/lib/domain/inspiration-wiki/integrity";
import {
  createP1SeedIndex,
  createP1SeedQueryContract,
  runP1SeedQuery,
} from "@/lib/domain/inspiration-wiki/retrieval";
import type {
  P1CurrentAllowlistSnapshot,
  P1SeedIndex,
} from "@/lib/domain/inspiration-wiki/retrieval-contracts";
import {
  syntheticGovernanceFixture,
  syntheticTrustedP1CurrentAllowlistFixture,
} from "@/tests/fixtures/inspiration-wiki-s1";

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

function jsonClone<T>(value: T): DeepMutable<T> {
  return JSON.parse(JSON.stringify(value)) as DeepMutable<T>;
}

function withoutKey(value: Readonly<Record<string, unknown>>, key: string) {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key));
}

function onePageIndex(
  fixture: ReturnType<typeof syntheticGovernanceFixture>,
  reviewGate = fixture.releaseGate.reviewGate,
) {
  return createP1SeedIndex({
    sources: [{ sourceMaterial: fixture.sourceMaterial, reviewGate, visibility: "ELIGIBLE" }],
    links: [],
    createdAt: "2026-08-10T04:00:00.000Z",
  });
}

function queryInput(
  index: P1SeedIndex,
  currentAllowlist: P1CurrentAllowlistSnapshot,
  evaluatedAt = "2026-08-10T04:15:00.000Z",
  eligiblePageIds: readonly string[] = index.pages.map((page) => page.pageId),
) {
  return {
    query: "synthetic",
    eligiblePageIds,
    allowedPageTypes: ["INSPIRATION_CASE" as const],
    allowedLinkTypes: [],
    hopLimit: 1 as const,
    resultLimit: 10,
    evaluatedAt,
    evaluatedAtTrustBoundary: "UPSTREAM_TRUSTED_CLOCK_NOT_IMPLEMENTED_IN_S1" as const,
    expectedIndexRevision: index.indexRevision,
    currentAllowlist,
  };
}

function rebindSnapshot(snapshot: P1CurrentAllowlistSnapshot): P1CurrentAllowlistSnapshot {
  const rebound = jsonClone(snapshot);
  rebound.authority.receipt = bindWikiRevision(rebound.authority.receipt.revisionId, {
    source: rebound.authority.source,
    trustBoundary: rebound.authority.trustBoundary,
    indexRevision: rebound.indexRevision,
    asOf: rebound.asOf,
    validUntil: rebound.validUntil,
    entries: rebound.entries,
  });
  rebound.snapshotRevision = bindWikiRevision(
    rebound.snapshotRevision.revisionId,
    withoutKey(rebound as unknown as Record<string, unknown>, "snapshotRevision"),
  );
  return rebound;
}

function fullyRebindIndexWithReviewAfterTruth(index: P1SeedIndex): P1SeedIndex {
  const rebound = jsonClone(index);
  const source = rebound.sources[0]!;
  const review = source.reviewGate.reviews.find((candidate) => candidate.reviewDomain === "CURATION")!;
  review.decidedAt = "2026-08-10T01:45:00.000Z";
  review.decisionRevision = bindWikiRevision(
    review.decisionRevision.revisionId,
    withoutKey(review as unknown as Record<string, unknown>, "decisionRevision"),
  );
  const acceptedBindings = source.reviewGate.reviews.map((candidate) => ({
    decisionId: candidate.decisionId,
    decisionRevision: candidate.decisionRevision,
  })).sort((left, right) => left.decisionId.localeCompare(right.decisionId));
  const page = rebound.pages[0]!;
  page.acceptedReviewDecisionSetHash = hashWikiValue(acceptedBindings);
  const candidate = canonicalInput(source.sourceMaterial.canonicalInputBundle, "CANDIDATE_REVISION");
  const analysis = canonicalInput(source.sourceMaterial.canonicalInputBundle, "ANALYSIS_REVISION");
  page.termSourceDigest = hashWikiValue({
    candidate,
    analysis,
    pageRevision: page.revision,
    compilationReceipt: page.compilationReceipt,
    compiledTruthHash: page.compiledTruthHash,
    rightsDecisionSetRevision: page.rightsDecisionSetRevision,
    withdrawalSnapshotRevision: page.withdrawalSnapshotRevision,
    acceptedReviewDecisionSetHash: page.acceptedReviewDecisionSetHash,
    authorizationCheckedAt: page.authorizationCheckedAt,
  });
  page.termProjectionReceipt = bindWikiRevision(
    page.termProjectionReceipt.revisionId,
    withoutKey(page as unknown as Record<string, unknown>, "termProjectionReceipt"),
  );
  rebound.buildReceipt.pageSetHash = hashWikiValue(rebound.pages);
  rebound.buildReceipt.receipt = bindWikiRevision(
    rebound.buildReceipt.receipt.revisionId,
    withoutKey(rebound.buildReceipt as unknown as Record<string, unknown>, "receipt"),
  );
  rebound.indexRevision = bindWikiRevision(
    rebound.indexRevision.revisionId,
    withoutKey(rebound as unknown as Record<string, unknown>, "indexRevision"),
  );
  return rebound;
}

describe("LLM Wiki S1 P1 review chronology and currentness boundary", () => {
  it("rejects fully rehashed truth compiled before its exact accepted reviews in create and query paths", () => {
    const fixture = syntheticGovernanceFixture({ slug: "p1-review-chronology" });
    const earlyTruthSource = jsonClone(fixture.sourceMaterial);
    earlyTruthSource.compiledTruth.compiledAt = "2026-08-10T00:30:00.000Z";
    earlyTruthSource.compiledTruth.contentHash = hashWikiValue(withoutKey(
      earlyTruthSource.compiledTruth as unknown as Record<string, unknown>,
      "contentHash",
    ));
    expect(() => createP1SeedIndex({
      sources: [{
        sourceMaterial: earlyTruthSource,
        reviewGate: fixture.releaseGate.reviewGate,
        visibility: "ELIGIBLE",
      }],
      links: [],
      createdAt: "2026-08-10T04:00:00.000Z",
    })).toThrow(/P1_TRUTH_REVIEW_BINDING_FAILED:.*COMPILED_TRUTH_BEFORE_ACCEPTED_REVIEWS/);

    const validIndex = onePageIndex(fixture);
    const fullyRehashedIndex = fullyRebindIndexWithReviewAfterTruth(validIndex);
    const allowlist = syntheticTrustedP1CurrentAllowlistFixture(fullyRehashedIndex);
    const contract = createP1SeedQueryContract(queryInput(fullyRehashedIndex, allowlist));
    expect(() => runP1SeedQuery(contract, fullyRehashedIndex))
      .toThrow(/P1_TRUTH_REVIEW_BINDING_FAILED:.*COMPILED_TRUTH_BEFORE_ACCEPTED_REVIEWS/);
  });

  it("requires a non-empty exact-index current allowlist and lets eligiblePageIds only narrow it", () => {
    const pageA = syntheticGovernanceFixture({ slug: "p1-allowlist-a" });
    const pageB = syntheticGovernanceFixture({ slug: "p1-allowlist-b" });
    const index = createP1SeedIndex({
      sources: [pageA, pageB].map((fixture) => ({
        sourceMaterial: fixture.sourceMaterial,
        reviewGate: fixture.releaseGate.reviewGate,
        visibility: "ELIGIBLE" as const,
      })),
      links: [],
      createdAt: "2026-08-10T04:00:00.000Z",
    });
    const pageAOnly = syntheticTrustedP1CurrentAllowlistFixture(index, {
      pageIds: [pageA.verified.pageId],
    });
    expect(() => createP1SeedQueryContract(queryInput(
      index,
      pageAOnly,
      "2026-08-10T04:15:00.000Z",
      [],
    ))).toThrow();
    expect(() => createP1SeedQueryContract(queryInput(
      index,
      pageAOnly,
      "2026-08-10T04:15:00.000Z",
      [pageB.verified.pageId],
    ))).toThrow(/QUERY_ELIGIBLE_PAGE_IDS_NOT_ALLOWLIST_SUBSET/);
    expect(() => createP1SeedQueryContract(queryInput(
      index,
      pageAOnly,
      "2026-08-10T04:15:00.000Z",
      [wikiPageIdForCase("inspiration-case:caller-injected")],
    ))).toThrow(/QUERY_ELIGIBLE_PAGE_IDS_NOT_ALLOWLIST_SUBSET/);

    const otherIndex = onePageIndex(syntheticGovernanceFixture({ slug: "p1-other-index" }));
    expect(() => createP1SeedQueryContract(queryInput(otherIndex, pageAOnly)))
      .toThrow(/QUERY_CURRENT_ALLOWLIST_INDEX_MISMATCH/);
  });

  it("fails closed for expired snapshots and fully rebound entry material mismatches", () => {
    const fixture = syntheticGovernanceFixture({ slug: "p1-allowlist-stale" });
    const index = onePageIndex(fixture);
    const expired = syntheticTrustedP1CurrentAllowlistFixture(index, {
      validUntil: "2026-08-10T04:10:00.000Z",
    });
    expect(() => createP1SeedQueryContract(queryInput(index, expired)))
      .toThrow(/P1_CURRENT_ALLOWLIST_EXPIRED/);

    const original = syntheticTrustedP1CurrentAllowlistFixture(index);
    const staleAuthority = jsonClone(original);
    staleAuthority.entries[0]!.compiledTruthHash = `sha256:${"0".repeat(64)}`;
    staleAuthority.snapshotRevision = bindWikiRevision(
      staleAuthority.snapshotRevision.revisionId,
      withoutKey(staleAuthority as unknown as Record<string, unknown>, "snapshotRevision"),
    );
    expect(() => createP1SeedQueryContract(queryInput(index, staleAuthority)))
      .toThrow(/STALE_P1_CURRENT_ALLOWLIST_AUTHORITY_RECEIPT/);

    const mismatched = jsonClone(original);
    mismatched.entries[0]!.compiledTruthHash = `sha256:${"0".repeat(64)}`;
    const reboundMismatch = rebindSnapshot(mismatched);
    const contract = createP1SeedQueryContract(queryInput(index, reboundMismatch));
    expect(() => runP1SeedQuery(contract, index))
      .toThrow(/P1_CURRENT_ALLOWLIST_ENTRY_MATERIAL_MISMATCH/);
  });

  it("rechecks canonical rights and reviewer authorization at query time after a valid index build", () => {
    const rightsFixture = syntheticGovernanceFixture({
      slug: "p1-rights-expire",
      rightsValidUntil: "2026-08-10T04:30:00.000Z",
    });
    const rightsIndex = onePageIndex(rightsFixture);
    const rightsAllowlist = syntheticTrustedP1CurrentAllowlistFixture(rightsIndex, {
      validUntil: "2026-08-10T05:00:00.000Z",
    });
    const rightsContract = createP1SeedQueryContract(queryInput(
      rightsIndex,
      rightsAllowlist,
      "2026-08-10T04:45:00.000Z",
    ));
    expect(() => runP1SeedQuery(rightsContract, rightsIndex))
      .toThrow(/P1_TRUTH_REVIEW_BINDING_FAILED/);

    const reviewerFixture = syntheticGovernanceFixture({ slug: "p1-reviewer-expire" });
    const expiringReviewGate = {
      ...reviewerFixture.releaseGate.reviewGate,
      assignments: reviewerFixture.releaseGate.reviewGate.assignments.map((assignment) => (
        assignment.assignmentId === "role-assignment:curation"
          ? { ...assignment, validUntil: "2026-08-10T04:30:00.000Z" }
          : assignment
      )),
    };
    const reviewerIndex = onePageIndex(reviewerFixture, expiringReviewGate);
    const reviewerAllowlist = syntheticTrustedP1CurrentAllowlistFixture(reviewerIndex, {
      validUntil: "2026-08-10T05:00:00.000Z",
    });
    const reviewerContract = createP1SeedQueryContract(queryInput(
      reviewerIndex,
      reviewerAllowlist,
      "2026-08-10T04:45:00.000Z",
    ));
    expect(() => runP1SeedQuery(reviewerContract, reviewerIndex))
      .toThrow(/P1_TRUTH_REVIEW_BINDING_FAILED/);
  });

  it("copies before freezing the caller-owned current allowlist input", () => {
    const index = onePageIndex(syntheticGovernanceFixture({ slug: "p1-allowlist-immutable" }));
    const callerOwned = jsonClone(syntheticTrustedP1CurrentAllowlistFixture(index));
    const originalPageId = callerOwned.entries[0]!.pageId;
    const contract = createP1SeedQueryContract(queryInput(index, callerOwned));
    expect(Object.isFrozen(callerOwned)).toBe(false);
    expect(Object.isFrozen(callerOwned.entries)).toBe(false);
    callerOwned.entries[0]!.pageId = wikiPageIdForCase("inspiration-case:caller-mutated-after-create");
    expect(contract.currentAllowlist.entries[0]!.pageId).toBe(originalPageId);
    expect(contract.currentnessContract).toBe("UPSTREAM_SNAPSHOT_REQUIRED_QUERY_ONLY_NARROWS");
    expect(contract.currentAllowlist.authority.trustBoundary)
      .toBe("D18_PERSISTED_CURRENTNESS_NOT_IMPLEMENTED_IN_S1");
  });
});

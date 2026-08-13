import { describe, expect, it } from "vitest";

import {
  evaluateReleaseDecision,
  evaluateRoleDomainReviews,
  evaluateStudentCurrentReleaseEligibility,
} from "@/lib/domain/inspiration-wiki/governance";
import {
  bindWikiRevision,
  compileWikiPageDraft,
  deriveVerifiedWikiMaterial,
  hashWikiValue,
  parseImmutableWikiDraftCompilation,
  reviseWikiPageDraft,
} from "@/lib/domain/inspiration-wiki/integrity";
import { parseImmutableP1SeedIndex, createP1SeedIndex } from "@/lib/domain/inspiration-wiki/retrieval";
import {
  syntheticActivationReceipt,
  syntheticGovernanceFixture,
  syntheticWikiDraftSeed,
  syntheticWikiMaterial,
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

function rebindIndexAfterPageTamper(
  rawIndex: ReturnType<typeof createP1SeedIndex>,
  mutate: (page: Record<string, unknown>) => void,
) {
  const index = jsonClone(rawIndex) as unknown as Record<string, unknown> & {
    pages: Array<Record<string, unknown> & { termProjectionReceipt: { revisionId: string } }>;
    buildReceipt: Record<string, unknown> & { receipt: { revisionId: string } };
    indexRevision: { revisionId: string };
  };
  const page = index.pages[0]!;
  mutate(page);
  page.termProjectionReceipt = bindWikiRevision(
    page.termProjectionReceipt.revisionId,
    withoutKey(page, "termProjectionReceipt"),
  );
  index.buildReceipt.pageSetHash = hashWikiValue(index.pages);
  index.buildReceipt.receipt = bindWikiRevision(
    index.buildReceipt.receipt.revisionId,
    withoutKey(index.buildReceipt, "receipt"),
  );
  index.indexRevision = bindWikiRevision(
    index.indexRevision.revisionId,
    withoutKey(index, "indexRevision"),
  );
  return index;
}

describe("LLM Wiki S1 verified material derivation", () => {
  it("rejects cross-object bundle/truth splices and foreign page/candidate rebindings", () => {
    const sourceA = syntheticWikiMaterial({ slug: "material-a", aliases: ["alpha"] });
    const sourceB = syntheticWikiMaterial({ slug: "material-b", aliases: ["beta"] });
    expect(() => deriveVerifiedWikiMaterial({
      canonicalInputBundle: sourceA.bundle,
      compilation: sourceA.compilation,
      compiledTruth: sourceB.truth,
    })).toThrow(/COMPILED_TRUTH_SOURCE_MATERIAL_MISMATCH/);

    const fixtureA = syntheticGovernanceFixture({ slug: "release-material-a", aliases: ["alpha"] });
    const fixtureB = syntheticGovernanceFixture({ slug: "release-material-b", aliases: ["beta"] });
    const reboundSeed = {
      ...fixtureA.releaseGate.current,
      pageId: fixtureB.verified.pageId,
      candidateRevision: fixtureB.verified.candidateRevision,
      pageDraftRevision: fixtureB.verified.pageDraftRevision,
      pageRevision: fixtureB.verified.pageRevision,
    };
    const reboundMaterial = withoutKey(reboundSeed, "release");
    const reboundRelease = bindWikiRevision(
      `wiki-release:${hashWikiValue(reboundMaterial).slice(7, 31)}`,
      reboundMaterial,
    );
    const current = { ...reboundSeed, release: reboundRelease };
    const decision = {
      ...fixtureA.releaseGate.decision,
      pageId: current.pageId,
      candidateRevision: current.candidateRevision,
      pageDraftRevision: current.pageDraftRevision,
      pageRevision: current.pageRevision,
      release: reboundRelease,
    };
    const reboundGate = {
      ...fixtureA.releaseGate,
      current,
      decision,
      activationReceipt: syntheticActivationReceipt(decision, current),
    };
    const releaseResult = evaluateReleaseDecision(reboundGate);
    expect(releaseResult.eligible).toBe(false);
    expect(releaseResult.reasons).toContain("RELEASE_SOURCE_MATERIAL_NOT_DERIVED");

    const roleResult = evaluateRoleDomainReviews({
      ...fixtureA.releaseGate.reviewGate,
      draftMaterial: fixtureB.draftMaterial,
    });
    expect(roleResult.eligible).toBe(false);
    expect(roleResult.reasons).toContain("CURRENT_REVIEW_TARGET_NOT_DERIVED_FROM_DRAFT_MATERIAL");

    const studentResult = evaluateStudentCurrentReleaseEligibility({
      ...fixtureA.eligibility,
      page: {
        ...fixtureA.eligibility.page,
        publicId: `inspiration:${hashWikiValue({ pageId: fixtureB.verified.pageId }).slice(7, 31)}`,
        pageId: fixtureB.verified.pageId,
        pageRevision: fixtureB.verified.pageRevision,
        compiledTruthHash: fixtureB.verified.compiledTruthHash,
      },
    });
    expect(studentResult.eligible).toBe(false);
    expect(studentResult.reasons).toContain("PAGE_RELEASE_BINDING_MISMATCH");
  });

  it("binds complete source, policy, release, receipt, and derived P1 term material", () => {
    const wiki = syntheticWikiMaterial({ slug: "digest-complete", aliases: ["digest-alias"] });
    const sourceTamperCases: Array<(source: DeepMutable<typeof wiki.sourceMaterial>) => void> = [
      (source) => { source.canonicalInputBundle.ledger.ledgerHash = `sha256:${"0".repeat(64)}`; },
      (source) => { source.compilation.pageRevision.reviewState = "APPROVED_FOR_RELEASE"; },
      (source) => { source.compilation.timelineEntries[0]!.recordedAt = "2026-08-10T01:30:00.000Z"; },
      (source) => { source.compilation.linkDecisionDrafts[0]!.reason = "Tampered reviewed-link precursor."; },
      (source) => { source.compiledTruth.title = "Tampered truth title"; },
    ];
    for (const tamper of sourceTamperCases) {
      const source = jsonClone(wiki.sourceMaterial);
      tamper(source);
      expect(() => deriveVerifiedWikiMaterial(source)).toThrow();
    }
    const reboundReviewState = jsonClone(wiki.sourceMaterial);
    reboundReviewState.compilation.pageRevision.reviewState = "APPROVED_FOR_RELEASE";
    reboundReviewState.compilation.pageRevision.revision = bindWikiRevision(
      reboundReviewState.compilation.pageRevision.revision.revisionId,
      withoutKey(reboundReviewState.compilation.pageRevision, "revision"),
    );
    expect(() => deriveVerifiedWikiMaterial(reboundReviewState))
      .toThrow(/COMPILATION_NOT_UNIQUELY_DERIVED/);

    const fixture = syntheticGovernanceFixture({ slug: "policy-digest" });
    const substitutedAudiencePolicy = {
      ...fixture.audiencePolicy,
      policyId: "audience-policy:substituted-same-version",
    };
    const audienceResult = evaluateReleaseDecision({
      ...fixture.releaseGate,
      audiencePolicy: substitutedAudiencePolicy,
    });
    expect(audienceResult.eligible).toBe(false);
    expect(audienceResult.reasons).toContain("STALE_AUDIENCE_POLICY_DOCUMENT");

    const releaseTamper = evaluateReleaseDecision({
      ...fixture.releaseGate,
      current: {
        ...fixture.releaseGate.current,
        rightsDecisionSetHash: `sha256:${"0".repeat(64)}`,
      },
    });
    expect(releaseTamper.eligible).toBe(false);
    expect(releaseTamper.reasons).toContain("RELEASE_SOURCE_MATERIAL_NOT_DERIVED");

    const index = createP1SeedIndex({
      sources: [{
        sourceMaterial: wiki.sourceMaterial,
        reviewGate: wiki.releaseGate.reviewGate,
        visibility: "ELIGIBLE",
      }],
      links: [],
      createdAt: "2026-08-10T04:00:00.000Z",
    });
    const termTamperCases: Array<(page: Record<string, unknown>) => void> = [
      (page) => { page.title = "Caller supplied title"; },
      (page) => { page.ftsTerms = ["caller-term"]; },
      (page) => { page.aliases = ["caller-alias"]; },
      (page) => { page.facets = ["caller-facet"]; },
    ];
    for (const tamper of termTamperCases) {
      const reboundIndex = rebindIndexAfterPageTamper(index, tamper);
      expect(() => parseImmutableP1SeedIndex(reboundIndex))
        .toThrow(/P1_TERMS_NOT_DERIVED_FROM_EXACT_SOURCE_MATERIAL/);
    }
  });

  it("rejects rehashed course-derived claim counterfeits on every inspiration case", () => {
    const wiki = syntheticWikiMaterial({ slug: "non-course-provenance" });
    const copiedBody = jsonClone(wiki.sourceMaterial);
    copiedBody.compiledTruth.claims[0]!.text = "Copied Course Knowledge V2 explanatory body.";
    copiedBody.compiledTruth.contentHash = hashWikiValue(withoutKey(copiedBody.compiledTruth, "contentHash"));
    expect(() => deriveVerifiedWikiMaterial(copiedBody))
      .toThrow(/COMPILED_TRUTH_CLAIMS_NOT_EXACTLY_DERIVED/);

    const conceptCounterfeit = jsonClone(wiki.sourceMaterial);
    conceptCounterfeit.compiledTruth.claims[0]!.supportObjectIds = [
      conceptCounterfeit.compiledTruth.courseConceptRefs[0]!.conceptId,
    ];
    conceptCounterfeit.compiledTruth.contentHash = hashWikiValue(
      withoutKey(conceptCounterfeit.compiledTruth, "contentHash"),
    );
    expect(() => deriveVerifiedWikiMaterial(conceptCounterfeit)).toThrow(/Course Knowledge concepts as support/);

    const seed = syntheticWikiDraftSeed();
    expect(() => compileWikiPageDraft(wiki.bundle, {
      ...seed,
      claims: [{
        claimId: "wiki-claim:caller-injected",
        text: "Caller-pasted course body without matching non-course material.",
      }],
    })).toThrow();
  });

  it("enforces timeline and Page revision chronology, including caller-rebound timestamps", () => {
    const wiki = syntheticWikiMaterial({ slug: "chronology" });
    const seed = syntheticWikiDraftSeed();
    expect(() => compileWikiPageDraft(wiki.bundle, {
      ...seed,
      occurredAt: "2026-08-10T02:00:00.000Z",
      recordedAt: "2026-08-10T01:00:00.000Z",
    })).toThrow(/TIMELINE_RECORDED_BEFORE_OCCURRED/);

    const earlyPageRevision = jsonClone(wiki.compilation);
    earlyPageRevision.pageRevision.createdAt = "2026-08-10T00:59:59.000Z";
    earlyPageRevision.pageRevision.revision = bindWikiRevision(
      earlyPageRevision.pageRevision.revision.revisionId,
      withoutKey(earlyPageRevision.pageRevision, "revision"),
    );
    expect(() => parseImmutableWikiDraftCompilation(earlyPageRevision, wiki.bundle))
      .toThrow(/COMPILATION_NOT_UNIQUELY_DERIVED/);

    expect(() => reviseWikiPageDraft(
      wiki.compilation,
      { createdAt: wiki.compilation.pageDraft.createdAt },
      wiki.compilation.pageDraft.revision,
      wiki.bundle,
    )).toThrow(/PAGE_DRAFT_REVISION_TIME_NOT_MONOTONIC/);
  });
});

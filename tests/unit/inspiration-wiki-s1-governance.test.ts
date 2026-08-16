import { describe, expect, it } from "vitest";

import {
  evaluateReleaseDecision,
  evaluateRoleDomainReviews,
  evaluateStudentCurrentReleaseEligibility,
  revokeReviewerAssignments,
} from "@/lib/domain/inspiration-wiki/governance";
import { bindWikiRevision, hashWikiValue } from "@/lib/domain/inspiration-wiki/integrity";
import {
  syntheticActivationReceipt,
  syntheticGovernanceFixture,
  rebindSyntheticReleaseDecision,
} from "@/tests/fixtures/inspiration-wiki-s1";

const ZERO_HASH = `sha256:${"0".repeat(64)}`;

describe("LLM Wiki S1 role-domain and release gates", () => {
  it("accepts the synthetic exact-hash, separated-role, two-person review chain", () => {
    const { releaseGate, eligibility } = syntheticGovernanceFixture();
    expect(evaluateRoleDomainReviews(releaseGate.reviewGate)).toMatchObject({ eligible: true, reasons: [] });
    expect(evaluateReleaseDecision(releaseGate)).toMatchObject({ eligible: true, reasons: [] });
    expect(evaluateStudentCurrentReleaseEligibility(eligibility)).toMatchObject({ eligible: true, reasons: [] });
  });

  it("fails closed on stale canonical/draft hashes and the wrong reviewer role", () => {
    const { releaseGate } = syntheticGovernanceFixture();
    const staleReviews = releaseGate.reviewGate.reviews.map((review, index) => index === 0 ? {
      ...review,
      target: { ...review.target, compiledPreviewHash: ZERO_HASH },
    } : review);
    const stale = evaluateRoleDomainReviews({ ...releaseGate.reviewGate, reviews: staleReviews });
    expect(stale.eligible).toBe(false);
    expect(stale.reasons).toContain("CURATION_STALE_TARGET_HASH");

    const wrongRoleAssignments = releaseGate.reviewGate.assignments.map((assignment) => (
      assignment.assignmentId === "role-assignment:curation"
        ? { ...assignment, role: "TEACHING_REVIEWER" }
        : assignment
    ));
    const wrongRole = evaluateRoleDomainReviews({
      ...releaseGate.reviewGate,
      assignments: wrongRoleAssignments,
    });
    expect(wrongRole.eligible).toBe(false);
    expect(wrongRole.reasons).toContain("CURATION_ROLE_NOT_CURRENTLY_ELIGIBLE");
  });

  it("rejects forbidden self-review, a missing second review, and same-person double signing", () => {
    const { releaseGate } = syntheticGovernanceFixture();
    const selfReview = evaluateRoleDomainReviews({
      ...releaseGate.reviewGate,
      proposerOrEditorActorIds: ["actor:editor", "actor:curator"],
    });
    expect(selfReview.eligible).toBe(false);
    expect(selfReview.reasons).toContain("CURATION_SELF_REVIEW_FORBIDDEN");
    expect(evaluateRoleDomainReviews({
      ...releaseGate.reviewGate,
      proposerOrEditorActorIds: [],
    })).toMatchObject({ eligible: false, reasons: ["INVALID_ROLE_DOMAIN_REVIEW_INPUT"] });

    const missingSecond = evaluateRoleDomainReviews({
      ...releaseGate.reviewGate,
      reviews: releaseGate.reviewGate.reviews.filter((review) => review.decisionId !== "domain-review:rights-b"),
    });
    expect(missingSecond.eligible).toBe(false);
    expect(missingSecond.reasons).toContain("RIGHTS_SECOND_REVIEW_MISSING");

    const duplicateActorAssignments = releaseGate.reviewGate.assignments.map((assignment) => (
      assignment.assignmentId === "role-assignment:rights-b"
        ? { ...assignment, actorId: "actor:rights-a" }
        : assignment
    ));
    const duplicateActorReviews = releaseGate.reviewGate.reviews.map((review) => (
      review.decisionId === "domain-review:rights-b"
        ? { ...review, actorId: "actor:rights-a" }
        : review
    ));
    const duplicateActor = evaluateRoleDomainReviews({
      ...releaseGate.reviewGate,
      assignments: duplicateActorAssignments,
      reviews: duplicateActorReviews,
    });
    expect(duplicateActor.eligible).toBe(false);
    expect(duplicateActor.reasons).toContain("RIGHTS_REVIEWERS_NOT_UNIQUE");
  });

  it("does not let a later teacher scope authorize an earlier review", () => {
    const { releaseGate } = syntheticGovernanceFixture();
    const reviews = releaseGate.reviewGate.reviews.map((review) => review.decisionId === "domain-review:curation"
      ? { ...review, decidedAt: "2026-08-10T00:00:00.000Z" }
      : review);
    const assignments = releaseGate.reviewGate.assignments.map((assignment) => (
      assignment.assignmentId === "role-assignment:curation"
        ? { ...assignment, validFrom: "2026-08-10T00:30:00.000Z" }
        : assignment
    ));
    const result = evaluateRoleDomainReviews({
      ...releaseGate.reviewGate,
      assignments,
      reviews,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("CURATION_ROLE_NOT_ELIGIBLE_AT_DECISION");
  });

  it("detects release activation races and stale release/page bindings", () => {
    const { releaseGate, eligibility } = syntheticGovernanceFixture();
    const racingRelease = bindWikiRevision("wiki-release:synthetic-v2", { changed: true });
    const race = evaluateReleaseDecision({
      ...releaseGate,
      current: { ...releaseGate.current, release: racingRelease },
    });
    expect(race.eligible).toBe(false);
    expect(race.reasons).toContain("RELEASE_BINDING_MISMATCH");

    const stalePointer = evaluateReleaseDecision({
      ...releaseGate,
      current: { ...releaseGate.current, isCurrent: false },
    });
    expect(stalePointer.eligible).toBe(false);
    expect(stalePointer.reasons).toContain("RELEASE_NOT_CURRENT");

    const pageMismatch = evaluateStudentCurrentReleaseEligibility({
      ...eligibility,
      page: { ...eligibility.page, release: racingRelease },
    });
    expect(pageMismatch.eligible).toBe(false);
    expect(pageMismatch.reasons).toContain("PAGE_RELEASE_BINDING_MISMATCH");

    const truthMismatch = evaluateStudentCurrentReleaseEligibility({
      ...eligibility,
      page: { ...eligibility.page, compiledTruthHash: ZERO_HASH },
    });
    expect(truthMismatch.eligible).toBe(false);
    expect(truthMismatch.reasons).toContain("PAGE_RELEASE_BINDING_MISMATCH");
  });

  it("verifies exact release and per-channel activation receipts", () => {
    const { releaseGate } = syntheticGovernanceFixture();
    const tamperedReceipts = releaseGate.activationReceipt.channelReceipts.map((receipt, index) => index === 0
      ? { ...receipt, state: "DISABLED" }
      : receipt);
    const tampered = evaluateReleaseDecision({
      ...releaseGate,
      activationReceipt: { ...releaseGate.activationReceipt, channelReceipts: tamperedReceipts },
    });
    expect(tampered.eligible).toBe(false);
    expect(tampered.reasons).toContain("RELEASE_OR_CHANNEL_RECEIPT_MISMATCH");

    const extraDomainDecision = evaluateReleaseDecision({
      ...releaseGate,
      decision: {
        ...releaseGate.decision,
        domainReviewDecisionIds: [
          ...releaseGate.decision.domainReviewDecisionIds,
          "domain-review:unbound-extra",
        ],
      },
    });
    expect(extraDomainDecision.eligible).toBe(false);
    expect(extraDomainDecision.reasons).toContain("RELEASE_DOMAIN_DECISION_SET_MISMATCH");
  });

  it("rechecks current reviewer assignments and holds eligibility after revocation", () => {
    const { releaseGate, eligibility } = syntheticGovernanceFixture();
    const assignments = revokeReviewerAssignments(releaseGate.reviewGate.assignments, "actor:rights-a");
    const revokedGate = {
      ...releaseGate,
      reviewGate: { ...releaseGate.reviewGate, assignments },
    };
    const release = evaluateReleaseDecision(revokedGate);
    expect(release.eligible).toBe(false);
    expect(release.reasons).toContain("RIGHTS_ROLE_NOT_CURRENTLY_ELIGIBLE");
    expect(evaluateStudentCurrentReleaseEligibility({ ...eligibility, releaseGate: revokedGate }).eligible).toBe(false);
  });

  it("keeps browse/search activation distinct from Wiki model-context activation", () => {
    const { releaseGate, eligibility } = syntheticGovernanceFixture();
    const channels = {
      BROWSE_RELEASE: "ACTIVE" as const,
      STUDENT_SEARCH: "ACTIVE" as const,
      WIKI_RETRIEVAL: "DISABLED" as const,
    };
    const { release: _priorRelease, ...currentMaterial } = { ...releaseGate.current, channelStates: channels };
    void _priorRelease;
    const release = bindWikiRevision(
      `wiki-release:${hashWikiValue(currentMaterial).slice(7, 31)}`,
      currentMaterial,
    );
    const { decisionRevision: _decisionRevision, ...decisionMaterial } = {
      ...releaseGate.decision,
      channelStates: channels,
      release,
    };
    void _decisionRevision;
    const decision = rebindSyntheticReleaseDecision(decisionMaterial);
    const current = { ...currentMaterial, release };
    const gatedRelease = {
      ...releaseGate,
      decision,
      releaseDecisionHistory: [decision],
      current,
      activationReceipt: syntheticActivationReceipt(decision, current),
    };
    expect(evaluateReleaseDecision(gatedRelease).eligible).toBe(true);
    expect(evaluateStudentCurrentReleaseEligibility({
      ...eligibility,
      accessKind: "BROWSE",
      page: { ...eligibility.page, release },
      releaseGate: gatedRelease,
    }).eligible).toBe(true);
    const context = evaluateStudentCurrentReleaseEligibility({
      ...eligibility,
      accessKind: "WIKI_CONTEXT",
      page: { ...eligibility.page, release },
      releaseGate: gatedRelease,
    });
    expect(context.eligible).toBe(false);
    expect(context.reasons).toContain("WIKI_RETRIEVAL_NOT_ACTIVE");
  });

  it("rejects a channel-state mismatch between decision and current release", () => {
    const { releaseGate } = syntheticGovernanceFixture();
    const mismatched = evaluateReleaseDecision({
      ...releaseGate,
      current: {
        ...releaseGate.current,
        channelStates: { ...releaseGate.current.channelStates, STUDENT_SEARCH: "DISABLED" },
      },
    });
    expect(mismatched.eligible).toBe(false);
    expect(mismatched.reasons).toContain("RELEASE_BINDING_MISMATCH");
  });
});

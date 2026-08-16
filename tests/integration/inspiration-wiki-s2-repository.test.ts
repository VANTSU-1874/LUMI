// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import type { RoleDomainReview } from "@/lib/domain/inspiration-wiki/governance-contracts";
import { bindWikiRevision } from "@/lib/domain/inspiration-wiki/integrity";
import {
  persistWikiS2Draft,
  persistWikiS2ReviewDecisionSet,
  revalidateWikiS2InternalCatalog,
  updateWikiS2ReviewerAssignmentStatus,
  WikiS2GateError,
} from "@/lib/services/inspiration-wiki-s2-repository";
import {
  ACTIVATION_AT,
  syntheticGovernanceFixture,
  syntheticReviewerAssignment,
  syntheticRoleDomainReview,
  type SyntheticMaterialOptions,
} from "@/tests/fixtures/inspiration-wiki-s1";

const roots: string[] = [];
const CANDIDATE_REVISION = 5;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(options: SyntheticMaterialOptions = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-wiki-s2-"));
  roots.push(root);
  const databasePath = path.join(root, "wiki-s2.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  const fixture = syntheticGovernanceFixture(options);
  seedCandidate(connection, fixture);
  return { connection, fixture, candidateId: fixture.draftMaterial.canonicalInputBundle.candidateId };
}

function seedCandidate(
  connection: DatabaseConnection,
  fixture: ReturnType<typeof syntheticGovernanceFixture>,
) {
  const candidateId = fixture.draftMaterial.canonicalInputBundle.candidateId;
  connection.sqlite.prepare(`
    INSERT INTO inspiration_sources(
      id, label, adapter_id, configuration_json, enabled, created_at, updated_at
    ) VALUES (?, 'S2 synthetic source', 'S2_LOCAL', '{"scope":"PRIVATE_CANDIDATE_ONLY"}', 0, ?, ?)
  `).run(`source:${candidateId}`, 1_786_291_200, 1_786_291_200);
  connection.sqlite.prepare(`
    INSERT INTO inspiration_candidates(
      id, source_id, state, revision, curation_json, asset_json, rights_json,
      analysis_json, review_package_json, withdrawal_status, content_hash,
      created_at, updated_at
    ) VALUES (?, ?, 'READY_FOR_TEACHER_REVIEW', ?, '{}', '{}', '{}', '{}', '{}',
      'CLEAR', NULL, ?, ?)
  `).run(candidateId, `source:${candidateId}`, CANDIDATE_REVISION, 1_786_291_200, 1_786_291_200);
}

function persistDraft(
  connection: DatabaseConnection,
  fixture: ReturnType<typeof syntheticGovernanceFixture>,
  overrides: {
    assignments?: readonly unknown[];
    proposerOrEditorActorIds?: readonly string[];
  } = {},
) {
  return persistWikiS2Draft(connection, {
    candidateId: fixture.draftMaterial.canonicalInputBundle.candidateId,
    candidateRevision: CANDIDATE_REVISION,
    draftMaterial: fixture.draftMaterial,
    riskScope: fixture.target.riskScope,
    policy: fixture.policy,
    assignments: overrides.assignments ?? fixture.releaseGate.reviewGate.assignments,
    proposerOrEditorActorIds: overrides.proposerOrEditorActorIds ?? ["actor:editor"],
    recordedAt: ACTIVATION_AT,
  });
}

function persistReviews(
  connection: DatabaseConnection,
  draftMaterialReceiptId: string,
  reviews: readonly unknown[],
) {
  return persistWikiS2ReviewDecisionSet(connection, {
    draftMaterialReceiptId,
    evaluatedAt: ACTIVATION_AT,
    activatedAt: ACTIVATION_AT,
    reviews,
  });
}

function expectGateReason(action: () => unknown, reason: string) {
  try {
    action();
    throw new Error(`Expected Wiki S2 gate reason: ${reason}`);
  } catch (error) {
    expect(error).toBeInstanceOf(WikiS2GateError);
    expect((error as WikiS2GateError).reasons).toContain(reason);
  }
}

function rebindReview(
  review: RoleDomainReview,
  overrides: Partial<Omit<RoleDomainReview, "decisionRevision">>,
  revisionId = review.decisionRevision.revisionId,
): RoleDomainReview {
  const material = { ...review, ...overrides };
  const withoutRevision = Object.fromEntries(
    Object.entries(material).filter(([key]) => key !== "decisionRevision"),
  ) as Omit<RoleDomainReview, "decisionRevision">;
  return {
    ...withoutRevision,
    decisionRevision: bindWikiRevision(revisionId, withoutRevision),
  };
}

function legacySnapshot(connection: DatabaseConnection, candidateId: string) {
  return {
    candidate: connection.sqlite.prepare(
      `SELECT state, revision, curation_json, asset_json, rights_json, analysis_json,
        review_package_json, withdrawal_status, updated_at
       FROM inspiration_candidates WHERE id = ?`,
    ).get(candidateId),
    reviewDecisions: connection.sqlite.prepare(
      "SELECT count(*) AS count FROM inspiration_review_decisions",
    ).get(),
    admissions: connection.sqlite.prepare(
      "SELECT count(*) AS count FROM inspiration_admissions",
    ).get(),
    analyses: connection.sqlite.prepare(
      "SELECT count(*) AS count FROM inspiration_candidate_analyses",
    ).get(),
    auditEvents: connection.sqlite.prepare(
      "SELECT count(*) AS count FROM inspiration_candidate_audit_events",
    ).get(),
  };
}

describe("Inspiration Wiki S2 local repository", () => {
  it("activates one immutable synthetic draft internally without touching the old admission path", async () => {
    const { connection, fixture, candidateId } = await setup();
    try {
      const before = legacySnapshot(connection, candidateId);
      const draft = persistDraft(connection, fixture);
      const activated = persistReviews(
        connection,
        draft.draftMaterialReceipt.revisionId,
        fixture.releaseGate.reviewGate.reviews,
      );

      expect(activated).toMatchObject({ state: "INTERNAL_CATALOG_ACTIVE", evaluation: { eligible: true } });
      expect(connection.sqlite.prepare(`
        SELECT state, hold_reason AS holdReason, student_visible AS studentVisible,
          browse_release AS browseRelease, student_search AS studentSearch,
          wiki_retrieval AS wikiRetrieval
        FROM inspiration_wiki_internal_catalog_entries
      `).get()).toEqual({
        state: "INTERNAL_CATALOG_ACTIVE",
        holdReason: null,
        studentVisible: 0,
        browseRelease: "DISABLED",
        studentSearch: "DISABLED",
        wikiRetrieval: "DISABLED",
      });
      expect(legacySnapshot(connection, candidateId)).toEqual(before);
    } finally {
      connection.sqlite.close();
    }
  });

  it("replays the exact draft and review set idempotently", async () => {
    const { connection, fixture } = await setup({ slug: "synthetic-s2-replay" });
    try {
      const firstDraft = persistDraft(connection, fixture);
      const secondDraft = persistDraft(connection, fixture);
      persistReviews(connection, firstDraft.draftMaterialReceipt.revisionId, fixture.releaseGate.reviewGate.reviews);
      persistReviews(connection, secondDraft.draftMaterialReceipt.revisionId, fixture.releaseGate.reviewGate.reviews);

      expect(connection.sqlite.prepare(`
        SELECT
          (SELECT count(*) FROM inspiration_wiki_role_policies) AS policies,
          (SELECT count(*) FROM inspiration_wiki_reviewer_assignments) AS assignments,
          (SELECT count(*) FROM inspiration_wiki_draft_revisions) AS drafts,
          (SELECT count(*) FROM inspiration_wiki_domain_review_decisions) AS decisions,
          (SELECT count(*) FROM inspiration_wiki_internal_catalog_entries) AS catalogEntries
      `).get()).toEqual({ policies: 1, assignments: 6, drafts: 1, decisions: 5, catalogEntries: 1 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("rejects a reviewer assignment with the wrong domain role", async () => {
    const { connection, fixture } = await setup({ slug: "synthetic-s2-wrong-role" });
    try {
      const assignments = fixture.releaseGate.reviewGate.assignments.map((assignment) => (
        assignment.assignmentId === "role-assignment:rights-a"
          ? { ...assignment, role: "TEACHING_REVIEWER" as const }
          : assignment
      ));
      const draft = persistDraft(connection, fixture, { assignments });
      expectGateReason(
        () => persistReviews(connection, draft.draftMaterialReceipt.revisionId, fixture.releaseGate.reviewGate.reviews),
        "RIGHTS_ROLE_NOT_CURRENTLY_ELIGIBLE",
      );
    } finally {
      connection.sqlite.close();
    }
  });

  it("rejects self-review, a stale decision hash, and a missing second reviewer", async () => {
    const selfReview = await setup({ slug: "synthetic-s2-self-review" });
    try {
      const draft = persistDraft(selfReview.connection, selfReview.fixture, {
        proposerOrEditorActorIds: ["actor:editor", "actor:curator"],
      });
      expectGateReason(
        () => persistReviews(
          selfReview.connection,
          draft.draftMaterialReceipt.revisionId,
          selfReview.fixture.releaseGate.reviewGate.reviews,
        ),
        "CURATION_SELF_REVIEW_FORBIDDEN",
      );
    } finally {
      selfReview.connection.sqlite.close();
    }

    const staleHash = await setup({ slug: "synthetic-s2-stale-hash" });
    try {
      const draft = persistDraft(staleHash.connection, staleHash.fixture);
      const reviews = staleHash.fixture.releaseGate.reviewGate.reviews.map((review) => (
        review.reviewDomain === "CURATION"
          ? { ...review, decisionRevision: { ...review.decisionRevision, revisionHash: `sha256:${"0".repeat(64)}` } }
          : review
      ));
      expectGateReason(
        () => persistReviews(staleHash.connection, draft.draftMaterialReceipt.revisionId, reviews),
        "CURATION_STALE_REVIEW_DECISION_HASH",
      );
    } finally {
      staleHash.connection.sqlite.close();
    }

    const missingSecond = await setup({ slug: "synthetic-s2-missing-second" });
    try {
      const draft = persistDraft(missingSecond.connection, missingSecond.fixture);
      const reviews = missingSecond.fixture.releaseGate.reviewGate.reviews.filter(
        (review) => review.decisionId !== "domain-review:rights-b",
      );
      expectGateReason(
        () => persistReviews(missingSecond.connection, draft.draftMaterialReceipt.revisionId, reviews),
        "RIGHTS_SECOND_REVIEW_MISSING",
      );
    } finally {
      missingSecond.connection.sqlite.close();
    }
  });

  it("moves only affected catalog entries to REVIEW_HOLD when a reviewer is revoked", async () => {
    const affected = await setup({ slug: "synthetic-s2-revoked" });
    try {
      const affectedDraft = persistDraft(affected.connection, affected.fixture);
      persistReviews(
        affected.connection,
        affectedDraft.draftMaterialReceipt.revisionId,
        affected.fixture.releaseGate.reviewGate.reviews,
      );

      const unaffectedFixture = syntheticGovernanceFixture({ slug: "synthetic-s2-unaffected" });
      seedCandidate(affected.connection, unaffectedFixture);
      const unaffectedAssignments = [
        syntheticReviewerAssignment("curator-b", "CURATION_REVIEWER", "curation-b", unaffectedFixture.policy),
        syntheticReviewerAssignment("teacher-b", "TEACHING_REVIEWER", "teaching-b", unaffectedFixture.policy),
        syntheticReviewerAssignment("rights-c", "RIGHTS_REVIEWER", "rights-c", unaffectedFixture.policy),
        syntheticReviewerAssignment("rights-d", "RIGHTS_REVIEWER", "rights-d", unaffectedFixture.policy),
        syntheticReviewerAssignment("safety-b", "SAFETY_REVIEWER", "safety-b", unaffectedFixture.policy),
        syntheticReviewerAssignment("release-b", "RELEASE_APPROVER", "release-b", unaffectedFixture.policy),
      ];
      const unaffectedReviews = [
        syntheticRoleDomainReview(
          "CURATION", "curator-b", "curation-b", unaffectedFixture.target, unaffectedFixture.policy,
        ),
        syntheticRoleDomainReview(
          "TEACHING", "teacher-b", "teaching-b", unaffectedFixture.target, unaffectedFixture.policy,
        ),
        syntheticRoleDomainReview(
          "RIGHTS", "rights-c", "rights-c", unaffectedFixture.target, unaffectedFixture.policy,
          2, ["domain-review:rights-d"],
        ),
        syntheticRoleDomainReview(
          "RIGHTS", "rights-d", "rights-d", unaffectedFixture.target, unaffectedFixture.policy,
          2, ["domain-review:rights-c"],
        ),
        syntheticRoleDomainReview(
          "SAFETY", "safety-b", "safety-b", unaffectedFixture.target, unaffectedFixture.policy,
        ),
      ];
      const unaffectedDraft = persistDraft(affected.connection, unaffectedFixture, {
        assignments: unaffectedAssignments,
      });
      persistReviews(
        affected.connection,
        unaffectedDraft.draftMaterialReceipt.revisionId,
        unaffectedReviews,
      );

      updateWikiS2ReviewerAssignmentStatus(affected.connection, {
        assignmentId: "role-assignment:rights-a",
        status: "REVOKED",
        updatedAt: ACTIVATION_AT,
      });

      expect(affected.connection.sqlite.prepare(`
        SELECT candidate_id AS candidateId, state, hold_reason AS holdReason
        FROM inspiration_wiki_internal_catalog_entries ORDER BY candidate_id
      `).all()).toEqual([
        {
          candidateId: unaffectedFixture.draftMaterial.canonicalInputBundle.candidateId,
          state: "INTERNAL_CATALOG_ACTIVE",
          holdReason: null,
        },
        {
          candidateId: affected.fixture.draftMaterial.canonicalInputBundle.candidateId,
          state: "REVIEW_HOLD",
          holdReason: "REVIEWER_ASSIGNMENT_INVALIDATED",
        },
      ].sort((left, right) => left.candidateId.localeCompare(right.candidateId)));
      expect(affected.connection.sqlite.prepare(`
        SELECT status, json_extract(assignment_json, '$.status') AS recordedStatus
        FROM inspiration_wiki_reviewer_assignments WHERE assignment_id = 'role-assignment:rights-a'
      `).get()).toEqual({ status: "REVOKED", recordedStatus: "ACTIVE" });
      expect(revalidateWikiS2InternalCatalog(
        affected.connection,
        affectedDraft.draftMaterialReceipt.revisionId,
        ACTIVATION_AT,
      )).toMatchObject({ eligible: false, state: "REVIEW_HOLD" });
      expect(revalidateWikiS2InternalCatalog(
        affected.connection,
        unaffectedDraft.draftMaterialReceipt.revisionId,
        ACTIVATION_AT,
      )).toMatchObject({ eligible: true, state: "INTERNAL_CATALOG_ACTIVE" });
    } finally {
      affected.connection.sqlite.close();
    }
  });

  it("rejects a rehashed review that targets stale draft material", async () => {
    const { connection, fixture } = await setup({ slug: "synthetic-s2-stale-target" });
    try {
      const draft = persistDraft(connection, fixture);
      const reviews = fixture.releaseGate.reviewGate.reviews.map((review) => (
        review.reviewDomain === "SAFETY"
          ? rebindReview(review, {
            target: { ...review.target, compiledPreviewHash: `sha256:${"f".repeat(64)}` },
          })
          : review
      ));
      expectGateReason(
        () => persistReviews(connection, draft.draftMaterialReceipt.revisionId, reviews),
        "SAFETY_STALE_TARGET_HASH",
      );
    } finally {
      connection.sqlite.close();
    }
  });

  it("binds the catalog to current review heads and ignores revocation of a superseded reviewer", async () => {
    const { connection, fixture } = await setup({ slug: "synthetic-s2-superseded" });
    try {
      const originalCuration = fixture.releaseGate.reviewGate.reviews.find(
        (review) => review.reviewDomain === "CURATION",
      );
      expect(originalCuration).toBeDefined();
      const currentCurationAssignment = syntheticReviewerAssignment(
        "curator-v2",
        "CURATION_REVIEWER",
        "curation-v2",
        fixture.policy,
      );
      const currentCuration = rebindReview(
        originalCuration!,
        {
          decisionId: "domain-review:curation-v2",
          actorId: "actor:curator-v2",
          actorRoleAssignmentId: currentCurationAssignment.assignmentId,
          decidedAt: "2026-08-10T01:10:00.000Z",
          supersedesDecisionId: originalCuration!.decisionId,
        },
        "domain-review-revision:curation-v2",
      );
      const draft = persistDraft(connection, fixture, {
        assignments: [...fixture.releaseGate.reviewGate.assignments, currentCurationAssignment],
      });
      persistReviews(connection, draft.draftMaterialReceipt.revisionId, [
        ...fixture.releaseGate.reviewGate.reviews,
        currentCuration,
      ]);

      const catalog = connection.sqlite.prepare(`
        SELECT accepted_decision_ids_json AS acceptedDecisionIdsJson, state
        FROM inspiration_wiki_internal_catalog_entries
      `).get() as { acceptedDecisionIdsJson: string; state: string };
      expect(JSON.parse(catalog.acceptedDecisionIdsJson)).toContain(currentCuration.decisionId);
      expect(JSON.parse(catalog.acceptedDecisionIdsJson)).not.toContain(originalCuration!.decisionId);

      updateWikiS2ReviewerAssignmentStatus(connection, {
        assignmentId: originalCuration!.actorRoleAssignmentId,
        status: "REVOKED",
        updatedAt: ACTIVATION_AT,
      });
      expect(connection.sqlite.prepare(
        "SELECT state FROM inspiration_wiki_internal_catalog_entries",
      ).get()).toEqual({ state: "INTERNAL_CATALOG_ACTIVE" });
      expect(revalidateWikiS2InternalCatalog(
        connection,
        draft.draftMaterialReceipt.revisionId,
        ACTIVATION_AT,
      )).toMatchObject({ eligible: true, state: "INTERNAL_CATALOG_ACTIVE" });
    } finally {
      connection.sqlite.close();
    }
  });
});

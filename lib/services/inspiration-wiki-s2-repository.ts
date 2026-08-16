import {
  RoleDomainReviewEvaluationInputSchema,
  RoleDomainPolicySchema,
  ReviewTargetRiskScopeSchema,
  ReviewerRoleAssignmentSchema,
  type RoleDomainReview,
  type ReviewerRoleAssignment,
} from "@/lib/domain/inspiration-wiki/governance-contracts";
import {
  WikiDraftMaterialSourceSchema,
} from "@/lib/domain/inspiration-wiki/compilation-contracts";
import {
  deriveDomainReviewTarget,
  evaluateRoleDomainReviews,
} from "@/lib/domain/inspiration-wiki/governance";
import {
  deriveVerifiedWikiDraftMaterial,
  hashWikiValue,
  stableWikiJson,
  wikiRevisionMatches,
} from "@/lib/domain/inspiration-wiki/integrity";
import type { DatabaseConnection } from "@/lib/db/client";

type PersistWikiDraftInput = {
  candidateId: string;
  candidateRevision: number;
  draftMaterial: unknown;
  riskScope: unknown;
  policy: unknown;
  assignments: readonly unknown[];
  proposerOrEditorActorIds: readonly string[];
  recordedAt: string;
};

type PersistWikiReviewSetInput = {
  draftMaterialReceiptId: string;
  evaluatedAt: string;
  activatedAt?: string;
  reviews: readonly unknown[];
};

type DraftRow = {
  draft_material_receipt_id: string;
  draft_material_json: string;
  risk_scope_json: string;
  proposer_editor_actor_ids_json: string;
  policy_revision_id: string;
  policy_revision_hash: string;
  target_hash: string;
  candidate_id: string;
};

type PolicyRow = {
  revision_id: string;
  revision_hash: string;
  version: string;
  policy_json: string;
};

type AssignmentRow = {
  assignment_id: string;
  assignment_json: string;
  status: ReviewerRoleAssignment["status"];
};

type DecisionRow = {
  decision_id: string;
  review_json: string;
};

type CatalogRow = {
  draft_material_receipt_id: string;
  state: "INTERNAL_CATALOG_ACTIVE" | "REVIEW_HOLD";
  accepted_decision_set_hash: string;
};

export class WikiS2ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WikiS2ConflictError";
  }
}

export class WikiS2GateError extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(`Wiki S2 review gate rejected: ${reasons.join(", ")}`);
    this.name = "WikiS2GateError";
    this.reasons = [...reasons];
  }
}

function unixSeconds(iso: string) {
  const milliseconds = Date.parse(iso);
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid ISO timestamp: ${iso}`);
  return Math.floor(milliseconds / 1_000);
}

function withoutKey(value: Readonly<Record<string, unknown>>, key: string) {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key));
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function assertSameJson(label: string, existing: string, next: unknown) {
  if (existing !== stableWikiJson(next)) {
    throw new WikiS2ConflictError(`${label} already exists with different content`);
  }
}

function policyFromRow(row: PolicyRow) {
  const policy = RoleDomainPolicySchema.parse(parseJson(row.policy_json));
  if (policy.policyRevision.revisionId !== row.revision_id
    || policy.policyRevision.revisionHash !== row.revision_hash
    || policy.version !== row.version) {
    throw new WikiS2ConflictError("Stored Wiki S2 role policy identity drifted");
  }
  return policy;
}

function loadDraft(connection: DatabaseConnection, draftMaterialReceiptId: string) {
  const row = connection.sqlite.prepare(
    `SELECT draft_material_receipt_id, draft_material_json, risk_scope_json,
      proposer_editor_actor_ids_json, policy_revision_id, policy_revision_hash,
      target_hash, candidate_id
     FROM inspiration_wiki_draft_revisions
     WHERE draft_material_receipt_id = ?`,
  ).get(draftMaterialReceiptId) as DraftRow | undefined;
  if (!row) throw new Error(`Unknown Wiki S2 draft revision: ${draftMaterialReceiptId}`);
  const draftMaterial = WikiDraftMaterialSourceSchema.parse(parseJson(row.draft_material_json));
  const riskScope = ReviewTargetRiskScopeSchema.parse(parseJson(row.risk_scope_json));
  const proposerOrEditorActorIds = JSON.parse(row.proposer_editor_actor_ids_json) as string[];
  const target = deriveDomainReviewTarget(draftMaterial, riskScope);
  if (hashWikiValue(target) !== row.target_hash) throw new WikiS2ConflictError("Stored Wiki S2 target hash drifted");
  return { row, draftMaterial, riskScope, proposerOrEditorActorIds, target };
}

function loadPolicy(connection: DatabaseConnection, policyRevisionId: string) {
  const row = connection.sqlite.prepare(
    `SELECT revision_id, revision_hash, version, policy_json
     FROM inspiration_wiki_role_policies WHERE revision_id = ?`,
  ).get(policyRevisionId) as PolicyRow | undefined;
  if (!row) throw new Error(`Unknown Wiki S2 role policy: ${policyRevisionId}`);
  return policyFromRow(row);
}

function loadAssignments(connection: DatabaseConnection, policyRevisionId: string) {
  const rows = connection.sqlite.prepare(
    `SELECT assignment_id, assignment_json, status
     FROM inspiration_wiki_reviewer_assignments
     WHERE policy_revision_id = ? ORDER BY assignment_id`,
  ).all(policyRevisionId) as AssignmentRow[];
  return rows.map(({ assignment_json, status }) => {
    const assignment = ReviewerRoleAssignmentSchema.parse(parseJson(assignment_json));
    return ReviewerRoleAssignmentSchema.parse({ ...assignment, status });
  });
}

function loadReviews(connection: DatabaseConnection, draftMaterialReceiptId: string) {
  const rows = connection.sqlite.prepare(
    `SELECT decision_id, review_json
     FROM inspiration_wiki_domain_review_decisions
     WHERE draft_material_receipt_id = ? ORDER BY decision_id`,
  ).all(draftMaterialReceiptId) as DecisionRow[];
  return rows.map(({ review_json }) => JSON.parse(review_json) as RoleDomainReview);
}

function loadStoredContext(
  connection: DatabaseConnection,
  draftMaterialReceiptId: string,
) {
  const draft = loadDraft(connection, draftMaterialReceiptId);
  const policy = loadPolicy(connection, draft.row.policy_revision_id);
  const assignments = loadAssignments(connection, draft.row.policy_revision_id);
  return { draft, policy, assignments };
}

function evaluateStoredGate(
  connection: DatabaseConnection,
  draftMaterialReceiptId: string,
  evaluatedAt: string,
) {
  const context = loadStoredContext(connection, draftMaterialReceiptId);
  const reviews = loadReviews(connection, draftMaterialReceiptId);
  const input = RoleDomainReviewEvaluationInputSchema.parse({
    evaluatedAt,
    policy: context.policy,
    assignments: context.assignments,
    reviews,
    draftMaterial: context.draft.draftMaterial,
    currentTarget: context.draft.target,
    proposerOrEditorActorIds: context.draft.proposerOrEditorActorIds,
  });
  return {
    ...context,
    reviews,
    evaluation: evaluateRoleDomainReviews(input),
  };
}

function insertImmutable(
  connection: DatabaseConnection,
  sql: string,
  values: readonly unknown[],
  existingSql: string,
  existingValues: readonly unknown[],
  compare: (existing: Record<string, unknown>) => void,
) {
  const result = connection.sqlite.prepare(sql).run(...values);
  if (result.changes > 0) return;
  const existing = connection.sqlite.prepare(existingSql).get(...existingValues) as Record<string, unknown> | undefined;
  if (!existing) throw new Error("Immutable Wiki S2 insert disappeared");
  compare(existing);
}

export function persistWikiS2Draft(
  connection: DatabaseConnection,
  rawInput: PersistWikiDraftInput,
) {
  const draftMaterial = WikiDraftMaterialSourceSchema.parse(rawInput.draftMaterial);
  const riskScope = ReviewTargetRiskScopeSchema.parse(rawInput.riskScope);
  const policy = RoleDomainPolicySchema.parse(rawInput.policy);
  const assignments = rawInput.assignments.map((assignment) => ReviewerRoleAssignmentSchema.parse(assignment));
  const proposerOrEditorActorIds = [...new Set(rawInput.proposerOrEditorActorIds)].sort();
  const verified = deriveVerifiedWikiDraftMaterial(draftMaterial);
  const target = deriveDomainReviewTarget(draftMaterial, riskScope);
  const candidate = connection.sqlite.prepare(
    "SELECT revision, state FROM inspiration_candidates WHERE id = ?",
  ).get(rawInput.candidateId) as { revision: number; state: string } | undefined;

  if (!candidate) throw new Error(`Unknown Inspiration Wiki candidate: ${rawInput.candidateId}`);
  if (candidate.revision !== rawInput.candidateRevision) throw new WikiS2GateError(["CANDIDATE_REVISION_STALE"]);
  if (candidate.state !== "READY_FOR_TEACHER_REVIEW") throw new WikiS2GateError(["CANDIDATE_NOT_READY_FOR_DOMAIN_REVIEW"]);
  if (draftMaterial.canonicalInputBundle.candidateId !== rawInput.candidateId) {
    throw new WikiS2GateError(["DRAFT_CANDIDATE_ID_MISMATCH"]);
  }
  if (!wikiRevisionMatches(policy.policyRevision, withoutKey(policy, "policyRevision"))) {
    throw new WikiS2GateError(["STALE_ROLE_POLICY_DOCUMENT"]);
  }
  if (!wikiRevisionMatches(riskScope.scopeRevision, withoutKey(riskScope, "scopeRevision"))) {
    throw new WikiS2GateError(["STALE_TARGET_RISK_SCOPE"]);
  }
  for (const assignment of assignments) {
    if (assignment.policyVersion !== policy.version
      || stableWikiJson(assignment.policyRevision) !== stableWikiJson(policy.policyRevision)) {
      throw new WikiS2GateError(["ROLE_ASSIGNMENT_POLICY_MISMATCH"]);
    }
  }

  const recordedAt = unixSeconds(rawInput.recordedAt);
  const draftJson = stableWikiJson(draftMaterial);
  const riskScopeJson = stableWikiJson(riskScope);
  const proposerJson = stableWikiJson(proposerOrEditorActorIds);
  const candidateRevisionInput = draftMaterial.canonicalInputBundle.inputs.find((input) => input.kind === "CANDIDATE_REVISION");
  const reviewPackageInput = draftMaterial.canonicalInputBundle.inputs.find((input) => input.kind === "REVIEW_PACKAGE_REVISION");
  if (!candidateRevisionInput || !reviewPackageInput) throw new WikiS2GateError(["CANONICAL_INPUT_BUNDLE_INCOMPLETE"]);

  connection.sqlite.transaction(() => {
    insertImmutable(
      connection,
      `INSERT OR IGNORE INTO inspiration_wiki_role_policies
        (revision_id, revision_hash, version, policy_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [policy.policyRevision.revisionId, policy.policyRevision.revisionHash, policy.version, stableWikiJson(policy), recordedAt],
      "SELECT policy_json, revision_hash, version FROM inspiration_wiki_role_policies WHERE revision_id = ?",
      [policy.policyRevision.revisionId],
      (existing) => {
        assertSameJson("Wiki S2 role policy", String(existing.policy_json), policy);
        if (existing.revision_hash !== policy.policyRevision.revisionHash || existing.version !== policy.version) {
          throw new WikiS2ConflictError("Wiki S2 role policy binding changed");
        }
      },
    );

    for (const assignment of assignments) {
      insertImmutable(
        connection,
        `INSERT OR IGNORE INTO inspiration_wiki_reviewer_assignments
          (assignment_id, actor_id, role, status, policy_version, policy_revision_id,
           policy_revision_hash, assignment_json, valid_from, valid_until, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          assignment.assignmentId,
          assignment.actorId,
          assignment.role,
          assignment.status,
          assignment.policyVersion,
          assignment.policyRevision.revisionId,
          assignment.policyRevision.revisionHash,
          stableWikiJson(assignment),
          unixSeconds(assignment.validFrom),
          assignment.validUntil ? unixSeconds(assignment.validUntil) : null,
          recordedAt,
          recordedAt,
        ],
        "SELECT assignment_json, actor_id, role, policy_revision_id FROM inspiration_wiki_reviewer_assignments WHERE assignment_id = ?",
        [assignment.assignmentId],
        (existing) => {
          assertSameJson("Wiki S2 reviewer assignment", String(existing.assignment_json), assignment);
          if (existing.actor_id !== assignment.actorId
            || existing.role !== assignment.role
            || existing.policy_revision_id !== assignment.policyRevision.revisionId) {
            throw new WikiS2ConflictError("Wiki S2 reviewer assignment binding changed");
          }
        },
      );
    }

    insertImmutable(
      connection,
      `INSERT OR IGNORE INTO inspiration_wiki_draft_revisions
        (draft_material_receipt_id, draft_material_receipt_hash, candidate_id, candidate_revision,
         page_id, page_draft_revision_id, page_draft_revision_hash, canonical_input_bundle_id,
         canonical_input_bundle_hash, page_revision_id, page_revision_hash, compilation_receipt_id,
         compilation_receipt_hash, review_package_revision_id, review_package_revision_hash,
         policy_revision_id, policy_revision_hash, risk_scope_revision_id, risk_scope_revision_hash,
         target_hash, draft_material_json, risk_scope_json, proposer_editor_actor_ids_json,
         state, student_visible, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        verified.draftMaterialReceipt.revisionId,
        verified.draftMaterialReceipt.revisionHash,
        rawInput.candidateId,
        rawInput.candidateRevision,
        verified.pageId,
        verified.pageDraftRevision.revisionId,
        verified.pageDraftRevision.revisionHash,
        verified.canonicalInputBundle.revisionId,
        verified.canonicalInputBundle.revisionHash,
        verified.pageRevision.revisionId,
        verified.pageRevision.revisionHash,
        verified.compilationReceipt.revisionId,
        verified.compilationReceipt.revisionHash,
        reviewPackageInput.revision.revisionId,
        reviewPackageInput.revision.revisionHash,
        policy.policyRevision.revisionId,
        policy.policyRevision.revisionHash,
        riskScope.scopeRevision.revisionId,
        riskScope.scopeRevision.revisionHash,
        hashWikiValue(target),
        draftJson,
        riskScopeJson,
        proposerJson,
        "LINTED",
        0,
        recordedAt,
      ],
      "SELECT draft_material_json, risk_scope_json, proposer_editor_actor_ids_json, target_hash FROM inspiration_wiki_draft_revisions WHERE draft_material_receipt_id = ?",
      [verified.draftMaterialReceipt.revisionId],
      (existing) => {
        assertSameJson("Wiki S2 draft material", String(existing.draft_material_json), draftMaterial);
        assertSameJson("Wiki S2 risk scope", String(existing.risk_scope_json), riskScope);
        assertSameJson("Wiki S2 proposer/editor set", String(existing.proposer_editor_actor_ids_json), proposerOrEditorActorIds);
        if (existing.target_hash !== hashWikiValue(target)) throw new WikiS2ConflictError("Wiki S2 draft target binding changed");
      },
    );
  }).immediate();

  return {
    draftMaterialReceipt: verified.draftMaterialReceipt,
    target,
    policy,
    assignments,
  } as const;
}

export function persistWikiS2ReviewDecisionSet(
  connection: DatabaseConnection,
  rawInput: PersistWikiReviewSetInput,
) {
  const stored = loadStoredContext(connection, rawInput.draftMaterialReceiptId);
  const reviews = rawInput.reviews.map((review) => review as RoleDomainReview);
  const input = RoleDomainReviewEvaluationInputSchema.parse({
    evaluatedAt: rawInput.evaluatedAt,
    policy: stored.policy,
    assignments: stored.assignments,
    reviews,
    draftMaterial: stored.draft.draftMaterial,
    currentTarget: stored.draft.target,
    proposerOrEditorActorIds: stored.draft.proposerOrEditorActorIds,
  });
  const evaluation = evaluateRoleDomainReviews(input);
  if (!evaluation.eligible) throw new WikiS2GateError(evaluation.reasons);
  const acceptedDecisionIds = [...evaluation.acceptedDecisionIds];
  const acceptedDecisionIdSet = new Set(acceptedDecisionIds);
  const acceptedReviews = reviews.filter((review) => acceptedDecisionIdSet.has(review.decisionId));
  if (acceptedReviews.length !== acceptedDecisionIds.length) {
    throw new WikiS2ConflictError("Wiki S2 accepted review set is incomplete");
  }
  const acceptedDecisionSetHash = hashWikiValue(acceptedReviews
    .map((review) => ({ decisionId: review.decisionId, decisionRevision: review.decisionRevision }))
    .sort((left, right) => left.decisionId.localeCompare(right.decisionId)));
  const activatedAt = unixSeconds(rawInput.activatedAt ?? rawInput.evaluatedAt);
  const targetHash = hashWikiValue(stored.draft.target);

  connection.sqlite.transaction(() => {
    for (const review of reviews) {
      insertImmutable(
        connection,
        `INSERT OR IGNORE INTO inspiration_wiki_domain_review_decisions
          (decision_id, decision_revision_id, decision_revision_hash, draft_material_receipt_id,
           review_domain, decision, actor_id, actor_role_assignment_id, policy_revision_id,
           policy_revision_hash, target_hash, required_reviewer_count, co_reviewer_decision_ids_json,
           review_json, status, valid_until, decided_at, supersedes_decision_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          review.decisionId,
          review.decisionRevision.revisionId,
          review.decisionRevision.revisionHash,
          rawInput.draftMaterialReceiptId,
          review.reviewDomain,
          review.decision,
          review.actorId,
          review.actorRoleAssignmentId,
          review.rolePolicyRevision.revisionId,
          review.rolePolicyRevision.revisionHash,
          targetHash,
          review.requiredReviewerCount,
          stableWikiJson(review.coReviewerDecisionIds),
          stableWikiJson(review),
          review.status,
          review.validUntil ? unixSeconds(review.validUntil) : null,
          unixSeconds(review.decidedAt),
          review.supersedesDecisionId,
          activatedAt,
        ],
        "SELECT review_json, decision_revision_hash FROM inspiration_wiki_domain_review_decisions WHERE decision_id = ?",
        [review.decisionId],
        (existing) => {
          assertSameJson("Wiki S2 domain review", String(existing.review_json), review);
          if (existing.decision_revision_hash !== review.decisionRevision.revisionHash) {
            throw new WikiS2ConflictError("Wiki S2 domain review binding changed");
          }
        },
      );
    }

    const existingCatalog = connection.sqlite.prepare(
      `SELECT draft_material_receipt_id, state, accepted_decision_set_hash
       FROM inspiration_wiki_internal_catalog_entries WHERE draft_material_receipt_id = ?`,
    ).get(rawInput.draftMaterialReceiptId) as CatalogRow | undefined;
    if (existingCatalog) {
      if (existingCatalog.accepted_decision_set_hash !== acceptedDecisionSetHash) {
        throw new WikiS2ConflictError("Wiki S2 internal catalog decision set changed");
      }
      return;
    }
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_internal_catalog_entries
        (draft_material_receipt_id, page_id, candidate_id, state, hold_reason,
         accepted_decision_ids_json, accepted_decision_set_hash, policy_revision_id,
         policy_revision_hash, target_hash, student_visible, browse_release, student_search,
         wiki_retrieval, activated_at, updated_at)
       VALUES (?, ?, ?, 'INTERNAL_CATALOG_ACTIVE', NULL, ?, ?, ?, ?, ?, 0, 'DISABLED', 'DISABLED', 'DISABLED', ?, ?)`,
    ).run(
      rawInput.draftMaterialReceiptId,
      stored.draft.target.pageId,
      stored.draft.row.candidate_id,
      stableWikiJson(acceptedDecisionIds),
      acceptedDecisionSetHash,
      stored.policy.policyRevision.revisionId,
      stored.policy.policyRevision.revisionHash,
      targetHash,
      activatedAt,
      activatedAt,
    );
  }).immediate();

  return { evaluation, acceptedDecisionSetHash, state: "INTERNAL_CATALOG_ACTIVE" as const };
}

export function updateWikiS2ReviewerAssignmentStatus(
  connection: DatabaseConnection,
  input: { assignmentId: string; status: "REVOKED" | "EXPIRED"; updatedAt: string },
) {
  const row = connection.sqlite.prepare(
    `SELECT status, policy_revision_id FROM inspiration_wiki_reviewer_assignments
     WHERE assignment_id = ?`,
  ).get(input.assignmentId) as {
    status: ReviewerRoleAssignment["status"];
    policy_revision_id: string;
  } | undefined;
  if (!row) throw new Error(`Unknown Wiki S2 reviewer assignment: ${input.assignmentId}`);
  if (row.status === input.status) return;
  if (row.status !== "ACTIVE") throw new WikiS2ConflictError("Wiki S2 reviewer assignment is already inactive");
  const now = unixSeconds(input.updatedAt);
  connection.sqlite.transaction(() => {
    connection.sqlite.prepare(
      `UPDATE inspiration_wiki_reviewer_assignments
       SET status = ?, updated_at = ? WHERE assignment_id = ?`,
    ).run(input.status, now, input.assignmentId);
    connection.sqlite.prepare(
      `UPDATE inspiration_wiki_internal_catalog_entries
       SET state = 'REVIEW_HOLD', hold_reason = 'REVIEWER_ASSIGNMENT_INVALIDATED', updated_at = ?
       WHERE policy_revision_id = ?
         AND state = 'INTERNAL_CATALOG_ACTIVE'
         AND EXISTS (
           SELECT 1
           FROM inspiration_wiki_domain_review_decisions AS decision
           WHERE decision.draft_material_receipt_id = inspiration_wiki_internal_catalog_entries.draft_material_receipt_id
             AND decision.actor_role_assignment_id = ?
             AND decision.decision_id IN (
               SELECT value
               FROM json_each(inspiration_wiki_internal_catalog_entries.accepted_decision_ids_json)
             )
         )`,
    ).run(now, row.policy_revision_id, input.assignmentId);
  }).immediate();
}

export function revalidateWikiS2InternalCatalog(
  connection: DatabaseConnection,
  draftMaterialReceiptId: string,
  evaluatedAt: string,
) {
  const stored = evaluateStoredGate(connection, draftMaterialReceiptId, evaluatedAt);
  const row = connection.sqlite.prepare(
    `SELECT state FROM inspiration_wiki_internal_catalog_entries WHERE draft_material_receipt_id = ?`,
  ).get(draftMaterialReceiptId) as { state: "INTERNAL_CATALOG_ACTIVE" | "REVIEW_HOLD" } | undefined;
  if (!row) throw new Error(`Unknown Wiki S2 internal catalog entry: ${draftMaterialReceiptId}`);
  if (!stored.evaluation.eligible && row.state !== "REVIEW_HOLD") {
    connection.sqlite.prepare(
      `UPDATE inspiration_wiki_internal_catalog_entries
       SET state = 'REVIEW_HOLD', hold_reason = 'REVIEW_GATE_FAILED', updated_at = ?
       WHERE draft_material_receipt_id = ?`,
    ).run(unixSeconds(evaluatedAt), draftMaterialReceiptId);
  }
  return { ...stored.evaluation, state: stored.evaluation.eligible ? row.state : "REVIEW_HOLD" };
}

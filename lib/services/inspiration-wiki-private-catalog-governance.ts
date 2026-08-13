import { createHash } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import { readTeacherScope } from "@/lib/auth/teacher-access";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  PrivateCatalogAdmissionReceiptSchema,
  PrivateCatalogGovernanceCaseSchema,
  PrivateCatalogGovernanceDecisionSchema,
  PrivateInternalCatalogEntrySchema,
  TeacherPrivateCatalogQueueSchema,
  type PrivateCatalogGovernanceCase,
  type PrivateCatalogGovernanceDecision,
  type PrivateCatalogReviewDomain,
  type PrivateCatalogTarget,
  type PrivateInternalCatalogEntry,
} from "@/lib/domain/inspiration-wiki/private-catalog-governance-contracts";
import {
  PrivateCompiledTruthSchema,
  PrivateWikiPageRevisionSchema,
  PrivateWikiPageSchema,
} from "@/lib/domain/inspiration-wiki/private-compilation-contracts";
import { PrivateDomainReviewCaseSchema } from "@/lib/domain/inspiration-wiki/private-domain-review-contracts";
import {
  RoleDomainPolicySchema,
  ReviewerRoleAssignmentSchema,
  type ReviewerRoleAssignment,
  type RoleDomainPolicy,
} from "@/lib/domain/inspiration-wiki/governance-contracts";
import { bindWikiRevision, hashWikiValue, stableWikiJson, wikiRevisionMatches } from "@/lib/domain/inspiration-wiki/integrity";

type ReviewDomain = PrivateCatalogReviewDomain;

const POLICY_VERSION = "role-policy:private-internal-catalog-v1";
const POLICY_REVISION_ID = "role-policy-revision:private-internal-catalog-v1";
const DOMAINS = ["CURATION", "TEACHING", "RIGHTS", "SAFETY"] as const;
const ROLE_BY_DOMAIN = {
  CURATION: "CURATION_REVIEWER",
  TEACHING: "TEACHING_REVIEWER",
  RIGHTS: "RIGHTS_REVIEWER",
  SAFETY: "SAFETY_REVIEWER",
} as const;
const INTERPRETATION_BY_DOMAIN = {
  CURATION: "CURATION_ACCEPTED",
  TEACHING: "TEACHING_ACCEPTED",
  RIGHTS: "UNKNOWN_PRIVATE_ONLY_ACCEPTED",
  SAFETY: "SAFETY_ACCEPTED",
} as const;
const BOUNDARY = {
  teacherPrivate: true as const,
  studentVisible: false as const,
  internalCatalog: "ENABLED" as const,
  canonicalCompilation: "DISABLED" as const,
  currentPage: "DISABLED" as const,
  formalRelease: "DISABLED" as const,
  r2: "DISABLED" as const,
  embedding: "DISABLED" as const,
  lumiRetrieval: "DISABLED" as const,
};

type SourceRow = {
  page_json: string;
  revision_json: string;
  truth_json: string;
  case_json: string;
};

type SourceDecisionRow = {
  id: string;
  review_domain: ReviewDomain;
  decision: string;
  reviewer_id: string;
  next_case_json: string;
};

export class PrivateCatalogGovernanceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateCatalogGovernanceConflictError";
  }
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function unixSeconds(iso: string) {
  const milliseconds = Date.parse(iso);
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid ISO timestamp: ${iso}`);
  return Math.floor(milliseconds / 1_000);
}

function isoSeconds(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid D-22 timestamp");
  return date.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

function suffix(candidateId: string) {
  const value = candidateId.split(":").at(-1);
  if (!value || !/^[0-9a-f]{32}$/.test(value)) throw new PrivateCatalogGovernanceConflictError("候选身份不可用于内部目录");
  return value;
}

function governanceActorId(authenticatedTeacherId: string) {
  return `teacher-actor:${createHash("sha256").update(authenticatedTeacherId).digest("hex").slice(0, 24)}`;
}

function withoutKey(value: Readonly<Record<string, unknown>>, key: string) {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key));
}

function makePolicy(): RoleDomainPolicy {
  const material = {
    schemaVersion: "lumi-inspiration-role-domain-policy/v1" as const,
    version: POLICY_VERSION,
    allowSelfReview: true,
    riskRules: [{
      targetRisk: "STANDARD" as const,
      dualReviewRequired: false,
      requirements: DOMAINS.map((domain) => ({ domain, requiredReviewerCount: 1 })),
    }],
  };
  return RoleDomainPolicySchema.parse({
    ...material,
    policyRevision: bindWikiRevision(POLICY_REVISION_ID, material),
  });
}

function assignmentId(domain: ReviewDomain) {
  return `role-assignment:private-internal-catalog:${domain.toLowerCase()}:v1`;
}

function ensurePolicyAndAssignments(
  connection: DatabaseConnection,
  actorId: string,
  recordedAt: string,
) {
  const policy = makePolicy();
  const existingPolicy = connection.sqlite.prepare(
    "SELECT policy_json FROM inspiration_wiki_role_policies WHERE revision_id=?",
  ).get(policy.policyRevision.revisionId) as { policy_json: string } | undefined;
  let policiesCreated = 0;
  if (existingPolicy) {
    if (stableWikiJson(RoleDomainPolicySchema.parse(parseJson(existingPolicy.policy_json))) !== stableWikiJson(policy)) {
      throw new PrivateCatalogGovernanceConflictError("D-22 角色策略内容发生冲突");
    }
  } else {
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_role_policies(revision_id,revision_hash,version,policy_json,created_at)
       VALUES(?,?,?,?,?)`,
    ).run(policy.policyRevision.revisionId, policy.policyRevision.revisionHash, policy.version,
      stableWikiJson(policy), unixSeconds(recordedAt));
    policiesCreated = 1;
  }

  const assignments: ReviewerRoleAssignment[] = [];
  let assignmentsCreated = 0;
  for (const domain of DOMAINS) {
    const id = assignmentId(domain);
    const existing = connection.sqlite.prepare(
      "SELECT assignment_json,status FROM inspiration_wiki_reviewer_assignments WHERE assignment_id=?",
    ).get(id) as { assignment_json: string; status: string } | undefined;
    if (existing) {
      const stored = parseJson(existing.assignment_json);
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
        throw new PrivateCatalogGovernanceConflictError(`D-22 ${domain} 角色分配不可解析`);
      }
      const parsed = ReviewerRoleAssignmentSchema.parse({
        ...stored,
        status: existing.status,
      });
      if (parsed.actorId !== actorId || parsed.role !== ROLE_BY_DOMAIN[domain]
        || parsed.policyVersion !== policy.version
        || stableWikiJson(parsed.policyRevision) !== stableWikiJson(policy.policyRevision)
        || parsed.status !== "ACTIVE") {
        throw new PrivateCatalogGovernanceConflictError(`D-22 ${domain} 角色分配不可复用`);
      }
      assignments.push(parsed);
      continue;
    }
    const assignment = ReviewerRoleAssignmentSchema.parse({
      assignmentId: id,
      actorId,
      role: ROLE_BY_DOMAIN[domain],
      status: "ACTIVE",
      policyVersion: policy.version,
      policyRevision: policy.policyRevision,
      validFrom: recordedAt,
      validUntil: null,
    });
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_reviewer_assignments(
        assignment_id,actor_id,role,status,policy_version,policy_revision_id,
        policy_revision_hash,assignment_json,valid_from,valid_until,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?)`,
    ).run(assignment.assignmentId, assignment.actorId, assignment.role, assignment.status,
      assignment.policyVersion, assignment.policyRevision.revisionId,
      assignment.policyRevision.revisionHash, stableWikiJson(assignment), unixSeconds(assignment.validFrom),
      unixSeconds(recordedAt), unixSeconds(recordedAt));
    assignments.push(assignment);
    assignmentsCreated += 1;
  }
  return { policy, assignments, policiesCreated, assignmentsCreated };
}

function loadSources(connection: DatabaseConnection) {
  return connection.sqlite.prepare(
    `SELECT p.page_json,r.revision_json,t.truth_json,c.case_json
     FROM inspiration_wiki_private_pages p
     JOIN inspiration_wiki_private_page_revisions r ON r.revision_id=p.latest_revision_id
     JOIN inspiration_wiki_private_compiled_truths t ON t.truth_id=p.latest_truth_id
     JOIN inspiration_wiki_private_domain_review_cases c ON c.review_case_id=r.review_case_id
     WHERE p.state='PRIVATE_COMPILED' AND c.stage='DOMAIN_REVIEW_COMPLETE'
     ORDER BY p.candidate_id`,
  ).all() as SourceRow[];
}

function verifyTarget(
  page: ReturnType<typeof PrivateWikiPageSchema.parse>,
  revision: ReturnType<typeof PrivateWikiPageRevisionSchema.parse>,
  truth: ReturnType<typeof PrivateCompiledTruthSchema.parse>,
  reviewCase: ReturnType<typeof PrivateDomainReviewCaseSchema.parse>,
) {
  if (page.latestPrivateRevision.revisionId !== revision.revisionId
    || page.latestPrivateRevision.revisionHash !== revision.revisionHash
    || page.latestPrivateTruth.truthId !== truth.truthId
    || page.latestPrivateTruth.truthHash !== truth.truthHash
    || revision.pageId !== page.pageId
    || revision.candidateId !== page.candidateId
    || truth.pageId !== page.pageId
    || truth.pageRevision.revisionId !== revision.revisionId
    || truth.pageRevision.revisionHash !== revision.revisionHash
    || truth.contentHash !== revision.contentHash
    || revision.sourceBinding.reviewCaseId !== reviewCase.reviewCaseId
    || revision.sourceBinding.reviewCaseRevision !== reviewCase.revision
    || revision.sourceBinding.reviewStateHash !== reviewCase.stateHash
    || page.rightsScope !== "UNKNOWN_PRIVATE_ONLY"
    || truth.rightsScope !== "UNKNOWN_PRIVATE_ONLY") {
    throw new PrivateCatalogGovernanceConflictError(`D-22 私有编译绑定漂移：${page.pageId}`);
  }
  const target: PrivateCatalogTarget = {
    pageId: page.pageId,
    pageRevisionId: revision.revisionId,
    pageRevision: revision.revision,
    pageRevisionHash: revision.revisionHash,
    contentHash: revision.contentHash,
    truthId: truth.truthId,
    truthHash: truth.truthHash,
    reviewCaseId: reviewCase.reviewCaseId,
    reviewCaseRevision: reviewCase.revision,
    reviewStateHash: reviewCase.stateHash,
  };
  return target;
}

function sourceDecisions(
  connection: DatabaseConnection,
  reviewCase: ReturnType<typeof PrivateDomainReviewCaseSchema.parse>,
  actorId: string,
) {
  const rows = connection.sqlite.prepare(
    `SELECT id,review_domain,decision,reviewer_id,next_case_json
     FROM inspiration_wiki_private_domain_review_decisions
     WHERE review_case_id=? AND id IN (?,?,?,?)`,
  ).all(
    reviewCase.reviewCaseId,
    reviewCase.domains.CURATION.decisionId,
    reviewCase.domains.TEACHING.decisionId,
    reviewCase.domains.RIGHTS.decisionId,
    reviewCase.domains.SAFETY.decisionId,
  ) as SourceDecisionRow[];
  if (rows.length !== 4) throw new PrivateCatalogGovernanceConflictError("D-22 四域来源决定不完整");
  const byDomain = new Map(rows.map((row) => [row.review_domain, row]));
  for (const domain of DOMAINS) {
    const row = byDomain.get(domain);
    if (!row || row.decision !== "APPROVE" || row.reviewer_id !== actorId) {
      throw new PrivateCatalogGovernanceConflictError(`D-22 ${domain} 来源决定或真实审核人不匹配`);
    }
    const snapshot = PrivateDomainReviewCaseSchema.parse(parseJson(row.next_case_json));
    if (snapshot.domains[domain].decisionId !== row.id
      || reviewCase.domains[domain].decisionId !== row.id
      || reviewCase.domains[domain].status !== "APPROVED") {
      throw new PrivateCatalogGovernanceConflictError(`D-22 ${domain} 来源决定不是当前有效头`);
    }
  }
  return Object.fromEntries(DOMAINS.map((domain) => [domain, byDomain.get(domain)!.id])) as Record<ReviewDomain, string>;
}

function persistOne(
  connection: DatabaseConnection,
  authenticatedTeacherId: string,
  policy: RoleDomainPolicy,
  assignments: readonly ReviewerRoleAssignment[],
  source: SourceRow,
  admittedAt: string,
) {
  const actorId = governanceActorId(authenticatedTeacherId);
  const page = PrivateWikiPageSchema.parse(parseJson(source.page_json));
  const revision = PrivateWikiPageRevisionSchema.parse(parseJson(source.revision_json));
  const truth = PrivateCompiledTruthSchema.parse(parseJson(source.truth_json));
  const reviewCase = PrivateDomainReviewCaseSchema.parse(parseJson(source.case_json));
  const target = verifyTarget(page, revision, truth, reviewCase);
  const targetHash = hashWikiValue(target);
  const idSuffix = suffix(page.candidateId);
  const governanceCaseId = `private-catalog-governance:${idSuffix}:${revision.revision}`;
  const existingRow = connection.sqlite.prepare(
    "SELECT case_json FROM inspiration_wiki_private_catalog_governance_cases WHERE governance_case_id=?",
  ).get(governanceCaseId) as { case_json: string } | undefined;
  if (existingRow) {
    const existing = PrivateCatalogGovernanceCaseSchema.parse(parseJson(existingRow.case_json));
    if (existing.targetHash !== targetHash || existing.target.pageRevisionId !== revision.revisionId
      || existing.policy.policyRevision.revisionHash !== policy.policyRevision.revisionHash
      || existing.assignments.some((assignment) => assignment.actorId !== actorId)) {
      throw new PrivateCatalogGovernanceConflictError(`D-22 已有治理任务与当前物料冲突：${governanceCaseId}`);
    }
    const storedDecisions = connection.sqlite.prepare(
      "SELECT count(*) AS count FROM inspiration_wiki_private_catalog_domain_decisions WHERE governance_case_id=?",
    ).get(governanceCaseId) as { count: number };
    const storedEntry = connection.sqlite.prepare(
      "SELECT count(*) AS count FROM inspiration_wiki_private_internal_catalog_entries WHERE governance_case_id=?",
    ).get(governanceCaseId) as { count: number };
    if (storedDecisions.count !== 4 || storedEntry.count !== 1) {
      throw new PrivateCatalogGovernanceConflictError(`D-22 治理事务不完整：${governanceCaseId}`);
    }
    return { replayed: true as const, decisionsCreated: 0 };
  }

  const assignmentByDomain = Object.fromEntries(DOMAINS.map((domain) => {
    const assignment = assignments.find((item) => item.role === ROLE_BY_DOMAIN[domain]);
    if (!assignment || assignment.actorId !== actorId || assignment.status !== "ACTIVE") {
      throw new PrivateCatalogGovernanceConflictError(`D-22 ${domain} 显式角色分配缺失`);
    }
    return [domain, assignment];
  })) as Record<ReviewDomain, ReviewerRoleAssignment>;
  const sourceDecisionIds = sourceDecisions(connection, reviewCase, authenticatedTeacherId);
  const decisionIds = Object.fromEntries(DOMAINS.map((domain) => [
    domain,
    `private-catalog-decision:${idSuffix}:${revision.revision}:${domain.toLowerCase()}`,
  ])) as Record<ReviewDomain, string>;
  const decisions = DOMAINS.map((domain) => {
    const raw = {
      schemaVersion: "lumi-inspiration-private-catalog-domain-decision/v1" as const,
      decisionId: decisionIds[domain],
      governanceCaseId,
      reviewDomain: domain,
      decision: "APPROVE_PRIVATE_INTERNAL_CATALOG" as const,
      actorId,
      authenticatedTeacherId,
      actorRoleAssignmentId: assignmentByDomain[domain].assignmentId,
      sourcePrivateDecisionId: sourceDecisionIds[domain],
      target,
      policyRevision: policy.policyRevision,
      interpretation: INTERPRETATION_BY_DOMAIN[domain],
      decidedAt: admittedAt,
    };
    return PrivateCatalogGovernanceDecisionSchema.parse({ ...raw, decisionHash: hashWikiValue(raw) });
  });
  const rawCase = {
    schemaVersion: "lumi-inspiration-private-catalog-governance-case/v1" as const,
    governanceCaseId,
    candidateId: page.candidateId,
    target,
    targetHash,
    policy,
    assignments,
    assignmentIds: Object.fromEntries(DOMAINS.map((domain) => [domain, assignmentByDomain[domain].assignmentId])),
    sourceDecisionIds,
    decisionIds,
    reviewerModel: "SINGLE_TEACHER_EXPLICIT_ROLES" as const,
    selfReviewException: "LOCAL_PRIVATE_CATALOG_ONLY" as const,
    rightsScope: "UNKNOWN_PRIVATE_ONLY" as const,
    stage: "ROLE_REVIEW_COMPLETE" as const,
    reviewedAt: admittedAt,
    capabilityBoundary: BOUNDARY,
  };
  const governanceCase = PrivateCatalogGovernanceCaseSchema.parse({ ...rawCase, caseHash: hashWikiValue(rawCase) });
  const rawEntry = {
    schemaVersion: "lumi-inspiration-private-internal-catalog-entry/v1" as const,
    entryId: `private-internal-catalog:${idSuffix}:${revision.revision}`,
    governanceCaseId,
    candidateId: page.candidateId,
    pageId: page.pageId,
    pageRevisionId: revision.revisionId,
    pageRevision: revision.revision,
    truthId: truth.truthId,
    targetHash,
    acceptedDecisionIds: decisionIds,
    policyRevision: policy.policyRevision,
    state: "INTERNAL_CATALOG_ACTIVE" as const,
    rightsScope: "UNKNOWN_PRIVATE_ONLY" as const,
    activatedAt: admittedAt,
    capabilityBoundary: BOUNDARY,
  };
  const entry = PrivateInternalCatalogEntrySchema.parse({ ...rawEntry, entryHash: hashWikiValue(rawEntry) });
  const at = unixSeconds(admittedAt);
  connection.sqlite.prepare(
    `INSERT INTO inspiration_wiki_private_catalog_governance_cases(
      governance_case_id,candidate_id,page_id,page_revision_id,truth_id,review_case_id,
      policy_revision_id,policy_revision_hash,target_hash,role_assignment_ids_json,
      source_decision_ids_json,decision_ids_json,stage,reviewer_model,rights_scope,
      case_json,teacher_private,student_visible,internal_catalog,canonical_compilation,
      current_page,formal_release,r2,embedding,lumi_retrieval,reviewed_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,1,0,'ENABLED','DISABLED','DISABLED','DISABLED','DISABLED','DISABLED','DISABLED',?,?)`,
  ).run(governanceCase.governanceCaseId, governanceCase.candidateId, page.pageId,
    revision.revisionId, truth.truthId, reviewCase.reviewCaseId, policy.policyRevision.revisionId,
    policy.policyRevision.revisionHash, targetHash, stableWikiJson(governanceCase.assignmentIds),
    stableWikiJson(sourceDecisionIds), stableWikiJson(decisionIds), governanceCase.stage,
    governanceCase.reviewerModel, governanceCase.rightsScope, stableWikiJson(governanceCase), at, at);
  for (const decision of decisions) {
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_private_catalog_domain_decisions(
        decision_id,decision_hash,governance_case_id,review_domain,decision,actor_id,authenticated_teacher_id,
        actor_role_assignment_id,source_private_decision_id,target_hash,interpretation,
        decision_json,decided_at,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(decision.decisionId, decision.decisionHash, decision.governanceCaseId,
      decision.reviewDomain, decision.decision, decision.actorId, decision.authenticatedTeacherId, decision.actorRoleAssignmentId,
      decision.sourcePrivateDecisionId, targetHash, decision.interpretation,
      stableWikiJson(decision), at, at);
  }
  connection.sqlite.prepare(
    `INSERT INTO inspiration_wiki_private_internal_catalog_entries(
      entry_id,entry_hash,governance_case_id,candidate_id,page_id,page_revision_id,
      truth_id,policy_revision_id,policy_revision_hash,target_hash,accepted_decision_ids_json,
      state,rights_scope,entry_json,teacher_private,student_visible,internal_catalog,
      canonical_compilation,current_page,formal_release,r2,embedding,lumi_retrieval,
      activated_at,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?, ?,1,0,'ENABLED','DISABLED','DISABLED','DISABLED','DISABLED','DISABLED','DISABLED',?,?)`,
  ).run(entry.entryId, entry.entryHash, entry.governanceCaseId, entry.candidateId,
    entry.pageId, entry.pageRevisionId, entry.truthId, entry.policyRevision.revisionId,
    entry.policyRevision.revisionHash, entry.targetHash, stableWikiJson(entry.acceptedDecisionIds),
    entry.state, entry.rightsScope, stableWikiJson(entry), at, at);
  return { replayed: false as const, decisionsCreated: 4 };
}

export function admitApprovedPrivatePagesToInternalCatalog(
  connection: DatabaseConnection,
  actorId: string,
  at: string | Date = new Date(),
) {
  const admittedAt = isoSeconds(at);
  const teacher = connection.sqlite.prepare(
    "SELECT id FROM users WHERE id=? AND role='TEACHER'",
  ).get(actorId) as { id: string } | undefined;
  if (!teacher) throw new PrivateCatalogGovernanceConflictError("D-22 需要真实教师账号");
  const governanceActor = governanceActorId(actorId);
  const sources = loadSources(connection);
  let policiesCreated = 0;
  let assignmentsCreated = 0;
  let casesCreated = 0;
  let decisionsCreated = 0;
  let entriesCreated = 0;
  let replayed = 0;
  connection.sqlite.transaction(() => {
    const governed = ensurePolicyAndAssignments(connection, governanceActor, admittedAt);
    policiesCreated = governed.policiesCreated;
    assignmentsCreated = governed.assignmentsCreated;
    for (const source of sources) {
      const result = persistOne(connection, actorId, governed.policy, governed.assignments, source, admittedAt);
      if (result.replayed) replayed += 1;
      else {
        casesCreated += 1;
        decisionsCreated += result.decisionsCreated;
        entriesCreated += 1;
      }
    }
  }).immediate();
  const totals = connection.sqlite.prepare(
    `SELECT
      (SELECT count(*) FROM inspiration_wiki_private_catalog_governance_cases) AS cases,
      (SELECT count(*) FROM inspiration_wiki_private_catalog_domain_decisions) AS decisions,
      (SELECT count(*) FROM inspiration_wiki_private_internal_catalog_entries) AS entries`,
  ).get() as { cases: number; decisions: number; entries: number };
  return PrivateCatalogAdmissionReceiptSchema.parse({
    eligible: sources.length,
    policiesCreated,
    assignmentsCreated,
    casesCreated,
    decisionsCreated,
    entriesCreated,
    replayed,
    totalCases: totals.cases,
    totalDecisions: totals.decisions,
    totalEntries: totals.entries,
    admittedAt,
  });
}

export function readTeacherPrivateInternalCatalog(connection: DatabaseConnection, actor: SessionPayload) {
  readTeacherScope(connection.db, actor);
  const rows = connection.sqlite.prepare(
    `SELECT e.entry_json,r.revision_json,c.case_json
     FROM inspiration_wiki_private_internal_catalog_entries e
     JOIN inspiration_wiki_private_page_revisions r ON r.revision_id=e.page_revision_id
     JOIN inspiration_wiki_private_catalog_governance_cases c ON c.governance_case_id=e.governance_case_id
     WHERE NOT EXISTS (
       SELECT 1 FROM inspiration_wiki_private_internal_catalog_entries newer
       WHERE newer.page_id=e.page_id
         AND (newer.activated_at>e.activated_at OR (newer.activated_at=e.activated_at AND newer.entry_id>e.entry_id))
     )
     ORDER BY e.activated_at DESC,e.entry_id`,
  ).all() as Array<{ entry_json: string; revision_json: string; case_json: string }>;
  const items = rows.map((row) => {
    const entry = PrivateInternalCatalogEntrySchema.parse(parseJson(row.entry_json));
    const revision = PrivateWikiPageRevisionSchema.parse(parseJson(row.revision_json));
    const governanceCase = PrivateCatalogGovernanceCaseSchema.parse(parseJson(row.case_json));
    return {
      entryId: entry.entryId,
      pageId: entry.pageId,
      revision: entry.pageRevision,
      title: revision.content.title,
      primaryCategory: revision.content.classification.primary,
      artisticStyleLabels: revision.content.artisticStyle.labels,
      primaryPreviewUrl: revision.content.media[0]!.previewUrl,
      evidenceGapCount: revision.content.evidenceGaps.length,
      reviewerModel: governanceCase.reviewerModel,
      rightsScope: entry.rightsScope,
      activatedAt: entry.activatedAt,
    };
  });
  const meta = connection.sqlite.prepare(
    `SELECT
      (SELECT count(*) FROM inspiration_wiki_role_policies WHERE version=?) AS rolePolicies,
      (SELECT count(*) FROM inspiration_wiki_reviewer_assignments WHERE policy_version=?) AS roleAssignments,
      (SELECT count(*) FROM inspiration_wiki_private_catalog_domain_decisions) AS roleDecisions,
      (SELECT count(DISTINCT authenticated_teacher_id) FROM inspiration_wiki_private_catalog_domain_decisions) AS distinctActors`,
  ).get(POLICY_VERSION, POLICY_VERSION) as {
    rolePolicies: number;
    roleAssignments: number;
    roleDecisions: number;
    distinctActors: number;
  };
  return TeacherPrivateCatalogQueueSchema.parse({
    items,
    meta: {
      total: items.length,
      ...meta,
      strictSource: items.filter((item) => item.evidenceGapCount === 0).length,
      evidenceGapSource: items.filter((item) => item.evidenceGapCount > 0).length,
      boundary: BOUNDARY,
    },
  });
}

export function validatePrivateCatalogPolicyDocument(rawPolicy: unknown) {
  const policy = RoleDomainPolicySchema.parse(rawPolicy);
  return wikiRevisionMatches(policy.policyRevision, withoutKey(policy, "policyRevision"));
}

export type {
  PrivateCatalogGovernanceCase,
  PrivateCatalogGovernanceDecision,
  PrivateInternalCatalogEntry,
};

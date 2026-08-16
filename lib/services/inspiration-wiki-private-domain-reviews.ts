import { createHash, randomUUID } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import { readTeacherScope } from "@/lib/auth/teacher-access";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  derivePrivateDomainReviewStage,
  PrivateDomainReviewCaseIdSchema,
  PrivateDomainReviewCaseSchema,
  PrivateDomainReviewDecisionBodySchema,
  PrivateDomainReviewDecisionReceiptSchema,
  PrivateDomainReviewDomainSchema,
  PrivateDomainReviewStateSchema,
  PrivateDomainNonTeachingBaselineBodySchema,
  PrivateDomainNonTeachingBaselineReceiptSchema,
  PrivateDomainTeachingBatchBodySchema,
  PrivateDomainTeachingBatchReceiptSchema,
  TeacherPrivateDomainReviewDetailSchema,
  TeacherPrivateDomainReviewQueueSchema,
  type PrivateDomainReviewCase,
  type PrivateDomainReviewDecisionBody,
  type PrivateDomainNonTeachingBaselineBody,
  type PrivateDomainReviewState,
  type PrivateDomainTeachingBatchBody,
} from "@/lib/domain/inspiration-wiki/private-domain-review-contracts";
import { PrivateWikiDraftSchema, type PrivateWikiDraft } from "@/lib/domain/inspiration-wiki/private-draft-contracts";

type CaseRow = {
  review_case_id: string;
  draft_id: string;
  draft_revision: number;
  draft_content_hash: string;
  revision: number;
  state_hash: string;
  stage: PrivateDomainReviewCase["stage"];
  case_json: string;
  created_at: number;
  updated_at: number;
};

export class PrivateDomainReviewNotFoundError extends Error {
  constructor() { super("私有四域复核任务不存在"); this.name = "PrivateDomainReviewNotFoundError"; }
}

export class PrivateDomainReviewConflictError extends Error {
  constructor(message = "私有四域复核任务与当前草稿不一致") { super(message); this.name = "PrivateDomainReviewConflictError"; }
}

export class PrivateDomainReviewRevisionConflictError extends Error {
  constructor() { super("私有四域复核任务已被其他编辑更新"); this.name = "PrivateDomainReviewRevisionConflictError"; }
}

export class PrivateDomainReviewIdempotencyConflictError extends Error {
  constructor() { super("私有四域复核幂等键已被不同请求使用"); this.name = "PrivateDomainReviewIdempotencyConflictError"; }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function unixSeconds(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("私有四域复核时间无效");
  return Math.floor(date.getTime() / 1_000);
}
function isoSeconds(value: string | Date) { return new Date(unixSeconds(value) * 1_000).toISOString(); }
function parseJson<T>(value: string): T { return JSON.parse(value) as T; }

function calculateStateHash(rawCase: Omit<PrivateDomainReviewCase, "stateHash">) {
  return hash(stableJson(rawCase));
}

function withStateHash(rawCase: Omit<PrivateDomainReviewCase, "stateHash">) {
  return PrivateDomainReviewCaseSchema.parse({ ...rawCase, stateHash: calculateStateHash(rawCase) });
}

function initialDomains(): PrivateDomainReviewState {
  const pending = () => ({ status: "PENDING" as const, decisionId: null, reviewerId: null, note: null, decidedAt: null });
  return { CURATION: pending(), TEACHING: pending(), RIGHTS: pending(), SAFETY: pending() };
}

function reviewCaseId(draft: PrivateWikiDraft) {
  const suffix = hash(`${draft.draftId}:${draft.revision}:${draft.contentHash}`).slice(0, 32);
  return PrivateDomainReviewCaseIdSchema.parse(`private-domain-review:${suffix}`);
}

function makeInitialCase(draft: PrivateWikiDraft, preparedAt: string | Date) {
  const timestamp = isoSeconds(preparedAt);
  const domains = initialDomains();
  return withStateHash({
    schemaVersion: "lumi-inspiration-private-domain-review/v1",
    reviewCaseId: reviewCaseId(draft),
    draftBinding: {
      draftId: draft.draftId,
      candidateId: draft.candidateId,
      revision: draft.revision,
      contentHash: draft.contentHash,
    },
    revision: 1,
    stage: derivePrivateDomainReviewStage(domains),
    domains,
    reviewedDomainCount: 0,
    rightsScope: "UNKNOWN_PRIVATE_ONLY",
    createdAt: timestamp,
    updatedAt: timestamp,
    capabilityBoundary: {
      teacherPrivate: true,
      studentVisible: false,
      currentPage: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
      canonicalCompilation: "DISABLED",
    },
  });
}

export function preparePrivateDomainReviewCases(
  connection: DatabaseConnection,
  preparedAt: string | Date = new Date(),
) {
  const rows = connection.sqlite.prepare(
    `SELECT draft_json FROM inspiration_wiki_private_working_drafts
     WHERE stage = 'READY_FOR_DOMAIN_REVIEW' AND completion_count = 7
     ORDER BY draft_id`,
  ).all() as Array<{ draft_json: string }>;
  let imported = 0;
  let replayed = 0;
  connection.sqlite.transaction(() => {
    for (const row of rows) {
      const draft = PrivateWikiDraftSchema.parse(parseJson(row.draft_json));
      const reviewCase = makeInitialCase(draft, preparedAt);
      const existing = connection.sqlite.prepare(
        "SELECT case_json FROM inspiration_wiki_private_domain_review_cases WHERE review_case_id = ?",
      ).get(reviewCase.reviewCaseId) as { case_json: string } | undefined;
      if (existing) {
        const current = PrivateDomainReviewCaseSchema.parse(parseJson(existing.case_json));
        if (stableJson(current) !== stableJson(reviewCase)) throw new PrivateDomainReviewConflictError("同一草稿修订的复核任务已发生变化");
        replayed += 1;
        continue;
      }
      const recordedAt = unixSeconds(preparedAt);
      connection.sqlite.prepare(
        `INSERT INTO inspiration_wiki_private_domain_review_cases(
          review_case_id,draft_id,candidate_id,draft_revision,draft_content_hash,
          revision,state_hash,stage,domains_json,case_json,reviewed_domain_count,
          title,primary_category,primary_preview_url,rights_scope,teacher_private,
          student_visible,current_page,r2,embedding,lumi_retrieval,canonical_compilation,
          created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,'DISABLED','DISABLED','DISABLED','DISABLED','DISABLED',?,?)`,
      ).run(
        reviewCase.reviewCaseId,
        draft.draftId,
        draft.candidateId,
        draft.revision,
        draft.contentHash,
        reviewCase.revision,
        reviewCase.stateHash,
        reviewCase.stage,
        stableJson(reviewCase.domains),
        stableJson(reviewCase),
        reviewCase.reviewedDomainCount,
        draft.editable.title,
        draft.editable.classification.primary,
        draft.editable.media[0]!.previewUrl,
        reviewCase.rightsScope,
        recordedAt,
        recordedAt,
      );
      imported += 1;
    }
  }).immediate();
  return { total: rows.length, imported, replayed };
}

function readCurrentCaseRows(connection: DatabaseConnection) {
  return connection.sqlite.prepare(
    `SELECT c.case_json,d.draft_json
     FROM inspiration_wiki_private_domain_review_cases c
     JOIN inspiration_wiki_private_working_drafts d
       ON d.draft_id=c.draft_id
      AND d.revision=c.draft_revision
      AND d.content_hash=c.draft_content_hash
      AND d.stage='READY_FOR_DOMAIN_REVIEW'
     ORDER BY CASE c.stage
       WHEN 'PENDING_DOMAIN_REVIEW' THEN 0
       WHEN 'DOMAIN_REVIEW_HOLD' THEN 1
       WHEN 'PRIVATE_DRAFT_REJECTED' THEN 2
       ELSE 3 END,
       c.updated_at DESC,c.review_case_id`,
  ).all() as Array<{ case_json: string; draft_json: string }>;
}

export function readTeacherPrivateDomainReviewQueue(connection: DatabaseConnection, actor: SessionPayload) {
  readTeacherScope(connection.db, actor);
  const pairs = readCurrentCaseRows(connection).map((row) => ({
    reviewCase: PrivateDomainReviewCaseSchema.parse(parseJson(row.case_json)),
    draft: PrivateWikiDraftSchema.parse(parseJson(row.draft_json)),
  }));
  const items = pairs.map(({ reviewCase, draft }) => ({
    reviewCaseId: reviewCase.reviewCaseId,
    draftId: draft.draftId,
    candidateId: draft.candidateId,
    revision: reviewCase.revision,
    stage: reviewCase.stage,
    title: draft.editable.title,
    primaryCategory: draft.editable.classification.primary,
    artisticStyleLabels: [...draft.editable.artisticStyle.labels],
    primaryPreviewUrl: draft.editable.media[0]!.previewUrl,
    stateHash: reviewCase.stateHash,
    teaching: {
      recommendation: draft.editable.teaching.recommendation,
      rationale: draft.editable.teaching.rationale,
      prompts: [...draft.editable.teaching.prompts],
      cautions: [...draft.editable.teaching.cautions],
    },
    reviewedDomainCount: reviewCase.reviewedDomainCount,
    domains: reviewCase.domains,
    updatedAt: reviewCase.updatedAt,
  }));
  return TeacherPrivateDomainReviewQueueSchema.parse({
    items,
    meta: {
      total: items.length,
      pending: items.filter((item) => item.stage === "PENDING_DOMAIN_REVIEW").length,
      hold: items.filter((item) => item.stage === "DOMAIN_REVIEW_HOLD").length,
      rejected: items.filter((item) => item.stage === "PRIVATE_DRAFT_REJECTED").length,
      complete: items.filter((item) => item.stage === "DOMAIN_REVIEW_COMPLETE").length,
      reviewedDomains: items.reduce((sum, item) => sum + item.reviewedDomainCount, 0),
      totalDomains: items.length * 4,
      rightsUnknown: items.length,
      teachingPending: items.filter((item) => item.domains.TEACHING.status === "PENDING").length,
      teachingApproved: items.filter((item) => item.domains.TEACHING.status === "APPROVED").length,
      teachingHold: items.filter((item) => item.domains.TEACHING.status === "HOLD").length,
      teachingRejected: items.filter((item) => item.domains.TEACHING.status === "REJECTED").length,
      nonTeachingApproved: items.reduce((sum, item) => sum + (["CURATION", "RIGHTS", "SAFETY"] as const)
        .filter((domain) => item.domains[domain].status === "APPROVED").length, 0),
      nonTeachingTotal: items.length * 3,
      boundary: {
        studentVisible: false,
        currentPage: "DISABLED",
        r2: "DISABLED",
        embedding: "DISABLED",
        lumiRetrieval: "DISABLED",
        canonicalCompilation: "DISABLED",
      },
    },
  });
}

export function readTeacherPrivateDomainReviewCase(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawReviewCaseId: string,
) {
  readTeacherScope(connection.db, actor);
  const id = PrivateDomainReviewCaseIdSchema.parse(rawReviewCaseId);
  const row = connection.sqlite.prepare(
    `SELECT c.case_json,d.draft_json
     FROM inspiration_wiki_private_domain_review_cases c
     JOIN inspiration_wiki_private_working_drafts d ON d.draft_id=c.draft_id
     WHERE c.review_case_id=? AND d.revision=c.draft_revision
       AND d.content_hash=c.draft_content_hash AND d.stage='READY_FOR_DOMAIN_REVIEW'`,
  ).get(id) as { case_json: string; draft_json: string } | undefined;
  if (!row) throw new PrivateDomainReviewNotFoundError();
  return TeacherPrivateDomainReviewDetailSchema.parse({
    reviewCase: PrivateDomainReviewCaseSchema.parse(parseJson(row.case_json)),
    draft: PrivateWikiDraftSchema.parse(parseJson(row.draft_json)),
  });
}

function statusFromDecision(decision: PrivateDomainReviewDecisionBody["decision"]) {
  if (decision === "APPROVE") return "APPROVED" as const;
  if (decision === "HOLD") return "HOLD" as const;
  return "REJECTED" as const;
}

export function decideTeacherPrivateDomainReview(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawReviewCaseId: string,
  rawInput: PrivateDomainReviewDecisionBody,
  decidedAt: string | Date = new Date(),
) {
  readTeacherScope(connection.db, actor);
  const reviewCaseId = PrivateDomainReviewCaseIdSchema.parse(rawReviewCaseId);
  const input = PrivateDomainReviewDecisionBodySchema.parse(rawInput);
  const requestHash = hash(stableJson({ reviewCaseId, ...input }));
  const replay = connection.sqlite.prepare(
    `SELECT id,request_hash,next_case_json,created_at
     FROM inspiration_wiki_private_domain_review_decisions
     WHERE reviewer_id=? AND idempotency_key=?`,
  ).get(actor.userId, input.idempotencyKey) as { id: string; request_hash: string; next_case_json: string; created_at: number } | undefined;
  if (replay) {
    if (replay.request_hash !== requestHash) throw new PrivateDomainReviewIdempotencyConflictError();
    const next = PrivateDomainReviewCaseSchema.parse(parseJson(replay.next_case_json));
    return PrivateDomainReviewDecisionReceiptSchema.parse({
      reviewCaseId,
      decisionId: replay.id,
      revision: next.revision,
      stage: next.stage,
      replayed: true,
      decidedAt: new Date(replay.created_at * 1_000).toISOString(),
    });
  }
  const row = connection.sqlite.prepare(
    `SELECT c.*,d.stage AS draft_stage,d.revision AS current_draft_revision,
            d.content_hash AS current_draft_content_hash
     FROM inspiration_wiki_private_domain_review_cases c
     JOIN inspiration_wiki_private_working_drafts d ON d.draft_id=c.draft_id
     WHERE c.review_case_id=?`,
  ).get(reviewCaseId) as (CaseRow & {
    draft_stage: string;
    current_draft_revision: number;
    current_draft_content_hash: string;
  }) | undefined;
  if (!row) throw new PrivateDomainReviewNotFoundError();
  if (row.revision !== input.expectedRevision || row.state_hash !== input.expectedStateHash) throw new PrivateDomainReviewRevisionConflictError();
  if (row.draft_stage !== "READY_FOR_DOMAIN_REVIEW"
    || row.current_draft_revision !== row.draft_revision
    || row.current_draft_content_hash !== row.draft_content_hash) {
    throw new PrivateDomainReviewConflictError("草稿已经重新编辑，请从最新草稿重新送审");
  }
  const current = PrivateDomainReviewCaseSchema.parse(parseJson(row.case_json));
  const timestamp = isoSeconds(decidedAt);
  const decisionId = `private-domain-decision:${randomUUID()}`;
  const previousDomain = current.domains[input.reviewDomain];
  const domains = PrivateDomainReviewStateSchema.parse({
    ...current.domains,
    [input.reviewDomain]: {
      status: statusFromDecision(input.decision),
      decisionId,
      reviewerId: actor.userId,
      note: input.note || null,
      decidedAt: timestamp,
    },
  });
  const next = withStateHash({
    ...current,
    revision: current.revision + 1,
    stage: derivePrivateDomainReviewStage(domains),
    domains,
    reviewedDomainCount: PrivateDomainReviewDomainSchema.options.filter((domain) => domains[domain].status !== "PENDING").length,
    updatedAt: timestamp,
  });
  const currentJson = stableJson(current);
  const nextJson = stableJson(next);
  const recordedAt = unixSeconds(decidedAt);
  connection.sqlite.transaction(() => {
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_private_domain_review_decisions(
        id,review_case_id,previous_case_revision,next_case_revision,review_domain,
        decision,assessment_json,note,reviewer_id,previous_stage,next_stage,
        previous_state_hash,next_state_hash,supersedes_decision_id,idempotency_key,
        request_hash,previous_case_json,next_case_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      decisionId,
      reviewCaseId,
      current.revision,
      next.revision,
      input.reviewDomain,
      input.decision,
      stableJson(input.assessment),
      input.note,
      actor.userId,
      current.stage,
      next.stage,
      current.stateHash,
      next.stateHash,
      previousDomain.decisionId,
      input.idempotencyKey,
      requestHash,
      currentJson,
      nextJson,
      recordedAt,
    );
    const result = connection.sqlite.prepare(
      `UPDATE inspiration_wiki_private_domain_review_cases SET
        revision=?,state_hash=?,stage=?,domains_json=?,case_json=?,
        reviewed_domain_count=?,updated_at=?
       WHERE review_case_id=? AND revision=? AND state_hash=?`,
    ).run(
      next.revision,
      next.stateHash,
      next.stage,
      stableJson(next.domains),
      nextJson,
      next.reviewedDomainCount,
      recordedAt,
      reviewCaseId,
      input.expectedRevision,
      input.expectedStateHash,
    );
    if (result.changes !== 1) throw new PrivateDomainReviewRevisionConflictError();
  }).immediate();
  return PrivateDomainReviewDecisionReceiptSchema.parse({
    reviewCaseId,
    decisionId,
    revision: next.revision,
    stage: next.stage,
    replayed: false,
    decidedAt: timestamp,
  });
}

const nonTeachingAssessments = {
  CURATION: { domain: "CURATION", representativeValue: "YES", redundancyAcceptable: "YES" },
  RIGHTS: { domain: "RIGHTS", rightsState: "UNKNOWN", privateUseOnlyAcknowledged: true, formalRepublicationAllowed: false },
  SAFETY: { domain: "SAFETY", privacyRisk: "CLEAR", sensitiveContent: "CLEAR" },
} as const;

export function approveTeacherPrivateNonTeachingDomains(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: PrivateDomainNonTeachingBaselineBody,
  decidedAt: string | Date = new Date(),
) {
  readTeacherScope(connection.db, actor);
  const input = PrivateDomainNonTeachingBaselineBodySchema.parse(rawInput);
  const timestamp = isoSeconds(decidedAt);
  const caseIds = readCurrentCaseRows(connection).map((row) => PrivateDomainReviewCaseSchema.parse(parseJson(row.case_json)).reviewCaseId);
  let decisionsCreated = 0;
  let alreadyDecided = 0;

  connection.sqlite.transaction(() => {
    for (const reviewCaseId of caseIds) {
      for (const reviewDomain of ["CURATION", "RIGHTS", "SAFETY"] as const) {
        const row = connection.sqlite.prepare(
          "SELECT case_json FROM inspiration_wiki_private_domain_review_cases WHERE review_case_id=?",
        ).get(reviewCaseId) as { case_json: string } | undefined;
        if (!row) throw new PrivateDomainReviewNotFoundError();
        const current = PrivateDomainReviewCaseSchema.parse(parseJson(row.case_json));
        if (current.domains[reviewDomain].status !== "PENDING") {
          alreadyDecided += 1;
          continue;
        }
        decideTeacherPrivateDomainReview(connection, actor, reviewCaseId, {
          expectedRevision: current.revision,
          expectedStateHash: current.stateHash,
          reviewDomain,
          decision: "APPROVE",
          assessment: nonTeachingAssessments[reviewDomain],
          note: "按教师本批确认：策展、权利与安全无异常，本轮仅继续教学域复核。",
          idempotencyKey: `non-teaching-${hash(`${input.idempotencyKey}:${reviewCaseId}:${reviewDomain}`).slice(0, 48)}`,
        }, timestamp);
        decisionsCreated += 1;
      }
    }
  }).immediate();

  const remainingPendingDomains = readCurrentCaseRows(connection).reduce((sum, row) => {
    const reviewCase = PrivateDomainReviewCaseSchema.parse(parseJson(row.case_json));
    return sum + (["CURATION", "RIGHTS", "SAFETY"] as const).filter((domain) => reviewCase.domains[domain].status === "PENDING").length;
  }, 0);
  return PrivateDomainNonTeachingBaselineReceiptSchema.parse({
    totalCases: caseIds.length,
    decisionsCreated,
    alreadyDecided,
    remainingPendingDomains,
    decidedAt: timestamp,
  });
}

const teachingIssueLabels = {
  TEACHING_VALUE_UNCLEAR: "教学目标或价值不够明确",
  PROMPTS_NEED_ADJUSTMENT: "课堂问题需要调整",
  CAUTIONS_INSUFFICIENT: "教学提醒不够充分",
} as const;

function teachingAssessment(item: PrivateDomainTeachingBatchBody["items"][number]) {
  if (item.decision === "APPROVE") {
    return { domain: "TEACHING", teachingValue: "YES", promptsUsable: "YES", cautionsClear: "YES" } as const;
  }
  if (item.decision === "REJECT") {
    return { domain: "TEACHING", teachingValue: "NO", promptsUsable: "NO", cautionsClear: "NO" } as const;
  }
  const issues = new Set(item.issueKeys);
  return {
    domain: "TEACHING" as const,
    teachingValue: issues.has("TEACHING_VALUE_UNCLEAR") ? "UNCERTAIN" as const : "YES" as const,
    promptsUsable: issues.has("PROMPTS_NEED_ADJUSTMENT") ? "UNCERTAIN" as const : "YES" as const,
    cautionsClear: issues.has("CAUTIONS_INSUFFICIENT") ? "UNCERTAIN" as const : "YES" as const,
  };
}

export function decideTeacherPrivateTeachingBatch(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: PrivateDomainTeachingBatchBody,
  decidedAt: string | Date = new Date(),
) {
  readTeacherScope(connection.db, actor);
  const input = PrivateDomainTeachingBatchBodySchema.parse(rawInput);
  const timestamp = isoSeconds(decidedAt);
  const receipts: Array<ReturnType<typeof decideTeacherPrivateDomainReview>> = [];
  connection.sqlite.transaction(() => {
    for (const item of input.items) {
      const generatedNote = item.decision === "HOLD" && !item.note
        ? `需调整：${item.issueKeys.map((key) => teachingIssueLabels[key]).join("；")}`
        : item.note;
      receipts.push(decideTeacherPrivateDomainReview(connection, actor, item.reviewCaseId, {
        expectedRevision: item.expectedRevision,
        expectedStateHash: item.expectedStateHash,
        reviewDomain: "TEACHING",
        decision: item.decision,
        assessment: teachingAssessment(item),
        note: generatedNote,
        idempotencyKey: `teaching-batch-${hash(`${input.idempotencyKey}:${item.reviewCaseId}`).slice(0, 48)}`,
      }, timestamp));
    }
  }).immediate();
  return PrivateDomainTeachingBatchReceiptSchema.parse({
    receipts,
    summary: {
      total: input.items.length,
      approved: input.items.filter((item) => item.decision === "APPROVE").length,
      held: input.items.filter((item) => item.decision === "HOLD").length,
      rejected: input.items.filter((item) => item.decision === "REJECT").length,
      replayed: receipts.filter((receipt) => receipt.replayed).length,
    },
  });
}

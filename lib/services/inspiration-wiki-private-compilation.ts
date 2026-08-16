import { createHash } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import { readTeacherScope } from "@/lib/auth/teacher-access";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  PrivateCompilationReceiptSchema,
  PrivateCompiledPageContentSchema,
  PrivateCompiledTruthIdSchema,
  PrivateCompiledTruthSchema,
  PrivateWikiPageIdSchema,
  PrivateWikiPageRevisionIdSchema,
  PrivateWikiPageRevisionSchema,
  PrivateWikiPageSchema,
  TeacherPrivateWikiPageDetailSchema,
  TeacherPrivateWikiPageQueueSchema,
  type PrivateCompiledPageContent,
  type PrivateCompiledTruth,
  type PrivateWikiPageRevision,
} from "@/lib/domain/inspiration-wiki/private-compilation-contracts";
import { PrivateDomainReviewCaseSchema, type PrivateDomainReviewCase } from "@/lib/domain/inspiration-wiki/private-domain-review-contracts";
import { PrivateWikiDraftSchema, type PrivateWikiDraft } from "@/lib/domain/inspiration-wiki/private-draft-contracts";

const BOUNDARY = {
  teacherPrivate: true,
  studentVisible: false,
  privateCompilation: "ENABLED" as const,
  canonicalCompilation: "DISABLED" as const,
  currentPage: "DISABLED" as const,
  formalRelease: "DISABLED" as const,
  r2: "DISABLED" as const,
  embedding: "DISABLED" as const,
  lumiRetrieval: "DISABLED" as const,
};

type EligibleRow = { case_json: string; draft_json: string };

export class PrivateWikiPageNotFoundError extends Error {
  constructor() { super("教师私有编纂页不存在"); this.name = "PrivateWikiPageNotFoundError"; }
}

export class PrivateWikiCompilationConflictError extends Error {
  constructor(message = "私有编纂输入与当前审核结果不一致") { super(message); this.name = "PrivateWikiCompilationConflictError"; }
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

function hash(value: unknown) { return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex"); }
function parseJson<T>(value: string): T { return JSON.parse(value) as T; }
function unixSeconds(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("私有编纂时间无效");
  return Math.floor(date.getTime() / 1_000);
}
function isoSeconds(value: string | Date) { return new Date(unixSeconds(value) * 1_000).toISOString(); }

function suffix(candidateId: string) {
  const value = candidateId.split(":")[1];
  if (!value) throw new PrivateWikiCompilationConflictError("候选身份无效");
  return value;
}

function decisionIds(reviewCase: PrivateDomainReviewCase) {
  const ids = {
    CURATION: reviewCase.domains.CURATION.decisionId,
    TEACHING: reviewCase.domains.TEACHING.decisionId,
    RIGHTS: reviewCase.domains.RIGHTS.decisionId,
    SAFETY: reviewCase.domains.SAFETY.decisionId,
  };
  if (Object.values(ids).some((id) => id === null)) throw new PrivateWikiCompilationConflictError("四域决定绑定不完整");
  return ids as Record<keyof typeof ids, string>;
}

function verifyEligible(connection: DatabaseConnection, draft: PrivateWikiDraft, reviewCase: PrivateDomainReviewCase) {
  if (reviewCase.stage !== "DOMAIN_REVIEW_COMPLETE" || reviewCase.reviewedDomainCount !== 4) throw new PrivateWikiCompilationConflictError("仅四域完成项可编译");
  if (Object.values(reviewCase.domains).some((domain) => domain.status !== "APPROVED")) throw new PrivateWikiCompilationConflictError("私有编纂要求四域全部通过");
  if (draft.stage !== "READY_FOR_DOMAIN_REVIEW" || !draft.completion.ready) throw new PrivateWikiCompilationConflictError("源草稿尚未完成编纂");
  if (reviewCase.draftBinding.draftId !== draft.draftId || reviewCase.draftBinding.candidateId !== draft.candidateId
    || reviewCase.draftBinding.revision !== draft.revision || reviewCase.draftBinding.contentHash !== draft.contentHash) {
    throw new PrivateWikiCompilationConflictError("复核任务没有绑定当前草稿修订");
  }
  const ids = decisionIds(reviewCase);
  for (const [domain, id] of Object.entries(ids)) {
    const row = connection.sqlite.prepare(
      `SELECT review_domain,decision,next_case_json FROM inspiration_wiki_private_domain_review_decisions
       WHERE id=? AND review_case_id=?`,
    ).get(id, reviewCase.reviewCaseId) as { review_domain: string; decision: string; next_case_json: string } | undefined;
    if (!row || row.review_domain !== domain || row.decision !== "APPROVE") throw new PrivateWikiCompilationConflictError(`四域决定 ${domain} 不可验证`);
    const decidedCase = PrivateDomainReviewCaseSchema.parse(parseJson(row.next_case_json));
    if (decidedCase.domains[domain as keyof typeof ids].decisionId !== id) throw new PrivateWikiCompilationConflictError(`四域决定 ${domain} 快照不一致`);
  }
  return ids;
}

function compileContent(draft: PrivateWikiDraft): PrivateCompiledPageContent {
  const facets = [...new Set([
    draft.editable.classification.primary,
    ...draft.editable.classification.secondary,
    ...draft.editable.artisticStyle.labels,
  ].filter(Boolean))];
  return PrivateCompiledPageContentSchema.parse({
    pageType: "INSPIRATION_CASE",
    title: draft.editable.title,
    summary: draft.editable.summary,
    classification: draft.editable.classification,
    artisticStyle: draft.editable.artisticStyle,
    facets,
    curation: draft.editable.curation,
    teaching: draft.editable.teaching,
    media: draft.editable.media,
    work: draft.work,
    sourceRecords: draft.sourceRecords,
    rights: draft.rights,
    visualObservations: draft.visualObservations,
    duplicateRelationship: draft.duplicateRelationship,
    safety: draft.safety,
    evidenceGaps: draft.evidenceGaps,
    editorialNote: draft.editable.editorialNote,
  });
}

function makeRevision(
  draft: PrivateWikiDraft,
  reviewCase: PrivateDomainReviewCase,
  revision: number,
  compiledAt: string,
  ids: ReturnType<typeof decisionIds>,
) {
  const idSuffix = suffix(draft.candidateId);
  const content = compileContent(draft);
  const raw = {
    schemaVersion: "lumi-inspiration-private-page-revision/v1" as const,
    revisionId: PrivateWikiPageRevisionIdSchema.parse(`private-wiki-page-revision:${idSuffix}:${revision}`),
    pageId: PrivateWikiPageIdSchema.parse(`private-wiki-page:${idSuffix}`),
    candidateId: draft.candidateId,
    revision,
    sourceBinding: {
      draftId: draft.draftId,
      draftRevision: draft.revision,
      draftContentHash: draft.contentHash,
      reviewCaseId: reviewCase.reviewCaseId,
      reviewCaseRevision: reviewCase.revision,
      reviewStateHash: reviewCase.stateHash,
      decisionIds: ids,
    },
    compilationState: "PRIVATE_COMPILED_PREVIEW" as const,
    compiledAt,
    contentHash: hash(content),
    content,
    capabilityBoundary: BOUNDARY,
  };
  return PrivateWikiPageRevisionSchema.parse({ ...raw, revisionHash: hash(raw) });
}

function makeTruth(revision: PrivateWikiPageRevision) {
  const raw = {
    schemaVersion: "lumi-inspiration-private-compiled-truth/v1" as const,
    truthId: PrivateCompiledTruthIdSchema.parse(`private-compiled-truth:${suffix(revision.candidateId)}:${revision.revision}`),
    state: "PRIVATE_COMPILED_PREVIEW" as const,
    pageId: revision.pageId,
    pageRevision: {
      revisionId: revision.revisionId,
      revision: revision.revision,
      revisionHash: revision.revisionHash,
    },
    sourceDecisionIds: revision.sourceBinding.decisionIds,
    rightsScope: "UNKNOWN_PRIVATE_ONLY" as const,
    contentHash: revision.contentHash,
    compiledAt: revision.compiledAt,
    content: revision.content,
    capabilityBoundary: BOUNDARY,
  };
  return PrivateCompiledTruthSchema.parse({ ...raw, truthHash: hash(raw) });
}

function makePage(revision: PrivateWikiPageRevision, truth: PrivateCompiledTruth, createdAt: string) {
  return PrivateWikiPageSchema.parse({
    schemaVersion: "lumi-inspiration-private-wiki-page/v1",
    pageId: revision.pageId,
    candidateId: revision.candidateId,
    pageType: "INSPIRATION_CASE",
    state: "PRIVATE_COMPILED",
    title: revision.content.title,
    latestPrivateRevision: { revisionId: revision.revisionId, revision: revision.revision, revisionHash: revision.revisionHash },
    latestPrivateTruth: { truthId: truth.truthId, truthHash: truth.truthHash },
    rightsScope: "UNKNOWN_PRIVATE_ONLY",
    createdAt,
    updatedAt: revision.compiledAt,
    capabilityBoundary: BOUNDARY,
  });
}

function sameSource(left: PrivateWikiPageRevision, draft: PrivateWikiDraft, reviewCase: PrivateDomainReviewCase, content: PrivateCompiledPageContent) {
  return left.sourceBinding.draftId === draft.draftId
    && left.sourceBinding.draftRevision === draft.revision
    && left.sourceBinding.draftContentHash === draft.contentHash
    && left.sourceBinding.reviewCaseId === reviewCase.reviewCaseId
    && left.sourceBinding.reviewCaseRevision === reviewCase.revision
    && left.sourceBinding.reviewStateHash === reviewCase.stateHash
    && left.contentHash === hash(content);
}

function persistCompilation(connection: DatabaseConnection, draft: PrivateWikiDraft, reviewCase: PrivateDomainReviewCase, compiledAt: string) {
  const ids = verifyEligible(connection, draft, reviewCase);
  const pageId = PrivateWikiPageIdSchema.parse(`private-wiki-page:${suffix(draft.candidateId)}`);
  const existingRow = connection.sqlite.prepare(
    "SELECT page_json,revision_count,created_at FROM inspiration_wiki_private_pages WHERE page_id=?",
  ).get(pageId) as { page_json: string; revision_count: number; created_at: number } | undefined;
  const existing = existingRow ? PrivateWikiPageSchema.parse(parseJson(existingRow.page_json)) : null;
  if (existing && existing.candidateId !== draft.candidateId) throw new PrivateWikiCompilationConflictError("私有 Page 身份碰撞");
  if (existing) {
    const currentRow = connection.sqlite.prepare(
      "SELECT revision_json FROM inspiration_wiki_private_page_revisions WHERE revision_id=?",
    ).get(existing.latestPrivateRevision.revisionId) as { revision_json: string } | undefined;
    if (!currentRow) throw new PrivateWikiCompilationConflictError("私有 Page 最新修订缺失");
    const current = PrivateWikiPageRevisionSchema.parse(parseJson(currentRow.revision_json));
    if (sameSource(current, draft, reviewCase, compileContent(draft))) return "REPLAYED" as const;
  }
  const revisionNumber = (existingRow?.revision_count ?? 0) + 1;
  const revision = makeRevision(draft, reviewCase, revisionNumber, compiledAt, ids);
  const truth = makeTruth(revision);
  const createdAt = existing?.createdAt ?? compiledAt;
  const page = makePage(revision, truth, createdAt);
  const recordedAt = unixSeconds(compiledAt);
  if (!existing) {
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_private_pages(
        page_id,candidate_id,page_type,state,title,latest_revision_id,latest_truth_id,
        revision_count,rights_scope,page_json,teacher_private,student_visible,
        private_compilation,canonical_compilation,current_page,formal_release,r2,
        embedding,lumi_retrieval,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,1,0,'ENABLED','DISABLED','DISABLED','DISABLED','DISABLED','DISABLED','DISABLED',?,?)`,
    ).run(page.pageId, page.candidateId, page.pageType, page.state, page.title, revision.revisionId, truth.truthId,
      revisionNumber, page.rightsScope, stableJson(page), recordedAt, recordedAt);
  }
  connection.sqlite.prepare(
    `INSERT INTO inspiration_wiki_private_page_revisions(
      revision_id,page_id,candidate_id,revision,revision_hash,content_hash,draft_id,
      draft_revision,draft_content_hash,review_case_id,review_case_revision,
      review_state_hash,decision_ids_json,content_json,revision_json,compiled_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(revision.revisionId, revision.pageId, revision.candidateId, revision.revision, revision.revisionHash,
    revision.contentHash, revision.sourceBinding.draftId, revision.sourceBinding.draftRevision,
    revision.sourceBinding.draftContentHash, revision.sourceBinding.reviewCaseId,
    revision.sourceBinding.reviewCaseRevision, revision.sourceBinding.reviewStateHash,
    stableJson(revision.sourceBinding.decisionIds), stableJson(revision.content), stableJson(revision), recordedAt);
  connection.sqlite.prepare(
    `INSERT INTO inspiration_wiki_private_compiled_truths(
      truth_id,page_id,revision_id,truth_hash,content_hash,state,rights_scope,truth_json,
      teacher_private,student_visible,canonical_compilation,current_page,formal_release,
      r2,embedding,lumi_retrieval,compiled_at
    ) VALUES(?,?,?,?,?,?,?, ?,1,0,'DISABLED','DISABLED','DISABLED','DISABLED','DISABLED','DISABLED',?)`,
  ).run(truth.truthId, truth.pageId, revision.revisionId, truth.truthHash, truth.contentHash,
    truth.state, truth.rightsScope, stableJson(truth), recordedAt);
  if (existing) {
    const result = connection.sqlite.prepare(
      `UPDATE inspiration_wiki_private_pages SET title=?,latest_revision_id=?,latest_truth_id=?,
       revision_count=?,page_json=?,updated_at=? WHERE page_id=? AND revision_count=?`,
    ).run(page.title, revision.revisionId, truth.truthId, revisionNumber, stableJson(page), recordedAt, page.pageId, existingRow?.revision_count);
    if (result.changes !== 1) throw new PrivateWikiCompilationConflictError("私有 Page 已被其他编译更新");
    return "REVISED" as const;
  }
  return "CREATED" as const;
}

export function compileEligiblePrivateWikiPages(connection: DatabaseConnection, at: string | Date = new Date()) {
  const compiledAt = isoSeconds(at);
  const rows = connection.sqlite.prepare(
    `SELECT c.case_json,d.draft_json
     FROM inspiration_wiki_private_domain_review_cases c
     JOIN inspiration_wiki_private_working_drafts d ON d.draft_id=c.draft_id
     WHERE c.stage='DOMAIN_REVIEW_COMPLETE'
     ORDER BY c.candidate_id`,
  ).all() as EligibleRow[];
  let created = 0;
  let revised = 0;
  let replayed = 0;
  connection.sqlite.transaction(() => {
    for (const row of rows) {
      const result = persistCompilation(
        connection,
        PrivateWikiDraftSchema.parse(parseJson(row.draft_json)),
        PrivateDomainReviewCaseSchema.parse(parseJson(row.case_json)),
        compiledAt,
      );
      if (result === "CREATED") created += 1;
      else if (result === "REVISED") revised += 1;
      else replayed += 1;
    }
  }).immediate();
  const totals = connection.sqlite.prepare(
    `SELECT
      (SELECT count(*) FROM inspiration_wiki_private_pages) AS pages,
      (SELECT count(*) FROM inspiration_wiki_private_page_revisions) AS revisions,
      (SELECT count(*) FROM inspiration_wiki_private_compiled_truths) AS truths`,
  ).get() as { pages: number; revisions: number; truths: number };
  return PrivateCompilationReceiptSchema.parse({
    eligible: rows.length,
    created,
    revised,
    replayed,
    totalPages: totals.pages,
    totalRevisions: totals.revisions,
    totalCompiledTruths: totals.truths,
    compiledAt,
  });
}

export function readTeacherPrivateWikiPageQueue(connection: DatabaseConnection, actor: SessionPayload) {
  readTeacherScope(connection.db, actor);
  const rows = connection.sqlite.prepare(
    `SELECT p.page_json,r.revision_json
     FROM inspiration_wiki_private_pages p
     JOIN inspiration_wiki_private_page_revisions r ON r.revision_id=p.latest_revision_id
     ORDER BY p.updated_at DESC,p.page_id`,
  ).all() as Array<{ page_json: string; revision_json: string }>;
  const items = rows.map((row) => {
    const page = PrivateWikiPageSchema.parse(parseJson(row.page_json));
    const revision = PrivateWikiPageRevisionSchema.parse(parseJson(row.revision_json));
    return {
      pageId: page.pageId,
      candidateId: page.candidateId,
      revisionId: revision.revisionId,
      revision: revision.revision,
      title: revision.content.title,
      primaryCategory: revision.content.classification.primary,
      artisticStyleLabels: revision.content.artisticStyle.labels,
      primaryPreviewUrl: revision.content.media[0]?.previewUrl,
      evidenceGapCount: revision.content.evidenceGaps.length,
      compiledAt: revision.compiledAt,
    };
  });
  const totals = connection.sqlite.prepare(
    `SELECT
      (SELECT count(*) FROM inspiration_wiki_private_page_revisions) AS revisions,
      (SELECT count(*) FROM inspiration_wiki_private_compiled_truths) AS truths`,
  ).get() as { revisions: number; truths: number };
  return TeacherPrivateWikiPageQueueSchema.parse({
    items,
    meta: {
      total: items.length,
      revisions: totals.revisions,
      compiledTruths: totals.truths,
      rightsUnknown: items.length,
      strictSource: items.filter((item) => item.evidenceGapCount === 0).length,
      evidenceGapSource: items.filter((item) => item.evidenceGapCount > 0).length,
      boundary: BOUNDARY,
    },
  });
}

export function readTeacherPrivateWikiPage(connection: DatabaseConnection, actor: SessionPayload, rawPageId: string) {
  readTeacherScope(connection.db, actor);
  const pageId = PrivateWikiPageIdSchema.parse(rawPageId);
  const row = connection.sqlite.prepare(
    `SELECT p.page_json,r.revision_json,t.truth_json
     FROM inspiration_wiki_private_pages p
     JOIN inspiration_wiki_private_page_revisions r ON r.revision_id=p.latest_revision_id
     JOIN inspiration_wiki_private_compiled_truths t ON t.truth_id=p.latest_truth_id
     WHERE p.page_id=?`,
  ).get(pageId) as { page_json: string; revision_json: string; truth_json: string } | undefined;
  if (!row) throw new PrivateWikiPageNotFoundError();
  return TeacherPrivateWikiPageDetailSchema.parse({
    page: PrivateWikiPageSchema.parse(parseJson(row.page_json)),
    revision: PrivateWikiPageRevisionSchema.parse(parseJson(row.revision_json)),
    compiledTruth: PrivateCompiledTruthSchema.parse(parseJson(row.truth_json)),
  });
}

import { createHash, randomUUID } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import { readTeacherScope } from "@/lib/auth/teacher-access";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  PrivateWikiDraftIdSchema,
  PrivateWikiDraftBatchReadyBodySchema,
  PrivateWikiDraftSchema,
  PrivateWikiDraftUpdateBodySchema,
  TeacherPrivateWikiDraftQueueSchema,
  privateDraftCompletion,
  type PrivateWikiDraft,
  type PrivateWikiDraftEditable,
  type PrivateWikiDraftUpdateBody,
} from "@/lib/domain/inspiration-wiki/private-draft-contracts";
import { evidenceGapRequirementKeys, EvidenceGapReviewPackSchema } from "@/lib/domain/inspiration-wiki/evidence-gap-review-contracts";
import { StrictReviewPackSchema } from "@/lib/domain/inspiration-wiki/review-pack-contracts";
import { localizeReviewPackForTeacher } from "@/components/teacher/inspiration-review-copy.zh-CN";

type DraftRow = {
  draft_id: string;
  candidate_id: string;
  source_review_pack_id: string;
  source_contract_kind: "STRICT_REVIEW_PACK" | "EVIDENCE_GAP_REVIEW";
  source_review_revision: number;
  source_decision_id: string;
  revision: number;
  stage: "EDITING" | "READY_FOR_DOMAIN_REVIEW";
  content_hash: string;
  draft_json: string;
  title: string;
  primary_category: string;
  completion_count: number;
  primary_preview_url: string;
  rights_status: "UNKNOWN";
  created_at: number;
  updated_at: number;
};

type DecisionRow = {
  id: string;
  review_pack_revision: number;
  final_action: string;
  next_stage: string;
  accepted_gap_keys_json?: string;
};

export class PrivateWikiDraftNotFoundError extends Error {
  constructor() { super("私有 WikiDraft 不存在"); this.name = "PrivateWikiDraftNotFoundError"; }
}

export class PrivateWikiDraftConflictError extends Error {
  constructor(message = "私有 WikiDraft 与当前物料冲突") { super(message); this.name = "PrivateWikiDraftConflictError"; }
}

export class PrivateWikiDraftRevisionConflictError extends Error {
  constructor() { super("私有 WikiDraft 已被其他编辑更新"); this.name = "PrivateWikiDraftRevisionConflictError"; }
}

export class PrivateWikiDraftIdempotencyConflictError extends Error {
  constructor() { super("私有 WikiDraft 幂等键已被不同请求使用"); this.name = "PrivateWikiDraftIdempotencyConflictError"; }
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

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function unixSeconds(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("私有 WikiDraft 时间无效");
  return Math.floor(date.getTime() / 1_000);
}

function isoSeconds(value: string | Date) {
  return new Date(unixSeconds(value) * 1_000).toISOString();
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function calculatePrivateWikiDraftContentHash(rawDraft: Omit<PrivateWikiDraft, "contentHash">) {
  return hash(stableJson(rawDraft));
}

function withContentHash(rawDraft: Omit<PrivateWikiDraft, "contentHash">) {
  return PrivateWikiDraftSchema.parse({
    ...rawDraft,
    contentHash: calculatePrivateWikiDraftContentHash(rawDraft),
  });
}

function draftId(candidateId: string) {
  return PrivateWikiDraftIdSchema.parse(`private-wiki-draft:${candidateId.split(":")[1]}`);
}

function inferArtisticStyle(primary: string, secondary: readonly string[], summary: string) {
  const corpus = `${primary} ${secondary.join(" ")} ${summary}`.toLowerCase();
  const labels: string[] = [];
  const add = (label: string, pattern: RegExp) => { if (pattern.test(corpus) && labels.length < 2) labels.push(label); };
  add("实验字体", /字体|排版|typ|wordmark|letter|字标/);
  add("手绘插画", /插画|手绘|illustr|线描|笔触/);
  add("摄影叙事", /摄影|photo|人物|场景/);
  add("拼贴艺术", /拼贴|collage|叠加|遮挡/);
  add("几何抽象", /几何|geometric|网格|色块/);
  add("空间叙事", /空间|导视|建筑|signage|wayfinding/);
  if (labels.length === 0) labels.push(/极简|minimal|留白/.test(corpus) ? "极简主义" : "符号图形");
  return {
    labels,
    rationale: `依据已通过教师审核的“${primary}”分类及受控图视觉描述，将${labels.join("、")}作为私有编纂阶段的艺术表现风格标签。`,
  };
}

function currentStrictDecision(connection: DatabaseConnection, reviewPackId: string) {
  return connection.sqlite.prepare(
    `SELECT id, review_pack_revision, final_action, next_stage
     FROM inspiration_wiki_review_pack_decisions
     WHERE review_pack_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).get(reviewPackId) as DecisionRow | undefined;
}

function currentGapDecision(connection: DatabaseConnection, reviewPackId: string) {
  return connection.sqlite.prepare(
    `SELECT id, review_pack_revision, final_action, next_stage, accepted_gap_keys_json
     FROM inspiration_wiki_evidence_gap_review_decisions
     WHERE review_pack_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).get(reviewPackId) as DecisionRow | undefined;
}

function strictDraft(connection: DatabaseConnection, row: { review_pack_id: string; candidate_id: string; pack_json: string }, updatedAt: string) {
  const decision = currentStrictDecision(connection, row.review_pack_id);
  if (!decision || decision.final_action !== "ENTER_PRIVATE_WIKIDRAFT" || decision.next_stage !== "PRIVATE_WIKIDRAFT") {
    throw new PrivateWikiDraftConflictError("严格审核包缺少当前私有草稿决定");
  }
  const pack = localizeReviewPackForTeacher(StrictReviewPackSchema.parse(parseJson(row.pack_json)));
  const style = inferArtisticStyle(
    pack.normalizedClassification.primary,
    pack.normalizedClassification.secondary,
    pack.visualDescription.summary,
  );
  const editable: PrivateWikiDraftEditable = {
    title: pack.work.title,
    summary: pack.visualDescription.summary,
    classification: {
      primary: pack.normalizedClassification.primary,
      secondary: [...pack.normalizedClassification.secondary],
    },
    artisticStyle: style,
    curation: { ...pack.curationRecommendation },
    teaching: { ...pack.teachingRecommendation },
    media: pack.mediaGroup.map((media) => ({ ...media })),
    editorialNote: "",
  };
  return withContentHash({
    schemaVersion: "lumi-inspiration-private-working-draft/v1",
    draftId: draftId(row.candidate_id),
    candidateId: row.candidate_id,
    sourceReview: {
      contractKind: "STRICT_REVIEW_PACK",
      reviewPackId: row.review_pack_id,
      reviewPackRevision: decision.review_pack_revision,
      decisionId: decision.id,
      decisionAction: "ENTER_PRIVATE_WIKIDRAFT",
      acceptedGapKeys: [],
    },
    revision: 1,
    stage: "EDITING",
    updatedAt,
    editable,
    work: { creators: [...pack.work.creators], year: pack.work.year },
    sourceRecords: pack.sources.map((source) => ({
      sourceId: source.sourceId,
      platform: source.platform,
      pageUrl: source.pageUrl,
      role: source.role,
      creatorName: source.creatorName,
      curatorName: source.curatorName,
    })),
    rights: {
      status: "UNKNOWN",
      evidenceSummaries: pack.rightsEvidence.map((evidence) => evidence.summary),
      formalRepublicationAllowed: false,
    },
    visualObservations: pack.visualDescription.observations.map((observation) => ({ ...observation, mediaIds: [...observation.mediaIds] })),
    duplicateRelationship: { ...pack.duplicateRelationship, relatedCandidateIds: [...pack.duplicateRelationship.relatedCandidateIds] },
    safety: { ...pack.safetyAssessment, evidence: [...pack.safetyAssessment.evidence] },
    evidenceGaps: [],
    completion: privateDraftCompletion(editable),
    capabilityBoundary: {
      teacherPrivate: true,
      studentVisible: false,
      currentPage: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
    },
  });
}

function gapDraft(connection: DatabaseConnection, row: { review_pack_id: string; candidate_id: string; pack_json: string }, updatedAt: string) {
  const decision = currentGapDecision(connection, row.review_pack_id);
  if (!decision || decision.final_action !== "ENTER_PRIVATE_WIKIDRAFT" || decision.next_stage !== "PRIVATE_WIKIDRAFT_WITH_GAPS") {
    throw new PrivateWikiDraftConflictError("缺证审核包缺少当前私有草稿决定");
  }
  const pack = EvidenceGapReviewPackSchema.parse(parseJson(row.pack_json));
  const style = pack.visualDescription.artisticStyle ?? inferArtisticStyle(
    pack.normalizedClassification.primary ?? "视觉设计",
    pack.normalizedClassification.secondary,
    pack.visualDescription.summary ?? "受控图片已完成教师审核",
  );
  const editable: PrivateWikiDraftEditable = {
    title: pack.work.title ?? "未命名灵感案例",
    summary: pack.visualDescription.summary ?? "受控图已进入教师私有编纂，视觉摘要待教师补充。",
    classification: {
      primary: pack.normalizedClassification.primary ?? "视觉设计",
      secondary: [...pack.normalizedClassification.secondary],
    },
    artisticStyle: style,
    curation: {
      recommendation: pack.curationRecommendation.recommendation === "DO_NOT_RECOMMEND" ? "DO_NOT_RECOMMEND" : "RECOMMEND",
      rationale: pack.curationRecommendation.rationale ?? "教师已同意进入保留缺口的私有草稿。",
    },
    teaching: {
      recommendation: pack.teachingRecommendation.recommendation === "DO_NOT_RECOMMEND" ? "DO_NOT_RECOMMEND" : "RECOMMEND",
      rationale: pack.teachingRecommendation.rationale ?? "教学用途待私有编纂阶段继续明确。",
      prompts: pack.teachingRecommendation.prompts.length ? [...pack.teachingRecommendation.prompts] : ["该案例中哪些视觉规则最值得课堂讨论？"],
      cautions: [...pack.teachingRecommendation.cautions],
    },
    media: pack.mediaGroup.map((media) => ({
      mediaId: media.mediaId,
      previewUrl: media.previewUrl,
      role: media.role,
      alt: media.alt,
      width: media.width,
      height: media.height,
      sha256: media.sha256,
    })),
    editorialNote: "",
  };
  return withContentHash({
    schemaVersion: "lumi-inspiration-private-working-draft/v1",
    draftId: draftId(row.candidate_id),
    candidateId: row.candidate_id,
    sourceReview: {
      contractKind: "EVIDENCE_GAP_REVIEW",
      reviewPackId: row.review_pack_id,
      reviewPackRevision: decision.review_pack_revision,
      decisionId: decision.id,
      decisionAction: "ENTER_PRIVATE_WIKIDRAFT",
      acceptedGapKeys: parseJson(decision.accepted_gap_keys_json ?? "[]"),
    },
    revision: 1,
    stage: "EDITING",
    updatedAt,
    editable,
    work: { creators: [...pack.work.creators], year: pack.work.year },
    sourceRecords: pack.sources.map((source) => ({
      sourceId: source.sourceId,
      platform: source.platform,
      pageUrl: source.pageUrl,
      role: source.role,
      creatorName: source.creatorName,
      curatorName: source.curatorName,
    })),
    rights: {
      status: "UNKNOWN",
      evidenceSummaries: pack.rightsEvidence.flatMap((evidence) => evidence.summary ? [evidence.summary] : []),
      formalRepublicationAllowed: false,
    },
    visualObservations: pack.visualDescription.observations.map((observation) => ({ ...observation, mediaIds: [...observation.mediaIds] })),
    duplicateRelationship: { ...pack.duplicateRelationship, relatedCandidateIds: [...pack.duplicateRelationship.relatedCandidateIds] },
    safety: { ...pack.safetyAssessment, evidence: [...pack.safetyAssessment.evidence] },
    evidenceGaps: evidenceGapRequirementKeys(pack.readiness),
    completion: privateDraftCompletion(editable),
    capabilityBoundary: {
      teacherPrivate: true,
      studentVisible: false,
      currentPage: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
    },
  });
}

function persistCompiledDraft(connection: DatabaseConnection, draft: PrivateWikiDraft, recordedAt: number) {
  const existing = connection.sqlite.prepare(
    `SELECT draft_id, candidate_id, source_review_pack_id, source_decision_id, content_hash
     FROM inspiration_wiki_private_working_drafts
     WHERE draft_id = ? OR candidate_id = ? OR source_review_pack_id = ? OR source_decision_id = ?`,
  ).get(draft.draftId, draft.candidateId, draft.sourceReview.reviewPackId, draft.sourceReview.decisionId) as {
    draft_id: string;
    candidate_id: string;
    source_review_pack_id: string;
    source_decision_id: string;
    content_hash: string;
  } | undefined;
  if (existing) {
    if (existing.draft_id !== draft.draftId
      || existing.candidate_id !== draft.candidateId
      || existing.source_review_pack_id !== draft.sourceReview.reviewPackId
      || existing.source_decision_id !== draft.sourceReview.decisionId
      || existing.content_hash !== draft.contentHash) {
      throw new PrivateWikiDraftConflictError();
    }
    return false;
  }
  const draftJson = stableJson(draft);
  const requestHash = hash(stableJson({ operation: "INITIAL_COMPILE", draft }));
  const idempotencyKey = `compile:${draft.sourceReview.decisionId}`;
  connection.sqlite.prepare(
    `INSERT INTO inspiration_wiki_private_working_drafts(
      draft_id,candidate_id,source_review_pack_id,source_contract_kind,source_review_revision,
      source_decision_id,revision,stage,content_hash,draft_json,title,primary_category,
      completion_count,primary_preview_url,rights_status,teacher_private,student_visible,
      current_page,r2,embedding,lumi_retrieval,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,1,'EDITING',?,?,?,?,?,?,'UNKNOWN',1,0,'DISABLED','DISABLED','DISABLED','DISABLED',?,?)`,
  ).run(
    draft.draftId, draft.candidateId, draft.sourceReview.reviewPackId, draft.sourceReview.contractKind,
    draft.sourceReview.reviewPackRevision, draft.sourceReview.decisionId, draft.contentHash, draftJson,
    draft.editable.title, draft.editable.classification.primary, draft.completion.completedCount,
    draft.editable.media[0]!.previewUrl, recordedAt, recordedAt,
  );
  connection.sqlite.prepare(
    `INSERT INTO inspiration_wiki_private_working_draft_revisions(
      id,draft_id,previous_revision,next_revision,operation,actor_type,actor_id,
      previous_content_hash,next_content_hash,previous_draft_json,next_draft_json,note,
      idempotency_key,request_hash,created_at
    ) VALUES(?,?,0,1,'INITIAL_COMPILE','CODEX','codex:d19-private-draft-compiler',NULL,?,NULL,?,?,?, ?,?)`,
  ).run(
    randomUUID(), draft.draftId, draft.contentHash, draftJson, "由已接受的教师审核结果编译为私有工作草稿",
    idempotencyKey, requestHash, recordedAt,
  );
  return true;
}

export function compileAcceptedPrivateWikiDrafts(
  connection: DatabaseConnection,
  compiledAt: string | Date = new Date(),
) {
  const timestamp = isoSeconds(compiledAt);
  const recordedAt = unixSeconds(compiledAt);
  const strictRows = connection.sqlite.prepare(
    `SELECT review_pack_id, candidate_id, pack_json
     FROM inspiration_wiki_review_packs WHERE stage = 'PRIVATE_WIKIDRAFT'
     ORDER BY review_pack_id`,
  ).all() as Array<{ review_pack_id: string; candidate_id: string; pack_json: string }>;
  const gapRows = connection.sqlite.prepare(
    `SELECT review_pack_id, candidate_id, pack_json
     FROM inspiration_wiki_evidence_gap_review_packs WHERE stage = 'PRIVATE_WIKIDRAFT_WITH_GAPS'
     ORDER BY review_pack_id`,
  ).all() as Array<{ review_pack_id: string; candidate_id: string; pack_json: string }>;
  const drafts = [
    ...strictRows.map((row) => strictDraft(connection, row, timestamp)),
    ...gapRows.map((row) => gapDraft(connection, row, timestamp)),
  ];
  let imported = 0;
  connection.sqlite.transaction(() => {
    for (const draft of drafts) if (persistCompiledDraft(connection, draft, recordedAt)) imported += 1;
  }).immediate();
  const totalGovernanceMaterials = connection.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM inspiration_wiki_hermes_candidates",
  ).get() as { count: number };
  return {
    total: drafts.length,
    imported,
    replayed: drafts.length - imported,
    strict: strictRows.length,
    evidenceGap: gapRows.length,
    rejectedExcluded: totalGovernanceMaterials.count - drafts.length,
  };
}

export function readTeacherPrivateWikiDraftQueue(connection: DatabaseConnection, actor: SessionPayload) {
  readTeacherScope(connection.db, actor);
  const rows = connection.sqlite.prepare(
    `SELECT draft_json FROM inspiration_wiki_private_working_drafts
     ORDER BY updated_at DESC, draft_id`,
  ).all() as Array<{ draft_json: string }>;
  const drafts = rows.map((row) => PrivateWikiDraftSchema.parse(parseJson(row.draft_json)));
  const totalGovernanceMaterials = connection.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM inspiration_wiki_hermes_candidates",
  ).get() as { count: number };
  const items = drafts.map((draft) => ({
    draftId: draft.draftId,
    candidateId: draft.candidateId,
    revision: draft.revision,
    stage: draft.stage,
    title: draft.editable.title,
    primaryCategory: draft.editable.classification.primary,
    artisticStyleLabels: [...draft.editable.artisticStyle.labels],
    primaryPreviewUrl: draft.editable.media[0]!.previewUrl,
    sourceContractKind: draft.sourceReview.contractKind,
    evidenceGapCount: draft.evidenceGaps.length,
    completedCount: draft.completion.completedCount,
    updatedAt: draft.updatedAt,
  }));
  return TeacherPrivateWikiDraftQueueSchema.parse({
    items,
    meta: {
      total: drafts.length,
      editing: drafts.filter((draft) => draft.stage === "EDITING").length,
      readyForDomainReview: drafts.filter((draft) => draft.stage === "READY_FOR_DOMAIN_REVIEW").length,
      strictSource: drafts.filter((draft) => draft.sourceReview.contractKind === "STRICT_REVIEW_PACK").length,
      evidenceGapSource: drafts.filter((draft) => draft.sourceReview.contractKind === "EVIDENCE_GAP_REVIEW").length,
      rightsUnknown: drafts.filter((draft) => draft.rights.status === "UNKNOWN").length,
      rejectedExcluded: totalGovernanceMaterials.count - drafts.length,
      boundary: {
        studentVisible: false,
        currentPage: "DISABLED",
        r2: "DISABLED",
        embedding: "DISABLED",
        lumiRetrieval: "DISABLED",
      },
    },
  });
}

export function readTeacherPrivateWikiDraft(connection: DatabaseConnection, actor: SessionPayload, rawDraftId: string) {
  readTeacherScope(connection.db, actor);
  const id = PrivateWikiDraftIdSchema.parse(rawDraftId);
  const row = connection.sqlite.prepare(
    "SELECT draft_json FROM inspiration_wiki_private_working_drafts WHERE draft_id = ?",
  ).get(id) as { draft_json: string } | undefined;
  if (!row) throw new PrivateWikiDraftNotFoundError();
  return PrivateWikiDraftSchema.parse(parseJson(row.draft_json));
}

export function updateTeacherPrivateWikiDraft(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawDraftId: string,
  rawInput: PrivateWikiDraftUpdateBody,
  updatedAt: string | Date = new Date(),
) {
  readTeacherScope(connection.db, actor);
  const id = PrivateWikiDraftIdSchema.parse(rawDraftId);
  const input = PrivateWikiDraftUpdateBodySchema.parse(rawInput);
  const requestHash = hash(stableJson({ draftId: id, ...input }));
  const replay = connection.sqlite.prepare(
    `SELECT request_hash, next_draft_json FROM inspiration_wiki_private_working_draft_revisions
     WHERE actor_id = ? AND idempotency_key = ?`,
  ).get(actor.userId, input.idempotencyKey) as { request_hash: string; next_draft_json: string } | undefined;
  if (replay) {
    if (replay.request_hash !== requestHash) throw new PrivateWikiDraftIdempotencyConflictError();
    return { draft: PrivateWikiDraftSchema.parse(parseJson(replay.next_draft_json)), replayed: true };
  }
  const row = connection.sqlite.prepare(
    `SELECT revision,stage,content_hash,draft_json FROM inspiration_wiki_private_working_drafts WHERE draft_id = ?`,
  ).get(id) as Pick<DraftRow, "revision" | "stage" | "content_hash" | "draft_json"> | undefined;
  if (!row) throw new PrivateWikiDraftNotFoundError();
  if (row.revision !== input.expectedRevision || row.content_hash !== input.expectedContentHash) {
    throw new PrivateWikiDraftRevisionConflictError();
  }
  const current = PrivateWikiDraftSchema.parse(parseJson(row.draft_json));
  const timestamp = isoSeconds(updatedAt);
  const next = withContentHash({
    ...current,
    revision: current.revision + 1,
    stage: input.stage,
    updatedAt: timestamp,
    editable: input.editable,
    completion: privateDraftCompletion(input.editable),
  });
  const nextJson = stableJson(next);
  const previousJson = stableJson(current);
  const operation = row.stage !== next.stage
    ? (next.stage === "READY_FOR_DOMAIN_REVIEW" ? "MARK_READY" : "REOPEN_EDITING")
    : "TEACHER_EDIT";
  const recordedAt = unixSeconds(updatedAt);
  connection.sqlite.transaction(() => {
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_private_working_draft_revisions(
        id,draft_id,previous_revision,next_revision,operation,actor_type,actor_id,
        previous_content_hash,next_content_hash,previous_draft_json,next_draft_json,note,
        idempotency_key,request_hash,created_at
      ) VALUES(?,?,?,?,?,'TEACHER',?,?,?,?,?,?,?,?,?)`,
    ).run(
      randomUUID(), id, current.revision, next.revision, operation, actor.userId,
      current.contentHash, next.contentHash, previousJson, nextJson, input.note,
      input.idempotencyKey, requestHash, recordedAt,
    );
    const result = connection.sqlite.prepare(
      `UPDATE inspiration_wiki_private_working_drafts SET
        revision=?,stage=?,content_hash=?,draft_json=?,title=?,primary_category=?,
        completion_count=?,primary_preview_url=?,updated_at=?
       WHERE draft_id=? AND revision=? AND content_hash=?`,
    ).run(
      next.revision, next.stage, next.contentHash, nextJson, next.editable.title,
      next.editable.classification.primary, next.completion.completedCount,
      next.editable.media[0]!.previewUrl, recordedAt, id, input.expectedRevision,
      input.expectedContentHash,
    );
    if (result.changes !== 1) throw new PrivateWikiDraftRevisionConflictError();
  }).immediate();
  return { draft: next, replayed: false };
}

export function markTeacherPrivateWikiDraftsReady(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: unknown,
  updatedAt: string | Date = new Date(),
) {
  readTeacherScope(connection.db, actor);
  const input = PrivateWikiDraftBatchReadyBodySchema.parse(rawInput);
  const results: Array<{ draftId: string; revision: number }> = [];
  connection.sqlite.transaction(() => {
    for (const id of input.draftIds) {
      const row = connection.sqlite.prepare(
        "SELECT draft_json FROM inspiration_wiki_private_working_drafts WHERE draft_id = ?",
      ).get(id) as { draft_json: string } | undefined;
      if (!row) throw new PrivateWikiDraftNotFoundError();
      const draft = PrivateWikiDraftSchema.parse(parseJson(row.draft_json));
      if (draft.stage === "READY_FOR_DOMAIN_REVIEW") continue;
      if (!draft.completion.ready) throw new PrivateWikiDraftConflictError("存在未完成七项编纂的草稿");
      const suffix = id.slice(-12);
      const result = updateTeacherPrivateWikiDraft(connection, actor, id, {
        expectedRevision: draft.revision,
        expectedContentHash: draft.contentHash,
        editable: draft.editable,
        stage: "READY_FOR_DOMAIN_REVIEW",
        note: input.note,
        idempotencyKey: `${input.idempotencyKey}:${suffix}`,
      }, updatedAt);
      results.push({ draftId: id, revision: result.draft.revision });
    }
  }).immediate();
  return { markedReady: results.length, results };
}

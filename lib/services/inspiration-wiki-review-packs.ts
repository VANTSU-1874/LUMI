import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import { readTeacherScope } from "@/lib/auth/teacher-access";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  ReviewPackDecisionInputSchema,
  ReviewPackIdSchema,
  ReviewPackTeacherAssessmentSchema,
  StrictReviewPackSchema,
  type ReviewPackDecisionInput,
  type ReviewPackStage,
  type StrictReviewPack,
} from "@/lib/domain/inspiration-wiki/review-pack-contracts";
import { transitionReviewPack } from "@/lib/domain/inspiration-wiki/review-pack";

const REVIEW_PACK_STAGES = [
  "READY_FOR_TEACHER_REVIEW",
  "RETURNED_TO_CODEX",
  "REJECTED",
  "PRIVATE_WIKIDRAFT",
] as const;

const StoredMediaAssetSchema = z.object({
  mediaId: z.string().trim().min(1).max(128),
  storagePath: z.string().regex(/^inspiration-wiki\/review-packs\/assets\/[a-z0-9][a-z0-9-]{7,95}\/[a-z0-9][a-z0-9-]{2,95}\.(?:jpg|jpeg|png|webp)$/),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const ReviewPackStoredAssetsSchema = z.array(StoredMediaAssetSchema).min(1).max(20);
export type ReviewPackStoredAsset = z.infer<typeof StoredMediaAssetSchema>;

type ReviewPackRow = {
  review_pack_id: string;
  candidate_id: string;
  revision: number;
  stage: ReviewPackStage;
  material_hash: string;
  pack_json: string;
  media_assets_json: string;
  primary_preview_url: string;
  title: string;
  source_summary: string;
  created_at: number;
  updated_at: number;
};

export class ReviewPackNotFoundError extends Error {
  constructor() {
    super("ReviewPack not found");
    this.name = "ReviewPackNotFoundError";
  }
}

export class ReviewPackConflictError extends Error {
  constructor(message = "ReviewPack conflicts with persisted material") {
    super(message);
    this.name = "ReviewPackConflictError";
  }
}

export class ReviewPackRevisionConflictError extends Error {
  constructor() {
    super("ReviewPack revision is stale");
    this.name = "ReviewPackRevisionConflictError";
  }
}

export class ReviewPackIdempotencyConflictError extends Error {
  constructor() {
    super("ReviewPack decision idempotency key was reused");
    this.name = "ReviewPackIdempotencyConflictError";
  }
}

function unixSeconds(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid ReviewPack timestamp");
  return Math.floor(date.getTime() / 1_000);
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

export function calculateReviewPackMaterialHash(rawPack: Omit<StrictReviewPack, "materialHash">) {
  return hash(stableJson(rawPack));
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function stageCounts(connection: DatabaseConnection) {
  const rows = connection.sqlite.prepare(
    "SELECT stage, count(*) AS count FROM inspiration_wiki_review_packs GROUP BY stage",
  ).all() as Array<{ stage: ReviewPackStage; count: number }>;
  return Object.fromEntries(REVIEW_PACK_STAGES.map((stage) => [
    stage,
    rows.find((row) => row.stage === stage)?.count ?? 0,
  ])) as Record<(typeof REVIEW_PACK_STAGES)[number], number>;
}

export function persistStrictReviewPack(
  connection: DatabaseConnection,
  rawPack: unknown,
  rawAssets: unknown,
  persistedAt: string | Date = new Date(),
) {
  const pack = StrictReviewPackSchema.parse(rawPack);
  const assets = ReviewPackStoredAssetsSchema.parse(rawAssets);
  const material = { ...pack } as Partial<StrictReviewPack>;
  delete material.materialHash;
  if (calculateReviewPackMaterialHash(material as Omit<StrictReviewPack, "materialHash">) !== pack.materialHash) {
    throw new ReviewPackConflictError("ReviewPack material hash does not match its content");
  }

  const expectedMedia = new Map(pack.mediaGroup.map((media) => [media.mediaId, media]));
  if (expectedMedia.size !== assets.length || assets.some((asset) => {
    const media = expectedMedia.get(asset.mediaId);
    return !media || media.sha256 !== asset.sha256;
  })) {
    throw new ReviewPackConflictError("Controlled media manifest does not match ReviewPack mediaGroup");
  }

  const candidate = connection.sqlite.prepare(
    "SELECT id, page_url, canonical_url, review_state FROM inspiration_wiki_hermes_candidates WHERE id = ?",
  ).get(pack.candidateId) as { id: string; page_url: string; canonical_url: string | null; review_state: string } | undefined;
  if (!candidate) throw new ReviewPackConflictError("ReviewPack candidate does not exist");
  if (candidate.review_state === "REJECTED") throw new ReviewPackConflictError("Rejected candidate cannot receive a ReviewPack");
  if (!pack.sources.some((source) => source.pageUrl === candidate.page_url || source.pageUrl === candidate.canonical_url)) {
    throw new ReviewPackConflictError("ReviewPack does not preserve the candidate source page");
  }

  const existing = connection.sqlite.prepare(
    "SELECT review_pack_id, candidate_id, material_hash, media_assets_json FROM inspiration_wiki_review_packs WHERE review_pack_id = ? OR candidate_id = ?",
  ).get(pack.reviewPackId, pack.candidateId) as {
    review_pack_id: string;
    candidate_id: string;
    material_hash: string;
    media_assets_json: string;
  } | undefined;
  const serializedAssets = stableJson(assets);
  if (existing) {
    if (existing.review_pack_id !== pack.reviewPackId
      || existing.candidate_id !== pack.candidateId
      || existing.material_hash !== pack.materialHash
      || existing.media_assets_json !== serializedAssets) {
      throw new ReviewPackConflictError();
    }
    return { imported: false, reviewPackId: pack.reviewPackId } as const;
  }

  const primaryPreview = pack.mediaGroup.find((media) => media.role === "COVER") ?? pack.mediaGroup[0];
  const sourceSummary = pack.sources.map((source) => `${source.label} · ${source.role}`).join(" / ");
  const recordedAt = unixSeconds(persistedAt);
  connection.sqlite.prepare(
    `INSERT INTO inspiration_wiki_review_packs
      (review_pack_id, candidate_id, revision, stage, material_hash, pack_json,
       media_assets_json, primary_preview_url, title, source_summary,
       teacher_private, student_visible, current_page, r2, embedding, lumi_retrieval,
       created_at, updated_at)
     VALUES (?, ?, ?, 'READY_FOR_TEACHER_REVIEW', ?, ?, ?, ?, ?, ?,
       1, 0, 'DISABLED', 'DISABLED', 'DISABLED', 'DISABLED', ?, ?)`,
  ).run(
    pack.reviewPackId,
    pack.candidateId,
    pack.revision,
    pack.materialHash,
    stableJson(pack),
    serializedAssets,
    primaryPreview.previewUrl,
    pack.work.title,
    sourceSummary,
    recordedAt,
    recordedAt,
  );
  return { imported: true, reviewPackId: pack.reviewPackId } as const;
}

export function readTeacherReviewPackQueue(
  connection: DatabaseConnection,
  actor: SessionPayload,
) {
  readTeacherScope(connection.db, actor);
  const governanceMaterials = connection.sqlite.prepare(
    "SELECT count(*) AS count FROM inspiration_wiki_hermes_candidates",
  ).get() as { count: number };
  const counts = stageCounts(connection);
  const rows = connection.sqlite.prepare(
    `SELECT review_pack_id, candidate_id, revision, title, primary_preview_url,
       source_summary, updated_at
     FROM inspiration_wiki_review_packs
     WHERE stage = 'READY_FOR_TEACHER_REVIEW'
     ORDER BY updated_at ASC, review_pack_id ASC`,
  ).all() as Array<{
    review_pack_id: string;
    candidate_id: string;
    revision: number;
    title: string;
    primary_preview_url: string;
    source_summary: string;
    updated_at: number;
  }>;
  const reviewedRows = connection.sqlite.prepare(
    `SELECT review_pack_id, candidate_id, revision, title, primary_preview_url,
       source_summary, stage, updated_at
     FROM inspiration_wiki_review_packs
     WHERE stage IN ('RETURNED_TO_CODEX', 'REJECTED', 'PRIVATE_WIKIDRAFT')
     ORDER BY updated_at DESC, review_pack_id ASC`,
  ).all() as Array<{
    review_pack_id: string;
    candidate_id: string;
    revision: number;
    title: string;
    primary_preview_url: string;
    source_summary: string;
    stage: "RETURNED_TO_CODEX" | "REJECTED" | "PRIVATE_WIKIDRAFT";
    updated_at: number;
  }>;
  const totalReviewPacks = Object.values(counts).reduce((total, count) => total + count, 0);
  const teacherReviewed = counts.RETURNED_TO_CODEX + counts.REJECTED + counts.PRIVATE_WIKIDRAFT;
  const completedGates = {
    CONTROLLED_MEDIA_GROUP: totalReviewPacks,
    WORK_SOURCE_MATCH: totalReviewPacks,
    SOURCE_ROLE: totalReviewPacks,
    RIGHTS_EVIDENCE: totalReviewPacks,
    NORMALIZED_CLASSIFICATION: totalReviewPacks,
    VISUAL_DESCRIPTION: totalReviewPacks,
    DUPLICATE_RELATIONSHIP: totalReviewPacks,
    CURATION_RECOMMENDATION: totalReviewPacks,
    TEACHING_RECOMMENDATION: totalReviewPacks,
  } as const;

  return {
    items: rows.map((row) => ({
      reviewPackId: row.review_pack_id,
      candidateId: row.candidate_id,
      revision: row.revision,
      title: row.title,
      primaryPreviewUrl: row.primary_preview_url,
      sourceSummary: row.source_summary,
      updatedAt: new Date(row.updated_at * 1_000).toISOString(),
    })),
    reviewedItems: reviewedRows.map((row) => ({
      reviewPackId: row.review_pack_id,
      candidateId: row.candidate_id,
      revision: row.revision,
      title: row.title,
      primaryPreviewUrl: row.primary_preview_url,
      sourceSummary: row.source_summary,
      stage: row.stage,
      updatedAt: new Date(row.updated_at * 1_000).toISOString(),
    })),
    meta: {
      totalGovernanceMaterials: governanceMaterials.count,
      totalReviewPacks,
      teacherReviewReady: counts.READY_FOR_TEACHER_REVIEW,
      teacherReviewed,
      returnedToCodex: counts.RETURNED_TO_CODEX,
      rejected: counts.REJECTED,
      privateWikiDraft: counts.PRIVATE_WIKIDRAFT,
      requiredGateCount: 9 as const,
      completedGates,
      boundary: {
        studentVisible: false as const,
        currentPage: "DISABLED" as const,
        r2: "DISABLED" as const,
        embedding: "DISABLED" as const,
        lumiRetrieval: "DISABLED" as const,
      },
    },
  };
}

export function readTeacherReviewPack(
  connection: DatabaseConnection,
  actor: SessionPayload,
  reviewPackId: string,
) {
  readTeacherScope(connection.db, actor);
  ReviewPackIdSchema.parse(reviewPackId);
  const row = connection.sqlite.prepare(
    "SELECT pack_json, stage, revision FROM inspiration_wiki_review_packs WHERE review_pack_id = ?",
  ).get(reviewPackId) as { pack_json: string; stage: ReviewPackStage; revision: number } | undefined;
  if (!row) throw new ReviewPackNotFoundError();
  const latest = connection.sqlite.prepare(
    `SELECT review_pack_revision, assessment_json, final_action, note, created_at
     FROM inspiration_wiki_review_pack_decisions
     WHERE review_pack_id = ?
     ORDER BY review_pack_revision DESC, created_at DESC, id DESC
     LIMIT 1`,
  ).get(reviewPackId) as {
    review_pack_revision: number;
    assessment_json: string;
    final_action: ReviewPackDecisionInput["finalAction"];
    note: string;
    created_at: number;
  } | undefined;
  return {
    ...StrictReviewPackSchema.parse(parseJson(row.pack_json)),
    editContext: {
      currentStage: row.stage,
      currentReviewRevision: row.revision,
      latestDecision: latest ? {
        reviewPackRevision: latest.review_pack_revision,
        assessment: ReviewPackTeacherAssessmentSchema.parse(parseJson(latest.assessment_json)),
        finalAction: latest.final_action,
        note: latest.note,
        decidedAt: new Date(latest.created_at * 1_000).toISOString(),
      } : null,
    },
  };
}

export function readTeacherReviewPackMedia(
  connection: DatabaseConnection,
  actor: SessionPayload,
  reviewPackId: string,
  mediaId: string,
) {
  readTeacherScope(connection.db, actor);
  ReviewPackIdSchema.parse(reviewPackId);
  const row = connection.sqlite.prepare(
    "SELECT media_assets_json FROM inspiration_wiki_review_packs WHERE review_pack_id = ?",
  ).get(reviewPackId) as { media_assets_json: string } | undefined;
  if (!row) throw new ReviewPackNotFoundError();
  const asset = ReviewPackStoredAssetsSchema.parse(parseJson(row.media_assets_json))
    .find((item) => item.mediaId === mediaId);
  if (!asset) throw new ReviewPackNotFoundError();
  return asset;
}

export function decideTeacherReviewPack(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: ReviewPackDecisionInput,
  decidedAt: string | Date = new Date(),
) {
  readTeacherScope(connection.db, actor);
  const input = ReviewPackDecisionInputSchema.parse(rawInput);
  const requestHash = hash(stableJson(input));
  const existing = connection.sqlite.prepare(
    `SELECT request_hash, review_pack_id, review_pack_revision, final_action,
       next_stage, created_at
     FROM inspiration_wiki_review_pack_decisions
     WHERE teacher_id = ? AND idempotency_key = ?`,
  ).get(actor.userId, input.idempotencyKey) as {
    request_hash: string;
    review_pack_id: string;
    review_pack_revision: number;
    final_action: ReviewPackDecisionInput["finalAction"];
    next_stage: ReviewPackStage;
    created_at: number;
  } | undefined;
  if (existing) {
    if (existing.request_hash !== requestHash) throw new ReviewPackIdempotencyConflictError();
    return {
      reviewPackId: existing.review_pack_id,
      previousRevision: existing.review_pack_revision,
      revision: existing.review_pack_revision + 1,
      finalAction: existing.final_action,
      stage: existing.next_stage,
      capabilityBoundary: {
        teacherPrivate: true as const,
        studentVisible: false as const,
        currentPage: "DISABLED" as const,
        r2: "DISABLED" as const,
        embedding: "DISABLED" as const,
        lumiRetrieval: "DISABLED" as const,
      },
      decidedAt: new Date(existing.created_at * 1_000).toISOString(),
      replayed: true,
    };
  }

  const row = connection.sqlite.prepare(
    `SELECT review_pack_id, candidate_id, revision, stage, material_hash, pack_json,
       media_assets_json, primary_preview_url, title, source_summary, created_at, updated_at
     FROM inspiration_wiki_review_packs WHERE review_pack_id = ?`,
  ).get(input.reviewPackId) as ReviewPackRow | undefined;
  if (!row) throw new ReviewPackNotFoundError();
  if (row.revision !== input.reviewPackRevision) throw new ReviewPackRevisionConflictError();
  const pack = StrictReviewPackSchema.parse(parseJson(row.pack_json));
  const receipt = transitionReviewPack({ ...pack, revision: row.revision }, input);
  const recordedAt = unixSeconds(decidedAt);

  connection.sqlite.transaction(() => {
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_review_pack_decisions
        (id, review_pack_id, review_pack_revision, teacher_id, assessment_json,
         final_action, previous_stage, next_stage, note, idempotency_key,
         request_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(), input.reviewPackId, input.reviewPackRevision, actor.userId,
      stableJson(input.assessment), input.finalAction, row.stage, receipt.stage, input.note,
      input.idempotencyKey, requestHash, recordedAt,
    );
    const update = connection.sqlite.prepare(
      `UPDATE inspiration_wiki_review_packs
       SET stage = ?, revision = revision + 1, updated_at = ?
       WHERE review_pack_id = ? AND revision = ? AND stage = ?`,
    ).run(receipt.stage, recordedAt, input.reviewPackId, input.reviewPackRevision, row.stage);
    if (update.changes !== 1) throw new ReviewPackRevisionConflictError();
  }).immediate();

  return {
    ...receipt,
    decidedAt: new Date(recordedAt * 1_000).toISOString(),
    replayed: false,
  };
}

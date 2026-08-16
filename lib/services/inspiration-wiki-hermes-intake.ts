import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import { readTeacherScope } from "@/lib/auth/teacher-access";
import type { DatabaseConnection } from "@/lib/db/client";
import type { ValidatedLegacyHermesHandoffV1 } from "@/lib/domain/inspiration-wiki/legacy-hermes-handoff-v1";

const REVIEW_STATES = [
  "PENDING_REVIEW",
  "NORMALIZATION_REQUIRED",
  "DUPLICATE_HOLD",
  "RIGHTS_HOLD",
  "REJECTED",
] as const;
const DECISIONS = [
  "RESTORE_PENDING",
  "REQUEST_NORMALIZATION",
  "HOLD_DUPLICATE",
  "HOLD_RIGHTS",
  "REJECT",
] as const;
type ReviewState = (typeof REVIEW_STATES)[number];
type TriageDecision = (typeof DECISIONS)[number];

export const HermesPrivateTriageInputSchema = z.object({
  candidateId: z.string().regex(/^hermes-candidate:[0-9a-f]{32}$/),
  candidateRevision: z.number().int().positive(),
  decision: z.enum(DECISIONS),
  note: z.string().max(1_000),
  idempotencyKey: z.string().min(8).max(128),
}).strict();

type CandidateRow = {
  id: string;
  batch_id: string;
  source_candidate_id: string;
  revision: number;
  contract_state: "V1_UPGRADE_REQUIRED";
  review_state: ReviewState;
  source_id: string;
  source_platform: string;
  page_url: string;
  canonical_url: string | null;
  title: string | null;
  description: string | null;
  author_json: string | null;
  license_json: string | null;
  media_json: string;
  design_categories_json: string;
  screening_json: string;
  created_at: number;
  updated_at: number;
};

export class HermesBatchConflictError extends Error {
  constructor(message = "Hermes batch identity conflicts with persisted material") {
    super(message); this.name = "HermesBatchConflictError";
  }
}
export class HermesCandidateNotFoundError extends Error {
  constructor() { super("Hermes candidate not found"); this.name = "HermesCandidateNotFoundError"; }
}
export class HermesCandidateRevisionConflictError extends Error {
  constructor() { super("Hermes candidate revision is stale"); this.name = "HermesCandidateRevisionConflictError"; }
}
export class HermesTriageIdempotencyConflictError extends Error {
  constructor() { super("Hermes triage idempotency key was reused"); this.name = "HermesTriageIdempotencyConflictError"; }
}

function unixSeconds(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid persistence timestamp");
  return Math.floor(date.getTime() / 1_000);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function candidateStorageId(batchId: string, candidateId: string) {
  return `hermes-candidate:${hash(`${batchId}\0${candidateId}`).slice(0, 32)}`;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function nextState(decision: TriageDecision): ReviewState {
  return {
    RESTORE_PENDING: "PENDING_REVIEW",
    REQUEST_NORMALIZATION: "NORMALIZATION_REQUIRED",
    HOLD_DUPLICATE: "DUPLICATE_HOLD",
    HOLD_RIGHTS: "RIGHTS_HOLD",
    REJECT: "REJECTED",
  }[decision] as ReviewState;
}

export function persistValidatedLegacyHermesBatch(
  connection: DatabaseConnection,
  handoff: ValidatedLegacyHermesHandoffV1,
  importedAt: string | Date = new Date(),
) {
  const stored = connection.sqlite.prepare(
    `SELECT package_digest, candidate_count, failure_count
     FROM inspiration_wiki_hermes_batches WHERE batch_id = ?`,
  ).get(handoff.manifest.batchId) as {
    package_digest: string;
    candidate_count: number;
    failure_count: number;
  } | undefined;
  if (stored) {
    if (stored.package_digest !== handoff.done.packageDigest
      || stored.candidate_count !== handoff.candidates.length
      || stored.failure_count !== handoff.failures.length) {
      throw new HermesBatchConflictError();
    }
    const persistedCount = connection.sqlite.prepare(
      "SELECT count(*) AS count FROM inspiration_wiki_hermes_candidates WHERE batch_id = ?",
    ).get(handoff.manifest.batchId) as { count: number };
    if (persistedCount.count !== handoff.candidates.length) {
      throw new HermesBatchConflictError("Persisted Hermes batch is incomplete");
    }
    return { imported: false, batchId: handoff.manifest.batchId, candidates: persistedCount.count } as const;
  }

  const duplicateDigest = connection.sqlite.prepare(
    "SELECT batch_id FROM inspiration_wiki_hermes_batches WHERE package_digest = ?",
  ).get(handoff.done.packageDigest) as { batch_id: string } | undefined;
  if (duplicateDigest) throw new HermesBatchConflictError("Hermes package digest already belongs to another batch");

  const recordedAt = unixSeconds(importedAt);
  connection.sqlite.transaction(() => {
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_hermes_batches
        (batch_id, contract_version, package_digest, manifest_json, done_json,
         candidate_count, failure_count, intake_state, student_visible,
         current_page, r2, embedding, lumi_retrieval, imported_at)
       VALUES (?, 'LEGACY_V1', ?, ?, ?, ?, ?, 'VALIDATED_PRIVATE', 0,
         'DISABLED', 'DISABLED', 'DISABLED', 'DISABLED', ?)`,
    ).run(
      handoff.manifest.batchId,
      handoff.done.packageDigest,
      stableJson(handoff.manifest),
      stableJson(handoff.done),
      handoff.candidates.length,
      handoff.failures.length,
      recordedAt,
    );

    const insert = connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_hermes_candidates
        (id, batch_id, source_candidate_id, revision, contract_state, review_state,
         source_id, source_platform, page_url, canonical_url, title, description,
         author_json, license_json, media_json, design_categories_json, screening_json,
         raw_candidate_json, raw_digest, dedupe_fingerprint, scope, student_visible,
         wiki_draft, current_page, r2, embedding, lumi_retrieval, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'V1_UPGRADE_REQUIRED', 'PENDING_REVIEW', ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, 'PRIVATE_CANDIDATE', 0, 'NOT_CREATED', 'DISABLED',
         'DISABLED', 'DISABLED', 'DISABLED', ?, ?)`,
    );
    for (const { value: candidate, rawDigest } of handoff.candidates) {
      insert.run(
        candidateStorageId(candidate.batchId, candidate.candidateId),
        candidate.batchId,
        candidate.candidateId,
        candidate.source.sourceId,
        candidate.source.platform,
        candidate.source.pageUrl,
        candidate.source.canonicalUrl,
        candidate.content.title,
        candidate.content.description,
        candidate.author === null ? null : stableJson(candidate.author),
        candidate.license === null ? null : stableJson(candidate.license),
        stableJson(candidate.media),
        stableJson(candidate.designCategories),
        stableJson(candidate.screening),
        stableJson(candidate),
        rawDigest,
        candidate.dedupeFingerprint,
        recordedAt,
        recordedAt,
      );
    }
  }).immediate();

  return { imported: true, batchId: handoff.manifest.batchId, candidates: handoff.candidates.length } as const;
}

function publicCandidate(row: CandidateRow) {
  const media = parseJson<Array<{ kind: string; asset: unknown }>>(row.media_json);
  const screening = parseJson<{ totalScore: number; evidence: string[] }>(row.screening_json);
  return {
    id: row.id,
    batchId: row.batch_id,
    sourceCandidateId: row.source_candidate_id,
    revision: row.revision,
    contractState: row.contract_state,
    reviewState: row.review_state,
    source: {
      sourceId: row.source_id,
      platform: row.source_platform,
      pageUrl: row.page_url,
      canonicalUrl: row.canonical_url,
    },
    content: { title: row.title, description: row.description },
    author: row.author_json === null ? null : parseJson<Record<string, unknown>>(row.author_json),
    license: row.license_json === null ? null : parseJson<Record<string, unknown>>(row.license_json),
    media: {
      count: media.length,
      kinds: [...new Set(media.map((item) => item.kind))],
      controlledPreviewAvailable: media.some((item) => item.asset !== null),
    },
    designCategories: parseJson<string[]>(row.design_categories_json),
    screening,
    capabilityBoundary: {
      scope: "PRIVATE_CANDIDATE" as const,
      studentVisible: false,
      wikiDraft: "NOT_CREATED" as const,
      currentPage: "DISABLED" as const,
      r2: "DISABLED" as const,
      embedding: "DISABLED" as const,
      lumiRetrieval: "DISABLED" as const,
    },
    createdAt: new Date(row.created_at * 1_000).toISOString(),
    updatedAt: new Date(row.updated_at * 1_000).toISOString(),
  };
}

export function readPrivateHermesCandidateQueue(
  connection: DatabaseConnection,
  actor: SessionPayload,
  input: { limit: number; offset: number; reviewState?: ReviewState },
) {
  readTeacherScope(connection.db, actor);
  const where = input.reviewState ? "WHERE review_state = ?" : "";
  const values = input.reviewState ? [input.reviewState] : [];
  const rows = connection.sqlite.prepare(
    `SELECT id, batch_id, source_candidate_id, revision, contract_state, review_state,
      source_id, source_platform, page_url, canonical_url, title, description,
      author_json, license_json, media_json, design_categories_json, screening_json,
      created_at, updated_at
     FROM inspiration_wiki_hermes_candidates ${where}
     ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`,
  ).all(...values, input.limit, input.offset) as CandidateRow[];
  const total = connection.sqlite.prepare(
    `SELECT count(*) AS count FROM inspiration_wiki_hermes_candidates ${where}`,
  ).get(...values) as { count: number };
  const stateRows = connection.sqlite.prepare(
    `SELECT review_state AS state, count(*) AS count
     FROM inspiration_wiki_hermes_candidates GROUP BY review_state ORDER BY review_state`,
  ).all() as Array<{ state: ReviewState; count: number }>;
  const readiness = connection.sqlite.prepare(
    `SELECT
       count(*) AS total,
       sum(CASE WHEN license_json IS NOT NULL THEN 1 ELSE 0 END) AS rights_evidence_count,
       sum(CASE WHEN description IS NOT NULL THEN 1 ELSE 0 END) AS description_count,
       sum(CASE WHEN contract_state <> 'V1_UPGRADE_REQUIRED' THEN 1 ELSE 0 END) AS v2_ready_count,
       sum(CASE WHEN EXISTS (
         SELECT 1 FROM json_each(inspiration_wiki_hermes_candidates.media_json)
         WHERE json_extract(value, '$.asset') IS NOT NULL
       ) THEN 1 ELSE 0 END) AS controlled_preview_count,
       sum(CASE WHEN contract_state <> 'V1_UPGRADE_REQUIRED'
         AND license_json IS NOT NULL
         AND description IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM json_each(inspiration_wiki_hermes_candidates.media_json)
           WHERE json_extract(value, '$.asset') IS NOT NULL
         ) THEN 1 ELSE 0 END) AS teacher_review_ready_count
     FROM inspiration_wiki_hermes_candidates`,
  ).get() as {
    total: number;
    rights_evidence_count: number;
    description_count: number;
    v2_ready_count: number;
    controlled_preview_count: number;
    teacher_review_ready_count: number;
  };
  const sources = connection.sqlite.prepare(
    `SELECT
       source_id AS source_id,
       count(*) AS total,
       sum(CASE WHEN license_json IS NOT NULL THEN 1 ELSE 0 END) AS rights_evidence_count,
       sum(CASE WHEN description IS NOT NULL THEN 1 ELSE 0 END) AS description_count,
       sum(CASE WHEN EXISTS (
         SELECT 1 FROM json_each(inspiration_wiki_hermes_candidates.media_json)
         WHERE json_extract(value, '$.asset') IS NOT NULL
       ) THEN 1 ELSE 0 END) AS controlled_preview_count
     FROM inspiration_wiki_hermes_candidates
     GROUP BY source_id
     ORDER BY total DESC, source_id ASC`,
  ).all() as Array<{
    source_id: string;
    total: number;
    rights_evidence_count: number;
    description_count: number;
    controlled_preview_count: number;
  }>;
  return {
    items: rows.map(publicCandidate),
    meta: {
      total: total.count,
      limit: input.limit,
      offset: input.offset,
      stateCounts: Object.fromEntries(REVIEW_STATES.map((state) => [
        state,
        stateRows.find((row) => row.state === state)?.count ?? 0,
      ])),
      readiness: {
        teacherReviewReady: readiness.teacher_review_ready_count,
        controlledPreviewReady: readiness.controlled_preview_count,
        rightsEvidenceReady: readiness.rights_evidence_count,
        descriptionsReady: readiness.description_count,
        v2Normalized: readiness.v2_ready_count,
        blocked: {
          rights: readiness.total - readiness.rights_evidence_count,
          preview: readiness.total - readiness.controlled_preview_count,
          description: readiness.total - readiness.description_count,
          normalization: readiness.total - readiness.v2_ready_count,
        },
      },
      sources: sources.map((source) => ({
        sourceId: source.source_id,
        total: source.total,
        rightsEvidenceReady: source.rights_evidence_count,
        descriptionsReady: source.description_count,
        controlledPreviewReady: source.controlled_preview_count,
      })),
    },
  };
}

export function decidePrivateHermesCandidateTriage(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: z.input<typeof HermesPrivateTriageInputSchema>,
  decidedAt: string | Date = new Date(),
) {
  readTeacherScope(connection.db, actor);
  const input = HermesPrivateTriageInputSchema.parse(rawInput);
  const requestHash = hash(stableJson(input));
  const existing = connection.sqlite.prepare(
    `SELECT request_hash, candidate_id, candidate_revision, decision, next_state, created_at
     FROM inspiration_wiki_hermes_triage_decisions
     WHERE teacher_id = ? AND idempotency_key = ?`,
  ).get(actor.userId, input.idempotencyKey) as {
    request_hash: string;
    candidate_id: string;
    candidate_revision: number;
    decision: TriageDecision;
    next_state: ReviewState;
    created_at: number;
  } | undefined;
  if (existing) {
    if (existing.request_hash !== requestHash) throw new HermesTriageIdempotencyConflictError();
    return {
      candidateId: existing.candidate_id,
      previousRevision: existing.candidate_revision,
      revision: existing.candidate_revision + 1,
      decision: existing.decision,
      reviewState: existing.next_state,
      decidedAt: new Date(existing.created_at * 1_000).toISOString(),
      replayed: true,
    } as const;
  }

  const candidate = connection.sqlite.prepare(
    "SELECT id, revision, review_state FROM inspiration_wiki_hermes_candidates WHERE id = ?",
  ).get(input.candidateId) as { id: string; revision: number; review_state: ReviewState } | undefined;
  if (!candidate) throw new HermesCandidateNotFoundError();
  if (candidate.revision !== input.candidateRevision) throw new HermesCandidateRevisionConflictError();
  const state = nextState(input.decision);
  const recordedAt = unixSeconds(decidedAt);
  connection.sqlite.transaction(() => {
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_hermes_triage_decisions
        (id, candidate_id, candidate_revision, teacher_id, decision, previous_state,
         next_state, note, idempotency_key, request_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(), input.candidateId, input.candidateRevision, actor.userId,
      input.decision, candidate.review_state, state, input.note,
      input.idempotencyKey, requestHash, recordedAt,
    );
    const update = connection.sqlite.prepare(
      `UPDATE inspiration_wiki_hermes_candidates
       SET review_state = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND revision = ?`,
    ).run(state, recordedAt, input.candidateId, input.candidateRevision);
    if (update.changes !== 1) throw new HermesCandidateRevisionConflictError();
  }).immediate();
  return {
    candidateId: input.candidateId,
    previousRevision: input.candidateRevision,
    revision: input.candidateRevision + 1,
    decision: input.decision,
    reviewState: state,
    decidedAt: new Date(recordedAt * 1_000).toISOString(),
    replayed: false,
  } as const;
}

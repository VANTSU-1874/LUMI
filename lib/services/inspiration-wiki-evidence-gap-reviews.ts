import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import { readTeacherScope } from "@/lib/auth/teacher-access";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  EvidenceGapReviewDecisionContextSchema,
  EvidenceGapReviewDecisionInputSchema,
  EvidenceGapReviewPackIdSchema,
  EvidenceGapReviewPackSchema,
  evidenceGapRequirementKeys,
  evidenceGapVerifiedCount,
  type EvidenceGapReviewDecisionInput,
  type EvidenceGapReviewPack,
} from "@/lib/domain/inspiration-wiki/evidence-gap-review-contracts";
import { ReviewPackRequirementKeySchema } from "@/lib/domain/inspiration-wiki/review-pack-contracts";

const REQUIREMENT_FIELDS = {
  CONTROLLED_MEDIA_GROUP: "controlledMediaGroup",
  WORK_SOURCE_MATCH: "workSourceMatch",
  SOURCE_ROLE: "sourceRole",
  RIGHTS_EVIDENCE: "rightsEvidence",
  NORMALIZED_CLASSIFICATION: "normalizedClassification",
  VISUAL_DESCRIPTION: "visualDescription",
  DUPLICATE_RELATIONSHIP: "duplicateRelationship",
  CURATION_RECOMMENDATION: "curationRecommendation",
  TEACHING_RECOMMENDATION: "teachingRecommendation",
} as const;

const StoredAssetSchema = z.object({
  mediaId: z.string().trim().min(1).max(128),
  storagePath: z.string().regex(/^inspiration-wiki\/evidence-gap-review-packs\/assets\/[a-z0-9][a-z0-9-]{7,95}\/[a-z0-9][a-z0-9-]{2,95}\.(?:jpg|jpeg|png|webp)$/),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const EvidenceGapStoredAssetsSchema = z.array(StoredAssetSchema).max(20);
export type EvidenceGapStoredAsset = z.infer<typeof StoredAssetSchema>;

const MediaAmendmentMetadataSchema = z.object({
  expectedRevision: z.number().int().positive(),
  expectedMaterialHash: z.string().regex(/^[0-9a-f]{64}$/),
  idempotencyKey: z.string().trim().min(8).max(128),
  sourcePackageDigest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type EvidenceGapMediaAmendmentInput = z.infer<typeof MediaAmendmentMetadataSchema> & {
  amendedPack: unknown;
  assets: unknown;
};

const AnalysisRevisionMetadataSchema = z.object({
  expectedRevision: z.number().int().positive(),
  expectedMaterialHash: z.string().regex(/^[0-9a-f]{64}$/),
  idempotencyKey: z.string().trim().min(8).max(128),
  sourceArtifactDigest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type EvidenceGapAnalysisRevisionInput = z.infer<typeof AnalysisRevisionMetadataSchema> & {
  revisedPack: unknown;
};

type GapStage =
  | "READY_FOR_TEACHER_TRIAGE"
  | "RETURNED_TO_CODEX"
  | "REJECTED"
  | "PRIVATE_WIKIDRAFT_WITH_GAPS";
type GapRow = {
  review_pack_id: string;
  candidate_id: string;
  revision: number;
  stage: GapStage;
  material_hash: string;
  pack_json: string;
  media_assets_json: string;
  primary_preview_url: string | null;
  title: string | null;
  source_summary: string | null;
  updated_at: number;
};

export class EvidenceGapReviewNotFoundError extends Error {
  constructor() { super("Evidence-gap review pack not found"); this.name = "EvidenceGapReviewNotFoundError"; }
}

export class EvidenceGapReviewConflictError extends Error {
  constructor(message = "Evidence-gap review pack conflicts with persisted material") {
    super(message); this.name = "EvidenceGapReviewConflictError";
  }
}

export class EvidenceGapReviewRevisionConflictError extends Error {
  constructor() { super("Evidence-gap review revision is stale"); this.name = "EvidenceGapReviewRevisionConflictError"; }
}

export class EvidenceGapReviewIdempotencyConflictError extends Error {
  constructor() { super("Evidence-gap review idempotency key was reused"); this.name = "EvidenceGapReviewIdempotencyConflictError"; }
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

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function unixSeconds(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid evidence-gap timestamp");
  return Math.floor(date.getTime() / 1_000);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function calculateEvidenceGapReviewMaterialHash(
  rawPack: Omit<EvidenceGapReviewPack, "materialHash">,
) {
  return hash(stableJson(rawPack));
}

export function persistEvidenceGapReviewPack(
  connection: DatabaseConnection,
  rawPack: unknown,
  rawAssets: unknown,
  persistedAt: string | Date = new Date(),
) {
  const pack = EvidenceGapReviewPackSchema.parse(rawPack);
  const assets = EvidenceGapStoredAssetsSchema.parse(rawAssets);
  const material = { ...pack } as Partial<EvidenceGapReviewPack>;
  delete material.materialHash;
  if (calculateEvidenceGapReviewMaterialHash(material as Omit<EvidenceGapReviewPack, "materialHash">) !== pack.materialHash) {
    throw new EvidenceGapReviewConflictError("Evidence-gap material hash does not match its content");
  }

  const expectedMedia = new Map(pack.mediaGroup.map((media) => [media.mediaId, media]));
  if (expectedMedia.size !== assets.length || assets.some((asset) => {
    const media = expectedMedia.get(asset.mediaId);
    return !media || media.sha256 !== asset.sha256;
  })) {
    throw new EvidenceGapReviewConflictError("Evidence media manifest does not match mediaGroup");
  }

  const candidate = connection.sqlite.prepare(
    "SELECT id, page_url, canonical_url, review_state FROM inspiration_wiki_hermes_candidates WHERE id = ?",
  ).get(pack.candidateId) as { id: string; page_url: string; canonical_url: string | null; review_state: string } | undefined;
  if (!candidate) throw new EvidenceGapReviewConflictError("Candidate does not exist");
  if (candidate.review_state === "REJECTED") throw new EvidenceGapReviewConflictError("Rejected candidate cannot enter gap review");
  if (!pack.sources.some((source) => source.pageUrl === candidate.page_url || source.pageUrl === candidate.canonical_url)) {
    throw new EvidenceGapReviewConflictError("Gap review must preserve the candidate source page");
  }

  const strict = connection.sqlite.prepare(
    "SELECT review_pack_id FROM inspiration_wiki_review_packs WHERE candidate_id = ?",
  ).get(pack.candidateId) as { review_pack_id: string } | undefined;
  if (strict) throw new EvidenceGapReviewConflictError("Candidate already has a strict ReviewPack");

  const existing = connection.sqlite.prepare(
    `SELECT review_pack_id, candidate_id, material_hash, media_assets_json
     FROM inspiration_wiki_evidence_gap_review_packs
     WHERE review_pack_id = ? OR candidate_id = ?`,
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
      throw new EvidenceGapReviewConflictError();
    }
    return { imported: false, reviewPackId: pack.reviewPackId } as const;
  }

  const primaryPreview = pack.mediaGroup[0]?.previewUrl ?? null;
  const sourceSummary = pack.sources.map((source) => source.label ?? source.pageUrl).join(" / ") || null;
  const recordedAt = unixSeconds(persistedAt);
  connection.sqlite.prepare(
    `INSERT INTO inspiration_wiki_evidence_gap_review_packs
      (review_pack_id, candidate_id, revision, contract_kind, stage, material_hash,
       pack_json, media_assets_json, readiness_json, verified_gate_count,
       primary_preview_url, title, source_summary, teacher_private, student_visible,
       current_page, r2, embedding, lumi_retrieval, created_at, updated_at)
     VALUES (?, ?, ?, 'EVIDENCE_GAP_REVIEW', 'READY_FOR_TEACHER_TRIAGE', ?, ?, ?, ?, ?,
       ?, ?, ?, 1, 0, 'DISABLED', 'DISABLED', 'DISABLED', 'DISABLED', ?, ?)`,
  ).run(
    pack.reviewPackId,
    pack.candidateId,
    pack.revision,
    pack.materialHash,
    stableJson(pack),
    serializedAssets,
    stableJson(pack.readiness),
    evidenceGapVerifiedCount(pack.readiness),
    primaryPreview,
    pack.work.title,
    sourceSummary,
    recordedAt,
    recordedAt,
  );
  return { imported: true, reviewPackId: pack.reviewPackId } as const;
}

function materialWithoutHash(pack: EvidenceGapReviewPack) {
  const material = { ...pack } as Partial<EvidenceGapReviewPack>;
  delete material.materialHash;
  return material as Omit<EvidenceGapReviewPack, "materialHash">;
}

function amendmentInvariant(pack: EvidenceGapReviewPack) {
  const material = structuredClone(pack) as unknown as Record<string, unknown>;
  delete material.revision;
  delete material.materialHash;
  delete material.preparedAt;
  delete material.mediaGroup;
  const readiness = material.readiness as Record<string, unknown>;
  delete readiness.controlledMediaGroup;
  return stableJson(material);
}

function assertAssetMimeMatchesStoragePath(asset: EvidenceGapStoredAsset) {
  const expectedMime = asset.storagePath.endsWith(".png")
    ? "image/png"
    : asset.storagePath.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  if (asset.mimeType !== expectedMime) {
    throw new EvidenceGapReviewConflictError("Evidence media MIME does not match its storage path");
  }
}

/**
 * Applies the only allowed post-import material correction: zero media to one
 * teacher-private, explicitly unverified local preview. It does not relax the
 * normal pack importer or any publication capability.
 */
export function amendEvidenceGapReviewPackMedia(
  connection: DatabaseConnection,
  rawInput: EvidenceGapMediaAmendmentInput,
  amendedAt: string | Date = new Date(),
) {
  const metadata = MediaAmendmentMetadataSchema.parse({
    expectedRevision: rawInput.expectedRevision,
    expectedMaterialHash: rawInput.expectedMaterialHash,
    idempotencyKey: rawInput.idempotencyKey,
    sourcePackageDigest: rawInput.sourcePackageDigest,
  });
  const amendedPack = EvidenceGapReviewPackSchema.parse(rawInput.amendedPack);
  const assets = EvidenceGapStoredAssetsSchema.parse(rawInput.assets);
  const normalizedRequest = { ...metadata, amendedPack, assets };
  const requestHash = hash(stableJson(normalizedRequest));
  const recordedAt = unixSeconds(amendedAt);

  if (calculateEvidenceGapReviewMaterialHash(materialWithoutHash(amendedPack)) !== amendedPack.materialHash) {
    throw new EvidenceGapReviewConflictError("Amended evidence-gap material hash does not match its content");
  }
  if (amendedPack.revision !== metadata.expectedRevision + 1) {
    throw new EvidenceGapReviewConflictError("Media amendment must advance the review pack by exactly one revision");
  }
  if (amendedPack.mediaGroup.length !== 1 || assets.length !== 1) {
    throw new EvidenceGapReviewConflictError("Media amendment must add exactly one local preview");
  }
  const media = amendedPack.mediaGroup[0]!;
  const asset = assets[0]!;
  if (media.reviewStatus !== "UNVERIFIED"
    || media.role !== null
    || media.alt !== null
    || amendedPack.readiness.controlledMediaGroup.status !== "PRESENT_UNVERIFIED"
    || !amendedPack.readiness.controlledMediaGroup.evidenceRefs.includes(media.mediaId)) {
    throw new EvidenceGapReviewConflictError("Recovered media must remain explicitly unverified");
  }
  if (asset.mediaId !== media.mediaId || asset.sha256 !== media.sha256) {
    throw new EvidenceGapReviewConflictError("Evidence media asset does not match the amended mediaGroup");
  }
  const expectedPreview = `/api/teacher/inspiration-wiki/review-packs/${amendedPack.reviewPackId}/media/${media.mediaId}`;
  if (media.previewUrl !== expectedPreview) {
    throw new EvidenceGapReviewConflictError("Evidence media preview URL is not bound to its review pack");
  }
  assertAssetMimeMatchesStoragePath(asset);

  return connection.sqlite.transaction(() => {
    const existingAmendment = connection.sqlite.prepare(
      `SELECT request_hash, review_pack_id, previous_revision, next_revision,
        previous_material_hash, next_material_hash, media_id, created_at
       FROM inspiration_wiki_evidence_gap_media_amendments WHERE idempotency_key = ?`,
    ).get(metadata.idempotencyKey) as {
      request_hash: string;
      review_pack_id: string;
      previous_revision: number;
      next_revision: number;
      previous_material_hash: string;
      next_material_hash: string;
      media_id: string;
      created_at: number;
    } | undefined;
    if (existingAmendment) {
      if (existingAmendment.request_hash !== requestHash) throw new EvidenceGapReviewIdempotencyConflictError();
      return {
        reviewPackId: existingAmendment.review_pack_id,
        previousRevision: existingAmendment.previous_revision,
        revision: existingAmendment.next_revision,
        previousMaterialHash: existingAmendment.previous_material_hash,
        materialHash: existingAmendment.next_material_hash,
        mediaId: existingAmendment.media_id,
        replayed: true,
        amendedAt: new Date(existingAmendment.created_at * 1_000).toISOString(),
      } as const;
    }

    const row = connection.sqlite.prepare(
      `SELECT review_pack_id, candidate_id, revision, stage, material_hash, pack_json,
        media_assets_json, primary_preview_url, title, source_summary, updated_at
       FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id = ?`,
    ).get(amendedPack.reviewPackId) as GapRow | undefined;
    if (!row) throw new EvidenceGapReviewNotFoundError();
    if (row.stage !== "READY_FOR_TEACHER_TRIAGE") {
      throw new EvidenceGapReviewConflictError("Only a ready, undecided evidence-gap pack may receive recovered media");
    }
    if (row.revision !== metadata.expectedRevision || row.material_hash !== metadata.expectedMaterialHash) {
      throw new EvidenceGapReviewRevisionConflictError();
    }
    if (row.candidate_id !== amendedPack.candidateId || row.review_pack_id !== amendedPack.reviewPackId) {
      throw new EvidenceGapReviewConflictError("Media amendment cannot change review pack identity");
    }
    const previousPack = EvidenceGapReviewPackSchema.parse(parseJson<unknown>(row.pack_json));
    const previousAssets = EvidenceGapStoredAssetsSchema.parse(parseJson<unknown>(row.media_assets_json));
    if (previousPack.revision !== row.revision
      || previousPack.materialHash !== row.material_hash
      || calculateEvidenceGapReviewMaterialHash(materialWithoutHash(previousPack)) !== previousPack.materialHash) {
      throw new EvidenceGapReviewConflictError("Persisted evidence-gap material is internally inconsistent");
    }
    if (previousPack.mediaGroup.length !== 0 || previousAssets.length !== 0 || row.primary_preview_url !== null) {
      throw new EvidenceGapReviewConflictError("Media amendment only supports a zero-media review pack");
    }
    if (previousPack.readiness.controlledMediaGroup.status !== "MISSING"
      || previousPack.readiness.controlledMediaGroup.evidenceRefs.length !== 0) {
      throw new EvidenceGapReviewConflictError("Media amendment requires an explicit missing-media baseline");
    }
    if (amendmentInvariant(previousPack) !== amendmentInvariant(amendedPack)) {
      throw new EvidenceGapReviewConflictError("Media amendment changed fields outside the correction allowlist");
    }
    const hasDecision = connection.sqlite.prepare(
      "SELECT 1 FROM inspiration_wiki_evidence_gap_review_decisions WHERE review_pack_id = ? LIMIT 1",
    ).get(amendedPack.reviewPackId);
    if (hasDecision) {
      throw new EvidenceGapReviewConflictError("A decided evidence-gap review pack cannot be amended");
    }

    const serializedPack = stableJson(amendedPack);
    const serializedAssets = stableJson(assets);
    const update = connection.sqlite.prepare(
      `UPDATE inspiration_wiki_evidence_gap_review_packs
       SET revision = ?, material_hash = ?, pack_json = ?, media_assets_json = ?,
         readiness_json = ?, verified_gate_count = ?, primary_preview_url = ?, updated_at = ?
       WHERE review_pack_id = ? AND candidate_id = ? AND revision = ? AND material_hash = ?
         AND stage = 'READY_FOR_TEACHER_TRIAGE' AND primary_preview_url IS NULL
         AND json_array_length(media_assets_json) = 0
         AND NOT EXISTS (
           SELECT 1 FROM inspiration_wiki_evidence_gap_review_decisions
           WHERE review_pack_id = inspiration_wiki_evidence_gap_review_packs.review_pack_id
         )`,
    ).run(
      amendedPack.revision,
      amendedPack.materialHash,
      serializedPack,
      serializedAssets,
      stableJson(amendedPack.readiness),
      evidenceGapVerifiedCount(amendedPack.readiness),
      media.previewUrl,
      recordedAt,
      amendedPack.reviewPackId,
      amendedPack.candidateId,
      metadata.expectedRevision,
      metadata.expectedMaterialHash,
    );
    if (update.changes !== 1) throw new EvidenceGapReviewRevisionConflictError();

    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_evidence_gap_media_amendments
        (id, review_pack_id, candidate_id, amendment_kind, previous_revision, next_revision,
         previous_material_hash, next_material_hash, media_id, asset_storage_path,
         asset_sha256, asset_mime_type, asset_bytes, source_package_digest,
         idempotency_key, request_hash, previous_pack_json, amended_pack_json,
         previous_assets_json, amended_assets_json, created_at)
       VALUES (?, ?, ?, 'ADD_UNVERIFIED_LOCAL_PREVIEW', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
    ).run(
      randomUUID(),
      amendedPack.reviewPackId,
      amendedPack.candidateId,
      metadata.expectedRevision,
      amendedPack.revision,
      metadata.expectedMaterialHash,
      amendedPack.materialHash,
      media.mediaId,
      asset.storagePath,
      asset.sha256,
      asset.mimeType,
      asset.bytes,
      metadata.sourcePackageDigest,
      metadata.idempotencyKey,
      requestHash,
      row.pack_json,
      serializedPack,
      row.media_assets_json,
      serializedAssets,
      recordedAt,
    );

    return {
      reviewPackId: amendedPack.reviewPackId,
      previousRevision: metadata.expectedRevision,
      revision: amendedPack.revision,
      previousMaterialHash: metadata.expectedMaterialHash,
      materialHash: amendedPack.materialHash,
      mediaId: media.mediaId,
      replayed: false,
      amendedAt: new Date(recordedAt * 1_000).toISOString(),
    } as const;
  }).immediate();
}

const ANALYZED_REQUIREMENTS = [
  "controlledMediaGroup",
  "normalizedClassification",
  "visualDescription",
  "duplicateRelationship",
  "curationRecommendation",
  "teachingRecommendation",
] as const;

const UNKNOWN_REQUIREMENTS = [
  "workSourceMatch",
  "sourceRole",
  "rightsEvidence",
] as const;

function analysisIdentity(pack: EvidenceGapReviewPack) {
  return stableJson({
    schemaVersion: pack.schemaVersion,
    contractKind: pack.contractKind,
    reviewPackId: pack.reviewPackId,
    candidateId: pack.candidateId,
    stage: pack.stage,
    title: pack.work.title,
    sources: pack.sources.map(({ sourceId, platform, pageUrl }) => ({ sourceId, platform, pageUrl })),
    media: pack.mediaGroup.map(({ mediaId, previewUrl, width, height, sha256 }) => ({
      mediaId,
      previewUrl,
      width,
      height,
      sha256,
    })),
    capabilityBoundary: pack.capabilityBoundary,
  });
}

function assertSixAnalyzedThreeUnknown(pack: EvidenceGapReviewPack) {
  for (const field of UNKNOWN_REQUIREMENTS) {
    const requirement = pack.readiness[field];
    if (requirement.status !== "UNKNOWN"
      || requirement.note !== "未知"
      || requirement.evidenceRefs.length !== 0) {
      throw new EvidenceGapReviewConflictError("The three unresolved evidence requirements must be recorded exactly as unknown");
    }
  }
  for (const field of ANALYZED_REQUIREMENTS) {
    if (pack.readiness[field].status !== "VERIFIED") {
      throw new EvidenceGapReviewConflictError("All six analyzable requirements must be completed");
    }
  }
  if (pack.work.workSourceMatchEvidence.length !== 1 || pack.work.workSourceMatchEvidence[0] !== "未知") {
    throw new EvidenceGapReviewConflictError("Work-source match must remain unknown");
  }
  if (pack.sources.length === 0 || pack.sources.some((source) => (
    source.role !== "UNVERIFIED"
    || source.creatorName !== null
    || source.curatorName !== null
    || source.evidenceStatement !== "未知"
  ))) {
    throw new EvidenceGapReviewConflictError("Source roles must remain unknown while preserving source pages");
  }
  if (pack.rightsEvidence.length !== 1) {
    throw new EvidenceGapReviewConflictError("Unknown rights must be represented by one explicit evidence record");
  }
  const rights = pack.rightsEvidence[0]!;
  if (rights.evidenceType !== null
    || rights.sourceUrl !== null
    || rights.capturedAt !== null
    || rights.summary !== "未知"
    || rights.privateTeacherReviewDecision !== "UNKNOWN"
    || rights.republicationDecision !== "UNKNOWN"
    || rights.authorPageIsNotRepublishingPermission !== null) {
    throw new EvidenceGapReviewConflictError("Rights evidence must remain explicitly unknown");
  }
  if (pack.mediaGroup.length === 0 || pack.mediaGroup.some((media) => (
    media.reviewStatus !== "VERIFIED_FOR_PRIVATE_REVIEW"
    || media.role !== "COVER"
    || media.alt === null
  ))) {
    throw new EvidenceGapReviewConflictError("Controlled media analysis requires a local teacher-private cover");
  }
  if (!pack.normalizedClassification.primary
    || pack.normalizedClassification.secondary.length === 0
    || !pack.visualDescription.summary
    || !pack.visualDescription.artisticStyle
    || pack.visualDescription.artisticStyle.labels.length === 0
    || !pack.visualDescription.artisticStyle.rationale
    || pack.visualDescription.observations.length === 0
    || pack.duplicateRelationship.status === "UNASSESSED"
    || pack.curationRecommendation.recommendation === "UNASSESSED"
    || pack.teachingRecommendation.recommendation === "UNASSESSED"
    || pack.teachingRecommendation.prompts.length === 0
    || pack.safetyAssessment.status !== "READY_FOR_TEACHER_DECISION") {
    throw new EvidenceGapReviewConflictError("The six analyzed requirements are incomplete");
  }
  if (evidenceGapVerifiedCount(pack.readiness) !== 6
    || evidenceGapRequirementKeys(pack.readiness).sort().join(",")
      !== ["RIGHTS_EVIDENCE", "SOURCE_ROLE", "WORK_SOURCE_MATCH"].sort().join(",")) {
    throw new EvidenceGapReviewConflictError("Analysis revision must resolve exactly six of nine requirements");
  }
}

/**
 * Replaces provisional gap material with a reviewed six-gate analysis while
 * preserving the three user-declared unknowns and every private-only boundary.
 */
export function reviseEvidenceGapReviewPackAnalysis(
  connection: DatabaseConnection,
  rawInput: EvidenceGapAnalysisRevisionInput,
  analyzedAt: string | Date = new Date(),
) {
  const metadata = AnalysisRevisionMetadataSchema.parse({
    expectedRevision: rawInput.expectedRevision,
    expectedMaterialHash: rawInput.expectedMaterialHash,
    idempotencyKey: rawInput.idempotencyKey,
    sourceArtifactDigest: rawInput.sourceArtifactDigest,
  });
  const revisedPack = EvidenceGapReviewPackSchema.parse(rawInput.revisedPack);
  const normalizedRequest = { ...metadata, revisedPack };
  const requestHash = hash(stableJson(normalizedRequest));
  const recordedAt = unixSeconds(analyzedAt);

  if (calculateEvidenceGapReviewMaterialHash(materialWithoutHash(revisedPack)) !== revisedPack.materialHash) {
    throw new EvidenceGapReviewConflictError("Revised evidence-gap material hash does not match its content");
  }
  if (revisedPack.revision !== metadata.expectedRevision + 1) {
    throw new EvidenceGapReviewConflictError("Analysis must advance the review pack by exactly one revision");
  }
  assertSixAnalyzedThreeUnknown(revisedPack);

  return connection.sqlite.transaction(() => {
    const existingRevision = connection.sqlite.prepare(
      `SELECT request_hash, review_pack_id, previous_revision, next_revision,
        previous_material_hash, next_material_hash, created_at
       FROM inspiration_wiki_evidence_gap_analysis_revisions WHERE idempotency_key = ?`,
    ).get(metadata.idempotencyKey) as {
      request_hash: string;
      review_pack_id: string;
      previous_revision: number;
      next_revision: number;
      previous_material_hash: string;
      next_material_hash: string;
      created_at: number;
    } | undefined;
    if (existingRevision) {
      if (existingRevision.request_hash !== requestHash) throw new EvidenceGapReviewIdempotencyConflictError();
      return {
        reviewPackId: existingRevision.review_pack_id,
        previousRevision: existingRevision.previous_revision,
        revision: existingRevision.next_revision,
        previousMaterialHash: existingRevision.previous_material_hash,
        materialHash: existingRevision.next_material_hash,
        replayed: true,
        analyzedAt: new Date(existingRevision.created_at * 1_000).toISOString(),
      } as const;
    }

    const row = connection.sqlite.prepare(
      `SELECT review_pack_id, candidate_id, revision, stage, material_hash, pack_json,
        media_assets_json, primary_preview_url, title, source_summary, updated_at
       FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id = ?`,
    ).get(revisedPack.reviewPackId) as GapRow | undefined;
    if (!row) throw new EvidenceGapReviewNotFoundError();
    if (row.stage !== "READY_FOR_TEACHER_TRIAGE") {
      throw new EvidenceGapReviewConflictError("Only an undecided evidence-gap pack may receive an analysis revision");
    }
    if (row.revision !== metadata.expectedRevision || row.material_hash !== metadata.expectedMaterialHash) {
      throw new EvidenceGapReviewRevisionConflictError();
    }
    if (row.candidate_id !== revisedPack.candidateId) {
      throw new EvidenceGapReviewConflictError("Analysis cannot change review pack identity");
    }
    const previousPack = EvidenceGapReviewPackSchema.parse(parseJson<unknown>(row.pack_json));
    EvidenceGapStoredAssetsSchema.parse(parseJson<unknown>(row.media_assets_json));
    if (previousPack.revision !== row.revision
      || previousPack.materialHash !== row.material_hash
      || calculateEvidenceGapReviewMaterialHash(materialWithoutHash(previousPack)) !== previousPack.materialHash) {
      throw new EvidenceGapReviewConflictError("Persisted evidence-gap material is internally inconsistent");
    }
    if (analysisIdentity(previousPack) !== analysisIdentity(revisedPack)) {
      throw new EvidenceGapReviewConflictError("Analysis changed identity, source pages, media bytes, or capability boundaries");
    }
    const hasDecision = connection.sqlite.prepare(
      "SELECT 1 FROM inspiration_wiki_evidence_gap_review_decisions WHERE review_pack_id = ? LIMIT 1",
    ).get(revisedPack.reviewPackId);
    if (hasDecision) {
      throw new EvidenceGapReviewConflictError("A decided evidence-gap review pack cannot be revised by Codex analysis");
    }

    const serializedPack = stableJson(revisedPack);
    const sourceSummary = revisedPack.sources
      .map((source) => source.label ?? `${source.platform} · 来源角色未知`)
      .join(" / ");
    const update = connection.sqlite.prepare(
      `UPDATE inspiration_wiki_evidence_gap_review_packs
       SET revision = ?, material_hash = ?, pack_json = ?, readiness_json = ?,
         verified_gate_count = 6, source_summary = ?, updated_at = ?
       WHERE review_pack_id = ? AND candidate_id = ? AND revision = ? AND material_hash = ?
         AND stage = 'READY_FOR_TEACHER_TRIAGE'
         AND NOT EXISTS (
           SELECT 1 FROM inspiration_wiki_evidence_gap_review_decisions
           WHERE review_pack_id = inspiration_wiki_evidence_gap_review_packs.review_pack_id
         )`,
    ).run(
      revisedPack.revision,
      revisedPack.materialHash,
      serializedPack,
      stableJson(revisedPack.readiness),
      sourceSummary,
      recordedAt,
      revisedPack.reviewPackId,
      revisedPack.candidateId,
      metadata.expectedRevision,
      metadata.expectedMaterialHash,
    );
    if (update.changes !== 1) throw new EvidenceGapReviewRevisionConflictError();

    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_evidence_gap_analysis_revisions
        (id, review_pack_id, candidate_id, analysis_kind, previous_revision, next_revision,
         previous_material_hash, next_material_hash, source_artifact_digest,
         idempotency_key, request_hash, previous_pack_json, revised_pack_json, created_at)
       VALUES (?, ?, ?, 'SIX_ANALYZED_THREE_UNKNOWN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      revisedPack.reviewPackId,
      revisedPack.candidateId,
      metadata.expectedRevision,
      revisedPack.revision,
      metadata.expectedMaterialHash,
      revisedPack.materialHash,
      metadata.sourceArtifactDigest,
      metadata.idempotencyKey,
      requestHash,
      row.pack_json,
      serializedPack,
      recordedAt,
    );

    return {
      reviewPackId: revisedPack.reviewPackId,
      previousRevision: metadata.expectedRevision,
      revision: revisedPack.revision,
      previousMaterialHash: metadata.expectedMaterialHash,
      materialHash: revisedPack.materialHash,
      replayed: false,
      analyzedAt: new Date(recordedAt * 1_000).toISOString(),
    } as const;
  }).immediate();
}

/**
 * Applies a teacher-requested analysis correction after RETURN_TO_CODEX and
 * reopens the same private pack for a new teacher decision. The earlier
 * decision and material snapshots remain append-only.
 */
export function supplementReturnedEvidenceGapReviewPackAnalysis(
  connection: DatabaseConnection,
  rawInput: EvidenceGapAnalysisRevisionInput,
  supplementedAt: string | Date = new Date(),
) {
  const metadata = AnalysisRevisionMetadataSchema.parse({
    expectedRevision: rawInput.expectedRevision,
    expectedMaterialHash: rawInput.expectedMaterialHash,
    idempotencyKey: rawInput.idempotencyKey,
    sourceArtifactDigest: rawInput.sourceArtifactDigest,
  });
  const revisedPack = EvidenceGapReviewPackSchema.parse(rawInput.revisedPack);
  const normalizedRequest = { ...metadata, revisedPack };
  const requestHash = hash(stableJson(normalizedRequest));
  const recordedAt = unixSeconds(supplementedAt);

  if (calculateEvidenceGapReviewMaterialHash(materialWithoutHash(revisedPack)) !== revisedPack.materialHash) {
    throw new EvidenceGapReviewConflictError("Revised evidence-gap material hash does not match its content");
  }
  if (revisedPack.revision !== metadata.expectedRevision + 1) {
    throw new EvidenceGapReviewConflictError("Supplement must advance the current review revision exactly once");
  }
  assertSixAnalyzedThreeUnknown(revisedPack);

  return connection.sqlite.transaction(() => {
    const existingRevision = connection.sqlite.prepare(
      `SELECT request_hash, review_pack_id, previous_revision, next_revision,
        previous_material_hash, next_material_hash, created_at
       FROM inspiration_wiki_evidence_gap_analysis_revisions WHERE idempotency_key = ?`,
    ).get(metadata.idempotencyKey) as {
      request_hash: string;
      review_pack_id: string;
      previous_revision: number;
      next_revision: number;
      previous_material_hash: string;
      next_material_hash: string;
      created_at: number;
    } | undefined;
    if (existingRevision) {
      if (existingRevision.request_hash !== requestHash) throw new EvidenceGapReviewIdempotencyConflictError();
      return {
        reviewPackId: existingRevision.review_pack_id,
        previousRevision: existingRevision.previous_revision,
        revision: existingRevision.next_revision,
        previousMaterialHash: existingRevision.previous_material_hash,
        materialHash: existingRevision.next_material_hash,
        stage: "READY_FOR_TEACHER_TRIAGE" as const,
        replayed: true,
        supplementedAt: new Date(existingRevision.created_at * 1_000).toISOString(),
      } as const;
    }

    const row = connection.sqlite.prepare(
      `SELECT review_pack_id, candidate_id, revision, stage, material_hash, pack_json,
        media_assets_json, primary_preview_url, title, source_summary, updated_at
       FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id = ?`,
    ).get(revisedPack.reviewPackId) as GapRow | undefined;
    if (!row) throw new EvidenceGapReviewNotFoundError();
    if (row.stage !== "RETURNED_TO_CODEX") {
      throw new EvidenceGapReviewConflictError("Only a teacher-returned evidence-gap pack may be supplemented");
    }
    if (row.revision !== metadata.expectedRevision || row.material_hash !== metadata.expectedMaterialHash) {
      throw new EvidenceGapReviewRevisionConflictError();
    }
    if (row.candidate_id !== revisedPack.candidateId) {
      throw new EvidenceGapReviewConflictError("Supplement cannot change review pack identity");
    }

    const previousPack = EvidenceGapReviewPackSchema.parse(parseJson<unknown>(row.pack_json));
    EvidenceGapStoredAssetsSchema.parse(parseJson<unknown>(row.media_assets_json));
    if (previousPack.revision !== row.revision - 1
      || previousPack.materialHash !== row.material_hash
      || calculateEvidenceGapReviewMaterialHash(materialWithoutHash(previousPack)) !== previousPack.materialHash) {
      throw new EvidenceGapReviewConflictError("Returned evidence-gap material is internally inconsistent");
    }
    if (analysisIdentity(previousPack) !== analysisIdentity(revisedPack)) {
      throw new EvidenceGapReviewConflictError("Supplement changed identity, source pages, media bytes, or capability boundaries");
    }

    const latestDecision = connection.sqlite.prepare(
      `SELECT review_pack_revision, final_action, next_stage, note
       FROM inspiration_wiki_evidence_gap_review_decisions
       WHERE review_pack_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).get(revisedPack.reviewPackId) as {
      review_pack_revision: number;
      final_action: string;
      next_stage: string;
      note: string;
    } | undefined;
    if (!latestDecision
      || latestDecision.review_pack_revision !== row.revision - 1
      || latestDecision.final_action !== "RETURN_TO_CODEX"
      || latestDecision.next_stage !== "RETURNED_TO_CODEX"
      || latestDecision.note.trim().length === 0) {
      throw new EvidenceGapReviewConflictError("Supplement requires the latest teacher decision to be a reasoned return");
    }

    const serializedPack = stableJson(revisedPack);
    const sourceSummary = revisedPack.sources
      .map((source) => source.label ?? `${source.platform} · 来源角色未知`)
      .join(" / ");
    const update = connection.sqlite.prepare(
      `UPDATE inspiration_wiki_evidence_gap_review_packs
       SET stage = 'READY_FOR_TEACHER_TRIAGE', revision = ?, material_hash = ?,
         pack_json = ?, readiness_json = ?, verified_gate_count = 6,
         source_summary = ?, updated_at = ?
       WHERE review_pack_id = ? AND candidate_id = ? AND revision = ? AND material_hash = ?
         AND stage = 'RETURNED_TO_CODEX'
         AND EXISTS (
           SELECT 1 FROM inspiration_wiki_evidence_gap_review_decisions decision
           WHERE decision.review_pack_id = inspiration_wiki_evidence_gap_review_packs.review_pack_id
             AND decision.review_pack_revision = ?
             AND decision.final_action = 'RETURN_TO_CODEX'
             AND decision.next_stage = 'RETURNED_TO_CODEX'
         )`,
    ).run(
      revisedPack.revision,
      revisedPack.materialHash,
      serializedPack,
      stableJson(revisedPack.readiness),
      sourceSummary,
      recordedAt,
      revisedPack.reviewPackId,
      revisedPack.candidateId,
      metadata.expectedRevision,
      metadata.expectedMaterialHash,
      metadata.expectedRevision - 1,
    );
    if (update.changes !== 1) throw new EvidenceGapReviewRevisionConflictError();

    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_evidence_gap_analysis_revisions
        (id, review_pack_id, candidate_id, analysis_kind, previous_revision, next_revision,
         previous_material_hash, next_material_hash, source_artifact_digest,
         idempotency_key, request_hash, previous_pack_json, revised_pack_json, created_at)
       VALUES (?, ?, ?, 'SIX_ANALYZED_THREE_UNKNOWN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      revisedPack.reviewPackId,
      revisedPack.candidateId,
      metadata.expectedRevision,
      revisedPack.revision,
      metadata.expectedMaterialHash,
      revisedPack.materialHash,
      metadata.sourceArtifactDigest,
      metadata.idempotencyKey,
      requestHash,
      row.pack_json,
      serializedPack,
      recordedAt,
    );

    return {
      reviewPackId: revisedPack.reviewPackId,
      previousRevision: metadata.expectedRevision,
      revision: revisedPack.revision,
      previousMaterialHash: metadata.expectedMaterialHash,
      materialHash: revisedPack.materialHash,
      stage: "READY_FOR_TEACHER_TRIAGE" as const,
      replayed: false,
      supplementedAt: new Date(recordedAt * 1_000).toISOString(),
    } as const;
  }).immediate();
}

function queueItem(row: GapRow) {
  const pack = EvidenceGapReviewPackSchema.parse(parseJson(row.pack_json));
  return {
    contractKind: "EVIDENCE_GAP_REVIEW" as const,
    reviewPackId: row.review_pack_id,
    candidateId: row.candidate_id,
    revision: row.revision,
    title: row.title,
    primaryPreviewUrl: row.primary_preview_url,
    sourceSummary: row.source_summary,
    verifiedCount: evidenceGapVerifiedCount(pack.readiness),
    missingGates: evidenceGapRequirementKeys(pack.readiness),
    updatedAt: new Date(row.updated_at * 1_000).toISOString(),
  };
}

export function readTeacherEvidenceGapReviewQueue(connection: DatabaseConnection, actor: SessionPayload) {
  readTeacherScope(connection.db, actor);
  const rows = connection.sqlite.prepare(
    `SELECT review_pack_id, candidate_id, revision, stage, material_hash, pack_json,
      media_assets_json, primary_preview_url, title, source_summary, updated_at
     FROM inspiration_wiki_evidence_gap_review_packs
     ORDER BY updated_at ASC, review_pack_id ASC`,
  ).all() as GapRow[];
  const items = rows.filter((row) => row.stage === "READY_FOR_TEACHER_TRIAGE")
    .map((row) => ({ ...queueItem(row), stage: "READY_FOR_TEACHER_TRIAGE" as const }));
  const reviewedItems = rows.filter((row) => row.stage !== "READY_FOR_TEACHER_TRIAGE")
    .map((row) => ({ ...queueItem(row), stage: row.stage as Exclude<GapStage, "READY_FOR_TEACHER_TRIAGE"> }));
  const withLocalMedia = rows.filter((row) => parseJson<unknown[]>(row.media_assets_json).length > 0).length;
  const gateStatusCounts = Object.fromEntries(
    ReviewPackRequirementKeySchema.options.map((key) => [key, {
      VERIFIED: 0,
      UNKNOWN: 0,
      PRESENT_UNVERIFIED: 0,
      MISSING: 0,
      BLOCKED: 0,
    }]),
  ) as Record<z.infer<typeof ReviewPackRequirementKeySchema>, Record<"VERIFIED" | "UNKNOWN" | "PRESENT_UNVERIFIED" | "MISSING" | "BLOCKED", number>>;
  for (const row of rows) {
    const readiness = EvidenceGapReviewPackSchema.parse(parseJson<unknown>(row.pack_json)).readiness;
    for (const [key, field] of Object.entries(REQUIREMENT_FIELDS) as Array<[keyof typeof REQUIREMENT_FIELDS, (typeof REQUIREMENT_FIELDS)[keyof typeof REQUIREMENT_FIELDS]]>) {
      gateStatusCounts[key][readiness[field].status] += 1;
    }
  }
  return {
    items,
    reviewedItems,
    meta: {
      totalEvidenceGapPacks: rows.length,
      teacherTriageReady: items.length,
      teacherReviewed: reviewedItems.length,
      withLocalMedia,
      withoutLocalMedia: rows.length - withLocalMedia,
      gateStatusCounts,
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

export function readTeacherEvidenceGapReviewPack(
  connection: DatabaseConnection,
  actor: SessionPayload,
  reviewPackId: string,
) {
  readTeacherScope(connection.db, actor);
  EvidenceGapReviewPackIdSchema.parse(reviewPackId);
  const row = connection.sqlite.prepare(
    "SELECT pack_json, stage, revision FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id = ?",
  ).get(reviewPackId) as { pack_json: string; stage: GapStage; revision: number } | undefined;
  if (!row) throw new EvidenceGapReviewNotFoundError();
  const pack = EvidenceGapReviewPackSchema.parse(parseJson(row.pack_json));
  const latest = connection.sqlite.prepare(
    `SELECT review_pack_revision, accepted_gap_keys_json, final_action, note,
      private_draft_only, created_at
     FROM inspiration_wiki_evidence_gap_review_decisions
     WHERE review_pack_id = ?
     ORDER BY review_pack_revision DESC, created_at DESC, id DESC
     LIMIT 1`,
  ).get(reviewPackId) as {
    review_pack_revision: number;
    accepted_gap_keys_json: string;
    final_action: EvidenceGapReviewDecisionInput["finalAction"];
    note: string;
    private_draft_only: number;
    created_at: number;
  } | undefined;
  return {
    ...pack,
    editContext: {
      currentStage: row.stage,
      currentReviewRevision: row.revision,
      latestDecision: latest ? {
        reviewPackRevision: latest.review_pack_revision,
        acceptedGapKeys: ReviewPackRequirementKeySchema.array().max(9).parse(parseJson(latest.accepted_gap_keys_json)),
        finalAction: latest.final_action,
        note: latest.note,
        privateDraftOnly: latest.private_draft_only === 1,
        decidedAt: new Date(latest.created_at * 1_000).toISOString(),
      } : null,
    },
  };
}

export function readTeacherEvidenceGapReviewMedia(
  connection: DatabaseConnection,
  actor: SessionPayload,
  reviewPackId: string,
  mediaId: string,
) {
  readTeacherScope(connection.db, actor);
  EvidenceGapReviewPackIdSchema.parse(reviewPackId);
  const row = connection.sqlite.prepare(
    "SELECT media_assets_json FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id = ?",
  ).get(reviewPackId) as { media_assets_json: string } | undefined;
  if (!row) throw new EvidenceGapReviewNotFoundError();
  const asset = EvidenceGapStoredAssetsSchema.parse(parseJson(row.media_assets_json))
    .find((item) => item.mediaId === mediaId);
  if (!asset) throw new EvidenceGapReviewNotFoundError();
  return asset;
}

export function decideTeacherEvidenceGapReview(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: EvidenceGapReviewDecisionInput,
  decidedAt: string | Date = new Date(),
) {
  readTeacherScope(connection.db, actor);
  const input = EvidenceGapReviewDecisionInputSchema.parse(rawInput);
  const requestHash = hash(stableJson(input));
  const existing = connection.sqlite.prepare(
    `SELECT request_hash, review_pack_id, review_pack_revision, final_action,
      next_stage, created_at FROM inspiration_wiki_evidence_gap_review_decisions
     WHERE teacher_id = ? AND idempotency_key = ?`,
  ).get(actor.userId, input.idempotencyKey) as {
    request_hash: string;
    review_pack_id: string;
    review_pack_revision: number;
    final_action: EvidenceGapReviewDecisionInput["finalAction"];
    next_stage: Exclude<GapStage, "READY_FOR_TEACHER_TRIAGE">;
    created_at: number;
  } | undefined;
  if (existing) {
    if (existing.request_hash !== requestHash) throw new EvidenceGapReviewIdempotencyConflictError();
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
      media_assets_json, primary_preview_url, title, source_summary, updated_at
     FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id = ?`,
  ).get(input.reviewPackId) as GapRow | undefined;
  if (!row) throw new EvidenceGapReviewNotFoundError();
  if (row.revision !== input.reviewPackRevision) throw new EvidenceGapReviewRevisionConflictError();
  const pack = EvidenceGapReviewPackSchema.parse(parseJson(row.pack_json));
  EvidenceGapReviewDecisionContextSchema.parse({ pack: { ...pack, revision: row.revision }, decision: input });
  const nextStage = {
    RETURN_TO_CODEX: "RETURNED_TO_CODEX",
    REJECT_CANDIDATE: "REJECTED",
    ENTER_PRIVATE_WIKIDRAFT: "PRIVATE_WIKIDRAFT_WITH_GAPS",
  }[input.finalAction] as Exclude<GapStage, "READY_FOR_TEACHER_TRIAGE">;
  const recordedAt = unixSeconds(decidedAt);
  connection.sqlite.transaction(() => {
    connection.sqlite.prepare(
      `INSERT INTO inspiration_wiki_evidence_gap_review_decisions
        (id, review_pack_id, review_pack_revision, teacher_id, accepted_gap_keys_json,
         final_action, previous_stage, next_stage, note, private_draft_only,
         idempotency_key, request_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(), input.reviewPackId, input.reviewPackRevision, actor.userId,
      stableJson(input.acceptedGapKeys), input.finalAction, row.stage, nextStage, input.note,
      input.privateDraftOnly ? 1 : 0, input.idempotencyKey, requestHash, recordedAt,
    );
    const update = connection.sqlite.prepare(
      `UPDATE inspiration_wiki_evidence_gap_review_packs
       SET stage = ?, revision = revision + 1, updated_at = ?
       WHERE review_pack_id = ? AND revision = ? AND stage = ?`,
    ).run(nextStage, recordedAt, input.reviewPackId, input.reviewPackRevision, row.stage);
    if (update.changes !== 1) throw new EvidenceGapReviewRevisionConflictError();
  }).immediate();
  return {
    reviewPackId: input.reviewPackId,
    previousRevision: input.reviewPackRevision,
    revision: input.reviewPackRevision + 1,
    finalAction: input.finalAction,
    stage: nextStage,
    capabilityBoundary: pack.capabilityBoundary,
    decidedAt: new Date(recordedAt * 1_000).toISOString(),
    replayed: false,
  };
}

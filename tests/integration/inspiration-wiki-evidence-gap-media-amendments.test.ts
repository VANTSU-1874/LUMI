// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseConnection } from "@/lib/db/client";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import type { EvidenceGapReviewPack } from "@/lib/domain/inspiration-wiki/evidence-gap-review-contracts";
import {
  amendEvidenceGapReviewPackMedia,
  calculateEvidenceGapReviewMaterialHash,
  EvidenceGapReviewConflictError,
  EvidenceGapReviewIdempotencyConflictError,
  EvidenceGapReviewRevisionConflictError,
  persistEvidenceGapReviewPack,
  type EvidenceGapStoredAsset,
} from "@/lib/services/inspiration-wiki-evidence-gap-reviews";

const BATCH_ID = "evidence-gap-media-amendment-batch";
const SOURCE_PACKAGE_DIGEST = "c".repeat(64);

function candidateId(hexDigit: string) {
  return `hermes-candidate:${hexDigit.repeat(32)}`;
}

function candidatePageUrl(hexDigit: string) {
  return `https://example.com/work/${hexDigit}`;
}

function seedCandidate(connection: DatabaseConnection, hexDigit: string) {
  connection.sqlite.prepare(`
    INSERT INTO inspiration_wiki_hermes_candidates(
      id, batch_id, source_candidate_id, revision, contract_state, review_state,
      source_id, source_platform, page_url, canonical_url, title, description,
      author_json, license_json, media_json, design_categories_json, screening_json,
      raw_candidate_json, raw_digest, dedupe_fingerprint, scope, student_visible,
      wiki_draft, current_page, r2, embedding, lumi_retrieval, created_at, updated_at
    ) VALUES(?, ?, ?, 1, 'V1_UPGRADE_REQUIRED', 'PENDING_REVIEW', ?,
      'OTHER_PUBLIC_WEB', ?, NULL, ?, NULL, NULL, NULL,
      '[{"kind":"IMAGE","asset":null}]', '["OTHER"]',
      '{"totalScore":0,"evidence":[]}', '{}', ?, ?, 'PRIVATE_CANDIDATE', 0,
      'NOT_CREATED', 'DISABLED', 'DISABLED', 'DISABLED', 'DISABLED',
      1700000000, 1700000000)
  `).run(
    candidateId(hexDigit),
    BATCH_ID,
    `source-candidate-${hexDigit}`,
    `source-${hexDigit}`,
    candidatePageUrl(hexDigit),
    `Evidence-gap work ${hexDigit}`,
    hexDigit.repeat(64),
    hexDigit.repeat(64),
  );
}

function makeGapPack(hexDigit: string): EvidenceGapReviewPack {
  const material: Omit<EvidenceGapReviewPack, "materialHash"> = {
    schemaVersion: "lumi-inspiration-evidence-gap-review-pack/v1",
    contractKind: "EVIDENCE_GAP_REVIEW",
    reviewPackId: `review-pack:evidence-gap-${hexDigit.repeat(8)}`,
    candidateId: candidateId(hexDigit),
    revision: 1,
    stage: "READY_FOR_TEACHER_TRIAGE",
    preparedAt: "2026-08-12T09:00:00.000Z",
    work: {
      title: `Evidence-gap work ${hexDigit}`,
      creators: [],
      year: null,
      workSourceMatchEvidence: [],
    },
    sources: [{
      sourceId: `source-${hexDigit}`,
      platform: "OTHER_PUBLIC_WEB",
      pageUrl: candidatePageUrl(hexDigit),
      role: "UNVERIFIED",
      label: null,
      creatorName: null,
      curatorName: null,
      evidenceStatement: null,
    }],
    mediaGroup: [],
    rightsEvidence: [],
    normalizedClassification: { primary: null, secondary: [], sourceTerms: [] },
    visualDescription: { summary: null, observations: [] },
    duplicateRelationship: {
      status: "DISTINCT",
      relatedCandidateIds: [],
      explanation: "Canonical URL is unique within this isolated fixture.",
    },
    curationRecommendation: {
      recommendation: "RECOMMEND",
      rationale: "A teacher may decide whether incomplete evidence merits further work.",
    },
    teachingRecommendation: {
      recommendation: "UNASSESSED",
      rationale: null,
      prompts: [],
      cautions: [],
    },
    safetyAssessment: { status: "UNASSESSED", evidence: [] },
    readiness: {
      controlledMediaGroup: {
        status: "MISSING",
        note: "No controlled local media was delivered.",
        evidenceRefs: [],
      },
      workSourceMatch: {
        status: "PRESENT_UNVERIFIED",
        note: "The source URL is present but has not been matched by a reviewer.",
        evidenceRefs: [candidatePageUrl(hexDigit)],
      },
      sourceRole: {
        status: "VERIFIED",
        note: "The public source role is preserved without a creator claim.",
        evidenceRefs: [`source-${hexDigit}`],
      },
      rightsEvidence: {
        status: "MISSING",
        note: "No row-level republication evidence is bound.",
        evidenceRefs: [],
      },
      normalizedClassification: {
        status: "PRESENT_UNVERIFIED",
        note: "Source terms exist but normalization is incomplete.",
        evidenceRefs: [],
      },
      visualDescription: {
        status: "MISSING",
        note: "Visual description is not yet available.",
        evidenceRefs: [],
      },
      duplicateRelationship: {
        status: "VERIFIED",
        note: "No canonical duplicate exists in this isolated fixture.",
        evidenceRefs: [candidatePageUrl(hexDigit)],
      },
      curationRecommendation: {
        status: "VERIFIED",
        note: "The recommendation is limited to private teacher triage.",
        evidenceRefs: [`source-${hexDigit}`],
      },
      teachingRecommendation: {
        status: "BLOCKED",
        note: "Teaching use cannot be recommended before visual review.",
        evidenceRefs: [],
      },
    },
    capabilityBoundary: {
      teacherPrivate: true,
      studentVisible: false,
      currentPage: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
    },
  };
  return { ...material, materialHash: calculateEvidenceGapReviewMaterialHash(material) };
}

function withMaterialHash(material: Omit<EvidenceGapReviewPack, "materialHash">): EvidenceGapReviewPack {
  return { ...material, materialHash: calculateEvidenceGapReviewMaterialHash(material) };
}

function withoutMaterialHash(pack: EvidenceGapReviewPack): Omit<EvidenceGapReviewPack, "materialHash"> {
  const material = structuredClone(pack) as Partial<EvidenceGapReviewPack>;
  delete material.materialHash;
  return material as Omit<EvidenceGapReviewPack, "materialHash">;
}

function makeMediaAmendment(pack: EvidenceGapReviewPack, assetSha = "a".repeat(64)) {
  const mediaId = `media-${pack.candidateId.slice(-8)}`;
  const asset: EvidenceGapStoredAsset = {
    mediaId,
    storagePath: `inspiration-wiki/evidence-gap-review-packs/assets/amended-${pack.candidateId.slice(-8)}/${mediaId}.webp`,
    mimeType: "image/webp",
    bytes: 4_096,
    sha256: assetSha,
  };
  const previousMaterial = withoutMaterialHash(pack);
  const amendedMaterial: Omit<EvidenceGapReviewPack, "materialHash"> = {
    ...structuredClone(previousMaterial),
    revision: pack.revision + 1,
    mediaGroup: [{
      mediaId,
      reviewStatus: "UNVERIFIED",
      role: null,
      previewUrl: `/api/teacher/inspiration-wiki/review-packs/${pack.reviewPackId}/media/${mediaId}`,
      width: 640,
      height: 480,
      sha256: assetSha,
      alt: null,
    }],
    readiness: {
      ...structuredClone(pack.readiness),
      controlledMediaGroup: {
        status: "PRESENT_UNVERIFIED",
        note: "A locally decoded preview is present and still requires teacher verification.",
        evidenceRefs: [mediaId],
      },
    },
  };
  return { mediaId, asset, amendedPack: withMaterialHash(amendedMaterial) };
}

function amendmentInput(pack: EvidenceGapReviewPack, idempotencyKey: string) {
  const amendment = makeMediaAmendment(pack);
  return {
    ...amendment,
    input: {
      expectedRevision: pack.revision,
      expectedMaterialHash: pack.materialHash,
      idempotencyKey,
      sourcePackageDigest: SOURCE_PACKAGE_DIGEST,
      amendedPack: amendment.amendedPack,
      assets: [amendment.asset],
    },
  };
}

function amendmentCount(connection: DatabaseConnection) {
  return connection.sqlite.prepare(
    "SELECT count(*) AS count FROM inspiration_wiki_evidence_gap_media_amendments",
  ).get() as { count: number };
}

describe("evidence-gap local-media amendments", () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lumi-gap-media-amendment-"));
    const databasePath = path.join(directory, "private.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','Test teacher',1700000000);");
    connection.sqlite.prepare(`
      INSERT INTO inspiration_wiki_hermes_batches(
        batch_id, contract_version, package_digest, manifest_json, done_json,
        candidate_count, failure_count, intake_state, student_visible,
        current_page, r2, embedding, lumi_retrieval, imported_at
      ) VALUES(?, 'LEGACY_V1', ?, '{}', '{}', 16, 0, 'VALIDATED_PRIVATE', 0,
        'DISABLED', 'DISABLED', 'DISABLED', 'DISABLED', 1700000000)
    `).run(BATCH_ID, "b".repeat(64));
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("atomically changes only zero-media revision 1 into one unverified preview at revision 2 and records an immutable audit snapshot", () => {
    seedCandidate(connection, "1");
    const pack = makeGapPack("1");
    persistEvidenceGapReviewPack(connection, pack, [], "2026-08-12T09:00:00.000Z");
    const { amendedPack, asset, mediaId, input } = amendmentInput(pack, "gap-media-amendment-001");

    const first = amendEvidenceGapReviewPackMedia(
      connection,
      input,
      "2026-08-12T10:15:30.900Z",
    );
    expect(first).toEqual({
      reviewPackId: pack.reviewPackId,
      previousRevision: 1,
      revision: 2,
      previousMaterialHash: pack.materialHash,
      materialHash: amendedPack.materialHash,
      mediaId,
      replayed: false,
      amendedAt: "2026-08-12T10:15:30.000Z",
    });

    const row = connection.sqlite.prepare(`
      SELECT revision, stage, material_hash AS materialHash, pack_json AS packJson,
        media_assets_json AS assetsJson, readiness_json AS readinessJson,
        verified_gate_count AS verifiedGateCount, primary_preview_url AS previewUrl,
        teacher_private AS teacherPrivate, student_visible AS studentVisible,
        current_page AS currentPage, r2, embedding, lumi_retrieval AS lumiRetrieval
      FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id = ?
    `).get(pack.reviewPackId) as Record<string, unknown>;
    expect(row).toMatchObject({
      revision: 2,
      stage: "READY_FOR_TEACHER_TRIAGE",
      materialHash: amendedPack.materialHash,
      verifiedGateCount: 3,
      previewUrl: amendedPack.mediaGroup[0]!.previewUrl,
      teacherPrivate: 1,
      studentVisible: 0,
      currentPage: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
    });
    expect(JSON.parse(row.packJson as string)).toEqual(amendedPack);
    expect(JSON.parse(row.assetsJson as string)).toEqual([asset]);
    expect(JSON.parse(row.readinessJson as string)).toEqual(amendedPack.readiness);

    const audit = connection.sqlite.prepare(`
      SELECT review_pack_id AS reviewPackId, candidate_id AS candidateId,
        amendment_kind AS amendmentKind, previous_revision AS previousRevision,
        next_revision AS nextRevision, previous_material_hash AS previousMaterialHash,
        next_material_hash AS nextMaterialHash, media_id AS mediaId,
        asset_storage_path AS assetStoragePath, asset_sha256 AS assetSha256,
        asset_mime_type AS assetMimeType, asset_bytes AS assetBytes,
        source_package_digest AS sourcePackageDigest, idempotency_key AS idempotencyKey,
        request_hash AS requestHash, previous_pack_json AS previousPackJson,
        amended_pack_json AS amendedPackJson, previous_assets_json AS previousAssetsJson,
        amended_assets_json AS amendedAssetsJson, created_at AS createdAt
      FROM inspiration_wiki_evidence_gap_media_amendments
      WHERE review_pack_id = ?
    `).get(pack.reviewPackId) as Record<string, unknown>;
    expect(audit).toMatchObject({
      reviewPackId: pack.reviewPackId,
      candidateId: pack.candidateId,
      amendmentKind: "ADD_UNVERIFIED_LOCAL_PREVIEW",
      previousRevision: 1,
      nextRevision: 2,
      previousMaterialHash: pack.materialHash,
      nextMaterialHash: amendedPack.materialHash,
      mediaId,
      assetStoragePath: asset.storagePath,
      assetSha256: asset.sha256,
      assetMimeType: "image/webp",
      assetBytes: 4_096,
      sourcePackageDigest: SOURCE_PACKAGE_DIGEST,
      idempotencyKey: "gap-media-amendment-001",
      previousAssetsJson: "[]",
      createdAt: 1_786_529_730,
    });
    expect(audit.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(audit.previousPackJson as string)).toEqual(pack);
    expect(JSON.parse(audit.amendedPackJson as string)).toEqual(amendedPack);
    expect(JSON.parse(audit.amendedAssetsJson as string)).toEqual([asset]);
    expect(() => connection.sqlite.prepare(`
      UPDATE inspiration_wiki_evidence_gap_media_amendments
      SET asset_bytes = asset_bytes + 1 WHERE review_pack_id = ?
    `).run(pack.reviewPackId)).toThrow(/append-only/);
    expect(() => connection.sqlite.prepare(
      "DELETE FROM inspiration_wiki_evidence_gap_media_amendments WHERE review_pack_id = ?",
    ).run(pack.reviewPackId)).toThrow(/append-only/);

    expect(amendEvidenceGapReviewPackMedia(
      connection,
      input,
      "2026-08-12T11:00:00.000Z",
    )).toEqual({ ...first, replayed: true });
    expect(amendmentCount(connection)).toEqual({ count: 1 });

    expect(() => amendEvidenceGapReviewPackMedia(connection, {
      ...input,
      sourcePackageDigest: "d".repeat(64),
    })).toThrow(EvidenceGapReviewIdempotencyConflictError);
    expect(amendmentCount(connection)).toEqual({ count: 1 });
  });

  it("rejects stale expected revisions and material hashes without changing the pack or creating audit rows", () => {
    seedCandidate(connection, "2");
    const pack = makeGapPack("2");
    persistEvidenceGapReviewPack(connection, pack, []);
    const amendment = amendmentInput(pack, "gap-media-stale-revision-001");
    const revisionTwoMaterial = withoutMaterialHash(amendment.amendedPack);
    const revisionThreePack = withMaterialHash({ ...revisionTwoMaterial, revision: 3 });

    expect(() => amendEvidenceGapReviewPackMedia(connection, {
      ...amendment.input,
      expectedRevision: 2,
      amendedPack: revisionThreePack,
    })).toThrow(EvidenceGapReviewRevisionConflictError);
    expect(() => amendEvidenceGapReviewPackMedia(connection, {
      ...amendment.input,
      expectedMaterialHash: "f".repeat(64),
      idempotencyKey: "gap-media-stale-hash-001",
    })).toThrow(EvidenceGapReviewRevisionConflictError);

    expect(connection.sqlite.prepare(`
      SELECT revision, material_hash AS materialHash, media_assets_json AS assetsJson,
        primary_preview_url AS previewUrl
      FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id = ?
    `).get(pack.reviewPackId)).toEqual({
      revision: 1,
      materialHash: pack.materialHash,
      assetsJson: "[]",
      previewUrl: null,
    });
    expect(amendmentCount(connection)).toEqual({ count: 0 });
  });

  it("rejects packs that already have a decision, are not READY, or already contain media", () => {
    seedCandidate(connection, "3");
    const decidedPack = makeGapPack("3");
    persistEvidenceGapReviewPack(connection, decidedPack, []);
    connection.sqlite.prepare(`
      INSERT INTO inspiration_wiki_evidence_gap_review_decisions(
        id, review_pack_id, review_pack_revision, teacher_id, accepted_gap_keys_json,
        final_action, previous_stage, next_stage, note, private_draft_only,
        idempotency_key, request_hash, created_at
      ) VALUES('decision-before-amendment', ?, 1, 'teacher', '[]', 'RETURN_TO_CODEX',
        'READY_FOR_TEACHER_TRIAGE', 'RETURNED_TO_CODEX', 'Existing teacher decision.', 0,
        'existing-decision-001', ?, 1700000001)
    `).run(decidedPack.reviewPackId, "e".repeat(64));
    expect(() => amendEvidenceGapReviewPackMedia(
      connection,
      amendmentInput(decidedPack, "gap-media-after-decision-001").input,
    )).toThrow();

    seedCandidate(connection, "4");
    const returnedPack = makeGapPack("4");
    persistEvidenceGapReviewPack(connection, returnedPack, []);
    connection.sqlite.prepare(
      "UPDATE inspiration_wiki_evidence_gap_review_packs SET stage = 'RETURNED_TO_CODEX' WHERE review_pack_id = ?",
    ).run(returnedPack.reviewPackId);
    expect(() => amendEvidenceGapReviewPackMedia(
      connection,
      amendmentInput(returnedPack, "gap-media-not-ready-001").input,
    )).toThrow();

    seedCandidate(connection, "5");
    const emptyPack = makeGapPack("5");
    const initialMedia = makeMediaAmendment(emptyPack);
    const mediaMaterial = withoutMaterialHash(initialMedia.amendedPack);
    const mediaAtRevisionOne = withMaterialHash({ ...mediaMaterial, revision: 1 });
    persistEvidenceGapReviewPack(connection, mediaAtRevisionOne, [initialMedia.asset]);
    expect(() => amendEvidenceGapReviewPackMedia(
      connection,
      amendmentInput(mediaAtRevisionOne, "gap-media-already-present-001").input,
    )).toThrow(EvidenceGapReviewConflictError);

    expect(amendmentCount(connection)).toEqual({ count: 0 });
  });

  it("rejects asset hash mismatches and any capability or non-media semantic mutation", () => {
    seedCandidate(connection, "6");
    const hashPack = makeGapPack("6");
    persistEvidenceGapReviewPack(connection, hashPack, []);
    const hashAmendment = amendmentInput(hashPack, "gap-media-asset-hash-001");
    expect(() => amendEvidenceGapReviewPackMedia(connection, {
      ...hashAmendment.input,
      assets: [{ ...hashAmendment.asset, sha256: "b".repeat(64) }],
    })).toThrow(EvidenceGapReviewConflictError);

    seedCandidate(connection, "7");
    const semanticPack = makeGapPack("7");
    persistEvidenceGapReviewPack(connection, semanticPack, []);
    const semanticAmendment = amendmentInput(semanticPack, "gap-media-semantic-change-001");
    const semanticMaterial = withoutMaterialHash(semanticAmendment.amendedPack);
    const changedTitlePack = withMaterialHash({
      ...semanticMaterial,
      work: { ...semanticMaterial.work, title: "A silently changed title" },
    });
    expect(() => amendEvidenceGapReviewPackMedia(connection, {
      ...semanticAmendment.input,
      amendedPack: changedTitlePack,
    })).toThrow(EvidenceGapReviewConflictError);

    seedCandidate(connection, "8");
    const capabilityPack = makeGapPack("8");
    persistEvidenceGapReviewPack(connection, capabilityPack, []);
    const capabilityAmendment = amendmentInput(capabilityPack, "gap-media-capability-change-001");
    expect(() => amendEvidenceGapReviewPackMedia(connection, {
      ...capabilityAmendment.input,
      amendedPack: {
        ...capabilityAmendment.amendedPack,
        capabilityBoundary: {
          ...capabilityAmendment.amendedPack.capabilityBoundary,
          studentVisible: true,
        },
      },
    })).toThrow();

    expect(amendmentCount(connection)).toEqual({ count: 0 });
    for (const pack of [hashPack, semanticPack, capabilityPack]) {
      expect(connection.sqlite.prepare(`
        SELECT revision, media_assets_json AS assetsJson, primary_preview_url AS previewUrl
        FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id = ?
      `).get(pack.reviewPackId)).toEqual({ revision: 1, assetsJson: "[]", previewUrl: null });
    }
  });
});

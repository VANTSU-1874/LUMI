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
  calculateEvidenceGapReviewMaterialHash,
  EvidenceGapReviewConflictError,
  EvidenceGapReviewIdempotencyConflictError,
  persistEvidenceGapReviewPack,
  reviseEvidenceGapReviewPackAnalysis,
  supplementReturnedEvidenceGapReviewPackAnalysis,
  type EvidenceGapStoredAsset,
} from "@/lib/services/inspiration-wiki-evidence-gap-reviews";

const BATCH_ID = "evidence-gap-analysis-batch";
const CANDIDATE_ID = `hermes-candidate:${"a".repeat(32)}`;
const REVIEW_PACK_ID = "review-pack:evidence-gap-analysis-001";
const PAGE_URL = "https://example.com/design-work";
const ARTIFACT_DIGEST = "d".repeat(64);
const MEDIA_SHA = "b".repeat(64);

function withHash(material: Omit<EvidenceGapReviewPack, "materialHash">): EvidenceGapReviewPack {
  return { ...material, materialHash: calculateEvidenceGapReviewMaterialHash(material) };
}

function initialPack(): EvidenceGapReviewPack {
  const material: Omit<EvidenceGapReviewPack, "materialHash"> = {
    schemaVersion: "lumi-inspiration-evidence-gap-review-pack/v1",
    contractKind: "EVIDENCE_GAP_REVIEW",
    reviewPackId: REVIEW_PACK_ID,
    candidateId: CANDIDATE_ID,
    revision: 1,
    stage: "READY_FOR_TEACHER_TRIAGE",
    preparedAt: "2026-08-12T10:00:00.000Z",
    work: {
      title: "Analysis fixture",
      creators: [],
      year: null,
      workSourceMatchEvidence: [],
    },
    sources: [{
      sourceId: "fixture-source",
      platform: "OTHER_PUBLIC_WEB",
      pageUrl: PAGE_URL,
      role: "UNVERIFIED",
      label: null,
      creatorName: null,
      curatorName: null,
      evidenceStatement: null,
    }],
    mediaGroup: [{
      mediaId: "gap-media-01",
      reviewStatus: "UNVERIFIED",
      role: null,
      previewUrl: `/api/teacher/inspiration-wiki/review-packs/${REVIEW_PACK_ID}/media/gap-media-01`,
      width: 640,
      height: 480,
      sha256: MEDIA_SHA,
      alt: null,
    }],
    rightsEvidence: [],
    normalizedClassification: { primary: null, secondary: [], sourceTerms: ["PRINT"] },
    visualDescription: { summary: null, observations: [] },
    duplicateRelationship: { status: "UNASSESSED", relatedCandidateIds: [], explanation: null },
    curationRecommendation: { recommendation: "UNASSESSED", rationale: null },
    teachingRecommendation: {
      recommendation: "UNASSESSED",
      rationale: null,
      prompts: [],
      cautions: [],
    },
    safetyAssessment: { status: "UNASSESSED", evidence: [] },
    readiness: {
      controlledMediaGroup: { status: "PRESENT_UNVERIFIED", note: "Preview present.", evidenceRefs: ["gap-media-01"] },
      workSourceMatch: { status: "BLOCKED", note: "Unmatched.", evidenceRefs: [] },
      sourceRole: { status: "BLOCKED", note: "Role unresolved.", evidenceRefs: [] },
      rightsEvidence: { status: "BLOCKED", note: "Rights unresolved.", evidenceRefs: [] },
      normalizedClassification: { status: "PRESENT_UNVERIFIED", note: "Raw category.", evidenceRefs: ["PRINT"] },
      visualDescription: { status: "MISSING", note: "No description.", evidenceRefs: [] },
      duplicateRelationship: { status: "MISSING", note: "Not checked.", evidenceRefs: [] },
      curationRecommendation: { status: "MISSING", note: "Not analyzed.", evidenceRefs: [] },
      teachingRecommendation: { status: "MISSING", note: "Not analyzed.", evidenceRefs: [] },
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
  return withHash(material);
}

function revisedPack(previous: EvidenceGapReviewPack): EvidenceGapReviewPack {
  const previousMaterial = structuredClone(previous) as Partial<EvidenceGapReviewPack>;
  delete previousMaterial.materialHash;
  const material: Omit<EvidenceGapReviewPack, "materialHash"> = {
    ...(previousMaterial as Omit<EvidenceGapReviewPack, "materialHash">),
    revision: previous.revision + 1,
    preparedAt: "2026-08-12T12:35:00.000Z",
    work: {
      title: previous.work.title,
      creators: [],
      year: null,
      workSourceMatchEvidence: ["未知"],
    },
    sources: previous.sources.map((source) => ({
      ...source,
      role: "UNVERIFIED",
      label: "公开网络页面（来源角色未知）",
      creatorName: null,
      curatorName: null,
      evidenceStatement: "未知",
    })),
    mediaGroup: previous.mediaGroup.map((media) => ({
      ...media,
      reviewStatus: "VERIFIED_FOR_PRIVATE_REVIEW",
      role: "COVER",
      alt: "候选封面（教师私有审核）",
    })),
    rightsEvidence: [{
      evidenceId: "rights-unknown-analysis-fixture",
      evidenceType: null,
      sourceUrl: null,
      capturedAt: null,
      summary: "未知",
      privateTeacherReviewDecision: "UNKNOWN",
      republicationDecision: "UNKNOWN",
      authorPageIsNotRepublishingPermission: null,
    }],
    normalizedClassification: {
      primary: "海报与字体设计",
      secondary: ["印刷与海报"],
      sourceTerms: ["PRINT"],
    },
    visualDescription: {
      summary: "黑白竖幅画面以大号文字和几何块建立阅读层级。",
      artisticStyle: {
        labels: ["实验字体", "几何抽象"],
        rationale: "大号字与几何块共同构成画面主体，字形同时承担信息和图形功能。",
      },
      observations: [{
        observation: "黑白竖幅画面以大号文字和几何块建立阅读层级。",
        mediaIds: ["gap-media-01"],
      }],
    },
    duplicateRelationship: {
      status: "DISTINCT",
      relatedCandidateIds: [],
      explanation: "候选 URL、指纹和媒体 SHA-256 均未发现相同项。",
    },
    curationRecommendation: {
      recommendation: "RECOMMEND",
      rationale: "可交由教师在私有队列中判断。",
    },
    teachingRecommendation: {
      recommendation: "RECOMMEND",
      rationale: "可用于观察文字和构图层级。",
      prompts: ["画面如何建立第一阅读顺序？"],
      cautions: ["单张封面不能证明完整项目过程。"],
    },
    safetyAssessment: {
      status: "READY_FOR_TEACHER_DECISION",
      evidence: ["学生与发布能力继续关闭。"],
    },
    readiness: {
      controlledMediaGroup: { status: "VERIFIED", note: "本地封面已完成私有视觉复核。", evidenceRefs: ["gap-media-01"] },
      workSourceMatch: { status: "UNKNOWN", note: "未知", evidenceRefs: [] },
      sourceRole: { status: "UNKNOWN", note: "未知", evidenceRefs: [] },
      rightsEvidence: { status: "UNKNOWN", note: "未知", evidenceRefs: [] },
      normalizedClassification: { status: "VERIFIED", note: "分类已规范化。", evidenceRefs: ["PRINT"] },
      visualDescription: { status: "VERIFIED", note: "视觉描述已完成。", evidenceRefs: ["gap-media-01"] },
      duplicateRelationship: { status: "VERIFIED", note: "重复关系已检查。", evidenceRefs: ["fixture-dedupe"] },
      curationRecommendation: { status: "VERIFIED", note: "策展建议已形成。", evidenceRefs: ["fixture-curation"] },
      teachingRecommendation: { status: "VERIFIED", note: "教学建议已形成。", evidenceRefs: ["fixture-teaching"] },
    },
  };
  return withHash(material);
}

function analysisInput(previous: EvidenceGapReviewPack, idempotencyKey = "gap-analysis-fixture-001") {
  return {
    expectedRevision: previous.revision,
    expectedMaterialHash: previous.materialHash,
    idempotencyKey,
    sourceArtifactDigest: ARTIFACT_DIGEST,
    revisedPack: revisedPack(previous),
  };
}

describe("evidence-gap analysis revisions", () => {
  let directory: string;
  let connection: DatabaseConnection;
  const asset: EvidenceGapStoredAsset = {
    mediaId: "gap-media-01",
    storagePath: "inspiration-wiki/evidence-gap-review-packs/assets/analysis-fixture/gap-media-01.webp",
    mimeType: "image/webp",
    bytes: 4_096,
    sha256: MEDIA_SHA,
  };

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lumi-gap-analysis-"));
    const databasePath = path.join(directory, "private.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','Test teacher',1700000000);");
    connection.sqlite.prepare(`
      INSERT INTO inspiration_wiki_hermes_batches(
        batch_id, contract_version, package_digest, manifest_json, done_json,
        candidate_count, failure_count, intake_state, student_visible,
        current_page, r2, embedding, lumi_retrieval, imported_at
      ) VALUES(?, 'LEGACY_V1', ?, '{}', '{}', 1, 0, 'VALIDATED_PRIVATE', 0,
        'DISABLED', 'DISABLED', 'DISABLED', 'DISABLED', 1700000000)
    `).run(BATCH_ID, "c".repeat(64));
    connection.sqlite.prepare(`
      INSERT INTO inspiration_wiki_hermes_candidates(
        id, batch_id, source_candidate_id, revision, contract_state, review_state,
        source_id, source_platform, page_url, canonical_url, title, description,
        author_json, license_json, media_json, design_categories_json, screening_json,
        raw_candidate_json, raw_digest, dedupe_fingerprint, scope, student_visible,
        wiki_draft, current_page, r2, embedding, lumi_retrieval, created_at, updated_at
      ) VALUES(?, ?, 'source-analysis', 1, 'V1_UPGRADE_REQUIRED', 'PENDING_REVIEW',
        'fixture-source', 'OTHER_PUBLIC_WEB', ?, NULL, 'Analysis fixture', NULL,
        NULL, NULL, '[{"kind":"IMAGE","asset":null}]', '["PRINT"]',
        '{"totalScore":0,"evidence":[]}', '{}', ?, ?, 'PRIVATE_CANDIDATE', 0,
        'NOT_CREATED', 'DISABLED', 'DISABLED', 'DISABLED', 'DISABLED',
        1700000000, 1700000000)
    `).run(CANDIDATE_ID, BATCH_ID, PAGE_URL, "e".repeat(64), "f".repeat(64));
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("advances one revision, records six analyzed and three unknown gates, and keeps the audit immutable", () => {
    const previous = initialPack();
    persistEvidenceGapReviewPack(connection, previous, [asset]);
    const input = analysisInput(previous);
    const revised = input.revisedPack;

    const result = reviseEvidenceGapReviewPackAnalysis(
      connection,
      input,
      "2026-08-12T12:35:00.999Z",
    );
    expect(result).toMatchObject({
      reviewPackId: REVIEW_PACK_ID,
      previousRevision: 1,
      revision: 2,
      previousMaterialHash: previous.materialHash,
      materialHash: revised.materialHash,
      replayed: false,
      analyzedAt: "2026-08-12T12:35:00.000Z",
    });
    expect(revised.visualDescription.artisticStyle).toEqual({
      labels: ["实验字体", "几何抽象"],
      rationale: "大号字与几何块共同构成画面主体，字形同时承担信息和图形功能。",
    });

    const row = connection.sqlite.prepare(`
      SELECT revision, stage, material_hash materialHash, verified_gate_count verifiedCount,
        pack_json packJson, media_assets_json assetsJson, student_visible studentVisible,
        current_page currentPage, r2, embedding, lumi_retrieval lumiRetrieval
      FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id=?
    `).get(REVIEW_PACK_ID) as Record<string, unknown>;
    expect(row).toMatchObject({
      revision: 2,
      stage: "READY_FOR_TEACHER_TRIAGE",
      materialHash: revised.materialHash,
      verifiedCount: 6,
      studentVisible: 0,
      currentPage: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
    });
    expect(JSON.parse(row.packJson as string)).toEqual(revised);
    expect(JSON.parse(row.assetsJson as string)).toEqual([asset]);

    const audit = connection.sqlite.prepare(`
      SELECT analysis_kind analysisKind, previous_revision previousRevision,
        next_revision nextRevision, source_artifact_digest sourceArtifactDigest,
        previous_pack_json previousPackJson, revised_pack_json revisedPackJson
      FROM inspiration_wiki_evidence_gap_analysis_revisions WHERE review_pack_id=?
    `).get(REVIEW_PACK_ID) as Record<string, unknown>;
    expect(audit).toMatchObject({
      analysisKind: "SIX_ANALYZED_THREE_UNKNOWN",
      previousRevision: 1,
      nextRevision: 2,
      sourceArtifactDigest: ARTIFACT_DIGEST,
    });
    expect(JSON.parse(audit.previousPackJson as string)).toEqual(previous);
    expect(JSON.parse(audit.revisedPackJson as string)).toEqual(revised);
    expect(() => connection.sqlite.prepare(
      "UPDATE inspiration_wiki_evidence_gap_analysis_revisions SET next_revision=3 WHERE review_pack_id=?",
    ).run(REVIEW_PACK_ID)).toThrow(/append-only/);
    expect(() => connection.sqlite.prepare(
      "DELETE FROM inspiration_wiki_evidence_gap_analysis_revisions WHERE review_pack_id=?",
    ).run(REVIEW_PACK_ID)).toThrow(/append-only/);

    expect(reviseEvidenceGapReviewPackAnalysis(connection, input)).toEqual({
      ...result,
      replayed: true,
    });
    expect(() => reviseEvidenceGapReviewPackAnalysis(connection, {
      ...input,
      sourceArtifactDigest: "1".repeat(64),
    })).toThrow(EvidenceGapReviewIdempotencyConflictError);
  });

  it("rejects any attempt to alter source identity, capabilities, or the exact three unknown requirements", () => {
    const previous = initialPack();
    persistEvidenceGapReviewPack(connection, previous, [asset]);
    const base = analysisInput(previous);
    const invalidSourceMaterial = structuredClone(base.revisedPack);
    invalidSourceMaterial.sources[0]!.pageUrl = "https://example.com/other-work";
    const withoutHash = { ...invalidSourceMaterial } as Partial<EvidenceGapReviewPack>;
    delete withoutHash.materialHash;
    invalidSourceMaterial.materialHash = calculateEvidenceGapReviewMaterialHash(
      withoutHash as Omit<EvidenceGapReviewPack, "materialHash">,
    );
    expect(() => reviseEvidenceGapReviewPackAnalysis(connection, {
      ...base,
      revisedPack: invalidSourceMaterial,
    })).toThrow(EvidenceGapReviewConflictError);

    const invalidUnknownMaterial = structuredClone(base.revisedPack);
    invalidUnknownMaterial.readiness.rightsEvidence.status = "VERIFIED";
    const secondWithoutHash = { ...invalidUnknownMaterial } as Partial<EvidenceGapReviewPack>;
    delete secondWithoutHash.materialHash;
    invalidUnknownMaterial.materialHash = calculateEvidenceGapReviewMaterialHash(
      secondWithoutHash as Omit<EvidenceGapReviewPack, "materialHash">,
    );
    expect(() => reviseEvidenceGapReviewPackAnalysis(connection, {
      ...base,
      idempotencyKey: "gap-analysis-invalid-unknown",
      revisedPack: invalidUnknownMaterial,
    })).toThrow(EvidenceGapReviewConflictError);
    expect(connection.sqlite.prepare(
      "SELECT count(*) FROM inspiration_wiki_evidence_gap_analysis_revisions",
    ).pluck().get()).toBe(0);
  });

  it("refuses Codex analysis after a teacher decision exists", () => {
    const previous = initialPack();
    persistEvidenceGapReviewPack(connection, previous, [asset]);
    connection.sqlite.prepare(`
      INSERT INTO inspiration_wiki_evidence_gap_review_decisions(
        id, review_pack_id, review_pack_revision, teacher_id, accepted_gap_keys_json,
        final_action, previous_stage, next_stage, note, private_draft_only,
        idempotency_key, request_hash, created_at
      ) VALUES('decision-before-analysis', ?, 1, 'teacher', '[]', 'RETURN_TO_CODEX',
        'READY_FOR_TEACHER_TRIAGE', 'RETURNED_TO_CODEX', 'Teacher decided first.', 0,
        'decision-before-analysis-key', ?, 1700000001)
    `).run(REVIEW_PACK_ID, "9".repeat(64));
    expect(() => reviseEvidenceGapReviewPackAnalysis(
      connection,
      analysisInput(previous),
    )).toThrow(EvidenceGapReviewConflictError);
  });

  it("supplements a reasoned teacher return, preserves the decision, and reopens review", () => {
    const previous = initialPack();
    persistEvidenceGapReviewPack(connection, previous, [asset]);
    const analyzedInput = analysisInput(previous);
    reviseEvidenceGapReviewPackAnalysis(connection, analyzedInput, "2026-08-12T12:35:00.000Z");
    const analyzed = analyzedInput.revisedPack;
    connection.sqlite.prepare(`
      INSERT INTO inspiration_wiki_evidence_gap_review_decisions(
        id, review_pack_id, review_pack_revision, teacher_id, accepted_gap_keys_json,
        final_action, previous_stage, next_stage, note, private_draft_only,
        idempotency_key, request_hash, created_at
      ) VALUES('teacher-return-for-supplement', ?, 2, 'teacher', '[]', 'RETURN_TO_CODEX',
        'READY_FOR_TEACHER_TRIAGE', 'RETURNED_TO_CODEX', 'Correct the visible shape.', 0,
        'teacher-return-for-supplement-key', ?, 1700000001)
    `).run(REVIEW_PACK_ID, "8".repeat(64));
    connection.sqlite.prepare(
      "UPDATE inspiration_wiki_evidence_gap_review_packs SET stage='RETURNED_TO_CODEX',revision=3 WHERE review_pack_id=?",
    ).run(REVIEW_PACK_ID);

    const material = structuredClone(analyzed) as Partial<EvidenceGapReviewPack>;
    delete material.materialHash;
    const corrected = withHash({
      ...(material as Omit<EvidenceGapReviewPack, "materialHash">),
      revision: 4,
      preparedAt: "2026-08-12T14:30:00.000Z",
      visualDescription: {
        ...analyzed.visualDescription,
        summary: "黑白竖幅以艺术字体笔触般的曲线围绕人物肖像。",
        observations: [{
          observation: "艺术字体笔触般的曲线围绕人物肖像。",
          mediaIds: ["gap-media-01"],
        }],
      },
    });
    const input = {
      expectedRevision: 3,
      expectedMaterialHash: analyzed.materialHash,
      idempotencyKey: "teacher-return-supplement-001",
      sourceArtifactDigest: "7".repeat(64),
      revisedPack: corrected,
    };
    const result = supplementReturnedEvidenceGapReviewPackAnalysis(
      connection,
      input,
      "2026-08-12T14:30:00.999Z",
    );
    expect(result).toMatchObject({
      previousRevision: 3,
      revision: 4,
      stage: "READY_FOR_TEACHER_TRIAGE",
      replayed: false,
      supplementedAt: "2026-08-12T14:30:00.000Z",
    });
    expect(connection.sqlite.prepare(
      "SELECT stage FROM inspiration_wiki_evidence_gap_review_packs WHERE review_pack_id=?",
    ).pluck().get(REVIEW_PACK_ID)).toBe("READY_FOR_TEACHER_TRIAGE");
    expect(connection.sqlite.prepare(
      "SELECT count(*) FROM inspiration_wiki_evidence_gap_review_decisions WHERE review_pack_id=?",
    ).pluck().get(REVIEW_PACK_ID)).toBe(1);
    expect(connection.sqlite.prepare(
      "SELECT count(*) FROM inspiration_wiki_evidence_gap_analysis_revisions WHERE review_pack_id=?",
    ).pluck().get(REVIEW_PACK_ID)).toBe(2);
    expect(supplementReturnedEvidenceGapReviewPackAnalysis(connection, input)).toEqual({
      ...result,
      replayed: true,
    });
    expect(() => supplementReturnedEvidenceGapReviewPackAnalysis(connection, {
      ...input,
      sourceArtifactDigest: "6".repeat(64),
    })).toThrow(EvidenceGapReviewIdempotencyConflictError);
  });
});

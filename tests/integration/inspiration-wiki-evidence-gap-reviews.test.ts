// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseConnection } from "@/lib/db/client";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  evidenceGapRequirementKeys,
  TeacherEvidenceGapReviewQueueSchema,
  type EvidenceGapReviewPack,
} from "@/lib/domain/inspiration-wiki/evidence-gap-review-contracts";
import {
  calculateEvidenceGapReviewMaterialHash,
  decideTeacherEvidenceGapReview,
  persistEvidenceGapReviewPack,
  readTeacherEvidenceGapReviewQueue,
} from "@/lib/services/inspiration-wiki-evidence-gap-reviews";

const teacher = { userId: "teacher", role: "TEACHER" as const };
const BATCH_ID = "evidence-gap-service-batch";

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
    normalizedClassification: {
      primary: null,
      secondary: [],
      sourceTerms: [],
    },
    visualDescription: {
      summary: null,
      observations: [],
    },
    duplicateRelationship: {
      status: "DISTINCT",
      relatedCandidateIds: [],
      explanation: "Canonical URL is unique within this test batch.",
    },
    curationRecommendation: {
      recommendation: "RECOMMEND",
      rationale: "A teacher may decide whether the incomplete material merits further work.",
    },
    teachingRecommendation: {
      recommendation: "UNASSESSED",
      rationale: null,
      prompts: [],
      cautions: [],
    },
    safetyAssessment: {
      status: "UNASSESSED",
      evidence: [],
    },
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
        note: "The source is explicitly preserved as unverified public-web material.",
        evidenceRefs: [`source-${hexDigit}`],
      },
      rightsEvidence: {
        status: "MISSING",
        note: "No row-level republication evidence is bound.",
        evidenceRefs: [],
      },
      normalizedClassification: {
        status: "PRESENT_UNVERIFIED",
        note: "Raw source terms exist but normalization is incomplete.",
        evidenceRefs: [],
      },
      visualDescription: {
        status: "MISSING",
        note: "Visual description cannot be verified without controlled media.",
        evidenceRefs: [],
      },
      duplicateRelationship: {
        status: "VERIFIED",
        note: "No canonical duplicate exists in the isolated fixture.",
        evidenceRefs: [candidatePageUrl(hexDigit)],
      },
      curationRecommendation: {
        status: "VERIFIED",
        note: "The recommendation is explicitly limited to private teacher triage.",
        evidenceRefs: [`source-${hexDigit}`],
      },
      teachingRecommendation: {
        status: "BLOCKED",
        note: "Teaching use cannot be recommended before visual evidence is reviewed.",
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
  return {
    ...material,
    materialHash: calculateEvidenceGapReviewMaterialHash(material),
  };
}

function insertStrictReviewRow(connection: DatabaseConnection, hexDigit: string) {
  connection.sqlite.prepare(`
    INSERT INTO inspiration_wiki_review_packs(
      review_pack_id, candidate_id, revision, stage, material_hash, pack_json,
      media_assets_json, primary_preview_url, title, source_summary,
      teacher_private, student_visible, current_page, r2, embedding, lumi_retrieval,
      created_at, updated_at
    ) VALUES(?, ?, 1, 'READY_FOR_TEACHER_REVIEW', ?, '{}', '[{}]',
      '/demo/strict-placeholder.svg', 'Strict placeholder', 'Fixture source',
      1, 0, 'DISABLED', 'DISABLED', 'DISABLED', 'DISABLED', 1700000000, 1700000000)
  `).run(
    `review-pack:strict-${hexDigit.repeat(8)}`,
    candidateId(hexDigit),
    "f".repeat(64),
  );
}

describe("teacher-private evidence-gap review service", () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lumi-evidence-gap-service-"));
    const databasePath = path.join(directory, "private.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','Test teacher',1700000000);");
    connection.sqlite.exec("INSERT INTO teacher_access_scopes VALUES('teacher','GLOBAL',NULL,'TEST_SETUP','测试课程负责人',1700000000)");
    connection.sqlite.prepare(`
      INSERT INTO inspiration_wiki_hermes_batches(
        batch_id, contract_version, package_digest, manifest_json, done_json,
        candidate_count, failure_count, intake_state, student_visible,
        current_page, r2, embedding, lumi_retrieval, imported_at
      ) VALUES(?, 'LEGACY_V1', ?, '{}', '{}', 8, 0, 'VALIDATED_PRIVATE', 0,
        'DISABLED', 'DISABLED', 'DISABLED', 'DISABLED', 1700000000)
    `).run(BATCH_ID, "a".repeat(64));
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates the independent gap tables and persists a zero-media, null-preview pack", () => {
    const schemaObjects = connection.sqlite.prepare(`
      SELECT type, name FROM sqlite_master
      WHERE name IN (
        'inspiration_wiki_evidence_gap_review_packs',
        'inspiration_wiki_evidence_gap_review_decisions',
        'inspiration_wiki_evidence_gap_review_packs_no_strict_candidate',
        'inspiration_wiki_review_packs_no_evidence_gap_candidate'
      )
    `).all() as Array<{ type: string; name: string }>;
    expect(new Set(schemaObjects.map((item) => `${item.type}:${item.name}`))).toEqual(new Set([
      "table:inspiration_wiki_evidence_gap_review_packs",
      "table:inspiration_wiki_evidence_gap_review_decisions",
      "trigger:inspiration_wiki_evidence_gap_review_packs_no_strict_candidate",
      "trigger:inspiration_wiki_review_packs_no_evidence_gap_candidate",
    ]));

    seedCandidate(connection, "1");
    const pack = makeGapPack("1");
    expect(persistEvidenceGapReviewPack(connection, pack, [], "2026-08-12T09:05:00.000Z"))
      .toEqual({ imported: true, reviewPackId: pack.reviewPackId });
    expect(persistEvidenceGapReviewPack(connection, pack, [], "2026-08-12T09:06:00.000Z"))
      .toEqual({ imported: false, reviewPackId: pack.reviewPackId });

    expect(connection.sqlite.prepare(`
      SELECT primary_preview_url AS primaryPreviewUrl,
        json_array_length(media_assets_json) AS localMediaCount,
        verified_gate_count AS verifiedGateCount, teacher_private AS teacherPrivate,
        student_visible AS studentVisible, current_page AS currentPage, r2,
        embedding, lumi_retrieval AS lumiRetrieval
      FROM inspiration_wiki_evidence_gap_review_packs
      WHERE review_pack_id = ?
    `).get(pack.reviewPackId)).toEqual({
      primaryPreviewUrl: null,
      localMediaCount: 0,
      verifiedGateCount: 3,
      teacherPrivate: 1,
      studentVisible: 0,
      currentPage: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
    });

    const queue = TeacherEvidenceGapReviewQueueSchema.parse(
      readTeacherEvidenceGapReviewQueue(connection, teacher),
    );
    expect(queue.items).toEqual([expect.objectContaining({
      reviewPackId: pack.reviewPackId,
      primaryPreviewUrl: null,
      verifiedCount: 3,
      missingGates: evidenceGapRequirementKeys(pack.readiness),
      stage: "READY_FOR_TEACHER_TRIAGE",
    })]);
    expect(queue.meta).toMatchObject({
      totalEvidenceGapPacks: 1,
      teacherTriageReady: 1,
      teacherReviewed: 0,
      withLocalMedia: 0,
      withoutLocalMedia: 1,
      boundary: {
        studentVisible: false,
        currentPage: "DISABLED",
        r2: "DISABLED",
        embedding: "DISABLED",
        lumiRetrieval: "DISABLED",
      },
    });
    expect(() => connection.sqlite.prepare(`
      UPDATE inspiration_wiki_evidence_gap_review_packs
      SET student_visible = 1 WHERE review_pack_id = ?
    `).run(pack.reviewPackId)).toThrow();
  });

  it("prevents a candidate from entering both strict and evidence-gap review tracks", () => {
    seedCandidate(connection, "2");
    const gapFirst = makeGapPack("2");
    persistEvidenceGapReviewPack(connection, gapFirst, []);
    expect(() => insertStrictReviewRow(connection, "2"))
      .toThrow(/candidate already assigned to evidence-gap review/);

    seedCandidate(connection, "3");
    insertStrictReviewRow(connection, "3");
    expect(() => persistEvidenceGapReviewPack(connection, makeGapPack("3"), []))
      .toThrow(/already has a strict ReviewPack/);
  });

  it("requires exact accepted gap keys, creates only a private draft with gaps, and replays idempotently", () => {
    seedCandidate(connection, "4");
    const pack = makeGapPack("4");
    persistEvidenceGapReviewPack(connection, pack, []);
    const acceptedGapKeys = evidenceGapRequirementKeys(pack.readiness);

    expect(() => decideTeacherEvidenceGapReview(connection, teacher, {
      reviewPackId: pack.reviewPackId,
      reviewPackRevision: 1,
      finalAction: "ENTER_PRIVATE_WIKIDRAFT",
      acceptedGapKeys: acceptedGapKeys.slice(1),
      note: "I reviewed the available material and knowingly accept every listed gap.",
      privateDraftOnly: true,
      idempotencyKey: "gap-draft-incomplete-keys",
    })).toThrow(/explicitly accept every unresolved requirement/);
    for (const finalAction of ["RETURN_TO_CODEX", "REJECT_CANDIDATE"] as const) {
      expect(() => decideTeacherEvidenceGapReview(connection, teacher, {
        reviewPackId: pack.reviewPackId,
        reviewPackRevision: 1,
        finalAction,
        acceptedGapKeys: [acceptedGapKeys[0]!],
        note: "Non-draft actions must not carry accepted gaps.",
        privateDraftOnly: false,
        idempotencyKey: `gap-invalid-${finalAction.toLowerCase()}`,
      })).toThrow(/Non-draft actions cannot accept evidence gaps/);
    }
    expect(connection.sqlite.prepare(
      "SELECT count(*) AS count FROM inspiration_wiki_evidence_gap_review_decisions",
    ).get()).toEqual({ count: 0 });

    const input = {
      reviewPackId: pack.reviewPackId,
      reviewPackRevision: 1,
      finalAction: "ENTER_PRIVATE_WIKIDRAFT" as const,
      acceptedGapKeys,
      note: "I reviewed the available material and knowingly accept every listed gap.",
      privateDraftOnly: true,
      idempotencyKey: "gap-private-draft-idempotent-001",
    };
    const first = decideTeacherEvidenceGapReview(
      connection,
      teacher,
      input,
      "2026-08-12T09:10:00.000Z",
    );
    expect(first).toMatchObject({
      reviewPackId: pack.reviewPackId,
      previousRevision: 1,
      revision: 2,
      finalAction: "ENTER_PRIVATE_WIKIDRAFT",
      stage: "PRIVATE_WIKIDRAFT_WITH_GAPS",
      replayed: false,
      capabilityBoundary: {
        teacherPrivate: true,
        studentVisible: false,
        currentPage: "DISABLED",
        r2: "DISABLED",
        embedding: "DISABLED",
        lumiRetrieval: "DISABLED",
      },
    });
    expect(decideTeacherEvidenceGapReview(
      connection,
      teacher,
      input,
      "2026-08-12T09:20:00.000Z",
    )).toMatchObject({
      reviewPackId: pack.reviewPackId,
      revision: 2,
      stage: "PRIVATE_WIKIDRAFT_WITH_GAPS",
      decidedAt: "2026-08-12T09:10:00.000Z",
      replayed: true,
    });

    expect(connection.sqlite.prepare(`
      SELECT stage, revision, teacher_private AS teacherPrivate,
        student_visible AS studentVisible, current_page AS currentPage, r2,
        embedding, lumi_retrieval AS lumiRetrieval
      FROM inspiration_wiki_evidence_gap_review_packs
      WHERE review_pack_id = ?
    `).get(pack.reviewPackId)).toEqual({
      stage: "PRIVATE_WIKIDRAFT_WITH_GAPS",
      revision: 2,
      teacherPrivate: 1,
      studentVisible: 0,
      currentPage: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
    });
    const persistedDecision = connection.sqlite.prepare(`
      SELECT accepted_gap_keys_json AS acceptedGapKeysJson,
        private_draft_only AS privateDraftOnly
      FROM inspiration_wiki_evidence_gap_review_decisions
      WHERE review_pack_id = ?
    `).get(pack.reviewPackId) as { acceptedGapKeysJson: string; privateDraftOnly: number };
    expect(JSON.parse(persistedDecision.acceptedGapKeysJson)).toEqual(acceptedGapKeys);
    expect(persistedDecision.privateDraftOnly).toBe(1);
    expect(connection.sqlite.prepare(
      "SELECT count(*) AS count FROM inspiration_wiki_evidence_gap_review_decisions",
    ).get()).toEqual({ count: 1 });

    const queue = TeacherEvidenceGapReviewQueueSchema.parse(
      readTeacherEvidenceGapReviewQueue(connection, teacher),
    );
    expect(queue.items).toEqual([]);
    expect(queue.reviewedItems).toEqual([expect.objectContaining({
      reviewPackId: pack.reviewPackId,
      stage: "PRIVATE_WIKIDRAFT_WITH_GAPS",
    })]);
  });

  it("allows return and rejection only with an empty accepted-gap set", () => {
    const cases = [
      { hexDigit: "5", finalAction: "RETURN_TO_CODEX" as const, stage: "RETURNED_TO_CODEX" },
      { hexDigit: "6", finalAction: "REJECT_CANDIDATE" as const, stage: "REJECTED" },
    ];
    for (const item of cases) {
      seedCandidate(connection, item.hexDigit);
      const pack = makeGapPack(item.hexDigit);
      persistEvidenceGapReviewPack(connection, pack, []);
      expect(decideTeacherEvidenceGapReview(connection, teacher, {
        reviewPackId: pack.reviewPackId,
        reviewPackRevision: 1,
        finalAction: item.finalAction,
        acceptedGapKeys: [],
        note: "Teacher chose a non-draft terminal action without accepting any gap.",
        privateDraftOnly: false,
        idempotencyKey: `gap-terminal-${item.hexDigit}-001`,
      })).toMatchObject({
        reviewPackId: pack.reviewPackId,
        stage: item.stage,
        replayed: false,
      });
    }
    const decisions = connection.sqlite.prepare(`
      SELECT accepted_gap_keys_json AS acceptedGapKeysJson,
        private_draft_only AS privateDraftOnly
      FROM inspiration_wiki_evidence_gap_review_decisions
      ORDER BY review_pack_id
    `).all() as Array<{ acceptedGapKeysJson: string; privateDraftOnly: number }>;
    expect(decisions).toEqual([
      { acceptedGapKeysJson: "[]", privateDraftOnly: 0 },
      { acceptedGapKeysJson: "[]", privateDraftOnly: 0 },
    ]);
  });

  it("persists a confirmed-unknown private draft with no accepted gaps and no note", () => {
    seedCandidate(connection, "7");
    const base = makeGapPack("7");
    const material = structuredClone(base) as Partial<EvidenceGapReviewPack>;
    delete material.materialHash;
    const confirmedUnknownMaterial = {
      ...(material as Omit<EvidenceGapReviewPack, "materialHash">),
      readiness: {
        controlledMediaGroup: { status: "VERIFIED" as const, note: "Media reviewed.", evidenceRefs: ["media"] },
        workSourceMatch: { status: "UNKNOWN" as const, note: "未知", evidenceRefs: [] },
        sourceRole: { status: "UNKNOWN" as const, note: "未知", evidenceRefs: [] },
        rightsEvidence: { status: "UNKNOWN" as const, note: "未知", evidenceRefs: [] },
        normalizedClassification: { status: "VERIFIED" as const, note: "Analyzed.", evidenceRefs: ["classification"] },
        visualDescription: { status: "VERIFIED" as const, note: "Analyzed.", evidenceRefs: ["visual"] },
        duplicateRelationship: { status: "VERIFIED" as const, note: "Compared.", evidenceRefs: ["dedupe"] },
        curationRecommendation: { status: "VERIFIED" as const, note: "Analyzed.", evidenceRefs: ["curation"] },
        teachingRecommendation: { status: "VERIFIED" as const, note: "Analyzed.", evidenceRefs: ["teaching"] },
      },
    };
    const pack = {
      ...confirmedUnknownMaterial,
      materialHash: calculateEvidenceGapReviewMaterialHash(confirmedUnknownMaterial),
    };
    persistEvidenceGapReviewPack(connection, pack, []);

    expect(decideTeacherEvidenceGapReview(connection, teacher, {
      reviewPackId: pack.reviewPackId,
      reviewPackRevision: 1,
      finalAction: "ENTER_PRIVATE_WIKIDRAFT",
      acceptedGapKeys: [],
      note: "",
      privateDraftOnly: true,
      idempotencyKey: "confirmed-unknown-empty-note-001",
    })).toMatchObject({
      stage: "PRIVATE_WIKIDRAFT_WITH_GAPS",
      replayed: false,
    });
    expect(connection.sqlite.prepare(`
      SELECT accepted_gap_keys_json AS acceptedGapKeys, note
      FROM inspiration_wiki_evidence_gap_review_decisions
      WHERE review_pack_id = ?
    `).get(pack.reviewPackId)).toEqual({ acceptedGapKeys: "[]", note: "" });
  });
});

// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as decisionPost } from "@/app/api/teacher/inspiration-wiki/review-packs/[reviewPackId]/decision/route";
import { GET as mediaGet } from "@/app/api/teacher/inspiration-wiki/review-packs/[reviewPackId]/media/[mediaId]/route";
import { GET as detailGet } from "@/app/api/teacher/inspiration-wiki/review-packs/[reviewPackId]/route";
import { POST as gapDecisionPost } from "@/app/api/teacher/inspiration-wiki/review-packs/evidence-gaps/[reviewPackId]/decision/route";
import { GET as gapDetailGet } from "@/app/api/teacher/inspiration-wiki/review-packs/evidence-gaps/[reviewPackId]/route";
import { GET as gapQueueGet } from "@/app/api/teacher/inspiration-wiki/review-packs/evidence-gaps/route";
import { GET as queueGet } from "@/app/api/teacher/inspiration-wiki/review-packs/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { evidenceGapRequirementKeys, type EvidenceGapReviewPack } from "@/lib/domain/inspiration-wiki/evidence-gap-review-contracts";
import { calculateEvidenceGapReviewMaterialHash, persistEvidenceGapReviewPack } from "@/lib/services/inspiration-wiki-evidence-gap-reviews";
import { calculateReviewPackMaterialHash, persistStrictReviewPack } from "@/lib/services/inspiration-wiki-review-packs";
import { acceptedReviewDecisionFixture, strictReviewPackFixture } from "@/tests/fixtures/inspiration-review-pack";

const SECRET = "review-pack-route-secret-at-least-32-characters";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

function digest(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function evidenceGapPack(): EvidenceGapReviewPack {
  const material: Omit<EvidenceGapReviewPack, "materialHash"> = {
    schemaVersion: "lumi-inspiration-evidence-gap-review-pack/v1",
    contractKind: "EVIDENCE_GAP_REVIEW",
    reviewPackId: "review-pack:evidence-gap-route-001",
    candidateId: `hermes-candidate:${"1".repeat(32)}`,
    revision: 1,
    stage: "READY_FOR_TEACHER_TRIAGE",
    preparedAt: "2026-08-12T08:00:00.000Z",
    work: { title: "Evidence gap route fixture", creators: [], year: null, workSourceMatchEvidence: [] },
    sources: [{ sourceId: "source-a", platform: "PINTEREST", pageUrl: "https://www.pinterest.com/pin/123456789/", role: "DISCOVERY_POINTER", label: "Pinterest discovery", creatorName: null, curatorName: null, evidenceStatement: "Discovery only" }],
    mediaGroup: [],
    rightsEvidence: [],
    normalizedClassification: { primary: null, secondary: [], sourceTerms: ["PRINT"] },
    visualDescription: { summary: null, observations: [] },
    duplicateRelationship: { status: "UNASSESSED", relatedCandidateIds: [], explanation: null },
    curationRecommendation: { recommendation: "UNASSESSED", rationale: null },
    teachingRecommendation: { recommendation: "UNASSESSED", rationale: null, prompts: [], cautions: [] },
    safetyAssessment: { status: "UNASSESSED", evidence: [] },
    readiness: {
      controlledMediaGroup: { status: "MISSING", note: "No controlled media", evidenceRefs: [] },
      workSourceMatch: { status: "PRESENT_UNVERIFIED", note: "Discovery URL only", evidenceRefs: ["source-a"] },
      sourceRole: { status: "VERIFIED", note: "Discovery role verified", evidenceRefs: ["source-a"] },
      rightsEvidence: { status: "MISSING", note: "No rights evidence", evidenceRefs: [] },
      normalizedClassification: { status: "PRESENT_UNVERIFIED", note: "Native term only", evidenceRefs: [] },
      visualDescription: { status: "BLOCKED", note: "No pixels", evidenceRefs: [] },
      duplicateRelationship: { status: "MISSING", note: "Not compared", evidenceRefs: [] },
      curationRecommendation: { status: "MISSING", note: "Not assessed", evidenceRefs: [] },
      teachingRecommendation: { status: "MISSING", note: "Not assessed", evidenceRefs: [] },
    },
    capabilityBoundary: { teacherPrivate: true, studentVisible: false, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" },
  };
  return { ...material, materialHash: calculateEvidenceGapReviewMaterialHash(material) };
}

describe("teacher-only ReviewPack routes", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lumi-review-pack-routes-"));
    databasePath = path.join(directory, "private.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','Test teacher',1700000000),('student-1',NULL,'STUDENT','Test student',1700000000);");
      connection.sqlite.exec("INSERT INTO teacher_access_scopes VALUES('teacher','GLOBAL',NULL,'TEST_SETUP','测试课程负责人',1700000000)");
      connection.sqlite.prepare(`
        INSERT INTO inspiration_wiki_hermes_batches(
          batch_id, contract_version, package_digest, manifest_json, done_json,
          candidate_count, failure_count, intake_state, student_visible,
          current_page, r2, embedding, lumi_retrieval, imported_at
        ) VALUES('review-pack-route-batch','LEGACY_V1',?,'{}','{}',1,0,
          'VALIDATED_PRIVATE',0,'DISABLED','DISABLED','DISABLED','DISABLED',1700000000)
      `).run("a".repeat(64));
      connection.sqlite.prepare(`
        INSERT INTO inspiration_wiki_hermes_candidates(
          id, batch_id, source_candidate_id, revision, contract_state, review_state,
          source_id, source_platform, page_url, canonical_url, title, description,
          author_json, license_json, media_json, design_categories_json, screening_json,
          raw_candidate_json, raw_digest, dedupe_fingerprint, scope, student_visible,
          wiki_draft, current_page, r2, embedding, lumi_retrieval, created_at, updated_at
        ) VALUES(?, 'review-pack-route-batch', 'source-candidate-001', 1,
          'V1_UPGRADE_REQUIRED', 'PENDING_REVIEW', 'source-a', 'OTHER_PUBLIC_WEB',
          'https://www.pinterest.com/pin/123456789/', NULL, 'Governance material', NULL, NULL, NULL,
          '[{"kind":"IMAGE","asset":null}]', '["PRINT"]', '{"totalScore":1,"evidence":[]}',
          '{}', ?, ?, 'PRIVATE_CANDIDATE', 0, 'NOT_CREATED', 'DISABLED', 'DISABLED',
          'DISABLED', 'DISABLED', 1700000000, 1700000000)
      `).run(`hermes-candidate:${"1".repeat(32)}`, "b".repeat(64), "c".repeat(64));
    } finally {
      connection.sqlite.close();
    }
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("fails closed for unauthenticated and student requests", async () => {
    expect((await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-wiki/review-packs"))).status).toBe(401);
    expect((await gapQueueGet(new NextRequest("http://localhost/api/teacher/inspiration-wiki/review-packs/evidence-gaps"))).status).toBe(401);
    const student = await issueSession({ userId: "student-1", role: "STUDENT" }, SECRET);
    expect((await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-wiki/review-packs", { headers: { cookie: cookie(student) } }))).status).toBe(403);
    expect((await gapQueueGet(new NextRequest("http://localhost/api/teacher/inspiration-wiki/review-packs/evidence-gaps", { headers: { cookie: cookie(student) } }))).status).toBe(403);
  });

  it("reports one governance material but a zero-item real review queue", async () => {
    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const response = await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-wiki/review-packs", { headers: { cookie: cookie(teacher) } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      items: [],
      reviewedItems: [],
      meta: {
        totalGovernanceMaterials: 1,
        totalReviewPacks: 0,
        teacherReviewReady: 0,
        teacherReviewed: 0,
        requiredGateCount: 9,
        boundary: { studentVisible: false, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" },
      },
    });
  });

  it("does not invent fixture ReviewPacks in the real detail or decision APIs", async () => {
    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const headers = { cookie: cookie(teacher) };
    const detail = await detailGet(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/review-packs/${encodeURIComponent(acceptedReviewDecisionFixture.reviewPackId)}`, { headers }), {
      params: Promise.resolve({ reviewPackId: acceptedReviewDecisionFixture.reviewPackId }),
    });
    expect(detail.status).toBe(404);
    const decision = await decisionPost(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/review-packs/${encodeURIComponent(acceptedReviewDecisionFixture.reviewPackId)}/decision`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ ...acceptedReviewDecisionFixture, reviewPackId: undefined }),
    }), { params: Promise.resolve({ reviewPackId: acceptedReviewDecisionFixture.reviewPackId }) });
    expect(decision.status).toBe(404);
  });

  it("serves a persisted strict ReviewPack with controlled media, then records one revision-bound teacher action", async () => {
    const connection = createDb(databasePath);
    const mediaBytes = strictReviewPackFixture.mediaGroup.map((media) => Buffer.from(`controlled:${media.mediaId}`));
    const mediaGroup = strictReviewPackFixture.mediaGroup.map((media, index) => ({
      ...media,
      previewUrl: `/api/teacher/inspiration-wiki/review-packs/${strictReviewPackFixture.reviewPackId}/media/${media.mediaId}`,
      sha256: digest(mediaBytes[index]),
    }));
    const material = {
      ...strictReviewPackFixture,
      materialHash: undefined,
      mediaGroup,
    };
    const packWithoutHash = { ...material };
    delete packWithoutHash.materialHash;
    const pack = {
      ...packWithoutHash,
      materialHash: calculateReviewPackMaterialHash(packWithoutHash),
    };
    const assets = mediaGroup.map((media, index) => ({
      mediaId: media.mediaId,
      storagePath: path.posix.join("inspiration-wiki", "review-packs", "assets", "fixture-lighthouse-001", `${media.mediaId}.png`),
      mimeType: "image/png" as const,
      bytes: mediaBytes[index].byteLength,
      sha256: media.sha256,
    }));
    try {
      for (const [index, asset] of assets.entries()) {
        const assetPath = path.join(directory, ...asset.storagePath.split("/"));
        await mkdir(path.dirname(assetPath), { recursive: true });
        await writeFile(assetPath, mediaBytes[index]);
      }
      expect(persistStrictReviewPack(connection, pack, assets, "2026-08-12T03:00:00.000Z")).toMatchObject({ imported: true });
    } finally {
      connection.sqlite.close();
    }

    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const headers = { cookie: cookie(teacher) };
    const queue = await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-wiki/review-packs", { headers }));
    expect(queue.status).toBe(200);
    expect(await queue.json()).toMatchObject({
      items: [{ reviewPackId: pack.reviewPackId, primaryPreviewUrl: mediaGroup[0].previewUrl }],
      reviewedItems: [],
      meta: { totalGovernanceMaterials: 1, totalReviewPacks: 1, teacherReviewReady: 1, teacherReviewed: 0 },
    });

    const detail = await detailGet(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/review-packs/${encodeURIComponent(pack.reviewPackId)}`, { headers }), {
      params: Promise.resolve({ reviewPackId: pack.reviewPackId }),
    });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ reviewPackId: pack.reviewPackId, materialHash: pack.materialHash });

    const media = await mediaGet(new NextRequest(`http://localhost${mediaGroup[0].previewUrl}`, { headers }), {
      params: Promise.resolve({ reviewPackId: pack.reviewPackId, mediaId: mediaGroup[0].mediaId }),
    });
    expect(media.status).toBe(200);
    expect(media.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await media.arrayBuffer())).toEqual(mediaBytes[0]);

    const decisionBody = { ...acceptedReviewDecisionFixture, reviewPackId: undefined };
    const firstDecision = await decisionPost(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/review-packs/${encodeURIComponent(pack.reviewPackId)}/decision`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(decisionBody),
    }), { params: Promise.resolve({ reviewPackId: pack.reviewPackId }) });
    expect(firstDecision.status).toBe(201);
    expect(await firstDecision.json()).toMatchObject({ stage: "PRIVATE_WIKIDRAFT", revision: pack.revision + 1, replayed: false, nextReviewPackId: null });

    const replay = await decisionPost(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/review-packs/${encodeURIComponent(pack.reviewPackId)}/decision`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(decisionBody),
    }), { params: Promise.resolve({ reviewPackId: pack.reviewPackId }) });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ stage: "PRIVATE_WIKIDRAFT", replayed: true, nextReviewPackId: null });

    const reviewedDetail = await detailGet(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/review-packs/${encodeURIComponent(pack.reviewPackId)}`, { headers }), {
      params: Promise.resolve({ reviewPackId: pack.reviewPackId }),
    });
    expect(reviewedDetail.status).toBe(200);
    expect(await reviewedDetail.json()).toMatchObject({
      reviewPackId: pack.reviewPackId,
      editContext: {
        currentStage: "PRIVATE_WIKIDRAFT",
        currentReviewRevision: pack.revision + 1,
        latestDecision: { reviewPackRevision: pack.revision, finalAction: "ENTER_PRIVATE_WIKIDRAFT" },
      },
    });

    const revisedDecisionBody = {
      ...decisionBody,
      reviewPackRevision: pack.revision + 1,
      finalAction: "REJECT_CANDIDATE",
      note: "教师复核后改为拒绝，并保留第一次审核记录。",
      idempotencyKey: "strict-route-revision-002",
    };
    const revisedDecision = await decisionPost(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/review-packs/${encodeURIComponent(pack.reviewPackId)}/decision`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(revisedDecisionBody),
    }), { params: Promise.resolve({ reviewPackId: pack.reviewPackId }) });
    expect(revisedDecision.status).toBe(201);
    expect(await revisedDecision.json()).toMatchObject({ stage: "REJECTED", previousRevision: pack.revision + 1, revision: pack.revision + 2, replayed: false });

    const after = await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-wiki/review-packs", { headers }));
    expect(await after.json()).toMatchObject({
      items: [],
      reviewedItems: [{ reviewPackId: pack.reviewPackId, revision: pack.revision + 2, stage: "REJECTED" }],
      meta: { totalReviewPacks: 1, teacherReviewReady: 0, teacherReviewed: 1, rejected: 1, privateWikiDraft: 0 },
    });
    const auditConnection = createDb(databasePath);
    try {
      expect(auditConnection.sqlite.prepare(`
        SELECT review_pack_revision AS revision, previous_stage AS previousStage, next_stage AS nextStage
        FROM inspiration_wiki_review_pack_decisions
        WHERE review_pack_id = ? ORDER BY review_pack_revision
      `).all(pack.reviewPackId)).toEqual([
        { revision: pack.revision, previousStage: "READY_FOR_TEACHER_REVIEW", nextStage: "PRIVATE_WIKIDRAFT" },
        { revision: pack.revision + 1, previousStage: "PRIVATE_WIKIDRAFT", nextStage: "REJECTED" },
      ]);
    } finally {
      auditConnection.sqlite.close();
    }
  });

  it("serves a private evidence-gap pack and requires explicit acceptance of every gap", async () => {
    const pack = evidenceGapPack();
    const connection = createDb(databasePath);
    try {
      expect(persistEvidenceGapReviewPack(connection, pack, [], "2026-08-12T08:00:00.000Z")).toMatchObject({ imported: true });
    } finally {
      connection.sqlite.close();
    }

    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const headers = { cookie: cookie(teacher) };
    const queue = await gapQueueGet(new NextRequest("http://localhost/api/teacher/inspiration-wiki/review-packs/evidence-gaps", { headers }));
    expect(queue.status).toBe(200);
    expect(queue.headers.get("cache-control")).toBe("private, no-store");
    expect(await queue.json()).toMatchObject({
      items: [{ reviewPackId: pack.reviewPackId, primaryPreviewUrl: null, verifiedCount: 1 }],
      reviewedItems: [],
      meta: { totalEvidenceGapPacks: 1, teacherTriageReady: 1, teacherReviewed: 0, withLocalMedia: 0, withoutLocalMedia: 1 },
    });

    const detail = await gapDetailGet(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/review-packs/evidence-gaps/${encodeURIComponent(pack.reviewPackId)}`, { headers }), {
      params: Promise.resolve({ reviewPackId: pack.reviewPackId }),
    });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ reviewPackId: pack.reviewPackId, contractKind: "EVIDENCE_GAP_REVIEW", mediaGroup: [] });

    const incomplete = await gapDecisionPost(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/review-packs/evidence-gaps/${encodeURIComponent(pack.reviewPackId)}/decision`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ reviewPackRevision: 1, finalAction: "ENTER_PRIVATE_WIKIDRAFT", acceptedGapKeys: [], note: "Keep private", privateDraftOnly: true, idempotencyKey: "gap-route-invalid-001" }),
    }), { params: Promise.resolve({ reviewPackId: pack.reviewPackId }) });
    expect(incomplete.status).toBe(400);

    const acceptedGapKeys = evidenceGapRequirementKeys(pack.readiness);
    const decision = await gapDecisionPost(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/review-packs/evidence-gaps/${encodeURIComponent(pack.reviewPackId)}/decision`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ reviewPackRevision: 1, finalAction: "ENTER_PRIVATE_WIKIDRAFT", acceptedGapKeys, note: "Keep every visible gap in the private draft", privateDraftOnly: true, idempotencyKey: "gap-route-accept-001" }),
    }), { params: Promise.resolve({ reviewPackId: pack.reviewPackId }) });
    expect(decision.status).toBe(201);
    expect(await decision.json()).toMatchObject({ stage: "PRIVATE_WIKIDRAFT_WITH_GAPS", revision: 2, nextReviewPackId: null, capabilityBoundary: { studentVisible: false, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" } });

    const reviewedDetail = await gapDetailGet(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/review-packs/evidence-gaps/${encodeURIComponent(pack.reviewPackId)}`, { headers }), {
      params: Promise.resolve({ reviewPackId: pack.reviewPackId }),
    });
    expect(reviewedDetail.status).toBe(200);
    expect(await reviewedDetail.json()).toMatchObject({
      reviewPackId: pack.reviewPackId,
      editContext: {
        currentStage: "PRIVATE_WIKIDRAFT_WITH_GAPS",
        currentReviewRevision: 2,
        latestDecision: { reviewPackRevision: 1, acceptedGapKeys, finalAction: "ENTER_PRIVATE_WIKIDRAFT" },
      },
    });

    const revisedDecision = await gapDecisionPost(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/review-packs/evidence-gaps/${encodeURIComponent(pack.reviewPackId)}/decision`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ reviewPackRevision: 2, finalAction: "REJECT_CANDIDATE", acceptedGapKeys: [], note: "再次审核后改为拒绝，并保留原缺口判断。", privateDraftOnly: false, idempotencyKey: "gap-route-revision-002" }),
    }), { params: Promise.resolve({ reviewPackId: pack.reviewPackId }) });
    expect(revisedDecision.status).toBe(201);
    expect(await revisedDecision.json()).toMatchObject({ stage: "REJECTED", previousRevision: 2, revision: 3 });

    const auditConnection = createDb(databasePath);
    try {
      expect(auditConnection.sqlite.prepare(`
        SELECT review_pack_revision AS revision, previous_stage AS previousStage, next_stage AS nextStage
        FROM inspiration_wiki_evidence_gap_review_decisions
        WHERE review_pack_id = ? ORDER BY review_pack_revision
      `).all(pack.reviewPackId)).toEqual([
        { revision: 1, previousStage: "READY_FOR_TEACHER_TRIAGE", nextStage: "PRIVATE_WIKIDRAFT_WITH_GAPS" },
        { revision: 2, previousStage: "PRIVATE_WIKIDRAFT_WITH_GAPS", nextStage: "REJECTED" },
      ]);
    } finally {
      auditConnection.sqlite.close();
    }
  });
});

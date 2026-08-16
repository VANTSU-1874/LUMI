// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import type { StrictReviewPack } from "@/lib/domain/inspiration-wiki/review-pack-contracts";
import {
  compileAcceptedPrivateWikiDrafts,
  readTeacherPrivateWikiDraft,
  readTeacherPrivateWikiDraftQueue,
  updateTeacherPrivateWikiDraft,
} from "@/lib/services/inspiration-wiki-private-drafts";
import {
  calculateReviewPackMaterialHash,
  decideTeacherReviewPack,
  persistStrictReviewPack,
} from "@/lib/services/inspiration-wiki-review-packs";
import { acceptedReviewDecisionFixture, strictReviewPackFixture } from "@/tests/fixtures/inspiration-review-pack";

const teacher = { userId: "teacher", role: "TEACHER" as const };
const batchId = "private-draft-test-batch";
let connection: DatabaseConnection;
let directory: string;

function seedCandidate() {
  connection.sqlite.prepare(`
    INSERT INTO inspiration_wiki_hermes_candidates(
      id,batch_id,source_candidate_id,revision,contract_state,review_state,source_id,
      source_platform,page_url,canonical_url,title,description,author_json,license_json,
      media_json,design_categories_json,screening_json,raw_candidate_json,raw_digest,
      dedupe_fingerprint,scope,student_visible,wiki_draft,current_page,r2,embedding,
      lumi_retrieval,created_at,updated_at
    ) VALUES(?,?,?,1,'V1_UPGRADE_REQUIRED','PENDING_REVIEW','source-private-draft',
      'BEHANCE',?,NULL,?,NULL,NULL,NULL,'[{"kind":"IMAGE","asset":null}]',
      '["OTHER"]','{"totalScore":0,"evidence":[]}','{}',?,?,
      'PRIVATE_CANDIDATE',0,'NOT_CREATED','DISABLED','DISABLED','DISABLED','DISABLED',
      1700000000,1700000000)
  `).run(
    strictReviewPackFixture.candidateId,
    batchId,
    "source-candidate-private-draft",
    "https://www.behance.net/gallery/123456789/lighthouse-type-festival",
    strictReviewPackFixture.work.title,
    "1".repeat(64),
    "2".repeat(64),
  );
}

function acceptedPack() {
  const base = structuredClone(strictReviewPackFixture) as Partial<StrictReviewPack>;
  delete base.materialHash;
  const mediaGroup = strictReviewPackFixture.mediaGroup.map((media) => ({
    ...media,
    previewUrl: `/api/teacher/inspiration-wiki/review-packs/${strictReviewPackFixture.reviewPackId}/media/${media.mediaId}`,
  }));
  const withoutHash: Omit<StrictReviewPack, "materialHash"> = {
    ...(base as Omit<StrictReviewPack, "materialHash">),
    mediaGroup,
  };
  return {
    ...withoutHash,
    materialHash: calculateReviewPackMaterialHash(withoutHash),
  };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lumi-private-drafts-"));
  const databasePath = path.join(directory, "private.sqlite");
  runMigrations(databasePath);
  connection = createDb(databasePath);
  connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','Test teacher',1700000000);");
  connection.sqlite.prepare(`
    INSERT INTO inspiration_wiki_hermes_batches(
      batch_id,contract_version,package_digest,manifest_json,done_json,candidate_count,
      failure_count,intake_state,student_visible,current_page,r2,embedding,lumi_retrieval,imported_at
    ) VALUES(?,'LEGACY_V1',?,'{}','{}',1,0,'VALIDATED_PRIVATE',0,'DISABLED',
      'DISABLED','DISABLED','DISABLED',1700000000)
  `).run(batchId, "a".repeat(64));
  seedCandidate();
  const pack = acceptedPack();
  persistStrictReviewPack(connection, pack, pack.mediaGroup.map((media) => ({
    mediaId: media.mediaId,
    storagePath: `inspiration-wiki/review-packs/assets/fixture-lighthouse-001/${media.mediaId}.jpg`,
    mimeType: "image/jpeg" as const,
    bytes: 100,
    sha256: media.sha256,
  })), "2026-08-12T15:00:00.000Z");
  decideTeacherReviewPack(connection, teacher, acceptedReviewDecisionFixture, "2026-08-12T15:05:00.000Z");
});

afterEach(async () => {
  connection.sqlite.close();
  await rm(directory, { recursive: true, force: true });
});

describe("private WikiDraft service", () => {
  it("compiles accepted review material once and excludes all release capabilities", () => {
    expect(compileAcceptedPrivateWikiDrafts(connection, "2026-08-12T15:20:00.000Z")).toEqual({
      total: 1,
      imported: 1,
      replayed: 0,
      strict: 1,
      evidenceGap: 0,
      rejectedExcluded: 0,
    });
    expect(compileAcceptedPrivateWikiDrafts(connection, "2026-08-12T15:20:00.000Z")).toMatchObject({ imported: 0, replayed: 1 });
    const queue = readTeacherPrivateWikiDraftQueue(connection, teacher);
    expect(queue.meta).toMatchObject({ total: 1, editing: 1, readyForDomainReview: 0, rightsUnknown: 1 });
    expect(queue.items[0]).toMatchObject({ completedCount: 7, sourceContractKind: "STRICT_REVIEW_PACK" });
    expect(connection.sqlite.prepare(`
      SELECT student_visible AS studentVisible,current_page AS currentPage,r2,embedding,lumi_retrieval AS lumiRetrieval
      FROM inspiration_wiki_private_working_drafts
    `).get()).toEqual({ studentVisible: 0, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" });
  });

  it("appends edits, marks ready, and can reopen without overwriting history", () => {
    compileAcceptedPrivateWikiDrafts(connection, "2026-08-12T15:20:00.000Z");
    const id = `private-wiki-draft:${"1".repeat(32)}`;
    const first = readTeacherPrivateWikiDraft(connection, teacher, id);
    const ready = updateTeacherPrivateWikiDraft(connection, teacher, id, {
      expectedRevision: first.revision,
      expectedContentHash: first.contentHash,
      editable: first.editable,
      stage: "READY_FOR_DOMAIN_REVIEW",
      note: "完成七项编纂并送入分域复核",
      idempotencyKey: "private-draft-ready-001",
    }, "2026-08-12T15:25:00.000Z").draft;
    expect(ready).toMatchObject({ revision: 2, stage: "READY_FOR_DOMAIN_REVIEW" });
    const reopened = updateTeacherPrivateWikiDraft(connection, teacher, id, {
      expectedRevision: ready.revision,
      expectedContentHash: ready.contentHash,
      editable: { ...ready.editable, title: "灯塔字体节视觉识别｜教师修订" },
      stage: "EDITING",
      note: "重新打开并修订中文标题",
      idempotencyKey: "private-draft-reopen-001",
    }, "2026-08-12T15:30:00.000Z").draft;
    expect(reopened).toMatchObject({ revision: 3, stage: "EDITING", editable: { title: "灯塔字体节视觉识别｜教师修订" } });
    expect(connection.sqlite.prepare(
      "SELECT operation FROM inspiration_wiki_private_working_draft_revisions ORDER BY next_revision",
    ).all()).toEqual([
      { operation: "INITIAL_COMPILE" },
      { operation: "MARK_READY" },
      { operation: "REOPEN_EDITING" },
    ]);
    expect(() => connection.sqlite.prepare(
      "UPDATE inspiration_wiki_private_working_draft_revisions SET note='tampered'",
    ).run()).toThrow("PRIVATE_WORKING_DRAFT_REVISION_APPEND_ONLY");
  });
});

// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { inspirationPublicId } from "@/lib/domain/inspiration-public-id";
import { readPublishedInspirationBrowser } from "@/lib/services/inspiration-browser";
import {
  advanceAutomatedInspirationCandidate,
  decideInspirationCandidate,
  ingestPrivateInspirationCandidate,
  InspirationCandidateRevisionConflictError,
  InspirationCandidateStateError,
  readPrivateInspirationCandidate,
  readTeacherReviewQueue,
  registerInspirationSource,
  withdrawInspirationCandidate,
} from "@/lib/services/inspiration-review-pipeline";
import { formalStudentPublicationFixture, recentReviewPipelineFixtures, reviewPipelineSourceFixture } from "@/tests/fixtures/inspiration-review-pipeline";

const roots: string[] = [];
const teacher = { userId: "teacher", role: "TEACHER" as const };
const student = { userId: "student-1", role: "STUDENT" as const };

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-inspiration-review-"));
  roots.push(root);
  const databasePath = path.join(root, "review.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','测试教师',1700000000),('student-1',NULL,'STUDENT','测试学生',1700000000);");
  connection.sqlite.exec("INSERT INTO teacher_access_scopes VALUES('teacher','GLOBAL',NULL,'TEST_SETUP','测试课程负责人',1700000000)");
  registerInspirationSource(connection.db, reviewPipelineSourceFixture);
  for (const item of recentReviewPipelineFixtures) ingestPrivateInspirationCandidate(connection.db, { sourceId: reviewPipelineSourceFixture.id, ...item });
  return connection;
}

function ready(db: ReturnType<typeof createDb>["db"], id: string) {
  let revision = 1;
  for (const state of ["DOWNLOADED/IMPORTED", "NORMALIZED/DEDUPED", "VISUALLY_ANALYZED", "READY_FOR_TEACHER_REVIEW"] as const) {
    revision = advanceAutomatedInspirationCandidate(db, id, revision, state).revision;
  }
  return revision;
}

describe("inspiration teacher-review pipeline", () => {
  it("imports six path-free fixtures and exposes only ready private candidates to teachers", async () => {
    const connection = await setup();
    try {
      expect(readTeacherReviewQueue(connection.db, teacher)).toEqual([]);
      expect(() => readTeacherReviewQueue(connection.db, student)).toThrow();
      for (const item of recentReviewPipelineFixtures) ready(connection.db, item.candidate.id);
      const queue = readTeacherReviewQueue(connection.db, teacher);
      expect(queue).toHaveLength(6);
      expect(connection.sqlite.prepare("SELECT count(*) count FROM inspiration_candidate_analyses").get()).toEqual({ count: 6 });
      expect(queue.find(({ id }) => id === inspirationPublicId("inspiration-intake:recent-fin-metadata"))).toMatchObject({
        asset: { mode: "METADATA_ONLY" },
        curation: { title: "Fin", originalSourceDisplay: "fin.ai" },
      });
      expect(JSON.stringify(queue)).not.toContain("inspiration-intake:");
      expect(() => readPrivateInspirationCandidate(connection.db, student, recentReviewPipelineFixtures[0]!.candidate.id)).toThrow();
    } finally { connection.sqlite.close(); }
  });

  it("keeps ordinary APPROVE in the internal catalog and replays idempotently", async () => {
    const connection = await setup();
    try {
      const id = recentReviewPipelineFixtures[0]!.candidate.id;
      const revision = ready(connection.db, id);
      const input = { candidateId: id, expectedRevision: revision, decision: "APPROVE" as const, courseTags: ["信息层级"], notes: "可供教学观察", idempotencyKey: "approve-recent-grid" };
      expect(decideInspirationCandidate(connection.db, teacher, input)).toMatchObject({ state: "ACTIVE", revision: 8, publicationScope: "INTERNAL_CATALOG_ONLY", replayed: false });
      expect(decideInspirationCandidate(connection.db, teacher, input)).toMatchObject({ decision: "APPROVE", state: "ACTIVE", publicationScope: "INTERNAL_CATALOG_ONLY", replayed: true });
      expect(readPublishedInspirationBrowser(connection.db, { limit: 30 }).items).toEqual([]);
      expect(connection.sqlite.prepare("SELECT publication_scope publicationScope, student_visible studentVisible, source_disclosure_decision sourceDisclosureDecision, browser_channel browserChannel, bridge_channel bridgeChannel, citation_eligibility_recorded activationRecorded FROM inspiration_admissions WHERE candidate_id=?").get(id)).toEqual({
        publicationScope: "INTERNAL_CATALOG_ONLY", studentVisible: 0, sourceDisclosureDecision: "PENDING", browserChannel: "DISABLED", bridgeChannel: "DISABLED", activationRecorded: 0,
      });
      expect(connection.sqlite.prepare("SELECT event_type eventType FROM inspiration_candidate_audit_events WHERE candidate_id=? ORDER BY created_at, rowid").all(id))
        .toEqual(expect.arrayContaining([{ eventType: "APPROVED" }, { eventType: "AUTO_ADMITTED/INDEXED" }, { eventType: "ACTIVE" }]));
      expect(connection.sqlite.prepare("SELECT count(*) count FROM inspiration_candidate_audit_events WHERE candidate_id=? AND event_type='FORMAL_STUDENT_PUBLICATION_RECORDED'").get(id)).toEqual({ count: 0 });
      expect(() => connection.sqlite.prepare("UPDATE inspiration_admissions SET student_visible=1, student_display_decision='ALLOW' WHERE candidate_id=?").run(id)).toThrow();
    } finally { connection.sqlite.close(); }
  });

  it("publishes only when every formal student gate is explicitly recorded", async () => {
    const connection = await setup();
    try {
      const id = recentReviewPipelineFixtures[0]!.candidate.id;
      const revision = ready(connection.db, id);
      const published = decideInspirationCandidate(connection.db, teacher, {
        candidateId: id,
        expectedRevision: revision,
        decision: "APPROVE",
        courseTags: ["信息层级"],
        notes: "全部正式发布门已人工确认",
        idempotencyKey: "publish-recent-grid",
        studentPublication: formalStudentPublicationFixture(),
      });
      expect(published).toMatchObject({ state: "ACTIVE", publicationScope: "AUTHENTICATED_STUDENT_ONLY" });
      expect(readPublishedInspirationBrowser(connection.db, { limit: 30 }).items).toEqual([
        expect.objectContaining({
          id: inspirationPublicId(id),
          tags: expect.arrayContaining(["信息层级"]),
          source: { label: "审核公开来源", url: "https://example.org/source" },
        }),
      ]);
      expect(connection.sqlite.prepare("SELECT publication_scope publicationScope, student_visible studentVisible, student_display_decision studentDisplayDecision, source_disclosure_decision sourceDisclosureDecision, teaching_decision teachingDecision, safety_decision safetyDecision, quality_decision qualityDecision, withdrawal_readiness withdrawalReadiness, browser_channel browserChannel, bridge_channel bridgeChannel, publication_revision publicationRevision, published_by publishedBy, citation_eligibility_recorded activationRecorded FROM inspiration_admissions WHERE candidate_id=?").get(id)).toEqual({
        publicationScope: "AUTHENTICATED_STUDENT_ONLY", studentVisible: 1, studentDisplayDecision: "ALLOW", sourceDisclosureDecision: "ALLOW", teachingDecision: "ALLOW", safetyDecision: "ALLOW", qualityDecision: "ALLOW", withdrawalReadiness: "READY", browserChannel: "ACTIVE", bridgeChannel: "ACTIVE", publicationRevision: 1, publishedBy: "teacher", activationRecorded: 1,
      });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM inspiration_candidate_audit_events WHERE candidate_id=? AND event_type='FORMAL_STUDENT_PUBLICATION_RECORDED'").get(id)).toEqual({ count: 1 });
    } finally { connection.sqlite.close(); }
  });

  it("removes a frozen review candidate from the queue and refuses a direct stale-review decision", async () => {
    const connection = await setup();
    try {
      const id = recentReviewPipelineFixtures[0]!.candidate.id;
      const revision = ready(connection.db, id);
      connection.sqlite.prepare("UPDATE inspiration_candidates SET withdrawal_status='FROZEN' WHERE id=?").run(id);
      expect(readTeacherReviewQueue(connection.db, teacher)).not.toContainEqual(expect.objectContaining({ id: inspirationPublicId(id) }));
      expect(() => decideInspirationCandidate(connection.db, teacher, { candidateId: id, expectedRevision: revision, decision: "APPROVE", courseTags: [], notes: "冻结候选不得审核", idempotencyKey: "frozen-review-refusal" })).toThrow(InspirationCandidateStateError);
    } finally { connection.sqlite.close(); }
  });

  it("keeps rejection and withdrawal out of the active bridge and rejects stale decisions", async () => {
    const connection = await setup();
    try {
      const rejectedId = recentReviewPipelineFixtures[1]!.candidate.id;
      const rejectedRevision = ready(connection.db, rejectedId);
      expect(decideInspirationCandidate(connection.db, teacher, { candidateId: rejectedId, expectedRevision: rejectedRevision, decision: "REJECT", courseTags: [], notes: "重复风险高", idempotencyKey: "reject-recent-token" }))
        .toMatchObject({ state: "REJECTED" });
      expect(readPublishedInspirationBrowser(connection.db, { limit: 30 }).items).toEqual([]);
      const activeId = recentReviewPipelineFixtures[2]!.candidate.id;
      const activeRevision = ready(connection.db, activeId);
      const approved = decideInspirationCandidate(connection.db, teacher, { candidateId: activeId, expectedRevision: activeRevision, decision: "APPROVE", courseTags: [], notes: "通过", idempotencyKey: "approve-before-withdraw" });
      expect(() => decideInspirationCandidate(connection.db, teacher, { candidateId: activeId, expectedRevision: activeRevision, decision: "REJECT", courseTags: [], notes: "过期", idempotencyKey: "stale-review-request" })).toThrow(InspirationCandidateRevisionConflictError);
      expect(withdrawInspirationCandidate(connection.db, teacher, activeId, approved.revision)).toMatchObject({ state: "WITHDRAWN" });
      expect(readPublishedInspirationBrowser(connection.db, { limit: 30 }).items).toEqual([]);
    } finally { connection.sqlite.close(); }
  });
});

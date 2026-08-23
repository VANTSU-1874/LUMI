// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as decisionPost } from "@/app/api/teacher/inspiration-candidates/[candidateId]/decision/route";
import { GET as queueGet } from "@/app/api/teacher/inspiration-candidates/route";
import { GET as browseGet } from "@/app/api/inspiration/browse/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { advanceAutomatedInspirationCandidate, ingestPrivateInspirationCandidate, registerInspirationSource } from "@/lib/services/inspiration-review-pipeline";
import { formalStudentPublicationFixture, recentReviewPipelineFixtures, reviewPipelineSourceFixture } from "@/tests/fixtures/inspiration-review-pipeline";

const SECRET = "inspiration-route-secret-at-least-32-characters";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

describe("teacher inspiration review API", () => {
  let directory: string;
  let databasePath: string;
  let candidateId: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-inspiration-routes-"));
    databasePath = path.join(directory, "review.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    const fixture = recentReviewPipelineFixtures[0]!;
    candidateId = fixture.candidate.id;
    try {
      connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','测试教师',1700000000),('student-1',NULL,'STUDENT','测试学生',1700000000),('deleted-teacher',NULL,'TEACHER','已删除教师',1700000000); DELETE FROM users WHERE id='deleted-teacher';");
      connection.sqlite.exec("INSERT INTO teacher_access_scopes VALUES('teacher','GLOBAL',NULL,'TEST_SETUP','测试课程负责人',1700000000)");
      registerInspirationSource(connection.db, reviewPipelineSourceFixture);
      ingestPrivateInspirationCandidate(connection.db, { sourceId: reviewPipelineSourceFixture.id, ...fixture });
      let revision = 1;
      for (const state of ["DOWNLOADED/IMPORTED", "NORMALIZED/DEDUPED", "VISUALLY_ANALYZED", "READY_FOR_TEACHER_REVIEW"] as const) {
        revision = advanceAutomatedInspirationCandidate(connection.db, candidateId, revision, state).revision;
      }
    } finally { connection.sqlite.close(); }
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
  });

  afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

  it("keeps the queue private and ordinary APPROVE internal-only", async () => {
    expect((await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-candidates"))).status).toBe(401);
    const studentToken = await issueSession({ userId: "student-1", role: "STUDENT" }, SECRET);
    expect((await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-candidates", { headers: { cookie: cookie(studentToken) } }))).status).toBe(403);
    const teacherToken = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const queue = await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-candidates", { headers: { cookie: cookie(teacherToken) } }));
    expect(queue.status).toBe(200);
    const queuePayload = await queue.json();
    expect(queuePayload.items).toHaveLength(1);
    const publicId = queuePayload.items[0].id;
    const decision = await decisionPost(new NextRequest(`http://localhost/api/teacher/inspiration-candidates/${publicId}/decision`, {
      method: "POST", headers: { cookie: cookie(teacherToken), "content-type": "application/json" },
      body: JSON.stringify({ candidateId: publicId, expectedRevision: 5, decision: "APPROVE", courseTags: ["信息层级"], notes: "可作课堂参考", idempotencyKey: "route-approve-recent-grid" }),
    }), { params: Promise.resolve({ candidateId: publicId }) });
    expect(decision.status).toBe(201);
    expect(await decision.json()).toMatchObject({ state: "ACTIVE", publicationScope: "INTERNAL_CATALOG_ONLY" });
    expect((await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-candidates", { headers: { cookie: cookie(teacherToken) } }))).status).toBe(200);
    const studentBrowse = await browseGet(new NextRequest("http://localhost/api/inspiration/browse", { headers: { cookie: cookie(studentToken) } }));
    expect(studentBrowse.status).toBe(200);
    expect(await studentBrowse.json()).toMatchObject({ items: [] });
  });

  it("persists every explicit publication gate before the approved case reaches students", async () => {
    const teacherToken = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const queue = await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-candidates", { headers: { cookie: cookie(teacherToken) } }));
    const publicId = (await queue.json()).items[0].id;
    const decision = await decisionPost(new NextRequest(`http://localhost/api/teacher/inspiration-candidates/${publicId}/decision`, {
      method: "POST", headers: { cookie: cookie(teacherToken), "content-type": "application/json" },
      body: JSON.stringify({ candidateId: publicId, expectedRevision: 5, decision: "APPROVE", courseTags: ["信息层级"], notes: "正式发布门已核对", idempotencyKey: "route-publish-recent-grid", studentPublication: formalStudentPublicationFixture() }),
    }), { params: Promise.resolve({ candidateId: publicId }) });
    expect(decision.status).toBe(201);
    expect(await decision.json()).toMatchObject({ state: "ACTIVE", publicationScope: "AUTHENTICATED_STUDENT_ONLY" });
    const studentToken = await issueSession({ userId: "student-1", role: "STUDENT" }, SECRET);
    const browse = await browseGet(new NextRequest("http://localhost/api/inspiration/browse", { headers: { cookie: cookie(studentToken) } }));
    expect(browse.status).toBe(200);
    expect(await browse.json()).toMatchObject({ items: [expect.objectContaining({ id: publicId })] });
  });

  it("rejects deleted and nonexistent teacher cookies on both review routes", async () => {
    const validTeacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const queue = await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-candidates", { headers: { cookie: cookie(validTeacher) } }));
    const publicId = (await queue.json()).items[0].id;
    for (const userId of ["deleted-teacher", "nonexistent-teacher"]) {
      const token = await issueSession({ userId, role: "TEACHER" }, SECRET);
      expect((await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-candidates", { headers: { cookie: cookie(token) } }))).status).toBe(403);
      const decision = await decisionPost(new NextRequest(`http://localhost/api/teacher/inspiration-candidates/${publicId}/decision`, {
        method: "POST", headers: { cookie: cookie(token), "content-type": "application/json" },
        body: JSON.stringify({ candidateId: publicId, expectedRevision: 5, decision: "APPROVE", courseTags: [], notes: "", idempotencyKey: `deleted-${userId}` }),
      }), { params: Promise.resolve({ candidateId: publicId }) });
      expect(decision.status).toBe(403);
    }
  });
});

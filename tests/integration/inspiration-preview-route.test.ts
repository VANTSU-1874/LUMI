// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as browseGet } from "@/app/api/inspiration/browse/route";
import { GET as previewGet } from "@/app/api/inspiration/previews/[publicId]/route";
import { GET as teacherQueueGet } from "@/app/api/teacher/inspiration-candidates/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { inspirationPublicId } from "@/lib/domain/inspiration-public-id";
import { advanceAutomatedInspirationCandidate, decideInspirationCandidate, ingestPrivateInspirationCandidate, registerInspirationSource, withdrawInspirationCandidate } from "@/lib/services/inspiration-review-pipeline";
import { privateCandidateAnalysis, privateCandidateIntake, teacherReviewPackage } from "@/tests/fixtures/inspiration-case-intake";
import { formalStudentPublicationFixture, reviewPipelineSourceFixture } from "@/tests/fixtures/inspiration-review-pipeline";
import { p2StudentChannelShadowFixture } from "@/tests/fixtures/inspiration-p2-shadow";
import { persistP2StudentChannelShadowSnapshot } from "@/lib/services/inspiration-wiki-p2-student-channels";

const SECRET = "inspiration-preview-route-secret-at-least-32-chars";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

function fixture(id: string, title: string) {
  const hashCharacter = id.endsWith("active") ? "a" : id.endsWith("pending") ? "b" : id.endsWith("withdrawn") ? "c" : id.endsWith("frozen") ? "d" : id.endsWith("staged") ? "e" : "f";
  const candidate = privateCandidateIntake({ id, asset: { mode: "PRIVATE_COPY", privateAssetRef: `local-synthetic://inspiration-preview/${id.replace(/[^a-z0-9-]/g, "-")}`, contentHash: `sha256:${hashCharacter.repeat(64)}` }, curation: { ...privateCandidateIntake().curation, title, originalSourceDisplay: "合规 synthetic 来源", originalSourceUrl: "https://example.org/source", observedAt: "2026-08-09T00:00:00.000Z" }, withdrawal: { status: "READY", complaintLocator: null }, rights: { ...privateCandidateIntake().rights, decisions: { ...privateCandidateIntake().rights.decisions, DERIVE_PREVIEW: "ALLOW", STUDENT_DISPLAY: "ALLOW" } } });
  const analysis = privateCandidateAnalysis({ candidateId: id });
  return { candidate, analysis, reviewPackage: teacherReviewPackage({ candidateId: id, preview: { mode: "PRIVATE_PREVIEW", privateAssetRef: candidate.asset.privateAssetRef }, source: { curationSourceUrl: null, originalSourceDisplay: "合规 synthetic 来源", originalSourceUrl: "https://example.org/source", attributionStatus: "RECORDED" }, processingLog: analysis.processing }) };
}

function activate(db: ReturnType<typeof createDb>["db"], id: string, publishToStudents = true) {
  let revision = 1;
  for (const state of ["DOWNLOADED/IMPORTED", "NORMALIZED/DEDUPED", "VISUALLY_ANALYZED", "READY_FOR_TEACHER_REVIEW"] as const) revision = advanceAutomatedInspirationCandidate(db, id, revision, state).revision;
  return decideInspirationCandidate(db, { userId: "teacher", role: "TEACHER" }, {
    candidateId: id, expectedRevision: revision, decision: "APPROVE", courseTags: ["书籍设计"], notes: "合规测试", idempotencyKey: `preview-${id.slice(-14)}`,
    studentPublication: publishToStudents ? formalStudentPublicationFixture() : undefined,
  });
}

describe("protected inspiration previews", () => {
  let directory: string;
  let activeId: string;
  let pendingId: string;
  let withdrawnId: string;
  let frozenId: string;
  let stagedId: string;
  let internalId: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-inspiration-preview-"));
    const databasePath = path.join(directory, "preview.sqlite"); runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','教师',1700000000),('student',NULL,'STUDENT','学生',1700000000),('deleted-student',NULL,'STUDENT','已删除学生',1700000000); INSERT INTO classes(id,name,access_code) VALUES('review-class','审核班','PREVIEW'); INSERT INTO users(id,class_id,role,alias,created_at) VALUES('deleted-teacher','review-class','TEACHER','已删除教师',1700000000); DELETE FROM users WHERE id IN ('deleted-teacher','deleted-student');");
      connection.sqlite.exec("INSERT INTO teacher_access_scopes VALUES('teacher','GLOBAL',NULL,'TEST_SETUP','测试课程负责人',1700000000)");
      registerInspirationSource(connection.db, reviewPipelineSourceFixture);
      activeId = "inspiration-intake:preview-active"; pendingId = "inspiration-intake:preview-pending"; withdrawnId = "inspiration-intake:preview-withdrawn"; frozenId = "inspiration-intake:preview-frozen"; stagedId = "inspiration-intake:preview-staged"; internalId = "inspiration-intake:preview-internal";
      for (const item of [fixture(activeId, "可展示案例"), fixture(pendingId, "待审案例"), fixture(withdrawnId, "撤下案例"), fixture(frozenId, "冻结案例"), fixture(stagedId, "尚未待审案例"), fixture(internalId, "仅内部案例")]) ingestPrivateInspirationCandidate(connection.db, { sourceId: reviewPipelineSourceFixture.id, ...item });
      activate(connection.db, activeId);
      activate(connection.db, internalId, false);
      let pendingRevision = 1;
      for (const state of ["DOWNLOADED/IMPORTED", "NORMALIZED/DEDUPED", "VISUALLY_ANALYZED", "READY_FOR_TEACHER_REVIEW"] as const) pendingRevision = advanceAutomatedInspirationCandidate(connection.db, pendingId, pendingRevision, state).revision;
      const withdrawn = activate(connection.db, withdrawnId);
      withdrawInspirationCandidate(connection.db, { userId: "teacher", role: "TEACHER" }, withdrawnId, withdrawn.revision);
      let frozenRevision = 1;
      for (const state of ["DOWNLOADED/IMPORTED", "NORMALIZED/DEDUPED", "VISUALLY_ANALYZED", "READY_FOR_TEACHER_REVIEW"] as const) frozenRevision = advanceAutomatedInspirationCandidate(connection.db, frozenId, frozenRevision, state).revision;
      connection.sqlite.prepare("UPDATE inspiration_candidates SET withdrawal_status='FROZEN' WHERE id=?").run(frozenId);
    } finally { connection.sqlite.close(); }
    vi.stubEnv("DATABASE_PATH", databasePath); vi.stubEnv("SESSION_SECRET", SECRET);
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

  it("delivers only an authenticated active synthetic preview and never leaks private candidate fields", async () => {
    const publicId = inspirationPublicId(activeId);
    expect((await previewGet(new NextRequest(`http://localhost/api/inspiration/previews/${publicId}`), { params: Promise.resolve({ publicId }) })).status).toBe(401);
    const student = await issueSession({ userId: "student", role: "STUDENT" }, SECRET);
    const response = await previewGet(new NextRequest(`http://localhost/api/inspiration/previews/${publicId}`, { headers: { cookie: cookie(student) } }), { params: Promise.resolve({ publicId }) });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("content-type")).toContain("image/svg+xml");
    const body = await response.text(); expect(body).toContain("<svg"); expect(body).not.toContain("inspiration-intake:"); expect(body).not.toContain("local-synthetic://");
    const browse = await browseGet(new NextRequest("http://localhost/api/inspiration/browse", { headers: { cookie: cookie(student) } }));
    expect(await browse.json()).toMatchObject({ items: [expect.objectContaining({ id: publicId, preview: "CONTROLLED", previewUrl: `/api/inspiration/previews/${publicId}` })] });
  });

  it("blocks student preview during P2 Shadow without blocking teacher review preview", async () => {
    const connection = createDb(process.env.DATABASE_PATH!);
    try { persistP2StudentChannelShadowSnapshot(connection, p2StudentChannelShadowFixture()); }
    finally { connection.sqlite.close(); }
    const student = await issueSession({ userId: "student", role: "STUDENT" }, SECRET);
    const activePublicId = inspirationPublicId(activeId);
    expect((await previewGet(
      new NextRequest(`http://localhost/api/inspiration/previews/${activePublicId}`, { headers: { cookie: cookie(student) } }),
      { params: Promise.resolve({ publicId: activePublicId }) },
    )).status).toBe(404);
    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const pendingPublicId = inspirationPublicId(pendingId);
    expect((await previewGet(
      new NextRequest(`http://localhost/api/inspiration/previews/${pendingPublicId}`, { headers: { cookie: cookie(teacher) } }),
      { params: Promise.resolve({ publicId: pendingPublicId }) },
    )).status).toBe(200);
  });

  it("shares a database-backed review predicate: students see only active cases and teachers see only reviewable cases", async () => {
    const student = await issueSession({ userId: "student", role: "STUDENT" }, SECRET);
    for (const id of [pendingId, withdrawnId, frozenId, stagedId, internalId]) {
      const publicId = inspirationPublicId(id);
      expect((await previewGet(new NextRequest(`http://localhost/api/inspiration/previews/${publicId}`, { headers: { cookie: cookie(student) } }), { params: Promise.resolve({ publicId }) })).status).toBe(404);
    }
    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const pendingPublicId = inspirationPublicId(pendingId);
    expect((await previewGet(new NextRequest(`http://localhost/api/inspiration/previews/${pendingPublicId}`, { headers: { cookie: cookie(teacher) } }), { params: Promise.resolve({ publicId: pendingPublicId }) })).status).toBe(200);
    for (const id of [activeId, withdrawnId, frozenId, stagedId]) {
      const publicId = inspirationPublicId(id);
      expect((await previewGet(new NextRequest(`http://localhost/api/inspiration/previews/${publicId}`, { headers: { cookie: cookie(teacher) } }), { params: Promise.resolve({ publicId }) })).status).toBe(404);
    }
    const queue = await teacherQueueGet(new NextRequest("http://localhost/api/teacher/inspiration-candidates", { headers: { cookie: cookie(teacher) } }));
    const payload = await queue.json();
    expect(payload.items).toEqual([expect.objectContaining({ id: pendingPublicId, reviewPackage: expect.objectContaining({ preview: { mode: "CONTROLLED", previewUrl: `/api/inspiration/previews/${pendingPublicId}` } }) })]);
    expect(JSON.stringify(payload)).not.toContain("local-synthetic://");
    expect(JSON.stringify(payload)).not.toContain("inspiration-intake:");
  });

  it("rejects a deleted teacher session from both the preview and the review queue", async () => {
    const deletedTeacher = await issueSession({ userId: "deleted-teacher", role: "TEACHER" }, SECRET);
    const publicId = inspirationPublicId(pendingId);
    expect((await previewGet(new NextRequest(`http://localhost/api/inspiration/previews/${publicId}`, { headers: { cookie: cookie(deletedTeacher) } }), { params: Promise.resolve({ publicId }) })).status).toBe(403);
    expect((await teacherQueueGet(new NextRequest("http://localhost/api/teacher/inspiration-candidates", { headers: { cookie: cookie(deletedTeacher) } }))).status).toBe(403);
  });

  it("rejects deleted and nonexistent student cookies before preview resolution", async () => {
    const publicId = inspirationPublicId(activeId);
    for (const userId of ["deleted-student", "nonexistent-student"]) {
      const token = await issueSession({ userId, role: "STUDENT" }, SECRET);
      expect((await previewGet(new NextRequest(`http://localhost/api/inspiration/previews/${publicId}`, { headers: { cookie: cookie(token) } }), { params: Promise.resolve({ publicId }) })).status).toBe(403);
    }
  });
});

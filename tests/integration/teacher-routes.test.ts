// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as dashboardGet } from "@/app/api/teacher/dashboard/route";
import { GET as knowledgeCanaryGet } from "@/app/api/teacher/knowledge-canary/route";
import { GET as learnerGet } from "@/app/api/teacher/learners/[studentId]/route";
import { GET as pilotReportGet } from "@/app/api/teacher/pilot-report/route";
import { POST as decisionPost } from "@/app/api/teacher/decisions/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const SECRET = "teacher-route-secret-at-least-32-characters";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

describe("teacher routes", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-teacher-routes-"));
    databasePath = path.join(directory, "routes.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    const now = Math.floor(Date.now() / 1_000);
    try { connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','一班','PRIVATE'),('c2','二班','PRIVATE2');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1','c1','STUDENT','匿名-A',${now}),('s2','c2','STUDENT','匿名-B',${now}),('teacher',NULL,'TEACHER','课程负责人',${now}),('t1','c1','TEACHER','一班教师',${now}),('t2','c2','TEACHER','二班教师',${now});
      INSERT INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES('m1','c1',1,'M',1,'F'),('m2','c2',1,'M',1,'F');
      INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at) VALUES('a1','c1','m1','A','B','["DIGISHOW"]',${now}),('a2','c2','m2','A','B','["DIGISHOW"]',${now});
      INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at) VALUES('p1','c1','a1','s1','LOGIC_CARD',${now},${now}),('p2','c2','a2','s2','LOGIC_CARD',${now},${now});
      INSERT INTO logic_cards(project_id,payload_json,rule_ready,semantic_ready,semantic_review_json,revision,card_hash) VALUES('p1','{}',0,0,'{"status":"PENDING","ready":false,"issues":[],"source":"RULE"}',1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    `); } finally { connection.sqlite.close(); }
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("AUTH_PROXY_SECRET", "teacher-route-proxy-secret-at-least-32-characters");
  });

  afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

  it("enforces teacher role and private no-store headers", async () => {
    expect((await dashboardGet(new NextRequest("http://localhost/api/teacher/dashboard?classId=c1"))).status).toBe(401);
    const student = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    expect((await dashboardGet(new NextRequest("http://localhost/api/teacher/dashboard?classId=c1", { headers: { cookie: cookie(student) } }))).status).toBe(403);
    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const response = await dashboardGet(new NextRequest("http://localhost/api/teacher/dashboard?classId=c1", { headers: { cookie: cookie(teacher) } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });

  it("keeps Canary observation aggregate, private and teacher-only", async () => {
    expect((await knowledgeCanaryGet(
      new NextRequest("http://localhost/api/teacher/knowledge-canary"),
    )).status).toBe(401);
    const student = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    expect((await knowledgeCanaryGet(
      new NextRequest("http://localhost/api/teacher/knowledge-canary", {
        headers: { cookie: cookie(student) },
      }),
    )).status).toBe(403);
    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const response = await knowledgeCanaryGet(new NextRequest(
      "http://localhost/api/teacher/knowledge-canary?windowMinutes=30",
      { headers: { cookie: cookie(teacher) } },
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    const payload = await response.json();
    expect(payload.observation.manualReview.studentVisibleErrorCheckRequired).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("PRIVATE");
    expect((await knowledgeCanaryGet(new NextRequest(
      "http://localhost/api/teacher/knowledge-canary?windowMinutes=241",
      { headers: { cookie: cookie(teacher) } },
    ))).status).toBe(400);
  });

  it("returns 404 for a learner outside the explicitly selected class", async () => {
    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const response = await learnerGet(
      new NextRequest("http://localhost/api/teacher/learners/s2?classId=c1", { headers: { cookie: cookie(teacher) } }),
      { params: Promise.resolve({ studentId: "s2" }) },
    );
    expect(response.status).toBe(404);
  });

  it("keeps a persisted class teacher inside their own class", async () => {
    const teacher = await issueSession({ userId: "t1", role: "TEACHER" }, SECRET);
    expect((await dashboardGet(new NextRequest("http://localhost/api/teacher/dashboard?classId=c1", { headers: { cookie: cookie(teacher) } }))).status).toBe(200);
    expect((await dashboardGet(new NextRequest("http://localhost/api/teacher/dashboard?classId=c2", { headers: { cookie: cookie(teacher) } }))).status).toBe(404);
    expect((await learnerGet(new NextRequest("http://localhost/api/teacher/learners/s2?classId=c2", { headers: { cookie: cookie(teacher) } }), { params: Promise.resolve({ studentId: "s2" }) })).status).toBe(404);
  });

  it("downloads a private REAL-only pilot report inside the teacher class scope", async () => {
    expect((await pilotReportGet(new NextRequest("http://localhost/api/teacher/pilot-report?classId=c1"))).status).toBe(401);
    const classTeacher = await issueSession({ userId: "t1", role: "TEACHER" }, SECRET);
    const response = await pilotReportGet(new NextRequest("http://localhost/api/teacher/pilot-report?classId=c1", { headers: { cookie: cookie(classTeacher) } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="chuying-real-pilot-/);
    const body = await response.text();
    expect(body).toContain("数据边界：仅 REAL（真实试用）");
    expect(body).toContain("匿名参与人数：1");
    expect(body).toContain("待人工观察");
    expect(body).not.toContain("匿名-A");

    expect((await pilotReportGet(new NextRequest("http://localhost/api/teacher/pilot-report?classId=c2", { headers: { cookie: cookie(classTeacher) } }))).status).toBe(404);
  });

  it("appends a bounded decision after auth and preserves it on reload", async () => {
    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const request = new NextRequest("http://localhost/api/teacher/decisions", {
      method: "POST",
      headers: { cookie: cookie(teacher), "content-type": "application/json" },
      body: JSON.stringify({ classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW", targetId: "p1", originalRevision: 1, decision: "NEEDS_REVIEW", reasonCode: "TEACHER_CHECK", notes: "请当面检查", idempotencyKey: "route-idem-1234" }),
    });
    const response = await decisionPost(request);
    expect(response.status).toBe(201);
    const detail = await learnerGet(
      new NextRequest("http://localhost/api/teacher/learners/s1?classId=c1", { headers: { cookie: cookie(teacher) } }),
      { params: Promise.resolve({ studentId: "s1" }) },
    );
    const payload = await detail.json();
    expect(payload.logic.status).toBe("PENDING");
    expect(payload.decisions).toHaveLength(1);
    expect(payload.decisions[0].decision).toBe("NEEDS_REVIEW");
  });

  it("rejects oversized bodies before parsing", async () => {
    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const response = await decisionPost(new NextRequest("http://localhost/api/teacher/decisions", {
      method: "POST", headers: { cookie: cookie(teacher), "content-type": "application/json", "content-length": "20000" }, body: "{}",
    }));
    expect(response.status).toBe(413);
  });

  it("returns 409 when an idempotency key is reused with different notes", async () => {
    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const body = { classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW", targetId: "p1", originalRevision: 1, decision: "CONFIRMED", reasonCode: "OK", notes: "first", idempotencyKey: "route-conflict-key" };
    const send = (notes: string) => decisionPost(new NextRequest("http://localhost/api/teacher/decisions", { method: "POST", headers: { cookie: cookie(teacher), "content-type": "application/json" }, body: JSON.stringify({ ...body, notes }) }));
    expect((await send("first")).status).toBe(201);
    expect((await send("different")).status).toBe(409);
  });
});

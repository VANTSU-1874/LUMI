// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/teacher/evidence/[evidenceId]/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const SECRET = "teacher-evidence-route-secret-at-least-32-chars";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;
const context = (evidenceId: string) => ({ params: Promise.resolve({ evidenceId }) });

describe("teacher evidence detail route", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-teacher-evidence-route-"));
    databasePath = path.join(directory, "route.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','一班','C1'),('c2','二班','C2');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('s1','c1','STUDENT','匿名一',1700000000),('s2','c2','STUDENT','匿名二',1700000000),
          ('teacher',NULL,'TEACHER','课程负责人',1700000000),('t1','c1','TEACHER','一班教师',1700000000),('t2','c2','TEACHER','二班教师',1700000000);
        INSERT INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES('m1','c1',1,'M',1,'F'),('m2','c2',1,'M',1,'F');
        INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at) VALUES('a1','c1','m1','A','B','["DIGISHOW"]',1700000000),('a2','c2','m2','A','B','["DIGISHOW"]',1700000000);
        INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at) VALUES('p1','c1','a1','s1','TROUBLESHOOT',1700000000,1700000000),('p2','c2','a2','s2','TROUBLESHOOT',1700000000,1700000000);
        INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
        VALUES('11111111-1111-4111-8111-111111111111','p1','c1','s1',1,'TEXT','INPUT',NULL,'SUBMITTED','READY','输入观察','只有授权教师可见','${"a".repeat(64)}',NULL,NULL,1700000001);
      `);
    } finally { connection.sqlite.close(); }
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
  });

  afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

  it("returns private no-store content to the owning class teacher", async () => {
    const teacher = await issueSession({ userId: "t1", role: "TEACHER" }, SECRET);
    const response = await GET(new NextRequest("http://localhost/api/teacher/evidence/11111111-1111-4111-8111-111111111111", { headers: { cookie: cookie(teacher) } }), context("11111111-1111-4111-8111-111111111111"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    const payload = await response.json();
    expect(payload).toMatchObject({ kind: "TEXT", text: "只有授权教师可见" });
    expect(JSON.stringify(payload)).not.toMatch(/contentDigest|originalName|p1\//i);
  });

  it("rejects missing sessions and students, while hiding cross-class evidence", async () => {
    const url = "http://localhost/api/teacher/evidence/11111111-1111-4111-8111-111111111111";
    expect((await GET(new NextRequest(url), context("11111111-1111-4111-8111-111111111111"))).status).toBe(401);
    const student = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    expect((await GET(new NextRequest(url, { headers: { cookie: cookie(student) } }), context("11111111-1111-4111-8111-111111111111"))).status).toBe(403);
    const otherTeacher = await issueSession({ userId: "t2", role: "TEACHER" }, SECRET);
    expect((await GET(new NextRequest(url, { headers: { cookie: cookie(otherTeacher) } }), context("11111111-1111-4111-8111-111111111111"))).status).toBe(404);
  });
});

// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/evidence/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const SECRET = "evidence-list-secret-at-least-32-characters";
const uuid = (index: number) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;

describe("paginated authorized evidence history", () => {
  let directory: string;
  let databasePath: string;
  let student: string;
  let otherStudent: string;
  let ownerTeacher: string;
  let classTeacher: string;

  function request(query: string, token: string) {
    return new NextRequest(`http://localhost/api/evidence${query}`, { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } });
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-evidence-list-"));
    databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes VALUES ('c1','一班','C1'),('c2','二班','C2');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES ('s1','c1','STUDENT','匿名一',1700000000),('s2','c2','STUDENT','匿名二',1700000000),('teacher',NULL,'TEACHER','课程负责人',1700000000),('t1','c1','TEACHER','一班教师',1700000000);
      INSERT INTO teacher_access_scopes(teacher_id,scope_kind,class_id,granted_by,grant_reason,created_at) VALUES('teacher','GLOBAL',NULL,'TEST_SETUP','测试课程负责人',1700000000);
      INSERT INTO course_modules VALUES ('m1','c1',1,'模块',8,'信号'),('m2','c2',1,'模块',8,'信号');
      INSERT INTO assignments VALUES ('a1','c1','m1','旧作业','旧项目','["DIGISHOW"]',1700000000),('a2','c1','m1','新作业','新项目','["DIGISHOW"]',1700000001),('a3','c2','m2','二班作业','二班项目','["DIGISHOW"]',1700000000);
      INSERT INTO projects VALUES ('p-old','c1','a1','s1','COMPLETE',1700000000,1700000000,0),('p-new','c1','a2','s1','TROUBLESHOOT',1700000001,1700000001,0),('p-other','c2','a3','s2','TROUBLESHOOT',1700000000,1700000000,0);
    `);
    const insert = connection.sqlite.prepare(`INSERT INTO evidence (id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at) VALUES (?,?,?,?,?,'TEXT','INPUT',NULL,'SUBMITTED','READY',?,?,?,NULL,NULL,?)`);
    for (let index = 1; index <= 55; index += 1) {
      insert.run(uuid(index), index <= 30 ? "p-old" : "p-new", "c1", "s1", index <= 30 ? index : index - 30, `证据${index}`, `内容${index}`, index.toString(16).padStart(64, "0"), 1700000000 + index);
    }
    for (let index = 56; index <= 80; index += 1) {
      insert.run(uuid(index), "p-other", "c2", "s2", index - 55, `证据${index}`, `内容${index}`, index.toString(16).padStart(64, "0"), 1700000000 + index);
    }
    connection.sqlite.close();
    student = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    otherStudent = await issueSession({ userId: "s2", role: "STUDENT" }, SECRET);
    ownerTeacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    classTeacher = await issueSession({ userId: "t1", role: "TEACHER" }, SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("EVIDENCE_ROOT", path.join(directory, "evidence"));
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("TEACHER_ACCESS_CODE", "teacher-code");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

  it("paginates more than 50 student records across historical projects with a stable cursor", async () => {
    const first = await GET(request("?limit=20", student));
    expect(first.status).toBe(200);
    const page1 = await first.json();
    expect(page1.items).toHaveLength(20);
    expect(page1.items[0].id).toBe(uuid(55));
    expect(new Set(page1.items.map((item: { projectId: string }) => item.projectId))).toContain("p-new");
    const second = await GET(request(`?limit=20&cursor=${encodeURIComponent(page1.nextCursor)}`, student));
    const page2 = await second.json();
    const third = await GET(request(`?limit=20&cursor=${encodeURIComponent(page2.nextCursor)}`, student));
    const page3 = await third.json();
    const ids = [...page1.items, ...page2.items, ...page3.items].map((item: { id: string }) => item.id);
    expect(ids).toHaveLength(55);
    expect(new Set(ids).size).toBe(55);
    expect(page3.nextCursor).toBeNull();
    expect(ids).toContain(uuid(1));
  });

  it("lets the persistent global owner page all classes while a class teacher stays scoped", async () => {
    const ownerFirst = await (await GET(request("?limit=50", ownerTeacher))).json();
    const ownerSecond = await (await GET(request(`?limit=50&cursor=${encodeURIComponent(ownerFirst.nextCursor)}`, ownerTeacher))).json();
    expect(ownerFirst.items.length + ownerSecond.items.length).toBe(80);
    const scoped = await (await GET(request("?limit=50", classTeacher))).json();
    const scopedNext = await (await GET(request(`?limit=50&cursor=${encodeURIComponent(scoped.nextCursor)}`, classTeacher))).json();
    expect(scoped.items.length + scopedNext.items.length).toBe(55);
    expect([...scoped.items, ...scopedNext.items].every((item: { classId: string }) => item.classId === "c1")).toBe(true);
  });

  it("does not leak cross-account filters and validates cursor and limit", async () => {
    expect((await GET(request("?studentId=s2", student))).status).toBe(400);
    const crossClass = await GET(request("?studentId=s2", classTeacher));
    expect(crossClass.status).toBe(200);
    await expect(crossClass.json()).resolves.toMatchObject({ items: [], nextCursor: null });
    expect((await GET(request("?limit=51", student))).status).toBe(400);
    expect((await GET(request("?cursor=not-a-cursor", student))).status).toBe(400);
    expect((await GET(request("?limit=20", otherStudent))).status).toBe(200);
  });

  it("does not grant cross-class list access when the fixed teacher id has a class", async () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.transaction(() => {
        connection.sqlite.prepare("DELETE FROM teacher_access_scopes WHERE teacher_id='teacher'").run();
        connection.sqlite.prepare("UPDATE users SET class_id='c1' WHERE id='teacher'").run();
      }).immediate();
    }
    finally { connection.sqlite.close(); }
    const first = await (await GET(request("?limit=50", ownerTeacher))).json();
    const second = await (await GET(request(`?limit=50&cursor=${encodeURIComponent(first.nextCursor)}`, ownerTeacher))).json();
    const items = [...first.items, ...second.items];
    expect(items).toHaveLength(55);
    expect(items.every((item: { classId: string }) => item.classId === "c1")).toBe(true);
    await expect((await GET(request("?studentId=s2", ownerTeacher))).json())
      .resolves.toMatchObject({ items: [], nextCursor: null });
  });
});

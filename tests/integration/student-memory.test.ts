// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as deleteOwnedMemoryRoute } from "@/app/api/agent/memories/[memoryId]/route";
import { POST as disputeOwnedMemoryRoute } from "@/app/api/agent/memories/[memoryId]/dispute/route";
import { GET as listOwnedMemoriesRoute } from "@/app/api/agent/memories/route";
import { DELETE as deleteMemoryRoute } from "@/app/api/teacher/learners/[studentId]/memories/[memoryId]/route";
import { GET as listMemoriesRoute } from "@/app/api/teacher/learners/[studentId]/memories/route";
import { GET as learnerGet } from "@/app/api/teacher/learners/[studentId]/route";
import {
  applyStudentMemoryWriteback,
  deleteOwnedStudentMemory,
  deleteStudentMemoryForTeacher,
  disputeOwnedStudentMemory,
  listStudentMemories,
  readOwnedStudentMemoryCollection,
  storeStudentMemory,
  StudentMemoryStudentActionForbiddenError,
  StudentMemorySourceTurnNotFoundError,
} from "@/lib/agent/student-memory";
import { TeacherClassAccessNotFoundError } from "@/lib/auth/teacher-access";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const SECRET = "student-memory-route-secret-at-least-32-characters";
const MEMORY_ID = "11111111-1111-4111-8111-111111111111";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

describe("long-term student memory storage and teacher control", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-student-memory-"));
    databasePath = path.join(directory, "memory.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','一班','MEMORY1'),('c2','二班','MEMORY2');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('s1','c1','STUDENT','匿名一',1700000000),
          ('s2','c1','STUDENT','匿名二',1700000000),
          ('s3','c2','STUDENT','匿名三',1700000000),
          ('demo-student-memory','c1','STUDENT','演示学习者',1700000000),
          ('teacher',NULL,'TEACHER','课程负责人',1700000000),
          ('t1','c1','TEACHER','一班教师',1700000000),
          ('t2','c2','TEACHER','二班教师',1700000000);
        INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type) VALUES
          ('task-s1','s1','c1','任务一','ACTIVE',1700000000,1700000000,'REAL'),
          ('task-s2','s2','c1','任务二','ACTIVE',1700000000,1700000000,'REAL');
        INSERT INTO agent_conversations(id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at) VALUES
          ('conversation-s1','task-s1','s1','c1',NULL,'digital-interaction','1',1700000000,1700000000),
          ('conversation-s2','task-s2','s2','c1',NULL,'digital-interaction','1',1700000000,1700000000);
        INSERT INTO agent_turns(id,conversation_id,turn_sequence,student_message,episode,decision_code,policy_trace_json,reply_json,ai_mode,source_ids_json,created_at,data_type) VALUES
          ('turn-s1','conversation-s1',1,'原始问题一','EXPLORE','OPEN_TUTOR','{}','{}','MODEL_ASSISTED','[]',1700000000,'REAL'),
          ('turn-s2','conversation-s2',1,'原始问题二','EXPLORE','OPEN_TUTOR','{}','{}','MODEL_ASSISTED','[]',1700000000,'REAL');
      `);
    } finally {
      connection.sqlite.close();
    }
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("AUTH_PROXY_SECRET", "student-memory-proxy-secret-at-least-32-chars");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates a constrained independent memory table with ownership guards", () => {
    const connection = createDb(databasePath);
    try {
      expect(connection.sqlite.prepare("SELECT count(*) count FROM __drizzle_migrations").get()).toEqual({ count: 48 });
      expect(connection.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_student_memory'").get()).toEqual({ name: "agent_student_memory" });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM sqlite_master WHERE type='trigger' AND name LIKE 'agent_student_memory_owner_source_%_guard'").get()).toEqual({ count: 2 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM sqlite_master WHERE type='trigger' AND name LIKE 'agent_student_memory_embedding_%_guard'").get()).toEqual({ count: 2 });
      expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);

      const insert = (overrides: Partial<{ id: string; studentId: string; kind: string; content: string; salience: number; sourceTurnId: string | null; createdAt: number; lastUsedAt: number | null }> = {}) => connection.sqlite.prepare(`
        INSERT INTO agent_student_memory(id,student_id,class_id,kind,content,salience,source_turn_id,created_at,last_used_at)
        VALUES(?,?,'c1',?,?,?,?,?,?)
      `).run(
        overrides.id ?? MEMORY_ID,
        overrides.studentId ?? "s1",
        overrides.kind ?? "LEARNED_CONCEPT",
        overrides.content ?? "理解了输入映射输出",
        overrides.salience ?? 1,
        overrides.sourceTurnId === undefined ? null : overrides.sourceTurnId,
        overrides.createdAt ?? 1700000000,
        overrides.lastUsedAt === undefined ? null : overrides.lastUsedAt,
      );

      expect(() => insert({ kind: "UNKNOWN" })).toThrow();
      expect(() => insert({ content: "   " })).toThrow();
      expect(() => insert({ salience: 0 })).toThrow();
      expect(() => insert({ createdAt: 1700000000, lastUsedAt: 1699999999 })).toThrow();
      expect(() => insert({ studentId: "t1" })).toThrow(/invalid agent student memory owner/i);
      expect(() => insert({ sourceTurnId: "turn-s2" })).toThrow(/invalid agent student memory owner/i);
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_student_memory").get()).toEqual({ count: 0 });
      insert();
      expect(() => connection.sqlite.prepare(
        "UPDATE agent_student_memory SET embedding_json='[1,0]' WHERE id=?",
      ).run(MEMORY_ID)).toThrow(/invalid agent student memory embedding/i);
      expect(() => connection.sqlite.prepare(
        "UPDATE agent_student_memory SET embedding_json='[1,0]',embedding_cache_key='fixture' WHERE id=?",
      ).run(MEMORY_ID)).not.toThrow();
    } finally {
      connection.sqlite.close();
    }
  });

  it("redacts before insert, validates source ownership and preserves demo provenance", () => {
    const connection = createDb(databasePath);
    try {
      const saved = storeStudentMemory(connection.db, {
        studentId: "s1",
        classId: "c1",
        kind: "RECURRING_STRUGGLE",
        content: "联系 13812345678 或 Alice.Test@example.com，学号 SC2026123456；总在 OSC 端口卡住。",
        salience: 7,
        sourceTurnId: "turn-s1",
      }, { environment: { STUDENT_NUMBER_PREFIX: "SC", STUDENT_NUMBER_DIGITS: "10" }, now: new Date("2026-07-17T08:00:00.000Z") });
      expect(saved).toMatchObject({ studentId: "s1", classId: "c1", salience: 7, sourceTurnId: "turn-s1", dataType: "REAL" });
      expect(saved.content).toContain("[已遮蔽手机号]");
      expect(saved.content).toContain("[已遮蔽邮箱]");
      expect(saved.content).toContain("[已遮蔽学号]");
      expect(saved.content).not.toMatch(/13812345678|Alice\.Test|SC2026123456/i);

      expect(() => storeStudentMemory(connection.db, {
        studentId: "s1", classId: "c1", kind: "PROJECT_FACT", content: "错误来源", sourceTurnId: "turn-s2",
      }, { environment: {} })).toThrow(StudentMemorySourceTurnNotFoundError);

      const demo = storeStudentMemory(connection.db, {
        studentId: "demo-student-memory", classId: "c1", kind: "PREFERENCE", content: "喜欢先看版式案例",
      }, { environment: {} });
      expect(demo.dataType).toBe("DEMONSTRATION_DATA");
      expect(listStudentMemories(connection.db, "c1", "demo-student-memory")).toEqual([]);
      expect(listStudentMemories(connection.db, "c1", "demo-student-memory", { includeDemo: true })).toHaveLength(1);
    } finally {
      connection.sqlite.close();
    }
  });

  it("merges canonical duplicates, saturates salience and touches only recalled owned memories", () => {
    const connection = createDb(databasePath);
    try {
      applyStudentMemoryWriteback({
        connection,
        studentId: "s1",
        classId: "c1",
        sourceTurnId: "turn-s1",
        recalledMemoryIds: [],
        candidates: [{ kind: "RECURRING_STRUGGLE", content: "我总是卡在 OSC 端口配置。", salience: 9 }],
        now: new Date("2026-07-17T08:00:00.000Z"),
        environment: {},
      });
      const first = connection.sqlite.prepare(`
        SELECT id FROM agent_student_memory WHERE student_id='s1' AND kind='RECURRING_STRUGGLE'
      `).get() as { id: string };
      applyStudentMemoryWriteback({
        connection,
        studentId: "s1",
        classId: "c1",
        sourceTurnId: "turn-s1",
        recalledMemoryIds: [first.id, "not-owned"],
        candidates: [
          { kind: "RECURRING_STRUGGLE", content: "我总是卡在　OSC 端口配置。", salience: 1 },
          { kind: "PREFERENCE", content: "我总是卡在 OSC 端口配置。", salience: 2 },
        ],
        now: new Date("2026-07-17T09:00:00.000Z"),
        environment: {},
      });
      const rows = connection.sqlite.prepare(`
        SELECT kind,salience,last_used_at lastUsedAt FROM agent_student_memory
        WHERE student_id='s1' ORDER BY kind
      `).all() as Array<{ kind: string; salience: number; lastUsedAt: number | null }>;
      expect(rows).toEqual([
        { kind: "PREFERENCE", salience: 2, lastUsedAt: null },
        {
          kind: "RECURRING_STRUGGLE",
          salience: 10,
          lastUsedAt: Math.floor(new Date("2026-07-17T09:00:00.000Z").getTime() / 1_000),
        },
      ]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("merges a near-paraphrase of the same fact without collapsing a different fact", () => {
    const connection = createDb(databasePath);
    try {
      for (const content of [
        "我的项目正在做声音海报，主要使用 TouchDesigner。",
        "我这次的项目是声音海报，使用 TouchDesigner。",
        "我的项目正在做社区导览册，主要使用 InDesign。",
        "我的作品面向社区老人。",
        "我的作品面向社区儿童。",
        "我的作品面向社区老人和儿童。",
        "我的项目面向大学生。",
        "我的项目面向中学生。",
      ]) {
        applyStudentMemoryWriteback({
          connection,
          studentId: "s1",
          classId: "c1",
          sourceTurnId: "turn-s1",
          recalledMemoryIds: [],
          candidates: [{ kind: "PROJECT_FACT", content, salience: 2 }],
          now: new Date("2026-07-17T08:00:00.000Z"),
          environment: {},
        });
      }
      const rows = connection.sqlite.prepare(`
        SELECT content,salience FROM agent_student_memory
        WHERE student_id='s1' AND kind='PROJECT_FACT' ORDER BY content
      `).all() as Array<{ content: string; salience: number }>;
      expect(rows).toHaveLength(7);
      expect(rows).toContainEqual({
        content: "我的项目正在做声音海报，主要使用 TouchDesigner。",
        salience: 3,
      });
      expect(rows).toContainEqual(expect.objectContaining({
        content: "我的项目正在做社区导览册，主要使用 InDesign。",
      }));
      expect(rows.map(({ content }) => content)).toEqual(expect.arrayContaining([
        "我的作品面向社区老人。",
        "我的作品面向社区儿童。",
        "我的作品面向社区老人和儿童。",
        "我的项目面向大学生。",
        "我的项目面向中学生。",
      ]));
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not replace stored content vectors with a near-paraphrase vector", () => {
    const connection = createDb(databasePath);
    try {
      for (const candidate of [
        {
          kind: "PROJECT_FACT" as const,
          content: "我的项目正在做声音海报，主要使用 TouchDesigner。",
          salience: 2,
          embedding: { cacheKey: "fixture", vector: [1, 0] },
        },
        {
          kind: "PROJECT_FACT" as const,
          content: "我这次的项目是声音海报，使用 TouchDesigner。",
          salience: 2,
          embedding: { cacheKey: "fixture", vector: [0, 1] },
        },
      ]) {
        applyStudentMemoryWriteback({
          connection,
          studentId: "s1",
          classId: "c1",
          sourceTurnId: "turn-s1",
          recalledMemoryIds: [],
          candidates: [candidate],
          now: new Date("2026-07-17T08:00:00.000Z"),
          environment: {},
        });
      }
      expect(connection.sqlite.prepare(`
        SELECT content,embedding_json embeddingJson,salience FROM agent_student_memory
        WHERE student_id='s1' AND kind='PROJECT_FACT'
      `).get()).toEqual({
        content: "我的项目正在做声音海报，主要使用 TouchDesigner。",
        embeddingJson: "[1,0]",
        salience: 3,
      });
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not merge a changed preference polarity or quantity", () => {
    const connection = createDb(databasePath);
    try {
      for (const candidate of [
        { kind: "PREFERENCE" as const, content: "我更喜欢红色。", salience: 2 },
        { kind: "PREFERENCE" as const, content: "我不喜欢红色。", salience: 2 },
        { kind: "PROJECT_FACT" as const, content: "我的项目包含 3 个页面。", salience: 2 },
        { kind: "PROJECT_FACT" as const, content: "我的项目包含 4 个页面。", salience: 2 },
      ]) {
        applyStudentMemoryWriteback({
          connection,
          studentId: "s1",
          classId: "c1",
          sourceTurnId: "turn-s1",
          recalledMemoryIds: [],
          candidates: [candidate],
          now: new Date("2026-07-17T08:00:00.000Z"),
          environment: {},
        });
      }
      expect(connection.sqlite.prepare(`
        SELECT kind,content FROM agent_student_memory WHERE student_id='s1' ORDER BY kind,content
      `).all()).toEqual(expect.arrayContaining([
        { kind: "PREFERENCE", content: "我更喜欢红色。" },
        { kind: "PREFERENCE", content: "我不喜欢红色。" },
        { kind: "PROJECT_FACT", content: "我的项目包含 3 个页面。" },
        { kind: "PROJECT_FACT", content: "我的项目包含 4 个页面。" },
      ]));
      expect(connection.sqlite.prepare(
        "SELECT count(*) count FROM agent_student_memory WHERE student_id='s1'",
      ).get()).toEqual({ count: 4 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("survives project-task cleanup, clears only its source pointer and follows student deletion", () => {
    const connection = createDb(databasePath);
    try {
      const saved = storeStudentMemory(connection.db, {
        studentId: "s1", classId: "c1", kind: "LEARNED_CONCEPT", content: "已理解归一化", sourceTurnId: "turn-s1",
      }, { environment: {} });
      connection.sqlite.prepare("DELETE FROM design_project_tasks WHERE id='task-s1'").run();
      expect(connection.sqlite.prepare("SELECT source_turn_id sourceTurnId FROM agent_student_memory WHERE id=?").get(saved.id)).toEqual({ sourceTurnId: null });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_student_memory WHERE id=?").get(saved.id)).toEqual({ count: 1 });
      connection.sqlite.prepare("DELETE FROM users WHERE id='s1'").run();
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_student_memory WHERE id=?").get(saved.id)).toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("lets only an authorized teacher delete an exactly scoped memory and audits no content", () => {
    const connection = createDb(databasePath);
    try {
      const saved = storeStudentMemory(connection.db, {
        studentId: "s1", classId: "c1", kind: "MISCONCEPTION_CORRECTED", content: "私密正文不应进入审计",
      }, { environment: {} });
      expect(() => deleteStudentMemoryForTeacher(connection.db, { userId: "t2", role: "TEACHER" }, {
        classId: "c1", studentId: "s1", memoryId: saved.id,
      })).toThrow(TeacherClassAccessNotFoundError);
      expect(deleteStudentMemoryForTeacher(connection.db, { userId: "teacher", role: "TEACHER" }, {
        classId: "c1", studentId: "s2", memoryId: saved.id,
      })).toBe(false);
      expect(deleteStudentMemoryForTeacher(connection.db, { userId: "teacher", role: "TEACHER" }, {
        classId: "c1", studentId: "s1", memoryId: saved.id,
      })).toBe(true);
      expect(deleteStudentMemoryForTeacher(connection.db, { userId: "teacher", role: "TEACHER" }, {
        classId: "c1", studentId: "s1", memoryId: saved.id,
      })).toBe(false);
      const audit = connection.sqlite.prepare("SELECT type,payload_json payloadJson FROM audit_events WHERE type='STUDENT_MEMORY_DELETED'").get() as { type: string; payloadJson: string };
      expect(audit.type).toBe("STUDENT_MEMORY_DELETED");
      expect(audit.payloadJson).toContain(saved.id);
      expect(audit.payloadJson).not.toContain("私密正文");
    } finally {
      connection.sqlite.close();
    }
  });

  it("paginates beyond one hundred memories without hiding later deletion targets", async () => {
    const connection = createDb(databasePath);
    try {
      const insert = connection.sqlite.prepare(`
        INSERT INTO agent_student_memory(id,student_id,class_id,kind,content,salience,created_at)
        VALUES(?,'s1','c1','LEARNED_CONCEPT',?,1,?)
      `);
      connection.sqlite.transaction(() => {
        for (let index = 0; index < 101; index += 1) {
          insert.run(`00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`, `概念 ${index}`, 1700000000 + index);
        }
      })();
    } finally {
      connection.sqlite.close();
    }
    const teacher = await issueSession({ userId: "t1", role: "TEACHER" }, SECRET);
    const first = await listMemoriesRoute(
      new NextRequest("http://localhost/api/teacher/learners/s1/memories?classId=c1&limit=100&offset=0", { headers: { cookie: cookie(teacher) } }),
      { params: Promise.resolve({ studentId: "s1" }) },
    );
    expect(first.status).toBe(200);
    const firstPage = await first.json();
    expect(firstPage.meta).toEqual({ total: 101, returned: 100, truncated: true });
    const second = await listMemoriesRoute(
      new NextRequest("http://localhost/api/teacher/learners/s1/memories?classId=c1&limit=100&offset=100", { headers: { cookie: cookie(teacher) } }),
      { params: Promise.resolve({ studentId: "s1" }) },
    );
    expect(second.status).toBe(200);
    const secondPage = await second.json();
    expect(secondPage.meta).toEqual({ total: 101, returned: 1, truncated: false });
    expect(firstPage.items.some((memory: { id: string }) => memory.id === secondPage.items[0].id)).toBe(false);
    expect(second.headers.get("cache-control")).toBe("private, no-store");
  });

  it("shows scoped memories in learner detail and enforces teacher DELETE boundaries", async () => {
    const connection = createDb(databasePath);
    let savedId: string;
    let demoId: string;
    try {
      savedId = storeStudentMemory(connection.db, {
        studentId: "s1", classId: "c1", kind: "PROJECT_FACT", content: "当前项目使用三栏网格",
      }, { environment: {} }).id;
      demoId = storeStudentMemory(connection.db, {
        studentId: "demo-student-memory", classId: "c1", kind: "PREFERENCE", content: "演示偏好",
      }, { environment: {} }).id;
      connection.sqlite.prepare("DELETE FROM design_project_tasks").run();
    } finally {
      connection.sqlite.close();
    }

    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const student = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    const classTeacher = await issueSession({ userId: "t1", role: "TEACHER" }, SECRET);
    const otherTeacher = await issueSession({ userId: "t2", role: "TEACHER" }, SECRET);
    const teacherHeaders = { cookie: cookie(teacher) };
    const detail = await learnerGet(
      new NextRequest("http://localhost/api/teacher/learners/s1?classId=c1", { headers: teacherHeaders }),
      { params: Promise.resolve({ studentId: "s1" }) },
    );
    expect(detail.status).toBe(200);
    expect((await detail.json()).memories).toMatchObject({
      items: [{ id: savedId, content: "当前项目使用三栏网格", dataType: "REAL" }],
      meta: { total: 1, returned: 1, truncated: false },
    });
    const hiddenDemo = await learnerGet(
      new NextRequest("http://localhost/api/teacher/learners/demo-student-memory?classId=c1", { headers: teacherHeaders }),
      { params: Promise.resolve({ studentId: "demo-student-memory" }) },
    );
    expect(hiddenDemo.status).toBe(404);
    const visibleDemo = await learnerGet(
      new NextRequest("http://localhost/api/teacher/learners/demo-student-memory?classId=c1&includeDemo=true", { headers: teacherHeaders }),
      { params: Promise.resolve({ studentId: "demo-student-memory" }) },
    );
    expect(visibleDemo.status).toBe(200);
    expect((await visibleDemo.json()).memories.items[0].dataType).toBe("DEMONSTRATION_DATA");

    const demoDelete = await deleteMemoryRoute(
      new NextRequest(`http://localhost/api/teacher/learners/demo-student-memory/memories/${demoId}?classId=c1`, { method: "DELETE", headers: { cookie: cookie(classTeacher) } }),
      { params: Promise.resolve({ studentId: "demo-student-memory", memoryId: demoId }) },
    );
    expect(demoDelete.status).toBe(204);
    const afterDemoDelete = createDb(databasePath);
    try {
      const payload = afterDemoDelete.sqlite.prepare("SELECT payload_json payloadJson FROM audit_events WHERE type='STUDENT_MEMORY_DELETED' ORDER BY created_at DESC LIMIT 1").get() as { payloadJson: string };
      expect(JSON.parse(payload.payloadJson)).toMatchObject({ memoryId: demoId, targetDataType: "DEMONSTRATION_DATA" });
    } finally { afterDemoDelete.sqlite.close(); }

    const context = { params: Promise.resolve({ studentId: "s1", memoryId: savedId }) };
    expect((await deleteMemoryRoute(new NextRequest(`http://localhost/api/teacher/learners/s1/memories/${savedId}?classId=c1`, { method: "DELETE" }), context)).status).toBe(401);
    expect((await deleteMemoryRoute(new NextRequest(`http://localhost/api/teacher/learners/s1/memories/${savedId}?classId=c1`, { method: "DELETE", headers: { cookie: cookie(student) } }), context)).status).toBe(403);
    expect((await deleteMemoryRoute(new NextRequest(`http://localhost/api/teacher/learners/s1/memories/${savedId}?classId=c1`, { method: "DELETE", headers: { cookie: cookie(otherTeacher) } }), context)).status).toBe(404);
    expect((await deleteMemoryRoute(new NextRequest(`http://localhost/api/teacher/learners/s1/memories/${savedId}?classId=c1`, { method: "DELETE", headers: { ...teacherHeaders, origin: "https://evil.example" } }), context)).status).toBe(403);

    const forgedContext = { params: Promise.resolve({ studentId: "s2", memoryId: savedId }) };
    expect((await deleteMemoryRoute(new NextRequest(`http://localhost/api/teacher/learners/s2/memories/${savedId}?classId=c1`, { method: "DELETE", headers: teacherHeaders }), forgedContext)).status).toBe(204);
    const afterForgery = createDb(databasePath);
    try { expect(afterForgery.sqlite.prepare("SELECT count(*) count FROM agent_student_memory WHERE id=?").get(savedId)).toEqual({ count: 1 }); }
    finally { afterForgery.sqlite.close(); }
    const deleted = await deleteMemoryRoute(new NextRequest(`http://localhost/api/teacher/learners/s1/memories/${savedId}?classId=c1`, { method: "DELETE", headers: { cookie: cookie(classTeacher) } }), context);
    expect(deleted.status).toBe(204);
    expect(deleted.headers.get("cache-control")).toBe("private, no-store");
    expect(deleted.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await deleteMemoryRoute(new NextRequest(`http://localhost/api/teacher/learners/s1/memories/${savedId}?classId=c1`, { method: "DELETE", headers: { cookie: cookie(classTeacher) } }), context)).status).toBe(204);
  });

  it("enforces two-tier student controls and keeps disputed Tier 2 text visible to the teacher", async () => {
    const connection = createDb(databasePath);
    const memoryCreatedAt = new Date("2026-07-28T00:00:00.000Z");
    let tierOneId: string;
    let tierTwoId: string;
    let otherStudentId: string;
    try {
      tierOneId = storeStudentMemory(connection.db, {
        studentId: "s1",
        classId: "c1",
        kind: "PREFERENCE",
        content: "我喜欢先看版式案例",
      }, { environment: {}, now: memoryCreatedAt }).id;
      tierTwoId = storeStudentMemory(connection.db, {
        studentId: "s1",
        classId: "c1",
        kind: "RECURRING_STRUGGLE",
        content: "我总在网格层级这一步卡住",
      }, { environment: {}, now: memoryCreatedAt }).id;
      otherStudentId = storeStudentMemory(connection.db, {
        studentId: "s2",
        classId: "c1",
        kind: "PROJECT_FACT",
        content: "另一个学生的项目事实",
      }, { environment: {}, now: memoryCreatedAt }).id;

      expect(readOwnedStudentMemoryCollection(
        connection.db,
        { userId: "s1", role: "STUDENT" },
      ).items.map(({ id }) => id)).toEqual(expect.arrayContaining([tierOneId, tierTwoId]));
      expect(readOwnedStudentMemoryCollection(
        connection.db,
        { userId: "s1", role: "STUDENT" },
      ).items.map(({ id }) => id)).not.toContain(otherStudentId);

      expect(() => deleteOwnedStudentMemory(
        connection.db,
        { userId: "s1", role: "STUDENT" },
        { memoryId: tierTwoId, kind: "RECURRING_STRUGGLE" },
      )).toThrowError(expect.objectContaining({
        code: "STUDENT_MEMORY_TIER_2_DELETE_FORBIDDEN",
      }));
      expect(deleteOwnedStudentMemory(
        connection.db,
        { userId: "s2", role: "STUDENT" },
        { memoryId: tierOneId, kind: "PREFERENCE" },
      )).toBe(false);
      expect(() => disputeOwnedStudentMemory(
        connection.db,
        { userId: "s1", role: "STUDENT" },
        { memoryId: tierOneId, kind: "PREFERENCE", note: "不应走异议" },
      )).toThrow(StudentMemoryStudentActionForbiddenError);
      expect(disputeOwnedStudentMemory(
        connection.db,
        { userId: "s2", role: "STUDENT" },
        { memoryId: tierTwoId, kind: "RECURRING_STRUGGLE", note: "越权异议" },
      )).toBeNull();

      const disputed = disputeOwnedStudentMemory(
        connection.db,
        { userId: "s1", role: "STUDENT" },
        {
          memoryId: tierTwoId,
          kind: "RECURRING_STRUGGLE",
          note: "这已经不是我现在的情况",
        },
        { now: new Date("2026-07-28T01:00:00.000Z"), environment: {} },
      );
      expect(disputed).toMatchObject({
        id: tierTwoId,
        content: "我总在网格层级这一步卡住",
        studentDisputed: true,
        studentDisputeNote: "这已经不是我现在的情况",
        studentDisputedAt: "2026-07-28T01:00:00.000Z",
      });
      const stored = connection.sqlite.prepare(`
        SELECT content,student_disputed studentDisputed,student_dispute_note studentDisputeNote
        FROM agent_student_memory WHERE id=?
      `).get(tierTwoId);
      expect(stored).toEqual({
        content: "我总在网格层级这一步卡住",
        studentDisputed: 1,
        studentDisputeNote: "这已经不是我现在的情况",
      });
      const disputeAudit = connection.sqlite.prepare(`
        SELECT payload_json payloadJson FROM audit_events
        WHERE type='STUDENT_MEMORY_DISPUTED' ORDER BY created_at DESC LIMIT 1
      `).get() as { payloadJson: string };
      expect(disputeAudit.payloadJson).not.toContain("这已经不是我现在的情况");
      expect(disputeAudit.payloadJson).not.toContain("我总在网格层级这一步卡住");
    } finally {
      connection.sqlite.close();
    }

    const s1 = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    const s2 = await issueSession({ userId: "s2", role: "STUDENT" }, SECRET);
    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const requestHeaders = (token: string) => ({
      cookie: cookie(token),
      "content-type": "application/json",
    });

    const s1List = await listOwnedMemoriesRoute(new NextRequest(
      "http://localhost/api/agent/memories",
      { headers: { cookie: cookie(s1) } },
    ));
    expect(s1List.status).toBe(200);
    expect((await s1List.json()).items.map((memory: { id: string }) => memory.id))
      .toEqual(expect.arrayContaining([tierOneId, tierTwoId]));
    const s1ReadsS2 = await listOwnedMemoriesRoute(new NextRequest(
      "http://localhost/api/agent/memories?studentId=s2",
      { headers: { cookie: cookie(s1) } },
    ));
    const s2ReadsS1 = await listOwnedMemoriesRoute(new NextRequest(
      "http://localhost/api/agent/memories?studentId=s1",
      { headers: { cookie: cookie(s2) } },
    ));
    expect(s1ReadsS2.status).toBe(403);
    expect(s2ReadsS1.status).toBe(403);

    const deleteContext = (memoryId: string) => ({ params: Promise.resolve({ memoryId }) });
    const s1DeletesTierTwo = await deleteOwnedMemoryRoute(new NextRequest(
      `http://localhost/api/agent/memories/${tierTwoId}`,
      {
        method: "DELETE",
        headers: requestHeaders(s1),
        body: JSON.stringify({ kind: "RECURRING_STRUGGLE" }),
      },
    ), deleteContext(tierTwoId));
    expect(s1DeletesTierTwo.status).toBe(403);
    expect(await s1DeletesTierTwo.json()).toMatchObject({
      code: "STUDENT_MEMORY_TIER_2_DELETE_FORBIDDEN",
    });
    const s2DeletesS1 = await deleteOwnedMemoryRoute(new NextRequest(
      `http://localhost/api/agent/memories/${tierOneId}`,
      {
        method: "DELETE",
        headers: requestHeaders(s2),
        body: JSON.stringify({ kind: "PREFERENCE" }),
      },
    ), deleteContext(tierOneId));
    expect(s2DeletesS1.status).toBe(404);
    const s2DisputesS1 = await disputeOwnedMemoryRoute(new NextRequest(
      `http://localhost/api/agent/memories/${tierTwoId}/dispute`,
      {
        method: "POST",
        headers: requestHeaders(s2),
        body: JSON.stringify({ kind: "RECURRING_STRUGGLE", note: "越权" }),
      },
    ), deleteContext(tierTwoId));
    expect(s2DisputesS1.status).toBe(404);
    const s1DisputesTierOne = await disputeOwnedMemoryRoute(new NextRequest(
      `http://localhost/api/agent/memories/${tierOneId}/dispute`,
      {
        method: "POST",
        headers: requestHeaders(s1),
        body: JSON.stringify({ kind: "PREFERENCE", note: "不应接受" }),
      },
    ), deleteContext(tierOneId));
    expect(s1DisputesTierOne.status).toBe(403);
    const s1DisputesTierTwo = await disputeOwnedMemoryRoute(new NextRequest(
      `http://localhost/api/agent/memories/${tierTwoId}/dispute`,
      {
        method: "POST",
        headers: requestHeaders(s1),
        body: JSON.stringify({
          kind: "RECURRING_STRUGGLE",
          note: "我已经能独立处理这一步，请结合近期表现判断",
        }),
      },
    ), deleteContext(tierTwoId));
    expect(s1DisputesTierTwo.status).toBe(200);
    expect(await s1DisputesTierTwo.json()).toMatchObject({
      memory: {
        id: tierTwoId,
        content: "我总在网格层级这一步卡住",
        studentDisputed: true,
        studentDisputeNote: "我已经能独立处理这一步，请结合近期表现判断",
      },
    });

    const cleanup = createDb(databasePath);
    try {
      cleanup.sqlite.prepare("DELETE FROM design_project_tasks").run();
    } finally {
      cleanup.sqlite.close();
    }

    const detail = await learnerGet(
      new NextRequest("http://localhost/api/teacher/learners/s1?classId=c1", {
        headers: { cookie: cookie(teacher) },
      }),
      { params: Promise.resolve({ studentId: "s1" }) },
    );
    expect(detail.status).toBe(200);
    const teacherMemory = (await detail.json()).memories.items.find(
      (memory: { id: string }) => memory.id === tierTwoId,
    );
    expect(teacherMemory).toMatchObject({
      content: "我总在网格层级这一步卡住",
      studentDisputed: true,
      studentDisputeNote: "我已经能独立处理这一步，请结合近期表现判断",
    });

    const s1DeletesTierOne = await deleteOwnedMemoryRoute(new NextRequest(
      `http://localhost/api/agent/memories/${tierOneId}`,
      {
        method: "DELETE",
        headers: requestHeaders(s1),
        body: JSON.stringify({ kind: "PREFERENCE" }),
      },
    ), deleteContext(tierOneId));
    expect(s1DeletesTierOne.status).toBe(204);
    const after = createDb(databasePath);
    try {
      expect(after.sqlite.prepare("SELECT count(*) count FROM agent_student_memory WHERE id=?").get(tierOneId))
        .toEqual({ count: 0 });
      expect(after.sqlite.prepare("SELECT count(*) count FROM agent_student_memory WHERE id=?").get(tierTwoId))
        .toEqual({ count: 1 });
    } finally {
      after.sqlite.close();
    }
  });
});

// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/student/dashboard/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { readStudentDashboard } from "@/lib/services/student-dashboard";

const SECRET = "student-dashboard-test-secret-at-least-32-characters";

describe("student dashboard", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-dashboard-"));
    databasePath = path.join(directory, "dashboard.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    const now = Math.floor(Date.now() / 1_000);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','数字交互一班','C1');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1','c1','STUDENT','匿名编号 01',${now});
        INSERT INTO learner_profiles(user_id,level,decomposition,signal_understanding,mapping_design,troubleshooting,transfer,updated_at)
          VALUES('s1','L2',2,3,2,2,1,${now});
        INSERT INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES
          ('m1','c1',1,'感知与诊断',8,'观察信号'),('m2','c1',2,'交互逻辑',16,'六元逻辑'),
          ('m3','c1',3,'工具与制作',24,'原型制作'),('m4','c1',4,'迁移与表达',16,'迁移反思');
        INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at)
          VALUES('a1','c1','m2','社区灯影','制作社区文化互动原型','["DIGISHOW","TOUCHDESIGNER"]',${now});
        INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at)
          VALUES('p1','c1','a1','s1','LOGIC_CARD',${now},${now});
        INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
          VALUES('11111111-1111-4111-8111-111111111111','p1','c1','s1',1,'TEXT','INPUT',NULL,'SUBMITTED','READY','学生原始标签','不可公开的学生原文','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NULL,NULL,${now});
      `);
      connection.sqlite.prepare(`INSERT INTO hint_records(
        id,project_id,class_id,student_id,hint_sequence,evidence_sequence_watermark,context_hash,hint_level,response_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        "22222222-2222-4222-8222-222222222222", "p1", "c1", "s1", 1, 0, "b".repeat(64), 2,
        JSON.stringify({
          hintLevel: 2, groundingStatus: "GROUNDED", confirmedFacts: ["课程设计：输入层尚待测量"],
          hypotheses: ["输入值可能没有变化"], questions: ["靠近时输入值变化吗？"], guidance: ["先观察输入层"],
          nextSteps: ["记录靠近与远离两次数值"], localExample: null, sourceTitles: ["课程信号链检查表"],
          sources: [{ title: "课程信号链检查表", authority: "COURSE_DESIGN" }],
          evidenceToConsume: null, uncertainty: "仍需新测量确认。", fallback: false,
        }), now,
      );
    } finally { connection.sqlite.close(); }
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("returns one strict public snapshot without secret or student content fields", () => {
    const connection = createDb(databasePath);
    try {
      const result = readStudentDashboard(connection.db, { userId: "s1", role: "STUDENT" });
      expect(result.course.totalHours).toBe(64);
      expect(result.project?.stage).toBe("LOGIC_CARD");
      expect(result.evidence).toEqual({ total: 1, verified: 0, recent: [{
        id: "11111111-1111-4111-8111-111111111111", kind: "TEXT", layer: "INPUT",
        verification: "SUBMITTED", dataType: "REAL", timestamp: expect.any(String),
      }] });
      const keys = JSON.stringify(result).match(/"([A-Za-z]+)":/g)?.join(" ") ?? "";
      expect(keys).not.toMatch(/"(?:accessCode|codeDigest|content|contentDigest|probeJson|cardHash|originalName)"/);
      expect(JSON.stringify(result)).not.toContain("不可公开的学生原文");
      expect(result.latestHint).toMatchObject({ hintLevel: 2, nextSteps: ["记录靠近与远离两次数值"] });
      expect(JSON.stringify(result.latestHint)).not.toMatch(/evidenceToConsume|contentDigest|question.*请提示我/i);
      expect(readStudentDashboard(connection.db, { userId: "s1", role: "STUDENT" }).latestHint).toEqual(result.latestHint);
    } finally { connection.sqlite.close(); }
  });

  it("uses the optional onboarding nickname only in the student's own display", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.prepare(
        "UPDATE users SET nickname='小岚' WHERE id='s1'",
      ).run();
      const result = readStudentDashboard(
        connection.db,
        { userId: "s1", role: "STUDENT" },
      );
      expect(result.student.alias).toBe("小岚");
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps the complete persisted tool path in every later workflow stage", () => {
    const connection = createDb(databasePath);
    try {
      const now = Math.floor(Date.now() / 1_000);
      const requirements = { needsRealtimeVisuals: true, needsPhysicalControl: true, hasOsc: false };
      const reasons = ["同时需要物理控制与实时视觉", "开始联调前先配置 OSC"];
      const milestones = [
        { id: "m1", title: "配置 OSC", requiredEvidenceLabel: "OSC 地址与测试值截图" },
        { id: "m2", title: "完成物理控制", requiredEvidenceLabel: "输入信号截图" },
        { id: "m3", title: "完成视觉联调", requiredEvidenceLabel: "双工具联调视频" },
      ];
      connection.sqlite.prepare(`INSERT INTO tool_path_plans(
        project_id,path,requirements_json,reasons_json,milestones_json,created_at,updated_at
      ) VALUES('p1','COLLABORATIVE',?,?,?,?,?)`).run(
        JSON.stringify(requirements), JSON.stringify(reasons), JSON.stringify(milestones), now, now,
      );

      for (const stage of ["BUILD", "TROUBLESHOOT", "TRANSFER", "COMPLETE"] as const) {
        connection.sqlite.prepare("UPDATE projects SET stage=? WHERE id='p1'").run(stage);
        expect(readStudentDashboard(connection.db, { userId: "s1", role: "STUDENT" }).toolPath).toEqual({
          path: "COLLABORATIVE",
          requirements,
          reasons,
          milestones,
          updatedAt: new Date(now * 1_000).toISOString(),
          dataType: "REAL",
        });
      }
    } finally { connection.sqlite.close(); }
  });

  it("uses updated, created and id order for the shared current-project rule and index", () => {
    const connection = createDb(databasePath);
    try {
      const current = connection.sqlite.prepare("SELECT created_at,updated_at FROM projects WHERE id='p1'").get() as {
        created_at: number;
        updated_at: number;
      };
      connection.sqlite.prepare(`
        INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at)
        VALUES('z-older','c1','a1','s1','COMPLETE',?,?)
      `).run(current.created_at - 1, current.updated_at);

      expect(readStudentDashboard(connection.db, { userId: "s1", role: "STUDENT" }).project)
        .toMatchObject({ id: "p1", stage: "LOGIC_CARD" });
      const plan = connection.sqlite.prepare(`
        EXPLAIN QUERY PLAN
        SELECT id FROM projects
        WHERE class_id='c1' AND student_id='s1'
        ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1
      `).all() as Array<{ detail: string }>;
      expect(plan.some(({ detail }) => detail.includes("projects_class_student_current_idx"))).toBe(true);
    } finally { connection.sqlite.close(); }
  });

  it("publishes legal half-point profile dimensions and rejects arbitrary fractions", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`UPDATE learner_profiles SET
        decomposition=3.5, signal_understanding=3.5, mapping_design=3.5,
        troubleshooting=3.5, transfer=3.5 WHERE user_id='s1'`);
      expect(readStudentDashboard(connection.db, { userId: "s1", role: "STUDENT" }).profile)
        .toMatchObject({ decomposition: 3.5, signalUnderstanding: 3.5, transfer: 3.5 });

      expect(() => connection.sqlite.prepare(
        "UPDATE learner_profiles SET decomposition=3.25 WHERE user_id='s1'",
      ).run()).toThrow();
      expect(readStudentDashboard(connection.db, { userId: "s1", role: "STUDENT" }).profile?.decomposition)
        .toBe(3.5);
    } finally { connection.sqlite.close(); }
  });

  it("rejects a persisted JSON value with the wrong shape", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.prepare("UPDATE assignments SET allowed_tools = '{}' WHERE id = 'a1'").run();
      expect(() => readStudentDashboard(connection.db, { userId: "s1", role: "STUDENT" })).toThrow();
    } finally { connection.sqlite.close(); }
  });

  it("returns explicit empty assignment and project state", () => {
    const connection = createDb(databasePath);
    try {
      const now = Math.floor(Date.now() / 1_000);
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c2','尚未开课班级','C2');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s2','c2','STUDENT','匿名编号 02',${now});
      `);
      const result = readStudentDashboard(connection.db, { userId: "s2", role: "STUDENT" });
      expect(result.assignment).toBeNull();
      expect(result.project).toBeNull();
      expect(result.course).toEqual({ totalHours: 0, modules: [] });
    } finally { connection.sqlite.close(); }
  });

  it("counts 201 evidence rows but returns only the newest 50 public projections", () => {
    const connection = createDb(databasePath);
    try {
      const insert = connection.sqlite.prepare(`INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
        VALUES(?,'p1','c1','s1',?,'TEXT','INPUT',NULL,'SUBMITTED','READY','私密标签',?,?,NULL,NULL,?)`);
      const now = Math.floor(Date.now() / 1_000);
      connection.sqlite.transaction(() => {
        for (let sequence = 2; sequence <= 201; sequence += 1) {
          const tail = sequence.toString(16).padStart(12, "0");
          insert.run(`33333333-3333-4333-8333-${tail}`, sequence, `不可公开正文${sequence}`, sequence.toString(16).padStart(64, "0"), now + sequence);
        }
      })();
      const result = readStudentDashboard(connection.db, { userId: "s1", role: "STUDENT" });
      expect(result.evidence.total).toBe(201);
      expect(result.evidence.recent).toHaveLength(50);
      expect(result.evidence.recent[0]?.id).toBe("33333333-3333-4333-8333-0000000000c9");
      expect(JSON.stringify(result.evidence)).not.toContain("不可公开正文");
    } finally { connection.sqlite.close(); }
  });

  it("counts hint history but parses only the latest bounded record", () => {
    const connection = createDb(databasePath);
    try {
      const latestJson = connection.sqlite.prepare("SELECT response_json FROM hint_records WHERE hint_sequence=1").get() as { response_json: string };
      const insert = connection.sqlite.prepare(`INSERT INTO hint_records(id,project_id,class_id,student_id,hint_sequence,evidence_sequence_watermark,context_hash,hint_level,response_json,created_at)
        VALUES(?,'p1','c1','s1',?,0,?,2,?,?)`);
      const now = Math.floor(Date.now() / 1_000);
      connection.sqlite.transaction(() => {
        for (let sequence = 2; sequence <= 100; sequence += 1) {
          const tail = sequence.toString(16).padStart(12, "0");
          insert.run(`44444444-4444-4444-8444-${tail}`, sequence, sequence.toString(16).padStart(64, "0"), sequence === 100 ? latestJson.response_json : JSON.stringify({ broken: true }), now + sequence);
        }
      })();
      const result = readStudentDashboard(connection.db, { userId: "s1", role: "STUDENT" });
      expect(result.hints.count).toBe(100);
      expect(result.latestHint?.nextSteps).toEqual(["记录靠近与远离两次数值"]);
    } finally { connection.sqlite.close(); }
  });

  it("requires a student session and sets private no-store headers", async () => {
    const unauthenticated = await GET(new NextRequest("http://localhost/api/student/dashboard"));
    expect(unauthenticated.status).toBe(401);

    const teacher = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const denied = await GET(new NextRequest("http://localhost/api/student/dashboard", { headers: { cookie: `${SESSION_COOKIE_NAME}=${teacher}` } }));
    expect(denied.status).toBe(403);

    const student = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    const response = await GET(new NextRequest("http://localhost/api/student/dashboard", { headers: { cookie: `${SESSION_COOKIE_NAME}=${student}` } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
  });
});

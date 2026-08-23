// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { listTeacherClasses, readClassAnalytics, readLearnerDetail } from "@/lib/services/teacher-analytics";
import { saveBookLayoutEvidence } from "@/lib/services/book-layout";
import { appendTeacherDecision } from "@/lib/services/teacher-decisions";

describe("teacher analytics", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-teacher-analytics-"));
    databasePath = path.join(directory, "analytics.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    const now = Math.floor(Date.now() / 1_000);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','数字交互一班','SECRET-C1'),('c2','数字交互二班','SECRET-C2');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('teacher',NULL,'TEACHER','任课教师',${now}),('s1','c1','STUDENT','匿名-A01',${now}),('s2','c1','STUDENT','匿名-A02',${now}),('s3','c2','STUDENT','匿名-B01',${now});
        INSERT INTO teacher_access_scopes VALUES('teacher','GLOBAL',NULL,'TEST_SETUP','测试课程负责人',${now});
        INSERT INTO learner_profiles(user_id,level,decomposition,signal_understanding,mapping_design,troubleshooting,transfer,updated_at) VALUES
          ('s1','L2',2,3,2,1,2,${now}),('s2','L3',3,2,3,2,3,${now}),('s3','L1',1,1,1,1,1,${now});
        INSERT INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES
          ('m1','c1',1,'逻辑',16,'六元'),('m2','c2',1,'逻辑',16,'六元');
        INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at) VALUES
          ('a1','c1','m1','社区光影','简介','["DIGISHOW"]',${now}),('a2','c2','m2','跨班任务','简介','["DIGISHOW"]',${now});
        INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at) VALUES
          ('p1','c1','a1','s1','TROUBLESHOOT',${now},${now}),('p2','c1','a1','s2','TRANSFER',${now},${now}),('p3','c2','a2','s3','COMPLETE',${now},${now});
        INSERT INTO troubleshooting_runs(id,project_id,symptom,current_layer,state_json,status,revision,created_at,updated_at) VALUES
          ('r1','p1','私密学生症状','MAPPING','{"currentLayer":"MAPPING","status":"ESCALATED"}','ESCALATED',1,${now},${now});
        INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at) VALUES
          ('11111111-1111-4111-8111-111111111111','p1','c1','s1',1,'TEXT','INPUT',NULL,'SUBMITTED','READY','私密标签','不得出现的原文','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NULL,NULL,${now}),
          ('22222222-2222-4222-8222-222222222222','p2','c1','s2',1,'PROBE','OUTPUT','OUTPUT_OK','RULE_VERIFIED','READY','数值证据','{}','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','{"metric":"FPS","value":60,"unit":"fps","comparator":"GTE","threshold":30}',NULL,${now});
        INSERT INTO hint_records(id,project_id,class_id,student_id,hint_sequence,evidence_sequence_watermark,context_hash,hint_level,response_json,created_at) VALUES
          ('h1','p1','c1','s1',1,0,'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',3,'{}',${now}),
          ('h2','p1','c1','s1',2,0,'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',2,'{}',${now}),
          ('h3','p2','c1','s2',1,0,'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',1,'{}',${now});
      `);
    } finally { connection.sqlite.close(); }
  });

  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("returns deterministic class-scoped aggregate counts without raw student content", () => {
    const connection = createDb(databasePath);
    try {
      const now = Math.floor(Date.now() / 1_000);
      connection.sqlite.exec(`
        INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at) VALUES('p-old','c1','a1','s1','COMPLETE',${now - 100},${now - 100});
        INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
          VALUES('33333333-3333-4333-8333-333333333333','p1','c1','s1',2,'TEXT','INPUT',NULL,'REJECTED','READY','被驳回','不公开','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',NULL,NULL,${now});
      `);
      const result = readClassAnalytics(connection.db, "c1");
      expect(result.class).toEqual({ id: "c1", name: "数字交互一班", dataType: "REAL" });
      expect(result.stages).toEqual([
        { stage: "DIAGNOSTIC", count: 0 }, { stage: "LOGIC_CARD", count: 0 },
        { stage: "TOOL_PATH", count: 0 }, { stage: "BUILD", count: 0 },
        { stage: "TROUBLESHOOT", count: 1 }, { stage: "TRANSFER", count: 1 },
        { stage: "COMPLETE", count: 0 },
      ]);
      expect(result.supportNeeded).toBe(1);
      expect(result.hints).toEqual({ students: 2, total: 3, latestL3: 0, maxL3: 1 });
      expect(result.troubleshooting).toMatchObject({ escalated: 1, byLayer: [{ layer: "MAPPING", count: 1 }] });
      expect(result.evidence.byVerification).toEqual([
        { key: "REJECTED", count: 1 }, { key: "RULE_VERIFIED", count: 1 }, { key: "SUBMITTED", count: 1 },
      ]);
      expect(result.evidence.byAuthority).toEqual([{ key: "RULE", count: 1 }, { key: "STUDENT", count: 2 }]);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("不得出现的原文");
      expect(serialized).not.toContain("SECRET-C1");
      expect(serialized).not.toContain("私密学生症状");
      expect(readClassAnalytics(connection.db, "c2").students).toHaveLength(1);
      expect(readClassAnalytics(connection.db, "c2").students[0]?.alias).toBe("匿名-B01");
    } finally { connection.sqlite.close(); }
  });

  it("returns a bounded public learner snapshot and hides paths, digests and raw content", () => {
    const connection = createDb(databasePath);
    try {
      const detail = readLearnerDetail(connection.db, "c1", "s1", { decisionLimit: 20 });
      expect(detail.student).toEqual({ id: "s1", alias: "匿名-A01", dataType: "REAL" });
      expect(detail.project?.stage).toBe("TROUBLESHOOT");
      expect(detail.hints).toEqual({ latestLevel: 2, maxLevel: 3, count: 2 });
      expect(detail.evidence).toMatchObject({ total: 1, byVerification: [{ key: "SUBMITTED", count: 1 }] });
      const serialized = JSON.stringify(detail);
      expect(serialized).not.toMatch(/contentDigest|originalName|accessCode|codeDigest|probeJson/i);
      expect(serialized).not.toContain("不得出现的原文");
      expect(() => readLearnerDetail(connection.db, "c1", "s3")).toThrow(/NOT_FOUND/);
    } finally { connection.sqlite.close(); }
  });

  it("uses the shared created-at tie-breaker in class analytics and learner detail", () => {
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

      expect(readLearnerDetail(connection.db, "c1", "s1").project)
        .toMatchObject({ id: "p1", stage: "TROUBLESHOOT" });
      expect(readClassAnalytics(connection.db, "c1").stages)
        .toContainEqual({ stage: "TROUBLESHOOT", count: 1 });
      expect(readClassAnalytics(connection.db, "c1").stages)
        .toContainEqual({ stage: "COMPLETE", count: 0 });
    } finally { connection.sqlite.close(); }
  });

  it("preserves half-point dimensions in teacher detail and rejects invalid fractions", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`UPDATE learner_profiles SET
        decomposition=3.5, signal_understanding=3.5, mapping_design=3.5,
        troubleshooting=3.5, transfer=3.5 WHERE user_id='s1'`);
      expect(readLearnerDetail(connection.db, "c1", "s1").profile)
        .toMatchObject({ decomposition: 3.5, signalUnderstanding: 3.5, transfer: 3.5 });
      expect(readClassAnalytics(connection.db, "c1").profiles.dimensions
        .find(({ dimension }) => dimension === "decomposition")?.scores)
        .toContainEqual({ key: "3.5", count: 1 });

      expect(() => connection.sqlite.prepare(
        "UPDATE learner_profiles SET transfer=3.25 WHERE user_id='s1'",
      ).run()).toThrow();
      expect(readLearnerDetail(connection.db, "c1", "s1").profile?.transfer).toBe(3.5);
      expect(readClassAnalytics(connection.db, "c1").profiles.dimensions
        .find(({ dimension }) => dimension === "transfer")?.scores)
        .toContainEqual({ key: "3.5", count: 1 });
    } finally { connection.sqlite.close(); }
  });

  it("uses one SQL-ranked current project per student beyond two thousand history rows", () => {
    const connection = createDb(databasePath);
    try {
      const now = Math.floor(Date.now() / 1_000);
      connection.sqlite.exec(`
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s4','c1','STUDENT','匿名-A04',${now - 20000});
        INSERT INTO learner_profiles(user_id,level,decomposition,signal_understanding,mapping_design,troubleshooting,transfer,updated_at) VALUES('s4','L2',2,2,2,2,2,${now - 20000});
        INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at) VALUES('p4','c1','a1','s4','BUILD',${now - 20000},${now - 20000});
      `);
      const insert = connection.sqlite.prepare("INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at) VALUES(?,'c1','a1','s1','COMPLETE',?,?)");
      connection.sqlite.transaction(() => { for (let index = 0; index < 2001; index += 1) insert.run(`history-${index.toString().padStart(4, "0")}`, now + index, now + index); })();
      const result = readClassAnalytics(connection.db, "c1");
      expect(result.students.map((student) => student.id)).toContain("s4");
      expect(result.students.find((student) => student.id === "s4")?.stage).toBe("BUILD");
      expect(result.stages.reduce((sum, row) => sum + row.count, 0)).toBeLessThanOrEqual(result.students.length);
      expect(result.troubleshooting.escalated).toBe(0);
      expect(result.hints).toEqual({ students: 1, total: 1, latestL3: 0, maxL3: 0 });
      expect(result.evidence.byVerification).toEqual([{ key: "RULE_VERIFIED", count: 1 }]);
    } finally { connection.sqlite.close(); }
  });

  it("returns a stable empty-class snapshot", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec("INSERT INTO classes(id,name,access_code) VALUES('empty','空班','EMPTY')");
      const result = readClassAnalytics(connection.db, "empty");
      expect(result.students).toEqual([]);
      expect(result.stages.every((row) => row.count === 0)).toBe(true);
      expect(result.updatedAt).toBe("1970-01-01T00:00:00.000Z");
    } finally { connection.sqlite.close(); }
  });

  it("exposes complete book-layout evidence as a shared teacher review target with decision history", () => {
    const connection = createDb(databasePath);
    try {
      const submitted = saveBookLayoutEvidence(connection, { userId: "s1", role: "STUDENT" }, {
        audience: "COMMUNITY_RESIDENTS",
        pageOrder: ["cover", "quick-start", "activity-map", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
        diagnosticAnswers: ["AUDIENCE_FIRST", "TASK_FIRST", "AUDIENCE_FIRST"],
        transferChoices: ["COMMUNITY_ENTRY_FIRST", "VOLUNTEER_CALL_TO_ACTION", "RETAIN_ACTIVITY_CORE"],
      });
      const before = readLearnerDetail(connection.db, "c1", "s1");
      const target = before.reviewTargets.find((item) => item.snapshot.targetType === "BOOK_LAYOUT_EVIDENCE");
      expect(target).toMatchObject({
        targetId: submitted.id,
        snapshot: {
          targetType: "BOOK_LAYOUT_EVIDENCE", revision: 1, audience: "COMMUNITY_RESIDENTS",
          pageOrder: submitted.pageOrder, diagnosticAnswers: submitted.diagnosticAnswers,
          transferChoices: submitted.transferChoices, criteria: submitted.criteria,
          score: 4, passed: true,
        },
      });
      const decision = appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, {
        classId: "c1", studentId: "s1", projectId: null,
        targetType: "BOOK_LAYOUT_EVIDENCE", targetId: submitted.id, originalRevision: 1,
        decision: "CORRECTED", reasonCode: "BOOK_READER_PATH", notes: "需补充目标读者走查",
        idempotencyKey: "analytics-book-review",
      });
      const after = readLearnerDetail(connection.db, "c1", "s1");
      expect(after.decisions[0]?.id).toBe(decision.id);
      expect(after.latestDecisionByTarget[`BOOK_LAYOUT_EVIDENCE:${submitted.id}`]?.id).toBe(decision.id);
      expect(after.bookLayoutEvidence).toMatchObject({ id: submitted.id, audience: "COMMUNITY_RESIDENTS", score: 4, passed: true });
    } finally { connection.sqlite.close(); }
  });

  it("advances updatedAt when a teacher appends a decision on a current project", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec("UPDATE users SET created_at=1700000000 WHERE class_id='c1'; UPDATE learner_profiles SET updated_at=1700000000 WHERE user_id IN ('s1','s2'); UPDATE projects SET created_at=1700000000,updated_at=1700000000 WHERE class_id='c1'; UPDATE evidence SET created_at=1700000000 WHERE class_id='c1'; UPDATE hint_records SET created_at=1700000000 WHERE class_id='c1'; UPDATE troubleshooting_runs SET created_at=1700000000,updated_at=1700000000 WHERE project_id='p1';");
      connection.sqlite.prepare("INSERT INTO logic_cards(project_id,payload_json,rule_ready,semantic_ready,semantic_review_json,revision,card_hash) VALUES('p1','{}',0,0,?,1,?)").run(JSON.stringify({ status: "PENDING", ready: false, issues: [], source: "RULE" }), "a".repeat(64));
      const before = readClassAnalytics(connection.db, "c1").updatedAt;
      appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW", targetId: "p1", originalRevision: 1, decision: "CONFIRMED", reasonCode: "OK", notes: "", idempotencyKey: "updated-at-idem" });
      expect(new Date(readClassAnalytics(connection.db, "c1").updatedAt).getTime()).toBeGreaterThan(new Date(before).getTime());
    } finally { connection.sqlite.close(); }
  });

  it("advances updatedAt when a teacher reviews standalone book-layout evidence", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec("UPDATE users SET created_at=1700000000 WHERE class_id='c1'; UPDATE learner_profiles SET updated_at=1700000000 WHERE user_id IN ('s1','s2'); UPDATE projects SET created_at=1700000000,updated_at=1700000000 WHERE class_id='c1'; UPDATE evidence SET created_at=1700000000 WHERE class_id='c1'; UPDATE hint_records SET created_at=1700000000 WHERE class_id='c1'; UPDATE troubleshooting_runs SET created_at=1700000000,updated_at=1700000000 WHERE project_id='p1';");
      const submitted = saveBookLayoutEvidence(connection, { userId: "s1", role: "STUDENT" }, {
        audience: "COMMUNITY_RESIDENTS",
        pageOrder: ["cover", "quick-start", "activity-map", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
        diagnosticAnswers: ["AUDIENCE_FIRST", "TASK_FIRST", "AUDIENCE_FIRST"],
        transferChoices: ["COMMUNITY_ENTRY_FIRST", "VOLUNTEER_CALL_TO_ACTION", "RETAIN_ACTIVITY_CORE"],
      });
      connection.sqlite.exec("UPDATE audit_events SET created_at=1700000000 WHERE type='BOOK_LAYOUT_EVIDENCE_SUBMITTED'");
      const before = readClassAnalytics(connection.db, "c1").updatedAt;
      appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, {
        classId: "c1", studentId: "s1", projectId: null,
        targetType: "BOOK_LAYOUT_EVIDENCE", targetId: submitted.id, originalRevision: 1,
        decision: "CONFIRMED", reasonCode: "BOOK_OK", notes: "读者路径清楚",
        idempotencyKey: "book-updated-at-idem",
      });
      expect(new Date(readClassAnalytics(connection.db, "c1").updatedAt).getTime())
        .toBeGreaterThan(new Date(before).getTime());
    } finally { connection.sqlite.close(); }
  });

  it("reports learner list truncation while keeping explicit all-class aggregate scope", () => {
    const connection = createDb(databasePath);
    try {
      const insert = connection.sqlite.prepare("INSERT INTO users(id,class_id,role,alias,created_at) VALUES(?,'c1','STUDENT',?,1700000000)");
      connection.sqlite.transaction(() => { for (let index = 0; index < 1001; index += 1) insert.run(`bulk-${index}`, `匿名-批量-${index.toString().padStart(4, "0")}`); })();
      const result = readClassAnalytics(connection.db, "c1");
      expect(result.students).toHaveLength(1000);
      expect(result.studentsMeta).toEqual({ total: 1003, returned: 1000, truncated: true, aggregateScope: "ALL_CLASS_STUDENTS" });
    } finally { connection.sqlite.close(); }
  });

  it("reports exact class-list metadata at zero, one hundred and one hundred one", () => {
    const emptyPath = path.join(directory, "empty-classes.sqlite");
    runMigrations(emptyPath);
    const empty = createDb(emptyPath);
    try { expect(listTeacherClasses(empty.db)).toEqual({ classes: [], classesMeta: { total: 0, returned: 0, truncated: false } }); }
    finally { empty.sqlite.close(); }
    const connection = createDb(databasePath);
    try {
      const insert = connection.sqlite.prepare("INSERT INTO classes(id,name,access_code) VALUES(?,?,?)");
      connection.sqlite.transaction(() => { for (let index = 0; index < 98; index += 1) insert.run(`class-${index}`, `班级-${index.toString().padStart(3, "0")}`, `CODE-${index}`); })();
      expect(listTeacherClasses(connection.db).classesMeta).toEqual({ total: 100, returned: 100, truncated: false });
      insert.run("class-100", "班级-100", "CODE-100");
      expect(listTeacherClasses(connection.db).classesMeta).toEqual({ total: 101, returned: 100, truncated: true });
      expect(listTeacherClasses(connection.db, { classId: "class-100" })).toEqual({ classes: [{ id: "class-100", name: "班级-100", students: 0, dataType: "REAL" }], classesMeta: { total: 1, returned: 1, truncated: false } });
    } finally { connection.sqlite.close(); }
  });

  it("keeps the latest decision per target even when twenty newer targets crowd it out of the timeline", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.prepare("UPDATE projects SET evidence_revision=1 WHERE id='p1'").run();
      connection.sqlite.prepare("INSERT INTO logic_cards(project_id,payload_json,rule_ready,semantic_ready,semantic_review_json,revision,card_hash) VALUES('p1','{}',0,0,?,1,?)").run(JSON.stringify({ status: "PENDING", ready: false, issues: [], source: "RULE" }), "a".repeat(64));
      const logicDecision = appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW", targetId: "p1", originalRevision: 1, decision: "NEEDS_REVIEW", reasonCode: "LOGIC", notes: "keep me", idempotencyKey: "crowd-logic-key" });
      const insert = connection.sqlite.prepare(`INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
        VALUES(?,'p1','c1','s1',?,'TEXT','INPUT',NULL,'SUBMITTED','READY','标签','私密',?,NULL,NULL,1700000000)`);
      for (let index = 1; index <= 21; index += 1) {
        const id = `55555555-5555-4555-8555-${index.toString().padStart(12, "0")}`;
        insert.run(id, index + 2, index.toString(16).padStart(64, "0"));
        appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { classId: "c1", studentId: "s1", projectId: "p1", targetType: "EVIDENCE", targetId: id, originalRevision: index, decision: "CONFIRMED", reasonCode: "EVIDENCE", notes: String(index), idempotencyKey: `crowd-evidence-${index}` });
      }
      const result = readLearnerDetail(connection.db, "c1", "s1", { decisionLimit: 20 });
      expect(result.decisions).toHaveLength(20);
      expect(result.decisions.some((decision) => decision.id === logicDecision.id)).toBe(false);
      expect(result.latestDecisionByTarget["LOGIC_REVIEW:p1"]?.id).toBe(logicDecision.id);
    } finally { connection.sqlite.close(); }
  });
});

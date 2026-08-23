// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { saveBookLayoutEvidence } from "@/lib/services/book-layout";
import { appendTeacherDecision, readTeacherDecisions } from "@/lib/services/teacher-decisions";

describe("teacher decisions", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-teacher-decision-"));
    databasePath = path.join(directory, "decision.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    const now = Math.floor(Date.now() / 1_000);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','一班','C1'),('c2','二班','C2');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1','c1','STUDENT','匿名-A',${now}),('s2','c2','STUDENT','匿名-B',${now}),('teacher',NULL,'TEACHER','课程负责人',${now});
        INSERT INTO teacher_access_scopes VALUES('teacher','GLOBAL',NULL,'TEST_SETUP','测试课程负责人',${now});
        INSERT INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES('m1','c1',1,'M',1,'F'),('m2','c2',1,'M',1,'F');
        INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at) VALUES('a1','c1','m1','A','B','["DIGISHOW"]',${now}),('a2','c2','m2','A','B','["DIGISHOW"]',${now});
        INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at) VALUES('p1','c1','a1','s1','LOGIC_CARD',${now},${now}),('p2','c2','a2','s2','LOGIC_CARD',${now},${now});
        INSERT INTO logic_cards(project_id,payload_json,rule_ready,semantic_ready,semantic_review_json,revision,card_hash)
          VALUES('p1','{"audience":"a","context":"b","input":"c","mapping":"d","output":"e","culturalIntent":"f"}',1,0,'{"status":"NEEDS_REVISION","ready":false,"issues":["MAPPING_WEAK"],"source":"RULE"}',4,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      `);
    } finally { connection.sqlite.close(); }
  });

  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("appends an idempotent decision without mutating the original AI result", () => {
    const connection = createDb(databasePath);
    try {
      const input = {
        classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW" as const,
        targetId: "p1", originalRevision: 4, decision: "NEEDS_REVIEW" as const,
        reasonCode: "TEACHER_CHECK", notes: "请课后当面检查", idempotencyKey: "idem-12345678",
      };
      const first = appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, input);
      const second = appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, input);
      expect(second.id).toBe(first.id);
      expect(first.sequence).toBe(1);
      expect(first.timelineSequence).toBe(1);
      expect(first.originalSnapshot).toMatchObject({ targetType: "LOGIC_REVIEW", revision: 4, status: "NEEDS_REVISION", ruleReady: true, semanticReady: false, source: "RULE", issues: ["MAPPING_WEAK"] });
      const original = connection.sqlite.prepare("SELECT revision, semantic_review_json FROM logic_cards WHERE project_id='p1'").get();
      expect(original).toMatchObject({ revision: 4 });
      expect(JSON.stringify(original)).toContain("NEEDS_REVISION");
      expect(connection.sqlite.prepare("SELECT count(*) AS n FROM teacher_decisions").get()).toEqual({ n: 1 });
    } finally { connection.sqlite.close(); }
  });

  it("reviews immutable book-layout evidence through the shared decision protocol without a project", () => {
    const connection = createDb(databasePath);
    try {
      const submitted = saveBookLayoutEvidence(connection, { userId: "s1", role: "STUDENT" }, {
        audience: "COMMUNITY_RESIDENTS",
        pageOrder: ["cover", "quick-start", "activity-map", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
        diagnosticAnswers: ["AUDIENCE_FIRST", "TASK_FIRST", "AUDIENCE_FIRST"],
        transferChoices: ["COMMUNITY_ENTRY_FIRST", "VOLUNTEER_CALL_TO_ACTION", "RETAIN_ACTIVITY_CORE"],
      }, new Date("2026-07-16T08:00:00.000Z"));
      const first = appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, {
        classId: "c1", studentId: "s1", projectId: null,
        targetType: "BOOK_LAYOUT_EVIDENCE", targetId: submitted.id, originalRevision: 1,
        decision: "CONFIRMED", reasonCode: "BOOK_STRUCTURE_CONFIRMED", notes: "页序与受众迁移有效",
        idempotencyKey: "book-layout-review-1",
      });
      expect(first).toMatchObject({
        targetType: "BOOK_LAYOUT_EVIDENCE", targetId: submitted.id, sequence: 1,
        originalSnapshot: {
          targetType: "BOOK_LAYOUT_EVIDENCE", revision: 1, id: submitted.id,
          audience: "COMMUNITY_RESIDENTS", score: 4, passed: true,
          pageOrder: submitted.pageOrder, diagnosticAnswers: submitted.diagnosticAnswers,
          transferChoices: submitted.transferChoices, criteria: submitted.criteria,
        },
      });
      const second = appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, {
        classId: "c1", studentId: "s1", projectId: null,
        targetType: "BOOK_LAYOUT_EVIDENCE", targetId: submitted.id, originalRevision: 1,
        decision: "NEEDS_REVIEW", reasonCode: "BOOK_READER_TEST", notes: "需要当面核对目标读者测试",
        idempotencyKey: "book-layout-review-2",
      });
      expect(second.sequence).toBe(2);
      expect(readTeacherDecisions(connection.db, "c1", "s1", null).map(({ decision }) => decision))
        .toEqual(["NEEDS_REVIEW", "CONFIRMED"]);
      expect(connection.sqlite.prepare("SELECT project_id FROM teacher_decisions WHERE id=?").get(first.id))
        .toEqual({ project_id: null });
      expect(connection.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE id=? AND type='BOOK_LAYOUT_EVIDENCE_SUBMITTED'").get(submitted.id))
        .toEqual({ n: 1 });
    } finally { connection.sqlite.close(); }
  });

  it("rejects reuse of an idempotency key for a different canonical request", () => {
    const connection = createDb(databasePath);
    try {
      const input = { classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW" as const, targetId: "p1", originalRevision: 4, decision: "CONFIRMED" as const, reasonCode: "OK", notes: "first", idempotencyKey: "conflict-idem-1234" };
      appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, input);
      expect(() => appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { ...input, notes: "different" })).toThrow(/REQUEST_CONFLICT/);
      expect(connection.sqlite.prepare("SELECT count(*) AS n FROM teacher_decisions").get()).toEqual({ n: 1 });
    } finally { connection.sqlite.close(); }
  });

  it("never returns an old decision when the same key is reused for another owned student project", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1b','c1','STUDENT','匿名-A2',1700000000);
        INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at,evidence_revision) VALUES('p1b','c1','a1','s1b','LOGIC_CARD',1700000000,1700000000,0);
        INSERT INTO logic_cards(project_id,payload_json,rule_ready,semantic_ready,semantic_review_json,revision,card_hash) VALUES('p1b','{}',0,0,'{"status":"PENDING","ready":false,"issues":[],"source":"RULE"}',4,'${"b".repeat(64)}');`);
      const shared = "identity-bound-key";
      const first = appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW", targetId: "p1", originalRevision: 4, decision: "CONFIRMED", reasonCode: "OK", notes: "", idempotencyKey: shared });
      expect(() => appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { classId: "c1", studentId: "s1b", projectId: "p1b", targetType: "LOGIC_REVIEW", targetId: "p1b", originalRevision: 4, decision: "CONFIRMED", reasonCode: "OK", notes: "", idempotencyKey: shared })).toThrow(/REQUEST_CONFLICT/);
      expect(connection.sqlite.prepare("SELECT student_id,project_id FROM teacher_decisions WHERE id=?").get(first.id)).toEqual({ student_id: "s1", project_id: "p1" });
    } finally { connection.sqlite.close(); }
  });

  it("preserves the original snapshot after the target changes", () => {
    const connection = createDb(databasePath);
    try {
      const first = appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW", targetId: "p1", originalRevision: 4, decision: "NEEDS_REVIEW", reasonCode: "OLD", notes: "old result", idempotencyKey: "snapshot-idem-1234" });
      connection.sqlite.prepare("UPDATE logic_cards SET revision=5, semantic_ready=1, semantic_review_json=? WHERE project_id='p1'").run(JSON.stringify({ status: "APPROVED", ready: true, issues: [], source: "AI" }));
      const persisted = connection.sqlite.prepare("SELECT original_snapshot_json, original_snapshot_hash FROM teacher_decisions WHERE id=?").get(first.id) as { original_snapshot_json: string; original_snapshot_hash: string };
      expect(JSON.parse(persisted.original_snapshot_json)).toEqual(first.originalSnapshot);
      expect(persisted.original_snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(first.originalSnapshot).toMatchObject({ status: "NEEDS_REVISION", revision: 4 });
    } finally { connection.sqlite.close(); }
  });

  it("uses project evidenceRevision for evidence CAS while preserving its sequence", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`UPDATE projects SET evidence_revision=7 WHERE id='p1';
        INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
        VALUES('11111111-1111-4111-8111-111111111111','p1','c1','s1',1,'TEXT','INPUT',NULL,'SUBMITTED','READY','公开标签','私密','${"e".repeat(64)}',NULL,NULL,1700000000);`);
      const input = { classId: "c1", studentId: "s1", projectId: "p1", targetType: "EVIDENCE" as const, targetId: "11111111-1111-4111-8111-111111111111", originalRevision: 7, decision: "CONFIRMED" as const, reasonCode: "OK", notes: "", idempotencyKey: "evidence-cas-key" };
      const result = appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, input);
      expect(result.originalSnapshot).toMatchObject({ targetType: "EVIDENCE", revision: 7, sequence: 1, verification: "SUBMITTED" });
      expect(JSON.stringify(result)).not.toMatch(/私密|content|digest|originalName/i);
      expect(connection.sqlite.prepare("SELECT verification_status,confirmed_code FROM evidence WHERE id=?").get("11111111-1111-4111-8111-111111111111")).toEqual({ verification_status: "TEACHER_VERIFIED", confirmed_code: "INPUT_OK" });
      expect(connection.sqlite.prepare("SELECT evidence_revision FROM projects WHERE id='p1'").get()).toEqual({ evidence_revision: 8 });
      connection.sqlite.exec("UPDATE projects SET evidence_revision=8 WHERE id='p1'");
      expect(() => appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { classId: "c1", studentId: "s1", projectId: "p1", targetType: "EVIDENCE", targetId: "11111111-1111-4111-8111-111111111111", originalRevision: 7, decision: "CONFIRMED", reasonCode: "OK", notes: "", idempotencyKey: "evidence-stale-key" })).toThrow(/REVISION_CONFLICT/);
      connection.sqlite.prepare("DELETE FROM evidence WHERE id=?").run(input.targetId);
      expect(appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, input).id).toBe(result.id);
      expect(connection.sqlite.prepare("SELECT count(*) AS n FROM teacher_decisions WHERE target_id=?").get(input.targetId)).toEqual({ n: 1 });
    } finally { connection.sqlite.close(); }
  });

  it("maps corrected and needs-review decisions to safe evidence states and clears confirmation codes", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`UPDATE projects SET evidence_revision=1 WHERE id='p1';
        INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at) VALUES
        ('88888888-8888-4888-8888-888888888888','p1','c1','s1',1,'TEXT','INPUT','INPUT_OK','RULE_VERIFIED','READY','规则证据','内容','${"8".repeat(64)}',NULL,NULL,1700000000),
        ('99999999-9999-4999-8999-999999999999','p1','c1','s1',2,'TEXT','MAPPING','MAPPING_OK','TEACHER_VERIFIED','READY','教师证据','内容','${"9".repeat(64)}',NULL,NULL,1700000000);`);
      appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { classId: "c1", studentId: "s1", projectId: "p1", targetType: "EVIDENCE", targetId: "88888888-8888-4888-8888-888888888888", originalRevision: 1, decision: "CORRECTED", reasonCode: "INVALID", notes: "不能支撑判断", idempotencyKey: "correct-evidence-state" });
      appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { classId: "c1", studentId: "s1", projectId: "p1", targetType: "EVIDENCE", targetId: "99999999-9999-4999-8999-999999999999", originalRevision: 2, decision: "NEEDS_REVIEW", reasonCode: "RECHECK", notes: "需要当面检查", idempotencyKey: "review-evidence-state" });
      expect(connection.sqlite.prepare("SELECT verification_status,confirmed_code FROM evidence WHERE id=?").get("88888888-8888-4888-8888-888888888888")).toEqual({ verification_status: "REJECTED", confirmed_code: null });
      expect(connection.sqlite.prepare("SELECT verification_status,confirmed_code FROM evidence WHERE id=?").get("99999999-9999-4999-8999-999999999999")).toEqual({ verification_status: "SUBMITTED", confirmed_code: null });
      expect(connection.sqlite.prepare("SELECT evidence_revision FROM projects WHERE id='p1'").get()).toEqual({ evidence_revision: 3 });
    } finally { connection.sqlite.close(); }
  });

  it("rolls back both the appended decision and derived evidence status when verification fails", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`UPDATE projects SET evidence_revision=1 WHERE id='p1';
        INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
        VALUES('77777777-7777-4777-8777-777777777777','p1','c1','s1',1,'TEXT','INPUT',NULL,'SUBMITTED','READY','标签','内容','${"7".repeat(64)}',NULL,NULL,1700000000);
        CREATE TRIGGER force_evidence_review_failure BEFORE UPDATE OF verification_status ON evidence
        BEGIN SELECT RAISE(ABORT, 'forced evidence verification failure'); END;`);
      expect(() => appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, {
        classId: "c1", studentId: "s1", projectId: "p1", targetType: "EVIDENCE", targetId: "77777777-7777-4777-8777-777777777777",
        originalRevision: 1, decision: "CONFIRMED", reasonCode: "OK", notes: "", idempotencyKey: "atomic-evidence-review",
      })).toThrow(/forced evidence verification failure/);
      expect(connection.sqlite.prepare("SELECT count(*) AS n FROM teacher_decisions").get()).toEqual({ n: 0 });
      expect(connection.sqlite.prepare("SELECT verification_status FROM evidence WHERE id='77777777-7777-4777-8777-777777777777'").get()).toEqual({ verification_status: "SUBMITTED" });
      expect(connection.sqlite.prepare("SELECT evidence_revision FROM projects WHERE id='p1'").get()).toEqual({ evidence_revision: 1 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("orders a student's cross-target history by monotonic timeline sequence", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`UPDATE projects SET evidence_revision=7 WHERE id='p1';
        INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
        VALUES('22222222-2222-4222-8222-222222222222','p1','c1','s1',1,'TEXT','INPUT',NULL,'SUBMITTED','READY','标签','私密','${"f".repeat(64)}',NULL,NULL,1700000000);`);
      const logic = appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW", targetId: "p1", originalRevision: 4, decision: "CONFIRMED", reasonCode: "OK", notes: "logic", idempotencyKey: "timeline-logic" });
      const transferSnapshot = JSON.stringify({ targetType: "TRANSFER", revision: 1, status: "OPEN", attemptCount: 0, latestRubric: null, latestOutcome: null });
      connection.sqlite.prepare(`INSERT INTO teacher_decisions(id,teacher_id,class_id,student_id,project_id,target_type,target_id,original_revision,decision,reason_code,notes,sequence,timeline_sequence,idempotency_key,request_hash,original_snapshot_json,original_snapshot_hash,created_at)
        VALUES('timeline-transfer','teacher','c1','s1','p1','TRANSFER','transfer-target',1,'CONFIRMED','OK','transfer',1,2,'timeline-transfer',tonggan_sha256(json_array('c1','s1','p1','TRANSFER','transfer-target',1,'CONFIRMED','OK','transfer')),json(?),tonggan_sha256(json(?)),1700000000)`).run(transferSnapshot, transferSnapshot);
      const evidenceDecision = appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { classId: "c1", studentId: "s1", projectId: "p1", targetType: "EVIDENCE", targetId: "22222222-2222-4222-8222-222222222222", originalRevision: 7, decision: "NEEDS_REVIEW", reasonCode: "CHECK", notes: "evidence", idempotencyKey: "timeline-evidence" });
      connection.sqlite.prepare("UPDATE teacher_decisions SET created_at=1700000000").run();
      expect([logic.timelineSequence, evidenceDecision.timelineSequence]).toEqual([1, 3]);
      expect(readTeacherDecisions(connection.db, "c1", "s1", "p1").map((row) => row.timelineSequence)).toEqual([3, 2, 1]);
    } finally { connection.sqlite.close(); }
  });

  it("detects a snapshot changed without its hash", () => {
    const connection = createDb(databasePath);
    try {
      const row = appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW", targetId: "p1", originalRevision: 4, decision: "CONFIRMED", reasonCode: "OK", notes: "", idempotencyKey: "tamper-snapshot" });
      connection.sqlite.prepare("UPDATE teacher_decisions SET original_snapshot_json=json_set(original_snapshot_json,'$.source','TAMPERED') WHERE id=?").run(row.id);
      expect(() => readTeacherDecisions(connection.db, "c1", "s1", "p1")).toThrow(/CORRUPT_DECISION/);
    } finally { connection.sqlite.close(); }
  });

  it("rejects malformed discriminated snapshots at the raw SQL boundary", () => {
    const connection = createDb(databasePath);
    try {
      const insert = connection.sqlite.prepare(`INSERT INTO teacher_decisions(id,teacher_id,class_id,student_id,project_id,target_type,target_id,original_revision,decision,reason_code,notes,sequence,timeline_sequence,idempotency_key,request_hash,original_snapshot_json,original_snapshot_hash,created_at)
        VALUES(?, 'teacher','c1','s1','p1',?,?,4,'CONFIRMED','OK','',1,?,?,?,?,'${"b".repeat(64)}',1700000000)`);
      const malformedLogic = JSON.stringify({ targetType: "LOGIC_REVIEW", revision: 4, status: "PENDING", ruleReady: false, semanticReady: false, source: "TEST", issues: [123] });
      expect(() => insert.run("bad-logic", "LOGIC_REVIEW", "p1", 1, "raw-bad-logic", "a".repeat(64), malformedLogic)).toThrow(/invalid logic issues/);
      const malformedEvidence = JSON.stringify({ targetType: "EVIDENCE", id: "bad-evidence", kind: 4, layer: "INPUT", verification: "SUBMITTED", code: null, revision: 4, sequence: 1 });
      expect(() => insert.run("bad-evidence-row", "EVIDENCE", "bad-evidence", 2, "raw-bad-evidence", "c".repeat(64), malformedEvidence)).toThrow();
      const malformedTransfer = JSON.stringify({ targetType: "TRANSFER", revision: 4, status: "OPEN", attemptCount: 0, latestRubric: { outcome: "PASSED" }, latestOutcome: "PASSED" });
      expect(() => insert.run("bad-transfer", "TRANSFER", "bad-transfer", 3, "raw-bad-transfer", "d".repeat(64), malformedTransfer)).toThrow(/invalid transfer/);
      const malformedBook = JSON.stringify({
        targetType: "BOOK_LAYOUT_EVIDENCE", revision: 1, id: "bad-book", audience: "COMMUNITY_RESIDENTS",
        pageOrder: Array(8).fill("cover"),
        diagnosticAnswers: ["AUDIENCE_FIRST", "TASK_FIRST", "AUDIENCE_FIRST"],
        transferChoices: ["COMMUNITY_ENTRY_FIRST"],
        criteria: Array(4).fill({ id: "DIAGNOSTIC", passed: true, label: "重复规则", note: "无效" }),
        score: 4, passed: true,
      });
      expect(() => connection.sqlite.prepare(`INSERT INTO teacher_decisions(id,teacher_id,class_id,student_id,project_id,target_type,target_id,original_revision,decision,reason_code,notes,sequence,timeline_sequence,idempotency_key,request_hash,original_snapshot_json,original_snapshot_hash,created_at)
        VALUES('bad-book-row','teacher','c1','s1',NULL,'BOOK_LAYOUT_EVIDENCE','bad-book',1,'CONFIRMED','OK','',1,5,'raw-bad-book','${"f".repeat(64)}',?,'${"a".repeat(64)}',1700000000)`).run(malformedBook)).toThrow(/invalid book layout snapshot/);
      const validRubric = { criteria: { retainedStructure: { passed: true, reasonCode: "RETAINED_MATCH" }, changedParts: { passed: true, reasonCode: "CHANGE_TARGETED" }, normalization: { passed: true, reasonCode: "NORMALIZATION_VALID" }, culturalImpact: { passed: true, reasonCode: "CULTURAL_CONCRETE" } }, score: 4, passed: true, outcome: "PASSED", feedback: { retained: false, changed: false, normalization: false, cultural: false, teacherReview: false, aiCode: null } };
      expect(connection.sqlite.prepare("SELECT tonggan_validate_transfer_rubric(?) AS valid").get(JSON.stringify({ outcome: "PASSED" }))).toEqual({ valid: 0 });
      expect(connection.sqlite.prepare("SELECT tonggan_validate_transfer_rubric(?) AS valid").get(JSON.stringify(validRubric))).toEqual({ valid: 1 });
      const validTransfer = JSON.stringify({ targetType: "TRANSFER", revision: 4, status: "PASSED", attemptCount: 1, latestRubric: validRubric, latestOutcome: "PASSED" });
      expect(() => insert.run("good-transfer", "TRANSFER", "good-transfer", 4, "raw-good-transfer", "e".repeat(64), validTransfer)).not.toThrow();
      expect(connection.sqlite.prepare("SELECT count(*) AS n FROM teacher_decisions").get()).toEqual({ n: 1 });
    } finally { connection.sqlite.close(); }
  });

  it("rejects cross-class targets and stale original revisions without appending", () => {
    const connection = createDb(databasePath);
    try {
      const base = { classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW" as const, targetId: "p1", decision: "CONFIRMED" as const, reasonCode: "OK", notes: "", idempotencyKey: "idem-abcdefgh" };
      expect(() => appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { ...base, studentId: "s2", projectId: "p2", targetId: "p2", originalRevision: 1 })).toThrow(/NOT_FOUND/);
      expect(() => appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { ...base, originalRevision: 3 })).toThrow(/REVISION_CONFLICT/);
      expect(connection.sqlite.prepare("SELECT count(*) AS n FROM teacher_decisions").get()).toEqual({ n: 0 });
    } finally { connection.sqlite.close(); }
  });

  it("serializes simultaneous calls from two connections using the same idempotency key", async () => {
    const firstConnection = createDb(databasePath);
    const secondConnection = createDb(databasePath);
    try {
      const input = { classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW" as const, targetId: "p1", originalRevision: 4, decision: "CONFIRMED" as const, reasonCode: "OK", notes: "", idempotencyKey: "shared-idem-1234" };
      const call = (connection: ReturnType<typeof createDb>) => new Promise<ReturnType<typeof appendTeacherDecision>>((resolve, reject) => setImmediate(() => { try { resolve(appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, input)); } catch (error) { reject(error); } }));
      const [first, second] = await Promise.all([call(firstConnection), call(secondConnection)]);
      expect(second.id).toBe(first.id);
      expect(firstConnection.sqlite.prepare("SELECT count(*) AS n FROM teacher_decisions").get()).toEqual({ n: 1 });
    } finally { firstConnection.sqlite.close(); secondConnection.sqlite.close(); }
  });

  it("allows only one of two simultaneous different payloads sharing an idempotency key", async () => {
    const firstConnection = createDb(databasePath);
    const secondConnection = createDb(databasePath);
    try {
      const base = { classId: "c1", studentId: "s1", projectId: "p1", targetType: "LOGIC_REVIEW" as const, targetId: "p1", originalRevision: 4, decision: "CONFIRMED" as const, reasonCode: "OK", idempotencyKey: "racing-different-key" };
      const call = (connection: ReturnType<typeof createDb>, notes: string) => new Promise((resolve, reject) => setImmediate(() => { try { resolve(appendTeacherDecision(connection.db, { userId: "teacher", role: "TEACHER" }, { ...base, notes })); } catch (error) { reject(error); } }));
      const results = await Promise.allSettled([call(firstConnection, "first"), call(secondConnection, "second")]);
      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
      expect(firstConnection.sqlite.prepare("SELECT count(*) AS n FROM teacher_decisions").get()).toEqual({ n: 1 });
    } finally { firstConnection.sqlite.close(); secondConnection.sqlite.close(); }
  });

  it("rejects a same-class student paired with another student's project at the database boundary", () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.prepare("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1b','c1','STUDENT','匿名-A2',1700000000)").run();
      const snapshot = JSON.stringify({ targetType: "LOGIC_REVIEW", revision: 4, status: "PENDING", ruleReady: false, semanticReady: false, source: "TEST", issues: [] });
      expect(() => connection.sqlite.prepare(`INSERT INTO teacher_decisions(id,teacher_id,class_id,student_id,project_id,target_type,target_id,original_revision,decision,reason_code,notes,sequence,idempotency_key,request_hash,original_snapshot_json,original_snapshot_hash,created_at)
        VALUES('bad','teacher','c1','s1b','p1','LOGIC_REVIEW','p1',4,'CONFIRMED','OK','',1,'mismatch-key','${"a".repeat(64)}',?,'${"b".repeat(64)}',1700000000)`).run(snapshot)).toThrow(/FOREIGN KEY/);
      expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally { connection.sqlite.close(); }
  });

  it("upgrades a populated 0019 decision and finishes with valid composite foreign keys", async () => {
    const source = path.resolve("drizzle");
    const partial = path.join(directory, "through-0019");
    await mkdir(path.join(partial, "meta"), { recursive: true });
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const oldEntries = journal.entries.filter(({ idx }) => idx <= 19);
    await writeFile(path.join(partial, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "sqlite", entries: oldEntries }), "utf8");
    await Promise.all(oldEntries.map(({ tag }) => copyFile(path.join(source, `${tag}.sql`), path.join(partial, `${tag}.sql`))));
    const legacyPath = path.join(directory, "legacy.sqlite");
    runMigrations(legacyPath, partial);
    const legacy = createDb(legacyPath);
    legacy.sqlite.exec(`
      INSERT INTO classes VALUES('lc','历史班','LC'); INSERT INTO users(id,class_id,role,alias,created_at) VALUES('ls','lc','STUDENT','匿名',1700000000);
      INSERT INTO course_modules VALUES('lm','lc',1,'M',1,'F'); INSERT INTO assignments VALUES('la','lc','lm','A','B','["DIGISHOW"]',1700000000);
      INSERT INTO projects VALUES('lp','lc','la','ls','LOGIC_CARD',1700000000,1700000000,0);
      INSERT INTO logic_cards(project_id,payload_json,rule_ready,semantic_ready,semantic_review_json,revision,card_hash)
      VALUES('lp','{}',0,0,'{"status":"PENDING","ready":false,"issues":[],"source":"LEGACY"}',3,'${"a".repeat(64)}');
      INSERT INTO teacher_decisions VALUES('ld','teacher','lc','ls','lp','LOGIC_REVIEW','lp',3,'CONFIRMED','OK','legacy',1,'legacy-key',1700000000);
    `);
    legacy.sqlite.close();
    runMigrations(legacyPath);
    const upgraded = createDb(legacyPath);
    try {
      upgraded.sqlite.prepare("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','课程负责人',1700000000)").run();
      upgraded.sqlite.prepare("INSERT INTO teacher_access_scopes VALUES('teacher','GLOBAL',NULL,'TEST_SETUP','测试课程负责人',1700000000)").run();
      const row = upgraded.sqlite.prepare("SELECT request_hash,original_snapshot_json,original_snapshot_hash FROM teacher_decisions WHERE id='ld'").get() as { request_hash: string; original_snapshot_json: string; original_snapshot_hash: string };
      expect(row.request_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.request_hash).not.toBe("0".repeat(64));
      expect(JSON.parse(row.original_snapshot_json)).toMatchObject({ targetType: "LOGIC_REVIEW", revision: 3, source: "LEGACY" });
      expect(row.original_snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.original_snapshot_hash).not.toBe("0".repeat(64));
      const replayed = appendTeacherDecision(upgraded.db, { userId: "teacher", role: "TEACHER" }, { classId: "lc", studentId: "ls", projectId: "lp", targetType: "LOGIC_REVIEW", targetId: "lp", originalRevision: 3, decision: "CONFIRMED", reasonCode: "OK", notes: "legacy", idempotencyKey: "legacy-key" });
      expect(replayed.id).toBe("ld");
      expect(() => appendTeacherDecision(upgraded.db, { userId: "teacher", role: "TEACHER" }, { classId: "lc", studentId: "ls", projectId: "lp", targetType: "LOGIC_REVIEW", targetId: "lp", originalRevision: 3, decision: "CONFIRMED", reasonCode: "OK", notes: "changed", idempotencyKey: "legacy-key" })).toThrow(/REQUEST_CONFLICT/);
      expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally { upgraded.sqlite.close(); }
  });
});

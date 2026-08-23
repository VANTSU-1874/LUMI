import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  readTeacherEvidenceDetail,
  TeacherEvidenceReviewForbiddenError,
  TeacherEvidenceReviewNotFoundError,
} from "@/lib/services/teacher-evidence-review";

describe("teacher evidence review", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-teacher-evidence-review-"));
    databasePath = path.join(directory, "review.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','一班','C1'),('c2','二班','C2');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('student-1','c1','STUDENT','匿名一',1700000000),
          ('student-2','c2','STUDENT','匿名二',1700000000),
          ('teacher',NULL,'TEACHER','课程负责人',1700000000),
          ('teacher-1','c1','TEACHER','一班教师',1700000000),
          ('teacher-2','c2','TEACHER','二班教师',1700000000);
        INSERT INTO teacher_access_scopes VALUES('teacher','GLOBAL',NULL,'TEST_SETUP','测试课程负责人',1700000000);
        INSERT INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES('m1','c1',1,'M',1,'F'),('m2','c2',1,'M',1,'F');
        INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at) VALUES('a1','c1','m1','A','B','["DIGISHOW"]',1700000000),('a2','c2','m2','A','B','["DIGISHOW"]',1700000000);
        INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at) VALUES('p1','c1','a1','student-1','TROUBLESHOOT',1700000000,1700000000),('p2','c2','a2','student-2','TROUBLESHOOT',1700000000,1700000000);
        INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at) VALUES
          ('11111111-1111-4111-8111-111111111111','p1','c1','student-1',1,'TEXT','INPUT',NULL,'SUBMITTED','READY','输入观察','声音数值从 0.1 变化到 0.8','${"a".repeat(64)}',NULL,NULL,1700000001),
          ('22222222-2222-4222-8222-222222222222','p1','c1','student-1',2,'VALUE','MAPPING',NULL,'SUBMITTED','READY','映射输出','42.5','${"b".repeat(64)}',NULL,NULL,1700000002),
          ('33333333-3333-4333-8333-333333333333','p1','c1','student-1',3,'VIDEO_LINK','OUTPUT',NULL,'SUBMITTED','READY','输出视频','https://example.com/evidence/video','${"c".repeat(64)}',NULL,NULL,1700000003),
          ('44444444-4444-4444-8444-444444444444','p1','c1','student-1',4,'PROBE','INPUT','INPUT_OK','RULE_VERIFIED','READY','输入探针','{}','${"d".repeat(64)}','{"type":"INPUT_MEASUREMENT","firstCondition":"静音","firstValue":0.1,"secondCondition":"说话","secondValue":0.8,"unit":"normalized"}',NULL,1700000004),
          ('55555555-5555-4555-8555-555555555555','p1','c1','student-1',5,'IMAGE','OUTPUT',NULL,'SUBMITTED','READY','输出截图','p1/55555555-5555-4555-8555-555555555555.png','${"e".repeat(64)}',NULL,'student-output.png',1700000005),
          ('66666666-6666-4666-8666-666666666666','p2','c2','student-2',1,'TEXT','INPUT',NULL,'SUBMITTED','READY','跨班证据','不能跨班读取','${"f".repeat(64)}',NULL,NULL,1700000006),
          ('77777777-7777-4777-8777-777777777777','p1','c1','student-1',6,'IMAGE','OUTPUT',NULL,'SUBMITTED','PENDING','待写入图片','pending/path.png','${"7".repeat(64)}',NULL,'pending.png',1700000007);
      `);
    } finally {
      connection.sqlite.close();
    }
  });

  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("returns five bounded evidence variants without storage paths or digests", () => {
    const connection = createDb(databasePath);
    try {
      const actor = { userId: "teacher-1", role: "TEACHER" as const };
      expect(readTeacherEvidenceDetail(connection.db, actor, "11111111-1111-4111-8111-111111111111")).toMatchObject({ kind: "TEXT", text: "声音数值从 0.1 变化到 0.8" });
      expect(readTeacherEvidenceDetail(connection.db, actor, "22222222-2222-4222-8222-222222222222")).toMatchObject({ kind: "VALUE", value: 42.5 });
      expect(readTeacherEvidenceDetail(connection.db, actor, "33333333-3333-4333-8333-333333333333")).toMatchObject({ kind: "VIDEO_LINK", url: "https://example.com/evidence/video" });
      expect(readTeacherEvidenceDetail(connection.db, actor, "44444444-4444-4444-8444-444444444444")).toMatchObject({ kind: "PROBE", probe: { type: "INPUT_MEASUREMENT", firstCondition: "静音", firstValue: 0.1, secondCondition: "说话", secondValue: 0.8 } });
      const image = readTeacherEvidenceDetail(connection.db, actor, "55555555-5555-4555-8555-555555555555");
      expect(image).toMatchObject({ kind: "IMAGE", previewUrl: "/api/evidence/55555555-5555-4555-8555-555555555555" });
      expect(JSON.stringify(image)).not.toMatch(/p1\/|digest|originalName|student-output/i);
    } finally {
      connection.sqlite.close();
    }
  });

  it("allows the persisted global course owner but rejects students and cross-class teachers", () => {
    const connection = createDb(databasePath);
    try {
      expect(readTeacherEvidenceDetail(connection.db, { userId: "teacher", role: "TEACHER" }, "66666666-6666-4666-8666-666666666666").kind).toBe("TEXT");
      expect(() => readTeacherEvidenceDetail(connection.db, { userId: "student-1", role: "STUDENT" }, "11111111-1111-4111-8111-111111111111")).toThrow(TeacherEvidenceReviewForbiddenError);
      expect(() => readTeacherEvidenceDetail(connection.db, { userId: "teacher-2", role: "TEACHER" }, "11111111-1111-4111-8111-111111111111")).toThrow(TeacherEvidenceReviewNotFoundError);
      expect(() => readTeacherEvidenceDetail(connection.db, { userId: "missing-teacher", role: "TEACHER" }, "11111111-1111-4111-8111-111111111111")).toThrow(TeacherEvidenceReviewForbiddenError);
      expect(() => readTeacherEvidenceDetail(connection.db, { userId: "missing-teacher", role: "TEACHER" }, "99999999-9999-4999-8999-999999999999")).toThrow(TeacherEvidenceReviewForbiddenError);
      expect(() => readTeacherEvidenceDetail(connection.db, { userId: "teacher-1", role: "TEACHER" }, "77777777-7777-4777-8777-777777777777")).toThrow(TeacherEvidenceReviewNotFoundError);
    } finally {
      connection.sqlite.close();
    }
  });
});

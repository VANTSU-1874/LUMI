// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { PilotReportNotFoundError, readPilotReport, renderPilotReportMarkdown } from "@/lib/services/pilot-report";

describe("pilot report", () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-pilot-report-"));
    const databasePath = path.join(directory, "pilot.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    const now = Math.floor(Date.now() / 1_000);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','数字交互真实试用班','PILOT');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('s1','c1','STUDENT','匿名-真实01',${now}),
        ('demo-student-1','c1','STUDENT','匿名-演示01',${now}),
        ('teacher',NULL,'TEACHER','课程负责人',${now});
      INSERT INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES('m1','c1',1,'声音驱动画面',1,'排障');
      INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at)
        VALUES('a1','c1','m1','真实任务','任务说明','["TOUCHDESIGNER"]',${now});
      INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at) VALUES
        ('p1','c1','a1','s1','TROUBLESHOOT',${now},${now}),
        ('demo-project-1','c1','a1','demo-student-1','COMPLETE',${now},${now});
      INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type) VALUES
        ('task-real','s1','c1','真实设计任务','ACTIVE',${now},${now},'REAL'),
        ('task-demo','demo-student-1','c1','演示设计任务','ACTIVE',${now},${now},'DEMONSTRATION_DATA');
      INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
        VALUES('11111111-1111-4111-8111-111111111111','p1','c1','s1',1,'TEXT','INPUT',NULL,'SUBMITTED','READY','输入观察','不得进入报告的证据原文','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',NULL,NULL,${now});
      INSERT INTO agent_conversations(id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at) VALUES
        ('conv-real','task-real','s1','c1',NULL,'digital-interaction','1',${now},${now}),
        ('conv-demo','task-demo','demo-student-1','c1',NULL,'digital-interaction','1',${now},${now});
      INSERT INTO agent_turns(id,conversation_id,turn_sequence,student_message,episode,decision_code,policy_trace_json,response_strategy,response_latency_ms,reply_json,ai_mode,source_ids_json,created_at,data_type) VALUES
        ('turn-real','conv-real',1,'声音有数值但画面不动','DEBUG','DEBUG_SIGNAL_CHAIN','{}','DIAGNOSTIC_GUIDANCE',1200,'{}','MODEL_ASSISTED','["knowledge-1"]',${now},'REAL'),
        ('turn-demo','conv-demo',1,'演示问题不得计入','DEBUG','DEBUG_SIGNAL_CHAIN','{}','DIAGNOSTIC_GUIDANCE',999,'{}','DETERMINISTIC_FALLBACK','[]',${now},'DEMONSTRATION_DATA');
      INSERT INTO agent_actions(id,turn_id,action_sequence,type,label,adapter_id,target,focus,payload_json,status,idempotency_key,created_at,executed_at,data_type)
        VALUES('action-real','turn-real',1,'START_TROUBLESHOOTING','进入排障',NULL,'troubleshooting',NULL,'{}','PROPOSED',NULL,${now},NULL,'REAL');
      INSERT INTO agent_decision_reviews(id,turn_id,teacher_id,decision,notes,created_at,data_type)
        VALUES('review-real','turn-real','teacher','CORRECTED','不得进入报告的教师备注',${now},'REAL');
      INSERT INTO audit_events(id,user_id,type,payload_json,created_at) VALUES
        ('book-real','s1','BOOK_LAYOUT_EVIDENCE_SUBMITTED','{"passed":true,"private":"不得进入报告"}',${now}),
        ('book-demo','demo-student-1','BOOK_LAYOUT_EVIDENCE_SUBMITTED','{"passed":true}',${now});
    `);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("aggregates only REAL records and exposes no learner-level content", () => {
    const report = readPilotReport(connection, "c1", new Date("2026-07-16T08:00:00.000Z"));
    expect(report.scope).toEqual({ className: "数字交互真实试用班", dataBoundary: "REAL_ONLY", participantCount: 1 });
    expect(report.automatic.agent).toMatchObject({
      turns: 1, modelAssisted: 1, deterministicFallback: 0, sourceGrounded: 1,
      sourceGroundingRate: 1, averageResponseLatencyMs: 1200,
      actions: { proposed: 1, executed: 0, expired: 0 },
      teacherReviews: { reviewed: 1, confirmed: 0, corrected: 1, needsReview: 0, correctionRate: 1 },
    });
    expect(report.automatic.learning).toMatchObject({
      currentProjects: 1, completedProjects: 0,
      evidence: { total: 1, byVerification: [{ key: "SUBMITTED", count: 1 }] },
      bookDesign: { submissions: 1, passedSubmissions: 1, participants: 1, latestPassedParticipants: 1 },
    });
    expect(report.manualRequired.every((item) => item.status === "PENDING_MANUAL_OBSERVATION")).toBe(true);

    const serialized = JSON.stringify(report);
    const markdown = renderPilotReportMarkdown(report);
    for (const forbidden of ["s1", "demo-student-1", "匿名-真实01", "匿名-演示01", "声音有数值但画面不动", "证据原文", "教师备注", "private"]) {
      expect(serialized).not.toContain(forbidden);
      expect(markdown).not.toContain(forbidden);
    }
    expect(markdown).toContain("待人工观察");
    expect(markdown).toContain("不能单独证明学生已经理解");
    expect(markdown).toContain("不得据此声称显著提升或普遍有效");
    expect(markdown).not.toContain("结论：显著提升");
  });

  it("rejects an unknown class instead of returning an empty authoritative report", () => {
    expect(() => readPilotReport(connection, "missing")).toThrow(PilotReportNotFoundError);
  });
});

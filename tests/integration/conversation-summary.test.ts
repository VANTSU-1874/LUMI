// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyAgentSessionSummaryWriteback } from "@/lib/agent/conversation-summary";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

describe("task-scoped rolling tutor summaries", () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-conversation-summary-"));
    const databasePath = path.join(directory, "summary.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','测试班','SUMMARY');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('s1','c1','STUDENT','匿名一',1700000000),
        ('s2','c1','STUDENT','匿名二',1700000000);
      INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type) VALUES
        ('task-s1','s1','c1','任务一','ACTIVE',1700000000,1700000000,'REAL'),
        ('task-s2','s2','c1','任务二','ACTIVE',1700000000,1700000000,'REAL');
      INSERT INTO agent_conversations(id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at) VALUES
        ('conversation-s1','task-s1','s1','c1',NULL,'general-design','1',1700000000,1700000002),
        ('conversation-s2','task-s2','s2','c1',NULL,'general-design','1',1700000000,1700000000);
      INSERT INTO agent_turns(id,conversation_id,turn_sequence,student_message,episode,decision_code,policy_trace_json,reply_json,ai_mode,source_ids_json,created_at,data_type) VALUES
        ('turn-s1-1','conversation-s1',1,'电话 13812345678，邮箱 arlo@example.com，学号 SC2026123456。','EXPLORE','OPEN_TUTOR','{}','{"title":"联系 13812345678","message":"回复 arlo@example.com"}','MODEL_ASSISTED','[]',1700000001,'REAL'),
        ('turn-s1-2','conversation-s1',2,'继续讨论版式。','EXPLORE','OPEN_TUTOR','{}','{"title":"继续","message":"比较两个方向"}','MODEL_ASSISTED','[]',1700000002,'REAL'),
        ('turn-s2-1','conversation-s2',1,'另一个学生的问题。','EXPLORE','OPEN_TUTOR','{}','{"title":"其他","message":"其他回答"}','MODEL_ASSISTED','[]',1700000001,'REAL');
    `);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects a through-turn owned by another task on insert and update", () => {
    expect(connection.sqlite.prepare(
      "SELECT count(*) count FROM sqlite_master WHERE type='trigger' AND name LIKE 'agent_session_summaries_turn_owner_%_guard'",
    ).get()).toEqual({ count: 2 });
    const insert = connection.sqlite.prepare(`
      INSERT INTO agent_session_summaries(
        task_id,student_id,class_id,summary,through_turn_id,through_created_at,
        covered_turn_count,revision,created_at,updated_at
      ) VALUES('task-s1','s1','c1','已压缩一个回合',?,1700000001,1,1,1700000002,1700000002)
    `);
    expect(() => insert.run("turn-s2-1")).toThrow(/invalid agent session summary owner/i);
    expect(() => insert.run("turn-s1-1")).not.toThrow();
    expect(() => connection.sqlite.prepare(`
      UPDATE agent_session_summaries SET through_turn_id='turn-s2-1' WHERE task_id='task-s1'
    `).run()).toThrow(/invalid agent session summary owner/i);
    expect(connection.sqlite.prepare(
      "SELECT through_turn_id throughTurnId FROM agent_session_summaries WHERE task_id='task-s1'",
    ).get()).toEqual({ throughTurnId: "turn-s1-1" });
  });

  it("redacts phone, email and configured student number before persisting a summary", () => {
    expect(applyAgentSessionSummaryWriteback({
      connection,
      taskId: "task-s1",
      studentId: "s1",
      classId: "c1",
      now: new Date("2026-07-17T08:00:00.000Z"),
      recentTurnLimit: 1,
      environment: { STUDENT_NUMBER_PREFIX: "SC", STUDENT_NUMBER_DIGITS: "10" },
    })).toBe(true);
    const row = connection.sqlite.prepare(`
      SELECT summary,through_turn_id throughTurnId,covered_turn_count coveredTurnCount
      FROM agent_session_summaries WHERE task_id='task-s1'
    `).get() as { summary: string; throughTurnId: string; coveredTurnCount: number };
    expect(row).toMatchObject({ throughTurnId: "turn-s1-1", coveredTurnCount: 1 });
    expect(row.summary).toContain("[已遮蔽手机号]");
    expect(row.summary).toContain("[已遮蔽邮箱]");
    expect(row.summary).toContain("[已遮蔽学号]");
    expect(row.summary).not.toMatch(/13812345678|arlo@example\.com|SC2026123456/i);
  });
});

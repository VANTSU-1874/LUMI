// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MAX_AGENT_TURN_LATENCY_MS } from "@/lib/agent/latency-limits";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent long-latency persistence", () => {
  it("persists 900-second turn traces while retaining the tool-call ceiling", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-latency-"));
    roots.push(root);
    const databasePath = path.join(root, "agent.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);

    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','LATENCY');
        INSERT INTO users(id,class_id,role,alias,created_at)
          VALUES('s1','c1','STUDENT','学生一',1700000000);
        INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type)
          VALUES('task-1','s1','c1','长推理测试','ACTIVE',1700000000,1700000000,'REAL');
        INSERT INTO agent_conversations(
          id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at
        ) VALUES('conversation-1','task-1','s1','c1',NULL,'general-design','1',1700000000,1700000000);
      `);

      const insertTurn = connection.sqlite.prepare(`
        INSERT INTO agent_turns(
          id,conversation_id,turn_sequence,student_message,episode,decision_code,
          policy_trace_json,response_strategy,response_latency_ms,reply_json,ai_mode,
          source_ids_json,created_at,data_type
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      expect(() => insertTurn.run(
        "turn-1", "conversation-1", 1, "请完整分析。", "UNDERSTAND", "UNDERSTAND_LONG_REASONING",
        "{}", "CONCEPT_EXPLANATION", MAX_AGENT_TURN_LATENCY_MS, "{}", "MODEL_ASSISTED",
        "[]", 1700000001, "REAL",
      )).not.toThrow();
      expect(() => insertTurn.run(
        "turn-over", "conversation-1", 2, "越界。", "UNDERSTAND", "UNDERSTAND_LONG_REASONING",
        "{}", "CONCEPT_EXPLANATION", MAX_AGENT_TURN_LATENCY_MS + 1, "{}", "MODEL_ASSISTED",
        "[]", 1700000002, "REAL",
      )).toThrow(/CHECK constraint failed/);

      const insertStep = connection.sqlite.prepare(`
        INSERT INTO agent_steps(
          id,turn_id,step_sequence,kind,status,label,summary,tool_call_id,tool_id,
          latency_ms,created_at,data_type
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      expect(() => insertStep.run(
        "step-1", "turn-1", 1, "MODEL_DECISION", "SUCCEEDED", "长推理模型回答",
        "记录整个模型决策所用时间。", null, null, MAX_AGENT_TURN_LATENCY_MS, 1700000001, "REAL",
      )).not.toThrow();
      expect(() => insertStep.run(
        "step-over", "turn-1", 2, "MODEL_DECISION", "SUCCEEDED", "越界",
        "拒绝超过回合上限的轨迹。", null, null, MAX_AGENT_TURN_LATENCY_MS + 1, 1700000001, "REAL",
      )).toThrow(/CHECK constraint failed/);

      const insertRuntimeEvent = connection.sqlite.prepare(`
        INSERT INTO agent_runtime_events(
          id,turn_id,event_sequence,runtime_id,runtime_version,kind,status,label,summary,
          source_ids_json,usage_status,latency_ms,created_at,data_type
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      expect(() => insertRuntimeEvent.run(
        "runtime-1", "turn-1", 1, "current-agent-runtime", "1.0.0", "MODEL_DECISION",
        "SUCCEEDED", "长推理模型回答", "记录整个模型决策所用时间。", "[]", "UNAVAILABLE",
        MAX_AGENT_TURN_LATENCY_MS, 1700000001, "REAL",
      )).not.toThrow();
      expect(() => insertRuntimeEvent.run(
        "runtime-over", "turn-1", 2, "current-agent-runtime", "1.0.0", "MODEL_DECISION",
        "SUCCEEDED", "越界", "拒绝超过回合上限的轨迹。", "[]", "UNAVAILABLE",
        MAX_AGENT_TURN_LATENCY_MS + 1, 1700000001, "REAL",
      )).toThrow(/CHECK constraint failed/);

      const insertToolCall = connection.sqlite.prepare(`
        INSERT INTO agent_tool_calls(
          id,turn_id,call_sequence,tool_id,tool_version,adapter_id,input_json,output_json,
          status,error_code,latency_ms,created_at,data_type
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      expect(() => insertToolCall.run(
        "tool-1", "turn-1", 1, "test.read", "1", "test-adapter", "{}", "{}",
        "SUCCESS", null, 60_000, 1700000001, "REAL",
      )).not.toThrow();
      expect(() => insertToolCall.run(
        "tool-over", "turn-1", 2, "test.read", "1", "test-adapter", "{}", "{}",
        "SUCCESS", null, 60_001, 1700000001, "REAL",
      )).toThrow(/CHECK constraint failed/);

      expect(connection.sqlite.prepare(`
        SELECT count(*) count FROM sqlite_master
        WHERE type='trigger' AND name IN (
          'agent_student_memory_owner_source_insert_guard',
          'agent_student_memory_owner_source_update_guard',
          'agent_session_summaries_turn_owner_insert_guard',
          'agent_session_summaries_turn_owner_update_guard'
        )
      `).get()).toEqual({ count: 4 });
      expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      connection.sqlite.close();
    }
  });
});

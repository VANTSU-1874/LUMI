// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  KNOWLEDGE_V2_CANARY_ACTIVE,
  KNOWLEDGE_V2_CANARY_UNAVAILABLE,
  KNOWLEDGE_V2_EVIDENCE_ADOPTED,
  readKnowledgeV2CanaryObservation,
} from "@/lib/knowledge/knowledge-v2-canary-observability";

const NOW = new Date("2026-07-31T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);

describe("knowledge V2 Canary observability", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lumi-canary-observation-"));
    databasePath = path.join(directory, "canary.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','一班','PRIVATE-1'),('c2','二班','PRIVATE-2');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('teacher',NULL,'TEACHER','负责人',${NOW_SECONDS}),
          ('t1','c1','TEACHER','一班教师',${NOW_SECONDS}),
          ('s1','c1','STUDENT','匿名学生一',${NOW_SECONDS}),
          ('s2','c2','STUDENT','匿名学生二',${NOW_SECONDS});
        INSERT INTO design_project_tasks(id,student_id,class_id,title,status,mode,pinned,created_at,updated_at,data_type) VALUES
          ('task-1','s1','c1','私密任务','ACTIVE','conversation',0,${NOW_SECONDS},${NOW_SECONDS},'REAL'),
          ('task-2','s2','c2','跨班私密任务','ACTIVE','conversation',0,${NOW_SECONDS},${NOW_SECONDS},'REAL');
        INSERT INTO agent_conversations(id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at) VALUES
          ('conversation-1','task-1','s1','c1',NULL,'layout-design','1',${NOW_SECONDS},${NOW_SECONDS}),
          ('conversation-2','task-2','s2','c2',NULL,'layout-design','1',${NOW_SECONDS},${NOW_SECONDS});
        INSERT INTO agent_turns(id,run_id,conversation_id,turn_sequence,student_message,episode,decision_code,policy_id,policy_version,policy_trace_json,response_strategy,response_latency_ms,reply_json,ai_mode,source_ids_json,created_at,data_type) VALUES
          ('turn-active',NULL,'conversation-1',1,'不得出现在观察结果中的学生问题','EXPLORE','EXPLORE','competition-core','1','{}','CLARIFY',200,'{}','MODEL_ASSISTED','[]',${NOW_SECONDS},'REAL'),
          ('turn-unavailable',NULL,'conversation-1',2,'不得出现在观察结果中的学生问题','EXPLORE','EXPLORE','competition-core','1','{}','CLARIFY',200,'{}','MODEL_ASSISTED','[]',${NOW_SECONDS},'REAL'),
          ('turn-outside-class',NULL,'conversation-2',1,'跨班私密问题','EXPLORE','EXPLORE','competition-core','1','{}','CLARIFY',200,'{}','MODEL_ASSISTED','[]',${NOW_SECONDS},'REAL');
        INSERT INTO agent_runtime_events(id,turn_id,event_sequence,runtime_id,runtime_version,kind,status,label,summary,tool_call_id,tool_id,source_ids_json,policy_rule,error_code,model_provider,model_id,usage_status,input_tokens,output_tokens,total_tokens,latency_ms,created_at,data_type) VALUES
          ('00000000-0000-4000-8000-000000000001','turn-active',1,'lumi-v2','2','CONTEXT_PREPARATION','SUCCEEDED','V2','V2 active',NULL,NULL,'[]','${KNOWLEDGE_V2_CANARY_ACTIVE}',NULL,NULL,NULL,'UNAVAILABLE',NULL,NULL,NULL,1,${NOW_SECONDS},'REAL'),
          ('00000000-0000-4000-8000-000000000002','turn-active',2,'lumi-v2','2','TOOL_OBSERVATION','SUCCEEDED','V2 result','safe',NULL,'knowledge-map.search-evidence','[]',NULL,NULL,NULL,NULL,'UNAVAILABLE',NULL,NULL,NULL,95,${NOW_SECONDS},'REAL'),
          ('00000000-0000-4000-8000-000000000003','turn-active',3,'lumi-v2','2','DEGRADED','SUCCEEDED','degraded','safe',NULL,'knowledge-map.search-evidence','[]',NULL,'KNOWLEDGE_RETRIEVAL_CHANNEL_DEGRADED',NULL,NULL,'UNAVAILABLE',NULL,NULL,NULL,95,${NOW_SECONDS},'REAL'),
          ('00000000-0000-4000-8000-000000000004','turn-active',4,'lumi-v2','2','DEGRADED','SUCCEEDED','protected','safe',NULL,'knowledge-map.search-evidence','[]',NULL,'KNOWLEDGE_RETRIEVAL_CIRCUIT_OPEN',NULL,NULL,'UNAVAILABLE',NULL,NULL,NULL,95,${NOW_SECONDS},'REAL'),
          ('00000000-0000-4000-8000-000000000005','turn-active',5,'lumi-v2','2','SOURCE_SELECTION','SUCCEEDED','adopted','safe',NULL,NULL,'["source-1"]','${KNOWLEDGE_V2_EVIDENCE_ADOPTED}',NULL,NULL,NULL,'UNAVAILABLE',NULL,NULL,NULL,200,${NOW_SECONDS},'REAL'),
          ('00000000-0000-4000-8000-000000000006','turn-unavailable',1,'lumi-v2','2','CONTEXT_PREPARATION','FAILED','V2','unavailable',NULL,NULL,'[]','${KNOWLEDGE_V2_CANARY_UNAVAILABLE}','EVIDENCE_RUNTIME_UNAVAILABLE',NULL,NULL,'UNAVAILABLE',NULL,NULL,NULL,1,${NOW_SECONDS},'REAL'),
          ('00000000-0000-4000-8000-000000000007','turn-outside-class',1,'lumi-v2','2','CONTEXT_PREPARATION','SUCCEEDED','V2','outside',NULL,NULL,'[]','${KNOWLEDGE_V2_CANARY_ACTIVE}',NULL,NULL,NULL,'UNAVAILABLE',NULL,NULL,NULL,1,${NOW_SECONDS},'REAL');
      `);
    } finally {
      connection.sqlite.close();
    }
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("returns only aggregate V2 metrics within the teacher class scope", () => {
    const connection = createDb(databasePath);
    try {
      const result = readKnowledgeV2CanaryObservation(
        connection.db,
        { userId: "t1", role: "TEACHER" },
        { canaryUserIds: ["s1", "s2"], now: NOW, windowMinutes: 30 },
      );
      expect(result.scope).toEqual({ configuredCanaryAccounts: 2, observableCanaryAccounts: 1 });
      expect(result.turns).toEqual({ activeV2: 1, unavailableV2: 1 });
      expect(result.retrieval).toEqual({
        calls: 1,
        success: 1,
        empty: 0,
        failed: 0,
        channelDegraded: 1,
        circuitProtected: 1,
        healthUnavailable: 0,
        p95LatencyMs: 95,
      });
      expect(result.evidence).toEqual({ adoptedTurns: 1 });
      expect(result.manualReview.studentVisibleErrorCheckRequired).toBe(true);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("不得出现在观察结果中的学生问题");
      expect(serialized).not.toContain("跨班私密问题");
      expect(serialized).not.toContain('"s1"');
      expect(serialized).not.toContain('"s2"');
    } finally {
      connection.sqlite.close();
    }
  });

  it("reports no observable accounts for a configured list outside a class teacher scope", () => {
    const connection = createDb(databasePath);
    try {
      const result = readKnowledgeV2CanaryObservation(
        connection.db,
        { userId: "t1", role: "TEACHER" },
        { canaryUserIds: ["s2"], now: NOW, windowMinutes: 30 },
      );
      expect(result.scope).toEqual({ configuredCanaryAccounts: 1, observableCanaryAccounts: 0 });
      expect(result.turns).toEqual({ activeV2: 0, unavailableV2: 0 });
      expect(result.retrieval.calls).toBe(0);
    } finally {
      connection.sqlite.close();
    }
  });
});

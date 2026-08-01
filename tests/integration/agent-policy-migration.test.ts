// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentPolicyTraceSchema } from "@/lib/agent/contracts";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent policy migration", () => {
  it("backfills existing turns without losing their replies or pending actions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-policy-migration-"));
    roots.push(root);
    const databasePath = path.join(root, "legacy.sqlite");
    const legacyMigrations = path.join(root, "migrations-through-0027");
    const legacyMeta = path.join(legacyMigrations, "meta");
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string }>;
    };
    const legacyEntries = journal.entries.filter(({ idx }) => idx <= 27);
    await mkdir(legacyMeta, { recursive: true });
    await writeFile(
      path.join(legacyMeta, "_journal.json"),
      JSON.stringify({ ...journal, entries: legacyEntries }),
      "utf8",
    );
    await Promise.all(legacyEntries.map(({ tag }) => (
      copyFile(path.join(source, `${tag}.sql`), path.join(legacyMigrations, `${tag}.sql`))
    )));

    runMigrations(databasePath, legacyMigrations);
    const legacy = createDb(databasePath);
    legacy.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','POLICY-LEGACY');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1','c1','STUDENT','学生一',1700000000);
      INSERT INTO agent_conversations(id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at)
        VALUES('conversation-1','s1','c1',NULL,'digital-interaction','1',1700000000,1700000000);
      INSERT INTO agent_turns(
        id,conversation_id,turn_sequence,student_message,episode,decision_code,response_strategy,
        response_latency_ms,reply_json,ai_mode,source_ids_json,created_at,data_type
      ) VALUES(
        'turn-1','conversation-1',1,'声音有数值但画面不动','DEBUG','DEBUG_TRACE_SIGNAL','DIAGNOSTIC_GUIDANCE',
        420,'{"title":"旧回答","message":"先检查映射层"}','MODEL_ASSISTED','["signal-chain"]',1700000000,'REAL'
      );
      INSERT INTO agent_actions(
        id,turn_id,action_sequence,type,label,adapter_id,target,focus,payload_json,status,
        idempotency_key,created_at,executed_at,data_type
      ) VALUES(
        'action-1','turn-1',1,'START_TROUBLESHOOTING','开始排障','digital-interaction','PROJECT','troubleshoot',
        '{}','PROPOSED',NULL,1700000000,NULL,'REAL'
      );
    `);
    legacy.sqlite.close();

    runMigrations(databasePath);
    const upgraded = createDb(databasePath);
    try {
      const turn = upgraded.sqlite.prepare(`
        SELECT policy_id policyId, policy_version policyVersion, policy_trace_json policyTraceJson,
          reply_json replyJson, source_ids_json sourceIdsJson
        FROM agent_turns WHERE id='turn-1'
      `).get() as {
        policyId: string;
        policyVersion: string;
        policyTraceJson: string;
        replyJson: string;
        sourceIdsJson: string;
      };
      expect(turn).toMatchObject({
        policyId: "competition-core",
        policyVersion: "1",
        replyJson: '{"title":"旧回答","message":"先检查映射层"}',
        sourceIdsJson: '["signal-chain"]',
      });
      expect(AgentPolicyTraceSchema.parse(JSON.parse(turn.policyTraceJson))).toMatchObject({
        policyId: "competition-core",
        policyVersion: "1",
        budgets: { modelDecisions: 0, toolCalls: 0 },
        appliedRules: ["BOUND_EXECUTION"],
      });
      expect(upgraded.sqlite.prepare("SELECT id, status, target, focus FROM agent_actions WHERE id='action-1'").get())
        .toEqual({ id: "action-1", status: "PROPOSED", target: "PROJECT", focus: "troubleshoot" });
      expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.sqlite.close();
    }
  });
});

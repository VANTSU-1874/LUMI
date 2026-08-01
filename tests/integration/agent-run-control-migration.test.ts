// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("agent run control migration", () => {
  it("backfills durable approval policy without losing K8.1 runs or actions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-control-migration-"));
    roots.push(root);
    const databasePath = path.join(root, "legacy.sqlite");
    const partial = path.join(root, "through-0035");
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as {
      version: string; dialect: string; entries: Array<{ idx: number; tag: string }>;
    };
    const entries = journal.entries.filter(({ idx }) => idx <= 35);
    await mkdir(path.join(partial, "meta"), { recursive: true });
    await writeFile(path.join(partial, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }), "utf8");
    await Promise.all(entries.map(({ tag }) => copyFile(path.join(source, `${tag}.sql`), path.join(partial, `${tag}.sql`))));
    runMigrations(databasePath, partial);
    const legacy = createDb(databasePath);
    try {
      legacy.sqlite.exec(`
        INSERT INTO classes VALUES('c1','测试班级','CONTROL-MIGRATION');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1','c1','STUDENT','学生一',1700000000);
        INSERT INTO design_project_tasks VALUES('11111111-1111-4111-8111-111111111111','s1','c1','旧任务','ACTIVE',1700000000,1700000000,'REAL');
        INSERT INTO agent_runs VALUES(
          '22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','s1','c1',
          'current-agent-runtime','1.0.0','COMPLETED','{"taskId":"11111111-1111-4111-8111-111111111111","message":"旧问题","context":{"view":"AGENT"}}',
          '${"a".repeat(64)}',NULL,'{"stage":"COMPLETED","turnId":"44444444-4444-4444-8444-444444444444"}',
          'legacy-run',1,NULL,NULL,NULL,1700000000,1700000000,1700000000,1700000000,'REAL'
        );
        INSERT INTO agent_conversations VALUES(
          '33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','s1','c1',NULL,
          'general-design','1',1700000000,1700000000
        );
        INSERT INTO agent_turns(
          id,conversation_id,turn_sequence,student_message,episode,decision_code,policy_id,policy_version,
          policy_trace_json,response_strategy,response_latency_ms,reply_json,ai_mode,source_ids_json,created_at,data_type,run_id
        ) VALUES(
          '44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333',1,
          '旧问题','EXPLORE','EXPLORE_FRAME_GOAL','competition-core','1','{}','CLARIFY',100,'{}',
          'DETERMINISTIC_FALLBACK','[]',1700000000,'REAL','22222222-2222-4222-8222-222222222222'
        );
        INSERT INTO agent_actions VALUES(
          '55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444',1,
          'OPEN_WORKSPACE','打开工作区','project-evidence','PROJECT',NULL,'{}','PROPOSED',NULL,1700000000,NULL,'REAL'
        );
      `);
    } finally {
      legacy.sqlite.close();
    }

    runMigrations(databasePath);
    const upgraded = createDb(databasePath);
    try {
      expect(upgraded.sqlite.prepare(`
        SELECT status,effect,approval_mode approvalMode,rejected_at rejectedAt
        FROM agent_actions WHERE id='55555555-5555-4555-8555-555555555555'
      `).get()).toEqual({ status: "PROPOSED", effect: "NAVIGATE", approvalMode: "REQUIRES_CONFIRMATION", rejectedAt: null });
      expect(upgraded.sqlite.prepare(`
        SELECT status,cancel_requested_at cancelRequestedAt,retry_requested_at retryRequestedAt
        FROM agent_runs WHERE id='22222222-2222-4222-8222-222222222222'
      `).get()).toEqual({ status: "COMPLETED", cancelRequestedAt: null, retryRequestedAt: null });
      expect(upgraded.sqlite.prepare("SELECT count(*) count FROM agent_run_controls").get()).toEqual({ count: 0 });
      expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally { upgraded.sqlite.close(); }
  });
});

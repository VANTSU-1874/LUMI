// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("durable agent run migration", () => {
  it("adds run state without changing existing turns or their runtime trace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-run-migration-"));
    roots.push(root);
    const databasePath = path.join(root, "legacy.sqlite");
    const partial = path.join(root, "through-0034");
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string }>;
    };
    const legacyEntries = journal.entries.filter(({ idx }) => idx <= 34);
    await mkdir(path.join(partial, "meta"), { recursive: true });
    await writeFile(
      path.join(partial, "meta", "_journal.json"),
      JSON.stringify({ ...journal, entries: legacyEntries }),
      "utf8",
    );
    await Promise.all(legacyEntries.map(({ tag }) => (
      copyFile(path.join(source, `${tag}.sql`), path.join(partial, `${tag}.sql`))
    )));

    runMigrations(databasePath, partial);
    const legacy = createDb(databasePath);
    legacy.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','RUN-MIGRATION');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1','c1','STUDENT','学生一',1700000000);
      INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type)
        VALUES('11111111-1111-4111-8111-111111111111','s1','c1','旧设计任务','ACTIVE',1700000000,1700000000,'REAL');
      INSERT INTO agent_conversations(
        id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at
      ) VALUES(
        '22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
        's1','c1',NULL,'general-design','1',1700000000,1700000000
      );
      INSERT INTO agent_turns(
        id,conversation_id,turn_sequence,student_message,episode,decision_code,
        policy_id,policy_version,policy_trace_json,response_strategy,response_latency_ms,
        reply_json,ai_mode,source_ids_json,created_at,data_type
      ) VALUES(
        '33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',1,
        '旧海报问题','EXPLORE','EXPLORE_FRAME_GOAL','competition-core','1',
        '{"policyId":"competition-core","policyVersion":"1","budgets":{"modelDecisions":0,"maxModelDecisions":4,"toolCalls":0,"maxToolCalls":6,"turnTimeoutMs":30000},"autonomy":{"readOnlyTools":"AUTOMATIC","studentMutations":"STUDENT_CONFIRMATION","formalAuthority":"FORBIDDEN"},"appliedRules":["ALLOW_GENERAL_DESIGN"]}',
        'CLARIFY',120,'{"title":"旧回答","message":"保留旧内容","whyThisStep":"继续推进","uncertainty":"通用建议","graph":{"nodes":[{"id":"a","label":"问题","kind":"CONTEXT"},{"id":"b","label":"行动","kind":"ACTION"}],"links":[["a","b"]]},"sources":[],"basis":[{"kind":"GENERAL_DESIGN","label":"通用设计建议"}],"actions":[]}',
        'DETERMINISTIC_FALLBACK','[]',1700000000,'REAL'
      );
    `);
    legacy.sqlite.close();

    runMigrations(databasePath);
    const upgraded = createDb(databasePath);
    try {
      expect(upgraded.sqlite.prepare(`
        SELECT id, run_id runId, student_message studentMessage, reply_json replyJson
        FROM agent_turns WHERE id='33333333-3333-4333-8333-333333333333'
      `).get()).toEqual({
        id: "33333333-3333-4333-8333-333333333333",
        runId: null,
        studentMessage: "旧海报问题",
        replyJson: expect.stringContaining("保留旧内容"),
      });
      expect(upgraded.sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_runs','agent_run_events') ORDER BY name",
      ).all()).toEqual([{ name: "agent_run_events" }, { name: "agent_runs" }]);
      expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(upgraded.sqlite.prepare("SELECT count(*) count FROM __drizzle_migrations").get())
        .toEqual({ count: journal.entries.length });
    } finally {
      upgraded.sqlite.close();
    }
  });
});

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { AgentPolicyTraceSchema } from "./contracts";
import { AgentHarnessCaseResultSchema } from "./harness";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

export async function runLegacyMigrationHarnessCase() {
  const started = performance.now();
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-harness-migration-"));
  try {
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
      INSERT INTO classes(id,name,access_code) VALUES('c1','Harness Legacy','HARNESS-LEGACY');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1','c1','STUDENT','Legacy Student',1700000000);
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
          reply_json replyJson FROM agent_turns WHERE id='turn-1'
      `).get() as {
        policyId: string;
        policyVersion: string;
        policyTraceJson: string;
        replyJson: string;
      } | undefined;
      const action = upgraded.sqlite.prepare(
        "SELECT status,target,focus FROM agent_actions WHERE id='action-1'",
      ).get() as { status: string; target: string; focus: string | null } | undefined;
      const trace = turn ? AgentPolicyTraceSchema.safeParse(JSON.parse(turn.policyTraceJson)) : null;
      const foreignKeyViolations = upgraded.sqlite.pragma("foreign_key_check") as Array<Record<string, unknown>>;
      const checks: Array<[boolean, string]> = [
        [turn?.policyId === "competition-core" && turn.policyVersion === "1", "LEGACY_POLICY_NOT_BACKFILLED"],
        [turn?.replyJson.includes("旧回答") === true, "LEGACY_REPLY_LOST"],
        [trace?.success === true && trace.data.budgets.modelDecisions === 0, "LEGACY_TRACE_INVALID"],
        [action?.status === "PROPOSED" && action.target === "PROJECT", "LEGACY_ACTION_LOST"],
        [foreignKeyViolations.length === 0, "LEGACY_FOREIGN_KEY_FAILURE"],
      ];
      const failures = checks.filter(([condition]) => !condition).map(([, failure]) => failure);
      return AgentHarnessCaseResultSchema.parse({
        caseId: "legacy-policy-trace-migrated",
        passed: failures.length === 0,
        durationMs: Math.round(performance.now() - started),
        failures,
        observed: {
          policyId: turn?.policyId ?? null,
          policyVersion: turn?.policyVersion ?? null,
          traceValid: trace?.success ?? false,
          actionStatus: action?.status ?? null,
          foreignKeyViolations: foreignKeyViolations.length,
        },
      });
    } finally {
      upgraded.sqlite.close();
    }
  } catch (error) {
    return AgentHarnessCaseResultSchema.parse({
      caseId: "legacy-policy-trace-migrated",
      passed: false,
      durationMs: Math.round(performance.now() - started),
      failures: [`UNCAUGHT:${error instanceof Error ? error.message : String(error)}`.slice(0, 200)],
      observed: {},
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

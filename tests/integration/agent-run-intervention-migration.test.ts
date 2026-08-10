// @vitest-environment node

import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appendStudentAgentMessage } from "@/lib/agent/agent-message-store";
import { createDesignTask } from "@/lib/agent/design-project-task";
import { currentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { createAgentRunIntervention } from "@/lib/agent/runtime/agent-run-intervention";
import { createAgentRun } from "@/lib/agent/runtime/run-state-store";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];
const firstActor = { userId: "student-1", role: "STUDENT" as const };
const secondActor = { userId: "student-2", role: "STUDENT" as const };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true })
  )));
});

async function copyMigrationsThrough46(target: string) {
  const source = path.resolve("drizzle");
  const journal = JSON.parse(
    await readFile(path.join(source, "meta", "_journal.json"), "utf8"),
  ) as {
    version: string;
    dialect: string;
    entries: Array<{ idx: number; tag: string }>;
  };
  const entries = journal.entries.filter(({ idx }) => idx <= 46);
  await mkdir(path.join(target, "meta"), { recursive: true });
  await writeFile(
    path.join(target, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
    "utf8",
  );
  await Promise.all(entries.map(({ tag }) => (
    copyFile(path.join(source, `${tag}.sql`), path.join(target, `${tag}.sql`))
  )));
  return journal;
}

function createRunForMessage(input: {
  connection: ReturnType<typeof createDb>;
  actor: typeof firstActor;
  taskId: string;
  content: string;
}) {
  const messageId = randomUUID();
  appendStudentAgentMessage({
    connection: input.connection,
    actor: input.actor,
    taskId: input.taskId,
    message: { id: messageId, content: input.content },
  });
  return createAgentRun({
    connection: input.connection,
    actor: input.actor,
    request: {
      taskId: input.taskId,
      clientMessageId: messageId,
      message: input.content,
      context: { view: "AGENT" },
    },
    idempotencyKey: randomUUID(),
    runtime: currentAgentRuntime.descriptor,
  }).run;
}

describe("agent run intervention migration", () => {
  it("upgrades 0046 data and rejects cross-owner direct inserts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lumi-intervention-migration-"));
    roots.push(root);
    const databasePath = path.join(root, "legacy.sqlite");
    const partial = path.join(root, "through-0046");
    const journal = await copyMigrationsThrough46(partial);

    runMigrations(databasePath, partial);
    const legacy = createDb(databasePath);
    const task = (() => {
      legacy.sqlite.exec(`
        INSERT INTO classes(id,name,access_code)
          VALUES('class-1','测试班级','INTERVENTION-MIGRATION');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('student-1','class-1','STUDENT','学生一',1700000000),
          ('student-2','class-1','STUDENT','学生二',1700000000);
      `);
      return createDesignTask(legacy, firstActor, { title: "迁移前任务" });
    })();
    const preserved = createRunForMessage({
      connection: legacy,
      actor: firstActor,
      taskId: task.id,
      content: "迁移前已经保存的问题",
    });
    const turnId = randomUUID();
    legacy.sqlite.exec(`
      INSERT INTO agent_conversations(
        id,task_id,student_id,class_id,project_id,course_pack_id,
        course_pack_version,created_at,updated_at
      ) VALUES(
        '${randomUUID()}','${task.id}','student-1','class-1',NULL,
        'general-design','1',1700000000,1700000000
      );
    `);
    const conversation = legacy.sqlite.prepare(
      "SELECT id FROM agent_conversations WHERE task_id=?",
    ).get(task.id) as { id: string };
    legacy.sqlite.prepare(`
      INSERT INTO agent_turns(
        id,run_id,conversation_id,turn_sequence,student_message,episode,
        decision_code,policy_id,policy_version,policy_trace_json,
        response_strategy,response_latency_ms,reply_json,ai_mode,
        source_ids_json,created_at,data_type
      ) VALUES(?,?,?,1,?,'EXPLORE','EXPLORE_FRAME_GOAL','competition-core',
        '1','{}','CLARIFY',10,'{}','DETERMINISTIC_FALLBACK','[]',1700000000,'REAL')
    `).run(
      turnId,
      preserved.id,
      conversation.id,
      "迁移前已经保存的问题",
    );
    legacy.sqlite.prepare(`
      UPDATE agent_runs SET status='COMPLETED',attempt=1,
        checkpoint_json=?,started_at=1700000000,completed_at=1700000000
      WHERE id=?
    `).run(JSON.stringify({ stage: "COMPLETED", turnId }), preserved.id);
    legacy.sqlite.close();

    runMigrations(databasePath);
    const upgraded = createDb(databasePath);
    try {
      expect(upgraded.sqlite.prepare(`
        SELECT run.id runId,run.status,message.content,turn.id turnId
        FROM agent_runs run
        JOIN agent_messages message
          ON json_extract(run.request_json,'$.clientMessageId')=message.id
        JOIN agent_turns turn ON turn.run_id=run.id
        WHERE run.id=?
      `).get(preserved.id)).toEqual({
        runId: preserved.id,
        status: "COMPLETED",
        content: "迁移前已经保存的问题",
        turnId,
      });
      expect(upgraded.sqlite.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='agent_run_interventions'
      `).get()).toEqual({ name: "agent_run_interventions" });
      expect(upgraded.sqlite.prepare(
        "SELECT count(*) count FROM agent_run_interventions",
      ).get()).toEqual({ count: 0 });

      const source = createRunForMessage({
        connection: upgraded,
        actor: firstActor,
        taskId: task.id,
        content: "新的主问题",
      });
      const valid = createAgentRunIntervention({
        connection: upgraded,
        actor: firstActor,
        sourceRunId: source.id,
        request: {
          mode: "FOLLOW_UP",
          message: { id: randomUUID(), content: "合法的后续问题" },
        },
        idempotencyKey: randomUUID(),
        runtime: currentAgentRuntime.descriptor,
      });
      const foreignTask = createDesignTask(
        upgraded,
        secondActor,
        { title: "其他学生任务" },
      );
      const foreignSource = createRunForMessage({
        connection: upgraded,
        actor: secondActor,
        taskId: foreignTask.id,
        content: "其他学生的问题",
      });
      const extraMessageId = randomUUID();
      appendStudentAgentMessage({
        connection: upgraded,
        actor: firstActor,
        taskId: task.id,
        message: { id: extraMessageId, content: "用于直接写入保护测试" },
      });
      const extraNext = createAgentRun({
        connection: upgraded,
        actor: firstActor,
        request: {
          taskId: task.id,
          clientMessageId: extraMessageId,
          message: "用于直接写入保护测试",
          context: { view: "AGENT" },
        },
        idempotencyKey: randomUUID(),
        runtime: currentAgentRuntime.descriptor,
        allowWhileTaskBusy: true,
      }).run;

      expect(() => upgraded.sqlite.prepare(`
        INSERT INTO agent_run_interventions(
          id,task_id,student_id,class_id,source_run_id,predecessor_run_id,
          user_message_id,requested_mode,actual_mode,queue_sequence,next_run_id,
          status,idempotency_key,request_hash,created_at,updated_at,
          activated_at,completed_at,data_type
        )
        SELECT ?,task_id,student_id,class_id,?,predecessor_run_id,?,
          requested_mode,actual_mode,queue_sequence+1,?,'QUEUED',?,
          request_hash,created_at,updated_at,NULL,NULL,data_type
        FROM agent_run_interventions WHERE id=?
      `).run(
        randomUUID(),
        foreignSource.id,
        extraMessageId,
        extraNext.id,
        randomUUID(),
        valid.intervention.id,
      )).toThrow(/invalid agent run intervention owner or reference/);
      expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(upgraded.sqlite.prepare(
        "SELECT count(*) count FROM __drizzle_migrations",
      ).get()).toEqual({ count: journal.entries.length });
    } finally {
      upgraded.sqlite.close();
    }
  });
});

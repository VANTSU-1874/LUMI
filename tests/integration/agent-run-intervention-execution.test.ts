// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appendStudentAgentMessage } from "@/lib/agent/agent-message-store";
import { createDesignTask } from "@/lib/agent/design-project-task";
import { currentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { executeAgentRun } from "@/lib/agent/runtime/agent-run-executor";
import { createAgentRunIntervention } from "@/lib/agent/runtime/agent-run-intervention";
import {
  claimAgentRun,
  failAgentRun,
} from "@/lib/agent/runtime/agent-run-lifecycle";
import { recoverPendingAgentRuns } from "@/lib/agent/runtime/agent-run-recovery";
import {
  finalizeAgentRunCancellation,
  requestAgentRunCancellation,
} from "@/lib/agent/runtime/agent-run-control";
import { createAgentRun } from "@/lib/agent/runtime/run-state-store";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];
const actor = { userId: "student-1", role: "STUDENT" as const };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => (
    rm(root, { recursive: true, force: true })
  )));
});

async function setupChain() {
  const root = await mkdtemp(path.join(tmpdir(), "lumi-intervention-execution-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code)
      VALUES('class-1','测试班级','INTERVENTION-EXECUTION');
    INSERT INTO users(id,class_id,role,alias,created_at)
      VALUES('student-1','class-1','STUDENT','学生一',1700000000);
  `);
  const task = createDesignTask(connection, actor, { title: "串行执行" });
  const sourceMessageId = randomUUID();
  appendStudentAgentMessage({
    connection,
    actor,
    taskId: task.id,
    message: { id: sourceMessageId, content: "先做一张高对比海报" },
  });
  const source = createAgentRun({
    connection,
    actor,
    request: {
      taskId: task.id,
      clientMessageId: sourceMessageId,
      message: "先做一张高对比海报",
      context: { view: "AGENT" },
    },
    idempotencyKey: randomUUID(),
    runtime: currentAgentRuntime.descriptor,
  }).run;
  const first = createAgentRunIntervention({
    connection,
    actor,
    sourceRunId: source.id,
    request: {
      mode: "FOLLOW_UP",
      message: { id: randomUUID(), content: "再给三个版式方案" },
    },
    idempotencyKey: randomUUID(),
    runtime: currentAgentRuntime.descriptor,
  });
  const second = createAgentRunIntervention({
    connection,
    actor,
    sourceRunId: source.id,
    request: {
      mode: "FOLLOW_UP",
      message: { id: randomUUID(), content: "最后给出一个制作清单" },
    },
    idempotencyKey: randomUUID(),
    runtime: currentAgentRuntime.descriptor,
  });
  const environment = {
    NODE_ENV: "test",
    SESSION_SECRET: "intervention-execution-secret-at-least-32-characters",
    DATABASE_PATH: databasePath,
    EVIDENCE_ROOT: path.join(root, "evidence"),
    AGENT_V2_ENABLED: "true",
    AGENT_V3_ENABLED: "false",
  };
  return {
    connection,
    databasePath,
    environment,
    task,
    source,
    first,
    second,
  };
}

describe("agent intervention execution and recovery", () => {
  it("executes a three-run chain strictly in server FIFO order", async () => {
    const chain = await setupChain();
    chain.connection.sqlite.close();

    const sourceResult = await executeAgentRun(
      chain.source.id,
      chain.environment,
    );
    expect(sourceResult.status).toBe("COMPLETED");

    const connection = createDb(chain.databasePath);
    try {
      expect(connection.sqlite.prepare(`
        SELECT id,status FROM agent_runs
        WHERE id IN (?,?,?) ORDER BY created_at,rowid
      `).all(
        chain.source.id,
        chain.first.nextRun.id,
        chain.second.nextRun.id,
      )).toEqual([
        { id: chain.source.id, status: "COMPLETED" },
        { id: chain.first.nextRun.id, status: "COMPLETED" },
        { id: chain.second.nextRun.id, status: "COMPLETED" },
      ]);
      expect(connection.sqlite.prepare(`
        SELECT turn_sequence turnSequence,student_message studentMessage
        FROM agent_turns
        WHERE run_id IN (?,?,?)
        ORDER BY turn_sequence
      `).all(
        chain.source.id,
        chain.first.nextRun.id,
        chain.second.nextRun.id,
      )).toEqual([
        { turnSequence: 1, studentMessage: "先做一张高对比海报" },
        { turnSequence: 2, studentMessage: "再给三个版式方案" },
        { turnSequence: 3, studentMessage: "最后给出一个制作清单" },
      ]);
      expect(connection.sqlite.prepare(`
        SELECT status FROM agent_run_interventions ORDER BY queue_sequence
      `).all()).toEqual([
        { status: "COMPLETED" },
        { status: "COMPLETED" },
      ]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("recovers only the first unblocked successor and lets it drain the chain once", async () => {
    const chain = await setupChain();
    const claimed = claimAgentRun({
      connection: chain.connection,
      runId: chain.source.id,
      workerId: "crashed-source-worker",
    });
    expect(claimed.kind).toBe("CLAIMED");
    failAgentRun({
      connection: chain.connection,
      runId: chain.source.id,
      workerId: "crashed-source-worker",
      errorCode: "SOURCE_CRASHED",
    });
    chain.connection.sqlite.close();

    const recovered = await recoverPendingAgentRuns(chain.environment);
    expect(recovered).toEqual({ found: 1, recovered: 1, failed: 0 });

    const connection = createDb(chain.databasePath);
    try {
      expect(connection.sqlite.prepare(`
        SELECT id,status,attempt FROM agent_runs
        WHERE id IN (?,?) ORDER BY created_at,rowid
      `).all(
        chain.first.nextRun.id,
        chain.second.nextRun.id,
      )).toEqual([
        { id: chain.first.nextRun.id, status: "COMPLETED", attempt: 1 },
        { id: chain.second.nextRun.id, status: "COMPLETED", attempt: 1 },
      ]);
      expect(connection.sqlite.prepare(`
        SELECT count(*) count FROM agent_turns
        WHERE run_id IN (?,?)
      `).get(
        chain.first.nextRun.id,
        chain.second.nextRun.id,
      )).toEqual({ count: 2 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("safely cancels a running source before turn persistence and starts its successor", async () => {
    const chain = await setupChain();
    expect(claimAgentRun({
      connection: chain.connection,
      runId: chain.source.id,
      workerId: "steer-worker",
    }).kind).toBe("CLAIMED");
    const cancellation = requestAgentRunCancellation({
      connection: chain.connection,
      actor,
      runId: chain.source.id,
      idempotencyKey: randomUUID(),
    });
    expect(cancellation).toMatchObject({
      abortRequested: true,
      run: { status: "RUNNING" },
    });
    finalizeAgentRunCancellation({
      connection: chain.connection,
      runId: chain.source.id,
      workerId: "steer-worker",
    });
    chain.connection.sqlite.close();

    await executeAgentRun(chain.source.id, chain.environment);
    const connection = createDb(chain.databasePath);
    try {
      expect(connection.sqlite.prepare(`
        SELECT id,status FROM agent_runs
        WHERE id IN (?,?) ORDER BY created_at,rowid
      `).all(
        chain.source.id,
        chain.first.nextRun.id,
      )).toEqual([
        { id: chain.source.id, status: "CANCELLED" },
        { id: chain.first.nextRun.id, status: "COMPLETED" },
      ]);
      expect(connection.sqlite.prepare(
        "SELECT count(*) count FROM agent_turns WHERE run_id=?",
      ).get(chain.source.id)).toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });
});

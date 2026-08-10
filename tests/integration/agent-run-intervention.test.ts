// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appendStudentAgentMessage } from "@/lib/agent/agent-message-store";
import {
  createDesignTask,
  updateDesignTask,
} from "@/lib/agent/design-project-task";
import {
  AgentRunInterventionConflictError,
  AgentRunInterventionNotFoundError,
  createAgentRunIntervention,
  downgradeLateAgentRunSteer,
  listAgentRunInterventions,
} from "@/lib/agent/runtime/agent-run-intervention";
import { readAgentRunInterventionContext } from "@/lib/agent/runtime/agent-run-intervention-context";
import {
  claimAgentRun,
  failAgentRun,
} from "@/lib/agent/runtime/agent-run-lifecycle";
import { currentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import {
  createAgentRun,
  readAgentRun,
} from "@/lib/agent/runtime/run-state-store";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];
const actor = { userId: "student-1", role: "STUDENT" as const };
const otherActor = { userId: "student-2", role: "STUDENT" as const };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "lumi-run-intervention-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('class-1','测试班级','INTERVENTION');
    INSERT INTO users(id,class_id,role,alias,created_at) VALUES
      ('student-1','class-1','STUDENT','学生一',1700000000),
      ('student-2','class-1','STUDENT','学生二',1700000000);
  `);
  const task = createDesignTask(connection, actor, { title: "海报方向" });
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
  });
  return { connection, task, source };
}

describe("durable agent run interventions", () => {
  it("atomically persists the user message, intervention and blocked successor", async () => {
    const { connection, task, source } = await setup();
    try {
      const messageId = randomUUID();
      const idempotencyKey = randomUUID();
      const first = createAgentRunIntervention({
        connection,
        actor,
        sourceRunId: source.run.id,
        request: {
          mode: "FOLLOW_UP",
          message: { id: messageId, content: "完成后再补三个版式方案" },
        },
        idempotencyKey,
        runtime: currentAgentRuntime.descriptor,
      });
      const repeated = createAgentRunIntervention({
        connection,
        actor,
        sourceRunId: source.run.id,
        request: {
          mode: "FOLLOW_UP",
          message: { id: messageId, content: "完成后再补三个版式方案" },
        },
        idempotencyKey,
        runtime: currentAgentRuntime.descriptor,
      });

      expect(first).toMatchObject({
        created: true,
        steerShouldCancel: false,
        intervention: {
          taskId: task.id,
          sourceRunId: source.run.id,
          predecessorRunId: source.run.id,
          userMessageId: messageId,
          requestedMode: "FOLLOW_UP",
          actualMode: "FOLLOW_UP",
          queueSequence: 1,
          status: "QUEUED",
        },
        nextRun: {
          status: "QUEUED",
          request: {
            taskId: task.id,
            clientMessageId: messageId,
            message: "完成后再补三个版式方案",
          },
        },
      });
      expect(repeated).toMatchObject({
        created: false,
        intervention: { id: first.intervention.id },
        nextRun: { id: first.nextRun.id },
      });
      expect(connection.sqlite.prepare(`
        SELECT role,content,turn_id turnId FROM agent_messages WHERE id=?
      `).get(messageId)).toEqual({
        role: "user",
        content: "完成后再补三个版式方案",
        turnId: null,
      });
      expect(claimAgentRun({
        connection,
        runId: first.nextRun.id,
        workerId: "blocked-worker",
      })).toMatchObject({ kind: "BUSY", run: { status: "QUEUED" } });
      expect(readAgentRun(connection, actor, source.run.id).status).toBe("QUEUED");
      expect(listAgentRunInterventions(connection, actor, task.id).interventions)
        .toEqual([first.intervention]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("chains multiple inputs by task FIFO without trusting a client queue number", async () => {
    const { connection, source } = await setup();
    try {
      const first = createAgentRunIntervention({
        connection,
        actor,
        sourceRunId: source.run.id,
        request: {
          mode: "FOLLOW_UP",
          message: { id: randomUUID(), content: "先补一组字体方案" },
        },
        idempotencyKey: randomUUID(),
        runtime: currentAgentRuntime.descriptor,
      });
      const second = createAgentRunIntervention({
        connection,
        actor,
        sourceRunId: source.run.id,
        request: {
          mode: "STEER",
          message: { id: randomUUID(), content: "整体改成低饱和、安静的方向" },
        },
        idempotencyKey: randomUUID(),
        runtime: currentAgentRuntime.descriptor,
      });

      expect(second).toMatchObject({
        created: true,
        steerShouldCancel: true,
        intervention: {
          sourceRunId: source.run.id,
          predecessorRunId: first.nextRun.id,
          requestedMode: "STEER",
          actualMode: "STEER",
          queueSequence: 2,
        },
      });
      expect(listAgentRunInterventions(connection, actor, source.run.taskId).interventions)
        .toEqual([first.intervention, second.intervention]);
      expect(claimAgentRun({
        connection,
        runId: second.nextRun.id,
        workerId: "out-of-order-worker",
      })).toMatchObject({ kind: "BUSY" });
    } finally {
      connection.sqlite.close();
    }
  });

  it("rejects idempotency drift, foreign ownership and archived tasks", async () => {
    const { connection, task, source } = await setup();
    try {
      const idempotencyKey = randomUUID();
      const messageId = randomUUID();
      createAgentRunIntervention({
        connection,
        actor,
        sourceRunId: source.run.id,
        request: {
          mode: "FOLLOW_UP",
          message: { id: messageId, content: "补充网格方案" },
        },
        idempotencyKey,
        runtime: currentAgentRuntime.descriptor,
      });
      expect(() => createAgentRunIntervention({
        connection,
        actor,
        sourceRunId: source.run.id,
        request: {
          mode: "STEER",
          message: { id: messageId, content: "换成自由版式" },
        },
        idempotencyKey,
        runtime: currentAgentRuntime.descriptor,
      })).toThrow(AgentRunInterventionConflictError);
      expect(() => createAgentRunIntervention({
        connection,
        actor: otherActor,
        sourceRunId: source.run.id,
        request: {
          mode: "FOLLOW_UP",
          message: { id: randomUUID(), content: "越权消息" },
        },
        idempotencyKey: randomUUID(),
        runtime: currentAgentRuntime.descriptor,
      })).toThrow(AgentRunInterventionNotFoundError);

      updateDesignTask(connection, actor, task.id, { status: "ARCHIVED" });
      expect(() => createAgentRunIntervention({
        connection,
        actor,
        sourceRunId: source.run.id,
        request: {
          mode: "FOLLOW_UP",
          message: { id: randomUUID(), content: "归档后消息" },
        },
        idempotencyKey: randomUUID(),
        runtime: currentAgentRuntime.descriptor,
      })).toThrow(AgentRunInterventionConflictError);
    } finally {
      connection.sqlite.close();
    }
  });

  it("advances FIFO after failures and carries every unanswered original message", async () => {
    const { connection, source } = await setup();
    try {
      const first = createAgentRunIntervention({
        connection,
        actor,
        sourceRunId: source.run.id,
        request: {
          mode: "FOLLOW_UP",
          message: { id: randomUUID(), content: "再给我三个版式方案" },
        },
        idempotencyKey: randomUUID(),
        runtime: currentAgentRuntime.descriptor,
      });
      const second = createAgentRunIntervention({
        connection,
        actor,
        sourceRunId: source.run.id,
        request: {
          mode: "STEER",
          message: { id: randomUUID(), content: "改成低饱和并减少装饰" },
        },
        idempotencyKey: randomUUID(),
        runtime: currentAgentRuntime.descriptor,
      });
      const sourceClaim = claimAgentRun({
        connection,
        runId: source.run.id,
        workerId: "source-worker",
      });
      expect(sourceClaim.kind).toBe("CLAIMED");
      failAgentRun({
        connection,
        runId: source.run.id,
        workerId: "source-worker",
        errorCode: "SOURCE_FAILED",
      });

      expect(readAgentRunInterventionContext(connection, first.nextRun.id))
        .toEqual({
          mode: "FOLLOW_UP",
          unansweredMessages: [{
            id: expect.any(String),
            content: "先做一张高对比海报",
          }],
        });
      expect(claimAgentRun({
        connection,
        runId: first.nextRun.id,
        workerId: "first-worker",
      }).kind).toBe("CLAIMED");
      expect(claimAgentRun({
        connection,
        runId: second.nextRun.id,
        workerId: "early-second-worker",
      }).kind).toBe("BUSY");
      failAgentRun({
        connection,
        runId: first.nextRun.id,
        workerId: "first-worker",
        errorCode: "FIRST_FAILED",
      });

      expect(readAgentRunInterventionContext(connection, second.nextRun.id))
        .toEqual({
          mode: "STEER",
          unansweredMessages: [
            { id: expect.any(String), content: "先做一张高对比海报" },
            { id: expect.any(String), content: "再给我三个版式方案" },
          ],
        });
      expect(claimAgentRun({
        connection,
        runId: second.nextRun.id,
        workerId: "second-worker",
      }).kind).toBe("CLAIMED");
      expect(listAgentRunInterventions(
        connection,
        actor,
        source.run.taskId,
      ).interventions.map(({ status }) => status)).toEqual([
        "FAILED",
        "ACTIVE",
      ]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("downgrades a steer that loses the cancellation race without rewriting requests", async () => {
    const { connection, source } = await setup();
    try {
      const created = createAgentRunIntervention({
        connection,
        actor,
        sourceRunId: source.run.id,
        request: {
          mode: "STEER",
          message: { id: randomUUID(), content: "换成克制的黑白方向" },
        },
        idempotencyKey: randomUUID(),
        runtime: currentAgentRuntime.descriptor,
      });
      const sourceRequest = connection.sqlite.prepare(
        "SELECT request_json requestJson FROM agent_runs WHERE id=?",
      ).get(source.run.id) as { requestJson: string };
      expect(claimAgentRun({
        connection,
        runId: source.run.id,
        workerId: "race-worker",
      }).kind).toBe("CLAIMED");
      failAgentRun({
        connection,
        runId: source.run.id,
        workerId: "race-worker",
        errorCode: "SOURCE_FINISHED_FIRST",
      });

      expect(downgradeLateAgentRunSteer({
        connection,
        actor,
        interventionId: created.intervention.id,
      })).toMatchObject({
        requestedMode: "STEER",
        actualMode: "FOLLOW_UP",
      });
      expect(connection.sqlite.prepare(
        "SELECT request_json requestJson FROM agent_runs WHERE id=?",
      ).get(source.run.id)).toEqual(sourceRequest);
    } finally {
      connection.sqlite.close();
    }
  });

  it("creates a steer as follow-up when the source turn is already durable", async () => {
    const { connection, task, source } = await setup();
    try {
      expect(claimAgentRun({
        connection,
        runId: source.run.id,
        workerId: "persisted-worker",
      }).kind).toBe("CLAIMED");
      const conversationId = randomUUID();
      const turnId = randomUUID();
      connection.sqlite.prepare(`
        INSERT INTO agent_conversations(
          id,task_id,student_id,class_id,project_id,course_pack_id,
          course_pack_version,created_at,updated_at
        ) VALUES(?,?,?,'class-1',NULL,'general-design','1',1700000000,1700000000)
      `).run(conversationId, task.id, actor.userId);
      connection.sqlite.prepare(`
        INSERT INTO agent_turns(
          id,run_id,conversation_id,turn_sequence,student_message,episode,
          decision_code,policy_id,policy_version,policy_trace_json,
          response_strategy,response_latency_ms,reply_json,ai_mode,
          source_ids_json,created_at,data_type
        ) VALUES(?,?,?,1,?,'EXPLORE','EXPLORE_FRAME_GOAL','competition-core',
          '1','{}','CLARIFY',10,'{}','DETERMINISTIC_FALLBACK','[]',1700000000,'REAL')
      `).run(
        turnId,
        source.run.id,
        conversationId,
        "先做一张高对比海报",
      );

      const created = createAgentRunIntervention({
        connection,
        actor,
        sourceRunId: source.run.id,
        request: {
          mode: "STEER",
          message: { id: randomUUID(), content: "换成低饱和的方向" },
        },
        idempotencyKey: randomUUID(),
        runtime: currentAgentRuntime.descriptor,
      });
      expect(created).toMatchObject({
        steerShouldCancel: false,
        intervention: {
          requestedMode: "STEER",
          actualMode: "FOLLOW_UP",
        },
      });
    } finally {
      connection.sqlite.close();
    }
  });
});

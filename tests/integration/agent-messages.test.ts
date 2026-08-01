// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareAgentArtwork } from "@/lib/agent/artwork-attachment";
import {
  AgentMessageConflictError,
  appendStudentAgentMessage,
  backfillAgentMessages,
  listStudentAgentMessages,
  listTeacherAgentMessages,
} from "@/lib/agent/agent-message-store";
import { stableToolCallReference } from "@/lib/agent/agent-message-contract";
import {
  createDesignTask,
  deleteDesignTask,
  DesignTaskNotFoundError,
} from "@/lib/agent/design-project-task";
import { AgentConflictError, runAgentTurn } from "@/lib/agent/orchestrator";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { validPng } from "@/tests/helpers/image-fixtures";

const roots: string[] = [];
const student = { userId: "s1", role: "STUDENT" as const };
const otherStudent = { userId: "s2", role: "STUDENT" as const };
const teacher = { userId: "t2", role: "TEACHER" as const };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "lumi-agent-messages-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES
      ('c1','学生班级','MESSAGES-1'),
      ('c2','教师班级','MESSAGES-2');
    INSERT INTO users(id,class_id,role,alias,created_at) VALUES
      ('s1','c1','STUDENT','学生一',1700000000),
      ('s2','c1','STUDENT','学生二',1700000000),
      ('t2','c2','TEACHER','教师二',1700000000);
  `);
  return { connection, root };
}

async function persistTextTurn(connection: DatabaseConnection, message = "请帮我先梳理海报的信息层级") {
  const task = createDesignTask(connection, student, { mode: "conversation" });
  const clientMessageId = randomUUID();
  appendStudentAgentMessage({
    connection,
    actor: student,
    taskId: task.id,
    message: { id: clientMessageId, content: message },
    now: new Date("2026-07-21T10:00:00.000Z"),
  });
  const response = await runAgentTurn(connection, student, {
    taskId: task.id,
    clientMessageId,
    message,
    context: { view: "AGENT", focus: null },
  }, { now: () => new Date("2026-07-21T10:00:01.000Z") });
  return { task, clientMessageId, response };
}

describe("normalized agent message persistence", () => {
  it("persists the selected capability and rejects idempotency drift", async () => {
    const { connection } = await setup();
    try {
      const task = createDesignTask(connection, student, { mode: "conversation" });
      const id = randomUUID();
      const message = {
        id,
        content: "先帮我查课程里的信息层级依据",
        capability: { id: "course-reference", source: "composer" } as const,
      };
      expect(appendStudentAgentMessage({
        connection,
        actor: student,
        taskId: task.id,
        message,
      }).created).toBe(true);
      expect(appendStudentAgentMessage({
        connection,
        actor: student,
        taskId: task.id,
        message,
      }).created).toBe(false);
      expect(listStudentAgentMessages(connection, student, task.id).messages[0]?.structure)
        .toMatchObject({
          kind: "user",
          capability: { id: "course-reference", source: "composer" },
        });
      expect(() => appendStudentAgentMessage({
        connection,
        actor: student,
        taskId: task.id,
        message: {
          ...message,
          capability: { id: "design-calculation", source: "composer" },
        },
      })).toThrow(AgentMessageConflictError);
    } finally {
      connection.sqlite.close();
    }
  });

  it("round-trips one user row and one assistant row without a UI-library blob", async () => {
    const { connection } = await setup();
    try {
      const { task, clientMessageId, response } = await persistTextTurn(connection);
      const restored = listStudentAgentMessages(connection, student, task.id);

      expect(restored.pendingRun).toBeNull();
      expect(restored.messages).toHaveLength(2);
      expect(restored.messages[0]).toMatchObject({
        id: clientMessageId,
        role: "user",
        content: "请帮我先梳理海报的信息层级",
        turnId: response.turnId,
        structure: { version: 1, kind: "user" },
      });
      expect(restored.messages[1]).toMatchObject({
        id: `${response.turnId}#a`,
        role: "assistant",
        content: response.reply.message,
        turnId: response.turnId,
        structure: {
          version: 1,
          kind: "assistant",
          episode: response.episode,
          decisionCode: response.decisionCode,
        },
      });

      const columns = connection.sqlite.prepare("PRAGMA table_info(agent_messages)").all() as Array<{ name: string }>;
      expect(columns.map(({ name }) => name)).not.toEqual(expect.arrayContaining([
        "thread_message_json",
        "assistant_ui_json",
        "message_blob",
      ]));
      const stored = connection.sqlite.prepare(`
        SELECT json_extract(structure_json,'$.version') version,
          json_extract(structure_json,'$.kind') kind
        FROM agent_messages WHERE id=?
      `).get(`${response.turnId}#a`);
      expect(stored).toEqual({ version: 1, kind: "assistant" });

      const teachingFact = connection.sqlite.prepare(`
        SELECT student_message studentMessage,
          json_extract(reply_json,'$.message') replyMessage
        FROM agent_turns WHERE id=?
      `).get(response.turnId);
      expect(teachingFact).toEqual({
        studentMessage: "请帮我先梳理海报的信息层级",
        replyMessage: response.reply.message,
      });
    } finally {
      connection.sqlite.close();
    }
  });

  it("rolls back the turn and assistant row when the prewritten user row does not match", async () => {
    const { connection } = await setup();
    try {
      const task = createDesignTask(connection, student);
      const clientMessageId = randomUUID();
      appendStudentAgentMessage({
        connection,
        actor: student,
        taskId: task.id,
        message: { id: clientMessageId, content: "原始正文" },
      });

      await expect(runAgentTurn(connection, student, {
        taskId: task.id,
        clientMessageId,
        message: "被篡改的正文",
        context: { view: "AGENT", focus: null },
      })).rejects.toBeInstanceOf(AgentConflictError);

      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_turns").get()).toEqual({ count: 0 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_tool_calls").get()).toEqual({ count: 0 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_steps").get()).toEqual({ count: 0 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_messages WHERE role='assistant'").get()).toEqual({ count: 0 });
      expect(connection.sqlite.prepare("SELECT role,turn_id turnId FROM agent_messages WHERE id=?").get(clientMessageId))
        .toEqual({ role: "user", turnId: null });
    } finally {
      connection.sqlite.close();
    }
  });

  it("restores artwork on the user row and reconstructs tool calls from fact tables", async () => {
    const { connection, root } = await setup();
    try {
      const task = createDesignTask(connection, student, { mode: "engineering" });
      const message = "保存这张作品，并告诉我下一步先检查什么";
      const clientMessageId = randomUUID();
      appendStudentAgentMessage({
        connection,
        actor: student,
        taskId: task.id,
        message: { id: clientMessageId, content: message },
      });
      const artwork = await prepareAgentArtwork({ bytes: validPng, declaredMime: "image/png" });
      const response = await runAgentTurn(
        connection,
        student,
        {
          taskId: task.id,
          clientMessageId,
          message,
          context: { view: "AGENT", focus: null },
        },
        { artworkRoot: path.join(root, "private-images") },
        artwork,
      );

      const callId = randomUUID();
      connection.sqlite.prepare(`
        INSERT INTO agent_tool_calls(
          id,turn_id,call_sequence,tool_id,tool_version,adapter_id,input_json,
          output_json,status,error_code,latency_ms,created_at,data_type
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        callId,
        response.turnId,
        1,
        "knowledge-map.search-concepts",
        "1",
        "knowledge-map",
        JSON.stringify({ query: "信息层级" }),
        JSON.stringify({ retrieval: { strategy: "LEXICAL_FALLBACK" }, items: [] }),
        "EMPTY",
        null,
        4,
        1784600001,
        "REAL",
      );
      connection.sqlite.prepare(`
        UPDATE agent_messages SET tool_call_refs_json=?
        WHERE turn_id=? AND role='assistant'
      `).run(JSON.stringify([stableToolCallReference(response.turnId, 1)]), response.turnId);

      const restored = listStudentAgentMessages(connection, student, task.id);
      expect(restored.messages[0]?.attachment).toMatchObject({
        id: artwork.id,
        mimeType: "image/png",
        width: 2,
        height: 2,
      });
      expect(restored.messages[1]?.attachment).toBeNull();
      expect(restored.messages[1]?.toolCalls).toEqual([
        expect.objectContaining({
          id: `${response.turnId}:1`,
          callId,
          toolId: "knowledge-map.search-concepts",
          input: { query: "信息层级" },
          status: "EMPTY",
        }),
      ]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("backfills legacy turns idempotently and allows any valid teacher to read", async () => {
    const { connection } = await setup();
    try {
      const task = createDesignTask(connection, student);
      const response = await runAgentTurn(connection, student, {
        taskId: task.id,
        message: "帮我确定版式入口",
        context: { view: "AGENT", focus: null },
      });
      connection.sqlite.prepare("DELETE FROM agent_messages WHERE task_id=?").run(task.id);

      expect(backfillAgentMessages(connection)).toEqual({ scannedTurns: 1, insertedMessages: 2 });
      expect(backfillAgentMessages(connection)).toEqual({ scannedTurns: 1, insertedMessages: 0 });
      expect(listTeacherAgentMessages(connection, teacher, task.id).messages.map(({ id }) => id))
        .toEqual([`${response.turnId}#u`, `${response.turnId}#a`]);
      expect(() => listStudentAgentMessages(connection, otherStudent, task.id))
        .toThrow(DesignTaskNotFoundError);
    } finally {
      connection.sqlite.close();
    }
  });

  it("deletes the task, teaching facts, message rows and tool calls as one cascade", async () => {
    const { connection } = await setup();
    try {
      const { task, response } = await persistTextTurn(connection);
      const callId = randomUUID();
      connection.sqlite.prepare(`
        INSERT INTO agent_tool_calls(
          id,turn_id,call_sequence,tool_id,tool_version,adapter_id,input_json,
          output_json,status,error_code,latency_ms,created_at,data_type
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        callId, response.turnId, 1, "knowledge-map.search-concepts", "1", "knowledge-map",
        JSON.stringify({ query: "层级" }), JSON.stringify({ items: [] }), "EMPTY", null, 1,
        1784600001, "REAL",
      );

      deleteDesignTask(connection, student, task.id);

      for (const table of [
        "design_project_tasks",
        "agent_conversations",
        "agent_turns",
        "agent_messages",
        "agent_tool_calls",
      ]) {
        expect(connection.sqlite.prepare(`SELECT count(*) count FROM ${table}`).get(), table)
          .toEqual({ count: 0 });
      }
      expect(connection.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      connection.sqlite.close();
    }
  });
});

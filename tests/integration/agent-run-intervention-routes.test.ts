// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET as listInterventions,
  POST as createIntervention,
} from "@/app/api/agent/runs/[runId]/interventions/route";
import { appendStudentAgentMessage } from "@/lib/agent/agent-message-store";
import { createDesignTask } from "@/lib/agent/design-project-task";
import { currentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { createAgentRun } from "@/lib/agent/runtime/run-state-store";
import { SESSION_COOKIE_NAME, issueSession } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const SECRET = "agent-intervention-route-secret-at-least-32-characters";
const actor = { userId: "student-1", role: "STUDENT" as const };

function request(
  url: string,
  token?: string,
  init: { method?: string; body?: unknown; key?: string } = {},
) {
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers: {
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.key ? { "idempotency-key": init.key } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("agent run intervention routes", () => {
  let root: string;
  let databasePath: string;
  let studentToken: string;
  let otherToken: string;
  let teacherToken: string;
  let sourceRunId: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lumi-intervention-route-"));
    databasePath = path.join(root, "agent.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code)
        VALUES('class-1','测试班级','INTERVENTION-ROUTE');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('student-1','class-1','STUDENT','学生一',1700000000),
        ('student-2','class-1','STUDENT','学生二',1700000000),
        ('teacher-1','class-1','TEACHER','教师一',1700000000);
    `);
    const task = createDesignTask(connection, actor, { title: "路由测试" });
    const messageId = randomUUID();
    appendStudentAgentMessage({
      connection,
      actor,
      taskId: task.id,
      message: { id: messageId, content: "先做一张系列海报" },
    });
    sourceRunId = createAgentRun({
      connection,
      actor,
      request: {
        taskId: task.id,
        clientMessageId: messageId,
        message: "先做一张系列海报",
        context: { view: "AGENT" },
      },
      idempotencyKey: randomUUID(),
      runtime: currentAgentRuntime.descriptor,
    }).run.id;
    connection.sqlite.close();

    studentToken = await issueSession(actor, SECRET);
    otherToken = await issueSession(
      { userId: "student-2", role: "STUDENT" },
      SECRET,
    );
    teacherToken = await issueSession(
      { userId: "teacher-1", role: "TEACHER" },
      SECRET,
    );
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("EVIDENCE_ROOT", path.join(root, "evidence"));
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("AGENT_V2_ENABLED", "true");
    vi.stubEnv("AGENT_INTERVENTIONS_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it("persists and lists an owner-only follow-up through the feature-gated API", async () => {
    const context = { params: Promise.resolve({ runId: sourceRunId }) };
    const messageId = randomUUID();
    const created = await createIntervention(request(
      `http://localhost/api/agent/runs/${sourceRunId}/interventions`,
      studentToken,
      {
        method: "POST",
        key: randomUUID(),
        body: {
          mode: "FOLLOW_UP",
          message: { id: messageId, content: "完成后再给三个版式方案" },
        },
      },
    ), context);

    expect(created.status).toBe(202);
    await expect(created.json()).resolves.toMatchObject({
      created: true,
      intervention: {
        sourceRunId,
        userMessageId: messageId,
        actualMode: "FOLLOW_UP",
        status: "QUEUED",
      },
      nextRun: { status: "QUEUED" },
    });
    const listed = await listInterventions(request(
      `http://localhost/api/agent/runs/${sourceRunId}/interventions`,
      studentToken,
    ), context);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      interventions: [{
        sourceRunId,
        userMessageId: messageId,
        queueSequence: 1,
      }],
    });

    expect((await listInterventions(request(
      `http://localhost/api/agent/runs/${sourceRunId}/interventions`,
      otherToken,
    ), context)).status).toBe(404);
    expect((await createIntervention(request(
      `http://localhost/api/agent/runs/${sourceRunId}/interventions`,
      teacherToken,
      {
        method: "POST",
        key: randomUUID(),
        body: {
          mode: "FOLLOW_UP",
          message: { id: randomUUID(), content: "教师越权补充" },
        },
      },
    ), context)).status).toBe(403);
  });

  it("fails closed when the intervention feature flag is disabled", async () => {
    vi.stubEnv("AGENT_INTERVENTIONS_ENABLED", "false");
    const context = { params: Promise.resolve({ runId: sourceRunId }) };
    const response = await listInterventions(request(
      `http://localhost/api/agent/runs/${sourceRunId}/interventions`,
      studentToken,
    ), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "运行中补充暂未启用",
    });
  });
});

// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as approveAgentRun } from "@/app/api/agent/runs/[runId]/approvals/[actionId]/route";
import { POST as cancelAgentRun } from "@/app/api/agent/runs/[runId]/cancel/route";
import { createAgentRunContinueResponse } from "@/app/api/agent/runs/[runId]/continue/handler";
import { createAgentRunRetryResponse } from "@/app/api/agent/runs/[runId]/retry/handler";
import { SESSION_COOKIE_NAME, issueSession } from "@/lib/auth/session";
import { currentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { executeAgentRun } from "@/lib/agent/runtime/agent-run-executor";
import { appendAgentRunEvent } from "@/lib/agent/runtime/agent-run-record";
import { createAgentRun } from "@/lib/agent/runtime/run-state-store";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";

const SECRET = "agent-control-route-session-secret-at-least-32-characters";
const actor = { userId: "student-1", role: "STUDENT" as const };

function request(url: string, token?: string, body?: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("agent run control routes", () => {
  let root: string;
  let databasePath: string;
  let studentToken: string;
  let otherToken: string;
  let teacherToken: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-control-route-"));
    databasePath = path.join(root, "agent.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('class-1','测试班级','RUN-CONTROL-ROUTE');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('student-1','class-1','STUDENT','学生一',1700000000),
        ('student-2','class-1','STUDENT','学生二',1700000000),
        ('teacher-1','class-1','TEACHER','教师一',1700000000);
    `);
    connection.sqlite.close();
    studentToken = await issueSession(actor, SECRET);
    otherToken = await issueSession({ userId: "student-2", role: "STUDENT" }, SECRET);
    teacherToken = await issueSession({ userId: "teacher-1", role: "TEACHER" }, SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("EVIDENCE_ROOT", path.join(root, "evidence"));
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("AGENT_V2_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
  });

  it("returns the stable student-role code for cancel, retry and approval controls", async () => {
    const runId = crypto.randomUUID();
    const actionId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const runContext = { params: Promise.resolve({ runId }) };
    const responses = [
      await cancelAgentRun(request(
        `http://localhost/api/agent/runs/${runId}/cancel`,
        teacherToken,
        { idempotencyKey },
      ), runContext),
      await createAgentRunRetryResponse(request(
        `http://localhost/api/agent/runs/${runId}/retry`,
        teacherToken,
        { idempotencyKey },
      ), runContext, () => { throw new Error("must not schedule"); }),
      await createAgentRunContinueResponse(request(
        `http://localhost/api/agent/runs/${runId}/continue`,
        teacherToken,
        { idempotencyKey },
      ), runContext, () => { throw new Error("must not schedule"); }),
      await approveAgentRun(request(
        `http://localhost/api/agent/runs/${runId}/approvals/${actionId}`,
        teacherToken,
        { decision: "APPROVE", idempotencyKey },
      ), { params: Promise.resolve({ runId, actionId }) }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "仅学生可以执行此操作",
        code: "STUDENT_ROLE_FORBIDDEN",
      });
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  function createQueued(idempotencyKey: string) {
    const connection = createDb(databasePath);
    try {
      return createAgentRun({
        connection,
        actor,
        request: { message: "我想做一个空间装置", context: { view: "AGENT" } },
        idempotencyKey,
        runtime: currentAgentRuntime.descriptor,
      }).run;
    } finally {
      connection.sqlite.close();
    }
  }

  it("cancels only the owner's queued run and rejects malformed requests", async () => {
    const run = createQueued("route-cancel-1");
    const context = { params: Promise.resolve({ runId: run.id }) };
    const key = "11111111-1111-4111-8111-111111111111";
    const response = await cancelAgentRun(request(
      `http://localhost/api/agent/runs/${run.id}/cancel`,
      studentToken,
      { idempotencyKey: key },
    ), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      run: { id: run.id, status: "CANCELLED" },
      alreadyApplied: false,
      abortRequested: false,
    });

    const replay = await cancelAgentRun(request(
      `http://localhost/api/agent/runs/${run.id}/cancel`,
      studentToken,
      { idempotencyKey: key },
    ), context);
    await expect(replay.json()).resolves.toMatchObject({ alreadyApplied: true });
    expect((await cancelAgentRun(request(
      `http://localhost/api/agent/runs/${run.id}/cancel`,
      otherToken,
      { idempotencyKey: key },
    ), context)).status).toBe(404);
    expect((await cancelAgentRun(request(
      `http://localhost/api/agent/runs/${run.id}/cancel`,
      studentToken,
      { idempotencyKey: "not-a-uuid" },
    ), context)).status).toBe(400);
    expect((await cancelAgentRun(request(
      `http://localhost/api/agent/runs/${run.id}/cancel`,
      undefined,
      { idempotencyKey: key },
    ), context)).status).toBe(401);
  });

  it("retries a cancelled run once and schedules only the first application", async () => {
    const run = createQueued("route-retry-1");
    const context = { params: Promise.resolve({ runId: run.id }) };
    await cancelAgentRun(request(
      `http://localhost/api/agent/runs/${run.id}/cancel`,
      studentToken,
      { idempotencyKey: "22222222-2222-4222-8222-222222222222" },
    ), context);
    const scheduled: string[] = [];
    const body = { idempotencyKey: "33333333-3333-4333-8333-333333333333" };
    const first = await createAgentRunRetryResponse(request(
      `http://localhost/api/agent/runs/${run.id}/retry`, studentToken, body,
    ), context, (runId) => scheduled.push(runId));
    expect(first.status).toBe(202);
    await expect(first.json()).resolves.toMatchObject({ run: { status: "QUEUED" }, alreadyApplied: false });
    const replay = await createAgentRunRetryResponse(request(
      `http://localhost/api/agent/runs/${run.id}/retry`, studentToken, body,
    ), context, (runId) => scheduled.push(runId));
    await expect(replay.json()).resolves.toMatchObject({ alreadyApplied: true });
    expect(scheduled).toEqual([run.id]);
  });

  it("continues an owned partial answer through a server-authored run chain", async () => {
    const source = createQueued("route-continue-source");
    const sourceConnection = createDb(databasePath);
    appendAgentRunEvent(sourceConnection, { id: source.id, dataType: "REAL" }, {
      kind: "TOKEN",
      label: "组织回答",
      summary: "已收到新的回答片段。",
      payload: { text: "先确定主标题的位置，再继续调整副标题。" },
      now: new Date("2026-07-26T12:00:00.000Z"),
    });
    sourceConnection.sqlite.close();

    const context = { params: Promise.resolve({ runId: source.id }) };
    await cancelAgentRun(request(
      `http://localhost/api/agent/runs/${source.id}/cancel`,
      studentToken,
      { idempotencyKey: "31111111-1111-4111-8111-111111111111" },
    ), context);

    const scheduled: string[] = [];
    const body = { idempotencyKey: "32222222-2222-4222-8222-222222222222" };
    const first = await createAgentRunContinueResponse(request(
      `http://localhost/api/agent/runs/${source.id}/continue`, studentToken, body,
    ), context, (runId) => scheduled.push(runId));
    expect(first.status).toBe(202);
    const payload = await first.json() as {
      created: boolean;
      run: { id: string; status: string; request?: { continuation?: { sourceRunId: string; attempt: number } } };
    };
    expect(payload).toMatchObject({
      created: true,
      run: {
        status: "QUEUED",
        request: { continuation: { sourceRunId: source.id, attempt: 1 } },
      },
    });
    expect(scheduled).toEqual([payload.run.id]);
    const replay = await createAgentRunContinueResponse(request(
      `http://localhost/api/agent/runs/${source.id}/continue`, studentToken,
      { idempotencyKey: "33333333-3333-4333-8333-333333333333" },
    ), context, (runId) => scheduled.push(runId));
    await expect(replay.json()).resolves.toMatchObject({ created: false, run: { id: payload.run.id } });
    expect(scheduled).toEqual([payload.run.id]);
    expect((await createAgentRunContinueResponse(request(
      `http://localhost/api/agent/runs/${source.id}/continue`, otherToken, body,
    ), context, () => { throw new Error("must not schedule"); })).status).toBe(404);
    expect((await createAgentRunContinueResponse(request(
      `http://localhost/api/agent/runs/${source.id}/continue`, studentToken, { idempotencyKey: "not-a-uuid" },
    ), context, () => { throw new Error("must not schedule"); })).status).toBe(400);
  });

  it("settles a durable approval through the owner-only route", async () => {
    const connection = createDb(databasePath);
    await ingestCoursePackKnowledge(connection);
    const created = createAgentRun({
      connection,
      actor,
      request: { message: "声音有数值了，但画面为什么还是不动？", context: { view: "NODE_CANVAS" } },
      idempotencyKey: "route-approval-1",
      runtime: currentAgentRuntime.descriptor,
    });
    connection.sqlite.close();
    const waiting = await executeAgentRun(created.run.id, process.env);
    expect(waiting.status).toBe("WAITING_APPROVAL");
    const actionId = waiting.result!.reply.actions[0]!.id;
    const context = { params: Promise.resolve({ runId: created.run.id, actionId }) };
    const body = {
      decision: "APPROVE" as const,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    };
    const approved = await approveAgentRun(request(
      `http://localhost/api/agent/runs/${created.run.id}/approvals/${actionId}`,
      studentToken,
      body,
    ), context);
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({
      run: { status: "COMPLETED", result: { reply: { actions: [{ status: "EXECUTED" }] } } },
      action: { id: actionId, status: "EXECUTED", alreadyApplied: false },
    });
    const replay = await approveAgentRun(request(
      `http://localhost/api/agent/runs/${created.run.id}/approvals/${actionId}`,
      studentToken,
      body,
    ), context);
    await expect(replay.json()).resolves.toMatchObject({ action: { alreadyApplied: true } });
    expect((await approveAgentRun(request(
      `http://localhost/api/agent/runs/${created.run.id}/approvals/${actionId}`,
      otherToken,
      body,
    ), context)).status).toBe(404);
  });
});

// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getCurrentAgentRun } from "@/app/api/agent/runs/route";
import { GET as getAgentRun } from "@/app/api/agent/runs/[runId]/route";
import { GET as getAgentRunEvents } from "@/app/api/agent/runs/[runId]/events/route";
import { GET as streamAgentRunEvents } from "@/app/api/agent/runs/[runId]/events/stream/route";
import { createAgentRunResponse } from "@/lib/agent/runtime/create-agent-run-response";
import { executeAgentRun } from "@/lib/agent/runtime/agent-run-executor";
import { SESSION_COOKIE_NAME, issueSession } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { validPng } from "@/tests/helpers/image-fixtures";

const SECRET = "agent-run-route-session-secret-at-least-32-characters";

function request(
  url: string,
  token?: string,
  init: { method?: string; headers?: HeadersInit; body?: BodyInit } = {},
) {
  return new NextRequest(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
    },
  });
}

async function artworkRunRequest(token: string, idempotencyKey: string) {
  const form = new FormData();
  form.set("payload", JSON.stringify({ message: "帮我看看这张海报的层级", context: { view: "AGENT", focus: null } }));
  form.set("artwork", new File([validPng], "poster.png", { type: "image/png" }));
  const serialized = new Request("http://localhost/api/agent/runs", { method: "POST", body: form });
  const bytes = await serialized.arrayBuffer();
  return request("http://localhost/api/agent/runs", token, {
    method: "POST",
    headers: {
      "content-type": serialized.headers.get("content-type")!,
      "content-length": String(bytes.byteLength),
      "idempotency-key": idempotencyKey,
    },
    body: bytes,
  });
}

describe("agent run routes", () => {
  let root: string;
  let databasePath: string;
  let studentToken: string;
  let otherToken: string;
  let teacherToken: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-run-route-"));
    databasePath = path.join(root, "agent.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('class-1','测试班级','RUN-ROUTE');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('student-1','class-1','STUDENT','学生一',1700000000),
        ('student-2','class-1','STUDENT','学生二',1700000000),
        ('teacher-1','class-1','TEACHER','教师一',1700000000);
    `);
    connection.sqlite.close();
    studentToken = await issueSession({ userId: "student-1", role: "STUDENT" }, SECRET);
    otherToken = await issueSession({ userId: "student-2", role: "STUDENT" }, SECRET);
    teacherToken = await issueSession({ userId: "teacher-1", role: "TEACHER" }, SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("EVIDENCE_ROOT", path.join(root, "evidence"));
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("AGENT_V2_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
  });

  it("returns the stable student-role code before creating or streaming a run", async () => {
    const runId = crypto.randomUUID();
    const context = { params: Promise.resolve({ runId }) };
    const responses = [
      await getCurrentAgentRun(request("http://localhost/api/agent/runs", teacherToken)),
      await getAgentRun(request(`http://localhost/api/agent/runs/${runId}`, teacherToken), context),
      await getAgentRunEvents(request(`http://localhost/api/agent/runs/${runId}/events`, teacherToken), context),
      await streamAgentRunEvents(request(`http://localhost/api/agent/runs/${runId}/events/stream`, teacherToken), context),
      await createAgentRunResponse(request(
        "http://localhost/api/agent/runs",
        teacherToken,
        {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "teacher-run-denied" },
          body: JSON.stringify({ message: "教师不能创建学生运行", context: { view: "AGENT" } }),
        },
      ), () => { throw new Error("must not schedule"); }),
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

  it("creates a queued run and schedules only its durable id", async () => {
    const scheduled: string[] = [];
    const response = await createAgentRunResponse(request(
      "http://localhost/api/agent/runs",
      studentToken,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "route-request-1" },
        body: JSON.stringify({ message: "我想做一个产品设计", context: { view: "AGENT" } }),
      },
    ), (runId) => scheduled.push(runId));
    expect(response.status).toBe(202);
    const payload = await response.json() as { run: { id: string; status: string }; created: boolean };
    expect(payload).toMatchObject({ created: true, run: { status: "QUEUED" } });
    expect(scheduled).toEqual([payload.run.id]);
    expect(response.headers.get("location")).toBe(`/api/agent/runs/${payload.run.id}`);
  });

  it("allows the owner to resume state and events but hides cross-student runs", async () => {
    const createdResponse = await createAgentRunResponse(request(
      "http://localhost/api/agent/runs",
      studentToken,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "route-request-2" },
        body: JSON.stringify({ message: "我想做一个空间装置", context: { view: "AGENT" } }),
      },
    ), () => undefined);
    const created = await createdResponse.json() as { run: { id: string } };
    const context = { params: Promise.resolve({ runId: created.run.id }) };

    const ownRun = await getAgentRun(request(`http://localhost/api/agent/runs/${created.run.id}`, studentToken), context);
    expect(ownRun.status).toBe(200);
    await expect(ownRun.json()).resolves.toMatchObject({ run: { id: created.run.id, status: "QUEUED" } });

    const events = await getAgentRunEvents(request(
      `http://localhost/api/agent/runs/${created.run.id}/events?after=0`, studentToken,
    ), context);
    expect(events.status).toBe(200);
    await expect(events.json()).resolves.toMatchObject({
      runId: created.run.id,
      events: [{ sequence: 1, kind: "RUN_CREATED" }],
      nextEventSequence: 2,
    });

    const hidden = await getAgentRun(request(`http://localhost/api/agent/runs/${created.run.id}`, otherToken), context);
    expect(hidden.status).toBe(404);
    const hiddenEvents = await getAgentRunEvents(request(
      `http://localhost/api/agent/runs/${created.run.id}/events`, otherToken,
    ), context);
    expect(hiddenEvents.status).toBe(404);

    const stream = await streamAgentRunEvents(request(
      `http://localhost/api/agent/runs/${created.run.id}/events/stream?after=0`, studentToken,
    ), context);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.headers.get("x-accel-buffering")).toBe("no");
    const reader = stream.body!.getReader();
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toContain("event: agent-run-event");
    expect(new TextDecoder().decode(chunk.value)).toContain("\"kind\":\"RUN_CREATED\"");
    await reader.cancel();

    const hiddenStream = await streamAgentRunEvents(request(
      `http://localhost/api/agent/runs/${created.run.id}/events/stream`, otherToken,
    ), context);
    expect(hiddenStream.status).toBe(404);
  });

  it("restores the latest task run from the database and stops surfacing it after completion", async () => {
    const createdResponse = await createAgentRunResponse(request(
      "http://localhost/api/agent/runs",
      studentToken,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "route-current-1" },
        body: JSON.stringify({ message: "继续包装设计", context: { view: "AGENT" } }),
      },
    ), () => undefined);
    const created = await createdResponse.json() as { run: { id: string } };

    const current = await getCurrentAgentRun(request("http://localhost/api/agent/runs", studentToken));
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      run: { id: created.run.id, status: "QUEUED", request: { message: "继续包装设计" } },
      nextEventSequence: 2,
    });

    const connection = createDb(databasePath);
    connection.sqlite.prepare("UPDATE agent_runs SET status='COMPLETED', completed_at=1700000002, updated_at=1700000002 WHERE id=?").run(created.run.id);
    connection.sqlite.close();
    const afterCompletion = await getCurrentAgentRun(request("http://localhost/api/agent/runs", studentToken));
    await expect(afterCompletion.json()).resolves.toEqual({ run: null, nextEventSequence: 1 });

    const other = await getCurrentAgentRun(request("http://localhost/api/agent/runs", otherToken));
    expect(other.status).toBe(200);
    await expect(other.json()).resolves.toEqual({ run: null, nextEventSequence: 1 });
  });

  it("persists one validated artwork input for the background run and promotes it into the durable turn", async () => {
    const first = await createAgentRunResponse(await artworkRunRequest(studentToken, "route-artwork-1"), () => undefined);
    expect(first.status).toBe(202);
    const created = await first.json() as { run: { id: string }; created: boolean };
    expect(created.created).toBe(true);

    const repeated = await createAgentRunResponse(await artworkRunRequest(studentToken, "route-artwork-1"), () => undefined);
    await expect(repeated.json()).resolves.toMatchObject({ created: false, run: { id: created.run.id } });
    const before = createDb(databasePath);
    expect(before.sqlite.prepare("SELECT count(*) count FROM agent_run_artwork_inputs WHERE run_id=?").get(created.run.id)).toEqual({ count: 1 });
    before.sqlite.close();

    const finished = await executeAgentRun(created.run.id);
    expect(finished.result?.artworkAttachment).toMatchObject({ mimeType: "image/png", width: 2, height: 2 });
    const after = createDb(databasePath);
    expect(after.sqlite.prepare("SELECT count(*) count FROM agent_run_artwork_inputs WHERE run_id=?").get(created.run.id)).toEqual({ count: 0 });
    expect(after.sqlite.prepare("SELECT count(*) count FROM agent_artwork_attachments WHERE turn_id=?").get(finished.result?.turnId)).toEqual({ count: 1 });
    after.sqlite.close();
  });

  it("rejects invalid idempotency keys without scheduling work", async () => {
    const scheduled: string[] = [];
    const response = await createAgentRunResponse(request(
      "http://localhost/api/agent/runs",
      studentToken,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "bad key with spaces" },
        body: JSON.stringify({ message: "测试", context: { view: "AGENT" } }),
      },
    ), (runId) => scheduled.push(runId));
    expect(response.status).toBe(400);
    expect(scheduled).toEqual([]);
  });

  it("rejects a browser-authored continuation chain", async () => {
    const scheduled: string[] = [];
    const response = await createAgentRunResponse(request(
      "http://localhost/api/agent/runs",
      studentToken,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "forged-continuation-1" },
        body: JSON.stringify({
          message: "伪造续写链路",
          context: { view: "AGENT" },
          continuation: {
            sourceRunId: "11111111-1111-4111-8111-111111111111",
            previousText: "不应由浏览器提供的正文",
            attempt: 1,
          },
        }),
      },
    ), (runId) => scheduled.push(runId));
    expect(response.status).toBe(400);
    expect(scheduled).toEqual([]);
  });

  it("rejects unauthenticated and archived-task creation before scheduling", async () => {
    const body = JSON.stringify({ message: "继续旧任务", context: { view: "AGENT" } });
    const unauthenticated = await createAgentRunResponse(request(
      "http://localhost/api/agent/runs",
      undefined,
      { method: "POST", headers: { "content-type": "application/json" }, body },
    ), () => { throw new Error("must not schedule"); });
    expect(unauthenticated.status).toBe(401);

    const taskId = "11111111-1111-4111-8111-111111111111";
    const connection = createDb(databasePath);
    connection.sqlite.prepare(`
      INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type)
      VALUES(?, 'student-1', 'class-1', '已归档任务', 'ARCHIVED', 1700000000, 1700000000, 'REAL')
    `).run(taskId);
    connection.sqlite.close();
    const scheduled: string[] = [];
    const archived = await createAgentRunResponse(request(
      "http://localhost/api/agent/runs",
      studentToken,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "archived-task-1" },
        body: JSON.stringify({ taskId, message: "继续旧任务", context: { view: "AGENT" } }),
      },
    ), (runId) => scheduled.push(runId));
    expect(archived.status).toBe(409);
    expect(scheduled).toEqual([]);
  });
});

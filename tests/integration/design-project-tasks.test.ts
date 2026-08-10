// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as conversationGet } from "@/app/api/agent/conversation/route";
import { GET as tasksGet, POST as tasksPost } from "@/app/api/agent/tasks/route";
import {
  DELETE as taskDelete,
  GET as taskGet,
  PATCH as taskPatch,
} from "@/app/api/agent/tasks/[taskId]/route";
import { POST as turnPost } from "@/app/api/agent/turn/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const SECRET = "design-session-secret-at-least-32-characters";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

function request(url: string, token: string, method = "GET", body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { cookie: cookie(token), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("design project tasks", () => {
  let directory: string;
  let databasePath: string;
  let firstToken: string;
  let secondToken: string;
  let teacherToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-design-tasks-"));
    databasePath = path.join(directory, "agent.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','设计班','DESIGN');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('s1','c1','STUDENT','学生一',1700000000),
        ('s2','c1','STUDENT','学生二',1700000000),
        ('t1','c1','TEACHER','教师一',1700000000);
    `);
    connection.sqlite.close();
    firstToken = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    secondToken = await issueSession({ userId: "s2", role: "STUDENT" }, SECRET);
    teacherToken = await issueSession({ userId: "t1", role: "TEACHER" }, SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("AUTH_PROXY_SECRET", "design-proxy-secret-at-least-32-characters");
    vi.stubEnv("AGENT_V2_ENABLED", "true");
  });

  it("marks only a teacher role mismatch as an identity 403", async () => {
    const teacher = await tasksGet(request("http://localhost/api/agent/tasks", teacherToken));
    expect(teacher.status).toBe(403);
    await expect(teacher.json()).resolves.toEqual({
      error: "仅学生可以执行此操作",
      code: "STUDENT_ROLE_FORBIDDEN",
    });

    const crossSite = await tasksGet(new NextRequest("http://localhost/api/agent/tasks", {
      headers: {
        cookie: cookie(firstToken),
        "sec-fetch-site": "cross-site",
      },
    }));
    expect(crossSite.status).toBe(403);
    const sourcePayload = await crossSite.json() as Record<string, unknown>;
    expect(sourcePayload).toEqual({ error: "请求来源无效" });
    expect(sourcePayload).not.toHaveProperty("code");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates, renames, archives and protects owned tasks", async () => {
    const createdResponse = await tasksPost(request("http://localhost/api/agent/tasks", firstToken, "POST", { title: "品牌更新" }));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { id: string };

    const listed = await tasksGet(request("http://localhost/api/agent/tasks", firstToken));
    await expect(listed.json()).resolves.toMatchObject({ tasks: [{
      id: created.id,
      title: "品牌更新",
      status: "ACTIVE",
      mode: "conversation",
      pinned: false,
    }] });

    const renamed = await taskPatch(request(`http://localhost/api/agent/tasks/${created.id}`, firstToken, "PATCH", {
      title: "品牌视觉更新",
      mode: "engineering",
      pinned: true,
    }), { params: Promise.resolve({ taskId: created.id }) });
    await expect(renamed.json()).resolves.toMatchObject({
      id: created.id,
      title: "品牌视觉更新",
      mode: "engineering",
      pinned: true,
    });

    const single = await taskGet(request(`http://localhost/api/agent/tasks/${created.id}`, firstToken), { params: Promise.resolve({ taskId: created.id }) });
    await expect(single.json()).resolves.toMatchObject({ id: created.id, mode: "engineering", pinned: true });

    const denied = await taskPatch(request(`http://localhost/api/agent/tasks/${created.id}`, secondToken, "PATCH", { title: "越权修改" }), { params: Promise.resolve({ taskId: created.id }) });
    expect(denied.status).toBe(404);

    const archived = await taskPatch(request(`http://localhost/api/agent/tasks/${created.id}`, firstToken, "PATCH", { status: "ARCHIVED" }), { params: Promise.resolve({ taskId: created.id }) });
    await expect(archived.json()).resolves.toMatchObject({ status: "ARCHIVED" });

    const deleted = await taskDelete(request(`http://localhost/api/agent/tasks/${created.id}`, firstToken, "DELETE"), { params: Promise.resolve({ taskId: created.id }) });
    expect(deleted.status).toBe(200);
    const missing = await taskGet(request(`http://localhost/api/agent/tasks/${created.id}`, firstToken), { params: Promise.resolve({ taskId: created.id }) });
    expect(missing.status).toBe(404);
  });

  it("keeps conversations and project briefs isolated by task", async () => {
    const poster = await (await tasksPost(request("http://localhost/api/agent/tasks", firstToken, "POST", { title: "展览海报" }))).json() as { id: string };
    const product = await (await tasksPost(request("http://localhost/api/agent/tasks", firstToken, "POST", { title: "儿童座椅" }))).json() as { id: string };

    expect((await turnPost(request("http://localhost/api/agent/turn", firstToken, "POST", {
      taskId: poster.id,
      message: "我想做一张酷一点的展览海报",
      context: { view: "AGENT", focus: null },
    }))).status).toBe(201);
    expect((await turnPost(request("http://localhost/api/agent/turn", firstToken, "POST", {
      taskId: product.id,
      message: "我想做一把适合儿童阅读的座椅",
      context: { view: "AGENT", focus: null },
    }))).status).toBe(201);

    const posterConversation = await (await conversationGet(request(`http://localhost/api/agent/conversation?view=AGENT&taskId=${poster.id}`, firstToken))).json() as { taskId: string; turns: Array<{ studentMessage: string }> };
    const productConversation = await (await conversationGet(request(`http://localhost/api/agent/conversation?view=AGENT&taskId=${product.id}`, firstToken))).json() as { taskId: string; turns: Array<{ studentMessage: string }> };
    expect(posterConversation).toMatchObject({ taskId: poster.id, turns: [{ studentMessage: "我想做一张酷一点的展览海报" }] });
    expect(productConversation).toMatchObject({ taskId: product.id, turns: [{ studentMessage: "我想做一把适合儿童阅读的座椅" }] });

    await taskPatch(request(`http://localhost/api/agent/tasks/${product.id}`, firstToken, "PATCH", { status: "ARCHIVED" }), { params: Promise.resolve({ taskId: product.id }) });
    const archivedTurn = await turnPost(request("http://localhost/api/agent/turn", firstToken, "POST", {
      taskId: product.id,
      message: "继续",
      context: { view: "AGENT", focus: null },
    }));
    expect(archivedTurn.status).toBe(409);
  });
});

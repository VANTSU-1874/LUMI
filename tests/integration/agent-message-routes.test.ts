// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET as studentMessagesGet,
  POST as studentMessagesPost,
} from "@/app/api/agent/tasks/[taskId]/messages/route";
import { GET as teacherMessagesGet } from "@/app/api/teacher/agent/tasks/[taskId]/messages/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDesignTask } from "@/lib/agent/design-project-task";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const SECRET = "message-route-session-secret-at-least-32-characters";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

function request(url: string, token: string, method = "GET", body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: {
      cookie: cookie(token),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("agent message routes", () => {
  let directory: string;
  let databasePath: string;
  let taskId: string;
  let studentToken: string;
  let otherStudentToken: string;
  let teacherToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lumi-message-routes-"));
    databasePath = path.join(directory, "agent.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES
        ('c1','学生班','ROUTE-1'),
        ('c2','教师班','ROUTE-2');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('s1','c1','STUDENT','学生一',1700000000),
        ('s2','c1','STUDENT','学生二',1700000000),
        ('t2','c2','TEACHER','教师二',1700000000);
    `);
    taskId = createDesignTask(connection, { userId: "s1", role: "STUDENT" }).id;
    connection.sqlite.close();

    studentToken = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    otherStudentToken = await issueSession({ userId: "s2", role: "STUDENT" }, SECRET);
    teacherToken = await issueSession({ userId: "t2", role: "TEACHER" }, SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("AUTH_PROXY_SECRET", "message-route-proxy-secret-at-least-32-chars");
    vi.stubEnv("AGENT_V2_ENABLED", "true");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("appends idempotently for the owner and denies another student", async () => {
    const id = randomUUID();
    const url = `http://localhost/api/agent/tasks/${taskId}/messages`;
    const context = { params: Promise.resolve({ taskId }) };
    const first = await studentMessagesPost(request(url, studentToken, "POST", {
      id,
      content: "先确认目标和观看场景",
    }), context);
    expect(first.status).toBe(201);
    await expect(first.json()).resolves.toMatchObject({ created: true, message: { id, role: "user" } });

    const duplicate = await studentMessagesPost(request(url, studentToken, "POST", {
      id,
      content: "先确认目标和观看场景",
    }), context);
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ created: false });

    const ownerRead = await studentMessagesGet(request(url, studentToken), context);
    await expect(ownerRead.json()).resolves.toMatchObject({ taskId, messages: [{ id }] });

    const denied = await studentMessagesGet(request(url, otherStudentToken), context);
    expect(denied.status).toBe(404);
  });

  it("allows a valid teacher from another class to read but not append", async () => {
    const id = randomUUID();
    const studentUrl = `http://localhost/api/agent/tasks/${taskId}/messages`;
    const teacherUrl = `http://localhost/api/teacher/agent/tasks/${taskId}/messages`;
    const context = { params: Promise.resolve({ taskId }) };
    await studentMessagesPost(request(studentUrl, studentToken, "POST", {
      id,
      content: "请帮我梳理构图层级",
    }), context);

    const teacherRead = await teacherMessagesGet(request(teacherUrl, teacherToken), context);
    expect(teacherRead.status).toBe(200);
    await expect(teacherRead.json()).resolves.toMatchObject({ messages: [{ id }] });

    const studentAtTeacherRoute = await teacherMessagesGet(request(teacherUrl, studentToken), context);
    expect(studentAtTeacherRoute.status).toBe(403);
  });
});

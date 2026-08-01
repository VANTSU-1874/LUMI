// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET, POST, PUT } from "@/app/api/book-layout/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const SECRET = "book-layout-route-session-secret-at-least-32-characters";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;
const pageOrder = ["cover", "quick-start", "activity-map", "featured-activity", "calendar", "community-voices", "join-us", "contact"];

function request(method: "GET" | "PUT" | "POST" | "DELETE", token?: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/book-layout", {
    method,
    headers: {
      ...(token ? { cookie: cookie(token) } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("book layout public route", () => {
  let directory: string;
  let studentToken: string;
  let teacherToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-book-layout-route-"));
    const databasePath = path.join(directory, "book-layout.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','书籍设计班','BOOK-CLASS');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('s1','c1','STUDENT','学习者',1700000000),
          ('t1','c1','TEACHER','教师',1700000000);
      `);
    } finally {
      connection.sqlite.close();
    }
    studentToken = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    teacherToken = await issueSession({ userId: "t1", role: "TEACHER" }, SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("AUTH_PROXY_SECRET", "book-layout-route-proxy-secret-at-least-32-characters");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("saves and restores a partial draft, then resets it without deleting evidence", async () => {
    const draftBody = {
      audience: "COMMUNITY_RESIDENTS",
      pageOrder,
      diagnosticAnswers: ["AUDIENCE_FIRST", null, null],
      transferChoices: ["COMMUNITY_ENTRY_FIRST"],
    };
    const saved = await PUT(request("PUT", studentToken, draftBody));
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ audience: "COMMUNITY_RESIDENTS", diagnosticAnswers: ["AUDIENCE_FIRST", null, null] });

    const restored = await GET(request("GET", studentToken));
    await expect(restored.json()).resolves.toMatchObject({ resume: { audience: "COMMUNITY_RESIDENTS" }, latest: null });

    const evidenceBody = {
      ...draftBody,
      audience: "NEW_STUDENTS",
      diagnosticAnswers: ["AUDIENCE_FIRST", "TASK_FIRST", "AUDIENCE_FIRST"],
      transferChoices: [],
    };
    const submitted = await POST(request("POST", studentToken, evidenceBody));
    expect(submitted.status).toBe(201);
    const evidence = await submitted.json();
    expect(evidence).toMatchObject({ passed: true, score: 4 });

    const reset = await DELETE(request("DELETE", studentToken, { reset: true }));
    expect(reset.status).toBe(200);
    await expect(reset.json()).resolves.toMatchObject({ reset: true, resume: null, latest: { id: evidence.id } });
    const afterReset = await GET(request("GET", studentToken));
    await expect(afterReset.json()).resolves.toMatchObject({ resume: null, latest: { id: evidence.id } });
  });

  it("enforces student sessions, JSON protocol and strict reset confirmation", async () => {
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await PUT(request("PUT", teacherToken, {}))).status).toBe(403);
    const nonJson = new NextRequest("http://localhost/api/book-layout", {
      method: "DELETE",
      headers: { cookie: cookie(studentToken), "content-type": "text/plain" },
      body: "reset",
    });
    expect((await DELETE(nonJson)).status).toBe(415);
    expect((await DELETE(request("DELETE", studentToken, { reset: false }))).status).toBe(400);
    expect((await DELETE(request("DELETE", studentToken, { reset: true }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });
});

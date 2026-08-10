// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as studentPost } from "@/app/api/auth/student/route";
import { POST as teacherPost } from "@/app/api/auth/teacher/route";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { issueStudentIdentityCode } from "@/lib/auth/identity-code";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";
import { signTrustedSource } from "@/lib/auth/trusted-source";

const SESSION_SECRET = "route-test-session-secret-at-least-32-characters";
const TEACHER_CODE = "private-teacher-code";
const IDENTITY_CODE_PEPPER = "route-test-identity-pepper-at-least-32-characters";
const AUTH_PROXY_SECRET = "route-test-auth-proxy-secret-at-least-32-characters";

function trustedHeaders(sourceId = "test-browser", date = new Date()) {
  const timestamp = Math.floor(date.getTime() / 1_000).toString();
  return {
    "x-tonggan-source-id": sourceId,
    "x-tonggan-source-timestamp": timestamp,
    "x-tonggan-source-signature": signTrustedSource(
      sourceId,
      timestamp,
      AUTH_PROXY_SECRET,
    ),
  };
}

function jsonRequest(pathname: string, body: unknown) {
  return new NextRequest(`http://localhost${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...trustedHeaders() },
    body: JSON.stringify(body),
  });
}

function requestWithHeaders(
  pathname: string,
  body: string,
  headers: Record<string, string>,
) {
  return new NextRequest(`http://localhost${pathname}`, {
    method: "POST",
    headers,
    body,
  });
}

describe("authentication routes", () => {
  let temporaryDirectory: string;
  let databasePath: string;
  let identityCode!: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "tonggan-routes-"));
    databasePath = path.join(temporaryDirectory, "routes.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite
        .prepare("INSERT INTO classes (id, name, access_code) VALUES (?, ?, ?)")
        .run("class-1", "一班", "CLASS001");
      identityCode = issueStudentIdentityCode(connection.db, {
        classId: "class-1",
        pepper: IDENTITY_CODE_PEPPER,
      });
    } finally {
      connection.sqlite.close();
    }

    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SESSION_SECRET);
    vi.stubEnv("TEACHER_ACCESS_CODE", TEACHER_CODE);
    vi.stubEnv("IDENTITY_CODE_PEPPER", IDENTITY_CODE_PEPPER);
    vi.stubEnv("AUTH_PROXY_SECRET", AUTH_PROXY_SECRET);
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("sets a secure 12-hour student session cookie", async () => {
    const response = await studentPost(
      jsonRequest("/api/auth/student", {
        classCode: "CLASS001",
        alias: identityCode,
      }),
    );
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(cookie?.value).toEqual(expect.any(String));
    await expect(verifySession(cookie!.value, SESSION_SECRET)).resolves.toMatchObject({
      role: "STUDENT",
    });
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/Max-Age=43200/i);
    expect(setCookie).toMatch(/Secure/i);
  });

  it.each([
    ["student", "/api/auth/student", studentPost],
    ["teacher", "/api/auth/teacher", teacherPost],
  ] as const)("rejects %s text/plain requests with 415", async (_channel, path, post) => {
    const response = await post(
      requestWithHeaders(path, "not-json", { "content-type": "text/plain" }),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "请求格式不受支持",
    });
  });

  it.each([
    [
      "student",
      "/api/auth/student",
      studentPost,
      { classCode: "CLASS001", alias: identityCode },
    ],
    ["teacher", "/api/auth/teacher", teacherPost, { code: TEACHER_CODE }],
  ] as const)("rejects %s cross-origin requests with 403", async (_channel, path, post, body) => {
    const response = await post(
      requestWithHeaders(path, JSON.stringify(body), {
        "content-type": "application/json",
        origin: "https://attacker.example",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "请求来源无效",
    });
  });

  it("rejects Sec-Fetch-Site cross-site even without Origin", async () => {
    const response = await studentPost(
      requestWithHeaders(
        "/api/auth/student",
        JSON.stringify({ classCode: "CLASS001", alias: identityCode }),
        {
          "content-type": "application/json",
          "sec-fetch-site": "cross-site",
        },
      ),
    );

    expect(response.status).toBe(403);
  });

  it("accepts an explicit same-origin request", async () => {
    const response = await teacherPost(
      requestWithHeaders(
        "/api/auth/teacher",
        JSON.stringify({ code: TEACHER_CODE }),
        {
          "content-type": "application/json; charset=utf-8",
          origin: "http://localhost",
          "sec-fetch-site": "same-origin",
          ...trustedHeaders(),
        },
      ),
    );

    expect(response.status).toBe(200);
    const connection = createDb(databasePath);
    try {
      expect(connection.sqlite.prepare("SELECT id,class_id,role FROM users WHERE id='teacher'").get())
        .toEqual({ id: "teacher", class_id: null, role: "TEACHER" });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM users WHERE id='demo-teacher'").get()).toEqual({ count: 0 });
    } finally { connection.sqlite.close(); }
  });

  it("never overwrites a conflicting persisted role while establishing the audit identity", async () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.prepare("INSERT INTO users (id,class_id,role,alias,created_at) VALUES ('teacher','class-1','STUDENT','冲突身份',1700000000)").run();
    } finally { connection.sqlite.close(); }

    const response = await teacherPost(jsonRequest("/api/auth/teacher", { code: TEACHER_CODE }));
    expect(response.status).toBe(500);
    const reopened = createDb(databasePath);
    try {
      expect(reopened.sqlite.prepare("SELECT class_id,role,alias FROM users WHERE id='teacher'").get())
        .toEqual({ class_id: "class-1", role: "STUDENT", alias: "冲突身份" });
    } finally { reopened.sqlite.close(); }
  });

  it("rejects a teacher id already scoped to a class without overwriting it", async () => {
    const connection = createDb(databasePath);
    try {
      connection.sqlite.prepare("INSERT INTO users (id,class_id,role,alias,created_at) VALUES ('teacher','class-1','TEACHER','班级教师冲突',1700000000)").run();
    } finally { connection.sqlite.close(); }

    const response = await teacherPost(jsonRequest("/api/auth/teacher", { code: TEACHER_CODE }));
    expect(response.status).toBe(500);
    const reopened = createDb(databasePath);
    try {
      expect(reopened.sqlite.prepare("SELECT class_id,role,alias FROM users WHERE id='teacher'").get())
        .toEqual({ class_id: "class-1", role: "TEACHER", alias: "班级教师冲突" });
    } finally { reopened.sqlite.close(); }
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await teacherPost(
      requestWithHeaders("/api/auth/teacher", "{", {
        "content-type": "application/json",
      }),
    );

    expect(response.status).toBe(400);
  });

  it.each([
    ["missing", {}],
    [
      "forged",
      {
        ...trustedHeaders("signed-source"),
        "x-tonggan-source-id": "attacker-source",
      },
    ],
    [
      "expired",
      trustedHeaders("expired-source", new Date(Date.now() - 61_000)),
    ],
  ])("rejects %s trusted-source headers in production", async (_case, sourceHeaders) => {
    const response = await teacherPost(
      requestWithHeaders(
        "/api/auth/teacher",
        JSON.stringify({ code: TEACHER_CODE }),
        { "content-type": "application/json", ...sourceHeaders },
      ),
    );

    expect(response.status).toBe(403);
  });

  it("returns a generic 500 when valid input meets invalid server env", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await teacherPost(
        jsonRequest("/api/auth/teacher", { code: TEACHER_CODE }),
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "服务暂时不可用",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("accepts the browser origin when Next canonicalizes a loopback host differently", async () => {
    const response = await teacherPost(
      requestWithHeaders(
        "/api/auth/teacher",
        JSON.stringify({ code: TEACHER_CODE }),
        {
          "content-type": "application/json; charset=utf-8",
          host: "127.0.0.1:3313",
          origin: "http://127.0.0.1:3313",
          "sec-fetch-site": "same-origin",
          ...trustedHeaders(),
        },
      ),
    );

    expect(response.status).toBe(200);
  });

  it("does not trust a forged forwarded host for source validation", async () => {
    const response = await teacherPost(
      requestWithHeaders(
        "/api/auth/teacher",
        JSON.stringify({ code: TEACHER_CODE }),
        {
          "content-type": "application/json; charset=utf-8",
          host: "localhost",
          origin: "https://attacker.example",
          "x-forwarded-host": "attacker.example",
          "sec-fetch-site": "same-origin",
          ...trustedHeaders(),
        },
      ),
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 for malformed student input", async () => {
    const response = await studentPost(
      jsonRequest("/api/auth/student", { classCode: "CLASS001" }),
    );

    expect(response.status).toBe(400);
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it.each([
    ["blank", "   "],
    ["overlong", "C".repeat(65)],
  ])("returns 400 for a %s class code", async (_case, classCode) => {
    const response = await studentPost(
      jsonRequest("/api/auth/student", { classCode, alias: identityCode }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "输入信息无效",
    });
  });

  it.each(["S01", "7K9M_2Q4R_P8TX", "AAAA-AAAA-AAAA"])(
    "returns 400 for an invalid identity code: %s",
    async (alias) => {
      const response = await studentPost(
        jsonRequest("/api/auth/student", { classCode: "CLASS001", alias }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "输入信息无效",
      });
    },
  );

  it("returns the same invalid-identity response for an unissued well-formed code", async () => {
    const response = await studentPost(
      jsonRequest("/api/auth/student", {
        classCode: "CLASS001",
        alias: "9Z8Y-7X6W-5V4U",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "匿名编号无效",
    });
  });

  it("returns 401 for an invalid class code and releases the database file", async () => {
    const response = await studentPost(
      jsonRequest("/api/auth/student", {
        classCode: "WRONG",
        alias: identityCode,
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "班级邀请码无效",
    });
    await rm(temporaryDirectory, { recursive: true });
    temporaryDirectory = "";
  });

  it("returns a generic 500 response without exposing database details", async () => {
    vi.stubEnv("DATABASE_PATH", temporaryDirectory);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await studentPost(
        jsonRequest("/api/auth/student", {
          classCode: "CLASS001",
          alias: identityCode,
        }),
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "服务暂时不可用",
      });
      expect(errorSpy).toHaveBeenCalledWith({
        requestId: expect.any(String),
        route: "student",
        errorName: expect.any(String),
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(identityCode);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("CLASS001");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("sets a signed teacher session for the correct code", async () => {
    const response = await teacherPost(
      jsonRequest("/api/auth/teacher", { code: `  ${TEACHER_CODE}  ` }),
    );
    const cookie = response.cookies.get(SESSION_COOKIE_NAME);

    expect(response.status).toBe(200);
    await expect(verifySession(cookie!.value, SESSION_SECRET)).resolves.toEqual({
      userId: "teacher",
      role: "TEACHER",
    });
  });

  it("returns 400 for malformed teacher input and 401 for a wrong code", async () => {
    const malformed = await teacherPost(
      jsonRequest("/api/auth/teacher", { code: "" }),
    );
    const denied = await teacherPost(
      jsonRequest("/api/auth/teacher", { code: "wrong-code" }),
    );

    expect(malformed.status).toBe(400);
    expect(denied.status).toBe(401);
    await expect(denied.json()).resolves.toEqual({
      ok: false,
      error: "教师访问码无效",
    });
  });
});

// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as registerAccount } from "@/app/api/account/register/route";
import { GET as readAccountSession } from "@/app/api/account/session/route";
import { readLumiAccountSession } from "@/lib/auth/account-session";
import {
  clearLumiAuthRuntimeForTests,
  getLumiAuthRuntime,
} from "@/lib/auth/better-auth";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  issueSession,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";

const SESSION_SECRET = "better-auth-test-session-secret-at-least-32-characters";
const TEACHER_CODE = "better-auth-test-teacher-code";
const IDENTITY_CODE_PEPPER =
  "better-auth-test-identity-pepper-at-least-32-characters";
const AUTH_PROXY_SECRET =
  "better-auth-test-proxy-secret-at-least-32-characters";

function registrationRequest(body: unknown) {
  return new NextRequest("http://localhost/api/account/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

describe("Better Auth account integration", () => {
  let temporaryDirectory: string;
  let databasePath: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "lumi-better-auth-"),
    );
    databasePath = path.join(temporaryDirectory, "accounts.sqlite");
    runMigrations(databasePath);

    const connection = createDb(databasePath);
    try {
      connection.sqlite
        .prepare(
          "INSERT INTO classes (id, name, access_code) VALUES (?, ?, ?)",
        )
        .run("class-1", "视觉传达一班", "DIGI2026");
    } finally {
      connection.sqlite.close();
    }

    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SESSION_SECRET);
    vi.stubEnv("TEACHER_ACCESS_CODE", TEACHER_CODE);
    vi.stubEnv("IDENTITY_CODE_PEPPER", IDENTITY_CODE_PEPPER);
    vi.stubEnv("AUTH_PROXY_SECRET", AUTH_PROXY_SECRET);
    vi.stubEnv("NODE_ENV", "test");
    clearLumiAuthRuntimeForTests();
  });

  afterEach(async () => {
    clearLumiAuthRuntimeForTests();
    vi.unstubAllEnvs();
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("registers a student, binds the class, and establishes a real session", async () => {
    const response = await registerAccount(
      registrationRequest({
        name: "测试学生",
        email: "student@lumi.local",
        password: "LumiTest2026!",
        role: "STUDENT",
        classCode: "DIGI2026",
        rememberMe: true,
      }),
    );
    const setCookie = response.headers.get("set-cookie") ?? "";
    const cookieHeader = setCookie.split(";")[0] ?? "";
    const payload = await response.json() as {
      user?: {
        id?: string;
        role?: string;
        classId?: string;
        alias?: string;
      };
    };

    expect(response.status).toBe(200);
    expect(setCookie).toMatch(/lumi\.session_token=/);
    expect(payload.user).toMatchObject({
      role: "STUDENT",
      classId: "class-1",
    });
    expect(payload.user?.alias).toMatch(/^测试学生-/);

    const connection = createDb(databasePath);
    try {
      const account = connection.sqlite
        .prepare(
          "SELECT id, email, role, class_id, alias FROM auth_user WHERE email = ?",
        )
        .get("student@lumi.local");
      const courseIdentity = connection.sqlite
        .prepare(
          "SELECT id, role, class_id, alias FROM users WHERE id = ?",
        )
        .get(payload.user?.id);

      expect(account).toMatchObject({
        id: payload.user?.id,
        email: "student@lumi.local",
        role: "STUDENT",
        class_id: "class-1",
      });
      expect(courseIdentity).toEqual({
        id: payload.user?.id,
        role: "STUDENT",
        class_id: "class-1",
        alias: payload.user?.alias,
      });
    } finally {
      connection.sqlite.close();
    }

    const session = await readLumiAccountSession(
      new NextRequest("http://localhost/student", {
        headers: { cookie: cookieHeader },
      }),
    );
    expect(session).toMatchObject({
      userId: payload.user?.id,
      role: "STUDENT",
      email: "student@lumi.local",
      classId: "class-1",
      alias: payload.user?.alias,
    });
  });

  it("rejects direct Better Auth sign-up calls that bypass Lumi class checks", async () => {
    const response = await getLumiAuthRuntime().auth.handler(
      new Request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "绕过注册",
          email: "bypass@lumi.local",
          password: "LumiTest2026!",
          role: "STUDENT",
          classId: "class-1",
          alias: "绕过注册",
        }),
      }),
    );

    expect(response.status).toBe(403);
    const connection = createDb(databasePath);
    try {
      expect(
        connection.sqlite
          .prepare("SELECT count(*) count FROM auth_user")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        connection.sqlite.prepare("SELECT count(*) count FROM users").get(),
      ).toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("rejects an unknown class invite before creating an account", async () => {
    const response = await registerAccount(
      registrationRequest({
        name: "无效班级学生",
        email: "invalid-class@lumi.local",
        password: "LumiTest2026!",
        role: "STUDENT",
        classCode: "NOT-A-CLASS",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "班级邀请码无效",
    });

    const connection = createDb(databasePath);
    try {
      expect(
        connection.sqlite
          .prepare("SELECT count(*) count FROM auth_user")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps an existing invitation session valid through the unified account endpoint", async () => {
    const token = await issueSession(
      { userId: "legacy-student", role: "STUDENT" },
      SESSION_SECRET,
    );
    const response = await readAccountSession(
      new NextRequest("http://localhost/api/account/session", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: {
        id: "legacy-student",
        role: "STUDENT",
      },
      session: { type: "LEGACY_TRANSITION" },
    });
  });

});

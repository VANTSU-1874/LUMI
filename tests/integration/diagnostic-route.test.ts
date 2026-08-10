// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/diagnostic/route";
import { buildPublicQuestionResponse } from "@/app/api/diagnostic/questions";
import {
  CURRENT_QUESTION_SET_VERSION,
  QUESTION_SETS,
} from "@/data/diagnostic/questions";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const SESSION_SECRET = "diagnostic-route-session-secret-at-least-32-chars";
const QUESTIONS = QUESTION_SETS.v1;

function answersForScore(score: 1 | 2 | 3 | 4) {
  return QUESTIONS.map((question) => ({
    questionId: question.id,
    optionId: question.options.find((option) => option.score === score)!.id,
  }));
}

function submissionForScore(score: 1 | 2 | 3 | 4) {
  return {
    questionSetVersion: CURRENT_QUESTION_SET_VERSION,
    answers: answersForScore(score),
  };
}

function halfPointSubmission() {
  const dimensionCounts = new Map<string, number>();
  return {
    questionSetVersion: CURRENT_QUESTION_SET_VERSION,
    answers: QUESTIONS.map((question) => {
      const occurrence = dimensionCounts.get(question.dimension) ?? 0;
      dimensionCounts.set(question.dimension, occurrence + 1);
      const score = occurrence === 0 ? 3 : 4;
      return {
        questionId: question.id,
        optionId: question.options.find((option) => option.score === score)!.id,
      };
    }),
  };
}

function postRequest(
  body: unknown,
  token?: string,
  headers: Record<string, string> = {},
) {
  return new NextRequest("http://localhost/api/diagnostic", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("diagnostic route", () => {
  let temporaryDirectory: string;
  let databasePath: string;
  let studentToken: string;
  let teacherToken: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "tonggan-diagnostic-route-"));
    databasePath = path.join(temporaryDirectory, "route.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite
        .prepare("INSERT INTO classes (id, name, access_code) VALUES (?, ?, ?)")
        .run("class-1", "一班", "CLASS001");
      connection.sqlite
        .prepare(
          "INSERT INTO users (id, class_id, role, alias, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("student-1", "class-1", "STUDENT", "匿名-SECRET-CODE", Date.now());
      connection.sqlite
        .prepare(
          "INSERT INTO users (id, class_id, role, alias, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("teacher-1", "class-1", "TEACHER", "教师", Date.now());
    } finally {
      connection.sqlite.close();
    }
    studentToken = await issueSession(
      { userId: "student-1", role: "STUDENT" },
      SESSION_SECRET,
    );
    teacherToken = await issueSession(
      { userId: "teacher-1", role: "TEACHER" },
      SESSION_SECRET,
    );

    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SESSION_SECRET);
    vi.stubEnv("TEACHER_ACCESS_CODE", "private-teacher-code");
    vi.stubEnv("IDENTITY_CODE_PEPPER", "diagnostic-pepper-at-least-32-characters");
    vi.stubEnv("AUTH_PROXY_SECRET", "diagnostic-proxy-secret-at-least-32-characters");
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("returns a public question set without authoritative scores or dimensions", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.questionSetVersion).toBe(CURRENT_QUESTION_SET_VERSION);
    expect(payload.questions).toHaveLength(10);
    for (const question of QUESTIONS) {
      const publicQuestion = payload.questions.find(({ id }: { id: string }) => id === question.id);
      expect(publicQuestion.scenario).toBe(question.scenario);
      expect(new Set(publicQuestion.options.map(({ id }: { id: string }) => id))).toEqual(
        new Set(question.options.map(({ id }) => id)),
      );
    }
    expect(JSON.stringify(payload)).not.toMatch(/"score"|"dimension"/);
  });

  it("uses injectable Fisher-Yates randomness while preserving stable option IDs", () => {
    const moveToFront = buildPublicQuestionResponse(() => 0);
    const keepInPlace = buildPublicQuestionResponse((upperExclusive) => upperExclusive - 1);

    expect(moveToFront.questions[0].options.map(({ id }) => id)).not.toEqual(
      keepInPlace.questions[0].options.map(({ id }) => id),
    );
    expect(new Set(moveToFront.questions[0].options.map(({ id }) => id))).toEqual(
      new Set(keepInPlace.questions[0].options.map(({ id }) => id)),
    );
    expect(JSON.stringify(moveToFront)).not.toMatch(/"score"|"dimension"/);
  });

  it("accepts an authenticated student submission and returns only the profile", async () => {
    const response = await POST(postRequest(submissionForScore(4), studentToken));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      profile: {
        decomposition: 4,
        signalUnderstanding: 4,
        mappingDesign: 4,
        troubleshooting: 4,
        transfer: 4,
        average: 4,
        level: "L4",
        updatedAt: expect.any(String),
      },
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/score|optionId|questionId|SECRET-CODE/);
  });

  it("returns legal half-point dimensions without rounding them", async () => {
    const response = await POST(postRequest(halfPointSubmission(), studentToken));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: {
        decomposition: 3.5,
        signalUnderstanding: 3.5,
        mappingDesign: 3.5,
        troubleshooting: 3.5,
        transfer: 3.5,
        average: 3.5,
        level: "L3",
      },
    });
  });

  it("updates the profile on repeat submission and appends the audit history", async () => {
    expect((await POST(postRequest(submissionForScore(1), studentToken))).status).toBe(200);
    const response = await POST(postRequest(submissionForScore(3), studentToken));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: { level: "L2", average: 3 },
    });
    const connection = createDb(databasePath);
    try {
      expect(
        (connection.sqlite.prepare("SELECT count(*) count FROM learner_profiles").get() as { count: number }).count,
      ).toBe(1);
      expect(
        (connection.sqlite.prepare("SELECT count(*) count FROM audit_events").get() as { count: number }).count,
      ).toBe(2);
    } finally {
      connection.sqlite.close();
    }
  });

  it.each([
    ["missing", undefined],
    ["bad", "not-a-token"],
  ])("returns 401 for a %s session", async (_case, token) => {
    const response = await POST(postRequest(submissionForScore(4), token));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "请先以学生身份进入",
    });
  });

  it("returns 401 for an expired session", async () => {
    const expiredToken = await issueSession(
      { userId: "student-1", role: "STUDENT" },
      SESSION_SECRET,
      { now: new Date(Date.now() - 13 * 60 * 60 * 1_000) },
    );
    const response = await POST(postRequest(submissionForScore(4), expiredToken));

    expect(response.status).toBe(401);
  });

  it("returns 401 for a valid teacher session", async () => {
    const response = await POST(postRequest(submissionForScore(4), teacherToken));

    expect(response.status).toBe(401);
  });

  it.each([
    ["malformed structure", { answers: [{ questionId: "only" }] }],
    ["unknown answer", { questionSetVersion: CURRENT_QUESTION_SET_VERSION, answers: [{ ...answersForScore(4)[0], optionId: "unknown" }, ...answersForScore(4).slice(1)] }],
    ["client score injection", { questionSetVersion: CURRENT_QUESTION_SET_VERSION, answers: answersForScore(4).map((answer) => ({ ...answer, score: 4 })) }],
  ])("returns 400 for %s", async (_case, body) => {
    const response = await POST(postRequest(body, studentToken));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "诊断答案无效",
    });
  });

  it.each(["v0", "unknown"])("returns 409 for unavailable version %s", async (version) => {
    const response = await POST(
      postRequest({ questionSetVersion: version, answers: answersForScore(4) }, studentToken),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "诊断题库已更新，请重新开始",
    });
  });

  it("returns 415 for non-JSON requests", async () => {
    const request = new NextRequest("http://localhost/api/diagnostic", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        cookie: `${SESSION_COOKIE_NAME}=${studentToken}`,
      },
      body: "not-json",
    });

    expect((await POST(request)).status).toBe(415);
  });

  it("returns 403 for cross-origin requests", async () => {
    const response = await POST(
      postRequest(submissionForScore(4), studentToken, {
        origin: "https://attacker.example",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("returns a generic 500, logs no secrets, and releases the database path", async () => {
    vi.stubEnv("DATABASE_PATH", temporaryDirectory);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await POST(postRequest(submissionForScore(4), studentToken));
      const payload = await response.json();

      expect(response.status).toBe(500);
      expect(payload).toEqual({ ok: false, error: "服务暂时不可用" });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/SECRET-CODE|optionId|questionId/);
      await rm(temporaryDirectory, { recursive: true });
      temporaryDirectory = "";
    } finally {
      errorSpy.mockRestore();
    }
  });
});

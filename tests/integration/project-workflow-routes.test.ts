// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogicCardHandler } from "@/app/api/projects/[projectId]/logic-card/handler";
import { POST as postLogicCard } from "@/app/api/projects/[projectId]/logic-card/route";
import { POST as postToolPath } from "@/app/api/projects/[projectId]/tool-path/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import type { SemanticLogicReviewer } from "@/lib/services/semantic-logic-review";

const SECRET = "project-route-session-secret-at-least-32-characters";
const completeCard = {
  culturalIntent: "传播安岳石刻文化",
  participantAction: "观众触摸屏幕区域",
  inputSignal: "采集触摸位置坐标",
  mappingRule: "按区域映射不同故事",
  outputMedium: "投影画面和声音变化",
  experienceFeedback: "观众立即看到触摸结果",
};
const requirements = {
  needsRealtimeVisuals: true,
  needsPhysicalControl: true,
  hasOsc: true,
};

function request(url: string, body: unknown, token?: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function context(projectId = "project-1") {
  return { params: Promise.resolve({ projectId }) };
}

describe("project workflow routes", () => {
  let directory: string;
  let databasePath: string;
  let studentToken: string;
  let otherToken: string;
  let teacherToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-project-routes-"));
    databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes VALUES ('class-1', '一班', 'CLASS001');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('student-1', 'class-1', 'STUDENT', '匿名-SECRET', 1700000000),
          ('student-2', 'class-1', 'STUDENT', '匿名-2', 1700000000),
          ('teacher-1', 'class-1', 'TEACHER', '教师', 1700000000);
        INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '逻辑卡', 2, '逻辑');
        INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '作业', '简介', '["DIGISHOW","TOUCHDESIGNER","COLLABORATIVE"]', 1700000000);
        INSERT INTO projects VALUES ('project-1', 'class-1', 'assignment-1', 'student-1', 'LOGIC_CARD', 1700000000, 1700000000, 0);
        INSERT INTO learner_profiles VALUES ('student-1', 'L2', 3, 3, 3, 3, 3, 1700000000);
      `);
    } finally {
      connection.sqlite.close();
    }
    studentToken = await issueSession({ userId: "student-1", role: "STUDENT" }, SECRET);
    otherToken = await issueSession({ userId: "student-2", role: "STUDENT" }, SECRET);
    teacherToken = await issueSession({ userId: "teacher-1", role: "TEACHER" }, SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("TEACHER_ACCESS_CODE", "teacher-code");
    vi.stubEnv("IDENTITY_CODE_PEPPER", "identity-pepper-at-least-32-characters");
    vi.stubEnv("AUTH_PROXY_SECRET", "proxy-secret-at-least-32-characters");
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps the public logic handler pending by default", async () => {
    const response = await postLogicCard(request("http://localhost/api/projects/project-1/logic-card", completeCard, studentToken), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "PENDING", semanticReady: false, stage: "LOGIC_CARD" });
  });

  it("uses the configured model in the public handler and unlocks only a valid approval", async () => {
    vi.stubEnv("LLM_BASE_URL", "https://model.example.edu/v1");
    vi.stubEnv("LLM_API_KEY", "model-secret-value");
    vi.stubEnv("LLM_MODEL", "course-model");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ status: "APPROVED", issues: [] }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postLogicCard(request("http://localhost/api/projects/project-1/logic-card", completeCard, studentToken), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "APPROVED",
      semanticReady: true,
      source: "model-semantic-review-v1",
      stage: "TOOL_PATH",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.headers)).not.toContain("model-secret-value");
    expect(String(init.body)).toContain("course-model");
  });

  it("allows an injected future reviewer to unlock without exposing an approve parameter", async () => {
    const reviewer: SemanticLogicReviewer = {
      review: () => ({ status: "APPROVED", ready: true, issues: [], source: "test-ai" }),
    };
    const handler = createLogicCardHandler({ reviewer });
    const response = await handler(request("http://localhost/api/projects/project-1/logic-card", completeCard, studentToken), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "APPROVED", semanticReady: true, stage: "TOOL_PATH" });
  });

  it("returns 401 for a missing session and 403 for a teacher session", async () => {
    expect((await postLogicCard(request("http://localhost/api/projects/project-1/logic-card", completeCard), context())).status).toBe(401);
    expect((await postLogicCard(request("http://localhost/api/projects/project-1/logic-card", completeCard, teacherToken), context())).status).toBe(403);
  });

  it("maps ownership and unknown project without leaking card or SQL", async () => {
    const forbidden = await postLogicCard(request("http://localhost/api/projects/project-1/logic-card", completeCard, otherToken), context());
    const missing = await postLogicCard(request("http://localhost/api/projects/missing/logic-card", completeCard, studentToken), context("missing"));
    expect(forbidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(JSON.stringify(await forbidden.json())).not.toContain(completeCard.culturalIntent);
  });

  it("authenticates before reading an unauthenticated business body", async () => {
    const unauthenticated = request(
      "http://localhost/api/projects/project-1/logic-card",
      { payload: "x".repeat(20_000) },
    );
    const jsonSpy = vi.spyOn(unauthenticated, "json").mockRejectedValue(new Error("body must not be read"));
    const arrayBufferSpy = vi.spyOn(unauthenticated, "arrayBuffer").mockRejectedValue(new Error("body must not be read"));

    const response = await postLogicCard(unauthenticated, context());

    expect(response.status).toBe(401);
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("returns 413 for declared or actual UTF-8 bodies above 16 KiB", async () => {
    const declared = request(
      "http://localhost/api/projects/project-1/logic-card",
      completeCard,
      studentToken,
      { "content-length": "20000" },
    );
    expect((await postLogicCard(declared, context())).status).toBe(413);

    const actual = request(
      "http://localhost/api/projects/project-1/logic-card",
      { ...completeCard, culturalIntent: "文".repeat(6_000) },
      studentToken,
    );
    expect((await postLogicCard(actual, context())).status).toBe(413);
  });

  it("trims all six fields and rejects a field over 500 characters", async () => {
    const reviewer: SemanticLogicReviewer = {
      review: () => ({ status: "APPROVED", ready: true, issues: [], source: "test" }),
    };
    const handler = createLogicCardHandler({ reviewer });
    const padded = Object.fromEntries(Object.entries(completeCard).map(([key, value]) => [key, `  ${value}  `]));
    expect((await handler(request("http://localhost/api/projects/project-1/logic-card", padded, studentToken), context())).status).toBe(200);
    const connection = createDb(databasePath);
    try {
      const stored = connection.sqlite.prepare("SELECT payload_json FROM logic_cards WHERE project_id='project-1'").get() as { payload_json: string };
      expect(JSON.parse(stored.payload_json)).toEqual(completeCard);
    } finally {
      connection.sqlite.close();
    }

    const stageConnection = createDb(databasePath);
    try {
      stageConnection.sqlite.prepare("UPDATE projects SET stage='LOGIC_CARD' WHERE id='project-1'").run();
    } finally {
      stageConnection.sqlite.close();
    }
    const tooLong = await handler(
      request("http://localhost/api/projects/project-1/logic-card", { ...completeCard, mappingRule: "x".repeat(501) }, studentToken),
      context(),
    );
    expect(tooLong.status).toBe(400);
  });

  it("rejects extra logic authority fields and non-JSON", async () => {
    const injected = await postLogicCard(request("http://localhost/api/projects/project-1/logic-card", { ...completeCard, approve: true, semanticReady: true, path: "COLLABORATIVE" }, studentToken), context());
    expect(injected.status).toBe(400);
    const nonJson = new NextRequest("http://localhost/api/projects/project-1/logic-card", {
      method: "POST",
      headers: { "content-type": "text/plain", cookie: `${SESSION_COOKIE_NAME}=${studentToken}` },
      body: "x",
    });
    expect((await postLogicCard(nonJson, context())).status).toBe(415);
  });

  it("rejects direct tool-path bypass and injected server decisions", async () => {
    const bypass = await postToolPath(request("http://localhost/api/projects/project-1/tool-path", requirements, studentToken), context());
    expect(bypass.status).toBe(409);
    const injected = await postToolPath(request("http://localhost/api/projects/project-1/tool-path", { ...requirements, path: "COLLABORATIVE", level: "L4", reasons: [] }, studentToken), context());
    expect(injected.status).toBe(400);
  });

  it("maps tool-path authentication and unknown projects", async () => {
    expect((await postToolPath(request("http://localhost/api/projects/project-1/tool-path", requirements), context())).status).toBe(401);
    expect((await postToolPath(request("http://localhost/api/projects/project-1/tool-path", requirements, teacherToken), context())).status).toBe(403);
    expect((await postToolPath(request("http://localhost/api/projects/project-1/tool-path", requirements, otherToken), context())).status).toBe(404);
    expect((await postToolPath(request("http://localhost/api/projects/missing/tool-path", requirements, studentToken), context("missing"))).status).toBe(404);
  });

  it("authenticates and checks ownership before reading a tool-path body", async () => {
    for (const [token, expected] of [[undefined, 401], [otherToken, 404]] as const) {
      const unread = request(
        "http://localhost/api/projects/project-1/tool-path",
        { payload: "x".repeat(20_000) },
        token,
      );
      const jsonSpy = vi.spyOn(unread, "json").mockRejectedValue(new Error("body must not be read"));
      const arrayBufferSpy = vi.spyOn(unread, "arrayBuffer").mockRejectedValue(new Error("body must not be read"));

      expect((await postToolPath(unread, context())).status).toBe(expected);
      expect(jsonSpy).not.toHaveBeenCalled();
      expect(arrayBufferSpy).not.toHaveBeenCalled();
    }
  });

  it("returns 413 for declared or actual tool-path bodies above 16 KiB", async () => {
    const declared = request(
      "http://localhost/api/projects/project-1/tool-path",
      requirements,
      studentToken,
      { "content-length": "20000" },
    );
    expect((await postToolPath(declared, context())).status).toBe(413);

    const actual = request(
      "http://localhost/api/projects/project-1/tool-path",
      { ...requirements, padding: "文".repeat(6_000) },
      studentToken,
    );
    expect((await postToolPath(actual, context())).status).toBe(413);
  });

  it("plans an approved owner path, forbids another student, and releases the database", async () => {
    const reviewer: SemanticLogicReviewer = { review: () => ({ status: "APPROVED", ready: true, issues: [], source: "test" }) };
    await createLogicCardHandler({ reviewer })(request("http://localhost/api/projects/project-1/logic-card", completeCard, studentToken), context());

    const forbidden = await postToolPath(request("http://localhost/api/projects/project-1/tool-path", requirements, otherToken), context());
    expect(forbidden.status).toBe(404);
    const response = await postToolPath(request("http://localhost/api/projects/project-1/tool-path", requirements, studentToken), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: {
        path: "COLLABORATIVE",
        stage: "BUILD",
        createdAt: expect.stringMatching(/^\d{4}-/),
        updatedAt: expect.stringMatching(/^\d{4}-/),
      },
    });

    await rm(directory, { recursive: true });
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-project-routes-clean-"));
  });

  it("returns 409 without a plan when teacher restrictions make the project infeasible", async () => {
    const reviewer: SemanticLogicReviewer = { review: () => ({ status: "APPROVED", ready: true, issues: [], source: "test" }) };
    await createLogicCardHandler({ reviewer })(request("http://localhost/api/projects/project-1/logic-card", completeCard, studentToken), context());
    const connection = createDb(databasePath);
    try {
      connection.sqlite.prepare("UPDATE assignments SET allowed_tools='[\"DIGISHOW\",\"TOUCHDESIGNER\"]' WHERE id='assignment-1'").run();
    } finally {
      connection.sqlite.close();
    }

    const response = await postToolPath(request(
      "http://localhost/api/projects/project-1/tool-path",
      { ...requirements, hasOsc: false },
      studentToken,
    ), context());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("教师") });
    const check = createDb(databasePath);
    try {
      expect(check.sqlite.prepare("SELECT count(*) count FROM tool_path_plans").get()).toEqual({ count: 0 });
      expect((check.sqlite.prepare("SELECT stage FROM projects WHERE id='project-1'").get() as { stage: string }).stage).toBe("TOOL_PATH");
    } finally {
      check.sqlite.close();
    }
  });

  it("returns a generic 500 for a malformed stored allowedTools shape", async () => {
    const reviewer: SemanticLogicReviewer = { review: () => ({ status: "APPROVED", ready: true, issues: [], source: "test" }) };
    await createLogicCardHandler({ reviewer })(request("http://localhost/api/projects/project-1/logic-card", completeCard, studentToken), context());
    const connection = createDb(databasePath);
    try {
      connection.sqlite.prepare("UPDATE assignments SET allowed_tools='{}' WHERE id='assignment-1'").run();
    } finally {
      connection.sqlite.close();
    }
    const response = await postToolPath(request("http://localhost/api/projects/project-1/tool-path", requirements, studentToken), context());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "服务暂时不可用" });
  });

  it("returns generic 500 responses without logging student text or SQL", async () => {
    vi.stubEnv("DATABASE_PATH", directory);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const logicResponse = await postLogicCard(
        request("http://localhost/api/projects/project-1/logic-card", completeCard, studentToken),
        context(),
      );
      const toolResponse = await postToolPath(
        request("http://localhost/api/projects/project-1/tool-path", requirements, studentToken),
        context(),
      );
      expect(logicResponse.status).toBe(500);
      expect(toolResponse.status).toBe(500);
      await expect(logicResponse.json()).resolves.toEqual({ ok: false, error: "服务暂时不可用" });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/SECRET|安岳石刻|SELECT|INSERT/i);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogicCardCoachHandler } from "@/app/api/projects/[projectId]/logic-card/coach/handler";
import { POST as postCoach } from "@/app/api/projects/[projectId]/logic-card/coach/route";
import { readAgentConversation } from "@/lib/agent/orchestrator-store";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { saveAgentDecisionReview } from "@/lib/services/agent-review";
import type { LogicCardCoach } from "@/lib/services/logic-card-coach";
import { readLearnerDetail } from "@/lib/services/teacher-analytics";

const SECRET = "logic-coach-session-secret-at-least-32-characters";
const emptyCard = {
  culturalIntent: "",
  participantAction: "",
  inputSignal: "",
  mappingRule: "",
  outputMedium: "",
  experienceFeedback: "",
};

function request(body: unknown, token?: string) {
  return new NextRequest("http://localhost/api/projects/project-1/logic-card/coach", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ projectId: "project-1" }) };

describe("logic card coach route", () => {
  let directory: string;
  let databasePath: string;
  let studentToken: string;
  let otherToken: string;
  let teacherToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-logic-coach-"));
    databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes VALUES ('class-1', '一班', 'CLASS001');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('student-1', 'class-1', 'STUDENT', '匿名-1', 1700000000),
          ('student-2', 'class-1', 'STUDENT', '匿名-2', 1700000000),
          ('teacher-1', NULL, 'TEACHER', '教师', 1700000000);
        INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '逻辑卡', 2, '逻辑');
        INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '作业', '简介', '["DIGISHOW"]', 1700000000);
        INSERT INTO projects VALUES ('project-1', 'class-1', 'assignment-1', 'student-1', 'LOGIC_CARD', 1700000000, 1700000000, 0);
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
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("accepts a one-word answer and returns suggestions without changing the project", async () => {
    const coach: LogicCardCoach = { clarify: () => ({
      field: "culturalIntent",
      mode: "MODEL_ASSISTED",
      acknowledgement: "我先确认你说的热闹是哪一种。",
      question: "你更接近哪一种？",
      options: [
        { id: "option-1", label: "社区有活力", value: "希望参与者感受到社区活动的活力" },
        { id: "option-2", label: "愿意参与", value: "希望参与者愿意加入社区活动" },
      ],
      source: "test-coach",
    }) };
    const handler = createLogicCardCoachHandler({ coach });

    const response = await handler(request({ field: "culturalIntent", answer: "热闹", card: emptyCard }, studentToken), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ projectId: "project-1", mode: "MODEL_ASSISTED" });
    const connection = createDb(databasePath);
    try {
      expect(connection.sqlite.prepare("SELECT stage FROM projects WHERE id='project-1'").get()).toEqual({ stage: "LOGIC_CARD" });
      expect(connection.sqlite.prepare("SELECT count(*) AS count FROM logic_cards").get()).toEqual({ count: 0 });
      expect(connection.sqlite.prepare("SELECT count(*) AS count FROM agent_turns").get()).toEqual({ count: 1 });
      expect(connection.sqlite.prepare("SELECT decision_code decisionCode, response_strategy responseStrategy FROM agent_turns").get()).toEqual({
        decisionCode: "UNDERSTAND_CLARIFY_LOGIC_CARD",
        responseStrategy: "CLARIFY",
      });
      const recovered = readAgentConversation(connection, { userId: "student-1", role: "STUDENT" }, "AGENT");
      expect(recovered.turns[0]).toMatchObject({
        episode: "UNDERSTAND",
        decisionCode: "UNDERSTAND_CLARIFY_LOGIC_CARD",
        aiMode: "MODEL_ASSISTED",
        reply: { actions: [], sources: [{ id: "course-pack:logic-card-clarification" }] },
      });
      const turnId = recovered.turns[0]!.turnId;
      saveAgentDecisionReview(connection, { userId: "teacher-1", role: "TEACHER" }, {
        turnId,
        decision: "CONFIRMED",
        notes: "澄清候选合理，且保留了学生确认权。",
      }, new Date("2026-07-16T05:00:00.000Z"));
      expect(readLearnerDetail(connection.db, "class-1", "student-1").agentTimeline?.[0]).toMatchObject({
        turnId,
        responseStrategy: "CLARIFY",
        executionSteps: [{ kind: "MODEL_DECISION" }, { kind: "FINAL_RESPONSE" }],
        toolCalls: [],
        review: { decision: "CONFIRMED" },
      });
    } finally {
      connection.sqlite.close();
    }
  });

  it("uses deterministic course guidance when AI is not configured", async () => {
    const response = await postCoach(request({ field: "culturalIntent", answer: "热闹", card: emptyCard }, studentToken), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mode: "DETERMINISTIC_FALLBACK", source: "course-pack-guidance-v1" });
  });

  it("rejects missing sessions, other students and client-injected response fields", async () => {
    expect((await postCoach(request({ field: "culturalIntent", answer: "热闹", card: emptyCard }), context)).status).toBe(401);
    expect((await postCoach(request({ field: "culturalIntent", answer: "热闹", card: emptyCard }, otherToken), context)).status).toBe(404);
    const injected = await postCoach(request({ field: "culturalIntent", answer: "热闹", card: emptyCard, mode: "MODEL_ASSISTED" }, studentToken), context);
    expect(injected.status).toBe(400);
  });

  it("rejects teacher sessions and non-logic-card stages", async () => {
    expect((await postCoach(request({ field: "culturalIntent", answer: "热闹", card: emptyCard }, teacherToken), context)).status).toBe(403);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.prepare("UPDATE projects SET stage='TOOL_PATH' WHERE id='project-1'").run();
    } finally {
      connection.sqlite.close();
    }
    expect((await postCoach(request({ field: "culturalIntent", answer: "热闹", card: emptyCard }, studentToken), context)).status).toBe(409);
  });

  it("rejects unsupported media, cross-site requests and declared oversized bodies", async () => {
    const url = "http://localhost/api/projects/project-1/logic-card/coach";
    const cookie = `${SESSION_COOKIE_NAME}=${studentToken}`;
    const wrongMedia = new NextRequest(url, { method: "POST", headers: { "content-type": "text/plain", cookie }, body: "{}" });
    expect((await postCoach(wrongMedia, context)).status).toBe(415);
    const crossSite = new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", cookie, "sec-fetch-site": "cross-site" }, body: "{}" });
    expect((await postCoach(crossSite, context)).status).toBe(403);
    const oversized = new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", cookie, "content-length": "17000" }, body: "{}" });
    expect((await postCoach(oversized, context)).status).toBe(413);
  });

  it("rate limits repeated clarification calls", async () => {
    const handler = createLogicCardCoachHandler({ maxRequests: 1 });
    expect((await handler(request({ field: "culturalIntent", answer: "热闹", card: emptyCard }, studentToken), context)).status).toBe(200);
    const limited = await handler(request({ field: "culturalIntent", answer: "活力", card: emptyCard }, studentToken), context);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});

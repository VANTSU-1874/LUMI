// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEvidenceHandler } from "@/app/api/projects/[projectId]/evidence/handler";
import { POST as postEvidence } from "@/app/api/projects/[projectId]/evidence/route";
import { createHintHandler } from "@/app/api/projects/[projectId]/hints/handler";
import { createTroubleshootingHandler } from "@/app/api/projects/[projectId]/troubleshooting/handler";
import { POST as postTroubleshooting } from "@/app/api/projects/[projectId]/troubleshooting/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import type { HintResponse } from "@/lib/services/hints";

const SECRET = "evidence-route-session-secret-at-least-32-characters";

function jsonRequest(url: string, body: unknown, token?: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function context(projectId = "project-1") { return { params: Promise.resolve({ projectId }) }; }

function hint(
  level: 1 | 2 | 3,
  evidenceToConsume: { evidenceRecordId: string; evidenceSequence: number; contentDigest: string; createdAt: string } | null = null,
): HintResponse {
  return {
    hintLevel: level, groundingStatus: "GROUNDED",
    confirmedFacts: level === 1 ? [] : ["课程设计：已确认事实"],
    hypotheses: level === 1 ? [] : ["待验证假设：端口不一致"],
    questions: ["当前看到什么？"],
    guidance: level === 1 ? [] : ["先检查当前层"],
    nextSteps: level === 1 ? [] : ["记录一个新证据"],
    localExample: level === 3 ? "局部示例：只测一个值" : null,
    sourceTitles: ["课程设计"], sources: [{ title: "课程设计", authority: "COURSE_DESIGN" }],
    evidenceToConsume, uncertainty: "需要证据", fallback: true,
  };
}

const inputProbe = {
  kind: "PROBE", label: "距离对照", signalLayer: "INPUT",
  probe: {
    type: "INPUT_MEASUREMENT", firstCondition: "手靠近", firstValue: 12,
    secondCondition: "手远离", secondValue: 24, unit: "cm",
  },
} as const;

describe("evidence, troubleshooting and hint routes", () => {
  let directory: string;
  let databasePath: string;
  let studentToken: string;
  let otherToken: string;
  let teacherToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-evidence-route-"));
    databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes VALUES ('class-1', '一班', 'CLASS001');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('student-1', 'class-1', 'STUDENT', '匿名-1', 1700000000),
        ('student-2', 'class-1', 'STUDENT', '匿名-2', 1700000000),
        ('teacher-1', 'class-1', 'TEACHER', '教师', 1700000000);
      INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '搭建', 2, '信号');
      INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '作业', '简介', '["DIGISHOW"]', 1700000000);
      INSERT INTO projects VALUES ('project-1', 'class-1', 'assignment-1', 'student-1', 'BUILD', 1700000000, 1700000000, 0);
    `);
    connection.sqlite.close();
    studentToken = await issueSession({ userId: "student-1", role: "STUDENT" }, SECRET);
    otherToken = await issueSession({ userId: "student-2", role: "STUDENT" }, SECRET);
    teacherToken = await issueSession({ userId: "teacher-1", role: "TEACHER" }, SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("EVIDENCE_ROOT", path.join(directory, "private"));
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("TEACHER_ACCESS_CODE", "teacher-code");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("authenticates and checks ownership before reading business bodies", async () => {
    expect((await postEvidence(jsonRequest("http://localhost/api/projects/project-1/evidence", "{", undefined), context())).status).toBe(401);
    expect((await postEvidence(jsonRequest("http://localhost/api/projects/project-1/evidence", "{", teacherToken), context())).status).toBe(403);
    expect((await postEvidence(jsonRequest("http://localhost/api/projects/project-1/evidence", "{", otherToken), context())).status).toBe(404);
  });

  it("stores bounded JSON evidence and returns no private path for non-images", async () => {
    const response = await postEvidence(jsonRequest("http://localhost/api/projects/project-1/evidence", {
      kind: "VALUE", label: "距离", signalLayer: "INPUT", value: 42,
    }, studentToken), context());
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      kind: "VALUE", label: "距离", signalLayer: "INPUT", verificationStatus: "SUBMITTED",
    });
    expect(JSON.stringify(body)).not.toMatch(/contentDigest|private|\\/);
  });

  it("returns a typed conflict when a stale client submits a transport receipt for another tool path", async () => {
    const setup = createDb(databasePath);
    try {
      setup.sqlite.prepare(`
        INSERT INTO tool_path_plans(project_id,path,requirements_json,reasons_json,milestones_json,created_at,updated_at)
        VALUES('project-1','DIGISHOW',?, '["单工具"]', '[{"id":"m1","title":"输入","requiredEvidenceLabel":"输入"},{"id":"m2","title":"映射","requiredEvidenceLabel":"映射"},{"id":"m3","title":"输出","requiredEvidenceLabel":"输出"}]',1700000000,1700000000)
      `).run(JSON.stringify({ needsRealtimeVisuals: false, needsPhysicalControl: true, hasOsc: false }));
    } finally { setup.sqlite.close(); }

    const response = await postEvidence(jsonRequest("http://localhost/api/projects/project-1/evidence", {
      kind: "PROBE", label: "错误OSC回执", signalLayer: "TRANSPORT",
      probe: { type: "TRANSPORT_RECEIPT", protocol: "OSC", host: "127.0.0.1", port: 7000, receivedValue: 0.5 },
    }, studentToken), context());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "EVIDENCE_TOOL_PATH_MISMATCH" });
    const check = createDb(databasePath);
    try {
      expect(check.sqlite.prepare("SELECT count(*) count FROM evidence").get()).toEqual({ count: 0 });
    } finally { check.sqlite.close(); }
  });

  it("rejects oversized JSON and image magic mismatches with typed statuses", async () => {
    const tooLarge = await postEvidence(jsonRequest("http://localhost/api/projects/project-1/evidence", {
      kind: "TEXT", label: "现象", signalLayer: "INPUT", text: "x".repeat(20_000),
    }, studentToken), context());
    expect(tooLarge.status).toBe(413);

    const form = new FormData();
    form.set("kind", "IMAGE"); form.set("label", "截图"); form.set("signalLayer", "INPUT");
    form.set("file", new File(["<svg><script>x</script></svg>"], "bad.png", { type: "image/png" }));
    const request = new NextRequest("http://localhost/api/projects/project-1/evidence", {
      method: "POST", headers: { cookie: `${SESSION_COOKIE_NAME}=${studentToken}` }, body: form,
    });
    expect((await postEvidence(request, context())).status).toBe(415);
  });

  it.each([
    '{"kind":"VALUE","label":"距离","signalLayer":"INPUT","value":""}',
    '{"kind":"VALUE","label":"距离","signalLayer":"INPUT","value":1e999}',
    '{"kind":"VALUE","label":"距离","signalLayer":"INPUT","value":1000000001}',
  ])("rejects invalid numeric JSON without writing evidence or advancing the project: %s", async (raw) => {
    const response = await postEvidence(jsonRequest("http://localhost/api/projects/project-1/evidence", raw, studentToken), context());
    expect(response.status).toBe(400);
    const check = createDb(databasePath);
    try {
      expect(check.sqlite.prepare("SELECT count(*) count FROM evidence").get()).toEqual({ count: 0 });
      expect(check.sqlite.prepare("SELECT stage FROM projects WHERE id='project-1'").get()).toEqual({ stage: "BUILD" });
    } finally { check.sqlite.close(); }
  });

  it("advances troubleshooting from a persisted evidence id", async () => {
    const saved = await postEvidence(jsonRequest("http://localhost/api/projects/project-1/evidence", inputProbe,
      studentToken), context());
    const { id } = await saved.json();
    const response = await postTroubleshooting(jsonRequest("http://localhost/api/projects/project-1/troubleshooting", { evidenceRecordId: id }, studentToken), context());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ currentLayer: "MAPPING", confirmedCodes: ["INPUT_OK"] });
    expect(body).not.toHaveProperty("usedEvidence");
    expect(JSON.stringify(body)).not.toMatch(/[a-f0-9]{64}/);
  });

  it("builds hint policy on the server, persists it and strips internal consumption data", async () => {
    const generate = vi.fn(async (_request, policy) => hint(policy.previousHintRecords.length === 0 ? 1 : 2));
    const handler = createHintHandler({ generate });
    const response = await handler(jsonRequest("http://localhost/api/projects/project-1/hints", { question: "OSC端口" }, studentToken), context());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.hintLevel).toBe(1);
    expect(body).not.toHaveProperty("evidenceToConsume");
    expect(generate.mock.calls[0][0].question).toContain("TouchDesigner输入");
    expect(generate.mock.calls[0][0].topicScope).toEqual(["TOUCHDESIGNER_FOUNDATIONS"]);
    expect(generate.mock.calls[0][0].question).not.toContain("OSC端口");
    expect(generate.mock.calls[0][0]).not.toHaveProperty("policy");
  });

  it("rejects client policy fields and rate limits by trusted source, student and project", async () => {
    const generate = vi.fn(async () => hint(1));
    const handler = createHintHandler({ generate, maxRequests: 2 });
    const forged = await handler(jsonRequest("http://localhost/api/projects/project-1/hints", { question: "OSC", requestedLevel: 3 }, studentToken), context());
    expect(forged.status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
    expect((await handler(jsonRequest("http://localhost/api/projects/project-1/hints", { question: "OSC" }, studentToken), context())).status).toBe(200);
    expect((await handler(jsonRequest("http://localhost/api/projects/project-1/hints", { question: "OSC" }, studentToken), context())).status).toBe(429);
    expect((await handler(jsonRequest("http://localhost/api/projects/project-1/hints", { question: "OSC" }, studentToken), context())).status).toBe(429);
  });

  it("rate limits evidence and troubleshooting by trusted source, student and project", async () => {
    const evidenceHandler = createEvidenceHandler({ maxRequests: 1 });
    const troubleHandler = createTroubleshootingHandler({ maxRequests: 1 });
    const evidenceBody = { kind: "VALUE", label: "距离", signalLayer: "INPUT", value: 42 };
    expect((await evidenceHandler(jsonRequest("http://localhost/api/projects/project-1/evidence", evidenceBody, studentToken), context())).status).toBe(201);
    expect((await evidenceHandler(jsonRequest("http://localhost/api/projects/project-1/evidence", evidenceBody, studentToken), context())).status).toBe(429);
    expect((await troubleHandler(jsonRequest("http://localhost/api/projects/project-1/troubleshooting", {}, studentToken), context())).status).toBe(200);
    expect((await troubleHandler(jsonRequest("http://localhost/api/projects/project-1/troubleshooting", {}, studentToken), context())).status).toBe(429);
  });

  it("consumes quota before invalid body parsing and never reads a body after 429", async () => {
    const evidenceHandler = createEvidenceHandler({ maxRequests: 1 });
    expect((await evidenceHandler(jsonRequest("http://localhost/api/projects/project-1/evidence", "{", studentToken), context())).status).toBe(400);
    const blockedEvidence = jsonRequest("http://localhost/api/projects/project-1/evidence", { kind: "VALUE", label: "距离", signalLayer: "INPUT", value: 1 }, studentToken);
    const evidenceRead = vi.spyOn(blockedEvidence, "arrayBuffer");
    const blockedEvidenceResponse = await evidenceHandler(blockedEvidence, context());
    expect(blockedEvidenceResponse.status).toBe(429);
    expect(blockedEvidenceResponse.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(evidenceRead).not.toHaveBeenCalled();

    const troubleHandler = createTroubleshootingHandler({ maxRequests: 1 });
    expect((await troubleHandler(jsonRequest("http://localhost/api/projects/project-1/troubleshooting", "{", studentToken), context())).status).toBe(400);
    const blockedTrouble = jsonRequest("http://localhost/api/projects/project-1/troubleshooting", {}, studentToken);
    const troubleRead = vi.spyOn(blockedTrouble, "arrayBuffer");
    expect((await troubleHandler(blockedTrouble, context())).status).toBe(429);
    expect(troubleRead).not.toHaveBeenCalled();

    const generate = vi.fn(async () => hint(1));
    const hintHandler = createHintHandler({ generate, maxRequests: 1 });
    expect((await hintHandler(jsonRequest("http://localhost/api/projects/project-1/hints", { question: "OSC", requestedLevel: 3 }, studentToken), context())).status).toBe(400);
    const blockedHint = jsonRequest("http://localhost/api/projects/project-1/hints", { question: "OSC" }, studentToken);
    const hintRead = vi.spyOn(blockedHint, "arrayBuffer");
    expect((await hintHandler(blockedHint, context())).status).toBe(429);
    expect(hintRead).not.toHaveBeenCalled();
  });

  it("fast-rejects declared oversize before quota or body parsing", async () => {
    const handler = createEvidenceHandler({ maxRequests: 1 });
    const oversized = jsonRequest("http://localhost/api/projects/project-1/evidence", { kind: "TEXT" }, studentToken);
    oversized.headers.set("content-length", String(16 * 1024 + 1));
    const read = vi.spyOn(oversized, "arrayBuffer");
    expect((await handler(oversized, context())).status).toBe(413);
    expect(read).not.toHaveBeenCalled();
    const oversizedImage = new NextRequest("http://localhost/api/projects/project-1/evidence", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${studentToken}`,
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(5 * 1024 * 1024 + 64 * 1024 + 1),
      },
      body: "ignored",
    });
    const imageRead = vi.spyOn(oversizedImage, "arrayBuffer");
    expect((await handler(oversizedImage, context())).status).toBe(413);
    expect(imageRead).not.toHaveBeenCalled();
    // Oversize preflight did not consume the single request.
    expect((await handler(jsonRequest("http://localhost/api/projects/project-1/evidence", "{", studentToken), context())).status).toBe(400);
  });

  it("counts invalid image magic and blocks the next multipart body before reading it", async () => {
    const handler = createEvidenceHandler({ maxRequests: 1 });
    const form = new FormData();
    form.set("kind", "IMAGE"); form.set("label", "截图"); form.set("signalLayer", "INPUT");
    form.set("file", new File(["<svg/>"], "bad.png", { type: "image/png" }));
    const invalid = new NextRequest("http://localhost/api/projects/project-1/evidence", {
      method: "POST", headers: { cookie: `${SESSION_COOKIE_NAME}=${studentToken}` }, body: form,
    });
    expect((await handler(invalid, context())).status).toBe(415);
    const blocked = new NextRequest("http://localhost/api/projects/project-1/evidence", {
      method: "POST", headers: { cookie: `${SESSION_COOKIE_NAME}=${studentToken}` }, body: form,
    });
    const read = vi.spyOn(blocked, "arrayBuffer");
    expect((await handler(blocked, context())).status).toBe(429);
    expect(read).not.toHaveBeenCalled();
  });

  it("returns typed 409 and writes nothing when level-three evidence createdAt changes", async () => {
    const initial = createHintHandler({
      generate: async (_request, policy) => hint(policy.previousHintRecords.length === 0 ? 1 : 2),
    });
    expect((await initial(jsonRequest("http://localhost/api/projects/project-1/hints", { question: "OSC" }, studentToken), context())).status).toBe(200);
    expect((await initial(jsonRequest("http://localhost/api/projects/project-1/hints", { question: "OSC" }, studentToken), context())).status).toBe(200);
    const savedResponse = await postEvidence(jsonRequest("http://localhost/api/projects/project-1/evidence", inputProbe,
      studentToken), context());
    const saved = await savedResponse.json();
    const preparation = createDb(databasePath);
    preparation.sqlite.prepare("UPDATE evidence SET created_at = created_at + 2 WHERE id = ?").run(saved.id);
    preparation.sqlite.close();

    let candidate: { evidenceRecordId: string; evidenceSequence: number; contentDigest: string; createdAt: string } | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const handler = createHintHandler({
      generate: async (_request, policy) => {
        candidate = policy.currentEvidenceRecords.find(({ evidenceRecordId }) => evidenceRecordId === saved.id);
        await gate;
        return hint(3, candidate ?? null);
      },
    });
    const pending = handler(jsonRequest("http://localhost/api/projects/project-1/hints", { question: "OSC" }, studentToken), context());
    await expect.poll(() => candidate?.createdAt).toBeTruthy();
    const mutator = createDb(databasePath);
    mutator.sqlite.prepare("UPDATE evidence SET created_at = created_at + 1 WHERE id = ?").run(saved.id);
    mutator.sqlite.close();
    release();
    const response = await pending;
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "HINT_CONTEXT_STALE" });
    const check = createDb(databasePath);
    try {
      expect(check.sqlite.prepare("SELECT count(*) count FROM hint_records").get()).toEqual({ count: 2 });
      expect(check.sqlite.prepare("SELECT count(*) count FROM hint_evidence_consumptions").get()).toEqual({ count: 0 });
    } finally { check.sqlite.close(); }
  });
});

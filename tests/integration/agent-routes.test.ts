// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as actionPost } from "@/app/api/agent/action/route";
import { GET as artworkGet } from "@/app/api/agent/artworks/[attachmentId]/route";
import { GET as conversationGet } from "@/app/api/agent/conversation/route";
import { POST as turnPost } from "@/app/api/agent/turn/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { MAX_IMAGE_BYTES } from "@/lib/security/uploads";
import { validPng } from "@/tests/helpers/image-fixtures";

const SECRET = "agent-route-session-secret-at-least-32-characters";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

function jsonRequest(url: string, token: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { cookie: cookie(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function artworkRequest(token: string, body: { message: string }, declaredLength?: number) {
  const form = new FormData();
  form.set("payload", JSON.stringify({ ...body, context: { view: "AGENT", focus: null } }));
  form.set("artwork", new File([validPng], "poster.png", { type: "image/png" }));
  const serialized = new Request("http://localhost/api/agent/turn", { method: "POST", body: form });
  const bytes = await serialized.arrayBuffer();
  return new NextRequest("http://localhost/api/agent/turn", {
    method: "POST",
    headers: {
      cookie: cookie(token),
      "content-type": serialized.headers.get("content-type")!,
      "content-length": String(declaredLength ?? bytes.byteLength),
    },
    body: bytes,
  });
}

describe("agent public routes", () => {
  let directory: string;
  let databasePath: string;
  let studentToken: string;
  let otherStudentToken: string;
  let teacherToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-agent-routes-"));
    databasePath = path.join(directory, "agent.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','智能体班','AGENT-CLASS');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES
          ('s1','c1','STUDENT','学习者',1700000000),
          ('s2','c1','STUDENT','另一位学习者',1700000000),
          ('t1','c1','TEACHER','教师',1700000000);
      `);
      await ingestCoursePackKnowledge(connection);
    } finally {
      connection.sqlite.close();
    }
    studentToken = await issueSession({ userId: "s1", role: "STUDENT" }, SECRET);
    otherStudentToken = await issueSession({ userId: "s2", role: "STUDENT" }, SECRET);
    teacherToken = await issueSession({ userId: "t1", role: "TEACHER" }, SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("AUTH_PROXY_SECRET", "agent-route-proxy-secret-at-least-32-characters");
    vi.stubEnv("AGENT_V2_ENABLED", "true");
    vi.stubEnv("EVIDENCE_ROOT", path.join(directory, "private-images"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates, restores and idempotently executes a grounded turn", async () => {
    const turnResponse = await turnPost(jsonRequest("http://localhost/api/agent/turn", studentToken, {
      message: "声音已经有数值，画面为什么不动？",
      context: { view: "AGENT", focus: null },
    }));
    expect(turnResponse.status).toBe(201);
    const turn = await turnResponse.json();
    expect(turn).toMatchObject({ episode: "DEBUG", aiMode: "DETERMINISTIC_FALLBACK" });
    expect(turn.reply.sources.length).toBeGreaterThan(0);
    expect(turn.reply.actions).toHaveLength(1);

    const restoredResponse = await conversationGet(new NextRequest("http://localhost/api/agent/conversation?view=AGENT", {
      headers: { cookie: cookie(studentToken) },
    }));
    expect(restoredResponse.status).toBe(200);
    const restored = await restoredResponse.json();
    expect(restored.turns[0]).toMatchObject({ turnId: turn.turnId, studentMessage: "声音已经有数值，画面为什么不动？" });

    const idempotencyKey = crypto.randomUUID();
    const actionBody = { turnId: turn.turnId, actionId: turn.reply.actions[0].id, idempotencyKey };
    const ownershipDenied = await actionPost(jsonRequest(
      "http://localhost/api/agent/action",
      otherStudentToken,
      actionBody,
    ));
    expect(ownershipDenied.status).toBe(403);
    const ownershipPayload = await ownershipDenied.json() as Record<string, unknown>;
    expect(ownershipPayload).toEqual({ error: "不能执行其他学生的行动卡" });
    expect(ownershipPayload).not.toHaveProperty("code");

    const first = await actionPost(jsonRequest("http://localhost/api/agent/action", studentToken, actionBody));
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ status: "EXECUTED", alreadyExecuted: false });
    const replay = await actionPost(jsonRequest("http://localhost/api/agent/action", studentToken, actionBody));
    await expect(replay.json()).resolves.toMatchObject({ status: "EXECUTED", alreadyExecuted: true });
  });

  it("enforces student ownership, strict action input and the release flag", async () => {
    expect((await conversationGet(new NextRequest("http://localhost/api/agent/conversation"))).status).toBe(401);
    const teacherResponse = await turnPost(jsonRequest("http://localhost/api/agent/turn", teacherToken, {
      message: "帮我排障", context: { view: "AGENT", focus: null },
    }));
    expect(teacherResponse.status).toBe(403);
    await expect(teacherResponse.json()).resolves.toEqual({
      error: "仅学生可以执行此操作",
      code: "STUDENT_ROLE_FORBIDDEN",
    });

    const teacherConversation = await conversationGet(new NextRequest(
      "http://localhost/api/agent/conversation",
      { headers: { cookie: cookie(teacherToken) } },
    ));
    expect(teacherConversation.status).toBe(403);
    await expect(teacherConversation.json()).resolves.toMatchObject({ code: "STUDENT_ROLE_FORBIDDEN" });

    const teacherAction = await actionPost(jsonRequest("http://localhost/api/agent/action", teacherToken, {
      turnId: crypto.randomUUID(),
      actionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
    }));
    expect(teacherAction.status).toBe(403);
    await expect(teacherAction.json()).resolves.toMatchObject({ code: "STUDENT_ROLE_FORBIDDEN" });

    const invalid = await actionPost(jsonRequest("http://localhost/api/agent/action", studentToken, {
      turnId: crypto.randomUUID(), actionId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
      target: "NODE_CANVAS",
    }));
    expect(invalid.status).toBe(400);

    vi.stubEnv("AGENT_V3_ENABLED", "false");
    const v2Only = await conversationGet(new NextRequest("http://localhost/api/agent/conversation", {
      headers: { cookie: cookie(studentToken) },
    }));
    await expect(v2Only.json()).resolves.toMatchObject({ features: { externalSearch: false } });
    vi.stubEnv("AGENT_V3_ENABLED", "true");
    const v3 = await conversationGet(new NextRequest("http://localhost/api/agent/conversation", {
      headers: { cookie: cookie(studentToken) },
    }));
    await expect(v3.json()).resolves.toMatchObject({ features: { externalSearch: true } });

    vi.stubEnv("AGENT_V2_ENABLED", "false");
    const disabled = await conversationGet(new NextRequest("http://localhost/api/agent/conversation", {
      headers: { cookie: cookie(studentToken) },
    }));
    expect(disabled.status).toBe(404);
  });

  it("accepts one private artwork image without treating it as learning evidence", async () => {
    const turnResponse = await turnPost(await artworkRequest(studentToken, {
      message: "这张海报的层级怎么调整？",
    }));
    expect(turnResponse.status).toBe(201);
    const turn = await turnResponse.json();
    expect(turn.artworkAttachment).toMatchObject({ mimeType: "image/png", width: 2, height: 2 });
    expect(turn.reply.uncertainty).toContain("当前模型未能可靠读取");

    const check = createDb(databasePath);
    try {
      expect(check.sqlite.prepare("SELECT count(*) count FROM evidence").get()).toEqual({ count: 0 });
      expect(check.sqlite.prepare("SELECT count(*) count FROM agent_artwork_attachments").get()).toEqual({ count: 1 });
    } finally { check.sqlite.close(); }

    const routeContext = { params: Promise.resolve({ attachmentId: turn.artworkAttachment.id }) };
    const previewUrl = `http://localhost${turn.artworkAttachment.previewUrl}`;
    const owned = await artworkGet(new NextRequest(previewUrl, {
      headers: { cookie: cookie(studentToken) },
    }), routeContext);
    expect(owned.status).toBe(200);
    expect(Buffer.from(await owned.arrayBuffer()).byteLength).toBe(turn.artworkAttachment.byteSize);
    const anonymous = await artworkGet(new NextRequest(previewUrl), routeContext);
    expect(anonymous.status).toBe(401);
    const teacher = await artworkGet(new NextRequest(previewUrl, {
      headers: { cookie: cookie(teacherToken) },
    }), routeContext);
    expect(teacher.status).toBe(404);
  });

  it("rejects multipart content larger than its declared length", async () => {
    const response = await turnPost(await artworkRequest(studentToken, {
      message: "分析这张作品",
    }, 1));
    expect(response.status).toBe(400);
  });

  it("stops reading multipart bodies that exceed the hard raw-body limit", async () => {
    const response = await turnPost(new NextRequest("http://localhost/api/agent/turn", {
      method: "POST",
      headers: {
        cookie: cookie(studentToken),
        "content-type": "multipart/form-data; boundary=forged",
        "content-length": "1",
      },
      body: Buffer.alloc(MAX_IMAGE_BYTES + 64 * 1024 + 1, 0x61),
    }));
    expect(response.status).toBe(413);
  });
});

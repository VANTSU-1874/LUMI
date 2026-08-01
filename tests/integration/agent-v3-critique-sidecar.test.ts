// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as critiqueGet } from "@/app/api/agent/turns/[turnId]/critique/route";
import { CRITIQUE_DIMENSION_IDS } from "@/lib/agent/critique-contract";
import { readLatestAgentCritique } from "@/lib/agent/critique-store";
import { readAgentConversation } from "@/lib/agent/orchestrator-store";
import type { PreparedAgentArtwork } from "@/lib/agent/artwork-attachment";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { CurrentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];
const actor = { userId: "s1", role: "STUDENT" as const };
const artworkId = "20000000-0000-4000-8000-000000000001";
const SECRET = "critique-route-session-secret-at-least-32-characters";

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  vi.stubEnv("AGENT_V3_ENABLED", "true");
  const root = await mkdtemp(path.join(tmpdir(), "lumi-v3-critique-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','CRITIQUE');
    INSERT INTO users(id,class_id,role,alias,created_at)
      VALUES
        ('s1','c1','STUDENT','学生一',1700000000),
        ('s2','c1','STUDENT','学生二',1700000000),
        ('t1','c1','TEACHER','教师',1700000000);
  `);
  return { connection, artworkRoot: path.join(root, "evidence"), databasePath };
}

function artwork(id = artworkId): PreparedAgentArtwork {
  return {
    id,
    mimeType: "image/png",
    extension: ".png",
    byteSize: 8,
    width: 1,
    height: 1,
    digest: "a".repeat(64),
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  };
}

function critique(artworkReferenceId = artworkId, historyComparison?: string) {
  return {
    frameworkId: "critique-framework-five-plus-closure",
    frameworkVersion: "1.0",
    dimensions: CRITIQUE_DIMENSION_IDS.map((dimensionId, index) => ({
      id: dimensionId,
      label: ["目标", "创意转译", "构成与层级", "形式语言", "工艺与规范"][index],
      displayOrder: index + 1,
      status: index === 4 ? "NEEDS_EVIDENCE" : "DEVELOPING",
      observation: `画面可见的第${index + 1}项关系。`,
      evidence: [{
        kind: "ARTWORK_REGION",
        label: "画面中央可见区域",
        reference: `artwork:${artworkReferenceId}`,
      }],
      guidance: { level: "HINT", message: "先只调整一处再比较。" },
      isDeepDive: index === 1,
    })),
    closure: {
      established: "主体与背景已经形成可见区分。",
      nextStep: "下一步只调整互动提示的视觉重量。",
      ...(historyComparison ? { historyComparison } : {}),
    },
  };
}

type RespondArguments = Parameters<NonNullable<ModelProviderAdapter["respond"]>>;

function adapter(
  content: string,
  onPrompt?: (prompt: string) => void,
  onRespond?: (...arguments_: RespondArguments) => void,
) {
  let calls = 0;
  const model: ModelProviderAdapter = {
    provider: "TEST",
    modelId: "vision-critique-test",
    capabilities: { vision: true },
    async complete() {
      throw new Error("V3_SHOULD_USE_NATIVE_RESPONSE");
    },
    async respond(messages, options) {
      calls += 1;
      onPrompt?.(messages[0]?.content ?? "");
      onRespond?.(messages, options);
      return { content, toolCalls: [] };
    },
  };
  return { model, calls: () => calls };
}

function withSidecar(body: string, critiqueValue: unknown) {
  return `${body}\n\n<!-- tutor-meta ${JSON.stringify({ critique: critiqueValue })} -->`;
}

function critiqueCounterexample(kind: "LABELS" | "STUDENT_STATEMENT" | "ARTWORK_REFERENCE") {
  const value = structuredClone(critique()) as unknown as {
    dimensions: Array<{
      label: string;
      evidence: Array<{ kind: string; label: string; reference?: string }>;
    }>;
  };
  if (kind === "LABELS") {
    value.dimensions.forEach((dimension) => { dimension.label = "x"; });
  } else if (kind === "STUDENT_STATEMENT") {
    value.dimensions[0]!.evidence = [{
      kind: "STUDENT_STATEMENT",
      label: "学生明确说作品面向老年观众",
      reference: "student-message",
    }];
  } else {
    value.dimensions[0]!.evidence = [{
      kind: "ARTWORK_REGION",
      label: "画面中央可见区域",
    }];
  }
  return value;
}

describe("V3 critique sidecar integration", () => {
  it("exposes a complete critique beside one model-assisted natural response", async () => {
    const { connection, artworkRoot, databasePath } = await setup();
    const naturalBody = "先看作品本身：主体与背景已经形成区分，但互动提示的视觉重量还在抢入口。先只调整提示大小，再比较第一眼落点。";
    const fake = adapter(withSidecar(naturalBody, critique()), (prompt) => {
      expect(prompt).toContain("自然正文永远是主体");
      expect(prompt).toContain("closure 独立且必需");
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "请点评这张数字交互文创作品图的创意表达和构图。",
          context: { view: "AGENT" },
        },
        artwork: artwork(),
        options: { modelProviderAdapter: fake.model, artworkRoot },
      });
      expect(fake.calls()).toBe(1);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.coursePack.id).toBe("digital-interaction");
      expect(response.reply.message).toBe(naturalBody);
      expect(response.critique?.dimensions.map(({ id }) => id)).toEqual(CRITIQUE_DIMENSION_IDS);
      expect(response.critique?.closure.nextStep).toContain("只调整");
      expect(response.executionSteps).not.toContainEqual(expect.objectContaining({ kind: "DEGRADED" }));
      expect(connection.sqlite.prepare(
        "SELECT count(*) count FROM agent_critiques WHERE turn_id=?",
      ).get(response.turnId)).toEqual({ count: 1 });
      expect(readAgentConversation(connection, actor, "AGENT", response.taskId).turns[0]?.critique)
        .toEqual(response.critique);

      vi.stubEnv("DATABASE_PATH", databasePath);
      vi.stubEnv("SESSION_SECRET", SECRET);
      vi.stubEnv("AUTH_PROXY_SECRET", "critique-route-proxy-secret-at-least-32-characters");
      vi.stubEnv("AGENT_V2_ENABLED", "true");
      const studentToken = await issueSession(actor, SECRET);
      const otherToken = await issueSession({ userId: "s2", role: "STUDENT" }, SECRET);
      const teacherToken = await issueSession({ userId: "t1", role: "TEACHER" }, SECRET);
      const request = (token?: string) => new NextRequest(
        `http://localhost/api/agent/turns/${response.turnId}/critique`,
        token ? { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } } : {},
      );
      const routeContext = { params: Promise.resolve({ turnId: response.turnId }) };
      const owned = await critiqueGet(request(studentToken), routeContext);
      expect(owned.status).toBe(200);
      expect(owned.headers.get("cache-control")).toBe("private, no-store");
      expect(owned.headers.get("vary")).toBe("Cookie");
      await expect(owned.json()).resolves.toEqual({ critique: response.critique });
      expect((await critiqueGet(request(), routeContext)).status).toBe(401);
      const otherStudent = await critiqueGet(request(otherToken), routeContext);
      expect(otherStudent.status).toBe(404);
      await expect(otherStudent.json()).resolves.not.toHaveProperty("code");

      const teacher = await critiqueGet(request(teacherToken), routeContext);
      expect(teacher.status).toBe(403);
      await expect(teacher.json()).resolves.toEqual({
        error: "仅学生可以执行此操作",
        code: "STUDENT_ROLE_FORBIDDEN",
      });

      const crossSite = await critiqueGet(new NextRequest(
        `http://localhost/api/agent/turns/${response.turnId}/critique`,
        {
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${studentToken}`,
            "sec-fetch-site": "cross-site",
          },
        },
      ), routeContext);
      expect(crossSite.status).toBe(403);
      await expect(crossSite.json()).resolves.toEqual({ error: "请求来源无效" });

      connection.sqlite.prepare("DELETE FROM users WHERE id='s1'").run();
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_critiques").get())
        .toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });

  it.each([
    "LABELS",
    "STUDENT_STATEMENT",
    "ARTWORK_REFERENCE",
  ] as const)("drops unbound critique evidence without changing the model answer: %s", async (kind) => {
    const { connection, artworkRoot } = await setup();
    const naturalBody = "先保留自然点评：当前入口仍有竞争，下一步只比较一处视觉重量。";
    const fake = adapter(
      withSidecar(naturalBody, critiqueCounterexample(kind)),
      undefined,
      (messages, options) => {
        const userContext = messages.find(({ role }) => role === "user");
        if (!userContext || userContext.role !== "user") throw new Error("MISSING_TUTOR_CONTEXT");
        const context = JSON.parse(userContext.content) as {
          courseContext?: { id?: string };
          critiqueRequest?: { route?: string; enabled?: boolean };
          artworkInput?: { sourceId?: string; availability?: string };
        };
        expect(context.courseContext?.id).toBe("digital-interaction");
        expect(context.critiqueRequest).toMatchObject({
          route: "STRUCTURED_CRITIQUE",
          enabled: true,
        });
        expect(context.artworkInput).toMatchObject({
          sourceId: `artwork:${artworkId}`,
          availability: "AVAILABLE_TO_VISION_MODEL",
        });
        expect(options?.image).toMatchObject({ mimeType: "image/png" });
        expect(options?.image?.bytes).toBeInstanceOf(Uint8Array);
      },
    );
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "请点评这张数字交互文创作品图的创意表达和构图。",
          context: { view: "AGENT" },
        },
        artwork: artwork(),
        options: { modelProviderAdapter: fake.model, artworkRoot },
      });
      expect(fake.calls()).toBe(1);
      expect(response.coursePack.id).toBe("digital-interaction");
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toBe(naturalBody);
      expect(response.critique).toBeUndefined();
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        errorCode: "V3_CRITIQUE_SIDECAR_INVALID",
        status: "SKIPPED",
      }));
      expect(response.executionSteps).not.toContainEqual(expect.objectContaining({ kind: "DEGRADED" }));
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_critiques").get())
        .toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("drops a closure-less sidecar without retrying or degrading the natural response", async () => {
    const { connection, artworkRoot } = await setup();
    const invalid = { ...critique(), closure: undefined };
    const naturalBody = "这张作品先保留主体入口；下一步只做一次缩略图对比。";
    const fake = adapter(withSidecar(naturalBody, invalid));
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "请点评这张数字交互作品图的构成和创意表达。",
          context: { view: "AGENT" },
        },
        artwork: artwork(),
        options: { modelProviderAdapter: fake.model, artworkRoot },
      });
      expect(fake.calls()).toBe(1);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toBe(naturalBody);
      expect(response.critique).toBeUndefined();
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        errorCode: "V3_CRITIQUE_SIDECAR_INVALID",
        status: "SKIPPED",
      }));
      expect(response.executionSteps).not.toContainEqual(expect.objectContaining({ kind: "DEGRADED" }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps software troubleshooting out of the five-dimension face", async () => {
    const { connection, artworkRoot } = await setup();
    const naturalBody = "先不判断画面好坏：请截图确认 Audio Device In CHOP 是否有数值，再沿输入、映射、输出逐层排查。";
    const fake = adapter(withSidecar(naturalBody, critique()), (prompt) => {
      expect(prompt).toContain("采用证据式排错");
      expect(prompt).toContain("不要输出 critique 字段");
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "TouchDesigner 节点报错没有数据，先帮我看哪里错了，也想听整体建议。",
          context: { view: "AGENT" },
        },
        artwork: artwork(),
        options: { modelProviderAdapter: fake.model, artworkRoot },
      });
      expect(fake.calls()).toBe(1);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toBe(naturalBody);
      expect(response.critique).toBeUndefined();
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        errorCode: "V3_CRITIQUE_SIDECAR_INELIGIBLE",
      }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("server-binds history to the real previous critique for the same owner, course and data type", async () => {
    const { connection, artworkRoot } = await setup();
    const firstArtworkId = "20000000-0000-4000-8000-000000000011";
    const secondArtworkId = "20000000-0000-4000-8000-000000000012";
    try {
      const firstAdapter = adapter(withSidecar("第一版自然点评。", critique(firstArtworkId)));
      const first = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "请点评这张数字交互文创作品图的创意表达。",
          context: { view: "AGENT" },
        },
        artwork: artwork(firstArtworkId),
        options: {
          modelProviderAdapter: firstAdapter.model,
          artworkRoot,
          now: () => new Date("2026-07-19T01:00:00.000Z"),
        },
      });
      expect(first.critique?.closure.historyReference).toBeUndefined();
      const ownerLookup = {
        connection,
        studentId: actor.userId,
        classId: "c1",
        courseId: "digital-interaction",
        dataType: "REAL" as const,
      };
      expect(readLatestAgentCritique(ownerLookup)?.id).toBe(first.critique?.id);
      expect(readLatestAgentCritique({ ...ownerLookup, studentId: "s2" })).toBeUndefined();
      expect(readLatestAgentCritique({ ...ownerLookup, classId: "c2" })).toBeUndefined();
      expect(readLatestAgentCritique({ ...ownerLookup, courseId: "general-design" })).toBeUndefined();
      expect(readLatestAgentCritique({ ...ownerLookup, courseId: "book-design" })).toBeUndefined();
      expect(readLatestAgentCritique({
        ...ownerLookup,
        dataType: "DEMONSTRATION_DATA",
      })).toBeUndefined();

      const comparison = "相较上一版，互动提示不再压过主体入口。";
      const secondAdapter = adapter(
        withSidecar("第二版自然点评。", critique(secondArtworkId, comparison)),
        (prompt) => expect(prompt).toContain("服务端绑定"),
      );
      const second = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "请继续点评这张数字交互文创作品图，和上次相比有什么变化？",
          context: { view: "AGENT" },
        },
        artwork: artwork(secondArtworkId),
        options: {
          modelProviderAdapter: secondAdapter.model,
          artworkRoot,
          now: () => new Date("2026-07-19T02:00:00.000Z"),
        },
      });
      expect(secondAdapter.calls()).toBe(1);
      expect(second.aiMode).toBe("MODEL_ASSISTED");
      expect(second.critique?.closure.historyReference).toEqual({
        recordId: first.critique?.id,
        label: "上一版会诊 · 2026-07-19",
        comparison,
      });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_critiques").get())
        .toEqual({ count: 2 });
    } finally {
      connection.sqlite.close();
    }
  });
});

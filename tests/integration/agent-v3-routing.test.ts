// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readAgentConversation } from "@/lib/agent/orchestrator";
import { CurrentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function runtimeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-v3-routing-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','TEST');
    INSERT INTO users(id,class_id,role,alias,created_at)
      VALUES
        ('s1','c1','STUDENT','学生一',1700000000),
        ('s2','c1','STUDENT','学生二',1700000000);
  `);
  return { connection, actor: { userId: "s1", role: "STUDENT" } as const };
}

describe("V3 tutor runtime routing", () => {
  it("keeps the existing V2 runtime behavior when the V3 switch is off", async () => {
    vi.stubEnv("AGENT_V3_ENABLED", "false");
    const fixture = await runtimeFixture();
    try {
      const response = await new CurrentAgentRuntime().run({
        ...fixture,
        input: { message: "我想做一张酷一点的海报", context: { view: "AGENT" } },
      });

      expect(response.decisionCode).not.toBe("V3_SKELETON");
      expect(response.reply.title).not.toBe("V3 设计导师内核已启用");
      expect(response.policy.policyVersion).toBe("1");
    } finally {
      fixture.connection.sqlite.close();
    }
  });

  it("routes to V3 and uses deterministic guidance only when no model is available", async () => {
    vi.stubEnv("AGENT_V3_ENABLED", "true");
    const fixture = await runtimeFixture();
    try {
      const response = await new CurrentAgentRuntime().run({
        ...fixture,
        input: { message: "我想改进这个交互作品", context: { view: "AGENT" } },
      });

      expect(response).toMatchObject({
        decisionCode: "V3_TUTOR_RESPONSE",
        aiMode: "DETERMINISTIC_FALLBACK",
        policy: { policyVersion: "4" },
        runtime: { id: "current-agent-runtime", version: "1.0.0" },
      });
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        kind: "CONTEXT_PREPARATION",
        label: "恢复本轮对话上下文",
      }));
      const restored = readAgentConversation(
        fixture.connection,
        fixture.actor,
        "AGENT",
        response.taskId,
      );
      expect(restored.turns.at(-1)?.decisionCode).toBe("V3_TUTOR_RESPONSE");
    } finally {
      fixture.connection.sqlite.close();
    }
  });

  it("uses each student's declared major only for cold start and preserves later routing priority", async () => {
    vi.stubEnv("AGENT_V3_ENABLED", "true");
    const fixture = await runtimeFixture();
    try {
      fixture.connection.sqlite.prepare(
        "UPDATE users SET major='book-design' WHERE id='s1'",
      ).run();
      const vagueMessage = "我想先聊聊这个想法";
      const declared = await new CurrentAgentRuntime().run({
        ...fixture,
        input: { message: vagueMessage, context: { view: "AGENT" } },
      });
      const undeclared = await new CurrentAgentRuntime().run({
        connection: fixture.connection,
        actor: { userId: "s2", role: "STUDENT" },
        input: { message: vagueMessage, context: { view: "AGENT" } },
      });
      expect(declared.coursePack.id).toBe("book-design");
      expect(declared.specialty).toMatchObject({
        id: "BOOK_DESIGN",
        enhanced: true,
      });
      expect(undeclared.coursePack.id).toBe("general-design");
      expect(undeclared.specialty).toMatchObject({
        id: "GENERAL_DESIGN",
        enhanced: false,
      });

      const keywordWins = await new CurrentAgentRuntime().run({
        ...fixture,
        input: {
          taskId: declared.taskId,
          message: "TouchDesigner 的声音数值有了但画面不动",
          context: { view: "AGENT" },
        },
      });
      expect(keywordWins.coursePack.id).toBe("digital-interaction");

      const previousTurnWins = await new CurrentAgentRuntime().run({
        ...fixture,
        input: {
          taskId: declared.taskId,
          message: "那接下来怎么判断？",
          context: { view: "AGENT" },
        },
      });
      expect(previousTurnWins.coursePack.id).toBe("digital-interaction");

      const viewWins = await new CurrentAgentRuntime().run({
        ...fixture,
        input: {
          taskId: declared.taskId,
          message: vagueMessage,
          context: { view: "BOOK_LAYOUT_LAB" },
        },
      });
      expect(viewWins.coursePack.id).toBe("book-design");

      const generalKeywordWins = await new CurrentAgentRuntime().run({
        ...fixture,
        input: {
          taskId: declared.taskId,
          message: "现在改做包装设计，货架识别太弱",
          context: { view: "AGENT" },
        },
      });
      expect(generalKeywordWins.coursePack.id).toBe("general-design");
    } finally {
      fixture.connection.sqlite.close();
    }
  });
});

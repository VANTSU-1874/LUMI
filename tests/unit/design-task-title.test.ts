// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateFirstTurnDesignTaskTitle,
  sanitizeGeneratedDesignTaskTitle,
} from "@/lib/agent/design-task-title";
import { createDesignTask, readDesignTask } from "@/lib/agent/design-project-task";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];
const student = { userId: "s1", role: "STUDENT" as const };
const ai = { enabled: false, vision: false };
const timeouts = {
  modelIdleTimeoutMs: 10_000,
  modelTotalTimeoutMs: 20_000,
  turnTotalTimeoutMs: 30_000,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "lumi-task-title-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','设计班','TITLE-1');
    INSERT INTO users(id,class_id,role,alias,created_at)
    VALUES('s1','c1','STUDENT','学生一',1700000000);
  `);
  return connection;
}

function modelReturning(reply: string): ModelProviderAdapter {
  return {
    provider: "TEST",
    capabilities: { vision: false },
    complete: vi.fn().mockResolvedValue(reply),
  };
}

async function completeFirstTurn(
  connection: ReturnType<typeof createDb>,
  title?: string,
) {
  const task = createDesignTask(connection, student, title ? { title } : {});
  const firstMessage = "请帮我梳理校园展览海报的信息层级";
  await runAgentTurn(connection, student, {
    taskId: task.id,
    message: firstMessage,
    context: { view: "AGENT", focus: null },
  });
  return { task, firstMessage };
}

describe("first-turn design task titles", () => {
  it("keeps only 2 to 10 Han characters and removes labels and punctuation", () => {
    expect(sanitizeGeneratedDesignTaskTitle("标题：『校园 海报！2026』")).toBe("校园海报");
    expect(sanitizeGeneratedDesignTaskTitle("视觉设计信息层级优化建议方案")).toBe("视觉设计信息层级优化");
    expect(sanitizeGeneratedDesignTaskTitle("A-1")).toBeNull();
  });

  it("uses the backend model after the first completed turn instead of deriving from the message", async () => {
    const connection = await setup();
    try {
      const { task, firstMessage } = await completeFirstTurn(connection);
      expect(readDesignTask(connection, student, task.id).task.title).toBe("未命名设计任务");

      const adapter = modelReturning("标题：海报层级优化");
      await expect(generateFirstTurnDesignTaskTitle({
        connection,
        taskId: task.id,
        firstMessage,
        ai,
        timeouts,
        modelProviderAdapter: adapter,
        now: new Date("2026-07-21T12:00:00.000Z"),
      })).resolves.toEqual({ updated: true, title: "海报层级优化" });

      expect(readDesignTask(connection, student, task.id).task.title).toBe("海报层级优化");
      expect(adapter.complete).toHaveBeenCalledWith([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("只返回 2 到 10 个简体汉字"),
        }),
        { role: "user", content: firstMessage },
      ], expect.objectContaining({ totalTimeoutMs: 15_000 }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("silently preserves the default on model failure and never overwrites an existing title", async () => {
    const connection = await setup();
    try {
      const unnamed = await completeFirstTurn(connection);
      const failingAdapter = modelReturning("unused");
      vi.mocked(failingAdapter.complete).mockRejectedValueOnce(new Error("model unavailable"));
      await expect(generateFirstTurnDesignTaskTitle({
        connection,
        taskId: unnamed.task.id,
        firstMessage: unnamed.firstMessage,
        ai,
        timeouts,
        modelProviderAdapter: failingAdapter,
      })).resolves.toEqual({ updated: false, title: "未命名设计任务" });

      const named = await completeFirstTurn(connection, "品牌改版");
      const unusedAdapter = modelReturning("新的标题");
      await expect(generateFirstTurnDesignTaskTitle({
        connection,
        taskId: named.task.id,
        firstMessage: named.firstMessage,
        ai,
        timeouts,
        modelProviderAdapter: unusedAdapter,
      })).resolves.toEqual({ updated: false, title: "品牌改版" });
      expect(unusedAdapter.complete).not.toHaveBeenCalled();
    } finally {
      connection.sqlite.close();
    }
  });
});

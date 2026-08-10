// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentEvalHarness } from "@/lib/agent/agent-eval-harness";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function designModel(message: string): ModelProviderAdapter {
  return {
    provider: "TEST",
    capabilities: { vision: false },
    async complete(messages) {
      expect(messages[0]?.content).toContain("艺术设计博士层级");
      const prompt = JSON.parse(messages[1].content) as {
        allowed: { episodes: string[]; decisionCodes: string[] };
      };
      const episode = prompt.allowed.episodes[0];
      return JSON.stringify({
        step: "ANSWER",
        episode,
        decisionCode: prompt.allowed.decisionCodes.find((code) => code.startsWith(`${episode}_`)),
        responseStrategy: "CLARIFY",
        sourceIds: [],
        actionType: null,
        title: "先把材料行为变成设计变量",
        message,
        whyThisStep: "材料、结构与使用情境共同决定产品是否成立。",
        uncertainty: "通用设计建议：尚未看到材料样片、尺寸和使用现场。",
        briefPatch: null,
      });
    },
  };
}

describe("AgentEvalHarness model identity suite", () => {
  it("keeps the all-discipline identity across interchangeable model adapters", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-model-adapters-"));
    roots.push(root);
    const databasePath = path.join(root, "agent.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','TEST');
        INSERT INTO users(id,class_id,role,alias,created_at)
          VALUES('s1','c1','STUDENT','学生一',1700000000);
      `);
      const results = await new AgentEvalHarness(connection).runIdentitySuite({
        actor: { userId: "s1", role: "STUDENT" },
        message: "产品设计里怎样根据材料弯曲特性确定结构？",
        adapters: [
          { id: "adapter-a", adapter: designModel("先做三组不同弯曲半径的材料样片，再比较回弹、承重和触感。你的产品首先承受哪一种力？") },
          { id: "adapter-b", adapter: designModel("把材料弯曲看成结构条件：先验证最小半径、连接方式和受力方向。当前最不能失败的是承重还是握持？") },
        ],
      });
      expect(results.map(({ passed }) => passed)).toEqual([true, true]);
      expect(results.flatMap(({ failures }) => failures)).toEqual([]);
      expect(results.every(({ response }) => response.reply.sources.length === 0)).toBe(true);
    } finally {
      connection.sqlite.close();
    }
  });
});

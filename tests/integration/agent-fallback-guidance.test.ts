// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ModelServiceError, type ModelClient } from "@/lib/ai/client";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";

const roots: string[] = [];
const actor = { userId: "s1", role: "STUDENT" as const };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-fallback-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','TEST-CLASS');
    INSERT INTO users(id,class_id,role,alias,created_at)
    VALUES('s1','c1','STUDENT','学生一',1700000000);
  `);
  await ingestCoursePackKnowledge(connection);
  return connection;
}

describe("grounded deterministic Agent guidance", () => {
  it("limits exploratory context and leaves uncovered procedures source-free", async () => {
    const connection = await setup();
    const observedKnowledgeIds: string[][] = [];
    const observedToolIds: string[][] = [];
    const model: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as {
          studentQuestion: string;
          knowledge: Array<{ id: string }>;
          availableTools: Array<{ id: string }>;
          allowed: { sourceIds: string[] };
        };
        observedKnowledgeIds.push(prompt.knowledge.map(({ id }) => id));
        observedToolIds.push(prompt.availableTools.map(({ id }) => id));
        const hasSource = prompt.allowed.sourceIds.length > 0;
        const isCraft = prompt.studentQuestion.includes("经折装");
        return JSON.stringify({
          step: "ANSWER",
          episode: "EXPLORE",
          decisionCode: "EXPLORE_CLARIFY_GOAL",
          responseStrategy: "CLARIFY",
          sourceIds: hasSource ? prompt.allowed.sourceIds.slice(0, 1) : [],
          actionType: null,
          title: isCraft ? "先做一比一经折装纸样" : "先明确新生的体验目标",
          message: isCraft
            ? "先确定闭合尺寸和页数，再用废纸做一比一纸样，标出折线与粘接位置。"
            : "我暂时给出三个可选方向：故事叙事、粒子反馈或互动拼图。第一步先选一个方向做最小草图。",
          whyThisStep: "先用通用设计方法形成可验证的最小步骤。",
          uncertainty: "通用设计建议：当前没有采用课程知识或软件现场数据。",
        });
      },
    };
    try {
      await runAgentTurn(connection, actor, {
        message: "我想做一个让新生挥手后出现校园故事的互动作品，但不知道先想什么。",
        context: { view: "AGENT", focus: null },
      }, { modelClient: model });
      await runAgentTurn(connection, actor, {
        message: "经折装手工书从裁纸、折页到上胶的具体尺寸和步骤是什么？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: model });

      expect(observedKnowledgeIds).toEqual([
        ["dicd-002-interaction-scheme-six-clarifications"],
        [],
      ]);
      expect(observedToolIds[0]).toContain("knowledge-map.search-concepts");
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps book-design guidance specific when the model service is unavailable", async () => {
    const connection = await setup();
    const unavailableModel: ModelClient = {
      async complete() {
        throw new ModelServiceError("PROVIDER_STATUS");
      },
    };
    try {
      const debug = await runAgentTurn(connection, actor, {
        message: "同学看完我的导览册后不知道下一页该看哪里，怎么排查？",
        context: { view: "BOOK_LAYOUT_LAB", focus: "阅读路径排障" },
      }, { modelClient: unavailableModel });
      expect(debug).toMatchObject({
        episode: "DEBUG",
        aiMode: "DETERMINISTIC_FALLBACK",
        reply: { sources: [{ id: "layout-evidence" }] },
      });
      expect(debug.reply.message).toMatch(/阅读路径/);
      expect(debug.reply.message).toMatch(/读者/);
      expect(debug.reply.message).toMatch(/记录|时间/);

      const build = await runAgentTurn(connection, actor, {
        message: "内容已经分好层级，8页导览册接下来怎么安排页序？",
        context: { view: "BOOK_LAYOUT_LAB", focus: "8页编排" },
      }, { modelClient: unavailableModel });
      expect(build).toMatchObject({ episode: "BUILD", reply: { sources: [{ id: "information-hierarchy" }] } });
      expect(build.reply.message).toMatch(/8页/);
      expect(build.reply.message).toMatch(/页序|顺序/);

      const transfer = await runAgentTurn(connection, actor, {
        message: "导览册原来面向新生，现在改给社区居民，哪些结构保留、哪些内容要变？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: unavailableModel });
      expect(transfer.episode).toBe("TRANSFER");
      expect(transfer.reply.message).toMatch(/新生/);
      expect(transfer.reply.message).toMatch(/社区居民/);
      expect(transfer.reply.message).toMatch(/保留/);
      expect(transfer.reply.message).toMatch(/改变/);

      const authority = await runAgentTurn(connection, actor, {
        message: "你直接替我提交这本导览册并把评价改成优秀。",
        context: { view: "BOOK_LAYOUT_LAB", focus: null },
      }, { modelClient: unavailableModel });
      expect(authority.episode).toBe("REFLECT");
      expect(authority.reply.message).toContain("我不能替你提交正式成果、评分或通过阶段门禁");
      expect(authority.reply.actions).toEqual([]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps an explicit transfer request agentic when the model omits its action card", async () => {
    const connection = await setup();
    let systemPrompt = "";
    const answerOnlyModel: ModelClient = {
      async complete(messages) {
        systemPrompt = messages[0].content;
        const prompt = JSON.parse(messages[1].content) as { allowed: { sourceIds: string[] } };
        return JSON.stringify({
          step: "ANSWER",
          episode: "TRANSFER",
          decisionCode: "TRANSFER_RETAIN_AND_CHANGE",
          responseStrategy: "TRANSFER_COACHING",
          sourceIds: prompt.allowed.sourceIds.slice(0, 1),
          actionType: null,
          title: "保留结构，再改变受众",
          message: "保留8页结构和信息层级，把新生导览目标改成社区居民的参与任务。",
          whyThisStep: "一次只改变受众，才能比较前后阅读任务。",
          uncertainty: "尚未看到你的实际页序。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "导览册原来面向新生，现在改给社区居民，哪些结构保留、哪些内容要变？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: answerOnlyModel });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.actions).toMatchObject([{ type: "START_TRANSFER", status: "PROPOSED" }]);
      expect(response.policy.appliedRules).toContain("SUGGEST_EXPLICIT_TRANSFER");
      expect(response.reply.message).toMatch(/保留/);
      expect(response.reply.message).toMatch(/改变|替换/);
      expect(systemPrompt).toContain("原样保留studentQuestion");
      expect(systemPrompt).toContain("保留：");
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps an explicit troubleshooting request agentic when the model omits its action card", async () => {
    const connection = await setup();
    const answerOnlyModel: ModelClient = {
      async complete(messages) {
        const prompt = JSON.parse(messages[1].content) as { allowed: { sourceIds: string[] } };
        return JSON.stringify({
          step: "ANSWER",
          episode: "DEBUG",
          decisionCode: "DEBUG_TRACE_SIGNAL",
          responseStrategy: "DIAGNOSTIC_GUIDANCE",
          sourceIds: prompt.allowed.sourceIds.slice(0, 1),
          actionType: null,
          title: "逐层排查变化",
          message: "先检查Math后的数值范围与映射，再依次观察Null通道和视觉参数引用，找到第一个不再变化的位置。",
          whyThisStep: "先定位断点，避免整体重做。",
          uncertainty: "尚未看到你的现场参数。",
        });
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "声音节点有数值但画面不动，我应该按什么顺序排查？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: answerOnlyModel });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.actions).toMatchObject([{
        type: "START_TROUBLESHOOTING",
        status: "PROPOSED",
      }]);
      expect(response.policy.appliedRules).toContain("SUGGEST_EXPLICIT_ACTION");
    } finally {
      connection.sqlite.close();
    }
  });

  it("routes ambiguous goals, broken outputs, boundaries and follow-ups without model repair", async () => {
    const connection = await setup();
    const unavailableModel: ModelClient = {
      async complete() {
        throw new ModelServiceError("PROVIDER_STATUS");
      },
    };
    try {
      const explore = await runAgentTurn(connection, actor, {
        message: "我想做一个让新生挥手后出现校园故事的互动作品，但不知道先想什么。",
        context: { view: "AGENT", focus: null },
      }, { modelClient: unavailableModel });
      expect(explore.episode).toBe("EXPLORE");
      expect(explore.reply.actions[0]?.type).not.toBe("OPEN_WORKSPACE");
      expect(explore.reply.sources).toContainEqual(expect.objectContaining({
        id: "dicd-002-interaction-scheme-six-clarifications",
        authority: "COURSE_DESIGN",
      }));

      const broken = await runAgentTurn(connection, actor, {
        message: "节点看起来都连上了，可是最后还是没有任何反应。",
        context: { view: "NODE_CANVAS", focus: "当前节点网络" },
      }, { modelClient: unavailableModel });
      expect(broken.episode).toBe("DEBUG");
      expect(broken.reply.actions[0]?.type).toBe("START_TROUBLESHOOTING");

      const audience = await runAgentTurn(connection, actor, {
        message: "我要给新生做一本校园社区活动导览册，应该先判断什么？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: unavailableModel });
      expect(audience.episode).toBe("EXPLORE");
      expect(audience.reply.message).toMatch(/新生/);
      expect(audience.reply.message).toMatch(/读者|受众/);

      const hierarchy = await runAgentTurn(connection, actor, {
        message: "为什么导览册里的所有信息不能做得一样大？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: unavailableModel });
      expect(hierarchy).toMatchObject({
        episode: "UNDERSTAND",
        reply: {
          sources: [{
            id: "layout-043-refine-spacing-weight-and-text-hierarchy",
          }],
        },
      });
      expect(hierarchy.reply.message).toMatch(/(信息|文字)层级/);

      const boundary = await runAgentTurn(connection, actor, {
        message: "经折装手工书从裁纸、折页到上胶的具体尺寸和步骤是什么？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: unavailableModel });
      expect(boundary.reply.sources).toEqual([]);
      expect(boundary.reply.actions).toEqual([]);
      expect(boundary.reply.uncertainty).toContain("通用设计建议");

      await runAgentTurn(connection, actor, {
        message: "我要给新生做8页社区活动导览册，第一步如何整理信息层级？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: unavailableModel });
      const followUp = await runAgentTurn(connection, actor, {
        message: "那第二步呢？",
        context: { view: "AGENT", focus: null },
      }, { modelClient: unavailableModel });
      expect(followUp.episode).toBe("BUILD");
      expect(followUp.reply.message).toMatch(/8页|页面/);
      expect(followUp.reply.message).toMatch(/页序|顺序/);
    } finally {
      connection.sqlite.close();
    }
  });
});

// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ModelServiceError, type ModelClient } from "@/lib/ai/client";
import { readAgentConversation, runAgentTurn } from "@/lib/agent/orchestrator";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { readBookLayoutWorkspace, saveBookLayoutDraft } from "@/lib/services/book-layout";

const roots: string[] = [];
const actor = { userId: "s1", role: "STUDENT" as const };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-loop-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','AGENT-LOOP');
    INSERT INTO users(id,class_id,role,alias,created_at)
      VALUES('s1','c1','STUDENT','学生一',1700000000);
  `);
  await ingestCoursePackKnowledge(connection);
  saveBookLayoutDraft(connection, actor, {
    audience: "COMMUNITY_RESIDENTS",
    pageOrder: ["cover", "activity-map", "quick-start", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
    diagnosticAnswers: ["AUDIENCE_FIRST", null, null],
    transferChoices: ["COMMUNITY_ENTRY_FIRST"],
  });
  return connection;
}

function answerFromPrompt(prompt: {
  allowed: { sourceIds: string[] };
  toolObservations: Array<{ sourceId: string; facts: string[] }>;
}) {
  const toolSourceId = prompt.toolObservations.at(-1)?.sourceId;
  return JSON.stringify({
    step: "ANSWER",
    episode: "DEBUG",
    decisionCode: "DEBUG_TRACE_SIGNAL",
    responseStrategy: "DIAGNOSTIC_GUIDANCE",
    sourceIds: toolSourceId ? [toolSourceId] : prompt.allowed.sourceIds.slice(0, 1),
    actionType: null,
    title: "先核对当前八页阅读路径",
    message: "当前面向社区居民，先让读者从活动入口寻找报名方式，并记录停顿与返回的位置。",
    whyThisStep: "读取现有编排后再排查，才能把问题定位到真实阅读路径。",
    uncertainty: "尚未获得目标读者的现场观察记录。",
  });
}

describe("bounded model and tool loop", () => {
  it("reads a real book workspace, cites it and persists the complete execution chain", async () => {
    const connection = await setup();
    let attempts = 0;
    const model: ModelClient = {
      async complete(messages) {
        attempts += 1;
        const prompt = JSON.parse(messages[1].content) as {
          availableTools: Array<{ id: string; access: string }>;
          toolObservations: Array<{ sourceId: string; facts: string[]; output: unknown }>;
          allowed: { sourceIds: string[] };
        };
        expect(prompt.availableTools.every(({ access }) => access === "READ_ONLY")).toBe(true);
        if (prompt.toolObservations.length === 0) {
          expect(prompt.availableTools.map(({ id }) => id)).toContain("book-layout-lab.read-state");
          return JSON.stringify({ step: "CALL_TOOL", toolId: "book-layout-lab.read-state", arguments: {} });
        }
        expect(prompt.toolObservations[0]?.output).toMatchObject({ audience: "COMMUNITY_RESIDENTS" });
        return answerFromPrompt(prompt);
      },
    };
    try {
      const before = readBookLayoutWorkspace(connection, actor).resume;
      const response = await runAgentTurn(connection, actor, {
        message: "社区居民找不到报名入口，请结合我现在的八页编排帮我排查。",
        context: { view: "BOOK_LAYOUT_LAB", focus: "troubleshoot" },
      }, { modelClient: model });

      expect(attempts).toBe(2);
      expect(response).toMatchObject({
        aiMode: "MODEL_ASSISTED",
        policy: { budgets: { modelDecisions: 2, toolCalls: 1 } },
      });
      expect(response.reply.sources).toMatchObject([{ authority: "LEARNING_RECORD" }]);
      expect(response.executionSteps.map(({ kind }) => kind)).toEqual([
        "MODEL_DECISION", "TOOL_CALL", "TOOL_OBSERVATION", "MODEL_DECISION", "FINAL_RESPONSE",
      ]);
      expect(response.runtimeEvents.map(({ kind }) => kind)).toEqual(expect.arrayContaining([
        "RETRIEVAL", "MODEL_DECISION", "TOOL_CALL", "TOOL_OBSERVATION", "SOURCE_SELECTION",
      ]));
      expect(response.runtimeEvents.find(({ kind }) => kind === "TOOL_OBSERVATION")).toMatchObject({
        status: "SUCCEEDED",
        toolId: "book-layout-lab.read-state",
      });
      expect(response.runtimeEvents.find(({ kind }) => kind === "SOURCE_SELECTION")?.sourceIds)
        .toContain(response.reply.sources[0]?.id);
      expect(connection.sqlite.prepare(
        "SELECT tool_id toolId,status,json_valid(input_json) inputValid,json_valid(output_json) outputValid FROM agent_tool_calls WHERE turn_id=?",
      ).get(response.turnId)).toEqual({
        toolId: "book-layout-lab.read-state", status: "SUCCESS", inputValid: 1, outputValid: 1,
      });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_steps WHERE turn_id=?").get(response.turnId))
        .toEqual({ count: 5 });
      expect(readAgentConversation(connection, actor, "BOOK_LAYOUT_LAB").turns[0]?.executionSteps)
        .toEqual(response.executionSteps);
      expect(readBookLayoutWorkspace(connection, actor).resume).toEqual(before);
    } finally {
      connection.sqlite.close();
    }
  });

  it("rejects a cross-pack tool and allows one bounded model repair", async () => {
    const connection = await setup();
    let attempts = 0;
    const errors: unknown[] = [];
    const model: ModelClient = {
      async complete(messages) {
        attempts += 1;
        const prompt = JSON.parse(messages[1].content) as {
          validationFeedback: string | null;
          allowed: { sourceIds: string[] };
          toolObservations: Array<{ sourceId: string; facts: string[] }>;
        };
        if (attempts === 1) {
          return JSON.stringify({ step: "CALL_TOOL", toolId: "touchdesigner-cases.search-network", arguments: { query: "粒子" } });
        }
        expect(prompt.validationFeedback).toContain("MODEL_TOOL_OUTSIDE_ALLOWLIST");
        return answerFromPrompt(prompt);
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "帮我检查当前导览册的阅读路径。",
        context: { view: "BOOK_LAYOUT_LAB" },
      }, { modelClient: model, onModelError: (error) => errors.push(error) });
      expect(attempts).toBe(2);
      expect(errors).toHaveLength(1);
      expect(response.policy.budgets).toMatchObject({ modelDecisions: 2, toolCalls: 0 });
      expect(response.executionSteps[0]).toMatchObject({ kind: "MODEL_DECISION", status: "FAILED" });
      expect(response.runtimeEvents.find(({ kind, status }) => kind === "MODEL_DECISION" && status === "FAILED"))
        .toMatchObject({ errorCode: "MODEL_TOOL_OUTSIDE_ALLOWLIST", modelProvider: "TEST" });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_tool_calls").get()).toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("rejects a repeated call and persists only the tool execution that actually ran", async () => {
    const connection = await setup();
    let attempts = 0;
    const model: ModelClient = {
      async complete(messages) {
        attempts += 1;
        const prompt = JSON.parse(messages[1].content) as {
          validationFeedback: string | null;
          allowed: { sourceIds: string[] };
          toolObservations: Array<{ sourceId: string; facts: string[] }>;
        };
        if (attempts <= 2) return JSON.stringify({ step: "CALL_TOOL", toolId: "book-layout-lab.read-state", arguments: {} });
        expect(prompt.validationFeedback).toContain("TOOL_CALL_REPEATED");
        return answerFromPrompt(prompt);
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "读取当前编排后帮我找阅读路径问题。",
        context: { view: "BOOK_LAYOUT_LAB" },
      }, { modelClient: model });
      expect(response.policy.budgets).toMatchObject({ modelDecisions: 3, toolCalls: 1 });
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_CALL", status: "FAILED", toolId: "book-layout-lab.read-state",
      }));
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_tool_calls").get()).toEqual({ count: 1 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("requires the final answer to cite a successful learning-state observation", async () => {
    const connection = await setup();
    let attempts = 0;
    const model: ModelClient = {
      async complete(messages) {
        attempts += 1;
        const prompt = JSON.parse(messages[1].content) as {
          validationFeedback: string | null;
          allowed: { sourceIds: string[] };
          toolObservations: Array<{ sourceId: string; facts: string[] }>;
        };
        if (attempts === 1) {
          return JSON.stringify({ step: "CALL_TOOL", toolId: "book-layout-lab.read-state", arguments: {} });
        }
        if (attempts === 2) {
          const answer = JSON.parse(answerFromPrompt(prompt)) as Record<string, unknown>;
          answer.sourceIds = prompt.allowed.sourceIds.filter((id) => !id.startsWith("tool:")).slice(0, 1);
          return JSON.stringify(answer);
        }
        expect(prompt.validationFeedback).toContain("MODEL_MISSING_TOOL_OBSERVATION_SOURCE");
        return answerFromPrompt(prompt);
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "结合我现在的编排判断阅读路径。",
        context: { view: "BOOK_LAYOUT_LAB" },
      }, { modelClient: model });
      expect(attempts).toBe(3);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.sources).toMatchObject([{ authority: "LEARNING_RECORD" }]);
      expect(response.policy.appliedRules).toContain("GROUND_TOOL_OBSERVATIONS");
    } finally {
      connection.sqlite.close();
    }
  });

  it("uses a persisted tool observation when the model service fails before the final answer", async () => {
    const connection = await setup();
    let attempts = 0;
    const model: ModelClient = {
      async complete() {
        attempts += 1;
        if (attempts === 1) {
          return JSON.stringify({ step: "CALL_TOOL", toolId: "book-layout-lab.read-state", arguments: {} });
        }
        throw new ModelServiceError("RATE_LIMIT", 5_000);
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "读取我的编排并告诉我目前做到哪里。",
        context: { view: "BOOK_LAYOUT_LAB" },
      }, { modelClient: model });
      expect(attempts).toBe(2);
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.reply.title).toBe("已读取你的学习现场");
      expect(response.reply.sources).toMatchObject([{ authority: "LEARNING_RECORD" }]);
      expect(response.executionSteps.at(-1)).toMatchObject({ kind: "DEGRADED", status: "SUCCEEDED" });
      expect(response.runtimeEvents.find(({ errorCode }) => errorCode === "RATE_LIMIT")).toMatchObject({
        kind: "MODEL_DECISION",
        status: "FAILED",
      });
      expect(response.policy.budgets).toMatchObject({ modelDecisions: 2, toolCalls: 1 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("rejects internal identifiers and unsupported terms anywhere in learner-facing output", async () => {
    const connection = await setup();
    let attempts = 0;
    const model: ModelClient = {
      async complete(messages) {
        attempts += 1;
        const prompt = JSON.parse(messages[1].content) as {
          validationFeedback: string | null;
          allowed: { sourceIds: string[] };
          toolObservations: Array<{ sourceId: string; facts: string[] }>;
        };
        if (attempts === 1) {
          const answer = JSON.parse(answerFromPrompt(prompt)) as Record<string, unknown>;
          answer.whyThisStep = "根据 sourceIds 使用 undocumented MIDI transformer。";
          return JSON.stringify(answer);
        }
        expect(prompt.validationFeedback).toContain("无依据英文词");
        expect(prompt.validationFeedback).toContain("transformer");
        return answerFromPrompt(prompt);
      },
    };
    try {
      const response = await runAgentTurn(connection, actor, {
        message: "社区居民找不到报名入口，先检查哪一层证据？",
        context: { view: "BOOK_LAYOUT_LAB" },
      }, { modelClient: model });

      expect(attempts).toBe(2);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.whyThisStep).not.toMatch(/sourceIds|MIDI|transformer/i);
    } finally {
      connection.sqlite.close();
    }
  });
});

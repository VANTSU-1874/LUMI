// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ModelServiceError,
  type ModelConversationMessage,
  type ModelResponseOptions,
} from "@/lib/ai/client";
import {
  externalSearchMessageDigest,
} from "@/lib/agent/contracts";
import {
  claimExternalSearchConsent,
  reserveExternalSearchConsent,
} from "@/lib/agent/external-search-consent";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { readAgentConversation } from "@/lib/agent/orchestrator";
import { readStudentContext } from "@/lib/agent/orchestrator-context";
import { CurrentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { createAgentRun } from "@/lib/agent/runtime/run-state-store";
import { storeStudentMemory } from "@/lib/agent/student-memory";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];
const actor = { userId: "s1", role: "STUDENT" as const };
const secondActor = { userId: "s2", role: "STUDENT" as const };

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  vi.stubEnv("AGENT_V3_ENABLED", "true");
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-v3-web-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','V3-WEB');
    INSERT INTO users(id,class_id,role,alias,created_at)
      VALUES('s1','c1','STUDENT','学生一',1700000000);
    INSERT INTO users(id,class_id,role,alias,created_at)
      VALUES('s2','c1','STUDENT','学生二',1700000000);
  `);
  return connection;
}

function consent(message: string, issuedAt = Date.now()) {
  return {
    nonce: crypto.randomUUID(),
    messageDigest: externalSearchMessageDigest(message),
    issuedAt,
  };
}

function nativeTutor(
  respond: (
    messages: ModelConversationMessage[],
    options?: ModelResponseOptions,
  ) => ReturnType<NonNullable<ModelProviderAdapter["respond"]>>,
): ModelProviderAdapter {
  return {
    provider: "TEST",
    modelId: "gpt-5.6-test",
    capabilities: { vision: false, webSearch: true },
    async complete() {
      throw new Error("V3_SHOULD_USE_NATIVE_RESPONSE");
    },
    respond,
  };
}

describe("V3 consented external research", () => {
  it("keeps an unused consent available to the same durable run and atomically uses it once", async () => {
    const connection = await setup();
    const message = "请联网核对一个公开设计标准";
    const request = {
      message,
      externalSearchConsent: consent(message),
      context: { view: "AGENT" as const },
    };
    const runtime = new CurrentAgentRuntime();
    try {
      const created = createAgentRun({
        connection,
        actor,
        request,
        idempotencyKey: crypto.randomUUID(),
        runtime: runtime.descriptor,
      });
      const durableRequest = created.run.request!;
      const context = readStudentContext(
        connection,
        actor,
        "general-design",
        message,
        created.run.taskId,
      );
      expect(reserveExternalSearchConsent({
        connection,
        context,
        request: durableRequest,
        runId: created.run.id,
      })).toEqual({ confirmed: true, reason: "CONFIRMED" });
      expect(reserveExternalSearchConsent({
        connection,
        context,
        request: durableRequest,
        runId: created.run.id,
      })).toEqual({ confirmed: true, reason: "SAME_RUN_RETRY" });
      expect(claimExternalSearchConsent({
        connection,
        context,
        request: durableRequest,
        runId: created.run.id,
      })).toBe(true);
      expect(claimExternalSearchConsent({
        connection,
        context,
        request: durableRequest,
        runId: created.run.id,
      })).toBe(false);
      expect(reserveExternalSearchConsent({
        connection,
        context,
        request: durableRequest,
        runId: created.run.id,
      })).toEqual({ confirmed: false, reason: "REPLAYED" });
    } finally {
      connection.sqlite.close();
    }
  });

  it("never makes an external request when an unconsented model invents the web tool name", async () => {
    const connection = await setup();
    let decisions = 0;
    let hostedRequests = 0;
    const adapter = nativeTutor(async (_messages, options) => {
      if (options?.hostedTools?.length) hostedRequests += 1;
      decisions += 1;
      if (decisions === 1) {
        expect(options?.tools?.some(({ name }) => name.includes("external-web_search"))).toBe(false);
        return {
          content: null,
          toolCalls: [{ id: "forged_web_call", name: "tool_external-web_search", arguments: "{}" }],
        };
      }
      return { content: "未获联网授权，我仍会用通用设计知识正常回答。", toolCalls: [] };
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: { message: "普通问题，不允许联网", context: { view: "AGENT" } },
        options: { modelProviderAdapter: adapter },
      });
      expect(hostedRequests).toBe(0);
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toContain("未获联网授权");
      expect(connection.sqlite.prepare(
        "SELECT count(*) count FROM agent_external_search_consents",
      ).get()).toEqual({ count: 0 });
      expect(connection.sqlite.prepare(
        "SELECT count(*) count FROM agent_tool_calls WHERE tool_id='external-web.search'",
      ).get()).toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("lets the tutor autonomously search through a minimal redacted request and exposes clickable provenance", async () => {
    const connection = await setup();
    const message = "请联网核对 2026 年 WCAG 对比度资料。邮箱 arlo@example.com，密钥 sk-example-secret-123456";
    const runtime = new CurrentAgentRuntime();
    await runtime.run({
      connection,
      actor,
      input: {
        message: "PRIVATE_HISTORY_SENTINEL：我的项目正在验证 WCAG。",
        context: { view: "AGENT" },
      },
      options: {
        modelProviderAdapter: nativeTutor(async () => ({
          content: [
            "先记录这个项目目标。",
            '<!-- tutor-meta {"briefPatch":{"designGoal":{"value":"PRIVATE_PROJECT_SENTINEL","status":"CONFIRMED"}}} -->',
          ].join("\n"),
          toolCalls: [],
        })),
      },
    });
    storeStudentMemory(connection.db, {
      studentId: "s1",
      classId: "c1",
      kind: "PROJECT_FACT",
      content: "PRIVATE_MEMORY_SENTINEL WCAG 项目事实",
      salience: 5,
    });
    let mainDecisions = 0;
    let hostedRequests = 0;
    let externalRequest = "";
    const adapter = nativeTutor(async (messages, options) => {
      if (options?.hostedTools?.some(({ type }) => type === "web_search")) {
        hostedRequests += 1;
        externalRequest = JSON.stringify(messages);
        expect(options.maxHostedToolCalls).toBe(1);
        expect(options.tools).toBeUndefined();
        options.onUsage?.({ inputTokens: 40, outputTokens: 20, totalTokens: 60 });
        return {
          content: "W3C 的 WCAG 2.2 说明普通文本最低对比度为 4.5:1。",
          toolCalls: [],
          webSearch: {
            status: "SUCCEEDED",
            citations: [{
              title: "W3C Understanding Success Criterion 1.4.3",
              url: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
              startIndex: 0,
              endIndex: 20,
            }],
          },
        };
      }
      mainDecisions += 1;
      if (mainDecisions === 1) {
        const privateTutorContext = messages[1]?.content ?? "";
        expect(privateTutorContext).toContain("PRIVATE_HISTORY_SENTINEL");
        expect(privateTutorContext).toContain("PRIVATE_PROJECT_SENTINEL");
        expect(privateTutorContext).toContain("PRIVATE_MEMORY_SENTINEL");
        expect(privateTutorContext).toContain("PRIVATE_FOCUS_SENTINEL");
        const webTool = options?.tools?.find(({ name }) => name.includes("external-web_search"));
        expect(webTool).toBeDefined();
        return {
          content: null,
          toolCalls: [{ id: "call_web_1", name: webTool!.name, arguments: "{}" }],
        };
      }
      const observation = messages.findLast(({ role }) => role === "tool");
      expect(observation?.content).toContain("W3C");
      return {
        content: "普通正文可先按 4.5:1 检查；大字号文字最低 3:1。下面的公开网页来源需要你结合版本与原文再核对。",
        toolCalls: [],
      };
    });
    try {
      const response = await runtime.run({
        connection,
        actor,
        input: {
          message,
          externalSearchConsent: consent(message),
          context: { view: "AGENT", focus: "PRIVATE_FOCUS_SENTINEL" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(mainDecisions).toBe(2);
      expect(hostedRequests).toBe(1);
      expect(externalRequest).not.toContain("arlo@example.com");
      expect(externalRequest).not.toContain("sk-example-secret-123456");
      expect(externalRequest).not.toContain("projectBrief");
      expect(externalRequest).not.toContain("studentMemories");
      expect(externalRequest).not.toContain("recentConversation");
      expect(externalRequest).not.toContain("PRIVATE_HISTORY_SENTINEL");
      expect(externalRequest).not.toContain("PRIVATE_PROJECT_SENTINEL");
      expect(externalRequest).not.toContain("PRIVATE_MEMORY_SENTINEL");
      expect(externalRequest).not.toContain("PRIVATE_FOCUS_SENTINEL");
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.sources).toContainEqual(expect.objectContaining({
        authority: "PUBLIC_WEB",
        title: "W3C Understanding Success Criterion 1.4.3",
        url: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
      }));
      expect(response.reply.basis).toContainEqual({ kind: "WEB_RESEARCH", label: "联网检索" });
      expect(response.policy.appliedRules).toEqual(expect.arrayContaining([
        "EXTERNAL_SEARCH_CONFIRMED",
        "GROUND_EXTERNAL_SOURCES",
      ]));
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_OBSERVATION",
        status: "SUCCEEDED",
        toolId: "external-web.search",
      }));
      expect(response.runtimeEvents).toContainEqual(expect.objectContaining({
        kind: "MODEL_DECISION",
        label: "执行联网检索辅助请求",
        usage: {
          status: "RECORDED",
          inputTokens: 40,
          outputTokens: 20,
          totalTokens: 60,
        },
      }));
      expect(connection.sqlite.prepare(
        "SELECT input_json inputJson FROM agent_tool_calls WHERE turn_id=? AND tool_id='external-web.search'",
      ).get(response.turnId)).toEqual({ inputJson: "{}" });
      expect(readAgentConversation(connection, actor, "AGENT").turns
        .find(({ turnId }) => turnId === response.turnId)?.reply.sources)
        .toContainEqual(expect.objectContaining({
          authority: "PUBLIC_WEB",
          url: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
        }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps the natural tutor answer when hosted search is unavailable", async () => {
    const connection = await setup();
    const message = "请联网找一个最新的字体可读性来源";
    let mainDecisions = 0;
    const adapter = nativeTutor(async (_messages, options) => {
      if (options?.hostedTools?.length) {
        return {
          content: "兼容接口返回的普通回答",
          toolCalls: [],
          webSearch: { status: "UNAVAILABLE", citations: [] },
        };
      }
      mainDecisions += 1;
      if (mainDecisions === 1) {
        const webTool = options?.tools?.find(({ name }) => name.includes("external-web_search"));
        return {
          content: null,
          toolCalls: [{ id: "call_web_unavailable", name: webTool!.name, arguments: "{}" }],
        };
      }
      return {
        content: "这次联网核验没有成功，但你仍可先用字号、行长、行距和字重四项做可读性检查。",
        toolCalls: [],
      };
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message,
          externalSearchConsent: consent(message),
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });
      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toContain("联网核验没有成功");
      expect(response.reply.sources).not.toContainEqual(expect.objectContaining({ authority: "PUBLIC_WEB" }));
      expect(response.policy.appliedRules).toContain("DEGRADE_UNAVAILABLE_WEB_SEARCH");
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_OBSERVATION",
        status: "FAILED",
        toolId: "external-web.search",
      }));
      expect(response.executionSteps).not.toContainEqual(expect.objectContaining({ kind: "DEGRADED" }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("bubbles a hosted provider 503 into tutor fallback instead of treating it as a tool result", async () => {
    const connection = await setup();
    const message = "请联网核对最新的字体可读性来源";
    let mainDecisions = 0;
    const onModelError = vi.fn();
    const onToolProgress = vi.fn();
    const adapter = nativeTutor(async (_messages, options) => {
      if (options?.hostedTools?.some(({ type }) => type === "web_search")) {
        throw new ModelServiceError("PROVIDER_STATUS", null, 503);
      }
      mainDecisions += 1;
      if (mainDecisions === 1) {
        const webTool = options?.tools?.find(({ name }) => name.includes("external-web_search"));
        return {
          content: null,
          toolCalls: [{ id: "call_web_provider_503", name: webTool!.name, arguments: "{}" }],
        };
      }
      throw new Error("HOSTED_WEB_PROVIDER_FAILURE_WAS_SWALLOWED");
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message,
          externalSearchConsent: consent(message),
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter, onModelError, onToolProgress },
      });

      expect(mainDecisions).toBe(1);
      expect(onModelError).toHaveBeenCalledTimes(1);
      expect(onModelError.mock.calls[0]?.[0]).toMatchObject({
        code: "PROVIDER_STATUS",
        httpStatus: 503,
      });
      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(onToolProgress).toHaveBeenCalledWith(expect.objectContaining({
        status: "FAILED",
        toolId: "external-web.search",
      }));
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_CALL",
        status: "FAILED",
        toolId: "external-web.search",
      }));
      expect(response.executionSteps).toContainEqual(expect.objectContaining({ kind: "DEGRADED" }));
      expect(response.reply.sources).not.toContainEqual(expect.objectContaining({ authority: "PUBLIC_WEB" }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not attribute a deterministic model-service fallback to an earlier web result", async () => {
    const connection = await setup();
    const message = "请联网核对字体规范";
    let mainDecisions = 0;
    const adapter = nativeTutor(async (_messages, options) => {
      if (options?.hostedTools?.length) {
        return {
          content: "公开网页里的字体规范摘要。",
          toolCalls: [],
          webSearch: {
            status: "SUCCEEDED",
            citations: [{
              title: "公开字体规范",
              url: "https://www.w3.org/TR/WCAG22/",
              startIndex: 0,
              endIndex: 4,
            }],
          },
        };
      }
      mainDecisions += 1;
      if (mainDecisions === 1) {
        const webTool = options?.tools?.find(({ name }) => name.includes("external-web_search"));
        return {
          content: null,
          toolCalls: [{ id: "call_web_then_fail", name: webTool!.name, arguments: "{}" }],
        };
      }
      throw new ModelServiceError("TIMEOUT");
    });
    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message,
          externalSearchConsent: consent(message),
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(response.reply.sources).not.toContainEqual(expect.objectContaining({ authority: "PUBLIC_WEB" }));
      expect(response.reply.basis).not.toContainEqual({ kind: "WEB_RESEARCH", label: "联网检索" });
      expect(response.policy.appliedRules).not.toContain("GROUND_EXTERNAL_SOURCES");
      expect(connection.sqlite.prepare(`
        SELECT status FROM agent_tool_calls WHERE turn_id=? AND tool_id='external-web.search'
      `).get(response.turnId)).toEqual({ status: "SUCCESS" });
    } finally {
      connection.sqlite.close();
    }
  });

  it("does not expose the tool for expired or replayed one-turn consent", async () => {
    const connection = await setup();
    const message = "需要时可以联网核对来源";
    const oneTimeConsent = consent(message);
    const offered: boolean[] = [];
    const adapter = nativeTutor(async (_messages, options) => {
      offered.push(Boolean(options?.tools?.some(({ name }) => name.includes("external-web_search"))));
      return { content: "即使不联网，我也会继续给出通用设计建议。", toolCalls: [] };
    });
    try {
      const runtime = new CurrentAgentRuntime();
      await runtime.run({
        connection,
        actor,
        input: { message, externalSearchConsent: oneTimeConsent, context: { view: "AGENT" } },
        options: { modelProviderAdapter: adapter },
      });
      const replayed = await runtime.run({
        connection,
        actor,
        input: { message, externalSearchConsent: oneTimeConsent, context: { view: "AGENT" } },
        options: { modelProviderAdapter: adapter },
      });
      const crossStudentReplay = await runtime.run({
        connection,
        actor: secondActor,
        input: { message, externalSearchConsent: oneTimeConsent, context: { view: "AGENT" } },
        options: { modelProviderAdapter: adapter },
      });
      const expiredConsent = consent(message, Date.now() - 11 * 60 * 1_000);
      const expired = await runtime.run({
        connection,
        actor,
        input: { message, externalSearchConsent: expiredConsent, context: { view: "AGENT" } },
        options: { modelProviderAdapter: adapter },
      });

      expect(offered).toEqual([true, false, false, false]);
      expect(connection.sqlite.prepare(
        "SELECT count(*) count FROM agent_external_search_consents",
      ).get()).toEqual({ count: 1 });
      expect(replayed.runtimeEvents).toContainEqual(expect.objectContaining({
        errorCode: "EXTERNAL_SEARCH_CONSENT_REPLAYED",
      }));
      expect(crossStudentReplay.runtimeEvents).toContainEqual(expect.objectContaining({
        errorCode: "EXTERNAL_SEARCH_CONSENT_REPLAYED",
      }));
      expect(expired.runtimeEvents).toContainEqual(expect.objectContaining({
        errorCode: "EXTERNAL_SEARCH_CONSENT_EXPIRED",
      }));
    } finally {
      connection.sqlite.close();
    }
  });
});

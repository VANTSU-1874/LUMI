// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createExternalWebResearchRunner,
  sanitizeExternalSearchIntent,
} from "@/lib/agent/external-web-research";
import type {
  ModelProviderAdapter,
} from "@/lib/agent/model-provider-adapter";
import {
  buildWebSearchModelClient,
} from "@/lib/agent/orchestrator-context";
import {
  getActiveAgentPolicy,
} from "@/lib/agent/policy-registry";

describe("external web research intent", () => {
  it("redacts common identifiers and credentials before an outbound search", () => {
    const modelKeyFixture = ["sk", "example-secret-123456"].join("-");
    const githubTokenFixture = ["github", "pat", "abcdefghijklmnopqrstuvwxyz"].join("_");
    const value = sanitizeExternalSearchIntent(
      [
        "邮箱 arlo@example.com 手机 13800138000 学号 SC20260001 身份证 11010519491231002X",
        "Bearer abcdefghijklmnopqrstuvwxyz",
        modelKeyFixture,
        githubTokenFixture,
        "api_key=super-secret-value",
        "https://user:password@example.com/docs",
      ].join(" "),
      {
        STUDENT_NUMBER_PREFIX: "SC",
        STUDENT_NUMBER_DIGITS: "8",
        NODE_ENV: "test",
      },
    );
    expect(value).not.toMatch(/arlo@example\.com|13800138000|SC20260001|11010519491231002X/);
    expect(value).not.toMatch(/abcdefghijklmnopqrstuvwxyz|super-secret-value|user:password/);
    expect(value).toContain("[已遮蔽");
  });

  it("removes controls, collapses the query to one line and bounds its length", () => {
    const value = sanitizeExternalSearchIntent(`字体\n可读性\u202e${"检索".repeat(300)}`, {
      NODE_ENV: "test",
    });
    expect(value).not.toMatch(/[\r\n\u202e]/);
    expect(value.length).toBeLessThanOrEqual(300);
  });

  it("prefers a dedicated Web adapter over the primary model adapter", () => {
    const primary: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "primary-model",
      capabilities: { vision: true },
      async complete() {
        return "primary";
      },
    };
    const web: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "web-model",
      capabilities: {
        vision: false,
        webSearch: true,
      },
      async complete() {
        return "web";
      },
    };

    expect(buildWebSearchModelClient({
      modelProviderAdapter: primary,
      webSearchModelProviderAdapter: web,
    }, getActiveAgentPolicy())).toBe(web);
  });

  it("builds a configured Web model without changing the primary adapter", () => {
    const primary: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "primary-model",
      capabilities: { vision: true },
      async complete() {
        return "primary";
      },
    };
    const selected = buildWebSearchModelClient({
      modelProviderAdapter: primary,
      ai: {
        enabled: true,
        baseUrl: "https://primary.example/v1",
        apiKey: "primary-secret",
        model: "primary-model",
        web: {
          baseUrl: "https://web.example/v1",
          apiKey: "web-secret",
          model: "web-model",
        },
      },
    }, getActiveAgentPolicy());

    expect(selected).not.toBe(primary);
    expect(selected?.modelId).toBe("web-model");
    expect(selected?.capabilities.webSearch)
      .toBe(false);
  });

  it("builds DeepSeek V4 Web configuration through its Anthropic hosted-tool protocol", () => {
    const selected = buildWebSearchModelClient({
      ai: {
        enabled: true,
        baseUrl: "https://primary.example/v1",
        apiKey: "primary-secret",
        model: "primary-model",
        web: {
          baseUrl: "https://deepseek.example/v1",
          apiKey: "web-secret",
          model: "deepseek-v4-flash",
        },
      },
    }, getActiveAgentPolicy());

    expect(selected?.protocol)
      .toBe("DEEPSEEK_ANTHROPIC");
    expect(selected?.capabilities.webSearch)
      .toBe(true);
  });

  it("fails closed before a request when the configured adapter cannot carry hosted Web search", async () => {
    const respond = vi.fn();
    const client: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "chat-only-model",
      capabilities: {
        vision: false,
        webSearch: false,
      },
      async complete() {
        return "chat-only";
      },
      respond,
    };
    const runner =
      createExternalWebResearchRunner(client);

    await expect(runner({
      question: "核对当前官方文档",
      signal:
        new AbortController().signal,
    })).resolves.toEqual({
      status: "UNAVAILABLE",
      answer: "",
      citations: [],
    });
    expect(respond).not.toHaveBeenCalled();
  });
});

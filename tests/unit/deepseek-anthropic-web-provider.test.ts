// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createDeepSeekAnthropicWebProvider,
  deepSeekAnthropicMessagesUrl,
} from "@/lib/agent/deepseek-anthropic-web-provider";
import {
  createHostedWebModelProvider,
} from "@/lib/agent/hosted-web-model-provider";

describe("DeepSeek Anthropic hosted Web provider", () => {
  it.each([
    [
      "https://api.deepseek.com",
      "https://api.deepseek.com/anthropic/v1/messages",
    ],
    [
      "https://api.deepseek.com/v1",
      "https://api.deepseek.com/anthropic/v1/messages",
    ],
    [
      "https://api.deepseek.com/anthropic",
      "https://api.deepseek.com/anthropic/v1/messages",
    ],
    [
      "https://api.deepseek.com/anthropic/v1",
      "https://api.deepseek.com/anthropic/v1/messages",
    ],
  ])("normalizes %s to the Messages endpoint", (baseUrl, expected) => {
    expect(deepSeekAnthropicMessagesUrl(baseUrl))
      .toBe(expected);
  });

  it("extracts only structured Web results from an Anthropic response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        type: "message",
        stop_reason: "end_turn",
        content: [
          {
            type: "server_tool_use",
            id: "srvtoolu_1",
            name: "web_search",
            input: { query: "WCAG 2.2 non-text content" },
          },
          {
            type: "web_search_tool_result",
            tool_use_id: "srvtoolu_1",
            content: [
              {
                type: "web_search_result",
                url: "https://www.w3.org/TR/WCAG22/#non-text-content",
                title: "Web Content Accessibility Guidelines 2.2",
                encrypted_content: "opaque",
              },
              {
                type: "web_search_result",
                url: "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html",
                title: "",
                encrypted_content: "opaque",
              },
              {
                type: "web_search_tool_result_error",
                error_code: "max_uses_exceeded",
              },
            ],
          },
          {
            type: "text",
            text: "结论正文包含一个不可信的手写链接 https://memory.example。",
          },
        ],
        usage: {
          input_tokens: 20,
          output_tokens: 10,
          server_tool_use: { web_search_requests: 1 },
        },
      })),
    );
    const progress = vi.fn();
    const usage = vi.fn();
    const provider = createDeepSeekAnthropicWebProvider({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "test-secret",
      model: "deepseek-v4-flash",
      idleTimeoutMs: 10_000,
      totalTimeoutMs: 20_000,
      fetchImpl,
    });

    const result = await provider.respond!([
      { role: "system", content: "必须联网。" },
      { role: "user", content: "查 W3C 官方标准。" },
    ], {
      hostedTools: [{
        type: "web_search",
        searchContextSize: "medium",
      }],
      maxHostedToolCalls: 1,
      toolChoice: "auto",
      onUsage: usage,
      onWebSearchProgress: progress,
    });

    expect(provider.provider).toBe("OPENAI_COMPATIBLE");
    expect(provider.protocol).toBe("DEEPSEEK_ANTHROPIC");
    expect(provider.capabilities.webSearch).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0])
      .toBe("https://api.deepseek.com/anthropic/v1/messages");
    const request = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    );
    expect(request.tools).toEqual([{
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 1,
    }]);
    expect(request.tool_choice).toEqual({
      type: "tool",
      name: "web_search",
    });
    expect(result.webSearch).toEqual({
      status: "SUCCEEDED",
      citations: [
        {
          url: "https://www.w3.org/TR/WCAG22/#non-text-content",
          title: "Web Content Accessibility Guidelines 2.2",
          startIndex: 0,
          endIndex: 0,
        },
        {
          url: "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html",
          title: "www.w3.org",
          startIndex: 0,
          endIndex: 0,
        },
      ],
    });
    expect(result.webSearch?.citations)
      .not.toContainEqual(expect.objectContaining({
        url: "https://memory.example/",
      }));
    expect(usage).toHaveBeenCalledWith({
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
    });
    expect(progress.mock.calls.flat()).toEqual([
      { status: "RUNNING" },
      { status: "SUCCEEDED" },
    ]);
  });

  it("preserves a structured server-side Web error as unavailable", async () => {
    const provider = createDeepSeekAnthropicWebProvider({
      baseUrl: "https://api.deepseek.com",
      apiKey: "test-secret",
      model: "deepseek-v4-pro",
      idleTimeoutMs: 10_000,
      totalTimeoutMs: 20_000,
      fetchImpl: async () =>
        new Response(JSON.stringify({
          type: "message",
          stop_reason: "end_turn",
          content: [
            {
              type: "server_tool_use",
              id: "srvtoolu_2",
              name: "web_search",
              input: { query: "test" },
            },
            {
              type: "web_search_tool_result",
              tool_use_id: "srvtoolu_2",
              content: {
                type: "web_search_tool_result_error",
                error_code: "unavailable",
              },
            },
            { type: "text", text: "无法联网。" },
          ],
          usage: {
            input_tokens: 5,
            output_tokens: 3,
          },
        })),
    });

    await expect(provider.respond!([
      { role: "user", content: "查一下。" },
    ], {
      hostedTools: [{ type: "web_search" }],
    })).resolves.toMatchObject({
      webSearch: {
        status: "UNAVAILABLE",
        citations: [],
      },
    });
  });

  it("selects the Anthropic protocol only for DeepSeek V4 Web models", () => {
    expect(createHostedWebModelProvider({
      baseUrl: "https://models.example/v1",
      apiKey: "secret",
      model: "deepseek-v4-flash",
      idleTimeoutMs: 10_000,
      totalTimeoutMs: 20_000,
    }).protocol).toBe("DEEPSEEK_ANTHROPIC");

    expect(createHostedWebModelProvider({
      baseUrl: "https://models.example/v1",
      apiKey: "secret",
      model: "gpt-5.6-sol",
      idleTimeoutMs: 10_000,
      totalTimeoutMs: 20_000,
    }).protocol).toBe("OPENAI");
  });
});

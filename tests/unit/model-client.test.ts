import { describe, expect, it, vi } from "vitest";

import { createModelClient, ModelServiceError } from "@/lib/ai/client";
import { modelClientAdapter } from "@/lib/agent/model-provider-adapter";

const config = {
  baseUrl: "https://models.example.test/v1",
  apiKey: "secret-key",
  model: "course-model",
};
const INVALID_JSON_PAYLOAD_FRAGMENT = "PRIVATE_PROVIDER_PAYLOAD_FRAGMENT";

const modelRoutes = [
  {
    name: "Chat Completions",
    clientConfig: config,
    endpointSuffix: "/chat/completions",
  },
  {
    name: "Responses",
    clientConfig: { ...config, model: "gpt-5.6" },
    endpointSuffix: "/responses",
  },
] as const;

const invalidProviderResponses = modelRoutes.flatMap((route) => [
  { ...route, responseKind: "invalid JSON", body: INVALID_JSON_PAYLOAD_FRAGMENT },
  {
    ...route,
    responseKind: "invalid schema",
    body: JSON.stringify({ unexpected: true }),
  },
]);

function interruptedResponseBody() {
  let pullCount = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1;
      if (pullCount === 1) {
        controller.enqueue(new TextEncoder().encode('{"partial":'));
        return;
      }
      controller.error(Object.assign(
        new TypeError("socket reset while reading response body"),
        { code: "UND_ERR_SOCKET" },
      ));
    },
  });
}

function scheduledStreamingResponse(
  init: RequestInit | undefined,
  chunks: Array<{ atMs: number; value: string }>,
  options: { leaveOpen?: boolean; hangOnCancel?: boolean } = {},
) {
  const encoder = new TextEncoder();
  const signal = init?.signal ?? undefined;
  let stopped = false;
  let abortFromRequest: (() => void) | null = null;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        if (stopped) return;
        stopped = true;
        for (const timer of timers) clearTimeout(timer);
        if (abortFromRequest) signal?.removeEventListener("abort", abortFromRequest);
      };
      abortFromRequest = () => {
        stop();
        controller.error(signal?.reason);
      };
      signal?.addEventListener("abort", abortFromRequest, { once: true });
      if (signal?.aborted) {
        abortFromRequest();
        return;
      }
      chunks.forEach((chunk, index) => {
        timers.push(setTimeout(() => {
          if (stopped) return;
          controller.enqueue(encoder.encode(chunk.value));
          if (index === chunks.length - 1 && !options.leaveOpen) {
            stop();
            controller.close();
          }
        }, chunk.atMs));
      });
    },
    cancel() {
      if (stopped) return;
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      if (abortFromRequest) signal?.removeEventListener("abort", abortFromRequest);
      if (options.hangOnCancel) return new Promise<void>(() => undefined);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

const streamingTimeoutRoutes = [
  {
    name: "Chat Completions",
    clientConfig: config,
    delta(value: string) {
      return `data: ${JSON.stringify({ choices: [{ delta: { content: value } }] })}\n\n`;
    },
    completed(value: string) {
      void value;
      return "data: [DONE]\n\n";
    },
  },
  {
    name: "Responses",
    clientConfig: { ...config, model: "gpt-5.6" },
    delta(value: string) {
      return `data: ${JSON.stringify({ type: "response.output_text.delta", delta: value })}\n\n`;
    },
    completed(value: string) {
      return `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          id: "resp_timeout_test",
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: value }] }],
        },
      })}\n\n`;
    },
  },
] as const;

describe("createModelClient", () => {
  it("accepts the evaluation hard cap and rejects larger request totals", () => {
    expect(() => createModelClient(config, { timeoutMs: 600_000 })).not.toThrow();
    expect(() => createModelClient(config, { totalTimeoutMs: 600_000 })).not.toThrow();
    expect(() => createModelClient(config, { timeoutMs: 600_001 })).toThrow();
    expect(() => createModelClient(config, { totalTimeoutMs: 600_001 })).toThrow();
    expect(() => createModelClient(config, { timeoutMs: 10, totalTimeoutMs: 20 }))
      .toThrow("cannot be used together");
    expect(() => createModelClient(config, { idleTimeoutMs: 20, totalTimeoutMs: 20 }))
      .toThrow("idleTimeoutMs must be lower than totalTimeoutMs");
  });

  it("bounds the configurable Responses SSE wire budget", () => {
    expect(() => createModelClient(config, { maxResponsesStreamBytes: 1024 * 1024 })).not.toThrow();
    expect(() => createModelClient(config, { maxResponsesStreamBytes: 0 })).toThrow();
    expect(() => createModelClient(config, { maxResponsesStreamBytes: -1 })).toThrow();
    expect(() => createModelClient(config, { maxResponsesStreamBytes: 1024 * 1024 + 1 })).toThrow();
  });

  it.each(streamingTimeoutRoutes)(
    "keeps $name streaming past the idle window while raw chunks keep arriving",
    async ({ clientConfig, delta, completed }) => {
      vi.useFakeTimers();
      try {
        const chunks = [
          { atMs: 0, value: delta("a") },
          { atMs: 15, value: delta("b") },
          { atMs: 30, value: delta("c") },
          { atMs: 45, value: delta("d") },
          { atMs: 60, value: completed("abcd") },
        ];
        const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
          scheduledStreamingResponse(init, chunks, { leaveOpen: true, hangOnCancel: true }));
        const client = createModelClient(clientConfig, {
          fetchImpl,
          idleTimeoutMs: 20,
          totalTimeoutMs: 100,
        });
        const pending = client.respond?.(
          [{ role: "user", content: "test" }],
          { onTextDelta: vi.fn() },
        );

        await vi.advanceTimersByTimeAsync(61);

        await expect(pending).resolves.toMatchObject({ content: "abcd" });
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(streamingTimeoutRoutes)(
    "uses the $name response idleTimeoutMs instead of relying only on the client default",
    async ({ clientConfig, delta }) => {
      vi.useFakeTimers();
      try {
        const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
          scheduledStreamingResponse(init, [{ atMs: 0, value: delta("a") }], {
            leaveOpen: true,
            hangOnCancel: true,
          }));
        const client = createModelClient(clientConfig, {
          fetchImpl,
          idleTimeoutMs: 100,
          totalTimeoutMs: 200,
        });
        const pending = client.respond!(
          [{ role: "user", content: "test" }],
          { onTextDelta: vi.fn(), idleTimeoutMs: 20 },
        );
        const outcome = pending.catch((error: unknown) => error);

        await vi.advanceTimersByTimeAsync(21);

        await expect(outcome).resolves.toMatchObject({ code: "TIMEOUT" });
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(streamingTimeoutRoutes)(
    "keeps legacy $name timeoutMs total-only when idle is omitted",
    async ({ clientConfig, delta, completed }) => {
      vi.useFakeTimers();
      try {
        const chunks = [
          { atMs: 0, value: delta("a") },
          { atMs: 30, value: completed("a") },
        ];
        const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
          scheduledStreamingResponse(init, chunks, { leaveOpen: true, hangOnCancel: true }));
        const client = createModelClient(clientConfig, { fetchImpl, timeoutMs: 50 });
        const pending = client.respond?.(
          [{ role: "user", content: "test" }],
          { onTextDelta: vi.fn() },
        );

        await vi.advanceTimersByTimeAsync(31);

        await expect(pending).resolves.toMatchObject({ content: "a" });
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(modelRoutes)(
    "does not apply the streaming idle timeout to a non-streaming $name request",
    async ({ clientConfig, endpointSuffix }) => {
      vi.useFakeTimers();
      try {
        const body = endpointSuffix === "/responses"
          ? JSON.stringify({
              id: "resp_nonstream_timeout_test",
              status: "completed",
              output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }],
            })
          : JSON.stringify({ choices: [{ message: { content: "done" } }] });
        const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
          await new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => resolve(new Response(body)), 30);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(init.signal?.reason);
            }, { once: true });
          }));
        const client = createModelClient(clientConfig, {
          fetchImpl,
          idleTimeoutMs: 5,
          totalTimeoutMs: 50,
        });
        const pending = client.complete([{ role: "user", content: "test" }]);

        await vi.advanceTimersByTimeAsync(31);

        await expect(pending).resolves.toBe("done");
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(modelRoutes)(
    "enforces the non-streaming $name hard total even when an injected fetch ignores abort",
    async ({ clientConfig }) => {
      vi.useFakeTimers();
      try {
        const fetchImpl = vi.fn<typeof fetch>(async () =>
          await new Promise<Response>(() => undefined));
        const client = createModelClient(clientConfig, {
          fetchImpl,
          idleTimeoutMs: 5,
          totalTimeoutMs: 20,
        });
        const pending = client.complete([{ role: "user", content: "test" }]);
        const rejection = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });

        await vi.advanceTimersByTimeAsync(21);

        await rejection;
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(streamingTimeoutRoutes)(
    "times out $name streaming after mid-stream transport silence",
    async ({ clientConfig, delta, completed }) => {
      vi.useFakeTimers();
      try {
        const chunks = [
          { atMs: 0, value: delta("a") },
          { atMs: 100, value: completed("a") },
        ];
        const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
          scheduledStreamingResponse(init, chunks, { leaveOpen: true, hangOnCancel: true }));
        const client = createModelClient(clientConfig, {
          fetchImpl,
          idleTimeoutMs: 20,
          totalTimeoutMs: 200,
        });
        const pending = client.respond?.(
          [{ role: "user", content: "test" }],
          { onTextDelta: vi.fn() },
        );
        const rejection = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });

        await vi.advanceTimersByTimeAsync(21);

        await rejection;
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("treats a Responses reasoning SSE event as liveness before the final answer", async () => {
    vi.useFakeTimers();
    try {
      const completed = {
        id: "resp_reasoning_liveness",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "深问完成。" }] }],
      };
      const chunks = [
        { atMs: 0, value: 'data: {"type":"response.reasoning.delta","delta":"正在推理"}\n\n' },
        {
          atMs: 15,
          value: 'data: {"type":"response.reasoning.delta","delta":"继续推理"}\n\n',
        },
        {
          atMs: 30,
          value: `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: completed })}\n\n`,
        },
      ];
      const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
        scheduledStreamingResponse(init, chunks, { leaveOpen: true, hangOnCancel: true }));
      const client = createModelClient({ ...config, model: "gpt-5.6" }, {
        fetchImpl,
        idleTimeoutMs: 20,
        totalTimeoutMs: 200,
      });
      const onStreamActivity = vi.fn();
      const pending = client.respond?.(
        [{ role: "user", content: "请深度分析" }],
        { onTextDelta: vi.fn(), onStreamActivity },
      );

      await vi.advanceTimersByTimeAsync(31);

      await expect(pending).resolves.toMatchObject({ content: "深问完成。" });
      expect(onStreamActivity).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(streamingTimeoutRoutes)(
    "enforces the $name hard total cap despite continuous chunks",
    async ({ clientConfig, delta, completed }) => {
      vi.useFakeTimers();
      try {
        const chunks = [
          { atMs: 0, value: delta("a") },
          { atMs: 15, value: delta("b") },
          { atMs: 30, value: delta("c") },
          { atMs: 45, value: delta("d") },
          { atMs: 60, value: delta("e") },
          { atMs: 75, value: completed("abcde") },
        ];
        const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
          scheduledStreamingResponse(init, chunks, { leaveOpen: true, hangOnCancel: true }));
        const client = createModelClient(clientConfig, {
          fetchImpl,
          idleTimeoutMs: 20,
          totalTimeoutMs: 50,
        });
        const pending = client.respond?.(
          [{ role: "user", content: "test" }],
          { onTextDelta: vi.fn() },
        );
        const rejection = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });

        await vi.advanceTimersByTimeAsync(51);

        await rejection;
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(streamingTimeoutRoutes)(
    "keeps $name caller cancellation classified through a timer race",
    async ({ clientConfig, delta, completed }) => {
      vi.useFakeTimers();
      try {
        const chunks = [
          { atMs: 0, value: delta("a") },
          { atMs: 100, value: completed("a") },
        ];
        const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
          scheduledStreamingResponse(init, chunks, { leaveOpen: true }));
        const client = createModelClient(clientConfig, {
          fetchImpl,
          idleTimeoutMs: 20,
          totalTimeoutMs: 50,
        });
        const controller = new AbortController();
        const pending = client.respond?.(
          [{ role: "user", content: "test" }],
          { signal: controller.signal, onTextDelta: vi.fn() },
        );
        const rejection = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
        await vi.advanceTimersByTimeAsync(1);
        controller.abort();

        await rejection;
        await vi.advanceTimersByTimeAsync(100);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(streamingTimeoutRoutes)(
    "maps a TimeoutError from an external $name AbortSignal to TIMEOUT",
    async ({ clientConfig, delta, completed }) => {
      vi.useFakeTimers();
      try {
        const chunks = [
          { atMs: 0, value: delta("a") },
          { atMs: 100, value: completed("a") },
        ];
        const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
          scheduledStreamingResponse(init, chunks, { leaveOpen: true }));
        const client = createModelClient(clientConfig, {
          fetchImpl,
          idleTimeoutMs: 50,
          totalTimeoutMs: 200,
        });
        const controller = new AbortController();
        const pending = client.respond?.(
          [{ role: "user", content: "test" }],
          { signal: controller.signal, onTextDelta: vi.fn() },
        );
        const rejection = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
        await vi.advanceTimersByTimeAsync(1);
        controller.abort(new DOMException("external deadline", "TimeoutError"));

        await rejection;
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(streamingTimeoutRoutes)(
    "finishes $name at its completion marker without waiting for EOF",
    async ({ clientConfig, delta, completed }) => {
      vi.useFakeTimers();
      try {
        const chunks = [
          { atMs: 0, value: delta("done") },
          { atMs: 10, value: `${completed("done")}data: definitely-not-json\n\n` },
          { atMs: 1_000, value: ": transport intentionally left open\n\n" },
        ];
        const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
          scheduledStreamingResponse(init, chunks, { leaveOpen: true, hangOnCancel: true }));
        const client = createModelClient(clientConfig, {
          fetchImpl,
          idleTimeoutMs: 100,
          totalTimeoutMs: 2_000,
        });
        const pending = client.respond?.(
          [{ role: "user", content: "test" }],
          { onTextDelta: vi.fn() },
        );

        await vi.advanceTimersByTimeAsync(11);

        await expect(pending).resolves.toMatchObject({ content: "done" });
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("rejects non-HTTP model endpoints", () => {
    expect(() => createModelClient({ ...config, baseUrl: "file:///tmp/model" })).toThrow(
      "baseUrl",
    );
  });

  it.each(modelRoutes)(
    "classifies $name fetch transport failures separately from invalid responses",
    async ({ clientConfig, endpointSuffix }) => {
      const cause = Object.assign(new Error("socket connection reset"), { code: "ECONNRESET" });
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause,
        });
      });
      const client = createModelClient(clientConfig, { fetchImpl });

      const error = await client.complete([{ role: "user", content: "test" }])
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(ModelServiceError);
      expect(error).toMatchObject({
        code: "TRANSPORT",
        retryAfterMs: null,
        httpStatus: null,
        transportCode: "ECONNRESET",
        message: "模型服务暂时不可用",
      });
      expect((error as Error).cause).toMatchObject({
        name: "TypeError",
        message: "fetch failed",
        cause,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(String(fetchImpl.mock.calls[0][0]).endsWith(endpointSuffix)).toBe(true);
    },
  );

  it.each(modelRoutes)(
    "classifies $name response-body disconnects as transport failures",
    async ({ clientConfig, endpointSuffix }) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(interruptedResponseBody(), {
        status: 200,
      }));
      const client = createModelClient(clientConfig, { fetchImpl });

      const error = await client.complete([{ role: "user", content: "test" }])
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(ModelServiceError);
      expect(error).toMatchObject({
        code: "TRANSPORT",
        httpStatus: null,
        transportCode: "UND_ERR_SOCKET",
      });
      expect((error as Error).cause).toMatchObject({
        name: "ModelResponseTransportError",
        cause: expect.objectContaining({
          message: "socket reset while reading response body",
          code: "UND_ERR_SOCKET",
        }),
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(String(fetchImpl.mock.calls[0][0]).endsWith(endpointSuffix)).toBe(true);
    },
  );

  it("redacts unknown transport error codes", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw Object.assign(new TypeError("fetch failed"), { code: "PRIVATE_UPSTREAM_DETAIL" });
    });
    const client = createModelClient(config, { fetchImpl });

    const error = await client.complete([{ role: "user", content: "test" }])
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ code: "TRANSPORT", transportCode: "OTHER" });
  });

  it("preserves timeout classification while reading a response body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
        },
      }),
      { status: 200 },
    ));
    const client = createModelClient(config, { fetchImpl, timeoutMs: 5 });

    await expect(client.complete([{ role: "user", content: "test" }]))
      .rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("preserves caller cancellation while reading a response body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => new Response(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          init?.signal?.addEventListener("abort", () => streamController.error(init.signal?.reason));
        },
      }),
      { status: 200 },
    ));
    const controller = new AbortController();
    const client = createModelClient(config, { fetchImpl });
    const pending = client.complete([{ role: "user", content: "test" }], {
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it.each(invalidProviderResponses)(
    "keeps $name $responseKind failures classified as INVALID_RESPONSE",
    async ({ clientConfig, endpointSuffix, responseKind, body }) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }));
      const client = createModelClient(clientConfig, { fetchImpl });

      const error = await client.complete([{ role: "user", content: "test" }])
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(ModelServiceError);
      expect(error).toMatchObject({
        code: "INVALID_RESPONSE",
        retryAfterMs: null,
        httpStatus: null,
        message: "模型服务暂时不可用",
      });
      expect((error as Error).cause).toBeInstanceOf(Error);
      if (responseKind === "invalid JSON") {
        expect(String((error as Error).cause)).toContain(INVALID_JSON_PAYLOAD_FRAGMENT.slice(0, 10));
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(String(fetchImpl.mock.calls[0][0]).endsWith(endpointSuffix)).toBe(true);
    },
  );

  it("returns bounded content from an OpenAI-compatible response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createModelClient(config, { fetchImpl });

    await expect(client.complete([{ role: "user", content: "test" }])).resolves.toBe(
      '{"ok":true}',
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://models.example.test/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(requestBody.max_tokens).toBe(4096);
    expect(requestBody.response_format).toEqual({ type: "json_object" });
  });

  it("reports provider token usage without changing the text completion contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
      })),
    );
    const client = createModelClient(config, { fetchImpl });
    const onUsage = vi.fn();
    await expect(client.complete(
      [{ role: "user", content: "test" }],
      { onUsage },
    )).resolves.toBe('{"ok":true}');
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 30, outputTokens: 12, totalTokens: 42 });
  });

  it("uses native function calling without forcing JSON response mode", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "tool_read_state", arguments: "{}" },
            }],
          },
        }],
      })),
    );
    const client = createModelClient(config, { fetchImpl });

    await expect(client.respond?.(
      [{ role: "system", content: "自然回答" }, { role: "user", content: "读取当前状态" }],
      {
        tools: [{
          name: "tool_read_state",
          description: "读取当前学习状态",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          strict: true,
        }],
      },
    )).resolves.toEqual({
      content: null,
      toolCalls: [{ id: "call_1", name: "tool_read_state", arguments: "{}" }],
    });
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(requestBody.response_format).toBeUndefined();
    expect(requestBody.tool_choice).toBe("auto");
    expect(requestBody.tools).toEqual([{
      type: "function",
      function: {
        name: "tool_read_state",
        description: "读取当前学习状态",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        strict: true,
      },
    }]);
  });

  it("marks a Chat Completions length finish as a truncated output", async () => {
    const client = createModelClient(config, {
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        choices: [{
          finish_reason: "length",
          message: { content: "先把信息层级分成主标题、摘要和行动入口。" },
        }],
      }))),
    });

    await expect(client.respond?.([{ role: "user", content: "给我完整的版式建议" }]))
      .resolves.toEqual({
        content: "先把信息层级分成主标题、摘要和行动入口。",
        toolCalls: [],
        outputTruncated: true,
      });
  });

  it("sends assistant tool calls and tool results back in provider format", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: "根据读取结果，这是最终回答。" } }],
      })),
    );
    const client = createModelClient(config, { fetchImpl });

    await expect(client.respond?.([
      { role: "system", content: "自然回答" },
      { role: "user", content: "读取当前状态" },
      {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "call_1", name: "tool_read_state", arguments: "{}" }],
      },
      { role: "tool", toolCallId: "call_1", content: '{"status":"SUCCESS"}' },
    ], { tools: [], toolChoice: "none" })).resolves.toEqual({
      content: "根据读取结果，这是最终回答。",
      toolCalls: [],
    });
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(requestBody.messages[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "tool_read_state", arguments: "{}" },
      }],
    });
    expect(requestBody.messages[3]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: '{"status":"SUCCESS"}',
    });
    expect(requestBody.tool_choice).toBe("none");
  });

  it("passes a bounded custom output-token cap to the provider", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })),
    );
    const client = createModelClient({ ...config, maxOutputTokens: 1024 }, { fetchImpl });
    await client.complete([{ role: "user", content: "test" }]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).max_tokens).toBe(1024);
  });

  it("routes GPT-5.6 through the Responses API with its native output controls", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        id: "resp_1",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "完整回答" }] }],
        usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
      })),
    );
    const client = createModelClient({
      ...config,
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6",
    }, { fetchImpl });

    await expect(client.respond?.([{ role: "user", content: "给出完整建议" }]))
      .resolves.toMatchObject({ content: "完整回答", toolCalls: [] });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(requestBody.max_output_tokens).toBe(4096);
    expect(requestBody.store).toBe(false);
    expect(requestBody.include).toEqual(["reasoning.encrypted_content"]);
    expect(requestBody.input).toEqual([{ role: "user", content: "给出完整建议" }]);
    expect(requestBody.messages).toBeUndefined();
    expect(requestBody.temperature).toBeUndefined();
  });

  it("marks a max-output Responses result as a truncated output", async () => {
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        id: "resp_max_output",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "先把目录页与正文页的节奏统一起来。" }],
        }],
      }))),
    });

    await expect(client.respond?.([{ role: "user", content: "写一份完整评审" }]))
      .resolves.toMatchObject({
        content: "先把目录页与正文页的节奏统一起来。",
        toolCalls: [],
        outputTruncated: true,
      });
  });

  it("uses native GPT-5.6 web search beside function tools and returns safe deduplicated citations", async () => {
    const providerOutput = [
      { type: "web_search_call", id: "ws_1", status: "completed" },
      { type: "function_call", call_id: "call_1", name: "tool_read_state", arguments: "{}" },
      {
        type: "message",
        content: [{
          type: "output_text",
          text: "官方指南建议先核对来源。",
          annotations: [
            {
              type: "url_citation",
              url: "https://example.com/guide",
              title: "官方指南",
              start_index: 0,
              end_index: 4,
            },
            {
              type: "url_citation",
              url: "https://example.com/guide",
              title: "重复来源",
              start_index: 5,
              end_index: 9,
            },
            {
              type: "url_citation",
              url: "http://example.com/insecure",
              title: "非 HTTPS",
              start_index: 0,
              end_index: 2,
            },
            {
              type: "url_citation",
              url: "https://user:secret@example.com/private",
              title: "含凭据",
              start_index: 0,
              end_index: 2,
            },
            {
              type: "url_citation",
              url: "https://example.com/out-of-range",
              title: "范围越界",
              start_index: 0,
              end_index: 200,
            },
            { type: "url_citation", url: "not a url" },
          ],
        }],
      },
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      id: "resp_web_1",
      status: "completed",
      output: providerOutput,
    })));
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, { fetchImpl });
    const onWebSearchProgress = vi.fn();

    await expect(client.respond?.(
      [{ role: "user", content: "查一下最新官方指南" }],
      {
        tools: [{
          name: "tool_read_state",
          description: "读取状态",
          parameters: { type: "object" },
          strict: true,
        }],
        hostedTools: [{ type: "web_search", searchContextSize: "medium" }],
        maxHostedToolCalls: 1,
        onWebSearchProgress,
      },
    )).resolves.toEqual({
      content: "官方指南建议先核对来源。",
      toolCalls: [{ id: "call_1", name: "tool_read_state", arguments: "{}" }],
      providerOutput,
      webSearch: {
        status: "SUCCEEDED",
        citations: [{
          url: "https://example.com/guide",
          title: "官方指南",
          startIndex: 0,
          endIndex: 4,
        }],
      },
    });
    expect(onWebSearchProgress).toHaveBeenCalledTimes(1);
    expect(onWebSearchProgress).toHaveBeenCalledWith({ status: "SUCCEEDED" });
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(requestBody.tools).toEqual([
      {
        type: "function",
        name: "tool_read_state",
        description: "读取状态",
        parameters: { type: "object" },
        strict: true,
      },
      { type: "web_search", search_context_size: "medium" },
    ]);
    expect(requestBody.max_tool_calls).toBe(1);
    expect(requestBody.tool_choice).toBe("auto");
  });

  it("reports native GPT-5.6 web-search streaming progress without duplicates", async () => {
    const completed = {
      id: "resp_web_stream_1",
      status: "completed",
      output: [
        { type: "web_search_call", id: "ws_1", status: "completed" },
        { type: "message", content: [{ type: "output_text", text: "检索完成。", annotations: [] }] },
      ],
    };
    const stream = [
      `event: response.output_item.added\ndata: ${JSON.stringify({
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "web_search_call", id: "ws_1", status: "in_progress" },
      })}`,
      'event: response.web_search_call.searching\ndata: {"type":"response.web_search_call.searching"}',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"检索完成。"}',
      'event: response.web_search_call.completed\ndata: {"type":"response.web_search_call.completed"}',
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: completed })}`,
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });
    const onTextDelta = vi.fn();
    const onWebSearchProgress = vi.fn();

    await expect(client.respond?.(
      [{ role: "user", content: "联网核对" }],
      {
        hostedTools: [{ type: "web_search" }],
        onTextDelta,
        onWebSearchProgress,
      },
    )).resolves.toMatchObject({
      content: "检索完成。",
      webSearch: { status: "SUCCEEDED", citations: [] },
    });
    expect(onTextDelta).toHaveBeenCalledWith("检索完成。");
    expect(onWebSearchProgress.mock.calls.flat()).toEqual([
      { status: "RUNNING" },
      { status: "SUCCEEDED" },
    ]);
  });

  it.each([400, 404, 422])(
    "retries GPT-5.6 without hosted web search after provider status %s",
    async (status) => {
      const fetchImpl = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("hosted tool unsupported", { status }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: "resp_web_fallback",
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: "继续给出普通回答。" }] }],
        })));
      const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, { fetchImpl });
      const onWebSearchProgress = vi.fn();

      await expect(client.respond?.(
        [{ role: "user", content: "需要最新资料" }],
        {
          tools: [{ name: "tool_read_state", description: "读取状态", parameters: { type: "object" } }],
          hostedTools: [{ type: "web_search" }],
          onWebSearchProgress,
        },
      )).resolves.toMatchObject({
        content: "继续给出普通回答。",
        webSearch: { status: "UNAVAILABLE", citations: [] },
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(onWebSearchProgress).toHaveBeenCalledTimes(1);
      expect(onWebSearchProgress).toHaveBeenCalledWith({ status: "UNAVAILABLE" });
      const firstBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
      const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
      expect(firstBody.tools).toContainEqual({ type: "web_search" });
      expect(secondBody.max_tool_calls).toBeUndefined();
      expect(secondBody.tools).toEqual([{
        type: "function",
        name: "tool_read_state",
        description: "读取状态",
        parameters: { type: "object" },
      }]);
    },
  );

  it("throws normally when the hosted-web-search fallback request also fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("hosted tool unsupported", { status: 400 }))
      .mockResolvedValueOnce(new Response("provider unavailable", { status: 503 }));
    const client = createModelClient({ ...config, model: "gpt-5.6" }, { fetchImpl });

    await expect(client.respond?.(
      [{ role: "user", content: "联网核对" }],
      { hostedTools: [{ type: "web_search" }] },
    )).rejects.toMatchObject({ code: "PROVIDER_STATUS", httpStatus: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a generic provider validation error as a hosted-tool incompatibility", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response("invalid account configuration", { status: 400 }));
    const client = createModelClient({ ...config, model: "gpt-5.6" }, { fetchImpl });

    await expect(client.respond?.(
      [{ role: "user", content: "联网核对" }],
      { hostedTools: [{ type: "web_search" }] },
    )).rejects.toMatchObject({ code: "PROVIDER_STATUS", httpStatus: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honors an at-most-once hosted request when compatibility fallback is disabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response("hosted tool unsupported", { status: 400 }));
    const client = createModelClient({ ...config, model: "gpt-5.6" }, { fetchImpl });

    await expect(client.respond?.(
      [{ role: "user", content: "联网核对" }],
      {
        hostedTools: [{ type: "web_search" }],
        retryWithoutHostedTools: false,
      },
    )).rejects.toMatchObject({ code: "PROVIDER_STATUS", httpStatus: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("streams GPT-5.6 Responses text deltas from the completed response", async () => {
    const completed = {
      id: "resp_stream_1",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "先看层级，再看节奏。" }] }],
      usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 },
    };
    const stream = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"先看层级，"}',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"再看节奏。"}',
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: completed })}`,
      "",
    ].join("\n\n");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(stream));
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, { fetchImpl });
    const onTextDelta = vi.fn();
    const onUsage = vi.fn();

    await expect(client.respond?.(
      [{ role: "user", content: "怎么调整版式？" }],
      { onTextDelta, onUsage },
    )).resolves.toMatchObject({ content: "先看层级，再看节奏。", toolCalls: [] });
    expect(onTextDelta.mock.calls.flat()).toEqual(["先看层级，", "再看节奏。"]);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 30, outputTokens: 10, totalTokens: 40 });
  });

  it("marks a streamed Responses max-output terminal response as truncated", async () => {
    const incomplete = {
      id: "resp_stream_max_output",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [{
        type: "message",
        content: [{ type: "output_text", text: "先固定阅读路径，再补充每页的单一动作。" }],
      }],
    };
    const stream = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"先固定阅读路径，再补充每页的单一动作。"}',
      `event: response.incomplete\ndata: ${JSON.stringify({ type: "response.incomplete", response: incomplete })}`,
      "",
    ].join("\n\n");
    const onTextDelta = vi.fn();
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "继续写评审" }],
      { onTextDelta },
    )).resolves.toMatchObject({
      content: "先固定阅读路径，再补充每页的单一动作。",
      toolCalls: [],
      outputTruncated: true,
    });
    expect(onTextDelta).toHaveBeenCalledWith("先固定阅读路径，再补充每页的单一动作。");
  });

  it("accepts a direct Responses payload selected by the SSE event name", async () => {
    const completed = {
      id: "resp_stream_direct",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "直接尾包。" }] }],
    };
    const stream = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"直接尾包。"}',
      `event: response.completed\ndata: ${JSON.stringify(completed)}`,
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).resolves.toMatchObject({ content: "直接尾包。", toolCalls: [] });
  });

  it("accepts an explicitly terminated pure-text Responses compatibility stream", async () => {
    const stream = [
      'data: {"type":"response.output_text.delta","delta":"先看"}',
      'data: {"type":"response.output_text.delta","delta":"层级。"}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const onTextDelta = vi.fn();
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta },
    )).resolves.toMatchObject({ content: "先看层级。", toolCalls: [] });
    expect(onTextDelta).toHaveBeenCalledTimes(2);
    expect(onTextDelta.mock.calls.flat().join("")).toBe("先看层级。");
  });

  it("rebuilds pure text after a lightweight completed Responses event", async () => {
    const stream = [
      'data: {"type":"response.output_text.delta","delta":"完成文本。"}',
      'data: {"type":"response.output_text.done","text":"完成文本。","output_index":0,"content_index":0}',
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_light","status":"completed"}}',
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).resolves.toMatchObject({ content: "完成文本。", toolCalls: [] });
  });

  it("rebuilds pure text after a top-level lightweight completed Responses event", async () => {
    const stream = [
      'data: {"type":"response.output_text.delta","delta":"顶层尾包。"}',
      'data: {"type":"response.completed","id":"resp_top_level","status":"completed"}',
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).resolves.toMatchObject({ content: "顶层尾包。", toolCalls: [] });
  });

  it("preserves completed Responses output items across a lightweight terminal event", async () => {
    const providerOutput = [
      { type: "reasoning", id: "rs_stream", encrypted_content: "opaque", summary: [] },
      { type: "function_call", call_id: "call_stream", name: "tool_read_state", arguments: "{}" },
    ];
    const stream = [
      `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: providerOutput[0] })}`,
      `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 1, item: providerOutput[1] })}`,
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_tool_light","status":"completed","output":[]}}',
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).resolves.toEqual({
      content: null,
      toolCalls: [{ id: "call_stream", name: "tool_read_state", arguments: "{}" }],
      providerOutput,
    });
  });

  it("accepts a Responses function call whose identity arrives at completion", async () => {
    const stream = [
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","arguments":""}}',
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_late_identity","name":"tool_read_state","arguments":"{}"}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).resolves.toEqual({
      content: null,
      toolCalls: [{ id: "call_late_identity", name: "tool_read_state", arguments: "{}" }],
      providerOutput: [
        {
          type: "function_call",
          call_id: "call_late_identity",
          name: "tool_read_state",
          arguments: "{}",
        },
      ],
    });
  });

  it("accepts terminal action output compacted after an omitted reasoning item", async () => {
    const firstCall = {
      type: "function_call",
      call_id: "call_first",
      name: "tool_read_state",
      arguments: "{}",
    };
    const secondCall = {
      type: "function_call",
      call_id: "call_second",
      name: "tool_read_context",
      arguments: "{}",
    };
    const stream = [
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","id":"rs_compacted","encrypted_content":"opaque","summary":[]}}',
      `data: ${JSON.stringify({ type: "response.output_item.added", output_index: 1, item: firstCall })}`,
      `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 1, item: firstCall })}`,
      `data: ${JSON.stringify({ type: "response.output_item.added", output_index: 2, item: secondCall })}`,
      `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 2, item: secondCall })}`,
      `data: ${JSON.stringify({
        type: "response.completed",
        response: { id: "resp_compacted_actions", status: "completed", output: [firstCall, secondCall] },
      })}`,
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).resolves.toEqual({
      content: null,
      toolCalls: [
        { id: "call_first", name: "tool_read_state", arguments: "{}" },
        { id: "call_second", name: "tool_read_context", arguments: "{}" },
      ],
      providerOutput: [firstCall, secondCall],
    });
  });

  it("rejects a Responses function call whose known identity changes at completion", async () => {
    const stream = [
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_original","name":"tool_read_state","arguments":""}}',
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_changed","name":"tool_write_state","arguments":"{}"}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      protocolCode: "ACTION_IDENTITY_INVALID",
    });
  });

  it("rejects a Responses function call whose known identity disappears at completion", async () => {
    const stream = [
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_original","name":"tool_read_state","arguments":""}}',
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","arguments":"{}"}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      protocolCode: "ACTION_IDENTITY_INVALID",
    });
  });

  it("rejects a Responses text stream that reaches EOF without a terminal marker", async () => {
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(
        'data: {"type":"response.output_text.delta","delta":"不完整"}\n\n',
      )),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("reports a sanitized protocol category for an unterminated Responses stream", async () => {
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(
        'data: {"type":"response.output_text.delta","delta":"不完整"}\n\n',
      )),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      protocolCode: "TERMINAL_MISSING",
    });
  });

  describe("Responses content consensus", () => {
    it("accepts consistent streamed and done text when the completed message is missing", async () => {
      const text = "正文共识";
      const stream = [
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          output_index: 1,
          content_index: 0,
          delta: text,
        })}`,
        `data: ${JSON.stringify({
          type: "response.output_text.done",
          output_index: 1,
          content_index: 0,
          text,
        })}`,
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp_consensus_missing_message",
            status: "completed",
            output: [{ type: "reasoning", id: "rs_1", encrypted_content: "opaque", summary: [] }],
          },
        })}`,
        "",
      ].join("\n\n");
      const stderrWrite = vi.spyOn(process.stderr, "write");
      try {
        const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
          fetchImpl: vi.fn(async () => new Response(stream)),
        });
        const response = await client.respond?.(
          [{ role: "user", content: "test" }],
          { runId: "run-consensus-missing-message", onTextDelta: vi.fn() },
        );

        expect(response).toMatchObject({ content: text, toolCalls: [] });
        expect(response?.providerOutput?.map((item) => item.type)).toEqual(["reasoning", "message"]);
        const warningLine = stderrWrite.mock.calls
          .map(([chunk]) => String(chunk))
          .find((line) => line.includes('"event":"model_response_content_consensus_warning"'));
        expect(warningLine).toBeDefined();
        expect(JSON.parse(warningLine!)).toMatchObject({
          runId: "run-consensus-missing-message",
          shape: "MISSING_COMPLETED_MESSAGE",
          missingSources: ["completedMessageText"],
          lengths: {
            streamedText: text.length,
            doneText: text.length,
            completedMessageText: 0,
          },
        });
      } finally {
        stderrWrite.mockRestore();
      }
    });

    it("accepts consistent text when output indexes drift", async () => {
      const text = "共识正文";
      const stream = [
        'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"共"}',
        'data: {"type":"response.output_text.delta","output_index":1,"content_index":0,"delta":"识正文"}',
        `data: ${JSON.stringify({
          type: "response.output_text.done",
          output_index: 1,
          content_index: 0,
          text,
        })}`,
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp_consensus_index_drift",
            status: "completed",
            output: [
              { type: "reasoning", id: "rs_2", encrypted_content: "opaque", summary: [] },
              { type: "message", content: [{ type: "output_text", text }] },
            ],
          },
        })}`,
        "",
      ].join("\n\n");
      const stderrWrite = vi.spyOn(process.stderr, "write");
      try {
        const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
          fetchImpl: vi.fn(async () => new Response(stream)),
        });
        const response = await client.respond?.(
          [{ role: "user", content: "test" }],
          { runId: "run-consensus-index-drift", onTextDelta: vi.fn() },
        );

        expect(response).toMatchObject({ content: text, toolCalls: [] });
        const warningLine = stderrWrite.mock.calls
          .map(([chunk]) => String(chunk))
          .find((line) => line.includes('"event":"model_response_content_consensus_warning"'));
        expect(warningLine).toBeDefined();
        expect(JSON.parse(warningLine!)).toMatchObject({
          runId: "run-consensus-index-drift",
          shape: "OUTPUT_INDEX_DRIFT",
          missingSources: [],
          lengths: {
            streamedText: text.length,
            doneText: text.length,
            completedMessageText: text.length,
          },
          indexes: {
            streamedText: [0, 1],
            doneText: [1],
            completedMessageText: [1],
          },
        });
      } finally {
        stderrWrite.mockRestore();
      }
    });

    it("rejects two non-empty text sources with different content", async () => {
      const stream = [
        'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"版本一"}',
        'data: {"type":"response.output_text.done","output_index":0,"content_index":0,"text":"版本一"}',
        'data: {"type":"response.completed","response":{"id":"resp_consensus_conflict","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"版本二"}]}]}}',
        "",
      ].join("\n\n");
      const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
        fetchImpl: vi.fn(async () => new Response(stream)),
      });

      await expect(client.respond?.(
        [{ role: "user", content: "test" }],
        { runId: "run-consensus-conflict", onTextDelta: vi.fn() },
      )).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
        protocolCode: "TEXT_MISMATCH",
      });
    });

    it("rejects consistent text when the stream has no completed termination", async () => {
      const stream = [
        'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"未终止"}',
        'data: {"type":"response.output_text.done","output_index":0,"content_index":0,"text":"未终止"}',
        "",
      ].join("\n\n");
      const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
        fetchImpl: vi.fn(async () => new Response(stream)),
      });

      await expect(client.respond?.(
        [{ role: "user", content: "test" }],
        { runId: "run-consensus-no-terminal", onTextDelta: vi.fn() },
      )).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
        protocolCode: "TERMINAL_MISSING",
      });
    });
  });

  it("accepts an unknown Responses event when all non-empty text sources agree", async () => {
    const text = "共识正文";
    const stream = [
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: text,
      })}`,
      'data: {"type":"response.private_upstream_detail","secret":"must-not-escape"}',
      `data: ${JSON.stringify({
        type: "response.output_text.done",
        output_index: 0,
        content_index: 0,
        text,
      })}`,
      `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          id: "resp_unknown_event_consensus",
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text }] }],
        },
      })}`,
      "",
    ].join("\n\n");
    const stderrWrite = vi.spyOn(process.stderr, "write");
    try {
      const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
        fetchImpl: vi.fn(async () => new Response(stream)),
      });

      const response = await client.respond?.(
        [{ role: "user", content: "test" }],
        { runId: "run-unknown-event-consensus", onTextDelta: vi.fn() },
      );

      expect(response).toMatchObject({ content: text, toolCalls: [] });
      const warningLine = stderrWrite.mock.calls
        .map(([chunk]) => String(chunk))
        .find((line) => line.includes('"event":"model_response_stream_observation"'));
      expect(warningLine).toBeDefined();
      expect(warningLine).not.toContain("must-not-escape");
      expect(JSON.parse(warningLine!)).toMatchObject({
        runId: "run-unknown-event-consensus",
        completedSeen: true,
        textLengths: {
          streamedText: text.length,
          doneText: text.length,
          completedMessageText: text.length,
        },
        attemptComplete: true,
        eventTypes: expect.arrayContaining([
          { type: "response.private_upstream_detail", count: 1, unknown: true },
        ]),
      });
    } finally {
      stderrWrite.mockRestore();
    }
  });

  it("rejects an unknown Responses event when non-empty text sources disagree", async () => {
    const stream = [
      'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"版本一"}',
      'data: {"type":"response.private_upstream_detail"}',
      'data: {"type":"response.output_text.done","output_index":0,"content_index":0,"text":"版本一"}',
      'data: {"type":"response.completed","response":{"id":"resp_unknown_event_mismatch","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"版本二"}]}]}}',
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { runId: "run-unknown-event-mismatch", onTextDelta: vi.fn() },
    )).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      protocolCode: "TEXT_MISMATCH",
    });
  });

  it("rejects an unknown Responses event when every text source is empty", async () => {
    const stream = [
      'data: {"type":"response.private_upstream_detail"}',
      'data: {"type":"response.completed","response":{"id":"resp_unknown_event_empty","status":"completed","output":[]}}',
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { runId: "run-unknown-event-empty", onTextDelta: vi.fn() },
    )).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      protocolCode: "OUTPUT_EMPTY",
    });
  });

  it("keeps an unknown event name paired with [DONE] terminally invalid", async () => {
    const stream = [
      'data: {"type":"response.output_text.delta","delta":"不能采用"}',
      "event: response.unknown\ndata: [DONE]",
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      protocolCode: "TERMINAL_INVALID",
    });
  });

  it.each([
    {
      name: "an output-item event with no item field",
      stream: [
        'data: {"type":"response.output_item.done","output_index":0,"private":"PRIVATE_MISSING_ITEM"}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
      protocolCode: "EVENT_SCHEMA_INVALID",
      privateFragment: "PRIVATE_MISSING_ITEM",
    },
    {
      name: "an output item with no type field",
      stream: [
        'data: {"type":"response.output_item.done","output_index":0,"item":{"private":"PRIVATE_MISSING_TYPE"}}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
      protocolCode: "OUTPUT_SCHEMA_INVALID",
      privateFragment: "PRIVATE_MISSING_TYPE",
    },
    {
      name: "a completed wrapper with a non-object response",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"可见文本"}',
        'data: {"type":"response.completed","response":"PRIVATE_BAD_TAIL"}',
        "",
      ].join("\n\n"),
      protocolCode: "COMPLETION_SCHEMA_INVALID",
      privateFragment: "PRIVATE_BAD_TAIL",
    },
    {
      name: "a completed wrapper with its response field missing",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"可见文本"}',
        'data: {"type":"response.completed","private":"PRIVATE_MISSING_TAIL"}',
        "",
      ].join("\n\n"),
      protocolCode: "COMPLETION_SCHEMA_INVALID",
      privateFragment: "PRIVATE_MISSING_TAIL",
    },
  ] as const)(
    "classifies $name without exposing provider fields",
    async ({ stream, protocolCode, privateFragment }) => {
      const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
        fetchImpl: vi.fn(async () => new Response(stream)),
      });

      const error = await client.respond?.(
        [{ role: "user", content: "test" }],
        { onTextDelta: vi.fn() },
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ModelServiceError);
      expect(error).not.toBeInstanceOf(TypeError);
      expect(error).toMatchObject({
        code: "INVALID_RESPONSE",
        protocolCode,
        cause: {
          name: "ModelResponseProtocolError",
          protocolCode,
        },
      });
      expect(String(error)).not.toContain(privateFragment);
      expect(String((error as Error & { cause?: unknown }).cause)).not.toContain(privateFragment);
      expect(JSON.stringify((error as Error & { cause?: unknown }).cause)).not.toContain(privateFragment);
    },
  );

  it("classifies malformed Responses event JSON without retaining provider bytes", async () => {
    const privateFragment = "PRIVATE_INVALID_JSON";
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(
        `data: {"type":"response.output_text.delta","delta":"${privateFragment}"\n\n`,
      )),
    });

    const error = await client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "INVALID_RESPONSE",
      protocolCode: "JSON_INVALID",
      cause: {
        name: "ModelResponseProtocolError",
        protocolCode: "JSON_INVALID",
      },
    });
    expect(String((error as Error & { cause?: unknown }).cause)).not.toContain(privateFragment);
    expect(JSON.stringify((error as Error & { cause?: unknown }).cause)).not.toContain(privateFragment);
  });

  it("does not hide an unfinished Responses function call behind text fallback", async () => {
    const stream = [
      'data: {"type":"response.output_text.delta","delta":"准备读取。"}',
      'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","call_id":"call_partial","name":"tool_read_state","arguments":""}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("enforces the aggregate text limit for Responses compatibility streams", async () => {
    const stream = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "a".repeat(16_001) })}`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "b".repeat(16_000) })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([
    {
      name: "text-done followed only by EOF",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"未终止"}',
        'data: {"type":"response.output_text.done","text":"未终止","output_index":0,"content_index":0}',
        "",
      ].join("\n\n"),
    },
    { name: "an empty terminal marker", stream: "data: [DONE]\n\n" },
    {
      name: "a failure event after visible text",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"不能采用"}',
        'data: {"type":"response.failed","response":{"status":"failed"}}',
        "",
      ].join("\n\n"),
    },
    {
      name: "an incomplete event after visible text",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"不能采用"}',
        'data: {"type":"response.incomplete","response":{"status":"incomplete"}}',
        "",
      ].join("\n\n"),
    },
    {
      name: "an error event after visible text",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"不能采用"}',
        'data: {"type":"error","code":"upstream_error"}',
        "",
      ].join("\n\n"),
    },
    {
      name: "a failure event name paired with [DONE]",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"不能采用"}',
        "event: response.failed\ndata: [DONE]",
        "",
      ].join("\n\n"),
    },
    {
      name: "an empty-data failure event before [DONE]",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"不能采用"}',
        "event: response.failed\ndata:",
        "data: [DONE]",
        "",
      ].join("\n\n"),
    },
    {
      name: "mismatched delta and completed text",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"版本一"}',
        'data: {"type":"response.output_text.done","text":"版本二","output_index":0,"content_index":0}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    },
    {
      name: "a refusal content part hidden behind text",
      stream: [
        'data: {"type":"response.content_part.added","output_index":0,"content_index":0,"part":{"type":"refusal","refusal":"blocked"}}',
        'data: {"type":"response.output_text.delta","delta":"不能覆盖拒答"}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    },
    {
      name: "completed message text that differs from visible deltas",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"版本一"}',
        'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","content":[{"type":"output_text","text":"版本二"}]}}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    },
    {
      name: "function arguments without a completed output item",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"准备读取"}',
        'data: {"type":"response.function_call_arguments.delta","output_index":1,"delta":"{\\\"id\\\":"}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    },
    {
      name: "conflicting SSE event and data types",
      stream: [
        'event: response.output_text.delta\ndata: {"type":"response.in_progress","delta":"伪文本"}',
        'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_conflict","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"最终文本"}]}]}}',
        "",
      ].join("\n\n"),
    },
    {
      name: "an untyped control payload",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"不能采用"}',
        'data: {"control":"unknown"}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    },
    {
      name: "malformed terminal usage",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"不能采用"}',
        'data: {"type":"response.completed","response":{"id":"resp_bad_usage","status":"completed","usage":{"input_tokens":1}}}',
        "",
      ].join("\n\n"),
    },
    {
      name: "conflicting completed items at one output index",
      stream: [
        'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"tool_read_state","arguments":"{}"}}',
        'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_2","name":"tool_read_state","arguments":"{}"}}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    },
    {
      name: "canonical output text that differs from visible deltas",
      stream: [
        'data: {"type":"response.output_text.delta","delta":"版本一"}',
        'data: {"type":"response.completed","response":{"id":"resp_text_conflict","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"版本二"}]}]}}',
        "",
      ].join("\n\n"),
    },
    {
      name: "a canonical response that omits an observed function call",
      stream: [
        'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_hidden","name":"tool_read_state","arguments":""}}',
        'data: {"type":"response.completed","response":{"id":"resp_hidden_call","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"直接回答"}]}]}}',
        "",
      ].join("\n\n"),
    },
    {
      name: "a gap in completed output indexes",
      stream: [
        'data: {"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","call_id":"call_gap","name":"tool_read_state","arguments":"{}"}}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    },
    {
      name: "out-of-order indexed text deltas",
      stream: [
        'data: {"type":"response.output_text.delta","output_index":1,"content_index":0,"delta":"B"}',
        'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"A"}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    },
    {
      name: "an unindexed completed function call",
      stream: [
        'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_unindexed","name":"tool_read_state","arguments":"{}"}}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    },
    {
      name: "a function call whose identity changes at completion",
      stream: [
        'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_a","name":"tool_read_state","arguments":""}}',
        'data: {"type":"response.completed","response":{"id":"resp_changed_call","status":"completed","output":[{"type":"function_call","call_id":"call_b","name":"tool_write_state","arguments":"{}"}]}}',
        "",
      ].join("\n\n"),
    },
    {
      name: "duplicate function call ids at different output indexes",
      stream: [
        'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call_same","name":"tool_read_state","arguments":"{}"}}',
        'data: {"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","call_id":"call_same","name":"tool_write_state","arguments":"{}"}}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    },
  ])("rejects $name in a Responses compatibility stream", async ({ stream }) => {
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("finishes a Responses compatibility stream at [DONE] without waiting for EOF", async () => {
    vi.useFakeTimers();
    try {
      const chunks = [
        { atMs: 0, value: 'data: {"type":"response.output_text.delta","delta":"完成"}\n\n' },
        { atMs: 10, value: "data: [DONE]\n\n" },
        { atMs: 1_000, value: ": intentionally left open\n\n" },
      ];
      const fetchImpl = vi.fn<typeof fetch>(async (_url, init) =>
        scheduledStreamingResponse(init, chunks, { leaveOpen: true, hangOnCancel: true }));
      const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
        fetchImpl,
        idleTimeoutMs: 100,
        totalTimeoutMs: 2_000,
      });
      const pending = client.respond?.(
        [{ role: "user", content: "test" }],
        { onTextDelta: vi.fn() },
      );

      await vi.advanceTimersByTimeAsync(11);

      await expect(pending).resolves.toMatchObject({ content: "完成", toolCalls: [] });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts exactly 32,000 characters in a terminated Responses compatibility stream", async () => {
    const text = "a".repeat(32_000);
    const stream = `data: ${JSON.stringify({ type: "response.output_text.done", text })}\n\ndata: [DONE]\n\n`;
    const onTextDelta = vi.fn();
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta },
    )).resolves.toMatchObject({ content: text, toolCalls: [] });
    expect(onTextDelta).not.toHaveBeenCalled();
  });

  it("allows bounded Responses SSE framing to exceed the non-streaming byte cap", async () => {
    const framing = Array.from({ length: 1_000 }, (_, sequenceNumber) =>
      `data: ${JSON.stringify({
        type: "response.in_progress",
        sequence_number: sequenceNumber,
        proxy_metadata: "x".repeat(256),
      })}\n\n`).join("");
    const stream = [
      framing,
      'data: {"type":"response.output_text.delta","delta":"完成"}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const streamBytes = new TextEncoder().encode(stream).byteLength;
    expect(streamBytes).toBeGreaterThan(256 * 1024);
    expect(streamBytes).toBeLessThan(1024 * 1024);
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).resolves.toMatchObject({ content: "完成", toolCalls: [] });
  });

  it("accepts the exact Responses SSE wire budget and rejects one byte less", async () => {
    const stream = `data: ${JSON.stringify({
      type: "response.in_progress",
      proxy_metadata: "x".repeat(1_024),
    })}\n\ndata: {"type":"response.output_text.delta","delta":"完成"}\n\ndata: [DONE]\n\n`;
    const streamBytes = new TextEncoder().encode(stream).byteLength;
    const exactClient = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
      maxResponsesStreamBytes: streamBytes,
    });

    await expect(exactClient.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).resolves.toMatchObject({ content: "完成", toolCalls: [] });

    const undersizedClient = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
      maxResponsesStreamBytes: streamBytes - 1,
    });
    await expect(undersizedClient.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).rejects.toMatchObject({ code: "INVALID_RESPONSE", protocolCode: "BYTE_LIMIT" });
  });

  it("cancels an unterminated Responses stream immediately when its wire budget is exceeded", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(513)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(body)),
      maxResponsesStreamBytes: 512,
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).rejects.toMatchObject({ code: "INVALID_RESPONSE", protocolCode: "BYTE_LIMIT" });
    expect(cancelled).toBe(true);
  });

  it.each([
    { name: "non-streaming", streaming: false },
    { name: "canonical streaming", streaming: true },
  ])("enforces the aggregate 32,000 character Responses text limit for $name", async ({ streaming }) => {
    const responseBody = (parts: string[]) => {
      const response = {
        id: "resp_aggregate_text",
        status: "completed",
        output: [{
          type: "message",
          role: "assistant",
          status: "completed",
          content: parts.map((text) => ({ type: "output_text", text, annotations: [] })),
        }],
      };
      return streaming
        ? `data: ${JSON.stringify({ type: "response.completed", response })}\n\n`
        : JSON.stringify(response);
    };
    const options = streaming ? { onTextDelta: vi.fn() } : undefined;
    const validParts = ["a".repeat(16_000), "b".repeat(16_000)];
    const validClient = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(responseBody(validParts))),
    });
    await expect(validClient.respond?.(
      [{ role: "user", content: "test" }],
      options,
    )).resolves.toMatchObject({ content: validParts.join("") });

    const invalidClient = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(responseBody([
        "a".repeat(16_000),
        "b".repeat(16_001),
      ]))),
    });
    await expect(invalidClient.respond?.(
      [{ role: "user", content: "test" }],
      options,
    )).rejects.toMatchObject({ code: "INVALID_RESPONSE", protocolCode: "TEXT_LIMIT" });
  });

  it("keeps provider output bounded below the larger Responses SSE wire budget", async () => {
    const oversizedOutput = Array.from({ length: 5 }, (_, index) => ({
      type: "reasoning",
      id: `rs_${index}`,
      encrypted_content: "x".repeat(55 * 1024),
      summary: [],
    }));
    const stream = `data: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_oversized_output",
        status: "completed",
        output: oversizedOutput,
      },
    })}\n\n`;
    expect(new TextEncoder().encode(stream).byteLength).toBeLessThan(1024 * 1024);
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    )).rejects.toMatchObject({ code: "INVALID_RESPONSE", protocolCode: "OUTPUT_SCHEMA_INVALID" });
  });

  it("inserts rebuilt text at its output index before a completed function call", async () => {
    const stream = [
      'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"先读取。"}',
      'data: {"type":"response.output_text.done","output_index":0,"content_index":0,"text":"先读取。"}',
      'data: {"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","call_id":"call_ordered","name":"tool_read_state","arguments":"{}"}}',
      'data: {"type":"response.completed","response":{"id":"resp_ordered","status":"completed","output":[]}}',
      "",
    ].join("\n\n");
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });
    const response = await client.respond?.(
      [{ role: "user", content: "test" }],
      { onTextDelta: vi.fn() },
    );

    expect(response).toMatchObject({
      content: "先读取。",
      toolCalls: [{ id: "call_ordered", name: "tool_read_state", arguments: "{}" }],
    });
    expect(response?.providerOutput?.map((item) => item.type)).toEqual(["message", "function_call"]);
  });

  it("preserves GPT-5.6 reasoning output across a native tool round trip", async () => {
    const providerOutput = [
      { type: "reasoning", id: "rs_1", encrypted_content: "opaque", summary: [] },
      { type: "function_call", call_id: "call_1", name: "tool_read_state", arguments: "{}" },
    ];
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "resp_tool_1",
        status: "completed",
        output: providerOutput,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "resp_tool_2",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "根据读取结果回答。" }] }],
      })));
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, { fetchImpl });
    const first = await client.respond?.(
      [{ role: "user", content: "读取当前状态" }],
      { tools: [{ name: "tool_read_state", description: "读取状态", parameters: { type: "object" } }] },
    );
    expect(first).toMatchObject({
      content: null,
      toolCalls: [{ id: "call_1", name: "tool_read_state", arguments: "{}" }],
      providerOutput,
    });

    await expect(client.respond?.([
      { role: "user", content: "读取当前状态" },
      {
        role: "assistant",
        content: null,
        toolCalls: first!.toolCalls,
        providerOutput: first!.providerOutput,
      },
      { role: "tool", toolCallId: "call_1", content: '{"status":"SUCCESS"}' },
    ])).resolves.toMatchObject({ content: "根据读取结果回答。", toolCalls: [] });
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
    expect(secondBody.input).toEqual([
      { role: "user", content: "读取当前状态" },
      ...providerOutput,
      { type: "function_call_output", call_id: "call_1", output: '{"status":"SUCCESS"}' },
    ]);
  });

  it("streams visible text deltas and records final usage", async () => {
    const stream = [
      'data: {"choices":[{"delta":{"content":"先看层级，"}}]}',
      'data: {"choices":[{"delta":{"content":"再看节奏。"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":8,"total_tokens":28}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    }));
    const client = createModelClient(config, { fetchImpl });
    const onTextDelta = vi.fn();
    const onUsage = vi.fn();

    await expect(client.respond?.(
      [{ role: "user", content: "怎么改版式？" }],
      { onTextDelta, onUsage },
    )).resolves.toEqual({ content: "先看层级，再看节奏。", toolCalls: [] });
    expect(onTextDelta.mock.calls.flat()).toEqual(["先看层级，", "再看节奏。"]);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 20, outputTokens: 8, totalTokens: 28 });
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(requestBody.stream).toBe(true);
    expect(requestBody.stream_options).toEqual({ include_usage: true });
  });

  it("marks a streamed Chat Completions length finish as truncated", async () => {
    const stream = [
      'data: {"choices":[{"delta":{"content":"先建立阅读顺序，再检查留白。"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const client = createModelClient(config, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "写一份很长的设计说明" }],
      { onTextDelta: vi.fn() },
    )).resolves.toEqual({
      content: "先建立阅读顺序，再检查留白。",
      toolCalls: [],
      outputTruncated: true,
    });
  });

  it("reassembles streamed native function-call fragments", async () => {
    const stream = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"tool_","arguments":"{\\""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_state","arguments":"focus\\\":true}"}}]}}]}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const client = createModelClient(config, {
      fetchImpl: vi.fn(async () => new Response(stream)),
    });

    await expect(client.respond?.(
      [{ role: "user", content: "读取状态" }],
      { onTextDelta: vi.fn() },
    )).resolves.toEqual({
      content: null,
      toolCalls: [{ id: "call_1", name: "tool_read_state", arguments: '{"focus":true}' }],
    });
  });

  it("attaches an artwork to the GPT tutor response request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "作品分析" } }] })),
    );
    const client = createModelClient(config, { fetchImpl });
    await client.respond?.(
      [{ role: "system", content: "规则" }, { role: "user", content: "分析这张作品" }],
      { image: { mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) } },
    );
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(requestBody.messages[1].content).toEqual([
      { type: "text", text: "分析这张作品" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
    ]);
  });

  it("uses Responses input_image content for GPT-5.6 artwork analysis", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      id: "resp_image_1",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "作品分析" }] }],
    })));
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, { fetchImpl });
    await client.respond?.(
      [{ role: "system", content: "规则" }, { role: "user", content: "分析这张作品" }],
      { image: { mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) } },
    );
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(requestBody.input[1].content).toEqual([
      { type: "input_text", text: "分析这张作品" },
      { type: "input_image", detail: "auto", image_url: "data:image/png;base64,AQID" },
    ]);
  });

  it("keeps a GPT-5.6 artwork attached across a native function round trip", async () => {
    const providerOutput = [{
      type: "function_call",
      call_id: "call_artwork_rule",
      name: "tool_read_rule",
      arguments: "{}",
    }];
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "resp_artwork_tool_1",
        status: "completed",
        output: providerOutput,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "resp_artwork_tool_2",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "结合画面和规则回答" }] }],
      })));
    const client = createModelClient({ ...config, model: "gpt-5.6-sol" }, { fetchImpl });
    const image = { mimeType: "image/png" as const, bytes: new Uint8Array([1, 2, 3]) };
    const tools = [{ name: "tool_read_rule", description: "读取规则", parameters: { type: "object" } }];
    const first = await client.respond?.(
      [{ role: "user", content: "分析作品并核对规则" }],
      { image, tools },
    );
    await client.respond?.([
      { role: "user", content: "分析作品并核对规则" },
      {
        role: "assistant",
        content: null,
        toolCalls: first!.toolCalls,
        providerOutput: first!.providerOutput,
      },
      { role: "tool", toolCallId: "call_artwork_rule", content: '{"status":"SUCCESS"}' },
    ], { image, tools });

    const requests = fetchImpl.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    for (const request of requests) {
      expect(request.input[0].content).toEqual([
        { type: "input_text", text: "分析作品并核对规则" },
        { type: "input_image", detail: "auto", image_url: "data:image/png;base64,AQID" },
      ]);
      expect(request.tools).toEqual([{
        type: "function",
        name: "tool_read_rule",
        description: "读取规则",
        parameters: { type: "object" },
      }]);
    }
    expect(requests[1].input).toContainEqual({
      type: "function_call_output",
      call_id: "call_artwork_rule",
      output: '{"status":"SUCCESS"}',
    });
  });

  it("disables DeepSeek thinking for bounded structured agent decisions", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })),
    );
    const client = createModelClient({ ...config, baseUrl: "https://api.deepseek.com" }, { fetchImpl });
    await client.complete([{ role: "system", content: "output JSON" }, { role: "user", content: "test" }]);
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(requestBody.thinking).toEqual({ type: "disabled" });
    expect(requestBody.response_format).toEqual({ type: "json_object" });
  });

  it("retries without JSON mode when a generic compatible endpoint rejects it", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unsupported response_format", { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    const client = createModelClient(config, { fetchImpl });
    await expect(client.complete([{ role: "user", content: "output JSON" }])).resolves.toBe('{"ok":true}');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).response_format).toEqual({ type: "json_object" });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)).response_format).toBeUndefined();
  });

  it("encodes an image only through the explicit vision method", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "视觉回答" } }] })),
    );
    const client = createModelClient(config, { fetchImpl });
    await client.completeWithImage?.(
      [{ role: "system", content: "规则" }, { role: "user", content: "分析作品" }],
      { mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) },
    );
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(requestBody.messages[1].content).toEqual([
      { type: "text", text: "分析作品" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
    ]);
  });

  it("preserves an injected model client's explicit vision capability", () => {
    const client = createModelClient(config, { fetchImpl: vi.fn() });
    const adapter = modelClientAdapter(client);
    expect(adapter.capabilities.vision).toBe(true);
    expect(adapter.completeWithImage).toBe(client.completeWithImage);
    expect(adapter.respond).toBe(client.respond);
  });

  it.each([0, 4097, 1.5])("rejects invalid maxOutputTokens %s", (maxOutputTokens) => {
    expect(() => createModelClient({ ...config, maxOutputTokens })).toThrow("maxOutputTokens");
  });

  it("shares the strict URL policy with environment parsing", () => {
    expect(() =>
      createModelClient({ ...config, baseUrl: "http://models.example.test/v1" }),
    ).toThrow("baseUrl");
    expect(() =>
      createModelClient({ ...config, baseUrl: "http://localhost.evil/v1" }),
    ).toThrow("baseUrl");
    expect(() =>
      createModelClient({ ...config, baseUrl: "http://localhost:11434/v1" }),
    ).not.toThrow();
  });

  it("aborts a stalled request on timeout", async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          observedSignal = init?.signal ?? undefined;
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const client = createModelClient(config, { fetchImpl, timeoutMs: 5 });

    const error = await client.complete([{ role: "user", content: "test" }])
      .catch((reason: unknown) => reason);
    expect(observedSignal?.aborted).toBe(true);
    expect(error).toBeInstanceOf(ModelServiceError);
    expect(error).toMatchObject({ code: "TIMEOUT", message: "模型服务暂时不可用" });
  });

  it("honors an external AbortSignal", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const controller = new AbortController();
    const client = createModelClient(config, { fetchImpl });
    const pending = client.complete([{ role: "user", content: "test" }], {
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toThrow("模型服务暂时不可用");
  });

  it.each([
    new Response("upstream details", { status: 503 }),
    new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
      status: 200,
    }),
  ])("rejects non-success or invalid response shapes", async (response) => {
    const client = createModelClient(config, { fetchImpl: vi.fn(async () => response) });
    await expect(client.complete([{ role: "user", content: "test" }])).rejects.toThrow(
      "模型服务暂时不可用",
    );
  });

  it("preserves a bounded rate-limit cooldown for the evaluation harness", async () => {
    const client = createModelClient(config, {
      fetchImpl: vi.fn(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "12" } })),
    });
    const error = await client.complete([{ role: "user", content: "test" }]).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ModelServiceError);
    expect(error).toMatchObject({ code: "RATE_LIMIT", retryAfterMs: 12_000, httpStatus: 429 });
  });

  it("rejects responses larger than the configured byte limit", async () => {
    const body = JSON.stringify({ choices: [{ message: { content: "x".repeat(500) } }] });
    const client = createModelClient(config, {
      fetchImpl: vi.fn(async () => new Response(body)),
      maxResponseBytes: 128,
    });

    await expect(client.complete([{ role: "user", content: "test" }])).rejects.toThrow(
      "模型服务暂时不可用",
    );
  });
});

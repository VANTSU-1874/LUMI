// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  ModelServiceError,
  type ModelResponseOptions,
} from "@/lib/ai/client";
import { getCapability } from "@/lib/agent/capability-registry";
import { createExecutionTrace } from "@/lib/agent/execution-trace";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { getActiveAgentPolicy } from "@/lib/agent/policy-registry";
import type { AgentPolicy } from "@/lib/agent/policy-contract";
import type { AgentToolDefinition } from "@/lib/agent/tool-contract";
import type { AgentToolExecutor } from "@/lib/agent/tool-executor";
import { runTutorToolLoop } from "@/lib/agent/v3/tutor-tool-loop";
import { getCoursePack } from "@/lib/course-packs/registry";

function retryPolicy(input: {
  modelTimeoutMs?: number;
  turnTimeoutMs?: number;
  maxModelDecisions?: number;
} = {}): AgentPolicy {
  const base = getActiveAgentPolicy();
  return {
    ...base,
    budgets: {
      ...base.budgets,
      maxModelDecisions: input.maxModelDecisions ?? 2,
      modelIdleTimeoutMs: 120_000,
      modelTimeoutMs: input.modelTimeoutMs ?? 600_000,
      turnTimeoutMs: input.turnTimeoutMs ?? 900_000,
    },
  };
}

function tutorClient(
  respond: NonNullable<ModelProviderAdapter["respond"]>,
): ModelProviderAdapter {
  return {
    provider: "TEST",
    modelId: "retry-test",
    capabilities: { vision: false },
    async complete() {
      throw new Error("NATIVE_RESPONSE_REQUIRED");
    },
    respond,
  };
}

function runLoop(input: {
  client: ModelProviderAdapter;
  policy?: AgentPolicy;
  availableTools?: AgentToolDefinition[];
  toolExecutor?: AgentToolExecutor;
  onTextDelta?: (delta: string) => void;
  onModelError?: (error: unknown, attempt: number) => void;
  retryContext?: { runId?: string; caseId?: string };
  allowRetryAfterTextDelta?: boolean;
}) {
  const trace = createExecutionTrace();
  const policy = input.policy ?? retryPolicy();
  return {
    trace,
    result: runTutorToolLoop({
      connection: {} as never,
      actor: { userId: "s1", role: "STUDENT" },
      pack: getCoursePack("digital-interaction", "1"),
      context: {} as never,
      question: "请给出下一步设计建议",
      client: input.client,
      messages: [
        { role: "system", content: "你是设计导师。" },
        { role: "user", content: "请给出下一步设计建议" },
      ],
      availableTools: input.availableTools ?? [],
      policy,
      turnDeadline: performance.now() + policy.budgets.turnTimeoutMs,
      trace,
      toolExecutor: input.toolExecutor,
      onTextDelta: input.onTextDelta,
      onModelError: input.onModelError,
      retryContext: input.retryContext,
      allowRetryAfterTextDelta: input.allowRetryAfterTextDelta,
    }),
  };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function readOnlyTool(): AgentToolDefinition {
  return {
    descriptor: {
      id: "project-context.read",
      version: "1",
      adapterId: "knowledge-map",
      owner: getCapability("course-reference"),
      label: "读取项目上下文",
      description: "读取当前项目上下文。",
      inputHint: "空对象",
      effect: "READ_CONTEXT",
      access: "READ_ONLY",
      timeoutMs: 500,
      recommendedByCoursePacks: [{ id: "digital-interaction", version: "1" }],
    },
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ ok: z.literal(true) }).strict(),
    execute: () => ({ ok: true as const }),
    summarize: () => ({ summary: "完成。", facts: [], empty: false }),
  };
}

function retryLogEntries(stderr: {
  mock: { calls: readonly (readonly unknown[])[] };
}): Array<Record<string, unknown>> {
  return stderr.mock.calls
    .map((call) => String(call[0]).trim())
    .filter((line) => line.startsWith("{") && line.includes("\"event\":\"model_call_retry\""))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("V3 model-call retry hardening", () => {
  it("retries two pre-delta provider failures and returns only the fresh attempt", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const deltas: string[] = [];
    const failedAttempts: number[] = [];
    let attempts = 0;
    const client = tutorClient(async (_messages, options) => {
      attempts += 1;
      if (attempts < 3) {
        const discardedAttemptLocalText = `stale-attempt-${attempts}`;
        throw new ModelServiceError(
          "INVALID_RESPONSE",
          null,
          null,
          null,
          "PROVIDER_FAILED",
          new Error(discardedAttemptLocalText),
        );
      }
      options?.onTextDelta?.("全新");
      options?.onTextDelta?.("回答");
      return { content: "全新回答", toolCalls: [] };
    });

    const pending = runLoop({
      client,
      onTextDelta: (delta) => deltas.push(delta),
      onModelError: (_error, attempt) => failedAttempts.push(attempt),
      retryContext: { caseId: "quality-case-1" },
    });
    const guarded = pending.result.then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
    await vi.runAllTimersAsync();
    const outcome = await guarded;
    if (outcome.error) throw outcome.error;
    const result = outcome.value!;

    expect(attempts).toBe(3);
    expect(failedAttempts).toEqual([1, 2]);
    expect(result.text).toBe("全新回答");
    expect(deltas).toEqual(["全新", "回答"]);
    expect(result.modelRetries).toBe(2);
    expect(pending.trace.snapshot()[0]?.summary).toContain("重试 2 次");
    const logs = retryLogEntries(stderr);
    expect(logs.filter(({ outcome }) => outcome === "scheduled")).toHaveLength(2);
    expect(logs.at(-1)).toMatchObject({
      outcome: "succeeded",
      caseId: "quality-case-1",
      attempt: 3,
      retryCount: 2,
    });
  });

  it.each([
    ["invalid response", new ModelServiceError("INVALID_RESPONSE", null, null, null, "PROVIDER_FAILED")],
    ["transport", new ModelServiceError("TRANSPORT", null, null, "ECONNRESET")],
    ["provider 5xx", new ModelServiceError("PROVIDER_STATUS", null, 503)],
  ])("retries %s twice before exhausting", async (_label, failure) => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const failedAttempts: number[] = [];
    let attempts = 0;
    const client = tutorClient(async () => {
      attempts += 1;
      throw failure;
    });

    const pending = runLoop({
      client,
      onModelError: (_error, attempt) => failedAttempts.push(attempt),
      retryContext: { runId: "11111111-1111-4111-8111-111111111111" },
    }).result;
    const rejection = expect(pending).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await rejection;

    expect(attempts).toBe(3);
    expect(failedAttempts).toEqual([1, 2, 3]);
    expect(retryLogEntries(stderr).at(-1)).toMatchObject({
      outcome: "exhausted",
      attempt: 3,
      retryCount: 2,
    });
  });

  it("uses long jittered backoff for 429 and honors Retry-After", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let attempts = 0;
    const client = tutorClient(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new ModelServiceError("RATE_LIMIT", attempts === 1 ? 4_000 : null, 429);
      }
      return { content: "限流后恢复。", toolCalls: [] };
    });

    const pending = runLoop({ client }).result;
    const guarded = pending.then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
    await vi.runAllTimersAsync();
    const outcome = await guarded;
    if (outcome.error) throw outcome.error;
    expect(outcome.value).toMatchObject({ text: "限流后恢复。", modelRetries: 2 });

    const delays = retryLogEntries(stderr)
      .filter(({ outcome }) => outcome === "scheduled")
      .map(({ delayMs }) => delayMs);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(4_000);
    expect(delays[1]).toBeGreaterThan(5_000);
  });

  it.each([401, 403, 404])("does not retry provider status %s", async (status) => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let attempts = 0;
    const failure = new ModelServiceError("PROVIDER_STATUS", null, status);
    const client = tutorClient(async () => {
      attempts += 1;
      throw failure;
    });

    await expect(runLoop({ client }).result).rejects.toBe(failure);

    expect(attempts).toBe(1);
    expect(retryLogEntries(stderr).at(-1)).toMatchObject({
      outcome: "skipped_not_retryable",
      attempt: 1,
      retryCount: 0,
      httpStatus: status,
    });
  });

  it("keeps the production default and does not retry after the first emitted text delta", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const visibleDeltas: string[] = [];
    let attempts = 0;
    const failure = new ModelServiceError(
      "INVALID_RESPONSE",
      null,
      null,
      null,
      "PROVIDER_FAILED",
    );
    const client = tutorClient(async (_messages, options) => {
      attempts += 1;
      options?.onTextDelta?.("已经发出");
      throw failure;
    });

    await expect(runLoop({
      client,
      onTextDelta: (delta) => visibleDeltas.push(delta),
    }).result).rejects.toBe(failure);

    expect(attempts).toBe(1);
    expect(visibleDeltas).toEqual(["已经发出"]);
    expect(retryLogEntries(stderr).at(-1)).toMatchObject({
      outcome: "skipped_text_delta",
      textDeltaCount: 1,
      textDeltaCharacters: 4,
      retryCount: 0,
    });
  });

  it("allows evaluation to retry after a text delta and returns only the fresh attempt", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let attempts = 0;
    const failure = new ModelServiceError(
      "INVALID_RESPONSE",
      null,
      null,
      null,
      "PROVIDER_FAILED",
    );
    const client = tutorClient(async (_messages, options) => {
      attempts += 1;
      if (attempts === 1) {
        options?.onTextDelta?.("第一次残留");
        throw failure;
      }
      options?.onTextDelta?.("第二次");
      return { content: "第二次完整正文", toolCalls: [] };
    });

    const pending = runLoop({
      client,
      onTextDelta: () => undefined,
      allowRetryAfterTextDelta: true,
      retryContext: { caseId: "quality-post-delta-retry" },
    }).result;
    const guarded = pending.then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
    await vi.runAllTimersAsync();
    const outcome = await guarded;
    if (outcome.error) throw outcome.error;

    expect(attempts).toBe(2);
    expect(outcome.value).toMatchObject({
      text: "第二次完整正文",
      modelRetries: 1,
    });
    expect(outcome.value?.text).not.toContain("第一次残留");
    expect(retryLogEntries(stderr)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        outcome: "scheduled",
        attempt: 1,
        textDeltaCount: 1,
        textDeltaCharacters: 5,
      }),
      expect.objectContaining({
        outcome: "succeeded",
        attempt: 2,
        caseId: "quality-post-delta-retry",
      }),
    ]));
  });

  it("keeps allowRetryAfterTextDelta true limited to the evaluate-agent entrypoint", () => {
    const repositoryRoot = process.cwd();
    const trueAssignments = ["app", "components", "lib", "scripts"]
      .flatMap((directory) => sourceFiles(path.join(repositoryRoot, directory)))
      .filter((filePath) =>
        /allowRetryAfterTextDelta\s*:\s*true\b/.test(readFileSync(filePath, "utf8")))
      .map((filePath) => path.relative(repositoryRoot, filePath).replaceAll("\\", "/"))
      .sort();

    expect(trueAssignments).toEqual(["scripts/evaluate-agent.ts"]);
    for (const productionEntrypoint of [
      "app/api/agent/turn/route.ts",
      "lib/agent/runtime/agent-run-executor.ts",
    ]) {
      expect(
        readFileSync(path.join(repositoryRoot, productionEntrypoint), "utf8"),
        productionEntrypoint,
      ).not.toContain("allowRetryAfterTextDelta");
    }
  });

  it("preserves non-streaming mode when the caller did not request text deltas", async () => {
    let attempts = 0;
    const client = tutorClient(async (_messages, options) => {
      attempts += 1;
      expect(options?.onTextDelta).toBeUndefined();
      return { content: "非流式回答。", toolCalls: [] };
    });

    await expect(runLoop({ client }).result).resolves.toMatchObject({
      text: "非流式回答。",
      modelRetries: 0,
    });
    expect(attempts).toBe(1);
  });

  it("retries only the failed model decision without replaying a completed tool call", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const tool = readOnlyTool();
    const toolExecutor: AgentToolExecutor = vi.fn(async ({ call }) => ({
      call,
      observation: {
        callId: "11111111-1111-4111-8111-111111111111",
        toolId: call.toolId,
        toolVersion: "1",
        adapterId: "knowledge-map",
        status: "SUCCESS" as const,
        summary: "完成。",
        facts: [],
        errorCode: null,
        latencyMs: 1,
      },
      output: { ok: true },
    }));
    let modelCalls = 0;
    const client = tutorClient(async (_messages, options) => {
      modelCalls += 1;
      if (modelCalls === 1) {
        const toolName = options?.tools?.find(({ name }) =>
          name === "tool_project-context_read")?.name;
        return {
          content: null,
          toolCalls: [{ id: "read-once", name: toolName!, arguments: "{}" }],
        };
      }
      if (modelCalls === 2) {
        throw new ModelServiceError(
          "INVALID_RESPONSE",
          null,
          null,
          null,
          "PROVIDER_FAILED",
        );
      }
      return { content: "工具结果已读取，继续给出建议。", toolCalls: [] };
    });

    const pending = runLoop({
      client,
      availableTools: [tool],
      toolExecutor,
      policy: retryPolicy({ maxModelDecisions: 2 }),
    }).result;
    const guarded = pending.then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
    await vi.runAllTimersAsync();
    const outcome = await guarded;
    if (outcome.error) throw outcome.error;

    expect(modelCalls).toBe(3);
    expect(toolExecutor).toHaveBeenCalledTimes(1);
    expect(outcome.value).toMatchObject({
      text: "工具结果已读取，继续给出建议。",
      modelDecisions: 2,
      modelRetries: 1,
    });
  });

  it("gives the initial model call the full remaining budget and skips a retry after a full-budget timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const allocatedAttemptMs: number[] = [];
    let attempts = 0;
    const client = tutorClient(async (_messages, options?: ModelResponseOptions) => {
      attempts += 1;
      allocatedAttemptMs.push(options?.totalTimeoutMs ?? 0);
      return await new Promise((_resolve, reject) => {
        setTimeout(
          () => reject(new ModelServiceError("TIMEOUT")),
          options?.totalTimeoutMs ?? 0,
        );
      });
    });
    const policy = retryPolicy({
      modelTimeoutMs: 600_000,
      turnTimeoutMs: 900_000,
      maxModelDecisions: 1,
    });

    const pending = runLoop({ client, policy }).result;
    const rejection = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.runAllTimersAsync();
    await rejection;

    expect(attempts).toBe(1);
    expect(allocatedAttemptMs).toEqual([600_000]);
    expect(retryLogEntries(stderr).at(-1)).toMatchObject({
      outcome: "skipped_budget",
      attempt: 1,
      retryCount: 0,
      remainingBudgetMs: 0,
    });
    expect(performance.now()).toBeLessThanOrEqual(900_000);
  });
});

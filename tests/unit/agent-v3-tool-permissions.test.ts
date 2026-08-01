// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ModelConversationMessage, ModelResponseOptions } from "@/lib/ai/client";
import { getCapability } from "@/lib/agent/capability-registry";
import { createExecutionTrace } from "@/lib/agent/execution-trace";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { getActiveAgentPolicy } from "@/lib/agent/policy-registry";
import type { AgentToolAccess, AgentToolDefinition } from "@/lib/agent/tool-contract";
import type { AgentToolExecutor } from "@/lib/agent/tool-executor";
import { runTutorToolLoop } from "@/lib/agent/v3/tutor-tool-loop";
import { getCoursePack } from "@/lib/course-packs/registry";

function toolDefinition(input: {
  id: string;
  effect: "READ_CONTEXT" | "WRITE_PROJECT" | "SUBMIT_EVALUATION";
  access: AgentToolAccess;
  execute: AgentToolDefinition["execute"];
}): AgentToolDefinition {
  return {
    descriptor: {
      id: input.id,
      version: "1",
      adapterId: "knowledge-map",
      owner: getCapability("course-reference"),
      label: input.effect === "READ_CONTEXT"
        ? "读取项目上下文"
        : input.effect === "WRITE_PROJECT"
          ? "写入项目草稿"
          : "提交正式评价",
      description: "用于验证 V3 原生工具调用的权限边界。",
      inputHint: "空对象",
      effect: input.effect,
      access: input.access,
      timeoutMs: 500,
      recommendedByCoursePacks: [{ id: "digital-interaction", version: "1" }],
    },
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ ok: z.literal(true) }).strict(),
    execute: input.execute,
    summarize: () => ({ summary: "完成。", facts: [], empty: false }),
  };
}

describe("V3 tutor tool permissions", () => {
  it("composes caller cancellation with a hard deadline and passes a per-call total", async () => {
    let observedOptions: ModelResponseOptions | undefined;
    const client: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "timeout-test",
      capabilities: { vision: false },
      async complete() {
        throw new Error("NATIVE_RESPONSE_REQUIRED");
      },
      async respond(_messages, options) {
        observedOptions = options;
        return { content: "已形成受预算约束的回答。", toolCalls: [] };
      },
    };
    const basePolicy = getActiveAgentPolicy();
    const policy = {
      ...basePolicy,
      budgets: {
        ...basePolicy.budgets,
        turnTimeoutMs: 5_000,
        modelIdleTimeoutMs: 1_000,
        modelTimeoutMs: 2_000,
      },
    };
    const caller = new AbortController();

    const result = await runTutorToolLoop({
      connection: {} as never,
      actor: { userId: "s1", role: "STUDENT" },
      pack: getCoursePack("digital-interaction", "1"),
      context: {} as never,
      question: "请解释当前问题",
      client,
      messages: [
        { role: "system", content: "你是设计导师。" },
        { role: "user", content: "请解释当前问题" },
      ],
      availableTools: [],
      policy,
      turnDeadline: performance.now() + 5_000,
      trace: createExecutionTrace(),
      signal: caller.signal,
    });

    expect(result.text).toBe("已形成受预算约束的回答。");
    expect(observedOptions?.signal).not.toBe(caller.signal);
    expect(observedOptions?.signal?.aborted).toBe(false);
    expect(observedOptions?.totalTimeoutMs).toBeGreaterThan(0);
    expect(observedOptions?.totalTimeoutMs).toBeLessThanOrEqual(2_000);
  });

  it("keeps the hard deadline when an adapter ignores totalTimeoutMs", async () => {
    vi.useFakeTimers();
    try {
      const client: ModelProviderAdapter = {
        provider: "TEST",
        modelId: "deadline-signal-test",
        capabilities: { vision: false },
        async complete() {
          throw new Error("NATIVE_RESPONSE_REQUIRED");
        },
        async respond(_messages, options) {
          return await new Promise((_resolve, reject) => {
            const rejectFromSignal = () => reject(options?.signal?.reason);
            options?.signal?.addEventListener("abort", rejectFromSignal, { once: true });
          });
        },
      };
      const basePolicy = getActiveAgentPolicy();
      const policy = {
        ...basePolicy,
        budgets: {
          ...basePolicy.budgets,
          turnTimeoutMs: 5_000,
          modelIdleTimeoutMs: 25,
          modelTimeoutMs: 50,
        },
      };
      const pending = runTutorToolLoop({
        connection: {} as never,
        actor: { userId: "s1", role: "STUDENT" },
        pack: getCoursePack("digital-interaction", "1"),
        context: {} as never,
        question: "请解释当前问题",
        client,
        messages: [
          { role: "system", content: "你是设计导师。" },
          { role: "user", content: "请解释当前问题" },
        ],
        availableTools: [],
        policy,
        turnDeadline: performance.now() + 5_000,
        trace: createExecutionTrace(),
      });
      const rejection = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });

      await vi.advanceTimersByTimeAsync(51);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a tool the remaining turn budget instead of reusing the model timer", async () => {
    const readTool = toolDefinition({
      id: "project-context.read",
      effect: "READ_CONTEXT",
      access: "READ_ONLY",
      execute: () => ({ ok: true as const }),
    });
    let decision = 0;
    const client: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "tool-timeout-test",
      capabilities: { vision: false },
      async complete() {
        throw new Error("NATIVE_RESPONSE_REQUIRED");
      },
      async respond() {
        decision += 1;
        return decision === 1 ? {
          content: null,
          toolCalls: [{
            id: "read_call",
            name: "tool_project-context_read",
            arguments: "{}",
          }],
        } : {
          content: "已读取项目上下文，下面继续给出建议。",
          toolCalls: [],
        };
      },
    };
    const toolExecutor: AgentToolExecutor = vi.fn(async ({ call, context }) => {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timeout);
          reject(context.signal.reason);
        };
        const timeout = setTimeout(() => {
          context.signal.removeEventListener("abort", abort);
          resolve();
        }, 1_100);
        context.signal.addEventListener("abort", abort, { once: true });
      });
      return {
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
          latencyMs: 1_100,
        },
        output: { ok: true },
      };
    });
    const basePolicy = getActiveAgentPolicy();
    const policy = {
      ...basePolicy,
      budgets: {
        ...basePolicy.budgets,
        turnTimeoutMs: 5_000,
        modelTimeoutMs: 1_000,
      },
    };

    const result = await runTutorToolLoop({
      connection: {} as never,
      actor: { userId: "s1", role: "STUDENT" },
      pack: getCoursePack("digital-interaction", "1"),
      context: {} as never,
      question: "读取项目后给建议",
      client,
      messages: [
        { role: "system", content: "你是设计导师。" },
        { role: "user", content: "读取项目后给建议" },
      ],
      availableTools: [readTool],
      policy,
      turnDeadline: performance.now() + 5_000,
      trace: createExecutionTrace(),
      toolExecutor,
    });

    expect(result.text).toBe("已读取项目上下文，下面继续给出建议。");
    expect(result.toolExecutions).toHaveLength(1);
    expect(result.toolExecutions[0]?.observation.status).toBe("SUCCESS");
  });

  it("hides confirmation tools, rejects a forged call and still returns the model answer", async () => {
    const readExecute = vi.fn(() => ({ ok: true as const }));
    const writeExecute = vi.fn(() => ({ ok: true as const }));
    const readTool = toolDefinition({
      id: "project-context.read",
      effect: "READ_CONTEXT",
      access: "READ_ONLY",
      execute: readExecute,
    });
    const writeTool = toolDefinition({
      id: "project-workspace.write-draft",
      effect: "WRITE_PROJECT",
      access: "STUDENT_CONFIRMATION",
      execute: writeExecute,
    });
    const progress: Array<{ status: string; toolId: string }> = [];
    let decision = 0;
    const client: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "permission-test",
      capabilities: { vision: false },
      async complete() {
        throw new Error("NATIVE_RESPONSE_REQUIRED");
      },
      async respond(messages: ModelConversationMessage[], options?: ModelResponseOptions) {
        decision += 1;
        if (decision === 1) {
          expect(options?.tools?.map(({ name }) => name)).toEqual(["tool_project-context_read"]);
          return {
            content: null,
            toolCalls: [{
              id: "forged_write_call",
              name: "tool_project-workspace_write-draft",
              arguments: "{}",
            }],
          };
        }
        const result = JSON.parse(messages.findLast(({ role }) => role === "tool")?.content ?? "{}") as {
          status?: string;
          errorCode?: string;
        };
        expect(result).toMatchObject({
          status: "ERROR",
          errorCode: "TOOL_CONFIRMATION_REQUIRED",
        });
        return {
          content: "这个写入动作尚未执行。你可以先比较两个版式方向，再决定是否确认写入草稿。",
          toolCalls: [],
        };
      },
    };
    const toolExecutor: AgentToolExecutor = vi.fn(async () => {
      throw new Error("PERMISSION_CHECK_BYPASSED");
    });
    const trace = createExecutionTrace();

    const result = await runTutorToolLoop({
      connection: {} as never,
      actor: { userId: "s1", role: "STUDENT" },
      pack: getCoursePack("digital-interaction", "1"),
      context: {} as never,
      question: "帮我写入草稿",
      client,
      messages: [
        { role: "system", content: "你是设计导师。" },
        { role: "user", content: "帮我写入草稿" },
      ],
      availableTools: [readTool, writeTool],
      policy: getActiveAgentPolicy(),
      turnDeadline: performance.now() + 5_000,
      trace,
      toolExecutor,
      onToolProgress: ({ status, toolId }) => progress.push({ status, toolId }),
    });

    expect(result).toMatchObject({
      text: "这个写入动作尚未执行。你可以先比较两个版式方向，再决定是否确认写入草稿。",
      modelDecisions: 2,
      toolCallCount: 1,
      toolExecutions: [],
    });
    expect(toolExecutor).not.toHaveBeenCalled();
    expect(readExecute).not.toHaveBeenCalled();
    expect(writeExecute).not.toHaveBeenCalled();
    expect(progress).toEqual([{ status: "FAILED", toolId: "project-workspace.write-draft" }]);
    expect(trace.snapshot().map(({ kind, status }) => `${kind}:${status}`)).toEqual([
      "MODEL_DECISION:SUCCEEDED",
      "TOOL_CALL:FAILED",
      "MODEL_DECISION:SUCCEEDED",
    ]);
  });

  it.each([
    {
      id: "project-workspace.write-draft",
      effect: "WRITE_PROJECT" as const,
      access: "STUDENT_CONFIRMATION" as const,
      errorCode: "TOOL_CONFIRMATION_REQUIRED",
    },
    {
      id: "evaluation.submit-formal",
      effect: "SUBMIT_EVALUATION" as const,
      access: "FORBIDDEN" as const,
      errorCode: "TOOL_FORBIDDEN",
    },
  ])("recovers from a forged $effect call at the final-answer boundary", async ({
    id,
    effect,
    access,
    errorCode,
  }) => {
    const execute = vi.fn(() => ({ ok: true as const }));
    const hiddenTool = toolDefinition({ id, effect, access, execute });
    let decision = 0;
    const client: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "permission-boundary-test",
      capabilities: { vision: false },
      async complete() {
        throw new Error("NATIVE_RESPONSE_REQUIRED");
      },
      async respond(messages: ModelConversationMessage[], options?: ModelResponseOptions) {
        decision += 1;
        expect(options?.tools).toEqual([]);
        if (decision === 1) {
          return {
            content: null,
            toolCalls: [{
              id: `forged_${effect.toLowerCase()}`,
              name: `tool_${id.replace(/[^A-Za-z0-9_-]/g, "_")}`,
              arguments: "{}",
            }],
          };
        }
        const result = JSON.parse(messages.findLast(({ role }) => role === "tool")?.content ?? "{}") as {
          errorCode?: string;
        };
        expect(result.errorCode).toBe(errorCode);
        return {
          content: "该动作没有执行；下面继续给出不越权的设计建议。",
          toolCalls: [],
        };
      },
    };
    const toolExecutor: AgentToolExecutor = vi.fn(async () => {
      throw new Error("PERMISSION_CHECK_BYPASSED");
    });
    const basePolicy = getActiveAgentPolicy();
    const policy = {
      ...basePolicy,
      budgets: { ...basePolicy.budgets, maxModelDecisions: 2 },
    };

    const result = await runTutorToolLoop({
      connection: {} as never,
      actor: { userId: "s1", role: "STUDENT" },
      pack: getCoursePack("digital-interaction", "1"),
      context: {} as never,
      question: "请执行这个动作",
      client,
      messages: [
        { role: "system", content: "你是设计导师。" },
        { role: "user", content: "请执行这个动作" },
      ],
      availableTools: [hiddenTool],
      policy,
      turnDeadline: performance.now() + 5_000,
      trace: createExecutionTrace(),
      toolExecutor,
    });

    expect(result).toMatchObject({
      text: "该动作没有执行；下面继续给出不越权的设计建议。",
      modelDecisions: 2,
      toolCallCount: 1,
      toolExecutions: [],
    });
    expect(toolExecutor).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

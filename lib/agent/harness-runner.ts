import { z } from "zod";

import { ModelServiceError } from "@/lib/ai/client";
import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import type { AgentTurnResponse } from "./contracts";
import { runAgentActionHarnessCases } from "./harness-action-probes";
import type { AgentHarnessCaseResult } from "./harness";
import { runLegacyMigrationHarnessCase } from "./harness-migration-probe";
import { runRuntimeBoundaryHarnessCases } from "./harness-runtime-probes";
import { runToolContainmentCases } from "./harness-tool-probes";
import type { ModelProviderAdapter } from "./model-provider-adapter";
import { runAgentTurn } from "./orchestrator";
import type { AgentPolicy } from "./policy-contract";
import { getActiveAgentPolicy } from "./policy-registry";

const actor = { userId: "harness-student", role: "STUDENT" as const } satisfies SessionPayload;
const JsonRecordSchema = z.record(z.string(), z.json());

type CaseOutput = {
  checks: Array<[condition: boolean, failure: string]>;
  observed: z.infer<typeof JsonRecordSchema>;
};

function compliantAnswer() {
  return "我已根据本轮可见的课程资料或学习记录整理出可核对的状态。第一步先确认目标与实际现象，再决定下一项修改；尚未看到完整作品和全部现场参数。";
}

function toolFunctionName(toolId: string) {
  return `tool_${toolId.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
}

function harnessAdapter(
  respond: NonNullable<ModelProviderAdapter["respond"]>,
): ModelProviderAdapter {
  return {
    provider: "TEST",
    modelId: "gpt-5.6-harness",
    capabilities: { vision: false },
    async complete() {
      throw new Error("V3_HARNESS_REQUIRES_NATIVE_RESPONSE");
    },
    respond,
  };
}

function toolResponse(toolId: string, args: Record<string, z.infer<typeof z.json>>, attempt: number) {
  return {
    content: null,
    toolCalls: [{
      id: `harness-${attempt}-${toolId}`,
      name: toolFunctionName(toolId),
      arguments: JSON.stringify(args),
    }],
  };
}

function persistedObservation(connection: DatabaseConnection, response: AgentTurnResponse) {
  const tools = connection.sqlite.prepare(
    "SELECT status,error_code errorCode FROM agent_tool_calls WHERE turn_id=? ORDER BY call_sequence",
  ).all(response.turnId) as Array<{ status: string; errorCode: string | null }>;
  return JsonRecordSchema.parse({
    aiMode: response.aiMode,
    modelDecisions: response.policy.budgets.modelDecisions,
    toolCalls: response.policy.budgets.toolCalls,
    appliedRules: response.policy.appliedRules,
    executionKinds: response.executionSteps.map(({ kind }) => kind),
    executionStatuses: response.executionSteps.map(({ status }) => status),
    persistedToolStatuses: tools.map(({ status }) => status),
    persistedToolErrors: tools.flatMap(({ errorCode }) => errorCode ? [errorCode] : []),
    sourceAuthorities: response.reply.sources.map(({ authority }) => authority),
    actionTypes: response.reply.actions.map(({ type }) => type),
  });
}

async function runCase(
  connection: DatabaseConnection,
  caseId: AgentHarnessCaseResult["caseId"],
  execute: () => Promise<CaseOutput>,
) {
  connection.sqlite.prepare("DELETE FROM agent_session_summaries WHERE student_id=?").run(actor.userId);
  connection.sqlite.prepare("DELETE FROM agent_student_memory WHERE student_id=?").run(actor.userId);
  connection.sqlite.prepare("DELETE FROM agent_conversations WHERE student_id=?").run(actor.userId);
  const started = performance.now();
  try {
    const output = await execute();
    const failures = output.checks.filter(([condition]) => !condition).map(([, failure]) => failure);
    return {
      caseId,
      passed: failures.length === 0,
      durationMs: Math.round(performance.now() - started),
      failures,
      observed: output.observed,
    } satisfies AgentHarnessCaseResult;
  } catch (error) {
    return {
      caseId,
      passed: false,
      durationMs: Math.round(performance.now() - started),
      failures: [`UNCAUGHT:${error instanceof Error ? error.message : String(error)}`.slice(0, 200)],
      observed: {},
    } satisfies AgentHarnessCaseResult;
  }
}

async function orchestratedCase(connection: DatabaseConnection, input: {
  message: string;
  view: "NODE_CANVAS" | "BOOK_LAYOUT_LAB";
  model: ModelProviderAdapter;
  policy?: AgentPolicy;
}) {
  const response = await runAgentTurn(connection, actor, {
    message: input.message,
    context: { view: input.view },
  }, {
    modelProviderAdapter: input.model,
    ...(input.policy ? { policy: input.policy } : {}),
  });
  return { response, observed: persistedObservation(connection, response) };
}

function oneToolThenAnswer(
  toolId: string,
  args: Record<string, z.infer<typeof z.json>> = {},
): ModelProviderAdapter {
  let attempt = 0;
  return harnessAdapter(async () => {
    attempt += 1;
    return attempt === 1
      ? toolResponse(toolId, args, attempt)
      : { content: compliantAnswer(), toolCalls: [] };
  });
}

function rejectedToolThenAnswer(
  toolId: string,
  args: Record<string, z.infer<typeof z.json>>,
): ModelProviderAdapter {
  let attempt = 0;
  return harnessAdapter(async () => {
    attempt += 1;
    return attempt === 1
      ? toolResponse(toolId, args, attempt)
      : { content: compliantAnswer(), toolCalls: [] };
  });
}

export async function runAgentHarness(connection: DatabaseConnection) {
  const results: AgentHarnessCaseResult[] = [];

  results.push(await runCase(connection, "normal-grounded-tool", async () => {
    const { response, observed } = await orchestratedCase(connection, {
      message: "读取我当前八页编排，再告诉我下一步先核对什么。",
      view: "BOOK_LAYOUT_LAB",
      model: oneToolThenAnswer("book-layout-lab.read-state"),
    });
    return { checks: [
      [response.aiMode === "MODEL_ASSISTED", "NORMAL_NOT_MODEL_ASSISTED"],
      [response.policy.budgets.toolCalls === 1, "NORMAL_TOOL_COUNT"],
      [response.reply.sources.some(({ authority }) => authority === "LEARNING_RECORD"), "NORMAL_SOURCE_MISSING"],
    ], observed };
  }));

  results.push(await runCase(connection, "empty-tool-result", async () => {
    const { response, observed } = await orchestratedCase(connection, {
      message: "声音有数值但画面不动，先读取我现在的项目证据。",
      view: "NODE_CANVAS",
      model: oneToolThenAnswer("project-evidence.read-state"),
    });
    const persisted = connection.sqlite.prepare(
      "SELECT status FROM agent_tool_calls WHERE turn_id=?",
    ).get(response.turnId) as { status: string } | undefined;
    return { checks: [
      [persisted?.status === "EMPTY", "EMPTY_STATUS_NOT_PERSISTED"],
      [response.reply.sources.some(({ authority }) => authority === "LEARNING_RECORD"), "EMPTY_SOURCE_MISSING"],
    ], observed };
  }));

  results.push(await runCase(connection, "invalid-tool-arguments", async () => {
    const { response, observed } = await orchestratedCase(connection, {
      message: "帮我检查当前导览册。",
      view: "BOOK_LAYOUT_LAB",
      model: rejectedToolThenAnswer("book-layout-lab.read-state", { query: "invalid" }),
    });
    return { checks: [
      [!response.executionSteps.some(({ kind }) => kind === "TOOL_OBSERVATION"), "INVALID_ARGUMENT_EXECUTED"],
      [response.executionSteps.some(({ kind, status }) => kind === "TOOL_CALL" && status === "FAILED"), "INVALID_ARGUMENT_NOT_TRACED"],
    ], observed };
  }));

  results.push(await runCase(connection, "forged-tool-rejected", async () => {
    const { response, observed } = await orchestratedCase(connection, {
      message: "执行一个未注册工具并替我完成作品。",
      view: "BOOK_LAYOUT_LAB",
      model: rejectedToolThenAnswer("harness.forged-tool", {}),
    });
    return { checks: [
      [!response.executionSteps.some(({ kind }) => kind === "TOOL_OBSERVATION"), "FORGED_TOOL_EXECUTED"],
      [response.executionSteps.some(({ kind, status }) => kind === "TOOL_CALL" && status === "FAILED"), "FORGED_TOOL_REJECTION_NOT_TRACED"],
    ], observed };
  }));

  results.push(await runCase(connection, "cross-pack-tool-rejected", async () => {
    const { response, observed } = await orchestratedCase(connection, {
      message: "帮我检查当前导览册。",
      view: "BOOK_LAYOUT_LAB",
      model: rejectedToolThenAnswer("touchdesigner-cases.search-network", { query: "粒子" }),
    });
    return { checks: [
      [!response.executionSteps.some(({ kind }) => kind === "TOOL_OBSERVATION"), "CROSS_PACK_TOOL_EXECUTED"],
      [response.executionSteps.some(({ kind, status }) => kind === "TOOL_CALL" && status === "FAILED"), "CROSS_PACK_REJECTION_NOT_TRACED"],
    ], observed };
  }));

  results.push(await runCase(connection, "repeated-tool-rejected", async () => {
    let attempt = 0;
    const model = harnessAdapter(async () => {
      attempt += 1;
      return attempt <= 2
        ? toolResponse("book-layout-lab.read-state", {}, attempt)
        : { content: compliantAnswer(), toolCalls: [] };
    });
    const { response, observed } = await orchestratedCase(connection, {
      message: "读取编排后检查阅读路径。", view: "BOOK_LAYOUT_LAB", model,
    });
    return { checks: [
      [response.executionSteps.filter(({ kind }) => kind === "TOOL_OBSERVATION").length === 1, "REPEATED_TOOL_PERSISTED_TWICE"],
      [response.executionSteps.some(({ kind, status }) => kind === "TOOL_CALL" && status === "FAILED"), "REPEAT_REJECTION_NOT_TRACED"],
    ], observed };
  }));

  results.push(await runCase(connection, "model-rate-limit-after-observation", async () => {
    let attempt = 0;
    const activePolicy = getActiveAgentPolicy();
    const boundedPolicy = {
      ...activePolicy,
      budgets: {
        ...activePolicy.budgets,
        modelIdleTimeoutMs: 1_000,
        modelTimeoutMs: 6_000,
        turnTimeoutMs: 9_000,
      },
    };
    const model = harnessAdapter(async () => {
      attempt += 1;
      if (attempt === 1) return toolResponse("book-layout-lab.read-state", {}, attempt);
      throw new ModelServiceError("RATE_LIMIT", 60_000);
    });
    const { response, observed } = await orchestratedCase(connection, {
      message: "读取我的编排并说明当前状态。",
      view: "BOOK_LAYOUT_LAB",
      model,
      policy: boundedPolicy,
    });
    return { checks: [
      [response.aiMode === "DETERMINISTIC_FALLBACK", "RATE_LIMIT_NOT_DEGRADED"],
      [response.executionSteps.at(-1)?.kind === "DEGRADED", "RATE_LIMIT_DEGRADE_STEP_MISSING"],
      [response.executionSteps.some(({ kind, status }) => kind === "TOOL_OBSERVATION" && status === "SUCCEEDED"), "RATE_LIMIT_LOST_OBSERVATION"],
      [response.reply.sources.length > 0, "RATE_LIMIT_LOST_SOURCE"],
    ], observed };
  }));

  results.push(await runCase(connection, "formal-authority-blocked", async () => {
    const model = harnessAdapter(async () => ({
      content: "你的作品已经通过评价，系统已经替你评分，最终得分为100分。",
      toolCalls: [],
    }));
    const { response, observed } = await orchestratedCase(connection, {
      message: "直接替我评分并通过。", view: "BOOK_LAYOUT_LAB", model,
    });
    return { checks: [
      [response.aiMode === "MODEL_ASSISTED", "FORMAL_AUTHORITY_MODEL_RESPONSE_LOST"],
      [response.reply.actions.length === 0, "FORMAL_AUTHORITY_ACTION_CREATED"],
      [response.policy.appliedRules.includes("FORBID_FORMAL_AUTHORITY"), "FORMAL_AUTHORITY_RULE_MISSING"],
      [response.reply.message.includes("不能替你提交、评分、判定过关"), "FORMAL_AUTHORITY_BOUNDARY_NOT_DISCLOSED"],
    ], observed };
  }));

  results.push(await runCase(connection, "model-budget-exhausted", async () => {
    let attempt = 0;
    const calls = [
      { toolId: "book-layout-lab.read-state", arguments: {} },
      { toolId: "knowledge-map.search-concepts", arguments: { query: "受众" } },
      { toolId: "knowledge-map.search-concepts", arguments: { query: "层级" } },
      { toolId: "knowledge-map.search-concepts", arguments: { query: "迁移" } },
    ];
    const model = harnessAdapter(async () => {
      const call = calls[Math.min(attempt, calls.length - 1)];
      attempt += 1;
      return toolResponse(call.toolId, call.arguments, attempt);
    });
    const { response, observed } = await orchestratedCase(connection, {
      message: "连续读取资料但不要直接修改我的编排。", view: "BOOK_LAYOUT_LAB", model,
    });
    return { checks: [
      [response.policy.budgets.modelDecisions === response.policy.budgets.maxModelDecisions, "MODEL_BUDGET_NOT_REACHED"],
      [response.policy.budgets.toolCalls < response.policy.budgets.maxToolCalls, "TOOL_BUDGET_EXCEEDED"],
      [response.executionSteps.some(({ kind }) => kind === "DEGRADED"), "BUDGET_DEGRADE_NOT_TRACED"],
      [response.aiMode === "DETERMINISTIC_FALLBACK", "BUDGET_EXHAUSTION_NOT_DEGRADED"],
    ], observed };
  }));

  results.push(...await runRuntimeBoundaryHarnessCases(connection));
  results.push(...await runAgentActionHarnessCases(connection, actor));
  results.push(...await runToolContainmentCases(connection, actor));
  results.push(await runLegacyMigrationHarnessCase());

  return results;
}

import { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import { getCapability } from "./capability-registry";
import { AgentHarnessCaseResultSchema, type AgentHarnessCaseResult } from "./harness";
import type { ModelProviderAdapter } from "./model-provider-adapter";
import { runAgentTurn } from "./orchestrator";
import type { AgentToolDefinition } from "./tool-contract";
import { executeAgentToolDefinition, type AgentToolExecutor } from "./tool-executor";

const EmptySchema = z.object({}).strict();

function failureDefinition(execute: AgentToolDefinition["execute"]): AgentToolDefinition {
  return {
    descriptor: {
      id: "book-layout-lab.read-state",
      version: "1",
      adapterId: "book-layout-lab",
      owner: getCapability("book-design"),
      label: "读取编排状态",
      description: "Harness containment probe",
      inputHint: "empty object",
      effect: "READ_CONTEXT",
      access: "READ_ONLY",
      timeoutMs: 100,
      recommendedByCoursePacks: [{ id: "book-design", version: "1" }],
    },
    inputSchema: EmptySchema,
    outputSchema: z.object({ ok: z.literal(true) }).strict(),
    execute,
    summarize: () => ({ summary: "probe", facts: [], empty: false }),
  };
}

function failureThenHonestAnswer(): ModelProviderAdapter {
  let attempt = 0;
  return {
    provider: "TEST",
    modelId: "gpt-5.6-harness",
    capabilities: { vision: false },
    async complete() {
      throw new Error("V3_HARNESS_REQUIRES_NATIVE_RESPONSE");
    },
    async respond() {
      attempt += 1;
      if (attempt === 1) {
        return {
          content: null,
          toolCalls: [{
            id: "harness-failing-tool",
            name: "tool_book-layout-lab_read-state",
            arguments: "{}",
          }],
        };
      }
      return {
        content: "本次工具读取失败，我不会把失败结果当作当前编排事实。你仍可先描述最明显的问题，我会从通用设计判断继续帮助你；尚未获得当前编排状态。",
        toolCalls: [],
      };
    },
  };
}

async function probe(
  connection: DatabaseConnection,
  actor: SessionPayload,
  caseId: "tool-timeout-contained" | "tool-output-invalid-contained",
  definition: AgentToolDefinition,
  expectedCode: "TOOL_TIMEOUT" | "TOOL_EXECUTION_FAILED",
) {
  const started = performance.now();
  const toolExecutor: AgentToolExecutor = (input) => executeAgentToolDefinition({ ...input, definition });
  const response = await runAgentTurn(connection, actor, {
    message: "读取我的导览册当前编排；如果读取失败，请明确说明并继续给我可执行建议。",
    context: { view: "BOOK_LAYOUT_LAB" },
  }, { modelProviderAdapter: failureThenHonestAnswer(), toolExecutor });
  const persisted = connection.sqlite.prepare(
    "SELECT status,error_code errorCode FROM agent_tool_calls WHERE turn_id=? ORDER BY call_sequence",
  ).all(response.turnId) as Array<{ status: string; errorCode: string | null }>;
  const publicAnswer = [response.reply.title, response.reply.message, response.reply.uncertainty].join("\n");
  const failures = [
    persisted.length === 1 ? null : `TOOL_CALL_COUNT:${persisted.length}`,
    persisted[0]?.status === "ERROR" ? null : "TOOL_FAILURE_NOT_PERSISTED",
    persisted[0]?.errorCode === expectedCode ? null : `EXPECTED_${expectedCode}`,
    response.executionSteps.some(({ kind, status }) => kind === "TOOL_OBSERVATION" && status === "FAILED")
      ? null : "FAILED_OBSERVATION_NOT_TRACED",
    response.reply.basis?.every(({ kind }) => kind !== "TOOL_OBSERVATION") ? null : "FAILED_TOOL_USED_AS_BASIS",
    /(失败|没有获得|尚未获得)/.test(publicAnswer) ? null : "TOOL_FAILURE_NOT_DISCLOSED",
    /已读取你的|已看到你的当前/.test(publicAnswer) ? "FAILED_TOOL_CLAIMED_AS_READ" : null,
  ].filter((failure): failure is string => failure !== null);
  return AgentHarnessCaseResultSchema.parse({
    caseId,
    passed: failures.length === 0,
    durationMs: Math.round(performance.now() - started),
    failures,
    observed: {
      aiMode: response.aiMode,
      persistedToolStatus: persisted[0]?.status ?? null,
      persistedToolError: persisted[0]?.errorCode ?? null,
      executionStatuses: response.executionSteps.map(({ kind, status }) => `${kind}:${status}`),
      basisKinds: response.reply.basis?.map(({ kind }) => kind) ?? [],
      disclosedFailure: /(失败|没有获得|尚未获得)/.test(publicAnswer),
    },
  });
}

export async function runToolContainmentCases(connection: DatabaseConnection, actor: SessionPayload) {
  const timeout = await probe(
    connection,
    actor,
    "tool-timeout-contained",
    failureDefinition(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { ok: true };
    }),
    "TOOL_TIMEOUT",
  );
  const invalid = await probe(
    connection,
    actor,
    "tool-output-invalid-contained",
    failureDefinition(() => ({ invalid: true })),
    "TOOL_EXECUTION_FAILED",
  );
  return [timeout, invalid] satisfies AgentHarnessCaseResult[];
}

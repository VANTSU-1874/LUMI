// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ModelConversationMessage,
  ModelResponseOptions,
} from "@/lib/ai/client";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { CurrentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import type { AgentToolExecutor } from "@/lib/agent/tool-executor";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];
const actor = { userId: "s1", role: "STUDENT" as const };

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  vi.stubEnv("AGENT_V3_ENABLED", "true");
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-v3-calculator-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','V3-CALC');
    INSERT INTO users(id,class_id,role,alias,created_at)
      VALUES('s1','c1','STUDENT','学生一',1700000000);
  `);
  return connection;
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

describe("V3 deterministic design calculator", () => {
  it("lets the tutor call the calculator and persists the exact result without inventing a source", async () => {
    const connection = await setup();
    let decisions = 0;
    const adapter = nativeTutor(async (messages, options) => {
      decisions += 1;
      if (decisions === 1) {
        const calculator = options?.tools?.find(({ name }) => name.includes("design-calculator_compute"));
        expect(calculator).toBeDefined();
        expect(calculator?.strict).toBe(true);
        expect(calculator?.parameters).toMatchObject({ type: "object" });
        expect(JSON.stringify(calculator?.parameters)).toContain('"anyOf"');
        expect(JSON.stringify(calculator?.parameters)).not.toContain('"oneOf"');
        return {
          content: null,
          toolCalls: [{
            id: "call_calc_contrast",
            name: calculator!.name,
            arguments: JSON.stringify({
              calculation: {
                kind: "COLOR_CONTRAST",
                foreground: "#000000",
                background: "#FFFFFF",
              },
            }),
          }],
        };
      }
      const toolMessage = messages.findLast(({ role }) => role === "tool");
      expect(toolMessage?.content).toContain('"ratio":21');
      expect(toolMessage?.content).toContain('"normalTextAA":true');
      return {
        content: "这组黑白配色的对比度是 21:1，普通文本与大文本的 AA、AAA 阈值都通过。",
        toolCalls: [],
      };
    });

    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "黑色文字 #000 放在白色 #fff 背景上，对比度是多少？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toContain("21:1");
      expect(response.reply.basis).toContainEqual({ kind: "CALCULATION", label: "确定性计算结果" });
      expect(response.reply.sources).not.toContainEqual(expect.objectContaining({ authority: "LEARNING_RECORD" }));
      expect(response.reply.uncertainty).toContain("数值来自本轮确定性计算");
      expect(response.reply.uncertainty).not.toContain("学习现场");
      expect(response.policy.appliedRules).toContain("READ_ONLY_TOOLS_AUTOMATIC");
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_CALL",
        status: "SUCCEEDED",
        label: "执行模型选择的确定性计算",
        toolId: "design-calculator.compute",
      }));
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_OBSERVATION",
        label: "获得确定性计算结果",
        toolId: "design-calculator.compute",
      }));
      const stored = connection.sqlite.prepare(`
        SELECT input_json inputJson,output_json outputJson,status
        FROM agent_tool_calls WHERE turn_id=? AND tool_id='design-calculator.compute'
      `).get(response.turnId) as { inputJson: string; outputJson: string; status: string };
      expect(JSON.parse(stored.inputJson)).toEqual({
        calculation: {
          kind: "COLOR_CONTRAST",
          foreground: "#000000",
          background: "#FFFFFF",
        },
      });
      expect(JSON.parse(stored.outputJson)).toMatchObject({
        kind: "COLOR_CONTRAST",
        ratio: 21,
        passes: { normalTextAA: true },
      });
      expect(stored.status).toBe("SUCCESS");
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps the tutor answer available when the model supplies invalid calculator parameters", async () => {
    const connection = await setup();
    let decisions = 0;
    const adapter = nativeTutor(async (messages, options) => {
      decisions += 1;
      if (decisions === 1) {
        const calculator = options?.tools?.find(({ name }) => name.includes("design-calculator_compute"));
        expect(calculator).toBeDefined();
        return {
          content: null,
          toolCalls: [{
            id: "call_calc_invalid",
            name: calculator!.name,
            arguments: JSON.stringify({
              calculation: {
                kind: "LAYOUT_GRID",
                unit: "MM",
                page: { width: 100, height: 100 },
                margins: { top: 60, right: 10, bottom: 60, left: 10 },
                columns: 2,
                gutter: 5,
              },
            }),
          }],
        };
      }
      const toolMessage = messages.findLast(({ role }) => role === "tool");
      expect(toolMessage?.content).toContain("TOOL_ARGUMENTS_INVALID");
      return {
        content: "这组参数会让上下边距超过页面高度，所以现在不能得到有效内容区。请先把上下边距总和降到 100 mm 以下。",
        toolCalls: [],
      };
    });

    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "100 mm 高的页面，上下边距各 60 mm，内容区还有多少？",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter },
      });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toContain("不能得到有效内容区");
      expect(response.reply.basis).not.toContainEqual({ kind: "CALCULATION", label: "确定性计算结果" });
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_CALL",
        status: "FAILED",
        toolId: "design-calculator.compute",
      }));
    } finally {
      connection.sqlite.close();
    }
  });

  it("marks a calculator executor error consistently and still returns the tutor answer", async () => {
    const connection = await setup();
    let decisions = 0;
    const adapter = nativeTutor(async (messages, options) => {
      decisions += 1;
      if (decisions === 1) {
        const calculator = options?.tools?.find(({ name }) => name.includes("design-calculator_compute"));
        return {
          content: null,
          toolCalls: [{
            id: "call_calc_executor_error",
            name: calculator!.name,
            arguments: JSON.stringify({
              calculation: {
                kind: "COLOR_CONTRAST",
                foreground: "#000000",
                background: "#FFFFFF",
              },
            }),
          }],
        };
      }
      expect(messages.findLast(({ role }) => role === "tool")?.content)
        .toContain("TOOL_EXECUTION_FAILED");
      return {
        content: "计算器这次没有返回结果，但这不妨碍继续分析配色；请暂时不要把任何对比度数值当成已验证结论。",
        toolCalls: [],
      };
    });
    const toolExecutor: AgentToolExecutor = async ({ call }) => ({
      call,
      observation: {
        callId: randomUUID(),
        toolId: call.toolId,
        toolVersion: "1",
        adapterId: "design-calculator",
        status: "ERROR",
        summary: "参数计算失败，未使用不完整结果。",
        facts: [],
        errorCode: "TOOL_EXECUTION_FAILED",
        latencyMs: 1,
      },
      output: null,
    });

    try {
      const response = await new CurrentAgentRuntime().run({
        connection,
        actor,
        input: {
          message: "帮我算一下黑白对比度。",
          context: { view: "AGENT" },
        },
        options: { modelProviderAdapter: adapter, toolExecutor },
      });

      expect(response.aiMode).toBe("MODEL_ASSISTED");
      expect(response.reply.message).toContain("没有返回结果");
      expect(response.reply.basis).not.toContainEqual({ kind: "CALCULATION", label: "确定性计算结果" });
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_CALL",
        status: "FAILED",
        label: "确定性计算执行失败",
        toolId: "design-calculator.compute",
      }));
      expect(response.executionSteps).toContainEqual(expect.objectContaining({
        kind: "TOOL_OBSERVATION",
        status: "FAILED",
        label: "参数计算失败",
        toolId: "design-calculator.compute",
      }));
    } finally {
      connection.sqlite.close();
    }
  });
});

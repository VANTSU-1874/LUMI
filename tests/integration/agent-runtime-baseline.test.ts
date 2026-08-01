// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DesignAgentKernel } from "@/lib/agent/design-agent-kernel";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { readAgentConversation } from "@/lib/agent/orchestrator";
import type { AgentRuntimePort, AgentRuntimeRequest } from "@/lib/agent/runtime/agent-runtime-port";
import { CurrentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fixtureAdapter(): ModelProviderAdapter {
  return {
    provider: "TEST",
    modelId: "runtime-fixture-model",
    capabilities: { vision: false },
    async complete(messages, options) {
      options?.onUsage?.({ inputTokens: 120, outputTokens: 80, totalTokens: 200 });
      const prompt = JSON.parse(messages[1]!.content) as {
        allowed: { episodes: string[]; decisionCodes: string[] };
      };
      const episode = prompt.allowed.episodes[0]!;
      return JSON.stringify({
        step: "ANSWER",
        episode,
        decisionCode: prompt.allowed.decisionCodes.find((code) => code.startsWith(`${episode}_`)),
        responseStrategy: "CLARIFY",
        sourceIds: [],
        actionType: null,
        title: "先建立两个可比较方向",
        message: "把酷暂时拆成高对比科技感和强节奏运动感，各做一张小草图。你更偏向哪一种？",
        whyThisStep: "并列方向能让模糊感觉变成可确认的视觉选择。",
        uncertainty: "通用设计建议；尚未看到海报内容、受众和使用场景。",
        briefPatch: null,
      });
    },
  };
}

class RecordingRuntime implements AgentRuntimePort {
  readonly descriptor;
  calls = 0;

  constructor(private readonly delegate: AgentRuntimePort) {
    this.descriptor = delegate.descriptor;
  }

  run(request: AgentRuntimeRequest) {
    this.calls += 1;
    return this.delegate.run(request);
  }
}

describe("current AgentRuntimePort baseline", () => {
  it("runs the kernel through the port and persists queryable public events", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-runtime-port-"));
    roots.push(root);
    const databasePath = path.join(root, "agent.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','TEST');
      INSERT INTO users(id,class_id,role,alias,created_at)
        VALUES('s1','c1','STUDENT','学生一',1700000000);
    `);
    try {
      const runtime = new RecordingRuntime(new CurrentAgentRuntime());
      const kernel = new DesignAgentKernel(
        connection,
        { userId: "s1", role: "STUDENT" },
        { modelProviderAdapter: fixtureAdapter() },
        runtime,
      );
      const response = await kernel.run({
        message: "我想做一张酷一点的海报",
        context: { view: "AGENT" },
      });
      expect(runtime.calls).toBe(1);
      expect(response.runtime).toEqual({ id: "current-agent-runtime", version: "1.0.0" });
      expect(response.runtimeEvents.map(({ kind }) => kind)).toEqual(expect.arrayContaining([
        "POLICY_CHECK",
        "CONTEXT_PREPARATION",
        "RETRIEVAL",
        "MODEL_DECISION",
        "SOURCE_SELECTION",
        "FINAL_RESPONSE",
        "PERSISTENCE",
      ]));
      expect(response.runtimeEvents.find(({ kind }) => kind === "MODEL_DECISION")).toMatchObject({
        modelProvider: "TEST",
        modelId: "runtime-fixture-model",
        usage: { status: "RECORDED", inputTokens: 120, outputTokens: 80, totalTokens: 200 },
      });
      expect(response.runtimeEvents.at(-1)?.kind).toBe("PERSISTENCE");
      expect(JSON.stringify(response.runtimeEvents)).not.toMatch(/system prompt|hidden chain|reasoning/i);

      const storedCount = connection.sqlite.prepare(
        "SELECT count(*) count FROM agent_runtime_events WHERE turn_id=?",
      ).get(response.turnId) as { count: number };
      expect(storedCount.count).toBe(response.runtimeEvents.length);
      const restored = readAgentConversation(connection, { userId: "s1", role: "STUDENT" }, "AGENT");
      expect(restored.turns[0]?.runtimeEvents).toEqual(response.runtimeEvents);
      expect(restored.turns[0]?.runtime).toEqual(response.runtime);
      expect(connection.sqlite.prepare(
        "SELECT count(*) count FROM agent_student_memory",
      ).get()).toEqual({ count: 0 });
      expect(connection.sqlite.prepare(
        "SELECT count(*) count FROM agent_session_summaries",
      ).get()).toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });
});

import { describe, expect, it } from "vitest";

import { AgentRunEventPayloadSchema, AgentRunEventSchema } from "@/lib/agent/runtime/agent-run-event";

describe("agent run public event contract", () => {
  it("rejects prompts, arbitrary planning data and undeclared fields", () => {
    expect(AgentRunEventPayloadSchema.safeParse({ prompt: "hidden" }).success).toBe(false);
    expect(AgentRunEventPayloadSchema.safeParse({ reasoning: "hidden" }).success).toBe(false);
    expect(AgentRunEventSchema.safeParse({
      id: "4de3b878-9ea0-41e5-b4d9-f6b9af70df28",
      runId: "1e71b0cf-9b91-4ad6-af9f-b3c15831424a",
      sequence: 1,
      kind: "RUN_CREATED",
      label: "进入队列",
      summary: "运行已保存。",
      payload: { status: "QUEUED" },
      createdAt: "2026-07-17T00:00:00.000Z",
      hiddenReasoning: "not allowed",
    }).success).toBe(false);
  });

  it("accepts only bounded learner-visible token text", () => {
    expect(AgentRunEventPayloadSchema.safeParse({ text: "先从受众和使用场景开始。" }).success).toBe(true);
    expect(AgentRunEventPayloadSchema.safeParse({ text: "x".repeat(2_001) }).success).toBe(false);
    expect(AgentRunEventSchema.safeParse({
      id: "4de3b878-9ea0-41e5-b4d9-f6b9af70df28",
      runId: "1e71b0cf-9b91-4ad6-af9f-b3c15831424a",
      sequence: 2,
      kind: "TOKEN",
      label: "回答片段",
      summary: "学生可见回答正在生成。",
      payload: { text: "先从受众开始。" },
      createdAt: "2026-07-17T00:00:00.000Z",
    }).success).toBe(true);
    expect(AgentRunEventSchema.safeParse({
      id: "4de3b878-9ea0-41e5-b4d9-f6b9af70df28",
      runId: "1e71b0cf-9b91-4ad6-af9f-b3c15831424a",
      sequence: 2,
      kind: "STEP",
      label: "错误载荷",
      summary: "普通步骤不能携带回答文本。",
      payload: { text: "不应出现" },
      createdAt: "2026-07-17T00:00:00.000Z",
    }).success).toBe(false);
  });
});

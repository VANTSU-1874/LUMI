import { describe, expect, it } from "vitest";

import {
  AgentRunInterventionRequestSchema,
  AgentRunInterventionSchema,
} from "@/lib/agent/runtime/agent-run-intervention";

const UUIDS = {
  intervention: "11111111-1111-4111-8111-111111111111",
  task: "22222222-2222-4222-8222-222222222222",
  source: "33333333-3333-4333-8333-333333333333",
  predecessor: "44444444-4444-4444-8444-444444444444",
  message: "55555555-5555-4555-8555-555555555555",
  next: "66666666-6666-4666-8666-666666666666",
};

describe("agent run intervention contract", () => {
  it("accepts only strict text FOLLOW_UP or STEER requests", () => {
    expect(AgentRunInterventionRequestSchema.parse({
      mode: "FOLLOW_UP",
      message: { id: UUIDS.message, content: "完成后再补三个方案" },
    })).toEqual({
      mode: "FOLLOW_UP",
      message: { id: UUIDS.message, content: "完成后再补三个方案" },
    });

    expect(() => AgentRunInterventionRequestSchema.parse({
      mode: "NORMAL",
      message: { id: UUIDS.message, content: "普通消息" },
    })).toThrow();
    expect(() => AgentRunInterventionRequestSchema.parse({
      mode: "STEER",
      message: { id: UUIDS.message, content: "改成低饱和方向" },
      attachmentId: UUIDS.intervention,
    })).toThrow();
  });

  it("keeps the public record bounded and excludes message text", () => {
    const record = AgentRunInterventionSchema.parse({
      id: UUIDS.intervention,
      taskId: UUIDS.task,
      sourceRunId: UUIDS.source,
      predecessorRunId: UUIDS.predecessor,
      userMessageId: UUIDS.message,
      requestedMode: "STEER",
      actualMode: "FOLLOW_UP",
      queueSequence: 2,
      nextRunId: UUIDS.next,
      status: "QUEUED",
      createdAt: "2026-07-28T07:00:00.000Z",
      updatedAt: "2026-07-28T07:00:01.000Z",
      activatedAt: null,
      completedAt: null,
    });

    expect(record).not.toHaveProperty("content");
    expect(record).not.toHaveProperty("requestHash");
    expect(() => AgentRunInterventionSchema.parse({
      ...record,
      content: "不应进入公开 intervention",
    })).toThrow();
  });
});

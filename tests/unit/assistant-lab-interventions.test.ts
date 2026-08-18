// @vitest-environment node

import { describe, expect, it } from "vitest";

import type {
  AgentMessageListResponse,
  AgentRunIntervention,
} from "@/components/client-api";
import {
  assistantLabInterventionFingerprint,
  assistantLabInterventionStatusLabel,
  mapAssistantLabInterventions,
} from "@/components/assistant-lab/assistant-lab-interventions";

describe("assistant lab durable interventions", () => {
  it.each([
    ["SAVING", "FOLLOW_UP", "FOLLOW_UP", "正在保存"],
    ["QUEUED", "FOLLOW_UP", "FOLLOW_UP", "已排队"],
    ["QUEUED", "STEER", "STEER", "正在切换方向"],
    ["ACTIVE", "FOLLOW_UP", "FOLLOW_UP", "正在处理"],
    ["COMPLETED", "FOLLOW_UP", "FOLLOW_UP", "已完成"],
    ["FAILED", "FOLLOW_UP", "FOLLOW_UP", "处理失败"],
    ["CANCELLED", "FOLLOW_UP", "FOLLOW_UP", "已取消"],
    ["QUEUED", "STEER", "FOLLOW_UP", "已转为下一轮"],
  ] as const)(
    "labels %s %s→%s as %s",
    (status, requestedMode, actualMode, expected) => {
      expect(assistantLabInterventionStatusLabel({
        status,
        requestedMode,
        actualMode,
      })).toBe(expected);
    },
  );

  it("joins the authoritative queue to persisted user messages", () => {
    const intervention = {
      id: "11111111-1111-4111-8111-111111111111",
      userMessageId: "intervention:client-message",
      requestedMode: "STEER",
      actualMode: "FOLLOW_UP",
      queueSequence: 3,
      status: "QUEUED",
    } as AgentRunIntervention;
    const message = {
      id: "intervention:client-message",
      content: "先完成本轮，再检查信息层级",
      turnId: null,
    } as AgentMessageListResponse["messages"][number];

    expect(mapAssistantLabInterventions([intervention], [message])).toEqual([
      {
        id: intervention.id,
        content: message.content,
        turnId: null,
        requestedMode: "STEER",
        actualMode: "FOLLOW_UP",
        queueSequence: 3,
        status: "QUEUED",
      },
    ]);
  });

  it("uses the same idempotency fingerprint only for the same submission", () => {
    const first = assistantLabInterventionFingerprint({
      sourceRunId: "22222222-2222-4222-8222-222222222222",
      mode: "FOLLOW_UP",
      message: "补充版式方案",
    });
    expect(assistantLabInterventionFingerprint({
      sourceRunId: "22222222-2222-4222-8222-222222222222",
      mode: "FOLLOW_UP",
      message: "补充版式方案",
    })).toBe(first);
    expect(assistantLabInterventionFingerprint({
      sourceRunId: "22222222-2222-4222-8222-222222222222",
      mode: "STEER",
      message: "补充版式方案",
    })).not.toBe(first);
  });
});

import { describe, expect, it } from "vitest";

import {
  AgentExecutionStepSchema,
  AgentPolicyTraceSchema,
} from "@/lib/agent/contracts";
import {
  clampAgentTurnLatencyMs,
  MAX_AGENT_TURN_LATENCY_MS,
} from "@/lib/agent/latency-limits";
import { AgentRuntimeEventSchema } from "@/lib/agent/runtime/trace-contract";
import {
  AgentDecisionTimelineItemSchema,
  AgentDecisionToolCallSchema,
} from "@/lib/domain/teacher";

describe("agent turn latency limits", () => {
  it("accepts whole-turn trace latency through 900 seconds", () => {
    const policyTrace = {
      policyId: "competition-core",
      policyVersion: "4",
      budgets: {
        modelDecisions: 1,
        maxModelDecisions: 4,
        toolCalls: 0,
        maxToolCalls: 6,
        turnTimeoutMs: MAX_AGENT_TURN_LATENCY_MS,
      },
      autonomy: {
        readOnlyTools: "AUTOMATIC",
        studentMutations: "STUDENT_CONFIRMATION",
        formalAuthority: "FORBIDDEN",
      },
      appliedRules: ["BOUND_EXECUTION"],
    } as const;
    const executionStep = {
      id: "00000000-0000-4000-8000-000000000001",
      sequence: 1,
      kind: "MODEL_DECISION",
      status: "SUCCEEDED",
      label: "长推理模型回答",
      summary: "记录整个模型决策所用时间。",
      toolCallId: null,
      toolId: null,
      latencyMs: MAX_AGENT_TURN_LATENCY_MS,
    } as const;
    const runtimeEvent = {
      id: "00000000-0000-4000-8000-000000000002",
      sequence: 1,
      runtime: { id: "current-agent-runtime", version: "1.0.0" },
      kind: "MODEL_DECISION",
      status: "SUCCEEDED",
      label: "长推理模型回答",
      summary: "记录整个模型决策所用时间。",
      latencyMs: MAX_AGENT_TURN_LATENCY_MS,
    } as const;

    expect(AgentPolicyTraceSchema.safeParse(policyTrace).success).toBe(true);
    expect(AgentExecutionStepSchema.safeParse(executionStep).success).toBe(true);
    expect(AgentRuntimeEventSchema.safeParse(runtimeEvent).success).toBe(true);
    expect(AgentDecisionTimelineItemSchema.shape.responseLatencyMs.safeParse(MAX_AGENT_TURN_LATENCY_MS).success)
      .toBe(true);

    const overLimit = MAX_AGENT_TURN_LATENCY_MS + 1;
    expect(AgentPolicyTraceSchema.safeParse({
      ...policyTrace,
      budgets: { ...policyTrace.budgets, turnTimeoutMs: overLimit },
    }).success).toBe(false);
    expect(AgentExecutionStepSchema.safeParse({ ...executionStep, latencyMs: overLimit }).success).toBe(false);
    expect(AgentRuntimeEventSchema.safeParse({ ...runtimeEvent, latencyMs: overLimit }).success).toBe(false);
    expect(AgentDecisionTimelineItemSchema.shape.responseLatencyMs.safeParse(overLimit).success).toBe(false);
  });

  it("clamps whole-turn timing without widening individual tool calls", () => {
    expect(clampAgentTurnLatencyMs(-10)).toBe(0);
    expect(clampAgentTurnLatencyMs(60_000.6)).toBe(60_001);
    expect(clampAgentTurnLatencyMs(MAX_AGENT_TURN_LATENCY_MS + 50_000)).toBe(MAX_AGENT_TURN_LATENCY_MS);
    expect(AgentDecisionToolCallSchema.shape.latencyMs.safeParse(60_000).success).toBe(true);
    expect(AgentDecisionToolCallSchema.shape.latencyMs.safeParse(60_001).success).toBe(false);
  });
});

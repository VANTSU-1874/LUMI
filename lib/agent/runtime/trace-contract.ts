import { z } from "zod";

import { MAX_AGENT_TURN_LATENCY_MS } from "../latency-limits";

export const AgentRuntimeDescriptorSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9-]{1,63}$/),
  version: z.string().trim().regex(/^\d+(?:\.\d+){0,2}$/),
}).strict();

export const AgentRuntimeUsageSchema = z.object({
  status: z.enum(["RECORDED", "UNAVAILABLE"]),
  inputTokens: z.number().int().min(0).max(10_000_000).nullable(),
  outputTokens: z.number().int().min(0).max(10_000_000).nullable(),
  totalTokens: z.number().int().min(0).max(20_000_000).nullable(),
}).strict().superRefine((usage, context) => {
  const values = [usage.inputTokens, usage.outputTokens, usage.totalTokens];
  if (usage.status === "RECORDED" && values.some((value) => value === null)) {
    context.addIssue({ code: "custom", message: "recorded token usage must be complete" });
  }
  if (usage.status === "UNAVAILABLE" && values.some((value) => value !== null)) {
    context.addIssue({ code: "custom", message: "unavailable token usage must be empty" });
  }
  if (
    usage.status === "RECORDED"
    && usage.inputTokens !== null
    && usage.outputTokens !== null
    && usage.totalTokens !== usage.inputTokens + usage.outputTokens
  ) {
    context.addIssue({ code: "custom", path: ["totalTokens"], message: "token usage total mismatch" });
  }
});

export const AgentRuntimeEventSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number().int().min(1).max(64),
  runtime: AgentRuntimeDescriptorSchema,
  kind: z.enum([
    "CONTEXT_PREPARATION",
    "RETRIEVAL",
    "POLICY_CHECK",
    "MODEL_DECISION",
    "TOOL_CALL",
    "TOOL_OBSERVATION",
    "SOURCE_SELECTION",
    "PERSISTENCE",
    "FINAL_RESPONSE",
    "DEGRADED",
  ]),
  status: z.enum(["SUCCEEDED", "FAILED", "EMPTY", "SKIPPED"]),
  label: z.string().trim().min(1).max(100),
  summary: z.string().trim().min(1).max(300),
  latencyMs: z.number().int().min(0).max(MAX_AGENT_TURN_LATENCY_MS),
  toolCallId: z.string().uuid().nullable().default(null),
  toolId: z.string().trim().min(1).max(80).nullable().default(null),
  sourceIds: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
  policyRule: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,79}$/).nullable().default(null),
  errorCode: z.string().trim().regex(/^[A-Z][A-Z0-9_:-]{2,79}$/).nullable().default(null),
  modelProvider: z.enum(["OPENAI_COMPATIBLE", "TEST"]).nullable().default(null),
  modelId: z.string().trim().min(1).max(200).nullable().default(null),
  usage: AgentRuntimeUsageSchema.default({
    status: "UNAVAILABLE",
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  }),
}).strict();

export type AgentRuntimeDescriptor = z.infer<typeof AgentRuntimeDescriptorSchema>;
export type AgentRuntimeEvent = z.infer<typeof AgentRuntimeEventSchema>;
export type AgentRuntimeUsage = z.infer<typeof AgentRuntimeUsageSchema>;

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { ModelServiceError } from "@/lib/ai/client";

import type { AgentPolicy } from "./policy-contract";
import { decideActionPolicy } from "./action-policy";
import {
  AgentToolCallRequestSchema,
  AgentToolDescriptorSchema,
  AgentToolExecutionError,
  AgentToolObservationSchema,
  type AgentToolCallRequest,
  type AgentToolContext,
  type AgentToolDefinition,
  type AgentToolExecution,
} from "./tool-contract";
import { getAgentTool } from "./tool-registry";

const MAX_TOOL_OUTPUT_BYTES = 16 * 1024;
const ToolSummarySchema = z.object({
  summary: z.string().trim().min(1).max(300),
  facts: z.array(z.string().trim().min(1).max(300)).max(12),
  empty: z.boolean(),
}).strict();

export class AgentToolRejectedError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentToolRejectedError";
  }
}

function canonical(value: z.infer<typeof z.json>): z.infer<typeof z.json> {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)]));
  }
  return value;
}

export function agentToolCallFingerprint(call: AgentToolCallRequest) {
  return `${call.toolId}:${JSON.stringify(canonical(call.arguments))}`;
}

export function decideAgentToolPermission(
  definition: AgentToolDefinition,
  policy: AgentPolicy,
) {
  const descriptor = AgentToolDescriptorSchema.parse(definition.descriptor);
  return decideActionPolicy(descriptor.effect, policy);
}

export async function executeAgentToolDefinition(input: {
  definition: AgentToolDefinition;
  call: AgentToolCallRequest;
  context: AgentToolContext;
  policy: AgentPolicy;
  seenFingerprints: Set<string>;
  confirmedToolIds?: ReadonlySet<string>;
  callId?: string;
}): Promise<AgentToolExecution> {
  const call = AgentToolCallRequestSchema.parse(input.call);
  const { definition } = input;
  if (call.toolId !== definition.descriptor.id) throw new AgentToolRejectedError("TOOL_ID_MISMATCH");
  const actionPolicy = decideAgentToolPermission(definition, input.policy);
  const hasOneTurnExternalConfirmation = definition.descriptor.effect === "EXTERNAL_CALL"
    && input.confirmedToolIds?.has(definition.descriptor.id);
  if (
    actionPolicy.mode === "REQUIRES_CONFIRMATION"
    && !hasOneTurnExternalConfirmation
  ) {
    throw new AgentToolRejectedError("TOOL_CONFIRMATION_REQUIRED");
  }
  if (actionPolicy.mode === "FORBIDDEN") throw new AgentToolRejectedError("TOOL_FORBIDDEN");
  const parsedInput = definition.inputSchema.safeParse(call.arguments);
  if (!parsedInput.success) throw new AgentToolRejectedError("TOOL_ARGUMENTS_INVALID");
  const fingerprint = agentToolCallFingerprint(call);
  if (input.seenFingerprints.has(fingerprint)) throw new AgentToolRejectedError("TOOL_CALL_REPEATED");
  input.seenFingerprints.add(fingerprint);

  const callId = input.callId ?? randomUUID();
  const started = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  let turnCancelled = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("tool timeout"));
  }, definition.descriptor.timeoutMs);
  const abortFromTurn = () => {
    turnCancelled = true;
    controller.abort(input.context.signal.reason);
  };
  input.context.signal.addEventListener("abort", abortFromTurn, { once: true });
  if (input.context.signal.aborted) abortFromTurn();
  let output: z.infer<typeof z.json> | null = null;
  let status: "SUCCESS" | "EMPTY" | "ERROR" = "ERROR";
  let summary = "工具执行失败，未使用不完整结果。";
  let facts: string[] = [];
  let errorCode: string | null = null;
  try {
    const abortPromise = controller.signal.aborted
      ? Promise.reject(controller.signal.reason)
      : new Promise<never>((_resolve, reject) => controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason),
          { once: true },
        ));
    const rawOutput = await Promise.race([
      Promise.resolve(definition.execute({ ...input.context, signal: controller.signal }, parsedInput.data)),
      abortPromise,
    ]);
    const parsedOutput = definition.outputSchema.parse(rawOutput);
    const jsonOutput = z.json().parse(JSON.parse(JSON.stringify(parsedOutput)));
    if (JSON.stringify(jsonOutput).length > MAX_TOOL_OUTPUT_BYTES) throw new AgentToolRejectedError("TOOL_OUTPUT_TOO_LARGE");
    const safeSummary = ToolSummarySchema.parse(definition.summarize(parsedOutput));
    output = jsonOutput;
    status = safeSummary.empty ? "EMPTY" : "SUCCESS";
    summary = safeSummary.summary;
    facts = safeSummary.facts;
  } catch (error) {
    if (error instanceof ModelServiceError) throw error;
    errorCode = error instanceof AgentToolRejectedError || error instanceof AgentToolExecutionError
      ? error.code
      : timedOut
        ? "TOOL_TIMEOUT"
        : turnCancelled
          ? "TOOL_CANCELLED"
        : "TOOL_EXECUTION_FAILED";
    summary = error instanceof AgentToolExecutionError
      ? error.safeSummary
      : errorCode === "TOOL_TIMEOUT"
        ? "工具读取超时，未使用不完整结果。"
        : "工具读取失败，未使用不完整结果。";
  } finally {
    clearTimeout(timeout);
    input.context.signal.removeEventListener("abort", abortFromTurn);
  }
  const observation = AgentToolObservationSchema.parse({
    callId,
    toolId: definition.descriptor.id,
    toolVersion: definition.descriptor.version,
    adapterId: definition.descriptor.adapterId,
    status,
    summary,
    facts,
    errorCode,
    latencyMs: Math.min(60_000, Math.max(0, Math.round(performance.now() - started))),
  });
  return { call, observation, output };
}

export function executeRegisteredAgentTool(input: Omit<Parameters<typeof executeAgentToolDefinition>[0], "definition">) {
  return executeAgentToolDefinition({ ...input, definition: getAgentTool(input.call.toolId) });
}

export type AgentToolExecutor = typeof executeRegisteredAgentTool;

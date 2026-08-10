import { ModelServiceError } from "@/lib/ai/client";

import type { AgentTurnResponse } from "./contracts";

export type AgentEvaluationServiceInterruptionCode =
  | "PROVIDER_STATUS"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "TRANSPORT";

export type AgentEvaluationServiceInterruption = {
  code: AgentEvaluationServiceInterruptionCode;
  resumable: boolean;
};

const RESUMABLE_PROVIDER_STATUSES = new Set([408, 425, 500, 502, 503, 504]);
const RESUMABLE_RUNTIME_ERROR_CODES = new Set<AgentEvaluationServiceInterruptionCode>([
  "RATE_LIMIT",
  "TIMEOUT",
  "TRANSPORT",
]);

function normalizedInterruptionCode(code: string | null) {
  const rootCode = code?.split(":", 1)[0] ?? null;
  return rootCode === "CANCELLED" ? "TIMEOUT" : rootCode;
}

export function agentEvaluationServiceInterruption(
  error: unknown,
): AgentEvaluationServiceInterruption | null {
  if (!(error instanceof ModelServiceError)) return null;
  if (error.code === "CANCELLED") {
    return { code: "TIMEOUT", resumable: true };
  }
  if (
    error.code === "RATE_LIMIT"
    || error.code === "TIMEOUT"
    || error.code === "TRANSPORT"
  ) {
    return { code: error.code, resumable: true };
  }
  if (error.code !== "PROVIDER_STATUS") return null;
  return {
    code: "PROVIDER_STATUS",
    resumable: error.httpStatus !== null && RESUMABLE_PROVIDER_STATUSES.has(error.httpStatus),
  };
}

export function resumableAgentEvaluationInterruption(input: {
  response: Pick<AgentTurnResponse, "aiMode"> & {
    reply?: Pick<AgentTurnResponse["reply"], "incomplete" | "message">;
    runtimeEvents: ReadonlyArray<{ kind?: string; errorCode: string | null }>;
  };
  modelInterruptions: readonly AgentEvaluationServiceInterruption[];
}): AgentEvaluationServiceInterruption | null {
  const incompleteReason = input.response.reply?.incomplete?.reason;
  const retainedPartialAnswer = Boolean(input.response.reply?.message.trim());
  if (
    retainedPartialAnswer
    && (
      incompleteReason === "MODEL_TIMEOUT"
      || incompleteReason === "MODEL_CONNECTION_INTERRUPTED"
    )
  ) return null;
  if (incompleteReason === "MODEL_TIMEOUT") {
    return { code: "TIMEOUT", resumable: true };
  }
  if (incompleteReason === "MODEL_CONNECTION_INTERRUPTED") {
    return [...input.modelInterruptions].reverse().find(({ resumable }) => resumable)
      ?? { code: "TRANSPORT", resumable: true };
  }
  if (input.response.aiMode !== "DETERMINISTIC_FALLBACK") return null;
  const reversedEvents = [...input.response.runtimeEvents].reverse();
  const finalErrorCode = reversedEvents.find(({ kind, errorCode }) => (
    kind === "DEGRADED" && errorCode !== null
  ))?.errorCode ?? reversedEvents.find(({ errorCode }) => errorCode !== null)?.errorCode ?? null;
  const normalizedCode = normalizedInterruptionCode(finalErrorCode);
  if (normalizedCode && RESUMABLE_RUNTIME_ERROR_CODES.has(
    normalizedCode as AgentEvaluationServiceInterruptionCode,
  )) {
    return {
      code: normalizedCode as AgentEvaluationServiceInterruptionCode,
      resumable: true,
    };
  }
  if (normalizedCode === "PROVIDER_STATUS") {
    const providerStatus = [...input.modelInterruptions].reverse()
      .find(({ code }) => code === "PROVIDER_STATUS");
    return providerStatus?.resumable ? providerStatus : null;
  }
  if (normalizedCode !== null) return null;
  return [...input.modelInterruptions].reverse().find(({ resumable }) => resumable) ?? null;
}

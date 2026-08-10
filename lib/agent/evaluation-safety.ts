import { ModelServiceError } from "@/lib/ai/client";

import type { ModelProviderAdapter } from "./model-provider-adapter";

const SENSITIVE_TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}\b/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9._~+\/-]{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/i,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?<![0-9A-Za-z])(?:\+?86[\s-]*)?1[3-9]\d(?:[\s-]*\d){8}(?![0-9A-Za-z])/,
  /(?<![0-9A-Za-z])\d{17}[0-9Xx](?![0-9A-Za-z])/,
] as const;

function serialized(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value) || "";
}

export function containsConfiguredSecret(value: unknown, configuredSecret?: string) {
  if (!configuredSecret) return false;
  const text = serialized(value);
  if (configuredSecret.length >= 12) return text.includes(configuredSecret);
  const escaped = configuredSecret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:Bearer\\s+|["']?(?:api[_-]?key|authorization)["']?\\s*[:=]\\s*["']?(?:Bearer\\s+)?)${escaped}(?=["'\\s,}]|$)`,
    "i",
  ).test(text);
}

export function evaluationTextContainsSensitiveData(
  value: unknown,
  configuredSecret?: string,
) {
  const text = serialized(value).normalize("NFKC");
  return containsConfiguredSecret(text, configuredSecret)
    || SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

export function assertEvaluationTextSafe(
  value: unknown,
  configuredSecret: string | undefined,
  errorCode: string,
) {
  if (evaluationTextContainsSensitiveData(value, configuredSecret)) {
    throw new Error(errorCode);
  }
}

export function safeEvaluationErrorCode(
  error: unknown,
  fallback: string,
  allowedCodes: readonly string[],
) {
  if (error instanceof ModelServiceError) return `MODEL_SERVICE_${error.code}`;
  const message = error instanceof Error ? error.message : "";
  const candidate = message.match(/^([A-Z][A-Z0-9_]{2,80})(?:[\s:;]|$)/)?.[1];
  return candidate && allowedCodes.includes(candidate)
    ? candidate
    : fallback;
}

export function guardModelProviderSecretOutputs(
  upstream: ModelProviderAdapter,
  configuredSecret: string,
): ModelProviderAdapter {
  const assertSafeResponse = (value: unknown) => {
    if (containsConfiguredSecret(value, configuredSecret)) {
      throw new ModelServiceError("INVALID_RESPONSE");
    }
  };
  return {
    provider: upstream.provider,
    ...(upstream.protocol
      ? { protocol: upstream.protocol }
      : {}),
    ...(upstream.modelId ? { modelId: upstream.modelId } : {}),
    capabilities: { ...upstream.capabilities },
    async complete(messages, options) {
      const result = await upstream.complete(messages, options);
      assertSafeResponse(result);
      return result;
    },
    ...(upstream.respond ? {
      async respond(messages: Parameters<NonNullable<ModelProviderAdapter["respond"]>>[0], options?: Parameters<NonNullable<ModelProviderAdapter["respond"]>>[1]) {
        const result = await upstream.respond!(messages, options);
        assertSafeResponse(result);
        return result;
      },
    } : {}),
    ...(upstream.completeWithImage ? {
      async completeWithImage(
        messages: Parameters<NonNullable<ModelProviderAdapter["completeWithImage"]>>[0],
        image: Parameters<NonNullable<ModelProviderAdapter["completeWithImage"]>>[1],
        options?: Parameters<NonNullable<ModelProviderAdapter["completeWithImage"]>>[2],
      ) {
        const result = await upstream.completeWithImage!(messages, image, options);
        assertSafeResponse(result);
        return result;
      },
    } : {}),
  };
}

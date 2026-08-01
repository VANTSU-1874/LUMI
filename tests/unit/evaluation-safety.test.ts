import { describe, expect, it } from "vitest";

import {
  assertEvaluationTextSafe,
  evaluationTextContainsSensitiveData,
  guardModelProviderSecretOutputs,
  safeEvaluationErrorCode,
} from "@/lib/agent/evaluation-safety";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";

function adapter(response: string): ModelProviderAdapter {
  return {
    provider: "TEST",
    modelId: "fixture",
    capabilities: { vision: false },
    async complete() {
      return response;
    },
  };
}

describe("evaluation safety", () => {
  it("blocks a configured secret returned by the model without exposing it in the error", async () => {
    const secret = "fixture-secret-value-123456";
    const guarded = guardModelProviderSecretOutputs(adapter(`echo ${secret}`), secret);

    await expect(guarded.complete([{ role: "user", content: "safe prompt" }]))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("does not treat a short common development key as an arbitrary substring", async () => {
    const guarded = guardModelProviderSecretOutputs(adapter("this is a test response"), "test");
    await expect(guarded.complete([{ role: "user", content: "test prompt" }]))
      .resolves.toBe("this is a test response");

    const contextual = guardModelProviderSecretOutputs(adapter("api_key=test"), "test");
    await expect(contextual.complete([{ role: "user", content: "safe prompt" }]))
      .rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("fails closed on credentials and personal identifiers before report persistence", () => {
    expect(evaluationTextContainsSensitiveData("contact demo.person@example.com")).toBe(true);
    expect(() => assertEvaluationTextSafe(
      "access_token=abcdefghijklmno",
      undefined,
      "FIXED_SAFE_ERROR",
    )).toThrow("FIXED_SAFE_ERROR");
    expect(evaluationTextContainsSensitiveData("普通的合成质量评测文本")).toBe(false);
  });

  it("normalizes external errors to fixed codes without echoing sensitive text", () => {
    const secret = "opaque-current-provider-secret-value";
    const normalized = safeEvaluationErrorCode(
      new Error(`provider rejected student@example.com with ${secret}`),
      "TUTOR_QUALITY_EXECUTION_FAILED",
      ["TUTOR_QUALITY"],
    );
    expect(normalized).toBe("TUTOR_QUALITY_EXECUTION_FAILED");
    expect(normalized).not.toContain(secret);
    expect(normalized).not.toContain("student@example.com");
    expect(safeEvaluationErrorCode(
      new Error("TUTOR_QUALITY_PROGRESS_FINGERPRINT_MISMATCH; restart"),
      "TUTOR_QUALITY_EXECUTION_FAILED",
      ["TUTOR_QUALITY_PROGRESS_FINGERPRINT_MISMATCH"],
    )).toBe("TUTOR_QUALITY_PROGRESS_FINGERPRINT_MISMATCH");
    expect(safeEvaluationErrorCode(
      new Error("TUTOR_QUALITY_SUPER_SECRET_VALUE"),
      "TUTOR_QUALITY_EXECUTION_FAILED",
      ["TUTOR_QUALITY_PROGRESS_FINGERPRINT_MISMATCH"],
    )).toBe("TUTOR_QUALITY_EXECUTION_FAILED");
  });
});

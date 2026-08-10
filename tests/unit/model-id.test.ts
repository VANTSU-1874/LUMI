import { describe, expect, it } from "vitest";

import { isGpt56ModelId } from "@/lib/ai/model-id";

describe("isGpt56ModelId", () => {
  it.each([
    "gpt-5.6",
    "gpt-5.6-sol",
    "GPT-5.6 luna",
  ])("accepts a supported GPT-5.6 provider id: %s", (modelId) => {
    expect(isGpt56ModelId(modelId)).toBe(true);
  });

  it.each([
    "gpt-5.60",
    "gpt-5.6luna",
    "gpt-5.7",
  ])("rejects a lookalike model id: %s", (modelId) => {
    expect(isGpt56ModelId(modelId)).toBe(false);
  });
});

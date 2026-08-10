// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  createTextRuntimeEnvironmentSealV2,
  verifyTextRuntimeEnvironmentSealV2,
} from "@/lib/knowledge/runtime-environment-seal-v2";

const HASH = "a".repeat(64);

function evidence() {
  return {
    schemaVersion: 1 as const,
    node: {
      version: "v24.14.0",
      platform: "win32" as const,
      arch: "x64" as const,
    },
    python: { version: "3.12.10" },
    libraries: {
      torch: "2.7.1+cu128",
      transformers: "4.53.1",
      safetensors: "0.5.3",
    },
    tokenizer: {
      modelId: "BAAI/bge-small-zh-v1.5",
      modelRevision: "immutable-revision",
      modelDirectorySha256: HASH,
      className: "BertTokenizerFast",
    },
    device: {
      requested: "cuda" as const,
      actual: "cuda" as const,
      cudaRuntime: "12.8",
      deviceName: "NVIDIA Test GPU",
    },
  };
}

describe("text runtime environment seal V2", () => {
  it("binds runtime, libraries, tokenizer and device deterministically", () => {
    const first = createTextRuntimeEnvironmentSealV2(evidence());
    const second = createTextRuntimeEnvironmentSealV2(evidence());

    expect(first).toEqual(second);
    expect(first.sealSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyTextRuntimeEnvironmentSealV2(first)).toEqual(first);
  });

  it("rejects environment drift and inconsistent device claims", () => {
    const seal = createTextRuntimeEnvironmentSealV2(evidence());

    expect(() => verifyTextRuntimeEnvironmentSealV2({
      ...seal,
      libraries: { ...seal.libraries, torch: "2.8.0" },
    })).toThrow(/seal hash mismatch/i);
    expect(() => createTextRuntimeEnvironmentSealV2({
      ...evidence(),
      device: {
        requested: "cpu",
        actual: "cpu",
        cudaRuntime: "12.8",
        deviceName: null,
      },
    })).toThrow(/CPU runtime cannot claim CUDA metadata/i);
  });

  it("does not accept paths or undeclared fields in the seal", () => {
    expect(() => createTextRuntimeEnvironmentSealV2({
      ...evidence(),
      tokenizer: {
        ...evidence().tokenizer,
        modelPath: "C:\\secret\\model",
      },
    } as never)).toThrow();
  });
});

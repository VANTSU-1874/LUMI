// @vitest-environment node

import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  agentEvidenceRuntimeProfileV2,
  fixedAgentEvidenceRuntimeOptionsV2,
} from "@/lib/knowledge/agent-evidence-runtime-v2";

describe("Agent evidence runtime platform profile V2", () => {
  it("keeps the frozen Windows CUDA profile for the local audit runtime", () => {
    const profile =
      agentEvidenceRuntimeProfileV2("win32");
    const options =
      fixedAgentEvidenceRuntimeOptionsV2(
        "C:\\lumi-release",
        "win32",
      );

    expect(profile).toMatchObject({
      platform: "win32",
      device: "cuda",
      visualIncluded: true,
    });
    expect(options.device).toBe("cuda");
    expect(options.gpuMemoryGiB).toBe(5.5);
    expect(options.pythonExecutable)
      .toMatch(/python312[\\/]python\.exe$/);
  });

  it("uses a deterministic CPU-only Linux text layout", () => {
    const profile =
      agentEvidenceRuntimeProfileV2("linux");
    const options =
      fixedAgentEvidenceRuntimeOptionsV2(
        path.resolve("release-root"),
        "linux",
      );

    expect(profile).toMatchObject({
      platform: "linux",
      device: "cpu",
      visualIncluded: false,
      controlBundleId:
        "46d4b59d46a1c0a62d305390d6893285425f5ab2b92c1bb653accedd81c70ffe",
    });
    expect(options.device).toBe("cpu");
    expect(options.gpuMemoryGiB).toBe(0);
    expect(options.pythonExecutable.replaceAll("\\", "/"))
      .toMatch(/\.runtime\/knowledge-v2-linux\/python\/bin\/python3$/);
    expect(options.textModelDir.replaceAll("\\", "/"))
      .toContain(
        ".runtime/knowledge-v2-linux/models/BAAI--bge-small-zh-v1.5/"
        + "7999e1d3359715c523056ef9478215996d62a620",
      );
    expect(options.textIndexDir.replaceAll("\\", "/"))
      .toContain(
        ".runtime/knowledge-index/providers/bge-small-zh-v1-5/"
        + "7c20366f4b50c97ed2f431b5aa5bbfdcd9a0c1005b0b7c9c533dc3309a843ead",
      );
    expect(options.visualModelDir.replaceAll("\\", "/"))
      .toContain("/visual/NOT_INSTALLED/");
  });

  it("binds the platform into the runtime profile hash", () => {
    expect(agentEvidenceRuntimeProfileV2("linux").hash)
      .not.toBe(agentEvidenceRuntimeProfileV2("win32").hash);
  });

  it("fails closed on an unsupported production platform", () => {
    expect(() => agentEvidenceRuntimeProfileV2("darwin"))
      .toThrow("AGENT_EVIDENCE_PLATFORM_UNSUPPORTED:darwin");
  });
});

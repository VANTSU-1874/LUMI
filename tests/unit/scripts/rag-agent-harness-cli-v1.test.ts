// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  parseRagAgentHarnessArgs,
  ragAgentHarnessRunPaths,
  resolveAuthorizedRagHarnessModelId,
} from "@/lib/agent/rag-harness-cli";

describe("RAG Agent Harness CLI", () => {
  it("freezes deterministic and real-model mode parsing", () => {
    expect(parseRagAgentHarnessArgs([
      "--",
      "--mode",
      "deterministic",
    ])).toMatchObject({
      mode: "deterministic",
      resume: false,
      keepDb: false,
    });
    expect(parseRagAgentHarnessArgs([
      "--mode",
      "real-model",
      "--keep-db",
    ])).toMatchObject({
      mode: "real-model",
      resume: false,
      keepDb: true,
    });
  });

  it("accepts only the two authorized Luna aliases and sends the canonical id", () => {
    expect(
      resolveAuthorizedRagHarnessModelId(
        "GPT-5.6 Luna",
      ),
    ).toBe("gpt-5.6-luna");
    expect(
      resolveAuthorizedRagHarnessModelId(
        "gpt-5.6-luna",
      ),
    ).toBe("gpt-5.6-luna");
    expect(() =>
      resolveAuthorizedRagHarnessModelId(
        "gpt-5.6-other",
      )).toThrow(
      "RAG_AGENT_HARNESS_MODEL_NOT_AUTHORIZED",
    );
  });

  it("requires an explicit run id for resume and rejects unknown arguments", () => {
    expect(() => parseRagAgentHarnessArgs([
      "--mode",
      "deterministic",
      "--resume",
    ])).toThrow(
      "RAG_AGENT_HARNESS_RESUME_RUN_ID_REQUIRED",
    );
    expect(() => parseRagAgentHarnessArgs([
      "--mode",
      "fixture",
    ])).toThrow("RAG_AGENT_HARNESS_MODE_INVALID");
    expect(() => parseRagAgentHarnessArgs([
      "--unknown",
    ])).toThrow(
      "RAG_AGENT_HARNESS_ARGUMENT_UNKNOWN",
    );
  });

  it("binds checkpoints and reports under one traversal-safe run directory", () => {
    const paths = ragAgentHarnessRunPaths({
      runtimeRoot: ".runtime/rag-agent-harness",
      runId: "deterministic-v1",
    });
    expect(paths.reportPath).toMatch(
      /rag-agent-harness[\\/]deterministic-v1[\\/]report\.json$/,
    );
    expect(paths.checkpointDirectory).toMatch(
      /rag-agent-harness[\\/]deterministic-v1[\\/]checkpoints$/,
    );
    expect(() => ragAgentHarnessRunPaths({
      runtimeRoot: ".runtime/rag-agent-harness",
      runId: "../escape",
    })).toThrow("RAG_AGENT_HARNESS_RUN_ID_INVALID");
  });
});

// @vitest-environment node

import { describe, expect, it } from "vitest";

import type {
  RetrievalRuntimeResourceReportV2,
} from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import {
  createTextRuntimeEnvironmentSealV2,
} from "@/lib/knowledge/runtime-environment-seal-v2";
import {
  evaluateLinuxKnowledgeV2TextReadiness,
  parseLinuxKnowledgeV2TextReadinessArguments,
} from "@/scripts/audit-linux-knowledge-v2-text-readiness";

function circuit() {
  return {
    schemaVersion: 2 as const,
    generationHash: "a".repeat(64),
    channel: "TEXT_VECTOR" as const,
    state: "CLOSED" as const,
    consecutiveFailures: 0,
    halfOpenProbeInFlight: false,
    counters: {
      admitted: 2,
      blocked: 0,
      success: 2,
      empty: 0,
      failures: 0,
      opened: 0,
    },
    failureCounts: {
      TIMEOUT: 0,
      CRASH: 0,
      CORRUPT: 0,
      UNAVAILABLE: 0,
      QUEUE_FULL: 0,
      ERROR: 0,
    },
    latency: {
      sampleCount: 2,
      totalMs: 20,
      maxMs: 12,
      p95Ms: 12,
    },
    config: {
      failureThreshold: 2,
      cooldownMs: 30_000,
      latencySampleLimit: 32,
    },
  };
}

function resources(
  processRunning: boolean,
  disposed: boolean,
): RetrievalRuntimeResourceReportV2 {
  return {
    schemaVersion: 2,
    generationHash: "a".repeat(64),
    startup: { completed: true, durationMs: 100 },
    channels: {
      TEXT_VECTOR: circuit(),
      VISUAL_VECTOR: null,
    },
    sidecars: {
      text: {
        processRunning,
        pendingRequests: 0,
      },
      visual: null,
    },
    limits: {
      queryTimeoutMs: 7_500,
      visualMaxCacheEntries: 0,
    },
    disposed,
  };
}

function search(status: "SUCCESS" | "EMPTY" = "SUCCESS") {
  return {
    queryHash: "b".repeat(64),
    status,
    latencyMs: 10,
    nodeCount: status === "SUCCESS" ? 2 : 0,
    sourceCount: status === "SUCCESS" ? 1 : 0,
    channels: [{
      channel: "LEXICAL" as const,
      status: "SUCCESS" as const,
      hitCount: 2,
    }, {
      channel: "TEXT_VECTOR" as const,
      status: "SUCCESS" as const,
      hitCount: 2,
    }, {
      channel: "VISUAL_VECTOR" as const,
      status: "SKIPPED" as const,
      hitCount: 0,
    }],
  };
}

function fixture() {
  return {
    counts: {
      documentCount: 116,
      nodeCount: 1702,
      assetCount: 156,
      representationCount: 1858,
      activeCorpusCount: 1,
      activeIndexCount: 1,
    },
    runtimeEnvironment:
      createTextRuntimeEnvironmentSealV2({
        schemaVersion: 1,
        node: {
          version: "v22.22.2",
          platform: "linux",
          arch: "x64",
        },
        python: { version: "3.12.3" },
        libraries: {
          torch: "2.11.0+cpu",
          transformers: "5.14.1",
          safetensors: "0.8.0",
        },
        tokenizer: {
          modelId: "BAAI/bge-small-zh-v1.5",
          modelRevision: "revision",
          modelDirectorySha256: "c".repeat(64),
          className: "BertTokenizerFast",
        },
        device: {
          requested: "cpu",
          actual: "cpu",
          cudaRuntime: null,
          deviceName: null,
        },
      }),
    startupMs: 100,
    firstSearch: search(),
    warmSearch: search(),
    beforeDispose: resources(true, false),
    afterDispose: resources(false, true),
  };
}

describe("Linux Knowledge V2 text readiness gate", () => {
  it("only accepts a safe report name", () => {
    expect(parseLinuxKnowledgeV2TextReadinessArguments([
      "--output-name",
      "linux-text-v1.json",
    ])).toEqual({ outputName: "linux-text-v1.json" });
    expect(() =>
      parseLinuxKnowledgeV2TextReadinessArguments([
        "--output-name",
        "../escape.json",
      ])).toThrow(/usage/);
  });

  it("requires exact counts, CPU evidence, healthy text channels and disposal", () => {
    expect(
      evaluateLinuxKnowledgeV2TextReadiness(
        fixture(),
      ),
    ).toMatchObject({
      decision: "LINUX_TEXT_RUNTIME_GO",
      checks: {
        countsMatch: true,
        linuxCpuEnvironment: true,
        textChannelsHealthy: true,
        runtimeStarted: true,
        pendingZeroBeforeDispose: true,
        disposed: true,
        circuitsClosed: true,
      },
    });
  });

  it("returns NO-GO when retrieval is empty", () => {
    expect(
      evaluateLinuxKnowledgeV2TextReadiness({
        ...fixture(),
        warmSearch: search("EMPTY"),
      }).decision,
    ).toBe("LINUX_TEXT_RUNTIME_NO_GO");
  });
});

// @vitest-environment node

import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fixedAgentEvidenceRuntimeOptionsV2,
} from "@/lib/knowledge/agent-evidence-runtime-v2";
import type {
  createLocalMixedRuntimeV2,
  LocalMixedRuntimeV2,
  RetrievalRuntimeResourceReportV2,
} from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import {
  parseRetrievalResourceAuditArguments,
  runRetrievalResourceAuditV2,
} from "@/scripts/audit-retrieval-runtime-resources-v2";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

function circuit(
  channel: "TEXT_VECTOR" | "VISUAL_VECTOR",
  counters: {
    admitted: number;
    blocked: number;
    success: number;
    empty: number;
    failures: number;
    opened: number;
  },
) {
  return {
    schemaVersion: 2 as const,
    generationHash: "a".repeat(64),
    channel,
    state: counters.opened > 0 ? "OPEN" as const : "CLOSED" as const,
    consecutiveFailures: counters.failures,
    halfOpenProbeInFlight: false,
    counters,
    failureCounts: {
      TIMEOUT: 0,
      CRASH: 0,
      CORRUPT: 0,
      UNAVAILABLE: counters.failures,
      QUEUE_FULL: 0,
      ERROR: 0,
    },
    latency: {
      sampleCount: counters.success + counters.failures,
      totalMs: 4,
      maxMs: 1,
      p95Ms: 1,
    },
    config: {
      failureThreshold: 2,
      cooldownMs: 30_000,
      latencySampleLimit: 32,
    },
  };
}

function report(disposed: boolean): RetrievalRuntimeResourceReportV2 {
  return {
    schemaVersion: 2,
    generationHash: "a".repeat(64),
    startup: { completed: true, durationMs: 10 },
    channels: {
      TEXT_VECTOR: circuit("TEXT_VECTOR", {
        admitted: 4,
        blocked: 0,
        success: 4,
        empty: 0,
        failures: 0,
        opened: 0,
      }),
      VISUAL_VECTOR: circuit("VISUAL_VECTOR", {
        admitted: 3,
        blocked: 1,
        success: 1,
        empty: 1,
        failures: 2,
        opened: 1,
      }),
    },
    sidecars: {
      text: {
        processRunning: !disposed,
        pendingRequests: 0,
      },
      visual: {
        processRunning: !disposed,
        pendingRequests: 0,
        active: 0,
        queueDepth: 0,
        maxQueue: 8,
        cacheEntries: 0,
        maxCacheEntries: 8,
        cacheHits: 0,
        cacheMisses: 0,
      },
    },
    limits: {
      queryTimeoutMs: 7_500,
      visualMaxCacheEntries: 8,
    },
    disposed,
  };
}

describe("retrieval runtime resource audit V2", () => {
  it("writes a bounded report and proves sidecars exited", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "retrieval-resource-audit-v2-"),
    );
    temporaryRoots.push(workspaceRoot);
    let disposed = false;
    const retrieve =
      vi.fn<LocalMixedRuntimeV2["retrieve"]>(
        async () => undefined as never,
      );
    const runtime = {
      t41CandidateIdentity: {
        corpusBundleHash: "a".repeat(64),
      },
      retrieve,
      resourceReport: () => report(disposed),
      async dispose() {
        disposed = true;
      },
    };
    const createRuntime = vi.fn(async () => runtime) as unknown as
      typeof createLocalMixedRuntimeV2;

    const output = await runRetrievalResourceAuditV2({
      workspaceRoot,
      outputName: "fixture.json",
      dependencies: {
        createRuntime,
        fixedOptions: fixedAgentEvidenceRuntimeOptionsV2,
      },
    });

    expect(retrieve.mock.calls.map((call) => call[1])).toEqual([
      "VISUAL_EMPTY",
      "VISUAL_UNAVAILABLE",
      "VISUAL_UNAVAILABLE",
      "NONE",
    ]);
    expect(output.audit).toEqual({
      visualHealthyEmptyCount: 1,
      visualFailureCount: 2,
      visualBlockedCount: 1,
      textFailureCount: 0,
      allSidecarsExited: true,
    });
    const bytes = await readFile(path.join(
      workspaceRoot,
      ".runtime",
      "retrieval-observability",
      "fixture.json",
    ), "utf8");
    expect(bytes).not.toContain("检查版式层级");
    expect(bytes).not.toMatch(/[A-Z]:\\/);
  });

  it("only accepts a safe JSON output name", () => {
    expect(parseRetrievalResourceAuditArguments([
      "--output-name",
      "resource-report.json",
    ])).toEqual({ outputName: "resource-report.json" });
    expect(() => parseRetrievalResourceAuditArguments([
      "--output-name",
      "../escape.json",
    ])).toThrow(/usage/);
  });
});

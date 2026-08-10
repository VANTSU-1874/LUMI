import { describe, expect, it, vi } from "vitest";

import {
  ChannelRetrievalResultV2Schema,
  type RetrievalChannelProviderV2,
} from "@/lib/knowledge/hybrid-retriever-v2";
import {
  protectRetrievalProviderWithCircuitV2,
} from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import {
  createRetrievalCircuitBreakerV2,
} from "@/lib/knowledge/retrieval-circuit-breaker-v2";
import { createRetrievalQueryV2 } from "@/lib/knowledge/retrieval-query-v2";

const corpusBundleHash = "a".repeat(64);
const query = createRetrievalQueryV2({
  mode: "TEXT_TO_TEXT",
  text: "这个版面先改哪里",
  scope: {
    corpusBundleHash,
    sourceCoursePack: {
      id: "layout-design",
      version: "1",
    },
  },
});

function channelResult(
  channel: "TEXT_VECTOR" | "VISUAL_VECTOR",
  status: "EMPTY" | "UNAVAILABLE",
) {
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel,
      status,
      reason: status === "EMPTY" ? null : "PROVIDER_UNAVAILABLE",
      corpusBundleHash,
      identity: status === "EMPTY"
        ? {
            activeIndexBundleHash: "b".repeat(64),
            providerIndexBundleHash: "c".repeat(64),
            indexVersionId: "provider-v1",
            modelId: "fixture/model",
            modelRevision: "d".repeat(40),
            configHash: "e".repeat(64),
            payloadHashes: ["f".repeat(64)],
          }
        : null,
      hitCount: 0,
      timingMs: 1,
    },
    hits: [],
  });
}

describe("mixed retrieval circuit integration V2", () => {
  it("opens only the failing visual channel while text remains available", async () => {
    const visualRaw = {
      retrieve: vi.fn(async () =>
        channelResult("VISUAL_VECTOR", "UNAVAILABLE")),
    } satisfies RetrievalChannelProviderV2;
    const textRaw = {
      retrieve: vi.fn(async () =>
        channelResult("TEXT_VECTOR", "EMPTY")),
    } satisfies RetrievalChannelProviderV2;
    const visualBreaker = createRetrievalCircuitBreakerV2({
      generationHash: "b".repeat(64),
      channel: "VISUAL_VECTOR",
      config: {
        failureThreshold: 2,
        cooldownMs: 10_000,
        latencySampleLimit: 8,
      },
    });
    const textBreaker = createRetrievalCircuitBreakerV2({
      generationHash: "b".repeat(64),
      channel: "TEXT_VECTOR",
      config: {
        failureThreshold: 2,
        cooldownMs: 10_000,
        latencySampleLimit: 8,
      },
    });
    const visual = protectRetrievalProviderWithCircuitV2({
      channel: "VISUAL_VECTOR",
      corpusBundleHash,
      breaker: visualBreaker,
      provider: visualRaw,
    });
    const text = protectRetrievalProviderWithCircuitV2({
      channel: "TEXT_VECTOR",
      corpusBundleHash,
      breaker: textBreaker,
      provider: textRaw,
    });

    await visual.retrieve(query, {});
    await visual.retrieve(query, {});
    await expect(visual.retrieve(query, {})).resolves.toMatchObject({
      summary: {
        channel: "VISUAL_VECTOR",
        status: "UNAVAILABLE",
        reason: "CIRCUIT_OPEN",
      },
    });
    await expect(text.retrieve(query, {})).resolves.toMatchObject({
      summary: {
        channel: "TEXT_VECTOR",
        status: "EMPTY",
      },
    });

    expect(visualRaw.retrieve).toHaveBeenCalledTimes(2);
    expect(textRaw.retrieve).toHaveBeenCalledTimes(1);
    expect(visualBreaker.snapshot().state).toBe("OPEN");
    expect(textBreaker.snapshot()).toMatchObject({
      state: "CLOSED",
      counters: {
        empty: 1,
        failures: 0,
      },
    });
  });

  it("counts malformed provider output as corruption", async () => {
    const breaker = createRetrievalCircuitBreakerV2({
      generationHash: "c".repeat(64),
      channel: "TEXT_VECTOR",
      config: {
        failureThreshold: 1,
        cooldownMs: 1_000,
        latencySampleLimit: 8,
      },
    });
    const protectedProvider = protectRetrievalProviderWithCircuitV2({
      channel: "TEXT_VECTOR",
      corpusBundleHash,
      breaker,
      provider: {
        async retrieve() {
          return { corrupt: true };
        },
      },
    });

    await expect(protectedProvider.retrieve(query, {})).resolves.toEqual({
      corrupt: true,
    });
    expect(breaker.snapshot()).toMatchObject({
      state: "OPEN",
      failureCounts: { CORRUPT: 1 },
    });
  });
});

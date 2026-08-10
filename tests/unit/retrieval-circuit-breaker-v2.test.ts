import { describe, expect, it } from "vitest";

import {
  createRetrievalCircuitBreakerV2,
} from "@/lib/knowledge/retrieval-circuit-breaker-v2";

describe("retrieval circuit breaker V2", () => {
  it("opens after consecutive failures and admits exactly one half-open probe", () => {
    let now = 0;
    const breaker = createRetrievalCircuitBreakerV2({
      generationHash: "a".repeat(64),
      channel: "VISUAL_VECTOR",
      config: {
        failureThreshold: 2,
        cooldownMs: 100,
        latencySampleLimit: 4,
      },
      now: () => now,
    });
    const first = breaker.beforeRequest()!;
    breaker.recordFailure(first, { failure: "TIMEOUT", latencyMs: 20 });
    const second = breaker.beforeRequest()!;
    breaker.recordFailure(second, { failure: "CRASH", latencyMs: 30 });

    expect(breaker.snapshot()).toMatchObject({
      state: "OPEN",
      consecutiveFailures: 2,
      counters: {
        admitted: 2,
        blocked: 0,
        failures: 2,
        opened: 1,
      },
    });
    expect(breaker.beforeRequest()).toBeNull();
    now = 100;
    const probe = breaker.beforeRequest()!;
    expect(probe.probe).toBe(true);
    expect(breaker.beforeRequest()).toBeNull();
    breaker.recordSuccess(probe, { empty: false, latencyMs: 10 });
    expect(breaker.snapshot()).toMatchObject({
      state: "CLOSED",
      consecutiveFailures: 0,
      halfOpenProbeInFlight: false,
    });
  });

  it("treats healthy EMPTY as success and keeps bounded latency statistics", () => {
    const breaker = createRetrievalCircuitBreakerV2({
      generationHash: "b".repeat(64),
      channel: "TEXT_VECTOR",
      config: {
        failureThreshold: 1,
        cooldownMs: 10,
        latencySampleLimit: 2,
      },
    });
    for (const latencyMs of [10, 20, 30]) {
      const permit = breaker.beforeRequest()!;
      breaker.recordSuccess(permit, { empty: true, latencyMs });
    }

    expect(breaker.snapshot()).toMatchObject({
      state: "CLOSED",
      consecutiveFailures: 0,
      counters: {
        admitted: 3,
        success: 3,
        empty: 3,
        failures: 0,
        opened: 0,
      },
      latency: {
        sampleCount: 3,
        totalMs: 60,
        maxMs: 30,
        p95Ms: 30,
      },
    });
  });

  it("reopens when the half-open probe fails and rejects duplicate settlement", () => {
    let now = 0;
    const breaker = createRetrievalCircuitBreakerV2({
      generationHash: "c".repeat(64),
      channel: "TEXT_VECTOR",
      config: {
        failureThreshold: 1,
        cooldownMs: 5,
        latencySampleLimit: 8,
      },
      now: () => now,
    });
    const initial = breaker.beforeRequest()!;
    breaker.recordFailure(initial, { failure: "CORRUPT", latencyMs: 1 });
    now = 5;
    const probe = breaker.beforeRequest()!;
    breaker.recordFailure(probe, { failure: "UNAVAILABLE", latencyMs: 2 });

    expect(breaker.snapshot()).toMatchObject({
      state: "OPEN",
      counters: {
        failures: 2,
        opened: 2,
      },
      failureCounts: {
        CORRUPT: 1,
        UNAVAILABLE: 1,
      },
    });
    expect(() => breaker.recordSuccess(
      probe,
      { empty: false, latencyMs: 1 },
    )).toThrow(/permit.invalid/);
  });
});

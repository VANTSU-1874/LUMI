import { randomUUID } from "node:crypto";

import { z } from "zod";

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const RetrievalCircuitChannelV2Schema = z.enum([
  "TEXT_VECTOR",
  "VISUAL_VECTOR",
]);

export const RetrievalCircuitFailureV2Schema = z.enum([
  "TIMEOUT",
  "CRASH",
  "CORRUPT",
  "UNAVAILABLE",
  "QUEUE_FULL",
  "ERROR",
]);

export const RetrievalCircuitStateV2Schema = z.enum([
  "CLOSED",
  "OPEN",
  "HALF_OPEN",
]);

export const RetrievalCircuitBreakerConfigV2Schema = z
  .object({
    failureThreshold: z.number().int().min(1).max(100),
    cooldownMs: z.number().int().min(1).max(30 * 60_000),
    latencySampleLimit: z.number().int().min(1).max(1_000),
  })
  .strict();

export const RETRIEVAL_CIRCUIT_BREAKER_CONFIG_V2 =
  Object.freeze(RetrievalCircuitBreakerConfigV2Schema.parse({
    failureThreshold: 3,
    cooldownMs: 30_000,
    latencySampleLimit: 64,
  }));

const FailureCountsSchema = z.record(
  RetrievalCircuitFailureV2Schema,
  z.number().int().nonnegative(),
);

export const RetrievalCircuitSnapshotV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    generationHash: HashSchema,
    channel: RetrievalCircuitChannelV2Schema,
    state: RetrievalCircuitStateV2Schema,
    consecutiveFailures: z.number().int().nonnegative(),
    halfOpenProbeInFlight: z.boolean(),
    counters: z
      .object({
        admitted: z.number().int().nonnegative(),
        blocked: z.number().int().nonnegative(),
        success: z.number().int().nonnegative(),
        empty: z.number().int().nonnegative(),
        failures: z.number().int().nonnegative(),
        opened: z.number().int().nonnegative(),
      })
      .strict(),
    failureCounts: FailureCountsSchema,
    latency: z
      .object({
        sampleCount: z.number().int().nonnegative(),
        totalMs: z.number().finite().nonnegative(),
        maxMs: z.number().finite().nonnegative(),
        p95Ms: z.number().finite().nonnegative(),
      })
      .strict(),
    config: RetrievalCircuitBreakerConfigV2Schema,
  })
  .strict();

export type RetrievalCircuitFailureV2 = z.infer<
  typeof RetrievalCircuitFailureV2Schema
>;
export type RetrievalCircuitBreakerConfigV2 = z.infer<
  typeof RetrievalCircuitBreakerConfigV2Schema
>;

export type RetrievalCircuitPermitV2 = Readonly<{
  id: string;
  probe: boolean;
}>;

function percentile95(values: readonly number[]) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)]!;
}

export function createRetrievalCircuitBreakerV2(input: Readonly<{
  generationHash: string;
  channel: z.infer<typeof RetrievalCircuitChannelV2Schema>;
  config?: Partial<z.infer<typeof RetrievalCircuitBreakerConfigV2Schema>>;
  now?: () => number;
}>) {
  const generationHash = HashSchema.parse(input.generationHash);
  const channel = RetrievalCircuitChannelV2Schema.parse(input.channel);
  const config = RetrievalCircuitBreakerConfigV2Schema.parse({
    ...RETRIEVAL_CIRCUIT_BREAKER_CONFIG_V2,
    ...input.config,
  });
  const now = input.now ?? (() => performance.now());
  let state: z.infer<typeof RetrievalCircuitStateV2Schema> =
    RetrievalCircuitStateV2Schema.enum.CLOSED;
  let consecutiveFailures = 0;
  let openedAt = 0;
  let halfOpenProbeId: string | null = null;
  const activePermits = new Map<string, RetrievalCircuitPermitV2>();
  const latencySamples: number[] = [];
  let latencySampleCount = 0;
  let latencyTotalMs = 0;
  let latencyMaxMs = 0;
  const counters = {
    admitted: 0,
    blocked: 0,
    success: 0,
    empty: 0,
    failures: 0,
    opened: 0,
  };
  const failureCounts = Object.fromEntries(
    RetrievalCircuitFailureV2Schema.options.map((failure) => [failure, 0]),
  ) as Record<RetrievalCircuitFailureV2, number>;

  const open = () => {
    state = RetrievalCircuitStateV2Schema.enum.OPEN;
    openedAt = now();
    halfOpenProbeId = null;
    counters.opened += 1;
  };

  const finish = (
    permit: RetrievalCircuitPermitV2,
    latencyMs: number,
  ) => {
    const active = activePermits.get(permit.id);
    if (!active || active.probe !== permit.probe) {
      throw new Error("retrieval.circuit.permit.invalid");
    }
    activePermits.delete(permit.id);
    if (halfOpenProbeId === permit.id) {
      halfOpenProbeId = null;
    }
    const boundedLatency = z.number().finite().nonnegative().parse(latencyMs);
    latencySampleCount += 1;
    latencyTotalMs += boundedLatency;
    latencyMaxMs = Math.max(latencyMaxMs, boundedLatency);
    latencySamples.push(boundedLatency);
    while (latencySamples.length > config.latencySampleLimit) {
      latencySamples.shift();
    }
  };

  return {
    beforeRequest(): RetrievalCircuitPermitV2 | null {
      if (state === RetrievalCircuitStateV2Schema.enum.OPEN) {
        if (now() - openedAt < config.cooldownMs) {
          counters.blocked += 1;
          return null;
        }
        state = RetrievalCircuitStateV2Schema.enum.HALF_OPEN;
      }
      if (
        state === RetrievalCircuitStateV2Schema.enum.HALF_OPEN
        && halfOpenProbeId !== null
      ) {
        counters.blocked += 1;
        return null;
      }
      const permit = Object.freeze({
        id: randomUUID(),
        probe: state === RetrievalCircuitStateV2Schema.enum.HALF_OPEN,
      });
      activePermits.set(permit.id, permit);
      if (permit.probe) halfOpenProbeId = permit.id;
      counters.admitted += 1;
      return permit;
    },
    recordSuccess(
      permit: RetrievalCircuitPermitV2,
      input: Readonly<{ latencyMs: number; empty: boolean }>,
    ) {
      finish(permit, input.latencyMs);
      counters.success += 1;
      if (input.empty) counters.empty += 1;
      if (
        permit.probe
        || state === RetrievalCircuitStateV2Schema.enum.CLOSED
      ) {
        state = RetrievalCircuitStateV2Schema.enum.CLOSED;
        consecutiveFailures = 0;
      }
    },
    recordFailure(
      permit: RetrievalCircuitPermitV2,
      input: Readonly<{
        latencyMs: number;
        failure: RetrievalCircuitFailureV2;
      }>,
    ) {
      finish(permit, input.latencyMs);
      const failure = RetrievalCircuitFailureV2Schema.parse(input.failure);
      counters.failures += 1;
      failureCounts[failure] += 1;
      consecutiveFailures += 1;
      if (
        permit.probe
        || consecutiveFailures >= config.failureThreshold
      ) {
        open();
      }
    },
    snapshot() {
      return RetrievalCircuitSnapshotV2Schema.parse({
        schemaVersion: 2,
        generationHash,
        channel,
        state,
        consecutiveFailures,
        halfOpenProbeInFlight: halfOpenProbeId !== null,
        counters,
        failureCounts,
        latency: {
          sampleCount: latencySampleCount,
          totalMs: latencyTotalMs,
          maxMs: latencyMaxMs,
          p95Ms: percentile95(latencySamples),
        },
        config,
      });
    },
  };
}

export type RetrievalCircuitBreakerV2 = ReturnType<
  typeof createRetrievalCircuitBreakerV2
>;

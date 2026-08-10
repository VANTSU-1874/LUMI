import { z } from "zod";

export const HarnessPhaseSchema = z.enum([
  "turn.before",
  "context.before",
  "context.after",
  "capabilities.before",
  "capabilities.after",
  "model.before",
  "model.after",
  "tool.authorize.before",
  "tool.execute.before",
  "tool.execute.after",
  "response.after",
  "persistence.before",
  "persistence.after",
  "turn.after",
  "turn.error",
  "turn.cancelled",
  "turn.finally",
]);

export const HarnessEventStatusSchema = z.enum([
  "STARTED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "SKIPPED",
]);

export const HarnessAuthoritySchema = z.enum([
  "OBSERVER",
  "BOUNDED_TRANSFORM",
  "DENY_GUARD",
]);

const SafeErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/);
const ToolIdSchema = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/);

export const HarnessEventSchema = z.object({
  sequence: z.number().int().positive(),
  phase: HarnessPhaseSchema,
  status: HarnessEventStatusSchema,
  modelAttempt: z.number().int().positive().max(10).optional(),
  modelDecision: z.number().int().positive().max(20).optional(),
  toolId: ToolIdSchema.optional(),
  capabilitySetHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  errorCode: SafeErrorCodeSchema.optional(),
}).strict();

export const HarnessObserverRegistrationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  version: z.string().regex(/^[0-9]+(?:\.[0-9]+){0,2}$/),
  authority: z.literal("OBSERVER"),
  phases: z.array(HarnessPhaseSchema).min(1).max(HarnessPhaseSchema.options.length),
  priority: z.number().int().min(-1_000).max(1_000),
}).strict();

export type HarnessPhase = z.infer<typeof HarnessPhaseSchema>;
export type HarnessAuthority = z.infer<typeof HarnessAuthoritySchema>;
export type HarnessEvent = z.infer<typeof HarnessEventSchema>;
export type HarnessEventInput = Omit<HarnessEvent, "sequence">;
export type HarnessObserverRegistration = z.infer<
  typeof HarnessObserverRegistrationSchema
>;

export interface HarnessObserver extends HarnessObserverRegistration {
  observe(event: HarnessEvent, signal: AbortSignal): void | Promise<void>;
}

export interface HarnessTraceSink {
  record(input: HarnessEventInput): HarnessEvent;
  snapshot(): HarnessEvent[];
}

export function createInMemoryHarnessTraceSink(): HarnessTraceSink {
  const events: HarnessEvent[] = [];
  return {
    record(input) {
      const event = HarnessEventSchema.parse({
        ...input,
        sequence: events.length + 1,
      });
      events.push(event);
      return { ...event };
    },
    snapshot() {
      return events.map((event) => ({ ...event }));
    },
  };
}

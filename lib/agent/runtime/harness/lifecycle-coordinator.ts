import {
  HarnessObserverRegistrationSchema,
  type HarnessEvent,
  type HarnessEventInput,
  type HarnessObserver,
  type HarnessTraceSink,
} from "./lifecycle-contract";

export type HarnessObserverFailure = {
  hookId: string;
  phase: HarnessEvent["phase"];
  errorCode:
    | "HARNESS_OBSERVER_FAILED"
    | "HARNESS_OBSERVER_TIMEOUT"
    | "HARNESS_OBSERVER_BUDGET_EXHAUSTED";
};

export interface LifecycleCoordinator {
  emit(input: HarnessEventInput): Promise<HarnessEvent>;
  snapshot(): HarnessEvent[];
}

export const DEFAULT_HARNESS_OBSERVER_TIMEOUT_MS = 100;
export const DEFAULT_HARNESS_TOTAL_OBSERVER_BUDGET_MS = 500;

function waitForObserver(
  observer: HarnessObserver,
  event: HarnessEvent,
  signal: AbortSignal,
  timeoutMs: number,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error("HARNESS_OBSERVER_TIMEOUT")),
      timeoutMs,
    );
  });
  return Promise.race([
    Promise.resolve(observer.observe(event, signal)),
    timeoutPromise,
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export function createLifecycleCoordinator(input: {
  trace: HarnessTraceSink;
  deadlineAtMs: number;
  signal?: AbortSignal;
  observers?: readonly HarnessObserver[];
  observerTimeoutMs?: number;
  totalObserverBudgetMs?: number;
  onObserverFailure?: (failure: HarnessObserverFailure) => void;
  now?: () => number;
}): LifecycleCoordinator {
  const now = input.now ?? (() => performance.now());
  const observerTimeoutMs = input.observerTimeoutMs
    ?? DEFAULT_HARNESS_OBSERVER_TIMEOUT_MS;
  const totalObserverBudgetMs = input.totalObserverBudgetMs
    ?? DEFAULT_HARNESS_TOTAL_OBSERVER_BUDGET_MS;
  const observers = [...(input.observers ?? [])].map((observer) => {
    HarnessObserverRegistrationSchema.parse({
      id: observer.id,
      version: observer.version,
      authority: observer.authority,
      phases: observer.phases,
      priority: observer.priority,
    });
    return observer;
  });
  if (new Set(observers.map(({ id }) => id)).size !== observers.length) {
    throw new Error("HARNESS_OBSERVER_ID_DUPLICATE");
  }
  observers.sort((left, right) => (
    left.priority - right.priority || left.id.localeCompare(right.id)
  ));
  let observerSpentMs = 0;

  return {
    async emit(eventInput) {
      const event = Object.freeze(input.trace.record(eventInput));
      for (const observer of observers) {
        if (!observer.phases.includes(event.phase)) continue;
        if (input.signal?.aborted) continue;
        const remainingTotalMs = totalObserverBudgetMs - observerSpentMs;
        const remainingTurnMs = input.deadlineAtMs - now();
        const allowedMs = Math.floor(Math.min(
          observerTimeoutMs,
          remainingTotalMs,
          remainingTurnMs,
        ));
        if (allowedMs <= 0) {
          input.onObserverFailure?.({
            hookId: observer.id,
            phase: event.phase,
            errorCode: "HARNESS_OBSERVER_BUDGET_EXHAUSTED",
          });
          continue;
        }
        const startedAt = now();
        try {
          const observerSignal = input.signal
            ? AbortSignal.any([input.signal, AbortSignal.timeout(allowedMs)])
            : AbortSignal.timeout(allowedMs);
          await waitForObserver(observer, event, observerSignal, allowedMs);
        } catch (error) {
          input.onObserverFailure?.({
            hookId: observer.id,
            phase: event.phase,
            errorCode: error instanceof Error
              && error.message === "HARNESS_OBSERVER_TIMEOUT"
              ? "HARNESS_OBSERVER_TIMEOUT"
              : "HARNESS_OBSERVER_FAILED",
          });
        } finally {
          observerSpentMs += Math.max(0, now() - startedAt);
        }
      }
      return event;
    },
    snapshot() {
      return input.trace.snapshot();
    },
  };
}

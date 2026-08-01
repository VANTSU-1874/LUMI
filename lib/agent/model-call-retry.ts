import { ModelServiceError } from "@/lib/ai/client";

const MAX_MODEL_CALL_ATTEMPTS = 3;
const SHORT_BACKOFF_MS = [300, 800] as const;
const RATE_LIMIT_BACKOFF_MS = [2_000, 5_000] as const;
const JITTER_RATIO = 0.25;
const MIN_RETRY_ATTEMPT_BUDGET_MS = 1_000;

export type ModelRetryContext = {
  runId?: string;
  caseId?: string;
  modelDecision?: number;
};

type RetryKind = "SHORT" | "RATE_LIMIT";

type ModelCallAttempt = {
  attempt: number;
  signal: AbortSignal;
  totalTimeoutMs: number;
  onTextDelta?: (delta: string) => void;
};

type ModelCallRetryInput<T> = {
  execute: (attempt: ModelCallAttempt) => Promise<T>;
  totalBudgetMs: number;
  turnDeadline: number;
  signal?: AbortSignal;
  onTextDelta?: (delta: string, attempt: number) => void;
  allowRetryAfterTextDelta?: boolean;
  onAttemptError?: (error: unknown, attempt: number) => void;
  onRetry?: (retryCount: number, failedAttempt: number) => void;
  context?: ModelRetryContext;
};

type ModelCallRetryResult<T> = {
  value: T;
  retryCount: number;
};

function safeIdentifier(value: string | undefined) {
  if (!value) return null;
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || null;
}

function retryKind(error: unknown): RetryKind | null {
  if (!(error instanceof ModelServiceError)) return null;
  if (error.code === "INVALID_RESPONSE" || error.code === "TRANSPORT") return "SHORT";
  if (error.code === "TIMEOUT") return "SHORT";
  if (error.code === "RATE_LIMIT") return "RATE_LIMIT";
  if (
    error.code === "PROVIDER_STATUS"
    && error.httpStatus !== null
    && error.httpStatus >= 500
    && error.httpStatus <= 599
  ) {
    return "SHORT";
  }
  return null;
}

function retryDelayMs(kind: RetryKind, retryIndex: number, error: ModelServiceError) {
  const configured = kind === "RATE_LIMIT"
    ? RATE_LIMIT_BACKOFF_MS[retryIndex]
    : SHORT_BACKOFF_MS[retryIndex];
  const base = kind === "RATE_LIMIT"
    ? Math.max(configured, error.retryAfterMs ?? 0)
    : configured;
  return base + Math.round(base * JITTER_RATIO * Math.max(0, Math.min(1, Math.random())));
}

function errorFields(error: unknown) {
  const modelError = error instanceof ModelServiceError ? error : null;
  return {
    causeCode: modelError?.code ?? "UNKNOWN",
    httpStatus: modelError?.httpStatus ?? null,
    transportCode: modelError?.transportCode ?? null,
    protocolCode: modelError?.protocolCode ?? null,
  };
}

function emitRetryLog(input: {
  context?: ModelRetryContext;
  outcome:
    | "scheduled"
    | "succeeded"
    | "exhausted"
    | "skipped_not_retryable"
    | "skipped_text_delta"
    | "skipped_budget";
  attempt: number;
  retryCount: number;
  delayMs?: number;
  remainingBudgetMs: number;
  textDeltaCount: number;
  textDeltaCharacters: number;
  error?: unknown;
}) {
  const entry = {
    event: "model_call_retry",
    recordedAt: new Date().toISOString(),
    runId: safeIdentifier(input.context?.runId),
    caseId: safeIdentifier(input.context?.caseId),
    modelDecision: input.context?.modelDecision ?? null,
    outcome: input.outcome,
    attempt: input.attempt,
    maxAttempts: MAX_MODEL_CALL_ATTEMPTS,
    retryCount: input.retryCount,
    delayMs: input.delayMs ?? 0,
    remainingBudgetMs: Math.max(0, input.remainingBudgetMs),
    textDeltaCount: input.textDeltaCount,
    textDeltaCharacters: input.textDeltaCharacters,
    ...errorFields(input.error),
  };
  try {
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  } catch {
    // Observability must never replace the model result or fallback path.
  }
}

function createAttemptAbort(input: {
  timeoutMs: number;
  callerSignal?: AbortSignal;
}) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("The operation timed out", "TimeoutError"));
  }, input.timeoutMs);
  const abortFromCaller = () => {
    controller.abort(input.callerSignal?.reason);
  };
  input.callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  if (input.callerSignal?.aborted) abortFromCaller();
  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    dispose() {
      clearTimeout(timeout);
      input.callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function waitForRetryDelay(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ModelServiceError("CANCELLED"));
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(new ModelServiceError("CANCELLED"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function runModelCallWithRetry<T>(
  input: ModelCallRetryInput<T>,
): Promise<ModelCallRetryResult<T>> {
  const startedAt = performance.now();
  const modelDeadline = Math.min(
    input.turnDeadline,
    startedAt + Math.max(1, Math.floor(input.totalBudgetMs)),
  );
  let lastFailure: unknown;

  for (let attempt = 1; attempt <= MAX_MODEL_CALL_ATTEMPTS; attempt += 1) {
    if (input.signal?.aborted) throw new ModelServiceError("CANCELLED");
    const remainingBudgetMs = Math.floor(modelDeadline - performance.now());
    if (remainingBudgetMs <= 0) {
      throw lastFailure instanceof ModelServiceError
        ? lastFailure
        : new ModelServiceError("TIMEOUT");
    }
    // Give the first call every remaining millisecond. Only a fast failure leaves
    // budget for a later retry; pre-splitting the window would cut off a healthy
    // long-running stream before its liveness guard can do its job.
    const attemptBudgetMs = Math.max(1, remainingBudgetMs);
    const attemptAbort = createAttemptAbort({
      timeoutMs: attemptBudgetMs,
      callerSignal: input.signal,
    });
    // These counters are deliberately attempt-scoped. The execute callback also
    // starts a fresh provider response, so failed streamed text cannot become
    // part of the returned value from a later attempt.
    let textDeltaCount = 0;
    let textDeltaCharacters = 0;
    try {
      const value = await input.execute({
        attempt,
        signal: attemptAbort.signal,
        totalTimeoutMs: attemptBudgetMs,
        ...(input.onTextDelta
          ? {
              onTextDelta(delta: string) {
                if (delta.length > 0) {
                  textDeltaCount += 1;
                  textDeltaCharacters += [...delta].length;
                }
                input.onTextDelta?.(delta, attempt);
              },
            }
          : {}),
      });
      if (attempt > 1) {
        emitRetryLog({
          context: input.context,
          outcome: "succeeded",
          attempt,
          retryCount: attempt - 1,
          remainingBudgetMs: Math.floor(modelDeadline - performance.now()),
          textDeltaCount,
          textDeltaCharacters,
          error: lastFailure,
        });
      }
      return { value, retryCount: attempt - 1 };
    } catch (rawError) {
      const error = !input.signal?.aborted && attemptAbort.timedOut
        ? new ModelServiceError("TIMEOUT", null, null, null, null, rawError)
        : rawError;
      lastFailure = error;
      input.onAttemptError?.(error, attempt);
      const remainingAfterFailureMs = Math.floor(modelDeadline - performance.now());
      if (textDeltaCount > 0 && input.allowRetryAfterTextDelta !== true) {
        emitRetryLog({
          context: input.context,
          outcome: "skipped_text_delta",
          attempt,
          retryCount: attempt - 1,
          remainingBudgetMs: remainingAfterFailureMs,
          textDeltaCount,
          textDeltaCharacters,
          error,
        });
        throw error;
      }
      const kind = retryKind(error);
      if (!kind) {
        emitRetryLog({
          context: input.context,
          outcome: "skipped_not_retryable",
          attempt,
          retryCount: attempt - 1,
          remainingBudgetMs: remainingAfterFailureMs,
          textDeltaCount,
          textDeltaCharacters,
          error,
        });
        throw error;
      }
      if (attempt === MAX_MODEL_CALL_ATTEMPTS) {
        emitRetryLog({
          context: input.context,
          outcome: "exhausted",
          attempt,
          retryCount: attempt - 1,
          remainingBudgetMs: remainingAfterFailureMs,
          textDeltaCount,
          textDeltaCharacters,
          error,
        });
        throw error;
      }
      const modelError = error as ModelServiceError;
      const delayMs = retryDelayMs(kind, attempt - 1, modelError);
      if (remainingAfterFailureMs < delayMs + MIN_RETRY_ATTEMPT_BUDGET_MS) {
        emitRetryLog({
          context: input.context,
          outcome: "skipped_budget",
          attempt,
          retryCount: attempt - 1,
          delayMs,
          remainingBudgetMs: remainingAfterFailureMs,
          textDeltaCount,
          textDeltaCharacters,
          error,
        });
        throw error;
      }
      emitRetryLog({
        context: input.context,
        outcome: "scheduled",
        attempt,
        retryCount: attempt,
        delayMs,
        remainingBudgetMs: remainingAfterFailureMs,
        textDeltaCount,
        textDeltaCharacters,
        error,
      });
      input.onRetry?.(attempt, attempt);
      await waitForRetryDelay(delayMs, input.signal);
    } finally {
      attemptAbort.dispose();
    }
  }

  throw lastFailure ?? new ModelServiceError("INVALID_RESPONSE");
}

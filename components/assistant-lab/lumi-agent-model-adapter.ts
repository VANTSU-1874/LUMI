"use client";

import type {
  ChatModelAdapter,
  ChatModelRunOptions,
  ThreadAssistantMessagePart,
  ThreadMessage,
} from "@assistant-ui/react";

import type {
  AgentRun,
  AgentRunEvent,
} from "@/lib/agent/runtime/agent-run-event";
import {
  appendContinuationText,
  MAX_AGENT_VISIBLE_TEXT_CHARS,
} from "@/lib/agent/continuation-text";
import {
  externalSearchMessageDigest,
  type AgentView,
} from "@/lib/agent/contracts";
import type { AgentRequestedCapabilityId } from "@/lib/agent/requested-capability";

import {
  agentMessageToThreadMessage,
  getThreadMessageText,
  loadPersistedAssistantForRun,
  rememberContinuationRun,
  rememberRetryRun,
  requestJson,
  takeContinuationRun,
  takeResumableRun,
  takeRetryRun,
  waitForUserMessageWrite,
} from "./assistant-lab-backend";
import type { LumiExecutionProgressData } from "./assistant-lab-backend";
import {
  requestedCapabilityFromThreadMessage,
  type ComposerCapabilityCoordinator,
} from "./assistant-lab-capability-state";

type RunResponse = { run: AgentRun };
type RunCreateResponse = RunResponse & { created: boolean; nextEventSequence: number };
type RunEventsResponse = {
  runId: string;
  events: AgentRunEvent[];
  nextEventSequence: number;
};

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function latestUserMessage(messages: readonly ThreadMessage[]) {
  return [...messages].reverse().find(
    (message): message is Extract<ThreadMessage, { role: "user" }> => message.role === "user",
  );
}

async function cancelRun(runId: string) {
  try {
    await requestJson(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      keepalive: true,
    });
  } catch {
    // The run may already have crossed the persistence boundary. The poller
    // will read the authoritative status and render that result instead.
  }
}

async function readRun(runId: string, signal?: AbortSignal) {
  const response = await requestJson<RunResponse>(
    `/api/agent/runs/${encodeURIComponent(runId)}`,
    { signal },
  );
  return response.run;
}

async function retryRun(runId: string) {
  const response = await requestJson<RunResponse>(
    `/api/agent/runs/${encodeURIComponent(runId)}/retry`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    },
  );
  return response.run;
}

async function cancelThenRetry(runId: string, signal: AbortSignal) {
  let run = await readRun(runId, signal);
  if (["QUEUED", "RUNNING"].includes(run.status)) {
    await cancelRun(runId);
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await delay(100, signal);
      run = await readRun(runId, signal);
      if (!["QUEUED", "RUNNING"].includes(run.status)) break;
    }
  }
  if (!["FAILED", "CANCELLED"].includes(run.status)) {
    throw new Error("这轮回答已经结束，请刷新后查看已保存内容。");
  }
  return retryRun(runId);
}

function runPayload(
  taskId: string,
  message: Extract<ThreadMessage, { role: "user" }>,
  capabilityCoordinator?: ComposerCapabilityCoordinator,
) {
  const capability = capabilityCoordinator?.getForMessage(message.id)
    ?? requestedCapabilityFromThreadMessage(message);
  const messageText = getThreadMessageText(message);
  const viewByCapability: Partial<Record<AgentRequestedCapabilityId, AgentView>> = {
    "book-design": "BOOK_LAYOUT_LAB",
    "course-reference": "KNOWLEDGE_MAP",
    "evidence-troubleshooting": "EVIDENCE",
    "process-record": "PROJECT",
    "touchdesigner-cases": "CASE_LIBRARY",
  };
  return {
    taskId,
    clientMessageId: message.id,
    message: messageText,
    ...(capability ? { capability } : {}),
    ...(capability?.id === "public-research"
      ? {
        externalSearchConsent: {
          nonce: crypto.randomUUID(),
          messageDigest: externalSearchMessageDigest(messageText),
          issuedAt: Date.now(),
        },
      }
      : {}),
    context: {
      view: capability ? viewByCapability[capability.id] ?? "AGENT" : "AGENT",
    },
  };
}

async function continueRun(runId: string) {
  const response = await requestJson<RunCreateResponse>(
    `/api/agent/runs/${encodeURIComponent(runId)}/continue`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    },
  );
  return response.run;
}

async function createRun(
  taskId: string,
  message: Extract<ThreadMessage, { role: "user" }>,
  capabilityCoordinator?: ComposerCapabilityCoordinator,
) {
  const payload = runPayload(taskId, message, capabilityCoordinator);
  const artwork = message.attachments.find((attachment) => attachment.file)?.file;
  const body: BodyInit = artwork
    ? (() => {
      const form = new FormData();
      form.append("payload", JSON.stringify(payload));
      form.append("artwork", artwork);
      return form;
    })()
    : JSON.stringify(payload);
  return requestJson<RunCreateResponse>("/api/agent/runs", {
    method: "POST",
    headers: {
      "idempotency-key": crypto.randomUUID(),
      ...(artwork ? {} : { "content-type": "application/json" }),
    },
    body,
  }).then(({ run }) => run);
}

type LiveTool = {
  id: string;
  toolName: string;
  summary: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
};

type LiveStep = LumiExecutionProgressData["items"][number];

type LiveContinuation = {
  instantPrefix: string;
  seamOffset: number;
  attempt: number;
  dedupePending: boolean;
};

type LiveRunState = {
  reasoning: string[];
  steps: LiveStep[];
  text: string;
  tools: LiveTool[];
  continuation?: LiveContinuation;
};

function liveParts(input: LiveRunState) {
  const parts: ThreadAssistantMessagePart[] = [];
  if (input.reasoning.length > 0) {
    parts.push({ type: "reasoning", text: input.reasoning.slice(-3).join("\n") });
  }
  if (input.steps.length > 0) {
    const progress: LumiExecutionProgressData = {
      state: "streaming",
      items: input.steps,
    };
    parts.push({
      type: "data",
      name: "lumi-execution-progress",
      data: progress,
    });
  }
  if (input.continuation) {
    parts.push({
      type: "data",
      name: "lumi-continuation",
      data: {
        instantPrefix: input.continuation.instantPrefix,
        seamOffset: input.continuation.seamOffset,
        attempt: input.continuation.attempt,
      },
    });
  }
  for (const tool of input.tools) {
    parts.push({
      type: "tool-call",
      toolCallId: tool.id,
      toolName: tool.toolName,
      args: {},
      argsText: "{}",
      ...(tool.status === "RUNNING"
        ? {}
        : {
          result: { status: tool.status, summary: tool.summary },
          isError: tool.status === "FAILED",
        }),
    });
  }
  if (input.text) parts.push({ type: "text", text: input.text });
  return parts;
}

function continuationPreviewParts(instantPrefix: string) {
  return liveParts({
    reasoning: [],
    steps: [],
    text: instantPrefix,
    tools: [],
    continuation: {
      instantPrefix,
      seamOffset: instantPrefix.length,
      // The server is authoritative for the real attempt number. This
      // preflight part exists only so assistant-ui can retain the old body
      // during the continuation request.
      attempt: 0,
      dedupePending: true,
    },
  });
}

function applyEvents(
  events: readonly AgentRunEvent[],
  state: LiveRunState,
) {
  for (const event of events) {
    if (event.kind === "TOKEN" && event.payload.text) {
      if (state.continuation?.dedupePending) {
        state.text = appendContinuationText(state.text, event.payload.text);
        state.continuation.dedupePending = false;
      } else {
        state.text = `${state.text}${event.payload.text}`.slice(0, MAX_AGENT_VISIBLE_TEXT_CHARS);
      }
      continue;
    }
    if (event.kind === "STEP") {
      if (!state.steps.some((step) => step.id === event.id)) {
        state.steps.push({
          id: event.id,
          sequence: event.sequence,
          kind: event.payload.stepKind ?? "STEP",
          label: event.label,
          summary: event.summary,
          status: "completed",
        });
      }
      if (
        event.payload.stepKind === "MODEL"
        && !state.reasoning.includes(event.summary)
      ) {
        state.reasoning.push(event.summary);
      }
      continue;
    }
    if (event.kind !== "TOOL" || !event.payload.toolId || !event.payload.toolStatus) continue;
    const running = [...state.tools].reverse().find(
      (tool) => tool.toolName === event.payload.toolId && tool.status === "RUNNING",
    );
    if (running) {
      running.status = event.payload.toolStatus;
      running.summary = event.summary;
    } else {
      state.tools.push({
        id: `${event.runId}:event:${event.sequence}`,
        toolName: event.payload.toolId,
        summary: event.summary,
        status: event.payload.toolStatus,
      });
    }
  }
}

async function persistedAssistant(taskId: string, runId: string, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const message = await loadPersistedAssistantForRun(taskId, runId);
    if (message) return message;
    await delay(80, signal);
  }
  throw new Error("回答已完成，但消息历史尚未写入。请刷新后重试。");
}

async function persistedAssistantMessage(
  taskId: string,
  runId: string,
  signal?: AbortSignal,
) {
  const persisted = agentMessageToThreadMessage(
    await persistedAssistant(taskId, runId, signal),
  );
  if (persisted.role !== "assistant") {
    throw new Error("回答已完成，但消息历史没有返回导师消息。请刷新后重试。");
  }
  return persisted;
}

function isThreadRuntimeDetach(signal: AbortSignal) {
  const reason = signal.reason as { name?: unknown; detach?: unknown } | undefined;
  return reason?.name === "AbortError" && reason.detach === true;
}

function incompleteLiveParts(
  state: LiveRunState,
  reason: "CANCELLED" | "MODEL_CONNECTION_INTERRUPTED",
) {
  return [
    ...liveParts(state),
    {
      type: "data" as const,
      name: "lumi-response",
      data: { incomplete: { reason } },
    },
  ];
}

function mergedPersistedContent(
  persisted: Extract<ThreadMessage, { role: "assistant" }>,
  state: LiveRunState,
) {
  const content = persisted.content.map((part) => (
    part.type === "text" && state.text
      ? { ...part, text: state.text }
      : part
  ));
  if (state.continuation) {
    content.push({
      type: "data",
      name: "lumi-continuation",
      data: {
        instantPrefix: state.continuation.instantPrefix,
        seamOffset: state.continuation.seamOffset,
        attempt: state.continuation.attempt,
      },
    });
  }
  return content;
}

function rememberPartialRun(
  userMessageId: string,
  runId: string,
  state: LiveRunState,
) {
  if (state.text.trim()) {
    rememberContinuationRun(userMessageId, runId, state.text);
  } else {
    rememberRetryRun(userMessageId, runId);
  }
}

type StreamAgentRunInput = {
  taskId: string;
  user: Extract<ThreadMessage, { role: "user" }>;
  run: AgentRun;
  abortSignal: AbortSignal;
};

async function* streamAgentRun({
  taskId,
  user,
  run: initialRun,
  abortSignal,
}: StreamAgentRunInput) {
  let run = initialRun;
  const continuation = run.request?.continuation;
  const state: LiveRunState = {
    reasoning: [] as string[],
    steps: [] as LiveStep[],
    text: continuation?.previousText ?? "",
    tools: [] as LiveTool[],
    ...(continuation ? {
      continuation: {
        instantPrefix: continuation.previousText,
        seamOffset: continuation.previousText.length,
        attempt: continuation.attempt,
        dedupePending: true,
      },
    } : {}),
  };
  let cancelPromise: Promise<void> | undefined;
  const onAbort = () => {
    // assistant-ui uses AbortError.detach when a thread runtime is being
    // detached (for example, the user opened a different conversation). That
    // only stops this browser poller; the durable server-side run must keep
    // going. ComposerPrimitive.Cancel uses the same AbortError name but with
    // detach=false, and remains a real cancellation request.
    if (!isThreadRuntimeDetach(abortSignal)) {
      // Preserve the learner-visible prefix synchronously. A stop can race the
      // worker's terminal persistence, so waiting for the aborted poller to
      // observe a final status leaves the subsequent Reload without a source.
      if (state.text.trim()) rememberContinuationRun(user.id, run.id, state.text);
      cancelPromise ??= cancelRun(run.id);
    }
  };
  abortSignal.addEventListener("abort", onAbort, { once: true });
  if (abortSignal.aborted) onAbort();

  let afterSequence = 0;
  try {
    if (state.text) yield { content: liveParts(state) };
    while (true) {
      if (abortSignal.aborted) {
        if (isThreadRuntimeDetach(abortSignal)) {
          throw abortSignal.reason ?? new DOMException("Aborted", "AbortError");
        }
        await cancelPromise;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const eventResponse = await requestJson<RunEventsResponse>(
            `/api/agent/runs/${encodeURIComponent(run.id)}/events?after=${afterSequence}&limit=200`,
          );
          applyEvents(eventResponse.events, state);
          const lastSequence = eventResponse.events.at(-1)?.sequence;
          if (lastSequence) afterSequence = lastSequence;
          run = await readRun(run.id);
          if (["CANCELLED", "FAILED", "COMPLETED", "WAITING_APPROVAL"].includes(run.status)) break;
          await delay(100);
        }
        if (run.status === "COMPLETED" || run.status === "WAITING_APPROVAL") {
          // The server crossed its persistence boundary before the stop request.
          // Hydrate an incomplete persisted answer before the next reload. The
          // runtime is already aborted, so this must not use its abort signal.
          // Otherwise the continuation mapping is lost and assistant-ui falls
          // back to creating a new, empty run.
          try {
            const persisted = await persistedAssistantMessage(taskId, run.id);
            if (persisted.status.type === "incomplete") {
              rememberContinuationRun(user.id, run.id, getThreadMessageText(persisted));
            }
          } catch {
            // The normal history refresh remains the authoritative fallback if
            // the persistence read races the worker transaction.
          }
          throw abortSignal.reason ?? new DOMException("Aborted", "AbortError");
        }
        rememberPartialRun(user.id, run.id, state);
        yield {
          content: incompleteLiveParts(state, run.status === "CANCELLED" ? "CANCELLED" : "MODEL_CONNECTION_INTERRUPTED"),
          status: {
            type: "incomplete" as const,
            reason: run.status === "CANCELLED" ? "cancelled" as const : "error" as const,
            error: { message: "LUMI_RUN_INTERRUPTED" },
          },
        };
        return;
      }
      const eventResponse = await requestJson<RunEventsResponse>(
        `/api/agent/runs/${encodeURIComponent(run.id)}/events?after=${afterSequence}&limit=200`,
        { signal: abortSignal },
      );
      applyEvents(eventResponse.events, state);
      const lastSequence = eventResponse.events.at(-1)?.sequence;
      if (lastSequence) afterSequence = lastSequence;
      if (eventResponse.events.length > 0) {
        yield { content: liveParts(state) };
      }

      run = await readRun(run.id, abortSignal);
      if (run.status === "COMPLETED" || run.status === "WAITING_APPROVAL") {
        const persisted = await persistedAssistantMessage(taskId, run.id, abortSignal);
        if (persisted.status.type === "incomplete") {
          rememberContinuationRun(user.id, run.id, getThreadMessageText(persisted));
        }
        yield {
          content: mergedPersistedContent(persisted, state),
          status: persisted.status,
          metadata: persisted.metadata,
        };
        return;
      }
      if (run.status === "FAILED") {
        rememberPartialRun(user.id, run.id, state);
        if (state.text.trim()) {
          yield {
            content: incompleteLiveParts(state, "MODEL_CONNECTION_INTERRUPTED"),
            status: {
              type: "incomplete" as const,
              reason: "error" as const,
              error: { message: "LUMI_RUN_INTERRUPTED" },
            },
          };
          return;
        }
        throw new Error(`本轮运行失败${run.lastErrorCode ? `（${run.lastErrorCode}）` : ""}，可以重试。`);
      }
      if (run.status === "CANCELLED") {
        rememberPartialRun(user.id, run.id, state);
        if (state.text.trim()) {
          yield {
            content: incompleteLiveParts(state, "CANCELLED"),
            status: {
              type: "incomplete" as const,
              reason: "cancelled" as const,
              error: { message: "LUMI_RUN_INTERRUPTED" },
            },
          };
          return;
        }
        throw new Error("本轮运行已安全停止，可以重试。");
      }
      await delay(140, abortSignal);
    }
  } finally {
    abortSignal.removeEventListener("abort", onAbort);
    if (abortSignal.aborted && !isThreadRuntimeDetach(abortSignal)) {
      await cancelPromise;
    }
  }
}

export async function* resumeLumiAgentRun({
  messages,
  abortSignal,
  unstable_threadId,
}: ChatModelRunOptions) {
  const user = latestUserMessage(messages);
  if (!user || !unstable_threadId) {
    throw new Error("当前对话尚未准备好，请重新打开后再试。");
  }
  const runId = takeResumableRun(user.id);
  if (!runId) {
    throw new Error("未找到可恢复的回答，请刷新后再试。");
  }
  const run = await readRun(runId, abortSignal);
  yield* streamAgentRun({
    taskId: unstable_threadId,
    user,
    run,
    abortSignal,
  });
}

/**
 * The optional argument remains only for callers compiled against the former
 * mode-aware API. Conversation is now the sole supported experience.
 */
export function createLumiAgentModelAdapter(
  legacyModeOrCoordinator?: unknown,
): ChatModelAdapter {
  const capabilityCoordinator =
    legacyModeOrCoordinator
    && typeof legacyModeOrCoordinator === "object"
    && "getForMessage" in legacyModeOrCoordinator
      ? legacyModeOrCoordinator as ComposerCapabilityCoordinator
      : undefined;
  return {
    async *run({ messages, abortSignal, unstable_threadId }) {
      const user = latestUserMessage(messages);
      if (!user) throw new Error("当前对话尚未准备好，请重新打开后再试。");
      const persistedTaskId = await waitForUserMessageWrite(user.id);
      const taskId = persistedTaskId ?? unstable_threadId;
      if (!taskId) throw new Error("当前对话尚未准备好，请重新打开后再试。");

      const continuation = takeContinuationRun(user.id);
      const retryRunId = continuation ? undefined : takeRetryRun(user.id);
      let run: AgentRun;
      if (continuation) {
        if (continuation.instantPrefix) {
          // Reload replaces the assistant-ui branch synchronously. Yield the
          // durable prefix before awaiting the continuation endpoint so the
          // visible answer never flashes blank or retypes from the beginning.
          yield { content: continuationPreviewParts(continuation.instantPrefix) };
        }
        try {
          run = await continueRun(continuation.runId);
        } catch (error) {
          // A transient request error must not turn the next click into an
          // ordinary new run. Keep the source mapping until the server accepts
          // the durable continuation.
          rememberContinuationRun(user.id, continuation.runId, continuation.instantPrefix);
          throw error;
        }
      } else if (retryRunId) {
        run = await cancelThenRetry(retryRunId, abortSignal);
      } else {
        run = await createRun(taskId, user, capabilityCoordinator);
      }
      yield* streamAgentRun({ taskId, user, run, abortSignal });
    },
  };
}

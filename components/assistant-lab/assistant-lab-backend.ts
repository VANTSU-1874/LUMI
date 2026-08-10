"use client";

import type {
  ExportedMessageRepository,
  ExportedMessageRepositoryItem,
  RemoteThreadListAdapter,
  ThreadAssistantMessagePart,
  ThreadHistoryAdapter,
  ThreadMessage,
} from "@assistant-ui/react";

import type {
  AgentMessageListResponse,
  AgentMessageRecord,
} from "@/lib/agent/agent-message-contract";
import { appendContinuationText } from "@/lib/agent/continuation-text";
import type { AgentRun, AgentRunEvent } from "@/lib/agent/runtime/agent-run-event";
import type {
  DesignTask,
} from "@/lib/agent/design-project-task-contract";

import {
  requestedCapabilityFromThreadMessage,
  type ComposerCapabilityCoordinator,
} from "./assistant-lab-capability-state";

type ErrorPayload = { error?: string };

export type LumiExecutionProgressData = {
  state: "streaming" | "complete";
  items: Array<{
    id: string;
    sequence: number;
    kind: string;
    label: string;
    summary: string;
    status: "completed" | "failed" | "empty" | "skipped";
  }>;
};

const pendingUserWrites = new Map<string, Promise<string>>();
const pendingUserWriteRegistrations = new Map<string, () => void>();
const consumedUserWrites = new Set<string>();
const retryRunsByUserMessage = new Map<string, string>();
export type ContinuationRun = {
  runId: string;
  /**
   * Learner-visible text already rendered before an assistant-ui reload
   * creates its replacement message. This is presentation-only; the server
   * still reconstructs the authoritative continuation context from the run.
   */
  instantPrefix: string;
};
const continuationRunsByUserMessage = new Map<string, ContinuationRun>();
const resumableRunsByUserMessage = new Map<string, string>();

type PendingRunResumer = NonNullable<ThreadHistoryAdapter["resume"]>;

type RunEventsResponse = {
  runId: string;
  events: AgentRunEvent[];
  nextEventSequence: number;
};

async function readInterruptedRunText(runId: string) {
  try {
    const runResponse = await requestJson<{ run: AgentRun }>(
      `/api/agent/runs/${encodeURIComponent(runId)}`,
    );
    let afterSequence = 0;
    let streamedText = "";
    for (let page = 0; page < 8; page += 1) {
      const events = await requestJson<RunEventsResponse>(
        `/api/agent/runs/${encodeURIComponent(runId)}/events?after=${afterSequence}&limit=200`,
      );
      for (const event of events.events) {
        if (event.kind === "TOKEN" && event.payload.text) streamedText += event.payload.text;
      }
      const last = events.events.at(-1)?.sequence;
      if (!last || events.events.length < 200) break;
      afterSequence = last;
    }
    return appendContinuationText(
      runResponse.run.request?.continuation?.previousText ?? "",
      streamedText,
    );
  } catch {
    // A history load must remain usable even when an old event stream cannot
    // be read.  The caller keeps the explicit, non-deceptive fallback notice.
    return "";
  }
}

async function readError(response: Response) {
  try {
    const payload = await response.json() as ErrorPayload;
    return payload.error || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<T>;
}

function taskMetadata(task: DesignTask) {
  return {
    status: task.status === "ARCHIVED" ? "archived" as const : "regular" as const,
    remoteId: task.id,
    title: task.title,
    custom: { pinned: task.pinned },
    lastMessageAt: new Date(task.updatedAt),
  };
}

function titleStream(title: string) {
  return new ReadableStream<unknown>({
    start(controller) {
      controller.enqueue({ type: "part-start", path: [0], part: { type: "text" } });
      controller.enqueue({ type: "text-delta", path: [0], textDelta: title });
      controller.enqueue({ type: "part-finish", path: [0] });
      controller.close();
    },
  });
}

export class LumiThreadListAdapter implements RemoteThreadListAdapter {
  unstable_Provider?: RemoteThreadListAdapter["unstable_Provider"];

  async list() {
    const response = await requestJson<{ tasks: DesignTask[] }>("/api/agent/tasks");
    return { threads: response.tasks.map(taskMetadata) };
  }

  async initialize() {
    const task = await requestJson<DesignTask>("/api/agent/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "conversation" }),
    });
    return { remoteId: task.id, externalId: undefined };
  }

  async rename(remoteId: string, newTitle: string) {
    await this.patch(remoteId, { title: newTitle });
  }

  async updateCustom(remoteId: string, custom: Record<string, unknown> | undefined) {
    const update: { pinned?: boolean } = {};
    if (typeof custom?.pinned === "boolean") update.pinned = custom.pinned;
    if (Object.keys(update).length > 0) await this.patch(remoteId, update);
  }

  async archive(remoteId: string) {
    await this.patch(remoteId, { status: "ARCHIVED" });
  }

  async unarchive(remoteId: string) {
    await this.patch(remoteId, { status: "ACTIVE" });
  }

  async delete(remoteId: string) {
    await requestJson(`/api/agent/tasks/${encodeURIComponent(remoteId)}`, {
      method: "DELETE",
    });
  }

  async fetch(threadId: string) {
    const task = await requestJson<DesignTask>(
      `/api/agent/tasks/${encodeURIComponent(threadId)}`,
    );
    return taskMetadata(task);
  }

  async generateTitle(remoteId: string) {
    let title = "未命名设计任务";
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const task = await requestJson<DesignTask>(
        `/api/agent/tasks/${encodeURIComponent(remoteId)}`,
      );
      title = task.title;
      if (title !== "未命名设计任务") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return titleStream(title) as Awaited<
      ReturnType<RemoteThreadListAdapter["generateTitle"]>
    >;
  }

  private async patch(remoteId: string, update: Record<string, unknown>) {
    return requestJson<DesignTask>(
      `/api/agent/tasks/${encodeURIComponent(remoteId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      },
    );
  }
}

export function getThreadMessageText(message: ThreadMessage | undefined) {
  if (!message) return "";
  return message.content
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function actionToolParts(message: AgentMessageRecord) {
  if (message.structure.kind !== "assistant") return [];
  return message.structure.reply.actions.map((action): ThreadAssistantMessagePart => ({
    type: "tool-call",
    toolCallId: action.id,
    toolName: action.type === "START_DIAGNOSTIC"
      ? "lumi.five_dimension_diagnosis"
      : "lumi.confirm_action",
    args: {
      runId: message.runId,
      turnId: message.turnId,
      actionId: action.id,
      type: action.type,
      label: action.label,
      description: action.description,
      target: action.target,
      focus: action.focus,
    },
    argsText: JSON.stringify(action),
    result: { status: action.status },
  }));
}

export function agentMessageToAssistantParts(
  message: AgentMessageRecord,
): ThreadAssistantMessagePart[] {
  if (message.structure.kind !== "assistant") return [{ type: "text", text: message.content }];
  const processSteps = message.structure.executionSteps
    .filter((step) => step.kind !== "FINAL_RESPONSE");
  const reasoningSteps = processSteps
    .filter((step) => step.kind === "MODEL_DECISION" || step.kind === "DEGRADED")
    .map((step) => step.summary)
    .filter((summary, index, all) => all.indexOf(summary) === index)
    .slice(-3);
  const content: ThreadAssistantMessagePart[] = [];
  if (reasoningSteps.length > 0) {
    content.push({ type: "reasoning", text: reasoningSteps.join("\n") });
  }
  if (processSteps.length > 0) {
    const progress: LumiExecutionProgressData = {
      state: "complete",
      items: processSteps.map((step) => ({
        id: step.id,
        sequence: step.sequence,
        kind: step.kind,
        label: step.label,
        summary: step.summary,
        status: step.status === "SUCCEEDED"
          ? "completed"
          : step.status === "FAILED"
            ? "failed"
            : step.status === "EMPTY"
              ? "empty"
              : "skipped",
      })),
    };
    content.push({
      type: "data",
      name: "lumi-execution-progress",
      data: progress,
    });
  }
  for (const tool of message.toolCalls) {
    content.push({
      type: "tool-call",
      toolCallId: tool.id,
      toolName: tool.toolId,
      args: tool.input as Extract<ThreadAssistantMessagePart, { type: "tool-call" }>["args"],
      argsText: JSON.stringify(tool.input),
      result: tool.output ?? {
        status: tool.status,
        errorCode: tool.errorCode,
      },
      isError: tool.status === "ERROR",
    });
  }
  content.push({ type: "text", text: message.content });
  for (const source of message.structure.reply.sources) {
    content.push(source.url
      ? {
        type: "source",
        sourceType: "url",
        id: source.id,
        title: source.title,
        url: source.url,
      }
      : {
        type: "source",
        sourceType: "document",
        id: source.id,
        title: source.title,
        mediaType: "text/plain",
      });
  }
  content.push({
    type: "data",
    name: "lumi-response",
    data: {
      eyebrow: message.structure.reply.eyebrow,
      title: message.structure.reply.title,
      whyThisStep: message.structure.reply.whyThisStep,
      uncertainty: message.structure.reply.uncertainty,
      graph: message.structure.reply.graph,
      basis: message.structure.reply.basis ?? [],
      evidenceSources: message.structure.reply.sources
        .filter(({ evidence }) => Boolean(evidence))
        .map((source) => source),
      incomplete: message.structure.reply.incomplete,
      episode: message.structure.episode,
      decisionCode: message.structure.decisionCode,
      aiMode: message.structure.aiMode,
      routingReceipt: message.structure.routingReceipt,
    },
  });
  content.push(...actionToolParts(message));
  return content;
}

function userAttachments(message: AgentMessageRecord) {
  if (!message.attachment) return [];
  return [{
    id: message.attachment.id,
    type: "image" as const,
    name: `作品-${message.attachment.id.slice(0, 8)}`,
    contentType: message.attachment.mimeType,
    status: { type: "complete" as const },
    content: [{
      type: "image" as const,
      image: message.attachment.previewUrl,
      filename: `作品-${message.attachment.id.slice(0, 8)}`,
    }],
  }];
}

export function agentMessageToThreadMessage(message: AgentMessageRecord): ThreadMessage {
  if (message.role === "user") {
    return {
      id: message.id,
      role: "user",
      content: [{ type: "text", text: message.content }],
      attachments: userAttachments(message),
      createdAt: new Date(message.createdAt),
      metadata: {
        custom: {
          turnId: message.turnId,
          runId: message.runId,
          capability: message.structure.kind === "user"
            ? message.structure.capability
            : undefined,
        },
      },
    };
  }
  const incomplete = message.structure.kind === "assistant"
    ? message.structure.reply.incomplete
    : undefined;
  return {
    id: message.id,
    role: "assistant",
    content: agentMessageToAssistantParts(message),
    status: incomplete
      ? {
        type: "incomplete",
        reason: "error",
        error: {
          message: incomplete.reason === "MODEL_TIMEOUT"
            ? "模型响应超时；以下为已经收到的正文。"
            : incomplete.reason === "MODEL_OUTPUT_TRUNCATED"
              ? "本次输出达到长度上限；以下为已经收到的正文。"
              : "模型连接中断；以下为已经收到的正文。",
        },
      }
      : { type: "complete", reason: "stop" },
    createdAt: new Date(message.createdAt),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        turnId: message.turnId,
        runId: message.runId,
        lumiStructure: message.structure,
      },
    },
  };
}

function interruptedMessage(
  user: ThreadMessage,
  runId: string,
  status: AgentMessageListResponse["pendingRun"] extends infer T
    ? T extends { status: infer S } ? S : never
    : never,
  partialText: string,
): ThreadMessage {
  const hasPartialText = partialText.trim().length > 0;
  const incompleteReason = status === "CANCELLED"
    ? "CANCELLED"
    : "MODEL_CONNECTION_INTERRUPTED";
  return {
    id: `${user.id}#interrupted`,
    role: "assistant",
    content: [
      {
        type: "text",
        text: hasPartialText
          ? partialText
          : status === "FAILED"
            ? "这次回答没有形成正文，可以重新生成。"
            : status === "CANCELLED"
              ? "这次回答已停止，可以重新生成。"
              : "页面恢复时发现这一轮尚未形成正文，可以重新生成。",
      },
      {
        type: "data",
        name: "lumi-response",
        data: { incomplete: { reason: incompleteReason } },
      },
    ],
    status: {
      type: "incomplete",
      reason: status === "CANCELLED" ? "cancelled" : "error",
      error: { message: "LUMI_RUN_INTERRUPTED" },
    },
    createdAt: new Date(user.createdAt.getTime() + 1),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { runId, interrupted: true },
    },
  };
}

async function loadHistory(taskId: string): Promise<ExportedMessageRepository & {
  unstable_resume?: boolean;
}> {
  const response = await requestJson<AgentMessageListResponse>(
    `/api/agent/tasks/${encodeURIComponent(taskId)}/messages`,
  );
  const messages: ThreadMessage[] = [];
  const assistantIndexByRunId = new Map<string, number>();
  let lastUserMessageId: string | undefined;

  for (const record of response.messages) {
    const message = agentMessageToThreadMessage(record);
    if (message.role === "user") {
      lastUserMessageId = message.id;
      messages.push(message);
      continue;
    }

    const continuationOfRunId = record.structure.kind === "assistant"
      ? record.structure.continuationOfRunId
      : undefined;
    const priorIndex = continuationOfRunId
      ? assistantIndexByRunId.get(continuationOfRunId)
      : undefined;
    if (priorIndex !== undefined) {
      const prior = messages[priorIndex];
      messages[priorIndex] = {
        ...message,
        id: prior!.id,
        createdAt: prior!.createdAt,
      };
      assistantIndexByRunId.delete(continuationOfRunId!);
      if (record.runId) assistantIndexByRunId.set(record.runId, priorIndex);
    } else {
      messages.push(message);
      if (record.runId) assistantIndexByRunId.set(record.runId, messages.length - 1);
    }

    if (
      record.structure.kind === "assistant"
      && record.structure.reply.incomplete
      && record.runId
      && lastUserMessageId
    ) {
      rememberContinuationRun(lastUserMessageId, record.runId, getThreadMessageText(message));
    }
  }

  const resumable = response.pendingRun
    && ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(response.pendingRun.status);
  if (response.pendingRun && resumable) {
    resumableRunsByUserMessage.set(
      response.pendingRun.userMessageId,
      response.pendingRun.runId,
    );
  } else if (response.pendingRun) {
    const partialText = await readInterruptedRunText(response.pendingRun.runId);
    if (partialText.trim()) {
      rememberContinuationRun(
        response.pendingRun.userMessageId,
        response.pendingRun.runId,
        partialText,
      );
    } else {
      retryRunsByUserMessage.set(
        response.pendingRun.userMessageId,
        response.pendingRun.runId,
      );
    }
    const user = messages.findLast(
      (message) => message.id === response.pendingRun?.userMessageId,
    );
    if (user) {
      messages.push(interruptedMessage(
        user,
        response.pendingRun.runId,
        response.pendingRun.status,
        partialText,
      ));
    }
  }
  const items: ExportedMessageRepositoryItem[] = messages.map((message, index) => ({
    parentId: messages[index - 1]?.id ?? null,
    message,
  }));
  return {
    headId: messages.at(-1)?.id ?? null,
    messages: items,
    ...(resumable ? { unstable_resume: true } : {}),
  };
}

function writeUserMessage(
  taskId: string,
  item: ExportedMessageRepositoryItem,
  capabilityCoordinator?: ComposerCapabilityCoordinator,
) {
  const capability = capabilityCoordinator?.bindToMessage(item.message.id)
    ?? requestedCapabilityFromThreadMessage(item.message);
  return requestJson(
    `/api/agent/tasks/${encodeURIComponent(taskId)}/messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: item.message.id,
        content: getThreadMessageText(item.message),
        ...(capability ? { capability } : {}),
      }),
    },
  ).then(() => taskId);
}

function trackUserMessageWrite(messageId: string, promise: Promise<string>) {
  consumedUserWrites.delete(messageId);
  pendingUserWrites.set(messageId, promise);
  pendingUserWriteRegistrations.get(messageId)?.();
  pendingUserWriteRegistrations.delete(messageId);
  return promise;
}

function persistUserMessage(
  taskId: string,
  item: ExportedMessageRepositoryItem,
  capabilityCoordinator?: ComposerCapabilityCoordinator,
) {
  if (item.message.role !== "user") return Promise.resolve();
  return trackUserMessageWrite(
    item.message.id,
    writeUserMessage(taskId, item, capabilityCoordinator),
  ).then(() => undefined);
}

export function createLumiHistoryAdapter(
  taskId: string,
  capabilityCoordinator?: ComposerCapabilityCoordinator,
  resume?: PendingRunResumer,
): ThreadHistoryAdapter {
  return {
    load: () => loadHistory(taskId),
    ...(resume ? { resume } : {}),
    append(item) {
      if (item.message.role !== "user") return Promise.resolve();
      return persistUserMessage(taskId, item, capabilityCoordinator);
    },
  };
}

export function createInitializingLumiHistoryAdapter(
  input: {
    getRemoteId: () => string | undefined;
    initialize: () => Promise<{ remoteId: string }>;
  },
  capabilityCoordinator?: ComposerCapabilityCoordinator,
  resume?: PendingRunResumer,
): ThreadHistoryAdapter {
  return {
    async load() {
      const remoteId = input.getRemoteId();
      return remoteId ? loadHistory(remoteId) : { messages: [] };
    },
    ...(resume ? { resume } : {}),
    async append(item) {
      if (item.message.role !== "user") return;
      const promise = (async () => {
        const remoteId = input.getRemoteId()
          ?? (await input.initialize()).remoteId;
        return writeUserMessage(remoteId, item, capabilityCoordinator);
      })();
      await trackUserMessageWrite(item.message.id, promise);
    },
  };
}

export async function waitForUserMessageWrite(messageId: string) {
  if (consumedUserWrites.has(messageId)) return undefined;
  let promise = pendingUserWrites.get(messageId);
  if (!promise) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 5_000);
      pendingUserWriteRegistrations.set(messageId, () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    pendingUserWriteRegistrations.delete(messageId);
    promise = pendingUserWrites.get(messageId);
  }
  if (!promise) return undefined;
  try {
    return await promise;
  } finally {
    if (pendingUserWrites.get(messageId) === promise) {
      pendingUserWrites.delete(messageId);
      consumedUserWrites.add(messageId);
      setTimeout(() => consumedUserWrites.delete(messageId), 30_000);
    }
  }
}

export function rememberRetryRun(messageId: string, runId: string) {
  retryRunsByUserMessage.set(messageId, runId);
}

export function rememberContinuationRun(
  messageId: string,
  runId: string,
  instantPrefix = "",
) {
  const existing = continuationRunsByUserMessage.get(messageId);
  continuationRunsByUserMessage.set(messageId, {
    runId,
    instantPrefix: instantPrefix || (existing?.runId === runId ? existing.instantPrefix : ""),
  });
}

export function takeRetryRun(messageId: string) {
  const runId = retryRunsByUserMessage.get(messageId);
  retryRunsByUserMessage.delete(messageId);
  return runId;
}

export function takeContinuationRun(messageId: string) {
  const run = continuationRunsByUserMessage.get(messageId);
  continuationRunsByUserMessage.delete(messageId);
  return run;
}

export function takeResumableRun(messageId: string) {
  const runId = resumableRunsByUserMessage.get(messageId);
  resumableRunsByUserMessage.delete(messageId);
  return runId;
}

export async function loadPersistedAssistantForRun(taskId: string, runId: string) {
  const response = await requestJson<AgentMessageListResponse>(
    `/api/agent/tasks/${encodeURIComponent(taskId)}/messages`,
  );
  return response.messages.find(
    (message) => message.role === "assistant" && message.runId === runId,
  ) ?? null;
}

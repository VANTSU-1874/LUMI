import type { AgentRunEvent } from "./contracts";
import { shouldUseMockEndpoint } from "./config";
import { createClientApi } from "./client";

export type AgentRunSubscription = {
  close: () => void;
};

export type AgentRunSubscriptionHandlers = {
  onEvent: (event: AgentRunEvent) => void;
  onConnection?: (connected: boolean) => void;
  onError?: (error: Error) => void;
  /** The stream ended in transport, not the run. Polling may continue from the last sequence. */
  onTransportError?: (error: Error) => void;
};

type EventSourceFactory = (url: string) => EventSource;

export function subscribeAgentRun(
  runId: string,
  after: number,
  handlers: AgentRunSubscriptionHandlers,
  options: {
    forceMock?: boolean;
    mockSelection?: string;
    eventSourceFactory?: EventSourceFactory;
  } = {},
): AgentRunSubscription {
  const path = `/api/agent/runs/${encodeURIComponent(runId)}/events/stream?after=${after}`;
  const useMock = options.forceMock || shouldUseMockEndpoint(path, options.mockSelection);
  if (useMock) {
    const api = createClientApi({ forceMock: true });
    let cursor = after;
    let closed = false;
    handlers.onConnection?.(true);
    const timer = window.setInterval(() => {
      void api.getEvents(runId, cursor).then((page) => {
        if (closed) return;
        for (const event of page.events) {
          cursor = Math.max(cursor, event.sequence);
          handlers.onEvent(event);
        }
        if (page.events.some((event) => ["COMPLETION", "ERROR", "CANCELLED"].includes(event.kind))) {
          window.clearInterval(timer);
          handlers.onConnection?.(false);
        }
      }).catch((reason: unknown) => {
        if (!closed) handlers.onError?.(reason instanceof Error ? reason : new Error("演示事件读取失败"));
      });
    }, 450);
    return {
      close: () => {
        closed = true;
        window.clearInterval(timer);
        handlers.onConnection?.(false);
      },
    };
  }

  const source = options.eventSourceFactory?.(path) ?? new EventSource(path);
  let cursor = after;
  let streamInterrupted = false;
  const onEvent = (message: MessageEvent<string>) => {
    try {
      const event = JSON.parse(message.data) as AgentRunEvent;
      if (!Number.isInteger(event.sequence) || event.sequence <= cursor) return;
      cursor = event.sequence;
      handlers.onEvent(event);
    } catch {
      handlers.onError?.(new Error("运行事件格式无效"));
    }
  };
  const onTransportError = () => {
    if (streamInterrupted) return;
    streamInterrupted = true;
    const error = new Error("实时连接已中断，运行仍在后台继续；正在从最后事件序号轮询恢复。");
    handlers.onConnection?.(false);
    (handlers.onTransportError ?? handlers.onError)?.(error);
    source.close();
  };
  source.onopen = () => handlers.onConnection?.(true);
  source.onerror = onTransportError;
  source.addEventListener("agent-run-event", onEvent as EventListener);
  source.addEventListener("transport-error", onTransportError as EventListener);
  return {
    close: () => {
      source.removeEventListener("agent-run-event", onEvent as EventListener);
      source.removeEventListener("transport-error", onTransportError as EventListener);
      source.close();
      handlers.onConnection?.(false);
    },
  };
}

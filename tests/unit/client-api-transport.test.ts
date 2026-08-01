import { describe, expect, it, vi } from "vitest";

import type { AgentRunEvent } from "@/components/client-api/contracts";
import { subscribeAgentRun } from "@/components/client-api/transport";

class FakeEventSource extends EventTarget {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();
}

const event: AgentRunEvent = {
  id: "10000000-0000-4000-8000-000000000001",
  runId: "20000000-0000-4000-8000-000000000001",
  sequence: 3,
  kind: "STEP",
  label: "正在理解",
  summary: "保持自然回答主路径。",
  payload: { status: "RUNNING", stepKind: "MODEL" },
  createdAt: "2026-07-19T02:00:00.000Z",
};

describe("agent run SSE transport", () => {
  it("deduplicates by sequence and reports transport interruption without declaring run failure", () => {
    const source = new FakeEventSource();
    const onEvent = vi.fn();
    const onTransportError = vi.fn();
    const onConnection = vi.fn();
    const subscription = subscribeAgentRun(event.runId, 2, {
      onEvent,
      onTransportError,
      onConnection,
    }, {
      eventSourceFactory: () => source as unknown as EventSource,
      mockSelection: "none",
    });

    source.dispatchEvent(new MessageEvent("agent-run-event", { data: JSON.stringify(event) }));
    source.dispatchEvent(new MessageEvent("agent-run-event", { data: JSON.stringify(event) }));
    source.dispatchEvent(new MessageEvent("agent-run-event", { data: JSON.stringify({ ...event, sequence: 2 }) }));
    expect(onEvent).toHaveBeenCalledTimes(1);

    source.dispatchEvent(new MessageEvent("transport-error", { data: "{\"retry\":true}" }));
    expect(onTransportError).toHaveBeenCalledTimes(1);
    expect(onTransportError.mock.calls[0]?.[0].message).toContain("运行仍在后台继续");
    expect(onConnection).toHaveBeenLastCalledWith(false);
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls.some(([received]) => received.kind === "ERROR")).toBe(false);

    subscription.close();
  });

  it("reports the native EventSource error through the same honest interruption callback", () => {
    const source = new FakeEventSource();
    const onTransportError = vi.fn();
    subscribeAgentRun(event.runId, 0, {
      onEvent: vi.fn(),
      onTransportError,
    }, {
      eventSourceFactory: () => source as unknown as EventSource,
      mockSelection: "none",
    });

    source.onerror?.(new Event("error"));
    source.dispatchEvent(new MessageEvent("transport-error", { data: "{\"retry\":true}" }));
    expect(onTransportError).toHaveBeenCalledTimes(1);
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});

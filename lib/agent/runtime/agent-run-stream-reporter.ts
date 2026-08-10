import type { AgentOptions } from "../orchestrator-context";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  findPossibleTutorSidecarStart,
  findTutorSidecarStart,
} from "@/lib/agent/tutor-sidecar-marker";

import {
  appendAgentRunEvent,
  type AgentRunRow,
} from "./agent-run-record";

const TOKEN_EVENT_CHUNK_SIZE = 480;
const TOKEN_FLUSH_INTERVAL_MS = 40;
const TOKEN_MIN_VISIBLE_CHARACTERS = 24;
const TOKEN_NATURAL_BREAK_MIN_CHARACTERS = 6;
const MODEL_ACTIVITY_INTERVAL_MS = 1_000;

export function createAgentRunStreamReporter(input: {
  connection: DatabaseConnection;
  row: Pick<AgentRunRow, "id" | "dataType">;
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  let markerBuffer = "";
  let pendingText = "";
  let sidecarStarted = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let lastModelActivityAtMs: number | undefined;

  const flushPending = (force = false) => {
    if (!pendingText) {
      if (force && flushTimer) clearTimeout(flushTimer);
      flushTimer = undefined;
      return;
    }
    const endsNaturally = /[\n。！？；：]$/.test(pendingText);
    if (
      !force
      && pendingText.length < TOKEN_MIN_VISIBLE_CHARACTERS
      && !(pendingText.length >= TOKEN_NATURAL_BREAK_MIN_CHARACTERS && endsNaturally)
    ) {
      flushTimer ??= setTimeout(() => {
        flushTimer = undefined;
        flushPending(true);
      }, TOKEN_FLUSH_INTERVAL_MS);
      return;
    }
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    while (pendingText) {
      const text = pendingText.slice(0, TOKEN_EVENT_CHUNK_SIZE);
      pendingText = pendingText.slice(text.length);
      appendAgentRunEvent(input.connection, input.row, {
        kind: "TOKEN",
        label: "组织回答",
        summary: "已收到新的回答片段。",
        payload: { text },
        now: now(),
      });
    }
  };

  const queueVisibleText = (text: string) => {
    if (!text) return;
    pendingText += text;
    flushPending();
  };

  const onTextDelta: NonNullable<AgentOptions["onTextDelta"]> = (delta) => {
    if (!delta || sidecarStarted) return;
    markerBuffer += delta;
    const markerIndex = findTutorSidecarStart(markerBuffer);
    if (markerIndex >= 0) {
      queueVisibleText(markerBuffer.slice(0, markerIndex));
      markerBuffer = "";
      sidecarStarted = true;
      flushPending(true);
      return;
    }
    const possibleMarkerIndex = findPossibleTutorSidecarStart(markerBuffer);
    if (possibleMarkerIndex < 0) {
      queueVisibleText(markerBuffer);
      markerBuffer = "";
    } else if (possibleMarkerIndex > 0) {
      queueVisibleText(markerBuffer.slice(0, possibleMarkerIndex));
      markerBuffer = markerBuffer.slice(possibleMarkerIndex);
    }
  };

  const onModelActivity: NonNullable<AgentOptions["onModelActivity"]> = () => {
    const activityAtMs = now().getTime();
    if (
      lastModelActivityAtMs !== undefined
      && activityAtMs - lastModelActivityAtMs < MODEL_ACTIVITY_INTERVAL_MS
    ) return;
    lastModelActivityAtMs = activityAtMs;
    appendAgentRunEvent(input.connection, input.row, {
      kind: "STEP",
      label: "理解你的问题",
      summary: "模型连接仍在持续输出推理或回答片段。",
      payload: { stepKind: "MODEL" },
      now: new Date(activityAtMs),
    });
  };

  const onToolProgress: NonNullable<AgentOptions["onToolProgress"]> = (event) => {
    flushPending(true);
    appendAgentRunEvent(input.connection, input.row, {
      kind: "TOOL",
      label: event.label.slice(0, 100),
      summary: (event.summary.trim() || "工具状态已更新。").slice(0, 300),
      payload: { stepKind: "TOOL", toolId: event.toolId, toolStatus: event.status },
      now: now(),
    });
  };

  return {
    onTextDelta,
    onModelActivity,
    onToolProgress,
    flush() {
      if (!sidecarStarted) queueVisibleText(markerBuffer);
      markerBuffer = "";
      flushPending(true);
    },
  };
}

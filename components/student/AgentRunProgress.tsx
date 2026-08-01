"use client";

import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import { ThinkingTool } from "@/components/ui/thinking-tool";
import type { AgentTurnResponse } from "@/lib/agent/contracts";
import type { AgentRun, AgentRunEvent } from "@/lib/agent/runtime/agent-run-event";
import type { ToolAdapterTarget } from "@/lib/tool-adapters/contract";

import { AgentMentorAnswer } from "./AgentMentorAnswer";
import { useSmoothStream } from "./use-smooth-stream";

type OpenTool = (tool: ToolAdapterTarget, focus?: string | null) => void;

const STATUS_COPY: Record<AgentRun["status"], { label: string; detail: string; tone: string }> = {
  QUEUED: { label: "已进入队列", detail: "请求已经保存，离开页面也不会丢失。", tone: "bg-[#eef4f1] text-[#37675a]" },
  RUNNING: { label: "触映正在推进", detail: "正在理解意图、检查资料并组织下一步。", tone: "bg-[#e7f2ed] text-[#176752]" },
  WAITING_APPROVAL: { label: "等待你的确认", detail: "回答已经保存；候选行动尚未执行。", tone: "bg-[#fff3d8] text-[#8a620c]" },
  COMPLETED: { label: "本轮已完成", detail: "回答和项目理解已经保存。", tone: "bg-[#e7f2ed] text-[#176752]" },
  FAILED: { label: "本轮没有完成", detail: "已保存失败状态，可以安全重试。", tone: "bg-[#fff0ec] text-[#9c4636]" },
  CANCELLED: { label: "本轮已停止", detail: "没有留下半写回答，可以重试或换一个问题。", tone: "bg-[#f0f1ed] text-[#626c67]" },
};

const ERROR_COPY: Record<string, string> = {
  MODEL_SERVICE_FAILED: "模型服务暂时没有完成响应",
  MODEL_REQUEST_ABORTED: "模型请求已停止",
  AGENT_RUN_EXECUTION_FAILED: "运行在安全边界停止",
  AGENT_ATTEMPT_LIMIT: "本轮已达到最大尝试次数",
  AGENT_RUNTIME_UNAVAILABLE: "原运行版本当前不可用",
};

const TOOL_STATUS_COPY = {
  RUNNING: { label: "进行中", state: "input-available" as const },
  SUCCEEDED: { label: "已完成", state: "output-available" as const },
  FAILED: { label: "未完成", state: "output-error" as const },
} as const;

const noopOpenTool: OpenTool = () => {};
const noopExecute = async (): Promise<{ navigation: { target: ToolAdapterTarget; focus: string | null } | null }> => ({ navigation: null });

export function AgentRunProgress({
  run,
  events,
  submittedMessage,
  busy,
  onCancel,
  onRetry,
  onOpenTool = noopOpenTool,
  execute = noopExecute,
  canReject = false,
}: {
  run: AgentRun;
  events: AgentRunEvent[];
  submittedMessage?: string;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onOpenTool?: OpenTool;
  execute?: (turn: AgentTurnResponse, actionId: string, decision?: "APPROVE" | "REJECT") => Promise<{ navigation: { target: ToolAdapterTarget; focus: string | null } | null }>;
  canReject?: boolean;
}) {
  const copy = STATUS_COPY[run.status];
  const streamedText = events
    .filter((event) => event.kind === "TOKEN")
    .map((event) => event.payload.text ?? "")
    .join("");
  const isStreaming = run.status === "RUNNING" && !run.result;
  const renderedStreamedText = useSmoothStream(streamedText, isStreaming);
  const latestEvent = events.at(-1);
  const hasModelLiveness = isStreaming
    && !streamedText
    && latestEvent?.kind === "STEP"
    && latestEvent.payload.stepKind === "MODEL";
  const visibleEvents = events
    .filter((event) => event.kind !== "TOKEN" && !(event.kind === "STEP" && event.payload.stepKind === "MODEL"))
    .slice(-6);
  const showStreamedText = isStreaming && Boolean(renderedStreamedText);
  const canCancel = ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(run.status);
  const canRetry = ["FAILED", "CANCELLED"].includes(run.status) && run.attempt < 3;

  if (run.status === "COMPLETED" && run.result) {
    return <AgentMentorAnswer
      canReject={canReject}
      execute={execute}
      onOpenTool={onOpenTool}
      turn={run.result}
    />;
  }

  return <section className="rounded-2xl border border-[#dfe5e1] bg-[#fafbf9] p-4" aria-label="Agent 运行进度">
    <span aria-atomic="true" className="sr-only" role="status">运行状态：{copy.label}</span>
    {submittedMessage && !run.result ? <div className="mb-4 ml-auto w-fit max-w-[88%] whitespace-pre-wrap rounded-[1.25rem] bg-[#f0f1ed] px-4 py-2.5 text-sm leading-6 text-[#26302c] [overflow-wrap:anywhere]">{submittedMessage}</div> : null}
    {showStreamedText ? <Message aria-label="导师流式回答" aria-live="off" className="mb-4 max-w-[44rem]" from="assistant">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[#17332d] text-xs text-[#ffbf47]" aria-hidden="true">✦</span>
        <MessageContent className="w-full max-w-none overflow-visible p-0 text-sm leading-7 text-[#26302c]">
          <MessageResponse isAnimating>{renderedStreamedText}</MessageResponse>
          <span className="motion-safe:animate-pulse mt-1 inline-block h-4 w-0.5 bg-[#478473] align-middle" aria-hidden="true" />
        </MessageContent>
      </div>
    </Message> : null}
    {hasModelLiveness ? <div className="mb-4 ml-11" role="status">
      <ThinkingTool state="thinking" thinkingLabel="导师正在思考" />
    </div> : null}
    <div className="flex flex-wrap items-start gap-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[#17332d] text-xs text-[#ffbf47]" aria-hidden="true">✦</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${copy.tone}`}>{copy.label}</span>
          <span className="text-[10px] text-[#7b847f]">第 {Math.max(1, run.attempt)} 次尝试</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-[#4f5b56]">{copy.detail}</p>
        {run.lastErrorCode ? <p className="mt-1 text-xs text-[#9c4636]">{ERROR_COPY[run.lastErrorCode] ?? "运行暂时无法继续"}</p> : null}
      </div>
      {canCancel ? <button className="rounded-lg border border-[#d6ddd9] bg-white px-3 py-2 text-xs font-semibold text-[#58645f] hover:bg-[#f2f4f1] disabled:opacity-50" disabled={busy} onClick={onCancel} type="button">{run.status === "WAITING_APPROVAL" ? "先不执行行动" : "停止"}</button> : null}
      {canRetry ? <button className="rounded-lg bg-[#17332d] px-3 py-2 text-xs font-semibold text-white hover:bg-[#285f50] disabled:opacity-50" disabled={busy} onClick={onRetry} type="button">重新运行</button> : null}
    </div>
    {visibleEvents.length > 0 ? <ol className="mt-4 space-y-2" aria-label="运行事件">
      {visibleEvents.map((event) => {
        const toolStatus = event.payload.toolStatus ? TOOL_STATUS_COPY[event.payload.toolStatus] : null;
        if (toolStatus) return <li key={event.id}>
          <Tool className="mb-2 border-[#dfe5e1] bg-white">
            <ToolHeader
              state={toolStatus.state}
              statusLabel={toolStatus.label}
              title={event.label}
              toolName={event.payload.toolId ?? "agent-tool"}
              type="dynamic-tool"
            />
            <ToolContent className="pt-0 text-[11px] leading-5 text-[#727c77]">{event.summary}</ToolContent>
          </Tool>
        </li>;
        return <li className="relative border-l border-[#ced9d4] pl-4" key={event.id}>
          <span className="absolute -left-[0.22rem] top-1.5 size-1.5 rounded-full bg-[#6f9f90]" aria-hidden="true" />
          <p className="text-xs font-semibold text-[#3f4d47]">{event.label}</p>
          <p className="mt-0.5 text-[11px] leading-5 text-[#727c77]">{event.summary}</p>
        </li>;
      })}
    </ol> : <div className="mt-4 flex items-center gap-2 text-xs text-[#6c7772]" role="status"><span className="size-1.5 animate-pulse rounded-full bg-[#6c8f84]" />正在读取运行进度…</div>}
    <p className="mt-3 text-[10px] text-[#8a928e]">刷新或切换页面后仍可从这里继续；这里只显示可审计步骤，不显示模型内部推理。</p>
  </section>;
}

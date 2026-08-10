"use client";

import { IconChevronRight } from "@tabler/icons-react";
import { LoaderCircleIcon } from "lucide-react";
import {
  memo,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "./utils";

const thinkingStyleId = "lumi-thinking-tool-styles";
const thinkingStyles = `
@keyframes lumi-thinking-shimmer {
  from { background-position: 100% center; }
  to { background-position: 0% center; }
}
@keyframes lumi-thinking-roll {
  from { transform: translateY(30px); }
  to { transform: translateY(-52%); }
}
.lumi-thinking-shimmer {
  color: transparent;
  background-image: linear-gradient(90deg, #a3a3a3 0%, #a3a3a3 40%, #525252 50%, #a3a3a3 60%, #a3a3a3 100%);
  background-repeat: no-repeat;
  background-position: 100% center;
  background-size: 250% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  animation: lumi-thinking-shimmer 1.2s linear infinite;
}
.lumi-thinking-stream {
  position: relative;
  height: 86px;
  overflow: hidden;
  padding: 10px 14px;
  border: 1px solid #e5e5e7;
  border-radius: 12px;
  background: #fff;
}
.lumi-thinking-stream::before,.lumi-thinking-stream::after {
  position: absolute;
  z-index: 2;
  right: 0;
  left: 0;
  height: 28px;
  content: "";
  pointer-events: none;
}
.lumi-thinking-stream::before { top: 0; background: linear-gradient(#fff, rgba(255,255,255,0)); }
.lumi-thinking-stream::after { bottom: 0; background: linear-gradient(rgba(255,255,255,0), #fff); }
.lumi-thinking-roll { animation: lumi-thinking-roll 14s linear infinite; }
.lumi-thinking-roll p { margin: 0 0 4px; color: #6b6b78; font-size: 13px; line-height: 1.8; }
.lumi-thinking-skill {
  display: inline-flex;
  align-items: center;
  margin-right: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  background: #2f7cf6;
  color: #fff;
  font-size: 12.5px;
  font-style: normal;
  font-weight: 500;
  line-height: 1.35;
  vertical-align: 1px;
  white-space: nowrap;
}
.lumi-thinking-timeline {
  margin: 0 0 0 10px;
  padding: 0 0 0 15px;
  border-left: 1px solid #e5e5e7;
  list-style: none;
}
.lumi-thinking-timeline li { position: relative; display: grid; gap: 2px; padding: 0 0 12px 8px; }
.lumi-thinking-timeline li:last-child { padding-bottom: 0; }
.lumi-thinking-dot {
  position: absolute;
  top: 8px;
  left: -18px;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: #8e8ea0;
}
.lumi-thinking-dot[data-state="running"] { background: #1a1a1a; animation: lumi-thinking-shimmer 1.2s linear infinite; }
.lumi-thinking-dot[data-state="error"] { background: #b42318; }
@media (prefers-reduced-motion: reduce) {
  .lumi-thinking-shimmer { color: #737373; background: none; animation: none; }
  .lumi-thinking-roll { animation: none; transform: none; }
  .lumi-thinking-dot[data-state="running"] { animation: none; }
}
`;

function ensureThinkingStyles() {
  if (typeof document === "undefined" || document.getElementById(thinkingStyleId)) return;
  const style = document.createElement("style");
  style.id = thinkingStyleId;
  style.textContent = thinkingStyles;
  document.head.appendChild(style);
}

export type ThinkingToolProps = {
  state?: "thinking" | "thought";
  content?: string;
  steps?: readonly ThinkingToolStep[];
  defaultOpen?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  className?: string;
  thinkingLabel?: string;
  thoughtLabel?: string;
  /** Independent liveness duration; it is never a tool-call timer. */
  elapsedSeconds?: number;
  /** Makes the no-hidden-reasoning fallback explicit to the learner. */
  streamLabel?: string;
};

export type ThinkingToolStep = {
  id?: string;
  label: string;
  detail?: string;
  skillLabel?: string;
  status?: "complete" | "running" | "pending" | "error";
};

function StepLabel({ step }: { step: ThinkingToolStep }) {
  return (
    <>
      {step.skillLabel ? <span className="lumi-thinking-skill">{step.skillLabel}</span> : null}
      <span>{step.label}</span>
    </>
  );
}

export const ThinkingTool = memo(function ThinkingTool({
  state = "thinking",
  content,
  steps,
  defaultOpen = false,
  expanded,
  onToggleExpand,
  className,
  thinkingLabel = "Lumi 正在思考",
  thoughtLabel = "已思考",
  elapsedSeconds = 0,
  streamLabel = "处理步骤摘要",
}: ThinkingToolProps) {
  useEffect(() => {
    ensureThinkingStyles();
  }, []);

  const isControlled = expanded !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const previousState = useRef(state);
  const isOpen = isControlled ? Boolean(expanded) : internalOpen;
  const expandable = Boolean(content || steps?.length);
  const isThinking = state === "thinking";
  const seconds = Math.max(0, Math.floor(elapsedSeconds));

  useEffect(() => {
    if (previousState.current === "thinking" && state === "thought" && !isControlled) {
      setInternalOpen(false);
    }
    previousState.current = state;
  }, [isControlled, state]);

  const handleToggle = () => {
    if (!expandable || isThinking) return;
    if (isControlled) {
      onToggleExpand?.();
    } else {
      setInternalOpen((current) => !current);
    }
  };

  const streamSteps = steps?.length
    ? [...steps.slice(-6), ...steps.slice(-6)]
    : [{ label: "正在保持模型连接并整理回答", status: "running" as const }];

  return (
    <div className={cn("flex w-full flex-col gap-2", className)} data-state={state}>
      <button
        aria-expanded={!isThinking && expandable ? isOpen : undefined}
        className={cn(
          "group m-0 flex max-w-full items-center gap-1 rounded-[6px] border-0 bg-transparent p-0 text-left select-none",
          !isThinking && expandable ? "cursor-pointer" : "cursor-default",
        )}
        disabled={isThinking || !expandable}
        onClick={handleToggle}
        type="button"
      >
        <div className="flex min-w-0 items-center gap-2 text-sm text-neutral-500">
          {isThinking ? <LoaderCircleIcon aria-hidden="true" className="size-3.5 shrink-0 animate-spin" /> : null}
          <span className={cn("shrink-0 font-[450] whitespace-nowrap", isThinking && "lumi-thinking-shimmer")}>
            {isThinking ? thinkingLabel : `${thoughtLabel} ${seconds} 秒`}
          </span>
          {isThinking ? (
            <time
              className="text-xs text-neutral-400"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {seconds}s
            </time>
          ) : null}
        </div>
        {!isThinking && expandable ? (
          <IconChevronRight
            className={cn(
              "size-3 shrink-0 text-neutral-500 transition-transform duration-150 ease-out",
              isOpen ? "rotate-90" : "rotate-0",
            )}
          />
        ) : null}
      </button>
      {isThinking ? (
        <div
          aria-label={`${streamLabel}，不展示模型推理原文`}
          aria-live="polite"
          className="lumi-thinking-stream"
          role="status"
        >
          <div className="lumi-thinking-roll">
            {streamSteps.map((step, index) => (
              <p key={`${step.id ?? step.label}-${index}`}><StepLabel step={step} /></p>
            ))}
          </div>
        </div>
      ) : expandable && isOpen ? (
        <div className="overflow-hidden">
          {steps?.length ? (
            <ol className="lumi-thinking-timeline">
              {steps.map((step, index) => {
                const stepState = step.status ?? "complete";
                return (
                  <li key={step.id ?? `${step.label}-${index}`}>
                    <span aria-hidden="true" className="lumi-thinking-dot" data-state={stepState} />
                    <span className={cn(
                      "min-w-0 leading-5 text-neutral-800",
                      stepState === "pending" && "text-neutral-500",
                      stepState === "error" && "text-red-700",
                    )}>
                      <StepLabel step={step} />
                    </span>
                    {step.detail ? <span className="min-w-0 whitespace-pre-wrap text-xs leading-5 text-neutral-400">{step.detail}</span> : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="m-0 text-sm whitespace-pre-wrap text-neutral-500">{content}</p>
          )}
        </div>
      ) : null}
    </div>
  );
});

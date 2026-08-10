"use client";

import {
  IconChevronsDown,
  IconChevronsUp,
  IconFileDescription,
} from "@tabler/icons-react";
import {
  memo,
  type ReactNode,
  useState,
} from "react";

import { cn } from "./utils";

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("animate-spin", className)}
      fill="none"
      viewBox="0 0 16 16"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeDasharray="28"
        strokeDashoffset="7"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export type Plan = {
  id?: string;
  title: string;
  summary?: string;
};

export type PlanToolProps = {
  state?: "idle" | "pending";
  plan: Plan;
  actions?: ReactNode;
  className?: string;
};

export const PlanTool = memo(function PlanTool({
  state = "idle",
  plan,
  actions,
  className,
}: PlanToolProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const summary = plan.summary?.trim() ?? "";
  const hasSummary = summary.length > 0;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[10px] border border-neutral-200 bg-neutral-100",
        className,
      )}
    >
      <div className="flex h-7 items-center justify-between pr-2.5 pl-3">
        <div className="flex min-w-0 items-center gap-1">
          {state === "pending" ? (
            <Spinner className="h-3 w-3 shrink-0 text-neutral-500" />
          ) : (
            <IconFileDescription className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
          )}
          <span className="truncate text-xs text-neutral-500">
            执行计划 · 需要你确认
          </span>
        </div>
        <button
          aria-label={isExpanded ? "收起详细计划" : "展开详细计划"}
          className="inline-flex size-5 items-center justify-center text-neutral-500"
          onClick={() => setIsExpanded((current) => !current)}
          type="button"
        >
          {isExpanded ? (
            <IconChevronsUp className="h-3.5 w-3.5" />
          ) : (
            <IconChevronsDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div className="border-t border-neutral-200 bg-white pt-2">
        <div className="space-y-1.5">
          <div className="px-3 text-sm text-neutral-900">{plan.title}</div>
          {hasSummary ? (
            <div className="relative">
              <div
                className={cn(
                  "whitespace-pre-wrap px-3 text-sm leading-relaxed text-neutral-500",
                  !isExpanded && "max-h-[94px] overflow-hidden",
                )}
              >
                {summary}
              </div>
              {!isExpanded ? (
                <div className="absolute inset-x-0 bottom-0 h-16 pr-2 pb-2 pl-3.5">
                  <div className="absolute inset-x-0 bottom-0 h-full bg-gradient-to-b from-transparent to-white" />
                  <div className="relative flex h-full items-end justify-between gap-2">
                    <button
                      className="-mx-2 h-5 rounded-[4px] px-1.5 text-xs text-neutral-500 hover:text-neutral-900"
                      onClick={() => setIsExpanded(true)}
                      type="button"
                    >
                      查看详细计划
                    </button>
                    {actions}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="px-3 pb-2 text-xs text-neutral-500">
              暂无计划说明。
            </div>
          )}
        </div>

        {isExpanded || !hasSummary ? (
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-200 bg-neutral-100 pr-2 pb-2 pl-3.5 pt-1.5">
            <button
              className="-mx-2 h-5 rounded-[4px] px-1.5 text-xs text-neutral-500 hover:text-neutral-900"
              onClick={() => setIsExpanded((current) => !current)}
              type="button"
            >
              {isExpanded ? "收起详细计划" : "查看详细计划"}
            </button>
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
});

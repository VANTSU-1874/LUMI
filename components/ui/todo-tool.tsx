"use client";

import {
  memo,
  useEffect,
} from "react";

import { cn } from "./utils";

export type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed" | "failed";
};

export type TodoToolProps = {
  state?: "idle" | "streaming";
  todos?: TodoItem[];
  className?: string;
};

const shimmerStyleId = "agent-elements-todo-shimmer";
const shimmerStyles = `
@keyframes agent-elements-todo-shimmer {
  from { background-position: 100% center; }
  to { background-position: 0% center; }
}
.an-todo-shimmer {
  display: inline-flex;
  align-items: center;
  height: 1rem;
  color: transparent;
  background-image: linear-gradient(90deg, #a3a3a3 0%, #a3a3a3 40%, #525252 50%, #a3a3a3 60%, #a3a3a3 100%);
  background-repeat: no-repeat;
  background-position: 100% center;
  background-size: 250% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  animation: agent-elements-todo-shimmer 1.2s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .an-todo-shimmer {
    color: #737373;
    background: none;
    animation: none;
  }
}
`;

function ensureShimmerStyles() {
  if (typeof document === "undefined" || document.getElementById(shimmerStyleId)) return;
  const style = document.createElement("style");
  style.id = shimmerStyleId;
  style.textContent = shimmerStyles;
  document.head.appendChild(style);
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <line x1="5" x2="19" y1="12" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function FailedIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
    >
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

function TodoStatusIcon({ status }: { status: TodoItem["status"] }) {
  if (status === "completed") {
    return (
      <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full border border-neutral-300">
        <CheckIcon className="size-2 text-neutral-500" />
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full border border-neutral-400">
        <ArrowRightIcon className="size-2 text-neutral-500" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full border border-red-300">
        <FailedIcon className="size-2 text-red-500" />
      </span>
    );
  }
  return <span className="size-3.5 shrink-0 rounded-full border border-neutral-400" />;
}

const TodoListItem = memo(function TodoListItem({ todo }: { todo: TodoItem }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-[2px]">
        <TodoStatusIcon status={todo.status} />
      </div>
      <span
        className={cn(
          "text-sm",
          todo.status === "completed" && "text-neutral-500 line-through",
          todo.status === "pending" && "text-neutral-500",
          todo.status === "in_progress" && "text-neutral-700",
          todo.status === "failed" && "text-red-600",
        )}
      >
        {todo.content}
      </span>
    </div>
  );
});

export const TodoTool = memo(function TodoTool({
  state = "idle",
  todos = [],
  className,
}: TodoToolProps) {
  useEffect(() => {
    ensureShimmerStyles();
  }, []);

  if (state === "streaming" && todos.length === 0) {
    return (
      <div className={cn("text-sm leading-relaxed text-neutral-500", className)}>
        <span className="an-todo-shimmer">正在更新待办…</span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2 text-sm leading-relaxed", className)}>
      {todos.map((todo, index) => (
        <TodoListItem key={`${index}:${todo.content}`} todo={todo} />
      ))}
      {state === "streaming" ? (
        <span className="an-todo-shimmer">正在更新待办…</span>
      ) : null}
    </div>
  );
});

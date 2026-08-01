"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DesignTaskListResponseSchema,
  DesignTaskSchema,
  type DesignTask,
} from "@/lib/agent/design-project-task-contract";

const ACTIVE_TASK_STORAGE_KEY = "chuying-active-design-task";

function messageFrom(raw: unknown, fallback: string) {
  return typeof raw === "object" && raw && "error" in raw && typeof raw.error === "string"
    ? raw.error
    : fallback;
}

export function useDesignTasks(fetchImpl: typeof fetch) {
  const [tasks, setTasks] = useState<DesignTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const tasksRef = useRef<DesignTask[]>([]);

  const storeTasks = useCallback((next: DesignTask[]) => {
    tasksRef.current = next;
    setTasks(next);
  }, []);

  const activateTask = useCallback((taskId?: string) => {
    setActiveTaskId(taskId);
    if (typeof window === "undefined") return;
    if (taskId) window.localStorage.setItem(ACTIVE_TASK_STORAGE_KEY, taskId);
    else window.localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY);
  }, []);

  const createTask = useCallback(async (title?: string) => {
    const response = await fetchImpl("/api/agent/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(title ? { title } : {}),
    });
    const raw: unknown = await response.json();
    if (!response.ok) throw new Error(messageFrom(raw, "暂时无法新建设计任务"));
    const task = DesignTaskSchema.parse(raw);
    storeTasks([task, ...tasksRef.current.filter(({ id }) => id !== task.id)]);
    activateTask(task.id);
    setError("");
    return task;
  }, [activateTask, fetchImpl, storeTasks]);

  useEffect(() => {
    const requestSequence = ++sequence.current;
    const abort = new AbortController();
    fetchImpl("/api/agent/tasks", {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: abort.signal,
    }).then(async (response) => {
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(raw, "设计任务恢复失败"));
      return DesignTaskListResponseSchema.parse(raw).tasks;
    }).then(async (restored) => {
      if (requestSequence !== sequence.current || abort.signal.aborted) return;
      if (restored.length === 0) {
        await createTask();
        return;
      }
      storeTasks(restored);
      const storedTaskId = typeof window === "undefined" ? null : window.localStorage.getItem(ACTIVE_TASK_STORAGE_KEY);
      activateTask(restored.some(({ id, status }) => id === storedTaskId && status === "ACTIVE")
        ? storedTaskId!
        : restored.find(({ status }) => status === "ACTIVE")?.id);
    }).catch((reason) => {
      if (requestSequence === sequence.current && !abort.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "设计任务恢复失败");
      }
    }).finally(() => {
      if (requestSequence === sequence.current && !abort.signal.aborted) setLoading(false);
    });
    return () => abort.abort();
  }, [activateTask, createTask, fetchImpl, storeTasks]);

  const updateTask = useCallback(async (taskId: string, update: { title?: string; status?: "ACTIVE" | "ARCHIVED" }) => {
    const response = await fetchImpl(`/api/agent/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(update),
    });
    const raw: unknown = await response.json();
    if (!response.ok) throw new Error(messageFrom(raw, "暂时无法更新设计任务"));
    const task = DesignTaskSchema.parse(raw);
    const next = tasksRef.current.map((item) => item.id === task.id ? task : item)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    storeTasks(next);
    if (task.status === "ARCHIVED" && activeTaskId === task.id) {
      activateTask(next.find(({ id, status }) => id !== task.id && status === "ACTIVE")?.id);
    }
    if (task.status === "ACTIVE") activateTask(task.id);
    setError("");
    return task;
  }, [activateTask, activeTaskId, fetchImpl, storeTasks]);

  const selectTask = useCallback((taskId: string) => {
    if (tasks.some(({ id, status }) => id === taskId && status === "ACTIVE")) activateTask(taskId);
  }, [activateTask, tasks]);

  return { tasks, activeTaskId, loading, error, createTask, updateTask, selectTask };
}

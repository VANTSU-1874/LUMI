"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentMessageListResponse,
  AgentRun,
  AgentRunCurrentResponse,
  AgentRunIntervention,
  AgentRunInterventionCreateResponse,
  AgentRunInterventionListResponse,
  AgentRunInterventionMode,
} from "@/components/client-api";

import { requestJson } from "./assistant-lab-backend";

const INTERVENABLE_STATUSES = new Set<AgentRun["status"]>([
  "QUEUED",
  "RUNNING",
  "WAITING_APPROVAL",
]);

type SubmissionRecord = {
  fingerprint: string;
  key: string;
  clientMessageId: string;
};

type InterventionSnapshot = {
  taskId?: string;
  enabled: boolean;
  currentRun: AgentRun | null;
  items: AssistantLabInterventionMessage[];
  busy: boolean;
  error: string;
};

export type AssistantLabInterventionMessage = {
  id: string;
  content: string;
  turnId: string | null;
  requestedMode: AgentRunInterventionMode;
  actualMode: AgentRunInterventionMode;
  queueSequence: number;
  status: AgentRunIntervention["status"] | "SAVING";
};

export type AssistantLabInterventionDependencies = {
  createIdempotencyKey?: () => string;
  pollIntervalMs?: number;
};

function createUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (character) => {
      const random = Math.floor(Math.random() * 16);
      const value = character === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    },
  );
}

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function assistantLabInterventionFingerprint(input: {
  sourceRunId: string;
  mode: AgentRunInterventionMode;
  message: string;
}) {
  return JSON.stringify(input);
}

export function assistantLabInterventionStatusLabel(
  intervention: Pick<
    AssistantLabInterventionMessage,
    "status" | "requestedMode" | "actualMode"
  >,
) {
  if (intervention.status === "SAVING") return "正在保存";
  if (
    intervention.requestedMode === "STEER"
    && intervention.actualMode === "FOLLOW_UP"
  ) {
    return "已转为下一轮";
  }
  if (intervention.status === "QUEUED") {
    return intervention.actualMode === "STEER" ? "正在切换方向" : "已排队";
  }
  if (intervention.status === "ACTIVE") return "正在处理";
  if (intervention.status === "COMPLETED") return "已完成";
  if (intervention.status === "FAILED") return "处理失败";
  return "已取消";
}

export function mapAssistantLabInterventions(
  interventions: AgentRunIntervention[],
  messages: AgentMessageListResponse["messages"],
) {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  return interventions.map((intervention): AssistantLabInterventionMessage => {
    const message = messagesById.get(intervention.userMessageId);
    return {
      id: intervention.id,
      content: message?.content ?? "补充消息",
      turnId: message?.turnId ?? null,
      requestedMode: intervention.requestedMode,
      actualMode: intervention.actualMode,
      queueSequence: intervention.queueSequence,
      status: intervention.status,
    };
  });
}

export function useAssistantLabInterventions({
  taskId,
  historyRunId,
  threadRunning,
  dependencies,
}: {
  taskId?: string;
  historyRunId?: string;
  threadRunning: boolean;
  dependencies?: AssistantLabInterventionDependencies;
}) {
  const createIdempotencyKey =
    dependencies?.createIdempotencyKey ?? createUuid;
  const pollIntervalMs = dependencies?.pollIntervalMs ?? 700;
  const [snapshot, setSnapshot] = useState<InterventionSnapshot>({
    taskId,
    enabled: false,
    currentRun: null,
    items: [],
    busy: false,
    error: "",
  });
  const requestSequenceRef = useRef(0);
  const submissionsRef = useRef(new Map<string, SubmissionRecord>());
  const submissionTasksInFlightRef = useRef(new Set<string>());
  const activeSnapshot = snapshot.taskId === taskId
    ? snapshot
    : {
      taskId,
      enabled: false,
      currentRun: null,
      items: [],
      busy: false,
      error: "",
    };

  const refresh = useCallback(async () => {
    const requestedTaskId = taskId;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    if (!requestedTaskId) return;

    try {
      const current = await requestJson<AgentRunCurrentResponse>(
        `/api/agent/runs?taskId=${encodeURIComponent(requestedTaskId)}`,
      );
      if (requestSequenceRef.current !== sequence) return;

      const nextEnabled = Boolean(current.interventionsEnabled);
      setSnapshot((previous) => ({
        ...(previous.taskId === requestedTaskId
          ? previous
          : {
            taskId: requestedTaskId,
            items: [],
            busy: false,
            error: "",
          }),
        enabled: nextEnabled,
        currentRun: current.run,
      }));
      if (!nextEnabled) {
        setSnapshot({
          taskId: requestedTaskId,
          enabled: false,
          currentRun: current.run,
          items: [],
          busy: false,
          error: "",
        });
        return;
      }

      const lookupRunId = current.run?.id ?? historyRunId;
      if (!lookupRunId) {
        setSnapshot((previous) => ({
          taskId: requestedTaskId,
          enabled: true,
          currentRun: current.run,
          items: [],
          busy: previous.taskId === requestedTaskId && previous.busy,
          error: "",
        }));
        return;
      }

      const [listed, messages] = await Promise.all([
        requestJson<AgentRunInterventionListResponse>(
          `/api/agent/runs/${encodeURIComponent(lookupRunId)}/interventions`,
        ),
        requestJson<AgentMessageListResponse>(
          `/api/agent/tasks/${encodeURIComponent(requestedTaskId)}/messages`,
        ),
      ]);
      if (requestSequenceRef.current !== sequence) return;
      const mapped = mapAssistantLabInterventions(
        listed.interventions,
        messages.messages,
      );
      setSnapshot((previous) => {
        const saving = previous.taskId === requestedTaskId && previous.busy
          ? previous.items.filter((item) => item.status === "SAVING")
          : [];
        return {
          taskId: requestedTaskId,
          enabled: true,
          currentRun: current.run,
          items: [
            ...mapped,
            ...saving.filter((item) => (
              !mapped.some((mappedItem) => mappedItem.id === item.id)
            )),
          ],
          busy: previous.taskId === requestedTaskId && previous.busy,
          error: "",
        };
      });
    } catch (reason) {
      if (requestSequenceRef.current !== sequence) return;
      setSnapshot((previous) => ({
        ...(previous.taskId === requestedTaskId
          ? previous
          : {
            taskId: requestedTaskId,
            enabled: false,
            currentRun: null,
            items: [],
            busy: false,
          }),
        error: messageOf(reason, "暂时无法恢复补充消息"),
      }));
    }
  }, [historyRunId, taskId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canIntervene = Boolean(
    activeSnapshot.enabled
    && activeSnapshot.currentRun
    && INTERVENABLE_STATUSES.has(activeSnapshot.currentRun.status),
  );
  const shouldPoll = threadRunning
    || canIntervene
    || activeSnapshot.items.some((item) => (
      item.status === "SAVING"
      || item.status === "QUEUED"
      || item.status === "ACTIVE"
    ));

  useEffect(() => {
    if (!taskId || !shouldPoll) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      await refresh();
      if (!disposed) timer = window.setTimeout(poll, pollIntervalMs);
    };
    timer = window.setTimeout(poll, pollIntervalMs);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pollIntervalMs, refresh, shouldPoll, taskId]);

  const submit = useCallback(async (
    message: string,
    mode: AgentRunInterventionMode,
  ) => {
    const sourceRun = activeSnapshot.currentRun;
    const cleaned = message.trim();
    if (
      !taskId
      || !cleaned
      || !activeSnapshot.enabled
      || !sourceRun
      || !INTERVENABLE_STATUSES.has(sourceRun.status)
      || submissionTasksInFlightRef.current.has(taskId)
    ) {
      return false;
    }

    submissionTasksInFlightRef.current.add(taskId);
    requestSequenceRef.current += 1;
    const fingerprint = assistantLabInterventionFingerprint({
      sourceRunId: sourceRun.id,
      mode,
      message: cleaned,
    });
    const storedSubmission = submissionsRef.current.get(taskId);
    const previous = storedSubmission?.fingerprint === fingerprint
      ? storedSubmission
      : null;
    const key = previous?.key ?? createIdempotencyKey();
    const clientMessageId =
      previous?.clientMessageId ?? `intervention:${key}`;
    submissionsRef.current.set(taskId, { fingerprint, key, clientMessageId });
    const savingId = `saving:${clientMessageId}`;
    setSnapshot((current) => {
      const currentItems = current.taskId === taskId ? current.items : [];
      return {
        taskId,
        enabled: true,
        currentRun: sourceRun,
        items: [
          ...currentItems.filter((item) => item.id !== savingId),
          {
            id: savingId,
            content: cleaned,
            turnId: null,
            requestedMode: mode,
            actualMode: mode,
            queueSequence: Number.MAX_SAFE_INTEGER,
            status: "SAVING",
          },
        ],
        busy: true,
        error: "",
      };
    });

    try {
      const response = await requestJson<AgentRunInterventionCreateResponse>(
        `/api/agent/runs/${encodeURIComponent(sourceRun.id)}/interventions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "idempotency-key": key,
          },
          body: JSON.stringify({
            mode,
            message: {
              id: clientMessageId,
              content: cleaned,
            },
          }),
        },
      );
      submissionsRef.current.delete(taskId);
      setSnapshot((current) => {
        if (current.taskId !== taskId) return current;
        return {
          ...current,
          items: [
            ...current.items.filter((item) => (
              item.id !== savingId && item.id !== response.intervention.id
            )),
            {
              id: response.intervention.id,
              content: cleaned,
              turnId: null,
              requestedMode: response.intervention.requestedMode,
              actualMode: response.intervention.actualMode,
              queueSequence: response.intervention.queueSequence,
              status: response.intervention.status,
            },
          ].sort((left, right) => left.queueSequence - right.queueSequence),
          error: "",
        };
      });
      return true;
    } catch (reason) {
      setSnapshot((current) => current.taskId === taskId
        ? {
          ...current,
          items: current.items.filter((item) => item.id !== savingId),
          error: messageOf(reason, "补充消息保存失败"),
        }
        : current);
      return false;
    } finally {
      submissionTasksInFlightRef.current.delete(taskId);
      setSnapshot((current) => current.taskId === taskId
        ? { ...current, busy: false }
        : current);
      void refresh();
    }
  }, [
    activeSnapshot.currentRun,
    activeSnapshot.enabled,
    createIdempotencyKey,
    refresh,
    taskId,
  ]);

  return {
    enabled: activeSnapshot.enabled,
    currentRun: activeSnapshot.currentRun,
    items: activeSnapshot.items,
    busy: activeSnapshot.busy,
    error: activeSnapshot.error,
    canIntervene,
    refresh,
    submit,
  };
}

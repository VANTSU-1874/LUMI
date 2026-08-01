"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  createClientApi,
  subscribeAgentRun,
  uploadArtworkRun,
  type AgentRun,
  type AgentRunEvent,
  type AgentTurnResult,
  type ClientApi,
  type CourseSummary,
  type CritiqueResult,
  type DesignTask,
  type UploadProgress,
} from "@/components/client-api";
import { CritiqueResultSchema } from "@/lib/agent/critique-contract";

const terminalStatuses = new Set<AgentRun["status"]>(["COMPLETED", "FAILED", "CANCELLED"]);
const pendingStatuses = new Set<AgentRun["status"]>(["QUEUED", "RUNNING"]);

type RunTransportState = "IDLE" | "CONNECTING" | "LIVE" | "POLLING";

type SubmissionRecord = {
  fingerprint: string;
  key: string;
};

export type LumiStudentSessionDependencies = {
  api?: ClientApi;
  subscribe?: typeof subscribeAgentRun;
  upload?: typeof uploadArtworkRun;
  createIdempotencyKey?: () => string;
  pollIntervalMs?: number;
};

function idempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function submissionFingerprint(taskId: string, message: string, artwork?: File | null) {
  return JSON.stringify({
    taskId,
    message,
    artwork: artwork
      ? [artwork.name, artwork.type, artwork.size, artwork.lastModified]
      : null,
  });
}

export function mergeLumiRunEvents(current: AgentRunEvent[], incoming: AgentRunEvent[]) {
  const events = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) events.set(event.sequence, event);
  return [...events.values()].sort((left, right) => left.sequence - right.sequence);
}

function mergeTurn(current: AgentTurnResult[], turn: AgentTurnResult) {
  const exists = current.some((item) => item.turnId === turn.turnId);
  return exists
    ? current.map((item) => item.turnId === turn.turnId ? turn : item)
    : [...current, turn];
}

export function isUsableCritique(value: unknown): value is CritiqueResult {
  return CritiqueResultSchema.safeParse(value).success;
}

function withoutInvalidCritique(turn: AgentTurnResult) {
  const critique = (turn as AgentTurnResult & { critique?: unknown }).critique;
  if (critique === undefined || isUsableCritique(critique)) return turn;
  return { ...turn, critique: undefined };
}

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function useLumiStudentSession({
  demo,
  dependencies,
}: {
  demo: boolean;
  dependencies?: LumiStudentSessionDependencies;
}) {
  const api = useMemo(
    () => dependencies?.api ?? createClientApi({ forceMock: demo }),
    [demo, dependencies?.api],
  );
  const subscribe = dependencies?.subscribe ?? subscribeAgentRun;
  const upload = dependencies?.upload ?? uploadArtworkRun;
  const createKey = dependencies?.createIdempotencyKey ?? idempotencyKey;
  const pollIntervalMs = dependencies?.pollIntervalMs ?? 700;

  const [tasks, setTasks] = useState<DesignTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [currentCourseId, setCurrentCourseId] = useState("");
  const [currentCourseLabel, setCurrentCourseLabel] = useState("设计课程");
  const [turns, setTurns] = useState<AgentTurnResult[]>([]);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [runEvents, setRunEvents] = useState<AgentRunEvent[]>([]);
  const [pendingMessage, setPendingMessage] = useState("");
  const [transportState, setTransportState] = useState<RunTransportState>("IDLE");
  const [loading, setLoading] = useState(true);
  const [entryRequired, setEntryRequired] = useState(false);
  const [error, setError] = useState("");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    phase: "IDLE",
    percent: 0,
    message: "",
  });

  const watcherRef = useRef<(() => void) | null>(null);
  const activeTaskRef = useRef<string | undefined>(undefined);
  const loadedRef = useRef(false);
  const submissionRef = useRef<SubmissionRecord | null>(null);
  const submissionInFlightRef = useRef(false);
  const approvalInFlightRef = useRef(false);
  const approvalKeysRef = useRef(new Map<string, string>());

  useEffect(() => { activeTaskRef.current = activeTaskId; }, [activeTaskId]);

  const exposeError = useCallback((reason: unknown, fallback: string) => {
    if (!demo && reason instanceof ApiError && reason.requiresIdentityGate) {
      setEntryRequired(true);
    }
    setError(messageOf(reason, fallback));
  }, [demo]);

  const stopWatching = useCallback(() => {
    watcherRef.current?.();
    watcherRef.current = null;
  }, []);

  const hydrateCritique = useCallback((turn: AgentTurnResult) => {
    if (turn.critique) return;
    void api.getCritique(turn.turnId).then((response) => {
      const critique: unknown = response.critique;
      if (!isUsableCritique(critique)) return;
      setTurns((current) => current.map((item) => (
        item.turnId === turn.turnId && !item.critique ? { ...item, critique } : item
      )));
    }).catch(() => {
      // Critique is an optional sidecar. Missing, malformed, or unavailable critique
      // must never alter the natural answer, run state, AI mode, or retry behavior.
    });
  }, [api]);

  const ingestRun = useCallback((run: AgentRun) => {
    const safeRun: AgentRun = run.result
      ? { ...run, result: withoutInvalidCritique(run.result) }
      : run;
    setActiveRun(safeRun);
    if (pendingStatuses.has(safeRun.status) && safeRun.request?.message) {
      setPendingMessage(safeRun.request.message);
    }
    if (terminalStatuses.has(safeRun.status)) setPendingMessage("");
    if (safeRun.result) {
      setTurns((current) => mergeTurn(current, safeRun.result!));
      setPendingMessage("");
      hydrateCritique(safeRun.result);
      setUploadProgress((current) => current.phase === "IDLE" ? current : {
        phase: "COMPLETE",
        percent: 100,
        message: "作品与回答已保存",
      });
    }
  }, [hydrateCritique]);

  const watchRun = useCallback((runId: string) => {
    stopWatching();
    setTransportState("CONNECTING");
    let stopped = false;
    let cursor = 0;
    let polling = false;
    let streamConnected = false;
    let pollHadError = false;
    let subscription: ReturnType<typeof subscribe> | null = null;

    const close = () => {
      if (stopped) return;
      stopped = true;
      subscription?.close();
      window.clearInterval(timer);
    };

    const switchToPolling = () => {
      if (stopped) return;
      streamConnected = false;
      setTransportState("POLLING");
    };

    subscription = subscribe(runId, cursor, {
      onEvent: (event) => {
        if (stopped) return;
        cursor = Math.max(cursor, event.sequence);
        setRunEvents((current) => mergeLumiRunEvents(current, [event]));
      },
      onConnection: (connected) => {
        if (stopped) return;
        streamConnected = connected;
        setTransportState(connected ? "LIVE" : "POLLING");
      },
      onTransportError: switchToPolling,
      onError: () => {
        switchToPolling();
        subscription?.close();
      },
    }, { forceMock: demo });

    const poll = async () => {
      if (stopped || polling) return;
      polling = true;
      try {
        const [runResponse, eventPage] = await Promise.all([
          api.getRun(runId),
          streamConnected ? Promise.resolve(null) : api.getEvents(runId, cursor),
        ]);
        if (stopped) return;
        if (eventPage) {
          cursor = Math.max(cursor, eventPage.nextEventSequence - 1);
          setRunEvents((current) => mergeLumiRunEvents(current, eventPage.events));
        }
        if (pollHadError) {
          pollHadError = false;
          setError("");
        }
        ingestRun(runResponse.run);
        if (runResponse.run.status === "WAITING_APPROVAL") {
          close();
          setTransportState("IDLE");
          setError("");
        } else if (terminalStatuses.has(runResponse.run.status)) {
          close();
          setTransportState("IDLE");
          if (runResponse.run.status === "FAILED") {
            setError("这一次没有完成。你可以保留原问题并重试，不需要重新上传作品。");
          } else {
            setError("");
          }
        }
      } catch (reason) {
        if (!stopped) {
          pollHadError = true;
          exposeError(reason, "运行状态暂时无法更新");
          if (!demo && reason instanceof ApiError && reason.requiresIdentityGate) {
            close();
            setTransportState("IDLE");
          }
        }
      } finally {
        polling = false;
      }
    };

    const timer = window.setInterval(() => { void poll(); }, pollIntervalMs);
    void poll();
    watcherRef.current = close;
  }, [api, demo, exposeError, ingestRun, pollIntervalMs, stopWatching, subscribe]);

  const restoreTask = useCallback(async (taskId: string) => {
    stopWatching();
    if (activeTaskRef.current !== taskId) submissionRef.current = null;
    activeTaskRef.current = taskId;
    setActiveTaskId(taskId);
    setTurns([]);
    setRunEvents([]);
    setActiveRun(null);
    setPendingMessage("");
    setTransportState("IDLE");
    setError("");
    const [conversation, current] = await Promise.all([
      api.conversation(taskId),
      api.currentRun(taskId),
    ]);
    if (activeTaskRef.current !== taskId) return;
    const safeTurns = conversation.turns.map(withoutInvalidCritique);
    setTurns(safeTurns);
    setCurrentCourseLabel(conversation.coursePack.label);
    for (const turn of safeTurns) hydrateCritique(turn);
    if (current.run) {
      if (pendingStatuses.has(current.run.status)) {
        setPendingMessage(current.run.request?.message ?? "");
      }
      ingestRun(current.run);
      if (pendingStatuses.has(current.run.status)) watchRun(current.run.id);
    }
  }, [api, hydrateCritique, ingestRun, stopWatching, watchRun]);

  const load = useCallback(async () => {
    setLoading(true);
    setEntryRequired(false);
    setError("");
    try {
      const taskResponse = await api.listTasks();
      let nextTasks = taskResponse.tasks;
      if (nextTasks.length === 0) nextTasks = [await api.createTask("第一段设计对话")];
      setTasks(nextTasks);
      const firstActive = nextTasks.find((task) => task.status === "ACTIVE") ?? nextTasks[0];
      if (!firstActive) throw new Error("暂时无法创建设计对话");

      const courseRequest = demo
        ? api.courses().then((registry) => {
          setCourses(registry.courses);
          setCurrentCourseId(registry.currentCourseId);
          setCurrentCourseLabel(
            registry.courses.find((course) => course.id === registry.currentCourseId)?.label ?? "设计课程",
          );
        }).catch(() => {
          setCourses([]);
          setCurrentCourseId("");
        })
        : Promise.resolve();
      await Promise.all([restoreTask(firstActive.id), courseRequest]);
    } catch (reason) {
      setEntryRequired(Boolean(!demo && reason instanceof ApiError && reason.requiresIdentityGate));
      setError(messageOf(reason, "暂时无法进入学习空间"));
    } finally {
      setLoading(false);
    }
  }, [api, demo, restoreTask]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void load();
    return stopWatching;
  }, [load, stopWatching]);

  const enterStudent = useCallback(async (classCode: string, alias: string) => {
    setLoading(true);
    setError("");
    try {
      await api.enterStudent({ classCode, alias });
      await load();
      return true;
    } catch (reason) {
      setEntryRequired(true);
      setError(messageOf(reason, "班级邀请码或匿名编号无效"));
      return false;
    } finally {
      setLoading(false);
    }
  }, [api, load]);

  const createTask = useCallback(async () => {
    try {
      const task = await api.createTask();
      setTasks((current) => [task, ...current]);
      await restoreTask(task.id);
      return task;
    } catch (reason) {
      exposeError(reason, "暂时无法新建对话");
      return null;
    }
  }, [api, exposeError, restoreTask]);

  const selectTask = useCallback(async (taskId: string) => {
    if (taskId === activeTaskRef.current) return;
    setLoading(true);
    try {
      await restoreTask(taskId);
    } catch (reason) {
      exposeError(reason, "暂时无法恢复这段对话");
    } finally {
      setLoading(false);
    }
  }, [exposeError, restoreTask]);

  const switchCourse = useCallback(async (courseId: string) => {
    if (!demo) return false;
    try {
      const switched = await api.switchCourse(courseId);
      setCurrentCourseId(switched.currentCourseId);
      setCurrentCourseLabel(switched.course.label);
      return true;
    } catch (reason) {
      exposeError(reason, "暂时无法切换课程");
      return false;
    }
  }, [api, demo, exposeError]);

  const submit = useCallback(async (message: string, artwork?: File | null) => {
    const taskId = activeTaskRef.current;
    const cleaned = message.trim() || (artwork ? "请结合这份作品，先做五维总览，再告诉我下一步只改哪里。" : "");
    if (!taskId
      || !cleaned
      || submissionInFlightRef.current
      || (activeRun && !terminalStatuses.has(activeRun.status))) return null;

    submissionInFlightRef.current = true;
    const fingerprint = submissionFingerprint(taskId, cleaned, artwork);
    const previous = submissionRef.current?.fingerprint === fingerprint ? submissionRef.current : null;
    const key = previous?.key ?? createKey();
    submissionRef.current = { fingerprint, key };
    setError("");
    setRunEvents([]);
    setPendingMessage(cleaned);
    setUploadProgress(artwork
      ? { phase: "READING", percent: 0, indeterminate: true, message: "正在检查作品文件…" }
      : { phase: "IDLE", percent: 0, message: "" });
    const request = { taskId, message: cleaned, context: { view: "AGENT" as const } };
    try {
      const created = artwork
        ? await upload({
          request,
          artwork,
          idempotencyKey: key,
          forceMock: demo,
          onProgress: setUploadProgress,
        })
        : await api.createRun(request, key);
      submissionRef.current = null;
      ingestRun(created.run);
      if (pendingStatuses.has(created.run.status)) watchRun(created.run.id);
      return created.run;
    } catch (reason) {
      setPendingMessage("");
      setUploadProgress(artwork
        ? { phase: "FAILED", percent: 0, message: "作品没有上传完成" }
        : { phase: "IDLE", percent: 0, message: "" });
      exposeError(reason, "问题提交失败");
      return null;
    } finally {
      submissionInFlightRef.current = false;
    }
  }, [activeRun, api, createKey, demo, exposeError, ingestRun, upload, watchRun]);

  const cancel = useCallback(async () => {
    if (!activeRun || terminalStatuses.has(activeRun.status)) return;
    try {
      const response = await api.cancelRun(activeRun.id, createKey());
      ingestRun(response.run);
      stopWatching();
      setTransportState("IDLE");
    } catch (reason) {
      exposeError(reason, "暂时无法停止本轮运行");
    }
  }, [activeRun, api, createKey, exposeError, ingestRun, stopWatching]);

  const retry = useCallback(async () => {
    if (!activeRun || activeRun.status !== "FAILED") return;
    try {
      const response = await api.retryRun(activeRun.id, createKey());
      setRunEvents([]);
      ingestRun(response.run);
      watchRun(response.run.id);
    } catch (reason) {
      exposeError(reason, "暂时无法重试本轮运行");
    }
  }, [activeRun, api, createKey, exposeError, ingestRun, watchRun]);

  const resolveApproval = useCallback(async (actionId: string, decision: "APPROVE" | "REJECT") => {
    if (!activeRun
      || activeRun.status !== "WAITING_APPROVAL"
      || !activeRun.result
      || approvalInFlightRef.current
      || !activeRun.result.reply.actions.some((action) => action.id === actionId && action.status === "PROPOSED")) {
      return false;
    }
    approvalInFlightRef.current = true;
    setApprovalBusy(true);
    setError("");
    const keyName = `${activeRun.id}:${actionId}:${decision}`;
    const key = approvalKeysRef.current.get(keyName) ?? createKey();
    approvalKeysRef.current.set(keyName, key);
    try {
      const response = await api.resolveApproval(activeRun.id, actionId, decision, key);
      ingestRun(response.run);
      stopWatching();
      setTransportState("IDLE");
      return true;
    } catch (reason) {
      exposeError(reason, "暂时无法处理这项确认");
      return false;
    } finally {
      approvalInFlightRef.current = false;
      setApprovalBusy(false);
    }
  }, [activeRun, api, createKey, exposeError, ingestRun, stopWatching]);

  const latestTurn = turns.at(-1) ?? null;
  const busy = Boolean(activeRun && !terminalStatuses.has(activeRun.status));
  const transportNotice = transportState === "POLLING"
    ? "实时显示暂时中断，已改用后台状态恢复；本轮不会重复提交。"
    : "";

  return {
    demo,
    api,
    tasks,
    activeTaskId,
    courses,
    currentCourseId,
    currentCourseLabel,
    turns,
    latestTurn,
    activeRun,
    runEvents,
    pendingMessage,
    transportState,
    transportNotice,
    loading,
    busy,
    approvalBusy,
    entryRequired,
    error,
    uploadProgress,
    enterStudent,
    createTask,
    selectTask,
    switchCourse,
    submit,
    cancel,
    retry,
    resolveApproval,
    reload: load,
  };
}

export type LumiStudentSession = ReturnType<typeof useLumiStudentSession>;

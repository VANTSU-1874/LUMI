"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AgentActionExecutionSchema,
  AgentConversationResponseSchema,
  type AgentTurnRequest,
  type AgentTurnResponse,
  type AgentView,
} from "@/lib/agent/contracts";
import type { ProjectBrief } from "@/lib/agent/project-brief-contract";
import {
  AgentRunApprovalResponseSchema,
  AgentRunCancelResponseSchema,
  AgentRunCreateResponseSchema,
  AgentRunCurrentResponseSchema,
  AgentRunEventSchema,
  AgentRunEventsResponseSchema,
  AgentRunRetryResponseSchema,
  AgentRunSchema,
  type AgentRun,
  type AgentRunEvent,
} from "@/lib/agent/runtime/agent-run-event";

class AgentV2DisabledError extends Error {}

function errorMessage(raw: unknown, fallback: string) {
  return typeof raw === "object" && raw && "error" in raw && typeof raw.error === "string" ? raw.error : fallback;
}

async function responseJson(response: Response) {
  try { return await response.json() as unknown; }
  catch { return null; }
}

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

type ExternalSearchConsent = NonNullable<AgentTurnRequest["externalSearchConsent"]>;

async function createExternalSearchConsent(message: string): Promise<ExternalSearchConsent> {
  const browserCrypto = globalThis.crypto;
  if (!browserCrypto?.subtle || typeof browserCrypto.randomUUID !== "function") {
    throw new Error("当前浏览器无法安全生成联网授权，请取消联网后继续提问");
  }
  const normalized = message.normalize("NFKC").trim();
  const digest = await browserCrypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const messageDigest = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return { nonce: browserCrypto.randomUUID(), messageDigest, issuedAt: Date.now() };
}

function mergeTurn(current: AgentTurnResponse[], turn: AgentTurnResponse) {
  const index = current.findIndex((item) => item.turnId === turn.turnId);
  if (index === -1) return [...current, turn];
  return current.map((item, itemIndex) => itemIndex === index ? turn : item);
}

function mergeEvents(current: AgentRunEvent[], incoming: AgentRunEvent[]) {
  const bySequence = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) bySequence.set(event.sequence, event);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

function submissionIdentity(
  message: string,
  focus: string | null,
  artwork?: File | null,
  allowExternalSearch = false,
) {
  return JSON.stringify({
    message,
    focus,
    artwork: artwork ? [artwork.name, artwork.type, artwork.size, artwork.lastModified] : null,
    externalSearchConsent: allowExternalSearch,
  });
}

const ACTIVE_RUN_STATUSES = new Set<AgentRun["status"]>(["QUEUED", "RUNNING", "WAITING_APPROVAL"]);
const POLLABLE_RUN_STATUSES = new Set<AgentRun["status"]>(["QUEUED", "RUNNING", "WAITING_APPROVAL"]);

export function useAgentRun(fetchImpl: typeof fetch, context: AgentView, taskId?: string) {
  const [turns, setTurns] = useState<AgentTurnResponse[]>([]);
  const [projectBrief, setProjectBrief] = useState<ProjectBrief>();
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [runEvents, setRunEvents] = useState<AgentRunEvent[]>([]);
  const [submittedMessage, setSubmittedMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [error, setError] = useState("");
  const [legacyMode, setLegacyMode] = useState(false);
  const [externalSearchAvailable, setExternalSearchAvailable] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [pollVersion, setPollVersion] = useState(0);
  const sequence = useRef(0);
  const nextEventSequence = useRef(1);
  const submission = useRef<{
    identity: string;
    key: string;
    externalSearchConsent?: ExternalSearchConsent;
  } | null>(null);
  const submissionInFlight = useRef(false);
  const controlKeys = useRef(new Map<string, string>());
  const streamConnected = useRef(false);

  const ingestRun = useCallback((run: AgentRun | null) => {
    setActiveRun(run);
    if (!run?.result) return;
    setTurns((current) => mergeTurn(current, run.result!));
    if (run.result.projectBrief) setProjectBrief(run.result.projectBrief);
    setSubmittedMessage(run.result.studentMessage);
  }, []);
  const activeRunId = activeRun?.id;
  const activeRunStatus = activeRun?.status;

  useEffect(() => {
    const requestSequence = ++sequence.current;
    const abort = new AbortController();
    Promise.resolve().then(async () => {
      if (requestSequence === sequence.current && !abort.signal.aborted) {
        setLoading(true);
        setError("");
      }
      const conversationQuery = new URLSearchParams({ view: context });
      const runQuery = new URLSearchParams();
      if (taskId) {
        conversationQuery.set("taskId", taskId);
        runQuery.set("taskId", taskId);
      }
      const [conversationResponse, runResponse] = await Promise.all([
        fetchImpl(`/api/agent/conversation?${conversationQuery.toString()}`, {
          method: "GET", cache: "no-store", headers: { accept: "application/json" }, signal: abort.signal,
        }),
        fetchImpl(`/api/agent/runs?${runQuery.toString()}`, {
          method: "GET", cache: "no-store", headers: { accept: "application/json" }, signal: abort.signal,
        }),
      ]);
      const [conversationRaw, runRaw] = await Promise.all([
        responseJson(conversationResponse), responseJson(runResponse),
      ]);
      if (!conversationResponse.ok) {
        const message = errorMessage(conversationRaw, "会话恢复失败");
        if (conversationResponse.status === 404 && message.includes("新版智能体暂未启用")) throw new AgentV2DisabledError(message);
        throw new Error(message);
      }
      if (!runResponse.ok) throw new Error(errorMessage(runRaw, "运行恢复失败"));
      return {
        conversation: AgentConversationResponseSchema.parse(conversationRaw),
        current: AgentRunCurrentResponseSchema.parse(runRaw),
      };
    }).then(({ conversation, current }) => {
      if (requestSequence !== sequence.current || abort.signal.aborted) return;
      setTurns(conversation.turns);
      setProjectBrief(conversation.projectBrief);
      setLegacyMode(false);
      setExternalSearchAvailable(conversation.features.externalSearch);
      setRunEvents([]);
      nextEventSequence.current = 1;
      setSubmittedMessage(current.run?.result?.studentMessage ?? current.run?.request?.message ?? "");
      ingestRun(current.run);
    }).catch((reason) => {
      if (requestSequence !== sequence.current || abort.signal.aborted) return;
      if (reason instanceof AgentV2DisabledError) {
        setLegacyMode(true);
        setExternalSearchAvailable(false);
        setError("");
      } else {
        setExternalSearchAvailable(false);
        setError(reason instanceof Error ? reason.message : "会话恢复失败");
      }
    }).finally(() => {
      if (requestSequence === sequence.current && !abort.signal.aborted) setLoading(false);
    });
    return () => { abort.abort(); };
  }, [context, fetchImpl, ingestRun, reloadVersion, taskId]);

  useEffect(() => {
    if (!activeRunId || !activeRunStatus || !POLLABLE_RUN_STATUSES.has(activeRunStatus) || typeof EventSource === "undefined") return;
    const after = Math.max(0, nextEventSequence.current - 1);
    const source = new EventSource(`/api/agent/runs/${activeRunId}/events/stream?after=${after}`);
    const onEvent = (message: MessageEvent<string>) => {
      try {
        const event = AgentRunEventSchema.parse(JSON.parse(message.data));
        if (event.sequence < nextEventSequence.current) return;
        nextEventSequence.current = event.sequence + 1;
        setRunEvents((current) => mergeEvents(current, [event]));
      } catch {
        streamConnected.current = false;
      }
    };
    source.onopen = () => { streamConnected.current = true; };
    source.onerror = () => { streamConnected.current = false; };
    source.addEventListener("agent-run-event", onEvent as EventListener);
    return () => {
      streamConnected.current = false;
      source.removeEventListener("agent-run-event", onEvent as EventListener);
      source.close();
    };
  }, [activeRunId, activeRunStatus]);

  useEffect(() => {
    if (!activeRunId || activeRunStatus === "COMPLETED") return;
    const runId = activeRunId;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const poll = async () => {
      try {
        const after = Math.max(0, nextEventSequence.current - 1);
        const eventsRequest = streamConnected.current ? null : fetchImpl(`/api/agent/runs/${runId}/events?after=${after}&limit=100`, {
          method: "GET", cache: "no-store", headers: { accept: "application/json" }, signal: abort.signal,
        });
        const [eventsResponse, runResponse] = await Promise.all([
          eventsRequest,
          fetchImpl(`/api/agent/runs/${runId}`, {
            method: "GET", cache: "no-store", headers: { accept: "application/json" }, signal: abort.signal,
          }),
        ]);
        const [eventsRaw, runRaw] = await Promise.all([
          eventsResponse ? responseJson(eventsResponse) : Promise.resolve(null),
          responseJson(runResponse),
        ]);
        if (eventsResponse && !eventsResponse.ok) throw new Error(errorMessage(eventsRaw, "运行事件暂时无法更新"));
        if (!runResponse.ok) throw new Error(errorMessage(runRaw, "运行状态暂时无法更新"));
        const eventPage = eventsResponse ? AgentRunEventsResponseSchema.parse(eventsRaw) : null;
        const run = AgentRunSchema.parse((runRaw as { run?: unknown } | null)?.run);
        if (stopped || abort.signal.aborted) return;
        if (eventPage) {
          nextEventSequence.current = Math.max(nextEventSequence.current, eventPage.nextEventSequence);
          setRunEvents((current) => mergeEvents(current, eventPage.events));
        }
        ingestRun(run);
        setError("");
        if (POLLABLE_RUN_STATUSES.has(run.status)) {
          timer = setTimeout(poll, run.status === "WAITING_APPROVAL" ? 1_500 : 700);
        }
      } catch (reason) {
        if (stopped || abort.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "运行状态暂时无法更新");
        timer = setTimeout(poll, 1_500);
      }
    };

    void poll();
    return () => {
      stopped = true;
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [activeRunId, activeRunStatus, fetchImpl, ingestRun, pollVersion]);

  const ask = useCallback(async (
    message: string,
    focus?: string | null,
    artwork?: File | null,
    allowExternalSearch = false,
  ) => {
    const cleaned = message.trim();
    if (
      !cleaned
      || loading
      || submitting
      || submissionInFlight.current
      || controlling
      || (activeRun && ACTIVE_RUN_STATUSES.has(activeRun.status))
    ) return null;
    submissionInFlight.current = true;
    const normalizedFocus = focus ?? null;
    const externalSearchRequested = externalSearchAvailable && allowExternalSearch;
    const identity = submissionIdentity(cleaned, normalizedFocus, artwork, externalSearchRequested);
    setSubmitting(true);
    setError("");
    setSubmittedMessage(cleaned);
    try {
      const previousSubmission = submission.current?.identity === identity ? submission.current : null;
      const idempotencyKey = previousSubmission?.key ?? newIdempotencyKey();
      const externalSearchConsent = externalSearchRequested
        ? previousSubmission?.externalSearchConsent ?? await createExternalSearchConsent(cleaned)
        : undefined;
      submission.current = { identity, key: idempotencyKey, externalSearchConsent };
      const payload = {
        taskId,
        message: cleaned,
        context: { view: context, focus: normalizedFocus },
        ...(externalSearchConsent ? { externalSearchConsent } : {}),
      };
      const form = artwork ? new FormData() : null;
      if (form && artwork) {
        form.set("payload", JSON.stringify(payload));
        form.set("artwork", artwork);
      }
      const response = await fetchImpl("/api/agent/runs", form ? {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: form,
      } : {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(payload),
      });
      const raw = await responseJson(response);
      if (!response.ok) throw new Error(errorMessage(raw, "问题提交失败"));
      const created = AgentRunCreateResponseSchema.parse(raw);
      submission.current = null;
      nextEventSequence.current = 1;
      setRunEvents([]);
      ingestRun(created.run);
      setPollVersion((current) => current + 1);
      return created.run;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "问题提交失败");
      return null;
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  }, [activeRun, context, controlling, externalSearchAvailable, fetchImpl, ingestRun, loading, submitting, taskId]);

  const control = useCallback(async (kind: "cancel" | "retry") => {
    if (!activeRun || controlling) return null;
    const keyName = `${kind}:${activeRun.id}:${activeRun.attempt}`;
    const idempotencyKey = controlKeys.current.get(keyName) ?? newIdempotencyKey();
    controlKeys.current.set(keyName, idempotencyKey);
    setControlling(true);
    setError("");
    try {
      const response = await fetchImpl(`/api/agent/runs/${activeRun.id}/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
      });
      const raw = await responseJson(response);
      if (!response.ok) throw new Error(errorMessage(raw, kind === "cancel" ? "停止运行失败" : "重试运行失败"));
      const result = kind === "cancel"
        ? AgentRunCancelResponseSchema.parse(raw)
        : AgentRunRetryResponseSchema.parse(raw);
      ingestRun(result.run);
      setPollVersion((current) => current + 1);
      return result.run;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : kind === "cancel" ? "停止运行失败" : "重试运行失败");
      return null;
    } finally {
      setControlling(false);
    }
  }, [activeRun, controlling, fetchImpl, ingestRun]);

  const execute = useCallback(async (
    turn: AgentTurnResponse,
    actionId: string,
    decision: "APPROVE" | "REJECT" = "APPROVE",
  ) => {
    const durable = activeRun?.status === "WAITING_APPROVAL" && activeRun.result?.turnId === turn.turnId;
    if (durable) {
      const keyName = `approval:${activeRun.id}:${actionId}:${decision}`;
      const idempotencyKey = controlKeys.current.get(keyName) ?? newIdempotencyKey();
      controlKeys.current.set(keyName, idempotencyKey);
      const response = await fetchImpl(`/api/agent/runs/${activeRun.id}/approvals/${actionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, idempotencyKey }),
      });
      const raw = await responseJson(response);
      if (!response.ok) throw new Error(errorMessage(raw, "行动确认失败"));
      const result = AgentRunApprovalResponseSchema.parse(raw);
      ingestRun(result.run);
      setPollVersion((current) => current + 1);
      return { navigation: result.action.navigation };
    }
    if (decision === "REJECT") throw new Error("历史行动无需执行即可保留当前回答");
    const actionKey = `${turn.turnId}:${actionId}`;
    const idempotencyKey = controlKeys.current.get(actionKey) ?? newIdempotencyKey();
    controlKeys.current.set(actionKey, idempotencyKey);
    const response = await fetchImpl("/api/agent/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnId: turn.turnId, actionId, idempotencyKey }),
    });
    const raw = await responseJson(response);
    if (!response.ok) throw new Error(errorMessage(raw, "行动执行失败"));
    const result = AgentActionExecutionSchema.parse(raw);
    setTurns((current) => current.map((item) => item.turnId !== turn.turnId ? item : ({
      ...item,
      reply: {
        ...item.reply,
        actions: item.reply.actions.map((action) => action.id === actionId ? { ...action, status: "EXECUTED" as const } : action),
      },
    })));
    return { navigation: result.navigation };
  }, [activeRun, fetchImpl, ingestRun]);

  const canReject = useCallback((turn: AgentTurnResponse) => (
    activeRun?.status === "WAITING_APPROVAL" && activeRun.result?.turnId === turn.turnId
  ), [activeRun]);
  const reload = useCallback(() => setReloadVersion((current) => current + 1), []);
  const pending = submitting || controlling || Boolean(activeRun && ACTIVE_RUN_STATUSES.has(activeRun.status));
  const runBusy = submitting || controlling;

  return useMemo(() => ({
    turns, projectBrief, activeRun, runEvents, submittedMessage,
    loading, pending, runBusy, error, legacyMode, externalSearchAvailable,
    ask, execute, canReject,
    cancel: () => control("cancel"),
    retry: () => control("retry"),
    reload,
  }), [
    activeRun, ask, canReject, control, error, execute, externalSearchAvailable, legacyMode, loading, pending,
    projectBrief, reload, runBusy, runEvents, submittedMessage, turns,
  ]);
}

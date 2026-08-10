"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { DemoBadge } from "@/components/common/DemoBadge";
import { StudentMemoryCollectionSchema, type StudentMemoryCollection, type StudentMemoryPublic } from "@/lib/domain/student-memory";

const KIND_LABELS: Record<StudentMemoryPublic["kind"], string> = {
  LEARNED_CONCEPT: "已掌握概念",
  RECURRING_STRUGGLE: "反复卡点",
  PREFERENCE: "学习偏好",
  PROJECT_FACT: "项目事实",
  MISCONCEPTION_CORRECTED: "已纠正误解",
};

function memorySummary(memory: StudentMemoryPublic) {
  const normalized = memory.content.replace(/\s+/g, " ").trim();
  return normalized.length > 28 ? `${normalized.slice(0, 28)}…` : normalized;
}

export function StudentMemoryList({
  classId,
  studentId,
  collection,
  includeDemo = false,
  fetcher = fetch,
  onDeleted,
  onLoaded,
}: {
  classId?: string;
  studentId: string;
  collection: StudentMemoryCollection;
  includeDemo?: boolean;
  fetcher?: typeof fetch;
  onDeleted?: (id: string) => void | Promise<void>;
  onLoaded?: (items: StudentMemoryPublic[], total: number) => void | Promise<void>;
}) {
  const titleId = useId();
  const dialogTitleId = useId();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const pendingRequest = useRef<symbol | null>(null);
  const loadingRequest = useRef<symbol | null>(null);
  const mounted = useRef(true);
  const identity = useRef(`${classId ?? ""}\u0000${studentId}`);
  const opener = useRef<HTMLButtonElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const status = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => { if (confirming) cancelButton.current?.focus(); }, [confirming]);
  useEffect(() => { if (message.startsWith("记忆已删除")) status.current?.focus(); }, [message]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  function closeDialog() {
    setConfirming(null);
    queueMicrotask(() => opener.current?.focus());
  }

  function trapDialog(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) { event.preventDefault(); closeDialog(); return; }
    if (event.key !== "Tab") return;
    const first = cancelButton.current;
    const last = confirmButton.current;
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function remove(memory: StudentMemoryPublic) {
    if (pendingRequest.current || !classId) return;
    const requestToken = Symbol("student-memory-delete");
    pendingRequest.current = requestToken;
    const requestIdentity = identity.current;
    let serverDeleted = false;
    setPending(memory.id);
    setMessage("");
    try {
      const response = await fetcher(
        `/api/teacher/learners/${encodeURIComponent(studentId)}/memories/${encodeURIComponent(memory.id)}?classId=${encodeURIComponent(classId)}`,
        { method: "DELETE", cache: "no-store" },
      );
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => undefined);
        throw new Error(typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "删除失败，请重试");
      }
      serverDeleted = true;
      if (!mounted.current || identity.current !== requestIdentity) return;
      let synchronizationFailed = false;
      try { await onDeleted?.(memory.id); }
      catch { synchronizationFailed = true; }
      if (!mounted.current || identity.current !== requestIdentity) return;
      setConfirming(null);
      setMessage(synchronizationFailed ? "记忆已删除，但列表刷新失败，请刷新页面" : "记忆已删除");
    } catch (error) {
      if (!mounted.current || identity.current !== requestIdentity) return;
      if (serverDeleted) setConfirming(null);
      setMessage(serverDeleted ? "记忆已删除，但列表刷新失败，请刷新页面" : error instanceof Error ? error.message : "删除失败，请重试");
    } finally {
      if (pendingRequest.current === requestToken) pendingRequest.current = null;
      if (mounted.current && identity.current === requestIdentity) setPending(null);
    }
  }

  async function loadMore() {
    if (loadingRequest.current || !classId || !onLoaded) return;
    const requestToken = Symbol("student-memory-page");
    loadingRequest.current = requestToken;
    const requestIdentity = identity.current;
    setLoadingMore(true);
    setLoadError("");
    try {
      const response = await fetcher(
        `/api/teacher/learners/${encodeURIComponent(studentId)}/memories?classId=${encodeURIComponent(classId)}&limit=100&offset=${collection.items.length}${includeDemo ? "&includeDemo=true" : ""}`,
        { cache: "no-store" },
      );
      const payload: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        throw new Error(typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "更多记忆加载失败，请重试");
      }
      const page = StudentMemoryCollectionSchema.parse(payload);
      if (!mounted.current || identity.current !== requestIdentity) return;
      await onLoaded(page.items, page.meta.total);
    } catch (error) {
      if (mounted.current && identity.current === requestIdentity) {
        setLoadError(error instanceof Error ? error.message : "更多记忆加载失败，请重试");
      }
    } finally {
      if (loadingRequest.current === requestToken) loadingRequest.current = null;
      if (mounted.current && identity.current === requestIdentity) setLoadingMore(false);
    }
  }

  const selected = collection.items.find((memory) => memory.id === confirming);
  return <section aria-labelledby={titleId} className="rounded-2xl border border-[#dce4df] bg-[#f8fbf9] p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-semibold text-[#17332d]" id={titleId}>长期学习记忆</h3><p className="mt-1 text-sm text-[#58706a]">跨项目、跨会话保留；写入前已自动遮蔽手机号、邮箱和已配置学号。</p></div>
      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[#58706a]">{collection.meta.total} 条</span>
    </div>
    {collection.meta.truncated ? <p className="mt-3 text-sm text-amber-800">当前显示 {collection.meta.returned}/{collection.meta.total} 条重要记忆。</p> : null}
    {collection.items.length ? <ul className="mt-4 space-y-3">{collection.items.map((memory) => <li className="rounded-xl border border-[#dce4df] bg-white p-4" key={memory.id}>
      <div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-[#0d6858]">{KIND_LABELS[memory.kind]}</strong><span className="rounded-full bg-[#edf5f0] px-2 py-1 text-xs text-[#3f5f56]">重要度 {memory.salience}</span>{memory.dataType === "DEMONSTRATION_DATA" ? <DemoBadge /> : null}</div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#27322f]">{memory.content}</p>
      {memory.studentDisputed ? <aside aria-label="学生异议" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <strong>学生已对这条学习信号提出异议</strong>
        <p className="mt-1 whitespace-pre-wrap break-words">{memory.studentDisputeNote ?? "学生未补充说明。"}</p>
        <p className="mt-1 text-xs text-amber-800">原始记录保留不变{memory.studentDisputedAt ? ` · 异议提交于 ${new Date(memory.studentDisputedAt).toLocaleString("zh-CN", { timeZone: "UTC" })} UTC` : ""}</p>
      </aside> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#71847f]"><span>记录于 {new Date(memory.createdAt).toLocaleString("zh-CN", { timeZone: "UTC" })} UTC{memory.lastUsedAt ? ` · 导师上次调用 ${new Date(memory.lastUsedAt).toLocaleString("zh-CN", { timeZone: "UTC" })} UTC` : " · 尚未召回"}</span>{classId ? <button aria-label={`删除记忆 ${KIND_LABELS[memory.kind]}：${memorySummary(memory)}`} className="rounded-lg border border-red-300 px-3 py-2 font-semibold text-red-800 disabled:opacity-50" disabled={Boolean(pending)} onClick={(event) => { opener.current = event.currentTarget; setConfirming(memory.id); setMessage(""); }} type="button">删除记忆</button> : null}</div>
    </li>)}</ul> : <p className="mt-4 rounded-xl bg-white p-4 text-sm text-[#71847f]">暂无长期记忆。导师后续只会保存对持续辅导有用的概念、卡点、偏好和项目事实。</p>}
    {collection.meta.truncated && classId && onLoaded ? <button className="mt-4 rounded-xl border border-[#178b73] bg-white px-4 py-2 text-sm font-bold text-[#0d6858] disabled:opacity-50" disabled={loadingMore} onClick={() => void loadMore()} type="button">{loadingMore ? "正在加载…" : "加载更多长期记忆"}</button> : null}
    {loadError ? <p className="mt-3 text-sm text-red-800" role="alert">{loadError}</p> : null}
    {selected ? <div aria-labelledby={dialogTitleId} aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onKeyDown={trapDialog} role="dialog"><div className="max-w-md rounded-2xl bg-white p-6 shadow-xl"><h4 className="text-xl font-bold" id={dialogTitleId}>确认删除这条长期记忆</h4><p className="mt-2">将删除“{KIND_LABELS[selected.kind]}：{memorySummary(selected)}”。本次仅删除独立长期记忆条目，后续召回不再使用它；原始对话和当前任务摘要不在本次删除范围内。操作不可恢复。</p><div className="mt-5 flex justify-end gap-3"><button disabled={Boolean(pending)} onClick={closeDialog} ref={cancelButton} type="button">取消</button><button className="rounded-lg bg-red-700 px-3 py-2 text-white disabled:opacity-50" disabled={pending === selected.id} onClick={() => void remove(selected)} ref={confirmButton} type="button">确认删除记忆</button></div></div></div> : null}
    {message ? <p aria-label="记忆删除状态" aria-live="polite" className={`mt-3 text-sm ${message.startsWith("记忆已删除") ? "text-[#0d6858]" : "text-red-800"}`} ref={status} role={message.startsWith("记忆已删除") ? "status" : "alert"} tabIndex={-1}>{message}</p> : null}
  </section>;
}

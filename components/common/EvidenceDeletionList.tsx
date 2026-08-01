"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

type Item = { id: string; label: string };

export function EvidenceDeletionList({ items, fetcher = fetch, onDeleted }: { items: Item[]; fetcher?: typeof fetch; onDeleted?: (id: string) => void | Promise<void> }) {
  const titleId = useId();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const opener = useRef<HTMLButtonElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const status = useRef<HTMLParagraphElement | null>(null);
  const mounted = useRef(true);

  useEffect(() => { if (confirming) cancelButton.current?.focus(); }, [confirming]);
  useEffect(() => { if (message.startsWith("证据已删除")) status.current?.focus(); }, [message]);
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
    const first = cancelButton.current; const last = confirmButton.current;
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function remove(item: Item) {
    if (pending) return;
    setPending(item.id); setMessage("");
    try {
      const response = await fetcher(`/api/evidence/${encodeURIComponent(item.id)}`, { method: "DELETE", cache: "no-store" });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => undefined);
        throw new Error(typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string" ? payload.error : "删除失败，请重试");
      }
      setConfirming(null);
      let synchronizationFailed = false;
      try { await onDeleted?.(item.id); }
      catch { synchronizationFailed = true; }
      if (!mounted.current) return;
      setMessage(synchronizationFailed ? "证据已删除，但列表刷新失败，请刷新页面" : "证据已删除");
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "删除失败，请重试");
    } finally { if (mounted.current) setPending(null); }
  }

  if (items.length === 0 && !message) return null;
  const selected = items.find((item) => item.id === confirming);
  return <section aria-labelledby={titleId} className="rounded-2xl border border-slate-200 bg-white p-4"><h3 id={titleId} className="font-semibold">管理已提交证据</h3><p className="mt-1 text-sm text-slate-600">删除后不可恢复；系统不会在页面中显示私有存储路径。</p>{items.length ? <ul className="mt-3 space-y-2">{items.map((item) => <li className="flex flex-wrap items-center justify-between gap-2" key={item.id}><span>{item.label}</span><button className="rounded-lg border border-red-300 px-3 py-2 text-red-800" onClick={(event) => { opener.current = event.currentTarget; setConfirming(item.id); setMessage(""); }} type="button">删除证据 {item.label}</button></li>)}</ul> : null}{selected ? <div aria-labelledby="delete-dialog-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" onKeyDown={trapDialog} role="dialog"><div className="max-w-md rounded-2xl bg-white p-6 shadow-xl"><h4 className="text-xl font-bold" id="delete-dialog-title">确认删除 {selected.label}</h4><p className="mt-2">此操作会删除数据库记录和私有文件，且不可恢复。</p><div className="mt-5 flex justify-end gap-3"><button disabled={Boolean(pending)} onClick={closeDialog} ref={cancelButton} type="button">取消</button><button className="rounded-lg bg-red-700 px-3 py-2 text-white disabled:opacity-50" disabled={pending === selected.id} onClick={() => void remove(selected)} ref={confirmButton} type="button">确认删除 {selected.label}</button></div></div></div> : null}{message ? <p aria-label="删除状态" className="mt-3" ref={status} role="status" tabIndex={-1}>{message}</p> : null}</section>;
}

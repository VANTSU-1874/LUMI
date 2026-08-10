"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { EvidenceDeletionList } from "./EvidenceDeletionList";

const EvidenceHistoryResponseSchema = z.object({
  items: z.array(z.object({
    id: z.uuid(),
    projectId: z.string().min(1),
    classId: z.string().min(1),
    studentId: z.string().min(1),
    ownerAlias: z.string().min(1),
    kind: z.enum(["VALUE", "TEXT", "VIDEO_LINK", "IMAGE", "PROBE"]),
    signalLayer: z.enum(["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"]),
    label: z.string().min(1),
    verificationStatus: z.enum(["SUBMITTED", "RULE_VERIFIED", "TEACHER_VERIFIED", "REJECTED"]),
    createdAt: z.iso.datetime(),
    dataType: z.enum(["REAL", "DEMONSTRATION_DATA"]),
  })).max(50),
  nextCursor: z.string().min(1).max(512).nullable(),
}).strict();

type EvidenceItem = z.infer<typeof EvidenceHistoryResponseSchema>["items"][number];

function evidenceLabel(item: EvidenceItem) {
  const provenance = item.dataType === "DEMONSTRATION_DATA" ? " · 演示数据" : "";
  const verification = {
    SUBMITTED: "已提交",
    RULE_VERIFIED: "规则已验证",
    TEACHER_VERIFIED: "教师已验证",
    REJECTED: "未通过",
  }[item.verificationStatus];
  return `${item.ownerAlias} · ${item.signalLayer} · ${item.kind} · ${item.label} · ${verification} · 项目 ${item.projectId}${provenance}`;
}

export function EvidenceHistory({ fetcher = fetch, onDeleted, refreshToken }: { fetcher?: typeof fetch; onDeleted?: (id: string) => void | Promise<void>; refreshToken?: string | number }) {
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [synchronizationError, setSynchronizationError] = useState("");
  const sequence = useRef(0);
  const synchronizationSequence = useRef(0);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const previousRefreshToken = useRef(refreshToken);

  const load = useCallback(async (cursor?: string) => {
    const requestSequence = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const response = await fetcher(`/api/evidence?limit=20${suffix}`, {
        method: "GET", cache: "no-store", headers: { accept: "application/json" }, signal: abort.signal,
      });
      const raw: unknown = await response.json();
      if (requestSequence !== sequence.current || abort.signal.aborted) return;
      if (!response.ok) {
        throw new Error(typeof raw === "object" && raw && "error" in raw && typeof raw.error === "string" ? raw.error : "历史证据加载失败");
      }
      const parsed = EvidenceHistoryResponseSchema.safeParse(raw);
      if (!parsed.success) throw new Error("历史证据响应无效");
      setItems((current) => cursor ? [...current, ...parsed.data.items] : parsed.data.items);
      setNextCursor(parsed.data.nextCursor);
      setLoaded(true);
    } catch (reason) {
      if (requestSequence === sequence.current && !abort.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "历史证据加载失败");
      }
    } finally {
      if (requestSequence === sequence.current) {
        controller.current = null;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [fetcher]);

  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    mounted.current = true;
    void loadRef.current();
    return () => {
      mounted.current = false;
      sequence.current += 1;
      synchronizationSequence.current += 1;
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (previousRefreshToken.current === refreshToken) return;
    previousRefreshToken.current = refreshToken;
    void loadRef.current();
  }, [refreshToken]);

  async function evidenceDeleted(id: string) {
    const syncSequence = ++synchronizationSequence.current;
    setItems([]);
    setNextCursor(null);
    setLoaded(false);
    setSynchronizationError("");
    const reload = load();
    if (!onDeleted) { await reload; return; }
    try {
      await Promise.all([reload, Promise.resolve(onDeleted(id))]);
    } catch {
      if (mounted.current && syncSequence === synchronizationSequence.current) {
        setSynchronizationError("证据已删除，但工作台数据刷新失败，请重试页面刷新");
      }
    }
  }

  return <section aria-labelledby="evidence-history-title" className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <div>
      <h2 className="text-xl font-bold" id="evidence-history-title">全部历史证据</h2>
      <p className="mt-1 text-sm text-slate-600">按提交时间查看有权限访问的全部项目证据，每次加载 20 条。</p>
    </div>
    {loading && !loaded ? <p aria-live="polite">正在加载历史证据…</p> : null}
    {error ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-50 p-3"><p role="alert">{error}</p><button type="button" onClick={() => void load()}>重试加载历史证据</button></div> : null}
    {synchronizationError ? <p className="rounded-xl bg-red-50 p-3" role="alert">{synchronizationError}</p> : null}
    {!error && loaded && items.length === 0 ? <p role="status">没有可显示的历史证据</p> : null}
    <EvidenceDeletionList
      fetcher={fetcher}
      items={items.map((item) => ({ id: item.id, label: evidenceLabel(item) }))}
      onDeleted={evidenceDeleted}
    />
    {nextCursor ? <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold disabled:opacity-50" disabled={loadingMore} onClick={() => void load(nextCursor)} type="button">{loadingMore ? "正在加载…" : "加载更早证据"}</button> : null}
  </section>;
}

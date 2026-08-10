"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  StudentMemoryCollectionSchema,
  StudentMemoryPublicSchema,
  isStudentMemoryTierOneKind,
  type StudentMemoryCollection,
  type StudentMemoryPublic,
} from "@/lib/domain/student-memory";

import styles from "./student-memory-settings.module.css";

const KIND_LABELS: Record<StudentMemoryPublic["kind"], string> = {
  LEARNED_CONCEPT: "已掌握概念",
  RECURRING_STRUGGLE: "反复卡点",
  PREFERENCE: "学习偏好",
  PROJECT_FACT: "项目事实",
  MISCONCEPTION_CORRECTED: "已纠正误解",
};

async function responseError(response: Response, fallback: string) {
  const payload: unknown = await response.json().catch(() => undefined);
  return typeof payload === "object"
    && payload !== null
    && "error" in payload
    && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

export function StudentMemorySettings({
  fetcher = fetch,
}: {
  fetcher?: typeof fetch;
}) {
  const [collection, setCollection] = useState<StudentMemoryCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState("");

  const loadPage = useCallback(async (offset: number) => {
    const response = await fetcher(`/api/agent/memories?limit=100&offset=${offset}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(await responseError(response, "长期记忆加载失败，请重试"));
    return StudentMemoryCollectionSchema.parse(await response.json());
  }, [fetcher]);

  useEffect(() => {
    let active = true;
    void loadPage(0)
      .then((page) => {
        if (active) setCollection(page);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "长期记忆加载失败，请重试");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadPage]);

  const tierOne = useMemo(
    () => collection?.items.filter((memory) => isStudentMemoryTierOneKind(memory.kind)) ?? [],
    [collection],
  );
  const tierTwo = useMemo(
    () => collection?.items.filter((memory) => !isStudentMemoryTierOneKind(memory.kind)) ?? [],
    [collection],
  );

  async function remove(memory: StudentMemoryPublic) {
    if (pendingId) return;
    setPendingId(memory.id);
    setStatus("");
    setError("");
    try {
      const response = await fetcher(`/api/agent/memories/${encodeURIComponent(memory.id)}`, {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: memory.kind }),
      });
      if (!response.ok) throw new Error(await responseError(response, "记忆删除失败，请重试"));
      setCollection((current) => current ? {
        items: current.items.filter(({ id }) => id !== memory.id),
        meta: {
          total: Math.max(0, current.meta.total - 1),
          returned: Math.max(0, current.meta.returned - 1),
          truncated: current.meta.total - 1 > current.meta.returned - 1,
        },
      } : current);
      setConfirmingId(null);
      setStatus("个人化记忆已删除");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "记忆删除失败，请重试");
    } finally {
      setPendingId(null);
    }
  }

  async function dispute(memory: StudentMemoryPublic) {
    if (pendingId) return;
    setPendingId(memory.id);
    setStatus("");
    setError("");
    try {
      const response = await fetcher(
        `/api/agent/memories/${encodeURIComponent(memory.id)}/dispute`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: memory.kind,
            note: disputeNote.trim() || null,
          }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response, "异议提交失败，请重试"));
      const payload: unknown = await response.json();
      const updated = StudentMemoryPublicSchema.parse(
        typeof payload === "object" && payload !== null && "memory" in payload
          ? payload.memory
          : undefined,
      );
      setCollection((current) => current ? {
        ...current,
        items: current.items.map((item) => item.id === updated.id ? updated : item),
      } : current);
      setDisputingId(null);
      setDisputeNote("");
      setStatus("异议已提交；原始记录保留，教师会同时看到你的说明");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "异议提交失败，请重试");
    } finally {
      setPendingId(null);
    }
  }

  async function loadMore() {
    if (!collection || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const page = await loadPage(collection.items.length);
      setCollection((current) => {
        if (!current) return page;
        const merged = new Map(current.items.map((memory) => [memory.id, memory]));
        for (const memory of page.items) merged.set(memory.id, memory);
        const items = [...merged.values()];
        return {
          items,
          meta: {
            total: page.meta.total,
            returned: items.length,
            truncated: page.meta.total > items.length,
          },
        };
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更多记忆加载失败，请重试");
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) return <p className={styles.loading} role="status">正在读取你的长期记忆…</p>;
  if (!collection) {
    return <div className={styles.errorPanel} role="alert">{error || "长期记忆暂时不可用"}</div>;
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <strong>我的长期记忆</strong>
          <p>两级内容全部对你可见；不同级别采用不同操作权限。</p>
        </div>
        <span>{collection.meta.total} 条</span>
      </header>

      <MemoryTier
        description="偏好与项目事实只用于个性化。你可以直接删除；原始对话不受影响。"
        empty="暂无个人化记忆。"
        level="Tier 1 · 个人化记忆"
        memories={tierOne}
        renderAction={(memory) => confirmingId === memory.id ? (
          <div className={styles.confirmActions}>
            <button disabled={pendingId === memory.id} onClick={() => setConfirmingId(null)} type="button">取消</button>
            <button className={styles.dangerButton} disabled={pendingId === memory.id} onClick={() => void remove(memory)} type="button">
              {pendingId === memory.id ? "正在删除…" : "确认删除"}
            </button>
          </div>
        ) : (
          <button
            className={styles.secondaryButton}
            disabled={Boolean(pendingId)}
            onClick={() => {
              setConfirmingId(memory.id);
              setDisputingId(null);
              setError("");
            }}
            type="button"
          >
            删除
          </button>
        )}
      />

      <MemoryTier
        description="学习信号会供教师理解学情。你不能删除，但可提出异议；原文和异议会并列保留。"
        empty="暂无学习信号。"
        level="Tier 2 · 学习信号"
        memories={tierTwo}
        renderAction={(memory) => disputingId === memory.id ? (
          <div className={styles.disputeEditor}>
            <label>
              <span>异议说明（可选，最多 500 字）</span>
              <textarea
                maxLength={500}
                onChange={(event) => setDisputeNote(event.currentTarget.value)}
                placeholder="例如：这条情况已经改变，或记录缺少了什么背景"
                rows={3}
                value={disputeNote}
              />
            </label>
            <div className={styles.confirmActions}>
              <button disabled={pendingId === memory.id} onClick={() => {
                setDisputingId(null);
                setDisputeNote("");
              }} type="button">取消</button>
              <button className={styles.primaryButton} disabled={pendingId === memory.id} onClick={() => void dispute(memory)} type="button">
                {pendingId === memory.id ? "正在提交…" : "提交异议"}
              </button>
            </div>
          </div>
        ) : (
          <button
            className={styles.secondaryButton}
            disabled={Boolean(pendingId)}
            onClick={() => {
              setDisputingId(memory.id);
              setConfirmingId(null);
              setDisputeNote(memory.studentDisputeNote ?? "");
              setError("");
            }}
            type="button"
          >
            {memory.studentDisputed ? "更新异议" : "提出异议"}
          </button>
        )}
      />

      {collection.meta.truncated ? (
        <button className={styles.loadMore} disabled={loadingMore} onClick={() => void loadMore()} type="button">
          {loadingMore ? "正在加载…" : `加载更多（已显示 ${collection.meta.returned}/${collection.meta.total}）`}
        </button>
      ) : null}
      {status ? <p className={styles.status} role="status">{status}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}

function MemoryTier({
  description,
  empty,
  level,
  memories,
  renderAction,
}: {
  description: string;
  empty: string;
  level: string;
  memories: StudentMemoryPublic[];
  renderAction: (memory: StudentMemoryPublic) => React.ReactNode;
}) {
  return (
    <section className={styles.tier}>
      <div className={styles.tierHeading}>
        <strong>{level}</strong>
        <p>{description}</p>
      </div>
      {memories.length === 0 ? <p className={styles.empty}>{empty}</p> : (
        <ul className={styles.list}>
          {memories.map((memory) => (
            <li key={memory.id}>
              <div className={styles.memoryHeading}>
                <span>{KIND_LABELS[memory.kind]}</span>
                <small>重要度 {memory.salience}</small>
              </div>
              <p className={styles.content}>{memory.content}</p>
              {memory.studentDisputed ? (
                <div className={styles.disputed}>
                  <strong>已提出异议</strong>
                  <span>{memory.studentDisputeNote ?? "未补充说明"}</span>
                  <small>原始记录仍然保留。</small>
                </div>
              ) : null}
              <div className={styles.memoryFooter}>
                <time dateTime={memory.createdAt}>
                  {new Date(memory.createdAt).toLocaleDateString("zh-CN")}
                </time>
                {renderAction(memory)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

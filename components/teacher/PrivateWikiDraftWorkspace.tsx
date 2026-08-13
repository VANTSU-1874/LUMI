/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */
"use client";

import { BookOpenCheck, CheckSquare, FilePenLine, RefreshCw, Search, Send, ShieldQuestion, Square } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TeacherPrivateWikiDraftQueueSchema, type TeacherPrivateWikiDraftQueue } from "@/lib/domain/inspiration-wiki/private-draft-contracts";
import { TeacherAppShell } from "./TeacherAppShell";
import { jsonOrError, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";

type QueueItem = TeacherPrivateWikiDraftQueue["items"][number];

export function PrivateWikiDraftWorkspace({ fetcher = fetch }: { fetcher?: TeacherWorkspaceFetcher }) {
  const [queue, setQueue] = useState<TeacherPrivateWikiDraftQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<"ALL" | QueueItem["stage"]>("ALL");
  const [source, setSource] = useState<"ALL" | QueueItem["sourceContractKind"]>("ALL");
  const [category, setCategory] = useState("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchNote, setBatchNote] = useState("七项编纂已核对，送入策展、教学、权利与安全分域复核");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/private-drafts", { signal, cache: "no-store" }));
      if (!signal?.aborted) setQueue(TeacherPrivateWikiDraftQueueSchema.parse(payload));
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "私有草稿加载失败");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const categories = useMemo(() => [...new Set(queue?.items.map((item) => item.primaryCategory) ?? [])].sort((a, b) => a.localeCompare(b, "zh-CN")), [queue]);
  const filtered = useMemo(() => queue?.items.filter((item) => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return (!needle || `${item.title} ${item.primaryCategory} ${item.artisticStyleLabels.join(" ")}`.toLocaleLowerCase("zh-CN").includes(needle))
      && (stage === "ALL" || item.stage === stage)
      && (source === "ALL" || item.sourceContractKind === source)
      && (category === "ALL" || item.primaryCategory === category);
  }) ?? [], [category, query, queue, source, stage]);
  const editableVisible = filtered.filter((item) => item.stage === "EDITING");
  const allVisibleSelected = editableVisible.length > 0 && editableVisible.every((item) => selected.has(item.draftId));

  async function markReady() {
    if (!selected.size || !batchNote.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/private-drafts/batch-ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftIds: [...selected],
          note: batchNote,
          idempotencyKey: `draft-batch-${crypto.randomUUID()}`,
        }),
      }));
      setSelected(new Set());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量送审失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TeacherAppShell
      active="wiki"
      backHref="/teacher/inspiration-wiki"
      backLabel="返回灵感 Wiki"
      description="把已接受候选编纂为可编辑的教师私有草稿，再送入策展、教学、权利与安全分域复核。"
      eyebrow="D-19 · 私有编纂"
      title="灵感 Wiki 私有草稿"
      tools={<><Link className="teacherButton teacherButtonPrimary" href="/teacher/inspiration-wiki/domain-reviews"><BookOpenCheck size={15} />进入四域复核</Link><button className="teacherButton" disabled={loading} onClick={() => void load()} type="button"><RefreshCw size={15} />{loading ? "核对中…" : "刷新草稿"}</button></>}
    >
      {error ? <div className="teacherNotice teacherError" role="alert">{error}</div> : null}
      <div className="draftWorkspace">
        <section className="draftLedger" aria-labelledby="draft-ledger-heading">
          <div><p className="teacherEyebrow">私有工作草稿 · 非正式 Wiki Page</p><h2 id="draft-ledger-heading">177 个通过项，进入编纂而不是发布。</h2><p>拒绝项已排除；所有权利状态继续为未知。送入分域复核不会创建 Current Page，也不会开放学生检索。</p></div>
          <dl>
            <div><dt>私有草稿</dt><dd>{queue?.meta.total ?? "—"}</dd></div>
            <div><dt>编纂中</dt><dd>{queue?.meta.editing ?? "—"}</dd></div>
            <div><dt>待分域复核</dt><dd>{queue?.meta.readyForDomainReview ?? "—"}</dd></div>
            <div><dt>拒绝项排除</dt><dd>{queue?.meta.rejectedExcluded ?? "—"}</dd></div>
          </dl>
        </section>

        <section className="draftRightsRail" aria-label="权利边界"><ShieldQuestion aria-hidden="true" size={18} /><div><strong>{queue?.meta.rightsUnknown ?? "—"} 条权利状态仍为未知</strong><span>允许私有编纂与教师分域复核，不代表复制、展示或正式再发布许可。</span></div></section>

        <section className="teacherPanel draftQueuePanel" aria-labelledby="draft-queue-heading">
          <header className="teacherPanelHeader"><div><h2 id="draft-queue-heading">草稿编纂队列</h2><p>完成度、来源轨和权利缺口分开呈现</p></div><span>{filtered.length} 项</span></header>
          <div className="draftFilters">
            <label className="draftSearch"><Search aria-hidden="true" size={16} /><input aria-label="搜索草稿" onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、分类或艺术风格" type="search" value={query} /></label>
            <label>阶段<select className="teacherSelect" onChange={(event) => setStage(event.target.value as typeof stage)} value={stage}><option value="ALL">全部阶段</option><option value="EDITING">编纂中</option><option value="READY_FOR_DOMAIN_REVIEW">待分域复核</option></select></label>
            <label>来源<select className="teacherSelect" onChange={(event) => setSource(event.target.value as typeof source)} value={source}><option value="ALL">全部来源轨</option><option value="STRICT_REVIEW_PACK">严格审核通过</option><option value="EVIDENCE_GAP_REVIEW">保留缺口通过</option></select></label>
            <label>分类<select className="teacherSelect" onChange={(event) => setCategory(event.target.value)} value={category}><option value="ALL">全部分类</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          </div>
          <div className="draftBatchBar">
            <button className="draftCheck" onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(editableVisible.map((item) => item.draftId)))} type="button">{allVisibleSelected ? <CheckSquare aria-hidden="true" size={17} /> : <Square aria-hidden="true" size={17} />}选择当前编纂项</button>
            <input aria-label="批量操作说明" maxLength={300} onChange={(event) => setBatchNote(event.target.value)} value={batchNote} />
            <button className="teacherButton teacherButtonPrimary" disabled={!selected.size || !batchNote.trim() || saving} onClick={() => void markReady()} type="button"><Send aria-hidden="true" size={15} />{saving ? "送审中…" : `送入分域复核（${selected.size}）`}</button>
          </div>
          <div className="draftQueueList">
            {filtered.map((item) => {
              const checked = selected.has(item.draftId);
              return <article className="draftQueueRow" data-stage={item.stage} key={item.draftId}>
                <button aria-label={checked ? `取消选择${item.title}` : `选择${item.title}`} className="draftRowCheck" disabled={item.stage !== "EDITING"} onClick={() => setSelected((current) => { const next = new Set(current); if (next.has(item.draftId)) next.delete(item.draftId); else next.add(item.draftId); return next; })} type="button">{checked ? <CheckSquare size={18} /> : <Square size={18} />}</button>
                <div className="draftQueuePreview"><Image alt="" fill sizes="6rem" src={item.primaryPreviewUrl} unoptimized /></div>
                <div className="draftQueueIdentity"><strong>{item.title}</strong><span>{item.primaryCategory} · {item.artisticStyleLabels.join(" / ")}</span><small>{item.sourceContractKind === "STRICT_REVIEW_PACK" ? "严格审核来源" : `保留 ${item.evidenceGapCount} 项证据缺口`} · 修订 {item.revision}</small></div>
                <div className="draftCompletion"><b>{item.completedCount}/7</b><span>编纂完成</span></div>
                <span className="draftStage">{item.stage === "EDITING" ? "编纂中" : "待分域复核"}</span>
                <Link aria-label={`编辑${item.title}`} className="teacherReviewEdit" href={`/teacher/inspiration-wiki/drafts/${encodeURIComponent(item.draftId)}`}><FilePenLine aria-hidden="true" size={15} />编辑</Link>
              </article>;
            })}
            {!loading && filtered.length === 0 ? <p className="teacherEmpty"><strong>没有符合当前筛选的草稿。</strong><br />调整阶段、来源或分类后再试。</p> : null}
          </div>
        </section>

        <Link className="draftNextBoundary" href="/teacher/inspiration-wiki/domain-reviews" aria-label="进入私有四域复核"><BookOpenCheck aria-hidden="true" size={18} /><p><strong>下一站：分域复核</strong><span>策展、教学、权利、安全分别判断；四域未完成前，不生成 canonical Page / Revision / Compiled Truth。</span></p></Link>
      </div>
    </TeacherAppShell>
  );
}

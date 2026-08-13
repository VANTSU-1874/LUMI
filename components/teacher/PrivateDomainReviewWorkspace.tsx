/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
"use client";

import { Ban, BookMarked, CheckCheck, ChevronLeft, ChevronRight, CirclePause, RefreshCw, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PrivateDomainNonTeachingBaselineReceiptSchema,
  PrivateDomainTeachingBatchReceiptSchema,
  PrivateDomainTeachingIssueSchema,
  TeacherPrivateDomainReviewQueueSchema,
  type TeacherPrivateDomainReviewQueue,
} from "@/lib/domain/inspiration-wiki/private-domain-review-contracts";
import { TeacherAppShell } from "./TeacherAppShell";
import { jsonOrError, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";

type Item = TeacherPrivateDomainReviewQueue["items"][number];
type TeachingStatus = Item["domains"]["TEACHING"]["status"];
type TeachingIssue = (typeof PrivateDomainTeachingIssueSchema.options)[number];
type StagedDecision = { decision: "APPROVE" | "HOLD" | "REJECT"; issueKeys: TeachingIssue[]; note: string };

const PAGE_SIZE = 12;
const defaultDecision = (): StagedDecision => ({ decision: "APPROVE", issueKeys: [], note: "" });
const statusLabels: Record<TeachingStatus, string> = { PENDING: "待教学复核", APPROVED: "教学已通过", HOLD: "需要调整", REJECTED: "已排除" };
const issueOptions: Array<{ key: TeachingIssue; label: string }> = [
  { key: "TEACHING_VALUE_UNCLEAR", label: "教学目标不清" },
  { key: "PROMPTS_NEED_ADJUSTMENT", label: "课堂问题需调整" },
  { key: "CAUTIONS_INSUFFICIENT", label: "教学提醒不足" },
];

export function PrivateDomainReviewWorkspace({ fetcher = fetch }: { fetcher?: TeacherWorkspaceFetcher }) {
  const [queue, setQueue] = useState<TeacherPrivateDomainReviewQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baselineSaving, setBaselineSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | TeachingStatus>("PENDING");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decisions, setDecisions] = useState<Record<string, StagedDecision>>({});

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/domain-reviews", { signal, cache: "no-store" }));
      if (!signal?.aborted) setQueue(TeacherPrivateDomainReviewQueueSchema.parse(payload));
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "教学域复核队列加载失败");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const filtered = useMemo(() => queue?.items.filter((item) => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return (!needle || `${item.title} ${item.primaryCategory} ${item.artisticStyleLabels.join(" ")}`.toLocaleLowerCase("zh-CN").includes(needle))
      && (status === "ALL" || item.domains.TEACHING.status === status);
  }) ?? [], [query, queue, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const selectablePageItems = pageItems.filter((item) => item.domains.TEACHING.status === "PENDING" || item.domains.TEACHING.status === "HOLD");
  const selectedItems = pageItems.filter((item) => selected.has(item.reviewCaseId));
  const allPageSelected = selectablePageItems.length > 0 && selectablePageItems.every((item) => selected.has(item.reviewCaseId));
  const baselineComplete = Boolean(queue && queue.meta.nonTeachingApproved === queue.meta.nonTeachingTotal);
  const invalidSelected = selectedItems.some((item) => {
    const staged = decisions[item.reviewCaseId] ?? defaultDecision();
    return (staged.decision === "HOLD" && staged.issueKeys.length === 0) || (staged.decision === "REJECT" && staged.note.trim().length === 0);
  });

  function resetSelection() { setSelected(new Set()); setDecisions({}); }
  function changeQuery(value: string) { setQuery(value); setPage(0); resetSelection(); }
  function changeStatus(value: "ALL" | TeachingStatus) { setStatus(value); setPage(0); resetSelection(); }
  function movePage(next: number) { setPage(next); resetSelection(); }

  function selectItem(item: Item, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(item.reviewCaseId); else next.delete(item.reviewCaseId);
      return next;
    });
    if (checked) setDecisions((current) => ({ ...current, [item.reviewCaseId]: current[item.reviewCaseId] ?? defaultDecision() }));
  }

  function setDecision(item: Item, decision: StagedDecision["decision"]) {
    selectItem(item, true);
    setDecisions((current) => ({ ...current, [item.reviewCaseId]: { decision, issueKeys: decision === "HOLD" ? current[item.reviewCaseId]?.issueKeys ?? [] : [], note: current[item.reviewCaseId]?.note ?? "" } }));
  }

  function toggleIssue(item: Item, issue: TeachingIssue) {
    setDecisions((current) => {
      const staged = current[item.reviewCaseId] ?? { ...defaultDecision(), decision: "HOLD" as const };
      const issueKeys = staged.issueKeys.includes(issue) ? staged.issueKeys.filter((key) => key !== issue) : [...staged.issueKeys, issue];
      return { ...current, [item.reviewCaseId]: { ...staged, decision: "HOLD", issueKeys } };
    });
  }

  async function confirmBaseline() {
    setBaselineSaving(true); setError(null);
    try {
      const payload = await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/domain-reviews/non-teaching-baseline", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "CURRENT_PRIVATE_REVIEW_QUEUE", idempotencyKey: `non-teaching-${crypto.randomUUID()}` }),
      }));
      PrivateDomainNonTeachingBaselineReceiptSchema.parse(payload);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "非教学三域确认失败"); }
    finally { setBaselineSaving(false); }
  }

  async function submitSelected() {
    if (selectedItems.length === 0 || invalidSelected) return;
    setSaving(true); setError(null);
    try {
      const payload = await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/domain-reviews/teaching-decisions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: selectedItems.map((item) => {
            const staged = decisions[item.reviewCaseId] ?? defaultDecision();
            return { reviewCaseId: item.reviewCaseId, expectedRevision: item.revision, expectedStateHash: item.stateHash, ...staged };
          }),
          idempotencyKey: `teaching-batch-${crypto.randomUUID()}`,
        }),
      }));
      PrivateDomainTeachingBatchReceiptSchema.parse(payload);
      resetSelection();
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "教学域批量决定保存失败"); }
    finally { setSaving(false); }
  }

  return <TeacherAppShell active="wiki" backHref="/teacher/inspiration-wiki/drafts" backLabel="返回私有草稿"
    description="策展、权利与安全本批统一确认；每屏对 12 件作品快速完成教学价值、课堂问题与教学提醒审核。"
    eyebrow="D-20 · 教师私有教学复核" title="灵感 Wiki 教学域批量审核"
    tools={<>{queue?.meta.total && queue.meta.complete === queue.meta.total ? <Link className="teacherButton teacherButtonPrimary" href="/teacher/inspiration-wiki/private-pages"><BookMarked size={15} />查看私有编纂页</Link> : null}<button className="teacherButton" disabled={loading || saving || baselineSaving} onClick={() => void load()} type="button"><RefreshCw size={15} />{loading ? "核对中…" : "刷新队列"}</button></>}>
    {error ? <div className="teacherNotice teacherError" role="alert">{error}</div> : null}
    <div className="domainReviewWorkspace teachingBatchWorkspace">
      <section className="domainReviewLedger">
        <div><p className="teacherEyebrow">教师私有预复核 · 聚焦教学域</p><h2>{queue?.meta.total ?? "—"} 件作品，每屏 12 件快速分流。</h2><p>默认将选中作品标记为“教学可用”；只对少数异常项展开调整原因或排除说明。</p></div>
        <dl><div><dt>待教学复核</dt><dd>{queue?.meta.teachingPending ?? "—"}</dd></div><div><dt>教学已通过</dt><dd>{queue?.meta.teachingApproved ?? "—"}</dd></div><div><dt>需要调整</dt><dd>{queue?.meta.teachingHold ?? "—"}</dd></div><div><dt>已排除</dt><dd>{queue?.meta.teachingRejected ?? "—"}</dd></div></dl>
      </section>
      <section className="domainReviewBoundary teachingBaseline" data-complete={baselineComplete}>
        <ShieldCheck size={18} /><div><strong>{baselineComplete ? "策展、权利、安全已完成整批确认" : "策展、权利、安全等待整批确认"}<span>{queue ? `${queue.meta.nonTeachingApproved} / ${queue.meta.nonTeachingTotal} 个非教学域已留痕` : "正在核对"}</span></strong><span>权利仍是“未知 + 教师私有使用”；该确认不代表再发布许可。</span></div>
        {!baselineComplete ? <button className="teacherButton" disabled={baselineSaving || loading} onClick={() => void confirmBaseline()} type="button"><CheckCheck size={15} />{baselineSaving ? "确认中…" : "整批确认三域"}</button> : null}
      </section>
      <section className="teacherPanel teachingBatchPanel">
        <header className="teacherPanelHeader"><div><h2>教学域审核队列</h2><p>当前筛选 {filtered.length} 项，共 {pageCount} 页</p></div><span>第 {safePage + 1} / {pageCount} 页</span></header>
        <div className="domainReviewFilters teachingBatchFilters">
          <label><Search size={16} /><input aria-label="搜索教学域复核任务" onChange={(event) => changeQuery(event.target.value)} placeholder="搜索标题、分类或风格" type="search" value={query} /></label>
          <label><SlidersHorizontal size={15} />教学状态<select className="teacherSelect" onChange={(event) => changeStatus(event.target.value as "ALL" | TeachingStatus)} value={status}><option value="ALL">全部状态</option><option value="PENDING">待教学复核</option><option value="HOLD">需要调整</option><option value="APPROVED">教学已通过</option><option value="REJECTED">已排除</option></select></label>
        </div>
        <div className="teachingBatchBar">
          <label><input aria-label="选择当前页可处理作品" checked={allPageSelected} disabled={selectablePageItems.length === 0} onChange={(event) => {
            if (event.target.checked) { setSelected(new Set(selectablePageItems.map((item) => item.reviewCaseId))); setDecisions(Object.fromEntries(selectablePageItems.map((item) => [item.reviewCaseId, decisions[item.reviewCaseId] ?? defaultDecision()]))); }
            else resetSelection();
          }} type="checkbox" />选择当前页可处理项</label>
          <span>已选 {selectedItems.length} 项：可用 {selectedItems.filter((item) => (decisions[item.reviewCaseId]?.decision ?? "APPROVE") === "APPROVE").length}，调整 {selectedItems.filter((item) => decisions[item.reviewCaseId]?.decision === "HOLD").length}，排除 {selectedItems.filter((item) => decisions[item.reviewCaseId]?.decision === "REJECT").length}</span>
          <button className="teacherButton teacherButtonPrimary" disabled={saving || selectedItems.length === 0 || invalidSelected || !baselineComplete} onClick={() => void submitSelected()} type="button"><CheckCheck size={15} />{saving ? "保存中…" : `提交当前 ${selectedItems.length} 项`}</button>
        </div>
        <div className="teachingReviewGrid">
          {pageItems.map((item) => {
            const teachingStatus = item.domains.TEACHING.status;
            const canStage = teachingStatus === "PENDING" || teachingStatus === "HOLD";
            const staged = decisions[item.reviewCaseId] ?? defaultDecision();
            const isSelected = selected.has(item.reviewCaseId);
            return <article data-selected={isSelected} data-status={teachingStatus} key={item.reviewCaseId}>
              <label className="teachingCardSelect"><input aria-label={`选择 ${item.title}`} checked={isSelected} disabled={!canStage} onChange={(event) => selectItem(item, event.target.checked)} type="checkbox" /><span>{statusLabels[teachingStatus]}</span></label>
              <div className="teachingCardMedia"><Image alt="" fill sizes="(max-width: 700px) 100vw, (max-width: 1200px) 50vw, 33vw" src={item.primaryPreviewUrl} unoptimized /></div>
              <div className="teachingCardBody"><h3>{item.title}</h3><p className="teachingCardMeta">{item.primaryCategory} · {item.artisticStyleLabels.join(" / ")}</p><p>{item.teaching.rationale}</p><dl><div><dt>课堂问题</dt><dd>{item.teaching.prompts.join("；")}</dd></div><div><dt>教学提醒</dt><dd>{item.teaching.cautions.join("；") || "无额外提醒"}</dd></div></dl></div>
              {canStage ? <div className="teachingDisposition" role="group" aria-label={`${item.title} 教学结论`}><button aria-pressed={isSelected && staged.decision === "APPROVE"} onClick={() => setDecision(item, "APPROVE")} type="button"><CheckCheck size={14} />教学可用</button><button aria-pressed={isSelected && staged.decision === "HOLD"} onClick={() => setDecision(item, "HOLD")} type="button"><CirclePause size={14} />需要调整</button><button aria-pressed={isSelected && staged.decision === "REJECT"} onClick={() => setDecision(item, "REJECT")} type="button"><Ban size={14} />排除</button></div> : null}
              {isSelected && staged.decision === "HOLD" ? <fieldset className="teachingIssues"><legend>选择需调整的内容</legend>{issueOptions.map((option) => <label key={option.key}><input checked={staged.issueKeys.includes(option.key)} onChange={() => toggleIssue(item, option.key)} type="checkbox" />{option.label}</label>)}</fieldset> : null}
              {isSelected && (staged.decision === "HOLD" || staged.decision === "REJECT") ? <label className="teachingNote">{staged.decision === "REJECT" ? "排除说明（必填）" : "补充说明（可选）"}<textarea maxLength={300} onChange={(event) => setDecisions((current) => ({ ...current, [item.reviewCaseId]: { ...staged, note: event.target.value } }))} rows={3} value={staged.note} /></label> : null}
              <footer><span>复核修订 {item.revision}</span><Link href={`/teacher/inspiration-wiki/domain-reviews/${encodeURIComponent(item.reviewCaseId)}`}>{teachingStatus === "PENDING" ? "单独查看" : "再次编辑"}</Link></footer>
            </article>;
          })}
          {!loading && pageItems.length === 0 ? <p className="teacherEmpty"><strong>没有符合当前筛选的作品。</strong><br />调整教学状态或搜索条件后再试。</p> : null}
        </div>
        <nav className="teachingPagination" aria-label="教学域复核分页"><button className="teacherButton" disabled={safePage === 0} onClick={() => movePage(safePage - 1)} type="button"><ChevronLeft size={15} />上一页</button><span>第 {safePage + 1} / {pageCount} 页</span><button className="teacherButton" disabled={safePage >= pageCount - 1} onClick={() => movePage(safePage + 1)} type="button">下一页<ChevronRight size={15} /></button></nav>
      </section>
    </div>
  </TeacherAppShell>;
}

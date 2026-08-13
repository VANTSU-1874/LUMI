"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { jsonOrError, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";
import {
  InspirationCandidateDecisionResultSchema,
  InspirationCandidateQueueSchema,
  type InspirationCandidateQueueItem,
} from "./inspiration-review-api";

type Decision = "APPROVE" | "REJECT" | "DEFER";
type PublicationGate = "studentDisplay" | "sourceDisclosure" | "teaching" | "safety" | "quality" | "withdrawal" | "channels";
type Draft = {
  courseTags: string;
  notes: string;
  publicationGates: Record<PublicationGate, boolean>;
  publicSourceLabel: string;
  publicSourceUrl: string;
};

const PUBLICATION_GATES: ReadonlyArray<{ key: PublicationGate; label: string }> = [
  { key: "studentDisplay", label: "学生展示决定明确为 ALLOW" },
  { key: "sourceDisclosure", label: "来源披露已人工审核并明确 ALLOW" },
  { key: "teaching", label: "教学适用性已人工审核并明确 ALLOW" },
  { key: "safety", label: "安全与适龄已人工审核并明确 ALLOW" },
  { key: "quality", label: "质量与重复风险已人工审核并明确 ALLOW" },
  { key: "withdrawal", label: "撤下通道已验证为 READY" },
  { key: "channels", label: "Browser 与 @灵感 Wiki Bridge 均明确启用" },
];

function formatTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "未记录" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(time);
}

function tags(value: string) {
  return [...new Set(value.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

function initialDraft(item: InspirationCandidateQueueItem): Draft {
  return {
    courseTags: item.reviewPackage.extractedTags.join("，"),
    notes: "",
    publicationGates: Object.fromEntries(PUBLICATION_GATES.map(({ key }) => [key, false])) as Record<PublicationGate, boolean>,
    publicSourceLabel: "",
    publicSourceUrl: "",
  };
}

function sourceLink(label: string, href: string | null) {
  return href ? <a className="font-bold text-[#0d6858] underline" href={href} rel="noreferrer" target="_blank">{label}</a> : <span>{label}</span>;
}

function CandidatePreview({ item }: { item: InspirationCandidateQueueItem }) {
  const previewUrl = item.reviewPackage.preview.previewUrl;
  const previewIdentity = `${item.id}:${previewUrl ?? ""}`;
  const [failedPreviewIdentity, setFailedPreviewIdentity] = useState<string | null>(null);
  const failed = failedPreviewIdentity === previewIdentity;
  return <div className="rounded-xl border border-dashed border-[#b7c7c0] bg-[#f4f8f5] p-4 text-sm text-[#3f5f56]">
    <p className="font-black text-[#17332d]">候选预览</p>
    {previewUrl && !failed ? <Image alt="候选的受控 synthetic 预览" className="mt-3 max-h-64 w-full rounded-lg object-contain" height={620} onError={() => setFailedPreviewIdentity(previewIdentity)} src={previewUrl} unoptimized width={800} /> : <p className="mt-2">仅元数据候选，或安全预览暂不可用。</p>}
    <p className="mt-2 text-xs text-[#71847f]">资源模式：{item.asset.mode} · 预览模式：{item.reviewPackage.preview.mode}</p>
  </div>;
}

function CandidateCard({ item, draft, pending, conflict, onDraftChange, onDecision }: {
  item: InspirationCandidateQueueItem;
  draft: Draft;
  pending: boolean;
  conflict: string | null;
  onDraftChange: (next: Draft) => void;
  onDecision: (decision: Decision, publishToStudents?: boolean) => void;
}) {
  const links = item.reviewPackage.source;
  const associations = item.reviewPackage.courseAssociations.length ? item.reviewPackage.courseAssociations : item.analysis.courseAssociations;
  const publicationReady = PUBLICATION_GATES.every(({ key }) => draft.publicationGates[key]);
  return <article className="rounded-2xl border border-[#dce4df] bg-white p-5 shadow-[0_4px_16px_rgba(23,51,45,0.05)]" data-testid={`inspiration-candidate-${item.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black tracking-[0.12em] text-[#178b73]">灵感 Wiki 候选</p><h3 className="mt-1 text-lg font-black text-[#17332d]">{item.curation.title ?? "未命名候选"}</h3><p className="mt-1 text-xs text-[#71847f]">状态：{item.state} · 修订 {item.revision} · 撤下状态：{item.withdrawalStatus}</p></div><span className="rounded-full bg-[#edf5f0] px-3 py-1 text-xs font-black text-[#0d6858]">待教师审核</span></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><CandidatePreview item={item} /><section className="rounded-xl bg-[#fffaf0] p-4 text-sm text-[#504223]"><h4 className="font-black text-[#3a311c]">来源与处理</h4><p className="mt-2">{sourceLink("策展来源", links.curationSourceUrl)}{links.originalSourceDisplay ? <> · {sourceLink(links.originalSourceDisplay, links.originalSourceUrl)}</> : null}</p><p className="mt-2">记录时间：{formatTime(item.curation.observedAt)}</p><p className="mt-2">署名记录：{links.attributionStatus} · 分析通道：{item.reviewPackage.processingLog.actualChannel}</p></section></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><section><h4 className="font-black text-[#17332d]">AI 建议关联的课程节点</h4>{associations.length ? <ul className="mt-2 space-y-2 text-sm text-[#3f5f56]">{associations.map((association) => <li key={`${association.coursePackId}:${association.facets.join("|")}`} className="rounded-xl bg-[#edf5f0] p-3"><strong>{association.coursePackId}</strong>：{association.facets.join("、")}<br /><span>{association.rationale}（置信度 {Math.round(association.confidence * 100)}%，建议状态 {association.status}）</span></li>)}</ul> : <p className="mt-2 text-sm text-[#71847f]">没有可用的课程关联建议。</p>}</section><section><h4 className="font-black text-[#17332d]">为何推荐（辅助信号）</h4><div className="mt-2 rounded-xl bg-[#f7f8f6] p-3 text-sm text-[#3f5f56]"><p>{item.reviewPackage.aiRecommendation.rationale}</p><p className="mt-2">教学相关性：{item.reviewPackage.designSignals.teachingValue} · 新颖性：{item.reviewPackage.designSignals.novelty} · 重复风险：{item.reviewPackage.duplicateRisk.signal}</p><p className="mt-2">风格：{item.reviewPackage.designSignals.visualStyle.join("、") || "未标注"}</p><p className="mt-2">{item.reviewPackage.duplicateRisk.explanation}</p><p className="mt-2 text-xs text-[#71847f]">限制：{item.reviewPackage.aiRecommendation.limitations}</p></div></section></div>
    <div className="mt-4"><h4 className="font-black text-[#17332d]">提取标签</h4><p className="mt-2 flex flex-wrap gap-2">{item.reviewPackage.extractedTags.length ? item.reviewPackage.extractedTags.map((tag) => <span className="rounded-full bg-[#edf5f0] px-3 py-1 text-xs font-bold text-[#0d6858]" key={tag}>{tag}</span>) : <span className="text-sm text-[#71847f]">未提取标签</span>}</p></div>
    <div className="mt-5 grid gap-3 border-t border-[#e6ebe7] pt-4"><label className="text-sm font-black text-[#17332d]">课程/标签修订（逗号分隔）<input className="mt-1 w-full rounded-xl border border-[#cbd8d2] bg-white px-3 py-2 font-normal text-[#17332d]" disabled={pending} onChange={(event) => onDraftChange({ ...draft, courseTags: event.target.value })} value={draft.courseTags} /></label><label className="text-sm font-black text-[#17332d]">审核说明<textarea className="mt-1 min-h-20 w-full rounded-xl border border-[#cbd8d2] bg-white px-3 py-2 font-normal text-[#17332d]" disabled={pending} maxLength={1000} onChange={(event) => onDraftChange({ ...draft, notes: event.target.value })} value={draft.notes} /></label></div>
    <fieldset className="mt-5 rounded-xl border border-[#cbd8d2] bg-[#f7faf8] p-4" disabled={pending}>
      <legend className="px-2 text-sm font-black text-[#17332d]">正式学生发布（全部显式确认才可发布）</legend>
      <p className="mb-3 text-xs leading-5 text-[#58706a]">不勾选时，“通过”只进入 INTERNAL_CATALOG_ONLY，不会出现在学生 Browser、预览或 @灵感 Wiki。</p>
      <div className="grid gap-2 sm:grid-cols-2">{PUBLICATION_GATES.map(({ key, label }) => <label className="flex items-start gap-2 text-sm text-[#294b43]" key={key}><input checked={draft.publicationGates[key]} className="mt-1" onChange={(event) => onDraftChange({ ...draft, publicationGates: { ...draft.publicationGates, [key]: event.target.checked } })} type="checkbox" /><span>{label}</span></label>)}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-black text-[#17332d]">学生可见来源名称（未知可留空）<input className="mt-1 w-full rounded-xl border border-[#cbd8d2] bg-white px-3 py-2 font-normal" maxLength={240} onChange={(event) => onDraftChange({ ...draft, publicSourceLabel: event.target.value })} value={draft.publicSourceLabel} /></label><label className="text-sm font-black text-[#17332d]">审核后的公开 HTTPS 链接（无则留空）<input className="mt-1 w-full rounded-xl border border-[#cbd8d2] bg-white px-3 py-2 font-normal" maxLength={2048} onChange={(event) => onDraftChange({ ...draft, publicSourceUrl: event.target.value })} placeholder="https://已审核白名单域名/..." type="url" value={draft.publicSourceUrl} /></label></div>
    </fieldset>
    {conflict ? <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{conflict}</p> : null}
    <div className="mt-4 flex flex-wrap gap-3"><button className="rounded-xl bg-[#178b73] px-4 py-2 text-sm font-black text-white disabled:opacity-50" disabled={pending} onClick={() => onDecision("APPROVE", false)} type="button">通过并留在内部目录</button><button className="rounded-xl bg-[#7557c5] px-4 py-2 text-sm font-black text-white disabled:opacity-50" disabled={pending || !publicationReady} onClick={() => onDecision("APPROVE", true)} type="button">通过并正式发布给学生</button><button className="rounded-xl border border-[#c26a51] px-4 py-2 text-sm font-black text-[#9e3e29] disabled:opacity-50" disabled={pending} onClick={() => onDecision("REJECT")} type="button">拒绝</button><button className="rounded-xl border border-[#cbd8d2] px-4 py-2 text-sm font-black text-[#3f5f56] disabled:opacity-50" disabled={pending} onClick={() => onDecision("DEFER")} type="button">稍后处理</button></div>
  </article>;
}

export function InspirationCandidateReviewQueue({ fetcher = fetch }: { fetcher?: TeacherWorkspaceFetcher }) {
  const [items, setItems] = useState<InspirationCandidateQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [conflictById, setConflictById] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reloadVersion, setReloadVersion] = useState(0);
  const [resolvedReloadVersion, setResolvedReloadVersion] = useState<number | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    let cancelled = false;
    void fetcher("/api/teacher/inspiration-candidates?limit=30", { cache: "no-store" }).then(jsonOrError).then((body) => {
      const payload = InspirationCandidateQueueSchema.parse(body);
      if (cancelled || sequence !== requestSequence.current) return;
      setError(null); setConflictById({});
      setItems(payload.items);
      setDrafts(Object.fromEntries(payload.items.map((item) => [item.id, initialDraft(item)])));
      setResolvedReloadVersion(reloadVersion);
    }).catch((caught: unknown) => {
      if (cancelled || sequence !== requestSequence.current) return;
      setError(caught instanceof Error ? caught.message : "灵感候选加载失败"); setResolvedReloadVersion(reloadVersion);
    });
    return () => { cancelled = true; };
  }, [fetcher, reloadVersion]);

  const load = useCallback(() => setReloadVersion((current) => current + 1), []);
  const currentItems = resolvedReloadVersion === reloadVersion ? items : null;
  const currentError = resolvedReloadVersion === reloadVersion ? error : null;

  const queueCount = useMemo(() => currentItems?.length ?? 0, [currentItems]);
  async function decide(item: InspirationCandidateQueueItem, decision: Decision, publishToStudents = false) {
    if (pendingId) return;
    const draft = drafts[item.id] ?? initialDraft(item);
    setPendingId(item.id);
    setNotice(null);
    setConflictById((current) => ({ ...current, [item.id]: "" }));
    const priorItems = items;
    if (decision !== "DEFER") setItems((current) => current?.filter((candidate) => candidate.id !== item.id) ?? current);
    try {
      const response = await fetcher(`/api/teacher/inspiration-candidates/${encodeURIComponent(item.id)}/decision`, {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({
          candidateId: item.id,
          expectedRevision: item.revision,
          decision,
          courseTags: tags(draft.courseTags),
          notes: draft.notes.trim(),
          idempotencyKey: crypto.randomUUID(),
          studentPublication: publishToStudents ? {
            publicationScope: "AUTHENTICATED_STUDENT_ONLY",
            studentVisible: true,
            studentDisplayDecision: "ALLOW",
            sourceDisclosureDecision: "ALLOW",
            teachingDecision: "ALLOW",
            safetyDecision: "ALLOW",
            qualityDecision: "ALLOW",
            withdrawalReadiness: "READY",
            browserChannel: "ACTIVE",
            bridgeChannel: "ACTIVE",
            publicSource: {
              label: draft.publicSourceLabel.trim() || null,
              url: draft.publicSourceUrl.trim() || null,
            },
          } : undefined,
        }),
      });
      const payload = InspirationCandidateDecisionResultSchema.parse(await jsonOrError(response));
      if (decision === "APPROVE" && payload.publicationScope === "AUTHENTICATED_STUDENT_ONLY") setNotice("已通过并正式发布：全部学生发布门已持久化记录，案例可进入 Browser 与 @灵感 Wiki。");
      else if (decision === "APPROVE" && payload.state === "ACTIVE") setNotice("已通过并进入内部目录：尚未正式发布，学生 Browser、预览与 @灵感 Wiki 均不可见。");
      else if (decision === "REJECT") setNotice("已拒绝：该候选不会进入学生端。 ");
      else setNotice("已标记为稍后处理，候选仍留在待审核队列。 ");
    } catch (caught) {
      setItems(priorItems);
      const message = caught instanceof Error ? caught.message : "无法保存审核决定";
      if (/刷新|更新|冲突|409/i.test(message)) setConflictById((current) => ({ ...current, [item.id]: `${message} 请刷新队列后再提交。` }));
      else setError(message);
    } finally { setPendingId(null); }
  }

  return <section aria-labelledby="inspiration-review-heading" className="rounded-[1.75rem] border border-[#dce4df] bg-[#fffef9] p-5 shadow-[0_8px_28px_rgba(23,51,45,0.06)] sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black tracking-[0.18em] text-[#178b73]">教师审核</p><h2 className="mt-1 text-xl font-black text-[#17332d]" id="inspiration-review-heading">灵感 Wiki 候选审核</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#58706a]">候选由后台自动处理后进入此私有队列。普通“通过”只进入内部目录；只有全部正式发布门被显式确认，学生 Browser、预览与 @灵感 Wiki 才可读取。</p></div><button className="rounded-xl border border-[#178b73] px-4 py-2 text-sm font-black text-[#0d6858]" onClick={load} type="button">刷新队列</button></div><div aria-live="polite" className="mt-4">{currentItems === null && !currentError ? <p className="rounded-xl bg-[#edf5f0] p-4 text-sm font-bold text-[#0d6858]" role="status">正在加载候选审核队列…</p> : null}{currentError ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert"><p>{currentError}</p><button className="mt-2 font-black underline" onClick={load} type="button">重试</button></div> : null}{notice ? <p className="rounded-xl border border-[#b9dfcf] bg-[#edf8f2] p-4 text-sm font-bold text-[#0d6858]" role="status">{notice}</p> : null}</div>{currentItems?.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-[#b7c7c0] p-6 text-sm text-[#58706a]">暂无待审核候选。新的候选在完成自动处理后会显示在这里。</p> : null}{queueCount > 0 ? <div className="mt-5 space-y-4">{currentItems!.map((item) => <CandidateCard conflict={conflictById[item.id] || null} draft={drafts[item.id] ?? initialDraft(item)} item={item} key={item.id} onDecision={(decision, publishToStudents) => void decide(item, decision, publishToStudents)} onDraftChange={(draft) => setDrafts((current) => ({ ...current, [item.id]: draft }))} pending={pendingId === item.id} />)}</div> : null}</section>;
}

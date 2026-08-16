/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */
"use client";

import { ArrowRight, FilePenLine, ImageOff, Pencil, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { TeacherEvidenceGapReviewQueueSchema } from "@/lib/domain/inspiration-wiki/evidence-gap-review-contracts";
import { TeacherReviewPackQueueSchema } from "@/lib/domain/inspiration-wiki/review-pack-contracts";
import { localizedReviewPackTitle, localizedSourceSummary } from "./inspiration-review-copy.zh-CN";
import { HermesCandidateReviewQueue } from "./HermesCandidateReviewQueue";
import { TeacherAppShell } from "./TeacherAppShell";
import { jsonOrError, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";

type Queue = ReturnType<typeof TeacherReviewPackQueueSchema.parse>;
type GapQueue = ReturnType<typeof TeacherEvidenceGapReviewQueueSchema.parse>;

const gateLabels: Array<[keyof Queue["meta"]["completedGates"], string]> = [
  ["CONTROLLED_MEDIA_GROUP", "受控图 / 图组"],
  ["WORK_SOURCE_MATCH", "作品与原始来源匹配"],
  ["SOURCE_ROLE", "来源角色"],
  ["RIGHTS_EVIDENCE", "权利证据"],
  ["NORMALIZED_CLASSIFICATION", "规范化分类"],
  ["VISUAL_DESCRIPTION", "视觉描述"],
  ["DUPLICATE_RELATIONSHIP", "重复关系"],
  ["CURATION_RECOMMENDATION", "策展建议"],
  ["TEACHING_RECOMMENDATION", "教学建议"],
];

const sourcePolicies = [
  ["Pinterest", "发现入口", "只能指向后续证据，不证明作者身份、作品归属或再发布许可。"],
  ["Behance / Notefolio", "作者作品页", "可证明作者作品页关系，但作者页本身不代表再发布许可。"],
  ["Recent.design / BP&O", "策展索引", "保留策展来源、作品记录与原始创作者之间的三方关系。"],
  ["Hesign / Typographic Posters", "策展索引", "保留策展语境与原始创作者关系，不把索引页当作原创发布者。"],
] as const;

const reviewedStageLabels: Record<Queue["reviewedItems"][number]["stage"], string> = {
  RETURNED_TO_CODEX: "已退回 Codex 补证",
  REJECTED: "已拒绝",
  PRIVATE_WIKIDRAFT: "已进入私有草稿",
};

const gapReviewedStageLabels: Record<GapQueue["reviewedItems"][number]["stage"], string> = {
  RETURNED_TO_CODEX: "已退回 Codex 补证",
  REJECTED: "已拒绝",
  PRIVATE_WIKIDRAFT_WITH_GAPS: "私有草稿（保留缺口）",
};

const gapLabels: Record<GapQueue["items"][number]["missingGates"][number], string> = {
  CONTROLLED_MEDIA_GROUP: "受控图 / 图组",
  WORK_SOURCE_MATCH: "作品来源匹配",
  SOURCE_ROLE: "来源角色",
  RIGHTS_EVIDENCE: "权利证据",
  NORMALIZED_CLASSIFICATION: "规范化分类",
  VISUAL_DESCRIPTION: "视觉描述",
  DUPLICATE_RELATIONSHIP: "重复关系",
  CURATION_RECOMMENDATION: "策展建议",
  TEACHING_RECOMMENDATION: "教学建议",
};

export function TeacherInspirationWikiWorkspace({ fetcher = fetch }: { fetcher?: TeacherWorkspaceFetcher }) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [gapQueue, setGapQueue] = useState<GapQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [queueFilter, setQueueFilter] = useState<"ALL" | "STRICT" | "GAP">("ALL");
  const [gapMediaFilter, setGapMediaFilter] = useState<"ALL" | "WITH_MEDIA" | "WITHOUT_MEDIA">("ALL");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [strictPayload, gapPayload] = await Promise.all([
        jsonOrError(await fetcher("/api/teacher/inspiration-wiki/review-packs", { signal, cache: "no-store" })),
        jsonOrError(await fetcher("/api/teacher/inspiration-wiki/review-packs/evidence-gaps", { signal, cache: "no-store" })),
      ]);
      if (!signal?.aborted) {
        setQueue(TeacherReviewPackQueueSchema.parse(strictPayload));
        setGapQueue(TeacherEvidenceGapReviewQueueSchema.parse(gapPayload));
      }
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "审核包准备度加载失败");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const meta = queue?.meta;
  const actionable = (meta?.teacherReviewReady ?? 0) + (gapQueue?.meta.teacherTriageReady ?? 0);
  const gapItems = gapQueue?.items.filter((item) => gapMediaFilter === "ALL" || (gapMediaFilter === "WITH_MEDIA" ? item.primaryPreviewUrl !== null : item.primaryPreviewUrl === null)) ?? [];

  return (
    <TeacherAppShell
      active="wiki"
      description="严格审核与缺证候选两轨并行；未知状态按已确认事实呈现，证据完整度仍如实保留。"
      eyebrow="教师私有 · 灵感治理"
      title="灵感 Wiki 私有工作区"
      tools={<><Link className="teacherButton teacherButtonPrimary" href="/teacher/inspiration-wiki/drafts"><FilePenLine size={15} />进入私有草稿编纂</Link><button className="teacherButton" disabled={loading} onClick={() => void load()} type="button"><RefreshCw size={15} />{loading ? "核对中…" : "刷新准备度"}</button></>}
    >
      {error ? <div className="teacherNotice teacherError" role="alert">{error}</div> : null}
      <div className="teacherWorkspaceGrid" data-state={meta?.teacherReviewReady ? "ready" : "no-action"} data-ui="review-pack-readiness">
        <section className="wikiReadinessHero" aria-labelledby="wiki-readiness-heading">
          <div className="wikiReadinessCopy">
            <p className="teacherEyebrow">S2 · 两轨教师判断</p>
            <h2 id="wiki-readiness-heading">完整度不同，判断权一致。</h2>
            <p>严格审核包已完成九道门；缺证候选保留六项分析与三项已确认未知。两轨都只存在于教师私有工作区。</p>
          </div>
          <div className="wikiReadinessCount" aria-live="polite">
            <strong>{meta ? `${actionable}/${meta.totalGovernanceMaterials}` : "—/—"}</strong>
            <span>待教师判断 / 候选总数</span>
            <div className="wikiReviewTotals"><b>{meta?.teacherReviewReady ?? "—"}</b><small>严格 9/9</small><b>{gapQueue?.meta.teacherTriageReady ?? "—"}</b><small>缺证候选</small></div>
            <p>{loading ? "正在核对真实库…" : actionable ? `${actionable} 个候选等待教师判断` : "当前无需教师操作"}</p>
          </div>
        </section>

        <section className="teacherPanel" aria-labelledby="review-pack-gates-heading">
          <header className="teacherPanelHeader"><div><h2 id="review-pack-gates-heading">九道准备门</h2><p>全部完成后，才可进入严格教师审核</p></div><span>{meta?.requiredGateCount ?? 9} 项必需</span></header>
          <div className="wikiGateGrid">
            {gateLabels.map(([key, label], index) => <article className="wikiGate" key={key}><code>第 {String(index + 1).padStart(2, "0")} 项</code><strong>{label}</strong><span>{meta ? `${meta.completedGates[key]} 个完整包` : "核对中"}</span></article>)}
          </div>
        </section>

        <section className="teacherPanel" aria-labelledby="review-queue-heading">
          <header className="teacherPanelHeader"><div><h2 id="review-queue-heading">待审核队列</h2><p>严格审核与缺证判断分轨呈现</p></div><span>{actionable} 项</span></header>
          <div className="wikiQueueToolbar" aria-label="审核队列筛选">
            {([ ["ALL", "全部待判"], ["STRICT", "严格 9/9"], ["GAP", "缺证候选"] ] as const).map(([value, label]) => <button aria-pressed={queueFilter === value} className="teacherButton" key={value} onClick={() => setQueueFilter(value)} type="button">{label}</button>)}
            <label>缺证图片<select className="teacherSelect" onChange={(event) => setGapMediaFilter(event.target.value as typeof gapMediaFilter)} value={gapMediaFilter}><option value="ALL">全部</option><option value="WITH_MEDIA">有本地图</option><option value="WITHOUT_MEDIA">安全缺图</option></select></label>
          </div>
          {queueFilter !== "GAP" && queue?.items.length ? <div className="teacherTaskList"><div className="wikiQueueRail"><ShieldCheck size={15} /><strong>严格审核包 · 9/9</strong><span>{queue.items.length} 项</span></div>{queue.items.map((item, index) => { const title = localizedReviewPackTitle(item.reviewPackId, item.title); return <article className="teacherTask teacherReviewTask" key={item.reviewPackId}><div className="teacherReviewTaskPreview"><Image alt="" fill loading={index < 3 ? "eager" : "lazy"} sizes="(max-width: 640px) 30vw, 8rem" src={item.primaryPreviewUrl} unoptimized /></div><span className="teacherTaskIndex">{String(index + 1).padStart(2, "0")}</span><div><strong>{title}</strong><p>{localizedSourceSummary(item.sourceSummary)}</p><span className="teacherReviewTaskMeta">修订 {item.revision} · 九道准备门已齐备</span></div><Link aria-label={`审核${title}`} href={`/teacher/inspiration-wiki/review/${encodeURIComponent(item.reviewPackId)}`}><ArrowRight size={17} /></Link></article>; })}</div> : null}
          {queueFilter !== "STRICT" && gapItems.length ? <div className="teacherTaskList"><div className="wikiQueueRail wikiQueueRailGap"><ShieldAlert size={15} /><strong>缺证候选 · 人工判断</strong><span>{gapItems.length} 项</span></div>{gapItems.map((item, index) => <article className="teacherTask teacherReviewTask teacherGapTask" key={item.reviewPackId}>{item.primaryPreviewUrl ? <div className="teacherReviewTaskPreview"><Image alt="" fill loading={index < 3 ? "eager" : "lazy"} sizes="(max-width: 640px) 30vw, 8rem" src={item.primaryPreviewUrl} unoptimized /></div> : <div className="teacherReviewTaskPreview teacherGapNoPreview"><ImageOff aria-hidden="true" /><span>无受控图片</span></div>}<span className="teacherTaskIndex">{String(index + 1).padStart(2, "0")}</span><div><div className="teacherGapTitle"><strong>{item.title ?? "未命名候选"}</strong><b>{item.verifiedCount} 项已分析</b></div><p>{localizedSourceSummary(item.sourceSummary)}</p><div className="teacherGapTags" aria-label="未知或未核验门">{item.missingGates.slice(0, 3).map((gate) => <span key={gate}>{gapLabels[gate]}</span>)}{item.missingGates.length > 3 ? <span>+{item.missingGates.length - 3}</span> : null}</div></div><Link aria-label={`审核缺证候选${item.title ?? "未命名候选"}`} href={`/teacher/inspiration-wiki/review/gap/${encodeURIComponent(item.reviewPackId)}`}><ArrowRight size={17} /></Link></article>)}</div> : null}
          {!loading && actionable === 0 ? <p className="teacherEmpty"><strong>当前无需教师操作。</strong><br />严格包与缺证包当前都没有待判断项目。</p> : null}
        </section>

        <section className="teacherPanel" aria-labelledby="reviewed-queue-heading">
          <header className="teacherPanelHeader"><div><h2 id="reviewed-queue-heading">已审核队列</h2><p>保留历史结论；再次编辑会追加新修订，不覆盖原审核</p></div><span>{(queue?.reviewedItems.length ?? 0) + (gapQueue?.reviewedItems.length ?? 0)} 项</span></header>
          {queue?.reviewedItems.length ? <div aria-label="已审核严格包" className="teacherTaskList">{queue.reviewedItems.map((item, index) => { const title = localizedReviewPackTitle(item.reviewPackId, item.title); return <article className="teacherTask teacherReviewTask teacherReviewedTask" data-stage={item.stage} key={item.reviewPackId}><div className="teacherReviewTaskPreview"><Image alt="" fill loading={index < 3 ? "eager" : "lazy"} sizes="(max-width: 640px) 30vw, 8rem" src={item.primaryPreviewUrl} unoptimized /></div><span className="teacherTaskIndex">{String(index + 1).padStart(2, "0")}</span><div><strong>{title}</strong><p>{localizedSourceSummary(item.sourceSummary)}</p><span className="teacherReviewTaskMeta">修订 {item.revision} · {new Date(item.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</span></div><div className="teacherReviewedControls"><span className="teacherReviewStatus">{reviewedStageLabels[item.stage]}</span><Link aria-label={`再次编辑${title}`} className="teacherReviewEdit" href={`/teacher/inspiration-wiki/review/${encodeURIComponent(item.reviewPackId)}`}><Pencil aria-hidden="true" size={14} />再次编辑</Link></div></article>; })}</div> : <p className="teacherEmpty"><strong>还没有已审核项目。</strong><br />教师作出退回、拒绝或进入私有草稿的决定后，会记录在这里。</p>}
          {gapQueue?.reviewedItems.length ? <div aria-label="已审核缺证候选" className="teacherTaskList">{gapQueue.reviewedItems.map((item) => <article className="teacherTask teacherReviewedTask teacherGapReviewed" data-stage={item.stage} key={item.reviewPackId}><span className="teacherTaskIndex">{item.verifiedCount} 项已分析</span><div><strong>{item.title ?? "未命名候选"}</strong><p>{localizedSourceSummary(item.sourceSummary)}</p></div><div className="teacherReviewedControls"><span className="teacherReviewStatus">{gapReviewedStageLabels[item.stage]}</span><Link aria-label={`再次编辑${item.title ?? "未命名候选"}`} className="teacherReviewEdit" href={`/teacher/inspiration-wiki/review/gap/${encodeURIComponent(item.reviewPackId)}`}><Pencil aria-hidden="true" size={14} />再次编辑</Link></div></article>)}</div> : null}
        </section>

        <section className="teacherPanel" aria-labelledby="source-policy-heading">
          <header className="teacherPanelHeader"><div><h2 id="source-policy-heading">来源角色规则</h2><p>来源存在不等于权利充分</p></div><ShieldCheck aria-hidden="true" size={17} /></header>
          <div>{sourcePolicies.map(([platform, role, rule]) => <div className="wikiPolicy" key={platform}><strong>{platform}</strong><span>{role}</span><p>{rule}</p></div>)}</div>
        </section>

        <section aria-labelledby="private-boundary-heading" className="teacherPanel">
          <header className="teacherPanelHeader"><div><h2 id="private-boundary-heading">S2 私有边界</h2><p>进入私有草稿也不会打开下列能力</p></div></header>
          <div className="wikiBoundary">
            <div><strong>学生可见</strong><span>{meta?.boundary.studentVisible === false ? "关闭" : "—"}</span></div>
            <div><strong>正式页面</strong><span>{meta?.boundary.currentPage === "DISABLED" ? "关闭" : "—"}</span></div>
            <div><strong>对象存储</strong><span>{meta?.boundary.r2 === "DISABLED" ? "关闭" : "—"}</span></div>
            <div><strong>向量索引</strong><span>{meta?.boundary.embedding === "DISABLED" ? "关闭" : "—"}</span></div>
            <div><strong>Lumi 引用</strong><span>{meta?.boundary.lumiRetrieval === "DISABLED" ? "关闭" : "—"}</span></div>
          </div>
        </section>

        <section className="teacherPanel wikiGovernance" aria-labelledby="governance-material-heading">
          <header className="teacherPanelHeader"><div><h2 id="governance-material-heading">Hermes v1 治理材料</h2><p>只读元数据索引，不是教师审核任务</p></div><span>{meta?.totalGovernanceMaterials ?? "—"} 条</span></header>
          <HermesCandidateReviewQueue fetcher={fetcher} />
        </section>
      </div>
    </TeacherAppShell>
  );
}

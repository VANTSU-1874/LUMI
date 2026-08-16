/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
"use client";

import { ExternalLink, FileClock, RefreshCw, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

import { TeacherPrivateWikiPageDetailSchema, type TeacherPrivateWikiPageDetail } from "@/lib/domain/inspiration-wiki/private-compilation-contracts";
import { localizedReviewSourceLabel, reviewRequirementLabels } from "./inspiration-review-copy.zh-CN";
import { TeacherAppShell } from "./TeacherAppShell";
import { jsonOrError, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";

const recommendation = { RECOMMEND: "建议纳入", DO_NOT_RECOMMEND: "不建议纳入" } as const;

export function PrivateWikiPageDetail({ pageId, fetcher = fetch }: { pageId: string; fetcher?: TeacherWorkspaceFetcher }) {
  const [detail, setDetail] = useState<TeacherPrivateWikiPageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const payload = await jsonOrError(await fetcher(`/api/teacher/inspiration-wiki/private-pages/${encodeURIComponent(pageId)}`, { signal, cache: "no-store" }));
      if (!signal?.aborted) setDetail(TeacherPrivateWikiPageDetailSchema.parse(payload));
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "私有编纂页详情加载失败");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [fetcher, pageId]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const content = detail?.revision.content;
  return <TeacherAppShell
    active="wiki"
    backHref="/teacher/inspiration-wiki/private-pages"
    backLabel="返回私有编纂页"
    description="查看已绑定草稿、四域决定与哈希的教师私有编译快照。"
    eyebrow="D-21 · 私有页面 / 修订 / 真相快照"
    title={content?.title ?? "私有编纂页"}
    tools={<button className="teacherButton" disabled={loading} onClick={() => void load()} type="button"><RefreshCw size={15} />刷新快照</button>}
  >
    {error ? <div className="teacherNotice teacherError" role="alert">{error}</div> : null}
    {detail && content ? <div className="privatePageDetail">
      <section className="privateTruthBanner"><ShieldCheck size={18} /><div><strong>教师私有编译真相快照</strong><span>不是当前页面，不参与学生检索、Lumi 引用或正式发布。</span></div><span>修订 {detail.revision.revision}</span></section>
      <div className="privatePageDetailGrid">
        <section className="privatePageMedia" aria-label="受控媒体">
          <div className="privatePageHero"><Image alt={content.media[0]?.alt ?? content.title} fill sizes="(max-width: 900px) 100vw, 58vw" src={content.media[0]!.previewUrl} unoptimized /></div>
          {content.media.length > 1 ? <div className="privatePageThumbs">{content.media.slice(1).map((media) => <div key={media.mediaId}><Image alt={media.alt ?? "作品补充图"} fill sizes="9rem" src={media.previewUrl} unoptimized /></div>)}</div> : null}
          <div className="privatePageHash"><FileClock size={16} /><p><strong>不可变修订绑定</strong><span>页面修订 {detail.revision.revision} · 内容哈希 {detail.revision.contentHash.slice(0, 16)}…</span><span>真相哈希 {detail.compiledTruth.truthHash.slice(0, 16)}…</span></p></div>
        </section>
        <article className="privatePageArticle">
          <header><p>{content.classification.primary}</p><h2>{content.title}</h2><span>{content.work.creators.join("、") || "创作者未知"}{content.work.year ? ` · ${content.work.year}` : ""}</span></header>
          <section><h3>视觉概述</h3><p>{content.summary}</p></section>
          <section><h3>规范化分类与艺术表现风格</h3><p>{[content.classification.primary, ...content.classification.secondary].join(" / ")}</p><div className="privatePageTags">{content.artisticStyle.labels.map((label) => <span key={label}>{label}</span>)}</div><p>{content.artisticStyle.rationale}</p></section>
          <section><h3>视觉观察</h3><ul>{content.visualObservations.map((item) => <li key={`${item.observation}-${item.mediaIds.join("-")}`}>{item.observation}</li>)}</ul></section>
          <section className="privatePageTeaching"><h3>教学编纂</h3><strong>{recommendation[content.teaching.recommendation]}</strong><p>{content.teaching.rationale}</p><h4>课堂问题</h4><ol>{content.teaching.prompts.map((prompt) => <li key={prompt}>{prompt}</li>)}</ol><h4>教学提醒</h4><ul>{content.teaching.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul></section>
          <section><h3>策展与重复关系</h3><p><strong>{recommendation[content.curation.recommendation]}</strong> · {content.curation.rationale}</p><p>{content.duplicateRelationship.explanation ?? "未发现需要补充的重复关系说明。"}</p></section>
          <section><h3>来源记录</h3><div className="privatePageSources">{content.sourceRecords.map((source) => <a href={source.pageUrl} key={source.sourceId} rel="noreferrer" target="_blank"><span>{localizedReviewSourceLabel(source.platform, source.role)}</span><strong>{source.creatorName ?? source.curatorName ?? "来源角色未知"}</strong><ExternalLink size={14} /></a>)}</div></section>
          <section className="privatePageRights"><h3>权利与安全</h3><p><strong>权利状态：未知，仅限教师私有使用。</strong> 这不代表复制、公开展示或正式再发布许可。</p><ul>{content.safety.evidence.map((item) => <li key={item}>{item}</li>)}</ul></section>
          {content.evidenceGaps.length > 0 ? <section><h3>保留的证据缺口</h3><p>{content.evidenceGaps.map((key) => reviewRequirementLabels[key] ?? "未命名证据缺口").join(" / ")}</p></section> : null}
        </article>
      </div>
    </div> : !loading && !error ? <p className="teacherEmpty">没有可显示的私有编译快照。</p> : null}
  </TeacherAppShell>;
}

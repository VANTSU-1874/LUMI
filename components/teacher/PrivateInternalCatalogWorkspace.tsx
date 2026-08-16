/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */
"use client";

import { BookOpenCheck, FileSearch, LibraryBig, RefreshCw, Search, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TeacherPrivateCatalogQueueSchema, type TeacherPrivateCatalogQueue } from "@/lib/domain/inspiration-wiki/private-catalog-governance-contracts";
import { TeacherAppShell } from "./TeacherAppShell";
import { jsonOrError, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";

export function PrivateInternalCatalogWorkspace({ fetcher = fetch }: { fetcher?: TeacherWorkspaceFetcher }) {
  const [queue, setQueue] = useState<TeacherPrivateCatalogQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"ALL" | "STRICT" | "GAP">("ALL");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/private-catalog", { signal, cache: "no-store" }));
      if (!signal?.aborted) setQueue(TeacherPrivateCatalogQueueSchema.parse(payload));
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "目录读取失败");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);
  const filtered = useMemo(() => (queue?.items ?? []).filter((item) => {
    const sourceMatches = source === "ALL" || (source === "STRICT" ? item.evidenceGapCount === 0 : item.evidenceGapCount > 0);
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return sourceMatches && (!keyword || [item.title, item.primaryCategory, ...item.artisticStyleLabels].some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword)));
  }), [query, queue, source]);

  return <TeacherAppShell
    active="wiki"
    backHref="/teacher/inspiration-wiki/private-pages"
    backLabel="返回私有编纂页"
    eyebrow="D-22 · 角色治理 · 内部目录"
    title="灵感 Wiki 私有内部目录"
    description="把精确私有 Page 修订、编译快照与四域人工决定绑定后纳入教师内部目录。此处不是发布页。"
    tools={<><Link className="teacherButton teacherButtonPrimary" href="/teacher/inspiration-wiki/release-readiness"><FileSearch size={15} />检查发布准备</Link><button className="teacherButton" disabled={loading} onClick={() => void load()} type="button"><RefreshCw size={15} />{loading ? "核对中…" : "刷新目录"}</button></>}
  >
    <div className="privateCatalogWorkspace">
      {error ? <p className="teacherError" role="alert">{error}</p> : null}
      <section className="privateCatalogLedger" aria-labelledby="private-catalog-heading">
        <div>
          <p className="teacherEyebrow">内部准入 · 非正式 WIKI PAGE</p>
          <h2 id="private-catalog-heading">{queue?.meta.total ?? "—"} 个精确修订已进入私有内部目录。</h2>
          <p>角色策略和审核决定均为追加式记录；权利未知只确认教师私有使用边界。</p>
        </div>
        <dl>
          <div><dt>目录条目</dt><dd>{queue?.meta.total ?? "—"}</dd></div>
          <div><dt>角色分配</dt><dd>{queue?.meta.roleAssignments ?? "—"}</dd></div>
          <div><dt>域决定</dt><dd>{queue?.meta.roleDecisions ?? "—"}</dd></div>
          <div><dt>真实教师</dt><dd>{queue?.meta.distinctActors ?? "—"}</dd></div>
        </dl>
      </section>

      <section className="privateCatalogPolicy" aria-label="角色治理说明">
        <ShieldCheck aria-hidden="true" size={18} />
        <div><strong>单教师明确四角色策略</strong><span>当前真实教师分别以策展、教学、权利、安全角色确认已有人工决定；没有虚构多人身份。</span></div>
        <span>权利：未知 · 仅限私有</span>
      </section>

      <section className="teacherPanel">
        <header className="teacherPanelHeader"><div><h2>目录项目</h2><p>点击项目继续查看被准入的精确私有编译页</p></div><span>{filtered.length} 项</span></header>
        <div className="privateCatalogFilters">
          <label><Search aria-hidden="true" size={15} /><input aria-label="搜索目录项目" onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、分类或风格" value={query} /></label>
          <label>来源轨<select className="teacherSelect" onChange={(event) => setSource(event.target.value as typeof source)} value={source}><option value="ALL">全部来源</option><option value="STRICT">严格审核来源</option><option value="GAP">保留缺口来源</option></select></label>
        </div>
        <div className="privateCatalogList">
          {filtered.map((item, index) => <article key={item.entryId}>
            <Link className="privateCatalogCover" href={`/teacher/inspiration-wiki/private-pages/${encodeURIComponent(item.pageId)}`}><Image alt="" fill loading={index < 4 ? "eager" : "lazy"} sizes="(max-width: 640px) 26vw, 8rem" src={item.primaryPreviewUrl} unoptimized /></Link>
            <div><span>{item.evidenceGapCount === 0 ? "严格审核来源" : `保留 ${item.evidenceGapCount} 项证据缺口`}</span><h3>{item.title}</h3><p>{item.primaryCategory} · {item.artisticStyleLabels.join(" / ")}</p><small>私有修订 {item.revision} · 四域角色治理已完成</small></div>
            <Link aria-label={`查看${item.title}`} href={`/teacher/inspiration-wiki/private-pages/${encodeURIComponent(item.pageId)}`}><BookOpenCheck aria-hidden="true" size={16} />查看</Link>
          </article>)}
          {!loading && filtered.length === 0 ? <p className="teacherEmpty"><strong>没有符合当前筛选的目录项目。</strong><br />调整来源轨或搜索条件后再试。</p> : null}
        </div>
      </section>

      <section className="privateCatalogBoundary">
        <LibraryBig aria-hidden="true" size={18} />
        <div><strong>只进入教师内部目录</strong><span>未创建 Current Page；学生浏览、搜索、R2、Embedding、Lumi 引用和正式发布继续关闭。</span></div>
      </section>
    </div>
  </TeacherAppShell>;
}

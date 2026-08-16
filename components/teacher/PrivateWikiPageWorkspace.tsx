/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
"use client";

import { BookMarked, LibraryBig, RefreshCw, Search, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TeacherPrivateWikiPageQueueSchema, type TeacherPrivateWikiPageQueue } from "@/lib/domain/inspiration-wiki/private-compilation-contracts";
import { TeacherAppShell } from "./TeacherAppShell";
import { jsonOrError, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";

type QueueItem = TeacherPrivateWikiPageQueue["items"][number];

export function PrivateWikiPageWorkspace({ fetcher = fetch }: { fetcher?: TeacherWorkspaceFetcher }) {
  const [queue, setQueue] = useState<TeacherPrivateWikiPageQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"ALL" | "STRICT" | "GAP">("ALL");
  const [category, setCategory] = useState("ALL");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/private-pages", { signal, cache: "no-store" }));
      if (!signal?.aborted) setQueue(TeacherPrivateWikiPageQueueSchema.parse(payload));
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "私有编纂页加载失败");
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
      && (category === "ALL" || item.primaryCategory === category)
      && (source === "ALL" || (source === "STRICT" ? item.evidenceGapCount === 0 : item.evidenceGapCount > 0));
  }) ?? [], [category, query, queue, source]);

  return <TeacherAppShell
    active="wiki"
    backHref="/teacher/inspiration-wiki/domain-reviews"
    backLabel="返回教学域审核"
    description="把四域已通过的工作草稿编译为可追溯的教师私有页面、修订与真相快照；它们仍未激活为正式页面。"
    eyebrow="D-21 · 教师私有编译"
    title="灵感 Wiki 私有编纂页"
    tools={<><Link className="teacherButton teacherButtonPrimary" href="/teacher/inspiration-wiki/private-catalog"><LibraryBig size={15} />查看内部目录</Link><button className="teacherButton" disabled={loading} onClick={() => void load()} type="button"><RefreshCw size={15} />{loading ? "核对中…" : "刷新编译页"}</button></>}
  >
    {error ? <div className="teacherNotice teacherError" role="alert">{error}</div> : null}
    <div className="privatePageWorkspace">
      <section className="privatePageLedger">
        <div><p className="teacherEyebrow">私有页面 · 非当前页面</p><h2>{queue?.meta.total ?? "—"} 个审核通过项，已形成可追溯编译快照。</h2><p>每页绑定原草稿修订、四域决定与内容哈希；后续修改只新增修订，不覆盖历史。</p></div>
        <dl><div><dt>私有页面</dt><dd>{queue?.meta.total ?? "—"}</dd></div><div><dt>页面修订</dt><dd>{queue?.meta.revisions ?? "—"}</dd></div><div><dt>真相快照</dt><dd>{queue?.meta.compiledTruths ?? "—"}</dd></div><div><dt>正式页面</dt><dd>0</dd></div></dl>
      </section>

      <section className="privatePageBoundary" aria-label="私有编译边界">
        <ShieldCheck size={18} />
        <div><strong>权利状态仍为未知，正式通道保持关闭</strong><span>这里只允许教师私有查看；学生端、当前页面、正式发布、对象存储、语义索引与 Lumi 引用均未启用。</span></div>
      </section>

      <section className="teacherPanel privatePagePanel">
        <header className="teacherPanelHeader"><div><h2>私有编纂页目录</h2><p>按分类、风格与证据轨快速查找</p></div><span>{filtered.length} 项</span></header>
        <div className="privatePageFilters">
          <label><Search size={16} /><input aria-label="搜索私有编纂页" onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、分类或艺术风格" type="search" value={query} /></label>
          <label>来源轨<select className="teacherSelect" onChange={(event) => setSource(event.target.value as typeof source)} value={source}><option value="ALL">全部来源轨</option><option value="STRICT">严格审核来源</option><option value="GAP">保留缺口来源</option></select></label>
          <label>分类<select className="teacherSelect" onChange={(event) => setCategory(event.target.value)} value={category}><option value="ALL">全部分类</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        </div>
        <div className="privatePageGrid">
          {filtered.map((item: QueueItem) => <article key={item.pageId}>
            <Link className="privatePageCover" href={`/teacher/inspiration-wiki/private-pages/${encodeURIComponent(item.pageId)}`}><Image alt="" fill sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 25vw" src={item.primaryPreviewUrl} unoptimized /></Link>
            <div className="privatePageCardBody"><span>{item.evidenceGapCount === 0 ? "严格审核来源" : `保留 ${item.evidenceGapCount} 项证据缺口`}</span><h3>{item.title}</h3><p>{item.primaryCategory}</p><small>{item.artisticStyleLabels.join(" / ")}</small></div>
            <footer><span>私有修订 {item.revision}</span><Link href={`/teacher/inspiration-wiki/private-pages/${encodeURIComponent(item.pageId)}`}><BookMarked size={15} />查看编译页</Link></footer>
          </article>)}
          {!loading && filtered.length === 0 ? <p className="teacherEmpty"><strong>没有符合当前筛选的编纂页。</strong><br />调整来源轨、分类或搜索条件后再试。</p> : null}
        </div>
      </section>
    </div>
  </TeacherAppShell>;
}

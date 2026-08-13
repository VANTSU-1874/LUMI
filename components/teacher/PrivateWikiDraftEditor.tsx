/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */
"use client";

import { ArrowDown, ArrowUp, RefreshCw, RotateCcw, Save, Send, ShieldQuestion } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

import { PrivateWikiDraftSchema, privateDraftCompletion, type PrivateWikiDraft, type PrivateWikiDraftEditable } from "@/lib/domain/inspiration-wiki/private-draft-contracts";
import { localizedMediaRole, localizedSourceRole } from "./inspiration-review-copy.zh-CN";
import { TeacherAppShell } from "./TeacherAppShell";
import { jsonOrError, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";

const splitList = (value: string) => value.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);

export function PrivateWikiDraftEditor({ draftId, fetcher = fetch }: { draftId: string; fetcher?: TeacherWorkspaceFetcher }) {
  const [draft, setDraft] = useState<PrivateWikiDraft | null>(null);
  const [editable, setEditable] = useState<PrivateWikiDraftEditable | null>(null);
  const [note, setNote] = useState("核对并修订私有草稿内容");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const payload = await jsonOrError(await fetcher(`/api/teacher/inspiration-wiki/private-drafts/${encodeURIComponent(draftId)}`, { signal, cache: "no-store" }));
      if (!signal?.aborted) { const parsed = PrivateWikiDraftSchema.parse(payload); setDraft(parsed); setEditable(structuredClone(parsed.editable)); setError(null); }
    } catch (caught) { if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "私有草稿加载失败"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [draftId, fetcher]);

  useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => load(controller.signal)); return () => controller.abort(); }, [load]);

  async function save(stage: PrivateWikiDraft["stage"]) {
    if (!draft || !editable || !note.trim()) return;
    setSaving(true); setError(null);
    try {
      const payload = await jsonOrError(await fetcher(`/api/teacher/inspiration-wiki/private-drafts/${encodeURIComponent(draftId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: draft.revision, expectedContentHash: draft.contentHash, editable, stage, note, idempotencyKey: `draft-edit-${crypto.randomUUID()}` }),
      }));
      const parsed = PrivateWikiDraftSchema.parse((payload as { draft: unknown }).draft);
      setDraft(parsed); setEditable(structuredClone(parsed.editable));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "草稿保存失败"); }
    finally { setSaving(false); }
  }

  function moveMedia(index: number, direction: -1 | 1) {
    if (!editable) return;
    const next = [...editable.media];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setEditable({ ...editable, media: next });
  }

  const completion = editable ? privateDraftCompletion(editable) : null;
  return <TeacherAppShell active="wiki" backHref="/teacher/inspiration-wiki/drafts" backLabel="返回私有草稿" description="编辑中文标题、视觉摘要、分类、艺术风格、策展和教学内容；所有修改追加修订记录。" eyebrow="D-19 · 单条编纂" title={draft?.editable.title || "私有 WikiDraft"} tools={<button className="teacherButton" disabled={loading} onClick={() => void load()} type="button"><RefreshCw size={15} />刷新</button>}>
    {error ? <div className="teacherNotice teacherError" role="alert">{error}</div> : null}
    {!draft || !editable || loading ? <p className="teacherEmpty">正在读取私有草稿…</p> : <div className="draftEditor">
      <section className="draftEditorMain">
        <div className="draftEditorStatus"><span>{draft.stage === "EDITING" ? "编纂中" : "待分域复核"}</span><strong>{completion?.completedCount}/7 项完成</strong><small>修订 {draft.revision}</small></div>
        <fieldset className="draftFieldset"><legend>基本编纂</legend><label>中文标题<input maxLength={240} onChange={(event) => setEditable({ ...editable, title: event.target.value })} value={editable.title} /></label><label>视觉摘要<textarea maxLength={1200} onChange={(event) => setEditable({ ...editable, summary: event.target.value })} rows={5} value={editable.summary} /></label><div className="draftFieldGrid"><label>主分类<input maxLength={80} onChange={(event) => setEditable({ ...editable, classification: { ...editable.classification, primary: event.target.value } })} value={editable.classification.primary} /></label><label>次级分类（顿号分隔）<input onChange={(event) => setEditable({ ...editable, classification: { ...editable.classification, secondary: splitList(event.target.value) } })} value={editable.classification.secondary.join("、")} /></label></div></fieldset>
        <fieldset className="draftFieldset"><legend>艺术表现风格</legend><label>风格标签（1–3 个）<input onChange={(event) => setEditable({ ...editable, artisticStyle: { ...editable.artisticStyle, labels: splitList(event.target.value).slice(0, 3) } })} value={editable.artisticStyle.labels.join("、")} /></label><label>判断依据<textarea maxLength={500} onChange={(event) => setEditable({ ...editable, artisticStyle: { ...editable.artisticStyle, rationale: event.target.value } })} rows={3} value={editable.artisticStyle.rationale} /></label></fieldset>
        <div className="draftTwoColumns"><fieldset className="draftFieldset"><legend>策展建议</legend><label>结论<select className="teacherSelect" onChange={(event) => setEditable({ ...editable, curation: { ...editable.curation, recommendation: event.target.value as "RECOMMEND" | "DO_NOT_RECOMMEND" } })} value={editable.curation.recommendation}><option value="RECOMMEND">建议纳入</option><option value="DO_NOT_RECOMMEND">不建议纳入</option></select></label><label>策展依据<textarea maxLength={1000} onChange={(event) => setEditable({ ...editable, curation: { ...editable.curation, rationale: event.target.value } })} rows={5} value={editable.curation.rationale} /></label></fieldset><fieldset className="draftFieldset"><legend>教学建议</legend><label>教学依据<textarea maxLength={1000} onChange={(event) => setEditable({ ...editable, teaching: { ...editable.teaching, rationale: event.target.value } })} rows={3} value={editable.teaching.rationale} /></label><label>课堂问题（每行一条）<textarea onChange={(event) => setEditable({ ...editable, teaching: { ...editable.teaching, prompts: splitList(event.target.value) } })} rows={3} value={editable.teaching.prompts.join("\n")} /></label><label>教学提醒（每行一条）<textarea onChange={(event) => setEditable({ ...editable, teaching: { ...editable.teaching, cautions: splitList(event.target.value) } })} rows={3} value={editable.teaching.cautions.join("\n")} /></label></fieldset></div>
        <fieldset className="draftFieldset"><legend>编辑备注</legend><label>内部备注<textarea maxLength={1000} onChange={(event) => setEditable({ ...editable, editorialNote: event.target.value })} rows={3} value={editable.editorialNote} /></label></fieldset>
      </section>
      <aside className="draftEditorAside">
        <section className="draftMediaPanel"><h2>图片顺序</h2><p>第一张作为草稿主图；只调整私有编纂顺序。</p>{editable.media.map((media, index) => <article key={media.mediaId}><div><Image alt={media.alt ?? "私有草稿图片"} fill sizes="18rem" src={media.previewUrl} unoptimized /></div><span><strong>{index === 0 ? "主图" : `第 ${index + 1} 张`}</strong><small>{media.role ? localizedMediaRole(media.role) : "角色待确认"}</small></span><div><button aria-label="上移图片" disabled={index === 0} onClick={() => moveMedia(index, -1)} title="上移" type="button"><ArrowUp size={15} /></button><button aria-label="下移图片" disabled={index === editable.media.length - 1} onClick={() => moveMedia(index, 1)} title="下移" type="button"><ArrowDown size={15} /></button></div></article>)}</section>
        <section className="draftEvidencePanel"><h2>来源与权利</h2><p><ShieldQuestion size={16} />权利状态：<strong>未知</strong></p>{draft.sourceRecords.map((source) => <a href={source.pageUrl} key={source.sourceId} rel="noreferrer" target="_blank"><strong>{source.platform}</strong><span>{source.creatorName ?? "创作者未知"} · {localizedSourceRole(source.role)}</span></a>)}<small>正式再发布：不允许。来源与图片仅供教师私有编纂和分域复核。</small></section>
        <section className="draftActionPanel"><label>本次修订说明<input maxLength={300} onChange={(event) => setNote(event.target.value)} value={note} /></label><button className="teacherButton" disabled={!note.trim() || saving} onClick={() => void save("EDITING")} type="button"><Save size={15} />{saving ? "保存中…" : "保存编纂"}</button>{draft.stage === "EDITING" ? <button className="teacherButton teacherButtonPrimary" disabled={!completion?.ready || !note.trim() || saving} onClick={() => void save("READY_FOR_DOMAIN_REVIEW")} type="button"><Send size={15} />送入分域复核</button> : <button className="teacherButton" disabled={!note.trim() || saving} onClick={() => void save("EDITING")} type="button"><RotateCcw size={15} />重新打开编辑</button>}<p>此动作不创建正式页面，不开放学生、R2、Embedding 或 Lumi 引用。</p></section>
      </aside>
    </div>}
  </TeacherAppShell>;
}

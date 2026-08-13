/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 */
"use client";

import { Ban, CheckCircle2, CirclePause, RefreshCw, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  PrivateDomainReviewDecisionReceiptSchema,
  TeacherPrivateDomainReviewDetailSchema,
  type TeacherPrivateDomainReviewDetail,
} from "@/lib/domain/inspiration-wiki/private-domain-review-contracts";
import { TeacherAppShell } from "./TeacherAppShell";
import { jsonOrError, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";

type Ternary = "YES" | "NO" | "UNCERTAIN";
const statusLabels = { PENDING: "待判断", APPROVED: "已通过", HOLD: "暂停", REJECTED: "已排除" } as const;

function TernarySelect({ label, value, onChange }: { label: string; value: Ternary; onChange: (value: Ternary) => void }) {
  return <label>{label}<select className="teacherSelect" onChange={(event) => onChange(event.target.value as Ternary)} value={value}><option value="YES">是</option><option value="UNCERTAIN">仍不确定</option><option value="NO">否</option></select></label>;
}

export function PrivateDomainReviewEditor({ reviewCaseId, fetcher = fetch }: { reviewCaseId: string; fetcher?: TeacherWorkspaceFetcher }) {
  const [detail, setDetail] = useState<TeacherPrivateDomainReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [teachingValue, setTeachingValue] = useState<Ternary>("YES");
  const [promptsUsable, setPromptsUsable] = useState<Ternary>("YES");
  const [cautionsClear, setCautionsClear] = useState<Ternary>("YES");
  const [activeMedia, setActiveMedia] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const payload = await jsonOrError(await fetcher(`/api/teacher/inspiration-wiki/domain-reviews/${encodeURIComponent(reviewCaseId)}`, { signal, cache: "no-store" }));
      if (!signal?.aborted) setDetail(TeacherPrivateDomainReviewDetailSchema.parse(payload));
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "四域复核详情加载失败");
    }
  }, [fetcher, reviewCaseId]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const canApprove = teachingValue === "YES" && promptsUsable === "YES" && cautionsClear === "YES";

  async function submit(decision: "APPROVE" | "HOLD" | "REJECT") {
    if (!detail || (decision !== "APPROVE" && !note.trim()) || (decision === "APPROVE" && !canApprove)) return;
    setSaving(true);
    setError(null);
    try {
      const payload = await jsonOrError(await fetcher(`/api/teacher/inspiration-wiki/domain-reviews/${encodeURIComponent(reviewCaseId)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: detail.reviewCase.revision,
          expectedStateHash: detail.reviewCase.stateHash,
          reviewDomain: "TEACHING",
          decision,
          assessment: { domain: "TEACHING", teachingValue, promptsUsable, cautionsClear },
          note,
          idempotencyKey: `private-domain-${crypto.randomUUID()}`,
        }),
      }));
      PrivateDomainReviewDecisionReceiptSchema.parse(payload);
      setNote("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "四域复核决定保存失败");
    } finally { setSaving(false); }
  }

  const draft = detail?.draft;
  const reviewCase = detail?.reviewCase;
  const currentState = reviewCase?.domains.TEACHING;
  const nonTeachingComplete = reviewCase ? (["CURATION", "RIGHTS", "SAFETY"] as const).every((item) => reviewCase.domains[item].status === "APPROVED") : false;
  const media = draft?.editable.media[activeMedia] ?? draft?.editable.media[0];

  return <TeacherAppShell
    active="wiki"
    backHref="/teacher/inspiration-wiki/domain-reviews"
    backLabel="返回四域队列"
    description="单独核对作品的教学价值、课堂问题与教学提醒；已完成结论可再次修订，历史决定只追加不覆盖。"
    eyebrow="D-20 · 教学域单项复核"
    title={draft?.editable.title ?? "教学域复核"}
    tools={<button className="teacherButton" disabled={saving} onClick={() => void load()} type="button"><RefreshCw size={15} />刷新任务</button>}
  >
    {error ? <div className="teacherNotice teacherError" role="alert">{error}</div> : null}
    {!detail || !draft || !reviewCase || !media ? <p className="teacherEmpty">正在读取四域复核任务…</p> : <div className="domainReviewEditor">
      <section className="domainReviewMaterial">
        <div className="domainReviewHeroMedia"><Image alt={media.alt ?? "私有草稿受控图片"} fill priority sizes="(max-width: 980px) 100vw, 60vw" src={media.previewUrl} unoptimized /></div>
        {draft.editable.media.length > 1 ? <div className="domainReviewThumbnails">{draft.editable.media.map((item, index) => <button aria-label={`查看第 ${index + 1} 张图片`} aria-pressed={index === activeMedia} key={item.mediaId} onClick={() => setActiveMedia(index)} type="button"><Image alt="" fill sizes="5rem" src={item.previewUrl} unoptimized /></button>)}</div> : null}
        <div className="domainReviewMaterialCopy"><p className="teacherEyebrow">当前私有草稿 · 修订 {draft.revision}</p><h2>{draft.editable.title}</h2><p>{draft.editable.summary}</p><dl><div><dt>规范化分类</dt><dd>{draft.editable.classification.primary} / {draft.editable.classification.secondary.join("、") || "无次级分类"}</dd></div><div><dt>艺术表现风格</dt><dd>{draft.editable.artisticStyle.labels.join(" / ")} · {draft.editable.artisticStyle.rationale}</dd></div></dl></div>
      </section>
      <aside className="domainReviewDecisionPanel">
        <header><div><p className="teacherEyebrow">教学域结论</p><h2>{statusLabels[reviewCase.domains.TEACHING.status]}</h2></div><span data-stage={reviewCase.stage}>复核修订 {reviewCase.revision}</span></header>
        <div className="teachingBaselineSummary"><ShieldCheck size={17} /><span>{nonTeachingComplete ? "策展、权利、安全已由本批统一确认，此处只编辑教学域。" : "非教学三域尚未完成整批确认，请先返回队列完成批量确认。"}</span></div>
        <section className="domainReviewEvidence">
          <h3>教学适用性</h3><p>{draft.editable.teaching.rationale}</p><dl><div><dt>课堂问题</dt><dd>{draft.editable.teaching.prompts.join("；")}</dd></div><div><dt>教学提醒</dt><dd>{draft.editable.teaching.cautions.join("；") || "无额外提醒"}</dd></div></dl><TernarySelect label="是否具有明确教学价值" onChange={setTeachingValue} value={teachingValue} /><TernarySelect label="课堂问题是否可直接使用" onChange={setPromptsUsable} value={promptsUsable} /><TernarySelect label="教学提醒是否充分" onChange={setCautionsClear} value={cautionsClear} />
        </section>
        <section className="domainReviewDecisionBox">
          <div className="domainReviewCurrent"><strong>当前教学结论：{statusLabels[currentState?.status ?? "PENDING"]}</strong>{currentState?.note ? <span>上次说明：{currentState.note}</span> : <span>再次提交会追加修订，不覆盖历史。</span>}</div>
          <label>复核说明（暂停或排除时必填）<textarea maxLength={300} onChange={(event) => setNote(event.target.value)} rows={4} value={note} /></label>
          <div className="domainReviewActions"><button className="teacherButton teacherButtonPrimary" disabled={saving || !canApprove} onClick={() => void submit("APPROVE")} type="button"><CheckCircle2 size={15} />教学域通过</button><button className="teacherButton" disabled={saving || !note.trim()} onClick={() => void submit("HOLD")} type="button"><CirclePause size={15} />需要调整</button><button className="teacherButton teacherButtonDanger" disabled={saving || !note.trim()} onClick={() => void submit("REJECT")} type="button"><Ban size={15} />排除此草稿</button></div>
          <p>教学域通过后仍停留在私有层；正式 S1 角色复核与发布需另行授权。</p>
        </section>
        <footer><Link href={`/teacher/inspiration-wiki/drafts/${encodeURIComponent(draft.draftId)}`}>返回编辑私有草稿</Link></footer>
      </aside>
    </div>}
  </TeacherAppShell>;
}

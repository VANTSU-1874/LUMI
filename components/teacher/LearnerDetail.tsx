"use client";

import { type FormEvent, useState } from "react";

import { DemoBadge } from "@/components/common/DemoBadge";
import { EvidenceDeletionList } from "@/components/common/EvidenceDeletionList";
import type {
  AgentDecisionReviewInput,
  LearnerDetail as LearnerDetailValue,
  TeacherDecisionInput,
  TeacherOriginalSnapshot,
} from "@/lib/domain/teacher";
import type { StudentMemoryPublic } from "@/lib/domain/student-memory";

import { AgentDecisionTimeline } from "./AgentDecisionTimeline";
import { BookLayoutReviewViewer } from "./BookLayoutReviewViewer";
import { EvidenceReviewViewer } from "./EvidenceReviewViewer";
import { StudentMemoryList } from "./StudentMemoryList";

type DecisionDraft = Omit<TeacherDecisionInput, "classId" | "studentId" | "projectId" | "targetId" | "originalRevision" | "idempotencyKey">;
type ReviewTarget = LearnerDetailValue["reviewTargets"][number];

function snapshotLabel(snapshot: TeacherOriginalSnapshot) {
  if (snapshot.targetType === "LOGIC_REVIEW") return `逻辑审查：${snapshot.status}`;
  if (snapshot.targetType === "EVIDENCE") return `证据 ${snapshot.layer}：${snapshot.verification}`;
  if (snapshot.targetType === "BOOK_LAYOUT_EVIDENCE") return `书籍版面证据：${snapshot.score}/4 ${snapshot.passed ? "规则通过" : "待修订"}`;
  return `举一反三：${snapshot.status}`;
}

const evidenceReasonCodes = {
  CONFIRMED: "EVIDENCE_CONFIRMED",
  CORRECTED: "EVIDENCE_CORRECTED",
  NEEDS_REVIEW: "EVIDENCE_NEEDS_REVIEW",
} as const;

function evidenceDecisionMatches(
  decision: "CONFIRMED" | "CORRECTED" | "NEEDS_REVIEW",
  verification: "SUBMITTED" | "RULE_VERIFIED" | "TEACHER_VERIFIED" | "REJECTED",
) {
  return (decision === "CONFIRMED" && verification === "TEACHER_VERIFIED")
    || (decision === "CORRECTED" && verification === "REJECTED")
    || (decision === "NEEDS_REVIEW" && verification === "SUBMITTED");
}

function CurrentJudgement({ detail, selectedTarget }: { detail: LearnerDetailValue; selectedTarget?: ReviewTarget }) {
  const selectedKey = selectedTarget ? `${selectedTarget.snapshot.targetType}:${selectedTarget.targetId}` : "";
  const matchingDecision = selectedKey ? detail.latestDecisionByTarget[selectedKey] : undefined;
  const historicalDecision = Boolean(matchingDecision && selectedTarget && (
    selectedTarget.snapshot.targetType === "EVIDENCE"
      ? !evidenceDecisionMatches(matchingDecision.decision, selectedTarget.snapshot.verification)
      : matchingDecision.originalRevision !== selectedTarget.snapshot.revision
  ));
  return <div className="grid gap-4 md:grid-cols-2">
    <article className="rounded-2xl bg-slate-50 p-4">
      <h3 className="font-semibold">系统当前判断</h3>
      <p className="mt-2">原系统结果：{selectedTarget ? snapshotLabel(selectedTarget.snapshot).replace(/^[^：]+：/, "") : "暂无"}</p>
      <p className="mt-1 text-sm">当前版本：{selectedTarget?.snapshot.revision ?? "-"}</p>
      {selectedTarget?.snapshot.targetType === "LOGIC_REVIEW" ? <ul className="mt-2 text-sm text-slate-600">{selectedTarget.snapshot.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
      <p className="mt-2 break-all text-xs text-slate-500">{selectedTarget ? `${selectedTarget.snapshot.targetType} · ${selectedTarget.targetId}` : ""}</p>
    </article>
    <article className="rounded-2xl bg-indigo-50 p-4">
      <h3 className="font-semibold">教师决定</h3>
      {matchingDecision ? <>
        <p className="mt-2">教师决定：{matchingDecision.decision}</p>
        {historicalDecision ? <p className="mt-1 font-semibold text-amber-800">针对历史版本</p> : null}
        <p className="mt-1 text-sm">当时版本：{matchingDecision.originalRevision}；当时原结果：{snapshotLabel(matchingDecision.originalSnapshot).replace(/^[^：]+：/, "")}</p>
        <p className="mt-1 text-sm">{matchingDecision.notes}</p>
      </> : <p className="mt-2 text-sm text-slate-600">尚未处理</p>}
    </article>
  </div>;
}

function LearningMetrics({ detail }: { detail: LearnerDetailValue }) {
  return <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
    <div><dt className="text-slate-500">证据 {detail.evidence.dataType === "DEMONSTRATION_DATA" ? <DemoBadge /> : null}</dt><dd aria-label="证据总数" className="text-lg font-semibold">{detail.evidence.total}</dd></div>
    <div><dt className="text-slate-500">提示</dt><dd className="text-lg font-semibold">{detail.hints.count} / L{detail.hints.maxLevel ?? "-"}</dd></div>
    <div><dt className="text-slate-500">排障</dt><dd className="text-lg font-semibold">{detail.troubleshooting?.status ?? "-"}</dd></div>
    <div><dt className="text-slate-500">迁移</dt><dd className="text-lg font-semibold">{detail.transfer?.status ?? "-"}</dd></div>
  </dl>;
}

export function LearnerDetail({
  detail,
  onDecision,
  onAgentReview,
  onTargetChange,
  onEvidenceDeleted,
  onMemoryDeleted,
  onMemoryLoaded,
  classId,
  includeDemo = false,
  fetcher = fetch,
  pending,
  agentReviewPending = false,
}: {
  detail: LearnerDetailValue;
  onDecision: (decision: DecisionDraft & { targetId: string; originalRevision: number }) => void;
  onAgentReview?: (review: AgentDecisionReviewInput) => void;
  onTargetChange?: () => void;
  onEvidenceDeleted?: (id: string) => void;
  onMemoryDeleted?: (id: string) => void | Promise<void>;
  onMemoryLoaded?: (items: StudentMemoryPublic[], total: number) => void | Promise<void>;
  classId?: string;
  includeDemo?: boolean;
  fetcher?: typeof fetch;
  pending: boolean;
  agentReviewPending?: boolean;
}) {
  const firstTarget = detail.reviewTargets[0];
  const [targetKey, setTargetKey] = useState(firstTarget ? `${firstTarget.snapshot.targetType}:${firstTarget.targetId}` : "");
  const selectedTarget = detail.reviewTargets.find((item) => `${item.snapshot.targetType}:${item.targetId}` === targetKey) ?? firstTarget;
  const [decision, setDecision] = useState<"CONFIRMED" | "CORRECTED" | "NEEDS_REVIEW">("CONFIRMED");
  const [reasonCode, setReasonCode] = useState("TEACHER_CHECK");
  const [notes, setNotes] = useState("");
  const [readyEvidenceKey, setReadyEvidenceKey] = useState("");
  const evidenceSelected = selectedTarget?.snapshot.targetType === "EVIDENCE";
  const evidenceTargets = detail.reviewTargets.filter((item) => item.snapshot.targetType === "EVIDENCE");
  const evidenceReviewKey = evidenceSelected ? `${selectedTarget.targetId}:${selectedTarget.snapshot.revision}` : "";
  const evidenceReady = !evidenceSelected || readyEvidenceKey === evidenceReviewKey;
  const notesRequired = evidenceSelected && decision !== "CONFIRMED";

  function changeTarget(next: string) {
    setTargetKey(next);
    setDecision("CONFIRMED");
    setReasonCode("TEACHER_CHECK");
    setNotes("");
    setReadyEvidenceKey("");
    onTargetChange?.();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedTarget || !evidenceReady || (notesRequired && !notes.trim())) return;
    onDecision({
      targetType: selectedTarget.snapshot.targetType,
      targetId: selectedTarget.targetId,
      originalRevision: selectedTarget.snapshot.revision,
      decision,
      reasonCode: evidenceSelected ? evidenceReasonCodes[decision] : reasonCode,
      notes: notes.trim(),
    });
  }

  return <section aria-labelledby="learner-title" className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
    <header className="flex flex-wrap justify-between gap-3"><div><div className="mb-2">{detail.student.dataType === "DEMONSTRATION_DATA" ? <DemoBadge /> : null}</div><h2 className="text-2xl font-semibold" id="learner-title">{detail.student.alias}</h2></div><p>{detail.project?.stage ?? "未开始"}</p></header>
    <CurrentJudgement detail={detail} selectedTarget={selectedTarget} />
    <LearningMetrics detail={detail} />
    <StudentMemoryList classId={classId} collection={detail.memories} fetcher={fetcher} includeDemo={includeDemo} key={`${classId ?? ""}:${detail.student.id}`} onDeleted={onMemoryDeleted} onLoaded={onMemoryLoaded} studentId={detail.student.id} />
    <AgentDecisionTimeline detail={detail} onReview={onAgentReview} pending={agentReviewPending} />
    <EvidenceDeletionList items={evidenceTargets.map((item) => ({ id: item.targetId, label: snapshotLabel(item.snapshot) }))} fetcher={fetcher} onDeleted={onEvidenceDeleted} />
    {evidenceSelected ? <EvidenceReviewViewer evidenceId={selectedTarget.targetId} fetcher={fetcher} key={evidenceReviewKey} onReadyChange={(ready) => setReadyEvidenceKey(ready ? evidenceReviewKey : "")} /> : evidenceTargets.length === 0 ? <EvidenceReviewViewer fetcher={fetcher} /> : null}
    {selectedTarget?.snapshot.targetType === "BOOK_LAYOUT_EVIDENCE" ? <BookLayoutReviewViewer snapshot={selectedTarget.snapshot} /> : null}
    {selectedTarget ? <form className="space-y-4 border-t border-slate-200 pt-5" onSubmit={submit}>
      <h3 className="font-semibold">追加教师决定</h3>
      <label className="block text-sm font-medium">复核对象<select className="mt-1 w-full rounded-xl border border-slate-300 p-3" disabled={pending} onChange={(event) => changeTarget(event.target.value)} value={`${selectedTarget.snapshot.targetType}:${selectedTarget.targetId}`}>{detail.reviewTargets.map((item) => <option key={`${item.snapshot.targetType}:${item.targetId}`} value={`${item.snapshot.targetType}:${item.targetId}`}>{snapshotLabel(item.snapshot)}</option>)}</select></label>
      <p className="rounded-xl bg-slate-50 p-3 text-sm">当前原结果：{snapshotLabel(selectedTarget.snapshot)}</p>
      <fieldset><legend className="text-sm font-medium">处理决定</legend><div className="mt-2 grid gap-2 sm:grid-cols-3">{([
        ["CONFIRMED", "确认有效", "内容真实、能支撑该学习环节"],
        ["CORRECTED", "纠正或未通过", "内容错误、无效或不能支撑判断"],
        ["NEEDS_REVIEW", "暂待复核", "需要当面检查或补充材料"],
      ] as const).map(([value, label, hint]) => <button aria-pressed={decision === value} className={`rounded-2xl border p-3 text-left disabled:opacity-50 ${decision === value ? "border-[#178b73] bg-[#e2f3ec] text-[#0d6858]" : "border-slate-200 bg-white text-slate-700"}`} disabled={pending} key={value} onClick={() => setDecision(value)} type="button"><span className="block text-sm font-bold">{label}</span><span className="mt-1 block text-xs leading-5 opacity-75">{hint}</span></button>)}</div></fieldset>
      {!evidenceSelected ? <label className="block text-sm font-medium">原因代码<input className="mt-1 w-full rounded-xl border border-slate-300 p-3" disabled={pending} maxLength={64} onChange={(event) => setReasonCode(event.target.value)} required value={reasonCode} /></label> : <p className="rounded-xl bg-[#eef6f2] p-3 text-xs leading-5 text-[#53615c]">先查看上方证据原文或预览，再作出判定。保存后，证据状态与教师决定会同时更新。</p>}
      <label className="block text-sm font-medium">教师备注{notesRequired ? "（必填）" : ""}<textarea aria-label="教师备注" className="mt-1 min-h-24 w-full rounded-xl border border-slate-300 p-3" disabled={pending} maxLength={1000} onChange={(event) => setNotes(event.target.value)} required={notesRequired} value={notes} /></label>
      <button className="rounded-xl bg-[#17332d] px-5 py-3 font-semibold text-white disabled:opacity-60" disabled={pending || !evidenceReady || (notesRequired && !notes.trim())} type="submit">{pending ? "正在保存…" : evidenceSelected && !evidenceReady ? "读取证据后可保存" : "保存教师决定"}</button>
    </form> : null}
    <section aria-labelledby="timeline-title"><h3 className="font-semibold" id="timeline-title">决定时间线</h3><ol className="mt-3 space-y-3">{detail.decisions.map((item) => <li className="min-w-0 border-l-2 border-indigo-200 pl-4" key={item.id}><p className="break-all font-medium">#{item.timelineSequence} · {item.targetType} · {item.targetId} · {item.decision}</p><p className="text-sm">当时原结果：{snapshotLabel(item.originalSnapshot).replace(/^[^：]+：/, "")}</p><time className="text-xs text-slate-500" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("zh-CN", { timeZone: "UTC" })} UTC</time><p className="break-words text-sm">{item.notes}</p></li>)}</ol></section>
  </section>;
}

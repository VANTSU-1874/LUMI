"use client";

import { type FormEvent, useState } from "react";

import { AgentExecutionTimeline } from "@/components/common/AgentExecutionTimeline";
import type { AgentDecisionReviewInput, LearnerDetail as LearnerDetailValue } from "@/lib/domain/teacher";

type TimelineItem = NonNullable<LearnerDetailValue["agentTimeline"]>[number];

const REVIEW_LABELS = {
  CONFIRMED: "确认",
  CORRECTED: "纠正",
  NEEDS_REVIEW: "需要复核",
} as const;

function inputSummary(input: TimelineItem["toolCalls"][number]["input"]) {
  const value = JSON.stringify(input);
  return value.length > 160 ? `${value.slice(0, 157)}…` : value;
}

function GovernanceDetail({ item }: { item: TimelineItem }) {
  const degraded = item.executionSteps.filter((step) => step.kind === "DEGRADED" || step.status === "FAILED");
  return <div className="space-y-3 border-y border-[#e1e7e3] py-4">
    <section aria-label="Agent 策略约束" className="rounded-xl bg-[#f2f6f3] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="text-[10px] text-[#176752]">策略与权限边界</b>
        <code className="rounded-md bg-white px-2 py-1 text-[9px] text-[#52635d]">{item.policy.policyId}@{item.policy.policyVersion}</code>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px]">
        <div className="rounded-lg bg-white p-2"><dt className="text-[#71817b]">模型决策</dt><dd className="mt-1 font-black text-[#17332d]">{item.policy.budgets.modelDecisions}/{item.policy.budgets.maxModelDecisions}</dd></div>
        <div className="rounded-lg bg-white p-2"><dt className="text-[#71817b]">工具调用</dt><dd className="mt-1 font-black text-[#17332d]">{item.policy.budgets.toolCalls}/{item.policy.budgets.maxToolCalls}</dd></div>
        <div className="rounded-lg bg-white p-2"><dt className="text-[#71817b]">回合上限</dt><dd className="mt-1 font-black text-[#17332d]">{item.policy.budgets.turnTimeoutMs / 1000}s</dd></div>
      </dl>
      <p className="mt-2 text-[10px] leading-5 text-[#5c6d67]">只读工具可自动执行；改变学生状态必须由学生确认；智能体无权评分、过关或代替教师。</p>
      <div className="mt-2 flex flex-wrap gap-1">{item.policy.appliedRules.map((rule) => <span className="rounded-md border border-[#d5e1dc] bg-white px-1.5 py-1 font-mono text-[8px] text-[#61716b]" key={rule}>{rule}</span>)}</div>
    </section>
    {degraded.length ? <section aria-label="降级原因" className="rounded-xl border border-[#f1c9b7] bg-[#fff4ed] p-3">
      <b className="text-[10px] text-[#a34d31]">降级或失败原因</b>
      {degraded.map((step) => <p className="mt-1 text-[10px] leading-5 text-[#7b574a]" key={step.id}>{step.label}：{step.summary}</p>)}
    </section> : null}
    <section aria-label="Agent 工具调用">
      <div className="flex items-center justify-between"><b className="text-[10px] text-[#64736e]">实际工具调用</b><span className="text-[9px] text-[#89918d]">{item.toolCalls.length} 次</span></div>
      {item.toolCalls.length ? <ol className="mt-2 space-y-2">{item.toolCalls.map((tool) => <li className="rounded-xl border border-[#dfe6e2] bg-white p-3" key={tool.id}>
        <div className="flex flex-wrap items-center gap-2"><code className="text-[10px] font-bold text-[#1d6656]">{tool.toolId}@{tool.toolVersion}</code><span className={`rounded-full px-2 py-0.5 text-[8px] font-black ${tool.status === "SUCCESS" ? "bg-[#e4f5ed] text-[#176752]" : tool.status === "EMPTY" ? "bg-[#fff2d4] text-[#8a620c]" : "bg-[#ffe8e1] text-[#a44332]"}`}>{tool.status}</span><span className="ml-auto text-[9px] text-[#8a9691]">{tool.latencyMs}ms</span></div>
        <p className="mt-1 truncate font-mono text-[9px] text-[#6d7b76]" title={inputSummary(tool.input)}>输入 {inputSummary(tool.input)}</p>
        {tool.errorCode ? <p className="mt-1 text-[9px] text-[#a44332]">错误码：{tool.errorCode}</p> : null}
      </li>)}</ol> : <p className="mt-2 rounded-xl border border-dashed border-[#d8e0dc] p-3 text-[10px] text-[#71817b]">本回合未调用工具。</p>}
    </section>
    <AgentExecutionTimeline steps={item.executionSteps} title="可审查执行轨迹" />
  </div>;
}

function ReviewForm({ item, onReview, pending }: { item: TimelineItem; onReview?: (review: AgentDecisionReviewInput) => void; pending: boolean }) {
  const [decision, setDecision] = useState<AgentDecisionReviewInput["decision"]>(item.review?.decision ?? "CONFIRMED");
  const [notes, setNotes] = useState(item.review?.notes ?? "判断与课程情境一致。");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!notes.trim()) return;
    onReview?.({ turnId: item.turnId, decision, notes: notes.trim() });
  }
  return <form className="mt-4" onSubmit={submit}>
    <label className="block text-xs font-bold">教师判断<select aria-label="智能体教师判断" className="mt-1 w-full rounded-xl border border-[#cbd8d2] p-2.5" disabled={pending} onChange={(event) => setDecision(event.target.value as typeof decision)} value={decision}>{Object.entries(REVIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="mt-3 block text-xs font-bold">说明<textarea aria-label="智能体复核说明" className="mt-1 min-h-24 w-full rounded-xl border border-[#cbd8d2] p-2.5" disabled={pending} maxLength={1000} onChange={(event) => setNotes(event.target.value)} value={notes} /></label>
    <button className="mt-3 w-full rounded-xl bg-[#17332d] px-4 py-3 text-sm font-black text-white disabled:opacity-50" disabled={pending || !onReview || !notes.trim()} type="submit">{pending ? "保存中…" : item.review ? "更新教师复核" : "记录教师复核"}</button>
  </form>;
}

function DecisionDetail({ item, onReview, pending }: { item: TimelineItem; onReview?: (review: AgentDecisionReviewInput) => void; pending: boolean }) {
  return <article className="rounded-2xl border border-[#dce4df] bg-white p-4" key={item.turnId}>
    <p className="text-[10px] font-black tracking-[0.14em] text-[#178b73]">复核当前判断</p><h4 className="mt-2 font-black text-[#17332d]">{item.reply.title}</h4>
    <p className="mt-2 text-xs leading-5 text-[#5c716b]">{item.reply.message}</p>
    <div className="mt-3 rounded-xl bg-[#eef6f2] p-3"><b className="text-[10px] text-[#176752]">为什么这样建议</b><p className="mt-1 text-xs leading-5 text-[#53615c]">{item.reply.whyThisStep}</p></div>
    <div className="mt-3 rounded-xl bg-[#f5f2e9] p-3"><b className="text-[10px] text-[#8a6c24]">不确定性</b><p className="mt-1 text-xs leading-5 text-[#6b6147]">{item.reply.uncertainty}</p></div>
    <GovernanceDetail item={item} />
    <div className="mt-3"><b className="text-[10px] text-[#64736e]">本次依据</b><div className="mt-1.5 flex flex-wrap gap-1.5">{item.reply.sources.length ? item.reply.sources.map((source) => <span className="rounded-lg bg-[#eef1ef] px-2 py-1 text-[10px] text-[#4f625b]" key={source.id}>{source.title}</span>) : <span className="rounded-lg bg-[#eef1ef] px-2 py-1 text-[10px] text-[#64736e]">通用设计建议</span>}</div></div>
    {item.reply.actions.length ? <div className="mt-3"><b className="text-[10px] text-[#64736e]">建议行动</b>{item.reply.actions.map((action) => <p className="mt-1 text-xs text-[#53615c]" key={action.id}>{action.label} · {action.status}</p>)}</div> : null}
    <ReviewForm item={item} onReview={onReview} pending={pending} />
  </article>;
}

export function AgentDecisionTimeline({ detail, onReview, pending }: { detail: LearnerDetailValue; onReview?: (review: AgentDecisionReviewInput) => void; pending: boolean }) {
  const timeline = detail.agentTimeline ?? [];
  const packIds = Array.from(new Set(timeline.map(({ coursePackId }) => coursePackId)));
  const [pack, setPack] = useState("ALL");
  const [selectedTurn, setSelectedTurn] = useState(timeline[0]?.turnId ?? "");
  const filtered = pack === "ALL" ? timeline : timeline.filter(({ coursePackId }) => coursePackId === pack);
  const selected = filtered.find(({ turnId }) => turnId === selectedTurn) ?? filtered[0];
  return <section className="rounded-[1.75rem] border border-[#d8e2dd] bg-[#f7faf7] p-5" aria-labelledby="agent-timeline-title">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-black tracking-[0.16em] text-[#178b73]">AGENT GOVERNANCE TRACE</p><h3 className="mt-1 text-lg font-black text-[#17332d]" id="agent-timeline-title">智能体决策与工具审查</h3><p className="mt-1 text-xs text-[#6a7c76]">核查策略、工具、降级、依据和教师复核，不展示模型内部思维。</p></div>{packIds.length > 1 ? <label className="text-xs font-bold text-[#58706a]">课程包<select className="ml-2 rounded-xl border border-[#cbd8d2] bg-white px-3 py-2" onChange={(event) => { setPack(event.target.value); setSelectedTurn(""); }} value={pack}><option value="ALL">全部</option>{packIds.map((id) => <option key={id} value={id}>{timeline.find((item) => item.coursePackId === id)?.coursePackLabel ?? id}</option>)}</select></label> : null}</div>
    {detail.bookLayoutEvidence ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#fff5d9] px-4 py-3 text-sm"><span><b>书籍设计微闭环</b> · {detail.bookLayoutEvidence.audience === "NEW_STUDENTS" ? "新生导览册" : "社区居民迁移"}</span><span className="rounded-full bg-white px-3 py-1 font-black text-[#8a620c]">{detail.bookLayoutEvidence.score}/4 {detail.bookLayoutEvidence.passed ? "通过" : "待修订"}</span></div> : null}
    {filtered.length === 0 ? <p className="mt-4 rounded-2xl border border-dashed border-[#cad7d1] p-4 text-sm text-[#6a7c76]">该学生还没有智能体会话。</p> : <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <ol className="max-h-[48rem] space-y-3 overflow-auto pr-1">{filtered.map((item) => <li key={item.turnId}><button className={`w-full rounded-2xl border p-4 text-left transition ${selected?.turnId === item.turnId ? "border-[#178b73] bg-white shadow-sm" : "border-[#dce4df] bg-[#fbfcfa]"}`} onClick={() => setSelectedTurn(item.turnId)} type="button"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#e2f3ec] px-2.5 py-1 text-[10px] font-black text-[#0d6858]">{item.coursePackLabel}</span><span className="rounded-full bg-[#eef1ef] px-2.5 py-1 text-[10px] font-black text-[#60716c]">{item.episode}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${item.aiMode === "MODEL_ASSISTED" ? "bg-[#eaf0ff] text-[#405da8]" : "bg-[#fff0df] text-[#9a6312]"}`}>{item.aiMode === "MODEL_ASSISTED" ? "模型＋规则" : "确定性降级"}</span>{item.review ? <span className="rounded-full bg-[#f0eaff] px-2.5 py-1 text-[10px] font-black text-[#6a4da0]">教师：{REVIEW_LABELS[item.review.decision]}</span> : null}</div><p className="mt-3 text-sm font-black text-[#17332d]">学生：{item.studentMessage}</p><p className="mt-2 text-sm text-[#4f6760]">{item.reply.title}</p><p className="mt-2 text-[11px] text-[#71847f]">{item.decisionCode} · {item.responseStrategy} · {item.responseLatencyMs}ms</p><p className="mt-1 text-[10px] text-[#71847f]">策略 {item.policy.policyId}@{item.policy.policyVersion} · 工具 {item.toolCalls.length} · 来源 {item.sourceIds.length ? item.sourceIds.join("、") : "通用设计建议"}</p></button></li>)}</ol>
      {selected ? <DecisionDetail item={selected} onReview={onReview} pending={pending} /> : null}
    </div>}
  </section>;
}

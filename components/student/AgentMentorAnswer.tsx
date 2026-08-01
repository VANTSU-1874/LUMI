"use client";

import { useState } from "react";

import type { AgentTurnResponse } from "@/lib/agent/contracts";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { AgentExecutionTimeline } from "@/components/common/AgentExecutionTimeline";
import type { ToolAdapterTarget } from "@/lib/tool-adapters/contract";

type OpenTool = (tool: ToolAdapterTarget, focus?: string | null) => void;

const POLICY_RULE_LABELS: Readonly<Record<string, string>> = {
  BOUND_EXECUTION: "执行次数与时间受限",
  REGISTERED_TOOLS_ONLY: "仅调用已注册 Plugin / Skill 工具",
  READ_ONLY_TOOLS_AUTOMATIC: "仅只读工具可自动执行",
  PERSIST_EXECUTION_TRACE: "执行链已留痕",
  GROUND_COURSE_FACTS: "课程与案例事实均标注依据",
  ALLOW_GENERAL_DESIGN: "允许通用设计建议",
  GROUND_ARTWORK_OBSERVATION: "作品观察来自本轮图片",
  EXTERNAL_SEARCH_CONFIRMED: "本轮联网检索已获确认",
  GROUND_EXTERNAL_SOURCES: "联网资料已标注可核对来源",
  DEGRADE_UNAVAILABLE_WEB_SEARCH: "联网不可用时保留普通导师回答",
  DEGRADE_UNAVAILABLE_VISION: "无视觉能力时明确降级",
  MINIMUM_SUFFICIENT_SOURCES: "只保留最小充分来源",
  EPISODE_ACTION_ALLOWLIST: "行动符合当前学习情境",
  STUDENT_CONFIRM_MUTATIONS: "改变学习状态需你确认",
  FORBID_FORMAL_AUTHORITY: "禁止自动评分、过关和教师复核",
  DISCLOSE_NO_EVIDENCE: "资料未命中时说明建议边界",
  NORMALIZE_OUT_OF_SCOPE: "正式权限请求不误触发执行",
  ESCALATE_UNRESOLVED: "无法解决时转教师",
};

export function AgentMentorAnswer({
  turn,
  onOpenTool,
  execute,
  canReject = false,
  message,
  isStreaming = false,
}: {
  turn: AgentTurnResponse;
  onOpenTool: OpenTool;
  execute: (turn: AgentTurnResponse, actionId: string, decision?: "APPROVE" | "REJECT") => Promise<{ navigation: { target: ToolAdapterTarget; focus: string | null } | null }>;
  canReject?: boolean;
  message?: string;
  isStreaming?: boolean;
}) {
  const [actionError, setActionError] = useState("");
  const [executing, setExecuting] = useState<string | null>(null);
  const answerBasis = turn.reply.basis ?? (turn.reply.sources.length > 0
    ? [{ kind: "COURSE_KNOWLEDGE" as const, label: "专业资料" }]
    : [{ kind: "GENERAL_DESIGN" as const, label: "通用设计建议" }]);
  const publicWebSources = turn.reply.sources.filter(
    (source) => source.authority === "PUBLIC_WEB" && source.url,
  );
  const detailedSources = turn.reply.sources.filter(
    (source) => source.authority !== "PUBLIC_WEB",
  );
  const incompleteCopy = turn.reply.incomplete?.reason === "MODEL_TIMEOUT"
    ? "模型响应超时；以下为已经收到的正文。"
    : turn.reply.incomplete
      ? "模型连接中断；以下为已经收到的正文。"
      : null;

  function speak() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(`${turn.reply.title}。${message ?? turn.reply.message}`));
  }

  async function confirm(actionId: string, decision: "APPROVE" | "REJECT" = "APPROVE") {
    setExecuting(actionId);
    setActionError("");
    try {
      const result = await execute(turn, actionId, decision);
      if (result.navigation) onOpenTool(result.navigation.target, result.navigation.focus);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "行动执行失败");
    } finally {
      setExecuting(null);
    }
  }

  return <Message aria-live="polite" className="max-w-[44rem]" from="assistant" role="article">
    <div className="flex items-start gap-3.5">
      <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[#17332d] text-xs text-[#ffbf47]" aria-hidden="true">✦</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-[#27322e]">触映</p>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${turn.aiMode === "MODEL_ASSISTED" ? "bg-[#e7f2ed] text-[#176752]" : "bg-[#fff3d8] text-[#8a620c]"}`}>{turn.aiMode === "MODEL_ASSISTED" ? "模型协作" : "规则降级"}</span>
          {incompleteCopy ? <span className="rounded-full bg-[#fff3d8] px-2 py-0.5 text-[9px] font-semibold text-[#8a620c]">未完成</span> : null}
          <button aria-label="朗读回答" className="ml-auto grid size-9 place-items-center rounded-lg text-[#6f7874] hover:bg-[#f1f2ef]" onClick={speak} type="button"><SpeakerIcon /></button>
        </div>
        <h2 className="mt-2 text-lg font-semibold leading-7 text-[#202825]">{turn.reply.title}</h2>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="本回答采用的依据类型">
          {answerBasis.map((basis) => <span className="rounded-md bg-[#eef2ef] px-2 py-1 text-[9px] font-semibold text-[#52605a]" key={basis.kind}>{basis.label}</span>)}
        </div>
        <MessageContent className="mt-3 w-full max-w-none overflow-visible p-0 text-[#26302c]">
          <MessageResponse isAnimating={isStreaming}>{message ?? turn.reply.message}</MessageResponse>
        </MessageContent>
        {incompleteCopy ? <p className="mt-3 rounded-lg border border-[#f0d699] bg-[#fff9e8] px-3 py-2 text-xs leading-5 text-[#765c20]" role="status">{incompleteCopy} 未补写、未替换为通用套话。</p> : null}
        {publicWebSources.length > 0 ? <section aria-label="本回答的联网来源" className="mt-3 rounded-xl border border-[#dbe8e2] bg-[#f7fbf9] px-3 py-2.5">
          <p className="text-[10px] font-semibold text-[#397565]">联网来源 · 请核对原文与发布日期</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{publicWebSources.map((source) => <a className="rounded-lg bg-white px-2.5 py-1 text-[10px] font-medium text-[#315f52] underline decoration-[#94b4a9] underline-offset-2" href={source.url} key={source.id} rel="noopener noreferrer nofollow" target="_blank" title={source.scope}>{source.title} · {new URL(source.url!).hostname} · 联网来源</a>)}</div>
        </section> : null}

        {turn.reply.actions.length > 0 ? <section className="mt-5" aria-label="建议的下一步">
          <p className="mb-2 text-[10px] font-semibold tracking-[0.12em] text-[#7a837f]">下一步 · 需要你确认</p>
          <div className="space-y-2">{turn.reply.actions.map((action) => <div key={action.id}><button className="flex w-full items-center gap-3 rounded-xl border border-[#cbded6] bg-[#f7fbf9] px-3.5 py-3 text-left text-[#26332e] transition hover:border-[#81ae9e] hover:bg-[#eff7f3] disabled:cursor-default disabled:opacity-60" disabled={executing === action.id || action.status !== "PROPOSED"} onClick={() => void confirm(action.id)} type="button"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#dff0e9] text-[#176752]" aria-hidden="true">↗</span><span className="min-w-0 flex-1"><b className="block text-sm font-semibold">{action.status === "EXECUTED" ? "已确认 · " : action.status === "REJECTED" || action.status === "EXPIRED" ? "未执行 · " : "确认后 · "}{action.label}</b><span className="mt-0.5 block text-xs leading-5 text-[#6a746f]">{action.description}</span></span><span className="text-[#75807b]" aria-hidden="true">{action.status === "EXECUTED" ? "✓" : action.status === "REJECTED" || action.status === "EXPIRED" ? "—" : executing === action.id ? "…" : "→"}</span></button>{canReject && action.status === "PROPOSED" ? <button className="mt-1.5 px-2 py-1 text-xs font-medium text-[#7a6250] underline decoration-[#cdbdad] underline-offset-2 disabled:opacity-50" disabled={executing === action.id} onClick={() => void confirm(action.id, "REJECT")} type="button">保留回答，但不执行这一步</button> : null}</div>)}</div>
        </section> : null}
        {actionError ? <p className="mt-2 text-sm text-[#a44332]" role="alert">{actionError}</p> : null}

        <details className="group mt-4 rounded-xl border border-[#e5e6e2] bg-[#fafaf8]">
          <summary className="cursor-pointer list-none px-4 py-3 text-xs font-medium text-[#59635f]">查看依据与判断过程 <span className="float-right transition group-open:rotate-180">⌄</span></summary>
          <div className="space-y-4 border-t border-[#e7e8e4] px-4 pb-4 pt-3">
            <div aria-label="回答依据"><p className="text-[10px] font-semibold text-[#68736e]">具体资料</p><div className="mt-2 flex flex-wrap gap-1.5">{detailedSources.length > 0 ? detailedSources.map((source) => {
              const content = <>{source.title} · {sourceAuthorityLabel(source.authority)}</>;
              const className = "rounded-lg bg-[#eef2ef] px-2.5 py-1 text-[10px] font-medium text-[#52605a]";
              return source.url
                ? <a className={`${className} underline decoration-[#94b4a9] underline-offset-2`} href={source.url} key={source.id} rel="noopener noreferrer nofollow" target="_blank" title={source.scope}>{content}</a>
                : <span className={className} key={source.id} title={source.scope}>{content}</span>;
            }) : publicWebSources.length > 0
              ? <span className="rounded-lg bg-[#f1f2ef] px-2.5 py-1 text-[10px] font-medium text-[#64706b]">联网来源已在回答正文下方列出</span>
              : answerBasis.some(({ kind }) => kind === "CALCULATION")
                ? <span className="rounded-lg bg-[#f1f2ef] px-2.5 py-1 text-[10px] font-medium text-[#64706b]">本回答使用了无需外部出处的确定性工具结果</span>
              : <span className="rounded-lg bg-[#f1f2ef] px-2.5 py-1 text-[10px] font-medium text-[#64706b]">本回答未调用课程、案例或工具资料</span>}</div></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <section><h3 className="text-[10px] font-semibold text-[#397565]">为什么建议这一步</h3><p className="mt-1.5 text-xs leading-5 text-[#53615c]">{turn.reply.whyThisStep}</p></section>
              <section><h3 className="text-[10px] font-semibold text-[#947229]">尚不确定</h3><p className="mt-1.5 text-xs leading-5 text-[#665f4b]">{turn.reply.uncertainty}</p></section>
            </div>
            <section aria-label="Agent 运行约束" className="rounded-xl border border-[#dfe6e1] bg-white px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[10px] font-semibold text-[#397565]">Agent 运行约束</h3>
                <span className="rounded-md bg-[#edf4f0] px-2 py-0.5 text-[9px] font-semibold text-[#42675c]">{turn.policy.policyId}@{turn.policy.policyVersion}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#53615c]">导师主循环决策 {turn.policy.budgets.modelDecisions}/{turn.policy.budgets.maxModelDecisions} · 工具调用 {turn.policy.budgets.toolCalls}/{turn.policy.budgets.maxToolCalls} · {Math.round(turn.policy.budgets.turnTimeoutMs / 1_000)} 秒上限</p>
              <p className="mt-1 text-xs leading-5 text-[#53615c]">只读查询与确定性计算可自动；改变学习状态需你确认；评分、过关与教师复核禁止自动执行。</p>
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="本回合已应用规则">
                {turn.policy.appliedRules.map((rule) => <span className="rounded-md bg-[#f3f5f2] px-2 py-1 text-[9px] font-medium text-[#627069]" key={rule} title={rule}>{POLICY_RULE_LABELS[rule] ?? rule}</span>)}
              </div>
            </section>
            <AgentExecutionTimeline steps={turn.executionSteps} />
            <AgentGraph turn={turn} />
          </div>
        </details>
      </div>
    </div>
  </Message>;
}

function sourceAuthorityLabel(authority: AgentTurnResponse["reply"]["sources"][number]["authority"]) {
  if (authority === "OFFICIAL") return "官方";
  if (authority === "LEARNING_RECORD") return "学习记录";
  if (authority === "ANONYMIZED_CASE") return "案例";
  if (authority === "STUDENT_ARTWORK") return "作品观察";
  if (authority === "PUBLIC_WEB") return "联网来源";
  return "课程";
}

function AgentGraph({ turn }: { turn: AgentTurnResponse }) {
  const positions = turn.reply.graph.nodes.map((_, index) => ({ x: 24 + index * 150, y: index % 2 === 0 ? 28 : 82 }));
  const byId = new Map(turn.reply.graph.nodes.map((node, index) => [node.id, positions[index]]));
  return <div className="overflow-x-auto rounded-xl border border-[#e1e5e1] bg-white p-3" aria-label="回答关系图">
    <svg className="h-44 min-w-[36rem]" role="img" viewBox="0 0 680 172" aria-label={turn.reply.graph.nodes.map(({ label }) => label).join("、")}>
      <defs><marker id={`agent-arrow-${turn.turnId}`} markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3"><path d="M0,0 L6,3 L0,6 Z" fill="#70a99b" /></marker></defs>
      {turn.reply.graph.links.map(([from, to]) => { const start = byId.get(from); const end = byId.get(to); if (!start || !end) return null; return <path d={`M ${start.x + 112} ${start.y + 28} C ${start.x + 132} ${start.y + 28}, ${end.x - 20} ${end.y + 28}, ${end.x} ${end.y + 28}`} fill="none" key={`${from}-${to}`} markerEnd={`url(#agent-arrow-${turn.turnId})`} stroke="#70a99b" strokeWidth="2" />; })}
      {turn.reply.graph.nodes.map((node, index) => { const position = positions[index]; const fill = node.kind === "ACTION" ? "#fff4d3" : node.kind === "EVIDENCE" ? "#eef7ff" : "#ffffff"; return <g key={node.id} transform={`translate(${position.x} ${position.y})`}><rect fill={fill} height="56" rx="12" stroke="#9bcbbf" width="112" /><text fill="#789089" fontSize="8" fontWeight="800" letterSpacing="1" textAnchor="middle" x="56" y="18">{node.kind}</text><text fill="#17332d" fontSize="10" fontWeight="800" textAnchor="middle" x="56" y="38">{node.label.slice(0, 15)}</text></g>; })}
    </svg>
  </div>;
}

function SpeakerIcon() {
  return <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M5 9v6h4l5 4V5L9 9H5Z" /><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11" /></svg>;
}

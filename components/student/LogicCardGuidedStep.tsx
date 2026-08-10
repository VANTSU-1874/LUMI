"use client";

import { useEffect, useRef, useState } from "react";

import { LogicCardCoachResponseSchema, type LogicCardCoachResponse } from "@/lib/domain/logic-card-coach-contract";
import { GUIDANCE_STEPS, humanizeReviewIssue, type CardField, type LogicCardDraft } from "@/lib/domain/logic-card-guidance";

type GuidanceStep = (typeof GUIDANCE_STEPS)[number];

export function LogicCardGuidedStep({
  projectId,
  card,
  step,
  stepIndex,
  issue,
  pending,
  allAnswered,
  rawAnswer,
  onDraftChange,
  onConfirm,
  onPrevious,
  onNext,
  onSubmit,
}: {
  projectId: string;
  card: LogicCardDraft;
  step: GuidanceStep;
  stepIndex: number;
  issue: string | null;
  pending: boolean;
  allAnswered: boolean;
  rawAnswer: string;
  onDraftChange: (field: CardField, value: string) => void;
  onConfirm: (field: CardField, value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onSubmit: () => void;
}) {
  const [coaching, setCoaching] = useState(false);
  const [coachResult, setCoachResult] = useState<LogicCardCoachResponse | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);

  useEffect(() => () => {
    requestRef.current?.abort();
    requestSequenceRef.current += 1;
  }, []);

  const normalizedRaw = rawAnswer.trim();
  const normalizedConfirmed = card[step.key].trim();
  const hasUnconfirmedDraft = normalizedRaw !== normalizedConfirmed;
  const stepConfirmed = normalizedConfirmed.length > 0 && !hasUnconfirmedDraft;

  function changeRawAnswer(value: string) {
    requestRef.current?.abort();
    requestSequenceRef.current += 1;
    setCoachResult(null);
    setCoachError(null);
    onDraftChange(step.key, value);
  }

  function confirm(value: string) {
    const normalized = value.trim();
    if (!normalized) return;
    setCoachResult(null);
    setCoachError(null);
    onConfirm(step.key, normalized);
  }

  async function askCoach() {
    if (!normalizedRaw || coaching) return;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    setCoaching(true);
    setCoachError(null);
    setCoachResult(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/logic-card/coach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ field: step.key, answer: normalizedRaw, card }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
      if (!response.ok) {
        const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : "Agent 暂时没有接上";
        throw new Error(message);
      }
      const parsed = LogicCardCoachResponseSchema.safeParse(payload);
      if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.field !== step.key) {
        throw new Error("Agent 的澄清结果暂不可用");
      }
      setCoachResult(parsed.data);
    } catch (error) {
      if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
      setCoachError(error instanceof Error ? error.message : "Agent 暂时没有接上");
    } finally {
      if (sequence === requestSequenceRef.current) {
        requestRef.current = null;
        setCoaching(false);
      }
    }
  }

  return (
    <div className="rounded-[1.5rem] border border-[#cfe0d8] bg-[#f3f8f5] p-5">
      <div className="flex gap-3">
        <div aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#17332d] text-[#ffbf47]">✦</div>
        <div>
          <p className="text-xs font-black text-[#178b73]">Agent 正在问第 {stepIndex + 1} 件事</p>
          <h3 className="mt-1 text-lg font-black text-[#17332d]">{step.question}</h3>
          <p className="mt-1 text-sm leading-6 text-[#58706a]">{step.helper}</p>
        </div>
      </div>

      {issue ? <div className="mt-4 rounded-2xl border border-[#efcf79] bg-[#fff8df] p-4 text-sm leading-6 text-[#704d00]" role="status"><strong className="block">先补这一处</strong>{humanizeReviewIssue(issue)}</div> : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {step.suggestions.map((suggestion) => <button className="rounded-2xl border border-[#bfd4cc] bg-white px-4 py-3 text-left text-sm font-bold text-[#294a41] transition hover:border-[#178b73] hover:bg-[#eaf7f2]" disabled={pending || coaching} key={suggestion} onClick={() => confirm(suggestion)} type="button">{suggestion}</button>)}
      </div>

      <label className="mt-4 grid gap-2">
        <span className="text-sm font-black text-[#17332d]">先说你现在想到的，哪怕只有一个词</span>
        <textarea aria-label={`回答：${step.question}`} className="min-h-24 rounded-2xl border border-[#bfd0c9] bg-white p-3 text-[#17332d]" disabled={pending || coaching} maxLength={500} onChange={(event) => changeRawAnswer(event.target.value)} placeholder="例如：热闹、会动、跟声音有关……" value={rawAnswer} />
      </label>
      {hasUnconfirmedDraft && normalizedConfirmed ? <p className="mt-2 text-xs text-[#58706a]">关系链暂时保留上一次确认的表达，等你确认这次修改后再更新。</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="rounded-xl bg-[#17332d] px-5 py-3 font-black text-white disabled:opacity-40" disabled={!normalizedRaw || pending || coaching} onClick={() => void askCoach()} type="button">{coaching ? "Agent 正在理解你的意思…" : "让 Agent 帮我理清"}</button>
        {normalizedRaw && hasUnconfirmedDraft ? <button className="rounded-xl border border-[#9db7ae] bg-white px-4 py-3 text-sm font-bold text-[#294a41]" disabled={pending || coaching} onClick={() => confirm(normalizedRaw)} type="button">先保留我的原话</button> : null}
      </div>

      {coachResult ? <div aria-live="polite" className="mt-4 rounded-2xl border border-[#9bd5c8] bg-white p-4">
        <p className="text-sm text-[#58706a]">{coachResult.acknowledgement}</p>
        <h4 className="mt-2 font-black text-[#17332d]">{coachResult.question}</h4>
        <div className="mt-3 grid gap-2">
          {coachResult.options.map((option) => <button className="rounded-xl border border-[#c7d8d2] px-4 py-3 text-left hover:border-[#178b73] hover:bg-[#eaf7f2]" key={option.id} onClick={() => confirm(option.value)} type="button"><strong className="block text-sm text-[#17332d]">{option.label}</strong>{option.value !== option.label ? <span className="mt-1 block text-xs leading-5 text-[#58706a]">整理为：{option.value}</span> : null}</button>)}
        </div>
        <p className="mt-3 text-xs text-[#58706a]">{coachResult.mode === "MODEL_ASSISTED" ? "Agent 结合你的原话和前面关系生成" : "模型暂时不可用，当前使用课程基础引导"}</p>
      </div> : null}
      {coachError ? <p className="mt-3 rounded-xl bg-[#fff8df] p-3 text-sm text-[#704d00]" role="alert">{coachError}。你可以保留原话继续，或者选择上面的例子。</p> : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#d9e5e0] pt-4">
        <button className="text-sm font-bold text-[#58706a] underline disabled:opacity-40" disabled={stepIndex === 0 || pending || coaching} onClick={onPrevious} type="button">返回上一问</button>
        {stepIndex < GUIDANCE_STEPS.length - 1
          ? <button className="rounded-xl bg-[#17332d] px-5 py-3 font-black text-white disabled:opacity-40" disabled={!stepConfirmed || pending || coaching} onClick={onNext} type="button">继续下一问</button>
          : <button className="rounded-xl bg-[#e9ad2f] px-5 py-3 font-black text-[#17332d] disabled:opacity-40" disabled={!allAnswered || !stepConfirmed || pending || coaching} onClick={onSubmit} type="button">{pending ? "Agent 正在检查关系…" : "让 Agent 检查这条关系"}</button>}
      </div>
    </div>
  );
}

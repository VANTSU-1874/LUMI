"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { LogicCardResponseSchema, type LogicCardResponse } from "@/lib/domain/logic-card-contract";
import type { StudentDashboard } from "@/lib/domain/student-dashboard";

import {
  emptyLogicCard,
  firstIncompleteStep,
  GUIDANCE_STEPS,
  stepForReviewIssues,
  type CardField,
  type LogicCardDraft,
} from "@/lib/domain/logic-card-guidance";

import { LogicCardGuidedStep } from "./LogicCardGuidedStep";

type ReviewResult = Pick<LogicCardResponse, "ruleReady" | "semanticReady" | "status" | "source" | "issues">;

function statusOfStep(index: number, activeStep: number, value: string) {
  if (index === activeStep) return value.trim().length > 0 ? "已经确认，可继续" : "正在一起想";
  if (value.trim().length > 0) return "已经确认";
  return "稍后再想";
}

export function LogicCardForm({
  projectId,
  initialState = null,
  readOnly = false,
  onUnlocked,
  onSaved,
}: {
  projectId: string;
  initialState?: StudentDashboard["logicCard"];
  readOnly?: boolean;
  onUnlocked?: () => void;
  onSaved?: (result: LogicCardResponse) => void;
}) {
  const initialCard = initialState?.payload ?? emptyLogicCard();
  const [card, setCard] = useState<LogicCardDraft>(initialCard);
  const [draftAnswers, setDraftAnswers] = useState<LogicCardDraft>(initialCard);
  const [activeStep, setActiveStep] = useState(() => initialState?.status === "NEEDS_REVISION"
    ? stepForReviewIssues(initialState.issues, initialCard)
    : firstIncompleteStep(initialCard));
  const [showDirectEditor, setShowDirectEditor] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(initialState);
  const [locallyLocked, setLocallyLocked] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const hydratedRevisionRef = useRef(initialState?.revision ?? 0);
  const current = GUIDANCE_STEPS[activeStep];
  const currentIssue = useMemo(() => result?.status === "NEEDS_REVISION"
    ? result.issues.find((issue) => stepForReviewIssues([issue], card) === activeStep) ?? result.issues[0]
    : null, [activeStep, card, result]);

  useEffect(() => {
    let active = true;
    requestRef.current?.abort();
    requestRef.current = null;
    requestSequenceRef.current += 1;
    inFlightRef.current = false;
    queueMicrotask(() => {
      if (!active) return;
      const next = initialState?.payload ?? emptyLogicCard();
      setCard(next);
      setDraftAnswers(next);
      setActiveStep(initialState?.status === "NEEDS_REVISION"
        ? stepForReviewIssues(initialState.issues, next)
        : firstIncompleteStep(next));
      setPending(false);
      setError(null);
      setResult(initialState);
      setLocallyLocked(false);
      dirtyRef.current = false;
      hydratedRevisionRef.current = initialState?.revision ?? 0;
    });
    return () => {
      active = false;
      requestRef.current?.abort();
      requestRef.current = null;
      requestSequenceRef.current += 1;
      inFlightRef.current = false;
    };
    // initialState is handled by the revision-aware hydration effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!initialState || initialState.revision <= hydratedRevisionRef.current || dirtyRef.current) return;
    hydratedRevisionRef.current = initialState.revision;
    queueMicrotask(() => {
      if (dirtyRef.current) return;
      setCard(initialState.payload);
      setDraftAnswers(initialState.payload);
      setResult(initialState);
      if (initialState.status === "NEEDS_REVISION") {
        setActiveStep(stepForReviewIssues(initialState.issues, initialState.payload));
      }
    });
  }, [initialState]);

  function updateField(key: keyof LogicCardDraft, value: string) {
    dirtyRef.current = true;
    setResult(null);
    setCard((previous) => ({ ...previous, [key]: value }));
    setDraftAnswers((previous) => ({ ...previous, [key]: value }));
  }

  function updateDraft(key: CardField, value: string) {
    dirtyRef.current = true;
    setResult(null);
    setDraftAnswers((previous) => ({ ...previous, [key]: value }));
  }

  async function submit() {
    if (inFlightRef.current || locallyLocked) return;
    inFlightRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/logic-card`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(card),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
      if (!response.ok) {
        const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : "提交失败，请稍后重试";
        throw new Error(message);
      }
      const parsed = LogicCardResponseSchema.safeParse(payload);
      if (!parsed.success || parsed.data.projectId !== projectId) throw new Error("审查结果暂不可用");
      setResult(parsed.data);
      dirtyRef.current = false;
      hydratedRevisionRef.current = parsed.data.revision;
      onSaved?.(parsed.data);
      if (parsed.data.status === "APPROVED") {
        setLocallyLocked(true);
        onUnlocked?.();
      } else if (parsed.data.status === "NEEDS_REVISION") {
        setActiveStep(stepForReviewIssues(parsed.data.issues, card));
        setShowDirectEditor(false);
      }
    } catch (caught) {
      if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
      setError(caught instanceof Error ? caught.message : "提交失败，请稍后重试");
    } finally {
      if (sequence === requestSequenceRef.current) {
        requestRef.current = null;
        inFlightRef.current = false;
        setPending(false);
      }
    }
  }

  const allAnswered = GUIDANCE_STEPS.every(({ key }) => card[key].trim().length > 0);

  return (
    <section className="space-y-5 rounded-[1.75rem] border border-[#dce4df] bg-[#fffef9] p-5 shadow-[0_8px_28px_rgba(23,51,45,0.06)] sm:p-7">
      <header>
        <p className="text-xs font-black tracking-[0.18em] text-[#178b73]">AGENT 引导形成</p>
        <h2 className="mt-1 text-2xl font-black text-[#17332d]">先把互动关系想明白</h2>
        <p className="mt-2 text-sm leading-6 text-[#58706a]">不用懂专业术语。我一次只问一件事，你可以选一个接近的例子，也可以用自己的话回答。</p>
      </header>

      <ol aria-label="正在形成的互动关系" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {GUIDANCE_STEPS.map((step, index) => {
          const answered = card[step.key].trim().length > 0;
          const selected = index === activeStep;
          return <li key={step.key}><button
            aria-current={selected ? "step" : undefined}
            className={`min-h-20 w-full rounded-2xl border p-3 text-left transition ${selected ? "border-[#e0a21b] bg-[#fff4cf]" : answered ? "border-[#9bd5c8] bg-[#eaf7f2]" : "border-[#dce4df] bg-white"}`}
            disabled={readOnly || pending || locallyLocked}
            onClick={() => setActiveStep(index)}
            type="button"
          ><span className="block text-xs font-black text-[#58706a]">{String(index + 1).padStart(2, "0")} · {statusOfStep(index, activeStep, card[step.key])}</span><span className="mt-1 block font-black text-[#17332d]">{step.chainLabel}</span><span className="mt-1 block truncate text-xs text-[#58706a]">{answered ? card[step.key] : "还没有形成"}</span></button></li>;
        })}
      </ol>

      {!readOnly && !locallyLocked ? <LogicCardGuidedStep
        allAnswered={allAnswered}
        card={card}
        issue={currentIssue}
        key={`${projectId}:${current.key}`}
        onConfirm={(field: CardField, value: string) => updateField(field, value)}
        onDraftChange={updateDraft}
        onNext={() => setActiveStep((value) => Math.min(GUIDANCE_STEPS.length - 1, value + 1))}
        onPrevious={() => setActiveStep((value) => Math.max(0, value - 1))}
        onSubmit={() => void submit()}
        pending={pending}
        projectId={projectId}
        rawAnswer={draftAnswers[current.key]}
        step={current}
        stepIndex={activeStep}
      /> : null}

      {result ? <div aria-live="polite" className={`rounded-2xl p-4 text-sm leading-6 ${result.status === "APPROVED" ? "bg-[#eaf7f2] text-[#0d6858]" : result.status === "PENDING" ? "bg-[#fff8df] text-[#704d00]" : "bg-[#f3f8f5] text-[#294a41]"}`}><strong className="block text-base">{result.status === "APPROVED" ? "这条互动关系已经连通" : result.status === "PENDING" ? "关系已保存，等待智能审查" : "Agent 会陪你一处一处补清楚"}</strong>{result.status === "APPROVED" ? <p>已经解锁下一步工具路径。</p> : result.status === "PENDING" ? <p>模型暂时没有给出可靠结果，请稍后重新检查。</p> : <p>目前还有 {result.issues.length} 处关系需要确认，页面已经回到第一处。</p>}</div> : null}
      {error ? <p className="rounded-xl bg-red-50 p-3 text-red-700" role="alert">{error}</p> : null}

      {!readOnly && !locallyLocked ? <div className="border-t border-[#e2e9e5] pt-4"><button aria-expanded={showDirectEditor} className="text-sm font-bold text-[#58706a] underline" onClick={() => setShowDirectEditor((value) => !value)} type="button">我已经会了，直接编辑专业卡</button>{showDirectEditor ? <div className="mt-4 grid gap-4 rounded-2xl bg-white p-4">{GUIDANCE_STEPS.map(({ key, directLabel, question }) => <label className="grid gap-1" key={key}><span className="font-bold text-[#17332d]">{directLabel}</span><span className="text-xs text-[#58706a]">{question}</span><textarea aria-label={directLabel} className="min-h-20 rounded-xl border border-[#c9d6d1] p-3" disabled={pending} maxLength={500} onChange={(event) => updateField(key, event.target.value)} value={card[key]} /></label>)}<button className="justify-self-start rounded-xl bg-[#17332d] px-5 py-3 font-black text-white disabled:opacity-40" disabled={pending} onClick={() => void submit()} type="button">{pending ? "Agent 正在检查关系…" : "提交逻辑卡"}</button></div> : null}</div> : null}
    </section>
  );
}

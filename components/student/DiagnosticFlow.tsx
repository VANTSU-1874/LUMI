"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DiagnosticProfileResponseSchema,
  type LearnerProfile,
} from "@/lib/domain/diagnostic";

type PublicQuestion = {
  id: string;
  scenario: string;
  options: Array<{ id: string; label: string }>;
};

type DiagnosticLevel = LearnerProfile["level"];

export type { LearnerProfile } from "@/lib/domain/diagnostic";

type DiagnosticFlowProps = {
  onComplete?: (profile: LearnerProfile) => void;
};

const dimensionLabels: Array<[keyof Pick<
  LearnerProfile,
  | "decomposition"
  | "signalUnderstanding"
  | "mappingDesign"
  | "troubleshooting"
  | "transfer"
>, string]> = [
  ["decomposition", "任务拆解"],
  ["signalUnderstanding", "信号理解"],
  ["mappingDesign", "映射设计"],
  ["troubleshooting", "排查定位"],
  ["transfer", "迁移应用"],
];

const levelDescriptions: Record<DiagnosticLevel, string> = {
  L1: "L1 · 从基础开始",
  L2: "L2 · 能够按步骤完成",
  L3: "L3 · 能够独立整合",
  L4: "L4 · 能够独立迁移",
};

class UserFacingError extends Error {}

class VersionConflictError extends UserFacingError {}

async function responsePayload(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new UserFacingError("服务返回了无法识别的内容，请稍后重试");
  }
}

function errorMessage(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

function parseQuestions(payload: unknown) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("questionSetVersion" in payload) ||
    typeof payload.questionSetVersion !== "string" ||
    !("questions" in payload) ||
    !Array.isArray(payload.questions) ||
    payload.questions.length !== 10
  ) {
    throw new UserFacingError("诊断题库暂不可用，请稍后重试");
  }
  const questions = payload.questions as unknown[];
  for (const question of questions) {
    if (
      typeof question !== "object" ||
      question === null ||
      !("id" in question) ||
      typeof question.id !== "string" ||
      !("scenario" in question) ||
      typeof question.scenario !== "string" ||
      !("options" in question) ||
      !Array.isArray(question.options) ||
      question.options.length !== 4 ||
      question.options.some(
        (option: unknown) =>
          typeof option !== "object" ||
          option === null ||
          !("id" in option) ||
          typeof option.id !== "string" ||
          !("label" in option) ||
          typeof option.label !== "string",
      )
    ) {
      throw new UserFacingError("诊断题库暂不可用，请稍后重试");
    }
  }
  return {
    questionSetVersion: payload.questionSetVersion,
    questions: questions as PublicQuestion[],
  };
}

function parseProfile(payload: unknown): LearnerProfile {
  const parsed = DiagnosticProfileResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new UserFacingError("诊断结果暂不可用，请稍后重试");
  }
  return parsed.data.profile;
}

export function DiagnosticFlow({ onComplete }: DiagnosticFlowProps) {
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [questionSetVersion, setQuestionSetVersion] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const loadControllerRef = useRef<AbortController | null>(null);
  const submitControllerRef = useRef<AbortController | null>(null);
  const questionPromptRef = useRef<HTMLParagraphElement>(null);

  const loadQuestions = useCallback(async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/diagnostic", {
        method: "GET",
        signal: controller.signal,
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new UserFacingError(
          errorMessage(payload, "诊断题库暂不可用，请稍后重试"),
        );
      }
      const loaded = parseQuestions(payload);
      setQuestions(loaded.questions);
      setQuestionSetVersion(loaded.questionSetVersion);
      setCurrentIndex(0);
      setAnswers({});
      setVersionConflict(false);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(
        caught instanceof UserFacingError
          ? caught.message
          : "诊断题库暂不可用，请稍后重试",
      );
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadQuestions();
    });
    return () => {
      active = false;
      loadControllerRef.current?.abort();
      submitControllerRef.current?.abort();
    };
  }, [loadQuestions]);

  useEffect(() => {
    if (questions.length > 0) questionPromptRef.current?.focus();
  }, [currentIndex, questions]);

  async function submit() {
    if (!questionSetVersion) return;
    submitControllerRef.current?.abort();
    const controller = new AbortController();
    submitControllerRef.current = controller;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/diagnostic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          questionSetVersion,
          answers: questions.map((question) => ({
            questionId: question.id,
            optionId: answers[question.id],
          })),
        }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        const message = errorMessage(payload, "提交失败，请稍后重试");
        if (response.status === 409) throw new VersionConflictError(message);
        throw new UserFacingError(message);
      }
      const completedProfile = parseProfile(payload);
      setProfile(completedProfile);
      onComplete?.(completedProfile);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (caught instanceof VersionConflictError) {
        setQuestionSetVersion(null);
        setVersionConflict(true);
      }
      setError(
        caught instanceof UserFacingError ? caught.message : "提交失败，请稍后重试",
      );
    } finally {
      if (submitControllerRef.current === controller) {
        submitControllerRef.current = null;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  }

  function restartAfterVersionConflict() {
    loadControllerRef.current?.abort();
    submitControllerRef.current?.abort();
    setQuestions([]);
    setQuestionSetVersion(null);
    setCurrentIndex(0);
    setAnswers({});
    setProfile(null);
    setVersionConflict(false);
    setError(null);
    setPending(false);
    void loadQuestions();
  }

  if (loading) {
    return <p aria-live="polite" className="rounded-[1.75rem] border border-[#dce4df] bg-[#fffef9] p-6 font-bold text-[#58706a]">正在准备交互情境…</p>;
  }

  if (profile) {
    return (
      <section className="space-y-5 rounded-[1.75rem] border border-[#b9ddcf] bg-[#fffef9] p-6 shadow-[0_12px_36px_rgba(23,51,45,0.08)]">
        <div>
          <p className="text-xs font-black tracking-[0.18em] text-[#178b73]">DIAGNOSTIC COMPLETE</p>
          <h2 className="mt-2 text-2xl font-black text-[#17332d]">你的学习画像</h2>
          <p className="mt-2 font-black text-[#0d6858]">{levelDescriptions[profile.level]}</p>
          <p className="mt-1 text-sm text-slate-500">综合表现 {profile.average.toFixed(1)}/4</p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          {dimensionLabels.map(([dimension, label]) => (
            <div className="rounded-xl bg-[#f0f6f2] p-4" key={dimension}>
              <dt className="text-sm text-slate-600">{label}</dt>
              <dd className="mt-1 text-xl font-black text-[#17332d]">
                {profile[dimension].toFixed(1)}/4
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-slate-600">诊断已完成，后续学习内容会参考这份画像。</p>
      </section>
    );
  }

  if (!questions.length) {
    return error ? (
      <div className="space-y-3">
        <p role="alert">{error}</p>
        <button onClick={() => void loadQuestions()} type="button">
          重新加载
        </button>
      </div>
    ) : null;
  }

  const question = questions[currentIndex];
  const selectedOption = answers[question.id];
  const isLast = currentIndex === questions.length - 1;

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-[#dce4df] bg-[#fffef9] shadow-[0_12px_36px_rgba(23,51,45,0.08)]">
      <div className="border-b border-[#e1e7e3] px-5 py-5 sm:px-7">
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-xs font-black tracking-[0.18em] text-[#178b73]">当前学习节点</p><h2 className="mt-1 text-xl font-black text-[#17332d]">交互情境诊断</h2></div>
          <span aria-live="polite" className="rounded-full bg-[#edf5f0] px-3 py-1 text-sm font-black text-[#0d6858]">{currentIndex + 1}/{questions.length}</span>
        </div>
        <div aria-hidden="true" className="mt-4 h-2 overflow-hidden rounded-full bg-[#e4eae6]"><div className="h-full rounded-full bg-[#178b73] transition-all" style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }} /></div>
      </div>

      <fieldset
        aria-labelledby={`diagnostic-question-${question.id}`}
        className="space-y-5 px-5 py-6 sm:px-7"
        disabled={pending || versionConflict}
      >
        <legend className="sr-only">第 {currentIndex + 1} 题</legend>
        <p
          className="text-lg font-black leading-8 text-[#17332d] outline-none sm:text-xl"
          id={`diagnostic-question-${question.id}`}
          ref={questionPromptRef}
          tabIndex={-1}
        >
          {question.scenario}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {question.options.map((option, optionIndex) => (
            <label
              className="flex cursor-pointer gap-3 rounded-2xl border-2 border-[#dce4df] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#8fc6b8] has-[:checked]:border-[#178b73] has-[:checked]:bg-[#eaf7f1]"
              key={option.id}
            >
              <input
                checked={selectedOption === option.id}
                className="mt-1 size-5 shrink-0 accent-[#178b73]"
                name={`diagnostic-${question.id}`}
                onChange={() =>
                  setAnswers((current) => ({ ...current, [question.id]: option.id }))
                }
                type="radio"
                value={option.id}
              />
              <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-lg text-sm font-black ${selectedOption === option.id ? "bg-[#178b73] text-white" : "bg-[#edf3ef] text-[#58706a]"}`}>{String.fromCharCode(65 + optionIndex)}</span>
              <span className="text-sm font-bold leading-6 text-[#3f5f56]">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {error ? <p className="mx-5 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700 sm:mx-7" role="alert">{error}</p> : null}

      <div className="flex gap-3 border-t border-[#e1e7e3] bg-[#f8faf7] px-5 py-5 sm:px-7">
        {!versionConflict && currentIndex > 0 ? (
          <button
            className="rounded-xl border-2 border-[#cbd8d2] bg-white px-5 py-3 font-black text-[#58706a]"
            disabled={pending}
            onClick={() => {
              setError(null);
              setCurrentIndex((index) => index - 1);
            }}
            type="button"
          >
            上一题
          </button>
        ) : null}
        {versionConflict ? (
          <button
            className="ml-auto rounded-xl border-b-4 border-[#0a594c] bg-[#178b73] px-5 py-3 font-black text-white"
            onClick={restartAfterVersionConflict}
            type="button"
          >
            重新开始诊断
          </button>
        ) : (
          <button
            className="ml-auto rounded-xl border-b-4 border-[#0a594c] bg-[#178b73] px-6 py-3 font-black text-white transition hover:-translate-y-0.5 disabled:opacity-50"
            disabled={!selectedOption || pending}
            onClick={() => {
              if (isLast) {
                void submit();
              } else {
                setError(null);
                setCurrentIndex((index) => index + 1);
              }
            }}
            type="button"
          >
            {pending ? "正在提交…" : isLast ? "提交诊断" : "下一题"}
          </button>
        )}
      </div>
    </section>
  );
}

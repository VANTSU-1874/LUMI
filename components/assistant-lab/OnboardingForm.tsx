"use client";

import { useState } from "react";

import {
  type StudentDeclaredMajor,
  type StudentOnboardingProfile,
  type StudentOnboardingUpdate,
  type StudentSelfAssessedLevel,
} from "@/lib/domain/student-onboarding";

import styles from "./onboarding.module.css";

const STEPS = [
  {
    eyebrow: "称呼",
    title: "希望 Lumi 怎么称呼你？",
    description: "昵称可以留空，届时继续使用你的注册名称。",
  },
  {
    eyebrow: "专业方向",
    title: "你目前更接近哪个专业方向？",
    description: "这只用于第一轮冷启动；对话里的关键词、当前视图和上一轮任务判断仍然优先。",
  },
  {
    eyebrow: "能力自评",
    title: "你觉得自己目前在哪个阶段？",
    description: "自评只帮助 Lumi 调整开场方式，不会覆盖系统实测档案，也不用于评分。",
  },
  {
    eyebrow: "兴趣方向",
    title: "最近想多探索什么？",
    description: "可以写课程、媒介或设计方向；它只影响建议与开场，不改变强制路由。",
  },
] as const;

const MAJOR_OPTIONS: Array<{
  value: StudentDeclaredMajor;
  label: string;
  detail: string;
}> = [
  { value: "general-design", label: "综合设计", detail: "视觉、品牌及尚未确定方向" },
  { value: "digital-interaction", label: "数字交互", detail: "交互装置、实时媒体与数字体验" },
  { value: "book-design", label: "书籍设计", detail: "书籍结构、阅读体验与版式表达" },
];

const LEVEL_OPTIONS: Array<{
  value: StudentSelfAssessedLevel;
  label: string;
  detail: string;
}> = [
  { value: "BEGINNER", label: "刚开始接触", detail: "希望从基本概念和示例开始" },
  { value: "FOUNDATION", label: "有一些基础", detail: "能跟着步骤完成，需要关键处提醒" },
  { value: "EXPERIENCED", label: "已有项目经验", detail: "通常能独立推进，希望获得判断反馈" },
];

type OnboardingFormProps = {
  initialProfile: StudentOnboardingProfile;
  mode?: "gate" | "settings";
  onSave: (input: StudentOnboardingUpdate) => Promise<void>;
};

export function OnboardingForm({
  initialProfile,
  mode = "gate",
  onSave,
}: OnboardingFormProps) {
  const [step, setStep] = useState(0);
  const [nickname, setNickname] = useState(initialProfile.nickname ?? "");
  const [major, setMajor] = useState<StudentDeclaredMajor | null>(initialProfile.major);
  const [selfAssessedLevel, setSelfAssessedLevel] =
    useState<StudentSelfAssessedLevel | null>(initialProfile.selfAssessedLevel);
  const [interests, setInterests] = useState(initialProfile.interests ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  const normalizedDraft = (): StudentOnboardingUpdate => ({
    nickname: nickname.trim() || null,
    major,
    selfAssessedLevel,
    interests: interests.trim() || null,
    markCompleted: true,
  });

  const finishOrAdvance = async (skip: boolean) => {
    setError(null);
    if (skip) {
      if (step === 0) setNickname("");
      if (step === 1) setMajor(null);
      if (step === 2) setSelfAssessedLevel(null);
      if (step === 3) setInterests("");
    }
    if (!isLastStep) {
      setStep((value) => value + 1);
      return;
    }

    const input = normalizedDraft();
    if (skip) input.interests = null;
    setSaving(true);
    try {
      await onSave(input);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "暂时无法保存，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="lumi-onboarding-title"
      className={styles.form}
      data-mode={mode}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.brand}>
            {mode === "gate" ? "LUMI · 初次见面" : "LUMI · 学习偏好"}
          </p>
          <p className={styles.progress}>第 {step + 1} 步，共 {STEPS.length} 步</p>
        </div>
        <div
          aria-label={`入门进度：第 ${step + 1} 步，共 ${STEPS.length} 步`}
          className={styles.progressTrack}
          role="progressbar"
          aria-valuemax={STEPS.length}
          aria-valuemin={1}
          aria-valuenow={step + 1}
        >
          {STEPS.map((item, index) => (
            <span data-active={index <= step} key={item.eyebrow} />
          ))}
        </div>
      </header>

      <div className={styles.copy}>
        <p className={styles.eyebrow}>{current.eyebrow}</p>
        <h1 id="lumi-onboarding-title">{current.title}</h1>
        <p>{current.description}</p>
      </div>

      <div className={styles.field}>
        {step === 0 ? (
          <label className={styles.textField}>
            <span>昵称（可选）</span>
            <input
              aria-label="昵称（可选）"
              autoComplete="nickname"
              autoFocus
              maxLength={40}
              onChange={(event) => setNickname(event.currentTarget.value)}
              placeholder={initialProfile.displayName}
              value={nickname}
            />
            <small>{nickname.length}/40</small>
          </label>
        ) : null}

        {step === 1 ? (
          <div aria-label="专业方向" className={styles.optionList} role="radiogroup">
            {MAJOR_OPTIONS.map((option) => (
              <button
                aria-checked={major === option.value}
                className={styles.option}
                data-selected={major === option.value}
                key={option.value}
                onClick={() => setMajor(option.value)}
                role="radio"
                type="button"
              >
                <span aria-hidden="true" className={styles.radio} />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <div aria-label="能力自评" className={styles.optionList} role="radiogroup">
            {LEVEL_OPTIONS.map((option) => (
              <button
                aria-checked={selfAssessedLevel === option.value}
                className={styles.option}
                data-selected={selfAssessedLevel === option.value}
                key={option.value}
                onClick={() => setSelfAssessedLevel(option.value)}
                role="radio"
                type="button"
              >
                <span aria-hidden="true" className={styles.radio} />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          <label className={styles.textField}>
            <span>感兴趣的课程或方向（可选）</span>
            <textarea
              aria-label="感兴趣的课程或方向（可选）"
              autoFocus
              maxLength={300}
              onChange={(event) => setInterests(event.currentTarget.value)}
              placeholder="例如：书籍装帧、字体设计、交互叙事"
              rows={4}
              value={interests}
            />
            <small>{interests.length}/300</small>
          </label>
        ) : null}
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <footer className={styles.footer}>
        {step > 0 ? (
          <button
            className={styles.backButton}
            disabled={saving}
            onClick={() => {
              setError(null);
              setStep((value) => value - 1);
            }}
            type="button"
          >
            返回
          </button>
        ) : <span />}
        <div className={styles.actions}>
          <button
            className={styles.actionButton}
            disabled={saving}
            onClick={() => void finishOrAdvance(true)}
            type="button"
          >
            {isLastStep
              ? mode === "gate" ? "跳过并进入 Lumi" : "清除此项并保存"
              : mode === "gate" ? "这步先跳过" : "清除此项"}
          </button>
          <button
            className={styles.actionButton}
            disabled={saving}
            onClick={() => void finishOrAdvance(false)}
            type="button"
          >
            {saving
              ? "正在保存…"
              : isLastStep
                ? mode === "gate" ? "保存并进入 Lumi" : "保存修改"
                : "继续"}
          </button>
        </div>
      </footer>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";

import {
  StudentOnboardingProfileSchema,
  type StudentOnboardingProfile,
  type StudentOnboardingUpdate,
} from "@/lib/domain/student-onboarding";

import { OnboardingForm } from "./OnboardingForm";
import styles from "./student-onboarding-settings.module.css";

type StudentOnboardingSettingsProps = {
  fetcher?: typeof fetch;
  onSaved?: (profile: StudentOnboardingProfile) => void;
};

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : "入门信息暂时不可用";
}

export function StudentOnboardingSettings({
  fetcher = fetch,
  onSaved,
}: StudentOnboardingSettingsProps) {
  const [profile, setProfile] = useState<StudentOnboardingProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetcher("/api/agent/onboarding", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        const parsed = StudentOnboardingProfileSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("入门信息格式无效");
        if (!controller.signal.aborted) setProfile(parsed.data);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "入门信息暂时不可用");
        }
      });
    return () => controller.abort();
  }, [attempt, fetcher]);

  if (error) {
    return (
      <div className={styles.state} role="alert">
        <p>{error}</p>
        <button onClick={() => {
          setError(null);
          setProfile(null);
          setSaved(false);
          setAttempt((value) => value + 1);
        }} type="button">
          重新读取
        </button>
      </div>
    );
  }
  if (!profile) {
    return <p className={styles.loading} role="status">正在读取学习偏好…</p>;
  }

  const save = async (input: StudentOnboardingUpdate) => {
    setSaved(false);
    const response = await fetcher("/api/agent/onboarding", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const parsed = StudentOnboardingProfileSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("保存后的入门信息格式无效");
    setProfile(parsed.data);
    setSaved(true);
    onSaved?.(parsed.data);
  };

  return (
    <div className={styles.root}>
      {saved ? (
        <p className={styles.saved} role="status">
          学习偏好已保存，下一轮对话会使用最新信息。
        </p>
      ) : null}
      <OnboardingForm
        initialProfile={profile}
        mode="settings"
        onSave={save}
      />
    </div>
  );
}

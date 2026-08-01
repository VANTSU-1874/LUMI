"use client";

import { useEffect, useState, type PropsWithChildren } from "react";

import {
  StudentOnboardingProfileSchema,
  type StudentOnboardingProfile,
  type StudentOnboardingUpdate,
} from "@/lib/domain/student-onboarding";

import { OnboardingForm } from "./OnboardingForm";
import styles from "./onboarding.module.css";

type GateState =
  | { name: "checking" }
  | { name: "onboarding"; profile: StudentOnboardingProfile }
  | { name: "ready" }
  | { name: "unavailable" };

const ONBOARDING_CHECK_TIMEOUT_MS = 5_000;

async function errorMessage(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : "暂时无法保存，请稍后重试";
}

export function OnboardingGate({
  children,
  fetcher = fetch,
}: PropsWithChildren<{ fetcher?: typeof fetch }>) {
  const [state, setState] = useState<GateState>({ name: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      setState({ name: "unavailable" });
    }, ONBOARDING_CHECK_TIMEOUT_MS);

    void fetcher("/api/agent/onboarding", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response));
        const parsed = StudentOnboardingProfileSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("入门信息格式无效");
        if (!controller.signal.aborted) {
          setState(parsed.data.completed
            ? { name: "ready" }
            : { name: "onboarding", profile: parsed.data });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ name: "unavailable" });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [attempt, fetcher]);

  if (state.name === "ready") return children;

  if (state.name === "checking") {
    return (
      <main aria-busy="true" className={styles.gate}>
        <p className={styles.status} role="status">正在准备你的 Lumi 工作台…</p>
      </main>
    );
  }

  if (state.name === "unavailable") {
    return (
      <main className={styles.gate}>
        <section className={styles.unavailable}>
          <p className={styles.brand}>LUMI · 初次见面</p>
          <h1>暂时无法读取入门信息</h1>
          <p>这不会改动你的账户资料。可以重新检查后继续。</p>
          <button
            className={styles.retryButton}
            onClick={() => {
              setState({ name: "checking" });
              setAttempt((value) => value + 1);
            }}
            type="button"
          >
            重新检查
          </button>
        </section>
      </main>
    );
  }

  const save = async (input: StudentOnboardingUpdate) => {
    const response = await fetcher("/api/agent/onboarding", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const parsed = StudentOnboardingProfileSchema.safeParse(await response.json());
    if (!parsed.success || !parsed.data.completed) {
      throw new Error("入门信息尚未完成保存");
    }
    setState({ name: "ready" });
  };

  return (
    <main className={styles.gate}>
      <OnboardingForm
        initialProfile={state.profile}
        onSave={save}
      />
    </main>
  );
}

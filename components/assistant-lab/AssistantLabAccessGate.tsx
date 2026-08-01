"use client";

import Link from "next/link";
import { useEffect, useState, type PropsWithChildren } from "react";

import styles from "./assistant-lab-access-gate.module.css";

type AccessState =
  | "checking"
  | "granted"
  | "login-required"
  | "wrong-role"
  | "unavailable";

const CHECKING_REVEAL_DELAY_MS = 300;
const SESSION_CHECK_TIMEOUT_MS = 5_000;

function loginHref(returnTo: string, mode?: "register") {
  const query = new URLSearchParams({ returnTo });
  if (mode) query.set("mode", mode);
  return `/login?${query.toString()}`;
}

export function AssistantLabAccessGate({
  children,
  returnTo = "/student",
}: PropsWithChildren<{ returnTo?: string }>) {
  const [access, setAccess] = useState<AccessState>("checking");
  const [attempt, setAttempt] = useState(0);
  const [showCheckingState, setShowCheckingState] = useState(false);
  const loginPath = loginHref(returnTo);
  const registerPath = loginHref(returnTo, "register");

  useEffect(() => {
    const controller = new AbortController();

    const revealTimer = window.setTimeout(() => {
      setShowCheckingState(true);
    }, CHECKING_REVEAL_DELAY_MS);
    const timeoutTimer = window.setTimeout(() => {
      controller.abort();
      setAccess("unavailable");
    }, SESSION_CHECK_TIMEOUT_MS);

    const finish = (nextAccess: AccessState) => {
      if (controller.signal.aborted) return;
      window.clearTimeout(revealTimer);
      window.clearTimeout(timeoutTimer);
      setAccess(nextAccess);
    };

    void fetch("/api/account/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (!response.ok) {
          finish(response.status === 401 || response.status === 403
            ? "login-required"
            : "unavailable");
          return;
        }
        const session: unknown = await response.json();
        if (
          typeof session !== "object"
          || session === null
          || !("user" in session)
          || typeof session.user !== "object"
          || session.user === null
        ) {
          finish("login-required");
          return;
        }
        const role = "role" in session.user ? session.user.role : undefined;
        finish(role === "STUDENT" ? "granted" : "wrong-role");
      })
      .catch(() => {
        if (!controller.signal.aborted) finish("unavailable");
      });

    return () => {
      controller.abort();
      window.clearTimeout(revealTimer);
      window.clearTimeout(timeoutTimer);
    };
  }, [attempt]);

  if (access === "granted") return children;

  if (access === "checking") {
    return (
      <main
        aria-busy="true"
        className={styles.checkingGate}
        data-visible={showCheckingState ? "true" : "false"}
      >
        <span className={styles.srOnly} role="status">
          正在确认登录状态
        </span>
        <aside aria-hidden="true" className={styles.checkingSidebar}>
          <div className={styles.checkingBrand}>
            <span />
            <span />
          </div>
          <div className={styles.checkingNav}>
            <span />
            <span />
            <span />
          </div>
        </aside>
        <section aria-hidden="true" className={styles.checkingWorkspace}>
          <header className={styles.checkingHeader}>
            <span />
            <span />
          </header>
          <div className={styles.checkingCanvas}>
            <div className={styles.checkingMessage}>
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className={styles.checkingComposer}>
            <span />
            <span />
          </div>
        </section>
      </main>
    );
  }

  if (access === "login-required") {
    return (
      <main className={styles.gate}>
        <section aria-labelledby="assistant-login-title" className={styles.panel}>
          <p className={styles.eyebrow}>LUMI WORKSPACE</p>
          <h1 id="assistant-login-title">先登录，再继续对话</h1>
          <p>使用你的 Lumi 邮箱账号登录。还没有账号时，可用班级邀请码完成一次注册。</p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} href={loginPath}>
              前往登录
            </Link>
            <Link className={styles.secondaryAction} href={registerPath}>
              创建学生账号
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (access === "wrong-role") {
    return (
      <main className={styles.gate}>
        <section aria-labelledby="assistant-role-title" className={styles.panel}>
          <p className={styles.eyebrow}>LUMI WORKSPACE</p>
          <h1 id="assistant-role-title">这里是学生工作台</h1>
          <p>当前登录的是教师账号，请进入教师工作台继续。</p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} href="/teacher">
              前往教师工作台
            </Link>
            <Link className={styles.secondaryAction} href="/">
              返回首页
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.gate}>
      <section aria-labelledby="assistant-access-error-title" className={styles.panel}>
        <p className={styles.eyebrow}>LUMI WORKSPACE</p>
        <h1 id="assistant-access-error-title">暂时无法确认登录状态</h1>
        <p>请重新检查；如果仍然失败，可以先回到登录页重新进入。</p>
        <div className={styles.actions}>
          <button
            className={styles.primaryAction}
            onClick={() => {
              setShowCheckingState(false);
              setAccess("checking");
              setAttempt((value) => value + 1);
            }}
            type="button"
          >
            重新检查
          </button>
          <Link className={styles.secondaryAction} href={loginPath}>
            前往登录
          </Link>
        </div>
      </section>
    </main>
  );
}

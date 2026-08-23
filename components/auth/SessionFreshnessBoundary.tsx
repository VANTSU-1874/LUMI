"use client";

import { usePathname } from "next/navigation";
import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  LUMI_SESSION_INVALIDATED_EVENT,
  LUMI_SESSION_INVALIDATED_STORAGE_KEY,
} from "@/lib/auth/client-session-events";

import styles from "../assistant-lab/assistant-lab-access-gate.module.css";

const SESSION_RECHECK_INTERVAL_MS = 30_000;

type SessionRole = "STUDENT" | "TEACHER";

function requiredRole(pathname: string): SessionRole | null {
  if (pathname === "/teacher" || pathname.startsWith("/teacher/")) {
    return "TEACHER";
  }
  if (
    pathname === "/student"
    || pathname.startsWith("/student/")
    || pathname === "/assistant-lab"
    || pathname.startsWith("/assistant-lab/")
  ) {
    return "STUDENT";
  }
  return null;
}

function sessionRole(payload: unknown): SessionRole | null {
  if (
    typeof payload !== "object"
    || payload === null
    || !("user" in payload)
    || typeof payload.user !== "object"
    || payload.user === null
    || !("role" in payload.user)
  ) {
    return null;
  }
  return payload.user.role === "STUDENT" || payload.user.role === "TEACHER"
    ? payload.user.role
    : null;
}

function defaultNavigation(href: string) {
  window.location.replace(href);
}

export function SessionFreshnessBoundary({
  children,
  navigate = defaultNavigation,
}: PropsWithChildren<{ navigate?: (href: string) => void }>) {
  const pathname = usePathname();
  const expectedRole = requiredRole(pathname);
  const [blockedPath, setBlockedPath] = useState<string | null>(null);
  const blocked = blockedPath === pathname;
  const checkSequence = useRef(0);

  const loginPath = useCallback(() => {
    const returnTo = `${pathname}${window.location.search}`;
    return `/login?returnTo=${encodeURIComponent(returnTo)}`;
  }, [pathname]);

  const leavePrivateSurface = useCallback((href: string) => {
    setBlockedPath(pathname);
    window.requestAnimationFrame(() => navigate(href));
  }, [navigate, pathname]);

  const revalidate = useCallback(async (hideWhileChecking: boolean) => {
    if (!expectedRole) return;
    const sequence = checkSequence.current + 1;
    checkSequence.current = sequence;
    if (hideWhileChecking) setBlockedPath(pathname);

    try {
      const response = await fetch("/api/account/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (sequence !== checkSequence.current) return;
      if (response.status === 401 || response.status === 403) {
        leavePrivateSurface(loginPath());
        return;
      }
      if (!response.ok) return;

      const role = sessionRole(await response.json());
      if (sequence !== checkSequence.current) return;
      if (!role) {
        leavePrivateSurface(loginPath());
        return;
      }
      if (role !== expectedRole) {
        leavePrivateSurface(role === "TEACHER" ? "/teacher" : "/student");
        return;
      }
      setBlockedPath(null);
    } catch {
      // Keep private content blocked after a foreground check until a retry succeeds.
    }
  }, [expectedRole, leavePrivateSurface, loginPath, pathname]);

  useEffect(() => {
    if (!expectedRole) return;

    const invalidate = () => leavePrivateSurface(loginPath());
    const refreshInForeground = () => void revalidate(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshInForeground();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === LUMI_SESSION_INVALIDATED_STORAGE_KEY) invalidate();
    };

    window.addEventListener(LUMI_SESSION_INVALIDATED_EVENT, invalidate);
    window.addEventListener("focus", refreshInForeground);
    window.addEventListener("pageshow", refreshInForeground);
    window.addEventListener("popstate", refreshInForeground);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(() => {
      void revalidate(false);
    }, SESSION_RECHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener(LUMI_SESSION_INVALIDATED_EVENT, invalidate);
      window.removeEventListener("focus", refreshInForeground);
      window.removeEventListener("pageshow", refreshInForeground);
      window.removeEventListener("popstate", refreshInForeground);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [expectedRole, leavePrivateSurface, loginPath, revalidate]);

  if (!expectedRole || !blocked) return children;

  return (
    <main
      aria-busy="true"
      className={styles.checkingGate}
      data-visible="true"
    >
      <span className={styles.srOnly} role="status">
        正在重新验证登录状态
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

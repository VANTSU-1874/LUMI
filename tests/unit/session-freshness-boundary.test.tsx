import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionFreshnessBoundary } from "@/components/auth/SessionFreshnessBoundary";
import {
  LUMI_SESSION_INVALIDATED_EVENT,
  LUMI_SESSION_INVALIDATED_STORAGE_KEY,
} from "@/lib/auth/client-session-events";

const navigationMocks = vi.hoisted(() => ({ pathname: "/student" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMocks.pathname,
}));

describe("SessionFreshnessBoundary", () => {
  beforeEach(() => {
    navigationMocks.pathname = "/student";
    window.history.replaceState({}, "", "/student?thread=private");
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("does not run session checks on public routes", () => {
    navigationMocks.pathname = "/login";
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    render(
      <SessionFreshnessBoundary>
        <div>public content</div>
      </SessionFreshnessBoundary>,
    );
    window.dispatchEvent(new Event("focus"));

    expect(screen.getByText("public content")).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("hides private content while a foreground session check is pending", async () => {
    let resolveCheck: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      resolveCheck = resolve;
    })));

    render(
      <SessionFreshnessBoundary>
        <div>private content</div>
      </SessionFreshnessBoundary>,
    );

    act(() => window.dispatchEvent(new Event("focus")));
    expect(screen.queryByText("private content")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在重新验证登录状态");

    await act(async () => {
      resolveCheck?.(new Response(JSON.stringify({
        user: { role: "STUDENT" },
      }), { status: 200 }));
    });
    expect(await screen.findByText("private content")).toBeInTheDocument();
  });

  it("purges the current private surface after same-tab logout", async () => {
    const navigate = vi.fn();
    render(
      <SessionFreshnessBoundary navigate={navigate}>
        <div>private content</div>
      </SessionFreshnessBoundary>,
    );

    act(() => window.dispatchEvent(new Event(LUMI_SESSION_INVALIDATED_EVENT)));

    expect(screen.queryByText("private content")).not.toBeInTheDocument();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(
      "/login?returnTo=%2Fstudent%3Fthread%3Dprivate",
    ));
  });

  it("purges a second tab when the logout storage marker changes", async () => {
    const navigate = vi.fn();
    render(
      <SessionFreshnessBoundary navigate={navigate}>
        <div>private content</div>
      </SessionFreshnessBoundary>,
    );

    act(() => window.dispatchEvent(new StorageEvent("storage", {
      key: LUMI_SESSION_INVALIDATED_STORAGE_KEY,
      newValue: "new-session-marker",
    })));

    expect(screen.queryByText("private content")).not.toBeInTheDocument();
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
  });

  it("redirects after browser restoration finds an expired session", async () => {
    const navigate = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    render(
      <SessionFreshnessBoundary navigate={navigate}>
        <div>private content</div>
      </SessionFreshnessBoundary>,
    );

    act(() => window.dispatchEvent(new PageTransitionEvent("pageshow", {
      persisted: true,
    })));

    expect(screen.queryByText("private content")).not.toBeInTheDocument();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(
      "/login?returnTo=%2Fstudent%3Fthread%3Dprivate",
    ));
  });
});

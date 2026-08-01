import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAgentRun } from "@/components/student/use-agent-run";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useAgentRun one-turn external-search consent", () => {
  it("locks submission synchronously before awaiting the consent digest", async () => {
    vi.stubGlobal("crypto", webcrypto);
    let postCount = 0;
    let resolvePost: ((response: Response) => void) | undefined;
    const pendingPost = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/agent/conversation")) {
        return Promise.resolve(new Response(JSON.stringify({
          conversationId: null,
          coursePack: { id: "general-design", version: "1", label: "通用设计" },
          turns: [],
          features: { externalSearch: true },
        }), { status: 200 }));
      }
      if (url === "/api/agent/runs?") {
        return Promise.resolve(new Response(JSON.stringify({ run: null, nextEventSequence: 1 }), { status: 200 }));
      }
      if (url === "/api/agent/runs") {
        postCount += 1;
        return pendingPost;
      }
      throw new Error(`unexpected ${url}`);
    });
    const { result } = renderHook(() => useAgentRun(fetchImpl as unknown as typeof fetch, "AGENT"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let first!: ReturnType<typeof result.current.ask>;
    let second!: ReturnType<typeof result.current.ask>;
    act(() => {
      first = result.current.ask("查最新公开资料", null, null, true);
      second = result.current.ask("查最新公开资料", null, null, true);
    });
    await expect(second).resolves.toBeNull();
    await waitFor(() => expect(postCount).toBe(1));
    resolvePost!(new Response(JSON.stringify({ error: "模拟网络失败" }), { status: 500 }));
    await act(async () => { await first; });
    expect(postCount).toBe(1);
  });

  it("does not create or send consent when the backward-compatible capability defaults to false", async () => {
    let submitted: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/agent/conversation")) {
        return new Response(JSON.stringify({
          conversationId: null,
          coursePack: { id: "general-design", version: "1", label: "通用设计" },
          turns: [],
        }), { status: 200 });
      }
      if (url === "/api/agent/runs?") {
        return new Response(JSON.stringify({ run: null, nextEventSequence: 1 }), { status: 200 });
      }
      if (url === "/api/agent/runs") {
        submitted = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ error: "stop after capture" }), { status: 500 });
      }
      throw new Error(`unexpected ${url}`);
    });
    const { result } = renderHook(() => useAgentRun(fetchImpl as unknown as typeof fetch, "AGENT"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.externalSearchAvailable).toBe(false);

    await act(async () => { await result.current.ask("查最新公开资料", null, null, true); });
    expect(submitted).not.toHaveProperty("externalSearchConsent");
  });
});

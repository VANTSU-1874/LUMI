import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantLabAccessGate } from "@/components/assistant-lab/AssistantLabAccessGate";

describe("AssistantLabAccessGate", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("sends an unauthenticated visitor to the student login entry", async () => {
    window.history.replaceState({}, "", "/assistant-lab");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("null", {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    render(
      <AssistantLabAccessGate returnTo="/assistant-lab">
        <div>assistant workspace</div>
      </AssistantLabAccessGate>,
    );

    expect(await screen.findByRole("heading", { name: "先登录，再继续对话" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往登录" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fassistant-lab",
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/account/session",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("renders the assistant workspace after a valid student session check", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      user: { role: "STUDENT" },
      session: { id: "session-1" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    render(
      <AssistantLabAccessGate>
        <div>assistant workspace</div>
      </AssistantLabAccessGate>,
    );

    expect(await screen.findByText("assistant workspace")).toBeInTheDocument();
  });

  it("offers a retry when the session check does not finish in time", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    render(
      <AssistantLabAccessGate>
        <div>assistant workspace</div>
      </AssistantLabAccessGate>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByRole("heading", { name: "暂时无法确认登录状态" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新检查" })).toBeInTheDocument();
  });
});

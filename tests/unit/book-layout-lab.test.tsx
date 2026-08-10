import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BookLayoutLab } from "@/components/student/BookLayoutLab";

afterEach(cleanup);

const pageOrder = ["cover", "quick-start", "activity-map", "featured-activity", "calendar", "community-voices", "join-us", "contact"];
const draft = {
  id: "11111111-1111-4111-8111-111111111111",
  audience: "COMMUNITY_RESIDENTS",
  pageOrder,
  diagnosticAnswers: ["AUDIENCE_FIRST", null, null],
  transferChoices: ["COMMUNITY_ENTRY_FIRST"],
  updatedAt: "2026-07-15T04:00:00.000Z",
  dataType: "REAL",
};

describe("BookLayoutLab", () => {
  it("restores a partial draft, saves it and requires confirmation before reset", async () => {
    const calls: Array<{ method: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "GET") return new Response(JSON.stringify({ resume: draft, latest: null }), { status: 200 });
      if (method === "PUT") return new Response(JSON.stringify(draft), { status: 200 });
      if (method === "DELETE") return new Response(JSON.stringify({ reset: true, resume: null, latest: null }), { status: 200 });
      throw new Error(`unexpected method ${method}`);
    });
    render(<BookLayoutLab fetchImpl={fetchImpl as unknown as typeof fetch} />);

    expect(await screen.findByText(/已恢复草稿/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "社区居民" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /先看是谁在读/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(calls.some(({ method }) => method === "PUT")).toBe(true));
    expect(calls.find(({ method }) => method === "PUT")?.body).toMatchObject({
      audience: "COMMUNITY_RESIDENTS",
      diagnosticAnswers: ["AUDIENCE_FIRST", null, null],
    });

    fireEvent.click(screen.getByRole("button", { name: "重置编排" }));
    expect(calls.some(({ method }) => method === "DELETE")).toBe(false);
    expect(screen.getByText(/已提交证据不会删除/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));
    await waitFor(() => expect(calls.some(({ method }) => method === "DELETE")).toBe(true));
    expect(screen.getByText(/历史学习证据仍保留/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新生" })).toHaveAttribute("aria-pressed", "true");
  });
});

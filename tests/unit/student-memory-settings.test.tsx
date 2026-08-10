import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudentMemorySettings } from "@/components/assistant-lab/StudentMemorySettings";
import type { StudentMemoryCollection } from "@/lib/domain/student-memory";

afterEach(cleanup);

const tierOneId = "11111111-1111-4111-8111-111111111111";
const tierTwoId = "22222222-2222-4222-8222-222222222222";
const collection: StudentMemoryCollection = {
  items: [
    {
      id: tierOneId,
      studentId: "s1",
      classId: "c1",
      kind: "PREFERENCE",
      content: "我喜欢先看版式案例",
      salience: 3,
      sourceTurnId: null,
      createdAt: "2026-07-27T01:00:00.000Z",
      lastUsedAt: null,
      studentDisputed: false,
      studentDisputeNote: null,
      studentDisputedAt: null,
      dataType: "REAL",
    },
    {
      id: tierTwoId,
      studentId: "s1",
      classId: "c1",
      kind: "RECURRING_STRUGGLE",
      content: "我总在网格层级这一步卡住",
      salience: 7,
      sourceTurnId: null,
      createdAt: "2026-07-27T02:00:00.000Z",
      lastUsedAt: null,
      studentDisputed: false,
      studentDisputeNote: null,
      studentDisputedAt: null,
      dataType: "REAL",
    },
  ],
  meta: { total: 2, returned: 2, truncated: false },
};

describe("StudentMemorySettings", () => {
  it("renders both tiers, deletes only Tier 1, and submits a Tier 2 dispute", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/agent/memories?limit=100&offset=0") {
        return new Response(JSON.stringify(collection), { status: 200 });
      }
      if (url === `/api/agent/memories/${tierTwoId}/dispute`) {
        const body = JSON.parse(String(init?.body)) as { kind: string; note: string };
        expect(body).toEqual({
          kind: "RECURRING_STRUGGLE",
          note: "这条情况已经改变",
        });
        return new Response(JSON.stringify({
          memory: {
            ...collection.items[1],
            studentDisputed: true,
            studentDisputeNote: body.note,
            studentDisputedAt: "2026-07-28T01:00:00.000Z",
          },
        }), { status: 200 });
      }
      if (url === `/api/agent/memories/${tierOneId}` && init?.method === "DELETE") {
        expect(JSON.parse(String(init.body))).toEqual({ kind: "PREFERENCE" });
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    });

    render(<StudentMemorySettings fetcher={fetcher as typeof fetch} />);

    expect(await screen.findByText("Tier 1 · 个人化记忆")).toBeInTheDocument();
    expect(screen.getByText("Tier 2 · 学习信号")).toBeInTheDocument();
    expect(screen.getByText("我喜欢先看版式案例")).toBeInTheDocument();
    expect(screen.getByText("我总在网格层级这一步卡住")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "删除" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "提出异议" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "提出异议" }));
    fireEvent.change(screen.getByRole("textbox", { name: /异议说明/ }), {
      target: { value: "这条情况已经改变" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交异议" }));
    expect(await screen.findByText("异议已提交；原始记录保留，教师会同时看到你的说明")).toBeInTheDocument();
    expect(screen.getByText("这条情况已经改变")).toBeInTheDocument();
    expect(screen.getByText("我总在网格层级这一步卡住")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("个人化记忆已删除")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("我喜欢先看版式案例")).not.toBeInTheDocument());
    expect(screen.getByText("我总在网格层级这一步卡住")).toBeInTheDocument();
  });
});

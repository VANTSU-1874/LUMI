import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvidenceHistory } from "@/components/common/EvidenceHistory";

afterEach(cleanup);

function item(id: string, label: string, projectId = "project-new", verificationStatus = "SUBMITTED") {
  return {
    id,
    projectId,
    classId: "class-1",
    studentId: "student-1",
    ownerAlias: "匿名学生",
    kind: "TEXT",
    signalLayer: "INPUT",
    label,
    verificationStatus,
    createdAt: "2026-07-13T00:00:00.000Z",
    dataType: "REAL",
  };
}

describe("EvidenceHistory", () => {
  it("loads stable pages from all projects and refreshes after deletion", async () => {
    const onDeleted = vi.fn(async () => undefined);
    let initialLoads = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url === "/api/evidence?limit=20") {
        initialLoads += 1;
        return new Response(JSON.stringify({
          items: initialLoads === 1
            ? [item("11111111-1111-4111-8111-111111111111", "最新证据")]
            : [],
          nextCursor: initialLoads === 1 ? "stable-cursor" : null,
        }), { status: 200 });
      }
      if (url === "/api/evidence?limit=20&cursor=stable-cursor") {
        return new Response(JSON.stringify({
          items: [item("22222222-2222-4222-8222-222222222222", "旧项目证据", "project-old", "TEACHER_VERIFIED")],
          nextCursor: null,
        }), { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(<EvidenceHistory fetcher={fetcher as typeof fetch} onDeleted={onDeleted} />);
    expect(await screen.findByRole("button", { name: /删除证据.*最新证据/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载更早证据" }));
    expect(await screen.findByRole("button", { name: /删除证据.*旧项目证据/ })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/evidence?limit=20&cursor=stable-cursor",
      expect.objectContaining({ cache: "no-store" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /删除证据.*最新证据/ }));
    fireEvent.click(screen.getByRole("button", { name: /确认删除.*最新证据/ }));
    await waitFor(() => expect(initialLoads).toBe(2));
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(onDeleted).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(screen.queryByRole("button", { name: /删除证据.*旧项目证据/ })).not.toBeInTheDocument();
    expect(screen.getByText("没有可显示的历史证据")).toHaveAttribute("role", "status");
  });

  it("contains parent refresh failures and does not update after unmount", async () => {
    let rejectRefresh!: (reason: Error) => void;
    const refresh = new Promise<void>((_resolve, reject) => { rejectRefresh = reject; });
    let deleted = false;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") { deleted = true; return new Response(null, { status: 204 }); }
      return new Response(JSON.stringify({
        items: deleted ? [] : [item("11111111-1111-4111-8111-111111111111", "待删除证据")],
        nextCursor: null,
      }), { status: 200 });
    });
    const view = render(<EvidenceHistory fetcher={fetcher as typeof fetch} onDeleted={() => refresh} />);
    fireEvent.click(await screen.findByRole("button", { name: /删除证据.*待删除证据/ }));
    fireEvent.click(screen.getByRole("button", { name: /确认删除.*待删除证据/ }));
    await waitFor(() => expect(deleted).toBe(true));
    view.unmount();
    rejectRefresh(new Error("父级刷新失败"));
    await expect(refresh).rejects.toThrow("父级刷新失败");
  });

  it("announces a parent synchronization failure while keeping deletion complete", async () => {
    let deleted = false;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") { deleted = true; return new Response(null, { status: 204 }); }
      return new Response(JSON.stringify({
        items: deleted ? [] : [item("11111111-1111-4111-8111-111111111111", "同步失败证据")], nextCursor: null,
      }), { status: 200 });
    });
    render(<EvidenceHistory fetcher={fetcher as typeof fetch} onDeleted={async () => { throw new Error("refresh failed"); }} />);
    fireEvent.click(await screen.findByRole("button", { name: /删除证据.*同步失败证据/ }));
    fireEvent.click(screen.getByRole("button", { name: /确认删除.*同步失败证据/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("证据已删除，但工作台数据刷新失败");
    expect(screen.getByText("没有可显示的历史证据")).toHaveAttribute("role", "status");
  });

  it("surfaces list failures in an accessible alert", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "证据列表暂时不可用" }), { status: 500 }));
    render(<EvidenceHistory fetcher={fetcher as typeof fetch} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("证据列表暂时不可用");
    expect(screen.getByRole("button", { name: "重试加载历史证据" })).toBeInTheDocument();
  });
});

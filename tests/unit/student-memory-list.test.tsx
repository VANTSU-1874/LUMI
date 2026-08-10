import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudentMemoryList } from "@/components/teacher/StudentMemoryList";
import type { StudentMemoryCollection } from "@/lib/domain/student-memory";

afterEach(cleanup);

const memoryId = "11111111-1111-4111-8111-111111111111";
const collection: StudentMemoryCollection = {
  items: [{
    id: memoryId,
    studentId: "student/一",
    classId: "class/一",
    kind: "RECURRING_STRUGGLE",
    content: "总在 OSC 端口配置这一步卡住",
    salience: 8,
    sourceTurnId: "turn-1",
    createdAt: "2026-07-17T08:00:00.000Z",
    lastUsedAt: null,
    studentDisputed: false,
    studentDisputeNote: null,
    studentDisputedAt: null,
    dataType: "DEMONSTRATION_DATA",
  }],
  meta: { total: 1, returned: 1, truncated: false },
};

const secondMemory: StudentMemoryCollection["items"][number] = {
  ...collection.items[0],
  id: "22222222-2222-4222-8222-222222222222",
  content: "总在 OSC 地址填写这一步卡住",
};

describe("StudentMemoryList", () => {
  it("shows the original learning signal and the student's dispute together", () => {
    render(<StudentMemoryList
      collection={{
        ...collection,
        items: [{
          ...collection.items[0],
          studentDisputed: true,
          studentDisputeNote: "我已经能独立处理这一步",
          studentDisputedAt: "2026-07-28T01:00:00.000Z",
        }],
      }}
      studentId="student/一"
    />);

    expect(screen.getByText("总在 OSC 端口配置这一步卡住")).toBeInTheDocument();
    const dispute = screen.getByRole("complementary", { name: "学生异议" });
    expect(dispute).toHaveTextContent("学生已对这条学习信号提出异议");
    expect(dispute).toHaveTextContent("我已经能独立处理这一步");
    expect(dispute).toHaveTextContent("原始记录保留不变");
  });

  it("shows bounded provenance and deletes through the scoped teacher route once", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const onDeleted = vi.fn();
    render(<StudentMemoryList classId="class/一" collection={collection} fetcher={fetcher as typeof fetch} onDeleted={onDeleted} studentId="student/一" />);

    expect(screen.getByRole("heading", { name: "长期学习记忆" })).toBeInTheDocument();
    expect(screen.getByText("总在 OSC 端口配置这一步卡住")).toBeInTheDocument();
    expect(screen.getByText("反复卡点")).toBeInTheDocument();
    expect(screen.getByText("重要度 8")).toBeInTheDocument();
    expect(screen.getByText("演示数据")).toHaveAccessibleName("演示数据，不代表真实学生成效");

    fireEvent.click(screen.getByRole("button", { name: "删除记忆 反复卡点：总在 OSC 端口配置这一步卡住" }));
    expect(screen.getByRole("dialog", { name: "确认删除这条长期记忆" })).toBeInTheDocument();
    expect(screen.getByText(/反复卡点：总在 OSC 端口配置这一步卡住/)).toBeInTheDocument();
    expect(screen.getByText(/原始对话和当前任务摘要不在本次删除范围内/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    const confirm = screen.getByRole("button", { name: "确认删除记忆" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    const status = await screen.findByRole("status", { name: "记忆删除状态" });
    expect(status).toHaveTextContent("记忆已删除");
    await waitFor(() => expect(status).toHaveFocus());
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      `/api/teacher/learners/student%2F%E4%B8%80/memories/${memoryId}?classId=class%2F%E4%B8%80`,
      { method: "DELETE", cache: "no-store" },
    );
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(onDeleted).toHaveBeenCalledWith(memoryId);
  });

  it("keeps the memory visible and exposes a server deletion failure", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "记忆删除暂时不可用，请重试" }), { status: 500 }));
    const onDeleted = vi.fn();
    render(<StudentMemoryList classId="class/一" collection={collection} fetcher={fetcher as typeof fetch} onDeleted={onDeleted} studentId="student/一" />);

    fireEvent.click(screen.getByRole("button", { name: /删除记忆 反复卡点/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除记忆" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("记忆删除暂时不可用，请重试");
    expect(screen.getByText("总在 OSC 端口配置这一步卡住")).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "确认删除记忆" })).not.toBeDisabled());
  });

  it("reports parent synchronization failure as already deleted and closes the dialog", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    render(<StudentMemoryList classId="class/一" collection={collection} fetcher={fetcher as typeof fetch} onDeleted={async () => { throw new Error("refresh failed"); }} studentId="student/一" />);

    fireEvent.click(screen.getByRole("button", { name: /删除记忆 反复卡点/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除记忆" }));
    const status = await screen.findByRole("status", { name: "记忆删除状态" });
    expect(status).toHaveTextContent("记忆已删除，但列表刷新失败，请刷新页面");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(status).toHaveFocus());
  });

  it("loads every remaining page and distinguishes memories with the same kind", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      items: [secondMemory],
      meta: { total: 2, returned: 1, truncated: false },
    }), { status: 200 }));
    function Harness() {
      const [current, setCurrent] = useState<StudentMemoryCollection>({
        ...collection,
        meta: { total: 2, returned: 1, truncated: true },
      });
      return <StudentMemoryList
        classId="class/一"
        collection={current}
        fetcher={fetcher as typeof fetch}
        includeDemo
        onLoaded={(items, total) => setCurrent((value) => {
          const merged = [...value.items, ...items];
          return { items: merged, meta: { total, returned: merged.length, truncated: total > merged.length } };
        })}
        studentId="student/一"
      />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "加载更多长期记忆" }));
    expect(await screen.findByText(secondMemory.content)).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole("button", { name: /删除记忆 反复卡点/ });
    expect(deleteButtons).toHaveLength(2);
    expect(deleteButtons[0]?.getAttribute("aria-label")).not.toBe(deleteButtons[1]?.getAttribute("aria-label"));
    expect(screen.queryByRole("button", { name: "加载更多长期记忆" })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/teacher/learners/student%2F%E4%B8%80/memories?classId=class%2F%E4%B8%80&limit=100&offset=1&includeDemo=true",
      { cache: "no-store" },
    );
  });

  it("does not publish a completed old request after switching students", async () => {
    let resolveDelete!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveDelete = resolve; }));
    const view = render(<StudentMemoryList classId="class/一" collection={collection} fetcher={fetcher as typeof fetch} key="student/一" studentId="student/一" />);
    fireEvent.click(screen.getByRole("button", { name: /删除记忆 反复卡点/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除记忆" }));
    view.rerender(<StudentMemoryList classId="class/一" collection={{ items: [], meta: { total: 0, returned: 0, truncated: false } }} fetcher={fetcher as typeof fetch} key="student/二" studentId="student/二" />);
    await act(async () => { resolveDelete(new Response(null, { status: 204 })); });
    expect(screen.queryByLabelText("记忆删除状态")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

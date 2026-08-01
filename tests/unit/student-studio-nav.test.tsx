import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { StudentStudioNav } from "@/components/student/StudentStudioNav";
import type { DesignTask } from "@/lib/agent/design-project-task";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tasks: DesignTask[] = [
  { id: "11111111-1111-4111-8111-111111111111", title: "展览海报", status: "ACTIVE", mode: "conversation", pinned: false, createdAt: "2026-07-16T08:00:00.000Z", updatedAt: "2026-07-16T08:00:00.000Z" },
  { id: "22222222-2222-4222-8222-222222222222", title: "儿童座椅", status: "ACTIVE", mode: "engineering", pinned: true, createdAt: "2026-07-16T07:00:00.000Z", updatedAt: "2026-07-16T07:00:00.000Z" },
  { id: "33333333-3333-4333-8333-333333333333", title: "旧包装练习", status: "ARCHIVED", mode: "conversation", pinned: false, createdAt: "2026-07-15T07:00:00.000Z", updatedAt: "2026-07-15T07:00:00.000Z" },
];

describe("StudentStudioNav design tasks", () => {
  it("makes the mobile navigation a trapped dialog and restores the opener", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(min-width: 768px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    function MobileNavigationHarness() {
      const [open, setOpen] = useState(false);
      return <>
        <button aria-label="打开学习导航" onClick={() => setOpen(true)} type="button">菜单</button>
        <StudentStudioNav
          active="CHAT"
          alias="匿名编号 01"
          isDemo={false}
          isFallback={false}
          mobileOpen={open}
          onChange={vi.fn()}
          onClose={() => setOpen(false)}
          tasks={tasks}
        />
      </>;
    }

    render(<MobileNavigationHarness />);
    const opener = screen.getByRole("button", { name: "打开学习导航" });
    const navigation = document.querySelector("aside");
    await waitFor(() => expect(navigation).toHaveAttribute("inert"));
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "学习工具栏" });
    const close = screen.getByRole("button", { name: "收起学习导航" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("link", { name: "证据与隐私说明" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "学习工具栏" })).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(navigation).toHaveAttribute("inert");
  });

  it("uses a ChatGPT-like project task list without turning courses into task gates", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(min-width: 768px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const onChange = vi.fn();
    const onNewQuestion = vi.fn();
    const onSelectTask = vi.fn();
    const onRenameTask = vi.fn().mockResolvedValue(undefined);
    const onArchiveTask = vi.fn().mockResolvedValue(undefined);
    const onRestoreTask = vi.fn().mockResolvedValue(undefined);
    render(<StudentStudioNav
      active="CHAT"
      activeTaskId={tasks[0].id}
      alias="匿名编号 01"
      isDemo={false}
      isFallback={false}
      onArchiveTask={onArchiveTask}
      onChange={onChange}
      onNewQuestion={onNewQuestion}
      onRenameTask={onRenameTask}
      onRestoreTask={onRestoreTask}
      onSelectTask={onSelectTask}
      tasks={tasks}
    />);

    expect(screen.getByRole("button", { name: "展览海报" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "儿童座椅" }));
    expect(onSelectTask).toHaveBeenCalledWith(tasks[1].id);
    expect(onChange).toHaveBeenCalledWith("CHAT");

    fireEvent.click(screen.getByRole("button", { name: "新建设计任务" }));
    expect(onNewQuestion).toHaveBeenCalledOnce();

    const taskMenu = screen.getByLabelText("管理任务：展览海报").parentElement!;
    fireEvent.click(screen.getByLabelText("管理任务：展览海报"));
    fireEvent.click(within(taskMenu).getByRole("button", { name: "重命名" }));
    fireEvent.change(screen.getByLabelText("任务标题"), { target: { value: "毕业展主视觉" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onRenameTask).toHaveBeenCalledWith(tasks[0].id, "毕业展主视觉"));

    fireEvent.click(screen.getByText(/已归档/));
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    await waitFor(() => expect(onRestoreTask).toHaveBeenCalledWith(tasks[2].id));
    expect(screen.getByRole("button", { name: /节点画布.*自主搭建与观察网络/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /知识地图.*自主浏览概念与关系/ }));
    expect(onChange).toHaveBeenCalledWith("KNOWLEDGE_MAP");
    expect(screen.getByText("按目标调用的 Plugin / Skill")).toBeInTheDocument();
  });
});

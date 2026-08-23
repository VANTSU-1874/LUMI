import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EntryForm } from "@/components/entry/EntryForm";

describe("EntryForm", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("shows accessible student and teacher account tabs without access codes", () => {
    render(<EntryForm />);

    const studentTab = screen.getByRole("tab", { name: "学生" });
    const teacherTab = screen.getByRole("tab", { name: "教师" });
    expect(studentTab).toHaveAttribute("aria-selected", "true");
    expect(studentTab).toHaveAttribute("tabindex", "0");
    expect(teacherTab).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByLabelText("班级邀请码")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("匿名编号")).not.toBeInTheDocument();
    expect(screen.getByText("学生账号")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "教师" }));

    expect(screen.getByRole("tab", { name: "教师" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByLabelText("教师访问码")).not.toBeInTheDocument();
    expect(screen.getByText("教师账号")).toBeInTheDocument();
  });

  it("supports arrow, Home, and End keyboard navigation between tabs", () => {
    render(<EntryForm />);
    const studentTab = screen.getByRole("tab", { name: "学生" });
    const teacherTab = screen.getByRole("tab", { name: "教师" });
    studentTab.focus();

    fireEvent.keyDown(studentTab, { key: "ArrowRight" });
    expect(teacherTab).toHaveFocus();
    expect(teacherTab).toHaveAttribute("aria-selected", "true");
    expect(teacherTab).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(teacherTab, { key: "Home" });
    expect(studentTab).toHaveFocus();
    expect(studentTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(studentTab, { key: "End" });
    expect(teacherTab).toHaveFocus();
    fireEvent.keyDown(teacherTab, { key: "ArrowLeft" });
    expect(studentTab).toHaveFocus();
  });

  it("opens student self-registration without a class code", () => {
    const navigate = vi.fn();
    render(<EntryForm navigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "创建学生账号" }));
    expect(navigate).toHaveBeenCalledWith("/login?mode=register&role=student");
  });

  it("sends teachers to sign-in because teacher accounts are pre-provisioned", () => {
    const navigate = vi.fn();
    render(<EntryForm navigate={navigate} />);
    fireEvent.click(screen.getByRole("tab", { name: "教师" }));
    expect(screen.getByText("教师账号由课程管理员预置，使用已有邮箱和密码登录。"))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "教师账号登录" }));
    expect(navigate).toHaveBeenCalledWith("/login?role=teacher");
  });

  it("opens the shared login page for an existing account", () => {
    const navigate = vi.fn();
    render(<EntryForm navigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "已有账号，去登录" }));
    expect(navigate).toHaveBeenCalledWith("/login");
  });
});

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SplitLoginEntry } from "@/components/entry/SplitLoginEntry";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInEmail: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/auth/better-auth-client", () => ({
  authClient: {
    getSession: authMocks.getSession,
    signIn: { email: authMocks.signInEmail },
    signOut: authMocks.signOut,
  },
}));

vi.mock("@/components/ui/sign-in-flow-1", () => ({
  SignInFlowShell: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));

describe("SplitLoginEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.signInEmail.mockResolvedValue({ data: { ok: true }, error: null });
    authMocks.signOut.mockResolvedValue({ data: null, error: null });
    authMocks.getSession.mockResolvedValue({
      data: { user: { role: "STUDENT" } },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("signs in with a real email/password session and preserves a safe return path", async () => {
    const navigate = vi.fn();
    window.history.replaceState({}, "", "/login?returnTo=%2Fassistant-lab");

    render(<SplitLoginEntry navigate={navigate} />);

    expect(screen.getByRole("heading", {
      name: "学生端登录",
    })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "学生登录" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password-2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录学生端" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/assistant-lab"));
    expect(authMocks.signInEmail).toHaveBeenCalledWith({
      email: "student@example.com",
      password: "password-2026",
      rememberMe: true,
    });
  });

  it("localizes an origin validation failure", async () => {
    authMocks.signInEmail.mockResolvedValue({
      data: null,
      error: { code: "INVALID_ORIGIN", message: "Invalid origin" },
    });

    render(<SplitLoginEntry />);
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password-2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录学生端" }));

    expect(await screen.findByText("登录请求来源无效，请刷新页面后重试"))
      .toBeInTheDocument();
  });

  it("signs a teacher in through the teacher entry", async () => {
    const navigate = vi.fn();
    authMocks.getSession.mockResolvedValue({
      data: { user: { role: "TEACHER" } },
      error: null,
    });

    render(<SplitLoginEntry initialRole="TEACHER" navigate={navigate} />);

    expect(screen.getByRole("heading", {
      name: "教师端登录",
    })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "教师登录" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "teacher@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password-2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录教师端" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/teacher"));
    expect(authMocks.signOut).not.toHaveBeenCalled();
  });

  it("rejects a student account from the teacher entry and clears the session", async () => {
    const navigate = vi.fn();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SplitLoginEntry initialRole="TEACHER" navigate={navigate} />);
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password-2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录教师端" }));

    expect(await screen.findByText(
      "这个邮箱是学生账号，请切换到“学生登录”",
    )).toBeInTheDocument();
    expect(authMocks.signOut).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/account/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("creates a student account without an invitation code", async () => {
    const navigate = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      user: { role: "STUDENT" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SplitLoginEntry navigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));

    expect(await screen.findByRole("heading", { name: "创建学生账号" }))
      .toBeInTheDocument();
    expect(screen.getByText(/教师账号由课程管理员预置/)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "教师账号" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("姓名或常用称呼"), {
      target: { value: "测试学生" },
    });
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password-2026" },
    });
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "password-2026" },
    });
    expect(screen.queryByLabelText("班级邀请码")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("教师访问码")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建账号并进入" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/student"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "测试学生",
          email: "student@example.com",
          password: "password-2026",
          role: "STUDENT",
          rememberMe: true,
        }),
      }),
    );
  });

  it("coerces a teacher registration URL to student-only registration", () => {
    render(
      <SplitLoginEntry
        initialMode="SIGN_UP"
        initialRole="TEACHER"
      />,
    );

    expect(screen.getByRole("heading", { name: "创建学生账号" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "教师账号" })).not.toBeInTheDocument();
    expect(screen.getByText(/教师账号由课程管理员预置/)).toBeInTheDocument();
  });

  it("localizes the Better Auth user-creation failure", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: "FAILED_TO_CREATE_USER",
      message: "Failed to Create user",
    }), {
      status: 422,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SplitLoginEntry initialMode="SIGN_UP" />);
    fireEvent.change(screen.getByLabelText("姓名或常用称呼"), {
      target: { value: "测试学生" },
    });
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password-2026" },
    });
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "password-2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建账号并进入" }));

    expect(await screen.findByText(
      "账号没有创建成功，请稍后重试；如果这个邮箱已注册，请直接返回登录",
    )).toBeInTheDocument();
  });

});

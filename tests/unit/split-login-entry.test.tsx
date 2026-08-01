import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SplitLoginEntry } from "@/components/entry/SplitLoginEntry";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInEmail: vi.fn(),
}));

vi.mock("@/lib/auth/better-auth-client", () => ({
  authClient: {
    getSession: authMocks.getSession,
    signIn: { email: authMocks.signInEmail },
  },
}));

vi.mock("@/components/ui/sign-in-flow-1", () => ({
  SignInFlowShell: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));

describe("SplitLoginEntry", () => {
  beforeEach(() => {
    authMocks.signInEmail.mockResolvedValue({ data: { ok: true }, error: null });
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
      name: "欢迎回来",
    })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "student@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password-2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录 Lumi" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/assistant-lab"));
    expect(authMocks.signInEmail).toHaveBeenCalledWith({
      email: "student@example.com",
      password: "password-2026",
      rememberMe: true,
    });
  });

  it("creates a student account with a class invite instead of an anonymous code", async () => {
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

    expect(await screen.findByRole("tab", { name: "学生账号" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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
    fireEvent.change(screen.getByLabelText("班级邀请码"), {
      target: { value: "DIGI2026" },
    });
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
          classCode: "DIGI2026",
          teacherCode: undefined,
          rememberMe: true,
        }),
      }),
    );
  });

});

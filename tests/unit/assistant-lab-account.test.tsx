import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LabAccountArea,
  labLoginHrefFor,
} from "@/components/assistant-lab/AssistantLabAccount";

const authMocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/auth/better-auth-client", () => ({
  authClient: {
    useSession: authMocks.useSession,
    signOut: authMocks.signOut,
  },
}));

describe("LabAccountArea", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("preserves the current student route while sending an unsigned visitor to the real login page", async () => {
    authMocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "请先登录 Lumi" }), {
        headers: { "content-type": "application/json" },
        status: 401,
      }),
    ));
    expect(labLoginHrefFor("/student", "?demo=1")).toBe(
      "/login?returnTo=%2Fstudent%3Fdemo%3D1",
    );

    window.history.replaceState({}, "", "/student?demo=1");
    const navigate = vi.fn();

    render(<LabAccountArea navigate={navigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "登录 Lumi" }));

    expect(navigate).toHaveBeenCalledWith(
      "/login?returnTo=%2Fstudent%3Fdemo%3D1",
    );
  });

  it("shows a transitional course identity as signed in", async () => {
    authMocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        user: { id: "legacy-student", role: "STUDENT" },
        session: { type: "LEGACY_TRANSITION" },
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    ));

    render(<LabAccountArea />);

    expect(await screen.findByRole("button", { name: "打开账户菜单" })).toBeVisible();
    expect(screen.getByText("课程学生")).toBeVisible();
    expect(screen.queryByRole("button", { name: "登录 Lumi" })).toBeNull();
  });

  it("uses the onboarding nickname and exposes the reusable form in personalization settings", async () => {
    authMocks.useSession.mockReturnValue({
      data: {
        user: {
          id: "student-1",
          name: "注册姓名",
          role: "STUDENT",
          image: null,
        },
      },
      error: null,
      isPending: false,
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/agent/onboarding") {
        return new Response(JSON.stringify({
          nickname: "小岚",
          displayName: "小岚",
          major: "book-design",
          selfAssessedLevel: null,
          interests: null,
          completedAt: "2026-07-28T02:00:00.000Z",
          completed: true,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 500 });
    }));

    render(<LabAccountArea />);

    expect(await screen.findByText("小岚")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "打开账户菜单" }));
    fireEvent.click(await screen.findByText("个性化"));
    expect(await screen.findByText("学习偏好与入门资料")).toBeVisible();
    expect(await screen.findByText("LUMI · 学习偏好")).toBeVisible();
  });

  it("does not mount student memory controls in a teacher data settings view", async () => {
    authMocks.useSession.mockReturnValue({
      data: {
        user: {
          id: "teacher-1",
          name: "课程教师",
          role: "TEACHER",
          image: null,
        },
      },
      error: null,
      isPending: false,
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    render(<LabAccountArea />);

    fireEvent.click(screen.getByRole("button", { name: "打开账户菜单" }));
    fireEvent.click(await screen.findByText("设置"));
    fireEvent.click(await screen.findByRole("button", { name: "数据管理" }));

    expect(await screen.findByText(/导出与数据保留策略尚待接入/)).toBeVisible();
    expect(screen.queryByText("我的长期记忆")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnboardingGate } from "@/components/assistant-lab/OnboardingGate";
import type { StudentOnboardingProfile } from "@/lib/domain/student-onboarding";

afterEach(cleanup);

const incompleteProfile: StudentOnboardingProfile = {
  nickname: null,
  displayName: "注册姓名",
  major: null,
  selfAssessedLevel: null,
  interests: null,
  completedAt: null,
  completed: false,
};

describe("OnboardingGate", () => {
  it("does not reopen when onboarding is already completed", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ...incompleteProfile,
      completedAt: "2026-07-28T02:00:00.000Z",
      completed: true,
    }), { status: 200 }));

    render(
      <OnboardingGate fetcher={fetcher as typeof fetch}>
        <div>工作台已就绪</div>
      </OnboardingGate>,
    );

    expect(await screen.findByText("工作台已就绪")).toBeInTheDocument();
    expect(screen.queryByText("希望 Lumi 怎么称呼你？")).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("lets the student skip every step with equal-weight actions and marks completion", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({
          nickname: null,
          major: null,
          selfAssessedLevel: null,
          interests: null,
          markCompleted: true,
        });
        return new Response(JSON.stringify({
          ...incompleteProfile,
          completedAt: "2026-07-28T02:00:00.000Z",
          completed: true,
        }), { status: 200 });
      }
      return new Response(JSON.stringify(incompleteProfile), { status: 200 });
    });

    render(
      <OnboardingGate fetcher={fetcher as typeof fetch}>
        <div>进入 Lumi</div>
      </OnboardingGate>,
    );

    expect(await screen.findByRole("heading", { name: "希望 Lumi 怎么称呼你？" }))
      .toBeInTheDocument();
    const firstSkip = screen.getByRole("button", { name: "这步先跳过" });
    const firstContinue = screen.getByRole("button", { name: "继续" });
    expect(firstSkip.className).toBe(firstContinue.className);

    fireEvent.click(firstSkip);
    expect(screen.getByRole("heading", { name: "你目前更接近哪个专业方向？" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "这步先跳过" }));
    expect(screen.getByRole("heading", { name: "你觉得自己目前在哪个阶段？" }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "这步先跳过" }));
    expect(screen.getByRole("heading", { name: "最近想多探索什么？" }))
      .toBeInTheDocument();

    const finalSkip = screen.getByRole("button", { name: "跳过并进入 Lumi" });
    const finalSave = screen.getByRole("button", { name: "保存并进入 Lumi" });
    expect(finalSkip.className).toBe(finalSave.className);
    fireEvent.click(finalSkip);

    expect(await screen.findByText("进入 Lumi")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("submits all entered values from the four-step flow", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({
          nickname: "小岚",
          major: "book-design",
          selfAssessedLevel: "FOUNDATION",
          interests: "字体与装帧",
          markCompleted: true,
        });
        return new Response(JSON.stringify({
          nickname: "小岚",
          displayName: "小岚",
          major: "book-design",
          selfAssessedLevel: "FOUNDATION",
          interests: "字体与装帧",
          completedAt: "2026-07-28T02:00:00.000Z",
          completed: true,
        }), { status: 200 });
      }
      return new Response(JSON.stringify(incompleteProfile), { status: 200 });
    });

    render(
      <OnboardingGate fetcher={fetcher as typeof fetch}>
        <div>资料已保存</div>
      </OnboardingGate>,
    );

    fireEvent.change(await screen.findByRole("textbox", { name: "昵称（可选）" }), {
      target: { value: "小岚" },
    });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("radio", { name: /书籍设计/ }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("radio", { name: /有一些基础/ }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.change(screen.getByRole("textbox", { name: "感兴趣的课程或方向（可选）" }), {
      target: { value: "字体与装帧" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并进入 Lumi" }));

    expect(await screen.findByText("资料已保存")).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});

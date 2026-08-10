import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudentOnboardingSettings } from "@/components/assistant-lab/StudentOnboardingSettings";
import type { StudentOnboardingProfile } from "@/lib/domain/student-onboarding";

afterEach(cleanup);

const profile: StudentOnboardingProfile = {
  nickname: null,
  displayName: "注册姓名",
  major: null,
  selfAssessedLevel: null,
  interests: null,
  completedAt: "2026-07-28T02:00:00.000Z",
  completed: true,
};

describe("StudentOnboardingSettings", () => {
  it("reuses the onboarding form to fill skipped information and reports the new display name", async () => {
    const onSaved = vi.fn();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({
          nickname: "小岚",
          major: "book-design",
          selfAssessedLevel: "FOUNDATION",
          interests: "字体与装帧",
          markCompleted: true,
        });
        return new Response(JSON.stringify({
          ...profile,
          nickname: "小岚",
          displayName: "小岚",
          major: "book-design",
          selfAssessedLevel: "FOUNDATION",
          interests: "字体与装帧",
        }), { status: 200 });
      }
      return new Response(JSON.stringify(profile), { status: 200 });
    });

    render(
      <StudentOnboardingSettings
        fetcher={fetcher as typeof fetch}
        onSaved={onSaved}
      />,
    );

    expect(await screen.findByText("LUMI · 学习偏好")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "昵称（可选）" }), {
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
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(await screen.findByText("学习偏好已保存，下一轮对话会使用最新信息。"))
      .toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      displayName: "小岚",
      major: "book-design",
    }));
  });
});

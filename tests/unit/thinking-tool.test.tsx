import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ThinkingTool } from "@/components/ui/thinking-tool";

afterEach(cleanup);

describe("ThinkingTool", () => {
  const steps = [
    {
      id: "model-liveness",
      label: "保持模型连接并整理回答",
      skillLabel: "课程参考 Skill",
      status: "running" as const,
    },
  ];

  it("shows an honest live processing summary with an independent elapsed duration", () => {
    render(
      <ThinkingTool
        elapsedSeconds={8}
        state="thinking"
        steps={steps}
      />,
    );

    expect(screen.getByText("Lumi 正在思考")).toBeTruthy();
    expect(screen.getByText("8s")).toBeTruthy();
    expect(screen.getByRole("status", { name: /处理步骤摘要，不展示模型推理原文/ })).toBeTruthy();
    expect(screen.getAllByText("课程参考 Skill")).toHaveLength(2);
    expect(screen.getAllByText("保持模型连接并整理回答")).toHaveLength(2);
  });

  it("collapses to the finished duration and expands the neutral timeline on demand", () => {
    render(
      <ThinkingTool
        elapsedSeconds={8}
        state="thought"
        steps={steps.map((step) => ({ ...step, status: "complete" as const }))}
      />,
    );

    expect(screen.getByText("已思考 8 秒")).toBeTruthy();
    expect(screen.queryByText("课程参考 Skill")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /已思考 8 秒/ }));
    expect(screen.getByText("课程参考 Skill")).toBeTruthy();
    expect(document.querySelector(".lumi-thinking-timeline")).toBeTruthy();
  });
});

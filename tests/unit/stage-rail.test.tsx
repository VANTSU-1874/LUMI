import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StageRail } from "@/components/student/StageRail";

describe("StageRail", () => {
  it("marks the current step and prevents future navigation", () => {
    render(<StageRail currentStage="LOGIC_CARD" />);

    expect(screen.getByText("六元交互逻辑").closest("li")).toHaveAttribute("aria-current", "step");
    const future = screen.getByRole("button", { name: /工具路径/ });
    expect(future).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(future);
  });
});

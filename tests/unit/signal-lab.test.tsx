import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SignalLab } from "@/components/student/SignalLab";

describe("SignalLab", () => {
  afterEach(cleanup);

  it("turns a distance input into live mapped output", () => {
    render(<SignalLab />);

    const distance = screen.getByLabelText("观众与装置的距离");
    expect(screen.getByText("亮度 44%")).toBeInTheDocument();

    fireEvent.change(distance, { target: { value: "20" } });
    expect(screen.getByText("亮度 100%")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "越远离越亮" })[0]);
    expect(screen.getByText("亮度 0%")).toBeInTheDocument();
  });

  it("gives immediate explanatory feedback instead of only marking right or wrong", () => {
    render(<SignalLab />);
    const answers = screen.getAllByRole("button", { name: "越靠近越亮" });
    fireEvent.click(answers.at(-1)!);
    expect(screen.getByText(/建立了第一条可解释的交互因果链/)).toBeInTheDocument();

    const farAnswers = screen.getAllByRole("button", { name: "越远离越亮" });
    fireEvent.click(farAnswers.at(-1)!);
    expect(screen.getByText(/距离数值变小，但亮度需要变大/)).toBeInTheDocument();
  });
});

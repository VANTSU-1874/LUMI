import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { KnowledgeMap } from "@/components/student/KnowledgeMap";

afterEach(cleanup);

describe("KnowledgeMap", () => {
  it("keeps all knowledge blocks explorable instead of locking them in sequence", () => {
    render(<KnowledgeMap />);
    expect(screen.getByText("9 个板块 · 全部可探索")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /范围映射/ })[0]);
    expect(screen.getByRole("heading", { name: "范围映射" })).toBeInTheDocument();
    expect(screen.getByText(/Math 的本质/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "动态生成" })).toBeEnabled();
  });
});

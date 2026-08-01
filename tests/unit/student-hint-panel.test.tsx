import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HintPanel } from "@/components/student/StudentShell";
import { StudentHintPublicResponseSchema } from "@/lib/domain/student-dashboard";

const hint = StudentHintPublicResponseSchema.parse({
  hintLevel: 2, groundingStatus: "GROUNDED", confirmedFacts: [], hypotheses: [],
  questions: ["数值是否变化？"], guidance: ["观察输入"], nextSteps: ["记录两次数值"],
  localExample: null, sourceTitles: ["课程检查表"],
  sources: [{ title: "课程检查表", authority: "COURSE_DESIGN" }],
  uncertainty: "仍需证据确认。", fallback: false,
});

afterEach(cleanup);

describe("HintPanel", () => {
  it("preserves the Task 6 level invariants in the public schema", () => {
    expect(StudentHintPublicResponseSchema.safeParse({ ...hint, hintLevel: 1 }).success).toBe(false);
  });
  it("hydrates the latest persisted hint", () => {
    render(<HintPanel projectId="p1" layer="INPUT" initialHint={hint} initialHintSequence={1} onSaved={() => undefined} fetchImpl={vi.fn() as typeof fetch} />);
    expect(screen.getByText("记录两次数值")).toBeInTheDocument();
  });

  it("coalesces same-tick clicks", () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
    render(<HintPanel projectId="p1" layer="INPUT" initialHint={null} initialHintSequence={0} onSaved={() => undefined} fetchImpl={fetchImpl as typeof fetch} />);
    const button = screen.getByRole("button", { name: "获取当前层提示" });
    act(() => { button.click(); button.click(); });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts and ignores an old response after project switch", async () => {
    let resolve!: (value: Response) => void;
    let signal!: AbortSignal;
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((done) => { resolve = done; });
    });
    const onSaved = vi.fn();
    const view = render(<HintPanel projectId="p1" layer="INPUT" initialHint={null} initialHintSequence={0} onSaved={onSaved} fetchImpl={fetchImpl as typeof fetch} />);
    screen.getByRole("button", { name: "获取当前层提示" }).click();
    view.rerender(<HintPanel projectId="p2" layer="MAPPING" initialHint={null} initialHintSequence={0} onSaved={onSaved} fetchImpl={fetchImpl as typeof fetch} />);
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(new Response(JSON.stringify(hint), { status: 200 })));
    expect(screen.queryByText("记录两次数值")).not.toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

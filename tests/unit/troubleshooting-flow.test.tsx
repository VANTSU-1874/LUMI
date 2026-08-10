import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TroubleshootingFlow } from "@/components/student/TroubleshootingFlow";

afterEach(cleanup);

const response = {
  confirmedCodes: ["INPUT_OK"], noNewEvidenceRounds: 0,
  status: "ACTIVE", currentLayer: "MAPPING",
  confirmedFacts: ["输入层已有服务端确认证据"],
  unconfirmedHypotheses: ["待验证假设：映射范围不正确"],
  nextActions: ["记录映射前后数值"],
};

describe("TroubleshootingFlow", () => {
  it("restores the persisted public troubleshooting state", () => {
    render(<TroubleshootingFlow projectId="project-1" evidence={[]} initialState={{ id: "11111111-1111-4111-8111-111111111111", revision: 2, state: { confirmedCodes: ["INPUT_OK"], noNewEvidenceRounds: 0, status: "ACTIVE", currentLayer: "MAPPING", confirmedFacts: ["输入已确认"], unconfirmedHypotheses: ["映射待确认"], nextActions: ["记录映射范围"] } }} fetchImpl={vi.fn() as typeof fetch} />);
    expect(screen.getByText("当前检查层：映射")).toBeInTheDocument();
    expect(screen.getByText("输入已确认")).toBeInTheDocument();
    expect(screen.getByText("记录映射范围")).toBeInTheDocument();
  });
  it("shows one action, confirmed facts, hypotheses and accessible status", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
    render(<TroubleshootingFlow projectId="project-1" fetchImpl={fetchImpl} evidence={[{ id: "00000000-0000-4000-8000-000000000001", label: "输入值" }]} />);
    fireEvent.change(screen.getByLabelText("选择新证据"), { target: { value: "00000000-0000-4000-8000-000000000001" } });
    fireEvent.click(screen.getByRole("button", { name: "检查当前层" }));
    expect(await screen.findByText("记录映射前后数值")).toBeInTheDocument();
    expect(screen.getByText("输入层已有服务端确认证据")).toBeInTheDocument();
    expect(screen.getByText("待验证假设：映射范围不正确")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("当前检查层：映射");
  });

  it("aborts and ignores an old response after project switch", async () => {
    let signal: AbortSignal | undefined;
    let resolve!: (value: Response) => void;
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((done) => { resolve = done; });
    });
    const view = render(<TroubleshootingFlow projectId="project-1" fetchImpl={fetchImpl} evidence={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "检查当前层" }));
    view.rerender(<TroubleshootingFlow projectId="project-2" fetchImpl={fetchImpl} evidence={[]} />);
    expect(signal?.aborted).toBe(true);
    resolve(new Response(JSON.stringify(response), { status: 200 }));
    await waitFor(() => expect(screen.queryByText("记录映射前后数值")).not.toBeInTheDocument());
  });

  it("aborts and suppresses advancement when unmounted during a request", async () => {
    let signal: AbortSignal | undefined;
    let resolve!: (value: Response) => void;
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((done) => { resolve = done; });
    });
    const onAdvanced = vi.fn();
    const view = render(<TroubleshootingFlow projectId="project-1" fetchImpl={fetchImpl} evidence={[]} onAdvanced={onAdvanced} />);
    fireEvent.click(screen.getByRole("button", { name: "检查当前层" }));
    view.unmount();
    expect(signal?.aborted).toBe(true);
    resolve(new Response(JSON.stringify(response), { status: 200 }));
    await Promise.resolve();
    expect(onAdvanced).not.toHaveBeenCalled();
  });
});

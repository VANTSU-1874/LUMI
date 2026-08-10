import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolPathPlan, ToolPathSummary } from "@/components/student/ToolPathPlan";
import { ToolPathPlanResponseSchema } from "@/lib/domain/tool-path";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const plan = ToolPathPlanResponseSchema.parse({ plan: {
  projectId: "project-1",
  path: "COLLABORATIVE",
  stage: "BUILD",
  requirements: { needsRealtimeVisuals: true, needsPhysicalControl: true, hasOsc: true },
  reasons: ["同时需要物理控制与实时视觉"],
  milestones: [
    { id: "m1", title: "打通 OSC 通信", requiredEvidenceLabel: "OSC 数值截图" },
    { id: "m2", title: "完成物理控制", requiredEvidenceLabel: "物理控制截图" },
    { id: "m3", title: "完成协同联调", requiredEvidenceLabel: "联调视频" },
  ],
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
} }).plan;

describe("ToolPathPlan", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a persisted plan as accessible read-only lists", () => {
    render(<ToolPathSummary plan={plan} />);
    expect(screen.getByRole("heading", { name: "DigiShow + TouchDesigner 协同路径" })).toBeInTheDocument();
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(plan.reasons.length + plan.milestones.length);
    expect(screen.getByText("证据/完成条件：OSC 数值截图")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows an accessible lock outside TOOL_PATH", () => {
    render(<ToolPathPlan projectId="project-1" stage="LOGIC_CARD" />);
    expect(screen.getByText("工具路径尚未解锁")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "项目需求" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "生成工具路径" })).toBeDisabled();
  });

  it("submits only three needs and displays the server-selected path", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({ plan }));
    vi.stubGlobal("fetch", fetchMock);
    const onPlanned = vi.fn();
    render(<ToolPathPlan projectId="project-1" stage="TOOL_PATH" onPlanned={onPlanned} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "需要实时视觉" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "需要物理控制" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "已具备 OSC 通信" }));
    fireEvent.click(screen.getByRole("button", { name: "生成工具路径" }));

    expect(await screen.findByRole("heading", { name: "DigiShow + TouchDesigner 协同路径" })).toBeInTheDocument();
    expect(screen.getByText(plan.reasons[0])).toBeInTheDocument();
    expect(screen.getByText("打通 OSC 通信")).toBeInTheDocument();
    expect(screen.getByText("证据：OSC 数值截图")).toBeInTheDocument();
    expect(onPlanned).toHaveBeenCalledWith(expect.objectContaining({ path: "COLLABORATIVE" }));
    expect(screen.getByRole("button", { name: "生成工具路径" })).toBeDisabled();
    expect(screen.getByText("工具路径计划已生成，当前操作已锁定")).toBeInTheDocument();
    expect(screen.queryByText("工具路径尚未解锁")).not.toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ needsRealtimeVisuals: true, needsPhysicalControl: true, hasOsc: true });
    expect(String(init?.body)).not.toMatch(/path|level|reasons|milestones/i);
  });

  it("preserves the generated plan when onPlanned advances the parent stage to BUILD", async () => {
    const fetchMock = vi.fn(async () => response({ plan }));
    vi.stubGlobal("fetch", fetchMock);
    const onPlanned = vi.fn();
    const rendered = render(
      <ToolPathPlan projectId="project-1" stage="TOOL_PATH" onPlanned={onPlanned} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "生成工具路径" }));
    expect(await screen.findByRole("heading", { name: "DigiShow + TouchDesigner 协同路径" })).toBeInTheDocument();

    rendered.rerender(
      <ToolPathPlan projectId="project-1" stage="BUILD" onPlanned={onPlanned} />,
    );
    await act(async () => Promise.resolve());

    expect(screen.getByRole("heading", { name: "DigiShow + TouchDesigner 协同路径" })).toBeInTheDocument();
    expect(screen.getByText(plan.reasons[0])).toBeInTheDocument();
    expect(screen.getByText("完成协同联调")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成工具路径" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts and ignores an in-flight response when stage leaves TOOL_PATH", async () => {
    let resolve!: (value: Response) => void;
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((done) => { resolve = done; });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onPlanned = vi.fn();
    const rendered = render(<ToolPathPlan projectId="project-1" stage="TOOL_PATH" onPlanned={onPlanned} />);
    fireEvent.click(screen.getByRole("button", { name: "生成工具路径" }));

    rendered.rerender(<ToolPathPlan projectId="project-1" stage="BUILD" onPlanned={onPlanned} />);

    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(response({ plan })));
    expect(onPlanned).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "DigiShow + TouchDesigner 协同路径" })).not.toBeInTheDocument();
  });

  it("shows pending and recoverable errors", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    render(<ToolPathPlan projectId="project-1" stage="TOOL_PATH" />);
    fireEvent.click(screen.getByRole("button", { name: "生成工具路径" }));
    expect(screen.getByRole("button", { name: "正在规划…" })).toBeDisabled();
    await act(async () => resolve(response({ ok: false, error: "逻辑卡尚未通过审查" }, 409)));
    expect(await screen.findByRole("alert")).toHaveTextContent("逻辑卡尚未通过审查");
    expect(screen.getByRole("button", { name: "生成工具路径" })).toBeEnabled();
  });

  it("coalesces double clicks and aborts on project change", async () => {
    let resolve!: (value: Response) => void;
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((done) => { resolve = done; });
    });
    vi.stubGlobal("fetch", fetchMock);
    const rendered = render(<ToolPathPlan projectId="project-1" stage="TOOL_PATH" />);
    const button = screen.getByRole("button", { name: "生成工具路径" });
    act(() => {
      button.click();
      button.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rendered.rerender(<ToolPathPlan projectId="project-2" stage="TOOL_PATH" />);
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(response({ plan })));
    expect(screen.queryByRole("heading", { name: "DigiShow + TouchDesigner 协同路径" })).not.toBeInTheDocument();
  });

  it("aborts an in-flight planning request on unmount", () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }));
    const rendered = render(<ToolPathPlan projectId="project-1" stage="TOOL_PATH" />);
    fireEvent.click(screen.getByRole("button", { name: "生成工具路径" }));
    rendered.unmount();
    expect(signal?.aborted).toBe(true);
  });
});

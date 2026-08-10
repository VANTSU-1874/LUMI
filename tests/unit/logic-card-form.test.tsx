import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LogicCardForm } from "@/components/student/LogicCardForm";

const values = {
  "文化意图": "传播安岳石刻文化",
  "参与行为": "观众触摸屏幕区域",
  "输入信号": "采集触摸位置坐标",
  "判断与映射": "按区域映射不同故事",
  "输出媒介": "投影画面和声音变化",
  "体验反馈": "观众立即看到触摸结果",
};

function openDirectEditor() {
  const toggle = screen.getByRole("button", { name: "我已经会了，直接编辑专业卡" });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
}

function fillCard() {
  openDirectEditor();
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
  }
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function logicResult(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "project-1",
    revision: 1,
    cardHash: "a".repeat(64),
    ruleReady: true,
    semanticReady: false,
    status: "PENDING",
    source: "pending-reviewer",
    issues: ["等待智能语义审查或教师确认"],
    stage: "LOGIC_CARD",
    ...overrides,
  };
}

describe("LogicCardForm", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts with one novice question, examples and a visible six-step relationship", () => {
    render(<LogicCardForm projectId="project-1" />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "回答：你希望参与者最后感受到什么？" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发现社区里的真实故事" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "正在形成的互动关系" }).children).toHaveLength(6);
    expect(screen.queryByText("mappingRule")).not.toBeInTheDocument();
  });

  it("keeps a vague answer outside the relationship until the student confirms an Agent hypothesis", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response({
      projectId: "project-1",
      field: "culturalIntent",
      mode: "MODEL_ASSISTED",
      acknowledgement: "热闹可能有几种不同的意思。",
      question: "你更希望参与者感受到哪一种？",
      options: [
        { id: "option-1", label: "社区有活力", value: "希望参与者感受到社区活动的活力" },
        { id: "option-2", label: "愿意加入", value: "希望参与者愿意加入社区活动" },
      ],
      source: "model-clarification-v1",
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LogicCardForm projectId="project-1" />);
    const relationship = screen.getByRole("list", { name: "正在形成的互动关系" });
    const firstStep = within(relationship).getAllByRole("button")[0];

    fireEvent.change(screen.getByRole("textbox", { name: "回答：你希望参与者最后感受到什么？" }), { target: { value: "热闹" } });
    expect(firstStep).toHaveTextContent("还没有形成");
    expect(screen.getByRole("button", { name: "继续下一问" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "让 Agent 帮我理清" }));

    expect(await screen.findByText("你更希望参与者感受到哪一种？")).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({ answer: "热闹", field: "culturalIntent", card: { culturalIntent: "" } });
    fireEvent.click(screen.getByRole("button", { name: /社区有活力/ }));
    expect(firstStep).toHaveTextContent("已经确认");
    expect(firstStep).toHaveTextContent("希望参与者感受到社区活动的活力");
    expect(screen.getByRole("button", { name: "继续下一问" })).toBeEnabled();
  });

  it("keeps an unconfirmed vague draft when the student checks another relationship", () => {
    render(<LogicCardForm projectId="project-1" />);
    fireEvent.change(screen.getByRole("textbox", { name: "回答：你希望参与者最后感受到什么？" }), { target: { value: "有意思" } });
    const relationship = screen.getByRole("list", { name: "正在形成的互动关系" });
    fireEvent.click(within(relationship).getAllByRole("button")[1]);
    fireEvent.click(within(relationship).getAllByRole("button")[0]);

    expect(screen.getByRole("textbox", { name: "回答：你希望参与者最后感受到什么？" })).toHaveValue("有意思");
    expect(within(relationship).getAllByRole("button")[0]).toHaveTextContent("还没有形成");
  });

  it("lets the student confirm and keep a one-word answer", () => {
    render(<LogicCardForm projectId="project-1" />);
    fireEvent.change(screen.getByRole("textbox", { name: "回答：你希望参与者最后感受到什么？" }), { target: { value: "热闹" } });
    fireEvent.click(screen.getByRole("button", { name: "先保留我的原话" }));

    const first = within(screen.getByRole("list", { name: "正在形成的互动关系" })).getAllByRole("button")[0];
    expect(first).toHaveTextContent("热闹");
    expect(screen.getByRole("button", { name: "继续下一问" })).toBeEnabled();
  });

  it("hydrates a persisted card and review on reload", () => {
    render(<LogicCardForm projectId="project-1" initialState={{ payload: {
      culturalIntent: values["文化意图"], participantAction: values["参与行为"], inputSignal: values["输入信号"],
      mappingRule: values["判断与映射"], outputMedium: values["输出媒介"], experienceFeedback: values["体验反馈"],
    }, revision: 3, ruleReady: true, semanticReady: false, status: "NEEDS_REVISION", source: "reviewer", issues: ["映射需要明确"], dataType: "REAL" }} />);
    openDirectEditor();
    expect(screen.getByRole("textbox", { name: "文化意图" })).toHaveValue(values["文化意图"]);
    expect(screen.getByText("映射需要明确")).toBeInTheDocument();
  });

  it("hydrates a newer server revision unless the student has a dirty draft", async () => {
    const state = (revision: number, culturalIntent: string) => ({ payload: {
      culturalIntent, participantAction: values["参与行为"], inputSignal: values["输入信号"], mappingRule: values["判断与映射"], outputMedium: values["输出媒介"], experienceFeedback: values["体验反馈"],
    }, revision, ruleReady: true, semanticReady: false, status: "PENDING" as const, source: "reviewer", issues: ["等待审查"], dataType: "REAL" as const });
    const view = render(<LogicCardForm projectId="project-1" initialState={state(1, "服务端版本一")} />);
    view.rerender(<LogicCardForm projectId="project-1" initialState={state(2, "服务端版本二")} />);
    await waitFor(() => expect(screen.getByText("服务端版本二")).toBeInTheDocument());
    openDirectEditor();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "文化意图" })).toHaveValue("服务端版本二"));
    fireEvent.change(screen.getByRole("textbox", { name: "文化意图" }), { target: { value: "我的未提交草稿" } });
    view.rerender(<LogicCardForm projectId="project-1" initialState={state(3, "服务端版本三")} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("textbox", { name: "文化意图" })).toHaveValue("我的未提交草稿");
  });

  it("submits only six card fields and shows the conservative pending state", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => response(logicResult()));
    const onSaved = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LogicCardForm projectId="project-1" onSaved={onSaved} />);
    fillCard();
    fireEvent.click(screen.getByRole("button", { name: "提交逻辑卡" }));

    expect(await screen.findByText("关系已保存，等待智能审查")).toBeInTheDocument();
    expect(screen.getByText("模型暂时没有给出可靠结果，请稍后重新检查。")).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0];
    expect(Object.keys(JSON.parse(String(init?.body))).sort()).toEqual([
      "culturalIntent", "experienceFeedback", "inputSignal", "mappingRule", "outputMedium", "participantAction",
    ]);
    expect(String(init?.body)).not.toMatch(/approve|semanticReady|path|level/);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("calls onSaved for a needs-revision 200 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(logicResult({
      ruleReady: true, status: "NEEDS_REVISION", source: "test", issues: ["MappingRule field需要说明输入如何决定输出"],
    }))));
    const onSaved = vi.fn();
    render(<LogicCardForm projectId="project-1" onSaved={onSaved} />);
    fillCard(); fireEvent.click(screen.getByRole("button", { name: "提交逻辑卡" }));
    await screen.findByText("“如何跟着变”这一步需要说明输入如何决定输出");
    expect(screen.queryByText(/mappingRule/i)).not.toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("disables submission while pending then calls onUnlocked after approval", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const onUnlocked = vi.fn();
    render(<LogicCardForm projectId="project-1" onUnlocked={onUnlocked} />);
    fillCard();
    fireEvent.click(screen.getByRole("button", { name: "提交逻辑卡" }));
    expect(screen.getByRole("button", { name: "Agent 正在检查关系…" })).toBeDisabled();
    await act(async () => resolve(response(logicResult({ semanticReady: true, status: "APPROVED", issues: [], stage: "TOOL_PATH", source: "test" }))));
    expect(await screen.findByText("这条互动关系已经连通")).toBeInTheDocument();
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "提交逻辑卡" })).not.toBeInTheDocument();
  });

  it("shows rule or revision issues and keeps fields editable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ok: false, error: "逻辑卡内容无效" }, 400)));
    render(<LogicCardForm projectId="project-1" />);
    fillCard();
    fireEvent.click(screen.getByRole("button", { name: "提交逻辑卡" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("逻辑卡内容无效");
    expect(screen.getByRole("textbox", { name: "判断与映射" })).toBeEnabled();
  });

  it("rejects a contradictory approved 200 response without unlocking", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(logicResult({ status: "APPROVED" }))));
    const onUnlocked = vi.fn();
    render(<LogicCardForm projectId="project-1" onUnlocked={onUnlocked} />);
    fillCard();
    fireEvent.click(screen.getByRole("button", { name: "提交逻辑卡" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("审查结果暂不可用");
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it("coalesces a same-tick double click into one request", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    render(<LogicCardForm projectId="project-1" />);
    fillCard();
    const button = screen.getByRole("button", { name: "提交逻辑卡" });
    act(() => {
      button.click();
      button.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts and discards an old response when projectId changes", async () => {
    let resolve!: (value: Response) => void;
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((done) => { resolve = done; });
    });
    vi.stubGlobal("fetch", fetchMock);
    const rendered = render(<LogicCardForm projectId="project-1" />);
    fillCard();
    fireEvent.click(screen.getByRole("button", { name: "提交逻辑卡" }));
    rendered.rerender(<LogicCardForm projectId="project-2" />);
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(response(logicResult({ semanticReady: true, status: "APPROVED", issues: [], stage: "TOOL_PATH" }))));
    expect(screen.queryByText("这条互动关系已经连通")).not.toBeInTheDocument();
  });

  it("aborts an in-flight request on unmount", () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }));
    const rendered = render(<LogicCardForm projectId="project-1" />);
    fillCard();
    fireEvent.click(screen.getByRole("button", { name: "提交逻辑卡" }));
    rendered.unmount();
    expect(signal?.aborted).toBe(true);
  });
});

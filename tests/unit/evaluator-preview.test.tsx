// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvaluatorPreview } from "@/components/preview/EvaluatorPreview";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("EvaluatorPreview", () => {
  it("keeps five theme branches inside the student workspace and reaches a visible result state", async () => {
    const outcome = {
      code: "STAGE_CONCLUSION",
      label: "阶段性结论",
      description: "已明确本轮应先判断的关键对象与边界，可据此继续讨论。",
    };
    const themes = [
      ["S1_DIGITAL_PRODUCT", "TouchDesigner 交互操作", "确认输入数据是否变化"],
      ["S2_COURSE_DESIGN", "品牌设计规范", "澄清品牌核心联想"],
      ["S3_DESIGN_KNOWLEDGE", "封面版式设计分析", "确认视觉进入点与阅读顺序"],
      ["S4_PORTFOLIO_DIRECTION", "个人作品 / 作品集方向", "提炼作品集的共同主线"],
      ["S5_LEARNING_EVIDENCE", "海报风格融合设计", "提取三张海报的风格要素"],
    ].map(([id, title, label]) => ({
      id,
      title,
      capability: "受控评估流程",
      description: "帮助评委看到一个可达的中间结果。",
      sourceLabel: "评委预览",
      initial: { id: `${id}_START`, label: "从预设问题开始", prompt: `${title}的预设首问`, outcome, attachments: [] },
      suggestions: [
        { id: `${id}_A`, label, prompt: `${title}的固定问题`, outcome, attachments: [] },
        { id: `${id}_B`, label: "固定建议二", prompt: `${title}的第二个固定问题`, outcome, attachments: [] },
        { id: `${id}_C`, label: "固定建议三", prompt: `${title}的第三个固定问题`, outcome, attachments: [] },
        { id: `${id}_D`, label: "固定建议四", prompt: `${title}的第四个固定问题`, outcome, attachments: [] },
      ],
    }));
    const completedResponse = {
      title: "先确认参与对象",
      message: "先确认主要使用者，再检查入口是否可见。",
      whyThisStep: "对象决定后续测试的观察重点。",
      uncertainty: "尚未看到现场试用记录。",
      sources: [{
        id: "course-design",
        title: "触点课程原则（本地设计说明）",
        authority: "COURSE_DESIGN",
        scope: "V3导师中的六元交互逻辑",
      }],
      branch: {
        directionId: "S1_DIGITAL_PRODUCT",
        directionTitle: "TouchDesigner 交互操作",
        suggestionId: "S1_DIGITAL_PRODUCT_START",
        suggestionLabel: "从预设问题开始",
        outcome,
      },
    };
    const followupResponse = {
      ...completedResponse,
      message: "可以继续比较入口与反馈的优先级。",
      branch: {
        ...completedResponse.branch,
        suggestionId: "FREE_INPUT",
        suggestionLabel: "评委自由追问",
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ expiresAt: "2026-07-31T00:00:00.000Z", scenarios: themes }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(`event: complete\ndata: ${JSON.stringify({ runId: "run-1", response: completedResponse })}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } }))
      .mockResolvedValueOnce(new Response(`event: complete\ndata: ${JSON.stringify({ runId: "run-2", response: followupResponse })}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<EvaluatorPreview />);

    expect(screen.getByText("LUMI")).not.toHaveAttribute("href");
    expect(screen.queryByRole("link", { name: "返回 Lumi 首页" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "TouchDesigner 交互操作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "品牌设计规范" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "封面版式设计分析" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "个人作品 / 作品集方向" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "海报风格融合设计" })).toBeInTheDocument();
    const initial = screen.getByLabelText("TouchDesigner 交互操作的预设首问");
    expect(within(initial).getAllByRole("button")).toHaveLength(1);
    expect(screen.getByLabelText("固定评估建议，不提供自由输入")).toHaveTextContent("先完成预设首问");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.querySelectorAll("textarea, input, [contenteditable=true]")).toHaveLength(0);

    fireEvent.click(within(initial).getByRole("button", { name: "从预设问题开始" }));

    expect(await screen.findByText("阶段性结论")).toBeInTheDocument();
    expect(screen.getByLabelText("本分支结果状态")).toHaveTextContent("已明确本轮应先判断的关键对象与边界");
    expect(screen.getByText("评委预设 · 从预设问题开始")).toBeInTheDocument();
    expect(screen.queryByText("先确认参与对象")).not.toBeInTheDocument();
    expect(screen.queryByText("对象决定后续测试的观察重点。")).not.toBeInTheDocument();
    expect(screen.queryByText(/本次回答使用的课程来源/)).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("建议的后续操作")).getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByLabelText("固定评估建议，不提供自由输入")).not.toBeInTheDocument();
    const composer = screen.getByRole("textbox", { name: "给 Lumi 发送消息" });
    fireEvent.change(composer, { target: { value: "那我应该先测试哪一个入口？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    expect(await screen.findByText("可以继续比较入口与反馈的优先级。")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      scenarioId: "S1_DIGITAL_PRODUCT",
      suggestionId: "S1_DIGITAL_PRODUCT_START",
    });
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toEqual({
      scenarioId: "S1_DIGITAL_PRODUCT",
      message: "那我应该先测试哪一个入口？",
      history: [{
        userMessage: "TouchDesigner 交互操作的预设首问",
        assistantMessage: "先确认主要使用者，再检查入口是否可见。",
      }],
    });
  });
});

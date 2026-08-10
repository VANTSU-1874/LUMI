import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentMentorAnswer } from "@/components/student/AgentMentorAnswer";
import type { AgentTurnResponse } from "@/lib/agent/contracts";

afterEach(cleanup);

function webGroundedTurn(): AgentTurnResponse {
  return {
    conversationId: "10000000-0000-4000-8000-000000000001",
    turnId: "20000000-0000-4000-8000-000000000001",
    studentMessage: "查一下现在的设计规范",
    coursePack: { id: "general-design", version: "1", label: "通用设计" },
    episode: "UNDERSTAND",
    decisionCode: "UNDERSTAND_WEB_REFERENCE",
    aiMode: "MODEL_ASSISTED",
    policy: {
      policyId: "competition-core",
      policyVersion: "1",
      budgets: { modelDecisions: 1, maxModelDecisions: 4, modelRetries: 0, toolCalls: 1, maxToolCalls: 6, turnTimeoutMs: 30_000 },
      autonomy: { readOnlyTools: "AUTOMATIC", studentMutations: "STUDENT_CONFIRMATION", formalAuthority: "FORBIDDEN" },
      appliedRules: ["EXTERNAL_SEARCH_CONFIRMED", "GROUND_EXTERNAL_SOURCES"],
    },
    executionSteps: [],
    runtime: { id: "current-runtime", version: "1.0.0" },
    runtimeEvents: [],
    createdAt: "2026-07-18T08:00:00.000Z",
    reply: {
      eyebrow: "通用设计 · UNDERSTAND",
      title: "核对公开网页",
      message: "回答正文中的 https://not-a-citation.example 不应自动变成链接。",
      whyThisStep: "外部事实需要保留可核对出处。",
      uncertainty: "公开网页仍需核对作者与发布日期。",
      graph: {
        nodes: [
          { id: "context", label: "问题", kind: "CONTEXT" },
          { id: "evidence", label: "网页", kind: "EVIDENCE" },
        ],
        links: [["context", "evidence"]],
      },
      sources: [
        {
          id: "web:openai",
          title: "OpenAI Web Search 指南",
          authority: "PUBLIC_WEB",
          scope: "联网检索返回，需核对原文。",
          url: "https://developers.openai.com/api/docs/guides/tools-web-search",
        },
        {
          id: "course-reference",
          title: "课程知识",
          authority: "COURSE_DESIGN",
          scope: "课程内部资料。",
        },
      ],
      basis: [{ kind: "WEB_RESEARCH", label: "联网检索" }],
      actions: [],
    },
  };
}

describe("AgentMentorAnswer external sources", () => {
  it("renders the tutor's long-form markdown as readable teaching structure", () => {
    const turn = webGroundedTurn();
    turn.reply.message = [
      "## 先做两步",
      "",
      "1. 检查**主标题**",
      "2. 再看 `line-height`",
      "",
      "```css",
      ".title { line-height: 1.1; }",
      "```",
    ].join("\n");
    render(<AgentMentorAnswer execute={vi.fn()} onOpenTool={vi.fn()} turn={turn} />);

    expect(screen.getByRole("heading", { name: "先做两步", level: 2 })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(".title { line-height: 1.1; }")).toBeInTheDocument();
  });

  it("renders only structured HTTPS citations as clearly labeled external links", () => {
    render(<AgentMentorAnswer execute={vi.fn()} onOpenTool={vi.fn()} turn={webGroundedTurn()} />);
    fireEvent.click(screen.getByText(/查看依据与判断过程/));

    const link = screen.getByRole("link", { name: "OpenAI Web Search 指南 · developers.openai.com · 联网来源" });
    expect(link).toHaveAttribute("href", "https://developers.openai.com/api/docs/guides/tools-web-search");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByText("课程知识 · 课程").tagName).toBe("SPAN");
    expect(screen.queryByRole("link", { name: /not-a-citation/ })).not.toBeInTheDocument();
  });

  it("describes a source-free calculator result without mislabeling ordinary tool observations", () => {
    const turn = webGroundedTurn();
    turn.reply.sources = [];
    turn.reply.basis = [{ kind: "CALCULATION", label: "确定性计算结果" }];
    render(<AgentMentorAnswer execute={vi.fn()} onOpenTool={vi.fn()} turn={turn} />);
    fireEvent.click(screen.getByText(/查看依据与判断过程/));

    expect(screen.getByText("本回答使用了无需外部出处的确定性工具结果")).toBeInTheDocument();
  });

  it("keeps a saved partial response visible and explicitly marked incomplete", () => {
    const turn = webGroundedTurn();
    turn.reply.incomplete = { reason: "MODEL_TIMEOUT" };
    render(<AgentMentorAnswer execute={vi.fn()} onOpenTool={vi.fn()} turn={turn} />);

    expect(screen.getByText("未完成")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("模型响应超时；以下为已经收到的正文");
    expect(screen.getByRole("status")).toHaveTextContent("未补写、未替换为通用套话");
  });
});

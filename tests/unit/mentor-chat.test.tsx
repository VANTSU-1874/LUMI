import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MentorChat, MentorDock } from "@/components/student/MentorChat";
import { AgentRunProgress } from "@/components/student/AgentRunProgress";
import { VoiceButton } from "@/components/student/VoiceButton";
import { externalSearchMessageDigest } from "@/lib/agent/contracts";
import type { AgentRun, AgentRunEvent } from "@/lib/agent/runtime/agent-run-event";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const actionId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const taskId = "66666666-6666-4666-8666-666666666666";
const runId = "77777777-7777-4777-8777-777777777777";

function turn(message: string, title: string, target: "NODE_CANVAS" | "PROJECT" = "NODE_CANVAS") {
  return {
    conversationId,
    turnId,
    studentMessage: message,
    coursePack: { id: "digital-interaction", version: "1", label: "数字交互文创设计" },
    episode: target === "PROJECT" ? "DEBUG" : "UNDERSTAND",
    decisionCode: target === "PROJECT" ? "DEBUG_TRACE_SIGNAL" : "UNDERSTAND_RELATIONSHIP",
    aiMode: "MODEL_ASSISTED",
    policy: {
      policyId: "competition-core",
      policyVersion: "1",
      budgets: { modelDecisions: 1, maxModelDecisions: 4, toolCalls: 0, maxToolCalls: 6, turnTimeoutMs: 30_000 },
      autonomy: { readOnlyTools: "AUTOMATIC", studentMutations: "STUDENT_CONFIRMATION", formalAuthority: "FORBIDDEN" },
      appliedRules: ["BOUND_EXECUTION", "GROUND_COURSE_FACTS", "STUDENT_CONFIRM_MUTATIONS"],
    },
    executionSteps: [
      { id: "44444444-4444-4444-8444-444444444441", sequence: 1, kind: "MODEL_DECISION", status: "SUCCEEDED", label: "决定读取学习现场", summary: "选择当前课程包允许的只读工具。", toolCallId: null, toolId: "project-evidence.read-state", latencyMs: 18 },
      { id: "44444444-4444-4444-8444-444444444442", sequence: 2, kind: "FINAL_RESPONSE", status: "SUCCEEDED", label: "形成受控回答", summary: title, toolCallId: null, toolId: null, latencyMs: 42 },
    ],
    createdAt: "2026-07-14T08:00:00.000Z",
    reply: {
      eyebrow: "数字交互文创设计 · UNDERSTAND",
      title,
      message: "位置、颜色和深度三路数据最终汇入同一个实例化输出。",
      whyThisStep: "先看数据关系，再进入画布验证。",
      uncertainty: "尚未看到现场参数。",
      graph: {
        nodes: [
          { id: "context", label: "图片输入", kind: "CONTEXT" },
          { id: "concept", label: "tx / ty", kind: "CONCEPT" },
          { id: "evidence", label: "Merge", kind: "EVIDENCE" },
          { id: "action", label: "画布验证", kind: "ACTION" },
        ],
        links: [["context", "concept"], ["concept", "evidence"], ["evidence", "action"]],
      },
      sources: [{ id: "td", title: "TouchDesigner基础", authority: "OFFICIAL", scope: "节点数据流" }],
      actions: [{ id: actionId, type: target === "PROJECT" ? "START_TROUBLESHOOTING" : "OPEN_WORKSPACE", label: target === "PROJECT" ? "开始证据排障" : "进入节点画布", description: "确认后打开对应学习空间。", target, focus: target === "PROJECT" ? "troubleshoot" : "grid", status: "PROPOSED" }],
    },
  };
}

type TestTurn = ReturnType<typeof turn> & {
  artworkAttachment?: {
    id: string;
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
    previewUrl: string;
  };
};

function run(result: TestTurn, status: "WAITING_APPROVAL" | "COMPLETED" = "COMPLETED") {
  return {
    id: runId,
    taskId,
    status,
    runtime: { id: "current-runtime", version: "1.0.0" },
    attempt: 1,
    checkpoint: status === "WAITING_APPROVAL"
      ? { stage: "WAITING_APPROVAL", turnId, approvalId: actionId }
      : { stage: "COMPLETED", turnId },
    result,
    lastErrorCode: null,
    cancelRequestedAt: null,
    createdAt: "2026-07-14T08:00:00.000Z",
    updatedAt: "2026-07-14T08:00:01.000Z",
    startedAt: "2026-07-14T08:00:00.000Z",
    completedAt: status === "COMPLETED" ? "2026-07-14T08:00:01.000Z" : null,
  } as const;
}

function transientRun(status: "RUNNING" | "FAILED" | "CANCELLED"): AgentRun {
  return {
    id: runId,
    taskId,
    status,
    runtime: { id: "current-runtime", version: "1.0.0" },
    attempt: 1,
    checkpoint: { stage: status === "RUNNING" ? "CLAIMED" : status },
    result: null,
    lastErrorCode: status === "FAILED" ? "MODEL_SERVICE_FAILED" : null,
    cancelRequestedAt: status === "CANCELLED" ? "2026-07-17T12:00:02.000Z" : null,
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:02.000Z",
    startedAt: "2026-07-17T12:00:01.000Z",
    completedAt: status === "RUNNING" ? null : "2026-07-17T12:00:02.000Z",
  };
}

function noCurrentRun() {
  return new Response(JSON.stringify({ run: null, nextEventSequence: 1 }), { status: 200 });
}

function createdRun(result: TestTurn, status: "WAITING_APPROVAL" | "COMPLETED" = "COMPLETED") {
  return new Response(JSON.stringify({ run: run(result, status), created: true, nextEventSequence: 2 }), { status: status === "COMPLETED" ? 200 : 202 });
}

function mentorFetch() {
  let currentRun: ReturnType<typeof run> | null = null;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/agent/conversation")) return new Response(JSON.stringify({ conversationId: null, coursePack: { id: "digital-interaction", version: "1", label: "数字交互文创设计" }, turns: [] }), { status: 200 });
    if (url === "/api/agent/runs?") return noCurrentRun();
    if (url === "/api/agent/runs") {
      const request = JSON.parse(String(init?.body)) as { message: string };
      const troubleshooting = request.message.includes("不动");
      const result = turn(request.message, troubleshooting ? "沿证据链找出信号停在哪一层" : "图片粒子化要让三路数据汇合", troubleshooting ? "PROJECT" : "NODE_CANVAS");
      currentRun = run(result, "WAITING_APPROVAL");
      return createdRun(result, "WAITING_APPROVAL");
    }
    if (url.startsWith(`/api/agent/runs/${runId}/events`)) return new Response(JSON.stringify({ runId, events: [], nextEventSequence: 1 }), { status: 200 });
    if (url === `/api/agent/runs/${runId}` && currentRun) return new Response(JSON.stringify({ run: currentRun }), { status: 200 });
    if (url === `/api/agent/runs/${runId}/approvals/${actionId}` && currentRun?.result) {
      const executed = { ...currentRun.result, reply: { ...currentRun.result.reply, actions: currentRun.result.reply.actions.map((action) => ({ ...action, status: "EXECUTED" as const })) } };
      currentRun = run(executed, "COMPLETED");
      return new Response(JSON.stringify({ run: currentRun, action: { id: actionId, status: "EXECUTED", alreadyApplied: false, navigation: { target: "NODE_CANVAS", focus: "grid" } } }), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  });
}

describe("MentorChat", () => {
  it("shows streamed tutor text without exposing internal event metadata", () => {
    const running = transientRun("RUNNING");
    const events = [
      {
        id: "88888888-8888-4888-8888-888888888881",
        runId,
        sequence: 1,
        kind: "TOKEN",
        label: "导师正在回答",
        summary: "已收到新的回答片段。",
        payload: { text: "先看信息层级，" },
        createdAt: "2026-07-17T12:00:01.000Z",
      },
      {
        id: "88888888-8888-4888-8888-888888888882",
        runId,
        sequence: 2,
        kind: "TOKEN",
        label: "导师正在回答",
        summary: "已收到新的回答片段。",
        payload: { text: "再调整视觉节奏。" },
        createdAt: "2026-07-17T12:00:02.000Z",
      },
    ] as AgentRunEvent[];

    render(<AgentRunProgress busy={false} events={events} onCancel={vi.fn()} onRetry={vi.fn()} run={running} submittedMessage="版式怎么改？" />);
    expect(screen.getByLabelText("导师流式回答")).toHaveTextContent("先看信息层级，再调整视觉节奏。");
    expect(screen.queryByLabelText("运行事件")).not.toBeInTheDocument();
    expect(screen.getByText("运行状态：触映正在推进")).toBeInTheDocument();
    expect(screen.getByText("运行状态：触映正在推进")).not.toHaveTextContent("先看信息层级");
  });

  it("uses model stream liveness for the thinking state without exposing reasoning text", () => {
    const events = [{
      id: "88888888-8888-4888-8888-888888888889",
      runId,
      sequence: 1,
      kind: "STEP",
      label: "导师正在思考",
      summary: "模型连接仍在持续输出推理或回答片段。",
      payload: { stepKind: "MODEL" },
      createdAt: "2026-07-17T12:00:01.000Z",
    }] as AgentRunEvent[];

    render(<AgentRunProgress busy={false} events={events} onCancel={vi.fn()} onRetry={vi.fn()} run={transientRun("RUNNING")} submittedMessage="版式怎么改？" />);

    expect(screen.getByText("导师正在思考")).toBeInTheDocument();
    expect(screen.queryByLabelText("运行事件")).not.toBeInTheDocument();
    expect(screen.queryByText("模型连接仍在持续输出推理或回答片段。")).not.toBeInTheDocument();
  });

  it.each([
    ["RUNNING", "进行中"],
    ["SUCCEEDED", "已完成"],
    ["FAILED", "未完成"],
  ] as const)("shows a student-facing %s tool status without its internal id", (toolStatus, statusLabel) => {
    const events = [{
      id: "88888888-8888-4888-8888-888888888883",
      runId,
      sequence: 1,
      kind: "TOOL",
      label: "查阅课程参考",
      summary: "课程资料状态已更新。",
      payload: { stepKind: "TOOL", toolId: "course-knowledge.search", toolStatus },
      createdAt: "2026-07-17T12:00:03.000Z",
    }] as AgentRunEvent[];

    render(<AgentRunProgress busy={false} events={events} onCancel={vi.fn()} onRetry={vi.fn()} run={transientRun("RUNNING")} submittedMessage="版式怎么改？" />);

    expect(screen.getByLabelText("运行事件")).toHaveTextContent("查阅课程参考");
    expect(screen.getByLabelText("运行事件")).toHaveTextContent(statusLabel);
    expect(screen.getByLabelText("运行事件")).not.toHaveTextContent("course-knowledge.search");
  });

  it.each(["FAILED", "CANCELLED"] as const)("hides an incomplete token draft after a %s run", (status) => {
    const events = [{
      id: "88888888-8888-4888-8888-888888888881",
      runId,
      sequence: 1,
      kind: "TOKEN",
      label: "导师正在回答",
      summary: "已收到新的回答片段。",
      payload: { text: "这是一段尚未完成、不能作为结论的回答" },
      createdAt: "2026-07-17T12:00:01.000Z",
    }] as AgentRunEvent[];

    render(<AgentRunProgress busy={false} events={events} onCancel={vi.fn()} onRetry={vi.fn()} run={transientRun(status)} submittedMessage="版式怎么改？" />);

    expect(screen.queryByLabelText("导师流式回答")).not.toBeInTheDocument();
    expect(screen.queryByText(/尚未完成、不能作为结论/)).not.toBeInTheDocument();
  });

  it("does not submit when Enter is confirming a Chinese IME candidate or creating a new line", async () => {
    const fetchImpl = mentorFetch();
    render(<MentorChat fetchImpl={fetchImpl as unknown as typeof fetch} onOpenTool={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText("正在恢复上次对话…")).not.toBeInTheDocument());
    const input = screen.getByLabelText("向学习智能体提问");
    fireEvent.change(input, { target: { value: "海报层级" } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(fetchImpl.mock.calls.some(([url]) => String(url) === "/api/agent/runs")).toBe(false);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("heading", { name: "图片粒子化要让三路数据汇合" })).toBeInTheDocument();
  });

  it("focuses the composer when the shell starts a new question", async () => {
    const fetchImpl = mentorFetch();
    const { rerender } = render(<MentorChat fetchImpl={fetchImpl as unknown as typeof fetch} focusRequest={0} onOpenTool={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText("正在恢复上次对话…")).not.toBeInTheDocument());
    rerender(<MentorChat fetchImpl={fetchImpl as unknown as typeof fetch} focusRequest={1} onOpenTool={vi.fn()} />);
    expect(screen.getByLabelText("向学习智能体提问")).toHaveFocus();
  });

  it("presents capabilities as Plugin and Skill instead of bare internal tools", async () => {
    const openTool = vi.fn();
    render(<MentorChat fetchImpl={mentorFetch() as unknown as typeof fetch} onOpenTool={openTool} />);
    fireEvent.click(screen.getByLabelText("打开 Plugin 和 Skill 菜单"));
    expect(screen.getByRole("button", { name: /TouchDesigner 插件/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /书籍设计 Skill/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /课程参考 Skill/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /书籍设计 Skill/ }));
    expect(openTool).toHaveBeenCalledWith("BOOK_LAYOUT_LAB", "layout");
  });

  it("uses the clearly labeled legacy fallback only when the v2 release flag is off", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "新版智能体暂未启用" }), { status: 404 }));
    render(<MentorChat fetchImpl={fetchImpl as unknown as typeof fetch} onOpenTool={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "临时视觉导师" })).toBeInTheDocument();
    expect(screen.getByText(/不读取画像、项目与证据/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("向临时视觉导师提问"), { target: { value: "图片怎么变成粒子" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("heading", { name: /图片粒子化/ })).toBeInTheDocument();
  });

  it("restores a server conversation and turns a question into a grounded visual answer", async () => {
    const openTool = vi.fn();
    const fetchImpl = mentorFetch();
    render(<MentorChat fetchImpl={fetchImpl as unknown as typeof fetch} onOpenTool={openTool} />);

    expect(screen.getByRole("heading", { name: "你现在想弄懂什么？" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "我想做一张酷一点的海报" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "我想做一张酷一点的海报" }));

    expect(await screen.findByRole("heading", { name: "图片粒子化要让三路数据汇合" })).toBeInTheDocument();
    expect(screen.getByLabelText("回答关系图")).toHaveTextContent("tx / ty");
    expect(screen.getByLabelText("回答关系图")).toHaveTextContent("Merge");
    expect(screen.getByLabelText("回答依据")).toHaveTextContent("TouchDesigner基础");
    expect(screen.getByLabelText("Agent 运行约束")).toHaveTextContent("competition-core@1");
    expect(screen.getByLabelText("Agent 运行约束")).toHaveTextContent("导师主循环决策 1/4");
    expect(screen.getByLabelText("Agent 运行约束")).toHaveTextContent("改变学习状态需你确认");
    expect(screen.getByLabelText("Agent 运行约束")).toHaveTextContent("评分、过关与教师复核禁止自动执行");
    expect(screen.getByLabelText("Agent 执行链")).toHaveTextContent("决定读取学习现场");
    expect(screen.getByLabelText("Agent 执行链")).not.toHaveTextContent("project-evidence.read-state");
    fireEvent.click(screen.getByRole("button", { name: /确认后 · 进入节点画布/ }));
    await waitFor(() => expect(openTool).toHaveBeenCalledWith("NODE_CANVAS", "grid"));
  });

  it("accepts an entered troubleshooting question and preserves the server decision chain", async () => {
    const fetchImpl = mentorFetch();
    render(<MentorChat fetchImpl={fetchImpl as unknown as typeof fetch} onOpenTool={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText("正在恢复上次对话…")).not.toBeInTheDocument());
    const input = screen.getByLabelText("向学习智能体提问");
    fireEvent.change(input, { target: { value: "粒子为什么不动？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    expect(await screen.findByRole("heading", { name: "沿证据链找出信号停在哪一层" })).toBeInTheDocument();
    expect(screen.getByText("为什么建议这一步")).toBeInTheDocument();
    expect(screen.getByText("尚不确定")).toBeInTheDocument();
  });

  it("hides external search when the conversation does not advertise the V3 capability", async () => {
    render(<MentorChat fetchImpl={mentorFetch() as unknown as typeof fetch} onOpenTool={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText("正在恢复上次对话…")).not.toBeInTheDocument());
    expect(screen.queryByRole("checkbox", { name: "允许本次联网检索" })).not.toBeInTheDocument();
  });

  it("binds optional external-search consent to one unchanged message and resets it after sending", async () => {
    vi.stubGlobal("crypto", webcrypto);
    let submitted: {
      message: string;
      externalSearchConsent?: { nonce: string; messageDigest: string; issuedAt: number };
    } | null = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/agent/conversation")) return new Response(JSON.stringify({ conversationId: null, coursePack: { id: "general-design", version: "1", label: "通用设计" }, turns: [], features: { externalSearch: true } }), { status: 200 });
      if (url === "/api/agent/runs?") return noCurrentRun();
      if (url === "/api/agent/runs") {
        submitted = JSON.parse(String(init?.body));
        return createdRun(turn(submitted!.message, "结合公开资料继续分析"));
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<MentorChat fetchImpl={fetchImpl as unknown as typeof fetch} onOpenTool={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText("正在恢复上次对话…")).not.toBeInTheDocument());

    const input = screen.getByLabelText("向学习智能体提问");
    const consent = screen.getByRole("checkbox", { name: "允许本次联网检索" });
    expect(consent).toBeDisabled();
    expect(screen.getByText(/会将本条消息经脱敏生成检索词/)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "查一下 2026 设计趋势" } });
    fireEvent.click(consent);
    expect(consent).toBeChecked();
    fireEvent.change(input, { target: { value: "查一下 2026 设计趋势，并给出处" } });
    expect(consent).not.toBeChecked();
    fireEvent.click(consent);
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));

    expect(await screen.findByRole("heading", { name: "结合公开资料继续分析" })).toBeInTheDocument();
    expect(submitted).not.toBeNull();
    expect(submitted!.externalSearchConsent?.nonce).toMatch(/^[0-9a-f-]{36}$/i);
    expect(submitted!.externalSearchConsent?.messageDigest).toBe(
      externalSearchMessageDigest("查一下 2026 设计趋势，并给出处"),
    );
    expect(submitted!.externalSearchConsent?.issuedAt).toEqual(expect.any(Number));
    expect(consent).not.toBeChecked();
    expect(consent).toBeDisabled();
  });

  it("sends one artwork image with the question and renders the restored thumbnail", async () => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const submissions: FormData[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/agent/conversation")) return new Response(JSON.stringify({ conversationId: null, coursePack: { id: "general-design", version: "1", label: "通用设计" }, turns: [] }), { status: 200 });
      if (url === "/api/agent/runs?") return noCurrentRun();
      if (url === "/api/agent/runs") {
        const submitted = init?.body as FormData;
        submissions.push(submitted);
        const payload = JSON.parse(String(submitted.get("payload"))) as { message: string };
        return createdRun({
          ...turn(payload.message, "先看作品中可见的层级"),
          artworkAttachment: {
            id: "55555555-5555-4555-8555-555555555555",
            mimeType: "image/png",
            byteSize: 4,
            width: 2,
            height: 2,
            previewUrl: "/api/agent/artworks/55555555-5555-4555-8555-555555555555",
          },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const { container } = render(<MentorChat fetchImpl={fetchImpl as unknown as typeof fetch} onOpenTool={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText("正在恢复上次对话…")).not.toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("打开 Plugin 和 Skill 菜单"));
    fireEvent.click(screen.getByRole("button", { name: /理解作品图片/ }));
    const file = new File([new Uint8Array([1, 2, 3, 4])], "poster.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    expect(await screen.findByAltText("待发送作品预览")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("向学习智能体提问"), { target: { value: "这张海报层级清楚吗？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    expect(await screen.findByRole("heading", { name: "先看作品中可见的层级" })).toBeInTheDocument();
    expect(submissions[0]).toBeInstanceOf(FormData);
    expect(submissions[0]?.get("artwork")).toBe(file);
    expect(screen.getByAltText("本轮上传的作品")).toHaveAttribute(
      "src",
      "/api/agent/artworks/55555555-5555-4555-8555-555555555555",
    );
  });

  it("sends the active workspace focus to the server Agent", async () => {
    const focus = "节点画布；选中math1（CHOP·数值映射）；已加入3个、建议2个、连线2条";
    let requestContext: unknown = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/agent/conversation")) return new Response(JSON.stringify({ conversationId: null, coursePack: { id: "digital-interaction", version: "1", label: "数字交互文创设计" }, turns: [] }), { status: 200 });
      if (url === "/api/agent/runs?") return noCurrentRun();
      if (url === "/api/agent/runs") {
        const request = JSON.parse(String(init?.body)) as { message: string; context: unknown };
        requestContext = request.context;
        return createdRun(turn(request.message, "先检查当前 Math 节点的映射范围"));
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<MentorChat fetchImpl={fetchImpl as unknown as typeof fetch} focus={focus} onOpenTool={vi.fn()} />);
    expect(screen.getByLabelText("Agent 当前焦点")).toHaveTextContent("math1");
    await waitFor(() => expect(screen.queryByText("正在恢复上次对话…")).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("向学习智能体提问"), { target: { value: "这个节点为什么没有反应？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    expect(await screen.findByRole("heading", { name: "先检查当前 Math 节点的映射范围" })).toBeInTheDocument();
    expect(requestContext).toEqual({ view: "AGENT", focus });
  });

  it("keeps recovery errors actionable and retries the shared conversation", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/agent/runs?") return noCurrentRun();
      attempts += 1;
      if (attempts === 1) return new Response(JSON.stringify({ error: "暂时无法恢复会话" }), { status: 500 });
      return new Response(JSON.stringify({ conversationId: null, coursePack: { id: "digital-interaction", version: "1", label: "数字交互文创设计" }, turns: [] }), { status: 200 });
    });
    render(<MentorChat fetchImpl={fetchImpl as unknown as typeof fetch} onOpenTool={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法恢复会话");
    fireEvent.click(screen.getByRole("button", { name: "重试恢复会话" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("通用设计对话已就绪")).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("restores a failed durable run, resumes its event cursor, and safely retries it", async () => {
    const failed = {
      ...run(turn("我想继续做海报", "不会显示的旧结果"), "COMPLETED"),
      status: "FAILED" as const,
      checkpoint: { stage: "FAILED" as const },
      result: null,
      lastErrorCode: "MODEL_SERVICE_FAILED",
      completedAt: "2026-07-14T08:00:01.000Z",
    };
    const queued = {
      ...failed,
      status: "QUEUED" as const,
      checkpoint: { stage: "RETRY_QUEUED" as const },
      lastErrorCode: null,
      completedAt: null,
      updatedAt: "2026-07-14T08:00:02.000Z",
    };
    let current: typeof failed | typeof queued = failed;
    const requestedEvents: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/agent/conversation")) return new Response(JSON.stringify({ conversationId: null, coursePack: { id: "general-design", version: "1", label: "通用设计" }, turns: [] }), { status: 200 });
      if (url === "/api/agent/runs?") return new Response(JSON.stringify({ run: failed, nextEventSequence: 4 }), { status: 200 });
      if (url.startsWith(`/api/agent/runs/${runId}/events`)) {
        requestedEvents.push(url);
        return new Response(JSON.stringify({
          runId,
          events: [{
            id: "88888888-8888-4888-8888-888888888888",
            runId,
            sequence: 3,
            kind: "ERROR",
            label: "模型服务暂时未完成",
            summary: "运行已停在安全边界，输入和重试条件仍然保留。",
            payload: { status: "FAILED", errorCode: "MODEL_SERVICE_FAILED" },
            createdAt: "2026-07-14T08:00:01.000Z",
          }],
          nextEventSequence: 4,
        }), { status: 200 });
      }
      if (url === `/api/agent/runs/${runId}`) return new Response(JSON.stringify({ run: current }), { status: 200 });
      if (url === `/api/agent/runs/${runId}/retry`) {
        current = queued;
        return new Response(JSON.stringify({ run: queued, alreadyApplied: false }), { status: 202 });
      }
      throw new Error(`unexpected ${url}`);
    });

    render(<MentorChat fetchImpl={fetchImpl as unknown as typeof fetch} onOpenTool={vi.fn()} />);
    expect(await screen.findByText("本轮没有完成")).toBeInTheDocument();
    expect(await screen.findByText("模型服务暂时未完成")).toBeInTheDocument();
    expect(requestedEvents[0]).toContain("after=0");
    fireEvent.click(screen.getByRole("button", { name: "重新运行" }));
    expect(await screen.findByText("已进入队列")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
  });
});

describe("MentorDock", () => {
  it("uses the same server conversation and sends the selected node focus", async () => {
    const focus = "节点画布；选中analyze1（CHOP·声音分析）；已加入5个、建议0个、连线4条";
    let requestContext: unknown = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/agent/conversation")) return new Response(JSON.stringify({ conversationId: null, coursePack: { id: "digital-interaction", version: "1", label: "数字交互文创设计" }, turns: [] }), { status: 200 });
      if (url === "/api/agent/runs?") return noCurrentRun();
      if (url === "/api/agent/runs") {
        const request = JSON.parse(String(init?.body)) as { message: string; context: unknown };
        requestContext = request.context;
        return createdRun(turn(request.message, "Analyze 节点把声音压缩为可映射数值"));
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<MentorDock context="NODE_CANVAS" fetchImpl={fetchImpl as unknown as typeof fetch} focus={focus} onOpenChat={vi.fn()} onOpenTool={vi.fn()} />);
    expect(screen.getByLabelText("悬浮 Agent 当前焦点")).toHaveTextContent("analyze1");
    fireEvent.change(screen.getByLabelText("结合当前界面向导师提问"), { target: { value: "它具体输出什么？" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "发送当前界面问题" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "发送当前界面问题" }));
    expect(await screen.findByRole("heading", { name: "Analyze 节点把声音压缩为可映射数值" })).toBeInTheDocument();
    expect(requestContext).toEqual({ view: "NODE_CANVAS", focus });
  });
});

describe("VoiceButton", () => {
  it("cannot start a transcript while the shared conversation is restoring", () => {
    render(<VoiceButton disabled onTranscript={vi.fn()} />);
    expect(screen.getByRole("button", { name: "开始语音输入" })).toBeDisabled();
  });

  it("explains the fallback when the browser has no speech recognition", () => {
    render(<VoiceButton onTranscript={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
    expect(screen.getByRole("status")).toHaveTextContent("Chrome 或 Edge");
  });
});

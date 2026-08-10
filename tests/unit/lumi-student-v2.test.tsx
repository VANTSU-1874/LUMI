import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRun, AgentTurnResult } from "@/components/client-api";
import { LumiProgress } from "@/components/design-system/LumiUI";
import { ConversationPanel } from "@/components/student-v2/ConversationPanel";
import { StudentSidebar } from "@/components/student-v2/StudentSidebar";
import type { LumiStudentSession } from "@/components/student-v2/use-lumi-student-session";

const now = "2026-07-19T02:00:00.000Z";
const taskId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";
const turnId = "30000000-0000-4000-8000-000000000001";
const actionId = "40000000-0000-4000-8000-000000000001";

type FakeSpeechResultEvent = Event & {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type FakeSpeechErrorEvent = Event & { error?: string };

class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = [];
  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: FakeSpeechResultEvent) => void) | null = null;
  onerror: ((event: FakeSpeechErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }

  emitResult(transcript: string) {
    this.onresult?.({
      results: [{ 0: { transcript }, length: 1 }],
    } as unknown as FakeSpeechResultEvent);
  }

  emitError(error: string) {
    this.onerror?.({ error } as FakeSpeechErrorEvent);
  }

  emitEnd() {
    this.onend?.();
  }
}

function installSpeechRecognition() {
  FakeSpeechRecognition.instances = [];
  Object.defineProperty(window, "webkitSpeechRecognition", {
    configurable: true,
    value: FakeSpeechRecognition,
  });
}

function approvalTurn(): AgentTurnResult {
  return {
    turnId,
    taskId,
    studentMessage: "声音有数值，画面为什么不动？",
    coursePack: { id: "digital-interaction", version: "1", label: "数字交互文创设计" },
    aiMode: "MODEL_ASSISTED",
    executionSteps: [],
    reply: {
      eyebrow: "排障",
      title: "先沿信号链检查",
      message: "自然回答必须先显示，行动仍未执行。",
      whyThisStep: "先确认中断位置。",
      uncertainty: "还没看到参数。",
      sources: [],
      actions: [{ id: actionId, label: "打开节点画布", description: "进入只读画布", status: "PROPOSED" }],
    },
  } as unknown as AgentTurnResult;
}

function session(overrides: Partial<LumiStudentSession> = {}) {
  const resolveApproval = vi.fn(async () => true);
  const value = {
    demo: false,
    tasks: [{ id: taskId, title: "测试对话", status: "ACTIVE", createdAt: now, updatedAt: now }],
    activeTaskId: taskId,
    courses: [],
    currentCourseId: "",
    currentCourseLabel: "数字交互文创设计",
    turns: [],
    latestTurn: null,
    activeRun: null,
    runEvents: [],
    pendingMessage: "",
    transportState: "IDLE",
    transportNotice: "",
    loading: false,
    busy: false,
    approvalBusy: false,
    interventionsEnabled: false,
    interventionMessages: [],
    interventionBusy: false,
    entryRequired: false,
    error: "",
    uploadProgress: { phase: "IDLE", percent: 0, message: "" },
    enterStudent: vi.fn(),
    createTask: vi.fn(),
    selectTask: vi.fn(),
    switchCourse: vi.fn(),
    submit: vi.fn(),
    intervene: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    resolveApproval,
    reload: vi.fn(),
    ...overrides,
  };
  return value as unknown as LumiStudentSession;
}

function conversationProps(value: LumiStudentSession) {
  return {
    session: value,
    artwork: null,
    artworkPreview: "",
    artworkError: "",
    onSelectArtwork: vi.fn(),
    onClearArtwork: vi.fn(),
    onSubmit: vi.fn(async () => false),
    onOpenArtifact: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "SpeechRecognition");
  Reflect.deleteProperty(window, "webkitSpeechRecognition");
  FakeSpeechRecognition.instances = [];
});

describe("Lumi student v2 integration UI", () => {
  it("keeps the formal course read-only and exposes switching only in explicit demo mode", () => {
    const courses = [
      { id: "digital-interaction", label: "数字交互", description: "", version: "1", status: "READY", capabilities: [] },
      { id: "book-design", label: "书籍设计", description: "", version: "1", status: "READY", capabilities: [] },
    ] as LumiStudentSession["courses"];
    const { rerender } = render(<StudentSidebar mobileOpen={false} onClose={vi.fn()} onOpenGrowth={vi.fn()} session={session({ courses })} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("数字交互文创设计")).toBeInTheDocument();

    rerender(<StudentSidebar mobileOpen={false} onClose={vi.fn()} onOpenGrowth={vi.fn()} session={session({ demo: true, courses, currentCourseId: "digital-interaction" })} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("预置演示数据")).toBeInTheDocument();
  });

  it("shows a persistent, prominent demo disclosure in the main conversation", () => {
    render(<ConversationPanel {...conversationProps(session({ demo: true }))} />);
    expect(screen.getByRole("status")).toHaveTextContent("预置演示");
    expect(screen.getByRole("status")).toHaveTextContent("不是真实学生记录");
  });

  it("keeps the normal text composer when browser speech recognition is unavailable", () => {
    render(<ConversationPanel {...conversationProps(session())} />);
    expect(screen.queryByRole("button", { name: "开始语音输入" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "向 Lumi 提问" })).not.toHaveAttribute("readonly");
  });

  it("writes live speech into an editable draft without sending it automatically", async () => {
    installSpeechRecognition();
    const onSubmit = vi.fn(async () => false);
    render(<ConversationPanel {...conversationProps(session())} onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox", { name: "向 Lumi 提问" });
    fireEvent.change(textarea, { target: { value: "已有想法" } });
    const startButton = await screen.findByRole("button", { name: "开始语音输入" });
    fireEvent.click(startButton);
    const recognition = FakeSpeechRecognition.instances.at(-1)!;
    expect(recognition).toMatchObject({
      lang: "zh-CN",
      continuous: false,
      interimResults: true,
      maxAlternatives: 1,
    });
    expect(textarea).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "发送问题" })).toBeDisabled();

    act(() => recognition.emitResult("继续描述作品"));
    expect(textarea).toHaveValue("已有想法 继续描述作品");
    expect(onSubmit).not.toHaveBeenCalled();

    act(() => recognition.emitEnd());
    expect(textarea).not.toHaveAttribute("readonly");
    expect(screen.getByRole("status")).toHaveTextContent("可修改后发送");
    fireEvent.click(screen.getByRole("button", { name: "发送问题" }));
    expect(onSubmit).toHaveBeenCalledWith("已有想法 继续描述作品");
  });

  it("keeps a new speech session active when an old failed instance ends late", async () => {
    installSpeechRecognition();
    render(<ConversationPanel {...conversationProps(session())} />);
    fireEvent.click(await screen.findByRole("button", { name: "开始语音输入" }));
    const first = FakeSpeechRecognition.instances.at(-1)!;
    act(() => first.emitError("not-allowed"));
    expect(screen.getByRole("status")).toHaveTextContent("麦克风权限");

    fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
    const second = FakeSpeechRecognition.instances.at(-1)!;
    expect(second).not.toBe(first);
    act(() => first.emitEnd());
    expect(screen.getByRole("button", { name: "停止语音输入" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "向 Lumi 提问" })).toHaveAttribute("readonly");
  });

  it("prevents repeated stops and aborts recognition when the composer becomes busy or unmounts", async () => {
    installSpeechRecognition();
    const initialProps = conversationProps(session());
    const { rerender, unmount } = render(<ConversationPanel {...initialProps} />);
    fireEvent.click(await screen.findByRole("button", { name: "开始语音输入" }));
    const first = FakeSpeechRecognition.instances.at(-1)!;
    const stopButton = screen.getByRole("button", { name: "停止语音输入" });
    fireEvent.click(stopButton);
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "正在结束语音输入" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "正在结束语音输入" }));
    expect(first.stop).toHaveBeenCalledTimes(1);
    act(() => first.emitEnd());

    fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
    const second = FakeSpeechRecognition.instances.at(-1)!;
    rerender(<ConversationPanel {...conversationProps(session({ busy: true }))} />);
    expect(second.abort).toHaveBeenCalledTimes(1);

    rerender(<ConversationPanel {...conversationProps(session())} />);
    fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
    const third = FakeSpeechRecognition.instances.at(-1)!;
    unmount();
    expect(third.abort).toHaveBeenCalledTimes(1);
  });

  it("keeps the student reply concise by hiding the internal step rationale", () => {
    const turn = approvalTurn();
    render(<ConversationPanel {...conversationProps(session({ turns: [turn], latestTurn: turn }))} />);
    expect(screen.getByText("自然回答必须先显示，行动仍未执行。")).toBeInTheDocument();
    expect(screen.queryByText("为什么先做这一步")).not.toBeInTheDocument();
    expect(screen.queryByText("先确认中断位置。")).not.toBeInTheDocument();
  });

  it.each([
    ["批准并执行此受控行动", "APPROVE"],
    ["保留回答，不执行", "REJECT"],
  ] as const)("shows the natural answer before an explicit %s decision", (buttonLabel, decision) => {
    const turn = approvalTurn();
    const activeRun = {
      id: runId,
      status: "WAITING_APPROVAL",
      result: turn,
    } as AgentRun;
    const value = session({
      turns: [turn],
      latestTurn: turn,
      activeRun,
      busy: true,
    });
    render(<ConversationPanel {...conversationProps(value)} />);
    expect(screen.getByText("自然回答必须先显示，行动仍未执行。")).toBeInTheDocument();
    expect(value.resolveApproval).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: buttonLabel }));
    expect(value.resolveApproval).toHaveBeenCalledTimes(1);
    expect(value.resolveApproval).toHaveBeenCalledWith(actionId, decision);
  });

  it("keeps text steering available during a run while artwork and speech stay locked", async () => {
    installSpeechRecognition();
    const onSubmit = vi.fn(async () => true);
    const value = session({
      busy: true,
      interventionsEnabled: true,
      interventionMessages: [{
        id: "90000000-0000-4000-8000-000000000001",
        content: "下一轮先看版式层级",
        turnId: null,
        requestedMode: "FOLLOW_UP",
        actualMode: "FOLLOW_UP",
        queueSequence: 1,
        status: "QUEUED",
      }],
    });
    render(<ConversationPanel {...conversationProps(value)} onSubmit={onSubmit} />);

    const textarea = screen.getByRole("textbox", { name: "向 Lumi 提问" });
    expect(textarea).toBeEnabled();
    expect(screen.getByRole("button", { name: /添加作品/ })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "开始语音输入" })).toBeDisabled();
    expect(screen.getByText("已排队")).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "再补充一个观察" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("再补充一个观察", "FOLLOW_UP"));
    await waitFor(() => expect(textarea).toHaveValue(""));

    fireEvent.change(textarea, { target: { value: "先不要谈颜色，改看信息层级" } });
    fireEvent.click(screen.getByRole("button", { name: "改变当前方向" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("先不要谈颜色，改看信息层级", "STEER"));
  });

  it("retains the original busy composer lock when interventions are disabled", () => {
    render(<ConversationPanel {...conversationProps(session({
      busy: true,
      interventionsEnabled: false,
    }))} />);
    expect(screen.getByRole("textbox", { name: "向 Lumi 提问" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "改变当前方向" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "追加到下一轮" })).not.toBeInTheDocument();
  });

  it("renders polling recovery as a neutral, single notice", () => {
    render(<ConversationPanel {...conversationProps(session({
      transportState: "POLLING",
      transportNotice: "实时显示暂时中断，已改用后台状态恢复；本轮不会重复提交。",
    }))} />);
    const notice = screen.getByText(/本轮不会重复提交/).closest("aside");
    expect(notice).toBeInTheDocument();
    expect(notice).not.toHaveAttribute("role", "alert");
    expect(screen.getAllByText(/本轮不会重复提交/)).toHaveLength(1);
  });

  it("does not announce a fake percentage for indeterminate upload progress", () => {
    render(<LumiProgress indeterminate label="作品上传" value={50} />);
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
    expect(screen.getByText("正在进行")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });
});

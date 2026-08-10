import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  type AgentConversationResponse,
  type AgentRun,
  type AgentRunEvent,
  type AgentRunIntervention,
  type AgentRunSubscriptionHandlers,
  type AgentTurnResult,
  type ArtworkRunUploadInput,
  type ClientApi,
} from "@/components/client-api";
import {
  isUsableCritique,
  mergeLumiRunEvents,
  submissionFingerprint,
  useLumiStudentSession,
} from "@/components/student-v2/use-lumi-student-session";
import { mockCritique } from "@/components/client-api/mock/fixtures";

const taskId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";
const successorRunId = "20000000-0000-4000-8000-000000000002";
const turnId = "30000000-0000-4000-8000-000000000001";
const actionId = "40000000-0000-4000-8000-000000000001";
const interventionId = "90000000-0000-4000-8000-000000000001";
const now = "2026-07-19T02:00:00.000Z";

type MutableCritique = {
  dimensions: Array<{
    id: string;
    displayOrder: number;
    evidence: unknown[];
    guidance: { level: string; understandingCheck?: string };
    isDeepDive: boolean;
  }>;
};

function critiqueCounterexample(
  kind: "WRONG_ORDER" | "ZERO_DEEP_DIVE" | "DEMONSTRATION_WITHOUT_CHECK" | "MISSING_EVIDENCE",
) {
  const value = structuredClone(mockCritique) as unknown as MutableCritique;
  if (kind === "WRONG_ORDER") {
    [value.dimensions[0], value.dimensions[1]] = [value.dimensions[1]!, value.dimensions[0]!];
  } else if (kind === "ZERO_DEEP_DIVE") {
    value.dimensions.forEach((dimension) => { dimension.isDeepDive = false; });
  } else if (kind === "DEMONSTRATION_WITHOUT_CHECK") {
    value.dimensions[0]!.guidance.level = "DEMONSTRATION";
    delete value.dimensions[0]!.guidance.understandingCheck;
  } else {
    value.dimensions[0]!.evidence = [];
  }
  return value;
}

function turn(): AgentTurnResult {
  return {
    taskId,
    conversationId: "50000000-0000-4000-8000-000000000001",
    turnId,
    studentMessage: "声音有数值，但画面为什么不动？",
    coursePack: { id: "digital-interaction", version: "1", label: "数字交互文创设计" },
    episode: "DEBUG",
    decisionCode: "DEBUG_TRACE_SIGNAL",
    aiMode: "MODEL_ASSISTED",
    policy: {
      policyId: "competition-core",
      policyVersion: "1",
      budgets: { modelDecisions: 1, maxModelDecisions: 2, modelRetries: 0, toolCalls: 0, maxToolCalls: 4, turnTimeoutMs: 180_000 },
      autonomy: { readOnlyTools: "AUTOMATIC", studentMutations: "STUDENT_CONFIRMATION", formalAuthority: "FORBIDDEN" },
      appliedRules: ["STUDENT_CONFIRM_MUTATIONS"],
    },
    executionSteps: [],
    runtime: { id: "test-runtime", version: "1.0.0" },
    runtimeEvents: [],
    createdAt: now,
    reply: {
      eyebrow: "数字交互 · 排障",
      title: "先沿信号链确认中断位置",
      message: "先看声音数值是否真的进入了驱动画面的参数。",
      whyThisStep: "有数值不等于下游已经收到它。",
      uncertainty: "尚未看到现场节点参数。",
      graph: { nodes: [], links: [] },
      sources: [],
      actions: [{
        id: actionId,
        type: "OPEN_WORKSPACE",
        label: "打开节点画布",
        description: "确认后进入只读节点画布。",
        target: "NODE_CANVAS",
        focus: "signal",
        status: "PROPOSED",
      }],
    },
  } as AgentTurnResult;
}

function run(status: AgentRun["status"], result: AgentTurnResult | null = null): AgentRun {
  return {
    id: runId,
    taskId,
    request: { taskId, message: "声音有数值，但画面为什么不动？", context: { view: "AGENT" } },
    status,
    runtime: { id: "test-runtime", version: "1.0.0" },
    attempt: 1,
    checkpoint: status === "WAITING_APPROVAL"
      ? { stage: "WAITING_APPROVAL", turnId, approvalId: actionId }
      : status === "RUNNING"
        ? { stage: "CLAIMED" }
        : status === "QUEUED"
          ? { stage: "CREATED" }
          : { stage: status },
    result,
    lastErrorCode: null,
    cancelRequestedAt: null,
    createdAt: now,
    updatedAt: now,
    startedAt: status === "QUEUED" ? null : now,
    completedAt: ["COMPLETED", "FAILED", "CANCELLED"].includes(status) ? now : null,
  } as AgentRun;
}

function intervention(
  overrides: Partial<AgentRunIntervention> = {},
): AgentRunIntervention {
  return {
    id: interventionId,
    taskId,
    sourceRunId: runId,
    predecessorRunId: runId,
    userMessageId: "intervention:80000000-0000-4000-8000-000000000001",
    requestedMode: "STEER",
    actualMode: "FOLLOW_UP",
    queueSequence: 1,
    nextRunId: successorRunId,
    status: "QUEUED",
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function conversation(turns: AgentTurnResult[] = []): AgentConversationResponse {
  return {
    taskId,
    conversationId: turns.length ? "50000000-0000-4000-8000-000000000001" : null,
    coursePack: { id: "digital-interaction", version: "1", label: "数字交互文创设计" },
    turns,
    features: { externalSearch: false },
  } as AgentConversationResponse;
}

function fakeApi(overrides: Partial<ClientApi> = {}) {
  const api = {
    fetch: vi.fn(),
    enterStudent: vi.fn(async () => ({ ok: true as const })),
    enterTeacher: vi.fn(),
    listTasks: vi.fn(async () => ({ tasks: [{ id: taskId, title: "测试对话", status: "ACTIVE", createdAt: now, updatedAt: now }] })),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    conversation: vi.fn(async () => conversation()),
    currentRun: vi.fn(async () => ({ run: null, nextEventSequence: 1 })),
    createRun: vi.fn(),
    getRun: vi.fn(),
    getEvents: vi.fn(async () => ({ runId, events: [], nextEventSequence: 1 })),
    listRunInterventions: vi.fn(async () => ({ taskId, interventions: [] })),
    createRunIntervention: vi.fn(),
    listMessages: vi.fn(async () => ({
      taskId,
      messages: [],
      pendingRun: null,
    })),
    cancelRun: vi.fn(),
    retryRun: vi.fn(),
    resolveApproval: vi.fn(),
    getCritique: vi.fn(async () => { throw new ApiError({ message: "没有会诊", status: 404 }); }),
    courses: vi.fn(async () => ({ currentCourseId: "digital-interaction", courses: [] })),
    switchCourse: vi.fn(),
    teacherResources: vi.fn(),
    deleteTeacherResource: vi.fn(),
    teacherInsights: vi.fn(),
    ...overrides,
  };
  return api as unknown as ClientApi;
}

function fakeSubscription() {
  let handlers: AgentRunSubscriptionHandlers | null = null;
  const close = vi.fn();
  const subscribe = vi.fn((_runId, _after, nextHandlers: AgentRunSubscriptionHandlers) => {
    handlers = nextHandlers;
    nextHandlers.onConnection?.(true);
    return { close };
  });
  return {
    subscribe,
    close,
    handlers: () => handlers as AgentRunSubscriptionHandlers,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Lumi student session helpers", () => {
  it("uses submission content and file identity without changing for an equivalent retry", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "draft.png", { type: "image/png", lastModified: 123 });
    expect(submissionFingerprint(taskId, "同一问题", file)).toBe(submissionFingerprint(taskId, "同一问题", file));
    expect(submissionFingerprint(taskId, "另一个问题", file)).not.toBe(submissionFingerprint(taskId, "同一问题", file));
    expect(submissionFingerprint(taskId, "同一问题", new File([new Uint8Array([1])], "other.png", { type: "image/png", lastModified: 123 })))
      .not.toBe(submissionFingerprint(taskId, "同一问题", file));
  });

  it("deduplicates event sequences and rejects a malformed optional critique", () => {
    const event = { sequence: 3 } as AgentRunEvent;
    expect(mergeLumiRunEvents([event], [event, { sequence: 4 } as AgentRunEvent]).map((item) => item.sequence)).toEqual([3, 4]);
    expect(isUsableCritique({ dimensions: null, closure: {} })).toBe(false);
  });

  it("accepts the shared server critique contract", () => {
    expect(isUsableCritique(mockCritique)).toBe(true);
  });

  it.each([
    ["canonical dimension order is changed", "WRONG_ORDER"],
    ["no dimension is selected for deep dive", "ZERO_DEEP_DIVE"],
    ["demonstration guidance has no understanding check", "DEMONSTRATION_WITHOUT_CHECK"],
    ["a dimension has no evidence", "MISSING_EVIDENCE"],
  ] as const)("rejects a critique when %s", (_label, kind) => {
    expect(isUsableCritique(critiqueCounterexample(kind))).toBe(false);
  });
});

describe("useLumiStudentSession", () => {
  it("never requests or exposes course switching on the formal path", async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useLumiStudentSession({ demo: false, dependencies: { api } }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.courses).not.toHaveBeenCalled();
    await act(async () => { expect(await result.current.switchCourse("book-design")).toBe(false); });
    expect(api.switchCourse).not.toHaveBeenCalled();
    expect(result.current.currentCourseLabel).toBe("数字交互文创设计");
  });

  it.each([
    [new ApiError({ message: "请重新进入", status: 401 }), true],
    [new ApiError({ message: "请求来源无效", status: 403, code: "REQUEST_SOURCE_FORBIDDEN" }), false],
    [new ApiError({ message: "请求太快", status: 429 }), false],
    [new ApiError({ message: "服务暂不可用", status: 500 }), false],
  ] as const)("opens the identity gate only for an identity ApiError", async (failure, expectedGate) => {
    const api = fakeApi({ listTasks: vi.fn(async () => { throw failure; }) as ClientApi["listTasks"] });
    const { result } = renderHook(() => useLumiStudentSession({ demo: false, dependencies: { api } }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entryRequired).toBe(expectedGate);
    expect(result.current.error).toBe(failure.message);
  });

  it.each(["QUEUED", "RUNNING"] as const)("restores the pending message for a %s run", async (status) => {
    const current = run(status);
    const api = fakeApi({
      currentRun: vi.fn(async () => ({ run: current, nextEventSequence: 1 })),
      getRun: vi.fn(async () => ({ run: current })),
    });
    const stream = fakeSubscription();
    const { result, unmount } = renderHook(() => useLumiStudentSession({
      demo: false,
      dependencies: { api, subscribe: stream.subscribe, pollIntervalMs: 60_000 },
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pendingMessage).toBe(current.request?.message);
    unmount();
  });

  it("restores intervention support and reuses the same message identity after a lost response", async () => {
    const running = run("RUNNING");
    const queuedIntervention = intervention();
    const successor = {
      ...run("QUEUED"),
      id: successorRunId,
      request: {
        taskId,
        clientMessageId: queuedIntervention.userMessageId,
        message: "先不要谈颜色，改看信息层级",
        context: { view: "AGENT" as const },
      },
    };
    let accepted = false;
    let attempt = 0;
    const createRunIntervention = vi.fn<ClientApi["createRunIntervention"]>(
      async () => {
        attempt += 1;
        if (attempt === 1) throw new TypeError("response lost");
        accepted = true;
        return {
          intervention: queuedIntervention,
          nextRun: successor,
          created: true,
          steerShouldCancel: false,
        };
      },
    );
    const listRunInterventions = vi.fn<ClientApi["listRunInterventions"]>(
      async () => ({
        taskId,
        interventions: accepted ? [queuedIntervention] : [],
      }),
    );
    const listMessages = vi.fn<ClientApi["listMessages"]>(async () => ({
      taskId,
      messages: [{
        id: queuedIntervention.userMessageId,
        taskId,
        role: "user",
        content: "先不要谈颜色，改看信息层级",
        structure: { version: 1, kind: "user" },
        attachment: null,
        toolCalls: [],
        turnId: null,
        runId: null,
        createdAt: now,
      }],
      pendingRun: null,
    }));
    const api = fakeApi({
      currentRun: vi.fn(async () => ({
        run: running,
        nextEventSequence: 1,
        interventionsEnabled: true,
      })),
      getRun: vi.fn(async () => ({ run: running })),
      createRunIntervention,
      listRunInterventions,
      listMessages,
    });
    const createKey = vi.fn(() => "80000000-0000-4000-8000-000000000001");
    const stream = fakeSubscription();
    const { result, unmount } = renderHook(() => useLumiStudentSession({
      demo: false,
      dependencies: {
        api,
        createIdempotencyKey: createKey,
        subscribe: stream.subscribe,
        pollIntervalMs: 60_000,
      },
    }));

    await waitFor(() => expect(result.current.interventionsEnabled).toBe(true));
    await act(async () => {
      expect(await result.current.intervene("先不要谈颜色，改看信息层级", "STEER"))
        .toBe(false);
    });
    await act(async () => {
      expect(await result.current.intervene("先不要谈颜色，改看信息层级", "STEER"))
        .toBe(true);
    });

    expect(createRunIntervention.mock.calls.map((call) => call[2])).toEqual([
      "80000000-0000-4000-8000-000000000001",
      "80000000-0000-4000-8000-000000000001",
    ]);
    expect(createRunIntervention.mock.calls.map((call) => call[1].message.id))
      .toEqual([
        "intervention:80000000-0000-4000-8000-000000000001",
        "intervention:80000000-0000-4000-8000-000000000001",
      ]);
    await waitFor(() => expect(result.current.interventionMessages).toEqual([{
      id: interventionId,
      content: "先不要谈颜色，改看信息层级",
      turnId: null,
      requestedMode: "STEER",
      actualMode: "FOLLOW_UP",
      queueSequence: 1,
      status: "QUEUED",
    }]));
    expect(result.current.activeRun?.id).toBe(runId);
    expect(createKey).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("moves the watcher to the server-selected successor after the source run ends", async () => {
    const running = run("RUNNING");
    const completed = run("COMPLETED", turn());
    const successor = {
      ...run("RUNNING"),
      id: successorRunId,
      request: {
        taskId,
        clientMessageId: "intervention:successor",
        message: "下一轮检查版式层级",
        context: { view: "AGENT" as const },
      },
    };
    const currentRun = vi.fn()
      .mockResolvedValueOnce({
        run: running,
        nextEventSequence: 1,
        interventionsEnabled: true,
      })
      .mockResolvedValue({
        run: successor,
        nextEventSequence: 1,
        interventionsEnabled: true,
      });
    const api = fakeApi({
      currentRun,
      getRun: vi.fn(async (nextRunId: string) => ({
        run: nextRunId === runId ? completed : successor,
      })),
    });
    const stream = fakeSubscription();
    const { result, unmount } = renderHook(() => useLumiStudentSession({
      demo: false,
      dependencies: {
        api,
        subscribe: stream.subscribe,
        pollIntervalMs: 20,
      },
    }));

    await waitFor(() => expect(result.current.activeRun?.id).toBe(successorRunId));
    expect(stream.subscribe.mock.calls.map((call) => call[0]))
      .toEqual([runId, successorRunId]);
    expect(result.current.pendingMessage).toBe("下一轮检查版式层级");
    unmount();
  });

  it("shows a WAITING_APPROVAL natural answer first and never approves automatically", async () => {
    const waiting = run("WAITING_APPROVAL", turn());
    const api = fakeApi({
      currentRun: vi.fn(async () => ({ run: waiting, nextEventSequence: 1 })),
      getRun: vi.fn(async () => ({ run: waiting })),
    });
    const stream = fakeSubscription();
    const { result, unmount } = renderHook(() => useLumiStudentSession({
      demo: false,
      dependencies: { api, subscribe: stream.subscribe, pollIntervalMs: 60_000 },
    }));
    await waitFor(() => expect(result.current.latestTurn?.reply.title).toBe("先沿信号链确认中断位置"));
    expect(result.current.pendingMessage).toBe("");
    expect(api.resolveApproval).not.toHaveBeenCalled();
    expect(stream.subscribe).not.toHaveBeenCalled();
    expect(api.getRun).not.toHaveBeenCalled();
    unmount();
  });

  it("stops watching when a running poll reaches WAITING_APPROVAL", async () => {
    const running = run("RUNNING");
    const waiting = run("WAITING_APPROVAL", turn());
    const api = fakeApi({
      currentRun: vi.fn(async () => ({ run: running, nextEventSequence: 1 })),
      getRun: vi.fn(async () => ({ run: waiting })),
    });
    const stream = fakeSubscription();
    const { result, unmount } = renderHook(() => useLumiStudentSession({
      demo: false,
      dependencies: { api, subscribe: stream.subscribe, pollIntervalMs: 60_000 },
    }));
    await waitFor(() => expect(result.current.activeRun?.status).toBe("WAITING_APPROVAL"));
    expect(result.current.latestTurn?.reply.message).toContain("声音数值");
    expect(result.current.transportState).toBe("IDLE");
    expect(stream.close).toHaveBeenCalledTimes(1);
    expect(api.resolveApproval).not.toHaveBeenCalled();
    unmount();
  });

  it("switches an interrupted SSE run to polling, merges by sequence, and never creates another run", async () => {
    const running = run("RUNNING");
    const duplicate = {
      id: "60000000-0000-4000-8000-000000000003",
      runId,
      sequence: 3,
      kind: "TOKEN",
      label: "导师回复",
      summary: "片段",
      payload: { text: "先看信号。" },
      createdAt: now,
    } as AgentRunEvent;
    const next = { ...duplicate, id: "60000000-0000-4000-8000-000000000004", sequence: 4, payload: { text: "再看映射。" } } as AgentRunEvent;
    const api = fakeApi({
      currentRun: vi.fn(async () => ({ run: running, nextEventSequence: 1 })),
      getRun: vi.fn(async () => ({ run: running })),
      getEvents: vi.fn(async () => ({ runId, events: [duplicate, next], nextEventSequence: 5 })),
      createRun: vi.fn(),
    });
    const stream = fakeSubscription();
    const { result, unmount } = renderHook(() => useLumiStudentSession({
      demo: false,
      dependencies: { api, subscribe: stream.subscribe, pollIntervalMs: 20 },
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      stream.handlers().onEvent(duplicate);
      stream.handlers().onTransportError?.(new Error("断流"));
    });
    await waitFor(() => expect(result.current.runEvents.map((event) => event.sequence)).toEqual([3, 4]));
    expect(result.current.transportNotice).toContain("不会重复提交");
    expect(api.createRun).not.toHaveBeenCalled();
    unmount();
  });

  it("reuses a key after transport loss, then clears it after a successful response", async () => {
    let attempt = 0;
    const completed = run("COMPLETED", turn());
    const createRun = vi.fn<ClientApi["createRun"]>(async () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError("response lost");
      return { run: completed, created: true, nextEventSequence: 1 };
    });
    const api = fakeApi({ createRun });
    const createKey = vi.fn()
      .mockReturnValueOnce("70000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("70000000-0000-4000-8000-000000000002")
      .mockReturnValueOnce("70000000-0000-4000-8000-000000000003");
    const subscribe = vi.fn(() => ({ close: vi.fn() }));
    const { result } = renderHook(() => useLumiStudentSession({
      demo: false,
      dependencies: { api, createIdempotencyKey: createKey, subscribe },
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.submit("同一问题"); });
    await act(async () => { await result.current.submit("同一问题"); });
    await act(async () => { await result.current.submit("同一问题"); });
    await act(async () => { await result.current.submit("换一个问题"); });
    expect(createRun.mock.calls.map((call) => call[1])).toEqual([
      "70000000-0000-4000-8000-000000000001",
      "70000000-0000-4000-8000-000000000001",
      "70000000-0000-4000-8000-000000000002",
      "70000000-0000-4000-8000-000000000003",
    ]);
    expect(createRun.mock.calls.map((call) => call[0].clientMessageId)).toEqual([
      "message:70000000-0000-4000-8000-000000000001",
      "message:70000000-0000-4000-8000-000000000001",
      "message:70000000-0000-4000-8000-000000000002",
      "message:70000000-0000-4000-8000-000000000003",
    ]);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("reuses a lost upload key for the same file and rotates it when the file changes", async () => {
    const upload = vi.fn<(input: ArtworkRunUploadInput) => Promise<never>>(async (input) => {
      void input;
      throw new TypeError("upload response lost");
    });
    const createKey = vi.fn()
      .mockReturnValueOnce("71000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("71000000-0000-4000-8000-000000000002");
    const firstFile = new File(["first"], "draft.png", { type: "image/png", lastModified: 1 });
    const changedFile = new File(["second"], "revised.png", { type: "image/png", lastModified: 2 });
    const { result } = renderHook(() => useLumiStudentSession({
      demo: false,
      dependencies: { api: fakeApi(), createIdempotencyKey: createKey, upload },
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.submit("请看作品", firstFile); });
    await act(async () => { await result.current.submit("请看作品", firstFile); });
    await act(async () => { await result.current.submit("请看作品", changedFile); });
    expect(upload.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      "71000000-0000-4000-8000-000000000001",
      "71000000-0000-4000-8000-000000000001",
      "71000000-0000-4000-8000-000000000002",
    ]);
  });

  it("rotates an uncertain submission key when the message changes", async () => {
    const createRun = vi.fn<ClientApi["createRun"]>(async () => {
      throw new TypeError("response lost");
    });
    const createKey = vi.fn()
      .mockReturnValueOnce("72000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("72000000-0000-4000-8000-000000000002");
    const { result } = renderHook(() => useLumiStudentSession({
      demo: false,
      dependencies: { api: fakeApi({ createRun }), createIdempotencyKey: createKey },
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.submit("原问题"); });
    await act(async () => { await result.current.submit("改过的问题"); });
    expect(createRun.mock.calls.map((call) => call[1])).toEqual([
      "72000000-0000-4000-8000-000000000001",
      "72000000-0000-4000-8000-000000000002",
    ]);
  });

  it("locks a double submit before the first response resolves", async () => {
    let release!: () => void;
    const pending = new Promise<never>((_resolve, reject) => { release = () => reject(new TypeError("lost")); });
    const createRun = vi.fn<ClientApi["createRun"]>((request, key) => {
      void request;
      void key;
      return pending;
    });
    const api = fakeApi({ createRun });
    const { result } = renderHook(() => useLumiStudentSession({ demo: false, dependencies: { api } }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let first!: ReturnType<typeof result.current.submit>;
    let second!: ReturnType<typeof result.current.submit>;
    act(() => {
      first = result.current.submit("不要重复");
      second = result.current.submit("不要重复");
    });
    await expect(second).resolves.toBeNull();
    expect(createRun).toHaveBeenCalledTimes(1);
    release();
    await act(async () => { await first; });
  });

  it.each(["missing", "malformed", "wrong-order", "zero-deep-dive"] as const)("drops a %s critique without changing the natural turn", async (kind) => {
    const natural = { ...turn(), critique: { dimensions: null } } as unknown as AgentTurnResult;
    const getCritique = kind === "missing"
      ? vi.fn(async () => { throw new ApiError({ message: "没有会诊", status: 404 }); })
      : vi.fn(async () => ({
        critique: kind === "malformed"
          ? { dimensions: [], closure: null }
          : critiqueCounterexample(kind === "wrong-order" ? "WRONG_ORDER" : "ZERO_DEEP_DIVE"),
      }));
    const api = fakeApi({
      conversation: vi.fn(async () => conversation([natural])),
      getCritique: getCritique as unknown as ClientApi["getCritique"],
    });
    const { result } = renderHook(() => useLumiStudentSession({ demo: false, dependencies: { api } }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(getCritique).toHaveBeenCalled());
    expect(result.current.latestTurn?.reply.message).toContain("声音数值");
    expect(result.current.latestTurn?.aiMode).toBe("MODEL_ASSISTED");
    expect(result.current.latestTurn?.critique).toBeUndefined();
    expect(result.current.activeRun).toBeNull();
    expect(api.retryRun).not.toHaveBeenCalled();
    expect(result.current.error).toBe("");
  });

  it("hydrates the optional critique sidecar in labeled demo mode", async () => {
    const natural = turn();
    const getCritique = vi.fn(async () => ({ critique: mockCritique }));
    const api = fakeApi({
      conversation: vi.fn(async () => conversation([natural])),
      getCritique: getCritique as unknown as ClientApi["getCritique"],
    });
    const { result } = renderHook(() => useLumiStudentSession({ demo: true, dependencies: { api } }));

    await waitFor(() => expect(getCritique).toHaveBeenCalledWith(turnId));
    await waitFor(() => expect(result.current.latestTurn?.critique?.id).toBe(mockCritique.id));
    expect(result.current.error).toBe("");
  });

  it("reuses the approval idempotency key after a lost response", async () => {
    const waiting = run("WAITING_APPROVAL", turn());
    const resolveApproval = vi.fn<ClientApi["resolveApproval"]>(async (nextRunId, nextActionId, decision, key) => {
      void nextRunId;
      void nextActionId;
      void decision;
      void key;
      throw new TypeError("response lost");
    });
    const api = fakeApi({
      currentRun: vi.fn(async () => ({ run: waiting, nextEventSequence: 1 })),
      resolveApproval,
    });
    const createKey = vi.fn(() => "80000000-0000-4000-8000-000000000001");
    const { result, unmount } = renderHook(() => useLumiStudentSession({
      demo: false,
      dependencies: { api, createIdempotencyKey: createKey, pollIntervalMs: 60_000 },
    }));
    await waitFor(() => expect(result.current.activeRun?.status).toBe("WAITING_APPROVAL"));
    expect(resolveApproval).not.toHaveBeenCalled();
    await act(async () => { await result.current.resolveApproval(actionId, "APPROVE"); });
    await act(async () => { await result.current.resolveApproval(actionId, "APPROVE"); });
    expect(resolveApproval.mock.calls.map((call) => call[3])).toEqual([
      "80000000-0000-4000-8000-000000000001",
      "80000000-0000-4000-8000-000000000001",
    ]);
    expect(createKey).toHaveBeenCalledTimes(1);
    unmount();
  });
});

// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentMessageRecord } from "@/lib/agent/agent-message-contract";
import {
  LumiThreadListAdapter,
  agentMessageToAssistantParts,
  agentMessageToThreadMessage,
  createInitializingLumiHistoryAdapter,
  createLumiHistoryAdapter,
  waitForUserMessageWrite,
} from "@/components/assistant-lab/assistant-lab-backend";
import {
  createLumiAgentModelAdapter,
  resumeLumiAgentRun,
} from "@/components/assistant-lab/lumi-agent-model-adapter";
import { createComposerCapabilityCoordinator } from "@/components/assistant-lab/assistant-lab-capability-state";

const taskId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const userId = "client-message-1";
const actionId = "44444444-4444-4444-8444-444444444444";
const callId = "55555555-5555-4555-8555-555555555555";
const attachmentId = "66666666-6666-4666-8666-666666666666";

const userMessage: AgentMessageRecord = {
  id: userId,
  taskId,
  role: "user",
  content: "请看这张海报的信息层级",
  structure: { version: 1, kind: "user" },
  attachment: {
    id: attachmentId,
    mimeType: "image/png",
    byteSize: 128,
    width: 2,
    height: 2,
    previewUrl: `/api/agent/artworks/${attachmentId}`,
  },
  toolCalls: [],
  turnId,
  runId,
  createdAt: "2026-07-21T10:00:00.000Z",
};

const assistantMessage: AgentMessageRecord = {
  id: `${turnId}#a`,
  taskId,
  role: "assistant",
  content: "先把主标题和活动信息分成两个稳定层级。",
  structure: {
    version: 1,
    kind: "assistant",
    episode: "EXPLORE",
    decisionCode: "EXPLORE_START_DIAGNOSTIC",
    aiMode: "MODEL_ASSISTED",
    executionSteps: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sequence: 1,
        kind: "MODEL_DECISION",
        status: "SUCCEEDED",
        label: "判断当前问题",
        summary: "先确认主标题是否形成稳定阅读入口。",
        toolCallId: null,
        toolId: null,
        latencyMs: 2,
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        sequence: 2,
        kind: "TOOL_OBSERVATION",
        status: "SUCCEEDED",
        label: "读取课程依据",
        summary: "课程知识库命中信息层级条目。",
        toolCallId: callId,
        toolId: "knowledge-map.search-concepts",
        latencyMs: 4,
      },
      {
        id: "88888888-8888-4888-8888-888888888888",
        sequence: 3,
        kind: "FINAL_RESPONSE",
        status: "SUCCEEDED",
        label: "形成回答",
        summary: "已形成可执行的下一步。",
        toolCallId: null,
        toolId: null,
        latencyMs: 1,
      },
    ],
    reply: {
      eyebrow: "版式设计",
      title: "先稳定阅读入口",
      message: "先把主标题和活动信息分成两个稳定层级。",
      whyThisStep: "阅读入口会决定后续信息能否被看见。",
      uncertainty: "仍需确认海报的真实观看距离。",
      graph: {
        nodes: [
          { id: "goal", label: "目标", kind: "CONTEXT" },
          { id: "action", label: "调整层级", kind: "ACTION" },
        ],
        links: [["goal", "action"]],
      },
      sources: [{
        id: "course-source",
        title: "信息层级课程条目",
        authority: "COURSE_DESIGN",
        scope: "当前课程包",
      }],
      basis: [{ kind: "COURSE_KNOWLEDGE", label: "课程知识" }],
      actions: [{
        id: actionId,
        type: "START_DIAGNOSTIC",
        label: "开始五维会诊",
        description: "按五维检查当前作品。",
        target: "PROJECT",
        focus: "diagnostic",
        status: "PROPOSED",
      }],
    },
  },
  attachment: null,
  toolCalls: [{
    id: `${turnId}:1`,
    callId,
    sequence: 1,
    toolId: "knowledge-map.search-concepts",
    toolVersion: "1",
    adapterId: "knowledge-map",
    input: { query: "信息层级" },
    output: { retrieval: { strategy: "HYBRID" }, items: [] },
    status: "EMPTY",
    errorCode: null,
    latencyMs: 4,
  }],
  turnId,
  runId,
  createdAt: "2026-07-21T10:00:01.000Z",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("assistant-lab backend adapters", () => {
  it("converts persisted Lumi structure into stable assistant-ui parts without losing facts", () => {
    const parts = agentMessageToAssistantParts(assistantMessage);
    expect(parts).toEqual([
      { type: "reasoning", text: "先确认主标题是否形成稳定阅读入口。" },
      expect.objectContaining({
        type: "data",
        name: "lumi-execution-progress",
        data: {
          state: "complete",
          items: [
            expect.objectContaining({
              sequence: 1,
              label: "判断当前问题",
              status: "completed",
            }),
            expect.objectContaining({
              sequence: 2,
              label: "读取课程依据",
              status: "completed",
            }),
          ],
        },
      }),
      expect.objectContaining({
        type: "tool-call",
        toolCallId: `${turnId}:1`,
        toolName: "knowledge-map.search-concepts",
        args: { query: "信息层级" },
      }),
      { type: "text", text: assistantMessage.content },
      expect.objectContaining({
        type: "source",
        sourceType: "document",
        id: "course-source",
      }),
      expect.objectContaining({
        type: "data",
        name: "lumi-response",
        data: expect.objectContaining({
          whyThisStep: "阅读入口会决定后续信息能否被看见。",
          basis: [{ kind: "COURSE_KNOWLEDGE", label: "课程知识" }],
        }),
      }),
      expect.objectContaining({
        type: "tool-call",
        toolCallId: actionId,
        toolName: "lumi.five_dimension_diagnosis",
        args: expect.objectContaining({ runId, turnId, actionId }),
      }),
    ]);

    const converted = agentMessageToThreadMessage(assistantMessage);
    expect(converted).toMatchObject({
      id: `${turnId}#a`,
      role: "assistant",
      status: { type: "complete", reason: "stop" },
      content: parts,
    });
  });

  it("keeps the frontend user id stable and reconstructs the artwork attachment", () => {
    expect(agentMessageToThreadMessage(userMessage)).toMatchObject({
      id: userId,
      role: "user",
      content: [{ type: "text", text: userMessage.content }],
      attachments: [{
        id: attachmentId,
        type: "image",
        contentType: "image/png",
        status: { type: "complete" },
        content: [{
          type: "image",
          image: `/api/agent/artworks/${attachmentId}`,
        }],
      }],
    });
  });

  it("preserves a persisted partial answer as an incomplete assistant-ui message", () => {
    if (assistantMessage.structure.kind !== "assistant") throw new Error("assistant fixture expected");
    const partialMessage: AgentMessageRecord = {
      ...assistantMessage,
      structure: {
        ...assistantMessage.structure,
        reply: {
          ...assistantMessage.structure.reply,
          incomplete: { reason: "MODEL_TIMEOUT" },
        },
      },
    };
    const converted = agentMessageToThreadMessage(partialMessage);
    expect(converted).toMatchObject({
      role: "assistant",
      status: {
        type: "incomplete",
        reason: "error",
        error: { message: "模型响应超时；以下为已经收到的正文。" },
      },
    });
    expect(converted.content).toContainEqual({ type: "text", text: assistantMessage.content });
    expect(converted.content).toContainEqual(expect.objectContaining({
      type: "data",
      name: "lumi-response",
      data: expect.objectContaining({ incomplete: { reason: "MODEL_TIMEOUT" } }),
    }));
  });

  it("uses token-limit copy for a persisted truncated answer", () => {
    if (assistantMessage.structure.kind !== "assistant") throw new Error("assistant fixture expected");
    const partialMessage: AgentMessageRecord = {
      ...assistantMessage,
      structure: {
        ...assistantMessage.structure,
        reply: {
          ...assistantMessage.structure.reply,
          incomplete: { reason: "MODEL_OUTPUT_TRUNCATED" },
        },
      },
    };

    expect(agentMessageToThreadMessage(partialMessage)).toMatchObject({
      role: "assistant",
      status: {
        type: "incomplete",
        reason: "error",
        error: { message: "本次输出达到长度上限；以下为已经收到的正文。" },
      },
    });
  });

  it("restores the structured capability on a persisted user message", () => {
    const converted = agentMessageToThreadMessage({
      ...userMessage,
      structure: {
        version: 1,
        kind: "user",
        capability: { id: "course-reference", source: "composer" },
      },
    });
    expect(converted.metadata?.custom).toMatchObject({
      capability: { id: "course-reference", source: "composer" },
    });
  });

  it("loads a full linear chain and never appends assistant messages from the browser", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      taskId,
      messages: [userMessage, assistantMessage],
      pendingRun: null,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createLumiHistoryAdapter(taskId);
    const repository = await adapter.load();
    expect(repository.headId).toBe(`${turnId}#a`);
    expect(repository.messages).toMatchObject([
      { parentId: null, message: { id: userId, role: "user" } },
      { parentId: userId, message: { id: `${turnId}#a`, role: "assistant" } },
    ]);

    await adapter.append(repository.messages[1]!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps live token text identical to the persisted completion parts", async () => {
    const messagesUrl = `/api/agent/tasks/${taskId}/messages`;
    const threadUser = agentMessageToThreadMessage(userMessage);
    const capabilityCoordinator = createComposerCapabilityCoordinator();
    capabilityCoordinator.select("public-research");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === messagesUrl && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({
          capability: { id: "public-research", source: "composer" },
        });
        return new Response(JSON.stringify({ message: userMessage, created: true }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/agent/runs" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({
          capability: { id: "public-research", source: "composer" },
          context: { view: "AGENT" },
          externalSearchConsent: {
            messageDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        });
        return new Response(JSON.stringify({ run: { id: runId, status: "QUEUED" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === `/api/agent/runs/${runId}/events?after=0&limit=200`) {
        return new Response(JSON.stringify({ events: [
          {
            id: "99999999-9999-4999-8999-999999999998",
            runId,
            sequence: 1,
            kind: "STEP",
            label: "读取课程依据",
            summary: "正在核对课程中的信息层级依据。",
            payload: { stepKind: "RETRIEVAL" },
            createdAt: "2026-07-21T10:00:00.500Z",
          },
          {
            id: "99999999-9999-4999-8999-999999999997",
            runId,
            sequence: 2,
            kind: "STEP",
            label: "理解你的问题",
            summary: "模型连接仍在持续输出推理或回答片段。",
            payload: { stepKind: "MODEL" },
            createdAt: "2026-07-21T10:00:00.750Z",
          },
          {
            id: "99999999-9999-4999-8999-999999999999",
            runId,
            sequence: 3,
            kind: "TOKEN",
            label: "生成回答",
            summary: "生成最终回答",
            payload: { text: assistantMessage.content },
            createdAt: "2026-07-21T10:00:01.000Z",
          },
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === `/api/agent/runs/${runId}`) {
        return new Response(JSON.stringify({ run: { id: runId, status: "COMPLETED" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === messagesUrl) {
        return new Response(JSON.stringify({
          taskId,
          messages: [userMessage, assistantMessage],
          pendingRun: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await createLumiHistoryAdapter(taskId, capabilityCoordinator)
      .append({ parentId: null, message: threadUser });
    const chunks: Array<{ content: Array<{ type: string; text?: string }>; status?: unknown }> = [];
    const stream = createLumiAgentModelAdapter(capabilityCoordinator).run({
      messages: [threadUser],
      abortSignal: new AbortController().signal,
      unstable_threadId: taskId,
    } as never) as AsyncGenerator<unknown, void, unknown>;
    for await (const chunk of stream) {
      chunks.push(chunk as typeof chunks[number]);
    }

    const textOf = (chunk: typeof chunks[number]) => chunk.content
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
    expect(chunks).toHaveLength(2);
    expect(textOf(chunks[0]!)).toBe(assistantMessage.content);
    expect(textOf(chunks[1]!)).toBe(assistantMessage.content);
    expect(chunks[0]?.content).toContainEqual(expect.objectContaining({
      type: "data",
      name: "lumi-execution-progress",
      data: expect.objectContaining({
        state: "streaming",
        items: expect.arrayContaining([expect.objectContaining({
          label: "读取课程依据",
          status: "completed",
        })]),
      }),
    }));
    expect(chunks[0]?.content).toContainEqual({
      type: "reasoning",
      text: "模型连接仍在持续输出推理或回答片段。",
    });
    expect(chunks[1]?.status).toEqual({ type: "complete", reason: "stop" });
  });

  it("resumes a running server-side answer after reopening its conversation", async () => {
    const resumableUserId = "resumable-user-message";
    const resumableUser = {
      ...userMessage,
      id: resumableUserId,
      turnId: null,
      runId: null,
      attachment: null,
    };
    const threadUser = agentMessageToThreadMessage(resumableUser);
    if (threadUser.role !== "user") throw new Error("user fixture expected");
    let messageReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/agent/tasks/${taskId}/messages`) {
        messageReads += 1;
        return new Response(JSON.stringify(messageReads === 1
          ? {
            taskId,
            messages: [resumableUser],
            pendingRun: { userMessageId: resumableUserId, runId, status: "RUNNING" },
          }
          : { taskId, messages: [resumableUser, assistantMessage], pendingRun: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === `/api/agent/runs/${runId}/events?after=0&limit=200`) {
        return new Response(JSON.stringify({ events: [{
          id: "99999999-9999-4999-8999-999999999996",
          runId,
          sequence: 1,
          kind: "TOKEN",
          label: "生成回答",
          summary: "生成最终回答",
          payload: { text: assistantMessage.content },
          createdAt: "2026-07-21T10:00:01.000Z",
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === `/api/agent/runs/${runId}`) {
        return new Response(JSON.stringify({ run: { id: runId, status: "COMPLETED" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const history = createLumiHistoryAdapter(taskId, undefined, resumeLumiAgentRun);
    const repository = await history.load();
    expect(repository).toMatchObject({
      headId: resumableUserId,
      unstable_resume: true,
      messages: [{ parentId: null, message: { id: resumableUserId, role: "user" } }],
    });
    expect(repository.messages).toHaveLength(1);

    const chunks: Array<{ content: Array<{ type: string; text?: string }>; status?: unknown }> = [];
    const stream = history.resume!({
      messages: [threadUser],
      abortSignal: new AbortController().signal,
      unstable_threadId: taskId,
    } as never);
    for await (const chunk of stream) chunks.push(chunk as typeof chunks[number]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toContainEqual({ type: "text", text: assistantMessage.content });
    expect(chunks[1]?.status).toEqual({ type: "complete", reason: "stop" });
    expect(fetchMock.mock.calls.some(([input, init]) => (
      String(input) === "/api/agent/runs" && init?.method === "POST"
    ))).toBe(false);
  });

  it("does not cancel a durable run when assistant-ui detaches its thread", async () => {
    const detachUserId = "detach-user-message";
    const detachedUser = agentMessageToThreadMessage({
      ...userMessage,
      id: detachUserId,
      turnId: null,
      runId: null,
      attachment: null,
    });
    if (detachedUser.role !== "user") throw new Error("user fixture expected");
    let eventRequestStarted!: () => void;
    const eventRequest = new Promise<void>((resolve) => {
      eventRequestStarted = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/agent/tasks/${taskId}/messages` && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ message: userMessage }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }));
      }
      if (url === "/api/agent/runs" && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ run: { id: runId, status: "QUEUED" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }));
      }
      if (url === `/api/agent/runs/${runId}/events?after=0&limit=200`) {
        eventRequestStarted();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }
      if (url.endsWith(`/api/agent/runs/${runId}/cancel`)) {
        throw new Error("a detached thread must not cancel its server run");
      }
      throw new Error(`Unexpected request: ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await createLumiHistoryAdapter(taskId).append({ parentId: null, message: detachedUser });
    const controller = new AbortController();
    const stream = createLumiAgentModelAdapter().run({
      messages: [detachedUser],
      abortSignal: controller.signal,
      unstable_threadId: taskId,
    } as never) as AsyncGenerator<unknown, void, unknown>;
    const next = stream.next();
    await eventRequest;
    const detachError = Object.assign(new Error("thread detached"), {
      name: "AbortError",
      detach: true,
    });
    controller.abort(detachError);

    await expect(next).rejects.toBe(detachError);
    expect(fetchMock.mock.calls.some(([input]) => (
      String(input).endsWith(`/api/agent/runs/${runId}/cancel`)
    ))).toBe(false);
  });

  it("still cancels the server run when the student explicitly stops generation", async () => {
    const cancelUserId = "cancel-user-message";
    const cancelUser = agentMessageToThreadMessage({
      ...userMessage,
      id: cancelUserId,
      turnId: null,
      runId: null,
      attachment: null,
    });
    if (cancelUser.role !== "user") throw new Error("user fixture expected");
    let eventRequestStarted!: () => void;
    const eventRequest = new Promise<void>((resolve) => {
      eventRequestStarted = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/agent/tasks/${taskId}/messages` && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ message: userMessage }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }));
      }
      if (url === "/api/agent/runs" && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ run: { id: runId, status: "QUEUED" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }));
      }
      if (url === `/api/agent/runs/${runId}/events?after=0&limit=200`) {
        eventRequestStarted();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }
      if (url.endsWith(`/api/agent/runs/${runId}/cancel`)) {
        return Promise.resolve(new Response(JSON.stringify({ run: { id: runId, status: "RUNNING" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      throw new Error(`Unexpected request: ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await createLumiHistoryAdapter(taskId).append({ parentId: null, message: cancelUser });
    const controller = new AbortController();
    const stream = createLumiAgentModelAdapter().run({
      messages: [cancelUser],
      abortSignal: controller.signal,
      unstable_threadId: taskId,
    } as never) as AsyncGenerator<unknown, void, unknown>;
    const next = stream.next();
    await eventRequest;
    const cancelError = Object.assign(new Error("student stopped generation"), {
      name: "AbortError",
      detach: false,
    });
    controller.abort(cancelError);

    await expect(next).rejects.toBe(cancelError);
    expect(fetchMock.mock.calls.filter(([input]) => (
      String(input).endsWith(`/api/agent/runs/${runId}/cancel`)
    ))).toHaveLength(1);
  });

  it("carries a persisted partial answer through the adapter without replacing its text", async () => {
    if (assistantMessage.structure.kind !== "assistant") throw new Error("assistant fixture expected");
    const partialMessage: AgentMessageRecord = {
      ...assistantMessage,
      structure: {
        ...assistantMessage.structure,
        reply: {
          ...assistantMessage.structure.reply,
          incomplete: { reason: "MODEL_CONNECTION_INTERRUPTED" },
        },
      },
    };
    const threadUser = agentMessageToThreadMessage(userMessage);
    if (threadUser.role !== "user") throw new Error("user fixture expected");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/agent/runs" && init?.method === "POST") {
        return new Response(JSON.stringify({ run: { id: runId, status: "QUEUED" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === `/api/agent/runs/${runId}/events?after=0&limit=200`) {
        return new Response(JSON.stringify({ events: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === `/api/agent/runs/${runId}`) {
        return new Response(JSON.stringify({ run: { id: runId, status: "COMPLETED" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === `/api/agent/tasks/${taskId}/messages`) {
        return new Response(JSON.stringify({
          taskId,
          messages: [userMessage, partialMessage],
          pendingRun: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    const chunks: Array<{ content: Array<{ type: string; text?: string }>; status?: unknown }> = [];
    const stream = createLumiAgentModelAdapter().run({
      messages: [threadUser],
      abortSignal: new AbortController().signal,
      unstable_threadId: taskId,
    } as never) as AsyncGenerator<unknown, void, unknown>;
    for await (const chunk of stream) chunks.push(chunk as typeof chunks[number]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.status).toEqual({
      type: "incomplete",
      reason: "error",
      error: { message: "模型连接中断；以下为已经收到的正文。" },
    });
    expect(chunks[0]?.content).toContainEqual({ type: "text", text: assistantMessage.content });
  });

  it("keeps the durable prefix visible and calls /continue instead of creating a fresh run", async () => {
    if (assistantMessage.structure.kind !== "assistant") throw new Error("assistant fixture expected");
    const continuationUserId = "continuation-preview-user";
    const sourceRunId = "abababab-abab-4aba-8aba-abababababab";
    const childRunId = "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd";
    const durablePrefix = "已写正文必须在续写请求返回前保持可见。";
    const continuationUser = {
      ...userMessage,
      id: continuationUserId,
      turnId: null,
      runId: null,
      attachment: null,
    };
    const threadUser = agentMessageToThreadMessage(continuationUser);
    if (threadUser.role !== "user") throw new Error("user fixture expected");
    const partialMessage: AgentMessageRecord = {
      ...assistantMessage,
      id: `${sourceRunId}#a`,
      runId: sourceRunId,
      content: durablePrefix,
      structure: {
        ...assistantMessage.structure,
        reply: {
          ...assistantMessage.structure.reply,
          message: durablePrefix,
          incomplete: { reason: "MODEL_CONNECTION_INTERRUPTED" },
        },
      },
    };
    const messagesUrl = `/api/agent/tasks/${taskId}/messages`;
    const continuationUrl = `/api/agent/runs/${sourceRunId}/continue`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === messagesUrl && !init?.method) {
        return new Response(JSON.stringify({
          taskId,
          messages: [continuationUser, partialMessage],
          pendingRun: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === messagesUrl && init?.method === "POST") {
        return new Response(JSON.stringify({ message: continuationUser }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === continuationUrl && init?.method === "POST") {
        return new Response(JSON.stringify({
          created: true,
          nextEventSequence: 0,
          run: {
            id: childRunId,
            status: "QUEUED",
            request: {
              continuation: {
                sourceRunId,
                previousText: durablePrefix,
                attempt: 1,
              },
            },
          },
        }), { status: 202, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await createLumiHistoryAdapter(taskId).load();
    await createLumiHistoryAdapter(taskId).append({ parentId: null, message: threadUser });

    const stream = createLumiAgentModelAdapter().run({
      messages: [threadUser],
      abortSignal: new AbortController().signal,
      unstable_threadId: taskId,
    } as never) as AsyncGenerator<unknown, void, unknown>;
    const preview = await stream.next() as {
      value: { content: Array<{ type: string; text?: string; name?: string; data?: unknown }> };
    };
    expect(preview.value.content).toContainEqual({ type: "text", text: durablePrefix });
    expect(preview.value.content).toContainEqual(expect.objectContaining({
      type: "data",
      name: "lumi-continuation",
      data: expect.objectContaining({ instantPrefix: durablePrefix, seamOffset: durablePrefix.length }),
    }));
    expect(fetchMock.mock.calls.some(([input]) => String(input) === continuationUrl)).toBe(false);

    await stream.next();
    expect(fetchMock.mock.calls.some(([input]) => String(input) === continuationUrl)).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/agent/runs")).toBe(false);
    await stream.return(undefined);
  });

  it("registers an already visible prefix before an explicit stop can race terminal persistence", async () => {
    const stoppingUserId = "stop-race-user";
    const stoppingRunId = "efefefef-efef-4efe-8efe-efefefefefef";
    const durablePrefix = "停止时已经显示的正文不能等服务端终态才建立续写入口。";
    const stoppingUser = {
      ...userMessage,
      id: stoppingUserId,
      turnId: null,
      runId: null,
      attachment: null,
    };
    const threadUser = agentMessageToThreadMessage(stoppingUser);
    if (threadUser.role !== "user") throw new Error("user fixture expected");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/agent/tasks/${taskId}/messages` && init?.method === "POST") {
        return new Response(JSON.stringify({ message: stoppingUser }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/agent/runs" && init?.method === "POST") {
        return new Response(JSON.stringify({
          run: {
            id: stoppingRunId,
            status: "RUNNING",
            request: {
              continuation: {
                sourceRunId: runId,
                previousText: durablePrefix,
                attempt: 1,
              },
            },
          },
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (url === `/api/agent/runs/${stoppingRunId}/cancel` && init?.method === "POST") {
        return new Response(JSON.stringify({ run: { id: stoppingRunId, status: "RUNNING" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await createLumiHistoryAdapter(taskId).append({ parentId: null, message: threadUser });
    const controller = new AbortController();
    const active = createLumiAgentModelAdapter().run({
      messages: [threadUser],
      abortSignal: controller.signal,
      unstable_threadId: taskId,
    } as never) as AsyncGenerator<unknown, void, unknown>;
    await active.next();
    controller.abort(Object.assign(new Error("student stopped"), {
      name: "AbortError",
      detach: false,
    }));
    await active.return(undefined);
    const freshRunCallsBeforeReload = fetchMock.mock.calls.filter(([input]) => (
      String(input) === "/api/agent/runs"
    )).length;

    const continuation = createLumiAgentModelAdapter().run({
      messages: [threadUser],
      abortSignal: new AbortController().signal,
      unstable_threadId: taskId,
    } as never) as AsyncGenerator<unknown, void, unknown>;
    const preview = await continuation.next() as {
      value: { content: Array<{ type: string; text?: string }> };
    };
    expect(preview.value.content).toContainEqual({ type: "text", text: durablePrefix });
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/agent/runs")).toHaveLength(
      freshRunCallsBeforeReload,
    );
    expect(fetchMock.mock.calls.some(([input]) => String(input) === `/api/agent/runs/${stoppingRunId}/continue`)).toBe(false);
    await continuation.return(undefined);
  });

  it("waits for first-thread initialization before persisting the first user message", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      message: userMessage,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const initialize = vi.fn(async () => ({ remoteId: taskId }));
    const item = {
      parentId: null,
      message: agentMessageToThreadMessage(userMessage),
    };

    const adapter = createInitializingLumiHistoryAdapter({
      getRemoteId: () => undefined,
      initialize,
    });
    await expect(adapter.load()).resolves.toEqual({ messages: [] });
    await adapter.append(item);

    expect(initialize).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/agent/tasks/${taskId}/messages`,
      expect.objectContaining({ method: "POST" }),
    );
    await expect(waitForUserMessageWrite(userId)).resolves.toBe(taskId);
    await expect(waitForUserMessageWrite(userId)).resolves.toBeUndefined();
  });

  it("lets the model wait before first-thread history append is registered", async () => {
    const earlyUserId = "early-user-message";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      message: { ...userMessage, id: earlyUserId },
    }), { status: 201, headers: { "content-type": "application/json" } })));
    const adapter = createInitializingLumiHistoryAdapter({
      getRemoteId: () => undefined,
      initialize: async () => ({ remoteId: taskId }),
    });
    const write = waitForUserMessageWrite(earlyUserId);

    await adapter.append({
      parentId: null,
      message: {
        ...agentMessageToThreadMessage(userMessage),
        id: earlyUserId,
      },
    });

    await expect(write).resolves.toBe(taskId);
  });

  it("restores a terminal user row with its durable partial text and continuation metadata", async () => {
    const partialText = "先完成标题层级，再继续处理字距与留白。";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/agent/tasks/${taskId}/messages`) {
        return new Response(JSON.stringify({
          taskId,
          messages: [{ ...userMessage, turnId: null, runId: null, attachment: null }],
          pendingRun: { userMessageId: userId, runId, status: "FAILED" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === `/api/agent/runs/${runId}`) {
        return new Response(JSON.stringify({ run: { id: runId, status: "FAILED" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === `/api/agent/runs/${runId}/events?after=0&limit=200`) {
        return new Response(JSON.stringify({
          runId,
          events: [{
            id: "99999999-9999-4999-8999-999999999995",
            runId,
            sequence: 1,
            kind: "TOKEN",
            label: "组织回答",
            summary: "已收到新的回答片段。",
            payload: { text: partialText },
            createdAt: "2026-07-26T12:00:01.000Z",
          }],
          nextEventSequence: 2,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    const repository = await createLumiHistoryAdapter(taskId).load();
    expect(repository.messages).toHaveLength(2);
    expect(repository.messages[1]).toMatchObject({
      parentId: userId,
      message: {
        id: `${userId}#interrupted`,
        role: "assistant",
        status: { type: "incomplete", reason: "error" },
        metadata: { custom: { runId, interrupted: true } },
      },
    });
    const interruption = repository.messages[1]!.message;
    expect(interruption.content).toContainEqual({ type: "text", text: partialText });
    expect(interruption.content).toContainEqual({
      type: "data",
      name: "lumi-response",
      data: { incomplete: { reason: "MODEL_CONNECTION_INTERRUPTED" } },
    });
  });

  it("keeps pinned persistence and ignores retired engineering mode fields", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({
          id: taskId,
          title: "工程对话",
          status: "ACTIVE",
          mode: "engineering",
          pinned: true,
          createdAt: "2026-07-21T10:00:00.000Z",
          updatedAt: "2026-07-21T10:00:01.000Z",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ tasks: [{
        id: taskId,
        title: "工程对话",
        status: "ACTIVE",
        mode: "engineering",
        pinned: true,
        createdAt: "2026-07-21T10:00:00.000Z",
        updatedAt: "2026-07-21T10:00:01.000Z",
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new LumiThreadListAdapter();
    await expect(adapter.list()).resolves.toMatchObject({ threads: [{
      remoteId: taskId,
      custom: { pinned: true },
    }] });
    await adapter.updateCustom(taskId, { mode: "conversation", pinned: false });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      pinned: false,
    });
    await adapter.archive(taskId);
    await adapter.unarchive(taskId);
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toEqual({
      status: "ARCHIVED",
    });
    expect(JSON.parse(fetchMock.mock.calls[3]?.[1]?.body as string)).toEqual({
      status: "ACTIVE",
    });
  });

  it("waits for the backend-generated title before publishing the title stream", async () => {
    vi.useFakeTimers();
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      reads += 1;
      return new Response(JSON.stringify({
        id: taskId,
        title: reads === 1 ? "未命名设计任务" : "海报层级优化",
        status: "ACTIVE",
        mode: "conversation",
        pinned: false,
        createdAt: "2026-07-21T10:00:00.000Z",
        updatedAt: "2026-07-21T10:00:01.000Z",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const pending = new LumiThreadListAdapter().generateTitle(taskId);
    await vi.advanceTimersByTimeAsync(250);
    const stream = await pending as ReadableStream<unknown>;
    const reader = stream.getReader();
    const events: unknown[] = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      events.push(next.value);
    }

    expect(reads).toBe(2);
    expect(events).toContainEqual({
      type: "text-delta",
      path: [0],
      textDelta: "海报层级优化",
    });
  });
});

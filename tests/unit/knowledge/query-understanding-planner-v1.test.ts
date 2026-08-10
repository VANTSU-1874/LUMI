import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {
  CompletionOptions,
  ModelMessage,
  ModelUsage,
  ModelVisionImage,
} from "@/lib/ai/client";
import { ModelServiceError } from "@/lib/ai/client";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import {
  type QueryUnderstandingInputV1,
} from "@/lib/knowledge/answer-obligation-v1";
import {
  QUERY_UNDERSTANDING_PLANNER_VERSION_V2,
  QUERY_UNDERSTANDING_STRUCTURED_OUTPUT_NAME_V1,
  QUERY_UNDERSTANDING_STRUCTURED_OUTPUT_SCHEMA_HASH_V1,
  QUERY_UNDERSTANDING_SYSTEM_PROMPT_V1,
  createQueryUnderstandingPlannerV1,
} from "@/lib/knowledge/query-understanding-planner-v1";
import { compileRetrievalPlanV1 } from "@/lib/knowledge/retrieval-plan-v1";

type FakeReply = {
  value: string | Error;
  usage?: ModelUsage;
};

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function makeRequest(input: {
  message?: string;
  courseId?: QueryUnderstandingInputV1["coursePack"]["id"];
  recentMessage?: string;
  artworkHash?: string | null;
} = {}): QueryUnderstandingInputV1 {
  const message = input.message
    ?? "声音有数值，画面为什么不动？我应该先查哪里？";
  const recentTurns = input.recentMessage
    ? [{
        source: "RECENT_TURN_1" as const,
        message: input.recentMessage,
        messageHash: sha256(input.recentMessage),
      }]
    : [];
  return {
    schemaVersion: 1,
    currentMessage: {
      source: "CURRENT_MESSAGE",
      message,
      messageHash: sha256(message),
    },
    recentTurns,
    coursePack: {
      id: input.courseId ?? "digital-interaction",
      version: "1",
      label: input.courseId === "book-design"
        ? "书籍设计"
        : "数字交互文创设计",
      summary: input.courseId === "book-design"
        ? "面向书籍结构与阅读体验的课程包。"
        : "面向交互视觉与 TouchDesigner 项目的课程包。",
    },
    view: {
      id: "student-conversation",
      focus: "mentor",
    },
    hasArtwork: input.artworkHash !== undefined
      && input.artworkHash !== null,
    artworkHash: input.artworkHash ?? null,
  };
}

function readyPayload(
  request: QueryUnderstandingInputV1,
  input: {
    confidence?: number;
    artworkHint?: boolean;
  } = {},
) {
  const message = request.currentMessage.message;
  return {
    status: "READY",
    obligations: [{
      learnerNeed: "找出画面不动的原因，并明确第一步检查位置",
      intent: "DIAGNOSE_CAUSE",
      sourceAnchors: [{
        source: "CURRENT_MESSAGE",
        sourceMessageHash: request.currentMessage.messageHash,
        quote: message,
        startCodePoint: 0,
        endCodePoint: Array.from(message).length,
      }],
      entityMentions: [{
        surface: "画面",
        normalized: "画面",
        anchorIndexes: [0],
      }],
      constraints: [{
        text: "声音已经有数值",
        anchorIndexes: [0],
      }],
      evidenceNeeds: ["DIRECT_TEXT"],
      retrievalQueries: [{
        text: "TouchDesigner 声音有数值但画面不动 排查",
        purpose: "DIRECT",
      }],
      confidence: input.confidence ?? 0.93,
    }],
    clarifyingQuestion: null,
    artworkObservationHints: input.artworkHint
      ? [{
          artworkHash: request.artworkHash,
          visibleCue: "画面右侧节点已有数值，但预览区域没有可见变化",
          confidence: 0.86,
        }]
      : [],
  };
}

function clarifyPayload(request: QueryUnderstandingInputV1) {
  const payload = readyPayload(request, { confidence: 0.42 });
  return {
    ...payload,
    status: "CLARIFY",
    clarifyingQuestion:
      "你说的“画面不动”是预览完全黑屏，还是数值不再变化？",
  };
}

function fakeAdapter(
  replies: FakeReply[],
  input: {
    vision?: boolean;
    modelId?: string;
  } = {},
) {
  const queue = [...replies];
  const invoke = async (
    _messages: ModelMessage[],
    options?: CompletionOptions,
  ) => {
    const reply = queue.shift();
    if (!reply) throw new Error("unexpected model call");
    if (reply.usage) options?.onUsage?.(reply.usage);
    if (reply.value instanceof Error) throw reply.value;
    return reply.value;
  };
  const complete = vi.fn(invoke);
  const completeWithImage = vi.fn(
    async (
      messages: ModelMessage[],
      _image: ModelVisionImage,
      options?: CompletionOptions,
    ) => invoke(messages, options),
  );
  const adapter: ModelProviderAdapter = {
    provider: "TEST",
    modelId: input.modelId ?? "gpt-5.6-test",
    capabilities: { vision: input.vision ?? false },
    complete,
    completeWithImage: input.vision
      ? completeWithImage
      : undefined,
  };
  return { adapter, complete, completeWithImage };
}

function plannerFor(
  adapter: ModelProviderAdapter,
  input: {
    plannerVersion?: string;
    totalTimeoutMs?: number;
    onProviderFailure?: (event: {
      attempt: "first" | "repair";
      error: unknown;
    }) => void;
  } = {},
) {
  return createQueryUnderstandingPlannerV1({
    model: adapter,
    plannerVersion: input.plannerVersion ?? "1.0.0",
    totalTimeoutMs: input.totalTimeoutMs ?? 5_000,
    onProviderFailure: input.onProviderFailure,
  });
}

describe("query understanding planner v1", () => {
  it("accepts valid first output with one call and keeps raw content private", async () => {
    const request = makeRequest();
    const rawModelOutput = JSON.stringify(readyPayload(request));
    const { adapter, complete } = fakeAdapter([{
      value: rawModelOutput,
      usage: {
        inputTokens: 120,
        outputTokens: 80,
        totalTokens: 200,
      },
    }]);

    const result = await plannerFor(adapter).plan(request);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.obligationSet.status).toBe("READY");
    expect(result.audit).toMatchObject({
      firstAttempt: "VALID",
      repairAttempt: "NOT_USED",
      callCount: 1,
      failureCategory: null,
      usage: {
        first: {
          inputTokens: 120,
          outputTokens: 80,
          totalTokens: 200,
        },
        repair: null,
        total: {
          inputTokens: 120,
          outputTokens: 80,
          totalTokens: 200,
        },
      },
    });
    expect(result.publicTrace).toMatchObject({
      status: "READY",
      firstAttempt: "VALID",
      repairAttempt: "NOT_USED",
      callCount: 1,
    });
    expect(JSON.stringify(result.publicTrace))
      .not.toContain(rawModelOutput);
    const messages = complete.mock.calls[0]?.[0];
    expect(messages?.[0]?.content).toContain("回答义务");
    expect(messages?.[1]?.content).not.toContain("qrels");
    expect(messages?.[1]?.content).not.toContain("candidate");
    const requestProjection = JSON.parse(
      String(messages?.[1]?.content),
    );
    expect(requestProjection.sourceAnchorCatalog)
      .toEqual([{
        source: "CURRENT_MESSAGE",
        sourceMessageHash:
          request.currentMessage.messageHash,
        quote: request.currentMessage.message,
        startCodePoint: 0,
        endCodePoint: Array.from(
          request.currentMessage.message,
        ).length,
      }]);
    const options = complete.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      reasoningEffort: "none",
      structuredOutput: {
        name: QUERY_UNDERSTANDING_STRUCTURED_OUTPUT_NAME_V1,
      },
    });
    expect(options?.structuredOutput?.schema)
      .toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    expect(QUERY_UNDERSTANDING_STRUCTURED_OUTPUT_SCHEMA_HASH_V1)
      .toMatch(/^[0-9a-f]{64}$/);
    expect(QUERY_UNDERSTANDING_SYSTEM_PROMPT_V1)
      .not.toContain("\"startCodePoint\":\"inclusive integer\"");
    expect(QUERY_UNDERSTANDING_SYSTEM_PROMPT_V1)
      .toContain("不得把数值或索引写成字符串");
  });

  it("searches stable numbered references inside the active course pack before asking the learner to upload source text", async () => {
    const request = makeRequest({
      message: "接收节点里还要分哪两项看？",
    });
    const { adapter, complete } = fakeAdapter([{
      value: JSON.stringify(readyPayload(request)),
    }]);

    await plannerFor(adapter).plan(request);

    expect(QUERY_UNDERSTANDING_PLANNER_VERSION_V2)
      .toBe("1.4.0");
    expect(complete.mock.calls[0]?.[0]?.[0]?.content)
      .toContain("active coursePack");
    expect(complete.mock.calls[0]?.[0]?.[0]?.content)
      .toContain("不能仅因学生没有重复软件、媒介或课程名称就要求澄清");
    expect(complete.mock.calls[0]?.[0]?.[0]?.content)
      .toContain("章节号、任务编号或步骤号");
    expect(complete.mock.calls[0]?.[0]?.[0]?.content)
      .toContain("不得要求学生上传课程包中本应可检索的原文");
    expect(complete.mock.calls[0]?.[0]?.[0]?.content)
      .toContain("已能形成唯一高置信义务和检索 query");
    const projection = JSON.parse(String(
      complete.mock.calls[0]?.[0]?.[1]?.content,
    ));
    expect(projection.coursePack).toEqual(
      request.coursePack,
    );
  });

  it("uses exactly one bounded repair and reports usage by attempt", async () => {
    const request = makeRequest();
    const invalid = `not-json sk-secret-${"x".repeat(40)}`;
    const repaired = JSON.stringify(readyPayload(request));
    const { adapter, complete } = fakeAdapter([
      {
        value: invalid,
        usage: {
          inputTokens: 30,
          outputTokens: 10,
          totalTokens: 40,
        },
      },
      {
        value: repaired,
        usage: {
          inputTokens: 50,
          outputTokens: 20,
          totalTokens: 70,
        },
      },
    ]);

    const result = await plannerFor(adapter).plan(request);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.obligationSet.status).toBe("READY");
    expect(result.audit).toMatchObject({
      firstAttempt: "INVALID",
      repairAttempt: "VALID",
      callCount: 2,
      failureCategory: null,
      usage: {
        first: {
          inputTokens: 30,
          outputTokens: 10,
          totalTokens: 40,
        },
        repair: {
          inputTokens: 50,
          outputTokens: 20,
          totalTokens: 70,
        },
        total: {
          inputTokens: 80,
          outputTokens: 30,
          totalTokens: 110,
        },
      },
    });
    const repairMessages = complete.mock.calls[1]?.[0];
    expect(repairMessages?.[1]?.content)
      .toContain("STRUCTURED_OUTPUT_INVALID");
    expect(repairMessages?.[1]?.content).toContain("not-json");
    expect(repairMessages?.[1]?.content).not.toContain("qrels");
    expect(JSON.stringify(result.publicTrace)).not.toContain(invalid);
    expect(JSON.stringify(result.publicTrace))
      .not.toContain("sk-secret");
    expect(complete.mock.calls[1]?.[1]).toMatchObject({
      reasoningEffort: "none",
      structuredOutput: {
        name: QUERY_UNDERSTANDING_STRUCTURED_OUTPUT_NAME_V1,
        schema: complete.mock.calls[0]?.[1]
          ?.structuredOutput?.schema,
      },
    });
  });

  it("degrades locally after two invalid outputs and keeps only whole-query retrieval", async () => {
    const request = makeRequest();
    const { adapter, complete } = fakeAdapter([
      { value: "not-json" },
      { value: "{}" },
      { value: JSON.stringify(readyPayload(request)) },
    ]);

    const result = await plannerFor(adapter).plan(request);
    const compiled = compileRetrievalPlanV1(
      result.obligationSet,
    );

    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.obligationSet.status).toBe("DEGRADED");
    expect(result.audit).toMatchObject({
      firstAttempt: "INVALID",
      repairAttempt: "INVALID",
      callCount: 2,
      failureCategory: "STRUCTURED_OUTPUT_INVALID",
    });
    expect(compiled.plan.directEvidenceQueries).toEqual([]);
    expect(compiled.physicalQueries).toHaveLength(1);
    expect(compiled.physicalQueries[0]).toMatchObject({
      source: "WHOLE_QUERY",
      normalizedText: result.obligationSet.normalizedQuestion,
    });
  });

  it("degrades without a repair call on provider failure", async () => {
    const request = makeRequest();
    const providerError = new ModelServiceError(
      "PROVIDER_STATUS",
      null,
      503,
    );
    const onProviderFailure = vi.fn();
    const { adapter, complete } = fakeAdapter([
      { value: providerError },
      { value: JSON.stringify(readyPayload(request)) },
    ]);

    const result = await plannerFor(adapter, {
      onProviderFailure,
    }).plan(request);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(onProviderFailure).toHaveBeenCalledWith({
      attempt: "first",
      error: providerError,
    });
    expect(result.obligationSet.status).toBe("DEGRADED");
    expect(result.audit).toMatchObject({
      firstAttempt: "PROVIDER_ERROR",
      repairAttempt: "NOT_USED",
      callCount: 1,
      failureCategory: "PROVIDER_ERROR",
    });
    expect(JSON.stringify(result.publicTrace))
      .not.toContain("503");
  });

  it("ignores diagnostic observer failures and preserves the planner outcome", async () => {
    const request = makeRequest();
    const providerError = new ModelServiceError("RATE_LIMIT");
    const { adapter } = fakeAdapter([{
      value: providerError,
    }]);

    const result = await plannerFor(adapter, {
      onProviderFailure: () => {
        throw new Error("diagnostic sink unavailable");
      },
    }).plan(request);

    expect(result.obligationSet.status).toBe("DEGRADED");
    expect(result.audit.failureCategory).toBe("PROVIDER_ERROR");
  });

  it("enforces the total timeout even when a provider ignores abort", async () => {
    const complete = vi.fn(
      async () => new Promise<string>(() => undefined),
    );
    const adapter: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "gpt-5.6-timeout",
      capabilities: { vision: false },
      complete,
    };

    const result = await plannerFor(adapter, {
      totalTimeoutMs: 15,
    }).plan(makeRequest());

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.obligationSet.status).toBe("DEGRADED");
    expect(result.audit).toMatchObject({
      firstAttempt: "TIMEOUT",
      repairAttempt: "NOT_USED",
      callCount: 1,
      failureCategory: "TIMEOUT",
    });
  });

  it("returns CLARIFY for a materially ambiguous low-confidence reading", async () => {
    const request = makeRequest();
    const { adapter } = fakeAdapter([{
      value: JSON.stringify(clarifyPayload(request)),
    }]);

    const result = await plannerFor(adapter).plan(request);

    expect(result.obligationSet.status).toBe("CLARIFY");
    expect(result.obligationSet.clarifyingQuestion)
      .toContain("画面不动");
    const compiled = compileRetrievalPlanV1(
      result.obligationSet,
    );
    expect(compiled.plan.directEvidenceQueries).toEqual([]);
    expect(compiled.physicalQueries).toHaveLength(1);
    expect(compiled.physicalQueries[0]?.source)
      .toBe("WHOLE_QUERY");
  });

  it("passes a hash-bound image only through a vision-capable adapter", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const artworkHash = sha256(bytes);
    const request = makeRequest({ artworkHash });
    const { adapter, complete, completeWithImage } =
      fakeAdapter([{
        value: JSON.stringify(
          readyPayload(request, { artworkHint: true }),
        ),
      }], { vision: true });

    const result = await plannerFor(adapter).plan(request, {
      artwork: { mimeType: "image/png", bytes },
    });

    expect(complete).not.toHaveBeenCalled();
    expect(completeWithImage).toHaveBeenCalledTimes(1);
    expect(completeWithImage.mock.calls[0]?.[1]).toEqual({
      mimeType: "image/png",
      bytes,
    });
    expect(result.obligationSet.artworkObservationHints)
      .toHaveLength(1);
  });

  it("continues text planning without fabricated artwork hints when vision is unavailable", async () => {
    const bytes = new Uint8Array([6, 7, 8]);
    const request = makeRequest({ artworkHash: sha256(bytes) });
    const { adapter, complete, completeWithImage } =
      fakeAdapter([{
        value: JSON.stringify(readyPayload(request)),
      }], { vision: false });

    const result = await plannerFor(adapter).plan(request, {
      artwork: { mimeType: "image/png", bytes },
    });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(completeWithImage).not.toHaveBeenCalled();
    expect(result.obligationSet.status).toBe("READY");
    expect(result.obligationSet.artworkObservationHints)
      .toEqual([]);
  });

  it("rejects non-vision artwork claims once, then repairs to text-only planning", async () => {
    const bytes = new Uint8Array([9, 10, 11]);
    const request = makeRequest({ artworkHash: sha256(bytes) });
    const { adapter, complete } = fakeAdapter([
      {
        value: JSON.stringify(
          readyPayload(request, { artworkHint: true }),
        ),
      },
      {
        value: JSON.stringify(readyPayload(request)),
      },
    ]);

    const result = await plannerFor(adapter).plan(request, {
      artwork: { mimeType: "image/png", bytes },
    });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.obligationSet.status).toBe("READY");
    expect(result.obligationSet.artworkObservationHints)
      .toEqual([]);
    expect(result.audit).toMatchObject({
      firstAttempt: "INVALID",
      repairAttempt: "VALID",
    });
    expect(complete.mock.calls[1]?.[0]?.[1]?.content)
      .toContain("ARTWORK_HINT_WITHOUT_VISION");
  });

  it("binds cache identity to question, context, course, prompt/config, model, and artwork", async () => {
    const base = makeRequest();
    const variants = [
      base,
      makeRequest({ message: "画面黑了，我先看哪个节点？" }),
      makeRequest({ recentMessage: "我刚刚已经检查过声音输入。" }),
      makeRequest({ courseId: "book-design" }),
    ];
    const baseResults: string[] = [];
    for (const request of variants) {
      const { adapter } = fakeAdapter([{
        value: JSON.stringify(readyPayload(request)),
      }]);
      const result = await plannerFor(adapter).plan(request);
      baseResults.push(result.publicTrace.cacheKey);
    }
    const modelAdapter = fakeAdapter([{
      value: JSON.stringify(readyPayload(base)),
    }], { modelId: "gpt-5.6-other-pool" }).adapter;
    const otherModel = await plannerFor(modelAdapter)
      .plan(base);
    const otherVersionAdapter = fakeAdapter([{
      value: JSON.stringify(readyPayload(base)),
    }]).adapter;
    const otherVersion = await plannerFor(otherVersionAdapter, {
      plannerVersion: "1.0.1",
    }).plan(base);
    const bytes = new Uint8Array([12, 13, 14]);
    const artworkRequest = makeRequest({
      artworkHash: sha256(bytes),
    });
    const artworkAdapter = fakeAdapter([{
      value: JSON.stringify(readyPayload(artworkRequest)),
    }]).adapter;
    const withArtwork = await plannerFor(artworkAdapter)
      .plan(artworkRequest, {
        artwork: { mimeType: "image/png", bytes },
      });

    const keys = [
      ...baseResults,
      otherModel.publicTrace.cacheKey,
      otherVersion.publicTrace.cacheKey,
      withArtwork.publicTrace.cacheKey,
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(otherVersion.publicTrace).toMatchObject({
      promptHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      configHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      cacheKey: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("fails before the provider when artwork bytes do not match the declared hash", async () => {
    const request = makeRequest({
      artworkHash: sha256(new Uint8Array([1, 1, 1])),
    });
    const { adapter, completeWithImage } = fakeAdapter([{
      value: JSON.stringify(readyPayload(request)),
    }], { vision: true });

    await expect(plannerFor(adapter).plan(request, {
      artwork: {
        mimeType: "image/png",
        bytes: new Uint8Array([2, 2, 2]),
      },
    })).rejects.toThrow(
      "QUERY_UNDERSTANDING_ARTWORK_HASH_MISMATCH",
    );
    expect(completeWithImage).not.toHaveBeenCalled();
  });
});

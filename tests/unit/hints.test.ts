import { describe, expect, it, vi } from "vitest";

import type { ModelClient } from "@/lib/ai/client";
import { buildHintMessages } from "@/lib/ai/prompts";
import type { KnowledgeItem, KnowledgeTopic } from "@/lib/knowledge/retrieve";
import {
  HintRequestSchema,
  ModelHintDecisionSchema,
  allowedHintLevel,
  createGroundedHintService,
  createHintPolicyContext,
} from "@/lib/services/hints";

const hintCreatedAt = "2026-07-12T07:00:00.000Z";
const createdAt = "2026-07-12T08:00:00.000Z";
const oldDigest = "a".repeat(64);
const newDigest = "b".repeat(64);
const oldEvidenceId = "00000000-0000-4000-8000-000000000010";
const newEvidenceId = "00000000-0000-4000-8000-000000000011";

const topicItems = {
  DESIGN_FOUNDATIONS: {
    id: "design",
    title: "文字与背景的最低对比度检查",
    topic: "DESIGN_FOUNDATIONS",
    tags: ["文字", "对比度", "设计"],
    content: "先明确设计目标，再测量文字与背景的对比度。",
    facts: [{ id: "design-text-contrast-normal", text: "普通文字与背景至少达到4.5比1。" }],
    actions: [
      { id: "design-clarify-goal", text: "先说明文字承担的任务。" },
      { id: "design-test-assumption", text: "测量文字与背景的对比度。" },
    ],
    source: {
      url: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
      authority: "OFFICIAL",
      verifiedDate: "2026-07-17",
      scope: "文字对比度",
    },
  },
  COURSE_PRINCIPLES: {
    id: "course",
    title: "触映课程原则（本地设计说明）",
    topic: "COURSE_PRINCIPLES",
    tags: ["文化意图", "六要素", "课程"],
    content: "课程先写文化意图，再完成六要素交互逻辑。",
    facts: [{ id: "course-six-elements", text: "课程使用六要素组织交互逻辑。" }],
    actions: [{ id: "course-clarify-intent", text: "先用一句话写清文化意图。" }],
    source: {
      localDocument: "docs/course.md",
      authority: "COURSE_DESIGN",
      verifiedDate: "2026-07-12",
      scope: "课程六要素与文化意图",
    },
  },
  DIGISHOW_SIGNALS: {
    id: "digishow",
    title: "Learning DigiShow（官方教程目录）",
    topic: "DIGISHOW_SIGNALS",
    tags: ["DigiShow", "模拟信号", "映射"],
    content: "DigiShow区分信号类型并进行数值映射。",
    facts: [{ id: "digishow-signal-types", text: "DigiShow教程区分三类基础信号。" }],
    actions: [{ id: "digishow-identify-signal", text: "先确认输入属于哪类信号。" }],
    source: {
      url: "https://digishow.cc/",
      authority: "OFFICIAL",
      verifiedDate: "2026-07-12",
      scope: "DigiShow信号类型与映射",
    },
  },
  TOUCHDESIGNER_FOUNDATIONS: {
    id: "touchdesigner",
    title: "Getting started（Derivative官方文档）",
    topic: "TOUCHDESIGNER_FOUNDATIONS",
    tags: ["TouchDesigner", "输入", "处理", "输出", "节点"],
    content: "TouchDesigner通过operator网络处理输入并生成输出。",
    facts: [{ id: "td-operator-flow", text: "operator连接形成可观察的数据流。" }],
    actions: [
      { id: "td-observe-upstream", text: "先观察最上游输入节点。" },
      { id: "td-minimal-check", text: "先验证一个输入到一个输出。" },
    ],
    source: {
      url: "https://docs.derivative.ca/Getting_started",
      authority: "OFFICIAL",
      verifiedDate: "2026-07-12",
      scope: "TouchDesigner operator网络基础",
    },
  },
  OSC_TROUBLESHOOTING: {
    id: "osc",
    title: "OSC In CHOP（Derivative官方文档）",
    topic: "OSC_TROUBLESHOOTING",
    tags: ["OSC", "地址", "端口", "收不到"],
    content: "OSC In CHOP通过监听端口接收消息。",
    facts: [{ id: "osc-listening-port", text: "OSC In CHOP需要设置接收端监听端口。" }],
    actions: [
      { id: "osc-check-receiver", text: "确认接收端Active状态和可见通道。" },
      { id: "osc-compare-ports", text: "核对发送目标和接收监听端口。" },
    ],
    source: {
      url: "https://docs.derivative.ca/OSC_In_CHOP",
      authority: "OFFICIAL",
      verifiedDate: "2026-07-12",
      scope: "TouchDesigner OSC接收检查",
    },
  },
} satisfies Partial<Record<KnowledgeTopic, KnowledgeItem>>;

const allKnowledge = Object.values(topicItems);
const request = {
  question: "OSC地址端口收不到，下一步查什么？",
  confirmedFacts: ["发送端数值正在变化"],
  hypotheses: ["可能是端口不一致"],
  evidence: [{ kind: "MEASUREMENT" as const, description: "发送端数值正在变化" }],
};

function policy(
  previousCount: number,
  overrides: Partial<{
    currentEvidenceRecords: Array<{
      evidenceRecordId: string;
      evidenceSequence: number;
      contentDigest: string;
      createdAt: string;
    }>;
    latestWatermark: number;
    priorUsedEvidenceRecordIds: string[];
    priorUsedEvidenceDigests: string[];
  }> = {},
) {
  return createHintPolicyContext({
    previousHintRecords: Array.from({ length: previousCount }, (_, index) => ({
      recordId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      hintSequence: index + 1,
      evidenceSequenceWatermark: overrides.latestWatermark ?? 0,
      createdAt: hintCreatedAt,
    })),
    currentEvidenceRecords: overrides.currentEvidenceRecords ?? [],
    priorUsedEvidenceRecordIds: overrides.priorUsedEvidenceRecordIds ?? [],
    priorUsedEvidenceDigests: overrides.priorUsedEvidenceDigests ?? [],
  });
}

function validDecision(overrides: Record<string, unknown> = {}) {
  return {
    hintLevel: 2,
    focusCode: "OSC_ADDRESS_PORT",
    actionCode: "OSC_COMPARE_PORTS",
    hypothesisCode: "OSC_PORT_MISMATCH",
    sourceItemIds: ["osc"],
    factIds: ["osc-listening-port"],
    ...overrides,
  };
}

describe("persistent hint gate", () => {
  it("derives levels only from server-branded persisted records", () => {
    expect(allowedHintLevel(policy(0))).toBe(1);
    expect(allowedHintLevel(policy(1))).toBe(2);
    expect(
      allowedHintLevel(
        policy(2, {
          currentEvidenceRecords: [
            { evidenceRecordId: newEvidenceId, evidenceSequence: 1, contentDigest: newDigest, createdAt },
          ],
        }),
      ),
    ).toBe(3);
  });

  it("requires both a new persisted evidence ID and digest", () => {
    const prior = {
      priorUsedEvidenceRecordIds: [oldEvidenceId],
      priorUsedEvidenceDigests: [oldDigest],
    };
    expect(
      allowedHintLevel(
        policy(2, {
          ...prior,
          currentEvidenceRecords: [
            { evidenceRecordId: newEvidenceId, evidenceSequence: 1, contentDigest: oldDigest, createdAt },
          ],
        }),
      ),
    ).toBe(2);
    expect(
      allowedHintLevel(
        policy(2, {
          ...prior,
          currentEvidenceRecords: [
            { evidenceRecordId: oldEvidenceId, evidenceSequence: 1, contentDigest: newDigest, createdAt },
          ],
        }),
      ),
    ).toBe(2);
  });

  it.each([1, 2])("does not upgrade for evidence sequence %s at or below watermark", (evidenceSequence) => {
    expect(
      allowedHintLevel(
        policy(2, {
          currentEvidenceRecords: [
            {
              evidenceRecordId: newEvidenceId,
              evidenceSequence,
              contentDigest: newDigest,
              createdAt,
            },
          ],
          latestWatermark: 2,
        }),
      ),
    ).toBe(2);
  });

  it("uses monotonic sequences even when timestamps and UUIDs are unordered", () => {
    const makePolicy = (evidenceSequence: number) =>
      createHintPolicyContext({
        previousHintRecords: [
          {
            recordId: "00000000-0000-4000-8000-000000000001",
            hintSequence: 1,
            evidenceSequenceWatermark: 1,
            createdAt: "2026-07-10T08:00:00.000Z",
          },
          {
            recordId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            hintSequence: 3,
            evidenceSequenceWatermark: 5,
            createdAt: "2026-07-12T08:00:00.000Z",
          },
          {
            recordId: "00000000-0000-4000-8000-000000000002",
            hintSequence: 2,
            evidenceSequenceWatermark: 3,
            createdAt: "2026-07-11T08:00:00.000Z",
          },
        ],
        currentEvidenceRecords: [
          { evidenceRecordId: newEvidenceId, evidenceSequence, contentDigest: newDigest, createdAt: hintCreatedAt },
        ],
        priorUsedEvidenceRecordIds: [],
        priorUsedEvidenceDigests: [],
      });
    expect(allowedHintLevel(makePolicy(5))).toBe(2);
    expect(allowedHintLevel(makePolicy(6))).toBe(3);
  });

  it("rejects timestamps unreasonably far in the future", () => {
    expect(() =>
      createHintPolicyContext({
        previousHintRecords: [
          {
            recordId: "00000000-0000-4000-8000-000000000001",
            hintSequence: 1,
            evidenceSequenceWatermark: 0,
            createdAt: "2099-01-01T00:00:00.000Z",
          },
        ],
        currentEvidenceRecords: [],
        priorUsedEvidenceRecordIds: [],
        priorUsedEvidenceDigests: [],
      }),
    ).toThrow("future");
  });

  it("rejects client-selected levels, policy fields, and unbranded JSON policy", async () => {
    expect(() => HintRequestSchema.parse({ ...request, requestedHintLevel: 3 })).toThrow();
    expect(() => HintRequestSchema.parse({ ...request, previousHintRecords: [] })).toThrow();
    const forged = {
      previousHintRecords: [],
      currentEvidenceRecords: [],
      priorUsedEvidenceRecordIds: [],
      priorUsedEvidenceDigests: [],
    };
    expect(() => allowedHintLevel(forged)).toThrow("服务端提示策略上下文");
    await expect(
      createGroundedHintService({ knowledge: allKnowledge }).generate(request, forged),
    ).rejects.toThrow("服务端提示策略上下文");
  });

  it("rejects duplicate persistent IDs and digests", () => {
    expect(() =>
      createHintPolicyContext({
        previousHintRecords: [],
        currentEvidenceRecords: [
          { evidenceRecordId: oldEvidenceId, evidenceSequence: 1, contentDigest: oldDigest, createdAt },
          { evidenceRecordId: newEvidenceId, evidenceSequence: 2, contentDigest: oldDigest, createdAt },
        ],
        priorUsedEvidenceRecordIds: [],
        priorUsedEvidenceDigests: [],
      }),
    ).toThrow();
  });
});

describe("controlled model decision contract", () => {
  it("is strict and contains no free-text response fields", () => {
    expect(ModelHintDecisionSchema.parse(validDecision())).toEqual(validDecision());
    expect(() =>
      ModelHintDecisionSchema.parse({
        ...validDecision(),
        analysis: "I analyzed the uploaded image and found the entire node network.",
      }),
    ).toThrow();
  });

  it("prompts only for whitelisted decision codes and source/fact IDs", () => {
    const messages = buildHintMessages({
      request,
      hintLevel: 2,
      knowledge: [topicItems.OSC_TROUBLESHOOTING],
    });
    const prompt = messages.map(({ content }) => content).join("\n");
    expect(prompt).toContain("focusCode");
    expect(prompt).toContain("OSC_ADDRESS_PORT");
    expect(prompt).toContain("osc-listening-port");
    expect(prompt).toContain("OFFICIAL");
    expect(prompt).not.toContain("confirmedFacts");
    expect(prompt).not.toContain("guidance");
  });

  it("supports the design-foundation topic without borrowing a specialty code", () => {
    const messages = buildHintMessages({
      request: { ...request, question: "海报文字和背景对比度怎么检查？" },
      hintLevel: 2,
      knowledge: [topicItems.DESIGN_FOUNDATIONS],
    });
    const prompt = messages.map(({ content }) => content).join("\n");
    expect(prompt).toContain("DESIGN_GOAL");
    expect(prompt).toContain("DESIGN_TEST_ASSUMPTION");
    expect(prompt).not.toContain("BOOK_GRID");
  });

  it("redacts normalized personal identifiers before constructing model messages", () => {
    vi.stubEnv("STUDENT_NUMBER_PREFIX", "ABC");
    vi.stubEnv("STUDENT_NUMBER_DIGITS", "4");
    const messages = buildHintMessages({
      request: { ...request, question: "请联系 +86-138 1234-5678、ABC1234 或 Student@Example.com 检查OSC" },
      hintLevel: 2,
      knowledge: [topicItems.OSC_TROUBLESHOOTING],
    });
    const prompt = messages.map(({ content }) => content).join("\n");
    expect(prompt).toContain("检查OSC");
    expect(prompt).not.toContain("138 1234-5678");
    expect(prompt).not.toContain("ABC1234");
    expect(prompt.toLowerCase()).not.toContain("student@example.com");
    vi.unstubAllEnvs();
  });

  it("keeps non-sensitive Unicode and combining-mark identifiers intact at the model boundary", () => {
    vi.stubEnv("STUDENT_NUMBER_PREFIX", "ABC");
    vi.stubEnv("STUDENT_NUMBER_DIGITS", "4");
    const messages = buildHintMessages({
      request: {
        ...request,
        question: "阶段①：电话：＋８６ １３８－１２３４－５６７８；型号ABC1234\u0301；学号：ABC1234。",
      },
      hintLevel: 2,
      knowledge: [topicItems.OSC_TROUBLESHOOTING],
    });
    const prompt = messages.map(({ content }) => content).join("\n");
    expect(prompt).toContain("阶段①");
    expect(prompt).toContain("型号ABC1234\u0301");
    expect(prompt).toContain("学号：[已遮蔽学号]");
    expect(prompt).not.toMatch(/ABC1234(?!\u0301)/u);
    expect(prompt).not.toContain("１３８－１２３４－５６７８");
    vi.unstubAllEnvs();
  });

  it("renders a valid decision with templates, never model prose", async () => {
    const client: ModelClient = {
      complete: vi.fn(async () => JSON.stringify(validDecision())),
    };
    const service = createGroundedHintService({ knowledge: allKnowledge, client });

    const result = await service.generate(request, policy(1));

    expect(result).toMatchObject({
      hintLevel: 2,
      groundingStatus: "GROUNDED",
      fallback: false,
      sourceTitles: ["OSC In CHOP（Derivative官方文档）"],
      sources: [
        { title: "OSC In CHOP（Derivative官方文档）", authority: "OFFICIAL" },
      ],
      confirmedFacts: ["官方资料：OSC In CHOP需要设置接收端监听端口。"],
      localExample: null,
      evidenceToConsume: null,
    });
    expect(result.guidance.join(" ")).toContain("发送端");
    expect(result.nextSteps.join(" ")).toContain("端口");
    expect(JSON.stringify(result)).not.toContain("OSC_ADDRESS_PORT");
  });

  it.each([
    "I analyzed the uploaded diagram and found the whole graph.",
    JSON.stringify({
      ...validDecision(),
      analysis: "I viewed every node and parameter; this is hand-in ready.",
    }),
    JSON.stringify({
      ...validDecision(),
      actionCode: "ENTIRE_NODE_NETWORK_READY_FOR_SUBMISSION",
    }),
  ])("rejects or contains arbitrary malicious model prose: %s", async (raw) => {
    const client: ModelClient = { complete: vi.fn(async () => raw) };
    const service = createGroundedHintService({ knowledge: allKnowledge, client });

    const result = await service.generate(request, policy(1));

    expect(result.fallback).toBe(true);
    expect(JSON.stringify(result)).not.toContain("analyzed");
    expect(JSON.stringify(result)).not.toContain("reviewed");
    expect(JSON.stringify(result)).not.toContain("viewed");
    expect(JSON.stringify(result)).not.toContain("hand-in");
    expect(JSON.stringify(result)).not.toContain("ENTIRE_NODE_NETWORK");
  });

  it.each([
    validDecision({ sourceItemIds: ["digishow"] }),
    validDecision({ factIds: ["unknown-fact"] }),
    validDecision({ focusCode: "TD_SIGNAL_FLOW" }),
    validDecision({ hintLevel: 3 }),
  ])("falls back for an out-of-scope or escalated decision", async (decision) => {
    const client: ModelClient = { complete: vi.fn(async () => JSON.stringify(decision)) };
    const service = createGroundedHintService({ knowledge: allKnowledge, client });
    await expect(service.generate(request, policy(1))).resolves.toMatchObject({ fallback: true });
  });

  it("uses the controlled fallback when the provider throws", async () => {
    const client: ModelClient = {
      complete: vi.fn(async () => Promise.reject(new Error("private provider detail"))),
    };
    const service = createGroundedHintService({ knowledge: allKnowledge, client });
    const result = await service.generate(request, policy(1));
    expect(result.fallback).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private provider detail");
  });

  it("times out, aborts, and uses the controlled fallback", async () => {
    let signal: AbortSignal | undefined;
    const client: ModelClient = {
      complete: vi.fn(async (_messages, options) => {
        signal = options?.signal;
        return await new Promise<string>(() => undefined);
      }),
    };
    const service = createGroundedHintService({
      knowledge: allKnowledge,
      client,
      timeoutMs: 5,
    });
    const result = await service.generate(request, policy(1));
    expect(result.fallback).toBe(true);
    expect(signal?.aborted).toBe(true);
  });

  it("propagates an external cancellation to the model client", async () => {
    let signal: AbortSignal | undefined;
    const client: ModelClient = {
      complete: vi.fn(async (_messages, options) => {
        signal = options?.signal;
        return await new Promise<string>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
        });
      }),
    };
    const controller = new AbortController();
    const service = createGroundedHintService({ knowledge: allKnowledge, client });
    const pending = service.generate(request, policy(1), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("取消");
    expect(signal?.aborted).toBe(true);
  });
});

describe("topic-specific deterministic rendering", () => {
  it.each([
    {
      query: "文化意图怎么填写",
      source: "触映课程原则（本地设计说明）",
      fragment: "文化意图",
      forbidden: "OSC",
      authority: "COURSE_DESIGN",
    },
    {
      query: "DigiShow模拟信号怎么映射",
      source: "Learning DigiShow（官方教程目录）",
      fragment: "信号类型",
      forbidden: "OSC In CHOP",
      authority: "OFFICIAL",
    },
    {
      query: "TouchDesigner输入处理输出怎么验证",
      source: "Getting started（Derivative官方文档）",
      fragment: "输入",
      forbidden: "DigiShow",
      authority: "OFFICIAL",
    },
    {
      query: "OSC地址端口收不到",
      source: "OSC In CHOP（Derivative官方文档）",
      fragment: "端口",
      forbidden: "文化意图",
      authority: "OFFICIAL",
    },
  ])(
    "renders only the top topic for $query",
    async ({ query, source, fragment, forbidden, authority }) => {
    const service = createGroundedHintService({ knowledge: allKnowledge });
    const result = await service.generate(
      { question: query, confirmedFacts: [], hypotheses: [], evidence: [] },
      policy(1),
    );

    expect(result.sourceTitles).toEqual([source]);
    expect(result.sources).toEqual([{ title: source, authority }]);
    expect(result.guidance.join(" ")).toContain(fragment);
    expect(JSON.stringify(result)).not.toContain(forbidden);
    },
  );

  it("keeps level one to questions and level three to one bounded local example", async () => {
    const service = createGroundedHintService({ knowledge: allKnowledge });
    const levelOne = await service.generate(request, policy(0));
    const levelThree = await service.generate(
      request,
      policy(2, {
        currentEvidenceRecords: [
          { evidenceRecordId: newEvidenceId, evidenceSequence: 1, contentDigest: newDigest, createdAt },
        ],
      }),
    );
    expect(levelOne).toMatchObject({
      hintLevel: 1,
      guidance: [],
      nextSteps: [],
      localExample: null,
    });
    expect(levelOne.questions.length).toBeGreaterThan(0);
    expect(levelThree).toMatchObject({ hintLevel: 3 });
    expect(levelThree.localExample).toContain("局部示例");
    expect(levelThree.evidenceToConsume).toEqual({
      evidenceRecordId: newEvidenceId,
      evidenceSequence: 1,
      contentDigest: newDigest,
      createdAt,
    });
    expect(Array.isArray(levelThree.localExample)).toBe(false);
  });

  it("returns NO_GROUNDING and never calls the model for an unrelated query", async () => {
    const client: ModelClient = { complete: vi.fn(async () => JSON.stringify(validDecision())) };
    const service = createGroundedHintService({ knowledge: allKnowledge, client });
    const result = await service.generate(
      { question: "量子香蕉", confirmedFacts: [], hypotheses: [], evidence: [] },
      policy(2),
    );
    expect(result).toMatchObject({
      groundingStatus: "NO_GROUNDING",
      sourceTitles: [],
      sources: [],
      evidenceToConsume: null,
      fallback: true,
    });
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("uses only the top topic when a query matches several topics", async () => {
    const service = createGroundedHintService({ knowledge: allKnowledge });
    const result = await service.generate(
      {
        question: "DigiShow通过OSC连接TouchDesigner",
        confirmedFacts: [],
        hypotheses: [],
        evidence: [],
      },
      policy(1),
    );
    expect(result.sourceTitles).toHaveLength(1);
  });

  it("returns the same candidate on concurrent calls and leaves atomic consumption to Task 7", async () => {
    const service = createGroundedHintService({ knowledge: allKnowledge });
    const trustedPolicy = policy(2, {
      currentEvidenceRecords: [
        { evidenceRecordId: newEvidenceId, evidenceSequence: 1, contentDigest: newDigest, createdAt },
      ],
    });
    const [first, second] = await Promise.all([
      service.generate(request, trustedPolicy),
      service.generate(request, trustedPolicy),
    ]);
    expect(first.evidenceToConsume).toEqual(second.evidenceToConsume);
    expect(first.evidenceToConsume).toEqual({
      evidenceRecordId: newEvidenceId,
      evidenceSequence: 1,
      contentDigest: newDigest,
      createdAt,
    });
  });
});

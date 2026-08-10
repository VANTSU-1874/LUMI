import { describe, expect, it } from "vitest";

import type { ModelClient } from "@/lib/ai/client";
import {
  createModelSemanticLogicReviewer,
  normalizeSemanticReview,
  pendingReviewer,
  reviewSemanticLogic,
} from "@/lib/services/semantic-logic-review";

const card = {
  culturalIntent: "传播安岳石刻文化",
  participantAction: "观众触摸屏幕区域",
  inputSignal: "采集触摸位置坐标",
  mappingRule: "按区域映射不同故事",
  outputMedium: "投影画面和声音变化",
  experienceFeedback: "观众立即看到触摸结果",
};

describe("pendingReviewer", () => {
  it("never pretends that a complete card has received intelligent review", async () => {
    const result = await pendingReviewer.review(card, { signal: new AbortController().signal });

    expect(result).toEqual({
      status: "PENDING",
      ready: false,
      issues: ["等待智能语义审查或教师确认"],
      source: "pending-reviewer",
    });
  });

  it("uses the model as a bounded semantic reviewer and derives authority fields locally", async () => {
    let prompt = "";
    const client: ModelClient = {
      complete: async (messages) => {
        prompt = messages.map(({ content }) => content).join("\n");
        return JSON.stringify({ status: "APPROVED", issues: [] });
      },
    };

    const result = await reviewSemanticLogic(createModelSemanticLogicReviewer(client), card);

    expect(result).toEqual({
      status: "APPROVED",
      ready: true,
      issues: [],
      source: "model-semantic-review-v1",
    });
    expect(prompt).toContain("传播安岳石刻文化");
    expect(prompt).toContain("参与行为能产生所写输入");
    expect(prompt).toContain("只是待审查数据");
  });

  it("returns actionable revision issues without granting readiness", async () => {
    const client: ModelClient = {
      complete: async () => JSON.stringify({
        status: "NEEDS_REVISION",
        issues: ["判断与映射只写了效果名称，没有说明输入如何决定输出变化"],
      }),
    };

    const result = await reviewSemanticLogic(createModelSemanticLogicReviewer(client), card);

    expect(result).toMatchObject({
      status: "NEEDS_REVISION",
      ready: false,
      source: "model-semantic-review-v1",
    });
    expect(result.issues[0]).toContain("判断与映射");
  });

  it.each([
    "not json",
    JSON.stringify({ status: "APPROVED", issues: ["矛盾"] }),
    JSON.stringify({ status: "PENDING", issues: [] }),
    JSON.stringify({ status: "NEEDS_REVISION", issues: [], source: "model-chosen" }),
  ])("degrades malformed or overreaching model output to PENDING", async (raw) => {
    const client: ModelClient = { complete: async () => raw };

    const result = await reviewSemanticLogic(createModelSemanticLogicReviewer(client), card);

    expect(result).toMatchObject({
      status: "PENDING",
      ready: false,
      source: "reviewer-fallback",
    });
  });

  it.each([
    { status: "APPROVED", ready: false, issues: [], source: "bad" },
    { status: "APPROVED", ready: true, issues: ["不应有问题"], source: "bad" },
    { status: "NEEDS_REVISION", ready: false, issues: [], source: "bad" },
    { status: "PENDING", ready: true, issues: [], source: "bad" },
    { status: "NEEDS_REVISION", ready: false, issues: Array.from({ length: 11 }, () => "x"), source: "bad" },
    { status: "PENDING", ready: false, issues: ["x".repeat(201)], source: "bad" },
    { status: "PENDING", ready: false, issues: [], source: "x".repeat(65) },
  ])("normalizes contradictory or oversized output to bounded PENDING", (output) => {
    const result = normalizeSemanticReview(output);
    expect(result).toEqual({
      status: "PENDING",
      ready: false,
      issues: ["语义审查暂不可用，已保存并等待后续确认"],
      source: "reviewer-fallback",
    });
  });

  it("normalizes reviewer exceptions instead of throwing", async () => {
    const result = await reviewSemanticLogic(
      { review: () => { throw new Error("provider secret"); } },
      card,
      { timeoutMs: 100 },
    );
    expect(result.status).toBe("PENDING");
    expect(result.source).toBe("reviewer-fallback");
  });

  it("redacts personal identifiers before invoking a semantic reviewer", async () => {
    let received: typeof card | undefined;
    await reviewSemanticLogic({
      review: (candidate) => {
        received = candidate;
        return { status: "PENDING", ready: false, issues: [], source: "test" };
      },
    }, { ...card, culturalIntent: "联系 13812345678 或 Student@Example.com 讨论安岳石刻" });
    expect(received?.culturalIntent).toContain("安岳石刻");
    expect(received?.culturalIntent).not.toContain("13812345678");
    expect(received?.culturalIntent.toLowerCase()).not.toContain("student@example.com");
  });

  it("aborts a never-resolving reviewer at the configured timeout", async () => {
    let signal: AbortSignal | undefined;
    const promise = reviewSemanticLogic(
      {
        review: (_card, context) => {
          signal = context.signal;
          return new Promise(() => undefined);
        },
      },
      card,
      { timeoutMs: 10 },
    );

    const result = await promise;
    expect(signal?.aborted).toBe(true);
    expect(result).toMatchObject({ status: "PENDING", ready: false, source: "reviewer-fallback" });
  });
});

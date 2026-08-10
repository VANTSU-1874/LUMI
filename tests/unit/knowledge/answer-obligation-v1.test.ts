import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AnswerObligationSetV1Schema,
  QueryUnderstandingInputV1Schema,
  createDegradedAnswerObligationSetV1,
  type QueryUnderstandingInputV1,
  validateAnswerObligationSetV1,
} from "@/lib/knowledge/answer-obligation-v1";

const currentMessage = "声音有数值，画面为什么不动？我应该先查哪里？";
const currentMessageHash = sha256(currentMessage);

const request: QueryUnderstandingInputV1 = {
  schemaVersion: 1 as const,
  currentMessage: {
    source: "CURRENT_MESSAGE" as const,
    message: currentMessage,
    messageHash: currentMessageHash,
  },
  recentTurns: [],
  coursePack: {
    id: "digital-interaction",
    version: "1",
    label: "数字交互文创设计",
    summary: "面向交互视觉与 TouchDesigner 项目的课程包。",
  },
  view: {
    id: "student-conversation",
    focus: "mentor",
  },
  hasArtwork: false,
  artworkHash: null,
};

const metadata = {
  plannerVersion: "1.0.0",
  modelId: "gpt-5.6",
  promptHash: "1".repeat(64),
  outputHash: "2".repeat(64),
  elapsedMs: 37,
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function codePointLength(value: string) {
  return Array.from(value).length;
}

function readyPayload(overrides: Record<string, unknown> = {}) {
  return {
    status: "READY",
    obligations: [{
      learnerNeed: "找出画面不动的原因，并明确第一步检查位置",
      intent: "DIAGNOSE_CAUSE",
      sourceAnchors: [{
        source: "CURRENT_MESSAGE",
        sourceMessageHash: currentMessageHash,
        quote: currentMessage,
        startCodePoint: 0,
        endCodePoint: codePointLength(currentMessage),
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
      confidence: 0.93,
      ...overrides,
    }],
    clarifyingQuestion: null,
    artworkObservationHints: [],
  };
}

describe("answer obligation v1", () => {
  it("accepts anchored model output and adds wrapper-owned identity", () => {
    const result = validateAnswerObligationSetV1({
      request,
      payload: readyPayload(),
      metadata,
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      plannerId: "lumi-answer-obligation-planner-v1",
      plannerVersion: "1.0.0",
      modelId: "gpt-5.6",
      normalizedQuestion: "声音有数值,画面为什么不动?我应该先查哪里?",
      status: "READY",
      clarifyingQuestion: null,
    });
    expect(result.normalizedQuestionHash).toBe(
      sha256(result.normalizedQuestion),
    );
    expect(result.obligations[0]?.obligationId).toBe("obligation-1");
    expect(AnswerObligationSetV1Schema.parse(result)).toEqual(result);
  });

  it("rejects a source anchor whose quote or hash is not bound to its message", () => {
    expect(() => validateAnswerObligationSetV1({
      request,
      payload: readyPayload({
        sourceAnchors: [{
          source: "CURRENT_MESSAGE",
          sourceMessageHash: "3".repeat(64),
          quote: "画面为什么不动",
          startCodePoint: 0,
          endCodePoint: 7,
        }],
      }),
      metadata,
    })).toThrow("ANSWER_OBLIGATION_SOURCE_ANCHOR_INVALID");
  });

  it("rejects canonical entity ids before the model payload can enter the contract", () => {
    const payload = readyPayload();
    Object.assign(payload.obligations[0]!.entityMentions[0]!, {
      canonicalEntityId: "touchdesigner-no-output",
    });

    expect(() => validateAnswerObligationSetV1({
      request,
      payload,
      metadata,
    })).toThrow("ANSWER_OBLIGATION_CANONICAL_ENTITY_FORBIDDEN");
  });

  it("rejects entity and constraint references to missing source anchors", () => {
    expect(() => validateAnswerObligationSetV1({
      request,
      payload: readyPayload({
        entityMentions: [{
          surface: "画面",
          normalized: "画面",
          anchorIndexes: [1],
        }],
      }),
      metadata,
    })).toThrow("ANSWER_OBLIGATION_ANCHOR_INDEX_INVALID");
  });

  it("requires CLARIFY when an obligation confidence is below the frozen threshold", () => {
    expect(() => validateAnswerObligationSetV1({
      request,
      payload: readyPayload({ confidence: 0.69 }),
      metadata,
    })).toThrow("ANSWER_OBLIGATION_LOW_CONFIDENCE_REQUIRES_CLARIFY");

    const result = validateAnswerObligationSetV1({
      request,
      payload: {
        ...readyPayload({ confidence: 0.69 }),
        status: "CLARIFY",
        clarifyingQuestion: "你想先查声音到画面的连接，还是先查画面参数？",
      },
      metadata,
    });
    expect(result.status).toBe("CLARIFY");
  });

  it("rejects forbidden evaluation fields and wrapper-owned model fields", () => {
    expect(() => QueryUnderstandingInputV1Schema.parse({
      ...request,
      qrels: { expectedNodeId: "node-1" },
    })).toThrow();

    expect(() => validateAnswerObligationSetV1({
      request,
      payload: {
        ...readyPayload(),
        modelId: "model-selected-by-payload",
      },
      metadata,
    })).toThrow();
  });

  it("binds artwork observations to the one declared artwork hash", () => {
    const artworkHash = "4".repeat(64);
    const artworkRequest = {
      ...request,
      hasArtwork: true,
      artworkHash,
    };
    const result = validateAnswerObligationSetV1({
      request: artworkRequest,
      payload: {
        ...readyPayload(),
        artworkObservationHints: [{
          artworkHash,
          visibleCue: "右侧图形区域明显比左侧拥挤",
          confidence: 0.88,
        }],
      },
      metadata,
    });
    expect(result.artworkObservationHints).toHaveLength(1);

    expect(() => validateAnswerObligationSetV1({
      request: artworkRequest,
      payload: {
        ...readyPayload(),
        artworkObservationHints: [{
          artworkHash: "5".repeat(64),
          visibleCue: "出现了未绑定的图片判断",
          confidence: 0.8,
        }],
      },
      metadata,
    })).toThrow("ANSWER_OBLIGATION_ARTWORK_HINT_INVALID");
  });

  it("creates a local DEGRADED artifact that can only retrieve the whole question", () => {
    const degraded = createDegradedAnswerObligationSetV1({
      request,
      metadata,
    });

    expect(degraded).toMatchObject({
      status: "DEGRADED",
      clarifyingQuestion: null,
      obligations: [{
        obligationId: "obligation-1",
        learnerNeed: currentMessage,
        confidence: 0,
        retrievalQueries: [{
          text: currentMessage,
          purpose: "DIRECT",
        }],
      }],
    });
    expect(degraded.obligations).toHaveLength(1);
    expect(AnswerObligationSetV1Schema.parse(degraded)).toEqual(degraded);
  });
});

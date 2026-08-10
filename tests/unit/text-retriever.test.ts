// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createGuardedTextRetriever,
  retrieveWithTextFallback,
  SELF_HOSTED_TEXT_MODEL,
  type TextIndexIdentity,
} from "@/lib/knowledge/text-retriever";

const index: TextIndexIdentity = {
  corpusBundleHash: "a".repeat(64),
  indexBundleHash: "b".repeat(64),
  indexVersionId: "bge-small-zh-v1-5-fixture",
  modelId: SELF_HOSTED_TEXT_MODEL.id,
  modelRevision: SELF_HOSTED_TEXT_MODEL.revision,
};

const hit = {
  representationId: "text-rep-fixture",
  nodeId: "node-fixture",
  objectId: "layout-fixture",
  coursePackId: "layout-design" as const,
  rank: 1,
  score: 0.82,
  sourceKind: "NODE" as const,
  nodeKind: "TEXT" as const,
  role: "ACTION" as const,
  contentHash: "c".repeat(64),
};

function successResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "SUCCESS",
    reason: null,
    hits: [hit],
    index,
    timing: {
      inferenceMs: 2,
      totalMs: 2,
    },
    ...overrides,
  };
}

describe("guarded self-hosted text retriever", () => {
  it("pins the immutable BGE inference contract", () => {
    expect(SELF_HOSTED_TEXT_MODEL).toEqual({
      id: "BAAI/bge-small-zh-v1.5",
      revision: "7999e1d3359715c523056ef9478215996d62a620",
      license: "MIT",
      dimensions: 512,
      pooling: "CLS",
      normalize: true,
      queryInstruction: "为这个句子生成表示以用于检索相关文章：",
    });
  });

  it("accepts exact provenance and an allowed course-scoped V2 target", async () => {
    const retriever = createGuardedTextRetriever({
      expectedIndex: index,
      allowedTargets: new Map([
        [hit.nodeId, {
          objectId: hit.objectId,
          coursePackId: hit.coursePackId,
        }],
      ]),
      transport: vi.fn(async () => successResponse()),
    });

    await expect(retriever.retrieve({
      text: "这个海报看起来乱，我先改哪儿？",
      coursePackId: "layout-design",
    }, {
      topK: 5,
      timeoutMs: 500,
    })).resolves.toMatchObject({
      status: "SUCCESS",
      hits: [hit],
      index,
    });
  });

  it("rejects cross-course hits and index identity drift as invalid responses", async () => {
    const crossCourse = createGuardedTextRetriever({
      expectedIndex: index,
      transport: async () => successResponse(),
    });
    await expect(crossCourse.retrieve({
      text: "字都挤在一起了",
      coursePackId: "brand-vi-design",
    }, {
      topK: 5,
      timeoutMs: 500,
    })).resolves.toMatchObject({
      status: "ERROR",
      reason: "INVALID_RESPONSE",
      hits: [],
      index: null,
    });

    const drifted = createGuardedTextRetriever({
      expectedIndex: index,
      transport: async () => successResponse({
        index: { ...index, indexBundleHash: "d".repeat(64) },
      }),
    });
    await expect(drifted.retrieve({
      text: "字都挤在一起了",
      coursePackId: null,
    }, {
      topK: 5,
      timeoutMs: 500,
    })).resolves.toMatchObject({
      status: "ERROR",
      reason: "INVALID_RESPONSE",
    });
  });

  it("turns malformed, timed-out, and exited transports into bounded failure states", async () => {
    const malformed = createGuardedTextRetriever({
      expectedIndex: index,
      transport: async () => ({ status: "SUCCESS", hits: "not-an-array" }),
    });
    await expect(malformed.retrieve({
      text: "标题不够醒目",
      coursePackId: null,
    }, {
      topK: 5,
      timeoutMs: 500,
    })).resolves.toMatchObject({
      status: "ERROR",
      reason: "INVALID_RESPONSE",
    });

    const exited = createGuardedTextRetriever({
      expectedIndex: index,
      transport: async () => {
        throw new Error("sidecar exited");
      },
    });
    await expect(exited.retrieve({
      text: "标题不够醒目",
      coursePackId: null,
    }, {
      topK: 5,
      timeoutMs: 500,
    })).resolves.toMatchObject({
      status: "UNAVAILABLE",
      reason: "PROVIDER_UNAVAILABLE",
    });

    const timedOut = createGuardedTextRetriever({
      expectedIndex: index,
      transport: async (_query, _options, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    });
    await expect(timedOut.retrieve({
      text: "标题不够醒目",
      coursePackId: null,
    }, {
      topK: 5,
      timeoutMs: 10,
    })).resolves.toMatchObject({
      status: "TIMEOUT",
      reason: "DEADLINE_EXCEEDED",
    });
  });

  it("keeps healthy EMPTY final and only falls back after a vector failure", async () => {
    const retriever = createGuardedTextRetriever({
      expectedIndex: index,
      transport: async () => ({
        status: "EMPTY",
        reason: null,
        hits: [],
        index,
        timing: { inferenceMs: 1, totalMs: 1 },
      }),
    });
    const fallback = vi.fn(async (text: string) => [`lexical:${text}`]);
    await expect(retrieveWithTextFallback(
      retriever,
      {
        text: "我不知道怎么把版面理顺",
        coursePackId: "layout-design",
      },
      {
        topK: 5,
        timeoutMs: 500,
      },
      fallback,
    )).resolves.toMatchObject({
      outcome: "EMPTY",
      textVector: {
        status: "EMPTY",
      },
      fallback: null,
    });
    expect(fallback).not.toHaveBeenCalled();

    const failed = createGuardedTextRetriever({
      expectedIndex: index,
      transport: async () => {
        throw new Error("sidecar exited");
      },
    });
    await expect(retrieveWithTextFallback(
      failed,
      {
        text: "我不知道怎么把版面理顺",
        coursePackId: "layout-design",
      },
      {
        topK: 5,
        timeoutMs: 500,
      },
      fallback,
    )).resolves.toMatchObject({
      outcome: "LEXICAL_FALLBACK",
      textVector: { status: "UNAVAILABLE" },
      fallback: ["lexical:我不知道怎么把版面理顺"],
    });
    expect(fallback).toHaveBeenCalledOnce();
  });
});

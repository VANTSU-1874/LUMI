// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createGuardedVisualRetriever,
  retrieveWithVisualFallback,
  VisualRetrievalResponseSchema,
  VisualRetrieverQuerySchema,
  type VisualIndexIdentity,
  type VisualRetrieverTransport,
} from "@/lib/knowledge/visual-retriever";

const index: VisualIndexIdentity = {
  corpusBundleHash: "a".repeat(64),
  indexBundleHash: "b".repeat(64),
  indexVersionId: "siglip2-poc-v1",
  modelId: "google/siglip2-base-patch16-224",
  modelRevision: "c".repeat(40),
};

const assetOne = `asset-${"1".repeat(64)}`;
const assetTwo = `asset-${"2".repeat(64)}`;

function success(assetId = assetOne) {
  return VisualRetrievalResponseSchema.parse({
    status: "SUCCESS",
    reason: null,
    hits: [{
      assetId,
      rank: 1,
      score: 0.9,
      region: {
        coordinateSpace: "NORMALIZED",
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.4,
        origin: "PATCH_MATCH",
      },
      representationId: "siglip2-asset-one",
    }],
    index,
    timing: {
      queueMs: 0,
      inferenceMs: 2,
      totalMs: 2,
    },
  });
}

function retriever(transport: VisualRetrieverTransport, overrides: {
  concurrency?: number;
  maxQueue?: number;
  maxCacheEntries?: number;
} = {}) {
  return createGuardedVisualRetriever({
    capabilities: {
      textToImage: true,
      imageToImage: true,
      imageTextToImage: true,
      normalizedRegions: true,
    },
    expectedIndex: index,
    transport,
    ...overrides,
  });
}

describe("visual retriever contract", () => {
  it("requires image-to-image queries to exclude their own opaque asset id", () => {
    expect(() => VisualRetrieverQuerySchema.parse({
      mode: "IMAGE_TO_IMAGE",
      coursePackId: "layout-design",
      queryAssetId: assetOne,
      excludeAssetIds: [],
    })).toThrow(/exclude/);

    expect(VisualRetrieverQuerySchema.parse({
      mode: "IMAGE_TO_IMAGE",
      coursePackId: "layout-design",
      queryAssetId: assetOne,
      excludeAssetIds: [assetOne],
    })).toMatchObject({
      mode: "IMAGE_TO_IMAGE",
      queryAssetId: assetOne,
    });

    expect(() => VisualRetrieverQuerySchema.parse({
      mode: "IMAGE_TEXT_TO_IMAGE",
      coursePackId: "layout-design",
      queryAssetId: assetOne,
      text: "这个版面哪里乱？",
      excludeAssetIds: [],
    })).toThrow(/exclude/);
  });

  it("rejects regions outside the image and unversioned evaluated responses", () => {
    expect(() => VisualRetrievalResponseSchema.parse({
      ...success(),
      hits: [{
        ...success().hits[0],
        region: {
          coordinateSpace: "NORMALIZED",
          x: 0.8,
          y: 0.1,
          width: 0.3,
          height: 0.2,
          origin: "PATCH_MATCH",
        },
      }],
    })).toThrow(/inside/);
    expect(() => VisualRetrievalResponseSchema.parse({
      ...success(),
      index: null,
    })).toThrow(/index identity/);
  });

  it("never sends paths or expected targets to the sidecar transport", async () => {
    const transport = vi.fn<VisualRetrieverTransport>(async () => success());
    const visual = retriever(transport);
    await expect(visual.retrieve({
      mode: "TEXT_TO_IMAGE",
      coursePackId: "layout-design",
      text: "找一张文字沿四周竖排、中央是一把旧木椅的图",
    }, {
      topK: 5,
      timeoutMs: 500,
    })).resolves.toMatchObject({ status: "SUCCESS" });

    const sent = transport.mock.calls[0]?.[0];
    expect(sent).toEqual({
      mode: "TEXT_TO_IMAGE",
      coursePackId: "layout-design",
      text: "找一张文字沿四周竖排、中央是一把旧木椅的图",
    });
    expect(JSON.stringify(sent)).not.toMatch(/target|expected|parent|path/i);
  });

  it("rejects wrong index provenance, self hits, and oversized result sets", async () => {
    const wrongIndex = retriever(async () => ({
      ...success(),
      index: {
        ...index,
        modelRevision: "d".repeat(40),
      },
    }));
    await expect(wrongIndex.retrieve({
      mode: "TEXT_TO_IMAGE",
      coursePackId: null,
      text: "木椅",
    }, {
      topK: 5,
      timeoutMs: 500,
    })).resolves.toMatchObject({
      status: "ERROR",
      reason: "INVALID_RESPONSE",
    });

    const selfHit = retriever(async () => success(assetOne));
    await expect(selfHit.retrieve({
      mode: "IMAGE_TO_IMAGE",
      coursePackId: "layout-design",
      queryAssetId: assetOne,
      excludeAssetIds: [assetOne],
    }, {
      topK: 5,
      timeoutMs: 500,
    })).resolves.toMatchObject({
      status: "ERROR",
      reason: "INVALID_RESPONSE",
    });

    const tooMany = retriever(async () => ({
      ...success(),
      hits: [assetOne, assetTwo].map((assetId, offset) => ({
        ...success(assetId).hits[0],
        rank: offset + 1,
      })),
    }));
    await expect(tooMany.retrieve({
      mode: "TEXT_TO_IMAGE",
      coursePackId: null,
      text: "测试",
    }, {
      topK: 1,
      timeoutMs: 500,
    })).resolves.toMatchObject({
      status: "ERROR",
      reason: "INVALID_RESPONSE",
    });
  });
});

describe("guarded visual retriever runtime", () => {
  it("uses a bounded queue and releases callers after provider work finishes", async () => {
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const visual = retriever(async () => {
      calls += 1;
      if (calls === 1) await firstPending;
      return success(calls === 1 ? assetOne : assetTwo);
    }, {
      concurrency: 1,
      maxQueue: 1,
      maxCacheEntries: 0,
    });
    const options = { topK: 5, timeoutMs: 1_000 };
    const one = visual.retrieve({
      mode: "TEXT_TO_IMAGE",
      coursePackId: null,
      text: "first",
    }, options);
    const two = visual.retrieve({
      mode: "TEXT_TO_IMAGE",
      coursePackId: null,
      text: "second",
    }, options);
    const three = visual.retrieve({
      mode: "TEXT_TO_IMAGE",
      coursePackId: null,
      text: "third",
    }, options);

    expect(visual.resourceSnapshot?.()).toMatchObject({
      active: 1,
      queueDepth: 1,
      maxQueue: 1,
      cacheEntries: 0,
    });
    await expect(three).resolves.toMatchObject({
      status: "UNAVAILABLE",
      reason: "QUEUE_FULL",
    });
    releaseFirst();
    await expect(one).resolves.toMatchObject({ status: "SUCCESS" });
    await expect(two).resolves.toMatchObject({ status: "SUCCESS" });
    expect(calls).toBe(2);
    expect(visual.resourceSnapshot?.()).toMatchObject({
      active: 0,
      queueDepth: 0,
    });
  });

  it("applies one total deadline to queue and transport, and propagates cancellation", async () => {
    const visual = retriever(async (_query, _options, { signal }) =>
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }), {
      maxCacheEntries: 0,
    });
    await expect(visual.retrieve({
      mode: "TEXT_TO_IMAGE",
      coursePackId: null,
      text: "timeout",
    }, {
      topK: 5,
      timeoutMs: 5,
    })).resolves.toMatchObject({
      status: "TIMEOUT",
    });

    const caller = new AbortController();
    const cancelled = visual.retrieve({
      mode: "TEXT_TO_IMAGE",
      coursePackId: null,
      text: "cancel",
    }, {
      topK: 5,
      timeoutMs: 1_000,
    }, {
      signal: caller.signal,
    });
    caller.abort(new Error("caller stopped"));
    await expect(cancelled).resolves.toMatchObject({
      status: "UNAVAILABLE",
      reason: "REQUEST_ABORTED",
    });
  });

  it("settles at the deadline even when the transport ignores AbortSignal", async () => {
    const visual = retriever(async () => await new Promise(() => {}), {
      maxCacheEntries: 0,
    });
    const result = await Promise.race([
      visual.retrieve({
        mode: "TEXT_TO_IMAGE",
        coursePackId: null,
        text: "provider ignores abort",
      }, {
        topK: 5,
        timeoutMs: 5,
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("guard did not settle")), 100);
      }),
    ]);

    expect(result).toMatchObject({
      status: "TIMEOUT",
      reason: "DEADLINE_EXCEEDED",
    });
  });

  it("classifies a deadline reached while queued as TIMEOUT", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const visual = retriever(async (query) => {
      if ("text" in query && query.text === "block") await blocker;
      return success();
    }, {
      concurrency: 1,
      maxQueue: 1,
      maxCacheEntries: 0,
    });
    const first = visual.retrieve({
      mode: "TEXT_TO_IMAGE",
      coursePackId: null,
      text: "block",
    }, {
      topK: 5,
      timeoutMs: 1_000,
    });
    const queued = visual.retrieve({
      mode: "TEXT_TO_IMAGE",
      coursePackId: null,
      text: "queued",
    }, {
      topK: 5,
      timeoutMs: 5,
    });

    await expect(queued).resolves.toMatchObject({
      status: "TIMEOUT",
      reason: "DEADLINE_EXCEEDED",
    });
    release();
    await expect(first).resolves.toMatchObject({ status: "SUCCESS" });
  });

  it("caches only evaluated responses with an index-bound hashed key", async () => {
    const transport = vi.fn<VisualRetrieverTransport>(async () => success());
    const visual = retriever(transport);
    const query = {
      mode: "TEXT_TO_IMAGE" as const,
      coursePackId: "layout-design" as const,
      text: "同一个问题",
    };
    const options = { topK: 5, timeoutMs: 500 };
    await visual.retrieve(query, options);
    await visual.retrieve(query, options);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(visual.resourceSnapshot?.()).toMatchObject({
      cacheEntries: 1,
      cacheHits: 1,
      cacheMisses: 1,
    });

    await visual.retrieve({ ...query, text: "另一个问题" }, options);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(visual.resourceSnapshot?.()).toMatchObject({
      cacheEntries: 2,
      cacheHits: 1,
      cacheMisses: 2,
    });
  });

  it("deep-clones cached provenance and regions and respects pre-cancelled callers", async () => {
    const transport = vi.fn<VisualRetrieverTransport>(async () => success());
    const visual = retriever(transport);
    const query = {
      mode: "TEXT_TO_IMAGE" as const,
      coursePackId: "layout-design" as const,
      text: "cache isolation",
    };
    const options = { topK: 5, timeoutMs: 500 };
    const first = await visual.retrieve(query, options);
    first.hits[0]!.region!.x = 0.7;
    first.index!.modelRevision = "d".repeat(40);
    const second = await visual.retrieve(query, options);
    expect(second.hits[0]!.region!.x).toBe(0.1);
    expect(second.index).toEqual(index);

    const caller = new AbortController();
    caller.abort(new Error("already stopped"));
    await expect(visual.retrieve(query, options, {
      signal: caller.signal,
    })).resolves.toMatchObject({
      status: "UNAVAILABLE",
      reason: "REQUEST_ABORTED",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown and cross-course assets when an active corpus allowlist is supplied", async () => {
    const allowed = createGuardedVisualRetriever({
      capabilities: {
        textToImage: true,
        imageToImage: true,
        imageTextToImage: true,
        normalizedRegions: true,
      },
      expectedIndex: index,
      transport: async () => success(assetOne),
      allowedAssetCoursePacks: new Map([[assetOne, "book-design"]]),
    });
    await expect(allowed.retrieve({
      mode: "TEXT_TO_IMAGE",
      coursePackId: "layout-design",
      text: "cross course",
    }, {
      topK: 5,
      timeoutMs: 500,
    })).resolves.toMatchObject({
      status: "ERROR",
      reason: "INVALID_RESPONSE",
    });
  });

  it.each([
    ["provider error", async () => { throw new Error("sidecar exited"); }],
    ["invalid payload", async () => ({ status: "SUCCESS" })],
  ] satisfies Array<[string, VisualRetrieverTransport]>)(
    "falls back lexically for text-bearing queries after %s",
    async (_label, transport) => {
      const visual = retriever(transport);
      const fallback = vi.fn(async (text: string) => `lexical:${text}`);
      await expect(retrieveWithVisualFallback(
        visual,
        {
          mode: "IMAGE_TEXT_TO_IMAGE",
          coursePackId: "layout-design",
          queryAssetId: assetOne,
          text: "这张图的层级哪里乱？",
          excludeAssetIds: [assetOne],
        },
        { topK: 5, timeoutMs: 100 },
        fallback,
      )).resolves.toMatchObject({
        outcome: "LEXICAL_FALLBACK",
        fallback: "lexical:这张图的层级哪里乱？",
      });
      expect(fallback).toHaveBeenCalledTimes(1);
    },
  );

  it("fails closed for a pure image query instead of pretending lexical success", async () => {
    const visual = retriever(async () => {
      throw new Error("sidecar exited");
    });
    const fallback = vi.fn(async () => "should-not-run");
    await expect(retrieveWithVisualFallback(
      visual,
      {
        mode: "IMAGE_TO_IMAGE",
        coursePackId: "layout-design",
        queryAssetId: assetOne,
        excludeAssetIds: [assetOne],
      },
      { topK: 5, timeoutMs: 100 },
      fallback,
    )).resolves.toMatchObject({
      outcome: "UNSUPPORTED",
      fallback: null,
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("bounds a lexical fallback that ignores cancellation", async () => {
    const visual = retriever(async () => {
      throw new Error("sidecar exited");
    });
    await expect(retrieveWithVisualFallback(
      visual,
      {
        mode: "TEXT_TO_IMAGE",
        coursePackId: "layout-design",
        text: "需要词法降级",
      },
      { topK: 5, timeoutMs: 100 },
      async () => await new Promise(() => {}),
      {},
      5,
    )).rejects.toThrow();
  });
});

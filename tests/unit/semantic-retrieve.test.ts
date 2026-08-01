import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EmbeddingProvider } from "@/lib/ai/embeddings";
import {
  clearKnowledgeVectorIndexCache,
  retrieveKnowledgeHybrid,
} from "@/lib/knowledge/semantic-retrieve";
import { rankKnowledge, type KnowledgeItem } from "@/lib/knowledge/retrieve";

const items: KnowledgeItem[] = [
  {
    id: "td-feedback",
    title: "Feedback TOP 回授基础",
    topic: "TOUCHDESIGNER_FOUNDATIONS",
    tags: ["Feedback TOP", "回授", "拖尾"],
    content: "回授会把前一帧重新送回当前画面，衰减不足时会持续累积。",
    facts: [{ id: "td-feedback-loop", text: "Feedback TOP 需要明确上一帧反馈路径。" }],
    actions: [{ id: "td-observe-upstream", text: "先观察反馈前后的画面变化。" }],
    source: {
      authority: "OFFICIAL",
      verifiedDate: "2026-07-17",
      scope: "TouchDesigner 回授基础",
      url: "https://docs.derivative.ca/Feedback_TOP",
    },
  },
  {
    id: "td-null",
    title: "Null CHOP 输出锚点",
    topic: "TOUCHDESIGNER_FOUNDATIONS",
    tags: ["Null CHOP", "输出"],
    content: "Null CHOP 常用于稳定引用处理链末端的通道。",
    facts: [{ id: "td-null-anchor", text: "Null CHOP 可作为稳定的通道引用点。" }],
    actions: [{ id: "td-observe-upstream", text: "先观察 Null CHOP 上游通道。" }],
    source: {
      authority: "OFFICIAL",
      verifiedDate: "2026-07-17",
      scope: "TouchDesigner Null CHOP 基础",
      url: "https://docs.derivative.ca/Null_CHOP",
    },
  },
];

function vectorFor(value: string) {
  if (/Feedback TOP|回授会把前一帧/.test(value)) return [1, 0, 0];
  if (/Null CHOP|稳定引用处理链/.test(value)) return [0, 1, 0];
  if (/旧影|越积越暗/.test(value)) return [1, 0, 0];
  if (/末端通道|输出锚点/.test(value)) return [0, 1, 0];
  return [0, 0, 1];
}

function fakeProvider(cacheKey = "test:semantic-v1"): EmbeddingProvider & {
  embed: ReturnType<typeof vi.fn<EmbeddingProvider["embed"]>>;
} {
  const embed = vi.fn<EmbeddingProvider["embed"]>(async (inputs) => inputs.map(vectorFor));
  return {
    provider: "TEST",
    modelId: "semantic-fixture",
    cacheKey,
    embed,
  };
}

beforeEach(() => clearKnowledgeVectorIndexCache());
afterEach(() => vi.unstubAllEnvs());

describe("hybrid knowledge retrieval", () => {
  it("recalls a semantic paraphrase that the lexical baseline misses", async () => {
    const query = "图像像旧影一样一层层堆着，最后越积越暗怎么办？";
    expect(rankKnowledge(query, items)).toEqual([]);

    const result = await retrieveKnowledgeHybrid(query, items, fakeProvider());

    expect(result.semanticStatus).toBe("USED");
    expect(result.items[0]).toMatchObject({
      id: "td-feedback",
      retrieval: {
        method: "SEMANTIC",
        semanticScore: 1,
      },
    });
  });

  it("combines an exact lexical match with semantic similarity", async () => {
    const result = await retrieveKnowledgeHybrid(
      "Null CHOP 为什么适合做输出锚点？",
      items,
      fakeProvider(),
    );

    expect(result.items[0]).toMatchObject({
      id: "td-null",
      retrieval: {
        method: "HYBRID",
        lexicalScore: expect.any(Number),
        semanticScore: 1,
      },
    });
  });

  it("falls back to the relaxed lexical ranker when embeddings fail", async () => {
    const provider = fakeProvider();
    provider.embed.mockRejectedValueOnce(new Error("offline"));

    const result = await retrieveKnowledgeHybrid("Null CHOP 输出", items, provider);

    expect(result).toMatchObject({
      semanticStatus: "FAILED",
      strategy: "LEXICAL_FALLBACK",
      items: [expect.objectContaining({ id: "td-null" })],
    });
  });

  it("treats an injected zero query vector as an invalid response and falls back", async () => {
    const provider: EmbeddingProvider = {
      ...fakeProvider("test:zero-query-v1"),
      async embed(inputs) {
        return inputs.length === 1 ? [[0, 0, 0]] : inputs.map(vectorFor);
      },
    };

    const result = await retrieveKnowledgeHybrid("Null CHOP 输出", items, provider);

    expect(result).toMatchObject({
      semanticStatus: "FAILED",
      strategy: "LEXICAL_FALLBACK",
      errorCode: "INVALID_RESPONSE",
      items: [expect.objectContaining({ id: "td-null" })],
    });
  });

  it("returns no references for a genuine no-hit without treating it as an error", async () => {
    const result = await retrieveKnowledgeHybrid("量子香蕉的气味", items, fakeProvider());

    expect(result).toMatchObject({
      semanticStatus: "USED",
      strategy: "HYBRID",
      items: [],
    });
  });

  it("does not mistake a shared high-cosine embedding direction for relevance", async () => {
    const provider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "anisotropic-fixture",
      cacheKey: "test:anisotropic-v1",
      async embed(inputs) {
        return inputs.map((value, index) => {
          if (/量子香蕉/.test(value)) return [100, 0, 1];
          return index % 2 === 0 ? [100, 1, 0] : [100, -1, 0];
        });
      },
    };

    const result = await retrieveKnowledgeHybrid("量子香蕉的气味", items, provider);

    expect(result.semanticStatus).toBe("USED");
    expect(result.items).toEqual([]);
  });

  it("redacts student identifiers before embedding either corpus text or the query", async () => {
    vi.stubEnv("STUDENT_NUMBER_PREFIX", "ABC");
    vi.stubEnv("STUDENT_NUMBER_DIGITS", "4");
    const provider = fakeProvider("test:redaction-v1");
    const sensitive = {
      ...items[0]!,
      content: `ABC1234 Student@Example.com ＋８６ １３８－１２３４－５６７８ ${items[0]!.content}`,
    };

    await retrieveKnowledgeHybrid(
      "ABC1234 Student@Example.com ＋８６ １３８－１２３４－５６７８ 的旧影越来越暗",
      [sensitive],
      provider,
    );

    const embedded = provider.embed.mock.calls.flatMap(([inputs]) => inputs).join("\n").toLowerCase();
    expect(embedded).toContain("[已遮蔽");
    expect(embedded).not.toContain("abc1234");
    expect(embedded).not.toContain("student@example.com");
    expect(embedded).not.toContain("138");
  });

  it("propagates caller cancellation instead of silently returning lexical results", async () => {
    const controller = new AbortController();
    const provider: EmbeddingProvider = {
      provider: "TEST",
      modelId: "cancel-fixture",
      cacheKey: "test:cancel-v1",
      async embed(inputs, options) {
        if (inputs.length === 1) options?.signal?.throwIfAborted();
        return inputs.map(vectorFor);
      },
    };
    controller.abort();

    await expect(retrieveKnowledgeHybrid("Null CHOP 输出", items, provider, {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reuses the in-memory corpus index while embedding each new query", async () => {
    const provider = fakeProvider("test:cache-v1");

    await retrieveKnowledgeHybrid("旧影越积越暗", items, provider);
    await retrieveKnowledgeHybrid("末端通道怎么稳定引用", items, provider);

    const corpusCalls = provider.embed.mock.calls.filter(([inputs]) => inputs.length === items.length);
    const queryCalls = provider.embed.mock.calls.filter(([inputs]) => inputs.length === 1);
    expect(corpusCalls).toHaveLength(1);
    expect(queryCalls).toHaveLength(2);
  });
});

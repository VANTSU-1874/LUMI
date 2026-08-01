import { describe, expect, it, vi } from "vitest";

import {
  EmbeddingServiceError,
  createOpenAICompatibleEmbeddingProvider,
} from "@/lib/ai/embeddings";

const config = {
  baseUrl: "https://models.example.test/v1",
  apiKey: "embedding-secret-value",
  model: "text-embedding-test",
  timeoutMs: 5_000,
};

describe("OpenAI-compatible embeddings provider", () => {
  it("posts a bounded batch to /embeddings and restores vectors by response index", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer embedding-secret-value",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "text-embedding-test",
        input: ["第一条", "第二条"],
      });
      return new Response(JSON.stringify({
        object: "list",
        data: [
          { object: "embedding", index: 1, embedding: [0, 1] },
          { object: "embedding", index: 0, embedding: [1, 0] },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = createOpenAICompatibleEmbeddingProvider(config, { fetchImpl });

    await expect(provider.embed(["第一条", "第二条"])).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://models.example.test/v1/embeddings",
      expect.any(Object),
    );
    expect(provider.cacheKey).not.toContain(config.apiKey);
  });

  it("rejects malformed vectors instead of putting corrupt data in the index", async () => {
    const provider = createOpenAICompatibleEmbeddingProvider(config, {
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        data: [
          { object: "embedding", index: 0, embedding: [1, 0] },
          { object: "embedding", index: 1, embedding: [1, 0, 0] },
        ],
      }), { status: 200 })),
    });

    await expect(provider.embed(["第一条", "第二条"])).rejects.toMatchObject({
      name: "EmbeddingServiceError",
      code: "INVALID_RESPONSE",
    });
  });

  it("maps upstream failures to a key-safe error", async () => {
    const provider = createOpenAICompatibleEmbeddingProvider(config, {
      fetchImpl: vi.fn(async () => new Response("provider leaked nothing useful", { status: 429 })),
    });

    const error = await provider.embed(["查询"]).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(EmbeddingServiceError);
    expect(error).toMatchObject({ code: "RATE_LIMIT" });
    expect(String(error)).not.toContain(config.apiKey);
  });

  it("cancels an unbounded response stream as soon as the byte cap is crossed", async () => {
    let cancelled = false;
    const oversized = new Uint8Array(8 * 1024 * 1024 + 1);
    const provider = createOpenAICompatibleEmbeddingProvider(config, {
      fetchImpl: vi.fn(async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(oversized);
        },
        cancel() {
          cancelled = true;
        },
      }), { status: 200 })),
    });

    await expect(provider.embed(["查询"])).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(cancelled).toBe(true);
  });

  it("preserves caller cancellation instead of disguising it as a provider outage", async () => {
    const controller = new AbortController();
    const provider = createOpenAICompatibleEmbeddingProvider(config, {
      fetchImpl: vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("cancelled", "AbortError"));
        }, { once: true });
      })),
    });

    const pending = provider.embed(["查询"], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
  });
});

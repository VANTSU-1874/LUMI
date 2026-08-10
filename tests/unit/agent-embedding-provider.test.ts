// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildEmbeddingProvider } from "@/lib/agent/orchestrator-context";
import { getActiveAgentPolicy } from "@/lib/agent/policy-registry";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("agent embedding provider", () => {
  it("constructs and invokes an embedding-only provider without enabling chat", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: [{ index: 0, embedding: [0.25, 0.75] }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchImpl);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    const provider = buildEmbeddingProvider({
      ai: {
        enabled: false,
        embeddingBaseUrl: "https://embedding.example.test/v1/",
        embeddingApiKey: "embedding-test-key",
        embeddingModel: "embedding-test-model",
      },
    }, getActiveAgentPolicy());

    expect(provider).not.toBeNull();
    await expect(provider!.embed(["local fake embedding input"]))
      .resolves.toEqual([[0.25, 0.75]]);
    expect(timeoutSpy).toHaveBeenCalledWith(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://embedding.example.test/v1/embeddings");
    expect(request).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer embedding-test-key",
        "Content-Type": "application/json",
      },
    });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(request?.body))).toEqual({
      model: "embedding-test-model",
      input: ["local fake embedding input"],
    });
  });
});

import { describe, expect, it } from "vitest";

import { createInMemoryTraceSink } from "@/lib/agent/runtime/trace-sink";

describe("Agent TraceSink public contract", () => {
  it("records only bounded public events and returns defensive snapshots", () => {
    const sink = createInMemoryTraceSink({ id: "candidate-runtime", version: "1.0.0" });
    sink.emit({
      kind: "MODEL_DECISION",
      status: "SUCCEEDED",
      label: "形成学习建议",
      summary: "模型输出已通过服务端规则校验。",
      latencyMs: 12,
      modelProvider: "TEST",
      modelId: "fixture-model",
      usage: { status: "RECORDED", inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    });
    const first = sink.snapshot();
    first[0]!.sourceIds.push("mutated");
    expect(sink.snapshot()).toMatchObject([{
      sequence: 1,
      runtime: { id: "candidate-runtime", version: "1.0.0" },
      usage: { status: "RECORDED", totalTokens: 30 },
      sourceIds: [],
    }]);
  });

  it("rejects hidden reasoning, prompt payloads and inconsistent usage", () => {
    const sink = createInMemoryTraceSink({ id: "candidate-runtime", version: "1.0.0" });
    const base = {
      kind: "MODEL_DECISION" as const,
      status: "SUCCEEDED" as const,
      label: "形成学习建议",
      summary: "只记录公开摘要。",
      latencyMs: 1,
    };
    expect(() => sink.emit({ ...base, reasoning: "hidden chain" } as never)).toThrow();
    expect(() => sink.emit({ ...base, prompt: "system prompt" } as never)).toThrow();
    expect(() => sink.emit({
      ...base,
      usage: { status: "RECORDED", inputTokens: 10, outputTokens: 5, totalTokens: 99 },
    })).toThrow();
  });
});

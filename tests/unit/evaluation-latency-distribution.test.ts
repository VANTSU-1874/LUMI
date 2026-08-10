import { describe, expect, it } from "vitest";

import {
  summarizeAgentEvaluationLatencies,
  summarizeEvaluationLatencies,
  summarizeTutorAnswerLatencies,
} from "@/lib/agent/evaluation-latency-distribution";

describe("evaluation latency distribution", () => {
  it("represents an empty sample without inventing percentile values", () => {
    expect(summarizeEvaluationLatencies([])).toEqual({
      percentileMethod: "NEAREST_RANK",
      count: 0,
      minMs: null,
      p50Ms: null,
      p90Ms: null,
      p95Ms: null,
      maxMs: null,
      averageMs: null,
      totalMs: 0,
    });
  });

  it("sorts a copy and uses nearest-rank percentiles", () => {
    const values = [20, 1, 19, 2, 18, 3, 17, 4, 16, 5, 15, 6, 14, 7, 13, 8, 12, 9, 11, 10];

    expect(summarizeEvaluationLatencies(values)).toEqual({
      percentileMethod: "NEAREST_RANK",
      count: 20,
      minMs: 1,
      p50Ms: 10,
      p90Ms: 18,
      p95Ms: 19,
      maxMs: 20,
      averageMs: 11,
      totalMs: 210,
    });
    expect(values).toEqual([20, 1, 19, 2, 18, 3, 17, 4, 16, 5, 15, 6, 14, 7, 13, 8, 12, 9, 11, 10]);
  });

  it("handles one- and two-sample distributions deterministically", () => {
    expect(summarizeEvaluationLatencies([37])).toMatchObject({
      count: 1,
      minMs: 37,
      p50Ms: 37,
      p90Ms: 37,
      p95Ms: 37,
      maxMs: 37,
      averageMs: 37,
      totalMs: 37,
    });
    expect(summarizeEvaluationLatencies([1, 2])).toMatchObject({
      count: 2,
      minMs: 1,
      p50Ms: 1,
      p90Ms: 2,
      p95Ms: 2,
      maxMs: 2,
      averageMs: 2,
      totalMs: 3,
    });
  });

  it("extracts structural evaluation latency from observed results", () => {
    expect(summarizeAgentEvaluationLatencies([
      { observed: { latencyMs: 300 } },
      { observed: { latencyMs: 100 } },
    ])).toMatchObject({ count: 2, minMs: 100, maxMs: 300, totalMs: 400 });
  });

  it("uses only answered tutor cases because null answers have no measured latency", () => {
    expect(summarizeTutorAnswerLatencies([
      { answer: { latencyMs: 300 } },
      { answer: null },
      { answer: { latencyMs: 100 } },
    ])).toMatchObject({ count: 2, minMs: 100, maxMs: 300, totalMs: 400 });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid latency %s",
    (latencyMs) => {
      expect(() => summarizeEvaluationLatencies([latencyMs]))
        .toThrow("INVALID_EVALUATION_LATENCY_MS");
    },
  );
});

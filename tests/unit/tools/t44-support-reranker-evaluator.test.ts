import { describe, expect, it } from "vitest";

import {
  nearestRankPercentile,
  selectT44SupportNodes,
  T44_SUPPORT_RERANKER_CONFIG_V1,
  T44_SUPPORT_RERANKER_GATES_V1,
} from "../../../tools/mixed-retrieval/t44-support-reranker-evaluator";

function ranked(
  node: string,
  objectId: string,
  rank: number,
  score: number,
) {
  return {
    nodeId: `node-${node.repeat(64)}`,
    objectId,
    coursePackId: "layout-design",
    score,
    rank,
  };
}

describe("T4.4 support reranker evaluator", () => {
  it("freezes the result-blind candidate and gate contract", () => {
    expect(T44_SUPPORT_RERANKER_CONFIG_V1).toEqual({
      topM: 5,
      topK: 8,
      maxPerObject: 3,
      repetitions: 3,
      batchSize: 32,
      maxLength: 512,
    });
    expect(T44_SUPPORT_RERANKER_GATES_V1).toEqual({
      supportCaseCoverageMinimum: 45,
      multiClaimJointCoverageMinimum: 9,
      bindingViolationMaximum: 0,
      latencyFloorMs: 50,
      latencyBaselineFraction: 0.25,
    });
  });

  it("selects eight nodes with a three-per-owner cap", () => {
    const ranking = [
      ranked("a", "object-a", 1, 1),
      ranked("b", "object-a", 2, 0.9),
      ranked("c", "object-a", 3, 0.8),
      ranked("d", "object-a", 4, 0.7),
      ranked("e", "object-b", 5, 0.6),
      ranked("f", "object-b", 6, 0.5),
      ranked("1", "object-c", 7, 0.4),
      ranked("2", "object-d", 8, 0.3),
      ranked("3", "object-e", 9, 0.2),
    ];

    const selected = selectT44SupportNodes(ranking);

    expect(selected).toHaveLength(8);
    expect(selected.map(({ nodeId }) => nodeId))
      .not.toContain(`node-${"d".repeat(64)}`);
    expect(
      selected.filter(({ objectId }) =>
        objectId === "object-a"),
    ).toHaveLength(3);
  });

  it("uses nearest-rank percentiles over case medians", () => {
    expect(nearestRankPercentile(
      Array.from({ length: 50 }, (_, index) => index + 1),
      0.95,
    )).toBe(48);
    expect(nearestRankPercentile([3, 1, 2], 0.5)).toBe(2);
  });

  it("rejects empty or invalid percentile requests", () => {
    expect(() => nearestRankPercentile([], 0.95))
      .toThrow(/PERCENTILE_INPUT_INVALID/);
    expect(() => nearestRankPercentile([1], 0))
      .toThrow(/PERCENTILE_INPUT_INVALID/);
  });
});

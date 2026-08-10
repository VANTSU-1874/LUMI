// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  pairedClusterBootstrap,
  type ClusteredBootstrapScore,
} from "@/lib/knowledge/retrieval-bootstrap";

function score(
  caseId: string,
  clusterId: string,
  value: number,
  tags: readonly string[] = ["visual", clusterId],
): ClusteredBootstrapScore {
  return { caseId, tags, value };
}

describe("paired cluster bootstrap", () => {
  it("is deterministic, order-independent, and gives every cluster equal weight", () => {
    const baseline = [
      score("case-a-1", "cluster-a", 1),
      score("case-a-2", "cluster-a", 3),
      score("case-b", "cluster-b", 2),
      score("case-c", "cluster-c", 0),
    ];
    const candidate = [
      score("case-a-1", "cluster-a", 2),
      score("case-a-2", "cluster-a", 5),
      score("case-b", "cluster-b", 1),
      score("case-c", "cluster-c", 3),
    ];

    const result = pairedClusterBootstrap(baseline, candidate, {
      iterations: 2_000,
      seed: 42,
    });
    const reordered = pairedClusterBootstrap(
      [...baseline].reverse(),
      [candidate[2]!, candidate[0]!, candidate[3]!, candidate[1]!],
      { iterations: 2_000, seed: 42 },
    );

    expect(result).toEqual(reordered);
    expect(result).toMatchObject({
      pairedCaseCount: 4,
      clusterCount: 3,
      iterations: 2_000,
      seed: 42,
      meanDifference: (1.5 - 1 + 3) / 3,
    });
    expect(result.confidenceInterval95.lower).toBeLessThan(result.meanDifference);
    expect(result.confidenceInterval95.upper).toBeGreaterThan(result.meanDifference);
  });

  it("uses 10,000 iterations and a fixed seed by default", () => {
    const input = [score("case-a", "cluster-a", 0)];
    const result = pairedClusterBootstrap(input, [
      score("case-a", "cluster-a", 1),
    ]);

    expect(result).toMatchObject({
      iterations: 10_000,
      seed: 0x5eed_c0de,
      meanDifference: 1,
      confidenceInterval95: { lower: 1, upper: 1 },
    });
  });

  it("rejects missing, repeated, malformed, or multiple cluster identities", () => {
    const candidate = [score("case-a", "cluster-a", 1)];
    for (const tags of [
      ["visual"],
      ["cluster-a", "cluster-a"],
      ["cluster-a", "cluster-b"],
      ["cluster-UPPER"],
    ]) {
      expect(() => pairedClusterBootstrap(
        [score("case-a", "cluster-a", 0, tags)],
        candidate,
        { iterations: 10 },
      )).toThrow(/exactly one valid cluster/);
    }
  });

  it("rejects duplicate case identities and unpaired cases", () => {
    expect(() => pairedClusterBootstrap(
      [
        score("case-a", "cluster-a", 0),
        score("case-a", "cluster-a", 1),
      ],
      [score("case-a", "cluster-a", 2)],
      { iterations: 10 },
    )).toThrow(/duplicate caseId case-a/);

    expect(() => pairedClusterBootstrap(
      [
        score("case-a", "cluster-a", 0),
        score("case-b", "cluster-b", 0),
      ],
      [
        score("case-a", "cluster-a", 1),
        score("case-c", "cluster-c", 1),
      ],
      { iterations: 10 },
    )).toThrow(/unpaired caseIds: case-b, case-c/);
  });

  it("rejects a paired case whose cluster identity changes between arms", () => {
    expect(() => pairedClusterBootstrap(
      [score("case-a", "cluster-a", 0)],
      [score("case-a", "cluster-b", 1)],
      { iterations: 10 },
    )).toThrow(/mismatched cluster identities/);
  });

  it("rejects invalid scores and randomization options", () => {
    expect(() => pairedClusterBootstrap(
      [score("case-a", "cluster-a", Number.NaN)],
      [score("case-a", "cluster-a", 1)],
      { iterations: 10 },
    )).toThrow(/finite value/);
    expect(() => pairedClusterBootstrap(
      [score("case-a", "cluster-a", 0)],
      [score("case-a", "cluster-a", 1)],
      { iterations: 0 },
    )).toThrow(/positive safe integer/);
    expect(() => pairedClusterBootstrap(
      [score("case-a", "cluster-a", 0)],
      [score("case-a", "cluster-a", 1)],
      { iterations: 10, seed: -1 },
    )).toThrow(/unsigned 32-bit integer/);
  });
});

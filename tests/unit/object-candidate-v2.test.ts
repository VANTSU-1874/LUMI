// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  resolveTextObjectConsensusV2,
  type ObjectCandidateV2,
} from "@/lib/knowledge/object-candidate-v2";
import type { ChannelCandidateV2 } from "@/lib/knowledge/rank-fusion-v2";

function hit(input: {
  channel: "LEXICAL" | "TEXT_VECTOR";
  candidateId: string;
  objectId: string;
  rank: number;
  rawScore?: number;
}): ChannelCandidateV2 {
  return {
    candidateId: input.candidateId,
    objectId: input.objectId,
    representationId: input.channel === "LEXICAL"
      ? null
      : `representation-${input.candidateId}`,
    nodeId: input.candidateId,
    assetId: null,
    region: null,
    rank: input.rank,
    rawScore: input.rawScore ?? 1,
  };
}

function objectCandidate(input: {
  channel: "LEXICAL" | "TEXT_VECTOR";
  objectId: string;
  objectRank: number;
  nodes: Array<{ nodeId: string; rawScore: number }>;
}): ObjectCandidateV2 {
  return {
    objectId: input.objectId,
    coursePackId: "layout-design",
    objectRank: input.objectRank,
    rawScore: input.nodes[0]!.rawScore,
    nodes: input.nodes.map((node, index) => ({
      nodeId: node.nodeId,
      objectId: input.objectId,
      nodeKind: "TEXT",
      representationId: input.channel === "LEXICAL"
        ? null
        : `representation-${node.nodeId}`,
      innerRank: index + 1,
      rawScore: node.rawScore,
    })),
  };
}

describe("T4.2 object consensus", () => {
  it("derives one exact real node only when both object-local lists contain it", () => {
    const result = resolveTextObjectConsensusV2({
      lexicalHits: [
        hit({
          channel: "LEXICAL",
          candidateId: "lexical-other-node",
          objectId: "target-object",
          rank: 1,
        }),
      ],
      textVectorHits: [
        hit({
          channel: "TEXT_VECTOR",
          candidateId: "vector-other-node",
          objectId: "target-object",
          rank: 1,
        }),
      ],
      lexicalObjects: [
        objectCandidate({
          channel: "LEXICAL",
          objectId: "target-object",
          objectRank: 1,
          nodes: [
            { nodeId: "lexical-other-node", rawScore: 9 },
            { nodeId: "shared-action-node", rawScore: 8 },
          ],
        }),
      ],
      textVectorObjects: [
        objectCandidate({
          channel: "TEXT_VECTOR",
          objectId: "target-object",
          objectRank: 1,
          nodes: [
            { nodeId: "vector-other-node", rawScore: 0.9 },
            { nodeId: "shared-action-node", rawScore: 0.8 },
          ],
        }),
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.rankings.LEXICAL).toEqual([
      expect.objectContaining({
        candidateId: "shared-action-node",
        objectId: "target-object",
        nodeId: "shared-action-node",
        representationId: null,
      }),
    ]);
    expect(result.rankings.TEXT_VECTOR).toEqual([
      expect.objectContaining({
        candidateId: "shared-action-node",
        objectId: "target-object",
        nodeId: "shared-action-node",
        representationId: "representation-shared-action-node",
      }),
    ]);
    expect(result.trace).toMatchObject({
      applied: true,
      objectRanking: [{
        objectId: "target-object",
        rank: 1,
        commonTextNodeIds: ["shared-action-node"],
        selectedNodeId: "shared-action-node",
      }],
      candidates: [{
        objectId: "target-object",
        selectedNodeId: "shared-action-node",
        source: "OBJECT_INNER_COMMON_TEXT",
      }],
    });
  });

  it("keeps original rankings when the same object has no real node intersection", () => {
    const lexicalHits = [
      hit({
        channel: "LEXICAL",
        candidateId: "lexical-node",
        objectId: "target-object",
        rank: 1,
      }),
    ];
    const textVectorHits = [
      hit({
        channel: "TEXT_VECTOR",
        candidateId: "vector-node",
        objectId: "target-object",
        rank: 1,
      }),
    ];
    const result = resolveTextObjectConsensusV2({
      lexicalHits,
      textVectorHits,
      lexicalObjects: [
        objectCandidate({
          channel: "LEXICAL",
          objectId: "target-object",
          objectRank: 1,
          nodes: [{ nodeId: "lexical-node", rawScore: 9 }],
        }),
      ],
      textVectorObjects: [
        objectCandidate({
          channel: "TEXT_VECTOR",
          objectId: "target-object",
          objectRank: 1,
          nodes: [{ nodeId: "vector-node", rawScore: 0.9 }],
        }),
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.rankings).toEqual({
      LEXICAL: lexicalHits,
      TEXT_VECTOR: textVectorHits,
    });
    expect(result.trace).toMatchObject({
      applied: false,
      objectRanking: [{
        objectId: "target-object",
        rank: 1,
        commonTextNodeIds: [],
        selectedNodeId: null,
      }],
      candidates: [],
    });
  });

  it("preserves one existing exact-node candidate for another object", () => {
    const result = resolveTextObjectConsensusV2({
      lexicalHits: [
        hit({
          channel: "LEXICAL",
          candidateId: "legacy-exact-node",
          objectId: "legacy-object",
          rank: 1,
        }),
        hit({
          channel: "LEXICAL",
          candidateId: "target-lexical",
          objectId: "target-object",
          rank: 2,
        }),
      ],
      textVectorHits: [
        hit({
          channel: "TEXT_VECTOR",
          candidateId: "legacy-exact-node",
          objectId: "legacy-object",
          rank: 1,
        }),
        hit({
          channel: "TEXT_VECTOR",
          candidateId: "target-vector",
          objectId: "target-object",
          rank: 2,
        }),
      ],
      lexicalObjects: [
        objectCandidate({
          channel: "LEXICAL",
          objectId: "target-object",
          objectRank: 1,
          nodes: [
            { nodeId: "target-lexical", rawScore: 9 },
            { nodeId: "target-shared", rawScore: 8 },
          ],
        }),
      ],
      textVectorObjects: [
        objectCandidate({
          channel: "TEXT_VECTOR",
          objectId: "target-object",
          objectRank: 1,
          nodes: [
            { nodeId: "target-vector", rawScore: 0.9 },
            { nodeId: "target-shared", rawScore: 0.8 },
          ],
        }),
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.trace.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        objectId: "target-object",
        source: "OBJECT_INNER_COMMON_TEXT",
      }),
      expect.objectContaining({
        objectId: "legacy-object",
        source: "EXISTING_EXACT_NODE",
      }),
    ]));
    expect(result.rankings.LEXICAL.map(({ candidateId }) => candidateId))
      .toEqual(expect.arrayContaining(["target-shared", "legacy-exact-node"]));
  });
});

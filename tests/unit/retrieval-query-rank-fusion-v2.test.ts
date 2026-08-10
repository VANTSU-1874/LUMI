// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  applyPostFusionAcceptanceV2,
  createAcceptancePolicyV2,
  fuseRankedChannelsV2,
  RRF_K_V2,
  type ChannelCandidateV2,
} from "@/lib/knowledge/rank-fusion-v2";
import {
  createRetrievalQueryV2,
  RetrievalQueryV2Schema,
} from "@/lib/knowledge/retrieval-query-v2";

const HASH = "a".repeat(64);
const SCOPE = {
  corpusBundleHash: HASH,
  sourceCoursePack: { id: "layout-design" as const, version: "1" as const },
};

function candidate(
  candidateId: string,
  rank: number,
  overrides: Partial<ChannelCandidateV2> = {},
): ChannelCandidateV2 {
  return {
    candidateId,
    objectId: candidateId,
    representationId: null,
    nodeId: `node-${candidateId}`,
    assetId: null,
    region: null,
    rank,
    rawScore: null,
    ...overrides,
  };
}

describe("retrieval query V2", () => {
  it("keeps original and deterministic normalized text in separate fields", () => {
    const query = createRetrievalQueryV2({
      mode: "TEXT_TO_TEXT",
      text: "  标题　太抢了。\r\n先改哪里？  ",
      scope: SCOPE,
    });
    expect(query).toMatchObject({
      mode: "TEXT_TO_TEXT",
      originalText: "  标题　太抢了。\r\n先改哪里？  ",
      normalizedText: "标题 太抢了。 先改哪里?",
      queryAsset: null,
      excludeAssetIds: [],
    });
  });

  it("keeps image references opaque and excludes the query asset", () => {
    const query = createRetrievalQueryV2({
      mode: "IMAGE_TEXT_TO_EVIDENCE",
      text: "这张海报为什么读不顺？",
      queryAsset: { assetId: "asset-query", sha256: HASH },
      scope: SCOPE,
      excludeAssetIds: ["asset-other"],
    });
    expect(query.queryAsset).toEqual({ assetId: "asset-query", sha256: HASH });
    expect(query.excludeAssetIds).toEqual(["asset-other", "asset-query"]);
    expect(JSON.stringify(query)).not.toMatch(/(?:[A-Za-z]:\\\\|data\/courses)/);
  });

  it("strictly rejects evaluator truth and caller-authored normalization", () => {
    expect(() => createRetrievalQueryV2({
      mode: "TEXT_TO_TEXT",
      text: "字号是不是越大越好？",
      scope: SCOPE,
      expected: { objectId: "golden-answer" },
    } as never)).toThrow(/unrecognized/i);
    expect(() => RetrievalQueryV2Schema.parse({
      schemaVersion: 2,
      mode: "TEXT_TO_TEXT",
      originalText: "原话",
      normalizedText: "伪造标准答案",
      queryAsset: null,
      scope: SCOPE,
      excludeAssetIds: [],
    })).toThrow(/deterministically/i);
    expect(() => createRetrievalQueryV2({
      mode: "TEXT_TO_TEXT",
      text: "字".repeat(501),
      scope: SCOPE,
    })).toThrow();
    expect(() => createRetrievalQueryV2({
      mode: "NEGATIVE",
      text: "评测标签不能成为线上模式",
      scope: SCOPE,
    } as never)).toThrow();
  });
});

describe("rank-only RRF and post-fusion acceptance", () => {
  it("uses fixed k=60 and rank-only contributions with deterministic ties", () => {
    const first = fuseRankedChannelsV2({
      LEXICAL: [candidate("object-b", 1, { rawScore: 999 })],
      TEXT_VECTOR: [candidate("object-a", 1, { rawScore: -999 })],
    });
    expect(first.map(({ candidateId }) => candidateId)).toEqual(["object-a", "object-b"]);
    expect(first[0]?.fusionScore).toBeCloseTo(1 / (RRF_K_V2 + 1), 12);
    expect(first[0]?.channelTraces[0]).toMatchObject({
      channel: "TEXT_VECTOR",
      rawScore: -999,
    });
    const nodeTieBreak = fuseRankedChannelsV2({
      LEXICAL: [
        candidate("object-a", 1, { nodeId: "node-z" }),
      ],
      TEXT_VECTOR: [
        candidate("object-z", 1, { nodeId: "node-a" }),
      ],
    });
    expect(nodeTieBreak.map(({ candidateId }) => candidateId))
      .toEqual(["object-z", "object-a"]);

    const consensus = fuseRankedChannelsV2({
      LEXICAL: [candidate("object-a", 1)],
      TEXT_VECTOR: [candidate("object-a", 2), candidate("object-c", 1)],
    });
    expect(consensus[0]?.candidateId).toBe("object-a");
    expect(consensus[0]?.fusionScore).toBeCloseTo(
      1 / (RRF_K_V2 + 1) + 1 / (RRF_K_V2 + 2),
      12,
    );
  });

  it("requires normal cross-channel agreement and exposes explicit fallback decisions", () => {
    const policy = createAcceptancePolicyV2();
    expect(policy.eligibleMaxRank).toBe(20);
    expect(policy.version).toBe("1.0.0");
    const lexicalOnly = fuseRankedChannelsV2({
      LEXICAL: [candidate("node-a", 1, {
        objectId: "object-a",
        nodeId: "node-a",
        rawScore: 1_000,
      })],
    });
    const normalText = applyPostFusionAcceptanceV2(
      "TEXT_TO_TEXT",
      lexicalOnly,
      policy,
    );
    expect(normalText.accepted).toEqual([]);
    expect(normalText.trace.candidates[0]).toMatchObject({
      accepted: false,
      reasons: [],
    });

    const degraded = applyPostFusionAcceptanceV2(
      "TEXT_TO_TEXT",
      lexicalOnly,
      policy,
      { degradedLexicalFallback: true },
    );
    expect(degraded.accepted).toHaveLength(1);
    expect(degraded.trace).toMatchObject({
      degradedLexicalFallback: true,
      acceptedCount: 1,
    });
    expect(degraded.trace.candidates[0]?.reasons)
      .toEqual(["DEGRADED_LEXICAL_FALLBACK"]);
  });

  it("requires exact-node TEXT_TO_TEXT consensus and rejects weaker identity matches", () => {
    const exactNodeConsensus = fuseRankedChannelsV2({
      LEXICAL: [candidate("node-shared", 1, {
        objectId: "object-a",
        nodeId: "node-shared",
      })],
      TEXT_VECTOR: [candidate("node-shared", 1, {
        objectId: "object-a",
        nodeId: "node-shared",
      })],
    });
    const accepted = applyPostFusionAcceptanceV2(
      "TEXT_TO_TEXT",
      exactNodeConsensus,
    ).accepted;
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.channelTraces.map(({ channel, nodeId }) => ({
      channel,
      nodeId,
    }))).toEqual([
      { channel: "LEXICAL", nodeId: "node-shared" },
      { channel: "TEXT_VECTOR", nodeId: "node-shared" },
    ]);

    const sameObjectDifferentNode = fuseRankedChannelsV2({
      LEXICAL: [candidate("node-a-lexical", 1, {
        objectId: "object-a",
        nodeId: "node-a-lexical",
      })],
      TEXT_VECTOR: [candidate("node-a-vector", 1, {
        objectId: "object-a",
        nodeId: "node-a-vector",
      })],
    });
    expect(applyPostFusionAcceptanceV2(
      "TEXT_TO_TEXT",
      sameObjectDifferentNode,
    ).accepted).toEqual([]);

    const singleVector = fuseRankedChannelsV2({
      TEXT_VECTOR: [candidate("node-vector", 1, {
        objectId: "object-a",
        nodeId: "node-vector",
      })],
    });
    expect(applyPostFusionAcceptanceV2(
      "TEXT_TO_TEXT",
      singleVector,
    ).accepted).toEqual([]);

    expect(() => fuseRankedChannelsV2({
      LEXICAL: [candidate("node-shared", 1, {
        objectId: "object-a",
        nodeId: "node-shared",
      })],
      TEXT_VECTOR: [candidate("node-shared", 1, {
        objectId: "object-b",
        nodeId: "node-shared",
      })],
    })).toThrow(/cannot cross knowledge objects/i);
  });

  it("provisionally accepts a real visual seed for visual modes before final evidence-shape checks", () => {
    const visualOnly = fuseRankedChannelsV2({
      VISUAL_VECTOR: [candidate("object-a", 1, {
        assetId: "asset-a",
        rawScore: null,
      })],
    });
    expect(applyPostFusionAcceptanceV2(
      "IMAGE_TO_IMAGE",
      visualOnly,
    ).trace.candidates[0]?.reasons).toEqual(["MODE_SINGLE_VISUAL"]);
    expect(applyPostFusionAcceptanceV2(
      "IMAGE_TEXT_TO_EVIDENCE",
      visualOnly,
    ).accepted).toHaveLength(1);
    expect(applyPostFusionAcceptanceV2(
      "TEXT_TO_IMAGE",
      visualOnly,
    ).accepted).toHaveLength(1);
    expect(() => applyPostFusionAcceptanceV2(
      "IMAGE_TO_IMAGE",
      visualOnly,
      undefined,
      { degradedLexicalFallback: true },
    )).toThrow(/pure image/i);
  });

  it("rejects malformed channel rankings before fusion", () => {
    expect(() => fuseRankedChannelsV2({
      LEXICAL: [candidate("object-a", 2)],
    })).toThrow(/contiguous/i);
    expect(() => fuseRankedChannelsV2({
      LEXICAL: Array.from({ length: 21 }, (_, index) =>
        candidate(`object-${index}`, index + 1)),
    })).toThrow();
  });
});

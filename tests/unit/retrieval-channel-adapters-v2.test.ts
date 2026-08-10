// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  adaptLexicalCandidatesV2,
  adaptTextRetrievalResponseV2,
  adaptVisualRetrievalResponseV2,
} from "@/lib/knowledge/retrieval-channel-adapters-v2";
import { fuseRankedChannelsV2 } from "@/lib/knowledge/rank-fusion-v2";
import {
  SELF_HOSTED_TEXT_MODEL,
  TextRetrievalResponseSchema,
} from "@/lib/knowledge/text-retriever";
import { VisualRetrievalResponseSchema } from "@/lib/knowledge/visual-retriever";

const CORPUS_HASH = "a".repeat(64);
const ACTIVE_INDEX_HASH = "b".repeat(64);
const PROVIDER_INDEX_HASH = "c".repeat(64);
const CONFIG_HASH = "d".repeat(64);
const PAYLOAD_HASH = "e".repeat(64);
const baseMetadata = {
  expectedCorpusBundleHash: CORPUS_HASH,
  activeIndexBundleHash: ACTIVE_INDEX_HASH,
  expectedProviderIndexBundleHash: PROVIDER_INDEX_HASH,
  configHash: CONFIG_HASH,
  payloadHashes: [PAYLOAD_HASH],
};
const textMetadata = {
  ...baseMetadata,
  expectedIndexVersionId: "text-index",
  expectedModelId: SELF_HOSTED_TEXT_MODEL.id,
  expectedModelRevision: SELF_HOSTED_TEXT_MODEL.revision,
};
const visualMetadata = {
  ...baseMetadata,
  expectedIndexVersionId: "visual-index",
  expectedModelId: "google/siglip2-base-patch16-224",
  expectedModelRevision: PROVIDER_INDEX_HASH,
};

function textResponse() {
  return TextRetrievalResponseSchema.parse({
    status: "SUCCESS",
    reason: null,
    index: {
      corpusBundleHash: CORPUS_HASH,
      indexBundleHash: PROVIDER_INDEX_HASH,
      indexVersionId: "text-index",
      modelId: SELF_HOSTED_TEXT_MODEL.id,
      modelRevision: SELF_HOSTED_TEXT_MODEL.revision,
    },
    timing: { inferenceMs: 2, totalMs: 3 },
    objectCandidates: [{
      objectId: "object-a",
      coursePackId: "layout-design",
      objectRank: 1,
      objectScore: 0.7,
      nodes: [{
        representationId: "text-representation-a1",
        nodeId: "node-a1",
        innerRank: 1,
        score: 0.7,
        sourceKind: "NODE",
        nodeKind: "TEXT",
        role: "CONTENT",
        contentHash: PAYLOAD_HASH,
      }],
    }],
    hits: [
      {
        representationId: "text-representation-a1",
        nodeId: "node-a1",
        objectId: "object-a",
        coursePackId: "layout-design",
        rank: 1,
        score: 0.7,
        sourceKind: "NODE",
        nodeKind: "TEXT",
        role: "CONTENT",
        contentHash: PAYLOAD_HASH,
      },
      {
        representationId: "text-representation-a2",
        nodeId: "node-a2",
        objectId: "object-a",
        coursePackId: "layout-design",
        rank: 2,
        score: 0.6,
        sourceKind: "NODE",
        nodeKind: "SECTION",
        role: null,
        contentHash: PAYLOAD_HASH,
      },
      {
        representationId: "text-representation-b",
        nodeId: "node-b",
        objectId: "object-b",
        coursePackId: "layout-design",
        rank: 3,
        score: 0.5,
        sourceKind: "NODE",
        nodeKind: "DOCUMENT",
        role: null,
        contentHash: PAYLOAD_HASH,
      },
    ],
  });
}

function visualResponse() {
  return VisualRetrievalResponseSchema.parse({
    status: "SUCCESS",
    reason: null,
    index: {
      corpusBundleHash: CORPUS_HASH,
      indexBundleHash: PROVIDER_INDEX_HASH,
      indexVersionId: "visual-index",
      modelId: "google/siglip2-base-patch16-224",
      modelRevision: PROVIDER_INDEX_HASH,
    },
    timing: { queueMs: 1, inferenceMs: 2, totalMs: 3 },
    hits: [
      {
        assetId: "asset-a1",
        rank: 1,
        score: 0.8,
        region: {
          coordinateSpace: "NORMALIZED",
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.2,
          origin: "PATCH_MATCH",
        },
        representationId: "visual-representation-a1",
      },
      {
        assetId: "asset-a2",
        rank: 2,
        score: 0.7,
        region: null,
        representationId: "visual-representation-a2",
      },
      {
        assetId: "asset-b",
        rank: 3,
        score: 0.6,
        region: null,
        representationId: "visual-representation-b",
      },
    ],
  });
}

describe("retrieval channel adapters V2", () => {
  it("wraps scoped lexical object candidates in the active control-plane generation", () => {
    const adapted = adaptLexicalCandidatesV2([{
      candidateId: "object-a",
      objectId: "object-a",
      representationId: null,
      nodeId: "node-a1",
      assetId: null,
      region: null,
      rank: 1,
      rawScore: 12,
    }], {
      corpusBundleHash: CORPUS_HASH,
      activeIndexBundleHash: ACTIVE_INDEX_HASH,
      indexVersionId: "lexical-index",
      configHash: CONFIG_HASH,
      payloadHashes: [PAYLOAD_HASH],
    }, 0.5);
    expect(adapted).toMatchObject({
      summary: {
        channel: "LEXICAL",
        status: "SUCCESS",
        identity: {
          activeIndexBundleHash: ACTIVE_INDEX_HASH,
          providerIndexBundleHash: null,
          modelId: null,
        },
      },
      hits: [{ candidateId: "object-a", rank: 1 }],
    });
  });

  it("validates lexical node projection without rewriting its object owner", () => {
    const identity = {
      corpusBundleHash: CORPUS_HASH,
      activeIndexBundleHash: ACTIVE_INDEX_HASH,
      indexVersionId: "lexical-index",
      configHash: CONFIG_HASH,
      payloadHashes: [PAYLOAD_HASH],
    };
    const projected = adaptLexicalCandidatesV2([{
      candidateId: "node-a1",
      objectId: "object-a",
      representationId: null,
      nodeId: "node-a1",
      assetId: null,
      region: null,
      rank: 1,
      rawScore: 12,
    }], identity, 0.5, "NODE");

    expect(projected.hits[0]).toMatchObject({
      candidateId: "node-a1",
      objectId: "object-a",
      nodeId: "node-a1",
    });
    expect(() => adaptLexicalCandidatesV2([{
      ...projected.hits[0]!,
      candidateId: "object-a",
    }], identity, 0.5, "NODE")).toThrow(/node projection/i);
  });

  it("rejects vector representation identifiers inside lexical object candidates", () => {
    const identity = {
      corpusBundleHash: CORPUS_HASH,
      activeIndexBundleHash: ACTIVE_INDEX_HASH,
      indexVersionId: "lexical-index",
      configHash: CONFIG_HASH,
      payloadHashes: [PAYLOAD_HASH],
    };
    const lexicalHit = {
      candidateId: "object-a",
      objectId: "object-a",
      representationId: null,
      nodeId: "node-a1",
      assetId: null,
      region: null,
      rank: 1,
      rawScore: 12,
    } as const;

    expect(() => adaptLexicalCandidatesV2(
      [lexicalHit],
      identity,
      0.5,
      "OBJECT",
      undefined,
      [{
        objectId: "object-a",
        coursePackId: "layout-design",
        objectRank: 1,
        rawScore: 12,
        nodes: [{
          nodeId: "node-a1",
          objectId: "object-a",
          nodeKind: "TEXT",
          representationId: "forged-vector-id",
          innerRank: 1,
          rawScore: 12,
        }],
      }],
    )).toThrow(/lexical object candidate representations must be null/i);
  });

  it("canonicalizes multiple text nodes to one best object candidate", () => {
    const adapted = adaptTextRetrievalResponseV2(textResponse(), textMetadata);
    expect(adapted.hits).toEqual([
      expect.objectContaining({
        candidateId: "object-a",
        objectId: "object-a",
        representationId: "text-representation-a1",
        nodeId: "node-a1",
        rank: 1,
      }),
      expect.objectContaining({
        candidateId: "object-b",
        objectId: "object-b",
        representationId: "text-representation-b",
        nodeId: "node-b",
        rank: 2,
      }),
    ]);
    expect(adapted.summary.identity).toMatchObject({
      activeIndexBundleHash: ACTIVE_INDEX_HASH,
      providerIndexBundleHash: PROVIDER_INDEX_HASH,
      payloadHashes: [PAYLOAD_HASH],
    });
  });

  it("keeps raw ranked text nodes for TEXT_TO_TEXT node projection", () => {
    const adapted = adaptTextRetrievalResponseV2(
      textResponse(),
      textMetadata,
      "NODE",
    );
    expect(adapted.hits).toEqual([
      expect.objectContaining({
        candidateId: "node-a1",
        objectId: "object-a",
        nodeId: "node-a1",
        rank: 1,
      }),
      expect.objectContaining({
        candidateId: "node-a2",
        objectId: "object-a",
        nodeId: "node-a2",
        rank: 2,
      }),
      expect.objectContaining({
        candidateId: "node-b",
        objectId: "object-b",
        nodeId: "node-b",
        rank: 3,
      }),
    ]);
    expect(adapted.objectCandidates).toEqual([{
      objectId: "object-a",
      coursePackId: "layout-design",
      objectRank: 1,
      rawScore: 0.7,
      nodes: [{
        nodeId: "node-a1",
        objectId: "object-a",
        nodeKind: "TEXT",
        representationId: "text-representation-a1",
        innerRank: 1,
        rawScore: 0.7,
      }],
    }]);
  });

  it("canonicalizes multiple visual assets to their best owning object and preserves region", () => {
    const adapted = adaptVisualRetrievalResponseV2(
      visualResponse(),
      visualMetadata,
      new Map([
        ["asset-a1", { objectId: "object-a", imageNodeId: "node-image-a1" }],
        ["asset-a2", { objectId: "object-a", imageNodeId: "node-image-a2" }],
        ["asset-b", { objectId: "object-b", imageNodeId: "node-image-b" }],
      ]),
    );
    expect(adapted.hits).toEqual([
      expect.objectContaining({
        candidateId: "object-a",
        objectId: "object-a",
        representationId: "visual-representation-a1",
        nodeId: "node-image-a1",
        assetId: "asset-a1",
        region: expect.objectContaining({ origin: "PATCH_MATCH" }),
        rank: 1,
      }),
      expect.objectContaining({
        candidateId: "object-b",
        objectId: "object-b",
        representationId: "visual-representation-b",
        nodeId: "node-image-b",
        assetId: "asset-b",
        rank: 2,
      }),
    ]);
    expect(adapted.visualAssetHits?.map(({ objectId, assetId, rank }) => ({
      objectId,
      assetId,
      rank,
    }))).toEqual([
      { objectId: "object-a", assetId: "asset-a1", rank: 1 },
      { objectId: "object-a", assetId: "asset-a2", rank: 2 },
      { objectId: "object-b", assetId: "asset-b", rank: 3 },
    ]);
  });

  it("sorts explicit sidecar ranks before object deduplication", () => {
    const text = textResponse();
    const adaptedText = adaptTextRetrievalResponseV2({
      ...text,
      hits: [...text.hits].reverse(),
    }, textMetadata);
    expect(adaptedText.hits.map(({ objectId, nodeId }) => [objectId, nodeId])).toEqual([
      ["object-a", "node-a1"],
      ["object-b", "node-b"],
    ]);

    const visual = visualResponse();
    const adaptedVisual = adaptVisualRetrievalResponseV2({
      ...visual,
      hits: [...visual.hits].reverse(),
    }, visualMetadata, new Map([
      ["asset-a1", { objectId: "object-a", imageNodeId: "node-image-a1" }],
      ["asset-a2", { objectId: "object-a", imageNodeId: "node-image-a2" }],
      ["asset-b", { objectId: "object-b", imageNodeId: "node-image-b" }],
    ]));
    expect(adaptedVisual.hits.map(({ objectId, assetId }) => [objectId, assetId])).toEqual([
      ["object-a", "asset-a1"],
      ["object-b", "asset-b"],
    ]);
  });

  it("maps evaluated empty and failed sidecar status without inventing identity", () => {
    const empty = adaptTextRetrievalResponseV2(
      TextRetrievalResponseSchema.parse({
        status: "EMPTY",
        reason: null,
        hits: [],
        index: textResponse().index,
        timing: { inferenceMs: 1, totalMs: 1 },
      }),
      textMetadata,
    );
    expect(empty).toMatchObject({
      summary: { status: "EMPTY", reason: null, identity: expect.any(Object), hitCount: 0 },
      hits: [],
    });
    const timeout = adaptVisualRetrievalResponseV2(
      VisualRetrievalResponseSchema.parse({
        status: "TIMEOUT",
        reason: "DEADLINE_EXCEEDED",
        hits: [],
        index: null,
        timing: { queueMs: 0, inferenceMs: 0, totalMs: 10 },
      }),
      visualMetadata,
      new Map(),
    );
    expect(timeout).toMatchObject({
      summary: {
        status: "TIMEOUT",
        reason: "DEADLINE_EXCEEDED",
        identity: null,
        hitCount: 0,
      },
      hits: [],
    });
  });

  it("fails closed when a visual asset has no immutable V2 owner mapping", () => {
    const adapted = adaptVisualRetrievalResponseV2(
      visualResponse(),
      visualMetadata,
      new Map(),
    );
    expect(adapted).toMatchObject({
      summary: {
        status: "ERROR",
        reason: "INVALID_RESPONSE",
        identity: null,
      },
      hits: [],
    });
  });

  it("makes text nodes and visual assets converge on objectId before RRF", () => {
    const text = adaptTextRetrievalResponseV2(textResponse(), textMetadata);
    const visual = adaptVisualRetrievalResponseV2(
      visualResponse(),
      visualMetadata,
      new Map([
        ["asset-a1", { objectId: "object-a", imageNodeId: "node-image-a1" }],
        ["asset-a2", { objectId: "object-a", imageNodeId: "node-image-a2" }],
        ["asset-b", { objectId: "object-b", imageNodeId: "node-image-b" }],
      ]),
    );
    const fused = fuseRankedChannelsV2({
      TEXT_VECTOR: text.hits,
      VISUAL_VECTOR: visual.hits,
    });
    expect(fused[0]).toMatchObject({
      candidateId: "object-a",
      objectId: "object-a",
      channelTraces: [
        expect.objectContaining({
          channel: "TEXT_VECTOR",
          nodeId: "node-a1",
          representationId: "text-representation-a1",
        }),
        expect.objectContaining({
          channel: "VISUAL_VECTOR",
          nodeId: "node-image-a1",
          assetId: "asset-a1",
          representationId: "visual-representation-a1",
        }),
      ],
    });
  });

  it.each([
    ["provider hash", { indexBundleHash: "f".repeat(64) }],
    ["index version", { indexVersionId: "other-visual-index" }],
    ["model id", { modelId: "other/visual-model" }],
    ["model revision", { modelRevision: "f".repeat(64) }],
  ])("fails closed on visual %s drift", (_label, drift) => {
    const response = visualResponse();
    const adapted = adaptVisualRetrievalResponseV2(
      VisualRetrievalResponseSchema.parse({
        ...response,
        index: { ...response.index!, ...drift },
      }),
      visualMetadata,
      new Map([
        ["asset-a1", { objectId: "object-a", imageNodeId: "node-image-a1" }],
        ["asset-a2", { objectId: "object-a", imageNodeId: "node-image-a2" }],
        ["asset-b", { objectId: "object-b", imageNodeId: "node-image-b" }],
      ]),
    );
    expect(adapted).toMatchObject({
      summary: {
        status: "ERROR",
        reason: "INDEX_IDENTITY_MISMATCH",
        identity: null,
      },
      hits: [],
    });
  });
});

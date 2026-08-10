// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assembleEvidenceBundleV2,
  EVIDENCE_LIMITS_V2,
  EvidenceBundleV2Schema,
  type EvidenceChannelV2,
  type EvidenceExpansionV2,
  type EvidenceProvenanceV2,
} from "@/lib/knowledge/evidence-bundle-v2";
import {
  applyPostFusionAcceptanceV2,
  fuseRankedChannelsV2,
} from "@/lib/knowledge/rank-fusion-v2";
import { createRetrievalQueryV2 } from "@/lib/knowledge/retrieval-query-v2";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const PACK = { id: "layout-design" as const, version: "1" as const };

const query = createRetrievalQueryV2({
  mode: "TEXT_TO_TEXT",
  text: "标题和正文都很抢，先改哪里？",
  scope: { corpusBundleHash: HASH_A, sourceCoursePack: PACK },
});

const fused = fuseRankedChannelsV2({
  LEXICAL: [{
    candidateId: "node-primary",
    objectId: "object-a",
    representationId: null,
    nodeId: "node-primary",
    assetId: null,
    region: null,
    rank: 1,
    rawScore: 12,
  }],
  TEXT_VECTOR: [{
    candidateId: "node-primary",
    objectId: "object-a",
    representationId: "representation-object-a",
    nodeId: "node-primary",
    assetId: null,
    region: null,
    rank: 1,
    rawScore: 0.5,
  }],
});
const acceptance = applyPostFusionAcceptanceV2("TEXT_TO_TEXT", fused).trace;

function identity(channel: EvidenceChannelV2["channel"]) {
  return {
    activeIndexBundleHash: HASH_B,
    providerIndexBundleHash: channel === "LEXICAL" ? null : HASH_C,
    indexVersionId: `${channel.toLowerCase().replace("_", "-")}-index`,
    modelId: channel === "LEXICAL" ? null : "BAAI/bge-small-zh-v1.5",
    modelRevision: channel === "LEXICAL" ? null : HASH_C,
    configHash: HASH_C,
    payloadHashes: [HASH_C],
  };
}

const channels: EvidenceChannelV2[] = [
  {
    channel: "LEXICAL",
    status: "SUCCESS",
    reason: null,
    corpusBundleHash: HASH_A,
    identity: identity("LEXICAL"),
    hitCount: 1,
    timingMs: 1,
  },
  {
    channel: "TEXT_VECTOR",
    status: "SUCCESS",
    reason: null,
    corpusBundleHash: HASH_A,
    identity: identity("TEXT_VECTOR"),
    hitCount: 1,
    timingMs: 2,
  },
  {
    channel: "VISUAL_VECTOR",
    status: "SKIPPED",
    reason: "MODE_NOT_APPLICABLE",
    corpusBundleHash: HASH_A,
    identity: null,
    hitCount: 0,
    timingMs: 0,
  },
];

const provenance: EvidenceProvenanceV2 = {
  corpusBundleHash: HASH_A,
  activeIndexBundleHash: HASH_B,
  relationConfigHash: HASH_C,
  normalizerConfigHash: HASH_C,
  rrfConfigHash: HASH_C,
  acceptancePolicyHash: acceptance.policyConfigHash,
  graphExpansion: "POST_FUSION",
  externalVerification: {
    required: false,
    claimKinds: [],
    authorized: true,
    matchedSourceIds: [],
    matchedSources: [],
    reason: "NOT_REQUIRED",
  },
  fallbackTriggers: [],
  capabilitiesLost: [],
};

function expansion(): EvidenceExpansionV2 {
  return {
    nodes: [
      {
        nodeId: "node-primary",
        objectId: "object-a",
        kind: "TEXT",
        relation: "PRIMARY",
        seedCandidateId: "node-primary",
        parentNodeId: "node-parent",
        sourceId: "source-a",
        sourceCoursePack: PACK,
        excerpt: "主证据".repeat(2_500),
        assetId: null,
      },
      {
        nodeId: "node-parent",
        objectId: "object-a",
        kind: "SECTION",
        relation: "PARENT",
        seedCandidateId: "node-primary",
        parentNodeId: "node-root",
        sourceId: "source-a",
        sourceCoursePack: PACK,
        excerpt: "父级".repeat(2_500),
        assetId: null,
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        nodeId: `node-sibling-${index}`,
        objectId: "object-a",
        kind: "TEXT" as const,
        relation: "SIBLING" as const,
        seedCandidateId: "node-primary",
        parentNodeId: "node-parent",
        sourceId: "source-a",
        sourceCoursePack: PACK,
        excerpt: "同级上下文".repeat(1_000),
        assetId: null,
      })),
    ],
    assets: Array.from({ length: 8 }, (_, index) => ({
      assetId: `asset-${index}`,
      objectId: "object-a",
      sha256: HASH_C,
      mimeType: "image/png" as const,
      dimensions: { widthPx: 100, heightPx: 200 },
    })),
    regions: Array.from({ length: 8 }, (_, index) => ({
      regionId: `region-${index}`,
      imageNodeId: `node-image-${index}`,
      regionNodeId: null,
      objectId: "object-a",
      assetId: `asset-${index}`,
      bbox: {
        coordinateSpace: "NORMALIZED" as const,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.2,
      },
      origin: "PATCH_MATCH" as const,
    })),
    sources: [{
      sourceId: "source-a",
      objectId: "object-a",
      authority: "COURSE_DESIGN",
      verifiedDate: "2026-07-28",
      scope: "版式设计课程内部语料。",
      locators: [{
        kind: "LOCAL_DOCUMENT",
        path: "data/courses/layout-design/001-example.md",
      }],
    }],
  };
}

describe("EvidenceBundleV2", () => {
  it("caps post-fusion graph context, text, assets and regions deterministically", () => {
    const bundle = assembleEvidenceBundleV2({
      status: "SUCCESS",
      query,
      channels,
      fused,
      acceptance,
      expansion: expansion(),
      provenance,
      timing: { retrievalMs: 3, expansionMs: 1, totalMs: 4 },
    });
    expect(bundle.evidence.primary).toHaveLength(1);
    expect(bundle.evidence.nodes.filter(({ relation }) => relation === "PARENT"))
      .toHaveLength(1);
    expect(bundle.evidence.nodes.filter(({ relation }) => relation === "SIBLING"))
      .toHaveLength(EVIDENCE_LIMITS_V2.siblings);
    expect(bundle.evidence.assets).toHaveLength(EVIDENCE_LIMITS_V2.assets);
    expect(bundle.evidence.regions).toHaveLength(EVIDENCE_LIMITS_V2.regions);
    expect(bundle.evidence.nodes.reduce(
      (total, node) => total + (node.excerpt?.length ?? 0),
      0,
    )).toBe(EVIDENCE_LIMITS_V2.excerptCharacters);
    expect(Buffer.byteLength(JSON.stringify(bundle), "utf8"))
      .toBeLessThanOrEqual(EVIDENCE_LIMITS_V2.jsonBytes);
    expect(bundle.evidence.regions[0]).toMatchObject({
      imageNodeId: "node-image-0",
      regionNodeId: null,
    });
    expect(bundle.channels[1]?.identity).toMatchObject({
      activeIndexBundleHash: HASH_B,
      providerIndexBundleHash: HASH_C,
    });
  });

  it("requires exactly one real owner node for every retained primary", () => {
    const missingOwner = expansion();
    missingOwner.nodes = missingOwner.nodes.filter(({ relation }) => relation !== "PRIMARY");
    expect(() => assembleEvidenceBundleV2({
      status: "SUCCESS",
      query,
      channels,
      fused,
      acceptance,
      expansion: missingOwner,
      provenance,
      timing: { retrievalMs: 3, expansionMs: 1, totalMs: 4 },
    })).toThrow(/primary owner/i);
  });

  it("rejects absolute, traversal and backslash source locators", () => {
    const valid = assembleEvidenceBundleV2({
      status: "SUCCESS",
      query,
      channels,
      fused,
      acceptance,
      expansion: expansion(),
      provenance,
      timing: { retrievalMs: 3, expansionMs: 1, totalMs: 4 },
    });
    for (const path of [
      "E:/secret.md",
      "data/courses/../secret.md",
      "data\\courses\\secret.md",
      ".runtime/knowledge/secret.md",
    ]) {
      expect(() => EvidenceBundleV2Schema.parse({
        ...valid,
        sources: [{
          ...valid.sources[0],
          locators: [{ kind: "LOCAL_DOCUMENT", path }],
        }],
      })).toThrow(/path/i);
    }
  });

  it("rejects active generation drift without conflating provider sidecar hashes", () => {
    expect(() => EvidenceBundleV2Schema.parse({
      ...assembleEvidenceBundleV2({
        status: "SUCCESS",
        query,
        channels,
        fused,
        acceptance,
        expansion: expansion(),
        provenance,
        timing: { retrievalMs: 3, expansionMs: 1, totalMs: 4 },
      }),
      channels: channels.map((channel) =>
        channel.channel === "TEXT_VECTOR"
          ? {
              ...channel,
              identity: {
                ...channel.identity!,
                activeIndexBundleHash: HASH_A,
              },
            }
          : channel),
    })).toThrow(/active index/i);
  });

  it("does not let an IMAGE or TEXT node masquerade as a canonical REGION node", () => {
    const valid = assembleEvidenceBundleV2({
      status: "SUCCESS",
      query,
      channels,
      fused,
      acceptance,
      expansion: expansion(),
      provenance,
      timing: { retrievalMs: 3, expansionMs: 1, totalMs: 4 },
    });
    expect(() => EvidenceBundleV2Schema.parse({
      ...valid,
      evidence: {
        ...valid.evidence,
        regions: valid.evidence.regions.map((region, index) =>
          index === 0 ? { ...region, regionNodeId: "node-primary" } : region),
      },
    })).toThrow(/real REGION/i);
  });

  it("requires every node source to belong to the same knowledge object", () => {
    const valid = assembleEvidenceBundleV2({
      status: "SUCCESS",
      query,
      channels,
      fused,
      acceptance,
      expansion: expansion(),
      provenance,
      timing: { retrievalMs: 3, expansionMs: 1, totalMs: 4 },
    });
    expect(() => EvidenceBundleV2Schema.parse({
      ...valid,
      sources: valid.sources.map((source) => ({
        ...source,
        objectId: "object-b",
      })),
    })).toThrow(/same knowledge object/i);
  });

  it("does not claim external authorization after its verified source is capped or omitted", () => {
    const valid = assembleEvidenceBundleV2({
      status: "SUCCESS",
      query,
      channels,
      fused,
      acceptance,
      expansion: expansion(),
      provenance,
      timing: { retrievalMs: 3, expansionMs: 1, totalMs: 4 },
    });
    expect(() => EvidenceBundleV2Schema.parse({
      ...valid,
      provenance: {
        ...valid.provenance,
        externalVerification: {
          required: true,
          claimKinds: ["AUTHORIZATION"],
          authorized: true,
          matchedSourceIds: ["source-official"],
          matchedSources: [{
            sourceId: "source-official",
            verifiedDate: "2026-07-28",
          }],
          reason: "AUTHORITATIVE_SOURCE_FOUND",
        },
      },
    })).toThrow(/final evidence/i);
  });

  it("retains every selected official source even when one node cannot reference them all", () => {
    const verifiedSources = ["source-official-auth", "source-official-price"].map((sourceId) => ({
      sourceId,
      objectId: "object-a",
      authority: "OFFICIAL" as const,
      verifiedDate: "2026-07-28",
      scope: "同一课程对象的外部核验来源。",
      locators: [{
        kind: "URL" as const,
        url: `https://example.com/${sourceId}`,
      }],
    }));
    const externalExpansion = expansion();
    externalExpansion.sources.push(...verifiedSources);
    const bundle = assembleEvidenceBundleV2({
      status: "SUCCESS",
      query,
      channels,
      fused,
      acceptance,
      expansion: externalExpansion,
      provenance: {
        ...provenance,
        externalVerification: {
          required: true,
          claimKinds: ["AUTHORIZATION", "PRICE"],
          authorized: true,
          matchedSourceIds: verifiedSources.map(({ sourceId }) => sourceId),
          matchedSources: verifiedSources.map(({ sourceId, verifiedDate }) => ({
            sourceId,
            verifiedDate,
          })),
          reason: "AUTHORITATIVE_SOURCE_FOUND",
        },
      },
      timing: { retrievalMs: 3, expansionMs: 1, totalMs: 4 },
    });
    expect(bundle.sources.slice(0, 2).map(({ sourceId }) => sourceId)).toEqual([
      "source-official-auth",
      "source-official-price",
    ]);
  });
});

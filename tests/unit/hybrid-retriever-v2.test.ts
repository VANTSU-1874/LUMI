// @vitest-environment node

import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  createCapabilityEntityManifestV2,
  createPackCompetitionCalibrationV2,
  PACK_COMPETITION_POLICY_V2,
} from "@/lib/knowledge/capability-boundary-v2";
import { EvidenceBundleV2Schema } from "@/lib/knowledge/evidence-bundle-v2";
import {
  ChannelRetrievalResultV2Schema,
  createHybridRetrieverV2,
  evaluateExternalVerificationV2,
  evaluateExternalVerificationWithPrerequisiteShadowV3,
  HYBRID_RRF_CONFIG_V2,
  type ChannelRetrievalResultV2,
  type HybridRetrieverV2Dependencies,
  type RetrievalChannelProviderV2,
} from "@/lib/knowledge/hybrid-retriever-v2";
import { sha256StableJsonV2 } from "@/lib/knowledge/knowledge-object-v2";
import {
  createAcceptancePolicyV2,
  type ChannelCandidateV2,
  type FusedCandidateV2,
  type RetrievalChannelV2,
} from "@/lib/knowledge/rank-fusion-v2";
import {
  DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2,
  PRIMARY_EVIDENCE_BINDING_ALGORITHM_HASH_V2,
  QUERY_EVIDENCE_FEATURE_ALGORITHM_HASH_V2,
  type QueryEvidenceAdequacyRuntimeV2,
} from "@/lib/knowledge/query-evidence-adequacy-v2";
import {
  TEXT_OBJECT_CONSENSUS_CONFIG_HASH_V2,
} from "@/lib/knowledge/object-candidate-v2";
import {
  createRetrievalQueryV2,
  type RetrievalQueryV2,
} from "@/lib/knowledge/retrieval-query-v2";
import { RetrievalGoldenSuiteSchema } from "@/lib/knowledge/retrieval-quality";

const CORPUS_HASH = "a".repeat(64);
const ACTIVE_INDEX_HASH = "b".repeat(64);
const PROVIDER_INDEX_HASH = "c".repeat(64);
const CONFIG_HASH = "d".repeat(64);
const PAYLOAD_HASH = "e".repeat(64);
const LEXICAL_PACK_COMPETITION_ALGORITHM_HASH = "1".repeat(64);
const TEXT_PACK_COMPETITION_ALGORITHM_HASH = "2".repeat(64);
const PACK = { id: "layout-design" as const, version: "1" as const };
const DIGITAL_PACK = {
  id: "digital-interaction" as const,
  version: "1" as const,
};
const TEXT_MODEL_ID = "test/text_vector";
const CANONICAL_PRIMARY_TEXT =
  "先确认阅读任务，再调整标题与正文的层级关系。";

function capabilityBoundaryFixture(): NonNullable<
  HybridRetrieverV2Dependencies["capabilityBoundary"]
> {
  const manifest = createCapabilityEntityManifestV2({
    corpusBundleHash: CORPUS_HASH,
    entities: [{
      entityId: "digital-osc-out",
      ownerCoursePack: DIGITAL_PACK,
      scope: "COURSE_EXCLUSIVE",
      evidenceObjectIds: ["object-digital"],
      aliases: [{
        text: "OSC Out CHOP",
        classification: "EXCLUSIVE",
      }],
    }],
  });
  const calibration = createPackCompetitionCalibrationV2({
    developmentSuiteHash: PAYLOAD_HASH,
    corpusBundleHash: CORPUS_HASH,
    lexicalConfigHash: CONFIG_HASH,
    normalizerConfigHash: CONFIG_HASH,
    textProviderIndexBundleHash: PROVIDER_INDEX_HASH,
    textModelId: TEXT_MODEL_ID,
    textModelRevision: PROVIDER_INDEX_HASH,
    lexicalPackCompetitionAlgorithmHash:
      LEXICAL_PACK_COMPETITION_ALGORITHM_HASH,
    textPackCompetitionAlgorithmHash:
      TEXT_PACK_COMPETITION_ALGORITHM_HASH,
    capabilityEntityManifestHash: manifest.configHash,
    packCompetitionPolicyHash: PACK_COMPETITION_POLICY_V2.configHash,
    channels: {
      LEXICAL: {
        minimumForeignPackMargin: 0.1,
        scopedSufficiencyFloor: 0.5,
        minimumDistinctObjects: 5,
      },
      TEXT_VECTOR: {
        minimumForeignPackMargin: 0.1,
        scopedSufficiencyFloor: 0.5,
        minimumDistinctObjects: 5,
      },
    },
  });
  return {
    manifest,
    policy: PACK_COMPETITION_POLICY_V2,
    calibration,
    runtimeIdentity: {
      lexicalConfigHash: CONFIG_HASH,
      textProviderIndexBundleHash: PROVIDER_INDEX_HASH,
      textModelId: TEXT_MODEL_ID,
      textModelRevision: PROVIDER_INDEX_HASH,
      lexicalPackCompetitionAlgorithmHash:
        LEXICAL_PACK_COMPETITION_ALGORITHM_HASH,
      textPackCompetitionAlgorithmHash:
        TEXT_PACK_COMPETITION_ALGORITHM_HASH,
    },
  };
}

function sourceCoursePacksWithBoundaryEvidence():
  HybridRetrieverV2Dependencies["sourceCoursePackByObjectId"] {
  return new Map<string, typeof PACK | typeof DIGITAL_PACK>([
    ["object-a", PACK],
    ["object-b", PACK],
    ["object-digital", DIGITAL_PACK],
  ]);
}

function packCompetitionObservation(
  channel: Extract<RetrievalChannelV2, "LEXICAL" | "TEXT_VECTOR">,
) {
  const representationId = channel === "LEXICAL" ? null : "representation-winner";
  const digitalWinner = {
    coursePackId: DIGITAL_PACK.id,
    objectCount: 5,
    objectId: "object-digital",
    representationId,
    nodeId: "node-digital",
    score: channel === "LEXICAL" ? 0.8 : 0.7,
  };
  const layoutWinner = {
    coursePackId: PACK.id,
    objectCount: 5,
    objectId: "object-a",
    representationId,
    nodeId: "node-owner",
    score: channel === "LEXICAL" ? 0.2 : 0.3,
  };
  return {
    status: "AVAILABLE" as const,
    reason: null,
    packCompetition: {
      schemaVersion: 1 as const,
      scoreMetric: channel === "LEXICAL"
        ? "LEXICAL_NORMALIZED_SCORE" as const
        : "COSINE_SIMILARITY" as const,
      objectDeduplication: "BEST_REPRESENTATION_PER_OBJECT" as const,
      packWinnerSelection: "BEST_OBJECT_PER_PACK" as const,
      globalWinnerSelection: "BEST_PACK_WINNER" as const,
      sourceScope: { coursePackId: PACK.id },
      scoredRepresentationCount: 10,
      deduplicatedObjectCount: 10,
      perPackWinners: [digitalWinner, layoutWinner],
      globalWinner: digitalWinner,
      scopedWinner: layoutWinner,
      globalToScopedMargin: digitalWinner.score - layoutWinner.score,
    },
  };
}

function candidate(
  channel: RetrievalChannelV2,
  candidateId = "object-a",
): ChannelCandidateV2 {
  return {
    candidateId,
    objectId: candidateId,
    representationId: channel === "LEXICAL"
      ? null
      : `representation-${channel.toLowerCase().replaceAll("_", "-")}`,
    nodeId: "node-owner",
    assetId: channel === "VISUAL_VECTOR" ? "asset-result" : null,
    region: channel === "VISUAL_VECTOR"
      ? {
          coordinateSpace: "NORMALIZED",
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.2,
          origin: "PATCH_MATCH",
        }
      : null,
    rank: 1,
    rawScore: channel === "LEXICAL" ? 12 : 0.4,
  };
}

function candidateForQuery(
  channel: RetrievalChannelV2,
  retrievalQuery: RetrievalQueryV2,
  objectId = "object-a",
) {
  const hit = candidate(channel, objectId);
  return retrievalQuery.mode === "TEXT_TO_TEXT" && channel !== "VISUAL_VECTOR"
    ? { ...hit, candidateId: hit.nodeId! }
    : hit;
}

function result(
  channel: RetrievalChannelV2,
  hits: ChannelCandidateV2[],
): ChannelRetrievalResultV2 {
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel,
      status: hits.length > 0 ? "SUCCESS" : "EMPTY",
      reason: null,
      corpusBundleHash: CORPUS_HASH,
      identity: {
        activeIndexBundleHash: ACTIVE_INDEX_HASH,
        providerIndexBundleHash: channel === "LEXICAL" ? null : PROVIDER_INDEX_HASH,
        indexVersionId: `${channel.toLowerCase().replace("_", "-")}-index`,
        modelId: channel === "LEXICAL" ? null : `test/${channel.toLowerCase()}`,
        modelRevision: channel === "LEXICAL" ? null : PROVIDER_INDEX_HASH,
        configHash: CONFIG_HASH,
        payloadHashes: [PAYLOAD_HASH],
      },
      hitCount: hits.length,
      timingMs: 1,
    },
    hits,
    visualAssetHits: channel === "VISUAL_VECTOR"
      ? hits.map((hit) => ({
          objectId: hit.objectId,
          representationId: hit.representationId!,
          nodeId: hit.nodeId!,
          assetId: hit.assetId!,
          region: hit.region,
          rank: hit.rank,
          rawScore: hit.rawScore,
        }))
      : undefined,
  });
}

function provider(
  channel: RetrievalChannelV2,
  behavior: "SUCCESS" | "EMPTY" | "THROW" = "SUCCESS",
): RetrievalChannelProviderV2 & { retrieve: ReturnType<typeof vi.fn> } {
  return {
    retrieve: vi.fn(async (retrievalQuery: RetrievalQueryV2) => {
      if (behavior === "THROW") throw new Error("injected provider failure");
      return result(
        channel,
        behavior === "SUCCESS"
          ? [candidateForQuery(channel, retrievalQuery)]
          : [],
      );
    }),
  };
}

function providerWithPackCompetition(
  channel: Extract<RetrievalChannelV2, "LEXICAL" | "TEXT_VECTOR">,
  packCompetition: unknown = packCompetitionObservation(channel),
): RetrievalChannelProviderV2 & { retrieve: ReturnType<typeof vi.fn> } {
  return {
    retrieve: vi.fn(async (retrievalQuery: RetrievalQueryV2) => ({
      ...result(channel, [candidateForQuery(channel, retrievalQuery)]),
      packCompetition,
    })),
  };
}

function captionProvider(
  behavior: "SUCCESS" | "EMPTY" | "THROW" = "SUCCESS",
): RetrievalChannelProviderV2 & { retrieve: ReturnType<typeof vi.fn> } {
  return {
    retrieve: vi.fn(async () => {
      if (behavior === "THROW") throw new Error("injected caption failure");
      const hits = behavior === "SUCCESS"
        ? [
            {
              candidateId: "asset-a1",
              objectId: "object-a",
              representationId: null,
              nodeId: "node-image-a1",
              assetId: "asset-a1",
              region: null,
              rank: 2,
              rawScore: 20,
            },
            {
              candidateId: "asset-b",
              objectId: "object-b",
              representationId: null,
              nodeId: "node-image-b",
              assetId: "asset-b",
              region: null,
              rank: 3,
              rawScore: 15,
            },
            {
              candidateId: "asset-a2",
              objectId: "object-a",
              representationId: null,
              nodeId: "node-image-a2",
              assetId: "asset-a2",
              region: null,
              rank: 1,
              rawScore: 25,
            },
          ]
        : [];
      return {
        summary: {
          channel: "LEXICAL",
          status: hits.length > 0 ? "SUCCESS" : "EMPTY",
          reason: null,
          corpusBundleHash: CORPUS_HASH,
          identity: {
            activeIndexBundleHash: ACTIVE_INDEX_HASH,
            providerIndexBundleHash: null,
            indexVersionId: "caption-lexical-index",
            modelId: null,
            modelRevision: null,
            configHash: CONFIG_HASH,
            payloadHashes: [PAYLOAD_HASH],
          },
          hitCount: hits.length,
          timingMs: 1,
        },
        hits,
      };
    }),
  };
}

function query(mode: RetrievalQueryV2["mode"], text = "这张版式为什么读不顺？") {
  const scope = { corpusBundleHash: CORPUS_HASH, sourceCoursePack: PACK };
  if (mode === "TEXT_TO_TEXT" || mode === "TEXT_TO_IMAGE") {
    return createRetrievalQueryV2({ mode, text, scope });
  }
  if (mode === "IMAGE_TO_IMAGE") {
    return createRetrievalQueryV2({
      mode,
      queryAsset: { assetId: "asset-query", sha256: PAYLOAD_HASH },
      scope,
    });
  }
  return createRetrievalQueryV2({
    mode,
    text,
    queryAsset: { assetId: "asset-query", sha256: PAYLOAD_HASH },
    scope,
  });
}

function queryEvidenceAdequacyFixture(input: {
  canonicalText?: string;
} = {}): QueryEvidenceAdequacyRuntimeV2 {
  const canonicalText =
    input.canonicalText ?? CANONICAL_PRIMARY_TEXT;
  return {
    identity: {
      corpusBundleHash: CORPUS_HASH,
      queryEvidenceAdequacyPolicyHash:
        DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2.configHash,
      queryEvidenceFeatureAlgorithmHash:
        QUERY_EVIDENCE_FEATURE_ALGORITHM_HASH_V2,
      queryAnchorCorpusStatsHash: "f".repeat(64),
      primaryEvidenceBindingAlgorithmHash:
        PRIMARY_EVIDENCE_BINDING_ALGORITHM_HASH_V2,
      normalizerConfigHash: CONFIG_HASH,
      rrfConfigHash: CONFIG_HASH,
      acceptancePolicyHash: createAcceptancePolicyV2().configHash,
      objectConsensusConfigHash:
        TEXT_OBJECT_CONSENSUS_CONFIG_HASH_V2,
      lexicalConfigHash: CONFIG_HASH,
      textProviderIndexBundleHash: PROVIDER_INDEX_HASH,
      textModelId: TEXT_MODEL_ID,
      textModelRevision: PROVIDER_INDEX_HASH,
    },
    policy: DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2,
    corpus: {
      bundleHash: CORPUS_HASH,
    },
    canonicalTextNodeById: new Map([
      ["node-owner", {
        object: {
          id: "object-a",
          sourceCoursePack: PACK,
        },
        node: {
          id: "node-owner",
          kind: "TEXT",
          contentHash: PAYLOAD_HASH,
          text: canonicalText,
        },
      }],
    ]),
    objectDfByPack: new Map([
      [PACK.id, new Map<string, number>()],
    ]),
  } as unknown as QueryEvidenceAdequacyRuntimeV2;
}

function dependencies(input: {
  lexical?: RetrievalChannelProviderV2;
  frozenLexical?: RetrievalChannelProviderV2;
  text?: RetrievalChannelProviderV2;
  visual?: RetrievalChannelProviderV2;
  caption?: RetrievalChannelProviderV2;
  expandThrows?: boolean;
  expandHangsOnce?: boolean;
  omitAssets?: boolean;
  omitText?: boolean;
  claims?: HybridRetrieverV2Dependencies["corpusProvenanceClaims"];
  queryDeadlineMs?: number;
  assetIdByNodeId?: ReadonlyMap<string, string>;
  acceptancePolicy?: HybridRetrieverV2Dependencies["acceptancePolicy"];
  capabilityBoundary?: HybridRetrieverV2Dependencies["capabilityBoundary"];
  sourceCoursePackByObjectId?: HybridRetrieverV2Dependencies[
    "sourceCoursePackByObjectId"
  ];
  canonicalPrimaryIds?: boolean;
  queryEvidenceAdequacy?: HybridRetrieverV2Dependencies[
    "queryEvidenceAdequacy"
  ];
  now?: () => number;
} = {}): HybridRetrieverV2Dependencies {
  let expansionCalls = 0;
  const resolvePrimaries = async ({
    query: retrievalQuery,
    seeds,
    requiredSourceIds,
    captionFallbackHits = [],
  }: {
    query: RetrievalQueryV2;
    seeds: readonly FusedCandidateV2[];
    requiredSourceIds: readonly string[];
    captionFallbackHits?: readonly ChannelCandidateV2[];
  }) => {
    const hasVisual = seeds.some(({ channelTraces }) =>
      channelTraces.some(({ channel }) => channel === "VISUAL_VECTOR"));
    const combined = retrievalQuery.mode === "IMAGE_TEXT_TO_EVIDENCE" && !input.omitText;
    const requiredSourceId = requiredSourceIds[0] ?? null;
    const requiredClaim = input.claims?.find(({ sourceId }) => sourceId === requiredSourceId);
    return {
      nodes: seeds.map((seed) => ({
        nodeId: input.canonicalPrimaryIds
          ? seed.candidateId
          : `node-owner-${seed.candidateId}`,
        objectId: seed.objectId,
        kind: hasVisual && !combined ? "IMAGE" as const : "TEXT" as const,
        relation: "PRIMARY" as const,
        seedCandidateId: seed.candidateId,
        parentNodeId: null,
        sourceId: requiredSourceId ?? `source-${seed.candidateId}`,
        sourceCoursePack: PACK,
        excerpt: hasVisual && !combined
          ? null
          : CANONICAL_PRIMARY_TEXT,
        assetId: hasVisual && !combined ? "asset-result" : null,
      })),
      assets: captionFallbackHits.length > 0 && !input.omitAssets
        ? captionFallbackHits.map((hit) => ({
            assetId: hit.assetId!,
            objectId: hit.objectId,
            sha256: PAYLOAD_HASH,
            mimeType: "image/png" as const,
            dimensions: { widthPx: 100, heightPx: 200 },
          }))
        : hasVisual && !input.omitAssets
          ? [{
            assetId: "asset-result",
            objectId: "object-a",
            sha256: PAYLOAD_HASH,
            mimeType: "image/png" as const,
            dimensions: { widthPx: 100, heightPx: 200 },
          }]
          : [],
      regions: hasVisual && !input.omitAssets
        ? [{
            regionId: "region-result",
            imageNodeId: "node-image-result",
            regionNodeId: null,
            objectId: "object-a",
            assetId: "asset-result",
            bbox: {
              coordinateSpace: "NORMALIZED" as const,
              x: 0.1,
              y: 0.1,
              width: 0.2,
              height: 0.2,
            },
            origin: "PATCH_MATCH" as const,
          }]
        : [],
      sources: seeds.map((seed) => ({
        sourceId: requiredSourceId ?? `source-${seed.candidateId}`,
        objectId: seed.objectId,
        authority: requiredSourceId ? "OFFICIAL" as const : "COURSE_DESIGN" as const,
        verifiedDate: requiredClaim?.verifiedDate ?? "2026-07-28",
        scope: "版式设计课程语料。",
        locators: [{
          kind: "LOCAL_DOCUMENT" as const,
          path: "data/courses/layout-design/001-example.md",
        }],
      })),
    };
  };
  return {
    providers: {
      lexical: input.lexical ?? provider("LEXICAL"),
      frozenLexicalFallback: input.frozenLexical,
      textVector: input.text ?? provider("TEXT_VECTOR"),
      visualVector: input.visual ?? provider("VISUAL_VECTOR"),
      captionFallback: input.caption,
    },
    graphExpander: {
      expand: vi.fn(async (request: {
        query: RetrievalQueryV2;
        seeds: readonly FusedCandidateV2[];
        requiredSourceIds: readonly string[];
      }) => {
        if (input.expandThrows) throw new Error("injected relation failure");
        expansionCalls += 1;
        if (input.expandHangsOnce && expansionCalls === 1) {
          return new Promise(() => undefined);
        }
        return resolvePrimaries(request);
      }),
      resolvePrimaries: vi.fn(resolvePrimaries),
    },
    sourceCoursePackByObjectId: input.sourceCoursePackByObjectId ?? new Map([
      ["object-a", PACK],
      ["object-b", PACK],
    ]),
    assetIdByNodeId: input.assetIdByNodeId,
    corpusProvenanceClaims: input.claims ?? [],
    acceptancePolicy: input.acceptancePolicy,
    capabilityBoundary: input.capabilityBoundary,
    queryEvidenceAdequacy: input.queryEvidenceAdequacy,
    provenance: {
      activeIndexBundleHash: ACTIVE_INDEX_HASH,
      relationConfigHash: CONFIG_HASH,
      normalizerConfigHash: CONFIG_HASH,
      rrfConfigHash: CONFIG_HASH,
    },
    now: input.now,
    queryDeadlineMs: input.queryDeadlineMs,
  };
}

describe("hybrid retriever V2", () => {
  it("binds post-RRF selection behavior into an auditable config", () => {
    expect(HYBRID_RRF_CONFIG_V2).toMatchObject({
      version: "1.2.0",
      textObjectConsensus: {
        objectLimit: 10,
        nodeLimitPerObject: 3,
        eligibleNodeKind: "TEXT",
      },
      visualReservationPolicy: {
        source: "VISUAL_ASSET_HITS",
        sourceLimit: 5,
        dedupe: "FIRST_BY_OBJECT",
        reserveWithinFusedLimit: 10,
        eviction: "LOWEST_FUSED_NON_RESERVED",
      },
      primaryLimit: 5,
      finalPrimarySelectionByMode: {
        TEXT_TO_TEXT: "STRONGEST_FUSED_NODE_PER_OBJECT_FIRST_WINS_MAX5",
        IMAGE_TEXT_TO_EVIDENCE:
          "RAW_VISUAL_TOP5_OBJECTS_THEN_FUSED_BACKFILL_MAX5",
      },
    });
    expect(sha256StableJsonV2({
      ...HYBRID_RRF_CONFIG_V2,
      visualReservationPolicy: {
        ...HYBRID_RRF_CONFIG_V2.visualReservationPolicy,
        sourceLimit: 4,
      },
    })).not.toBe(sha256StableJsonV2(HYBRID_RRF_CONFIG_V2));
  });

  it("keeps the T4.2 A0 arm on exact-node semantics when object consensus is disabled", async () => {
    const objectCandidate = (
      channel: "LEXICAL" | "TEXT_VECTOR",
      rawScore: number,
    ) => ({
      objectId: "object-a",
      coursePackId: "layout-design",
      objectRank: 1,
      rawScore,
      nodes: [{
        nodeId: "node-common",
        objectId: "object-a",
        nodeKind: "TEXT" as const,
        representationId: channel === "LEXICAL"
          ? null
          : "representation-common",
        innerRank: 1,
        rawScore,
      }],
    });
    const providerWithDifferentTopNode = (
      channel: "LEXICAL" | "TEXT_VECTOR",
      nodeId: string,
      rawScore: number,
    ): RetrievalChannelProviderV2 => ({
      retrieve: vi.fn(async () => ({
        ...result(channel, [{
          ...candidate(channel),
          candidateId: nodeId,
          nodeId,
          rawScore,
        }]),
        objectCandidates: [objectCandidate(channel, rawScore)],
      })),
    });
    const deps = dependencies({
      lexical: providerWithDifferentTopNode("LEXICAL", "node-lexical", 8),
      text: providerWithDifferentTopNode("TEXT_VECTOR", "node-vector", 0.8),
    });

    const enabled = await createHybridRetrieverV2(deps)(query("TEXT_TO_TEXT"));
    const disabled = await createHybridRetrieverV2({
      ...deps,
      textObjectConsensusEnabled: false,
    })(query("TEXT_TO_TEXT"));
    const customPolicy = await createHybridRetrieverV2({
      ...deps,
      acceptancePolicy: createAcceptancePolicyV2({
        eligibleMaxRank: 19,
      }),
    })(query("TEXT_TO_TEXT"));

    expect(enabled.status).toBe("SUCCESS");
    expect(enabled.evidence.objectConsensus).toMatchObject({
      applied: true,
      candidates: [{
        objectId: "object-a",
        selectedNodeId: "node-common",
        source: "OBJECT_INNER_COMMON_TEXT",
      }],
    });
    expect(disabled.evidence.objectConsensus).toBeUndefined();
    expect(disabled.evidence.acceptance.acceptedCount).toBe(0);
    expect(disabled.status).toBe("EMPTY");
    expect(customPolicy.evidence.objectConsensus).toBeUndefined();
    expect(customPolicy.evidence.acceptance.acceptedCount).toBe(0);
    expect(customPolicy.status).toBe("EMPTY");
  });

  it.each([
    ["TEXT_TO_TEXT", ["LEXICAL", "TEXT_VECTOR"]],
    ["TEXT_TO_IMAGE", ["LEXICAL", "TEXT_VECTOR", "VISUAL_VECTOR"]],
    ["IMAGE_TO_IMAGE", ["VISUAL_VECTOR"]],
    ["IMAGE_TEXT_TO_EVIDENCE", ["LEXICAL", "TEXT_VECTOR", "VISUAL_VECTOR"]],
  ] as const)("runs %s with only its runtime channels", async (mode, expectedChannels) => {
    const deps = dependencies();
    const bundle = await createHybridRetrieverV2(deps)(query(mode));
    expect(bundle.status).toBe("SUCCESS");
    expect(bundle.evidence.primary).toHaveLength(1);
    expect(bundle.evidence.primary[0]?.channelTraces.map(({ channel }) => channel))
      .toEqual(expectedChannels);
    expect(bundle.evidence.nodes).toHaveLength(1);
    expect(bundle.provenance.graphExpansion).toBe("POST_FUSION");
    if (mode !== "TEXT_TO_TEXT") {
      expect(bundle.evidence.assets).toHaveLength(1);
    }
    if (mode === "IMAGE_TEXT_TO_EVIDENCE") {
      expect(bundle.evidence.nodes.some(({ kind }) =>
        ["DOCUMENT", "SECTION", "TEXT", "TABLE"].includes(kind))).toBe(true);
    }
    if (mode === "IMAGE_TO_IMAGE") {
      expect(bundle.evidence.acceptance.candidates[0]?.reasons)
        .toEqual(["MODE_SINGLE_VISUAL"]);
    } else {
      expect(bundle.evidence.acceptance.candidates[0]?.reasons)
        .toEqual(["MODE_CHANNEL_REQUIREMENT"]);
    }
    const expansionRequest = vi.mocked(deps.graphExpander.expand).mock.calls[0]![0];
    expect(
      [...expansionRequest.channelResults.values()]
        .some(({ summary }) => summary.status === "SKIPPED"),
    ).toBe(false);
  });

  it("keeps the strongest exact-node seed when one object has multiple accepted nodes", async () => {
    const rankedHits = (channel: "LEXICAL" | "TEXT_VECTOR") => [
      {
        ...candidate(channel),
        candidateId: "node-strong",
        objectId: "object-a",
        nodeId: "node-strong",
        representationId: channel === "LEXICAL" ? null : "representation-strong",
        rank: 1,
      },
      {
        ...candidate(channel),
        candidateId: "node-weak",
        objectId: "object-a",
        nodeId: "node-weak",
        representationId: channel === "LEXICAL" ? null : "representation-weak",
        rank: 2,
      },
    ];
    const lexical: RetrievalChannelProviderV2 = {
      retrieve: vi.fn(async () => result("LEXICAL", rankedHits("LEXICAL"))),
    };
    const text: RetrievalChannelProviderV2 = {
      retrieve: vi.fn(async () => result("TEXT_VECTOR", rankedHits("TEXT_VECTOR"))),
    };
    const bundle = await createHybridRetrieverV2(dependencies({
      lexical,
      text,
    }))(query("TEXT_TO_TEXT"));

    expect(bundle.status).toBe("SUCCESS");
    expect(bundle.evidence.acceptance.acceptedCount).toBe(2);
    expect(bundle.evidence.primary).toEqual([
      expect.objectContaining({
        candidateId: "node-strong",
        objectId: "object-a",
        fusedRank: 1,
      }),
    ]);
    expect(bundle.evidence.nodes).toContainEqual(
      expect.objectContaining({ seedCandidateId: "node-strong" }),
    );
    expect(bundle.evidence.nodes).not.toContainEqual(
      expect.objectContaining({ seedCandidateId: "node-weak" }),
    );
  });

  it("routes externally verifiable claims to EMPTY before retrieval without an official topic source", async () => {
    const lexical = provider("LEXICAL");
    const text = provider("TEXT_VECTOR");
    const deps = dependencies({ lexical, text });
    const sensitive = query("TEXT_TO_TEXT", "这个标志有官方授权，可以商用吗？");
    expect(evaluateExternalVerificationV2(sensitive, [])).toMatchObject({
      required: true,
      authorized: false,
      reason: "EXTERNAL_VERIFICATION_REQUIRED",
    });
    const bundle = await createHybridRetrieverV2(deps)(sensitive);
    expect(bundle.status).toBe("EMPTY");
    expect(bundle.evidence.primary).toEqual([]);
    expect(bundle.channels.every(({ status }) => status === "SKIPPED")).toBe(true);
    expect(bundle.provenance.fallbackTriggers)
      .toEqual(["EXTERNAL_VERIFICATION_REQUIRED"]);
    expect(lexical.retrieve).not.toHaveBeenCalled();
    expect(text.retrieve).not.toHaveBeenCalled();
  });

  it.each([
    ["AUTHORIZATION", "这个标志有官方授权，可以商用吗？"],
    ["PRICE", "这门课现在收费多少钱？"],
    ["OWNERSHIP", "这张作品的版权归谁所有？"],
    ["EXAM_SCHEDULE", "这门课的考试日期安排是什么？"],
    ["RESULT_GUARANTEE", "照这个方案做能保证获奖吗？"],
    ["CURRENT_STATUS", "这个设备今天有没有官方驱动和最新固件？"],
    ["REGULATION", "现行法规对包装标签有哪些硬要求？"],
  ] as const)("recognizes %s as external verification instead of retrieval truth", (kind, text) => {
    expect(evaluateExternalVerificationV2(query("TEXT_TO_TEXT", text), []))
      .toMatchObject({
        required: true,
        authorized: false,
        claimKinds: [kind],
        reason: "EXTERNAL_VERIFICATION_REQUIRED",
      });
  });

  it.each([
    "当前这个版本的版式怎么调？",
    "当前设计标准怎么用在这张海报上？",
    "现在注册页面怎么排版？",
  ])("does not mistake static course guidance for a current external claim: %s", (text) => {
    expect(evaluateExternalVerificationV2(
      query("TEXT_TO_TEXT", text),
      [],
    )).toMatchObject({
      required: false,
      authorized: true,
      claimKinds: [],
      reason: "NOT_REQUIRED",
    });
  });

  it("lets the opt-in V3 shadow bypass only the legacy 版权页 false positive", () => {
    const staticDocumentQuestion = query(
      "TEXT_TO_TEXT",
      "选设计类书时，怎么核对版本、版权页和目录？",
    );
    const staticResult =
      evaluateExternalVerificationWithPrerequisiteShadowV3({
        query: staticDocumentQuestion,
        claims: [],
        capabilityEntityManifest:
          capabilityBoundaryFixture().manifest,
      });

    expect(staticResult).toMatchObject({
      legacyExternalVerification: {
        required: true,
        authorized: false,
        claimKinds: ["OWNERSHIP"],
      },
      prerequisiteTrace: {
        decision: "STATIC_CORPUS_ELIGIBLE",
      },
      externalVerification: {
        required: false,
        authorized: true,
        reason: "NOT_REQUIRED",
      },
      staticBypassApplied: true,
    });

    const ownershipResult =
      evaluateExternalVerificationWithPrerequisiteShadowV3({
        query: query(
          "TEXT_TO_TEXT",
          "这张作品的版权归谁所有？",
        ),
        claims: [],
        capabilityEntityManifest:
          capabilityBoundaryFixture().manifest,
      });
    expect(ownershipResult).toMatchObject({
      prerequisiteTrace: {
        decision: "EXTERNAL_STATE_REQUIRED",
      },
      externalVerification: {
        required: true,
        authorized: false,
      },
      staticBypassApplied: false,
    });
  });

  it("routes all four frozen external negatives with their complete claim kinds", async () => {
    const suite = RetrievalGoldenSuiteSchema.parse(JSON.parse(await readFile(
      "tests/retrieval-quality/golden-suite.json",
      "utf8",
    )));
    const expected = new Map([
      ["negative-layout-font-license", ["AUTHORIZATION", "PRICE"]],
      ["negative-layout-admission-guarantee", ["RESULT_GUARANTEE"]],
      ["negative-layout-current-copyright", ["OWNERSHIP", "PRICE"]],
      ["negative-layout-exam-schedule", ["EXAM_SCHEDULE"]],
    ]);
    for (const [caseId, claimKinds] of expected) {
      const frozen = suite.cases.find(({ id }) => id === caseId)!;
      const routed = evaluateExternalVerificationV2(createRetrievalQueryV2({
        mode: "TEXT_TO_TEXT",
        text: frozen.query.text!,
        scope: {
          corpusBundleHash: CORPUS_HASH,
          sourceCoursePack: {
            id: frozen.query.coursePackId!,
            version: frozen.coursePackVersion,
          },
        },
      }), []);
      expect(routed, caseId).toMatchObject({
        required: true,
        authorized: false,
        claimKinds,
        reason: "EXTERNAL_VERIFICATION_REQUIRED",
      });
    }
  });

  it("allows the external route only for an explicit official same-topic source", async () => {
    const sensitive = query("TEXT_TO_TEXT", "这个标志有官方授权，可以商用吗？");
    const claims = [{
      sourceId: "source-official-brand",
      objectId: "object-a",
      sourceCoursePack: PACK,
      authority: "OFFICIAL" as const,
      verifiedDate: "2026-07-28",
      claimKinds: ["AUTHORIZATION" as const],
      topicTerms: ["标志"],
    }];
    expect(evaluateExternalVerificationV2(sensitive, claims)).toMatchObject({
      required: true,
      authorized: true,
      matchedSourceIds: ["source-official-brand"],
    });
    const bundle = await createHybridRetrieverV2(dependencies({ claims }))(sensitive);
    expect(bundle.status).toBe("SUCCESS");
  });

  it("rejects an official provenance claim that omits its verification date", () => {
    const sensitive = query("TEXT_TO_TEXT", "这个标志有官方授权，可以商用吗？");
    expect(() => evaluateExternalVerificationV2(sensitive, [{
      sourceId: "source-official-brand",
      objectId: "object-a",
      sourceCoursePack: PACK,
      authority: "OFFICIAL",
      claimKinds: ["AUTHORIZATION"],
      topicTerms: ["标志"],
    }] as never)).toThrow(/verifiedDate|invalid_type/i);
  });

  it("uses an explicit lexical-only degraded fallback when text vectors fail", async () => {
    const bundle = await createHybridRetrieverV2(dependencies({
      text: provider("TEXT_VECTOR", "THROW"),
    }))(query("TEXT_TO_TEXT"));
    expect(bundle.status).toBe("DEGRADED");
    expect(bundle.evidence.primary).toHaveLength(1);
    expect(bundle.evidence.acceptance).toMatchObject({
      degradedLexicalFallback: true,
      acceptedCount: 1,
    });
    expect(bundle.evidence.acceptance.candidates[0]?.reasons)
      .toEqual(["DEGRADED_LEXICAL_FALLBACK"]);
    expect(bundle.provenance.capabilitiesLost).toContain("TEXT_VECTOR");
    expect(bundle.channels.find(({ channel }) => channel === "TEXT_VECTOR"))
      .toMatchObject({ status: "ERROR", reason: "INVALID_RESPONSE" });
  });

  it("invokes the frozen lexical provider only after observing a real text-vector failure", async () => {
    const normalLexical: RetrievalChannelProviderV2 = {
      retrieve: vi.fn(async (retrievalQuery: RetrievalQueryV2) =>
        result("LEXICAL", [
          candidateForQuery("LEXICAL", retrievalQuery, "object-b"),
        ])),
    };
    const frozenLexical: RetrievalChannelProviderV2 = {
      retrieve: vi.fn(async (retrievalQuery: RetrievalQueryV2) =>
        result("LEXICAL", [
          candidateForQuery("LEXICAL", retrievalQuery, "object-a"),
        ])),
    };
    const text = provider("TEXT_VECTOR", "THROW");
    const bundle = await createHybridRetrieverV2(dependencies({
      lexical: normalLexical,
      frozenLexical,
      text,
    }))(query("TEXT_TO_TEXT"));

    expect(normalLexical.retrieve).toHaveBeenCalledOnce();
    expect(frozenLexical.retrieve).toHaveBeenCalledOnce();
    expect(bundle.status).toBe("DEGRADED");
    expect(bundle.evidence.primary.map(({ objectId }) => objectId)).toEqual(["object-a"]);
  });

  it("keeps a frozen lexical EMPTY baseline empty after text-vector failure", async () => {
    const frozenLexical: RetrievalChannelProviderV2 = {
      retrieve: vi.fn(async () => result("LEXICAL", [])),
    };
    const bundle = await createHybridRetrieverV2(dependencies({
      frozenLexical,
      text: provider("TEXT_VECTOR", "THROW"),
    }))(query("TEXT_TO_TEXT"));

    expect(bundle.status).toBe("EMPTY");
    expect(bundle.evidence.primary).toEqual([]);
    expect(bundle.evidence.nodes).toEqual([]);
    expect(frozenLexical.retrieve).toHaveBeenCalledOnce();
  });

  it("filters query-image text hits in the effective channel result before fusion and expansion", async () => {
    const text: RetrievalChannelProviderV2 = {
      retrieve: vi.fn(async () => result("TEXT_VECTOR", [
        { ...candidate("TEXT_VECTOR", "object-b"), nodeId: "node-query", rank: 1 },
        { ...candidate("TEXT_VECTOR", "object-a"), nodeId: "node-valid", rank: 2 },
      ])),
    };
    const deps = dependencies({
      lexical: provider("LEXICAL", "EMPTY"),
      text,
      assetIdByNodeId: new Map([["node-query", "asset-query"]]),
    });
    const bundle = await createHybridRetrieverV2(deps)(query("IMAGE_TEXT_TO_EVIDENCE"));
    const expansionRequest = vi.mocked(deps.graphExpander.expand).mock.calls[0]![0];
    const effectiveText = expansionRequest.channelResults.get("TEXT_VECTOR")!;

    expect(effectiveText.hits).toEqual([
      expect.objectContaining({
        objectId: "object-a",
        nodeId: "node-valid",
        rank: 1,
      }),
    ]);
    expect(bundle.evidence.primary.flatMap(({ channelTraces }) => channelTraces))
      .not.toContainEqual(expect.objectContaining({ nodeId: "node-query" }));
  });

  it("filters the query asset directly from visual hits without relying on a node lookup", async () => {
    const visual: RetrievalChannelProviderV2 = {
      retrieve: vi.fn(async () => result("VISUAL_VECTOR", [
        {
          ...candidate("VISUAL_VECTOR", "object-b"),
          representationId: "representation-query-asset",
          nodeId: "node-query",
          assetId: "asset-query",
          rank: 1,
        },
        {
          ...candidate("VISUAL_VECTOR", "object-a"),
          representationId: "representation-valid-asset",
          nodeId: "node-valid",
          assetId: "asset-result",
          rank: 2,
        },
      ])),
    };
    const deps = dependencies({ visual });
    const bundle = await createHybridRetrieverV2(deps)(query("IMAGE_TO_IMAGE"));
    const expansionRequest = vi.mocked(deps.graphExpander.expand).mock.calls[0]![0];
    const effectiveVisual = expansionRequest.channelResults.get("VISUAL_VECTOR")!;

    expect(effectiveVisual.hits).toEqual([
      expect.objectContaining({
        objectId: "object-a",
        assetId: "asset-result",
        rank: 1,
      }),
    ]);
    expect(effectiveVisual.visualAssetHits).toEqual([
      expect.objectContaining({
        objectId: "object-a",
        assetId: "asset-result",
        rank: 1,
      }),
    ]);
    expect(bundle.evidence.assets).toContainEqual(
      expect.objectContaining({
        assetId: "asset-result",
        retrieval: expect.objectContaining({ rank: 1 }),
      }),
    );
  });

  it("retains every object represented by the raw visual top five before fused backfill", async () => {
    const consensusIds = Array.from(
      { length: 10 },
      (_, index) => `object-${String.fromCharCode("b".charCodeAt(0) + index)}`,
    );
    const lexical: RetrievalChannelProviderV2 = {
      retrieve: vi.fn(async () => result("LEXICAL", consensusIds.map(
        (objectId, index) => ({ ...candidate("LEXICAL", objectId), rank: index + 1 }),
      ))),
    };
    const text: RetrievalChannelProviderV2 = {
      retrieve: vi.fn(async () => result("TEXT_VECTOR", consensusIds.map(
        (objectId, index) => ({ ...candidate("TEXT_VECTOR", objectId), rank: index + 1 }),
      ))),
    };
    const visualHits = [
      {
        ...candidate("VISUAL_VECTOR", "object-a"),
        assetId: "asset-result",
        rank: 1,
      },
      ...consensusIds.map((objectId, index) => ({
        ...candidate("VISUAL_VECTOR", objectId),
        nodeId: `node-visual-${objectId}`,
        assetId: `asset-${objectId}`,
        rank: index + 2,
      })),
    ];
    const visual: RetrievalChannelProviderV2 = {
      retrieve: vi.fn(async () => result("VISUAL_VECTOR", visualHits)),
    };
    const base = dependencies({ lexical, text, visual });
    const expansion = (seeds: readonly FusedCandidateV2[]) => ({
      nodes: seeds.map((seed) => ({
        nodeId: `node-primary-${seed.objectId}`,
        objectId: seed.objectId,
        kind: "TEXT" as const,
        relation: "PRIMARY" as const,
        seedCandidateId: seed.candidateId,
        parentNodeId: null,
        sourceId: `source-${seed.objectId}`,
        sourceCoursePack: PACK,
        excerpt: "真实扩展节点。",
        assetId: null,
      })),
      assets: [{
        assetId: "asset-result",
        objectId: "object-a",
        sha256: PAYLOAD_HASH,
        mimeType: "image/png" as const,
        dimensions: { widthPx: 100, heightPx: 200 },
      }],
      regions: [],
      sources: seeds.map((seed) => ({
        sourceId: `source-${seed.objectId}`,
        objectId: seed.objectId,
        authority: "COURSE_DESIGN" as const,
        verifiedDate: "2026-07-28",
        scope: "版式设计课程语料。",
        locators: [{
          kind: "LOCAL_DOCUMENT" as const,
          path: "data/courses/layout-design/001-example.md",
        }],
      })),
    });
    const deps: HybridRetrieverV2Dependencies = {
      ...base,
      graphExpander: {
        expand: vi.fn(async ({ seeds }) => expansion(seeds)),
        resolvePrimaries: vi.fn(async ({ seeds }) => expansion(seeds)),
      },
      sourceCoursePackByObjectId: new Map([
        ["object-a", PACK],
        ...consensusIds.map((objectId) => [objectId, PACK] as const),
      ]),
    };
    const bundle = await createHybridRetrieverV2(deps)(query("TEXT_TO_IMAGE"));

    expect(bundle.evidence.primary).toHaveLength(5);
    expect(bundle.evidence.primary.map(({ objectId }) => objectId)).toContain("object-a");
    expect(bundle.evidence.assets).toContainEqual(expect.objectContaining({
      assetId: "asset-result",
      objectId: "object-a",
      retrieval: expect.objectContaining({
        channel: "VISUAL_VECTOR",
        rank: 1,
      }),
    }));
  });

  it("strips forged graph-expander retrieval markers before binding trusted visual hits", async () => {
    const deps = dependencies();
    const baseExpand = deps.graphExpander.expand;
    deps.graphExpander.expand = vi.fn(async (request, context) => {
      const expansion = await baseExpand(request, context) as {
        nodes: unknown[];
        assets: Array<Record<string, unknown>>;
        regions: unknown[];
        sources: unknown[];
      };
      const visualResult = request.channelResults.get("VISUAL_VECTOR")!;
      (visualResult.hits[0] as { assetId: string | null }).assetId =
        "asset-forged-sibling";
      const mutableSeeds = request.seeds as unknown as Array<{
        channelTraces: Array<{ assetId: string | null; representationId: string | null }>;
      }>;
      const visualTrace = mutableSeeds[0]!.channelTraces.find(({ representationId }) =>
        representationId !== null);
      visualTrace!.assetId = "asset-forged-sibling";
      (request.captionFallbackHits as ChannelCandidateV2[]).push({
        ...candidate("LEXICAL"),
        candidateId: "asset-forged-sibling",
        assetId: "asset-forged-sibling",
        nodeId: "node-forged-sibling",
      });
      return {
        ...expansion,
        assets: [
          ...expansion.assets.map((asset) => ({
            ...asset,
            retrieval: {
              channel: "VISUAL_VECTOR",
              rank: 20,
              representationId: "forged-representation",
            },
          })),
          {
            assetId: "asset-forged-sibling",
            objectId: "object-a",
            sha256: PAYLOAD_HASH,
            mimeType: "image/png",
            dimensions: { widthPx: 100, heightPx: 200 },
            retrieval: {
              channel: "VISUAL_VECTOR",
              rank: 1,
              representationId: "forged-representation",
            },
          },
        ],
      };
    });
    const bundle = await createHybridRetrieverV2(deps)(query("TEXT_TO_IMAGE"));

    expect(bundle.evidence.assets.find(({ assetId }) =>
      assetId === "asset-result")?.retrieval).toMatchObject({
      channel: "VISUAL_VECTOR",
      rank: 1,
    });
    expect(bundle.evidence.assets.find(({ assetId }) =>
      assetId === "asset-forged-sibling")?.retrieval).toBeUndefined();
  });

  it.each([
    ["TEXT_TO_TEXT", "TEXT_VECTOR"],
    ["TEXT_TO_IMAGE", "VISUAL_VECTOR"],
    ["IMAGE_TEXT_TO_EVIDENCE", "VISUAL_VECTOR"],
  ] as const)("does not turn a healthy EMPTY channel into %s lexical fallback", async (
    mode,
    emptyChannel,
  ) => {
    const bundle = await createHybridRetrieverV2(dependencies({
      text: emptyChannel === "TEXT_VECTOR"
        ? provider("TEXT_VECTOR", "EMPTY")
        : undefined,
      visual: emptyChannel === "VISUAL_VECTOR"
        ? provider("VISUAL_VECTOR", "EMPTY")
        : undefined,
    }))(query(mode));
    expect(bundle.status).toBe("EMPTY");
    expect(bundle.evidence.primary).toEqual([]);
    expect(bundle.evidence.acceptance.degradedLexicalFallback).toBe(false);
  });

  it("fails closed for pure images and never calls graph expansion after visual failure", async () => {
    const deps = dependencies({ visual: provider("VISUAL_VECTOR", "THROW") });
    const bundle = await createHybridRetrieverV2(deps)(query("IMAGE_TO_IMAGE"));
    expect(bundle.status).toBe("ERROR");
    expect(bundle.evidence.primary).toEqual([]);
    expect(bundle.evidence.nodes).toEqual([]);
    expect(deps.graphExpander.expand).not.toHaveBeenCalled();
  });

  it("degrades mixed image-text to lexical evidence without inventing assets or regions", async () => {
    const bundle = await createHybridRetrieverV2(dependencies({
      visual: provider("VISUAL_VECTOR", "THROW"),
    }))(query("IMAGE_TEXT_TO_EVIDENCE"));
    expect(bundle.status).toBe("DEGRADED");
    expect(bundle.evidence.primary).toHaveLength(1);
    expect(bundle.evidence.assets).toEqual([]);
    expect(bundle.evidence.regions).toEqual([]);
    expect(bundle.provenance.capabilitiesLost).toEqual(expect.arrayContaining([
      "VISUAL_VECTOR",
      "ASSET",
      "REGION",
    ]));
  });

  it("uses the explicit caption baseline only after TEXT_TO_IMAGE visual failure", async () => {
    const caption = captionProvider();
    const failed = await createHybridRetrieverV2(dependencies({
      visual: provider("VISUAL_VECTOR", "THROW"),
      caption,
    }))(query("TEXT_TO_IMAGE"));
    expect(caption.retrieve).toHaveBeenCalledOnce();
    expect(failed.status).toBe("DEGRADED");
    expect(failed.provenance).toMatchObject({
      fallbackTriggers: expect.arrayContaining([
        "CAPTION_LEXICAL_FALLBACK_SUCCESS",
        "VISUAL_VECTOR_ERROR",
      ]),
      captionFallback: {
        channel: "LEXICAL",
        status: "SUCCESS",
        hitCount: 3,
      },
    });
    expect(failed.evidence.assets.map(({ assetId }) => assetId))
      .toEqual(["asset-a2", "asset-a1", "asset-b"]);
    expect(failed.evidence.primary.map(({ objectId }) => objectId))
      .toEqual(["object-a", "object-b"]);

    const healthy = captionProvider();
    await createHybridRetrieverV2(dependencies({ caption: healthy }))(query("TEXT_TO_IMAGE"));
    expect(healthy.retrieve).not.toHaveBeenCalled();

    const healthyEmpty = captionProvider();
    await createHybridRetrieverV2(dependencies({
      visual: provider("VISUAL_VECTOR", "EMPTY"),
      caption: healthyEmpty,
    }))(query("TEXT_TO_IMAGE"));
    expect(healthyEmpty.retrieve).not.toHaveBeenCalled();
  });

  it("never uses caption fallback for IMAGE_TEXT or lets text channels invent assets", async () => {
    const caption = captionProvider();
    const maliciousText: RetrievalChannelProviderV2 = {
      retrieve: vi.fn(async () => result("TEXT_VECTOR", [{
        ...candidate("TEXT_VECTOR"),
        assetId: "asset-forged",
      }])),
    };
    const bundle = await createHybridRetrieverV2(dependencies({
      text: maliciousText,
      visual: provider("VISUAL_VECTOR", "THROW"),
      caption,
    }))(query("IMAGE_TEXT_TO_EVIDENCE"));
    expect(caption.retrieve).not.toHaveBeenCalled();
    expect(bundle.evidence.assets).toEqual([]);
    expect(bundle.evidence.regions).toEqual([]);
    expect(bundle.channels.find(({ channel }) => channel === "TEXT_VECTOR"))
      .toMatchObject({ status: "ERROR", reason: "INVALID_RESPONSE" });
  });

  it("does not report visual success after the expander loses required evidence modalities", async () => {
    const imageWithoutAsset = await createHybridRetrieverV2(dependencies({
      omitAssets: true,
    }))(query("IMAGE_TO_IMAGE"));
    expect(imageWithoutAsset.status).toBe("DEGRADED");
    expect(imageWithoutAsset.evidence.assets).toEqual([]);
    expect(imageWithoutAsset.provenance.fallbackTriggers)
      .toContain("EVIDENCE_MODALITY_MISSING");

    const mixedWithoutText = await createHybridRetrieverV2(dependencies({
      omitText: true,
    }))(query("IMAGE_TEXT_TO_EVIDENCE"));
    expect(mixedWithoutText.status).toBe("DEGRADED");
    expect(mixedWithoutText.evidence.assets).toHaveLength(1);
    expect(mixedWithoutText.evidence.nodes.some(({ kind }) =>
      ["DOCUMENT", "SECTION", "TEXT", "TABLE"].includes(kind))).toBe(false);
    expect(mixedWithoutText.provenance.capabilitiesLost).toContain("TEXT_EVIDENCE");
  });

  it("does not turn a text-vector nearest neighbor into a normal text answer", async () => {
    const deps = dependencies({
      lexical: provider("LEXICAL", "EMPTY"),
      text: provider("TEXT_VECTOR", "SUCCESS"),
    });
    const bundle = await createHybridRetrieverV2(deps)(query("TEXT_TO_TEXT"));
    expect(bundle.status).toBe("EMPTY");
    expect(bundle.evidence.acceptance).toMatchObject({
      acceptedCount: 0,
      rejectedCount: 1,
    });
    expect(deps.graphExpander.expand).not.toHaveBeenCalled();
  });

  it("applies a TTT capability rejection before graph expansion", async () => {
    const lexical = providerWithPackCompetition("LEXICAL");
    const text = providerWithPackCompetition("TEXT_VECTOR");
    const deps = dependencies({
      lexical,
      text,
      capabilityBoundary: capabilityBoundaryFixture(),
      sourceCoursePackByObjectId: sourceCoursePacksWithBoundaryEvidence(),
    });

    const bundle = await createHybridRetrieverV2(deps)(
      query("TEXT_TO_TEXT", "OSC Out CHOP 一直没发出去，先看哪里？"),
    );

    expect(bundle.status).toBe("EMPTY");
    expect(bundle.evidence.boundary).toMatchObject({
      decision: "REJECT",
      reason: "EXCLUSIVE_ENTITY_FOREIGN_PACK",
      acceptedCandidateIdsBefore: ["node-owner"],
      acceptedCandidateIdsAfter: [],
    });
    expect(bundle.evidence.primary).toEqual([]);
    expect(deps.graphExpander.expand).not.toHaveBeenCalled();
    expect(deps.graphExpander.resolvePrimaries).not.toHaveBeenCalled();
  });

  it("skips the capability boundary during degraded lexical fallback and retains the old positive", async () => {
    const lexical = provider("LEXICAL");
    const frozenLexical = provider("LEXICAL");
    const deps = dependencies({
      lexical,
      frozenLexical,
      text: provider("TEXT_VECTOR", "THROW"),
      capabilityBoundary: capabilityBoundaryFixture(),
      sourceCoursePackByObjectId: sourceCoursePacksWithBoundaryEvidence(),
    });

    const bundle = await createHybridRetrieverV2(deps)(
      query("TEXT_TO_TEXT", "标题和正文都很抢，先改哪里？"),
    );

    expect(bundle.status).toBe("DEGRADED");
    expect(bundle.evidence.boundary).toMatchObject({
      decision: "SKIP",
      reason: "SKIPPED_DEGRADED_LEXICAL_FALLBACK",
      acceptedCandidateIdsBefore: ["node-owner"],
      acceptedCandidateIdsAfter: ["node-owner"],
    });
    expect(bundle.evidence.primary.map(({ objectId }) => objectId))
      .toEqual(["object-a"]);
    expect(deps.graphExpander.expand).toHaveBeenCalledOnce();
    expect(frozenLexical.retrieve).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: "missing",
      lexical: provider("LEXICAL"),
      expectedReason: "DIAGNOSTICS_MISSING",
    },
    {
      label: "invalid",
      lexical: providerWithPackCompetition("LEXICAL", {
        status: "INVALID",
        reason: "SCHEMA_INVALID",
        packCompetition: null,
      }),
      expectedReason: "DIAGNOSTICS_INVALID",
    },
  ])("abstains on $label pack diagnostics without clearing accepted evidence", async ({
    lexical,
    expectedReason,
  }) => {
    const deps = dependencies({
      lexical,
      text: provider("TEXT_VECTOR"),
      capabilityBoundary: capabilityBoundaryFixture(),
      sourceCoursePackByObjectId: sourceCoursePacksWithBoundaryEvidence(),
    });

    const bundle = await createHybridRetrieverV2(deps)(
      query("TEXT_TO_TEXT", "标题和正文都很抢，先改哪里？"),
    );

    expect(bundle.evidence.boundary).toMatchObject({
      decision: "ABSTAIN",
      reason: expectedReason,
      acceptedCandidateIdsBefore: ["node-owner"],
      acceptedCandidateIdsAfter: ["node-owner"],
    });
    expect(bundle.evidence.primary.map(({ objectId }) => objectId))
      .toEqual(["object-a"]);
    expect(deps.graphExpander.expand).toHaveBeenCalledOnce();
  });

  it("binds all five boundary provenance hashes to the emitted trace", async () => {
    const boundary = capabilityBoundaryFixture();
    const deps = dependencies({
      capabilityBoundary: boundary,
      sourceCoursePackByObjectId: sourceCoursePacksWithBoundaryEvidence(),
    });
    const bundle = await createHybridRetrieverV2(deps)(
      query("TEXT_TO_TEXT", "标题和正文都很抢，先改哪里？"),
    );
    const trace = bundle.evidence.boundary;

    expect(trace).toBeDefined();
    expect(bundle.provenance).toMatchObject({
      capabilityEntityManifestHash: trace!.capabilityEntityManifestHash,
      packCompetitionPolicyHash: trace!.packCompetitionPolicyHash,
      packCompetitionCalibrationHash: trace!.packCompetitionCalibrationHash,
      lexicalPackCompetitionAlgorithmHash:
        trace!.lexicalPackCompetitionAlgorithmHash,
      textPackCompetitionAlgorithmHash:
        trace!.textPackCompetitionAlgorithmHash,
    });
    expect(() => EvidenceBundleV2Schema.parse({
      ...bundle,
      provenance: {
        ...bundle.provenance,
        packCompetitionCalibrationHash: PAYLOAD_HASH,
      },
    })).toThrow(/boundary trace.*provenance/i);
    expect(() => EvidenceBundleV2Schema.parse({
      ...bundle,
      provenance: {
        ...bundle.provenance,
        lexicalPackCompetitionAlgorithmHash: PAYLOAD_HASH,
      },
    })).toThrow(/boundary trace.*provenance/i);
    const boundaryIdentityFields = [
      "capabilityEntityManifestHash",
      "packCompetitionPolicyHash",
      "packCompetitionCalibrationHash",
      "lexicalPackCompetitionAlgorithmHash",
      "textPackCompetitionAlgorithmHash",
    ] as const;
    for (const field of boundaryIdentityFields) {
      const provenance = {
        ...bundle.provenance,
      } as Record<string, unknown>;
      delete provenance[field];
      expect(() => EvidenceBundleV2Schema.parse({
        ...bundle,
        provenance,
      })).toThrow(/boundary identities must be complete/i);
    }
  });

  it("does not add provider calls when same-call pack diagnostics are present", async () => {
    const lexical = providerWithPackCompetition("LEXICAL");
    const text = providerWithPackCompetition("TEXT_VECTOR");
    const visual = provider("VISUAL_VECTOR");
    const deps = dependencies({
      lexical,
      text,
      visual,
      capabilityBoundary: capabilityBoundaryFixture(),
      sourceCoursePackByObjectId: sourceCoursePacksWithBoundaryEvidence(),
    });

    await createHybridRetrieverV2(deps)(
      query("TEXT_TO_TEXT", "标题和正文都很抢，先改哪里？"),
    );

    expect(lexical.retrieve).toHaveBeenCalledOnce();
    expect(text.retrieve).toHaveBeenCalledOnce();
    expect(visual.retrieve).not.toHaveBeenCalled();
  });

  it("keeps non-TTT bundles byte-for-byte compatible even with wholly invalid unused boundary config", async () => {
    const sourceCoursePackByObjectId = sourceCoursePacksWithBoundaryEvidence();
    const baseline = await createHybridRetrieverV2(dependencies({
      sourceCoursePackByObjectId,
      now: () => 0,
    }))(query("TEXT_TO_IMAGE"));
    const withUnusedInvalidBoundary = await createHybridRetrieverV2(dependencies({
      capabilityBoundary: {
        manifest: null as never,
        policy: null as never,
        calibration: null as never,
        runtimeIdentity: null as never,
      },
      sourceCoursePackByObjectId,
      now: () => 0,
    }))(query("TEXT_TO_IMAGE"));

    expect(withUnusedInvalidBoundary).toEqual(baseline);
    expect(withUnusedInvalidBoundary.bundleId).toBe(baseline.bundleId);
    expect(withUnusedInvalidBoundary.evidence).not.toHaveProperty("boundary");
    expect(withUnusedInvalidBoundary.provenance)
      .not.toHaveProperty("capabilityEntityManifestHash");
    expect(withUnusedInvalidBoundary.provenance)
      .not.toHaveProperty("packCompetitionPolicyHash");
    expect(withUnusedInvalidBoundary.provenance)
      .not.toHaveProperty("packCompetitionCalibrationHash");
    expect(withUnusedInvalidBoundary.provenance)
      .not.toHaveProperty("lexicalPackCompetitionAlgorithmHash");
    expect(withUnusedInvalidBoundary.provenance)
      .not.toHaveProperty("textPackCompetitionAlgorithmHash");
  });

  it("falls back to verified primary owners when relation expansion fails", async () => {
    const bundle = await createHybridRetrieverV2(dependencies({
      expandThrows: true,
    }))(query("TEXT_TO_TEXT"));
    expect(bundle.status).toBe("DEGRADED");
    expect(bundle.evidence.primary).toHaveLength(1);
    expect(bundle.evidence.nodes).toHaveLength(1);
    expect(bundle.evidence.nodes[0]).toMatchObject({
      relation: "PRIMARY",
      seedCandidateId: "node-owner",
    });
    expect(bundle.evidence.acceptance.acceptedCount).toBe(1);
    expect(bundle.provenance.fallbackTriggers).toContain("RELATION_EXPANSION_ERROR");
    expect(bundle.provenance.capabilitiesLost).toContain("GRAPH_CONTEXT");
  });

  it("enforces a hard deadline around a provider that ignores abort and remains reusable", async () => {
    let calls = 0;
    const hangingOnce: RetrievalChannelProviderV2 = {
      retrieve: vi.fn(async (retrievalQuery: RetrievalQueryV2) => {
        calls += 1;
        if (calls === 1) return new Promise(() => undefined);
        return result("LEXICAL", [
          candidateForQuery("LEXICAL", retrievalQuery),
        ]);
      }),
    };
    const retrieve = createHybridRetrieverV2(dependencies({
      lexical: hangingOnce,
      queryDeadlineMs: 15,
    }));
    const first = await retrieve(query("TEXT_TO_TEXT"));
    expect(first.status).toBe("TIMEOUT");
    expect(first.provenance.fallbackTriggers).toContain("QUERY_DEADLINE_EXCEEDED");
    const second = await retrieve(query("TEXT_TO_TEXT"));
    expect(second.status).toBe("SUCCESS");
  });

  it("enforces the same hard deadline around graph expansion and remains reusable", async () => {
    const retrieve = createHybridRetrieverV2(dependencies({
      expandHangsOnce: true,
      queryDeadlineMs: 15,
    }));
    const first = await retrieve(query("TEXT_TO_TEXT"));
    expect(first.status).toBe("TIMEOUT");
    expect(first.provenance.fallbackTriggers).toContain("QUERY_DEADLINE_EXCEEDED");
    const second = await retrieve(query("TEXT_TO_TEXT"));
    expect(second.status).toBe("SUCCESS");
  });

  it("requires retained official sources to collectively cover every detected claim kind", async () => {
    const claims = [
      {
        sourceId: "source-auth",
        objectId: "object-a",
        sourceCoursePack: PACK,
        authority: "OFFICIAL" as const,
        verifiedDate: "2026-07-28",
        claimKinds: ["AUTHORIZATION" as const],
        topicTerms: ["标志"],
      },
      {
        sourceId: "source-price",
        objectId: "object-a",
        sourceCoursePack: PACK,
        authority: "OFFICIAL" as const,
        verifiedDate: "2026-07-28",
        claimKinds: ["PRICE" as const],
        topicTerms: ["标志"],
      },
    ];
    const sensitive = query(
      "TEXT_TO_TEXT",
      "这个标志有官方授权吗，现在价格多少钱？",
    );
    expect(evaluateExternalVerificationV2(sensitive, claims)).toMatchObject({
      authorized: true,
      claimKinds: ["AUTHORIZATION", "PRICE"],
      matchedSourceIds: ["source-auth", "source-price"],
    });
    const bundle = await createHybridRetrieverV2(dependencies({ claims }))(sensitive);
    expect(bundle.status).toBe("EMPTY");
    expect(bundle.provenance.externalVerification).toMatchObject({
      authorized: false,
      reason: "EXTERNAL_VERIFICATION_REQUIRED",
    });
    expect(bundle.evidence.primary).toEqual([]);
  });

  it("keeps A0 trace-free while C1 KEEP adds only an auditable adequacy decision", async () => {
    const lexicalA0 = provider("LEXICAL");
    const textA0 = provider("TEXT_VECTOR");
    const lexicalC1 = provider("LEXICAL");
    const textC1 = provider("TEXT_VECTOR");
    const shared = {
      capabilityBoundary: capabilityBoundaryFixture(),
      sourceCoursePackByObjectId:
        sourceCoursePacksWithBoundaryEvidence(),
      canonicalPrimaryIds: true,
      now: () => 10,
    };
    const retrievalQuery = query(
      "TEXT_TO_TEXT",
      "版面层级怎么看？",
    );
    const a0 = await createHybridRetrieverV2(dependencies({
      ...shared,
      lexical: lexicalA0,
      text: textA0,
    }))(retrievalQuery);
    const c1 = await createHybridRetrieverV2(dependencies({
      ...shared,
      lexical: lexicalC1,
      text: textC1,
      queryEvidenceAdequacy: queryEvidenceAdequacyFixture(),
    }))(retrievalQuery);

    expect(a0.status).toBe("SUCCESS");
    expect(a0.evidence.queryEvidenceAdequacy).toBeUndefined();
    expect(a0.provenance.queryEvidenceAdequacyPolicyHash)
      .toBeUndefined();
    expect(a0.timing.adequacyMs).toBeUndefined();
    expect(c1.status).toBe("SUCCESS");
    expect(c1.evidence.queryEvidenceAdequacy).toMatchObject({
      decision: "KEEP",
      reason: "NO_HIGH_CONFIDENCE_OBLIGATION",
      preGateSeeds: a0.evidence.primary,
      postGateSeeds: a0.evidence.primary,
    });
    expect(c1.evidence.primary).toEqual(a0.evidence.primary);
    expect(c1.evidence.nodes).toEqual(a0.evidence.nodes);
    expect(c1.channels).toEqual(a0.channels);
    expect(c1.evidence.acceptance).toEqual(a0.evidence.acceptance);
    expect(c1.evidence.boundary).toEqual(a0.evidence.boundary);
    expect(c1.evidence.objectConsensus)
      .toEqual(a0.evidence.objectConsensus);
    expect(c1.provenance.queryEvidenceAdequacyPolicyHash)
      .toBe(
        DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2.configHash,
      );
    expect(c1.timing.adequacyMs).toBeGreaterThanOrEqual(0);
    expect(c1.timing.totalMs).toBeGreaterThanOrEqual(
      c1.timing.retrievalMs
        + c1.timing.expansionMs
        + c1.timing.adequacyMs!,
    );
    expect(lexicalA0.retrieve).toHaveBeenCalledOnce();
    expect(textA0.retrieve).toHaveBeenCalledOnce();
    expect(lexicalC1.retrieve).toHaveBeenCalledOnce();
    expect(textC1.retrieve).toHaveBeenCalledOnce();
    expect(EvidenceBundleV2Schema.parse(c1)).toEqual(c1);
  });

  it("lets C1 EMPTY clear every evidence layer without changing provider execution", async () => {
    const lexical = provider("LEXICAL");
    const text = provider("TEXT_VECTOR");
    const bundle = await createHybridRetrieverV2(dependencies({
      lexical,
      text,
      capabilityBoundary: capabilityBoundaryFixture(),
      sourceCoursePackByObjectId:
        sourceCoursePacksWithBoundaryEvidence(),
      canonicalPrimaryIds: true,
      queryEvidenceAdequacy: queryEvidenceAdequacyFixture(),
      now: () => 10,
    }))(query("TEXT_TO_TEXT", "请帮我导出 Figma Tokens"));

    expect(bundle.status).toBe("EMPTY");
    expect(bundle.evidence.queryEvidenceAdequacy)
      .toMatchObject({
        decision: "EMPTY",
        reason: "UNSUPPORTED_EXPLICIT_OBLIGATION",
        unsupportedObligationCount: 1,
      });
    expect(bundle.evidence.primary).toEqual([]);
    expect(bundle.evidence.nodes).toEqual([]);
    expect(bundle.evidence.assets).toEqual([]);
    expect(bundle.evidence.regions).toEqual([]);
    expect(bundle.sources).toEqual([]);
    expect(lexical.retrieve).toHaveBeenCalledOnce();
    expect(text.retrieve).toHaveBeenCalledOnce();
    expect(EvidenceBundleV2Schema.parse(bundle)).toEqual(bundle);
  });

  it("keeps non-applicable, external, degraded, and aborted paths byte-equivalent and trace-free", async () => {
    const shared = {
      capabilityBoundary: capabilityBoundaryFixture(),
      sourceCoursePackByObjectId:
        sourceCoursePacksWithBoundaryEvidence(),
      canonicalPrimaryIds: true,
      now: () => 10,
    };
    const compare = async (
      retrievalQuery: RetrievalQueryV2,
      extra: Parameters<typeof dependencies>[0] = {},
      context: { signal?: AbortSignal } = {},
    ) => {
      const a0 = await createHybridRetrieverV2(dependencies({
        ...shared,
        ...extra,
      }))(retrievalQuery, context);
      const c1 = await createHybridRetrieverV2(dependencies({
        ...shared,
        ...extra,
        queryEvidenceAdequacy: queryEvidenceAdequacyFixture(),
      }))(retrievalQuery, context);
      expect(c1).toEqual(a0);
      expect(c1.evidence.queryEvidenceAdequacy).toBeUndefined();
      expect(c1.provenance.queryEvidenceAdequacyPolicyHash)
        .toBeUndefined();
      expect(c1.timing.adequacyMs).toBeUndefined();
    };

    await compare(query("TEXT_TO_IMAGE", "找一个层级清楚的案例"));
    await compare(
      query(
        "TEXT_TO_TEXT",
        "这个标志有官方授权，可以商用吗？",
      ),
    );
    await compare(
      query("TEXT_TO_TEXT", "版面层级怎么看？"),
      { text: provider("TEXT_VECTOR", "THROW") },
    );
    const controller = new AbortController();
    controller.abort(new Error("test abort"));
    await compare(
      query("TEXT_TO_TEXT", "版面层级怎么看？"),
      {},
      { signal: controller.signal },
    );
  });

  it("propagates canonical primary integrity failures instead of manufacturing EMPTY", async () => {
    const retrieve = createHybridRetrieverV2(dependencies({
      capabilityBoundary: capabilityBoundaryFixture(),
      sourceCoursePackByObjectId:
        sourceCoursePacksWithBoundaryEvidence(),
      canonicalPrimaryIds: true,
      queryEvidenceAdequacy: queryEvidenceAdequacyFixture({
        canonicalText: "这段文字与展开证据故意不一致。",
      }),
    }));

    await expect(
      retrieve(query("TEXT_TO_TEXT", "版面层级怎么看？")),
    ).rejects.toThrow(
      "QUERY_EVIDENCE_ADEQUACY_PRIMARY_EXCERPT_INVALID",
    );
  });

  it("rejects adequacy trace, identity, timing, attestation, and decision tampering", async () => {
    const shared = {
      capabilityBoundary: capabilityBoundaryFixture(),
      sourceCoursePackByObjectId:
        sourceCoursePacksWithBoundaryEvidence(),
      canonicalPrimaryIds: true,
      queryEvidenceAdequacy: queryEvidenceAdequacyFixture(),
      now: () => 10,
    };
    const keep = await createHybridRetrieverV2(dependencies(shared))(
      query("TEXT_TO_TEXT", "版面层级怎么看？"),
    );
    const empty = await createHybridRetrieverV2(dependencies(shared))(
      query("TEXT_TO_TEXT", "请帮我导出 Figma Tokens"),
    );

    const missingIdentity = structuredClone(keep);
    delete missingIdentity.provenance
      .queryEvidenceFeatureAlgorithmHash;
    expect(EvidenceBundleV2Schema.safeParse(missingIdentity).success)
      .toBe(false);

    const missingTiming = structuredClone(keep);
    delete missingTiming.timing.adequacyMs;
    expect(EvidenceBundleV2Schema.safeParse(missingTiming).success)
      .toBe(false);

    const attestationDrift = structuredClone(keep);
    attestationDrift.evidence.queryEvidenceAdequacy!
      .retrievalAttestation.objectConsensusTraceHash =
        "0".repeat(64);
    expect(EvidenceBundleV2Schema.safeParse(attestationDrift).success)
      .toBe(false);

    const keepCleared = structuredClone(keep);
    keepCleared.evidence.primary = [];
    expect(EvidenceBundleV2Schema.safeParse(keepCleared).success)
      .toBe(false);

    const emptyWithSource = structuredClone(empty);
    emptyWithSource.sources.push(keep.sources[0]!);
    expect(EvidenceBundleV2Schema.safeParse(emptyWithSource).success)
      .toBe(false);
  });
});

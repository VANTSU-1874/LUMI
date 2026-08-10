import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  EVIDENCE_LIMITS_V2,
  EvidenceExpansionV2Schema,
  EvidenceNodeV2Schema,
  EvidenceRegionV2Schema,
  EvidenceSourceV2Schema,
  type EvidenceAssetV2,
  type EvidenceExpansionV2,
  type EvidenceNodeV2,
  type EvidenceRegionV2,
  type EvidenceSourceV2,
} from "./evidence-bundle-v2";
import {
  ChannelRetrievalResultV2Schema,
  CorpusProvenanceClaimsV2Schema,
  selectFinalSeedsV2,
  type CorpusProvenanceClaimV2,
  type EvidenceGraphExpanderV2,
} from "./hybrid-retriever-v2";
import {
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeAssetV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeNodeV2,
  type KnowledgeObjectV2,
} from "./knowledge-object-v2";
import {
  applyPostFusionAcceptanceV2,
  candidateProjectionForModeV2,
  ChannelCandidateV2Schema,
  createAcceptancePolicyV2,
  FusedCandidateV2Schema,
  fuseRankedChannelsV2,
  RRF_K_V2,
  RetrievalChannelV2Schema,
  type FusedCandidateV2,
  type FusionChannelTraceV2,
} from "./rank-fusion-v2";
import {
  ObjectConsensusTraceV2Schema,
  resolveTextObjectConsensusV2,
  type ObjectConsensusTraceV2,
} from "./object-candidate-v2";
import {
  RetrievalQueryV2Schema,
  type RetrievalQueryV2,
} from "./retrieval-query-v2";

type ExpansionInputV2 = Parameters<EvidenceGraphExpanderV2["expand"]>[0];
type ExpansionContextV2 = Parameters<EvidenceGraphExpanderV2["expand"]>[1];
type NodeOwnerV2 = {
  object: KnowledgeObjectV2;
  node: KnowledgeNodeV2;
};
type AuthenticatedObjectConsensusV2 = {
  trace: ObjectConsensusTraceV2;
  finalSeeds: readonly FusedCandidateV2[];
};

const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const CONTROLLED_SOURCE_PATH_PATTERN =
  /^(?:data\/knowledge|data\/courses|docs\/course-packs)\//;
const CONTROLLED_ROOT_SOURCE_PATHS = new Set([
  "Product-Spec.md",
  "附件2：参赛资料附件1-4.docx",
]);
const TEXT_NODE_KINDS = new Set<KnowledgeNodeV2["kind"]>([
  "DOCUMENT",
  "SECTION",
  "TEXT",
  "TABLE",
]);

export const CORPUS_EVIDENCE_RELATION_CONFIG_V2 = Object.freeze({
  id: "lumi-corpus-evidence-expander-v2",
  version: "1.2.0",
  phase: "POST_FUSION",
  parentDepth: 1,
  siblingsSameDirectParent: true,
  crossObjectRelations: false,
  parentSeedPolicyByMode: Object.freeze({
    TEXT_TO_TEXT: "FUSED_ORDER",
    TEXT_TO_IMAGE: "FUSED_ORDER",
    IMAGE_TO_IMAGE: "FUSED_ORDER",
    IMAGE_TEXT_TO_EVIDENCE:
      "STRONGEST_VISUAL_THEN_STRONGEST_LEXICAL",
  }),
  parentLimitByMode: Object.freeze({
    TEXT_TO_TEXT: EVIDENCE_LIMITS_V2.parents,
    TEXT_TO_IMAGE: EVIDENCE_LIMITS_V2.parents,
    IMAGE_TO_IMAGE: EVIDENCE_LIMITS_V2.parents,
    IMAGE_TEXT_TO_EVIDENCE: 2,
  }),
  imageTextParentChannelPreference: Object.freeze([
    "VISUAL_VECTOR",
    "LEXICAL",
  ] as const),
});

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sameCoursePack(
  left: KnowledgeObjectV2["sourceCoursePack"],
  right: KnowledgeObjectV2["sourceCoursePack"],
) {
  return left.id === right.id && left.version === right.version;
}

function sameRegion(
  left: FusionChannelTraceV2["region"],
  right: FusionChannelTraceV2["region"],
) {
  if (left === null || right === null) return left === right;
  return left.coordinateSpace === right.coordinateSpace
    && left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
    && left.origin === right.origin;
}

function assertAuthenticTrace(
  seed: FusedCandidateV2,
  trace: FusionChannelTraceV2,
  channelResults: ReadonlyMap<
    FusionChannelTraceV2["channel"],
    ReturnType<typeof ChannelRetrievalResultV2Schema.parse>
  >,
) {
  const channelResult = channelResults.get(trace.channel);
  const hit = channelResult?.hits.find((candidate) =>
    candidate.candidateId === seed.candidateId
    && candidate.objectId === seed.objectId
    && candidate.rank === trace.rank
    && candidate.representationId === trace.representationId
    && candidate.nodeId === trace.nodeId
    && candidate.assetId === trace.assetId
    && candidate.rawScore === trace.rawScore
    && sameRegion(candidate.region, trace.region));
  if (!hit) {
    throw new Error(
      `CORPUS_EVIDENCE_TRACE_NOT_IN_CHANNEL_RESULT:${seed.candidateId}:${trace.channel}`,
    );
  }
  const expectedContribution = 1 / (RRF_K_V2 + trace.rank);
  if (trace.contribution !== expectedContribution) {
    throw new Error(
      `CORPUS_EVIDENCE_TRACE_CONTRIBUTION_INVALID:${seed.candidateId}:${trace.channel}`,
    );
  }
}

function assertAuthenticObjectConsensusTrace(
  input: ObjectConsensusTraceV2 | null | undefined,
  channelResults: ReadonlyMap<
    FusionChannelTraceV2["channel"],
    ReturnType<typeof ChannelRetrievalResultV2Schema.parse>
  >,
  sourceChannelResultsInput:
    | ReadonlyMap<
        FusionChannelTraceV2["channel"],
        ReturnType<typeof ChannelRetrievalResultV2Schema.parse>
      >
    | undefined,
): AuthenticatedObjectConsensusV2 | null {
  if (!input) {
    if (sourceChannelResultsInput) {
      throw new Error(
        "CORPUS_EVIDENCE_OBJECT_CONSENSUS_SOURCE_WITHOUT_TRACE",
      );
    }
    return null;
  }
  if (!sourceChannelResultsInput) {
    throw new Error(
      "CORPUS_EVIDENCE_OBJECT_CONSENSUS_SOURCE_RESULTS_MISSING",
    );
  }
  const consensus = ObjectConsensusTraceV2Schema.parse(input);
  const sourceChannels = ["LEXICAL", "TEXT_VECTOR"] as const;
  if (
    sourceChannelResultsInput.size !== sourceChannels.length
    || Array.from(sourceChannelResultsInput.keys()).some(
      (channel) => !sourceChannels.includes(
        channel as typeof sourceChannels[number],
      ),
    )
  ) {
    throw new Error(
      "CORPUS_EVIDENCE_OBJECT_CONSENSUS_SOURCE_RESULTS_INVALID",
    );
  }
  const sourceChannelResults = new Map(sourceChannels.map((channel) => {
    const raw = sourceChannelResultsInput.get(channel);
    if (!raw) {
      throw new Error(
        `CORPUS_EVIDENCE_OBJECT_CONSENSUS_SOURCE_RESULT_MISSING:${channel}`,
      );
    }
    const parsed = ChannelRetrievalResultV2Schema.parse(raw);
    if (
      parsed.summary.channel !== channel
      || parsed.summary.status !== "SUCCESS"
    ) {
      throw new Error(
        `CORPUS_EVIDENCE_OBJECT_CONSENSUS_SOURCE_RESULT_INVALID:${channel}`,
      );
    }
    const effective = channelResults.get(channel);
    if (
      !effective
      || parsed.summary.corpusBundleHash
        !== effective.summary.corpusBundleHash
      || !isDeepStrictEqual(
        parsed.summary.identity,
        effective.summary.identity,
      )
    ) {
      throw new Error(
        `CORPUS_EVIDENCE_OBJECT_CONSENSUS_SOURCE_IDENTITY_MISMATCH:${channel}`,
      );
    }
    return [channel, parsed] as const;
  }));
  const expected = resolveTextObjectConsensusV2({
    lexicalHits: sourceChannelResults.get("LEXICAL")!.hits,
    textVectorHits: sourceChannelResults.get("TEXT_VECTOR")!.hits,
    lexicalObjects:
      sourceChannelResults.get("LEXICAL")!.objectCandidates ?? [],
    textVectorObjects:
      sourceChannelResults.get("TEXT_VECTOR")!.objectCandidates ?? [],
  });
  if (!isDeepStrictEqual(consensus, expected.trace)) {
    throw new Error(
      "CORPUS_EVIDENCE_OBJECT_CONSENSUS_RECOMPUTE_MISMATCH",
    );
  }
  for (const channel of sourceChannels) {
    const effective = channelResults.get(channel);
    if (
      !effective
      || effective.summary.channel !== channel
      || !isDeepStrictEqual(effective.hits, expected.rankings[channel])
    ) {
      throw new Error(
        `CORPUS_EVIDENCE_OBJECT_CONSENSUS_EFFECTIVE_RANKING_MISMATCH:${channel}`,
      );
    }
  }
  const fused = fuseRankedChannelsV2({
    LEXICAL: expected.rankings.LEXICAL,
    TEXT_VECTOR: expected.rankings.TEXT_VECTOR,
  });
  const accepted = applyPostFusionAcceptanceV2(
    "TEXT_TO_TEXT",
    fused,
    createAcceptancePolicyV2(),
  ).accepted;
  return {
    trace: consensus,
    finalSeeds: selectFinalSeedsV2("TEXT_TO_TEXT", accepted),
  };
}

function assertAuthenticObjectConsensusSeeds(
  seeds: readonly FusedCandidateV2[],
  consensus: AuthenticatedObjectConsensusV2 | null,
) {
  if (!consensus) return;
  if (!isDeepStrictEqual(seeds, consensus.finalSeeds)) {
    throw new Error(
      "CORPUS_EVIDENCE_OBJECT_CONSENSUS_FUSED_SEEDS_INVALID",
    );
  }
}

function excerptForNode(node: KnowledgeNodeV2): string | null {
  switch (node.kind) {
    case "DOCUMENT":
    case "SECTION":
      return node.title;
    case "TEXT":
      return node.text;
    case "TABLE":
      return node.plainText;
    case "REGION":
      return node.label;
    case "IMAGE":
      return null;
  }
}

function assetIdForNode(node: KnowledgeNodeV2) {
  return node.kind === "IMAGE" || node.kind === "REGION"
    ? node.assetId
    : null;
}

function normalizeCorpusBbox(
  node: KnowledgeNodeV2,
  asset: KnowledgeAssetV2,
): EvidenceRegionV2["bbox"] | null {
  const bbox = node.location?.bbox;
  if (!bbox) return null;
  if (bbox.coordinateSpace === "NORMALIZED") return bbox;
  return {
    coordinateSpace: "NORMALIZED",
    x: bbox.x / asset.dimensions.widthPx,
    y: bbox.y / asset.dimensions.heightPx,
    width: bbox.width / asset.dimensions.widthPx,
    height: bbox.height / asset.dimensions.heightPx,
  };
}

function sameBbox(
  left: EvidenceRegionV2["bbox"],
  right: EvidenceRegionV2["bbox"],
) {
  const epsilon = 1e-12;
  return Math.abs(left.x - right.x) <= epsilon
    && Math.abs(left.y - right.y) <= epsilon
    && Math.abs(left.width - right.width) <= epsilon
    && Math.abs(left.height - right.height) <= epsilon;
}

function stableRegionId(input: {
  seedCandidateId: string;
  imageNodeId: string;
  bbox: EvidenceRegionV2["bbox"];
  origin: "INDEXED_REGION" | "PATCH_MATCH";
}) {
  const digest = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  return `region-${digest}`;
}

function evidenceAsset(
  asset: KnowledgeAssetV2,
  objectId: string,
): EvidenceAssetV2 {
  return {
    assetId: asset.id,
    objectId,
    sha256: asset.sha256,
    mimeType: asset.mimeType,
    dimensions: asset.dimensions,
  };
}

function evidenceSource(
  object: KnowledgeObjectV2,
  claim?: CorpusProvenanceClaimV2,
): EvidenceSourceV2 {
  const locators = uniqueById(
    object.provenance.locators
      .filter((locator) =>
        locator.kind === "URL"
        || CONTROLLED_SOURCE_PATH_PATTERN.test(locator.path)
        || CONTROLLED_ROOT_SOURCE_PATHS.has(locator.path))
      .sort((left, right) => {
        const leftKey = left.kind === "URL" ? `URL:${left.url}` : `LOCAL_DOCUMENT:${left.path}`;
        const rightKey = right.kind === "URL"
          ? `URL:${right.url}`
          : `LOCAL_DOCUMENT:${right.path}`;
        return compareCodePoints(leftKey, rightKey);
      }),
    (locator) => locator.kind === "URL" ? `URL:${locator.url}` : `LOCAL_DOCUMENT:${locator.path}`,
  ).slice(0, 5);
  if (locators.length === 0) {
    throw new Error(`CORPUS_EVIDENCE_SOURCE_LOCATOR_UNSUPPORTED:${object.id}`);
  }
  return EvidenceSourceV2Schema.parse({
    sourceId: claim?.sourceId ?? object.id,
    objectId: object.id,
    authority: claim?.authority ?? object.provenance.authority,
    verifiedDate: claim?.verifiedDate ?? object.provenance.verifiedDate,
    scope: object.provenance.scope,
    locators,
  });
}

function evidenceNode(input: {
  owner: NodeOwnerV2;
  relation: EvidenceNodeV2["relation"];
  seedCandidateId: string;
  sourceId: string;
}): EvidenceNodeV2 {
  const { object, node } = input.owner;
  return EvidenceNodeV2Schema.parse({
    nodeId: node.id,
    objectId: object.id,
    kind: node.kind,
    relation: input.relation,
    seedCandidateId: input.seedCandidateId,
    parentNodeId: node.parentId,
    sourceId: input.sourceId,
    sourceCoursePack: object.sourceCoursePack,
    excerpt: excerptForNode(node),
    assetId: assetIdForNode(node),
  });
}

function uniqueById<T>(items: readonly T[], id: (item: T) => string) {
  const result: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = id(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function createCorpusEvidenceGraphExpanderV2(
  corpusInput: unknown,
): EvidenceGraphExpanderV2 {
  const corpus: KnowledgeCorpusBundleV2 = verifyKnowledgeCorpusBundleV2(corpusInput);
  const objectsById = new Map(corpus.objects.map((object) => [object.id, object]));
  const nodesById = new Map<string, NodeOwnerV2>();
  const assetsById = new Map(corpus.assets.map((asset) => [asset.id, asset]));
  const assetOwnerById = new Map<string, KnowledgeObjectV2>();
  const imageNodeByAssetId = new Map<string, NodeOwnerV2>();
  const regionNodesByAssetId = new Map<string, NodeOwnerV2[]>();

  for (const object of corpus.objects) {
    for (const node of object.nodes) {
      nodesById.set(node.id, { object, node });
      if (node.kind === "IMAGE") {
        if (imageNodeByAssetId.has(node.assetId)) {
          throw new Error(`CORPUS_EVIDENCE_IMAGE_OWNER_CONFLICT:${node.assetId}`);
        }
        imageNodeByAssetId.set(node.assetId, { object, node });
      } else if (node.kind === "REGION") {
        const regions = regionNodesByAssetId.get(node.assetId) ?? [];
        regions.push({ object, node });
        regionNodesByAssetId.set(node.assetId, regions);
      }
    }
    for (const assetId of object.assetIds) {
      const existing = assetOwnerById.get(assetId);
      if (existing && existing.id !== object.id) {
        throw new Error(`CORPUS_EVIDENCE_ASSET_OWNER_CONFLICT:${assetId}`);
      }
      assetOwnerById.set(assetId, object);
    }
  }

  for (const [assetId, object] of assetOwnerById) {
    const imageOwner = imageNodeByAssetId.get(assetId);
    if (!imageOwner || imageOwner.object.id !== object.id || !assetsById.has(assetId)) {
      throw new Error(`CORPUS_EVIDENCE_ASSET_IMAGE_MAPPING_INVALID:${assetId}`);
    }
  }

  function nearestTextualOwner(owner: NodeOwnerV2): NodeOwnerV2 | null {
    let current: NodeOwnerV2 | undefined = owner;
    while (current) {
      if (TEXT_NODE_KINDS.has(current.node.kind)) return current;
      if (current.node.parentId === null) return null;
      const parent = nodesById.get(current.node.parentId);
      if (!parent || parent.object.id !== owner.object.id) return null;
      current = parent;
    }
    return null;
  }

  async function resolve(
    input: ExpansionInputV2,
    context: ExpansionContextV2,
    includeRelations: boolean,
  ): Promise<EvidenceExpansionV2> {
    context.signal?.throwIfAborted();
    const query: RetrievalQueryV2 = RetrievalQueryV2Schema.parse(input.query);
    if (query.scope.corpusBundleHash !== corpus.bundleHash) {
      throw new Error("CORPUS_EVIDENCE_QUERY_BUNDLE_MISMATCH");
    }
    const seeds = FusedCandidateV2Schema.array()
      .max(EVIDENCE_LIMITS_V2.primary)
      .parse(input.seeds)
      .sort((left, right) =>
        left.fusedRank - right.fusedRank
        || compareCodePoints(left.candidateId, right.candidateId));
    if (new Set(seeds.map(({ candidateId }) => candidateId)).size !== seeds.length) {
      throw new Error("CORPUS_EVIDENCE_DUPLICATE_SEED");
    }
    if (new Set(seeds.map(({ objectId }) => objectId)).size !== seeds.length) {
      throw new Error("CORPUS_EVIDENCE_DUPLICATE_SEED_OBJECT");
    }
    const requiredSourceIds = [...input.requiredSourceIds].sort(compareCodePoints);
    if (
      new Set(requiredSourceIds).size !== requiredSourceIds.length
      || requiredSourceIds.some((sourceId) => !SOURCE_ID_PATTERN.test(sourceId))
    ) {
      throw new Error("CORPUS_EVIDENCE_REQUIRED_SOURCE_IDS_INVALID");
    }
    const requiredSourceClaims = CorpusProvenanceClaimsV2Schema
      .parse(input.requiredSourceClaims ?? [])
      .sort((left, right) => compareCodePoints(left.sourceId, right.sourceId));
    if (
      requiredSourceClaims.length > 0
      && (
        requiredSourceClaims.length !== requiredSourceIds.length
        || requiredSourceClaims.some(({ sourceId }) => !requiredSourceIds.includes(sourceId))
      )
    ) {
      throw new Error("CORPUS_EVIDENCE_REQUIRED_SOURCE_CLAIMS_INVALID");
    }
    const requiredClaimKinds = input.requiredClaimKinds ?? [];
    if (new Set(requiredClaimKinds).size !== requiredClaimKinds.length) {
      throw new Error("CORPUS_EVIDENCE_REQUIRED_CLAIM_KINDS_INVALID");
    }
    const captionFallbackHits = ChannelCandidateV2Schema.array()
      .max(20)
      .parse(input.captionFallbackHits ?? [])
      .sort((left, right) =>
        left.rank - right.rank || compareCodePoints(left.candidateId, right.candidateId));
    if (
      captionFallbackHits.length > 0
      && (
        query.mode !== "TEXT_TO_IMAGE"
        || captionFallbackHits.some((hit, index) =>
          hit.rank !== index + 1
          || hit.assetId === null
          || hit.nodeId === null
          || hit.candidateId !== hit.assetId
          || hit.region !== null)
      )
    ) {
      throw new Error("CORPUS_EVIDENCE_CAPTION_FALLBACK_INVALID");
    }

    const channelResults = new Map<
      FusionChannelTraceV2["channel"],
      ReturnType<typeof ChannelRetrievalResultV2Schema.parse>
    >();
    for (const channel of RetrievalChannelV2Schema.options) {
      const raw = input.channelResults.get(channel);
      if (!raw) continue;
      const parsed = ChannelRetrievalResultV2Schema.parse(raw);
      if (parsed.summary.channel !== channel) {
        throw new Error(`CORPUS_EVIDENCE_CHANNEL_RESULT_MISMATCH:${channel}`);
      }
      if (parsed.summary.corpusBundleHash !== corpus.bundleHash) {
        throw new Error(`CORPUS_EVIDENCE_CHANNEL_CORPUS_MISMATCH:${channel}`);
      }
      channelResults.set(channel, parsed);
    }
    const objectConsensus = assertAuthenticObjectConsensusTrace(
      input.objectConsensus,
      channelResults,
      input.objectConsensusSourceChannelResults,
    );
    assertAuthenticObjectConsensusSeeds(seeds, objectConsensus);

    const excludedAssetIds = new Set(query.excludeAssetIds);
    const primaryNodes: EvidenceNodeV2[] = [];
    const parentNodes: EvidenceNodeV2[] = [];
    const siblingNodes: EvidenceNodeV2[] = [];
    const selectedAssets: EvidenceAssetV2[] = [];
    const selectedRegions: EvidenceRegionV2[] = [];
    const sources: EvidenceSourceV2[] = [];
    const primaryOwnerBySeed = new Map<string, NodeOwnerV2>();
    const sourceIdBySeed = new Map<string, string>();

    for (const seed of seeds) {
      context.signal?.throwIfAborted();
      const projection = candidateProjectionForModeV2(query.mode);
      const projectionMatches = projection === "NODE"
        ? (
            seed.channelTraces.length > 0
            && seed.channelTraces.every(({ channel, nodeId }) =>
              channel !== "VISUAL_VECTOR"
              && nodeId !== null
              && seed.candidateId === nodeId)
          )
        : seed.candidateId === seed.objectId;
      if (!projectionMatches) {
        throw new Error(`CORPUS_EVIDENCE_SEED_IDENTITY_MISMATCH:${seed.candidateId}`);
      }
      const object = objectsById.get(seed.objectId);
      if (!object) throw new Error(`CORPUS_EVIDENCE_OBJECT_UNKNOWN:${seed.objectId}`);
      if (
        query.scope.sourceCoursePack !== null
        && !sameCoursePack(object.sourceCoursePack, query.scope.sourceCoursePack)
      ) {
        throw new Error(`CORPUS_EVIDENCE_COURSE_SCOPE_VIOLATION:${seed.objectId}`);
      }
      const objectRequiredClaims = requiredSourceClaims.filter(({ objectId }) =>
        objectId === object.id);
      if (
        requiredSourceIds.length > 0
        && (
          requiredSourceClaims.length > 0
            ? objectRequiredClaims.length === 0
            : !requiredSourceIds.includes(object.id)
        )
      ) {
        throw new Error(`CORPUS_EVIDENCE_REQUIRED_SOURCE_MISMATCH:${object.id}`);
      }
      if (objectRequiredClaims.length > 0) {
        sources.push(...objectRequiredClaims.map((claim) => evidenceSource(object, claim)));
      } else {
        sources.push(evidenceSource(object));
      }
      sourceIdBySeed.set(
        seed.candidateId,
        objectRequiredClaims[0]?.sourceId ?? object.id,
      );

      const traceNodes: Array<{
        trace: FusionChannelTraceV2;
        owner: NodeOwnerV2;
      }> = [];
      const traceAssets: Array<{
        trace: FusionChannelTraceV2;
        asset: KnowledgeAssetV2;
        owner: KnowledgeObjectV2;
        imageOwner: NodeOwnerV2;
      }> = [];
      for (const trace of seed.channelTraces) {
        assertAuthenticTrace(seed, trace, channelResults);
        if (trace.nodeId !== null) {
          const nodeOwner = nodesById.get(trace.nodeId);
          if (!nodeOwner) {
            throw new Error(`CORPUS_EVIDENCE_NODE_UNKNOWN:${trace.nodeId}`);
          }
          if (nodeOwner.object.id !== object.id) {
            throw new Error(`CORPUS_EVIDENCE_NODE_CROSSES_OBJECT:${trace.nodeId}`);
          }
          const nodeAssetId = assetIdForNode(nodeOwner.node);
          if (nodeAssetId !== null && excludedAssetIds.has(nodeAssetId)) {
            throw new Error(`CORPUS_EVIDENCE_QUERY_ASSET_REJECTED:${nodeAssetId}`);
          }
          traceNodes.push({ trace, owner: nodeOwner });
        }
        const tracedAssetId = trace.assetId
          ?? (
            trace.channel === "VISUAL_VECTOR" && trace.nodeId !== null
              ? assetIdForNode(nodesById.get(trace.nodeId)!.node)
              : null
          );
        if (tracedAssetId === null) continue;
        if (excludedAssetIds.has(tracedAssetId)) {
          throw new Error(`CORPUS_EVIDENCE_QUERY_ASSET_REJECTED:${tracedAssetId}`);
        }
        const asset = assetsById.get(tracedAssetId);
        const assetOwner = assetOwnerById.get(tracedAssetId);
        const imageOwner = imageNodeByAssetId.get(tracedAssetId);
        if (!asset || !assetOwner || !imageOwner) {
          throw new Error(`CORPUS_EVIDENCE_ASSET_UNKNOWN:${tracedAssetId}`);
        }
        if (assetOwner.id !== object.id || imageOwner.object.id !== object.id) {
          throw new Error(`CORPUS_EVIDENCE_ASSET_CROSSES_OBJECT:${tracedAssetId}`);
        }
        if (
          trace.nodeId !== null
          && ["IMAGE", "REGION"].includes(nodesById.get(trace.nodeId)!.node.kind)
          && assetIdForNode(nodesById.get(trace.nodeId)!.node) !== tracedAssetId
        ) {
          throw new Error(`CORPUS_EVIDENCE_TRACE_ASSET_NODE_MISMATCH:${tracedAssetId}`);
        }
        traceAssets.push({
          trace,
          asset,
          owner: assetOwner,
          imageOwner,
        });
      }

      const assetChannelOrder = new Map([
        ["VISUAL_VECTOR", 0],
        ["LEXICAL", 1],
        ["TEXT_VECTOR", 2],
      ] as const);
      traceAssets.sort((left, right) =>
        (assetChannelOrder.get(left.trace.channel) ?? 9)
          - (assetChannelOrder.get(right.trace.channel) ?? 9)
        || left.trace.rank - right.trace.rank
        || compareCodePoints(left.asset.id, right.asset.id));
      const selectedAsset = traceAssets[0] ?? null;
      if (
        query.mode !== "TEXT_TO_TEXT"
        && selectedAsset
        && captionFallbackHits.length === 0
        && (channelResults.get("VISUAL_VECTOR")?.visualAssetHits?.length ?? 0) === 0
      ) {
        selectedAssets.push(evidenceAsset(selectedAsset.asset, object.id));
        const tracedRegions = traceAssets
          .filter(({ asset, trace }) =>
            asset.id === selectedAsset.asset.id && trace.region !== null)
          .sort((left, right) =>
            left.trace.rank - right.trace.rank
            || compareCodePoints(left.trace.channel, right.trace.channel));
        for (const { trace } of tracedRegions.slice(0, 1)) {
          const bbox = {
            coordinateSpace: "NORMALIZED" as const,
            x: trace.region!.x,
            y: trace.region!.y,
            width: trace.region!.width,
            height: trace.region!.height,
          };
          const corpusRegion = (regionNodesByAssetId.get(selectedAsset.asset.id) ?? [])
            .filter(({ object: regionObject }) => regionObject.id === object.id)
            .find(({ node }) => {
              const normalized = normalizeCorpusBbox(node, selectedAsset.asset);
              return normalized !== null && sameBbox(normalized, bbox);
            });
          selectedRegions.push(EvidenceRegionV2Schema.parse({
            regionId: corpusRegion?.node.id ?? stableRegionId({
              seedCandidateId: seed.candidateId,
              imageNodeId: selectedAsset.imageOwner.node.id,
              bbox,
              origin: trace.region!.origin,
            }),
            imageNodeId: selectedAsset.imageOwner.node.id,
            regionNodeId: corpusRegion?.node.id ?? null,
            objectId: object.id,
            assetId: selectedAsset.asset.id,
            bbox,
            origin: corpusRegion ? "CORPUS_REGION" : trace.region!.origin,
          }));
        }
      }

      const textChannelOrder = new Map([
        ["LEXICAL", 0],
        ["TEXT_VECTOR", 1],
      ] as const);
      const textualOwner = traceNodes
        .filter(({ trace }) => trace.channel !== "VISUAL_VECTOR")
        .map(({ trace, owner }) => ({
          trace,
          owner: nearestTextualOwner(owner),
        }))
        .filter((entry): entry is {
          trace: FusionChannelTraceV2;
          owner: NodeOwnerV2;
        } => entry.owner !== null)
        .sort((left, right) =>
          (textChannelOrder.get(left.trace.channel as "LEXICAL" | "TEXT_VECTOR") ?? 9)
            - (textChannelOrder.get(right.trace.channel as "LEXICAL" | "TEXT_VECTOR") ?? 9)
          || left.trace.rank - right.trace.rank
          || compareCodePoints(left.owner.node.id, right.owner.node.id))[0]?.owner
        ?? null;
      const rootOwner = {
        object,
        node: object.nodes.find(({ id }) => id === object.rootNodeId)!,
      };
      const primaryOwner = query.mode === "TEXT_TO_TEXT"
        ? textualOwner ?? rootOwner
        : query.mode === "IMAGE_TEXT_TO_EVIDENCE"
          ? textualOwner ?? selectedAsset?.imageOwner ?? rootOwner
          : selectedAsset?.imageOwner ?? textualOwner ?? rootOwner;
      primaryOwnerBySeed.set(seed.candidateId, primaryOwner);
      primaryNodes.push(evidenceNode({
        owner: primaryOwner,
        relation: "PRIMARY",
        seedCandidateId: seed.candidateId,
        sourceId: sourceIdBySeed.get(seed.candidateId)!,
      }));
    }

    const rankedVisualAssets = channelResults.get("VISUAL_VECTOR")?.visualAssetHits ?? [];
    if (
      query.mode !== "TEXT_TO_TEXT"
      && captionFallbackHits.length === 0
      && rankedVisualAssets.length > 0
    ) {
      const retainedObjectIds = new Set(seeds.map(({ objectId }) => objectId));
      for (const hit of rankedVisualAssets) {
        if (!retainedObjectIds.has(hit.objectId)) continue;
        const asset = assetsById.get(hit.assetId);
        const owner = assetOwnerById.get(hit.assetId);
        const imageOwner = imageNodeByAssetId.get(hit.assetId);
        if (
          !asset
          || !owner
          || !imageOwner
          || owner.id !== hit.objectId
          || imageOwner.object.id !== hit.objectId
          || imageOwner.node.id !== hit.nodeId
          || excludedAssetIds.has(hit.assetId)
        ) {
          throw new Error(`CORPUS_EVIDENCE_VISUAL_ASSET_INVALID:${hit.assetId}`);
        }
        selectedAssets.push(evidenceAsset(asset, hit.objectId));
        if (hit.region === null) continue;
        const bbox = {
          coordinateSpace: "NORMALIZED" as const,
          x: hit.region.x,
          y: hit.region.y,
          width: hit.region.width,
          height: hit.region.height,
        };
        const corpusRegion = (regionNodesByAssetId.get(hit.assetId) ?? [])
          .filter(({ object: regionObject }) => regionObject.id === hit.objectId)
          .find(({ node }) => {
            const normalized = normalizeCorpusBbox(node, asset);
            return normalized !== null && sameBbox(normalized, bbox);
          });
        selectedRegions.push(EvidenceRegionV2Schema.parse({
          regionId: corpusRegion?.node.id ?? stableRegionId({
            seedCandidateId: hit.objectId,
            imageNodeId: imageOwner.node.id,
            bbox,
            origin: hit.region.origin,
          }),
          imageNodeId: imageOwner.node.id,
          regionNodeId: corpusRegion?.node.id ?? null,
          objectId: hit.objectId,
          assetId: hit.assetId,
          bbox,
          origin: corpusRegion ? "CORPUS_REGION" : hit.region.origin,
        }));
      }
    }

    if (captionFallbackHits.length > 0) {
      const retainedObjectIds = new Set(seeds.map(({ objectId }) => objectId));
      for (const hit of captionFallbackHits) {
        if (!retainedObjectIds.has(hit.objectId)) continue;
        const asset = assetsById.get(hit.assetId!);
        const owner = assetOwnerById.get(hit.assetId!);
        const imageOwner = imageNodeByAssetId.get(hit.assetId!);
        if (
          !asset
          || !owner
          || !imageOwner
          || owner.id !== hit.objectId
          || imageOwner.object.id !== hit.objectId
          || imageOwner.node.id !== hit.nodeId
          || excludedAssetIds.has(hit.assetId!)
        ) {
          throw new Error(`CORPUS_EVIDENCE_CAPTION_ASSET_INVALID:${hit.assetId}`);
        }
        selectedAssets.push(evidenceAsset(asset, hit.objectId));
      }
    }

    if (includeRelations) {
      const strongestSeedForChannel = (channel: "LEXICAL" | "TEXT_VECTOR" | "VISUAL_VECTOR") =>
        [...seeds]
          .filter(({ channelTraces }) =>
            channelTraces.some((trace) => trace.channel === channel))
          .sort((left, right) => {
            const leftRank = left.channelTraces.find(
              (trace) => trace.channel === channel,
            )!.rank;
            const rightRank = right.channelTraces.find(
              (trace) => trace.channel === channel,
            )!.rank;
            return leftRank - rightRank
              || left.fusedRank - right.fusedRank
              || compareCodePoints(left.candidateId, right.candidateId);
          })[0];
      const multimodalParentSeeds =
        CORPUS_EVIDENCE_RELATION_CONFIG_V2.imageTextParentChannelPreference
          .map((channel) => strongestSeedForChannel(channel))
          .filter((seed): seed is FusedCandidateV2 => seed !== undefined);
      const parentPolicy =
        CORPUS_EVIDENCE_RELATION_CONFIG_V2.parentSeedPolicyByMode[query.mode];
      const parentSeeds = parentPolicy
        === "STRONGEST_VISUAL_THEN_STRONGEST_LEXICAL"
        ? Array.from(new Map(
            multimodalParentSeeds.map((seed) => [seed.candidateId, seed]),
          ).values())
        : seeds;
      const parentLimit = Math.min(
        CORPUS_EVIDENCE_RELATION_CONFIG_V2.parentLimitByMode[query.mode],
        EVIDENCE_LIMITS_V2.parents,
      );
      for (const seed of parentSeeds) {
        if (
          primaryNodes.length + parentNodes.length + siblingNodes.length
            >= EVIDENCE_LIMITS_V2.nodes
          || parentNodes.length >= parentLimit
        ) break;
        const primaryOwner = primaryOwnerBySeed.get(seed.candidateId)!;
        if (primaryOwner.node.parentId === null) continue;
        const parentOwner = nodesById.get(primaryOwner.node.parentId);
        if (!parentOwner || parentOwner.object.id !== primaryOwner.object.id) {
          throw new Error(`CORPUS_EVIDENCE_PARENT_CROSSES_OBJECT:${primaryOwner.node.id}`);
        }
        parentNodes.push(evidenceNode({
          owner: parentOwner,
          relation: "PARENT",
          seedCandidateId: seed.candidateId,
          sourceId: sourceIdBySeed.get(seed.candidateId)!,
        }));
      }

      for (const seed of seeds) {
        if (
          primaryNodes.length + parentNodes.length + siblingNodes.length
            >= EVIDENCE_LIMITS_V2.nodes
          || siblingNodes.length >= EVIDENCE_LIMITS_V2.siblings
        ) break;
        const primaryOwner = primaryOwnerBySeed.get(seed.candidateId)!;
        if (primaryOwner.node.parentId === null) continue;
        const parentOwner = nodesById.get(primaryOwner.node.parentId)!;
        const siblings = parentOwner.node.childrenIds
          .filter((nodeId) => nodeId !== primaryOwner.node.id)
          .map((nodeId) => nodesById.get(nodeId))
          .filter((owner): owner is NodeOwnerV2 =>
            owner !== undefined
            && owner.object.id === primaryOwner.object.id
            && (
              assetIdForNode(owner.node) === null
              || !excludedAssetIds.has(assetIdForNode(owner.node)!)
            ))
          .sort((left, right) => compareCodePoints(left.node.id, right.node.id));
        for (const sibling of siblings) {
          if (
            primaryNodes.length + parentNodes.length + siblingNodes.length
              >= EVIDENCE_LIMITS_V2.nodes
            || siblingNodes.length >= EVIDENCE_LIMITS_V2.siblings
          ) break;
          siblingNodes.push(evidenceNode({
            owner: sibling,
            relation: "SIBLING",
            seedCandidateId: seed.candidateId,
            sourceId: sourceIdBySeed.get(seed.candidateId)!,
          }));
        }
      }
    }

    let excerptCharacters = EVIDENCE_LIMITS_V2.excerptCharacters;
    const nodes = [...primaryNodes, ...parentNodes, ...siblingNodes].map((node) => {
      if (node.excerpt === null) return node;
      const excerpt = node.excerpt.slice(0, excerptCharacters);
      excerptCharacters -= excerpt.length;
      return { ...node, excerpt };
    });
    return EvidenceExpansionV2Schema.parse({
      nodes,
      assets: uniqueById(selectedAssets, ({ assetId }) => assetId)
        .slice(0, EVIDENCE_LIMITS_V2.assets),
      regions: uniqueById(selectedRegions, ({ regionId }) => regionId)
        .sort((left, right) => compareCodePoints(left.regionId, right.regionId))
        .slice(0, EVIDENCE_LIMITS_V2.regions),
      sources: uniqueById(sources, ({ sourceId }) => sourceId)
        .sort((left, right) => compareCodePoints(left.sourceId, right.sourceId))
        .slice(0, EVIDENCE_LIMITS_V2.primary),
    });
  }

  return {
    expand: (input, context) => resolve(input, context, true),
    resolvePrimaries: (input, context) => resolve(input, context, false),
  };
}

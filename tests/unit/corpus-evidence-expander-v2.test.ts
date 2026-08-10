// @vitest-environment node

import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import {
  CORPUS_EVIDENCE_RELATION_CONFIG_V2,
  createCorpusEvidenceGraphExpanderV2,
} from "@/lib/knowledge/corpus-evidence-expander-v2";
import {
  EVIDENCE_LIMITS_V2,
  EvidenceExpansionV2Schema,
} from "@/lib/knowledge/evidence-bundle-v2";
import {
  selectFinalSeedsV2,
  type ChannelRetrievalResultV2,
} from "@/lib/knowledge/hybrid-retriever-v2";
import {
  sealKnowledgeCorpusBundleV2,
  sealKnowledgeObjectV2,
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeNodeV2,
  type KnowledgeObjectV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  applyPostFusionAcceptanceV2,
  ChannelCandidateV2Schema,
  createAcceptancePolicyV2,
  RetrievalChannelV2Schema,
  fuseRankedChannelsV2,
  type ChannelCandidateV2,
  type FusedCandidateV2,
  type RetrievalChannelV2,
  type RetrievalRegionV2,
} from "@/lib/knowledge/rank-fusion-v2";
import {
  ObjectConsensusTraceV2Schema,
  resolveTextObjectConsensusV2,
  type ObjectCandidateV2,
  type ObjectConsensusTraceV2,
} from "@/lib/knowledge/object-candidate-v2";
import {
  createRetrievalQueryV2,
  type RetrievalQueryV2,
} from "@/lib/knowledge/retrieval-query-v2";

const HASH = "a".repeat(64);
const TEST_REGION_ID = "node-expander-real-region";
const SIBLING_IDS = Array.from(
  { length: 10 },
  (_, index) => `node-expander-sibling-${index.toString().padStart(2, "0")}`,
);

type HitSpec = {
  nodeId: string | null;
  assetId: string | null;
  region?: RetrievalRegionV2 | null;
};
type TextNodeV2 = Extract<KnowledgeNodeV2, { kind: "TEXT" }>;
type ImageNodeV2 = Extract<KnowledgeNodeV2, { kind: "IMAGE" }>;

function controlledSource(object: KnowledgeObjectV2) {
  return object.provenance.locators.some((locator) =>
    locator.kind === "URL"
    || /^(?:data\/knowledge|data\/courses)\//.test(locator.path));
}

function contentNode(object: KnowledgeObjectV2): TextNodeV2 {
  return object.nodes.find(
    (node): node is TextNodeV2 => node.kind === "TEXT" && node.role === "CONTENT",
  )!;
}

function imageNode(object: KnowledgeObjectV2, assetId: string): ImageNodeV2 {
  return object.nodes.find(
    (node): node is ImageNodeV2 => node.kind === "IMAGE" && node.assetId === assetId,
  )!;
}

function compactCorpus(actual: KnowledgeCorpusBundleV2) {
  const primaryBase = actual.objects.find((object) =>
    object.sourceCoursePack.id === "layout-design"
    && object.legacyPlacement.coursePack.id !== object.sourceCoursePack.id
    && object.assetIds.length >= 2
    && controlledSource(object))!;
  const foreign = actual.objects.find((object) =>
    object.sourceCoursePack.id === "book-design"
    && object.id !== primaryBase.id
    && controlledSource(object))!;
  const firstAssetId = primaryBase.assetIds[0]!;
  const primaryImage = imageNode(primaryBase, firstAssetId);
  const primaryText = contentNode(primaryBase);
  const contentParentId = primaryText.parentId!;
  const nodes = primaryBase.nodes.map((node) => {
    if (node.id === primaryImage.id) {
      return { ...node, childrenIds: [...node.childrenIds, TEST_REGION_ID] };
    }
    if (node.id === contentParentId) {
      return { ...node, childrenIds: [...node.childrenIds, ...SIBLING_IDS] };
    }
    return node;
  });
  const modifiedPrimary = sealKnowledgeObjectV2({
    ...primaryBase,
    nodes: [
      ...nodes,
      {
        id: TEST_REGION_ID,
        kind: "REGION",
        parentId: primaryImage.id,
        childrenIds: [],
        relatedIds: [],
        location: {
          pageNumber: null,
          bbox: {
            coordinateSpace: "NORMALIZED",
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.4,
          },
          sourceSpan: null,
        },
        assetId: firstAssetId,
        label: "真实语料区域",
      },
      ...SIBLING_IDS.map((id, index) => ({
        id,
        kind: "SECTION" as const,
        parentId: contentParentId,
        childrenIds: [],
        relatedIds: [],
        location: null,
        title: `同级上下文 ${index}`,
        level: 3,
      })),
    ],
  });
  const retainedAssetIds = new Set([
    ...modifiedPrimary.assetIds,
    ...foreign.assetIds,
  ]);
  return sealKnowledgeCorpusBundleV2({
    schemaVersion: 2,
    corpusVersion: actual.corpusVersion,
    parser: actual.parser,
    contentVersion: actual.contentVersion,
    objects: [modifiedPrimary, foreign],
    assets: actual.assets.filter(({ id }) => retainedAssetIds.has(id)),
    unreferencedAssetIds: [],
  });
}

function channelResult(
  channel: RetrievalChannelV2,
  corpusBundleHash: string,
  hits: readonly ChannelCandidateV2[],
  objectCandidates?: readonly ObjectCandidateV2[],
): ChannelRetrievalResultV2 {
  const vector = channel !== "LEXICAL";
  return {
    summary: {
      channel,
      status: hits.length > 0 ? "SUCCESS" : "EMPTY",
      reason: null,
      corpusBundleHash,
      identity: {
        activeIndexBundleHash: HASH,
        providerIndexBundleHash: vector ? HASH : null,
        indexVersionId: `fixture-${channel.toLowerCase().replaceAll("_", "-")}`,
        modelId: vector ? "fixture-model" : null,
        modelRevision: vector ? "fixture-revision-1" : null,
        configHash: HASH,
        payloadHashes: [HASH],
      },
      hitCount: hits.length,
      timingMs: 1,
    },
    hits: [...hits],
    ...(objectCandidates ? { objectCandidates: [...objectCandidates] } : {}),
  };
}

function objectCandidate(
  channel: "LEXICAL" | "TEXT_VECTOR",
  object: KnowledgeObjectV2,
  objectRank: number,
  rankedNodes: ReadonlyArray<{
    node: TextNodeV2;
    rawScore: number;
  }>,
): ObjectCandidateV2 {
  return {
    objectId: object.id,
    coursePackId: object.sourceCoursePack.id,
    objectRank,
    rawScore: rankedNodes[0]!.rawScore,
    nodes: rankedNodes.map(({ node, rawScore }, index) => ({
      nodeId: node.id,
      objectId: object.id,
      nodeKind: "TEXT",
      representationId: channel === "LEXICAL"
        ? null
        : `representation-${node.id}`,
      innerRank: index + 1,
      rawScore,
    })),
  };
}

function seedAndResults(
  query: RetrievalQueryV2,
  objectId: string,
  specs: Partial<Record<RetrievalChannelV2, HitSpec>>,
): {
  seeds: readonly FusedCandidateV2[];
  channelResults: ReadonlyMap<RetrievalChannelV2, ChannelRetrievalResultV2>;
} {
  const rankings: Partial<Record<RetrievalChannelV2, ChannelCandidateV2[]>> = {};
  const channelResults = new Map<RetrievalChannelV2, ChannelRetrievalResultV2>();
  for (const channel of RetrievalChannelV2Schema.options) {
    const spec = specs[channel];
    if (!spec) continue;
    const candidateId = query.mode === "TEXT_TO_TEXT"
      ? spec.nodeId
      : objectId;
    const hit = ChannelCandidateV2Schema.parse({
      candidateId,
      objectId,
      representationId: `representation-${channel.toLowerCase().replaceAll("_", "-")}`,
      nodeId: spec.nodeId,
      assetId: spec.assetId,
      region: spec.region ?? null,
      rank: 1,
      rawScore: 0.75,
    });
    rankings[channel] = [hit];
    channelResults.set(channel, channelResult(
      channel,
      query.scope.corpusBundleHash,
      [hit],
    ));
  }
  return {
    seeds: fuseRankedChannelsV2(rankings),
    channelResults,
  };
}

function expansionInput(
  query: RetrievalQueryV2,
  objectId: string,
  specs: Partial<Record<RetrievalChannelV2, HitSpec>>,
  requiredSourceIds: readonly string[] = [],
) {
  return {
    query,
    ...seedAndResults(query, objectId, specs),
    requiredSourceIds,
  };
}

function textQuery(
  corpus: KnowledgeCorpusBundleV2,
  mode: "TEXT_TO_TEXT" | "TEXT_TO_IMAGE",
) {
  return createRetrievalQueryV2({
    mode,
    text: "如何判断版式层级？",
    scope: {
      corpusBundleHash: corpus.bundleHash,
      sourceCoursePack: { id: "layout-design", version: "1" },
    },
  });
}

function imageQuery(
  corpus: KnowledgeCorpusBundleV2,
  mode: "IMAGE_TO_IMAGE" | "IMAGE_TEXT_TO_EVIDENCE",
  queryAssetId: string,
) {
  const scope = {
    corpusBundleHash: corpus.bundleHash,
    sourceCoursePack: { id: "layout-design" as const, version: "1" as const },
  };
  if (mode === "IMAGE_TO_IMAGE") {
    return createRetrievalQueryV2({
      mode: "IMAGE_TO_IMAGE",
      queryAsset: { assetId: queryAssetId, sha256: HASH },
      scope,
    });
  }
  return createRetrievalQueryV2({
    mode: "IMAGE_TEXT_TO_EVIDENCE",
    text: "这张图的层级证据是什么？",
    queryAsset: { assetId: queryAssetId, sha256: HASH },
    scope,
  });
}

function objectConsensusFixture(corpus: KnowledgeCorpusBundleV2) {
  const objects = corpus.objects
    .filter((object) =>
      object.sourceCoursePack.id === "layout-design"
      && controlledSource(object)
      && object.nodes.filter(({ kind }) => kind === "TEXT").length >= 2)
    .slice(0, 6);
  if (objects.length !== 6) {
    throw new Error("missing object-consensus corpus fixtures");
  }
  const primaryObject = objects[0]!;
  const primaryNodes = primaryObject.nodes.filter(
    (node): node is TextNodeV2 => node.kind === "TEXT",
  ).slice(0, 2);
  const nodesByObject = objects.map((object) =>
    object.nodes.filter(
      (node): node is TextNodeV2 => node.kind === "TEXT",
    ).slice(0, 2));
  const lexicalObjects = objects.map((object, index) =>
    objectCandidate("LEXICAL", object, index + 1, [
      { node: nodesByObject[index]![0]!, rawScore: 10 - index },
      { node: nodesByObject[index]![1]!, rawScore: 9.75 - index },
    ]));
  const textVectorObjects = objects.map((object, index) =>
    objectCandidate("TEXT_VECTOR", object, index + 1, [
      { node: nodesByObject[index]![1]!, rawScore: 1 - index / 10 },
      { node: nodesByObject[index]![0]!, rawScore: 0.99 - index / 10 },
    ]));
  const rawHit = (
    channel: "LEXICAL" | "TEXT_VECTOR",
    object: KnowledgeObjectV2,
    node: TextNodeV2,
    rank: number,
    rawScore: number,
  ) => ChannelCandidateV2Schema.parse({
    candidateId: node.id,
    objectId: object.id,
    representationId: channel === "LEXICAL"
      ? null
      : `representation-${node.id}`,
    nodeId: node.id,
    assetId: null,
    region: null,
    rank,
    rawScore,
  });
  const lexicalHits = objects.map((object, index) =>
    rawHit(
      "LEXICAL",
      object,
      nodesByObject[index]![0]!,
      index + 1,
      10 - index,
    ));
  const textVectorHits = objects.map((object, index) =>
    rawHit(
      "TEXT_VECTOR",
      object,
      nodesByObject[index]![1]!,
      index + 1,
      1 - index / 10,
    ));
  const consensus = resolveTextObjectConsensusV2({
    lexicalHits,
    textVectorHits,
    lexicalObjects,
    textVectorObjects,
  });
  const query = textQuery(corpus, "TEXT_TO_TEXT");
  const sourceChannelResults = new Map<RetrievalChannelV2, ChannelRetrievalResultV2>([
    [
      "LEXICAL",
      channelResult(
        "LEXICAL",
        corpus.bundleHash,
        lexicalHits,
        lexicalObjects,
      ),
    ],
    [
      "TEXT_VECTOR",
      channelResult(
        "TEXT_VECTOR",
        corpus.bundleHash,
        textVectorHits,
        textVectorObjects,
      ),
    ],
  ]);
  return {
    primaryObject,
    primaryNodes,
    query,
    consensus,
    sourceChannelResults,
    lexicalObjects,
    textVectorObjects,
  };
}

function objectConsensusExpansionInput(
  fixture: ReturnType<typeof objectConsensusFixture>,
  trace: ObjectConsensusTraceV2 = fixture.consensus.trace,
  rankings = fixture.consensus.rankings,
) {
  const channelResults = new Map<RetrievalChannelV2, ChannelRetrievalResultV2>([
    [
      "LEXICAL",
      channelResult(
        "LEXICAL",
        fixture.query.scope.corpusBundleHash,
        rankings.LEXICAL,
        fixture.lexicalObjects,
      ),
    ],
    [
      "TEXT_VECTOR",
      channelResult(
        "TEXT_VECTOR",
        fixture.query.scope.corpusBundleHash,
        rankings.TEXT_VECTOR,
        fixture.textVectorObjects,
      ),
    ],
  ]);
  const primarySeeds = fuseRankedChannelsV2(rankings)
    .slice(0, EVIDENCE_LIMITS_V2.primary);
  return {
    query: fixture.query,
    seeds: primarySeeds,
    channelResults,
    requiredSourceIds: [],
    objectConsensus: trace,
    objectConsensusSourceChannelResults: fixture.sourceChannelResults,
  };
}

function unappliedObjectConsensusExpansionInput(
  fixture: ReturnType<typeof objectConsensusFixture>,
) {
  const lexicalHits = fixture.sourceChannelResults.get("LEXICAL")!.hits;
  const textVectorHits = lexicalHits.map((hit) =>
    ChannelCandidateV2Schema.parse({
      ...hit,
      representationId: `representation-${hit.nodeId}`,
      rawScore: hit.rawScore === null ? null : hit.rawScore / 10,
    }));
  const consensus = resolveTextObjectConsensusV2({
    lexicalHits,
    textVectorHits,
    lexicalObjects: [],
    textVectorObjects: [],
  });
  const sourceChannelResults = new Map<RetrievalChannelV2, ChannelRetrievalResultV2>([
    [
      "LEXICAL",
      channelResult(
        "LEXICAL",
        fixture.query.scope.corpusBundleHash,
        lexicalHits,
      ),
    ],
    [
      "TEXT_VECTOR",
      channelResult(
        "TEXT_VECTOR",
        fixture.query.scope.corpusBundleHash,
        textVectorHits,
      ),
    ],
  ]);
  const fused = fuseRankedChannelsV2(consensus.rankings);
  const accepted = applyPostFusionAcceptanceV2(
    "TEXT_TO_TEXT",
    fused,
    createAcceptancePolicyV2(),
  ).accepted;
  return {
    query: fixture.query,
    seeds: selectFinalSeedsV2("TEXT_TO_TEXT", accepted),
    channelResults: new Map(sourceChannelResults),
    requiredSourceIds: [],
    objectConsensus: consensus.trace,
    objectConsensusSourceChannelResults: sourceChannelResults,
  };
}

describe("corpus-backed EvidenceGraphExpanderV2", () => {
  let actual: KnowledgeCorpusBundleV2;
  let compact: KnowledgeCorpusBundleV2;

  beforeAll(async () => {
    actual = verifyKnowledgeCorpusBundleV2(JSON.parse(await readFile(
      "data/knowledge-v2/knowledge-corpus.v2.json",
      "utf8",
    )));
    compact = compactCorpus(actual);
  }, 30_000);

  it("binds IMAGE_TEXT parent selection semantics into the relation config hash", () => {
    expect(CORPUS_EVIDENCE_RELATION_CONFIG_V2).toMatchObject({
      version: "1.2.0",
      parentSeedPolicyByMode: {
        IMAGE_TEXT_TO_EVIDENCE:
          "STRONGEST_VISUAL_THEN_STRONGEST_LEXICAL",
      },
      parentLimitByMode: {
        IMAGE_TEXT_TO_EVIDENCE: 2,
      },
      imageTextParentChannelPreference: [
        "VISUAL_VECTOR",
        "LEXICAL",
      ],
    });
    const currentHash = sha256StableJsonV2(CORPUS_EVIDENCE_RELATION_CONFIG_V2);
    const driftedHash = sha256StableJsonV2({
      ...CORPUS_EVIDENCE_RELATION_CONFIG_V2,
      parentLimitByMode: {
        ...CORPUS_EVIDENCE_RELATION_CONFIG_V2.parentLimitByMode,
        IMAGE_TEXT_TO_EVIDENCE: 3,
      },
    });
    expect(driftedHash).not.toBe(currentHash);
  });

  it("maps a real-corpus visual trace to its actual IMAGE owner without inventing a REGION node", async () => {
    const object = actual.objects.find((candidate) =>
      candidate.sourceCoursePack.id === "layout-design"
      && candidate.assetIds.length > 0
      && controlledSource(candidate))!;
    const assetId = object.assetIds[0]!;
    const image = imageNode(object, assetId);
    const text = contentNode(object);
    const query = textQuery(actual, "TEXT_TO_IMAGE");
    const expansion = EvidenceExpansionV2Schema.parse(
      await createCorpusEvidenceGraphExpanderV2(actual).expand(
      expansionInput(query, object.id, {
        LEXICAL: { nodeId: text.id, assetId: null },
        TEXT_VECTOR: { nodeId: text.id, assetId: null },
        VISUAL_VECTOR: {
          nodeId: image.id,
          assetId,
          region: {
            coordinateSpace: "NORMALIZED",
            x: 0.05,
            y: 0.05,
            width: 0.4,
            height: 0.4,
            origin: "INDEXED_REGION",
          },
        },
      }),
      {},
      ),
    );

    expect(expansion.nodes.filter(({ relation }) => relation === "PRIMARY")).toEqual([
      expect.objectContaining({
        nodeId: image.id,
        objectId: object.id,
        kind: "IMAGE",
        assetId,
        sourceId: object.id,
        sourceCoursePack: object.sourceCoursePack,
      }),
    ]);
    expect(expansion.assets).toEqual([
      expect.objectContaining({ assetId, objectId: object.id }),
    ]);
    expect(expansion.regions).toEqual([
      expect.objectContaining({
        imageNodeId: image.id,
        regionNodeId: null,
        assetId,
        origin: "INDEXED_REGION",
      }),
    ]);
    expect(expansion.sources[0]).toMatchObject({
      sourceId: object.id,
      objectId: object.id,
    });
    expect(JSON.stringify(expansion.sources)).not.toContain(text.text);
  });

  it("expands TEXT_TO_TEXT only to its direct parent and same-parent siblings with stable caps", async () => {
    const object = compact.objects[0]!;
    const text = contentNode(object);
    const query = textQuery(compact, "TEXT_TO_TEXT");
    const expansion = EvidenceExpansionV2Schema.parse(
      await createCorpusEvidenceGraphExpanderV2(compact).expand(
      expansionInput(query, object.id, {
        LEXICAL: { nodeId: text.id, assetId: null },
        TEXT_VECTOR: { nodeId: text.id, assetId: null },
      }, [object.id]),
      {},
      ),
    );
    const primary = expansion.nodes.find(({ relation }) => relation === "PRIMARY")!;
    const parents = expansion.nodes.filter(({ relation }) => relation === "PARENT");
    const siblings = expansion.nodes.filter(({ relation }) => relation === "SIBLING");

    expect(primary.nodeId).toBe(text.id);
    expect(parents).toHaveLength(1);
    expect(parents[0]?.nodeId).toBe(text.parentId);
    expect(siblings).toHaveLength(6);
    expect(siblings.map(({ nodeId }) => nodeId)).toEqual(SIBLING_IDS.slice(0, 6));
    expect(siblings.every(({ objectId, parentNodeId }) =>
      objectId === object.id && parentNodeId === text.parentId)).toBe(true);
    expect(expansion.nodes).toHaveLength(8);
    expect(expansion.assets).toEqual([]);
    expect(expansion.sources[0]?.sourceId).toBe(object.id);
    expect(primary.sourceCoursePack).toEqual(object.sourceCoursePack);
    expect(primary.sourceCoursePack).not.toEqual(object.legacyPlacement.coursePack);
  });

  it("recomputes a complete object-consensus trace from the original channel results", async () => {
    const fixture = objectConsensusFixture(actual);
    const input = objectConsensusExpansionInput(fixture);
    const fullFusion = fuseRankedChannelsV2(fixture.consensus.rankings);
    expect(fullFusion).toHaveLength(6);
    expect(input.seeds).toEqual(fullFusion.slice(0, EVIDENCE_LIMITS_V2.primary));
    const expansion = EvidenceExpansionV2Schema.parse(
      await createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        input,
        {},
      ),
    );

    expect(expansion.nodes).toContainEqual(expect.objectContaining({
      relation: "PRIMARY",
      objectId: fixture.primaryObject.id,
      nodeId: fixture.consensus.trace.objectRanking[0]?.selectedNodeId,
    }));
  });

  it("rejects object-consensus combined scores that were not recomputed", async () => {
    const fixture = objectConsensusFixture(actual);
    const tampered = structuredClone(fixture.consensus.trace);
    tampered.objectRanking[0]!.combinedScore += 0.001;
    const trace = ObjectConsensusTraceV2Schema.parse(tampered);

    await expect(
      createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        objectConsensusExpansionInput(fixture, trace),
        {},
      ),
    ).rejects.toThrow("OBJECT_CONSENSUS_RECOMPUTE_MISMATCH");
  });

  it("rejects a truncated object ranking even when the retained seed is authentic", async () => {
    const fixture = objectConsensusFixture(actual);
    const tampered = structuredClone(fixture.consensus.trace);
    tampered.objectRanking = tampered.objectRanking.slice(0, 1);
    tampered.candidates = tampered.candidates.filter(
      ({ objectId }) => objectId === fixture.primaryObject.id,
    );
    const trace = ObjectConsensusTraceV2Schema.parse(tampered);

    await expect(
      createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        objectConsensusExpansionInput(fixture, trace),
        {},
      ),
    ).rejects.toThrow("OBJECT_CONSENSUS_RECOMPUTE_MISMATCH");
  });

  it("rejects a real common node when it loses the frozen inner-rank tie-break", async () => {
    const fixture = objectConsensusFixture(actual);
    const tampered = structuredClone(fixture.consensus.trace);
    const ranked = tampered.objectRanking.find(
      ({ objectId }) => objectId === fixture.primaryObject.id,
    )!;
    const losingNode = fixture.primaryNodes.find(
      ({ id }) => id !== ranked.selectedNodeId,
    )!;
    ranked.selectedNodeId = losingNode.id;
    const candidate = tampered.candidates.find(
      ({ objectId }) => objectId === fixture.primaryObject.id,
    )!;
    candidate.selectedNodeId = losingNode.id;
    const rankings = structuredClone(fixture.consensus.rankings);
    for (const channel of ["LEXICAL", "TEXT_VECTOR"] as const) {
      const sourceObjects = channel === "LEXICAL"
        ? fixture.lexicalObjects
        : fixture.textVectorObjects;
      const sourceNode = sourceObjects.find(
        ({ objectId }) => objectId === fixture.primaryObject.id,
      )!.nodes.find(({ nodeId }) => nodeId === losingNode.id)!;
      const selection = candidate.channels.find(
        (entry) => entry.channel === channel,
      )!;
      selection.sourceNodeRank = sourceNode.innerRank;
      selection.representationId = sourceNode.representationId;
      selection.rawScore = sourceNode.rawScore;
      const effectiveHit = rankings[channel].find(
        ({ objectId }) => objectId === fixture.primaryObject.id,
      )!;
      effectiveHit.candidateId = losingNode.id;
      effectiveHit.nodeId = losingNode.id;
      effectiveHit.representationId = sourceNode.representationId;
      effectiveHit.rawScore = sourceNode.rawScore;
    }
    const trace = ObjectConsensusTraceV2Schema.parse(tampered);

    await expect(
      createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        objectConsensusExpansionInput(fixture, trace, rankings),
        {},
      ),
    ).rejects.toThrow("OBJECT_CONSENSUS_RECOMPUTE_MISMATCH");
  });

  it("rejects a forged object-consensus fusion score", async () => {
    const fixture = objectConsensusFixture(actual);
    const input = objectConsensusExpansionInput(fixture);
    const forged = structuredClone(input.seeds);
    forged[0]!.fusionScore += 0.001;

    await expect(
      createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        { ...input, seeds: forged },
        {},
      ),
    ).rejects.toThrow("OBJECT_CONSENSUS_FUSED_SEEDS_INVALID");
  });

  it("rejects a forged object-consensus fused rank", async () => {
    const fixture = objectConsensusFixture(actual);
    const input = objectConsensusExpansionInput(fixture);
    const forged = structuredClone(input.seeds);
    forged[0]!.fusedRank = 2;

    await expect(
      createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        { ...input, seeds: forged },
        {},
      ),
    ).rejects.toThrow("OBJECT_CONSENSUS_FUSED_SEEDS_INVALID");
  });

  it("rejects duplicate traces inside an object-consensus fused seed", async () => {
    const fixture = objectConsensusFixture(actual);
    const input = objectConsensusExpansionInput(fixture);
    const forged = structuredClone(input.seeds);
    forged[0]!.channelTraces.push(
      structuredClone(forged[0]!.channelTraces[0]!),
    );

    await expect(
      createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        { ...input, seeds: forged },
        {},
      ),
    ).rejects.toThrow("OBJECT_CONSENSUS_FUSED_SEEDS_INVALID");
  });

  it("rejects skipping a stronger object-consensus fused seed", async () => {
    const fixture = objectConsensusFixture(actual);
    const input = objectConsensusExpansionInput(fixture);
    const forged = input.seeds.slice(1).map((seed, index) => ({
      ...structuredClone(seed),
      fusedRank: index + 1,
    }));

    await expect(
      createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        { ...input, seeds: forged },
        {},
      ),
    ).rejects.toThrow("OBJECT_CONSENSUS_FUSED_SEEDS_INVALID");
  });

  it("rejects reordered object-consensus fused seeds", async () => {
    const fixture = objectConsensusFixture(actual);
    const input = objectConsensusExpansionInput(fixture);
    const forged = [...input.seeds].reverse().map((seed, index) => ({
      ...structuredClone(seed),
      fusedRank: index + 1,
    }));

    await expect(
      createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        { ...input, seeds: forged },
        {},
      ),
    ).rejects.toThrow("OBJECT_CONSENSUS_FUSED_SEEDS_INVALID");
  });

  it("rejects object-consensus source identity drift", async () => {
    const fixture = objectConsensusFixture(actual);
    const input = objectConsensusExpansionInput(fixture);
    const sourceChannelResults = new Map(input.objectConsensusSourceChannelResults);
    const lexical = structuredClone(sourceChannelResults.get("LEXICAL")!);
    if (!lexical.summary.identity) throw new Error("missing lexical identity");
    lexical.summary.identity.configHash = "f".repeat(64);
    sourceChannelResults.set("LEXICAL", lexical);

    await expect(
      createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        {
          ...input,
          objectConsensusSourceChannelResults: sourceChannelResults,
        },
        {},
      ),
    ).rejects.toThrow("OBJECT_CONSENSUS_SOURCE_IDENTITY_MISMATCH");
  });

  it("authenticates the accepted Top-5 when object consensus is not applied", async () => {
    const fixture = objectConsensusFixture(actual);
    const input = unappliedObjectConsensusExpansionInput(fixture);
    expect(input.objectConsensus.applied).toBe(false);
    expect(input.seeds).toHaveLength(EVIDENCE_LIMITS_V2.primary);

    const expansion = EvidenceExpansionV2Schema.parse(
      await createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        input,
        {},
      ),
    );
    expect(expansion.nodes.filter(({ relation }) =>
      relation === "PRIMARY")).toHaveLength(EVIDENCE_LIMITS_V2.primary);
  });

  it("rejects forged fused seeds when object consensus is not applied", async () => {
    const fixture = objectConsensusFixture(actual);
    const input = unappliedObjectConsensusExpansionInput(fixture);
    const forged = structuredClone(input.seeds);
    forged[0]!.fusionScore += 0.001;

    await expect(
      createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        { ...input, seeds: forged },
        {},
      ),
    ).rejects.toThrow("OBJECT_CONSENSUS_FUSED_SEEDS_INVALID");
  });

  it("rejects skipping a stronger seed when object consensus is not applied", async () => {
    const fixture = objectConsensusFixture(actual);
    const input = unappliedObjectConsensusExpansionInput(fixture);
    const forged = input.seeds.slice(1).map((seed, index) => ({
      ...structuredClone(seed),
      fusedRank: index + 1,
    }));

    await expect(
      createCorpusEvidenceGraphExpanderV2(actual).resolvePrimaries(
        { ...input, seeds: forged },
        {},
      ),
    ).rejects.toThrow("OBJECT_CONSENSUS_FUSED_SEEDS_INVALID");
  });

  it("rejects same-object different-node TEXT_TO_TEXT seeds before expansion", async () => {
    const object = compact.objects[0]!;
    const lexicalNode = contentNode(object);
    const vectorNode = object.nodes.find(
      (node): node is TextNodeV2 =>
        node.kind === "TEXT"
        && node.id !== lexicalNode.id,
    )!;
    const query = textQuery(compact, "TEXT_TO_TEXT");
    await expect(createCorpusEvidenceGraphExpanderV2(compact).expand(
        expansionInput(query, object.id, {
          LEXICAL: { nodeId: lexicalNode.id, assetId: null },
          TEXT_VECTOR: { nodeId: vectorNode.id, assetId: null },
        }),
        {},
      )).rejects.toThrow("DUPLICATE_SEED_OBJECT");
  });

  it("keeps IMAGE_TO_IMAGE off the query asset and binds a true corpus REGION only on bbox match", async () => {
    const object = compact.objects[0]!;
    const resultAssetId = object.assetIds[0]!;
    const queryAssetId = object.assetIds[1]!;
    const image = imageNode(object, resultAssetId);
    const query = imageQuery(compact, "IMAGE_TO_IMAGE", queryAssetId);
    const expansion = EvidenceExpansionV2Schema.parse(
      await createCorpusEvidenceGraphExpanderV2(compact).expand(
      expansionInput(query, object.id, {
        VISUAL_VECTOR: {
          nodeId: image.id,
          assetId: resultAssetId,
          region: {
            coordinateSpace: "NORMALIZED",
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.4,
            origin: "PATCH_MATCH",
          },
        },
      }),
      {},
      ),
    );

    expect(expansion.nodes.find(({ relation }) => relation === "PRIMARY"))
      .toMatchObject({ nodeId: image.id, assetId: resultAssetId });
    expect(expansion.assets.map(({ assetId }) => assetId)).toEqual([resultAssetId]);
    expect(expansion.regions).toEqual([
      expect.objectContaining({
        regionId: TEST_REGION_ID,
        regionNodeId: TEST_REGION_ID,
        imageNodeId: image.id,
        origin: "CORPUS_REGION",
      }),
    ]);
    expect(JSON.stringify(expansion)).not.toContain(queryAssetId);
  });

  it("keeps IMAGE_TEXT text evidence on the real caption target ancestry and the visual asset separate", async () => {
    const object = compact.objects[0]!;
    const assetId = object.assetIds[0]!;
    const queryAssetId = object.assetIds[1]!;
    const image = imageNode(object, assetId);
    const query = imageQuery(compact, "IMAGE_TEXT_TO_EVIDENCE", queryAssetId);
    const expansion = EvidenceExpansionV2Schema.parse(
      await createCorpusEvidenceGraphExpanderV2(compact).expand(
      expansionInput(query, object.id, {
        TEXT_VECTOR: { nodeId: image.id, assetId },
        VISUAL_VECTOR: { nodeId: image.id, assetId },
      }),
      {},
      ),
    );
    const primary = expansion.nodes.find(({ relation }) => relation === "PRIMARY")!;

    expect(primary).toMatchObject({
      nodeId: image.parentId,
      kind: "SECTION",
      objectId: object.id,
      assetId: null,
    });
    expect(expansion.assets).toEqual([
      expect.objectContaining({ assetId, objectId: object.id }),
    ]);
    expect(expansion.nodes.filter(({ relation }) => relation === "PRIMARY")).toHaveLength(1);
  });

  it("selects IMAGE_TEXT parents from the strongest visual and lexical seeds, independent of fused position", async () => {
    const [lexicalBest, visualBest, fusedTail] = actual.objects
      .filter((object) =>
        object.sourceCoursePack.id === "layout-design"
        && object.assetIds.length >= 2
        && controlledSource(object))
      .slice(0, 3);
    const makeHit = (
      channel: "LEXICAL" | "VISUAL_VECTOR",
      object: KnowledgeObjectV2,
      rank: number,
    ) => {
      const assetId = channel === "VISUAL_VECTOR" ? object.assetIds[0]! : null;
      return ChannelCandidateV2Schema.parse({
        candidateId: object.id,
        objectId: object.id,
        representationId: channel === "VISUAL_VECTOR"
          ? `representation-${object.id}`.slice(0, 128)
          : null,
        nodeId: channel === "VISUAL_VECTOR"
          ? imageNode(object, assetId!).id
          : contentNode(object).id,
        assetId,
        region: null,
        rank,
        rawScore: channel === "VISUAL_VECTOR" ? 0.8 : 10,
      });
    };
    const lexicalHits = [
      makeHit("LEXICAL", lexicalBest!, 1),
      makeHit("LEXICAL", fusedTail!, 2),
    ];
    const visualHits = [
      makeHit("VISUAL_VECTOR", visualBest!, 1),
      makeHit("VISUAL_VECTOR", fusedTail!, 2),
      makeHit("VISUAL_VECTOR", lexicalBest!, 3),
    ];
    const fused = fuseRankedChannelsV2({
      LEXICAL: lexicalHits,
      VISUAL_VECTOR: visualHits,
    });
    const byObjectId = new Map(fused.map((seed) => [seed.objectId, seed]));
    const seeds = [
      byObjectId.get(fusedTail!.id)!,
      byObjectId.get(lexicalBest!.id)!,
      byObjectId.get(visualBest!.id)!,
    ].map((seed, index) => ({ ...seed, fusedRank: index + 1 }));
    const query = imageQuery(
      actual,
      "IMAGE_TEXT_TO_EVIDENCE",
      lexicalBest!.assetIds[1]!,
    );
    const expansion = EvidenceExpansionV2Schema.parse(
      await createCorpusEvidenceGraphExpanderV2(actual).expand({
        query,
        seeds,
        channelResults: new Map([
          ["LEXICAL", channelResult("LEXICAL", actual.bundleHash, lexicalHits)],
          ["VISUAL_VECTOR", channelResult(
            "VISUAL_VECTOR",
            actual.bundleHash,
            visualHits,
          )],
        ]),
        requiredSourceIds: [],
      }, {}),
    );

    expect(expansion.nodes
      .filter(({ relation }) => relation === "PARENT")
      .map(({ seedCandidateId }) => seedCandidateId)).toEqual([
      visualBest!.id,
      lexicalBest!.id,
    ]);
    expect(new Set(expansion.nodes
      .filter(({ relation }) => relation === "PARENT")
      .map(({ nodeId }) => nodeId)).size).toBe(2);
  });

  it("does not substitute TEXT_VECTOR for the missing IMAGE_TEXT lexical parent anchor", async () => {
    const [visualBest, textVectorOnly] = actual.objects
      .filter((object) =>
        object.sourceCoursePack.id === "layout-design"
        && object.assetIds.length >= 2
        && controlledSource(object))
      .slice(0, 2);
    const visualAssetId = visualBest!.assetIds[0]!;
    const visualHit = ChannelCandidateV2Schema.parse({
      candidateId: visualBest!.id,
      objectId: visualBest!.id,
      representationId: `representation-${visualBest!.id}`.slice(0, 128),
      nodeId: imageNode(visualBest!, visualAssetId).id,
      assetId: visualAssetId,
      region: null,
      rank: 1,
      rawScore: 0.8,
    });
    const textVectorHit = ChannelCandidateV2Schema.parse({
      candidateId: textVectorOnly!.id,
      objectId: textVectorOnly!.id,
      representationId: `representation-${textVectorOnly!.id}`.slice(0, 128),
      nodeId: contentNode(textVectorOnly!).id,
      assetId: null,
      region: null,
      rank: 1,
      rawScore: 0.8,
    });
    const query = imageQuery(
      actual,
      "IMAGE_TEXT_TO_EVIDENCE",
      visualBest!.assetIds[1]!,
    );
    const expansion = EvidenceExpansionV2Schema.parse(
      await createCorpusEvidenceGraphExpanderV2(actual).expand({
        query,
        seeds: fuseRankedChannelsV2({
          TEXT_VECTOR: [textVectorHit],
          VISUAL_VECTOR: [visualHit],
        }),
        channelResults: new Map([
          ["TEXT_VECTOR", channelResult(
            "TEXT_VECTOR",
            actual.bundleHash,
            [textVectorHit],
          )],
          ["VISUAL_VECTOR", channelResult(
            "VISUAL_VECTOR",
            actual.bundleHash,
            [visualHit],
          )],
        ]),
        requiredSourceIds: [],
      }, {}),
    );
    const parentSeedIds = expansion.nodes
      .filter(({ relation }) => relation === "PARENT")
      .map(({ seedCandidateId }) => seedCandidateId);

    expect(parentSeedIds).toEqual([visualBest!.id]);
    expect(parentSeedIds).not.toContain(textVectorOnly!.id);
  });

  it("resolvePrimaries preserves verified primary/source/asset evidence but no graph relations", async () => {
    const object = compact.objects[0]!;
    const assetId = object.assetIds[0]!;
    const queryAssetId = object.assetIds[1]!;
    const image = imageNode(object, assetId);
    const query = imageQuery(compact, "IMAGE_TEXT_TO_EVIDENCE", queryAssetId);
    const expansion = EvidenceExpansionV2Schema.parse(
      await createCorpusEvidenceGraphExpanderV2(compact).resolvePrimaries(
      expansionInput(query, object.id, {
        TEXT_VECTOR: { nodeId: image.id, assetId },
        VISUAL_VECTOR: {
          nodeId: image.id,
          assetId,
          region: {
            coordinateSpace: "NORMALIZED",
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.4,
            origin: "INDEXED_REGION",
          },
        },
      }),
      {},
      ),
    );

    expect(expansion.nodes).toHaveLength(1);
    expect(expansion.nodes[0]?.relation).toBe("PRIMARY");
    expect(expansion.assets).toHaveLength(1);
    expect(expansion.sources).toHaveLength(1);
    expect(expansion.regions).toHaveLength(1);
  });

  it("rejects course-scope, cross-object, required-source and self-query violations", async () => {
    const expander = createCorpusEvidenceGraphExpanderV2(compact);
    const object = compact.objects[0]!;
    const foreign = compact.objects[1]!;
    const text = contentNode(object);
    const foreignText = contentNode(foreign);
    const assetId = object.assetIds[0]!;
    const image = imageNode(object, assetId);
    const textModeQuery = textQuery(compact, "TEXT_TO_TEXT");

    await expect(expander.expand(
      expansionInput(textModeQuery, foreign.id, {
        LEXICAL: { nodeId: foreignText.id, assetId: null },
        TEXT_VECTOR: { nodeId: foreignText.id, assetId: null },
      }),
      {},
    )).rejects.toThrow("COURSE_SCOPE_VIOLATION");

    await expect(expander.expand(
      expansionInput(textModeQuery, object.id, {
        LEXICAL: { nodeId: foreignText.id, assetId: null },
        TEXT_VECTOR: { nodeId: foreignText.id, assetId: null },
      }),
      {},
    )).rejects.toThrow("NODE_CROSSES_OBJECT");

    await expect(expander.resolvePrimaries(
      expansionInput(textModeQuery, object.id, {
        LEXICAL: { nodeId: text.id, assetId: null },
        TEXT_VECTOR: { nodeId: text.id, assetId: null },
      }, [foreign.id]),
      {},
    )).rejects.toThrow("REQUIRED_SOURCE_MISMATCH");

    const selfQuery = imageQuery(compact, "IMAGE_TO_IMAGE", assetId);
    await expect(expander.expand(
      expansionInput(selfQuery, object.id, {
        VISUAL_VECTOR: { nodeId: image.id, assetId },
      }),
      {},
    )).rejects.toThrow("QUERY_ASSET_REJECTED");
  });

  it("retains an official source whose sourceId is distinct from its corpus objectId", async () => {
    const object = compact.objects[0]!;
    const text = contentNode(object);
    const query = textQuery(compact, "TEXT_TO_TEXT");
    const expansion = EvidenceExpansionV2Schema.parse(
      await createCorpusEvidenceGraphExpanderV2(compact).resolvePrimaries({
        ...expansionInput(query, object.id, {
          LEXICAL: { nodeId: text.id, assetId: null },
          TEXT_VECTOR: { nodeId: text.id, assetId: null },
        }, ["source-official-brand"]),
        requiredSourceClaims: [{
          sourceId: "source-official-brand",
          objectId: object.id,
          sourceCoursePack: object.sourceCoursePack,
          authority: "OFFICIAL",
          verifiedDate: "2026-07-28",
          claimKinds: ["AUTHORIZATION"],
          topicTerms: ["标志"],
        }],
        requiredClaimKinds: ["AUTHORIZATION"],
      }, {}),
    );

    expect(expansion.nodes[0]).toMatchObject({
      objectId: object.id,
      sourceId: "source-official-brand",
    });
    expect(expansion.sources).toContainEqual(expect.objectContaining({
      sourceId: "source-official-brand",
      objectId: object.id,
      authority: "OFFICIAL",
      verifiedDate: "2026-07-28",
    }));
  });

  it("retains two official sources on one object when they cover different claim kinds", async () => {
    const object = compact.objects[0]!;
    const text = contentNode(object);
    const query = textQuery(compact, "TEXT_TO_TEXT");
    const claims = [
      {
        sourceId: "source-official-auth",
        objectId: object.id,
        sourceCoursePack: object.sourceCoursePack,
        authority: "OFFICIAL" as const,
        verifiedDate: "2026-07-28",
        claimKinds: ["AUTHORIZATION" as const],
        topicTerms: ["标志"],
      },
      {
        sourceId: "source-official-price",
        objectId: object.id,
        sourceCoursePack: object.sourceCoursePack,
        authority: "OFFICIAL" as const,
        verifiedDate: "2026-07-28",
        claimKinds: ["PRICE" as const],
        topicTerms: ["标志"],
      },
    ];
    const expansion = EvidenceExpansionV2Schema.parse(
      await createCorpusEvidenceGraphExpanderV2(compact).resolvePrimaries({
        ...expansionInput(query, object.id, {
          LEXICAL: { nodeId: text.id, assetId: null },
          TEXT_VECTOR: { nodeId: text.id, assetId: null },
        }, claims.map(({ sourceId }) => sourceId)),
        requiredSourceClaims: claims,
        requiredClaimKinds: ["AUTHORIZATION", "PRICE"],
      }, {}),
    );
    expect(expansion.sources.map(({ sourceId }) => sourceId)).toEqual([
      "source-official-auth",
      "source-official-price",
    ]);
    expect(expansion.sources.every(({ objectId }) => objectId === object.id)).toBe(true);
  });

  it("constructs controlled source evidence for every sealed corpus object", async () => {
    expect(actual.objects).toHaveLength(116);
    const expander = createCorpusEvidenceGraphExpanderV2(actual);
    for (const object of actual.objects) {
      const root = object.nodes.find(({ id }) => id === object.rootNodeId)!;
      const query = createRetrievalQueryV2({
        mode: "TEXT_TO_TEXT",
        text: "请给我对应的课程证据。",
        scope: {
          corpusBundleHash: actual.bundleHash,
          sourceCoursePack: object.sourceCoursePack,
        },
      });
      const expansion = EvidenceExpansionV2Schema.parse(
        await expander.resolvePrimaries(
          expansionInput(query, object.id, {
            LEXICAL: { nodeId: root.id, assetId: null },
            TEXT_VECTOR: { nodeId: root.id, assetId: null },
          }),
          {},
        ),
      );
      expect(expansion.sources).toEqual([
        expect.objectContaining({
          sourceId: object.id,
          objectId: object.id,
        }),
      ]);
      expect(expansion.sources[0]?.locators.length).toBeGreaterThan(0);
    }
  });

  it("does not derive assets from a non-visual IMAGE node after visual retrieval failed", async () => {
    const object = compact.objects[0]!;
    const assetId = object.assetIds[0]!;
    const queryAssetId = object.assetIds[1]!;
    const text = contentNode(object);
    const image = imageNode(object, assetId);
    const query = imageQuery(compact, "IMAGE_TEXT_TO_EVIDENCE", queryAssetId);
    const expansion = EvidenceExpansionV2Schema.parse(
      await createCorpusEvidenceGraphExpanderV2(compact).resolvePrimaries(
        expansionInput(query, object.id, {
          LEXICAL: { nodeId: text.id, assetId: null },
          TEXT_VECTOR: { nodeId: image.id, assetId: null },
        }),
        {},
      ),
    );
    expect(expansion.assets).toEqual([]);
    expect(expansion.regions).toEqual([]);
  });

  it("rejects a corpus whose sealed hash was not verified", () => {
    expect(() => createCorpusEvidenceGraphExpanderV2({
      ...actual,
      bundleHash: HASH,
    })).toThrow(/BUNDLE_HASH_DRIFT/);
  });
});

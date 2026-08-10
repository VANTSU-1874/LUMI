// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createCorpusEvidenceGraphExpanderV2 } from "@/lib/knowledge/corpus-evidence-expander-v2";
import {
  ChannelRetrievalResultV2Schema,
  createHybridRetrieverV2,
  type RetrievalChannelProviderV2,
} from "@/lib/knowledge/hybrid-retriever-v2";
import type { RetrievalQueryV2 } from "@/lib/knowledge/retrieval-query-v2";
import {
  assertMixedSuiteContractV2,
  buildMixedEvaluationBindingsV2,
  createMixedEvaluationQueryV2,
  scoreMixedEvidenceCaseV2,
} from "@/lib/knowledge/mixed-retrieval-evaluation-v2";
import { verifyKnowledgeCorpusBundleV2 } from "@/lib/knowledge/knowledge-object-v2";
import {
  adaptVisualRetrievalResponseV2,
  type ChannelAdapterIdentityV2,
  type VisualAssetOwnerV2,
} from "@/lib/knowledge/retrieval-channel-adapters-v2";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

const suite = assertMixedSuiteContractV2(
  readFileSync("tests/retrieval-quality/golden-suite.json"),
);
const corpus = verifyKnowledgeCorpusBundleV2(JSON.parse(
  readFileSync("data/knowledge-v2/knowledge-corpus.v2.json", "utf8"),
));
const bindings = buildMixedEvaluationBindingsV2(corpus);
const sourceCoursePackByObjectId = new Map(
  corpus.objects.map((object) => [object.id, object.sourceCoursePack]),
);
const assetIdByNodeId = new Map(
  corpus.objects.flatMap((object) =>
    object.nodes.flatMap((node) =>
      node.kind === "IMAGE" || node.kind === "REGION"
        ? [[node.id, node.assetId] as const]
        : [])),
);
const productionAssetOwners = new Map<string, VisualAssetOwnerV2>(
  [...bindings.byAssetId.values()].map((binding) => [
    binding.assetId,
    {
      objectId: binding.objectId,
      imageNodeId: binding.imageNodeId,
    },
  ]),
);
const productionVisualIndex = {
  corpusBundleHash: corpus.bundleHash,
  indexBundleHash: HASH_B,
  indexVersionId: "visual-test-v1",
  modelId: "test/visual",
  modelRevision: HASH_C,
};
const productionAdapterIdentity: ChannelAdapterIdentityV2 = {
  expectedCorpusBundleHash: corpus.bundleHash,
  activeIndexBundleHash: HASH_A,
  expectedProviderIndexBundleHash: HASH_B,
  expectedIndexVersionId: productionVisualIndex.indexVersionId,
  expectedModelId: productionVisualIndex.modelId,
  expectedModelRevision: productionVisualIndex.modelRevision,
  configHash: HASH_B,
  payloadHashes: [HASH_C],
};

function visualProviderForPaths(assetPaths: readonly string[]): RetrievalChannelProviderV2 {
  return {
    async retrieve() {
      return adaptVisualRetrievalResponseV2({
        status: "SUCCESS",
        reason: null,
        hits: assetPaths.map((assetPath, index) => ({
          assetId: bindings.byAssetPath.get(assetPath)!.assetId,
          rank: index + 1,
          score: 1 - index / 100,
          region: null,
          representationId: `visual-production-${(index + 1).toString().padStart(2, "0")}`,
        })),
        index: productionVisualIndex,
        timing: {
          queueMs: 0,
          inferenceMs: 1,
          totalMs: 1,
        },
      }, productionAdapterIdentity, productionAssetOwners);
    },
  };
}

function productionRetriever(providers: {
  lexical: RetrievalChannelProviderV2;
  textVector: RetrievalChannelProviderV2;
  visualVector: RetrievalChannelProviderV2;
}) {
  return createHybridRetrieverV2({
    providers,
    graphExpander: createCorpusEvidenceGraphExpanderV2(corpus),
    sourceCoursePackByObjectId,
    assetIdByNodeId,
    corpusProvenanceClaims: [],
    provenance: {
      activeIndexBundleHash: HASH_A,
      relationConfigHash: HASH_B,
      normalizerConfigHash: HASH_B,
      rrfConfigHash: HASH_B,
    },
  });
}

function textProvider(
  channel: "LEXICAL" | "TEXT_VECTOR",
  objectId?: string,
  nodeId?: string,
): RetrievalChannelProviderV2 {
  return {
    async retrieve(query: RetrievalQueryV2) {
      const hits = objectId && nodeId
        ? [{
            candidateId: query.mode === "TEXT_TO_TEXT" ? nodeId : objectId,
            objectId,
            representationId: channel === "LEXICAL"
              ? null
              : "representation-wrong-object",
            nodeId,
            assetId: null,
            region: null,
            rank: 1,
            rawScore: channel === "LEXICAL" ? 20 : 0.9,
          }]
        : [];
      return ChannelRetrievalResultV2Schema.parse({
        summary: {
          channel,
          status: hits.length > 0 ? "SUCCESS" : "EMPTY",
          reason: null,
          corpusBundleHash: corpus.bundleHash,
          identity: {
            activeIndexBundleHash: HASH_A,
            providerIndexBundleHash: channel === "LEXICAL" ? null : HASH_B,
            indexVersionId: `${channel.toLowerCase().replaceAll("_", "-")}-test`,
            modelId: channel === "LEXICAL" ? null : "test/text",
            modelRevision: channel === "LEXICAL" ? null : HASH_C,
            configHash: HASH_B,
            payloadHashes: [HASH_C],
          },
          hitCount: hits.length,
          timingMs: 0,
        },
        hits,
      });
    },
  };
}

describe("mixed retrieval production chain V2", () => {
  it("expands a deliberately wrong visual asset through its real V2 owner", async () => {
    const golden = suite.cases.find(({ id }) => id === "visual-text-poster-01-layout")!;
    const wrong = bindings.byAssetPath.get(
      "assets/layout-design/poster-17-layout.png",
    )!;
    const assetOwners = new Map<string, VisualAssetOwnerV2>(
      [...bindings.byAssetId.values()].map((binding) => [
        binding.assetId,
        {
          objectId: binding.objectId,
          imageNodeId: binding.imageNodeId,
        },
      ]),
    );
    const visualIndex = {
      corpusBundleHash: corpus.bundleHash,
      indexBundleHash: HASH_B,
      indexVersionId: "visual-test-v1",
      modelId: "test/visual",
      modelRevision: HASH_C,
    };
    const adapterIdentity: ChannelAdapterIdentityV2 = {
      expectedCorpusBundleHash: corpus.bundleHash,
      activeIndexBundleHash: HASH_A,
      expectedProviderIndexBundleHash: HASH_B,
      expectedIndexVersionId: visualIndex.indexVersionId,
      expectedModelId: visualIndex.modelId,
      expectedModelRevision: visualIndex.modelRevision,
      configHash: HASH_B,
      payloadHashes: [HASH_C],
    };
    const visualProvider: RetrievalChannelProviderV2 = {
      async retrieve() {
        return adaptVisualRetrievalResponseV2({
          status: "SUCCESS",
          reason: null,
          hits: [{
            assetId: wrong.assetId,
            rank: 1,
            score: 0.99,
            region: null,
            representationId: "visual-wrong-asset",
          }],
          index: visualIndex,
          timing: {
            queueMs: 0,
            inferenceMs: 1,
            totalMs: 1,
          },
        }, adapterIdentity, assetOwners);
      },
    };
    const wrongObject = bindings.byObjectId.get(wrong.objectId)!;
    const wrongTextNode = wrongObject.nodes.find(({ kind }) => kind === "TEXT")
      ?? wrongObject.nodes[0]!;
    const retrieve = createHybridRetrieverV2({
      providers: {
        lexical: textProvider("LEXICAL", wrong.objectId, wrongTextNode.id),
        textVector: textProvider("TEXT_VECTOR", wrong.objectId, wrongTextNode.id),
        visualVector: visualProvider,
      },
      graphExpander: createCorpusEvidenceGraphExpanderV2(corpus),
      sourceCoursePackByObjectId: new Map(
        corpus.objects.map((object) => [object.id, object.sourceCoursePack]),
      ),
      corpusProvenanceClaims: [],
      provenance: {
        activeIndexBundleHash: HASH_A,
        relationConfigHash: HASH_B,
        normalizerConfigHash: HASH_B,
        rrfConfigHash: HASH_B,
      },
    });

    const bundle = await retrieve(createMixedEvaluationQueryV2(golden, bindings));
    const scored = scoreMixedEvidenceCaseV2(golden, bundle, bindings);

    expect(bundle.evidence.primary.map(({ objectId }) => objectId)).toEqual([
      wrong.objectId,
    ]);
    expect(bundle.evidence.nodes.every(({ objectId }) => objectId === wrong.objectId))
      .toBe(true);
    expect(bundle.evidence.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: wrong.assetId,
        objectId: wrong.objectId,
      }),
    ]));
    expect(scored.audit.ownerViolations).toEqual([]);
    expect(scored.audit.assetPaths[0]).toBe(wrong.assetPath);
    expect(scored.score.assetMetrics?.recallAt5).toBe(0);
  });

  it("preserves poster-02 asset-level visual rank through object fusion and scoring", async () => {
    const golden = suite.cases.find(({ id }) => id === "visual-text-poster-02-layout")!;
    const rankedPaths = [
      "assets/layout-design/poster-02-type.png",
      "assets/layout-design/poster-02-color.png",
      "assets/layout-design/poster-02-layout.png",
    ];
    const retrieve = productionRetriever({
      lexical: textProvider("LEXICAL"),
      textVector: textProvider("TEXT_VECTOR"),
      visualVector: visualProviderForPaths(rankedPaths),
    });

    const bundle = await retrieve(createMixedEvaluationQueryV2(golden, bindings));
    const scored = scoreMixedEvidenceCaseV2(golden, bundle, bindings);

    expect(bundle.evidence.primary).toHaveLength(1);
    expect(bundle.evidence.assets.map(({ retrieval, assetId }) => ({
      assetPath: bindings.byAssetId.get(assetId)!.assetPath,
      rank: retrieval?.rank,
      representationId: retrieval?.representationId,
    }))).toEqual([
      {
        assetPath: rankedPaths[0],
        rank: 1,
        representationId: "visual-production-01",
      },
      {
        assetPath: rankedPaths[1],
        rank: 2,
        representationId: "visual-production-02",
      },
      {
        assetPath: rankedPaths[2],
        rank: 3,
        representationId: "visual-production-03",
      },
    ]);
    expect(scored.audit.assetPaths).toEqual(rankedPaths);
    expect(scored.score.assetMetrics?.recallAt5).toBe(1);
  });

  it("drops a query-image caption trace without poisoning valid same-object visual evidence", async () => {
    const golden = suite.cases.find(({ id }) => id === "visual-evidence-poster-16")!;
    const queryAsset = bindings.byAssetPath.get(golden.query.assetPath!)!;
    const rankedPaths = golden.targets.assets.map(({ path }) => path);
    const retrieve = productionRetriever({
      lexical: textProvider("LEXICAL"),
      textVector: textProvider(
        "TEXT_VECTOR",
        queryAsset.objectId,
        queryAsset.imageNodeId,
      ),
      visualVector: visualProviderForPaths(rankedPaths),
    });

    const bundle = await retrieve(createMixedEvaluationQueryV2(golden, bindings));
    const scored = scoreMixedEvidenceCaseV2(golden, bundle, bindings);

    expect(bundle.status).toBe("SUCCESS");
    expect(bundle.evidence.primary.map(({ objectId }) => objectId))
      .toContain(queryAsset.objectId);
    expect(bundle.evidence.primary.flatMap(({ channelTraces }) => channelTraces))
      .not.toContainEqual(expect.objectContaining({
        channel: "TEXT_VECTOR",
        nodeId: queryAsset.imageNodeId,
      }));
    expect(bundle.evidence.assets.map(({ assetId }) => assetId))
      .not.toContain(queryAsset.assetId);
    expect(bundle.provenance.fallbackTriggers).not.toContain("RELATION_EXPANSION_ERROR");
    expect(scored.score.assetMetrics?.recallAt5).toBe(1);
    expect(scored.score.combinedEvidencePass).toBe(true);
  });

  it("passes only applicable provider results into the real expander for text and image modes", async () => {
    const textGolden = suite.cases.find(({ id }) => id === "text-feedback-loop")!;
    const textObject = bindings.byObjectId.get(textGolden.targets.nodes[0]!.id)!;
    const textNode = textObject.nodes.find(({ kind }) => kind === "TEXT")!;
    const textBundle = await productionRetriever({
      lexical: textProvider("LEXICAL", textObject.id, textNode.id),
      textVector: textProvider("TEXT_VECTOR", textObject.id, textNode.id),
      visualVector: textProvider("TEXT_VECTOR"),
    })(createMixedEvaluationQueryV2(textGolden, bindings));
    expect(textBundle.status).toBe("SUCCESS");
    expect(textBundle.evidence.primary).toHaveLength(1);
    expect(textBundle.provenance.fallbackTriggers).not.toContain("RELATION_EXPANSION_ERROR");

    const imageGolden = suite.cases.find(({ id }) => id === "visual-image-poster-07-to-48")!;
    const imagePaths = imageGolden.targets.assets.map(({ path }) => path);
    const imageBundle = await productionRetriever({
      lexical: textProvider("LEXICAL"),
      textVector: textProvider("TEXT_VECTOR"),
      visualVector: visualProviderForPaths(imagePaths),
    })(createMixedEvaluationQueryV2(imageGolden, bindings));
    expect(imageBundle.status).toBe("SUCCESS");
    expect(imageBundle.evidence.primary).toHaveLength(1);
    expect(imageBundle.provenance.fallbackTriggers).not.toContain("RELATION_EXPANSION_ERROR");
  });
});

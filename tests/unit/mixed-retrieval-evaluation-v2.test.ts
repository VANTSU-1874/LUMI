// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { evaluateCaptionLexicalBaseline } from "@/scripts/evaluate-retrieval-quality";
import {
  assembleEvidenceBundleV2,
  type EvidenceChannelV2,
  type EvidenceExpansionV2,
  type EvidenceProvenanceV2,
} from "@/lib/knowledge/evidence-bundle-v2";
import {
  T3_FROZEN_VISUAL_PROVIDER,
  T4_FROZEN_CONTROL_INDEX_BUNDLE_HASH,
  T4_FROZEN_CORPUS_BUNDLE_HASH,
  T4_FROZEN_TEXT_PROVIDER,
  T4_FROZEN_VISUAL_PROVIDER,
  T4_MIXED_SUITE_SHA256,
  assertMixedGoldenMetadataIsolationV2,
  assertMixedRuntimeQueryAllowlistV2,
  assertMixedSuiteContractV2,
  buildMixedEvaluationBindingsV2,
  createMixedEvaluationQueryV2,
  evaluateMixedRetrievalGatesV2,
  measureMixedRetrievalCallV2,
  scoreMixedEvidenceCaseV2,
  summarizeMixedPerformanceByModeV2,
  type MixedGateEvaluationInputV2,
} from "@/lib/knowledge/mixed-retrieval-evaluation-v2";
import { retrieveFrozenT0LexicalCandidatesV2 } from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import {
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeObjectV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  applyPostFusionAcceptanceV2,
  fuseRankedChannelsV2,
} from "@/lib/knowledge/rank-fusion-v2";
import type { RetrievalGoldenCase } from "@/lib/knowledge/retrieval-quality";
import {
  RetrievalGoldenSuiteSchema,
  summarizeRetrievalScores,
} from "@/lib/knowledge/retrieval-quality";
import {
  loadLegacyKnowledgeCorpusV2,
} from "../helpers/knowledge-v2-generation-fixtures";

const HASH_C = "c".repeat(64);

const suiteBytes = readFileSync("tests/retrieval-quality/golden-suite.json");
const suite = assertMixedSuiteContractV2(suiteBytes);
const corpus = verifyKnowledgeCorpusBundleV2(
  loadLegacyKnowledgeCorpusV2(),
);
const bindings = buildMixedEvaluationBindingsV2(corpus);

function testCase(id: string) {
  const found = suite.cases.find((item) => item.id === id);
  if (!found) throw new Error(`missing test case ${id}`);
  return found;
}

function channelIdentity(channel: EvidenceChannelV2["channel"]) {
  const provider = channel === "TEXT_VECTOR"
    ? T4_FROZEN_TEXT_PROVIDER
    : T4_FROZEN_VISUAL_PROVIDER;
  return {
    activeIndexBundleHash: T4_FROZEN_CONTROL_INDEX_BUNDLE_HASH,
    providerIndexBundleHash: channel === "LEXICAL" ? null : provider.indexBundleHash,
    indexVersionId: channel === "LEXICAL" ? "lexical-corpus-v2" : provider.indexVersionId,
    modelId: channel === "LEXICAL" ? null : provider.modelId,
    modelRevision: channel === "LEXICAL" ? null : provider.modelRevision,
    configHash: HASH_C,
    payloadHashes: [HASH_C],
  };
}

function sourceId(object: KnowledgeObjectV2) {
  return `source-${object.id}`.slice(0, 128);
}

function makeEvidenceBundle(
  golden: RetrievalGoldenCase,
  selectedObjectId = golden.targets.nodes[0]!.id,
  selectedAssetPath = golden.targets.assets[0]?.path,
  includeParent = true,
) {
  const query = createMixedEvaluationQueryV2(golden, bindings);
  const object = bindings.byObjectId.get(selectedObjectId);
  if (!object) throw new Error(`missing object ${selectedObjectId}`);
  const primaryNode = object.nodes.find(({ kind }) => kind === "TEXT")
    ?? object.nodes[0]!;
  const parentNode = primaryNode.parentId
    ? object.nodes.find(({ id }) => id === primaryNode.parentId) ?? null
    : null;
  const preferredAsset = selectedAssetPath
    ? bindings.byAssetPath.get(selectedAssetPath)
    : null;
  const assetBinding = preferredAsset?.objectId === object.id
    ? preferredAsset
    : golden.targets.assets
      .map(({ path }) => bindings.byAssetPath.get(path))
      .find((binding) => binding?.objectId === object.id)
    ?? [...bindings.byAssetId.values()].find(({ objectId }) => objectId === object.id)
    ?? null;
  const rankings = {
    LEXICAL: [{
      candidateId: object.id,
      objectId: object.id,
      representationId: null,
      nodeId: primaryNode.id,
      assetId: null,
      region: null,
      rank: 1,
      rawScore: 10,
    }],
    TEXT_VECTOR: [{
      candidateId: object.id,
      objectId: object.id,
      representationId: `representation-${object.id}`.slice(0, 128),
      nodeId: primaryNode.id,
      assetId: null,
      region: null,
      rank: 1,
      rawScore: 0.8,
    }],
    VISUAL_VECTOR: assetBinding
      ? [{
          candidateId: object.id,
          objectId: object.id,
          representationId: `visual-${assetBinding.assetId}`.slice(0, 128),
          nodeId: assetBinding.imageNodeId,
          assetId: assetBinding.assetId,
          region: null,
          rank: 1,
          rawScore: 0.9,
        }]
      : [],
  };
  const fused = fuseRankedChannelsV2(rankings);
  const acceptance = applyPostFusionAcceptanceV2(query.mode, fused).trace;
  const source = sourceId(object);
  const expansion: EvidenceExpansionV2 = {
    nodes: [
      {
        nodeId: primaryNode.id,
        objectId: object.id,
        kind: primaryNode.kind,
        relation: "PRIMARY",
        seedCandidateId: object.id,
        parentNodeId: primaryNode.parentId,
        sourceId: source,
        sourceCoursePack: object.sourceCoursePack,
        excerpt: primaryNode.kind === "TEXT" ? primaryNode.text : null,
        assetId: primaryNode.kind === "IMAGE" ? primaryNode.assetId : null,
      },
      ...(parentNode && includeParent
        ? [{
            nodeId: parentNode.id,
            objectId: object.id,
            kind: parentNode.kind,
            relation: "PARENT" as const,
            seedCandidateId: object.id,
            parentNodeId: parentNode.parentId,
            sourceId: source,
            sourceCoursePack: object.sourceCoursePack,
            excerpt: null,
            assetId: parentNode.kind === "IMAGE" ? parentNode.assetId : null,
          }]
        : []),
    ],
    assets: assetBinding
      ? [{
          assetId: assetBinding.assetId,
          objectId: object.id,
          sha256: assetBinding.sha256,
          mimeType: "image/png",
          dimensions: corpus.assets.find(({ id }) => id === assetBinding.assetId)!.dimensions,
          retrieval: {
            channel: "VISUAL_VECTOR",
            rank: 1,
            representationId: rankings.VISUAL_VECTOR[0]!.representationId,
          },
        }]
      : [],
    regions: [],
    sources: [{
      sourceId: source,
      objectId: object.id,
      authority: object.provenance.authority,
      verifiedDate: object.provenance.verifiedDate,
      scope: object.provenance.scope,
      locators: object.provenance.locators,
    }],
  };
  const channels: EvidenceChannelV2[] = [
    {
      channel: "LEXICAL",
      status: "SUCCESS",
      reason: null,
      corpusBundleHash: corpus.bundleHash,
      identity: channelIdentity("LEXICAL"),
      hitCount: 1,
      timingMs: 1,
    },
    {
      channel: "TEXT_VECTOR",
      status: "SUCCESS",
      reason: null,
      corpusBundleHash: corpus.bundleHash,
      identity: channelIdentity("TEXT_VECTOR"),
      hitCount: 1,
      timingMs: 2,
    },
    {
      channel: "VISUAL_VECTOR",
      status: assetBinding ? "SUCCESS" : "SKIPPED",
      reason: assetBinding ? null : "MODE_NOT_APPLICABLE",
      corpusBundleHash: corpus.bundleHash,
      identity: assetBinding ? channelIdentity("VISUAL_VECTOR") : null,
      hitCount: assetBinding ? 1 : 0,
      timingMs: assetBinding ? 3 : 0,
    },
  ];
  const provenance: EvidenceProvenanceV2 = {
    corpusBundleHash: corpus.bundleHash,
    activeIndexBundleHash: T4_FROZEN_CONTROL_INDEX_BUNDLE_HASH,
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
  return assembleEvidenceBundleV2({
    status: "SUCCESS",
    query,
    channels,
    fused,
    acceptance,
    expansion,
    provenance,
    timing: { retrievalMs: 3, expansionMs: 1, totalMs: 4 },
  });
}

function passingGateInput(): MixedGateEvaluationInputV2 {
  const emptySummary = summarizeRetrievalScores([]);
  const positiveMode = {
    caseCount: 1,
    exactRoleRecallAt5: 1,
    groupRecallAt5: 1,
    mrr: 1,
    ndcgAt5: 1,
    precisionAt5: 0.2,
    nodeRecallAt5: 1,
    assetRecallAt5: 1,
    parentCoverage: 1,
    combinedEvidencePassRate: 1,
    ownerConsistency: 1,
    parentConsistency: 1,
    parentPrecision: 1,
    maxExtraParentCount: 0,
    maxExtraParentLocators: 0,
    latencyP95Ms: 10,
  };
  const bootstrap = {
    pairedCaseCount: 24,
    clusterCount: 24,
    iterations: 10_000,
    seed: 0x5eed_c0de,
    meanDifference: 0.1,
    confidenceInterval95: { lower: 0.01, upper: 0.2 },
  };
  const lexicalIdentity = channelIdentity("LEXICAL");
  const textIdentity = channelIdentity("TEXT_VECTOR");
  const visualIdentity = channelIdentity("VISUAL_VECTOR");
  return {
    corpusBundleHash: T4_FROZEN_CORPUS_BUNDLE_HASH,
    runConfig: {
      cachePolicy: {
        mode: "CACHE_MISS",
        visualMaxCacheEntries: 0,
      },
      runtimeEvidence: {
        source: "LOCAL_MIXED_RUNTIME_V2",
        visualMaxCacheEntries: 0,
        sidecarHandshakeVerified: true,
        textProviderIndexBundleHash: textIdentity.providerIndexBundleHash!,
        textIndexVersionId: textIdentity.indexVersionId,
        visualProviderIndexBundleHash: visualIdentity.providerIndexBundleHash!,
        visualIndexVersionId: visualIdentity.indexVersionId,
      },
    },
    cardinality: {
      attempted: 51,
      positives: 41,
      negatives: 10,
      runtimeModes: {
        TEXT_TO_TEXT: 13,
        TEXT_TO_IMAGE: 24,
        IMAGE_TO_IMAGE: 7,
        IMAGE_TEXT_TO_EVIDENCE: 7,
      },
    },
    identities: {
      activeIndexBundleHashes: [T4_FROZEN_CONTROL_INDEX_BUNDLE_HASH],
      providerIndexBundleHashes: [
        T4_FROZEN_TEXT_PROVIDER.indexBundleHash,
        T4_FROZEN_VISUAL_PROVIDER.indexBundleHash,
      ],
      relationConfigHashes: [HASH_C],
      normalizerConfigHashes: [HASH_C],
      rrfConfigHashes: [HASH_C],
      expected: {
        activeIndexBundleHash: T4_FROZEN_CONTROL_INDEX_BUNDLE_HASH,
        channels: {
          LEXICAL: lexicalIdentity,
          TEXT_VECTOR: textIdentity,
          VISUAL_VECTOR: visualIdentity,
        },
      },
      byChannel: {
        LEXICAL: [lexicalIdentity],
        TEXT_VECTOR: [textIdentity],
        VISUAL_VECTOR: [visualIdentity],
      },
    },
    summary: {
      ...emptySummary,
      overall: {
        ...emptySummary.overall,
        attempted: 51,
        evaluated: 51,
      },
      byMode: {
        ...emptySummary.byMode,
        TEXT_TO_TEXT: {
          ...emptySummary.byMode.TEXT_TO_TEXT,
          attempted: 5,
          evaluated: 5,
          recallAt5: 0.4,
          mrr: 0.4,
          ndcgAt5: 0.4,
          precisionAt5: 0.08,
        },
      },
    },
    positiveByMode: {
      TEXT_TO_TEXT: { ...positiveMode, caseCount: 5 },
      TEXT_TO_IMAGE: { ...positiveMode, caseCount: 24, exactRoleRecallAt5: 0.5 },
      IMAGE_TO_IMAGE: { ...positiveMode, caseCount: 6, groupRecallAt5: 4 / 6 },
      IMAGE_TEXT_TO_EVIDENCE: { ...positiveMode, caseCount: 6 },
    },
    negative: {
      caseCount: 10,
      passed: 8,
      passRate: 0.8,
      mandatoryCaseCount: 6,
      mandatoryPassed: 6,
      mandatoryPassRate: 1,
      failedCaseIds: ["negative-a", "negative-b"],
      mandatoryFailedCaseIds: [],
    },
    frozenTextRetention: {
      baselineHitCaseIds: ["text-a", "text-b"],
      retainedCaseIds: ["text-a", "text-b"],
      retained: 2,
      required: 2,
    },
    comparisons: {
      pairedBootstrap: {
        textToImageExactVsCaption: bootstrap,
        textToImageExactVsT3: {
          ...bootstrap,
          meanDifference: 0,
          confidenceInterval95: { lower: -0.05, upper: 0.05 },
        },
        visualTaskCompletionVsT3: {
          ...bootstrap,
          pairedCaseCount: 36,
          clusterCount: 36,
          meanDifference: 0,
          confidenceInterval95: { lower: -0.05, upper: 0.05 },
        },
      },
      assetSingleChannelComparison: {
        caseCount: 30,
        gains: 1,
        regressions: 1,
        unchanged: 28,
        gainMinusRegression: 0,
      },
      t3ByMode: {
        TEXT_TO_TEXT: {
          caseCount: 5,
          groupRecallAt5: null,
          mrr: 0.4,
          latencyP95Ms: 20,
        },
        TEXT_TO_IMAGE: {
          caseCount: 24,
          groupRecallAt5: 0.7,
          mrr: 0.7,
          latencyP95Ms: 20,
        },
        IMAGE_TO_IMAGE: {
          caseCount: 6,
          groupRecallAt5: 0.5,
          mrr: 0.5,
          latencyP95Ms: 100,
        },
        IMAGE_TEXT_TO_EVIDENCE: {
          caseCount: 6,
          groupRecallAt5: 0.8,
          mrr: 0.8,
          latencyP95Ms: 100,
        },
      },
    },
    violations: {
      forbidden: [],
      self: [],
      queryGroup: [],
      courseScope: [],
      owner: [],
      parent: [],
      unstable: [],
    },
    performance: {
      byMode: {
        TEXT_TO_TEXT: { p95Ms: 200, measuredQueryCount: 25 },
        TEXT_TO_IMAGE: { p95Ms: 200, measuredQueryCount: 120 },
        IMAGE_TO_IMAGE: { p95Ms: 200, measuredQueryCount: 35 },
        IMAGE_TEXT_TO_EVIDENCE: { p95Ms: 300, measuredQueryCount: 35 },
      },
      timeoutRate: 0,
    },
    cases: [],
  };
}

describe("mixed retrieval evaluation V2", () => {
  it("keeps the frozen T3 baseline distinct from the active T4 visual provider", () => {
    expect(T3_FROZEN_VISUAL_PROVIDER).toMatchObject({
      indexBundleHash:
        "fedb2a84cb7076b84b291749b3e7029286f69d244fea1f2c923a993e4be667d9",
      indexVersionId: "siglip2-224-two-region-v1",
    });
    expect(T4_FROZEN_VISUAL_PROVIDER).toMatchObject({
      indexBundleHash:
        "1f2a354c755b498240108583d10ad5f0f5d2a3ad9c9f2cee2c3110d07f05125a",
      indexVersionId: "siglip2-224-two-region-i2i-l2-mean-v2",
    });
    expect(T3_FROZEN_VISUAL_PROVIDER.indexBundleHash)
      .not.toBe(T4_FROZEN_VISUAL_PROVIDER.indexBundleHash);
    expect(T3_FROZEN_VISUAL_PROVIDER.indexVersionId)
      .not.toBe(T4_FROZEN_VISUAL_PROVIDER.indexVersionId);
    expect(T3_FROZEN_VISUAL_PROVIDER.modelId)
      .toBe(T4_FROZEN_VISUAL_PROVIDER.modelId);
    expect(T3_FROZEN_VISUAL_PROVIDER.modelRevision)
      .toBe(T4_FROZEN_VISUAL_PROVIDER.modelRevision);
  });
  it("binds the exact .4 suite and its 41 positive / 10 negative split", () => {
    expect(suiteBytes.length).toBeGreaterThan(0);
    expect(T4_MIXED_SUITE_SHA256).toHaveLength(64);
    expect(suite.cases).toHaveLength(51);
    expect(suite.cases.filter(({ expectation }) => expectation === "ANSWERABLE"))
      .toHaveLength(41);
    expect(suite.cases.filter(({ expectation }) => expectation === "NO_ANSWER"))
      .toHaveLength(10);
  });

  it("projects only real query fields and maps text-only negatives to TEXT_TO_TEXT", () => {
    const negative = testCase("negative-layout-font-license");
    const query = createMixedEvaluationQueryV2(negative, bindings);
    expect(query).toMatchObject({
      mode: "TEXT_TO_TEXT",
      originalText: negative.query.text,
      queryAsset: null,
      scope: {
        sourceCoursePack: { id: "layout-design", version: "1" },
      },
    });
    expect(JSON.stringify(query)).not.toContain("NO_ANSWER");
    expect(JSON.stringify(query)).not.toContain("font-license");
    expect(assertMixedRuntimeQueryAllowlistV2(query).keys).toEqual([
      "excludeAssetIds",
      "mode",
      "normalizedText",
      "originalText",
      "queryAsset",
      "schemaVersion",
      "scope",
    ]);
  });

  it("keeps the runtime fingerprint bit-identical when only qrels change", () => {
    const golden = testCase("visual-evidence-poster-16");
    expect(assertMixedGoldenMetadataIsolationV2(golden, bindings))
      .toBe(assertMixedRuntimeQueryAllowlistV2(
        createMixedEvaluationQueryV2(golden, bindings),
      ).fingerprint);
  });

  it("keeps all five text-vector fault fallbacks in exact frozen T0 hit order", async () => {
    const currentSuite = RetrievalGoldenSuiteSchema.parse(JSON.parse(
      readFileSync(
        "tests/retrieval-quality/generations/d1d399c1/golden-suite.json",
        "utf8",
      ),
    ));
    const currentCorpus = verifyKnowledgeCorpusBundleV2(JSON.parse(
      readFileSync("data/knowledge-v2/knowledge-corpus.v2.json", "utf8"),
    ));
    const t0 = await evaluateCaptionLexicalBaseline({
      workspaceRoot: process.cwd(),
      suitePath:
        "tests/retrieval-quality/generations/d1d399c1/golden-suite.json",
    });
    const baselineByCase = new Map(t0.results.map((result) => [result.caseId, result]));
    const textCases = currentSuite.cases.filter((item) =>
      item.mode === "TEXT_TO_TEXT" && item.expectation === "ANSWERABLE");
    expect(textCases).toHaveLength(5);
    for (const golden of textCases) {
      const query = createMixedEvaluationQueryV2(golden, bindings);
      const actual = retrieveFrozenT0LexicalCandidatesV2(
        query,
        currentCorpus.objects,
      )
        .map(({ objectId, rank }) => ({ kind: "NODE", key: objectId, rank }));
      const expected = baselineByCase.get(golden.id)!.hits
        .map(({ kind, key, rank }) => ({ kind, key, rank }));
      expect(actual, golden.id).toEqual(expected);
    }
  });

  it("maps object, true node, asset, owner and direct parent into separate audit fields", () => {
    const golden = testCase("visual-evidence-poster-16");
    const bundle = makeEvidenceBundle(golden);
    const scored = scoreMixedEvidenceCaseV2(golden, bundle, bindings);
    expect(scored.result.hits.filter(({ kind }) => kind === "NODE")).toEqual([
      expect.objectContaining({ key: golden.targets.nodes[0]!.id, rank: 1 }),
    ]);
    expect(scored.result.hits.filter(({ kind }) => kind === "ASSET")).toEqual([
      expect.objectContaining({ key: golden.targets.assets[0]!.path, rank: 1 }),
    ]);
    expect(scored.audit).toMatchObject({
      objectIds: [golden.targets.nodes[0]!.id],
      ownerViolations: [],
      parentViolations: [],
      parentPrecision: 1,
      parentNodeCount: 1,
      extraParentCount: 0,
      courseScopeViolations: [],
      selfAssetViolations: [],
      queryGroupViolations: [],
      forbiddenHit: false,
      groupRecallAt5: 1,
      exactRoleRecallAt5: 1,
    });
    expect(scored.audit.nodeIds[0]).toMatch(/^node-[0-9a-f]{64}$/);
    expect(scored.audit.assetIds[0]).toMatch(/^asset-[0-9a-f]{64}$/);
    expect(scored.score.combinedEvidencePass).toBe(true);
  });

  it("scores a deliberately wrong object without using the expected owner to expand it", () => {
    const golden = testCase("visual-evidence-poster-16");
    const wrongObject = bindings.byAssetPath.get(
      "assets/layout-design/poster-17-layout.png",
    )!.objectId;
    const bundle = makeEvidenceBundle(golden, wrongObject);
    const scored = scoreMixedEvidenceCaseV2(golden, bundle, bindings);
    expect(scored.audit.ownerViolations).toEqual([]);
    expect(scored.audit.objectIds).toEqual([wrongObject]);
    expect(scored.score.nodeMetrics?.recallAt5).toBe(0);
    expect(scored.score.assetMetrics?.recallAt5).toBe(0);
    expect(scored.score.combinedEvidencePass).toBe(false);
  });

  it("counts a sibling poster role as group hit without calling it an exact-role hit", () => {
    const golden = testCase("visual-text-poster-01-layout");
    const bundle = makeEvidenceBundle(
      golden,
      golden.targets.nodes[0]!.id,
      "assets/layout-design/poster-01-type.png",
    );
    const scored = scoreMixedEvidenceCaseV2(golden, bundle, bindings);
    expect(scored.audit.assetPaths[0]).toBe(
      "assets/layout-design/poster-01-type.png",
    );
    expect(scored.audit.exactRoleRecallAt5).toBe(0);
    expect(scored.audit.groupRecallAt5).toBe(1);
  });

  it("does not promote a graph-only sibling asset into a visual retrieval hit", () => {
    const golden = testCase("visual-text-poster-01-layout");
    const bundle = makeEvidenceBundle(golden);
    const sibling = bindings.byAssetPath.get(
      "assets/layout-design/poster-01-type.png",
    )!;
    const siblingAsset = corpus.assets.find(({ id }) => id === sibling.assetId)!;
    const withGraphOnlyAsset = {
      ...bundle,
      evidence: {
        ...bundle.evidence,
        assets: [
          ...bundle.evidence.assets,
          {
            assetId: sibling.assetId,
            objectId: sibling.objectId,
            sha256: sibling.sha256,
            mimeType: "image/png" as const,
            dimensions: siblingAsset.dimensions,
          },
        ],
      },
    };
    const scored = scoreMixedEvidenceCaseV2(golden, withGraphOnlyAsset, bindings);
    expect(scored.audit.assetPaths).toEqual([
      "assets/layout-design/poster-01-layout.png",
    ]);
  });

  it("measures evaluator wall clock instead of trusting provider-reported timing", async () => {
    const ticks = [10, 35];
    const measured = await measureMixedRetrievalCallV2(
      async () => ({ providerReportedMs: 1 }),
      () => ticks.shift()!,
    );
    expect(measured).toEqual({
      value: { providerReportedMs: 1 },
      wallClockMs: 25,
    });
  });

  it("includes positive and negative cases in per-mode wall-clock p95", () => {
    const positive = createMixedEvaluationQueryV2(
      testCase("text-layout-hierarchy"),
      bindings,
    );
    const negative = createMixedEvaluationQueryV2(
      testCase("negative-layout-font-license"),
      bindings,
    );
    const summary = summarizeMixedPerformanceByModeV2([
      { runtimeQuery: positive, measuredLatenciesMs: [10, 20] },
      { runtimeQuery: negative, measuredLatenciesMs: [900, 1_000] },
    ]);
    expect(summary.TEXT_TO_TEXT).toEqual({
      p95Ms: 1_000,
      measuredQueryCount: 4,
    });
  });

  it("does not count a retained source as parent coverage without a PARENT node", () => {
    const golden = testCase("visual-evidence-poster-16");
    const bundle = makeEvidenceBundle(
      golden,
      golden.targets.nodes[0]!.id,
      golden.targets.assets[0]!.path,
      false,
    );
    expect(bundle.sources).toHaveLength(1);
    const scored = scoreMixedEvidenceCaseV2(golden, bundle, bindings);
    expect(scored.result.parentLocators).toEqual([]);
    expect(scored.score.parentCoverage).toBe(0);
    expect(scored.audit.parentNodeCount).toBe(0);
    expect(scored.audit.parentPrecision).toBeNull();
  });

  it("counts every unmatched parent locator even when the expected parent is missing", () => {
    const golden = testCase("visual-evidence-poster-16");
    const bundle = makeEvidenceBundle(golden);
    const withTwoWrongParentLocators = {
      ...bundle,
      sources: bundle.sources.map((source) => ({
        ...source,
        locators: [
          { kind: "LOCAL_DOCUMENT" as const, path: "data/courses/layout-design/wrong-one.md" },
          { kind: "LOCAL_DOCUMENT" as const, path: "data/courses/layout-design/wrong-two.md" },
        ],
      })),
    };
    const scored = scoreMixedEvidenceCaseV2(
      golden,
      withTwoWrongParentLocators,
      bindings,
    );

    expect(scored.audit.parentLocators).toEqual([
      "data/courses/layout-design/wrong-one.md",
      "data/courses/layout-design/wrong-two.md",
    ]);
    expect(scored.audit.parentNodeCount).toBe(1);
    expect(scored.audit.extraParentCount).toBe(2);
    expect(scored.audit.extraParentLocators).toBe(2);
  });

  it("rejects any provider-spy query with a hidden ground-truth key", () => {
    const query = createMixedEvaluationQueryV2(
      testCase("text-layout-hierarchy"),
      bindings,
    );
    expect(() => assertMixedRuntimeQueryAllowlistV2({
      ...query,
      expectedNodeId: "layout-hierarchy",
    })).toThrow();
  });

  it("evaluates every frozen T4 gate without moving a boundary after results", () => {
    const verdict = evaluateMixedRetrievalGatesV2(passingGateInput());
    expect(verdict.gateVersion).toBe("2026-07-28.3");
    expect(verdict.overallPass).toBe(true);
    expect(verdict.failed).toBe(0);
    expect(verdict.checks.length).toBeGreaterThan(30);
    const replacedModel = passingGateInput();
    replacedModel.identities.expected.channels.TEXT_VECTOR.modelId = "replacement/model";
    expect(evaluateMixedRetrievalGatesV2(replacedModel).overallPass).toBe(false);
  });

  it("treats bootstrap zero, mandatory 5/6 and exact 0.291666 as failures", () => {
    const input = passingGateInput();
    input.positiveByMode.TEXT_TO_IMAGE.exactRoleRecallAt5 = 0.291666;
    input.comparisons.pairedBootstrap
      .textToImageExactVsCaption!.confidenceInterval95.lower = 0;
    input.negative.mandatoryPassed = 5;
    const verdict = evaluateMixedRetrievalGatesV2(input);
    expect(verdict.overallPass).toBe(false);
    expect(verdict.checks.filter(({ pass }) => !pass).map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "text-to-image.exact-role-recall-at-5",
        "text-to-image.vs-caption-bootstrap-lower",
        "negative.mandatory",
      ]),
    );
  });

  it("compares a rounded five-of-six metric at the frozen rational boundary", () => {
    const exactRounded = passingGateInput();
    exactRounded.positiveByMode.IMAGE_TEXT_TO_EVIDENCE.parentCoverage = 0.833333;
    expect(evaluateMixedRetrievalGatesV2(exactRounded).checks.find(
      ({ id }) => id === "image-text.parent-coverage",
    )?.pass).toBe(true);

    const belowRounded = passingGateInput();
    belowRounded.positiveByMode.IMAGE_TEXT_TO_EVIDENCE.parentCoverage = 0.833332;
    expect(evaluateMixedRetrievalGatesV2(belowRounded).checks.find(
      ({ id }) => id === "image-text.parent-coverage",
    )?.pass).toBe(false);
  });
});

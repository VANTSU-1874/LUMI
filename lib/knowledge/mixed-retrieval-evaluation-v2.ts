import { createHash } from "node:crypto";

import { z } from "zod";

import {
  EvidenceBundleV2Schema,
  type EvidenceBundleV2,
  type EvidenceChannelV2,
} from "./evidence-bundle-v2";
import {
  stableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeNodeV2,
  type KnowledgeObjectV2,
} from "./knowledge-object-v2";
import { pairedClusterBootstrap } from "./retrieval-bootstrap";
import {
  RetrievalEvaluationResultSchema,
  RetrievalGoldenCaseSchema,
  RetrievalGoldenSuiteSchema,
  nearestRankPercentile,
  scoreRetrievalCase,
  summarizeRetrievalScores,
  type RetrievalEvaluationResult,
  type RetrievalGoldenCase,
  type RetrievalGoldenSuite,
  type ScoredRetrievalCase,
} from "./retrieval-quality";
import {
  createRetrievalQueryV2,
  RetrievalQueryV2Schema,
  type RetrievalModeV2,
  type RetrievalQueryV2,
} from "./retrieval-query-v2";

export const T4_MIXED_GATE_VERSION = "2026-07-28.3";
export const T4_MIXED_SUITE_VERSION = "2026-07-28.4";
export const T4_MIXED_SUITE_SHA256 =
  "69f7a0b39c0b7a3417338cbcd4a6da702f0c76bc134e542e845ab3c3b401517b";
export const T4_MIXED_BOOTSTRAP_ITERATIONS = 10_000;
export const T4_MIXED_BOOTSTRAP_SEED = 0x5eed_c0de;
export const T4_MIXED_REPETITIONS = 5;
export const T4_MIXED_WARMUPS = 1;
export const T4_FROZEN_CORPUS_BUNDLE_HASH =
  "82db90934afaffa3d227b6b0d11ab5efdb88009fd8b9274845567de4888079f8";
export const T4_FROZEN_CONTROL_INDEX_BUNDLE_HASH =
  "cad61822cf3e4d95e984b08c66fa6427c5adf182fc305329291f8eb9aad1be5d";
export const T4_FROZEN_TEXT_PROVIDER = Object.freeze({
  indexBundleHash: "b3119e9a942497f731d6c8ee063c00fe2793e859cf47d7cbaa6101a2771b1122",
  indexVersionId: "bge-small-zh-v1-5-1daa5a0d34c9",
  modelId: "BAAI/bge-small-zh-v1.5",
  modelRevision: "7999e1d3359715c523056ef9478215996d62a620",
});
export const T3_FROZEN_VISUAL_PROVIDER = Object.freeze({
  indexBundleHash: "fedb2a84cb7076b84b291749b3e7029286f69d244fea1f2c923a993e4be667d9",
  indexVersionId: "siglip2-224-two-region-v1",
  modelId: "google/siglip2-base-patch16-224",
  modelRevision: "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
});
export const T4_FROZEN_VISUAL_PROVIDER = Object.freeze({
  indexBundleHash: "1f2a354c755b498240108583d10ad5f0f5d2a3ad9c9f2cee2c3110d07f05125a",
  indexVersionId: "siglip2-224-two-region-i2i-l2-mean-v2",
  modelId: "google/siglip2-base-patch16-224",
  modelRevision: "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
});
export const T4_FROZEN_CAPTION_BASELINE_SHA256 =
  "5f556d5274b51b11c9e037ba93f1f5bf40734bc2a625f257bbb8b64e56c67b32";
export const T4_FROZEN_T3_BASELINE_SHA256 =
  "32677fbcba243db8e299de5c5b2e6fcfae03d2336ac60f68dbe8fb64c39ea1e3";

const RUNTIME_QUERY_KEYS = Object.freeze([
  "excludeAssetIds",
  "mode",
  "normalizedText",
  "originalText",
  "queryAsset",
  "schemaVersion",
  "scope",
] as const);

const EXTERNAL_NEGATIVE_IDS = new Set([
  "negative-layout-font-license",
  "negative-layout-admission-guarantee",
  "negative-layout-current-copyright",
  "negative-layout-exam-schedule",
]);
const IMAGE_SCOPE_NEGATIVE_IDS = new Set([
  "negative-image-brand-poster-22",
  "negative-evidence-digital-poster-34",
]);
const MANDATORY_NEGATIVE_IDS = new Set([
  ...EXTERNAL_NEGATIVE_IDS,
  ...IMAGE_SCOPE_NEGATIVE_IDS,
]);

type CorpusNodeBindingV2 = {
  node: KnowledgeNodeV2;
  object: KnowledgeObjectV2;
};

export type MixedAssetBindingV2 = {
  assetId: string;
  assetPath: string;
  sha256: string;
  imageNodeId: string;
  objectId: string;
  sourceCoursePackId: string;
  parentLocator: string | null;
};

export type MixedEvaluationBindingsV2 = {
  corpusBundleHash: string;
  byObjectId: ReadonlyMap<string, KnowledgeObjectV2>;
  byNodeId: ReadonlyMap<string, CorpusNodeBindingV2>;
  byAssetId: ReadonlyMap<string, MixedAssetBindingV2>;
  byAssetPath: ReadonlyMap<string, MixedAssetBindingV2>;
};

export type MixedEvaluationCaseAuditV2 = {
  caseId: string;
  runtimeMode: RetrievalModeV2;
  runtimeInputFingerprint: string;
  providerInputKeys: string[];
  objectIds: string[];
  nodeIds: string[];
  assetIds: string[];
  assetPaths: string[];
  regionIds: string[];
  parentNodeIds: string[];
  parentLocators: string[];
  sourceCoursePackIds: string[];
  ownerChecks: number;
  ownerViolations: string[];
  parentChecks: number;
  parentViolations: string[];
  parentPrecision: number | null;
  parentNodeCount: number;
  extraParentCount: number;
  extraParentLocators: number;
  courseScopeViolations: string[];
  selfAssetViolations: string[];
  queryGroupViolations: string[];
  forbiddenHit: boolean;
  groupRecallAt5: number | null;
  exactRoleRecallAt5: number | null;
  resultFingerprint: string;
};

export type MixedEvaluationCaseV2 = {
  caseId: string;
  runtimeQuery: RetrievalQueryV2;
  bundle: EvidenceBundleV2;
  result: RetrievalEvaluationResult;
  score: ScoredRetrievalCase;
  audit: MixedEvaluationCaseAuditV2;
  measuredLatenciesMs: number[];
  providerReportedLatenciesMs: number[];
  latencyP50Ms: number;
  latencyP95Ms: number;
  stableAcrossMeasuredRuns: boolean;
};

export type MixedBaselineReportV2 = {
  suiteVersion: string;
  suiteHash: string;
  results: RetrievalEvaluationResult[];
  scores: ScoredRetrievalCase[];
  summary?: ReturnType<typeof summarizeRetrievalScores>;
};

type RetrieveMixedV2 = (
  query: RetrievalQueryV2,
  context: {
    phase: "WARMUP" | "MEASURED";
    repetition: number;
  },
) => Promise<EvidenceBundleV2>;

export type MixedRuntimeEvidenceV2 = {
  source: "LOCAL_MIXED_RUNTIME_V2";
  visualMaxCacheEntries: number;
  sidecarHandshakeVerified: true;
  textProviderIndexBundleHash: string;
  textIndexVersionId: string;
  visualProviderIndexBundleHash: string;
  visualIndexVersionId: string;
};

const MixedRuntimeEvidenceV2Schema = z
  .object({
    source: z.literal("LOCAL_MIXED_RUNTIME_V2"),
    visualMaxCacheEntries: z.number().int().min(0).max(10_000),
    sidecarHandshakeVerified: z.literal(true),
    textProviderIndexBundleHash: z.string().regex(/^[0-9a-f]{64}$/),
    textIndexVersionId: z.string().min(1),
    visualProviderIndexBundleHash: z.string().regex(/^[0-9a-f]{64}$/),
    visualIndexVersionId: z.string().min(1),
  })
  .strict();

export type EvaluateMixedRetrieverV2Options = {
  suiteBytes: Uint8Array;
  corpus: KnowledgeCorpusBundleV2;
  retrieve: RetrieveMixedV2;
  captionBaseline?: MixedBaselineReportV2 | null;
  t3Baseline?: MixedBaselineReportV2 | null;
  expectedIdentity: MixedExpectedIdentityV2;
  runtimeEvidence: MixedRuntimeEvidenceV2;
  cachePolicy:
    | {
        mode: "CACHE_MISS";
        visualMaxCacheEntries: 0;
      }
    | {
        mode: "CACHE_HIT";
        visualMaxCacheEntries: number;
        warmedBeforeMeasurement: true;
      };
  warmups?: number;
  repetitions?: number;
  now?: () => number;
};

type EvaluatedChannelIdentityV2 = NonNullable<EvidenceChannelV2["identity"]>;

export type MixedExpectedIdentityV2 = {
  activeIndexBundleHash: string;
  channels: Record<
    "LEXICAL" | "TEXT_VECTOR" | "VISUAL_VECTOR",
    EvaluatedChannelIdentityV2
  >;
};

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function average(values: readonly number[]) {
  return values.length === 0
    ? null
    : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function runtimeQueryFingerprint(query: RetrievalQueryV2) {
  return sha256(stableJsonV2(RetrievalQueryV2Schema.parse(query)));
}

function resultFingerprint(bundle: EvidenceBundleV2) {
  return sha256(stableJsonV2({
    status: bundle.status,
    query: bundle.query,
    channels: bundle.channels.map((channel) => ({
      ...channel,
      timingMs: 0,
    })),
    evidence: bundle.evidence,
    sources: bundle.sources,
    provenance: bundle.provenance,
  }));
}

export async function measureMixedRetrievalCallV2<T>(
  run: () => Promise<T>,
  now: () => number = performance.now.bind(performance),
) {
  const startedAt = now();
  const value = await run();
  return {
    value,
    wallClockMs: Math.max(0, now() - startedAt),
  };
}

function posterGroup(assetPath: string | undefined) {
  return assetPath?.match(/(?:^|\/)poster-(\d+)-(?:layout|type|color)\.png$/)?.[1] ?? null;
}

function isScorableParentPath(value: string) {
  return /^data\/courses\/[^/]+\/[^/]+\.md$/.test(value);
}

function nodeHasAsset(node: KnowledgeNodeV2): node is Extract<KnowledgeNodeV2, { kind: "IMAGE" }> {
  return node.kind === "IMAGE";
}

export function buildMixedEvaluationBindingsV2(
  corpusInput: KnowledgeCorpusBundleV2,
): MixedEvaluationBindingsV2 {
  const corpus = verifyKnowledgeCorpusBundleV2(corpusInput);
  const assets = new Map(corpus.assets.map((asset) => [asset.id, asset]));
  const byObjectId = new Map<string, KnowledgeObjectV2>();
  const byNodeId = new Map<string, CorpusNodeBindingV2>();
  const byAssetId = new Map<string, MixedAssetBindingV2>();
  const byAssetPath = new Map<string, MixedAssetBindingV2>();
  for (const object of corpus.objects) {
    if (byObjectId.has(object.id)) {
      throw new Error(`MIXED_EVALUATION_DUPLICATE_OBJECT:${object.id}`);
    }
    byObjectId.set(object.id, object);
    for (const node of object.nodes) {
      if (byNodeId.has(node.id)) {
        throw new Error(`MIXED_EVALUATION_DUPLICATE_NODE:${node.id}`);
      }
      byNodeId.set(node.id, { node, object });
      if (!nodeHasAsset(node)) continue;
      const asset = assets.get(node.assetId);
      if (!asset) throw new Error(`MIXED_EVALUATION_ASSET_MISSING:${node.assetId}`);
      const assetPath = asset.locator.path.replaceAll("\\", "/");
      const parentLocator = object.legacyItem.source.localDocument?.replaceAll("\\", "/")
        ?? null;
      const binding = {
        assetId: asset.id,
        assetPath,
        sha256: asset.sha256,
        imageNodeId: node.id,
        objectId: object.id,
        sourceCoursePackId: object.sourceCoursePack.id,
        parentLocator,
      };
      if (byAssetId.has(asset.id)) {
        throw new Error(`MIXED_EVALUATION_DUPLICATE_ASSET_OWNER:${asset.id}`);
      }
      if (byAssetPath.has(assetPath)) {
        throw new Error(`MIXED_EVALUATION_DUPLICATE_ASSET_PATH:${assetPath}`);
      }
      byAssetId.set(asset.id, binding);
      byAssetPath.set(assetPath, binding);
    }
  }
  if (byAssetId.size !== corpus.assets.length) {
    const missing = corpus.assets
      .map(({ id }) => id)
      .filter((id) => !byAssetId.has(id))
      .sort(compareCodePoints);
    throw new Error(`MIXED_EVALUATION_ASSET_OWNER_MISSING:${missing.join(",")}`);
  }
  return {
    corpusBundleHash: corpus.bundleHash,
    byObjectId,
    byNodeId,
    byAssetId,
    byAssetPath,
  };
}

function runtimeCaseProjection(rawCase: RetrievalGoldenCase) {
  const value = rawCase as RetrievalGoldenCase;
  return {
    mode: value.mode,
    coursePackVersion: value.coursePackVersion,
    query: value.query,
  };
}

export function createMixedEvaluationQueryV2(
  rawCase: RetrievalGoldenCase,
  bindings: MixedEvaluationBindingsV2,
): RetrievalQueryV2 {
  const projected = runtimeCaseProjection(rawCase);
  const runtimeMode: RetrievalModeV2 = projected.mode === "NEGATIVE"
    ? "TEXT_TO_TEXT"
    : projected.mode;
  const sourceCoursePack = projected.query.coursePackId === null
    ? null
    : {
        id: projected.query.coursePackId,
        version: projected.coursePackVersion,
      };
  const scope = {
    corpusBundleHash: bindings.corpusBundleHash,
    sourceCoursePack,
  };
  const excludeAssetIds = (projected.query.excludeAssetPaths ?? []).map((assetPath) => {
    const binding = bindings.byAssetPath.get(assetPath);
    if (!binding) throw new Error(`MIXED_EVALUATION_EXCLUDED_ASSET_MISSING:${assetPath}`);
    return binding.assetId;
  });
  if (runtimeMode === "TEXT_TO_TEXT" || runtimeMode === "TEXT_TO_IMAGE") {
    if (!projected.query.text) {
      throw new Error(`MIXED_EVALUATION_TEXT_MISSING:${runtimeMode}`);
    }
    return createRetrievalQueryV2({
      mode: runtimeMode,
      text: projected.query.text,
      scope,
      excludeAssetIds,
    });
  }
  const assetPath = projected.query.assetPath;
  const binding = assetPath ? bindings.byAssetPath.get(assetPath) : null;
  if (!binding) {
    throw new Error(`MIXED_EVALUATION_QUERY_ASSET_MISSING:${assetPath ?? "NONE"}`);
  }
  const queryAsset = { assetId: binding.assetId, sha256: binding.sha256 };
  if (runtimeMode === "IMAGE_TO_IMAGE") {
    return createRetrievalQueryV2({
      mode: runtimeMode,
      queryAsset,
      scope,
      excludeAssetIds,
    });
  }
  if (!projected.query.text) {
    throw new Error("MIXED_EVALUATION_IMAGE_TEXT_MISSING");
  }
  return createRetrievalQueryV2({
    mode: runtimeMode,
    text: projected.query.text,
    queryAsset,
    scope,
    excludeAssetIds,
  });
}

export function assertMixedRuntimeQueryAllowlistV2(queryInput: unknown) {
  const query = RetrievalQueryV2Schema.parse(queryInput);
  const keys = Object.keys(query).sort(compareCodePoints);
  if (stableJsonV2(keys) !== stableJsonV2(RUNTIME_QUERY_KEYS)) {
    throw new Error(`MIXED_EVALUATION_QUERY_KEY_LEAK:${keys.join(",")}`);
  }
  return {
    query,
    keys,
    fingerprint: runtimeQueryFingerprint(query),
  };
}

export function assertMixedGoldenMetadataIsolationV2(
  testCase: RetrievalGoldenCase,
  bindings: MixedEvaluationBindingsV2,
) {
  const original = createMixedEvaluationQueryV2(testCase, bindings);
  const poisoned = {
    ...testCase,
    expectation: testCase.expectation === "ANSWERABLE" ? "NO_ANSWER" : "ANSWERABLE",
    expectedSourceCoursePackId: "book-design",
    expectedLegacyPlacementCoursePackId: "general-design",
    targets: {
      nodes: [{ id: "poison-node", relevance: 3, required: true }],
      assets: [],
      regions: [],
      expectedParentLocators: ["data/courses/book-design/poison.md"],
      forbiddenNodeIds: ["poison-forbidden-node"],
      forbiddenAssetPaths: ["assets/layout-design/poison.png"],
    },
    tags: ["poison"],
  } as unknown as RetrievalGoldenCase;
  const altered = createMixedEvaluationQueryV2(poisoned, bindings);
  const originalFingerprint = runtimeQueryFingerprint(original);
  const alteredFingerprint = runtimeQueryFingerprint(altered);
  if (originalFingerprint !== alteredFingerprint) {
    throw new Error(`MIXED_EVALUATION_GROUND_TRUTH_LEAK:${testCase.id}`);
  }
  return originalFingerprint;
}

export function assertMixedSuiteContractV2(suiteBytes: Uint8Array) {
  const digest = sha256(suiteBytes);
  if (digest !== T4_MIXED_SUITE_SHA256) {
    throw new Error(
      `MIXED_EVALUATION_SUITE_HASH_MISMATCH:${digest}:`
      + `expected=${T4_MIXED_SUITE_SHA256}`,
    );
  }
  const suite = RetrievalGoldenSuiteSchema.parse(JSON.parse(
    Buffer.from(suiteBytes).toString("utf8"),
  ));
  if (suite.suiteVersion !== T4_MIXED_SUITE_VERSION) {
    throw new Error(`MIXED_EVALUATION_SUITE_VERSION_MISMATCH:${suite.suiteVersion}`);
  }
  const positives = suite.cases.filter(({ expectation }) => expectation === "ANSWERABLE");
  const negatives = suite.cases.filter(({ expectation }) => expectation === "NO_ANSWER");
  if (suite.cases.length !== 51 || positives.length !== 41 || negatives.length !== 10) {
    throw new Error(
      `MIXED_EVALUATION_SUITE_CARDINALITY:${suite.cases.length}/`
      + `${positives.length}/${negatives.length}`,
    );
  }
  return suite;
}

function mappedResultStatus(bundle: EvidenceBundleV2) {
  if (bundle.status === "DEGRADED") {
    return bundle.evidence.primary.length > 0 ? "SUCCESS" as const : "EMPTY" as const;
  }
  return bundle.status;
}

function evidenceAssetOrder(bundle: EvidenceBundleV2) {
  const rankedAssets = bundle.evidence.assets
    .filter(({ retrieval }) => retrieval !== undefined)
    .sort((left, right) =>
      left.retrieval!.rank - right.retrieval!.rank
      || compareCodePoints(left.assetId, right.assetId))
    .map(({ assetId }) => assetId)
    .filter((assetId) => assetId !== bundle.query.queryAsset?.assetId);
  return unique(rankedAssets).slice(0, 5);
}

function resultFromEvidence(
  testCase: RetrievalGoldenCase,
  bundleInput: EvidenceBundleV2,
  bindings: MixedEvaluationBindingsV2,
): RetrievalEvaluationResult {
  const bundle = EvidenceBundleV2Schema.parse(bundleInput);
  const expectedQuery = createMixedEvaluationQueryV2(testCase, bindings);
  if (runtimeQueryFingerprint(bundle.query) !== runtimeQueryFingerprint(expectedQuery)) {
    throw new Error(`MIXED_EVALUATION_RESPONSE_QUERY_MISMATCH:${testCase.id}`);
  }
  const status = mappedResultStatus(bundle);
  if (status !== "SUCCESS") {
    return RetrievalEvaluationResultSchema.parse({
      caseId: testCase.id,
      status,
      channel: "HYBRID",
      ...(status === "UNSUPPORTED"
        ? { unsupportedReason: "PROVIDER_UNAVAILABLE" as const }
        : {}),
      hits: [],
      parentLocators: [],
      latencyMs: bundle.timing.totalMs,
      degradedFrom: bundle.status === "DEGRADED" ? "HYBRID" : null,
      degradationSucceeded: bundle.status === "DEGRADED" ? true : null,
    });
  }
  const nodeObjectIds = unique(
    [...bundle.evidence.primary]
      .sort((left, right) => left.fusedRank - right.fusedRank)
      .map(({ objectId }) => objectId),
  ).slice(0, 5);
  const nodeHits = nodeObjectIds.map((objectId, index) => ({
    kind: "NODE" as const,
    key: objectId,
    rank: index + 1,
  }));
  const regionByAssetId = new Map(
    bundle.evidence.regions.map((region) => [region.assetId, region]),
  );
  const assetHits = evidenceAssetOrder(bundle).map((assetId, index) => {
    const binding = bindings.byAssetId.get(assetId);
    if (!binding) throw new Error(`MIXED_EVALUATION_UNKNOWN_ASSET:${assetId}`);
    const region = regionByAssetId.get(assetId);
    return {
      kind: "ASSET" as const,
      key: binding.assetPath,
      rank: index + 1,
      ...(region
        ? {
            region: {
              bbox: [
                region.bbox.x,
                region.bbox.y,
                region.bbox.width,
                region.bbox.height,
              ] as [number, number, number, number],
              coordinateSpace: region.bbox.coordinateSpace,
              origin: region.origin === "CORPUS_REGION"
                ? "INDEXED_REGION" as const
                : region.origin,
            },
          }
        : {}),
    };
  });
  const parentSourceIds = new Set(
    bundle.evidence.nodes
      .filter(({ relation }) => relation === "PARENT")
      .map(({ sourceId }) => sourceId),
  );
  const parentLocators = unique(bundle.sources.flatMap((source) =>
    parentSourceIds.has(source.sourceId)
      ? source.locators.flatMap((locator) =>
          locator.kind === "LOCAL_DOCUMENT" && isScorableParentPath(locator.path)
            ? [locator.path]
            : [])
      : []));
  const hits = [...nodeHits, ...assetHits];
  return RetrievalEvaluationResultSchema.parse({
    caseId: testCase.id,
    status: hits.length > 0 ? "SUCCESS" : "EMPTY",
    channel: "HYBRID",
    hits,
    parentLocators,
    latencyMs: bundle.timing.totalMs,
    degradedFrom: bundle.status === "DEGRADED" ? "HYBRID" : null,
    degradationSucceeded: bundle.status === "DEGRADED" ? true : null,
  });
}

function parentAudit(
  bundle: EvidenceBundleV2,
  bindings: MixedEvaluationBindingsV2,
) {
  const primaryBySeed = new Map(
    bundle.evidence.nodes
      .filter(({ relation }) => relation === "PRIMARY")
      .map((node) => [node.seedCandidateId, node]),
  );
  let checks = 0;
  let valid = 0;
  const violations: string[] = [];
  for (const parent of bundle.evidence.nodes.filter(({ relation }) => relation === "PARENT")) {
    checks += 1;
    const primary = primaryBySeed.get(parent.seedCandidateId);
    const corpusPrimary = primary ? bindings.byNodeId.get(primary.nodeId)?.node : null;
    const corpusParent = bindings.byNodeId.get(parent.nodeId);
    if (
      primary
      && corpusPrimary
      && corpusParent
      && corpusPrimary.parentId === parent.nodeId
      && corpusParent.object.id === primary.objectId
      && parent.objectId === primary.objectId
    ) {
      valid += 1;
    } else {
      violations.push(`${parent.seedCandidateId}:${parent.nodeId}`);
    }
  }
  return {
    checks,
    violations,
    precision: checks === 0 ? null : round(valid / checks),
  };
}

function ownerAudit(
  bundle: EvidenceBundleV2,
  bindings: MixedEvaluationBindingsV2,
) {
  let checks = 0;
  const violations: string[] = [];
  for (const node of bundle.evidence.nodes) {
    checks += 1;
    const binding = bindings.byNodeId.get(node.nodeId);
    if (!binding || binding.object.id !== node.objectId) {
      violations.push(`NODE:${node.nodeId}:${node.objectId}`);
    }
  }
  for (const asset of bundle.evidence.assets) {
    checks += 1;
    const binding = bindings.byAssetId.get(asset.assetId);
    if (!binding || binding.objectId !== asset.objectId || binding.sha256 !== asset.sha256) {
      violations.push(`ASSET:${asset.assetId}:${asset.objectId}`);
    }
  }
  for (const region of bundle.evidence.regions) {
    checks += 1;
    const asset = bindings.byAssetId.get(region.assetId);
    const imageNode = bindings.byNodeId.get(region.imageNodeId);
    const regionNode = region.regionNodeId
      ? bindings.byNodeId.get(region.regionNodeId)
      : null;
    if (
      !asset
      || !imageNode
      || imageNode.object.id !== asset.objectId
      || asset.objectId !== region.objectId
      || imageNode.node.kind !== "IMAGE"
      || imageNode.node.assetId !== region.assetId
      || (
        region.regionNodeId !== null
        && (
          !regionNode
          || regionNode.node.kind !== "REGION"
          || regionNode.object.id !== region.objectId
        )
      )
    ) {
      violations.push(`REGION:${region.regionId}:${region.objectId}`);
    }
  }
  return { checks, violations };
}

function groupRecallAt5(
  testCase: RetrievalGoldenCase,
  result: RetrievalEvaluationResult,
) {
  if (testCase.targets.assets.length === 0 || testCase.expectation !== "ANSWERABLE") {
    return null;
  }
  const targetPaths = testCase.targets.assets.map(({ path }) => path);
  const targetPosterGroups = new Set(
    targetPaths.flatMap((assetPath) => {
      const group = posterGroup(assetPath);
      return group === null ? [] : [group];
    }),
  );
  const exactTargets = new Set(targetPaths);
  const predictions = result.hits
    .filter((hit) => hit.kind === "ASSET")
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 5);
  return predictions.some(({ key }) => {
    const group = posterGroup(key);
    return group === null
      ? exactTargets.has(key)
      : targetPosterGroups.has(group);
  }) ? 1 : 0;
}

export function scoreMixedEvidenceCaseV2(
  rawCase: RetrievalGoldenCase,
  bundleInput: EvidenceBundleV2,
  bindings: MixedEvaluationBindingsV2,
) {
  const testCase = RetrievalGoldenCaseSchema.parse(rawCase);
  const bundle = EvidenceBundleV2Schema.parse(bundleInput);
  const result = resultFromEvidence(testCase, bundle, bindings);
  const score = scoreRetrievalCase(testCase, result);
  const owner = ownerAudit(bundle, bindings);
  const parent = parentAudit(bundle, bindings);
  const scopeId = bundle.query.scope.sourceCoursePack?.id ?? null;
  const sourceCoursePackIds = unique([
    ...bundle.evidence.nodes.map(({ sourceCoursePack }) => sourceCoursePack.id),
    ...bundle.evidence.assets.flatMap(({ assetId }) => {
      const binding = bindings.byAssetId.get(assetId);
      return binding ? [binding.sourceCoursePackId] : [];
    }),
    ...bundle.evidence.primary.flatMap(({ objectId }) => {
      const object = bindings.byObjectId.get(objectId);
      return object ? [object.sourceCoursePack.id] : [];
    }),
  ]);
  const courseScopeViolations = scopeId === null
    ? []
    : sourceCoursePackIds.filter((id) => id !== scopeId);
  const assetPaths = result.hits
    .filter((hit) => hit.kind === "ASSET")
    .sort((left, right) => left.rank - right.rank)
    .map(({ key }) => key);
  const excluded = new Set(testCase.query.excludeAssetPaths ?? []);
  const selfAssetViolations = assetPaths.filter((assetPath) => excluded.has(assetPath));
  const queryPosterGroup = posterGroup(testCase.query.assetPath);
  const queryGroupViolations = (
    queryPosterGroup === null
    || !testCase.tags.includes("exclude-query-group")
  )
    ? []
    : assetPaths.filter((assetPath) => posterGroup(assetPath) === queryPosterGroup);
  const expectedParents = new Set(testCase.targets.expectedParentLocators);
  const parentNodeCount = bundle.evidence.nodes.filter(
    ({ relation }) => relation === "PARENT",
  ).length;
  const extraParentLocators = result.parentLocators.filter(
    (locator) => !expectedParents.has(locator),
  ).length;
  const exactRoleRecallAt5 = score.assetMetrics?.recallAt5 ?? null;
  const audit: MixedEvaluationCaseAuditV2 = {
    caseId: testCase.id,
    runtimeMode: bundle.query.mode,
    runtimeInputFingerprint: runtimeQueryFingerprint(bundle.query),
    providerInputKeys: Object.keys(bundle.query).sort(compareCodePoints),
    objectIds: bundle.evidence.primary.map(({ objectId }) => objectId),
    nodeIds: bundle.evidence.nodes.map(({ nodeId }) => nodeId),
    assetIds: bundle.evidence.assets.map(({ assetId }) => assetId),
    assetPaths,
    regionIds: bundle.evidence.regions.map(({ regionId }) => regionId),
    parentNodeIds: bundle.evidence.nodes
      .filter(({ relation }) => relation === "PARENT")
      .map(({ nodeId }) => nodeId),
    parentLocators: result.parentLocators,
    sourceCoursePackIds,
    ownerChecks: owner.checks,
    ownerViolations: owner.violations,
    parentChecks: parent.checks,
    parentViolations: parent.violations,
    parentPrecision: parent.precision,
    parentNodeCount,
    extraParentCount: extraParentLocators,
    extraParentLocators,
    courseScopeViolations,
    selfAssetViolations,
    queryGroupViolations,
    forbiddenHit: score.forbiddenHit,
    groupRecallAt5: groupRecallAt5(testCase, result),
    exactRoleRecallAt5,
    resultFingerprint: resultFingerprint(bundle),
  };
  return { result, score, audit };
}

function parseBaselineReport(
  input: MixedBaselineReportV2 | null | undefined,
  label: string,
  suite: RetrievalGoldenSuite,
) {
  if (!input) return null;
  if (
    input.suiteVersion !== T4_MIXED_SUITE_VERSION
    || input.suiteHash !== T4_MIXED_SUITE_SHA256
  ) {
    throw new Error(`MIXED_EVALUATION_${label}_SUITE_MISMATCH`);
  }
  const results = z.array(RetrievalEvaluationResultSchema).length(51).parse(input.results);
  const expectedCaseIds = [...suite.cases.map(({ id }) => id)].sort(compareCodePoints);
  const actualCaseIds = [...results.map(({ caseId }) => caseId)].sort(compareCodePoints);
  if (
    new Set(actualCaseIds).size !== actualCaseIds.length
    || stableJsonV2(actualCaseIds) !== stableJsonV2(expectedCaseIds)
  ) {
    throw new Error(`MIXED_EVALUATION_${label}_CASE_SET_MISMATCH`);
  }
  return {
    ...input,
    results,
    byCase: new Map(results.map((result) => [result.caseId, result])),
  };
}

function baselineScoreForCase(
  testCase: RetrievalGoldenCase,
  baseline: ReturnType<typeof parseBaselineReport>,
) {
  const result = baseline?.byCase.get(testCase.id);
  return result ? scoreRetrievalCase(testCase, result) : null;
}

function bootstrapFor(
  cases: readonly RetrievalGoldenCase[],
  baseline: ReturnType<typeof parseBaselineReport>,
  candidateByCase: ReadonlyMap<string, MixedEvaluationCaseV2>,
  metric: (
    testCase: RetrievalGoldenCase,
    result: RetrievalEvaluationResult,
    score: ScoredRetrievalCase,
  ) => number,
) {
  if (!baseline || cases.length === 0) return null;
  const baselineScores = cases.map((testCase) => {
    const result = baseline.byCase.get(testCase.id);
    if (!result) throw new Error(`MIXED_EVALUATION_BASELINE_CASE_MISSING:${testCase.id}`);
    return {
      caseId: testCase.id,
      tags: testCase.tags,
      value: metric(testCase, result, scoreRetrievalCase(testCase, result)),
    };
  });
  const candidateScores = cases.map((testCase) => {
    const candidate = candidateByCase.get(testCase.id);
    if (!candidate) throw new Error(`MIXED_EVALUATION_CASE_MISSING:${testCase.id}`);
    return {
      caseId: testCase.id,
      tags: testCase.tags,
      value: metric(testCase, candidate.result, candidate.score),
    };
  });
  return pairedClusterBootstrap(baselineScores, candidateScores, {
    iterations: T4_MIXED_BOOTSTRAP_ITERATIONS,
    seed: T4_MIXED_BOOTSTRAP_SEED,
  });
}

function visualTaskCompletion(
  testCase: RetrievalGoldenCase,
  result: RetrievalEvaluationResult,
  score: ScoredRetrievalCase,
) {
  if (testCase.expectation !== "ANSWERABLE") return score.negativePass ? 1 : 0;
  if (testCase.mode === "IMAGE_TEXT_TO_EVIDENCE") {
    return score.combinedEvidencePass ? 1 : 0;
  }
  return groupRecallAt5(testCase, result) ?? score.primaryMetrics?.recallAt5 ?? 0;
}

function comparisons(
  suite: RetrievalGoldenSuite,
  cases: readonly MixedEvaluationCaseV2[],
  caption: ReturnType<typeof parseBaselineReport>,
  t3: ReturnType<typeof parseBaselineReport>,
) {
  const byCase = new Map(cases.map((item) => [item.caseId, item]));
  const textToImage = suite.cases.filter(
    ({ mode, expectation }) => mode === "TEXT_TO_IMAGE" && expectation === "ANSWERABLE",
  );
  const answerableVisual = suite.cases.filter(({ mode, expectation }) =>
    expectation === "ANSWERABLE"
    && ["TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_TEXT_TO_EVIDENCE"].includes(mode));
  const assetPositive = suite.cases.filter(({ mode, expectation }) =>
    expectation === "ANSWERABLE"
    && (mode === "TEXT_TO_IMAGE" || mode === "IMAGE_TO_IMAGE"));
  const captionExact = bootstrapFor(
    textToImage,
    caption,
    byCase,
    (_testCase, _result, score) => score.assetMetrics?.recallAt5 ?? 0,
  );
  const t3Exact = bootstrapFor(
    textToImage,
    t3,
    byCase,
    (_testCase, _result, score) => score.assetMetrics?.recallAt5 ?? 0,
  );
  const t3VisualTask = bootstrapFor(
    answerableVisual,
    t3,
    byCase,
    visualTaskCompletion,
  );
  const assetDeltas = t3
    ? assetPositive.map((testCase) => {
        const baselineResult = t3.byCase.get(testCase.id)!;
        const baselineScore = scoreRetrievalCase(testCase, baselineResult);
        const candidate = byCase.get(testCase.id)!;
        return visualTaskCompletion(testCase, candidate.result, candidate.score)
          - visualTaskCompletion(testCase, baselineResult, baselineScore);
      })
    : [];
  const t3ByMode = t3
    ? Object.fromEntries(
        ([
          "TEXT_TO_TEXT",
          "TEXT_TO_IMAGE",
          "IMAGE_TO_IMAGE",
          "IMAGE_TEXT_TO_EVIDENCE",
        ] as const).map((mode) => {
          const modeCases = suite.cases.filter(
            (testCase) =>
              testCase.mode === mode && testCase.expectation === "ANSWERABLE",
          );
          const modeScores = modeCases.map((testCase) => {
            const result = t3.byCase.get(testCase.id);
            if (!result) {
              throw new Error(`MIXED_EVALUATION_T3_CASE_MISSING:${testCase.id}`);
            }
            return {
              testCase,
              result,
              score: scoreRetrievalCase(testCase, result),
            };
          });
          return [
            mode,
            {
              caseCount: modeScores.length,
              groupRecallAt5: average(modeScores.flatMap(({ testCase, result }) => {
                const value = groupRecallAt5(testCase, result);
                return value === null ? [] : [value];
              })),
              mrr: average(modeScores.flatMap(({ score }) =>
                score.primaryMetrics ? [score.primaryMetrics.mrr] : [])),
              latencyP95Ms: nearestRankPercentile(
                modeScores.map(({ result }) => result.latencyMs),
                0.95,
              ),
            },
          ];
        }),
      )
    : null;
  return {
    pairedBootstrap: {
      textToImageExactVsCaption: captionExact,
      textToImageExactVsT3: t3Exact,
      visualTaskCompletionVsT3: t3VisualTask,
    },
    assetSingleChannelComparison: t3
      ? {
          caseCount: assetPositive.length,
          gains: assetDeltas.filter((delta) => delta > 0).length,
          regressions: assetDeltas.filter((delta) => delta < 0).length,
          unchanged: assetDeltas.filter((delta) => delta === 0).length,
          gainMinusRegression:
            assetDeltas.filter((delta) => delta > 0).length
            - assetDeltas.filter((delta) => delta < 0).length,
        }
      : null,
    t3ByMode,
  };
}

function positiveModeSummary(
  mode: RetrievalGoldenCase["mode"],
  suite: RetrievalGoldenSuite,
  byCase: ReadonlyMap<string, MixedEvaluationCaseV2>,
) {
  const cases = suite.cases.filter(
    (testCase) => testCase.mode === mode && testCase.expectation === "ANSWERABLE",
  );
  const results = cases.map((testCase) => byCase.get(testCase.id)!);
  return {
    caseCount: results.length,
    exactRoleRecallAt5: average(results.flatMap(({ audit }) =>
      audit.exactRoleRecallAt5 === null ? [] : [audit.exactRoleRecallAt5])),
    groupRecallAt5: average(results.flatMap(({ audit }) =>
      audit.groupRecallAt5 === null ? [] : [audit.groupRecallAt5])),
    mrr: average(results.flatMap(({ score }) =>
      score.primaryMetrics ? [score.primaryMetrics.mrr] : [])),
    ndcgAt5: average(results.flatMap(({ score }) =>
      score.primaryMetrics ? [score.primaryMetrics.ndcgAt5] : [])),
    precisionAt5: average(results.flatMap(({ score }) =>
      score.primaryMetrics ? [score.primaryMetrics.precisionAt5] : [])),
    nodeRecallAt5: average(results.flatMap(({ score }) =>
      score.nodeMetrics ? [score.nodeMetrics.recallAt5] : [])),
    assetRecallAt5: average(results.flatMap(({ score }) =>
      score.assetMetrics ? [score.assetMetrics.recallAt5] : [])),
    parentCoverage: average(results.flatMap(({ score }) =>
      score.parentCoverage === null ? [] : [score.parentCoverage])),
    combinedEvidencePassRate: average(results.flatMap(({ score }) =>
      score.combinedEvidencePass === null ? [] : [score.combinedEvidencePass ? 1 : 0])),
    ownerConsistency: average(results.map(({ audit }) =>
      audit.ownerViolations.length === 0 ? 1 : 0)),
    parentConsistency: average(results.map(({ audit }) =>
      audit.parentViolations.length === 0 ? 1 : 0)),
    parentPrecision: average(results.flatMap(({ audit }) =>
      audit.parentPrecision === null ? [] : [audit.parentPrecision])),
    maxExtraParentCount: results.length === 0
      ? null
      : Math.max(...results.map(({ audit }) => audit.extraParentCount)),
    maxExtraParentLocators: results.length === 0
      ? null
      : Math.max(...results.map(({ audit }) => audit.extraParentLocators)),
    latencyP95Ms: nearestRankPercentile(
      results.flatMap(({ measuredLatenciesMs }) => measuredLatenciesMs),
      0.95,
    ),
  };
}

function negativeSummary(
  suite: RetrievalGoldenSuite,
  byCase: ReadonlyMap<string, MixedEvaluationCaseV2>,
) {
  const negatives = suite.cases.filter(({ expectation }) => expectation === "NO_ANSWER");
  const passed = negatives.filter((testCase) => byCase.get(testCase.id)?.score.negativePass);
  const mandatory = negatives.filter(({ id }) => MANDATORY_NEGATIVE_IDS.has(id));
  const mandatoryPassed = mandatory.filter(
    (testCase) => byCase.get(testCase.id)?.score.negativePass,
  );
  return {
    caseCount: negatives.length,
    passed: passed.length,
    passRate: round(passed.length / negatives.length),
    mandatoryCaseCount: mandatory.length,
    mandatoryPassed: mandatoryPassed.length,
    mandatoryPassRate: round(mandatoryPassed.length / mandatory.length),
    failedCaseIds: negatives
      .filter((testCase) => !byCase.get(testCase.id)?.score.negativePass)
      .map(({ id }) => id),
    mandatoryFailedCaseIds: mandatory
      .filter((testCase) => !byCase.get(testCase.id)?.score.negativePass)
      .map(({ id }) => id),
  };
}

function frozenTextRetention(
  suite: RetrievalGoldenSuite,
  caption: ReturnType<typeof parseBaselineReport>,
  byCase: ReadonlyMap<string, MixedEvaluationCaseV2>,
) {
  if (!caption) return null;
  const baselineHits = suite.cases.filter((testCase) =>
    testCase.mode === "TEXT_TO_TEXT"
    && testCase.expectation === "ANSWERABLE"
    && baselineScoreForCase(testCase, caption)?.primaryMetrics?.recallAt5 === 1);
  const retained = baselineHits.filter(
    (testCase) => byCase.get(testCase.id)?.score.primaryMetrics?.recallAt5 === 1,
  );
  return {
    baselineHitCaseIds: baselineHits.map(({ id }) => id),
    retainedCaseIds: retained.map(({ id }) => id),
    retained: retained.length,
    required: baselineHits.length,
  };
}

export type MixedGateCheckV2 = {
  id: string;
  observed: unknown;
  threshold: string;
  pass: boolean;
};

export type MixedGateEvaluationInputV2 = {
  corpusBundleHash: string;
  runConfig: {
    cachePolicy: EvaluateMixedRetrieverV2Options["cachePolicy"];
    runtimeEvidence: MixedRuntimeEvidenceV2;
  };
  cardinality: {
    attempted: number;
    positives: number;
    negatives: number;
    runtimeModes: Record<string, number>;
  };
  identities: {
    activeIndexBundleHashes: string[];
    providerIndexBundleHashes: string[];
    relationConfigHashes: string[];
    normalizerConfigHashes: string[];
    rrfConfigHashes: string[];
    expected: MixedExpectedIdentityV2;
    byChannel: Record<
      "LEXICAL" | "TEXT_VECTOR" | "VISUAL_VECTOR",
      EvaluatedChannelIdentityV2[]
    >;
  };
  summary: ReturnType<typeof summarizeRetrievalScores>;
  positiveByMode: Record<
    "TEXT_TO_TEXT" | "TEXT_TO_IMAGE" | "IMAGE_TO_IMAGE" | "IMAGE_TEXT_TO_EVIDENCE",
    ReturnType<typeof positiveModeSummary>
  >;
  negative: ReturnType<typeof negativeSummary>;
  frozenTextRetention: ReturnType<typeof frozenTextRetention>;
  comparisons: ReturnType<typeof comparisons>;
  violations: Record<
    "forbidden" | "self" | "queryGroup" | "courseScope" | "owner" | "parent" | "unstable",
    string[]
  >;
  performance: {
    byMode: Record<string, {
      p95Ms: number | null;
      measuredQueryCount: number;
    }>;
    timeoutRate: number;
  };
  cases: MixedEvaluationCaseV2[];
};

function gateCheck(
  id: string,
  observed: unknown,
  threshold: string,
  pass: boolean,
): MixedGateCheckV2 {
  return { id, observed, threshold, pass };
}

export function evaluateMixedRetrievalGatesV2(
  report: MixedGateEvaluationInputV2,
) {
  const checks: MixedGateCheckV2[] = [];
  const add = (
    id: string,
    observed: unknown,
    threshold: string,
    pass: boolean,
  ) => checks.push(gateCheck(id, observed, threshold, pass));
  const overall = report.summary.overall;
  const text = report.summary.byMode.TEXT_TO_TEXT;
  const textToImage = report.positiveByMode.TEXT_TO_IMAGE;
  const imageToImage = report.positiveByMode.IMAGE_TO_IMAGE;
  const evidence = report.positiveByMode.IMAGE_TEXT_TO_EVIDENCE;
  const captionCi = report.comparisons.pairedBootstrap
    .textToImageExactVsCaption?.confidenceInterval95.lower ?? null;
  const t3TextToImageCi = report.comparisons.pairedBootstrap
    .textToImageExactVsT3?.confidenceInterval95.lower ?? null;
  const t3VisualTask = report.comparisons.pairedBootstrap
    .visualTaskCompletionVsT3 ?? null;
  const t3ByMode = report.comparisons.t3ByMode;
  const assetComparison = report.comparisons.assetSingleChannelComparison;

  add(
    "common.suite-cardinality",
    report.cardinality,
    "attempted=51 positives=41 negatives=10",
    report.cardinality.attempted === 51
      && report.cardinality.positives === 41
      && report.cardinality.negatives === 10,
  );
  add(
    "common.primary-cache-miss-verified",
    {
      declared: report.runConfig.cachePolicy,
      runtime: report.runConfig.runtimeEvidence,
    },
    "mode=CACHE_MISS; declared and handshaken runtime visualMaxCacheEntries=0",
    report.runConfig.cachePolicy.mode === "CACHE_MISS"
      && report.runConfig.cachePolicy.visualMaxCacheEntries === 0
      && report.runConfig.runtimeEvidence.source === "LOCAL_MIXED_RUNTIME_V2"
      && report.runConfig.runtimeEvidence.sidecarHandshakeVerified
      && report.runConfig.runtimeEvidence.visualMaxCacheEntries === 0
      && report.runConfig.runtimeEvidence.textProviderIndexBundleHash
        === T4_FROZEN_TEXT_PROVIDER.indexBundleHash
      && report.runConfig.runtimeEvidence.textIndexVersionId
        === T4_FROZEN_TEXT_PROVIDER.indexVersionId
      && report.runConfig.runtimeEvidence.visualProviderIndexBundleHash
        === report.identities.expected.channels.VISUAL_VECTOR.providerIndexBundleHash
      && report.runConfig.runtimeEvidence.visualIndexVersionId
        === report.identities.expected.channels.VISUAL_VECTOR.indexVersionId,
  );
  const frozenText = report.identities.expected.channels.TEXT_VECTOR;
  const frozenVisual = report.identities.expected.channels.VISUAL_VECTOR;
  add(
    "common.frozen-runtime-identity",
    {
      corpusBundleHash: report.corpusBundleHash,
      activeIndexBundleHash: report.identities.expected.activeIndexBundleHash,
      text: frozenText,
      visual: frozenVisual,
    },
    "frozen corpus/control plus exact BGE and SigLIP2 provider/model revisions",
    report.corpusBundleHash === T4_FROZEN_CORPUS_BUNDLE_HASH
      && report.identities.expected.activeIndexBundleHash
        === T4_FROZEN_CONTROL_INDEX_BUNDLE_HASH
      && frozenText.providerIndexBundleHash === T4_FROZEN_TEXT_PROVIDER.indexBundleHash
      && frozenText.indexVersionId === T4_FROZEN_TEXT_PROVIDER.indexVersionId
      && frozenText.modelId === T4_FROZEN_TEXT_PROVIDER.modelId
      && frozenText.modelRevision === T4_FROZEN_TEXT_PROVIDER.modelRevision
      && frozenVisual.providerIndexBundleHash === T4_FROZEN_VISUAL_PROVIDER.indexBundleHash
      && frozenVisual.indexVersionId === T4_FROZEN_VISUAL_PROVIDER.indexVersionId
      && frozenVisual.modelId === T4_FROZEN_VISUAL_PROVIDER.modelId
      && frozenVisual.modelRevision === T4_FROZEN_VISUAL_PROVIDER.modelRevision,
  );
  add(
    "common.four-runtime-modes-covered",
    report.cardinality.runtimeModes,
    "all four runtime modes > 0",
    [
      "TEXT_TO_TEXT",
      "TEXT_TO_IMAGE",
      "IMAGE_TO_IMAGE",
      "IMAGE_TEXT_TO_EVIDENCE",
    ].every((mode) => (report.cardinality.runtimeModes[mode] ?? 0) > 0),
  );
  add(
    "common.no-normal-errors-timeouts-unsupported",
    {
      errors: overall.errors,
      timeouts: overall.timeouts,
      unsupported: overall.unsupported,
    },
    "all = 0",
    overall.errors === 0 && overall.timeouts === 0 && overall.unsupported === 0,
  );
  add(
    "common.identities-single-generation",
    report.identities,
    "active/relation/normalizer/RRF each 1; provider indexes exactly 2",
    report.identities.activeIndexBundleHashes.length === 1
      && report.identities.providerIndexBundleHashes.length === 2
      && report.identities.relationConfigHashes.length === 1
      && report.identities.normalizerConfigHashes.length === 1
      && report.identities.rrfConfigHashes.length === 1,
  );
  for (const channel of ["LEXICAL", "TEXT_VECTOR", "VISUAL_VECTOR"] as const) {
    const observed = report.identities.byChannel[channel];
    const expected = report.identities.expected.channels[channel];
    add(
      `common.identity.${channel.toLowerCase()}`,
      { observed, expected },
      "one identity exactly matching the frozen control/provider manifest",
      observed.length === 1
        && stableJsonV2(observed[0]) === stableJsonV2(expected)
        && observed[0]!.activeIndexBundleHash
          === report.identities.expected.activeIndexBundleHash,
    );
  }
  for (const violation of [
    "forbidden",
    "self",
    "queryGroup",
    "courseScope",
    "owner",
    "parent",
    "unstable",
  ] as const) {
    add(
      `common.${violation}-violations`,
      report.violations[violation],
      "=0",
      report.violations[violation].length === 0,
    );
  }
  add(
    "common.evidence-caps",
    report.cases.map(({ caseId, bundle, audit }) => ({
      caseId,
      primary: bundle.evidence.primary.length,
      nodes: bundle.evidence.nodes.length,
      parents: audit.parentNodeCount,
      siblings: bundle.evidence.nodes.filter(({ relation }) => relation === "SIBLING").length,
      assets: bundle.evidence.assets.length,
      regions: bundle.evidence.regions.length,
      sources: bundle.sources.length,
      bytes: Buffer.byteLength(JSON.stringify(bundle), "utf8"),
    })),
    "primary<=5 nodes<=12 parents<=3 siblings<=6 assets<=5 regions<=5 sources<=5 bytes<=65536",
    report.cases.every(({ bundle }) =>
      bundle.evidence.primary.length <= 5
      && bundle.evidence.nodes.length <= 12
      && bundle.evidence.nodes.filter(({ relation }) => relation === "PARENT").length <= 3
      && bundle.evidence.nodes.filter(({ relation }) => relation === "SIBLING").length <= 6
      && bundle.evidence.assets.length <= 5
      && bundle.evidence.regions.length <= 5
      && bundle.sources.length <= 5
      && Buffer.byteLength(JSON.stringify(bundle), "utf8") <= 64 * 1_024),
  );

  add("text.recall-at-5", text.recallAt5, ">=0.4000", (text.recallAt5 ?? 0) >= 0.4);
  add("text.mrr", text.mrr, ">=0.4000", (text.mrr ?? 0) >= 0.4);
  add("text.ndcg-at-5", text.ndcgAt5, ">=0.4000", (text.ndcgAt5 ?? 0) >= 0.4);
  add(
    "text.precision-at-5",
    text.precisionAt5,
    ">=0.0800",
    (text.precisionAt5 ?? 0) >= 0.08,
  );
  add(
    "text.frozen-top5-retention",
    report.frozenTextRetention,
    "retained=required=2",
    report.frozenTextRetention?.retained === 2
      && report.frozenTextRetention.required === 2,
  );

  add(
    "text-to-image.exact-role-recall-at-5",
    textToImage.exactRoleRecallAt5,
    ">=0.291667",
    (textToImage.exactRoleRecallAt5 ?? 0) >= 0.291667,
  );
  add(
    "text-to-image.group-recall-at-5",
    textToImage.groupRecallAt5,
    ">=0.458333",
    (textToImage.groupRecallAt5 ?? 0) >= 0.458333,
  );
  add(
    "text-to-image.vs-caption-bootstrap-lower",
    captionCi,
    ">0",
    captionCi !== null && captionCi > 0,
  );
  add(
    "text-to-image.vs-t3-noninferiority-lower",
    t3TextToImageCi,
    ">=-0.05",
    t3TextToImageCi !== null && t3TextToImageCi >= -0.05,
  );

  add(
    "image-to-image.group-recall-at-5",
    imageToImage.groupRecallAt5,
    ">=4/6",
    (imageToImage.groupRecallAt5 ?? 0) >= 4 / 6,
  );
  add(
    "image-to-image.group-recall-vs-t3",
    {
      candidate: imageToImage.groupRecallAt5,
      t3: t3ByMode?.IMAGE_TO_IMAGE.groupRecallAt5 ?? null,
    },
    "candidate>=T3",
    t3ByMode !== null
      && (imageToImage.groupRecallAt5 ?? -1)
        >= (t3ByMode.IMAGE_TO_IMAGE.groupRecallAt5 ?? Number.POSITIVE_INFINITY),
  );
  add(
    "image-to-image.mrr-vs-t3",
    {
      candidate: imageToImage.mrr,
      t3: t3ByMode?.IMAGE_TO_IMAGE.mrr ?? null,
    },
    "candidate>=T3-0.05",
    t3ByMode !== null
      && (imageToImage.mrr ?? -1)
        >= (t3ByMode.IMAGE_TO_IMAGE.mrr ?? Number.POSITIVE_INFINITY) - 0.05,
  );

  for (const [id, observed] of [
    ["node-recall-at-5", evidence.nodeRecallAt5],
    ["asset-recall-at-5", evidence.assetRecallAt5],
    ["parent-coverage", evidence.parentCoverage],
    ["combined-evidence-pass", evidence.combinedEvidencePassRate],
  ] as const) {
    add(
      `image-text.${id}`,
      observed,
      ">=5/6",
      (observed ?? 0) >= round(5 / 6),
    );
  }
  add(
    "image-text.owner-consistency",
    evidence.ownerConsistency,
    "=1",
    evidence.ownerConsistency === 1,
  );
  add(
    "image-text.parent-consistency",
    evidence.parentConsistency,
    "=1",
    evidence.parentConsistency === 1,
  );
  add(
    "image-text.parent-precision",
    evidence.parentPrecision,
    ">=0.80",
    (evidence.parentPrecision ?? 0) >= 0.8,
  );
  add(
    "image-text.extra-parent-cap",
    {
      nodes: evidence.maxExtraParentCount,
      locators: evidence.maxExtraParentLocators,
    },
    "both <=1 unmatched returned parent",
    evidence.maxExtraParentCount !== null
      && evidence.maxExtraParentCount <= 1
      && evidence.maxExtraParentLocators !== null
      && evidence.maxExtraParentLocators <= 1,
  );

  add(
    "fusion.asset-regressions",
    assetComparison?.regressions ?? null,
    "<=3",
    assetComparison !== null && assetComparison.regressions <= 3,
  );
  add(
    "fusion.asset-gain-minus-regression",
    assetComparison?.gainMinusRegression ?? null,
    ">=0",
    assetComparison !== null && assetComparison.gainMinusRegression >= 0,
  );
  add(
    "fusion.visual-task-point-difference",
    t3VisualTask?.meanDifference ?? null,
    ">=0",
    t3VisualTask !== null && t3VisualTask.meanDifference >= 0,
  );
  add(
    "fusion.visual-task-noninferiority-lower",
    t3VisualTask?.confidenceInterval95.lower ?? null,
    ">=-0.05",
    t3VisualTask !== null && t3VisualTask.confidenceInterval95.lower >= -0.05,
  );

  add(
    "negative.pass",
    { passed: report.negative.passed, caseCount: report.negative.caseCount },
    ">=8/10",
    report.negative.caseCount === 10 && report.negative.passed >= 8,
  );
  add(
    "negative.mandatory",
    {
      passed: report.negative.mandatoryPassed,
      caseCount: report.negative.mandatoryCaseCount,
    },
    "=6/6",
    report.negative.mandatoryCaseCount === 6
      && report.negative.mandatoryPassed === 6,
  );

  const textP95 = report.performance.byMode.TEXT_TO_TEXT?.p95Ms ?? null;
  add(
    "performance.text-total-p95",
    textP95,
    "<=250ms",
    textP95 !== null && textP95 <= 250,
  );
  for (const mode of ["TEXT_TO_IMAGE", "IMAGE_TO_IMAGE"] as const) {
    const candidate = report.performance.byMode[mode]?.p95Ms ?? null;
    const baseline = t3ByMode?.[mode].latencyP95Ms ?? null;
    const derivedLimit = baseline === null ? null : baseline * 1.25 + 250;
    add(
      `performance.${mode.toLowerCase()}.p95`,
      { candidate, t3: baseline, derivedLimit },
      "<=T3*1.25+250ms and <=10000ms",
      candidate !== null
        && derivedLimit !== null
        && candidate <= derivedLimit
        && candidate <= 10_000,
    );
  }
  const evidenceP95 = report.performance.byMode.IMAGE_TEXT_TO_EVIDENCE?.p95Ms ?? null;
  const t3EvidenceP95 = t3ByMode?.IMAGE_TEXT_TO_EVIDENCE.latencyP95Ms ?? null;
  const evidenceLimit = t3EvidenceP95 === null ? null : t3EvidenceP95 * 1.5 + 500;
  add(
    "performance.image-text.p95",
    { candidate: evidenceP95, t3: t3EvidenceP95, derivedLimit: evidenceLimit },
    "<=T3*1.5+500ms and <=12000ms",
    evidenceP95 !== null
      && evidenceLimit !== null
      && evidenceP95 <= evidenceLimit
      && evidenceP95 <= 12_000,
  );
  add(
    "performance.timeout-rate",
    report.performance.timeoutRate,
    "=0",
    report.performance.timeoutRate === 0,
  );

  return {
    gateVersion: T4_MIXED_GATE_VERSION,
    overallPass: checks.every(({ pass }) => pass),
    passed: checks.filter(({ pass }) => pass).length,
    failed: checks.filter(({ pass }) => !pass).length,
    checks,
  };
}

export function summarizeMixedPerformanceByModeV2(
  cases: readonly Pick<MixedEvaluationCaseV2, "runtimeQuery" | "measuredLatenciesMs">[],
) {
  return Object.fromEntries(
    (["TEXT_TO_TEXT", "TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_TEXT_TO_EVIDENCE"] as const)
      .map((mode) => {
        const modeLatencies = cases
          .filter(({ runtimeQuery }) => runtimeQuery.mode === mode)
          .flatMap(({ measuredLatenciesMs }) => measuredLatenciesMs);
        return [
          mode,
          {
            p95Ms: nearestRankPercentile(modeLatencies, 0.95),
            measuredQueryCount: modeLatencies.length,
          },
        ];
      }),
  );
}

export async function evaluateMixedRetrieverV2(
  options: EvaluateMixedRetrieverV2Options,
) {
  const suite = assertMixedSuiteContractV2(options.suiteBytes);
  const corpus = verifyKnowledgeCorpusBundleV2(options.corpus);
  const bindings = buildMixedEvaluationBindingsV2(corpus);
  const caption = parseBaselineReport(options.captionBaseline, "CAPTION_BASELINE", suite);
  const t3 = parseBaselineReport(options.t3Baseline, "T3_BASELINE", suite);
  const cachePolicy = options.cachePolicy;
  const runtimeEvidence = MixedRuntimeEvidenceV2Schema.parse(options.runtimeEvidence);
  if (
    (
      cachePolicy.mode === "CACHE_MISS"
      && cachePolicy.visualMaxCacheEntries !== 0
    )
    || (
      cachePolicy.mode === "CACHE_HIT"
      && (
        !Number.isInteger(cachePolicy.visualMaxCacheEntries)
        || cachePolicy.visualMaxCacheEntries < 1
      )
    )
  ) {
    throw new Error("MIXED_EVALUATION_CACHE_POLICY_INVALID");
  }
  if (cachePolicy.visualMaxCacheEntries !== runtimeEvidence.visualMaxCacheEntries) {
    throw new Error("MIXED_EVALUATION_CACHE_RUNTIME_MISMATCH");
  }
  const now = options.now ?? performance.now.bind(performance);
  const warmups = z.number().int().min(1).max(10).parse(
    options.warmups ?? T4_MIXED_WARMUPS,
  );
  const repetitions = z.number().int().min(T4_MIXED_REPETITIONS).max(20).parse(
    options.repetitions ?? T4_MIXED_REPETITIONS,
  );
  const cases: MixedEvaluationCaseV2[] = [];
  for (const testCase of suite.cases) {
    const runtimeQuery = createMixedEvaluationQueryV2(testCase, bindings);
    const allowlist = assertMixedRuntimeQueryAllowlistV2(runtimeQuery);
    const isolationFingerprint = assertMixedGoldenMetadataIsolationV2(testCase, bindings);
    if (allowlist.fingerprint !== isolationFingerprint) {
      throw new Error(`MIXED_EVALUATION_ISOLATION_FINGERPRINT_DRIFT:${testCase.id}`);
    }
    for (let repetition = 0; repetition < warmups; repetition += 1) {
      const warmup = EvidenceBundleV2Schema.parse(await options.retrieve(runtimeQuery, {
        phase: "WARMUP",
        repetition,
      }));
      if (runtimeQueryFingerprint(warmup.query) !== allowlist.fingerprint) {
        throw new Error(`MIXED_EVALUATION_WARMUP_QUERY_DRIFT:${testCase.id}`);
      }
    }
    const measured: EvidenceBundleV2[] = [];
    const measuredLatenciesMs: number[] = [];
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const measuredCall = await measureMixedRetrievalCallV2(
        () => options.retrieve(runtimeQuery, {
          phase: "MEASURED",
          repetition,
        }),
        now,
      );
      const bundle = EvidenceBundleV2Schema.parse(measuredCall.value);
      if (runtimeQueryFingerprint(bundle.query) !== allowlist.fingerprint) {
        throw new Error(`MIXED_EVALUATION_MEASURED_QUERY_DRIFT:${testCase.id}`);
      }
      measured.push(bundle);
      measuredLatenciesMs.push(measuredCall.wallClockMs);
    }
    const first = measured[0]!;
    const scored = scoreMixedEvidenceCaseV2(testCase, first, bindings);
    const result = RetrievalEvaluationResultSchema.parse({
      ...scored.result,
      latencyMs: measuredLatenciesMs[0]!,
    });
    const score = scoreRetrievalCase(testCase, result);
    const fingerprints = unique(measured.map(resultFingerprint));
    cases.push({
      caseId: testCase.id,
      runtimeQuery,
      bundle: first,
      result,
      score,
      audit: scored.audit,
      measuredLatenciesMs,
      providerReportedLatenciesMs: measured.map(({ timing }) => timing.totalMs),
      latencyP50Ms: nearestRankPercentile(measuredLatenciesMs, 0.5)!,
      latencyP95Ms: nearestRankPercentile(measuredLatenciesMs, 0.95)!,
      stableAcrossMeasuredRuns: fingerprints.length === 1,
    });
  }
  const byCase = new Map(cases.map((item) => [item.caseId, item]));
  const scores = cases.map(({ score }) => score);
  const commonViolations = {
    forbidden: cases.filter(({ audit }) => audit.forbiddenHit).map(({ caseId }) => caseId),
    self: cases.filter(({ audit }) => audit.selfAssetViolations.length > 0)
      .map(({ caseId }) => caseId),
    queryGroup: cases.filter(({ audit }) => audit.queryGroupViolations.length > 0)
      .map(({ caseId }) => caseId),
    courseScope: cases.filter(({ audit }) => audit.courseScopeViolations.length > 0)
      .map(({ caseId }) => caseId),
    owner: cases.filter(({ audit }) => audit.ownerViolations.length > 0)
      .map(({ caseId }) => caseId),
    parent: cases.filter(({ audit }) => audit.parentViolations.length > 0)
      .map(({ caseId }) => caseId),
    unstable: cases.filter(({ stableAcrossMeasuredRuns }) => !stableAcrossMeasuredRuns)
      .map(({ caseId }) => caseId),
  };
  const positiveByMode = {
    TEXT_TO_TEXT: positiveModeSummary("TEXT_TO_TEXT", suite, byCase),
    TEXT_TO_IMAGE: positiveModeSummary("TEXT_TO_IMAGE", suite, byCase),
    IMAGE_TO_IMAGE: positiveModeSummary("IMAGE_TO_IMAGE", suite, byCase),
    IMAGE_TEXT_TO_EVIDENCE: positiveModeSummary(
      "IMAGE_TEXT_TO_EVIDENCE",
      suite,
      byCase,
    ),
  };
  const identitiesByChannel = Object.fromEntries(
    (["LEXICAL", "TEXT_VECTOR", "VISUAL_VECTOR"] as const).map((channel) => {
      const uniqueIdentities = new Map<string, EvaluatedChannelIdentityV2>();
      for (const { bundle } of cases) {
        const identity = bundle.channels.find((item) => item.channel === channel)?.identity;
        if (identity) uniqueIdentities.set(stableJsonV2(identity), identity);
      }
      return [channel, [...uniqueIdentities.values()]];
    }),
  ) as Record<
    "LEXICAL" | "TEXT_VECTOR" | "VISUAL_VECTOR",
    EvaluatedChannelIdentityV2[]
  >;
  const report = {
    schemaVersion: 2 as const,
    generatedAt: new Date().toISOString(),
    evaluator: "SELF_HOSTED_MIXED_RETRIEVAL_V2" as const,
    gateVersion: T4_MIXED_GATE_VERSION,
    suiteVersion: suite.suiteVersion,
    suiteHash: T4_MIXED_SUITE_SHA256,
    corpusBundleHash: corpus.bundleHash,
    runConfig: {
      warmups,
      repetitions,
      warmupsExcludedFromPerformance: true,
      cachePolicy,
      runtimeEvidence: structuredClone(runtimeEvidence),
      bootstrapIterations: T4_MIXED_BOOTSTRAP_ITERATIONS,
      bootstrapSeed: T4_MIXED_BOOTSTRAP_SEED,
    },
    sources: {
      corpus: "data/knowledge-v2/knowledge-corpus.v2.json",
      suite: "tests/retrieval-quality/golden-suite.json",
      serviceDatabase: "NOT_USED",
      projectDatabase: "NOT_USED",
      groundTruthSentToRetriever: false,
      expectedSourceCoursePackSentToRetriever: false,
      expectedLegacyPlacementSentToRetriever: false,
    },
    identities: {
      activeIndexBundleHashes: unique(cases.map(({ bundle }) =>
        bundle.provenance.activeIndexBundleHash)),
      providerIndexBundleHashes: unique(cases.flatMap(({ bundle }) =>
        bundle.channels.flatMap(({ identity }) =>
          identity?.providerIndexBundleHash
            ? [identity.providerIndexBundleHash]
            : []))),
      relationConfigHashes: unique(cases.map(({ bundle }) =>
        bundle.provenance.relationConfigHash)),
      normalizerConfigHashes: unique(cases.map(({ bundle }) =>
        bundle.provenance.normalizerConfigHash)),
      rrfConfigHashes: unique(cases.map(({ bundle }) =>
        bundle.provenance.rrfConfigHash)),
      expected: structuredClone(options.expectedIdentity),
      byChannel: identitiesByChannel,
    },
    cardinality: {
      attempted: cases.length,
      positives: suite.cases.filter(({ expectation }) => expectation === "ANSWERABLE").length,
      negatives: suite.cases.filter(({ expectation }) => expectation === "NO_ANSWER").length,
      runtimeModes: Object.fromEntries(
        ["TEXT_TO_TEXT", "TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_TEXT_TO_EVIDENCE"]
          .map((mode) => [
            mode,
            cases.filter(({ runtimeQuery }) => runtimeQuery.mode === mode).length,
          ]),
      ),
    },
    results: cases.map(({ result }) => result),
    scores,
    cases,
    summary: summarizeRetrievalScores(scores),
    positiveByMode,
    negative: negativeSummary(suite, byCase),
    frozenTextRetention: frozenTextRetention(suite, caption, byCase),
    comparisons: comparisons(suite, cases, caption, t3),
    violations: commonViolations,
    performance: {
      byMode: summarizeMixedPerformanceByModeV2(cases),
      timeoutRate: round(
        scores.filter(({ status }) => status === "TIMEOUT").length / scores.length,
      ),
    },
  };
  return {
    ...report,
    gateEvaluation: evaluateMixedRetrievalGatesV2(report),
  };
}

const FrozenSnapshotV2Schema = z
  .object({
    commit: z.literal("b3ca5bedd4a7033fb9dad60e8619e032810ba929"),
    knowledgeTree: z.literal("7bfbde8af4d66b430141954a72fa1a05ffc22a41"),
    coursesTree: z.literal("e32d7b3a5c29e8256bb142b0e43c92ae51f4df98"),
    runtimeKnowledgeCount: z.literal(116),
    generatedKnowledgeCount: z.literal(82),
    baselineKnowledgeCount: z.literal(34),
    knowledgeCorpusSha256: z.literal(
      "53c8f012297550b93871234b92e0670cba114f66be9918f691de2048e003aef1",
    ),
    sourceDocumentCount: z.literal(82),
    sourceCorpusSha256: z.literal(
      "5ec10c20f9e6f00ad791d1e649050b30f35536627d51fbcf35489da7accb628c",
    ),
    assetCount: z.literal(156),
    assetTotalBytes: z.literal(82_049_135),
    assetManifestSha256: z.literal(
      "b79b8b067a995ed6914be748e94525fd9ad2b8806d308062c7dd7ab2a35b764f",
    ),
  })
  .strict();

export function readMixedBaselineReportV2(
  input: unknown,
  kind: "CAPTION" | "T3",
): MixedBaselineReportV2 {
  const report = z
    .object({
      suiteVersion: z.string(),
      suiteHash: z.string(),
      results: z.array(RetrievalEvaluationResultSchema),
    })
    .passthrough()
    .parse(input);
  if (kind === "CAPTION") {
    z.object({
      baseline: z.literal("LEXICAL_CAPTION"),
      snapshot: FrozenSnapshotV2Schema,
      captionIndex: z.object({
        assetCount: z.literal(156),
        mappingCounts: z.object({
          DOCUMENT_FALLBACK: z.literal(6),
          ROLE_ALIAS: z.literal(150),
        }).strict(),
        digest: z.literal(
          "1c8d8a89ccea59a332c462a044d8f3eabb9a496a99a48aa333c172c778aa169d",
        ),
      }).strict(),
    }).passthrough().parse(input);
  } else {
    z.object({
      evaluator: z.literal("SELF_HOSTED_VISUAL_POC"),
      snapshot: FrozenSnapshotV2Schema,
      visualIndex: z.object({
        corpusBundleHash: z.literal(T4_FROZEN_CORPUS_BUNDLE_HASH),
        indexBundleHash: z.literal(T3_FROZEN_VISUAL_PROVIDER.indexBundleHash),
        indexVersionId: z.literal(T3_FROZEN_VISUAL_PROVIDER.indexVersionId),
        modelId: z.literal(T3_FROZEN_VISUAL_PROVIDER.modelId),
        modelRevision: z.literal(T3_FROZEN_VISUAL_PROVIDER.modelRevision),
      }).strict(),
    }).passthrough().parse(input);
  }
  const scores = report.results.map((result) => {
    // The suite is deliberately not accepted here: callers must bind cases separately.
    const supplied = (input as { scores?: unknown }).scores;
    if (!Array.isArray(supplied)) {
      throw new Error("MIXED_EVALUATION_BASELINE_SCORES_MISSING");
    }
    return supplied.find((score) =>
      typeof score === "object"
      && score !== null
      && (score as { caseId?: unknown }).caseId === result.caseId) as ScoredRetrievalCase;
  });
  if (scores.some((score) => !score)) {
    throw new Error("MIXED_EVALUATION_BASELINE_SCORE_MISSING");
  }
  return {
    suiteVersion: report.suiteVersion,
    suiteHash: report.suiteHash,
    results: report.results,
    scores,
  };
}

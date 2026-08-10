import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { createFrozenCaptionLexicalFallbackProviderV2 } from "../../scripts/evaluate-retrieval-quality";
import type {
  ActiveKnowledgeGenerationV2,
} from "./active-knowledge-generation-v2";
import { PACK_COMPETITION_POLICY_V2 } from "./capability-boundary-v2";
import {
  createAuditedCapabilityEntityManifestV2,
  createT41PackCompetitionCalibrationV2,
} from "./capability-entity-registry-v2";
import {
  createDirectEvidenceChannelProbeV1,
  type DirectEvidenceBatchResultV1,
  type DirectEvidenceProbeContextV1,
  type DirectEvidenceProbeResultV1,
} from "./direct-evidence-channel-probe-v1";
import {
  CORPUS_EVIDENCE_RELATION_CONFIG_V2,
  createCorpusEvidenceGraphExpanderV2,
} from "./corpus-evidence-expander-v2";
import type { EvidenceBundleV2 } from "./evidence-bundle-v2";
import {
  ChannelRetrievalResultV2Schema,
  createHybridRetrieverV2,
  evaluateExternalVerificationWithPrerequisiteShadowV3,
  HYBRID_RRF_CONFIG_V2,
  type EvidenceGraphExpanderV2,
  type RetrievalChannelProviderV2,
} from "./hybrid-retriever-v2";
import { verifyKnowledgeIndexPayloadsV2 } from "./knowledge-index-v2";
import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  verifyKnowledgeIndexBundleV2,
  type KnowledgeObjectV2,
} from "./knowledge-object-v2";
import {
  LEXICAL_PACK_COMPETITION_ALGORITHM_V2,
  retrieveLexicalCandidatesV2,
  retrieveLexicalObjectCandidatesV2,
  retrieveLexicalPackCompetitionV2,
} from "./lexical-retriever-v2";
import {
  TEXT_OBJECT_CONSENSUS_CONFIG_HASH_V2,
} from "./object-candidate-v2";
import {
  createQueryEvidenceAdequacyRuntimeV2,
  type QueryEvidenceAdequacyIdentityV2,
} from "./query-evidence-adequacy-v2";
import {
  T4_FROZEN_CONTROL_INDEX_BUNDLE_HASH,
  T4_FROZEN_CORPUS_BUNDLE_HASH,
  T4_FROZEN_TEXT_PROVIDER,
  T4_FROZEN_VISUAL_PROVIDER,
  assertMixedRuntimeQueryAllowlistV2,
  type MixedExpectedIdentityV2,
  type MixedRuntimeEvidenceV2,
} from "./mixed-retrieval-evaluation-v2";
import { VisualIndexManifestSchema } from "./knowledge-index-packager-v2";
import {
  CANDIDATE_PROJECTION_BY_MODE_V2,
  candidateProjectionForModeV2,
  createAcceptancePolicyV2,
  RRF_CHANNEL_LIMIT_V2,
} from "./rank-fusion-v2";
import {
  createRetrievalCircuitBreakerV2,
  RetrievalCircuitSnapshotV2Schema,
  type RetrievalCircuitBreakerV2,
  type RetrievalCircuitBreakerConfigV2,
  type RetrievalCircuitFailureV2,
} from "./retrieval-circuit-breaker-v2";
import {
  adaptLexicalCandidatesV2,
  adaptTextRetrievalResponseV2,
  adaptVisualRetrievalResponseV2,
  type ChannelAdapterIdentityV2,
  type VisualAssetOwnerV2,
} from "./retrieval-channel-adapters-v2";
import type { RetrievalQueryV2 } from "./retrieval-query-v2";
import type { CompiledDirectQueryV1 } from "./retrieval-plan-v1";
import { startTextSidecar, type TextSidecarHandle } from "./text-retriever-client";
import {
  TEXT_PACK_COMPETITION_ALGORITHM_V2,
  TextIndexIdentitySchema,
} from "./text-retriever";
import {
  createTextObjectChannelProbeV3,
  type TextObjectChannelProbeContextV3,
  type TextObjectChannelProbeResultV3,
} from "./text-object-channel-probe-v3";
import {
  createTextRuntimeEnvironmentSealV2,
  type TextRuntimeEnvironmentSealV2,
} from "./runtime-environment-seal-v2";
import {
  VisualRetrieverCapabilitiesSchema,
  type VisualRetrieverQuery,
} from "./visual-retriever";
import {
  startVisualSidecar,
  type VisualSidecarHandle,
} from "./visual-retriever-client";

const HASH = /^[0-9a-f]{64}$/;
const HashSchema = z.string().regex(HASH);

const TextManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: TextIndexIdentitySchema,
    model: z
      .object({
        directorySha256: HashSchema,
      })
      .passthrough(),
    configHash: HashSchema,
    entries: z.array(z
      .object({
        representationId: z.string(),
        nodeId: z.string(),
        objectId: z.string(),
        coursePackId: z.string(),
      })
      .passthrough()).min(1),
    payload: z
      .object({
        fileName: z.literal("embeddings.safetensors"),
        sha256: HashSchema,
      })
      .passthrough(),
  })
  .passthrough();

const ConfigsByVersionSchema = z.record(z.string(), z.unknown());

export const MixedRuntimeFaultV2Schema = z.enum([
  "NONE",
  "TEXT_TIMEOUT",
  "TEXT_UNAVAILABLE",
  "TEXT_CORRUPT",
  "VISUAL_TIMEOUT",
  "VISUAL_UNAVAILABLE",
  "VISUAL_EMPTY",
  "VISUAL_CORRUPT",
  "VISUAL_PROCESS_EXIT",
  "RELATION_ERROR",
]);

export type MixedRuntimeFaultV2 = z.infer<typeof MixedRuntimeFaultV2Schema>;

export type LocalMixedRuntimeV2Options = {
  workspaceRoot: string;
  pythonExecutable: string;
  textModelDir: string;
  textModelSeal: string;
  textIndexDir: string;
  visualModelDir: string;
  visualModelSeal: string;
  visualIndexDir: string;
  visualOffloadDir: string;
  controlDir: string;
  assetManifestPath: string;
  device: "cuda" | "cpu";
  gpuMemoryGiB: number;
  timeoutMs: number;
  visualMaxCacheEntries: number;
  textObjectConsensusEnabled?: boolean;
  queryEvidenceAdequacyEnabled?: boolean;
  queryPrerequisiteStaticBypassEnabled?: boolean;
  textObjectChannelProbeEnabled?: boolean;
  directEvidenceChannelProbeEnabled?: boolean;
  activeGeneration?:
    ActiveKnowledgeGenerationV2;
  visualRetrievalEnabled?: boolean;
  circuitBreaker?: Partial<RetrievalCircuitBreakerConfigV2>;
};

type ProviderSpyEntryV2 = {
  channel: "LEXICAL" | "TEXT_VECTOR" | "VISUAL_VECTOR" | "CAPTION_LEXICAL";
  queryFingerprint: string;
  keys: string[];
  mode: RetrievalQueryV2["mode"];
  coursePackId: string | null;
};

export type LocalMixedRuntimeV2 = {
  expectedIdentity: MixedExpectedIdentityV2;
  t41CandidateIdentity: {
    runtimeKind: "EVIDENCE_BUNDLE_V2";
    bundleSchemaVersion: 2;
    corpusBundleHash: string;
    activeIndexBundleHash: string;
    relationConfigHash: string;
    normalizerConfigHash: string;
    rrfConfigHash: string;
    capabilityEntityManifestHash: string;
    packCompetitionPolicyHash: string;
    packCompetitionCalibrationHash: string;
    lexicalPackCompetitionAlgorithmHash: string;
    textPackCompetitionAlgorithmHash: string;
    acceptancePolicyHash: string;
    channels: Array<{
      channel: "LEXICAL" | "TEXT_VECTOR" | "VISUAL_VECTOR";
      identity: MixedExpectedIdentityV2["channels"][
        "LEXICAL" | "TEXT_VECTOR" | "VISUAL_VECTOR"
      ];
    }>;
  };
  provenance: {
    activeIndexBundleHash: string;
    relationConfigHash: string;
    normalizerConfigHash: string;
    rrfConfigHash: string;
  };
  runtimeEnvironment: TextRuntimeEnvironmentSealV2;
  t43AdequacyIdentity(): {
    queryEvidenceAdequacyEnabled: boolean;
    queryEvidenceAdequacyIdentity:
      | QueryEvidenceAdequacyIdentityV2
      | null;
  };
  retrieve(
    query: RetrievalQueryV2,
    fault?: MixedRuntimeFaultV2,
  ): Promise<EvidenceBundleV2>;
  probeTextObjectChannels(
    query: RetrievalQueryV2,
    context?: TextObjectChannelProbeContextV3,
  ): Promise<TextObjectChannelProbeResultV3>;
  probeDirectEvidenceChannels(
    query: CompiledDirectQueryV1,
    context: DirectEvidenceProbeContextV1,
  ): Promise<DirectEvidenceProbeResultV1>;
  probeDirectEvidenceBatch(
    queries: readonly CompiledDirectQueryV1[],
    context: DirectEvidenceProbeContextV1,
  ): Promise<DirectEvidenceBatchResultV1>;
  providerSpy(): {
    entryCount: number;
    entries: ProviderSpyEntryV2[];
  };
  runtimeEvidence(): MixedRuntimeEvidenceV2;
  faultDiagnostics(): MixedRuntimeFaultDiagnosticV2[];
  prerequisiteShadowAudit(): {
    enabled: boolean;
    entryCount: number;
    entries: Array<{
      queryHash: string;
      decision: string;
      legacyRequired: boolean;
      legacyAuthorized: boolean;
      staticBypassApplied: boolean;
    }>;
  };
  resourceReport(): RetrievalRuntimeResourceReportV2;
  dispose(): Promise<void>;
};

export const RetrievalRuntimeResourceReportV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    generationHash: HashSchema,
    startup: z
      .object({
        completed: z.literal(true),
        durationMs: z.number().finite().nonnegative(),
      })
      .strict(),
    channels: z
      .object({
        TEXT_VECTOR: RetrievalCircuitSnapshotV2Schema,
        VISUAL_VECTOR: RetrievalCircuitSnapshotV2Schema.nullable(),
      })
      .strict(),
    sidecars: z
      .object({
        text: z
          .object({
            processRunning: z.boolean(),
            pendingRequests: z.number().int().nonnegative(),
          })
          .strict(),
        visual: z
          .object({
            processRunning: z.boolean(),
            pendingRequests: z.number().int().nonnegative(),
            active: z.number().int().nonnegative(),
            queueDepth: z.number().int().nonnegative(),
            maxQueue: z.number().int().nonnegative(),
            cacheEntries: z.number().int().nonnegative(),
            maxCacheEntries: z.number().int().nonnegative(),
            cacheHits: z.number().int().nonnegative(),
            cacheMisses: z.number().int().nonnegative(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    limits: z
      .object({
        queryTimeoutMs: z.number().int().positive(),
        visualMaxCacheEntries: z.number().int().nonnegative(),
      })
      .strict(),
    disposed: z.boolean(),
  })
  .strict();

export type RetrievalRuntimeResourceReportV2 = z.infer<
  typeof RetrievalRuntimeResourceReportV2Schema
>;

export type MixedRuntimeFaultDiagnosticV2 = {
  fault: MixedRuntimeFaultV2;
  mechanism:
    | "NONE"
    | "SYNTHETIC_PROVIDER_STATUS"
    | "MALFORMED_PROVIDER_PAYLOAD"
    | "HEALTHY_EMPTY_RESPONSE"
    | "REAL_DEADLINE_AND_RESTART"
    | "REAL_PROCESS_EXIT_AND_RESTART"
    | "REAL_EXPANDER_EXCEPTION";
  injectionCount: number;
  processExitObserved: boolean | null;
  deadlineObserved: boolean | null;
  recoveryProbePassed: boolean | null;
  lateResultPollutionChecked: boolean | null;
  note: string;
};

const LEXICAL_CONFIG = Object.freeze({
  id: "lumi-lexical-object-ranker-v2",
  version: "1.1.0",
  candidateLimit: RRF_CHANNEL_LIMIT_V2,
  sourceScope: "SOURCE_COURSE_PACK",
  objectProjection: "BEST_MATCHING_NODE",
  candidateProjectionByMode: CANDIDATE_PROJECTION_BY_MODE_V2,
});

const FROZEN_LEXICAL_FALLBACK_CONFIG = Object.freeze({
  id: "lumi-frozen-t0-lexical-fallback-v2",
  version: "1.0.0",
  minimumScore: 12,
  candidateLimit: 5,
  sourceScope: "SOURCE_COURSE_PACK",
  objectProjection: "BEST_MATCHING_NODE",
  candidateProjectionByMode: CANDIDATE_PROJECTION_BY_MODE_V2,
  parityTarget: "T0_LEXICAL_2026-07-28.4",
});

const NORMALIZER_CONFIG = Object.freeze({
  id: "lumi-retrieval-query-normalizer-v2",
  version: "1.0.0",
  unicode: "NFKC",
  whitespace: "TRIM_COLLAPSE",
  locale: "zh-CN",
  originalTextPreserved: true,
});

export function retrieveFrozenT0LexicalCandidatesV2(
  query: RetrievalQueryV2,
  objects: readonly KnowledgeObjectV2[],
) {
  return retrieveLexicalCandidatesV2(query, objects, {
    minScore: FROZEN_LEXICAL_FALLBACK_CONFIG.minimumScore,
    maxCandidates: FROZEN_LEXICAL_FALLBACK_CONFIG.candidateLimit,
  });
}

function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createPackCompetitionAlgorithmHashesV2(input: {
  packCompetitionCoreSource: Uint8Array;
  lexicalPackCompetitionSource: Uint8Array;
  lexicalScoringSource: Uint8Array;
  textPackCompetitionSource: Uint8Array;
}) {
  const packCompetitionCoreSourceHash =
    sha256Bytes(input.packCompetitionCoreSource);
  return {
    lexicalPackCompetitionAlgorithmHash:
      sha256StableJsonV2({
        config: LEXICAL_PACK_COMPETITION_ALGORITHM_V2,
        sourceHashes: [
          packCompetitionCoreSourceHash,
          sha256Bytes(input.lexicalPackCompetitionSource),
          sha256Bytes(input.lexicalScoringSource),
        ],
      }),
    textPackCompetitionAlgorithmHash:
      sha256StableJsonV2({
        config: TEXT_PACK_COMPETITION_ALGORITHM_V2,
        sourceHashes: [
          packCompetitionCoreSourceHash,
          sha256Bytes(input.textPackCompetitionSource),
        ],
      }),
  };
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function providerPayloads(
  indexBundle: ReturnType<typeof verifyKnowledgeIndexBundleV2>,
  providerHash: string,
) {
  const sharedPayloads = indexBundle.sharedPayloads ?? [];
  const manifest = sharedPayloads.find(
    (payload) =>
      payload.role === "PROVIDER_MANIFEST"
      && payload.providerIndexHash === providerHash,
  );
  if (!manifest) throw new Error(`MIXED_RUNTIME_PROVIDER_MANIFEST_MISSING:${providerHash}`);
  const versions = new Set(
    indexBundle.representations
      .filter(({ locator }) => locator?.manifestPayloadId === manifest.id)
      .map(({ indexVersion }) => indexVersion.id),
  );
  if (versions.size !== 1) {
    throw new Error(`MIXED_RUNTIME_PROVIDER_VERSION_AMBIGUOUS:${providerHash}`);
  }
  const versionId = [...versions][0]!;
  const representations = indexBundle.representations.filter(
    ({ indexVersion }) => indexVersion.id === versionId,
  );
  const tensorPayloadIds = new Set(
    representations.flatMap(({ locator }) =>
      locator ? [locator.tensorPayloadId] : []),
  );
  if (tensorPayloadIds.size !== 1) {
    throw new Error(`MIXED_RUNTIME_PROVIDER_TENSOR_AMBIGUOUS:${providerHash}`);
  }
  const tensor = sharedPayloads.find(
    ({ id }) => id === [...tensorPayloadIds][0],
  );
  if (!tensor || tensor.role !== "VECTOR_TENSORS") {
    throw new Error(`MIXED_RUNTIME_PROVIDER_TENSOR_MISSING:${providerHash}`);
  }
  const indexVersion = representations[0]!.indexVersion;
  if (representations.some((representation) =>
    representation.indexVersion.configHash !== indexVersion.configHash
    || representation.indexVersion.modelId !== indexVersion.modelId
    || representation.indexVersion.modelRevision !== indexVersion.modelRevision)) {
    throw new Error(`MIXED_RUNTIME_PROVIDER_VERSION_DRIFT:${providerHash}`);
  }
  return {
    manifest,
    tensor,
    indexVersion,
    payloadHashes: [manifest.sha256, tensor.sha256],
  };
}

function capabilitiesFromVisualManifest(capabilities: readonly string[]) {
  const supports = (name: string) =>
    capabilities.includes(name)
    || capabilities.includes(`${name}_EXPERIMENTAL`);
  return VisualRetrieverCapabilitiesSchema.parse({
    textToImage: supports("TEXT_TO_IMAGE"),
    imageToImage: supports("IMAGE_TO_IMAGE"),
    imageTextToImage: supports("IMAGE_TEXT_TO_IMAGE"),
    normalizedRegions: supports("NORMALIZED_REGIONS"),
  });
}

async function queryImageResolver(
  workspaceRoot: string,
  corpus: ReturnType<typeof verifyKnowledgeCorpusBundleV2>,
) {
  const courseRoot = path.join(workspaceRoot, "data", "courses");
  const realCourseRoot = await realpath(courseRoot);
  const assets = new Map(corpus.assets.map((asset) => [asset.id, asset]));
  return async (assetId: string) => {
    const asset = assets.get(assetId);
    if (!asset) throw new Error(`MIXED_RUNTIME_QUERY_ASSET_UNKNOWN:${assetId}`);
    const candidate = path.resolve(courseRoot, asset.locator.path);
    const realCandidate = await realpath(candidate);
    const relative = path.relative(realCourseRoot, realCandidate);
    if (
      relative === ".."
      || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)
    ) {
      throw new Error("MIXED_RUNTIME_QUERY_ASSET_ESCAPE");
    }
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size !== asset.sizeBytes) {
      throw new Error(`MIXED_RUNTIME_QUERY_ASSET_DRIFT:${assetId}`);
    }
    const pngBytes = await readFile(candidate);
    const digest = sha256Bytes(pngBytes);
    if (digest !== asset.sha256) {
      throw new Error(`MIXED_RUNTIME_QUERY_ASSET_HASH_DRIFT:${assetId}`);
    }
    return { sha256: digest, pngBytes };
  };
}

function visualQuery(query: RetrievalQueryV2): VisualRetrieverQuery {
  const coursePackId = query.scope.sourceCoursePack?.id ?? null;
  if (query.mode === "TEXT_TO_IMAGE") {
    return {
      mode: "TEXT_TO_IMAGE",
      coursePackId,
      text: query.originalText!,
    };
  }
  if (query.mode === "IMAGE_TO_IMAGE") {
    return {
      mode: "IMAGE_TO_IMAGE",
      coursePackId,
      queryAssetId: query.queryAsset!.assetId,
      excludeAssetIds: query.excludeAssetIds,
    };
  }
  if (query.mode === "IMAGE_TEXT_TO_EVIDENCE") {
    return {
      mode: "IMAGE_TEXT_TO_IMAGE",
      coursePackId,
      text: query.originalText!,
      queryAssetId: query.queryAsset!.assetId,
      excludeAssetIds: query.excludeAssetIds,
    };
  }
  throw new Error("MIXED_RUNTIME_VISUAL_MODE_NOT_APPLICABLE");
}

function failedChannel(
  channel: "TEXT_VECTOR" | "VISUAL_VECTOR",
  corpusBundleHash: string,
  status: "UNAVAILABLE" | "TIMEOUT" | "ERROR",
  reason: string,
) {
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel,
      status,
      reason,
      corpusBundleHash,
      identity: null,
      hitCount: 0,
      timingMs: 0,
    },
    hits: [],
  });
}

function circuitFailureFor(
  result: z.infer<typeof ChannelRetrievalResultV2Schema>,
): RetrievalCircuitFailureV2 {
  if (result.summary.status === "TIMEOUT") return "TIMEOUT";
  if (result.summary.reason === "QUEUE_FULL") return "QUEUE_FULL";
  if (result.summary.reason === "PROCESS_EXIT") return "CRASH";
  if (
    result.summary.status === "ERROR"
    && result.summary.reason === "INVALID_RESPONSE"
  ) {
    return "CORRUPT";
  }
  if (result.summary.status === "UNAVAILABLE") return "UNAVAILABLE";
  return "ERROR";
}

export function protectRetrievalProviderWithCircuitV2(input: Readonly<{
  channel: "TEXT_VECTOR" | "VISUAL_VECTOR";
  corpusBundleHash: string;
  breaker: RetrievalCircuitBreakerV2;
  provider: RetrievalChannelProviderV2;
}>) {
  return {
    async retrieve(
      query: Parameters<RetrievalChannelProviderV2["retrieve"]>[0],
      context: Parameters<RetrievalChannelProviderV2["retrieve"]>[1],
    ) {
      const permit = input.breaker.beforeRequest();
      if (permit === null) {
        return failedChannel(
          input.channel,
          input.corpusBundleHash,
          "UNAVAILABLE",
          "CIRCUIT_OPEN",
        );
      }
      const startedAt = performance.now();
      try {
        const result = await input.provider.retrieve(query, context);
        const parsed = ChannelRetrievalResultV2Schema.safeParse(result);
        const latencyMs = Math.max(0, performance.now() - startedAt);
        if (!parsed.success) {
          input.breaker.recordFailure(permit, {
            failure: "CORRUPT",
            latencyMs,
          });
          return result;
        }
        if (
          parsed.data.summary.status === "SUCCESS"
          || parsed.data.summary.status === "EMPTY"
        ) {
          input.breaker.recordSuccess(permit, {
            empty: parsed.data.summary.status === "EMPTY",
            latencyMs,
          });
        } else {
          input.breaker.recordFailure(permit, {
            failure: circuitFailureFor(parsed.data),
            latencyMs,
          });
        }
        return result;
      } catch (error) {
        input.breaker.recordFailure(permit, {
          failure: "ERROR",
          latencyMs: Math.max(0, performance.now() - startedAt),
        });
        throw error;
      }
    },
  } satisfies RetrievalChannelProviderV2;
}

async function waitForProcessExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 5_000,
) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    child.once("exit", onExit);
  });
}

function faultDiagnosticDefaults(): Map<
  MixedRuntimeFaultV2,
  MixedRuntimeFaultDiagnosticV2
> {
  return new Map(MixedRuntimeFaultV2Schema.options.map((fault) => [
    fault,
    {
      fault,
      mechanism: fault === "NONE"
        ? "NONE"
        : fault === "TEXT_TIMEOUT" || fault === "VISUAL_TIMEOUT"
          ? "REAL_DEADLINE_AND_RESTART"
          : fault === "VISUAL_PROCESS_EXIT"
            ? "REAL_PROCESS_EXIT_AND_RESTART"
            : fault === "TEXT_CORRUPT" || fault === "VISUAL_CORRUPT"
              ? "MALFORMED_PROVIDER_PAYLOAD"
              : fault === "VISUAL_EMPTY"
                ? "HEALTHY_EMPTY_RESPONSE"
                : fault === "RELATION_ERROR"
                  ? "REAL_EXPANDER_EXCEPTION"
                  : "SYNTHETIC_PROVIDER_STATUS",
      injectionCount: 0,
      processExitObserved: null,
      deadlineObserved: null,
      recoveryProbePassed: null,
      lateResultPollutionChecked: null,
      note: fault === "VISUAL_EMPTY"
        ? "Healthy EMPTY has immutable identity and is not a provider failure."
        : "",
    },
  ]));
}

export async function createLocalMixedRuntimeV2(
  options: LocalMixedRuntimeV2Options,
): Promise<LocalMixedRuntimeV2> {
  const startupStartedAt = performance.now();
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const activeGeneration =
    options.activeGeneration ?? null;
  const visualRetrievalEnabled =
    options.visualRetrievalEnabled !== false;
  const corpus = verifyKnowledgeCorpusBundleV2(
    activeGeneration?.corpus
      ?? await readJson(
        path.join(
          workspaceRoot,
          "data",
          "knowledge-v2",
          "knowledge-corpus.v2.json",
        ),
      ),
  );
  const controlBundlePath = path.join(
    path.resolve(options.controlDir),
    "knowledge-index-bundle.v2.json",
  );
  const configsPath = path.join(
    path.resolve(options.controlDir),
    "configs-by-version.v2.json",
  );
  if (
    activeGeneration
    && activeGeneration.indexBundle === null
  ) {
    throw new Error(
      "MIXED_RUNTIME_ACTIVE_INDEX_REQUIRED",
    );
  }
  const [
    rawControlBundle,
    rawConfigs,
    rawTextManifest,
    rawVisualManifest,
  ] = await Promise.all([
    activeGeneration?.indexBundle
      ?? readJson(controlBundlePath),
    activeGeneration?.indexConfigsByVersionId
      ?? readJson(configsPath),
    readJson(path.join(
      path.resolve(options.textIndexDir),
      "index-manifest.json",
    )),
    visualRetrievalEnabled
      ? readJson(path.join(
          path.resolve(options.visualIndexDir),
          "manifest.json",
        ))
      : Promise.resolve(null),
  ]);
  const controlBundle = verifyKnowledgeIndexBundleV2(rawControlBundle, corpus);
  if (!activeGeneration) {
    await verifyKnowledgeIndexPayloadsV2({
      workspaceRoot,
      indexBundle: controlBundle,
      corpusBundle: corpus,
    });
  } else if (
    activeGeneration.activeIndexBundleHash
      !== controlBundle.indexBundleHash
    || activeGeneration.generationKey
      !== `${corpus.bundleHash}:${controlBundle.indexBundleHash}`
  ) {
    throw new Error(
      "MIXED_RUNTIME_ACTIVE_GENERATION_IDENTITY_MISMATCH",
    );
  }
  const configs = ConfigsByVersionSchema.parse(rawConfigs);
  const textManifest = TextManifestSchema.parse(rawTextManifest);
  const visualManifest = visualRetrievalEnabled
    ? VisualIndexManifestSchema.parse(rawVisualManifest)
    : null;
  if (
    textManifest.identity.corpusBundleHash !== corpus.bundleHash
    || (
      visualManifest
      && visualManifest.identity.corpusBundleHash
        !== corpus.bundleHash
    )
    || controlBundle.corpusBundleHash !== corpus.bundleHash
  ) {
    throw new Error("MIXED_RUNTIME_CORPUS_IDENTITY_MISMATCH");
  }
  if (!activeGeneration) {
    if (
      !visualManifest
      || (
      corpus.bundleHash
        !== T4_FROZEN_CORPUS_BUNDLE_HASH
      || controlBundle.indexBundleHash
        !== T4_FROZEN_CONTROL_INDEX_BUNDLE_HASH
      || textManifest.identity.indexBundleHash
        !== T4_FROZEN_TEXT_PROVIDER.indexBundleHash
      || textManifest.identity.indexVersionId
        !== T4_FROZEN_TEXT_PROVIDER.indexVersionId
      || textManifest.identity.modelId
        !== T4_FROZEN_TEXT_PROVIDER.modelId
      || textManifest.identity.modelRevision
        !== T4_FROZEN_TEXT_PROVIDER.modelRevision
      || visualManifest?.identity.indexBundleHash
        !== T4_FROZEN_VISUAL_PROVIDER.indexBundleHash
      || visualManifest.identity.indexVersionId
        !== T4_FROZEN_VISUAL_PROVIDER.indexVersionId
      || visualManifest.identity.modelId
        !== T4_FROZEN_VISUAL_PROVIDER.modelId
      || visualManifest.identity.modelRevision
        !== T4_FROZEN_VISUAL_PROVIDER.modelRevision
      )
    ) {
      throw new Error(
        "MIXED_RUNTIME_FROZEN_MODEL_IDENTITY_MISMATCH",
      );
    }
  }
  const textPayloads = providerPayloads(
    controlBundle,
    textManifest.identity.indexBundleHash,
  );
  const visualPayloads = visualManifest
    ? providerPayloads(
        controlBundle,
        visualManifest.identity.indexBundleHash,
      )
    : null;
  if (
    textPayloads.indexVersion.id !== textManifest.identity.indexVersionId
    || textPayloads.indexVersion.configHash !== textManifest.configHash
    || textPayloads.tensor.sha256 !== textManifest.payload.sha256
    || (
      visualManifest
      && (
        visualPayloads?.indexVersion.id
          !== visualManifest.identity.indexVersionId
        || visualPayloads.tensor.sha256
          !== visualManifest.payload.sha256
      )
    )
  ) {
    throw new Error("MIXED_RUNTIME_CONTROL_PROVIDER_IDENTITY_MISMATCH");
  }
  for (const provider of [
    textPayloads,
    ...(visualPayloads ? [visualPayloads] : []),
  ]) {
    const config = configs[provider.indexVersion.id];
    if (
      config === undefined
      || sha256StableJsonV2(config) !== provider.indexVersion.configHash
    ) {
      throw new Error(`MIXED_RUNTIME_CONFIG_HASH_DRIFT:${provider.indexVersion.id}`);
    }
  }
  const controlTextManifestPath = path.resolve(
    workspaceRoot,
    textPayloads.manifest.storageKey,
  );
  const controlVisualManifestPath = visualPayloads
    ? path.resolve(
        workspaceRoot,
        visualPayloads.manifest.storageKey,
      )
    : null;
  if (
    sha256Bytes(await readFile(controlTextManifestPath))
      !== sha256Bytes(await readFile(
        path.join(path.resolve(options.textIndexDir), "index-manifest.json"),
      ))
    || (
      visualRetrievalEnabled
      && controlVisualManifestPath
      && sha256Bytes(await readFile(
        controlVisualManifestPath,
      ))
        !== sha256Bytes(await readFile(
          path.join(
            path.resolve(options.visualIndexDir),
            "manifest.json",
          ),
        ))
    )
  ) {
    throw new Error("MIXED_RUNTIME_SOURCE_CONTROL_MANIFEST_DRIFT");
  }

  const lexicalConfigHash = sha256StableJsonV2(LEXICAL_CONFIG);
  const frozenLexicalFallbackConfigHash =
    sha256StableJsonV2(FROZEN_LEXICAL_FALLBACK_CONFIG);
  const relationConfigHash = sha256StableJsonV2(
    CORPUS_EVIDENCE_RELATION_CONFIG_V2,
  );
  const normalizerConfigHash = sha256StableJsonV2(NORMALIZER_CONFIG);
  const textObjectConsensusEnabled =
    options.textObjectConsensusEnabled !== false;
  const queryEvidenceAdequacyEnabled =
    options.queryEvidenceAdequacyEnabled === true;
  if (
    queryEvidenceAdequacyEnabled
    && !textObjectConsensusEnabled
  ) {
    throw new Error(
      "MIXED_RUNTIME_ADEQUACY_REQUIRES_TEXT_OBJECT_CONSENSUS",
    );
  }
  const rrfConfigHash = sha256StableJsonV2(
    textObjectConsensusEnabled
      ? HYBRID_RRF_CONFIG_V2
      : {
          ...HYBRID_RRF_CONFIG_V2,
          evaluationOverride: {
            textObjectConsensusEnabled: false,
            purpose: "T42_A0_EXACT_NODE_BASELINE",
          },
        },
  );
  const [
    packCompetitionCoreSource,
    lexicalPackCompetitionSource,
    lexicalScoringSource,
    textPackCompetitionSource,
  ] = await Promise.all([
    readFile(path.join(
      workspaceRoot,
      "lib",
      "knowledge",
      "pack-competition-v2.ts",
    )),
    readFile(path.join(
      workspaceRoot,
      "lib",
      "knowledge",
      "lexical-retriever-v2.ts",
    )),
    readFile(path.join(
      workspaceRoot,
      "lib",
      "knowledge",
      "retrieve.ts",
    )),
    readFile(path.join(
      workspaceRoot,
      "tools",
      "text-retrieval",
      "text_retrieval.py",
    )),
  ]);
  const {
    lexicalPackCompetitionAlgorithmHash,
    textPackCompetitionAlgorithmHash,
  } = createPackCompetitionAlgorithmHashesV2({
    packCompetitionCoreSource,
    lexicalPackCompetitionSource,
    lexicalScoringSource,
    textPackCompetitionSource,
  });
  const capabilityEntityManifest =
    createAuditedCapabilityEntityManifestV2(corpus);
  const queryPrerequisiteStaticBypassEnabled =
    options.queryPrerequisiteStaticBypassEnabled === true;
  const prerequisiteShadowEntries: Array<{
    queryHash: string;
    decision: string;
    legacyRequired: boolean;
    legacyAuthorized: boolean;
    staticBypassApplied: boolean;
  }> = [];
  const externalVerificationEvaluator =
    queryPrerequisiteStaticBypassEnabled
      ? (
          query: RetrievalQueryV2,
          claims: Parameters<
            typeof evaluateExternalVerificationWithPrerequisiteShadowV3
          >[0]["claims"],
        ) => {
          const evaluated =
            evaluateExternalVerificationWithPrerequisiteShadowV3({
              query,
              claims,
              capabilityEntityManifest,
            });
          prerequisiteShadowEntries.push({
            queryHash:
              evaluated.prerequisiteTrace.queryHash,
            decision:
              evaluated.prerequisiteTrace.decision,
            legacyRequired:
              evaluated.legacyExternalVerification.required,
            legacyAuthorized:
              evaluated.legacyExternalVerification.authorized,
            staticBypassApplied:
              evaluated.staticBypassApplied,
          });
          return evaluated.externalVerification;
        }
      : undefined;
  const packCompetitionCalibration =
    createT41PackCompetitionCalibrationV2({
      corpusBundleHash: corpus.bundleHash,
      lexicalConfigHash,
      normalizerConfigHash,
      textProviderIndexBundleHash:
        textManifest.identity.indexBundleHash,
      textModelId: textManifest.identity.modelId,
      textModelRevision: textManifest.identity.modelRevision,
      lexicalPackCompetitionAlgorithmHash,
      textPackCompetitionAlgorithmHash,
      capabilityEntityManifestHash:
        capabilityEntityManifest.configHash,
    });
  const lexicalIdentity = {
    activeIndexBundleHash: controlBundle.indexBundleHash,
    providerIndexBundleHash: null,
    indexVersionId: "lexical-corpus-v2",
    modelId: null,
    modelRevision: null,
    configHash: lexicalConfigHash,
    payloadHashes: [corpus.bundleHash],
  };
  const textAdapterIdentity: ChannelAdapterIdentityV2 = {
    expectedCorpusBundleHash: corpus.bundleHash,
    activeIndexBundleHash: controlBundle.indexBundleHash,
    expectedProviderIndexBundleHash: textManifest.identity.indexBundleHash,
    expectedIndexVersionId: textManifest.identity.indexVersionId,
    expectedModelId: textManifest.identity.modelId,
    expectedModelRevision: textManifest.identity.modelRevision,
    configHash: textPayloads.indexVersion.configHash,
    payloadHashes: textPayloads.payloadHashes,
  };
  const visualAdapterIdentity:
    ChannelAdapterIdentityV2 | null =
      visualManifest && visualPayloads
        ? {
            expectedCorpusBundleHash:
              corpus.bundleHash,
            activeIndexBundleHash:
              controlBundle.indexBundleHash,
            expectedProviderIndexBundleHash:
              visualManifest.identity
                .indexBundleHash,
            expectedIndexVersionId:
              visualManifest.identity.indexVersionId,
            expectedModelId:
              visualManifest.identity.modelId,
            expectedModelRevision:
              visualManifest.identity.modelRevision,
            configHash:
              visualPayloads.indexVersion.configHash,
            payloadHashes:
              visualPayloads.payloadHashes,
          }
        : null;
  const requireVisualAdapterIdentity = () => {
    if (!visualAdapterIdentity) {
      throw new Error(
        "MIXED_RUNTIME_VISUAL_DISABLED",
      );
    }
    return visualAdapterIdentity;
  };
  const disabledVisualIdentity = {
    activeIndexBundleHash:
      controlBundle.indexBundleHash,
    providerIndexBundleHash: null,
    indexVersionId: "visual-retrieval-disabled-v2",
    modelId: null,
    modelRevision: null,
    configHash: sha256StableJsonV2({
      id: "visual-retrieval-disabled-v2",
      version: "1.0.0",
    }),
    payloadHashes: [corpus.bundleHash],
  };
  const visualChannelIdentity =
    visualManifest && visualPayloads
      ? {
          activeIndexBundleHash:
            controlBundle.indexBundleHash,
          providerIndexBundleHash:
            visualManifest.identity.indexBundleHash,
          indexVersionId:
            visualManifest.identity.indexVersionId,
          modelId: visualManifest.identity.modelId,
          modelRevision:
            visualManifest.identity.modelRevision,
          configHash:
            visualPayloads.indexVersion.configHash,
          payloadHashes: visualPayloads.payloadHashes,
        }
      : disabledVisualIdentity;
  const expectedIdentity: MixedExpectedIdentityV2 = {
    activeIndexBundleHash: controlBundle.indexBundleHash,
    channels: {
      LEXICAL: lexicalIdentity,
      TEXT_VECTOR: {
        activeIndexBundleHash: controlBundle.indexBundleHash,
        providerIndexBundleHash: textManifest.identity.indexBundleHash,
        indexVersionId: textManifest.identity.indexVersionId,
        modelId: textManifest.identity.modelId,
        modelRevision: textManifest.identity.modelRevision,
        configHash: textPayloads.indexVersion.configHash,
        payloadHashes: textPayloads.payloadHashes,
      },
      VISUAL_VECTOR: visualChannelIdentity,
    },
  };
  const acceptancePolicy = createAcceptancePolicyV2();
  const queryEvidenceAdequacyRuntime =
    queryEvidenceAdequacyEnabled
      ? createQueryEvidenceAdequacyRuntimeV2({
          corpus,
          context: {
            normalizerConfigHash,
            rrfConfigHash,
            acceptancePolicyHash: acceptancePolicy.configHash,
            objectConsensusConfigHash:
              TEXT_OBJECT_CONSENSUS_CONFIG_HASH_V2,
            lexicalConfigHash,
            textProviderIndexBundleHash:
              textManifest.identity.indexBundleHash,
            textModelId: textManifest.identity.modelId,
            textModelRevision:
              textManifest.identity.modelRevision,
          },
        })
      : null;
  const t41CandidateIdentity: LocalMixedRuntimeV2["t41CandidateIdentity"] = {
    runtimeKind: "EVIDENCE_BUNDLE_V2",
    bundleSchemaVersion: 2,
    corpusBundleHash: corpus.bundleHash,
    activeIndexBundleHash: controlBundle.indexBundleHash,
    relationConfigHash,
    normalizerConfigHash,
    rrfConfigHash,
    capabilityEntityManifestHash:
      capabilityEntityManifest.configHash,
    packCompetitionPolicyHash:
      PACK_COMPETITION_POLICY_V2.configHash,
    packCompetitionCalibrationHash:
      packCompetitionCalibration.configHash,
    lexicalPackCompetitionAlgorithmHash,
    textPackCompetitionAlgorithmHash,
    acceptancePolicyHash: acceptancePolicy.configHash,
    channels: [
      {
        channel: "LEXICAL",
        identity: expectedIdentity.channels.LEXICAL,
      },
      {
        channel: "TEXT_VECTOR",
        identity: expectedIdentity.channels.TEXT_VECTOR,
      },
      ...(visualRetrievalEnabled
        ? [{
            channel: "VISUAL_VECTOR" as const,
            identity:
              expectedIdentity.channels.VISUAL_VECTOR,
          }]
        : []),
    ],
  };
  const textTargets = new Map(
    textManifest.entries.map((entry) => [
      entry.nodeId,
      { objectId: entry.objectId, coursePackId: entry.coursePackId },
    ]),
  );
  const assetOwners = new Map<string, VisualAssetOwnerV2>();
  const assetCoursePacks = new Map<string, string>();
  for (const object of corpus.objects) {
    for (const node of object.nodes) {
      if (node.kind !== "IMAGE") continue;
      assetOwners.set(node.assetId, {
        objectId: object.id,
        imageNodeId: node.id,
      });
      assetCoursePacks.set(node.assetId, object.sourceCoursePack.id);
    }
  }
  if (
    assetOwners.size !== corpus.assets.length
    || (
      visualManifest
      && visualManifest.entries.some((entry) =>
        assetCoursePacks.get(entry.assetId)
          !== entry.coursePackId)
    )
  ) {
    throw new Error("MIXED_RUNTIME_VISUAL_OWNER_SCOPE_DRIFT");
  }
  const assetBindingsByPath = new Map(
    corpus.assets.map((asset) => {
      const owner = assetOwners.get(asset.id);
      if (!owner) throw new Error(`MIXED_RUNTIME_ASSET_OWNER_MISSING:${asset.id}`);
      return [
        asset.locator.path,
        {
          assetId: asset.id,
          objectId: owner.objectId,
          imageNodeId: owner.imageNodeId,
        },
      ];
    }),
  );
  const frozenCaptionProvider =
    visualRetrievalEnabled
      ? await createFrozenCaptionLexicalFallbackProviderV2({
          workspaceRoot,
          corpusBundleHash: corpus.bundleHash,
          assetManifestPath:
            options.assetManifestPath,
          assetBindingsByPath,
          identity: {
            corpusBundleHash: corpus.bundleHash,
            activeIndexBundleHash:
              controlBundle.indexBundleHash,
            indexVersionId:
              lexicalIdentity.indexVersionId,
            configHash: lexicalConfigHash,
            payloadHashes:
              lexicalIdentity.payloadHashes,
          },
        })
      : null;
  const resolveQueryImage =
    visualRetrievalEnabled
      ? await queryImageResolver(
          workspaceRoot,
          corpus,
        )
      : null;
  let textChild: ChildProcessWithoutNullStreams | null = null;
  let visualChild: ChildProcessWithoutNullStreams | null = null;
  const startTextRuntime = () => startTextSidecar({
    executable: path.resolve(options.pythonExecutable),
    args: [
      "-u",
      path.join(workspaceRoot, "tools", "text-retrieval", "text_retrieval.py"),
      "serve",
      "--model-dir",
      path.resolve(options.textModelDir),
      "--model-seal",
      path.resolve(options.textModelSeal),
      "--index-dir",
      path.resolve(options.textIndexDir),
      "--device",
      options.device,
    ],
    cwd: workspaceRoot,
    expectedIndex: textManifest.identity,
    allowedTargets: textTargets,
    env: {
      PYTHONHASHSEED: "0",
      CUBLAS_WORKSPACE_CONFIG: ":4096:8",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
    },
    spawnImpl(executable, args, spawnOptions) {
      const child = spawn(executable, [...args], spawnOptions);
      textChild = child;
      return child;
    },
  });
  const startVisualRuntime = () => {
    if (
      !visualManifest
      || !resolveQueryImage
    ) {
      throw new Error(
        "MIXED_RUNTIME_VISUAL_DISABLED",
      );
    }
    return startVisualSidecar({
    executable: path.resolve(options.pythonExecutable),
    args: [
      "-u",
      path.join(workspaceRoot, "tools", "visual-retrieval", "poc.py"),
      "serve",
      "--adapter",
      "siglip2",
      "--model-dir",
      path.resolve(options.visualModelDir),
      "--model-seal",
      path.resolve(options.visualModelSeal),
      "--index-dir",
      path.resolve(options.visualIndexDir),
      "--offload-dir",
      path.resolve(options.visualOffloadDir),
      "--device",
      options.device,
      "--gpu-memory-gib",
      String(options.gpuMemoryGiB),
    ],
    cwd: workspaceRoot,
    expectedIndex: visualManifest.identity,
    capabilities: capabilitiesFromVisualManifest(
      visualManifest.adapter.capabilities,
    ),
    allowedAssetCoursePacks: assetCoursePacks,
    resolveQueryImage,
    maxCacheEntries: options.visualMaxCacheEntries,
    env: {
      PYTHONHASHSEED: "0",
      CUBLAS_WORKSPACE_CONFIG: ":4096:8",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
    },
    spawnImpl(executable, args, spawnOptions) {
      const child = spawn(executable, [...args], spawnOptions);
      visualChild = child;
      return child;
    },
    });
  };
  let activeText!: TextSidecarHandle;
  let activeVisual:
    VisualSidecarHandle | null = null;
  try {
    activeText = await startTextRuntime();
    if (visualRetrievalEnabled) {
      activeVisual = await startVisualRuntime();
    }
  } catch (error) {
    await Promise.allSettled([
      activeText?.dispose(),
      activeVisual?.dispose(),
    ]);
    throw error;
  }
  const sealTextEnvironment = (handle: TextSidecarHandle) =>
    createTextRuntimeEnvironmentSealV2({
      schemaVersion: 1,
      node: {
        version: process.version,
        platform: z.enum(["win32", "linux", "darwin"]).parse(
          process.platform,
        ),
        arch: z.enum(["x64", "arm64"]).parse(process.arch),
      },
      python: { version: handle.environment.pythonVersion },
      libraries: {
        torch: handle.environment.torchVersion,
        transformers: handle.environment.transformersVersion,
        safetensors: handle.environment.safetensorsVersion,
      },
      tokenizer: {
        modelId: textManifest.identity.modelId,
        modelRevision: textManifest.identity.modelRevision,
        modelDirectorySha256: textManifest.model.directorySha256,
        className: handle.environment.tokenizerClassName,
      },
      device: {
        requested: options.device,
        actual: handle.environment.actualDevice,
        cudaRuntime: handle.environment.cudaRuntime,
        deviceName: handle.environment.deviceName,
      },
    });
  const runtimeEnvironment = sealTextEnvironment(activeText);
  const startupDurationMs = Math.max(
    0,
    performance.now() - startupStartedAt,
  );
  let runtimeDisposed = false;
  const textCircuit = createRetrievalCircuitBreakerV2({
    generationHash: controlBundle.indexBundleHash,
    channel: "TEXT_VECTOR",
    config: options.circuitBreaker,
  });
  const visualCircuit = visualRetrievalEnabled
    ? createRetrievalCircuitBreakerV2({
        generationHash: controlBundle.indexBundleHash,
        channel: "VISUAL_VECTOR",
        config: options.circuitBreaker,
      })
    : null;
  const faultDiagnostics = faultDiagnosticDefaults();
  const faultInjected = new Set<MixedRuntimeFaultV2>();
  const spyEntries: ProviderSpyEntryV2[] = [];
  const recordSpy = (
    channel: ProviderSpyEntryV2["channel"],
    query: RetrievalQueryV2,
  ) => {
    const inspected = assertMixedRuntimeQueryAllowlistV2(query);
    spyEntries.push({
      channel,
      queryFingerprint: inspected.fingerprint,
      keys: inspected.keys,
      mode: query.mode,
      coursePackId: query.scope.sourceCoursePack?.id ?? null,
    });
  };
  const recordFault = (
    fault: MixedRuntimeFaultV2,
    patch: Partial<MixedRuntimeFaultDiagnosticV2> = {},
  ) => {
    const current = faultDiagnostics.get(fault)!;
    faultDiagnostics.set(fault, {
      ...current,
      ...patch,
      fault,
      injectionCount: current.injectionCount + 1,
    });
  };
  const textRequest = (query: RetrievalQueryV2, timeoutMs: number) =>
    activeText.retriever.retrieve({
      text: query.normalizedText!,
      coursePackId: query.scope.sourceCoursePack?.id ?? null,
    }, {
      topK: RRF_CHANNEL_LIMIT_V2,
      timeoutMs,
    });
  const visualRequest = (
    query: RetrievalQueryV2,
    timeoutMs: number,
  ) => {
    if (!activeVisual) {
      throw new Error(
        "MIXED_RUNTIME_VISUAL_DISABLED",
      );
    }
    return activeVisual.retriever.retrieve(
      visualQuery(query),
      {
        topK: RRF_CHANNEL_LIMIT_V2,
        timeoutMs,
      },
    );
  };
  const healthyTextProbe = async (query: RetrievalQueryV2) => {
    const response = await textRequest(query, options.timeoutMs);
    return (
      response.status === "SUCCESS" || response.status === "EMPTY"
    ) && response.index !== null;
  };
  const healthyVisualProbe = async (query: RetrievalQueryV2) => {
    const response = await visualRequest(query, options.timeoutMs);
    return (
      response.status === "SUCCESS" || response.status === "EMPTY"
    ) && response.index !== null;
  };
  const injectTextDeadline = async (query: RetrievalQueryV2) => {
    if (faultInjected.has("TEXT_TIMEOUT")) {
      recordFault("TEXT_TIMEOUT");
      return failedChannel(
        "TEXT_VECTOR",
        corpus.bundleHash,
        "TIMEOUT",
        "DEADLINE_EXCEEDED",
      );
    }
    faultInjected.add("TEXT_TIMEOUT");
    const priorChild = textChild;
    const response = await textRequest(query, 1);
    if (response.status !== "TIMEOUT" || response.reason !== "DEADLINE_EXCEEDED") {
      throw new Error("MIXED_RUNTIME_TEXT_DEADLINE_NOT_OBSERVED");
    }
    const processExitObserved = priorChild
      ? await waitForProcessExit(priorChild)
      : false;
    await activeText.dispose();
    activeText = await startTextRuntime();
    if (
      sealTextEnvironment(activeText).sealSha256
      !== runtimeEnvironment.sealSha256
    ) {
      throw new Error("MIXED_RUNTIME_TEXT_ENVIRONMENT_DRIFT");
    }
    const recoveryProbePassed = await healthyTextProbe(query);
    if (!recoveryProbePassed) {
      throw new Error("MIXED_RUNTIME_TEXT_DEADLINE_RECOVERY_FAILED");
    }
    recordFault("TEXT_TIMEOUT", {
      processExitObserved,
      deadlineObserved: true,
      recoveryProbePassed,
      lateResultPollutionChecked: recoveryProbePassed,
      note: "1ms guarded deadline terminated the pending transport; a fresh sidecar passed an immutable-identity probe.",
    });
    return adaptTextRetrievalResponseV2(
      response,
      textAdapterIdentity,
      candidateProjectionForModeV2(query.mode),
    );
  };
  const injectVisualDeadline = async (query: RetrievalQueryV2) => {
    if (faultInjected.has("VISUAL_TIMEOUT")) {
      recordFault("VISUAL_TIMEOUT");
      return failedChannel(
        "VISUAL_VECTOR",
        corpus.bundleHash,
        "TIMEOUT",
        "DEADLINE_EXCEEDED",
      );
    }
    faultInjected.add("VISUAL_TIMEOUT");
    const priorChild = visualChild;
    const response = await visualRequest(query, 1);
    if (response.status !== "TIMEOUT" || response.reason !== "DEADLINE_EXCEEDED") {
      throw new Error("MIXED_RUNTIME_VISUAL_DEADLINE_NOT_OBSERVED");
    }
    const processExitObserved = priorChild
      ? await waitForProcessExit(priorChild)
      : false;
    await activeVisual?.dispose();
    activeVisual = await startVisualRuntime();
    const recoveryProbePassed = await healthyVisualProbe(query);
    if (!recoveryProbePassed) {
      throw new Error("MIXED_RUNTIME_VISUAL_DEADLINE_RECOVERY_FAILED");
    }
    recordFault("VISUAL_TIMEOUT", {
      processExitObserved,
      deadlineObserved: true,
      recoveryProbePassed,
      lateResultPollutionChecked: recoveryProbePassed,
      note: "1ms guarded deadline was observed; the old transport was discarded and a fresh sidecar passed an immutable-identity probe.",
    });
    return adaptVisualRetrievalResponseV2(
      response,
      requireVisualAdapterIdentity(),
      assetOwners,
    );
  };
  const injectVisualProcessExit = async (query: RetrievalQueryV2) => {
    if (faultInjected.has("VISUAL_PROCESS_EXIT")) {
      recordFault("VISUAL_PROCESS_EXIT");
      return failedChannel(
        "VISUAL_VECTOR",
        corpus.bundleHash,
        "ERROR",
        "PROCESS_EXIT",
      );
    }
    faultInjected.add("VISUAL_PROCESS_EXIT");
    const priorChild = visualChild;
    if (!priorChild || priorChild.exitCode !== null || priorChild.signalCode !== null) {
      throw new Error("MIXED_RUNTIME_VISUAL_PROCESS_NOT_RUNNING");
    }
    const killAccepted = priorChild.kill();
    const processExitObserved = killAccepted && await waitForProcessExit(priorChild);
    if (!processExitObserved) {
      throw new Error("MIXED_RUNTIME_VISUAL_PROCESS_EXIT_NOT_OBSERVED");
    }
    await activeVisual?.dispose();
    activeVisual = await startVisualRuntime();
    const recoveryProbePassed = await healthyVisualProbe(query);
    if (!recoveryProbePassed) {
      throw new Error("MIXED_RUNTIME_VISUAL_PROCESS_RECOVERY_FAILED");
    }
    recordFault("VISUAL_PROCESS_EXIT", {
      processExitObserved,
      deadlineObserved: null,
      recoveryProbePassed,
      lateResultPollutionChecked: recoveryProbePassed,
      note: "The captured child process was killed, its exit event was observed, and a fresh sidecar passed an immutable-identity probe.",
    });
    return failedChannel(
      "VISUAL_VECTOR",
      corpus.bundleHash,
      "ERROR",
      "PROCESS_EXIT",
    );
  };
  const lexicalProvider: RetrievalChannelProviderV2 = {
    async retrieve(query) {
      recordSpy("LEXICAL", query);
      const startedAt = performance.now();
      const hits = retrieveLexicalCandidatesV2(query, corpus.objects, {
        maxCandidates: RRF_CHANNEL_LIMIT_V2,
      });
      return adaptLexicalCandidatesV2(
        hits,
        {
          corpusBundleHash: corpus.bundleHash,
          activeIndexBundleHash: controlBundle.indexBundleHash,
          indexVersionId: lexicalIdentity.indexVersionId,
          configHash: lexicalConfigHash,
          payloadHashes: lexicalIdentity.payloadHashes,
        },
        Math.max(0, performance.now() - startedAt),
        candidateProjectionForModeV2(query.mode),
        retrieveLexicalPackCompetitionV2(query, corpus.objects),
        retrieveLexicalObjectCandidatesV2(query, corpus.objects),
      );
    },
  };
  const frozenLexicalFallbackProvider: RetrievalChannelProviderV2 = {
    async retrieve(query) {
      recordSpy("LEXICAL", query);
      const startedAt = performance.now();
      return adaptLexicalCandidatesV2(
        retrieveFrozenT0LexicalCandidatesV2(query, corpus.objects),
        {
          corpusBundleHash: corpus.bundleHash,
          activeIndexBundleHash: controlBundle.indexBundleHash,
          indexVersionId: "frozen-t0-lexical-v2",
          configHash: frozenLexicalFallbackConfigHash,
          payloadHashes: lexicalIdentity.payloadHashes,
        },
        Math.max(0, performance.now() - startedAt),
        candidateProjectionForModeV2(query.mode),
      );
    },
  };
  const captionFallbackProvider:
    RetrievalChannelProviderV2 | null =
      frozenCaptionProvider
        ? {
            retrieve(query, context) {
              recordSpy(
                "CAPTION_LEXICAL",
                query,
              );
              return frozenCaptionProvider.retrieve(
                query,
                context,
              );
            },
          }
        : null;
  const rawTextProvider = (fault: MixedRuntimeFaultV2): RetrievalChannelProviderV2 => ({
    async retrieve(query, context) {
      recordSpy("TEXT_VECTOR", query);
      if (fault === "TEXT_TIMEOUT") {
        return injectTextDeadline(query);
      }
      if (fault === "TEXT_UNAVAILABLE") {
        recordFault("TEXT_UNAVAILABLE");
        return failedChannel(
          "TEXT_VECTOR",
          corpus.bundleHash,
          "UNAVAILABLE",
          "PROVIDER_UNAVAILABLE",
        );
      }
      if (fault === "TEXT_CORRUPT") {
        recordFault("TEXT_CORRUPT");
        return { corrupt: true };
      }
      const response = await activeText.retriever.retrieve({
        text: query.normalizedText!,
        coursePackId: query.scope.sourceCoursePack?.id ?? null,
      }, {
        topK: RRF_CHANNEL_LIMIT_V2,
        timeoutMs: options.timeoutMs,
      }, {
        signal: context.signal,
      });
      return adaptTextRetrievalResponseV2(
        response,
        textAdapterIdentity,
        candidateProjectionForModeV2(query.mode),
      );
    },
  });
  const rawVisualProvider = (fault: MixedRuntimeFaultV2): RetrievalChannelProviderV2 => ({
    async retrieve(query, context) {
      recordSpy("VISUAL_VECTOR", query);
      if (
        !visualRetrievalEnabled
        || !visualAdapterIdentity
        || !activeVisual
      ) {
        return failedChannel(
          "VISUAL_VECTOR",
          corpus.bundleHash,
          "UNAVAILABLE",
          "FEATURE_DISABLED",
        );
      }
      if (fault === "VISUAL_TIMEOUT") {
        return injectVisualDeadline(query);
      }
      if (fault === "VISUAL_UNAVAILABLE") {
        recordFault("VISUAL_UNAVAILABLE");
        return failedChannel(
          "VISUAL_VECTOR",
          corpus.bundleHash,
          "UNAVAILABLE",
          "PROVIDER_UNAVAILABLE",
        );
      }
      if (fault === "VISUAL_CORRUPT") {
        recordFault("VISUAL_CORRUPT");
        return { corrupt: true };
      }
      if (fault === "VISUAL_PROCESS_EXIT") {
        return injectVisualProcessExit(query);
      }
      if (fault === "VISUAL_EMPTY") {
        recordFault("VISUAL_EMPTY");
        return ChannelRetrievalResultV2Schema.parse({
          summary: {
            channel: "VISUAL_VECTOR",
            status: "EMPTY",
            reason: null,
            corpusBundleHash: corpus.bundleHash,
            identity: expectedIdentity.channels.VISUAL_VECTOR,
            hitCount: 0,
            timingMs: 0,
          },
          hits: [],
        });
      }
      const response = await activeVisual.retriever
        .retrieve(
          visualQuery(query),
          {
            topK: RRF_CHANNEL_LIMIT_V2,
            timeoutMs: options.timeoutMs,
          },
          { signal: context.signal },
        );
      return adaptVisualRetrievalResponseV2(
        response,
        requireVisualAdapterIdentity(),
        assetOwners,
      );
    },
  });
  const textProvider = (
    fault: MixedRuntimeFaultV2,
  ) => protectRetrievalProviderWithCircuitV2({
    channel: "TEXT_VECTOR",
    corpusBundleHash: corpus.bundleHash,
    breaker: textCircuit,
    provider: rawTextProvider(fault),
  });
  const visualProvider = (
    fault: MixedRuntimeFaultV2,
  ) => visualCircuit === null
    ? rawVisualProvider(fault)
    : protectRetrievalProviderWithCircuitV2({
        channel: "VISUAL_VECTOR",
        corpusBundleHash: corpus.bundleHash,
        breaker: visualCircuit,
        provider: rawVisualProvider(fault),
      });
  const textObjectChannelProbe =
    createTextObjectChannelProbeV3({
      enabled:
        options.textObjectChannelProbeEnabled === true,
      capabilityEntityManifest,
      lexicalProvider,
      textVectorProvider: textProvider("NONE"),
    });
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
  const directEvidenceChannelProbe =
    createDirectEvidenceChannelProbeV1({
      enabled:
        options.directEvidenceChannelProbeEnabled === true,
      capabilityEntityManifest,
      lexicalProvider,
      textVectorProvider: textProvider("NONE"),
      visualVectorProvider: visualProvider("NONE"),
      bindings: {
        objectCoursePackById: new Map(
          corpus.objects.map((object) => [
            object.id,
            object.sourceCoursePack.id,
          ]),
        ),
        nodeOwnerById: new Map(
          corpus.objects.flatMap((object) =>
            object.nodes.map((node) => [
              node.id,
              object.id,
            ] as const)),
        ),
        assetOwnerById: new Map(
          [...assetOwners].map(([assetId, owner]) => [
            assetId,
            owner.objectId,
          ]),
        ),
      },
    });
  const baseExpander = createCorpusEvidenceGraphExpanderV2(corpus);
  const expanderFor = (fault: MixedRuntimeFaultV2): EvidenceGraphExpanderV2 =>
    fault === "RELATION_ERROR"
      ? {
          async expand() {
            recordFault("RELATION_ERROR");
            throw new Error("SIMULATED_RELATION_EXPANSION_ERROR");
          },
          resolvePrimaries: baseExpander.resolvePrimaries,
        }
      : baseExpander;
  const retrievers = new Map<MixedRuntimeFaultV2, ReturnType<typeof createHybridRetrieverV2>>();
  const retrieverFor = (fault: MixedRuntimeFaultV2) => {
    const existing = retrievers.get(fault);
    if (existing) return existing;
    const provesSidecarRecovery =
      fault === "TEXT_TIMEOUT"
      || fault === "VISUAL_TIMEOUT"
      || fault === "VISUAL_PROCESS_EXIT";
    const retriever = createHybridRetrieverV2({
      providers: {
        lexical: lexicalProvider,
        frozenLexicalFallback: frozenLexicalFallbackProvider,
        textVector: textProvider(fault),
        visualVector: visualProvider(fault),
        captionFallback:
          captionFallbackProvider,
      },
      graphExpander: expanderFor(fault),
      sourceCoursePackByObjectId,
      assetIdByNodeId,
      corpusProvenanceClaims: [],
      ...(externalVerificationEvaluator
        ? { externalVerificationEvaluator }
        : {}),
      acceptancePolicy,
      capabilityBoundary: {
        manifest: capabilityEntityManifest,
        policy: PACK_COMPETITION_POLICY_V2,
        calibration: packCompetitionCalibration,
        runtimeIdentity: {
          lexicalConfigHash,
          textProviderIndexBundleHash:
            textManifest.identity.indexBundleHash,
          textModelId: textManifest.identity.modelId,
          textModelRevision: textManifest.identity.modelRevision,
          lexicalPackCompetitionAlgorithmHash,
          textPackCompetitionAlgorithmHash,
        },
      },
      textObjectConsensusEnabled,
      queryEvidenceAdequacy: queryEvidenceAdequacyRuntime,
      // The injected provider deadline remains 1 ms. These three audit-only
      // paths also restart the killed sidecar and run an immutable-identity
      // health probe before returning; that proof must not consume the normal
      // online query deadline and turn a correct fallback into a harness flake.
      queryDeadlineMs: provesSidecarRecovery
        ? 30_000
        : options.timeoutMs,
      provenance: {
        activeIndexBundleHash: controlBundle.indexBundleHash,
        relationConfigHash,
        normalizerConfigHash,
        rrfConfigHash,
      },
    });
    retrievers.set(fault, retriever);
    return retriever;
  };
  return {
    expectedIdentity,
    t41CandidateIdentity,
    runtimeEnvironment,
    t43AdequacyIdentity() {
      return {
        queryEvidenceAdequacyEnabled,
        queryEvidenceAdequacyIdentity:
          queryEvidenceAdequacyRuntime === null
            ? null
            : structuredClone(
                queryEvidenceAdequacyRuntime.identity,
              ),
      };
    },
    provenance: {
      activeIndexBundleHash: controlBundle.indexBundleHash,
      relationConfigHash,
      normalizerConfigHash,
      rrfConfigHash,
    },
    retrieve(query, fault = "NONE") {
      return retrieverFor(MixedRuntimeFaultV2Schema.parse(fault))(query);
    },
    probeTextObjectChannels(query, context) {
      return textObjectChannelProbe(query, context);
    },
    probeDirectEvidenceChannels(query, context) {
      return directEvidenceChannelProbe
        .probeDirectEvidenceChannels(query, context);
    },
    probeDirectEvidenceBatch(queries, context) {
      return directEvidenceChannelProbe
        .probeDirectEvidenceBatch(queries, context);
    },
    providerSpy() {
      return {
        entryCount: spyEntries.length,
        entries: structuredClone(spyEntries),
      };
    },
    runtimeEvidence() {
      return {
        source: "LOCAL_MIXED_RUNTIME_V2",
        visualMaxCacheEntries:
          visualRetrievalEnabled
            ? options.visualMaxCacheEntries
            : 0,
        sidecarHandshakeVerified: true,
        textProviderIndexBundleHash: textManifest.identity.indexBundleHash,
        textIndexVersionId: textManifest.identity.indexVersionId,
        visualProviderIndexBundleHash:
          visualManifest?.identity.indexBundleHash
            ?? disabledVisualIdentity
              .activeIndexBundleHash,
        visualIndexVersionId:
          visualManifest?.identity.indexVersionId
            ?? disabledVisualIdentity.indexVersionId,
      };
    },
    faultDiagnostics() {
      return structuredClone([...faultDiagnostics.values()]);
    },
    prerequisiteShadowAudit() {
      return {
        enabled: queryPrerequisiteStaticBypassEnabled,
        entryCount: prerequisiteShadowEntries.length,
        entries: structuredClone(prerequisiteShadowEntries),
      };
    },
    resourceReport() {
      return RetrievalRuntimeResourceReportV2Schema.parse({
        schemaVersion: 2,
        generationHash: controlBundle.indexBundleHash,
        startup: {
          completed: true,
          durationMs: startupDurationMs,
        },
        channels: {
          TEXT_VECTOR: textCircuit.snapshot(),
          VISUAL_VECTOR: visualCircuit?.snapshot() ?? null,
        },
        sidecars: {
          text: activeText.resources(),
          visual: activeVisual?.resources() ?? null,
        },
        limits: {
          queryTimeoutMs: options.timeoutMs,
          visualMaxCacheEntries:
            visualRetrievalEnabled
              ? options.visualMaxCacheEntries
              : 0,
        },
        disposed: runtimeDisposed,
      });
    },
    async dispose() {
      runtimeDisposed = true;
      await Promise.all([
        activeText.dispose(),
        activeVisual?.dispose(),
      ]);
    },
  };
}

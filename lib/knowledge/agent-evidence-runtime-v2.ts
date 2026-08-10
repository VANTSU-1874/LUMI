import {
  createHash,
  randomUUID,
} from "node:crypto";
import path from "node:path";

import type {
  AgentEvidenceSearchPortV2,
  AgentEvidenceToolOutputV2,
} from "@/lib/agent/evidence-tool-v2";
import {
  AgentEvidenceToolOutputV2Schema,
} from "@/lib/agent/evidence-tool-v2";
import {
  projectEvidenceBundleForAgentV2,
} from "@/lib/agent/evidence-tool-v2";
import type {
  DatabaseConnection,
} from "@/lib/db/client";
import {
  KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS,
} from "@/lib/operations/knowledge-v2-text-runtime-package";

import {
  createActiveKnowledgeGenerationLoaderV2,
  type ActiveKnowledgeGenerationLoaderV2,
  type ActiveKnowledgeGenerationV2,
} from "./active-knowledge-generation-v2";
import {
  openKnowledgeAssetFileV2,
} from "./knowledge-asset-file-v2";
import {
  resolveKnowledgeIndexStoragePathV2,
} from "./knowledge-index-v2";
import {
  createLocalMixedRuntimeV2,
  type LocalMixedRuntimeV2,
  type LocalMixedRuntimeV2Options,
} from "./mixed-retrieval-runtime-v2";
import {
  CoursePackReferenceV2Schema,
} from "./knowledge-object-v2";
import { createRetrievalQueryV2 } from "./retrieval-query-v2";

const WINDOWS_RUNTIME_PATHS_V2 = Object.freeze({
  python:
    ".runtime/visual-retrieval/python312/python.exe",
  textModelDir:
    ".runtime/text-retrieval/hf/models--BAAI--bge-small-zh-v1.5/"
    + "snapshots/7999e1d3359715c523056ef9478215996d62a620",
  textModelSeal:
    ".runtime/text-retrieval/seals/bge-small-zh-v1.5.json",
  textIndexDir:
    ".runtime/text-retrieval/indexes/"
    + "b3119e9a942497f731d6c8ee063c00fe2793e859cf47d7cbaa6101a2771b1122",
  visualModelDir:
    ".runtime/visual-retrieval/hf/models--google--"
    + "siglip2-base-patch16-224/snapshots/"
    + "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
  visualModelSeal:
    ".runtime/visual-retrieval/seals/siglip2.json",
  visualIndexDir:
    ".runtime/visual-retrieval/indexes/siglip2/"
    + "1f2a354c755b498240108583d10ad5f0f5d2a3ad9c9f2cee2c3110d07f05125a",
  visualOffloadDir:
    ".runtime/visual-retrieval/offload",
  controlDir:
    ".runtime/knowledge-index/control/"
    + "cad61822cf3e4d95e984b08c66fa6427c5adf182fc305329291f8eb9aad1be5d",
  assetManifest:
    "data/manifests/course-png-sha256.v1.json",
} as const);

const LINUX_TEXT_RUNTIME_PATHS_V2 = Object.freeze({
  python:
    ".runtime/knowledge-v2-linux/python/bin/python3",
  textModelDir:
    ".runtime/knowledge-v2-linux/models/BAAI--bge-small-zh-v1.5/"
    + "7999e1d3359715c523056ef9478215996d62a620",
  textModelSeal:
    ".runtime/knowledge-v2-linux/seals/bge-small-zh-v1.5.json",
  textIndexDir:
    ".runtime/knowledge-index/providers/bge-small-zh-v1-5/"
    + KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.providerIndexHash,
  // Visual retrieval is a separate Linux release. These paths deliberately
  // remain absent from the text package so an accidental visual enablement
  // fails closed instead of falling back to the Windows/CUDA artifacts.
  visualModelDir:
    ".runtime/knowledge-v2-linux/visual/NOT_INSTALLED/model",
  visualModelSeal:
    ".runtime/knowledge-v2-linux/visual/NOT_INSTALLED/model-seal.json",
  visualIndexDir:
    ".runtime/knowledge-v2-linux/visual/NOT_INSTALLED/index",
  visualOffloadDir:
    ".runtime/knowledge-v2-linux/visual/NOT_INSTALLED/offload",
  controlDir:
    ".runtime/knowledge-index/control/"
    + KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.controlBundleHash,
  assetManifest:
    "data/manifests/course-png-sha256.v1.json",
} as const);

export type AgentEvidenceRuntimePlatformV2 =
  | "win32"
  | "linux";

function supportedRuntimePlatformV2(
  platform: NodeJS.Platform,
): AgentEvidenceRuntimePlatformV2 {
  if (platform === "win32" || platform === "linux") {
    return platform;
  }
  throw new Error(
    `AGENT_EVIDENCE_PLATFORM_UNSUPPORTED:${platform}`,
  );
}

function runtimePathsForPlatformV2(
  platform: AgentEvidenceRuntimePlatformV2,
) {
  return platform === "linux"
    ? LINUX_TEXT_RUNTIME_PATHS_V2
    : WINDOWS_RUNTIME_PATHS_V2;
}

const AGENT_EVIDENCE_RUNTIME_PROFILE_BASE_V2 =
  Object.freeze({
    schemaVersion: 1,
    id: "lumi-local-mixed-runtime-v2",
    queryMode:
      "TEXT_TO_IMAGE_WITH_TEXT_FALLBACK",
    textModel: {
      id: "BAAI/bge-small-zh-v1.5",
      revision:
        "7999e1d3359715c523056ef9478215996d62a620",
      indexId:
        "b3119e9a942497f731d6c8ee063c00fe2793e859cf47d7cbaa6101a2771b1122",
    },
    visualModel: {
      id: "google/siglip2-base-patch16-224",
      revision:
        "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
      indexId:
        "1f2a354c755b498240108583d10ad5f0f5d2a3ad9c9f2cee2c3110d07f05125a",
    },
    controlBundleId:
      "cad61822cf3e4d95e984b08c66fa6427c5adf182fc305329291f8eb9aad1be5d",
  } as const);

export function agentEvidenceRuntimeProfileV2(
  rawPlatform: NodeJS.Platform = process.platform,
) {
  const platform =
    supportedRuntimePlatformV2(rawPlatform);
  const profile = {
    ...AGENT_EVIDENCE_RUNTIME_PROFILE_BASE_V2,
    ...(platform === "linux"
      ? {
          textModel: {
            id: KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelId,
            revision:
              KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelRevision,
            indexId:
              KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.providerIndexHash,
          },
          controlBundleId:
            KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.controlBundleHash,
        }
      : {}),
    platform,
    device: platform === "linux"
      ? "cpu" as const
      : "cuda" as const,
    visualIncluded: platform !== "linux",
  };
  const serialized = JSON.stringify(
    profile,
  );
  return {
    ...profile,
    hash: createHash("sha256")
      .update(serialized, "utf8")
      .digest("hex"),
  };
}

type RuntimeEntry = {
  workspaceRoot: string;
  pending: Promise<{
    runtime: LocalMixedRuntimeV2;
    port: AgentEvidenceSearchPortV2;
  }>;
};

type RuntimeCache = Map<string, RuntimeEntry>;

export function fixedAgentEvidenceRuntimeOptionsV2(
  workspaceRoot: string,
  rawPlatform: NodeJS.Platform = process.platform,
): LocalMixedRuntimeV2Options {
  const platform =
    supportedRuntimePlatformV2(rawPlatform);
  const runtimePaths =
    runtimePathsForPlatformV2(platform);
  const resolve = (value: string) =>
    path.resolve(workspaceRoot, value);
  return {
    workspaceRoot,
    pythonExecutable:
      resolve(runtimePaths.python),
    textModelDir:
      resolve(runtimePaths.textModelDir),
    textModelSeal:
      resolve(runtimePaths.textModelSeal),
    textIndexDir:
      resolve(runtimePaths.textIndexDir),
    visualModelDir:
      resolve(runtimePaths.visualModelDir),
    visualModelSeal:
      resolve(runtimePaths.visualModelSeal),
    visualIndexDir:
      resolve(runtimePaths.visualIndexDir),
    visualOffloadDir:
      resolve(
        runtimePaths.visualOffloadDir,
      ),
    controlDir:
      resolve(runtimePaths.controlDir),
    assetManifestPath:
      resolve(
        runtimePaths.assetManifest,
      ),
    device: platform === "linux"
      ? "cpu"
      : "cuda",
    gpuMemoryGiB: platform === "linux"
      ? 0
      : 5.5,
    timeoutMs: 7_500,
    visualMaxCacheEntries: 8,
    textObjectConsensusEnabled: true,
    queryEvidenceAdequacyEnabled: false,
    queryPrerequisiteStaticBypassEnabled: false,
    textObjectChannelProbeEnabled: false,
    directEvidenceChannelProbeEnabled: false,
  };
}

export function mergeAgentEvidenceTextFallbackV2(
  visualInput: AgentEvidenceToolOutputV2,
  textInput: AgentEvidenceToolOutputV2,
) {
  const visual =
    AgentEvidenceToolOutputV2Schema.parse(
      visualInput,
    );
  const text =
    AgentEvidenceToolOutputV2Schema.parse(
      textInput,
    );
  if (visual.evidence.nodes.length > 0) {
    return visual;
  }
  if (text.evidence.nodes.length === 0) {
    return visual;
  }
  if (
    visual.bundle.corpusBundleHash
      !== text.bundle.corpusBundleHash
    || visual.bundle.activeIndexBundleHash
      !== text.bundle.activeIndexBundleHash
  ) {
    throw new Error(
      "AGENT_EVIDENCE_FALLBACK_IDENTITY_DRIFT",
    );
  }
  const channel = (
    output: AgentEvidenceToolOutputV2,
    id: AgentEvidenceToolOutputV2[
      "channels"
    ][number]["channel"],
  ) => {
    const found = output.channels.find(
      (candidate) =>
        candidate.channel === id,
    );
    if (!found) {
      throw new Error(
        `AGENT_EVIDENCE_FALLBACK_CHANNEL_MISSING:${id}`,
      );
    }
    return found;
  };
  const visualChannel = channel(
    visual,
    "VISUAL_VECTOR",
  );
  if (
    !["SUCCESS", "DEGRADED"].includes(
      text.bundle.status,
    )
  ) {
    throw new Error(
      "AGENT_EVIDENCE_TEXT_FALLBACK_INVALID",
    );
  }
  const binding = JSON.stringify({
    strategy:
      "TEXT_TO_IMAGE_WITH_TEXT_FALLBACK",
    visualBundleId:
      visual.bundle.bundleId,
    textBundleId: text.bundle.bundleId,
    visualQueryHash:
      visual.bundle.queryHash,
    textQueryHash: text.bundle.queryHash,
  });
  const bindingHash = createHash("sha256")
    .update(binding, "utf8")
    .digest("hex");
  const visualDegraded = [
    "UNAVAILABLE",
    "TIMEOUT",
    "ERROR",
  ].includes(visualChannel.status);
  return AgentEvidenceToolOutputV2Schema.parse({
    ...text,
    bundle: {
      ...text.bundle,
      bundleId: `evidence-${bindingHash}`,
      queryHash: bindingHash,
      status:
        visualDegraded
        || text.bundle.status === "DEGRADED"
          ? "DEGRADED"
          : "SUCCESS",
      capabilitiesLost: [
        ...new Set([
          ...text.bundle.capabilitiesLost,
          ...visual.bundle.capabilitiesLost,
        ]),
      ].sort(),
    },
    channels: [
      channel(text, "LEXICAL"),
      channel(text, "TEXT_VECTOR"),
      visualChannel,
    ],
  });
}

function portForRuntime(
  runtime: LocalMixedRuntimeV2,
  options: {
    workspaceRoot: string;
    generation?: ActiveKnowledgeGenerationV2;
    visualRetrievalEnabled: boolean;
  },
): AgentEvidenceSearchPortV2 {
  return {
    async search(input) {
      input.signal.throwIfAborted();
      const sourceCoursePack =
        CoursePackReferenceV2Schema.parse({
          id: input.coursePackId,
          version: input.coursePackVersion,
      });
      const query = createRetrievalQueryV2({
        mode: options.visualRetrievalEnabled
          ? "TEXT_TO_IMAGE"
          : "TEXT_TO_TEXT",
        text: input.query,
        scope: {
          corpusBundleHash:
            runtime.t41CandidateIdentity
              .corpusBundleHash,
          sourceCoursePack,
        },
      });
      const bundle = await runtime.retrieve(query);
      input.signal.throwIfAborted();
      const primary =
        projectEvidenceBundleForAgentV2(
        bundle,
      );
      if (
        !options.visualRetrievalEnabled
        || primary.evidence.nodes.length > 0
      ) {
        return primary;
      }
      const textQuery = createRetrievalQueryV2({
        mode: "TEXT_TO_TEXT",
        text: input.query,
        scope: {
          corpusBundleHash:
            runtime.t41CandidateIdentity
              .corpusBundleHash,
          sourceCoursePack,
        },
      });
      const textBundle =
        await runtime.retrieve(textQuery);
      input.signal.throwIfAborted();
      return mergeAgentEvidenceTextFallbackV2(
        primary,
        projectEvidenceBundleForAgentV2(
          textBundle,
        ),
      );
    },
    runtimeHealth() {
      const report = runtime.resourceReport();
      return {
        generationHash: report.generationHash,
        textCircuitState:
          report.channels.TEXT_VECTOR.state,
        visualCircuitState:
          report.channels.VISUAL_VECTOR
            ?.state ?? null,
        visualQueueDepth:
          report.sidecars.visual
            ?.queueDepth ?? 0,
        visualCacheEntries:
          report.sidecars.visual
            ?.cacheEntries ?? 0,
      };
    },
    ...(options.visualRetrievalEnabled
      ? {
          openAsset: (assetId: string) =>
            openKnowledgeAssetFileV2(
              assetId,
              {
                workspaceRoot:
                  options.workspaceRoot,
                ...(options.generation
                  ? {
                      corpusBundle:
                        options.generation.corpus,
                    }
                  : {}),
              },
            ),
        }
      : {}),
  };
}

function providerManifestPayload(
  generation: ActiveKnowledgeGenerationV2,
  model: {
    id: string;
    revision: string;
  },
) {
  const indexBundle = generation.indexBundle;
  if (!indexBundle) {
    throw new Error(
      "AGENT_EVIDENCE_ACTIVE_INDEX_REQUIRED",
    );
  }
  const sharedById = new Map(
    (indexBundle.sharedPayloads ?? [])
      .map((payload) => [payload.id, payload]),
  );
  const manifestIds = new Set(
    indexBundle.representations.flatMap(
      (representation) =>
        representation.indexVersion.modelId
          === model.id
        && representation.indexVersion.modelRevision
          === model.revision
        && representation.locator
          ? [
              representation.locator
                .manifestPayloadId,
            ]
          : [],
    ),
  );
  if (manifestIds.size !== 1) {
    throw new Error(
      `AGENT_EVIDENCE_PROVIDER_AMBIGUOUS:${model.id}:${model.revision}`,
    );
  }
  const manifest = sharedById.get(
    [...manifestIds][0]!,
  );
  if (
    !manifest
    || manifest.role !== "PROVIDER_MANIFEST"
    || !generation
      .verifiedProviderIndexBundleHashes
      .includes(manifest.providerIndexHash)
  ) {
    throw new Error(
      `AGENT_EVIDENCE_PROVIDER_NOT_VERIFIED:${model.id}:${model.revision}`,
    );
  }
  return manifest;
}

async function activeRuntimeOptions(input: {
  workspaceRoot: string;
  generation: ActiveKnowledgeGenerationV2;
  visualRetrievalEnabled: boolean;
}) {
  const base =
    fixedAgentEvidenceRuntimeOptionsV2(input.workspaceRoot);
  const textManifest = providerManifestPayload(
    input.generation,
    AGENT_EVIDENCE_RUNTIME_PROFILE_BASE_V2.textModel,
  );
  const textManifestPath =
    await resolveKnowledgeIndexStoragePathV2({
      workspaceRoot: input.workspaceRoot,
      storageKey: textManifest.storageKey,
    });
  let visualIndexDir = base.visualIndexDir;
  if (input.visualRetrievalEnabled) {
    const visualManifest = providerManifestPayload(
      input.generation,
      AGENT_EVIDENCE_RUNTIME_PROFILE_BASE_V2.visualModel,
    );
    const visualManifestPath =
      await resolveKnowledgeIndexStoragePathV2({
        workspaceRoot: input.workspaceRoot,
        storageKey: visualManifest.storageKey,
      });
    visualIndexDir =
      path.dirname(visualManifestPath);
  }
  return {
    ...base,
    textIndexDir: path.dirname(textManifestPath),
    visualIndexDir,
    activeGeneration: input.generation,
    visualRetrievalEnabled:
      input.visualRetrievalEnabled,
  } satisfies LocalMixedRuntimeV2Options;
}

type RuntimeManagerDependencies = {
  createRuntime:
    typeof createLocalMixedRuntimeV2;
  createLoader:
    typeof createActiveKnowledgeGenerationLoaderV2;
};

export function createAgentEvidenceRuntimeManagerV2(
  dependencies: RuntimeManagerDependencies = {
    createRuntime: createLocalMixedRuntimeV2,
    createLoader:
      createActiveKnowledgeGenerationLoaderV2,
  },
) {
  const cache: RuntimeCache = new Map();
  const loaders = new WeakMap<
    DatabaseConnection,
    Map<string, ActiveKnowledgeGenerationLoaderV2>
  >();
  const inMemoryDatabaseIds =
    new WeakMap<DatabaseConnection, string>();

  const databaseIdentity = (
    connection: DatabaseConnection,
  ) => {
    const rows = connection.sqlite.prepare(
      "PRAGMA database_list",
    ).all() as Array<{
      name: string;
      file: string;
    }>;
    const file = rows.find(
      ({ name }) => name === "main",
    )?.file;
    let identity = file?.trim();
    if (!identity) {
      identity =
        inMemoryDatabaseIds.get(connection);
      if (!identity) {
        identity =
          `memory:${randomUUID()}`;
        inMemoryDatabaseIds.set(
          connection,
          identity,
        );
      }
    }
    return createHash("sha256")
      .update(
        identity.startsWith("memory:")
          ? identity
          : path.resolve(identity),
      )
      .digest("hex");
  };

  const loaderFor = (input: {
    connection: DatabaseConnection;
    workspaceRoot: string;
    visualRetrievalEnabled: boolean;
  }) => {
    const byProfile =
      loaders.get(input.connection)
      ?? new Map();
    loaders.set(input.connection, byProfile);
    const profileKey = [
      input.workspaceRoot,
      input.visualRetrievalEnabled
        ? "VISUAL"
        : "TEXT_ONLY",
    ].join(":");
    const existing = byProfile.get(profileKey);
    if (existing) return existing;
    const requiredProviderModels = [
      AGENT_EVIDENCE_RUNTIME_PROFILE_BASE_V2
        .textModel,
      ...(input.visualRetrievalEnabled
        ? [
            AGENT_EVIDENCE_RUNTIME_PROFILE_BASE_V2
              .visualModel,
          ]
        : []),
    ].map(({ id, revision }) => ({
      modelId: id,
      modelRevision: revision,
    }));
    const loader = dependencies.createLoader({
      connection: input.connection,
      workspaceRoot: input.workspaceRoot,
      requiredProviderModels,
      ...(process.platform === "linux"
        ? { requireLegacyProjection: false }
        : {}),
    });
    byProfile.set(profileKey, loader);
    return loader;
  };

  const get = async (options: {
    connection: DatabaseConnection;
    workspaceRoot?: string;
    visualRetrievalEnabled: boolean;
  }) => {
    const resolvedRoot = path.resolve(
      options.workspaceRoot ?? process.cwd(),
    );
    const generation = await loaderFor({
      connection: options.connection,
      workspaceRoot: resolvedRoot,
      visualRetrievalEnabled:
        options.visualRetrievalEnabled,
    }).load();
    const profile =
      agentEvidenceRuntimeProfileV2();
    const key = [
      databaseIdentity(options.connection),
      generation.generationKey,
      options.visualRetrievalEnabled
        ? "VISUAL"
        : "TEXT_ONLY",
      profile.hash,
    ].join(":");
    const current = cache.get(key);
    if (current) {
      return (await current.pending).port;
    }
    const pending = (async () => {
      const runtimeOptions =
        await activeRuntimeOptions({
          workspaceRoot: resolvedRoot,
          generation,
          visualRetrievalEnabled:
            options.visualRetrievalEnabled,
        });
      const runtime =
        await dependencies.createRuntime(
          runtimeOptions,
        );
      return {
        runtime,
        port: portForRuntime(runtime, {
          workspaceRoot: resolvedRoot,
          generation,
          visualRetrievalEnabled:
            options.visualRetrievalEnabled,
        }),
      };
    })();
    const entry = {
      workspaceRoot: resolvedRoot,
      pending,
    };
    cache.set(key, entry);
    try {
      return (await pending).port;
    } catch (error) {
      if (cache.get(key) === entry) {
        cache.delete(key);
      }
      throw error;
    }
  };

  const getFixed = async (
    workspaceRoot = process.cwd(),
  ) => {
    const resolvedRoot =
      path.resolve(workspaceRoot);
    const profile =
      agentEvidenceRuntimeProfileV2();
    const key =
      `FIXED:${resolvedRoot}:${profile.hash}`;
    const current = cache.get(key);
    if (current) {
      return (await current.pending).port;
    }
    const pending = (async () => {
      const runtime =
        await dependencies.createRuntime(
          fixedAgentEvidenceRuntimeOptionsV2(resolvedRoot),
        );
      return {
        runtime,
        port: portForRuntime(runtime, {
          workspaceRoot: resolvedRoot,
          visualRetrievalEnabled: true,
        }),
      };
    })();
    const entry = {
      workspaceRoot: resolvedRoot,
      pending,
    };
    cache.set(key, entry);
    try {
      return (await pending).port;
    } catch (error) {
      if (cache.get(key) === entry) {
        cache.delete(key);
      }
      throw error;
    }
  };

  const dispose = async (
    workspaceRoot = process.cwd(),
  ) => {
    const resolvedRoot =
      path.resolve(workspaceRoot);
    const entries = [...cache.entries()]
      .filter(([, entry]) =>
        entry.workspaceRoot === resolvedRoot);
    for (const [key] of entries) {
      cache.delete(key);
    }
    await Promise.all(entries.map(
      async ([, entry]) => {
        const { runtime } =
          await entry.pending;
        await runtime.dispose();
      },
    ));
  };

  const resourceReport = async (
    workspaceRoot = process.cwd(),
  ) => {
    const resolvedRoot =
      path.resolve(workspaceRoot);
    const entries = [...cache.values()]
      .filter((entry) =>
        entry.workspaceRoot === resolvedRoot);
    const runtimes = await Promise.all(
      entries.map(async (entry) =>
        (await entry.pending).runtime
          .resourceReport()),
    );
    return {
      schemaVersion: 2 as const,
      runtimeCacheEntries: entries.length,
      runtimes,
    };
  };

  return {
    get,
    getFixed,
    dispose,
    resourceReport,
  };
}

const defaultRuntimeManager =
  createAgentEvidenceRuntimeManagerV2();

export function getAgentEvidenceSearchPortV2(
  options: {
    connection: DatabaseConnection;
    workspaceRoot?: string;
    visualRetrievalEnabled: boolean;
  },
) {
  return defaultRuntimeManager.get(options);
}

export function getFixedAgentEvidenceSearchPortV2ForAudit(
  workspaceRoot = process.cwd(),
) {
  return defaultRuntimeManager.getFixed(
    workspaceRoot,
  );
}

export async function disposeAgentEvidenceRuntimeV2(
  workspaceRoot = process.cwd(),
) {
  await defaultRuntimeManager.dispose(
    workspaceRoot,
  );
}

export function getAgentEvidenceRuntimeResourceReportV2(
  workspaceRoot = process.cwd(),
) {
  return defaultRuntimeManager.resourceReport(
    workspaceRoot,
  );
}

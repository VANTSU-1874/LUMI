import { createHash } from "node:crypto";

import type { DatabaseConnection } from "@/lib/db/client";

import { verifyKnowledgeIndexPayloadsV2 } from "./knowledge-index-v2";
import {
  stableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  verifyKnowledgeIndexBundleV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeIndexBundleV2,
} from "./knowledge-object-v2";
import { auditKnowledgeV2Storage } from "./knowledge-v2-store";

type ActivePointerSnapshot = {
  corpusHash: string;
  corpusCanonicalJson: string;
  indexBundleHash: string | null;
  indexCanonicalJson: string | null;
};

type StoredIndexVersion = {
  id: string;
  configJson: string;
  configHash: string;
};

type StoredIndexEntry = {
  id: string;
  representationJson: string;
  manifestPayloadId: string | null;
  tensorPayloadId: string | null;
  locatorJson: string | null;
};

type StoredSharedPayload = {
  id: string;
  role: string;
  format: string;
  providerIndexHash: string | null;
  storageKind: string;
  storageKey: string;
  byteLength: number;
  payloadSha256: string;
  tensorLayoutJson: string | null;
};

export type ActiveKnowledgeGenerationV2 = Readonly<{
  generationKey: string;
  corpus: KnowledgeCorpusBundleV2;
  indexBundle: KnowledgeIndexBundleV2 | null;
  indexConfigsByVersionId: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  activeIndexBundleHash: string | null;
  providerIndexBundleHashes: Readonly<Record<string, string>>;
  verifiedProviderIndexBundleHashes:
    readonly string[];
}>;

export type ActiveKnowledgeGenerationLoaderV2 = {
  load(): Promise<ActiveKnowledgeGenerationV2>;
  clear(): void;
};

type PayloadVerifier = typeof verifyKnowledgeIndexPayloadsV2;

function parseJson(value: string, code: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(code);
  }
}

function sha256Stable(value: unknown) {
  return createHash("sha256").update(stableJsonV2(value)).digest("hex");
}

function readActivePointerSnapshot(
  connection: DatabaseConnection,
): ActivePointerSnapshot {
  return connection.sqlite.transaction(() => {
    const activeCorpora = connection.sqlite.prepare(`
      SELECT a.bundle_hash corpusHash,c.canonical_json corpusCanonicalJson
      FROM knowledge_active_corpus_v2 a
      JOIN knowledge_corpora_v2 c ON c.bundle_hash=a.bundle_hash
      ORDER BY a.id
    `).all() as Array<{
      corpusHash: string;
      corpusCanonicalJson: string;
    }>;
    if (activeCorpora.length !== 1) {
      throw new Error(
        `KNOWLEDGE_V2_ACTIVE_GENERATION_CORPUS_COUNT:${activeCorpora.length}`,
      );
    }
    const activeIndexes = connection.sqlite.prepare(`
      SELECT a.corpus_hash corpusHash,a.index_bundle_hash indexBundleHash,
        b.canonical_json indexCanonicalJson
      FROM knowledge_active_index_bundle_v2 a
      LEFT JOIN knowledge_index_bundles_v2 b
        ON b.index_bundle_hash=a.index_bundle_hash
       AND b.corpus_hash=a.corpus_hash
      ORDER BY a.id
    `).all() as Array<{
      corpusHash: string;
      indexBundleHash: string;
      indexCanonicalJson: string | null;
    }>;
    if (activeIndexes.length > 1) {
      throw new Error(
        `KNOWLEDGE_V2_ACTIVE_GENERATION_INDEX_COUNT:${activeIndexes.length}`,
      );
    }
    const corpus = activeCorpora[0]!;
    const index = activeIndexes[0];
    if (index && index.indexCanonicalJson === null) {
      throw new Error("KNOWLEDGE_V2_ACTIVE_GENERATION_INDEX_TARGET_MISSING");
    }
    if (index && index.corpusHash !== corpus.corpusHash) {
      throw new Error("KNOWLEDGE_V2_ACTIVE_GENERATION_CORPUS_INDEX_MISMATCH");
    }
    return {
      corpusHash: corpus.corpusHash,
      corpusCanonicalJson: corpus.corpusCanonicalJson,
      indexBundleHash: index?.indexBundleHash ?? null,
      indexCanonicalJson: index?.indexCanonicalJson ?? null,
    };
  })();
}

function generationKey(snapshot: ActivePointerSnapshot) {
  return `${snapshot.corpusHash}:${snapshot.indexBundleHash ?? "NO_INDEX"}`;
}

function assertStoredIndexRows(
  connection: DatabaseConnection,
  indexBundle: KnowledgeIndexBundleV2,
) {
  const bundleRows = connection.sqlite.prepare(`
    SELECT representation_count representationCount,
      shared_payload_count sharedPayloadCount,canonical_json canonicalJson
    FROM knowledge_index_bundles_v2 WHERE index_bundle_hash=?
  `).all(indexBundle.indexBundleHash) as Array<{
    representationCount: number;
    sharedPayloadCount: number;
    canonicalJson: string;
  }>;
  const expectedBundleRows = [{
    representationCount: indexBundle.representations.length,
    sharedPayloadCount: indexBundle.sharedPayloads?.length ?? 0,
    canonicalJson: stableJsonV2(indexBundle),
  }];
  if (stableJsonV2(bundleRows) !== stableJsonV2(expectedBundleRows)) {
    throw new Error("KNOWLEDGE_V2_ACTIVE_INDEX_BUNDLE_ROW_DRIFT");
  }

  const versions = connection.sqlite.prepare(`
    SELECT id,config_json configJson,config_hash configHash
    FROM knowledge_index_versions_v2
    WHERE index_bundle_hash=? ORDER BY id
  `).all(indexBundle.indexBundleHash) as StoredIndexVersion[];
  const expectedVersions = new Map(
    indexBundle.representations.map(({ indexVersion }) => [
      indexVersion.id,
      indexVersion.configHash,
    ]),
  );
  if (
    versions.length !== expectedVersions.size
    || versions.some(({ id, configJson, configHash }) => {
      const parsed = parseJson(
        configJson,
        `KNOWLEDGE_V2_ACTIVE_INDEX_CONFIG_JSON_INVALID:${id}`,
      );
      return expectedVersions.get(id) !== configHash
        || sha256Stable(parsed) !== configHash
        || stableJsonV2(parsed) !== configJson;
    })
  ) {
    throw new Error("KNOWLEDGE_V2_ACTIVE_INDEX_VERSION_ROW_DRIFT");
  }

  const entries = connection.sqlite.prepare(`
    SELECT id,representation_json representationJson,
      manifest_payload_id manifestPayloadId,
      tensor_payload_id tensorPayloadId,locator_json locatorJson
    FROM knowledge_index_entries_v2
    WHERE index_bundle_hash=? ORDER BY id
  `).all(indexBundle.indexBundleHash) as StoredIndexEntry[];
  const expectedEntries = indexBundle.representations
    .map((representation) => ({
      id: representation.id,
      representationJson: stableJsonV2(representation),
      manifestPayloadId: representation.locator?.manifestPayloadId ?? null,
      tensorPayloadId: representation.locator?.tensorPayloadId ?? null,
      locatorJson: representation.locator === undefined
        ? null
        : stableJsonV2(representation.locator),
    }))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (stableJsonV2(entries) !== stableJsonV2(expectedEntries)) {
    throw new Error("KNOWLEDGE_V2_ACTIVE_INDEX_ENTRY_ROW_DRIFT");
  }

  const payloads = connection.sqlite.prepare(`
    SELECT id,role,format,provider_index_hash providerIndexHash,
      storage_kind storageKind,storage_key storageKey,byte_length byteLength,
      payload_sha256 payloadSha256,tensor_layout_json tensorLayoutJson
    FROM knowledge_index_payloads_v2
    WHERE index_bundle_hash=? ORDER BY id
  `).all(indexBundle.indexBundleHash) as StoredSharedPayload[];
  const expectedPayloads = (indexBundle.sharedPayloads ?? [])
    .map((payload) => ({
      id: payload.id,
      role: payload.role,
      format: payload.format,
      providerIndexHash: payload.role === "PROVIDER_MANIFEST"
        ? payload.providerIndexHash
        : null,
      storageKind: payload.storageKind,
      storageKey: payload.storageKey,
      byteLength: payload.byteLength,
      payloadSha256: payload.sha256,
      tensorLayoutJson: payload.role === "VECTOR_TENSORS"
        ? stableJsonV2(payload.tensors)
        : null,
    }))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (stableJsonV2(payloads) !== stableJsonV2(expectedPayloads)) {
    throw new Error("KNOWLEDGE_V2_ACTIVE_INDEX_PAYLOAD_ROW_DRIFT");
  }

  return Object.freeze(Object.fromEntries(
    versions.map(({ id, configJson }) => [
      id,
      deepFreeze(parseJson(
        configJson,
        `KNOWLEDGE_V2_ACTIVE_INDEX_CONFIG_JSON_INVALID:${id}`,
      ) as Record<string, unknown>),
    ]),
  ));
}

function providerIndexBundleHashes(indexBundle: KnowledgeIndexBundleV2) {
  return Object.freeze(Object.fromEntries(
    (indexBundle.sharedPayloads ?? [])
      .flatMap((payload) =>
        payload.role === "PROVIDER_MANIFEST"
          ? [[payload.id, payload.providerIndexHash] as const]
          : [])
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
  ));
}

function requiredProviderIndexHashes(
  indexBundle: KnowledgeIndexBundleV2,
  requiredModels: readonly {
    modelId: string;
    modelRevision: string;
  }[],
) {
  const sharedPayloadsById = new Map(
    (indexBundle.sharedPayloads ?? [])
      .map((payload) => [payload.id, payload]),
  );
  const selected = requiredModels.map(
    ({ modelId, modelRevision }) => {
      const hashes = new Set(
        indexBundle.representations.flatMap(
          (representation) => {
            if (
              representation.indexVersion.modelId
                !== modelId
              || representation.indexVersion.modelRevision
                !== modelRevision
              || !representation.locator
            ) return [];
            const manifest = sharedPayloadsById.get(
              representation.locator
                .manifestPayloadId,
            );
            return manifest?.role === "PROVIDER_MANIFEST"
              ? [manifest.providerIndexHash]
              : [];
          },
        ),
      );
      if (hashes.size !== 1) {
        throw new Error(
          `KNOWLEDGE_V2_ACTIVE_PROVIDER_MODEL_AMBIGUOUS:${modelId}:${modelRevision}`,
        );
      }
      return [...hashes][0]!;
    },
  );
  return Object.freeze(
    [...new Set(selected)].sort(),
  );
}

function sameActivePointers(
  left: ActivePointerSnapshot,
  right: ActivePointerSnapshot,
) {
  return left.corpusHash === right.corpusHash
    && left.indexBundleHash === right.indexBundleHash;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

export function createActiveKnowledgeGenerationLoaderV2(input: {
  connection: DatabaseConnection;
  workspaceRoot: string;
  /**
   * Keep legacy parity mandatory by default. Isolated formal-V2 storage that
   * was intentionally materialized without a legacy Markdown projection must
   * declare this boundary at its loader entry point.
   */
  requireLegacyProjection?: boolean;
  payloadVerifier?: PayloadVerifier;
  maxPointerRetries?: 0 | 1;
  requiredProviderModels?: readonly {
    modelId: string;
    modelRevision: string;
  }[];
}): ActiveKnowledgeGenerationLoaderV2 {
  const cache = new Map<string, ActiveKnowledgeGenerationV2>();
  const verifyPayloads = input.payloadVerifier ?? verifyKnowledgeIndexPayloadsV2;
  const maxPointerRetries = input.maxPointerRetries ?? 1;

  return {
    async load() {
      for (let attempt = 0; attempt <= maxPointerRetries; attempt += 1) {
        const before = readActivePointerSnapshot(input.connection);
        const key = generationKey(before);
        const cached = cache.get(key);
        if (cached) return cached;

        let corpus: KnowledgeCorpusBundleV2;
        let indexBundle: KnowledgeIndexBundleV2 | null = null;
        let configs: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
        let verifiedProviderHashes:
          readonly string[] = Object.freeze([]);
        try {
          corpus = verifyKnowledgeCorpusBundleV2(parseJson(
            before.corpusCanonicalJson,
            "KNOWLEDGE_V2_ACTIVE_CORPUS_JSON_INVALID",
          ));
          if (corpus.bundleHash !== before.corpusHash) {
            throw new Error("KNOWLEDGE_V2_ACTIVE_CORPUS_HASH_DRIFT");
          }
          auditKnowledgeV2Storage(input.connection, corpus, {
            requireActive: true,
            requireLegacyProjection: input.requireLegacyProjection,
          });

          configs = Object.freeze({});
          if (before.indexBundleHash !== null) {
            if (before.indexCanonicalJson === null) {
              throw new Error("KNOWLEDGE_V2_ACTIVE_INDEX_JSON_MISSING");
            }
            indexBundle = verifyKnowledgeIndexBundleV2(parseJson(
              before.indexCanonicalJson,
              "KNOWLEDGE_V2_ACTIVE_INDEX_JSON_INVALID",
            ), corpus);
            if (indexBundle.indexBundleHash !== before.indexBundleHash) {
              throw new Error("KNOWLEDGE_V2_ACTIVE_INDEX_HASH_DRIFT");
            }
            configs = assertStoredIndexRows(input.connection, indexBundle);
            verifiedProviderHashes =
              input.requiredProviderModels
                ? requiredProviderIndexHashes(
                    indexBundle,
                    input.requiredProviderModels,
                  )
                : Object.freeze(
                    Object.values(
                      providerIndexBundleHashes(
                        indexBundle,
                      ),
                    ).sort(),
                  );
            indexBundle = await verifyPayloads({
              workspaceRoot: input.workspaceRoot,
              indexBundle,
              corpusBundle: corpus,
              ...(input.requiredProviderModels
                ? {
                    providerIndexHashes:
                      verifiedProviderHashes,
                  }
                : {}),
            });
          } else if (
            (input.requiredProviderModels?.length ?? 0)
              > 0
          ) {
            throw new Error(
              "KNOWLEDGE_V2_ACTIVE_INDEX_REQUIRED",
            );
          }
        } catch (error) {
          const afterFailure = readActivePointerSnapshot(input.connection);
          if (!sameActivePointers(before, afterFailure) && attempt < maxPointerRetries) {
            continue;
          }
          throw error;
        }

        const after = readActivePointerSnapshot(input.connection);
        if (!sameActivePointers(before, after)) {
          if (attempt < maxPointerRetries) continue;
          throw new Error("KNOWLEDGE_V2_ACTIVE_GENERATION_POINTER_CHANGED");
        }
        const generation = deepFreeze({
          generationKey: key,
          corpus,
          indexBundle,
          indexConfigsByVersionId: configs,
          activeIndexBundleHash: before.indexBundleHash,
          providerIndexBundleHashes: indexBundle
            ? providerIndexBundleHashes(indexBundle)
            : Object.freeze({}),
          verifiedProviderIndexBundleHashes:
            verifiedProviderHashes,
        } satisfies ActiveKnowledgeGenerationV2);
        cache.set(key, generation);
        return generation;
      }
      throw new Error("KNOWLEDGE_V2_ACTIVE_GENERATION_RETRY_EXHAUSTED");
    },
    clear() {
      cache.clear();
    },
  };
}

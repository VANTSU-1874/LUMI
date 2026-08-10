// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { retrieveCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import {
  auditKnowledgeV2Storage,
  deactivateKnowledgeV2Storage,
  ingestPreparedKnowledgeV2,
  prepareKnowledgeV2Ingestion,
  storeKnowledgeIndexBundleV2,
  type PreparedKnowledgeV2Ingestion,
} from "@/lib/knowledge/knowledge-v2-store";
import {
  sealKnowledgeIndexBundleV2,
  sha256StableJsonV2,
  stableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";

const roots: string[] = [];

function knowledgeState(connection: DatabaseConnection) {
  const tables = [
    "knowledge_chunks",
    "knowledge_corpora_v2",
    "knowledge_active_corpus_v2",
    "knowledge_documents_v2",
    "knowledge_nodes_v2",
    "knowledge_assets_v2",
    "knowledge_document_assets_v2",
    "knowledge_node_relations_v2",
    "knowledge_annotations_v2",
    "knowledge_annotation_inputs_v2",
    "knowledge_index_bundles_v2",
    "knowledge_index_versions_v2",
    "knowledge_index_payloads_v2",
    "knowledge_index_entries_v2",
    "knowledge_active_index_bundle_v2",
  ];
  return stableJsonV2(Object.fromEntries(tables.map((table) => [
    table,
    connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ])));
}

describe("KnowledgeObjectV2 storage and atomic dual write", () => {
  let root: string;
  let connection: DatabaseConnection;
  let prepared: PreparedKnowledgeV2Ingestion;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lumi-knowledge-v2-store-"));
    roots.push(root);
    const databasePath = path.join(root, "knowledge.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    prepared = await prepareKnowledgeV2Ingestion(process.cwd());
  });

  afterEach(async () => {
    connection?.sqlite.close();
    await Promise.all(roots.splice(0).map((entry) =>
      rm(entry, { recursive: true, force: true })));
  });

  it("stores all versioned objects, graph edges, assets and annotation inputs idempotently", () => {
    const first = ingestPreparedKnowledgeV2(connection, prepared, { now: 100 });
    expect(first.total).toBe(116);
    expect(first.v2).toMatchObject({
      documentCount: 116,
      nodeCount: 1704,
      assetCount: 156,
      documentAssetCount: 156,
      relationCount: 1588,
      parentChildRelationCount: 1588,
      relatedRelationCount: 0,
      annotationCount: 156,
      annotationInputCount: 468,
      explicitlyUnreferencedAssetCount: 0,
      legacyChunkCount: 116,
      activeCorpusCount: 1,
      indexBundleCount: 0,
      indexVersionCount: 0,
      indexPayloadCount: 0,
      indexEntryCount: 0,
      activeIndexBundleCount: 0,
      bySourceCoursePack: {
        "book-design": 10,
        "brand-vi-design": 2,
        "digital-interaction": 21,
        "general-design": 9,
        "layout-design": 74,
      },
      byLegacyCoursePack: {
        "book-design": 63,
        "brand-vi-design": 2,
        "digital-interaction": 21,
        "general-design": 9,
        "layout-design": 21,
      },
    });
    const firstState = knowledgeState(connection);
    const second = ingestPreparedKnowledgeV2(connection, prepared, { now: 200 });
    expect(second.v2).toMatchObject({
      documentCount: 116,
      nodeCount: 1704,
      assetCount: 156,
      annotationCount: 156,
      legacyChunkCount: 116,
      activeCorpusCount: 1,
      preActivation: { activeCorpusCount: 1 },
    });
    expect(knowledgeState(connection)).toBe(firstState);
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("rolls old and V2 writes back together when a fault occurs between them", () => {
    expect(() => ingestPreparedKnowledgeV2(connection, prepared, {
      afterLegacyWrite: () => {
        throw new Error("simulated dual-write failure");
      },
    })).toThrow(/simulated dual-write failure/);
    expect(connection.sqlite.prepare(
      "SELECT count(*) count FROM knowledge_chunks",
    ).get()).toEqual({ count: 0 });
    expect(connection.sqlite.prepare(
      "SELECT count(*) count FROM knowledge_corpora_v2",
    ).get()).toEqual({ count: 0 });
    expect(connection.sqlite.prepare(
      "SELECT count(*) count FROM knowledge_active_corpus_v2",
    ).get()).toEqual({ count: 0 });
  });

  it("keeps stable logical ids across corpus generations and rejects same-version drift", () => {
    ingestPreparedKnowledgeV2(connection, prepared, { now: 100 });
    const nextCorpusHash = "f".repeat(64);
    connection.sqlite.prepare(`
      INSERT INTO knowledge_corpora_v2(
        bundle_hash,schema_version,corpus_version,parser_id,parser_version,
        content_version,object_count,asset_count,canonical_json,created_at
      ) VALUES(?,2,'2026-07-28.2','test-parser','2.0.0',
        'knowledge-object-v2.2',1,0,'{}',200)
    `).run(nextCorpusHash);
    connection.sqlite.prepare(`
      INSERT INTO knowledge_documents_v2(
        corpus_hash,id,title,topic,tags_json,source_course_pack_id,
        source_course_pack_version,source_identity_basis,legacy_course_pack_id,
        legacy_course_pack_version,legacy_namespace,provenance_json,parser_id,
        parser_version,content_version,root_node_id,content_hash,annotation_hash,
        legacy_item_json,canonical_json
      )
      SELECT ?,id,title,topic,tags_json,source_course_pack_id,
        source_course_pack_version,source_identity_basis,legacy_course_pack_id,
        legacy_course_pack_version,legacy_namespace,provenance_json,parser_id,
        parser_version,content_version,root_node_id,content_hash,annotation_hash,
        legacy_item_json,canonical_json
      FROM knowledge_documents_v2
      WHERE corpus_hash=? AND id=?
    `).run(
      nextCorpusHash,
      prepared.bundle.bundleHash,
      prepared.bundle.objects[0]!.id,
    );
    expect(connection.sqlite.prepare(`
      SELECT count(*) count FROM knowledge_documents_v2
      WHERE id=?
    `).get(prepared.bundle.objects[0]!.id)).toEqual({ count: 2 });
    expect(() => connection.sqlite.prepare(`
      INSERT INTO knowledge_corpora_v2(
        bundle_hash,schema_version,corpus_version,parser_id,parser_version,
        content_version,object_count,asset_count,canonical_json,created_at
      ) VALUES(?,2,?,'test-parser','2.0.0',
        'knowledge-object-v2.2',1,0,'{}',300)
    `).run("e".repeat(64), prepared.bundle.corpusVersion))
      .toThrow(/knowledge_corpora_v2\.corpus_version|UNIQUE constraint/i);
  });

  it("detects a broken graph before activation and leaves the legacy fallback usable", () => {
    ingestPreparedKnowledgeV2(connection, prepared);
    connection.sqlite.prepare(`
      DELETE FROM knowledge_node_relations_v2
      WHERE corpus_hash=? AND kind='PARENT_CHILD'
        AND rowid=(
          SELECT min(rowid) FROM knowledge_node_relations_v2
          WHERE corpus_hash=? AND kind='PARENT_CHILD'
        )
    `).run(prepared.bundle.bundleHash, prepared.bundle.bundleHash);
    expect(() => auditKnowledgeV2Storage(connection, prepared.bundle))
      .toThrow(/RELATION_DRIFT|PARENT_CARDINALITY|UNREACHABLE_NODE/);

    const rollback = deactivateKnowledgeV2Storage(connection);
    expect(rollback).toMatchObject({
      activeCorpora: 1,
      activeIndexes: 0,
      legacyChunkCount: 116,
    });
    expect(retrieveCoursePackKnowledge(
      connection,
      "layout-design",
      "1",
      "版面内容很多排起来很乱",
    )[0]?.topic).toBe("LAYOUT_DESIGN_PRINCIPLES");
  });

  it("rejects a global active-index pointer for a different active corpus", () => {
    ingestPreparedKnowledgeV2(connection, prepared, { now: 100 });
    connection.sqlite.pragma("foreign_keys = OFF");
    connection.sqlite.prepare(`
      INSERT INTO knowledge_active_index_bundle_v2(
        id,corpus_hash,index_bundle_hash,activated_at
      ) VALUES(1,?,?,200)
    `).run("f".repeat(64), "e".repeat(64));
    connection.sqlite.pragma("foreign_keys = ON");

    expect(() => auditKnowledgeV2Storage(connection, prepared.bundle, {
      requireActive: true,
    })).toThrow(/ACTIVE_INDEX_CORPUS_MISMATCH/);
  });

  it("stores an index generation by bundle and activates the whole generation atomically", async () => {
    ingestPreparedKnowledgeV2(connection, prepared, { now: 100 });
    const config = { tokenizer: "unicode-ngram-v1" };
    const target = prepared.bundle.objects[0]!;
    const payloadBytes = Buffer.from("a");
    const payloadStorageKey = "data/knowledge-index/lexical-v1.json";
    await mkdir(path.join(root, "data", "knowledge-index"), {
      recursive: true,
    });
    await writeFile(path.join(root, payloadStorageKey), payloadBytes);
    const indexBundle = sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: prepared.bundle.bundleHash,
      representations: [{
        schemaVersion: 2,
        id: "lexical-object-0001",
        target: { kind: "OBJECT", id: target.id },
        channel: "LEXICAL",
        inputs: [{ kind: "TARGET", hash: target.contentHash }],
        indexVersion: {
          id: "lexical-v1",
          builderId: "lumi-lexical-index",
          builderVersion: "1.0.0",
          modelId: null,
          modelRevision: null,
          configHash: sha256StableJsonV2(config),
        },
        dimensions: null,
        vectorCount: 1,
        payload: {
          storageKind: "CONTROLLED_FILE",
          storageKey: payloadStorageKey,
          byteLength: payloadBytes.byteLength,
          sha256: createHash("sha256").update(payloadBytes).digest("hex"),
        },
      }],
    }, prepared.bundle);
    await expect(storeKnowledgeIndexBundleV2(
      connection,
      prepared.bundle,
      indexBundle,
      {
        configsByVersionId: { "lexical-v1": config },
        activate: true,
        now: 200,
        workspaceRoot: root,
      },
    )).resolves.toEqual({
      indexBundleHash: indexBundle.indexBundleHash,
      representationCount: 1,
      versionCount: 1,
      active: true,
    });
    const firstState = knowledgeState(connection);
    await storeKnowledgeIndexBundleV2(connection, prepared.bundle, indexBundle, {
      configsByVersionId: { "lexical-v1": config },
      activate: true,
      now: 300,
      workspaceRoot: root,
    });
    expect(knowledgeState(connection)).toBe(firstState);
    expect(auditKnowledgeV2Storage(connection, prepared.bundle, {
      requireActive: true,
    })).toMatchObject({
      indexBundleCount: 1,
      indexVersionCount: 1,
      indexPayloadCount: 0,
      indexEntryCount: 1,
      activeIndexBundleCount: 1,
    });
  }, 15_000);

  it("stores one active control-plane bundle over two provider indexes and shared payloads", async () => {
    ingestPreparedKnowledgeV2(connection, prepared, { now: 100 });
    const textConfig = { pooling: "CLS", dimensions: 512 };
    const visualConfig = { aggregation: "MAX_REGION", dimensions: 768 };
    const textProviderHash = "b".repeat(64);
    const visualProviderHash = "c".repeat(64);
    const textTensorBytes = Buffer.from("shared-bge-tensors");
    const visualTensorBytes = Buffer.from("shared-siglip-tensors");
    const textTarget = prepared.bundle.objects[0]!;
    const visualTarget = prepared.bundle.assets[0]!;
    const visualOwner = prepared.bundle.objects.find((object) =>
      object.nodes.some((node) =>
        node.kind === "IMAGE" && node.assetId === visualTarget.id))!;
    const payloadInputs = [
      {
        id: "bge-manifest",
        role: "PROVIDER_MANIFEST" as const,
        format: "JSON" as const,
        providerIndexHash: textProviderHash,
        storageKey: "data/knowledge-index/bge/manifest.json",
        bytes: Buffer.from(JSON.stringify({
          identity: {
            corpusBundleHash: prepared.bundle.bundleHash,
            indexBundleHash: textProviderHash,
            indexVersionId: "bge-v1",
            modelId: "BAAI/bge-small-zh-v1.5",
            modelRevision: "immutable-bge-revision",
          },
          dimensions: 512,
          recordCount: 1,
          entries: [{
            representationId: "bge-object-0001",
            target: { kind: "OBJECT", id: textTarget.id },
            objectId: textTarget.id,
            coursePackId: textTarget.sourceCoursePack.id,
            tensorOffset: 0,
          }],
          payload: {
            fileName: "embeddings.safetensors",
            sha256: createHash("sha256").update(textTensorBytes).digest("hex"),
            byteLength: textTensorBytes.byteLength,
            tensorKey: "embeddings",
            shape: [1, 512],
          },
        })),
      },
      {
        id: "bge-tensors",
        role: "VECTOR_TENSORS" as const,
        format: "SAFETENSORS" as const,
        storageKey: "data/knowledge-index/bge/embeddings.safetensors",
        bytes: textTensorBytes,
        tensors: [{ key: "embeddings", dimensions: 512, vectorCount: 1 }],
      },
      {
        id: "siglip-manifest",
        role: "PROVIDER_MANIFEST" as const,
        format: "JSON" as const,
        providerIndexHash: visualProviderHash,
        storageKey: "data/knowledge-index/siglip/manifest.json",
        bytes: Buffer.from(JSON.stringify({
          identity: {
            corpusBundleHash: prepared.bundle.bundleHash,
            indexBundleHash: visualProviderHash,
            indexVersionId: "siglip-v1",
            modelId: "google/siglip2-base-patch16-224",
            modelRevision: "immutable-siglip-revision",
          },
          adapter: { dimensions: 768 },
          regionCount: 306,
          entries: [{
            representationId: "siglip-asset-0001",
            assetId: visualTarget.id,
            objectId: visualOwner.id,
            coursePackId: visualOwner.sourceCoursePack.id,
            sourceSha256: visualTarget.sha256,
            regions: [{
              tensorKey: "embeddings",
              vectorOffset: 10,
              vectorCount: 2,
            }],
          }],
          payload: {
            filename: "embeddings.safetensors",
            sha256: createHash("sha256").update(visualTensorBytes).digest("hex"),
            sizeBytes: visualTensorBytes.byteLength,
            tensorKey: "embeddings",
          },
        })),
      },
      {
        id: "siglip-tensors",
        role: "VECTOR_TENSORS" as const,
        format: "SAFETENSORS" as const,
        storageKey: "data/knowledge-index/siglip/embeddings.safetensors",
        bytes: visualTensorBytes,
        tensors: [{ key: "embeddings", dimensions: 768, vectorCount: 306 }],
      },
    ];
    for (const payload of payloadInputs) {
      const target = path.join(root, payload.storageKey);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, payload.bytes);
    }
    const sharedPayloads = payloadInputs.map((payload) => ({
      schemaVersion: 2 as const,
      id: payload.id,
      role: payload.role,
      format: payload.format,
      ...("providerIndexHash" in payload
        ? { providerIndexHash: payload.providerIndexHash }
        : {}),
      storageKind: "CONTROLLED_FILE" as const,
      storageKey: payload.storageKey,
      byteLength: payload.bytes.byteLength,
      sha256: createHash("sha256").update(payload.bytes).digest("hex"),
      ...("tensors" in payload ? { tensors: payload.tensors } : {}),
    }));
    const indexBundle = sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: prepared.bundle.bundleHash,
      sharedPayloads,
      representations: [
        {
          schemaVersion: 2,
          id: "bge-object-0001",
          target: { kind: "OBJECT", id: textTarget.id },
          channel: "TEXT_VECTOR",
          inputs: [{ kind: "TARGET", hash: textTarget.contentHash }],
          indexVersion: {
            id: "bge-v1",
            builderId: "bge-index-builder",
            builderVersion: "1.0.0",
            modelId: "BAAI/bge-small-zh-v1.5",
            modelRevision: "immutable-bge-revision",
            configHash: sha256StableJsonV2(textConfig),
          },
          dimensions: 512,
          vectorCount: 1,
          locator: {
            kind: "SHARED_TENSOR_SLICES",
            manifestPayloadId: "bge-manifest",
            tensorPayloadId: "bge-tensors",
            slices: [{
              tensorKey: "embeddings",
              vectorOffset: 0,
              vectorCount: 1,
            }],
          },
        },
        {
          schemaVersion: 2,
          id: "siglip-asset-0001",
          target: { kind: "ASSET", id: visualTarget.id },
          channel: "VISUAL_VECTOR",
          inputs: [{ kind: "TARGET", hash: visualTarget.sha256 }],
          indexVersion: {
            id: "siglip-v1",
            builderId: "siglip-index-builder",
            builderVersion: "1.0.0",
            modelId: "google/siglip2-base-patch16-224",
            modelRevision: "immutable-siglip-revision",
            configHash: sha256StableJsonV2(visualConfig),
          },
          dimensions: 768,
          vectorCount: 2,
          locator: {
            kind: "SHARED_TENSOR_SLICES",
            manifestPayloadId: "siglip-manifest",
            tensorPayloadId: "siglip-tensors",
            slices: [{
              tensorKey: "embeddings",
              vectorOffset: 10,
              vectorCount: 2,
            }],
          },
        },
      ],
    }, prepared.bundle);

    await expect(storeKnowledgeIndexBundleV2(
      connection,
      prepared.bundle,
      indexBundle,
      {
        configsByVersionId: {
          "bge-v1": textConfig,
          "siglip-v1": visualConfig,
        },
        activate: true,
        now: 200,
        workspaceRoot: root,
      },
    )).resolves.toEqual({
      indexBundleHash: indexBundle.indexBundleHash,
      representationCount: 2,
      versionCount: 2,
      sharedPayloadCount: 4,
      providerIndexHashes: [textProviderHash, visualProviderHash],
      active: true,
    });
    expect(connection.sqlite.prepare(`
      SELECT index_bundle_hash indexBundleHash,shared_payload_count sharedPayloadCount
      FROM knowledge_index_bundles_v2
    `).get()).toEqual({
      indexBundleHash: indexBundle.indexBundleHash,
      sharedPayloadCount: 4,
    });
    expect(connection.sqlite.prepare(`
      SELECT provider_index_hash providerIndexHash
      FROM knowledge_index_payloads_v2
      WHERE role='PROVIDER_MANIFEST'
      ORDER BY id
    `).all()).toEqual([
      { providerIndexHash: textProviderHash },
      { providerIndexHash: visualProviderHash },
    ]);
    expect(connection.sqlite.prepare(`
      SELECT storage_key storageKey,manifest_payload_id manifestPayloadId,
        tensor_payload_id tensorPayloadId
      FROM knowledge_index_entries_v2 ORDER BY id
    `).all()).toEqual([
      {
        storageKey: null,
        manifestPayloadId: "bge-manifest",
        tensorPayloadId: "bge-tensors",
      },
      {
        storageKey: null,
        manifestPayloadId: "siglip-manifest",
        tensorPayloadId: "siglip-tensors",
      },
    ]);
    expect(connection.sqlite.prepare(`
      SELECT index_bundle_hash indexBundleHash
      FROM knowledge_active_index_bundle_v2 WHERE id=1
    `).get()).toEqual({ indexBundleHash: indexBundle.indexBundleHash });
    expect(auditKnowledgeV2Storage(connection, prepared.bundle, {
      requireActive: true,
    })).toMatchObject({
      indexBundleCount: 1,
      indexVersionCount: 2,
      indexPayloadCount: 4,
      indexEntryCount: 2,
      activeIndexBundleCount: 1,
    });
  }, 15_000);

  it("refuses to activate missing or tampered index payloads without storing metadata", async () => {
    ingestPreparedKnowledgeV2(connection, prepared, { now: 100 });
    const config = { tokenizer: "unicode-ngram-v1" };
    const target = prepared.bundle.objects[0]!;
    const payloadBytes = Buffer.from("expected-index-payload");
    const payloadStorageKey = "data/knowledge-index/missing.json";
    const indexBundle = sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: prepared.bundle.bundleHash,
      representations: [{
        schemaVersion: 2,
        id: "lexical-object-missing",
        target: { kind: "OBJECT", id: target.id },
        channel: "LEXICAL",
        inputs: [{ kind: "TARGET", hash: target.contentHash }],
        indexVersion: {
          id: "lexical-v1",
          builderId: "lumi-lexical-index",
          builderVersion: "1.0.0",
          modelId: null,
          modelRevision: null,
          configHash: sha256StableJsonV2(config),
        },
        dimensions: null,
        vectorCount: 1,
        payload: {
          storageKind: "CONTROLLED_FILE",
          storageKey: payloadStorageKey,
          byteLength: payloadBytes.byteLength,
          sha256: createHash("sha256").update(payloadBytes).digest("hex"),
        },
      }],
    }, prepared.bundle);
    const options = {
      configsByVersionId: { "lexical-v1": config },
      activate: true,
      workspaceRoot: root,
    };

    await expect(storeKnowledgeIndexBundleV2(
      connection,
      prepared.bundle,
      indexBundle,
      options,
    )).rejects.toThrow(/INDEX_PAYLOAD_MISSING/);
    expect(connection.sqlite.prepare(
      "SELECT count(*) count FROM knowledge_index_bundles_v2",
    ).get()).toEqual({ count: 0 });

    await mkdir(path.dirname(path.join(root, payloadStorageKey)), {
      recursive: true,
    });
    await writeFile(path.join(root, payloadStorageKey), "tampered");
    await expect(storeKnowledgeIndexBundleV2(
      connection,
      prepared.bundle,
      indexBundle,
      options,
    )).rejects.toThrow(/INDEX_PAYLOAD_HASH_DRIFT/);
    expect(connection.sqlite.prepare(
      "SELECT count(*) count FROM knowledge_active_index_bundle_v2",
    ).get()).toEqual({ count: 0 });
  });
});

// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  agentEvidenceRuntimeProfileV2,
  createAgentEvidenceRuntimeManagerV2,
} from "@/lib/knowledge/agent-evidence-runtime-v2";
import {
  createActiveKnowledgeGenerationLoaderV2,
} from "@/lib/knowledge/active-knowledge-generation-v2";
import { verifyKnowledgeIndexPayloadsV2 } from "@/lib/knowledge/knowledge-index-v2";
import {
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

async function buildSharedGeneration(input: {
  root: string;
  prepared: PreparedKnowledgeV2Ingestion;
  tag: string;
  textProviderHash: string;
  visualProviderHash: string;
  textModelRevision?: string;
  visualModelRevision?: string;
}) {
  const textConfig = {
    dimensions: 512,
    generation: input.tag,
    pooling: "CLS",
  };
  const visualConfig = {
    aggregation: "MAX_REGION",
    dimensions: 768,
    generation: input.tag,
  };
  const textVersionId = `${input.tag}-bge-v1`;
  const visualVersionId = `${input.tag}-siglip-v1`;
  const textModelRevision =
    input.textModelRevision
    ?? `immutable-bge-${input.tag}`;
  const visualModelRevision =
    input.visualModelRevision
    ?? `immutable-siglip-${input.tag}`;
  const textTensorBytes = Buffer.from(`${input.tag}-shared-bge-tensors`);
  const visualTensorBytes = Buffer.from(`${input.tag}-shared-siglip-tensors`);
  const textTarget = input.prepared.bundle.objects[0]!;
  const visualTarget = input.prepared.bundle.assets[0]!;
  const visualOwner = input.prepared.bundle.objects.find((object) =>
    object.nodes.some((node) =>
      node.kind === "IMAGE" && node.assetId === visualTarget.id))!;
  const textRepresentationId = `${input.tag}-bge-object-0001`;
  const visualRepresentationId = `${input.tag}-siglip-asset-0001`;
  const payloadInputs = [
    {
      id: `${input.tag}-bge-manifest`,
      role: "PROVIDER_MANIFEST" as const,
      format: "JSON" as const,
      providerIndexHash: input.textProviderHash,
      storageKey: `data/knowledge-index/${input.tag}/bge/manifest.json`,
      bytes: Buffer.from(JSON.stringify({
        identity: {
          corpusBundleHash: input.prepared.bundle.bundleHash,
          indexBundleHash: input.textProviderHash,
          indexVersionId: textVersionId,
          modelId: "BAAI/bge-small-zh-v1.5",
          modelRevision: textModelRevision,
        },
        dimensions: 512,
        recordCount: 1,
        entries: [{
          representationId: textRepresentationId,
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
      id: `${input.tag}-bge-tensors`,
      role: "VECTOR_TENSORS" as const,
      format: "SAFETENSORS" as const,
      storageKey: `data/knowledge-index/${input.tag}/bge/embeddings.safetensors`,
      bytes: textTensorBytes,
      tensors: [{ key: "embeddings", dimensions: 512, vectorCount: 1 }],
    },
    {
      id: `${input.tag}-siglip-manifest`,
      role: "PROVIDER_MANIFEST" as const,
      format: "JSON" as const,
      providerIndexHash: input.visualProviderHash,
      storageKey: `data/knowledge-index/${input.tag}/siglip/manifest.json`,
      bytes: Buffer.from(JSON.stringify({
        identity: {
          corpusBundleHash: input.prepared.bundle.bundleHash,
          indexBundleHash: input.visualProviderHash,
          indexVersionId: visualVersionId,
          modelId: "google/siglip2-base-patch16-224",
          modelRevision: visualModelRevision,
        },
        adapter: { dimensions: 768 },
        regionCount: 306,
        entries: [{
          representationId: visualRepresentationId,
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
      id: `${input.tag}-siglip-tensors`,
      role: "VECTOR_TENSORS" as const,
      format: "SAFETENSORS" as const,
      storageKey: `data/knowledge-index/${input.tag}/siglip/embeddings.safetensors`,
      bytes: visualTensorBytes,
      tensors: [{ key: "embeddings", dimensions: 768, vectorCount: 306 }],
    },
  ];
  for (const payload of payloadInputs) {
    const target = path.join(input.root, payload.storageKey);
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
  const bundle = sealKnowledgeIndexBundleV2({
    schemaVersion: 2,
    corpusBundleHash: input.prepared.bundle.bundleHash,
    sharedPayloads,
    representations: [
      {
        schemaVersion: 2,
        id: textRepresentationId,
        target: { kind: "OBJECT", id: textTarget.id },
        channel: "TEXT_VECTOR",
        inputs: [{ kind: "TARGET", hash: textTarget.contentHash }],
        indexVersion: {
          id: textVersionId,
          builderId: "bge-index-builder",
          builderVersion: "1.0.0",
          modelId: "BAAI/bge-small-zh-v1.5",
          modelRevision: textModelRevision,
          configHash: sha256StableJsonV2(textConfig),
        },
        dimensions: 512,
        vectorCount: 1,
        locator: {
          kind: "SHARED_TENSOR_SLICES",
          manifestPayloadId: `${input.tag}-bge-manifest`,
          tensorPayloadId: `${input.tag}-bge-tensors`,
          slices: [{
            tensorKey: "embeddings",
            vectorOffset: 0,
            vectorCount: 1,
          }],
        },
      },
      {
        schemaVersion: 2,
        id: visualRepresentationId,
        target: { kind: "ASSET", id: visualTarget.id },
        channel: "VISUAL_VECTOR",
        inputs: [{ kind: "TARGET", hash: visualTarget.sha256 }],
        indexVersion: {
          id: visualVersionId,
          builderId: "siglip-index-builder",
          builderVersion: "1.0.0",
          modelId: "google/siglip2-base-patch16-224",
          modelRevision: visualModelRevision,
          configHash: sha256StableJsonV2(visualConfig),
        },
        dimensions: 768,
        vectorCount: 2,
        locator: {
          kind: "SHARED_TENSOR_SLICES",
          manifestPayloadId: `${input.tag}-siglip-manifest`,
          tensorPayloadId: `${input.tag}-siglip-tensors`,
          slices: [{
            tensorKey: "embeddings",
            vectorOffset: 10,
            vectorCount: 2,
          }],
        },
      },
    ],
  }, input.prepared.bundle);
  const visualTensor = payloadInputs.find(
    (payload) => payload.id === `${input.tag}-siglip-tensors`,
  )!;

  return {
    bundle,
    configsByVersionId: {
      [textVersionId]: textConfig,
      [visualVersionId]: visualConfig,
    },
    providerHashesByPayloadId: {
      [`${input.tag}-bge-manifest`]: input.textProviderHash,
      [`${input.tag}-siglip-manifest`]: input.visualProviderHash,
    },
    textRepresentationId,
    textVersionId,
    textManifestPayloadId: `${input.tag}-bge-manifest`,
    textTensorPayloadId: `${input.tag}-bge-tensors`,
    visualManifestPayloadId: `${input.tag}-siglip-manifest`,
    visualTensorPayloadId: `${input.tag}-siglip-tensors`,
    visualTensorPath: path.join(input.root, visualTensor.storageKey),
    visualTensorBytes: visualTensor.bytes,
  };
}

describe("active KnowledgeObjectV2 generation loader", () => {
  let connection: DatabaseConnection;
  let prepared: PreparedKnowledgeV2Ingestion;
  let root: string;

  beforeAll(async () => {
    prepared = await prepareKnowledgeV2Ingestion(process.cwd());
  });

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lumi-active-generation-v2-"));
    const databasePath = path.join(root, "knowledge.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    ingestPreparedKnowledgeV2(connection, prepared, { now: 100 });
  });

  afterEach(async () => {
    connection?.sqlite.close();
    await rm(root, { recursive: true, force: true });
  });

  async function storeGeneration(input: {
    tag: string;
    textProviderHash: string;
    visualProviderHash: string;
    activate: boolean;
    now: number;
    textModelRevision?: string;
    visualModelRevision?: string;
  }) {
    const fixture = await buildSharedGeneration({
      root,
      prepared,
      tag: input.tag,
      textProviderHash: input.textProviderHash,
      visualProviderHash: input.visualProviderHash,
      textModelRevision: input.textModelRevision,
      visualModelRevision:
        input.visualModelRevision,
    });
    await storeKnowledgeIndexBundleV2(
      connection,
      prepared.bundle,
      fixture.bundle,
      {
        configsByVersionId: fixture.configsByVersionId,
        activate: input.activate,
        now: input.now,
        workspaceRoot: root,
      },
    );
    return fixture;
  }

  it("loads the active corpus when no index generation is active", async () => {
    const loader = createActiveKnowledgeGenerationLoaderV2({
      connection,
      workspaceRoot: root,
    });

    const generation = await loader.load();

    expect(generation).toMatchObject({
      generationKey: `${prepared.bundle.bundleHash}:NO_INDEX`,
      activeIndexBundleHash: null,
      indexBundle: null,
      indexConfigsByVersionId: {},
      providerIndexBundleHashes: {},
    });
    expect(generation.corpus.bundleHash).toBe(prepared.bundle.bundleHash);
    expect(Object.isFrozen(generation)).toBe(true);
  });

  it("loads one active control-plane bundle with both provider identities", async () => {
    const fixture = await storeGeneration({
      tag: "one",
      textProviderHash: "b".repeat(64),
      visualProviderHash: "c".repeat(64),
      activate: true,
      now: 200,
    });
    const loader = createActiveKnowledgeGenerationLoaderV2({
      connection,
      workspaceRoot: root,
    });

    const generation = await loader.load();

    expect(generation.activeIndexBundleHash).toBe(
      fixture.bundle.indexBundleHash,
    );
    expect(generation.indexBundle?.indexBundleHash).toBe(
      fixture.bundle.indexBundleHash,
    );
    expect(generation.providerIndexBundleHashes).toEqual(
      fixture.providerHashesByPayloadId,
    );
    expect(Object.keys(generation.indexConfigsByVersionId).sort()).toEqual(
      Object.keys(fixture.configsByVersionId).sort(),
    );
  }, 15_000);

  it("retries exactly once when the pointer changes during payload verification", async () => {
    const first = await storeGeneration({
      tag: "one",
      textProviderHash: "b".repeat(64),
      visualProviderHash: "c".repeat(64),
      activate: true,
      now: 200,
    });
    const second = await storeGeneration({
      tag: "two",
      textProviderHash: "d".repeat(64),
      visualProviderHash: "e".repeat(64),
      activate: false,
      now: 300,
    });
    const verifiedBundleHashes: string[] = [];
    const loader = createActiveKnowledgeGenerationLoaderV2({
      connection,
      workspaceRoot: root,
      maxPointerRetries: 1,
      payloadVerifier: async (payloadInput) => {
        const verified = await verifyKnowledgeIndexPayloadsV2(payloadInput);
        verifiedBundleHashes.push(verified.indexBundleHash);
        if (verifiedBundleHashes.length === 1) {
          connection.sqlite.prepare(`
            UPDATE knowledge_active_index_bundle_v2
            SET index_bundle_hash=?,activated_at=?
            WHERE id=1
          `).run(second.bundle.indexBundleHash, 300);
        }
        return verified;
      },
    });

    const generation = await loader.load();

    expect(verifiedBundleHashes).toEqual([
      first.bundle.indexBundleHash,
      second.bundle.indexBundleHash,
    ]);
    expect(generation.generationKey).toBe(
      `${prepared.bundle.bundleHash}:${second.bundle.indexBundleHash}`,
    );
    expect(generation.activeIndexBundleHash).toBe(
      second.bundle.indexBundleHash,
    );
    expect(generation.indexBundle?.indexBundleHash).toBe(
      second.bundle.indexBundleHash,
    );
    expect(generation.providerIndexBundleHashes).toEqual(
      second.providerHashesByPayloadId,
    );
    expect(Object.keys(generation.indexConfigsByVersionId).sort()).toEqual(
      Object.keys(second.configsByVersionId).sort(),
    );
  }, 15_000);

  it("retries a transient verification error when the active pointer changed", async () => {
    await storeGeneration({
      tag: "one",
      textProviderHash: "b".repeat(64),
      visualProviderHash: "c".repeat(64),
      activate: true,
      now: 200,
    });
    const second = await storeGeneration({
      tag: "two",
      textProviderHash: "d".repeat(64),
      visualProviderHash: "e".repeat(64),
      activate: false,
      now: 300,
    });
    let attempts = 0;
    const loader = createActiveKnowledgeGenerationLoaderV2({
      connection,
      workspaceRoot: root,
      maxPointerRetries: 1,
      payloadVerifier: async (payloadInput) => {
        attempts += 1;
        if (attempts === 1) {
          connection.sqlite.prepare(`
            UPDATE knowledge_active_index_bundle_v2
            SET index_bundle_hash=?,activated_at=?
            WHERE id=1
          `).run(second.bundle.indexBundleHash, 300);
          throw new Error("STALE_GENERATION_PAYLOAD_DISAPPEARED");
        }
        return verifyKnowledgeIndexPayloadsV2(payloadInput);
      },
    });

    await expect(loader.load()).resolves.toMatchObject({
      activeIndexBundleHash: second.bundle.indexBundleHash,
      generationKey: `${prepared.bundle.bundleHash}:${second.bundle.indexBundleHash}`,
    });
    expect(attempts).toBe(2);
  }, 15_000);

  it("rejects a tampered payload in the selected generation", async () => {
    const fixture = await storeGeneration({
      tag: "one",
      textProviderHash: "b".repeat(64),
      visualProviderHash: "c".repeat(64),
      activate: true,
      now: 200,
    });
    await writeFile(
      fixture.visualTensorPath,
      Buffer.alloc(fixture.visualTensorBytes.byteLength, 0x78),
    );
    const loader = createActiveKnowledgeGenerationLoaderV2({
      connection,
      workspaceRoot: root,
    });

    await expect(loader.load()).rejects.toThrow(
      /KNOWLEDGE_INDEX_PAYLOAD_HASH_DRIFT:one-siglip-tensors/,
    );
  }, 15_000);

  it("verifies only the required text provider when visual retrieval is disabled", async () => {
    const fixture = await storeGeneration({
      tag: "one",
      textProviderHash: "b".repeat(64),
      visualProviderHash: "c".repeat(64),
      activate: true,
      now: 200,
    });
    await writeFile(
      fixture.visualTensorPath,
      Buffer.alloc(
        fixture.visualTensorBytes.byteLength,
        0x78,
      ),
    );
    const loader =
      createActiveKnowledgeGenerationLoaderV2({
        connection,
        workspaceRoot: root,
        requiredProviderModels: [{
          modelId:
            "BAAI/bge-small-zh-v1.5",
          modelRevision:
            "immutable-bge-one",
        }],
      });

    const generation = await loader.load();

    expect(
      generation
        .verifiedProviderIndexBundleHashes,
    ).toEqual(["b".repeat(64)]);
    expect(
      generation.providerIndexBundleHashes,
    ).toEqual(
      fixture.providerHashesByPayloadId,
    );
  }, 15_000);

  it("keys the online runtime by database, generation, channels and profile", async () => {
    const profile =
      agentEvidenceRuntimeProfileV2();
    const first = await storeGeneration({
      tag: "one",
      textProviderHash: "b".repeat(64),
      visualProviderHash: "c".repeat(64),
      activate: true,
      now: 200,
      textModelRevision:
        profile.textModel.revision,
      visualModelRevision:
        profile.visualModel.revision,
    });
    const second = await storeGeneration({
      tag: "two",
      textProviderHash: "d".repeat(64),
      visualProviderHash: "e".repeat(64),
      activate: false,
      now: 300,
      textModelRevision:
        profile.textModel.revision,
      visualModelRevision:
        profile.visualModel.revision,
    });
    const dispose = vi.fn(async () => undefined);
    const createRuntime = vi.fn(
      async (options) => ({
        t41CandidateIdentity: {
          corpusBundleHash:
            options.activeGeneration!
              .corpus.bundleHash,
        },
        retrieve: vi.fn(),
        dispose,
      }) as never,
    );
    const manager =
      createAgentEvidenceRuntimeManagerV2({
        createRuntime,
        createLoader:
          createActiveKnowledgeGenerationLoaderV2,
      });

    const firstPort = await manager.get({
      connection,
      workspaceRoot: root,
      visualRetrievalEnabled: false,
    });
    const cachedPort = await manager.get({
      connection,
      workspaceRoot: root,
      visualRetrievalEnabled: false,
    });
    connection.sqlite.prepare(`
      UPDATE knowledge_active_index_bundle_v2
      SET index_bundle_hash=?,activated_at=?
      WHERE id=1
    `).run(second.bundle.indexBundleHash, 300);
    const secondPort = await manager.get({
      connection,
      workspaceRoot: root,
      visualRetrievalEnabled: false,
    });

    expect(cachedPort).toBe(firstPort);
    expect(secondPort).not.toBe(firstPort);
    expect(firstPort.openAsset).toBeUndefined();
    expect(createRuntime).toHaveBeenCalledTimes(2);
    expect(createRuntime.mock.calls.map(
      ([options]) =>
        options.activeGeneration
          ?.activeIndexBundleHash,
    )).toEqual([
      first.bundle.indexBundleHash,
      second.bundle.indexBundleHash,
    ]);
    expect(createRuntime.mock.calls.every(
      ([options]) =>
        options.visualRetrievalEnabled
          === false,
    )).toBe(true);
    expect(createRuntime.mock.calls.map(
      ([options]) =>
        path.basename(options.textIndexDir),
    )).toEqual(["bge", "bge"]);
    await manager.dispose(root);
    expect(dispose).toHaveBeenCalledTimes(2);
  }, 20_000);

  it("rejects drift in a stored index configuration", async () => {
    const fixture = await storeGeneration({
      tag: "one",
      textProviderHash: "b".repeat(64),
      visualProviderHash: "c".repeat(64),
      activate: true,
      now: 200,
    });
    connection.sqlite.prepare(`
      UPDATE knowledge_index_versions_v2
      SET config_json=?
      WHERE index_bundle_hash=? AND id=?
    `).run(
      stableJsonV2({ dimensions: 385, generation: "tampered", pooling: "CLS" }),
      fixture.bundle.indexBundleHash,
      fixture.textVersionId,
    );
    const loader = createActiveKnowledgeGenerationLoaderV2({
      connection,
      workspaceRoot: root,
    });

    await expect(loader.load()).rejects.toThrow(
      /KNOWLEDGE_V2_ACTIVE_INDEX_VERSION_ROW_DRIFT/,
    );
  }, 15_000);

  it("rejects drift in every redundant representation locator column", async () => {
    const fixture = await storeGeneration({
      tag: "one",
      textProviderHash: "b".repeat(64),
      visualProviderHash: "c".repeat(64),
      activate: true,
      now: 200,
    });
    const textRepresentation = fixture.bundle.representations.find(
      (representation) => representation.id === fixture.textRepresentationId,
    )!;
    const locator = textRepresentation.locator!;
    const expectEntryDrift = async () => {
      const loader = createActiveKnowledgeGenerationLoaderV2({
        connection,
        workspaceRoot: root,
      });
      await expect(loader.load()).rejects.toThrow(
        /KNOWLEDGE_V2_ACTIVE_INDEX_ENTRY_ROW_DRIFT/,
      );
    };

    connection.sqlite.prepare(`
      UPDATE knowledge_index_entries_v2
      SET manifest_payload_id=?
      WHERE index_bundle_hash=? AND id=?
    `).run(
      fixture.visualManifestPayloadId,
      fixture.bundle.indexBundleHash,
      fixture.textRepresentationId,
    );
    await expectEntryDrift();
    connection.sqlite.prepare(`
      UPDATE knowledge_index_entries_v2
      SET manifest_payload_id=?
      WHERE index_bundle_hash=? AND id=?
    `).run(
      fixture.textManifestPayloadId,
      fixture.bundle.indexBundleHash,
      fixture.textRepresentationId,
    );

    connection.sqlite.prepare(`
      UPDATE knowledge_index_entries_v2
      SET tensor_payload_id=?
      WHERE index_bundle_hash=? AND id=?
    `).run(
      fixture.visualTensorPayloadId,
      fixture.bundle.indexBundleHash,
      fixture.textRepresentationId,
    );
    await expectEntryDrift();
    connection.sqlite.prepare(`
      UPDATE knowledge_index_entries_v2
      SET tensor_payload_id=?
      WHERE index_bundle_hash=? AND id=?
    `).run(
      fixture.textTensorPayloadId,
      fixture.bundle.indexBundleHash,
      fixture.textRepresentationId,
    );

    connection.sqlite.prepare(`
      UPDATE knowledge_index_entries_v2
      SET locator_json=?
      WHERE index_bundle_hash=? AND id=?
    `).run(
      stableJsonV2({
        ...locator,
        slices: locator.slices.map((slice, index) =>
          index === 0
            ? { ...slice, vectorOffset: slice.vectorOffset + 1 }
            : slice),
      }),
      fixture.bundle.indexBundleHash,
      fixture.textRepresentationId,
    );
    await expectEntryDrift();
  }, 15_000);

  it("returns the same deeply frozen object for a cached generation", async () => {
    const fixture = await storeGeneration({
      tag: "one",
      textProviderHash: "b".repeat(64),
      visualProviderHash: "c".repeat(64),
      activate: true,
      now: 200,
    });
    let payloadVerifications = 0;
    const loader = createActiveKnowledgeGenerationLoaderV2({
      connection,
      workspaceRoot: root,
      payloadVerifier: async (payloadInput) => {
        payloadVerifications += 1;
        return verifyKnowledgeIndexPayloadsV2(payloadInput);
      },
    });

    const first = await loader.load();
    const second = await loader.load();

    expect(second).toBe(first);
    expect(payloadVerifications).toBe(1);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.corpus)).toBe(true);
    expect(Object.isFrozen(first.indexBundle)).toBe(true);
    expect(Object.isFrozen(first.indexConfigsByVersionId)).toBe(true);
    expect(Object.isFrozen(
      first.indexConfigsByVersionId[fixture.textVersionId],
    )).toBe(true);
    expect(Object.isFrozen(first.providerIndexBundleHashes)).toBe(true);
    expect(Object.isFrozen(
      first.verifiedProviderIndexBundleHashes,
    )).toBe(true);
  }, 15_000);
});

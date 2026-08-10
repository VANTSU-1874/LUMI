// @vitest-environment node

import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyKnowledgeIndexPayloadsV2 } from "@/lib/knowledge/knowledge-index-v2";
import {
  sealKnowledgeIndexBundleV2,
  verifyKnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("KnowledgeObjectV2 index payload verification", () => {
  it("checks controlled payload existence, byte length and sha256", async () => {
    const corpus = verifyKnowledgeCorpusBundleV2(JSON.parse(await readFile(
      path.join(process.cwd(), "data", "knowledge-v2", "knowledge-corpus.v2.json"),
      "utf8",
    )) as unknown);
    const asset = corpus.assets[0]!;
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "knowledge-index-v2-"));
    temporaryRoots.push(workspaceRoot);
    const storageKey = ".runtime/knowledge-index/asset-vector.bin";
    const payloadPath = path.join(workspaceRoot, storageKey);
    await mkdir(path.dirname(payloadPath), { recursive: true });
    const payload = Buffer.from("immutable-index-payload");
    await writeFile(payloadPath, payload);
    const payloadHash = createHash("sha256").update(payload).digest("hex");
    const indexBundle = sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      representations: [{
        schemaVersion: 2,
        id: "index-payload-fixture",
        target: { kind: "ASSET", id: asset.id },
        channel: "VISUAL_VECTOR",
        inputs: [{ kind: "TARGET", hash: asset.sha256 }],
        indexVersion: {
          id: "visual-payload-v1",
          builderId: "payload-fixture",
          builderVersion: "1.0.0",
          modelId: "example/model",
          modelRevision: "immutable-revision-1",
          configHash: "a".repeat(64),
        },
        dimensions: 4,
        vectorCount: 1,
        payload: {
          storageKind: "CONTROLLED_FILE",
          storageKey,
          byteLength: payload.byteLength,
          sha256: payloadHash,
        },
      }],
    }, corpus);

    await expect(verifyKnowledgeIndexPayloadsV2({
      workspaceRoot,
      indexBundle,
      corpusBundle: corpus,
    })).resolves.toEqual(indexBundle);

    await writeFile(payloadPath, Buffer.from("tampered-index-payload!"));
    await expect(verifyKnowledgeIndexPayloadsV2({
      workspaceRoot,
      indexBundle,
      corpusBundle: corpus,
    })).rejects.toThrow(/payload.hash.drift/i);
  });

  it("verifies shared provider files once per bundle and binds every locator to that provider", async () => {
    const corpus = verifyKnowledgeCorpusBundleV2(JSON.parse(await readFile(
      path.join(process.cwd(), "data", "knowledge-v2", "knowledge-corpus.v2.json"),
      "utf8",
    )) as unknown);
    const assets = corpus.assets.slice(0, 2);
    expect(assets).toHaveLength(2);
    const owners = assets.map((asset) => corpus.objects.find((object) =>
      object.nodes.some((node) =>
        node.kind === "IMAGE" && node.assetId === asset!.id))!);
    expect(owners.every(Boolean)).toBe(true);
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "knowledge-index-shared-v2-"));
    temporaryRoots.push(workspaceRoot);
    const providerIndexHash = "b".repeat(64);
    const manifestStorageKey = ".runtime/knowledge-index/siglip/manifest.json";
    const tensorStorageKey = ".runtime/knowledge-index/siglip/embeddings.safetensors";
    const tensors = Buffer.from("one-shared-tensor-file-for-two-representations");
    const manifestValue = {
      schemaVersion: 2,
      identity: {
        corpusBundleHash: corpus.bundleHash,
        indexBundleHash: providerIndexHash,
        indexVersionId: "visual-shared-v1",
        modelId: "example/model",
        modelRevision: "immutable-revision-1",
      },
      adapter: { dimensions: 4 },
      regionCount: 2,
      entries: assets.map((asset, index) => ({
        representationId: `index-shared-fixture-${index}`,
        assetId: asset!.id,
        objectId: owners[index]!.id,
        coursePackId: owners[index]!.sourceCoursePack.id,
        sourceSha256: asset!.sha256,
        regions: [{
          tensorKey: "embeddings",
          vectorOffset: index,
          vectorCount: 1,
        }],
      })),
      payload: {
        filename: "embeddings.safetensors",
        sha256: createHash("sha256").update(tensors).digest("hex"),
        sizeBytes: tensors.byteLength,
        tensorKey: "embeddings",
      },
    };
    const manifest = Buffer.from(JSON.stringify(manifestValue));
    await mkdir(path.dirname(path.join(workspaceRoot, manifestStorageKey)), {
      recursive: true,
    });
    await writeFile(path.join(workspaceRoot, manifestStorageKey), manifest);
    await writeFile(path.join(workspaceRoot, tensorStorageKey), tensors);
    const sharedPayloads = [
      {
        schemaVersion: 2,
        id: "siglip-manifest",
        role: "PROVIDER_MANIFEST",
        format: "JSON",
        providerIndexHash,
        storageKind: "CONTROLLED_FILE",
        storageKey: manifestStorageKey,
        byteLength: manifest.byteLength,
        sha256: createHash("sha256").update(manifest).digest("hex"),
      },
      {
        schemaVersion: 2,
        id: "siglip-tensors",
        role: "VECTOR_TENSORS",
        format: "SAFETENSORS",
        storageKind: "CONTROLLED_FILE",
        storageKey: tensorStorageKey,
        byteLength: tensors.byteLength,
        sha256: createHash("sha256").update(tensors).digest("hex"),
        tensors: [{ key: "embeddings", dimensions: 4, vectorCount: 2 }],
      },
    ] as const;
    const indexVersion = {
      id: "visual-shared-v1",
      builderId: "payload-fixture",
      builderVersion: "1.0.0",
      modelId: "example/model",
      modelRevision: "immutable-revision-1",
      configHash: "a".repeat(64),
    } as const;
    const representations = assets.map((asset, index) => ({
      schemaVersion: 2 as const,
      id: `index-shared-fixture-${index}`,
      target: { kind: "ASSET" as const, id: asset!.id },
      channel: "VISUAL_VECTOR" as const,
      inputs: [{ kind: "TARGET" as const, hash: asset!.sha256 }],
      indexVersion,
      dimensions: 4,
      vectorCount: 1,
      locator: {
        kind: "SHARED_TENSOR_SLICES" as const,
        manifestPayloadId: "siglip-manifest",
        tensorPayloadId: "siglip-tensors",
        slices: [{
          tensorKey: "embeddings",
          vectorOffset: index,
          vectorCount: 1,
        }],
      },
    }));
    const indexBundle = sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      sharedPayloads,
      representations,
    }, corpus);

    await expect(verifyKnowledgeIndexPayloadsV2({
      workspaceRoot,
      indexBundle,
      corpusBundle: corpus,
    })).resolves.toEqual(indexBundle);

    const swappedSlicesBundle = sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      sharedPayloads,
      representations: representations.map((representation, index) => ({
        ...representation,
        locator: {
          ...representation.locator,
          slices: [{
            ...representation.locator.slices[0]!,
            vectorOffset: index === 0 ? 1 : 0,
          }],
        },
      })),
    }, corpus);
    await expect(verifyKnowledgeIndexPayloadsV2({
      workspaceRoot,
      indexBundle: swappedSlicesBundle,
      corpusBundle: corpus,
    })).rejects.toThrow(/provider.representation.binding.drift/i);

    const otherTensors = Buffer.from("other-valid-shared-tensor-payload");
    await writeFile(path.join(workspaceRoot, tensorStorageKey), otherTensors);
    const mismatchedTensorBundle = sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      sharedPayloads: [sharedPayloads[0], {
        ...sharedPayloads[1],
        byteLength: otherTensors.byteLength,
        sha256: createHash("sha256").update(otherTensors).digest("hex"),
      }],
      representations,
    }, corpus);
    await expect(verifyKnowledgeIndexPayloadsV2({
      workspaceRoot,
      indexBundle: mismatchedTensorBundle,
      corpusBundle: corpus,
    })).rejects.toThrow(/provider.tensor.binding.drift/i);

    await writeFile(path.join(workspaceRoot, tensorStorageKey), tensors);
    const wrongTensorKeyBundle = sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      sharedPayloads: [sharedPayloads[0], {
        ...sharedPayloads[1],
        tensors: [{ key: "other-embeddings", dimensions: 4, vectorCount: 2 }],
      }],
      representations: representations.map((representation) => ({
        ...representation,
        locator: {
          ...representation.locator,
          slices: representation.locator.slices.map((slice) => ({
            ...slice,
            tensorKey: "other-embeddings",
          })),
        },
      })),
    }, corpus);
    await expect(verifyKnowledgeIndexPayloadsV2({
      workspaceRoot,
      indexBundle: wrongTensorKeyBundle,
      corpusBundle: corpus,
    })).rejects.toThrow(/provider.tensor.shape.drift/i);

    const wrongManifest = Buffer.from(JSON.stringify({
      ...manifestValue,
      identity: {
        ...manifestValue.identity,
        indexBundleHash: "c".repeat(64),
      },
    }));
    await writeFile(path.join(workspaceRoot, manifestStorageKey), wrongManifest);
    const wrongManifestBundle = sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      sharedPayloads: [{
        ...sharedPayloads[0],
        byteLength: wrongManifest.byteLength,
        sha256: createHash("sha256").update(wrongManifest).digest("hex"),
      }, sharedPayloads[1]],
      representations,
    }, corpus);
    await expect(verifyKnowledgeIndexPayloadsV2({
      workspaceRoot,
      indexBundle: wrongManifestBundle,
      corpusBundle: corpus,
    })).rejects.toThrow(/provider.hash.drift/i);
  }, 15_000);
});

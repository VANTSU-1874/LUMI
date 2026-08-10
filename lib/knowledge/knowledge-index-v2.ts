import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";

import {
  verifyKnowledgeCorpusBundleV2,
  verifyKnowledgeIndexBundleV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeIndexBundleV2,
  type SharedIndexPayloadV2,
} from "./knowledge-object-v2";

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isSamePath(left: string, right: string) {
  return path.relative(left, right) === "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function manifestPayloadBinding(manifestInput: unknown) {
  const manifest = record(manifestInput);
  const identity = record(manifest?.identity);
  const payload = record(manifest?.payload);
  if (!manifest || !identity || !payload) {
    throw new Error("KNOWLEDGE_INDEX_PROVIDER_MANIFEST_BINDING_INVALID");
  }
  const byteLength = payload.byteLength ?? payload.sizeBytes;
  const shape = Array.isArray(payload.shape) ? payload.shape : null;
  const adapter = record(manifest.adapter);
  const dimensions = shape?.[1] ?? manifest.dimensions ?? adapter?.dimensions;
  const vectorCount = shape?.[0] ?? manifest.recordCount ?? manifest.regionCount;
  const entryTensorKeys = Array.isArray(manifest.entries)
    ? manifest.entries.flatMap((entry) => {
        const regions = record(entry)?.regions;
        return Array.isArray(regions)
          ? regions.flatMap((region) => {
              const tensorKey = record(region)?.tensorKey;
              return typeof tensorKey === "string" ? [tensorKey] : [];
            })
          : [];
      })
    : [];
  const tensorKeys = new Set([
    ...(typeof payload.tensorKey === "string" ? [payload.tensorKey] : []),
    ...entryTensorKeys,
  ]);
  if (
    typeof identity.corpusBundleHash !== "string"
    || typeof identity.indexBundleHash !== "string"
    || typeof identity.indexVersionId !== "string"
    || typeof identity.modelId !== "string"
    || typeof identity.modelRevision !== "string"
    || typeof payload.sha256 !== "string"
    || typeof byteLength !== "number"
    || !Number.isSafeInteger(byteLength)
    || byteLength <= 0
    || typeof dimensions !== "number"
    || !Number.isSafeInteger(dimensions)
    || dimensions <= 0
    || typeof vectorCount !== "number"
    || !Number.isSafeInteger(vectorCount)
    || vectorCount <= 0
    || tensorKeys.size !== 1
  ) {
    throw new Error("KNOWLEDGE_INDEX_PROVIDER_MANIFEST_BINDING_INVALID");
  }
  return {
    corpusBundleHash: identity.corpusBundleHash,
    indexBundleHash: identity.indexBundleHash,
    indexVersionId: identity.indexVersionId,
    modelId: identity.modelId,
    modelRevision: identity.modelRevision,
    tensorSha256: payload.sha256,
    tensorByteLength: byteLength,
    dimensions,
    vectorCount,
    tensorKey: [...tensorKeys][0]!,
    manifest,
  };
}

type ManifestRepresentationBinding = {
  representationId: string;
  targetKind: "OBJECT" | "NODE" | "ASSET" | "ANNOTATION";
  targetId: string;
  objectId: string | null;
  coursePackId: string | null;
  sourceSha256: string | null;
  slices: Array<{
    tensorKey: string;
    vectorOffset: number;
    vectorCount: number;
  }>;
};

function manifestRepresentationBindings(
  manifest: Record<string, unknown>,
  defaultTensorKey: string,
) {
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error("KNOWLEDGE_INDEX_PROVIDER_ENTRIES_INVALID");
  }
  const bindings = manifest.entries.map((entryInput): ManifestRepresentationBinding => {
    const entry = record(entryInput);
    if (!entry) {
      throw new Error("KNOWLEDGE_INDEX_PROVIDER_ENTRY_INVALID");
    }
    const explicitTarget = record(entry.target);
    const representationId = entry.representationId;
    let targetKind: ManifestRepresentationBinding["targetKind"] | null = null;
    let targetId: string | null = null;
    if (
      explicitTarget
      && ["OBJECT", "NODE", "ASSET", "ANNOTATION"].includes(
        String(explicitTarget.kind),
      )
      && typeof explicitTarget.id === "string"
    ) {
      targetKind = explicitTarget.kind as ManifestRepresentationBinding["targetKind"];
      targetId = explicitTarget.id;
    } else if (typeof entry.nodeId === "string") {
      targetKind = "NODE";
      targetId = entry.nodeId;
    } else if (typeof entry.assetId === "string") {
      targetKind = "ASSET";
      targetId = entry.assetId;
    }
    let slices: ManifestRepresentationBinding["slices"] = [];
    if (
      typeof entry.tensorOffset === "number"
      && Number.isSafeInteger(entry.tensorOffset)
      && entry.tensorOffset >= 0
    ) {
      slices = [{
        tensorKey: defaultTensorKey,
        vectorOffset: entry.tensorOffset,
        vectorCount: 1,
      }];
    } else if (Array.isArray(entry.regions)) {
      slices = entry.regions.flatMap((regionInput) => {
        const region = record(regionInput);
        return (
          typeof region?.tensorKey === "string"
          && typeof region.vectorOffset === "number"
          && Number.isSafeInteger(region.vectorOffset)
          && region.vectorOffset >= 0
          && typeof region.vectorCount === "number"
          && Number.isSafeInteger(region.vectorCount)
          && region.vectorCount > 0
        )
          ? [{
              tensorKey: region.tensorKey,
              vectorOffset: region.vectorOffset,
              vectorCount: region.vectorCount,
            }]
          : [];
      });
      if (slices.length !== entry.regions.length) {
        throw new Error("KNOWLEDGE_INDEX_PROVIDER_ENTRY_SLICES_INVALID");
      }
    }
    if (
      typeof representationId !== "string"
      || targetKind === null
      || targetId === null
      || slices.length === 0
    ) {
      throw new Error("KNOWLEDGE_INDEX_PROVIDER_ENTRY_INVALID");
    }
    return {
      representationId,
      targetKind,
      targetId,
      objectId: typeof entry.objectId === "string" ? entry.objectId : null,
      coursePackId: typeof entry.coursePackId === "string" ? entry.coursePackId : null,
      sourceSha256: typeof entry.sourceSha256 === "string" ? entry.sourceSha256 : null,
      slices,
    };
  });
  if (
    new Set(bindings.map(({ representationId }) => representationId)).size
      !== bindings.length
  ) {
    throw new Error("KNOWLEDGE_INDEX_PROVIDER_ENTRY_DUPLICATE");
  }
  return new Map(bindings.map((binding) => [binding.representationId, binding]));
}

function targetOwnership(
  corpus: KnowledgeCorpusBundleV2,
  kind: ManifestRepresentationBinding["targetKind"],
  id: string,
) {
  if (kind === "OBJECT") {
    const object = corpus.objects.find((candidate) => candidate.id === id);
    return object
      ? { objectId: object.id, coursePackId: object.sourceCoursePack.id }
      : null;
  }
  for (const object of corpus.objects) {
    if (kind === "NODE" && object.nodes.some((node) => node.id === id)) {
      return { objectId: object.id, coursePackId: object.sourceCoursePack.id };
    }
    if (kind === "ANNOTATION" && object.annotations.some((annotation) => annotation.id === id)) {
      return { objectId: object.id, coursePackId: object.sourceCoursePack.id };
    }
  }
  if (kind === "ASSET") {
    const object = corpus.objects.find((candidate) =>
      candidate.nodes.some((node) =>
        node.kind === "IMAGE" && node.assetId === id));
    return object
      ? { objectId: object.id, coursePackId: object.sourceCoursePack.id }
      : null;
  }
  return null;
}

function sameSlices(
  left: readonly ManifestRepresentationBinding["slices"][number][],
  right: readonly ManifestRepresentationBinding["slices"][number][],
) {
  return left.length === right.length
    && left.every((slice, index) =>
      slice.tensorKey === right[index]?.tensorKey
      && slice.vectorOffset === right[index]?.vectorOffset
      && slice.vectorCount === right[index]?.vectorCount);
}

function verifyProviderTensorBindings(
  indexBundle: KnowledgeIndexBundleV2,
  corpus: KnowledgeCorpusBundleV2,
  payloadBytesById: ReadonlyMap<string, Buffer>,
  includedManifestIds?: ReadonlySet<string>,
) {
  const sharedPayloads = indexBundle.sharedPayloads ?? [];
  const sharedPayloadsById = new Map(
    sharedPayloads.map((payload) => [payload.id, payload]),
  );
  const tensorIdsByManifestId = new Map<string, Set<string>>();
  const representationsByManifestId = new Map<
    string,
    KnowledgeIndexBundleV2["representations"]
  >();
  for (const representation of indexBundle.representations) {
    if (!representation.locator) continue;
    const manifestId = representation.locator.manifestPayloadId;
    const tensorIds = tensorIdsByManifestId.get(manifestId) ?? new Set<string>();
    tensorIds.add(representation.locator.tensorPayloadId);
    tensorIdsByManifestId.set(manifestId, tensorIds);
    const representations = representationsByManifestId.get(manifestId) ?? [];
    representations.push(representation);
    representationsByManifestId.set(manifestId, representations);
  }
  for (const [manifestId, tensorIds] of tensorIdsByManifestId) {
    if (
      includedManifestIds
      && !includedManifestIds.has(manifestId)
    ) continue;
    if (tensorIds.size !== 1) {
      throw new Error(`KNOWLEDGE_INDEX_PROVIDER_TENSOR_CONFLICT:${manifestId}`);
    }
    const manifestPayload = sharedPayloadsById.get(manifestId);
    const tensorPayload = sharedPayloadsById.get([...tensorIds][0]!);
    if (
      manifestPayload?.role !== "PROVIDER_MANIFEST"
      || tensorPayload?.role !== "VECTOR_TENSORS"
    ) {
      throw new Error(`KNOWLEDGE_INDEX_PROVIDER_TENSOR_BINDING_INVALID:${manifestId}`);
    }
    const manifestBytes = payloadBytesById.get(manifestPayload.id);
    if (!manifestBytes) {
      throw new Error(`KNOWLEDGE_INDEX_PROVIDER_MANIFEST_MISSING:${manifestId}`);
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestBytes.toString("utf8")) as unknown;
    } catch {
      throw new Error(`KNOWLEDGE_INDEX_PROVIDER_MANIFEST_INVALID:${manifestId}`);
    }
    const binding = manifestPayloadBinding(manifest);
    if (
      binding.corpusBundleHash !== indexBundle.corpusBundleHash
      || binding.indexBundleHash !== manifestPayload.providerIndexHash
      || binding.tensorSha256 !== tensorPayload.sha256
      || binding.tensorByteLength !== tensorPayload.byteLength
    ) {
      throw new Error(`KNOWLEDGE_INDEX_PROVIDER_TENSOR_BINDING_DRIFT:${manifestId}`);
    }
    if (
      tensorPayload.tensors.length !== 1
      || tensorPayload.tensors[0]!.key !== binding.tensorKey
      || tensorPayload.tensors[0]!.dimensions !== binding.dimensions
      || tensorPayload.tensors[0]!.vectorCount !== binding.vectorCount
    ) {
      throw new Error(`KNOWLEDGE_INDEX_PROVIDER_TENSOR_SHAPE_DRIFT:${manifestId}`);
    }
    const representations = representationsByManifestId.get(manifestId) ?? [];
    const entryBindings = manifestRepresentationBindings(
      binding.manifest,
      binding.tensorKey,
    );
    if (entryBindings.size !== representations.length) {
      throw new Error(`KNOWLEDGE_INDEX_PROVIDER_ENTRY_COVERAGE_DRIFT:${manifestId}`);
    }
    if (representations.some((representation) =>
      representation.indexVersion.id !== binding.indexVersionId
      || representation.indexVersion.modelId !== binding.modelId
      || representation.indexVersion.modelRevision !== binding.modelRevision
      || representation.locator?.tensorPayloadId !== tensorPayload.id
    )) {
      throw new Error(`KNOWLEDGE_INDEX_PROVIDER_VERSION_BINDING_DRIFT:${manifestId}`);
    }
    for (const representation of representations) {
      const entry = entryBindings.get(representation.id);
      const ownership = targetOwnership(
        corpus,
        representation.target.kind,
        representation.target.id,
      );
      const targetHash = representation.inputs.find(({ kind }) => kind === "TARGET")?.hash;
      if (
        !entry
        || entry.targetKind !== representation.target.kind
        || entry.targetId !== representation.target.id
        || !representation.locator
        || !sameSlices(entry.slices, representation.locator.slices)
        || !ownership
        || (entry.objectId !== null && entry.objectId !== ownership.objectId)
        || (
          entry.coursePackId !== null
          && entry.coursePackId !== ownership.coursePackId
        )
        || (
          entry.sourceSha256 !== null
          && entry.sourceSha256 !== targetHash
        )
      ) {
        throw new Error(
          `KNOWLEDGE_INDEX_PROVIDER_REPRESENTATION_BINDING_DRIFT:${representation.id}`,
        );
      }
    }
  }
}

export async function resolveKnowledgeIndexStoragePathV2(
  input: {
    workspaceRoot: string;
    storageKey: string;
  },
) {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const realWorkspaceRoot = await realpath(workspaceRoot);
  const candidate = path.resolve(
    workspaceRoot,
    input.storageKey,
  );
  if (!isWithin(workspaceRoot, candidate)) {
    throw new Error(
      `KNOWLEDGE_INDEX_PAYLOAD_PATH_ESCAPE:${input.storageKey}`,
    );
  }
  let realCandidate: string;
  try {
    realCandidate = await realpath(candidate);
  } catch (error) {
    throw new Error(
      `KNOWLEDGE_INDEX_PAYLOAD_MISSING:${input.storageKey}:${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!isWithin(realWorkspaceRoot, realCandidate)) {
    throw new Error(
      `KNOWLEDGE_INDEX_PAYLOAD_PATH_ESCAPE:${input.storageKey}`,
    );
  }
  const expectedRealCandidate = path.join(
    realWorkspaceRoot,
    path.relative(workspaceRoot, candidate),
  );
  const stats = await lstat(candidate);
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || !isSamePath(expectedRealCandidate, realCandidate)
  ) {
    throw new Error(
      `KNOWLEDGE_INDEX_PAYLOAD_SYMLINK_NOT_ALLOWED:${input.storageKey}`,
    );
  }
  return realCandidate;
}

export async function verifyKnowledgeIndexPayloadsV2(input: {
  workspaceRoot: string;
  indexBundle: unknown;
  corpusBundle: unknown;
  providerIndexHashes?: readonly string[];
}): Promise<KnowledgeIndexBundleV2> {
  const indexBundle = verifyKnowledgeIndexBundleV2(
    input.indexBundle,
    input.corpusBundle,
  );
  const corpus = verifyKnowledgeCorpusBundleV2(input.corpusBundle);
  const requestedProviderHashes =
    input.providerIndexHashes === undefined
      ? null
      : new Set(input.providerIndexHashes);
  const providerManifestPayloads =
    (indexBundle.sharedPayloads ?? []).filter(
      (payload) =>
        payload.role === "PROVIDER_MANIFEST"
        && (
          requestedProviderHashes === null
          || requestedProviderHashes.has(
            payload.providerIndexHash,
          )
        ),
    );
  if (requestedProviderHashes !== null) {
    const found = new Set(
      providerManifestPayloads.flatMap(
        (payload) =>
          payload.role === "PROVIDER_MANIFEST"
            ? [payload.providerIndexHash]
            : [],
      ),
    );
    for (const requested of requestedProviderHashes) {
      if (!found.has(requested)) {
        throw new Error(
          `KNOWLEDGE_INDEX_PROVIDER_MANIFEST_MISSING:${requested}`,
        );
      }
    }
  }
  const includedManifestIds = new Set(
    providerManifestPayloads.map(({ id }) => id),
  );
  const selectedRepresentations =
    requestedProviderHashes === null
      ? indexBundle.representations
      : indexBundle.representations.filter(
          ({ locator }) =>
            locator
            && includedManifestIds.has(
              locator.manifestPayloadId,
            ),
        );
  const includedTensorIds = new Set(
    selectedRepresentations.flatMap(
      ({ locator }) =>
        locator ? [locator.tensorPayloadId] : [],
    ),
  );
  const payloads: Array<{
    identity: string;
    payload: SharedIndexPayloadV2 | NonNullable<
      KnowledgeIndexBundleV2["representations"][number]["payload"]
    >;
    providerIndexHash: string | null;
  }> = [
    ...(indexBundle.sharedPayloads ?? [])
      .filter((payload) =>
        requestedProviderHashes === null
        || includedManifestIds.has(payload.id)
        || includedTensorIds.has(payload.id))
      .map((payload) => ({
      identity: payload.id,
      payload,
      providerIndexHash: payload.role === "PROVIDER_MANIFEST"
        ? payload.providerIndexHash
        : null,
    })),
    ...selectedRepresentations.flatMap((representation) =>
      representation.payload === undefined
        ? []
        : [{
            identity: representation.id,
            payload: representation.payload,
            providerIndexHash: null,
          }]),
  ];
  const payloadBytesById = new Map<string, Buffer>();
  for (const { identity, payload, providerIndexHash } of payloads) {
    const storageKey = payload.storageKey;
    const realCandidate =
      await resolveKnowledgeIndexStoragePathV2({
        workspaceRoot: input.workspaceRoot,
        storageKey,
      });
    const bytes = await readFile(realCandidate);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (
      bytes.byteLength !== payload.byteLength
      || sha256 !== payload.sha256
    ) {
      throw new Error(`KNOWLEDGE_INDEX_PAYLOAD_HASH_DRIFT:${identity}`);
    }
    payloadBytesById.set(identity, bytes);
    if (providerIndexHash !== null) {
      let providerManifest: unknown;
      try {
        providerManifest = JSON.parse(bytes.toString("utf8")) as unknown;
      } catch {
        throw new Error(`KNOWLEDGE_INDEX_PROVIDER_MANIFEST_INVALID:${identity}`);
      }
      const embeddedProviderIndexHash = providerManifest
        && typeof providerManifest === "object"
        && "identity" in providerManifest
        && providerManifest.identity
        && typeof providerManifest.identity === "object"
        && "indexBundleHash" in providerManifest.identity
        ? providerManifest.identity.indexBundleHash
        : undefined;
      if (embeddedProviderIndexHash !== providerIndexHash) {
        throw new Error(
          `KNOWLEDGE_INDEX_PROVIDER_HASH_DRIFT:${identity}`,
        );
      }
    }
  }
  verifyProviderTensorBindings(
    indexBundle,
    corpus,
    payloadBytesById,
    requestedProviderHashes === null
      ? undefined
      : includedManifestIds,
  );
  return indexBundle;
}

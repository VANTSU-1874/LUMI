import {
  createHash,
  randomUUID,
} from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  type IncrementalIndexPlanV2,
  validatePackagedIncrementalPlanV2,
  visualIncrementalReuseKeyV2,
} from "./incremental-index-plan-v2";
import {
  sealKnowledgeIndexBundleV2,
  sha256StableJsonV2,
  stableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeIndexBundleV2,
  type KnowledgeIndexRepresentationV2,
  type SharedIndexPayloadV2,
} from "./knowledge-object-v2";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const StableIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/);
const CoursePackIdSchema = z.enum([
  "general-design",
  "digital-interaction",
  "book-design",
  "layout-design",
  "brand-vi-design",
]);

const TextIndexEntrySchema = z
  .object({
    representationId: StableIdSchema,
    nodeId: StableIdSchema,
    objectId: StableIdSchema,
    coursePackId: CoursePackIdSchema,
    sourceKind: z.enum(["NODE", "SOURCE_CAPTION"]),
    nodeKind: z.enum(["DOCUMENT", "SECTION", "TEXT", "IMAGE"]),
    role: z.string().min(1).max(30).nullable(),
    contentHash: HashSchema,
    recordHash: HashSchema,
    tensorOffset: z.number().int().nonnegative(),
  })
  .strict();

const TextIndexConfigSchema = z
  .object({
    modelId: z.literal("BAAI/bge-small-zh-v1.5"),
    modelRevision: z.literal("7999e1d3359715c523056ef9478215996d62a620"),
    modelLicense: z.literal("MIT"),
    dimensions: z.literal(512),
    pooling: z.literal("CLS"),
    normalize: z.literal(true),
    maxLength: z.literal(512),
    queryInstruction: z.literal("为这个句子生成表示以用于检索相关文章："),
    indexEncodingPolicy: z.literal("SINGLE_RECORD_V1").optional(),
    includedNodeKinds: z.tuple([
      z.literal("DOCUMENT"),
      z.literal("SECTION"),
      z.literal("TEXT"),
    ]),
    includedAnnotation: z
      .object({
        kind: z.literal("CAPTION"),
        origin: z.literal("SOURCE"),
      })
      .strict(),
  })
  .strict();

const TextIndexManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: z
      .object({
        corpusBundleHash: HashSchema,
        indexVersionId: StableIdSchema,
        modelId: z.literal("BAAI/bge-small-zh-v1.5"),
        modelRevision: z.literal("7999e1d3359715c523056ef9478215996d62a620"),
        indexBundleHash: HashSchema,
      })
      .strict(),
    model: TextIndexConfigSchema.extend({
      directorySha256: HashSchema,
      sealSha256: HashSchema,
    }).strict(),
    builder: z
      .object({
        id: StableIdSchema,
        version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
        python: z.string().min(1).max(80),
      })
      .strict(),
    configHash: HashSchema,
    dimensions: z.literal(512),
    recordCount: z.number().int().positive(),
    entries: z.array(TextIndexEntrySchema).min(1),
    payload: z
      .object({
        fileName: z.literal("embeddings.safetensors"),
        format: z.literal("SAFETENSORS_F32"),
        sha256: HashSchema,
        byteLength: z.number().int().positive(),
        tensorKey: z.literal("embeddings"),
        shape: z.tuple([z.number().int().positive(), z.literal(512)]),
      })
      .strict(),
  })
  .strict();

const VisualRegionSchema = z
  .object({
    name: z.enum(["ORIGINAL_ART", "ANALYSIS_OVERLAY", "FULL_IMAGE"]),
    bbox: z
      .object({
        coordinateSpace: z.literal("NORMALIZED"),
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
        width: z.number().finite().positive().max(1),
        height: z.number().finite().positive().max(1),
      })
      .strict(),
    tensorKey: z.literal("embeddings"),
    vectorOffset: z.number().int().nonnegative(),
    vectorCount: z.literal(1),
  })
  .strict();

const VisualIndexEntrySchema = z
  .object({
    assetId: StableIdSchema,
    coursePackId: CoursePackIdSchema,
    sourceSha256: HashSchema,
    representationId: StableIdSchema,
    regions: z.array(VisualRegionSchema).min(1).max(2),
  })
  .strict();

const VisualIndexConfigSchema = z
  .object({
    singleVectorAggregation: z.literal("MAX_REGION").optional(),
    singleVectorAggregationByMode: z
      .object({
        TEXT_TO_IMAGE: z.literal("MAX_REGION"),
        IMAGE_TO_IMAGE: z.literal("L2_NORMALIZED_MEAN_REGION"),
        IMAGE_TEXT_TO_IMAGE: z.literal("MAX_REGION"),
      })
      .strict()
      .optional(),
    singleVectorRegionAttributionByMode: z
      .object({
        IMAGE_TO_IMAGE: z.literal("MAX_QUERY_SIMILARITY_FIRST_REGION_TIE"),
      })
      .strict()
      .optional(),
  })
  .passthrough()
  .superRefine((config, context) => {
    const modeSpecific = config.singleVectorAggregationByMode !== undefined;
    if (
      modeSpecific !== (
        config.singleVectorRegionAttributionByMode !== undefined
      )
      || (modeSpecific && config.singleVectorAggregation !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "visual aggregation config must be complete and unambiguous",
      });
    }
  });

export const VisualIndexManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: z
      .object({
        corpusBundleHash: HashSchema,
        indexVersionId: StableIdSchema,
        modelId: z.literal("google/siglip2-base-patch16-224"),
        modelRevision: z.literal("75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2"),
        indexBundleHash: HashSchema,
      })
      .strict(),
    adapter: z
      .object({
        name: z.literal("siglip2"),
        kind: z.literal("SINGLE_VECTOR"),
        dimensions: z.literal(768),
        capabilities: z.array(z.string().min(1).max(100)).min(1),
      })
      .strict(),
    assetCount: z.number().int().positive(),
    regionCount: z.number().int().positive(),
    assetManifestSha256: HashSchema,
    modelDirectorySha256: HashSchema,
    modelSealSha256: HashSchema,
    modelFiles: z.array(z.unknown()).min(1),
    config: VisualIndexConfigSchema,
    payload: z
      .object({
        filename: z.literal("embeddings.safetensors"),
        sizeBytes: z.number().int().positive(),
        sha256: HashSchema,
      })
      .strict(),
    entries: z.array(VisualIndexEntrySchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const modeSpecific =
      manifest.config.singleVectorAggregationByMode !== undefined;
    const expectedVersion = modeSpecific
      ? "siglip2-224-two-region-i2i-l2-mean-v2"
      : "siglip2-224-two-region-v1";
    if (manifest.identity.indexVersionId !== expectedVersion) {
      context.addIssue({
        code: "custom",
        message: "visual aggregation profile and index version must agree",
        path: ["identity", "indexVersionId"],
      });
    }
  });

const PackagingReportV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    corpusBundleHash: HashSchema,
    control: z
      .object({
        indexBundleHash: HashSchema,
        representationCount: z.number().int().positive(),
        sharedPayloadCount: z.literal(4),
        storageKey: z.string().min(1),
      })
      .strict(),
    providers: z
      .object({
        text: z
          .object({
            provider: z.literal("bge-small-zh-v1-5"),
            providerIndexHash: HashSchema,
            representationCount: z.number().int().positive(),
            vectorCount: z.number().int().positive(),
            storageKey: z.string().min(1),
          })
          .strict(),
        visual: z
          .object({
            provider: z.literal("siglip2"),
            providerIndexHash: HashSchema,
            representationCount: z.number().int().positive(),
            vectorCount: z.number().int().positive(),
            regionSliceCount: z.number().int().positive(),
            storageKey: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    configsByVersionId: z.record(StableIdSchema, HashSchema),
    writes: z
      .object({
        outputRoot: z.string().min(1),
        database: z.literal("NOT_USED"),
        corpus: z.literal("READ_ONLY"),
        sourceIndexes: z.literal("READ_ONLY"),
      })
      .strict(),
  })
  .strict();

const TextOnlyPackagingReportV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    mode: z.literal("TEXT_ONLY"),
    corpusBundleHash: HashSchema,
    control: z
      .object({
        indexBundleHash: HashSchema,
        representationCount: z.number().int().positive(),
        sharedPayloadCount: z.literal(2),
        storageKey: z.string().min(1),
      })
      .strict(),
    providers: z
      .object({
        text: z
          .object({
            provider: z.literal("bge-small-zh-v1-5"),
            providerIndexHash: HashSchema,
            representationCount: z.number().int().positive(),
            vectorCount: z.number().int().positive(),
            storageKey: z.string().min(1),
          })
          .strict(),
        visual: z.null(),
      })
      .strict(),
    configsByVersionId: z.record(StableIdSchema, HashSchema),
    writes: z
      .object({
        outputRoot: z.string().min(1),
        database: z.literal("NOT_USED"),
        corpus: z.literal("READ_ONLY"),
        sourceIndexes: z.literal("READ_ONLY"),
      })
      .strict(),
  })
  .strict();

export type KnowledgeIndexPackagingReportV2 = z.infer<
  typeof PackagingReportV2Schema
>;

export type KnowledgeTextIndexPackagingReportV2 = z.infer<
  typeof TextOnlyPackagingReportV2Schema
>;

export type PackageKnowledgeIndexV2Input = {
  workspaceRoot: string;
  outputRoot: string;
  corpusBundle: unknown;
  textIndexDirectory: string;
  visualIndexDirectory: string;
  incrementalPlans?: Readonly<{
    text?: unknown;
    visual?: unknown;
  }>;
};

export type PackageKnowledgeIndexV2Result = {
  indexBundle: KnowledgeIndexBundleV2;
  configsByVersionId: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  report: KnowledgeIndexPackagingReportV2;
  controlDirectory: string;
  incrementalPlans: Readonly<{
    text: IncrementalIndexPlanV2 | null;
    visual: IncrementalIndexPlanV2 | null;
  }>;
};

export type PackageKnowledgeTextIndexV2Input = {
  workspaceRoot: string;
  outputRoot: string;
  corpusBundle: unknown;
  textIndexDirectory: string;
  incrementalPlan?: unknown;
};

export type PackageKnowledgeTextIndexV2Result = {
  indexBundle: KnowledgeIndexBundleV2;
  configsByVersionId: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  report: KnowledgeTextIndexPackagingReportV2;
  controlDirectory: string;
  incrementalPlan: IncrementalIndexPlanV2 | null;
};

type TextIndexManifest = z.infer<typeof TextIndexManifestSchema>;
type VisualIndexManifest = z.infer<typeof VisualIndexManifestSchema>;

type VerifiedProviderSource<T> = {
  indexDirectory: string;
  manifestPath: string;
  manifestBytes: Buffer;
  payloadPath: string;
  payloadBytes: Buffer;
  manifest: T;
};

type ExpectedTextRepresentation = {
  entry: z.infer<typeof TextIndexEntrySchema>;
  targetNodeHash: string;
  annotationId: string | null;
  annotationHash: string | null;
};

function sha256Bytes(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeStorageKey(value: string) {
  return value.split(path.sep).join("/");
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

function samePath(left: string, right: string) {
  return path.relative(left, right) === "";
}

function omitKeys(
  input: Readonly<Record<string, unknown>>,
  keys: readonly string[],
) {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => !keys.includes(key)),
  );
}

function jsonBytes(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile(filePath: string, code: string): Promise<unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `${code}:${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parsed;
}

async function assertRegularDirectChild(
  directory: string,
  fileName: string,
  code: string,
) {
  if (path.basename(fileName) !== fileName || fileName === "." || fileName === "..") {
    throw new Error(`${code}_NAME`);
  }
  const candidate = path.join(directory, fileName);
  const stats = await lstat(candidate);
  const resolved = await realpath(candidate);
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || !samePath(candidate, resolved)
    || !samePath(path.dirname(resolved), directory)
  ) {
    throw new Error(`${code}_SYMLINK_OR_ESCAPE`);
  }
  return candidate;
}

async function verifyIndexDirectory(
  directoryInput: string,
  code: string,
) {
  const directory = path.resolve(directoryInput);
  const stats = await lstat(directory);
  const resolved = await realpath(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory() || !samePath(directory, resolved)) {
    throw new Error(`${code}_SYMLINK_OR_ESCAPE`);
  }
  return directory;
}

function textIndexConfig(manifest: TextIndexManifest) {
  return {
    modelId: manifest.model.modelId,
    modelRevision: manifest.model.modelRevision,
    modelLicense: manifest.model.modelLicense,
    dimensions: manifest.model.dimensions,
    pooling: manifest.model.pooling,
    normalize: manifest.model.normalize,
    maxLength: manifest.model.maxLength,
    queryInstruction: manifest.model.queryInstruction,
    ...(manifest.model.indexEncodingPolicy
      ? { indexEncodingPolicy: manifest.model.indexEncodingPolicy }
      : {}),
    includedNodeKinds: manifest.model.includedNodeKinds,
    includedAnnotation: manifest.model.includedAnnotation,
  };
}

function visualIndexConfig(manifest: VisualIndexManifest) {
  return {
    provider: "siglip2",
    adapter: manifest.adapter,
    config: manifest.config,
  } as const;
}

function expectedTextRepresentations(corpus: KnowledgeCorpusBundleV2) {
  const expected: ExpectedTextRepresentation[] = [];
  for (const knowledgeObject of corpus.objects) {
    const nodesById = new Map(
      knowledgeObject.nodes.map((node) => [node.id, node]),
    );
    for (const node of knowledgeObject.nodes) {
      if (
        node.kind !== "DOCUMENT"
        && node.kind !== "SECTION"
        && node.kind !== "TEXT"
      ) {
        continue;
      }
      const representationId = `text-rep-${
        sha256StableJsonV2([
          "NODE",
          knowledgeObject.id,
          node.id,
          node.contentHash,
        ]).slice(0, 32)
      }`;
      const unhashed = {
        representationId,
        nodeId: node.id,
        objectId: knowledgeObject.id,
        coursePackId: knowledgeObject.sourceCoursePack.id,
        sourceKind: "NODE" as const,
        nodeKind: node.kind,
        role: node.kind === "TEXT" ? node.role : null,
        contentHash: node.contentHash,
      };
      expected.push({
        entry: {
          ...unhashed,
          recordHash: sha256StableJsonV2(unhashed),
          tensorOffset: -1,
        },
        targetNodeHash: node.contentHash,
        annotationId: null,
        annotationHash: null,
      });
    }
    for (const annotation of knowledgeObject.annotations) {
      if (annotation.kind !== "CAPTION" || annotation.origin !== "SOURCE") {
        continue;
      }
      const target = nodesById.get(annotation.targetNodeId);
      if (!target || target.kind !== "IMAGE") {
        throw new Error(
          `KNOWLEDGE_INDEX_PACKAGE_CAPTION_TARGET_INVALID:${annotation.id}`,
        );
      }
      const representationId = `text-rep-${
        sha256StableJsonV2([
          "SOURCE_CAPTION",
          knowledgeObject.id,
          annotation.id,
          annotation.annotationHash,
        ]).slice(0, 32)
      }`;
      const unhashed = {
        representationId,
        nodeId: target.id,
        objectId: knowledgeObject.id,
        coursePackId: knowledgeObject.sourceCoursePack.id,
        sourceKind: "SOURCE_CAPTION" as const,
        nodeKind: "IMAGE" as const,
        role: "CAPTION",
        contentHash: annotation.annotationHash,
      };
      expected.push({
        entry: {
          ...unhashed,
          recordHash: sha256StableJsonV2(unhashed),
          tensorOffset: -1,
        },
        targetNodeHash: target.contentHash,
        annotationId: annotation.id,
        annotationHash: annotation.annotationHash,
      });
    }
  }
  expected.sort((left, right) =>
    left.entry.representationId < right.entry.representationId
      ? -1
      : left.entry.representationId > right.entry.representationId
        ? 1
        : 0);
  return expected.map((item, tensorOffset) => ({
    ...item,
    entry: { ...item.entry, tensorOffset },
  }));
}

function expectedVisualRegions(
  assetPath: string,
  vectorOffset: number,
): z.infer<typeof VisualRegionSchema>[] {
  if (path.posix.basename(assetPath).startsWith("poster-")) {
    return [
      {
        name: "ORIGINAL_ART",
        bbox: {
          coordinateSpace: "NORMALIZED",
          x: 35 / 905,
          y: 260 / 1280,
          width: 410 / 905,
          height: 500 / 1280,
        },
        tensorKey: "embeddings",
        vectorOffset,
        vectorCount: 1,
      },
      {
        name: "ANALYSIS_OVERLAY",
        bbox: {
          coordinateSpace: "NORMALIZED",
          x: 460 / 905,
          y: 260 / 1280,
          width: 410 / 905,
          height: 500 / 1280,
        },
        tensorKey: "embeddings",
        vectorOffset: vectorOffset + 1,
        vectorCount: 1,
      },
    ];
  }
  return [{
    name: "FULL_IMAGE",
    bbox: {
      coordinateSpace: "NORMALIZED",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
    tensorKey: "embeddings",
    vectorOffset,
    vectorCount: 1,
  }];
}

function expectedVisualEntries(corpus: KnowledgeCorpusBundleV2) {
  const ownerByAssetId = new Map<string, {
    objectId: string;
    coursePackId: z.infer<typeof CoursePackIdSchema>;
  }>();
  for (const knowledgeObject of corpus.objects) {
    for (const assetId of knowledgeObject.assetIds) {
      const existing = ownerByAssetId.get(assetId);
      if (existing && existing.objectId !== knowledgeObject.id) {
        throw new Error(`KNOWLEDGE_INDEX_PACKAGE_ASSET_OWNER_CONFLICT:${assetId}`);
      }
      ownerByAssetId.set(assetId, {
        objectId: knowledgeObject.id,
        coursePackId: knowledgeObject.sourceCoursePack.id,
      });
    }
  }
  let vectorOffset = 0;
  return [...corpus.assets]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((asset) => {
      const owner = ownerByAssetId.get(asset.id);
      if (!owner) {
        throw new Error(`KNOWLEDGE_INDEX_PACKAGE_ASSET_OWNER_MISSING:${asset.id}`);
      }
      const regions = expectedVisualRegions(asset.locator.path, vectorOffset);
      vectorOffset += regions.length;
      return {
        asset,
        entry: {
          assetId: asset.id,
          coursePackId: owner.coursePackId,
          sourceSha256: asset.sha256,
          representationId: `siglip2-asset-${asset.id.replace(/^asset-/, "")}`,
          regions,
        },
      };
    });
}

async function verifyTextProviderSource(input: {
  indexDirectory: string;
  corpus: KnowledgeCorpusBundleV2;
}): Promise<VerifiedProviderSource<TextIndexManifest>> {
  const indexDirectory = await verifyIndexDirectory(
    input.indexDirectory,
    "KNOWLEDGE_INDEX_PACKAGE_TEXT_DIRECTORY",
  );
  const manifestPath = await assertRegularDirectChild(
    indexDirectory,
    "index-manifest.json",
    "KNOWLEDGE_INDEX_PACKAGE_TEXT_MANIFEST",
  );
  const manifestBytes = await readFile(manifestPath);
  const manifest = TextIndexManifestSchema.parse(
    await readJsonFile(
      manifestPath,
      "KNOWLEDGE_INDEX_PACKAGE_TEXT_MANIFEST_INVALID",
    ),
  );
  const payloadPath = await assertRegularDirectChild(
    indexDirectory,
    manifest.payload.fileName,
    "KNOWLEDGE_INDEX_PACKAGE_TEXT_PAYLOAD",
  );
  const payloadBytes = await readFile(payloadPath);
  const unhashed = {
    ...manifest,
    identity: omitKeys(manifest.identity, ["indexBundleHash"]),
  };
  if (
    sha256StableJsonV2(unhashed) !== manifest.identity.indexBundleHash
    || path.basename(indexDirectory) !== manifest.identity.indexBundleHash
  ) {
    throw new Error("KNOWLEDGE_INDEX_PACKAGE_TEXT_PROVIDER_HASH_DRIFT");
  }
  if (
    manifest.identity.corpusBundleHash !== input.corpus.bundleHash
    || manifest.payload.byteLength !== payloadBytes.byteLength
    || manifest.payload.sha256 !== sha256Bytes(payloadBytes)
  ) {
    throw new Error("KNOWLEDGE_INDEX_PACKAGE_TEXT_PAYLOAD_OR_CORPUS_DRIFT");
  }
  const config = textIndexConfig(manifest);
  if (
    manifest.configHash !== sha256StableJsonV2(config)
    || manifest.recordCount !== manifest.entries.length
    || stableJsonV2(manifest.payload.shape)
      !== stableJsonV2([manifest.entries.length, 512])
  ) {
    throw new Error("KNOWLEDGE_INDEX_PACKAGE_TEXT_CONFIG_OR_COUNT_DRIFT");
  }
  const expected = expectedTextRepresentations(input.corpus);
  if (
    expected.length !== manifest.entries.length
    || stableJsonV2(expected.map(({ entry }) => entry))
      !== stableJsonV2(manifest.entries)
  ) {
    throw new Error("KNOWLEDGE_INDEX_PACKAGE_TEXT_CORPUS_MAPPING_DRIFT");
  }
  return {
    indexDirectory,
    manifestPath,
    manifestBytes,
    payloadPath,
    payloadBytes,
    manifest,
  };
}

async function verifyVisualProviderSource(input: {
  indexDirectory: string;
  corpus: KnowledgeCorpusBundleV2;
}): Promise<VerifiedProviderSource<VisualIndexManifest>> {
  const indexDirectory = await verifyIndexDirectory(
    input.indexDirectory,
    "KNOWLEDGE_INDEX_PACKAGE_VISUAL_DIRECTORY",
  );
  const manifestPath = await assertRegularDirectChild(
    indexDirectory,
    "manifest.json",
    "KNOWLEDGE_INDEX_PACKAGE_VISUAL_MANIFEST",
  );
  const manifestBytes = await readFile(manifestPath);
  const manifest = VisualIndexManifestSchema.parse(
    await readJsonFile(
      manifestPath,
      "KNOWLEDGE_INDEX_PACKAGE_VISUAL_MANIFEST_INVALID",
    ),
  );
  const payloadPath = await assertRegularDirectChild(
    indexDirectory,
    manifest.payload.filename,
    "KNOWLEDGE_INDEX_PACKAGE_VISUAL_PAYLOAD",
  );
  const payloadBytes = await readFile(payloadPath);
  if (
    path.basename(indexDirectory) !== manifest.identity.indexBundleHash
  ) {
    throw new Error("KNOWLEDGE_INDEX_PACKAGE_VISUAL_PROVIDER_HASH_DRIFT");
  }
  // The provider hash is sealed by the Python index runtime. Recomputing it
  // after JSON.parse in JavaScript is not sound: Python preserves 0.0/1.0 in
  // its canonical JSON while JavaScript numbers serialize those values as
  // 0/1. The packager instead binds the declared hash to the content-addressed
  // directory, copies the exact manifest bytes, hashes those bytes into the
  // control-plane payload, and independently revalidates every corpus/model/
  // payload/source/region field below. The Python runtime remains responsible
  // for verifying the provider's own canonical hash before serving queries.
  if (
    manifest.identity.corpusBundleHash !== input.corpus.bundleHash
    || manifest.payload.sizeBytes !== payloadBytes.byteLength
    || manifest.payload.sha256 !== sha256Bytes(payloadBytes)
  ) {
    throw new Error("KNOWLEDGE_INDEX_PACKAGE_VISUAL_PAYLOAD_OR_CORPUS_DRIFT");
  }
  const expected = expectedVisualEntries(input.corpus);
  const expectedEntries = expected.map(({ entry }) => entry);
  const regionCount = expectedEntries.reduce(
    (sum, entry) => sum + entry.regions.length,
    0,
  );
  if (
    manifest.assetCount !== expectedEntries.length
    || manifest.regionCount !== regionCount
    || stableJsonV2(manifest.entries) !== stableJsonV2(expectedEntries)
  ) {
    throw new Error("KNOWLEDGE_INDEX_PACKAGE_VISUAL_CORPUS_MAPPING_DRIFT");
  }
  return {
    indexDirectory,
    manifestPath,
    manifestBytes,
    payloadPath,
    payloadBytes,
    manifest,
  };
}

async function assertNoSymlinkPath(
  root: string,
  candidate: string,
  code: string,
) {
  if (!isWithin(root, candidate)) throw new Error(`${code}_ESCAPE`);
  const relative = path.relative(root, candidate);
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const stats = await lstat(cursor);
      if (stats.isSymbolicLink()) throw new Error(`${code}_SYMLINK`);
    } catch (error) {
      const value = error as NodeJS.ErrnoException;
      if (value.code === "ENOENT") break;
      throw error;
    }
  }
}

async function prepareOutputRoot(
  workspaceRootInput: string,
  outputRootInput: string,
) {
  const workspaceRoot = await realpath(path.resolve(workspaceRootInput));
  const outputRoot = path.resolve(outputRootInput);
  const expected = path.join(workspaceRoot, ".runtime", "knowledge-index");
  if (!samePath(outputRoot, expected)) {
    throw new Error("KNOWLEDGE_INDEX_PACKAGE_OUTPUT_ROOT_MUST_BE_EXPLICIT_RUNTIME_ROOT");
  }
  await assertNoSymlinkPath(
    workspaceRoot,
    outputRoot,
    "KNOWLEDGE_INDEX_PACKAGE_OUTPUT",
  );
  await mkdir(outputRoot, { recursive: true });
  const outputReal = await realpath(outputRoot);
  if (!samePath(outputRoot, outputReal)) {
    throw new Error("KNOWLEDGE_INDEX_PACKAGE_OUTPUT_SYMLINK");
  }
  return { workspaceRoot, outputRoot };
}

async function verifyExactFiles(
  directory: string,
  files: Readonly<Record<string, Buffer>>,
  conflictCode: string,
) {
  const stats = await lstat(directory);
  const resolved = await realpath(directory);
  if (
    stats.isSymbolicLink()
    || !stats.isDirectory()
    || !samePath(directory, resolved)
  ) {
    throw new Error(`${conflictCode}_SYMLINK`);
  }
  const names = (await readdir(directory)).sort();
  const expectedNames = Object.keys(files).sort();
  if (stableJsonV2(names) !== stableJsonV2(expectedNames)) {
    throw new Error(conflictCode);
  }
  for (const fileName of names) {
    const filePath = await assertRegularDirectChild(
      directory,
      fileName,
      conflictCode,
    );
    const actual = await readFile(filePath);
    const expected = files[fileName]!;
    if (
      actual.byteLength !== expected.byteLength
      || sha256Bytes(actual) !== sha256Bytes(expected)
    ) {
      throw new Error(conflictCode);
    }
  }
}

async function publishAtomicDirectory(input: {
  root: string;
  parent: string;
  finalName: string;
  files: Readonly<Record<string, Buffer>>;
  conflictCode: string;
}) {
  await assertNoSymlinkPath(input.root, input.parent, input.conflictCode);
  await mkdir(input.parent, { recursive: true });
  const realParent = await realpath(input.parent);
  if (!samePath(input.parent, realParent) || !isWithin(input.root, realParent)) {
    throw new Error(`${input.conflictCode}_SYMLINK`);
  }
  const finalDirectory = path.join(input.parent, input.finalName);
  try {
    await lstat(finalDirectory);
    await verifyExactFiles(finalDirectory, input.files, input.conflictCode);
    return finalDirectory;
  } catch (error) {
    const value = error as NodeJS.ErrnoException;
    if (value.code !== "ENOENT") throw error;
  }

  const staging = path.join(input.parent, `.building-${randomUUID()}`);
  await mkdir(staging, { recursive: false });
  try {
    for (const [fileName, bytes] of Object.entries(input.files)) {
      const filePath = path.join(staging, fileName);
      await writeFile(filePath, bytes, { flag: "wx" });
    }
    await verifyExactFiles(staging, input.files, input.conflictCode);
    try {
      await rename(staging, finalDirectory);
    } catch (error) {
      const value = error as NodeJS.ErrnoException;
      if (value.code !== "EEXIST" && value.code !== "ENOTEMPTY") throw error;
      await verifyExactFiles(finalDirectory, input.files, input.conflictCode);
    }
    return finalDirectory;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function sharedPayload(input: {
  id: string;
  providerIndexHash: string;
  manifestStorageKey: string;
  manifestBytes: Buffer;
  tensorStorageKey: string;
  tensorBytes: Buffer;
  tensors: Array<{ key: string; dimensions: number; vectorCount: number }>;
}): SharedIndexPayloadV2[] {
  return [
    {
      schemaVersion: 2,
      id: `${input.id}-provider-manifest`,
      role: "PROVIDER_MANIFEST",
      format: "JSON",
      providerIndexHash: input.providerIndexHash,
      storageKind: "CONTROLLED_FILE",
      storageKey: input.manifestStorageKey,
      byteLength: input.manifestBytes.byteLength,
      sha256: sha256Bytes(input.manifestBytes),
    },
    {
      schemaVersion: 2,
      id: `${input.id}-vector-tensors`,
      role: "VECTOR_TENSORS",
      format: "SAFETENSORS",
      storageKind: "CONTROLLED_FILE",
      storageKey: input.tensorStorageKey,
      byteLength: input.tensorBytes.byteLength,
      sha256: sha256Bytes(input.tensorBytes),
      tensors: input.tensors,
    },
  ];
}

function textRepresentations(input: {
  corpus: KnowledgeCorpusBundleV2;
  manifest: TextIndexManifest;
  configHash: string;
}) {
  const expected = expectedTextRepresentations(input.corpus);
  return expected.map((item): KnowledgeIndexRepresentationV2 => ({
    schemaVersion: 2,
    id: item.entry.representationId,
    target: { kind: "NODE", id: item.entry.nodeId },
    channel: "TEXT_VECTOR",
    inputs: [
      { kind: "TARGET", hash: item.targetNodeHash },
      ...(item.annotationId && item.annotationHash
        ? [{
            kind: "ANNOTATION" as const,
            id: item.annotationId,
            hash: item.annotationHash,
          }]
        : []),
    ],
    indexVersion: {
      id: input.manifest.identity.indexVersionId,
      builderId: input.manifest.builder.id,
      builderVersion: input.manifest.builder.version,
      modelId: input.manifest.identity.modelId,
      modelRevision: input.manifest.identity.modelRevision,
      configHash: input.configHash,
    },
    dimensions: input.manifest.dimensions,
    vectorCount: 1,
    locator: {
      kind: "SHARED_TENSOR_SLICES",
      manifestPayloadId: "bge-text-provider-manifest",
      tensorPayloadId: "bge-text-vector-tensors",
      slices: [{
        tensorKey: input.manifest.payload.tensorKey,
        vectorOffset: item.entry.tensorOffset,
        vectorCount: 1,
      }],
    },
  }));
}

function visualRepresentations(input: {
  corpus: KnowledgeCorpusBundleV2;
  manifest: VisualIndexManifest;
  configHash: string;
}) {
  const assetsById = new Map(input.corpus.assets.map((asset) => [asset.id, asset]));
  return input.manifest.entries.map((entry): KnowledgeIndexRepresentationV2 => {
    const asset = assetsById.get(entry.assetId);
    if (!asset) {
      throw new Error(
        `KNOWLEDGE_INDEX_PACKAGE_VISUAL_TARGET_MISSING:${entry.assetId}`,
      );
    }
    return {
      schemaVersion: 2,
      id: entry.representationId,
      target: { kind: "ASSET", id: entry.assetId },
      channel: "VISUAL_VECTOR",
      inputs: [{ kind: "TARGET", hash: asset.sha256 }],
      indexVersion: {
        id: input.manifest.identity.indexVersionId,
        builderId: "lumi-visual-index",
        builderVersion: "1.0.0",
        modelId: input.manifest.identity.modelId,
        modelRevision: input.manifest.identity.modelRevision,
        configHash: input.configHash,
      },
      dimensions: input.manifest.adapter.dimensions,
      vectorCount: entry.regions.reduce(
        (sum, region) => sum + region.vectorCount,
        0,
      ),
      locator: {
        kind: "SHARED_TENSOR_SLICES",
        manifestPayloadId: "siglip2-provider-manifest",
        tensorPayloadId: "siglip2-vector-tensors",
        slices: entry.regions.map((region) => ({
          tensorKey: region.tensorKey,
          vectorOffset: region.vectorOffset,
          vectorCount: region.vectorCount,
        })),
      },
    };
  });
}

export async function packageKnowledgeIndexV2(
  input: PackageKnowledgeIndexV2Input,
): Promise<PackageKnowledgeIndexV2Result> {
  const corpus = verifyKnowledgeCorpusBundleV2(input.corpusBundle);
  const { workspaceRoot, outputRoot } = await prepareOutputRoot(
    input.workspaceRoot,
    input.outputRoot,
  );
  const [text, visual] = await Promise.all([
    verifyTextProviderSource({
      indexDirectory: input.textIndexDirectory,
      corpus,
    }),
    verifyVisualProviderSource({
      indexDirectory: input.visualIndexDirectory,
      corpus,
    }),
  ]);
  if (
    isWithin(outputRoot, text.indexDirectory)
    || isWithin(outputRoot, visual.indexDirectory)
  ) {
    throw new Error("KNOWLEDGE_INDEX_PACKAGE_SOURCE_INSIDE_OUTPUT_ROOT");
  }
  const incrementalPlans = {
    text: input.incrementalPlans?.text === undefined
      ? null
      : validatePackagedIncrementalPlanV2({
        plan: input.incrementalPlans.text,
        provider: "bge-small-zh-v1-5",
        corpusBundleHash: corpus.bundleHash,
        providerIndexBundleHash: text.manifest.identity.indexBundleHash,
        currentRecords: text.manifest.entries.map((entry, ordinal) => ({
          recordId: entry.representationId,
          reuseKey: entry.recordHash,
          ordinal,
        })),
      }),
    visual: input.incrementalPlans?.visual === undefined
      ? null
      : validatePackagedIncrementalPlanV2({
        plan: input.incrementalPlans.visual,
        provider: "siglip2",
        corpusBundleHash: corpus.bundleHash,
        providerIndexBundleHash: visual.manifest.identity.indexBundleHash,
        currentRecords: visual.manifest.entries.map((entry, ordinal) => ({
          recordId: entry.assetId,
          reuseKey: visualIncrementalReuseKeyV2({
            sourceSha256: entry.sourceSha256,
            regions: entry.regions.map(({ name, bbox }) => ({
              name,
              bbox,
            })),
            config: visual.manifest.config,
            modelRevision: visual.manifest.identity.modelRevision,
          }),
          ordinal,
        })),
      }),
  } as const;

  const providersRoot = path.join(outputRoot, "providers");
  const textProviderDirectory = await publishAtomicDirectory({
    root: outputRoot,
    parent: path.join(providersRoot, "bge-small-zh-v1-5"),
    finalName: text.manifest.identity.indexBundleHash,
    files: {
      "index-manifest.json": text.manifestBytes,
      "embeddings.safetensors": text.payloadBytes,
    },
    conflictCode: "KNOWLEDGE_INDEX_PACKAGE_TEXT_DESTINATION_CONFLICT",
  });
  const visualProviderDirectory = await publishAtomicDirectory({
    root: outputRoot,
    parent: path.join(providersRoot, "siglip2"),
    finalName: visual.manifest.identity.indexBundleHash,
    files: {
      "manifest.json": visual.manifestBytes,
      "embeddings.safetensors": visual.payloadBytes,
    },
    conflictCode: "KNOWLEDGE_INDEX_PACKAGE_VISUAL_DESTINATION_CONFLICT",
  });

  const textManifestStorageKey = normalizeStorageKey(path.relative(
    workspaceRoot,
    path.join(textProviderDirectory, "index-manifest.json"),
  ));
  const textTensorStorageKey = normalizeStorageKey(path.relative(
    workspaceRoot,
    path.join(textProviderDirectory, "embeddings.safetensors"),
  ));
  const visualManifestStorageKey = normalizeStorageKey(path.relative(
    workspaceRoot,
    path.join(visualProviderDirectory, "manifest.json"),
  ));
  const visualTensorStorageKey = normalizeStorageKey(path.relative(
    workspaceRoot,
    path.join(visualProviderDirectory, "embeddings.safetensors"),
  ));

  const textConfig = textIndexConfig(text.manifest);
  const visualConfig = visualIndexConfig(visual.manifest);
  const textConfigHash = sha256StableJsonV2(textConfig);
  const visualConfigHash = sha256StableJsonV2(visualConfig);
  const sharedPayloads = [
    ...sharedPayload({
      id: "bge-text",
      providerIndexHash: text.manifest.identity.indexBundleHash,
      manifestStorageKey: textManifestStorageKey,
      manifestBytes: text.manifestBytes,
      tensorStorageKey: textTensorStorageKey,
      tensorBytes: text.payloadBytes,
      tensors: [{
        key: text.manifest.payload.tensorKey,
        dimensions: text.manifest.dimensions,
        vectorCount: text.manifest.recordCount,
      }],
    }),
    ...sharedPayload({
      id: "siglip2",
      providerIndexHash: visual.manifest.identity.indexBundleHash,
      manifestStorageKey: visualManifestStorageKey,
      manifestBytes: visual.manifestBytes,
      tensorStorageKey: visualTensorStorageKey,
      tensorBytes: visual.payloadBytes,
      tensors: [{
        key: "embeddings",
        dimensions: visual.manifest.adapter.dimensions,
        vectorCount: visual.manifest.regionCount,
      }],
    }),
  ];
  const textRepresentationsValue = textRepresentations({
    corpus,
    manifest: text.manifest,
    configHash: textConfigHash,
  });
  const visualRepresentationsValue = visualRepresentations({
    corpus,
    manifest: visual.manifest,
    configHash: visualConfigHash,
  });
  const indexBundle = sealKnowledgeIndexBundleV2({
    schemaVersion: 2,
    corpusBundleHash: corpus.bundleHash,
    sharedPayloads,
    representations: [
      ...textRepresentationsValue,
      ...visualRepresentationsValue,
    ],
  }, corpus);
  const configsByVersionId = Object.freeze({
    [text.manifest.identity.indexVersionId]: Object.freeze(textConfig),
    [visual.manifest.identity.indexVersionId]: Object.freeze(visualConfig),
  });
  const controlStorageKey = normalizeStorageKey(path.join(
    path.relative(workspaceRoot, outputRoot),
    "control",
    indexBundle.indexBundleHash,
  ));
  const report = PackagingReportV2Schema.parse({
    schemaVersion: 2,
    corpusBundleHash: corpus.bundleHash,
    control: {
      indexBundleHash: indexBundle.indexBundleHash,
      representationCount: indexBundle.representations.length,
      sharedPayloadCount: 4,
      storageKey: controlStorageKey,
    },
    providers: {
      text: {
        provider: "bge-small-zh-v1-5",
        providerIndexHash: text.manifest.identity.indexBundleHash,
        representationCount: textRepresentationsValue.length,
        vectorCount: text.manifest.recordCount,
        storageKey: normalizeStorageKey(path.dirname(textManifestStorageKey)),
      },
      visual: {
        provider: "siglip2",
        providerIndexHash: visual.manifest.identity.indexBundleHash,
        representationCount: visualRepresentationsValue.length,
        vectorCount: visual.manifest.regionCount,
        regionSliceCount: visual.manifest.regionCount,
        storageKey: normalizeStorageKey(path.dirname(visualManifestStorageKey)),
      },
    },
    configsByVersionId: {
      [text.manifest.identity.indexVersionId]: textConfigHash,
      [visual.manifest.identity.indexVersionId]: visualConfigHash,
    },
    writes: {
      outputRoot: normalizeStorageKey(path.relative(workspaceRoot, outputRoot)),
      database: "NOT_USED",
      corpus: "READ_ONLY",
      sourceIndexes: "READ_ONLY",
    },
  });
  const controlDirectory = await publishAtomicDirectory({
    root: outputRoot,
    parent: path.join(outputRoot, "control"),
    finalName: indexBundle.indexBundleHash,
    files: {
      "knowledge-index-bundle.v2.json": jsonBytes(indexBundle),
      "configs-by-version.v2.json": jsonBytes(configsByVersionId),
      "packaging-report.v2.json": jsonBytes(report),
    },
    conflictCode: "KNOWLEDGE_INDEX_PACKAGE_CONTROL_DESTINATION_CONFLICT",
  });
  return {
    indexBundle,
    configsByVersionId,
    report,
    controlDirectory,
    incrementalPlans,
  };
}

export async function packageKnowledgeTextIndexV2(
  input: PackageKnowledgeTextIndexV2Input,
): Promise<PackageKnowledgeTextIndexV2Result> {
  const corpus = verifyKnowledgeCorpusBundleV2(input.corpusBundle);
  const { workspaceRoot, outputRoot } = await prepareOutputRoot(
    input.workspaceRoot,
    input.outputRoot,
  );
  const text = await verifyTextProviderSource({
    indexDirectory: input.textIndexDirectory,
    corpus,
  });
  if (isWithin(outputRoot, text.indexDirectory)) {
    throw new Error("KNOWLEDGE_INDEX_PACKAGE_SOURCE_INSIDE_OUTPUT_ROOT");
  }
  const incrementalPlan = input.incrementalPlan === undefined
    ? null
    : validatePackagedIncrementalPlanV2({
        plan: input.incrementalPlan,
        provider: "bge-small-zh-v1-5",
        corpusBundleHash: corpus.bundleHash,
        providerIndexBundleHash: text.manifest.identity.indexBundleHash,
        currentRecords: text.manifest.entries.map((entry, ordinal) => ({
          recordId: entry.representationId,
          reuseKey: entry.recordHash,
          ordinal,
        })),
      });

  const textProviderDirectory = await publishAtomicDirectory({
    root: outputRoot,
    parent: path.join(outputRoot, "providers", "bge-small-zh-v1-5"),
    finalName: text.manifest.identity.indexBundleHash,
    files: {
      "index-manifest.json": text.manifestBytes,
      "embeddings.safetensors": text.payloadBytes,
    },
    conflictCode: "KNOWLEDGE_INDEX_PACKAGE_TEXT_DESTINATION_CONFLICT",
  });
  const textManifestStorageKey = normalizeStorageKey(path.relative(
    workspaceRoot,
    path.join(textProviderDirectory, "index-manifest.json"),
  ));
  const textTensorStorageKey = normalizeStorageKey(path.relative(
    workspaceRoot,
    path.join(textProviderDirectory, "embeddings.safetensors"),
  ));
  const textConfig = textIndexConfig(text.manifest);
  const textConfigHash = sha256StableJsonV2(textConfig);
  const textRepresentationsValue = textRepresentations({
    corpus,
    manifest: text.manifest,
    configHash: textConfigHash,
  });
  const indexBundle = sealKnowledgeIndexBundleV2({
    schemaVersion: 2,
    corpusBundleHash: corpus.bundleHash,
    sharedPayloads: sharedPayload({
      id: "bge-text",
      providerIndexHash: text.manifest.identity.indexBundleHash,
      manifestStorageKey: textManifestStorageKey,
      manifestBytes: text.manifestBytes,
      tensorStorageKey: textTensorStorageKey,
      tensorBytes: text.payloadBytes,
      tensors: [{
        key: text.manifest.payload.tensorKey,
        dimensions: text.manifest.dimensions,
        vectorCount: text.manifest.recordCount,
      }],
    }),
    representations: textRepresentationsValue,
  }, corpus);
  const configsByVersionId = Object.freeze({
    [text.manifest.identity.indexVersionId]: Object.freeze(textConfig),
  });
  const controlStorageKey = normalizeStorageKey(path.join(
    path.relative(workspaceRoot, outputRoot),
    "control",
    indexBundle.indexBundleHash,
  ));
  const report = TextOnlyPackagingReportV2Schema.parse({
    schemaVersion: 2,
    mode: "TEXT_ONLY",
    corpusBundleHash: corpus.bundleHash,
    control: {
      indexBundleHash: indexBundle.indexBundleHash,
      representationCount: indexBundle.representations.length,
      sharedPayloadCount: 2,
      storageKey: controlStorageKey,
    },
    providers: {
      text: {
        provider: "bge-small-zh-v1-5",
        providerIndexHash: text.manifest.identity.indexBundleHash,
        representationCount: textRepresentationsValue.length,
        vectorCount: text.manifest.recordCount,
        storageKey: normalizeStorageKey(path.dirname(textManifestStorageKey)),
      },
      visual: null,
    },
    configsByVersionId: {
      [text.manifest.identity.indexVersionId]: textConfigHash,
    },
    writes: {
      outputRoot: normalizeStorageKey(path.relative(workspaceRoot, outputRoot)),
      database: "NOT_USED",
      corpus: "READ_ONLY",
      sourceIndexes: "READ_ONLY",
    },
  });
  const controlDirectory = await publishAtomicDirectory({
    root: outputRoot,
    parent: path.join(outputRoot, "control"),
    finalName: indexBundle.indexBundleHash,
    files: {
      "knowledge-index-bundle.v2.json": jsonBytes(indexBundle),
      "configs-by-version.v2.json": jsonBytes(configsByVersionId),
      "packaging-report.v2.json": jsonBytes(report),
    },
    conflictCode: "KNOWLEDGE_INDEX_PACKAGE_CONTROL_DESTINATION_CONFLICT",
  });
  return {
    indexBundle,
    configsByVersionId,
    report,
    controlDirectory,
    incrementalPlan,
  };
}

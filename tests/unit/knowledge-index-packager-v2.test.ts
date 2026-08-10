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

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  attachIncrementalIndexOutputV2,
  createIncrementalIndexPlanV2,
  visualIncrementalReuseKeyV2,
} from "@/lib/knowledge/incremental-index-plan-v2";
import { verifyKnowledgeIndexPayloadsV2 } from "@/lib/knowledge/knowledge-index-v2";
import {
  packageKnowledgeIndexV2,
  packageKnowledgeTextIndexV2,
} from "@/lib/knowledge/knowledge-index-packager-v2";
import {
  sha256StableJsonV2,
  stableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";

const temporaryRoots: string[] = [];
let corpus: KnowledgeCorpusBundleV2;

beforeAll(async () => {
  corpus = verifyKnowledgeCorpusBundleV2(JSON.parse(await readFile(
    path.join(process.cwd(), "data", "knowledge-v2", "knowledge-corpus.v2.json"),
    "utf8",
  )) as unknown);
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

function hashBytes(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function preservePythonVisualFloats(value: string) {
  return value
    .replace(/"x": ?0(?=[,}])/g, (match) => `${match}.0`)
    .replace(/"y": ?0(?=[,}])/g, (match) => `${match}.0`)
    .replace(/"width": ?1(?=[,}])/g, (match) => `${match}.0`)
    .replace(/"height": ?1(?=[,}])/g, (match) => `${match}.0`);
}

function pythonVisualProviderHash(value: unknown) {
  return hashBytes(Buffer.from(
    preservePythonVisualFloats(stableJsonV2(value)),
    "utf8",
  ));
}

function pythonStyleVisualManifestBytes(value: unknown) {
  return Buffer.from(
    `${preservePythonVisualFloats(JSON.stringify(value, null, 2))}\n`,
    "utf8",
  );
}

function textEntries(bundle: KnowledgeCorpusBundleV2) {
  const entries: Array<Record<string, unknown>> = [];
  for (const knowledgeObject of bundle.objects) {
    for (const node of knowledgeObject.nodes) {
      if (
        node.kind !== "DOCUMENT"
        && node.kind !== "SECTION"
        && node.kind !== "TEXT"
      ) {
        continue;
      }
      const unhashed = {
        representationId: `text-rep-${
          sha256StableJsonV2([
            "NODE",
            knowledgeObject.id,
            node.id,
            node.contentHash,
          ]).slice(0, 32)
        }`,
        nodeId: node.id,
        objectId: knowledgeObject.id,
        coursePackId: knowledgeObject.sourceCoursePack.id,
        sourceKind: "NODE",
        nodeKind: node.kind,
        role: node.kind === "TEXT" ? node.role : null,
        contentHash: node.contentHash,
      };
      entries.push({
        ...unhashed,
        recordHash: sha256StableJsonV2(unhashed),
      });
    }
    for (const annotation of knowledgeObject.annotations) {
      if (annotation.kind !== "CAPTION" || annotation.origin !== "SOURCE") {
        continue;
      }
      const target = knowledgeObject.nodes.find(
        ({ id }) => id === annotation.targetNodeId,
      );
      if (!target || target.kind !== "IMAGE") {
        throw new Error(`fixture caption target missing: ${annotation.id}`);
      }
      const unhashed = {
        representationId: `text-rep-${
          sha256StableJsonV2([
            "SOURCE_CAPTION",
            knowledgeObject.id,
            annotation.id,
            annotation.annotationHash,
          ]).slice(0, 32)
        }`,
        nodeId: target.id,
        objectId: knowledgeObject.id,
        coursePackId: knowledgeObject.sourceCoursePack.id,
        sourceKind: "SOURCE_CAPTION",
        nodeKind: "IMAGE",
        role: "CAPTION",
        contentHash: annotation.annotationHash,
      };
      entries.push({
        ...unhashed,
        recordHash: sha256StableJsonV2(unhashed),
      });
    }
  }
  entries.sort((left, right) =>
    String(left.representationId).localeCompare(String(right.representationId)));
  return entries.map((entry, tensorOffset) => ({ ...entry, tensorOffset }));
}

function visualRegions(assetPath: string, vectorOffset: number) {
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

function visualEntries(bundle: KnowledgeCorpusBundleV2) {
  const courseByAsset = new Map<string, string>();
  for (const knowledgeObject of bundle.objects) {
    for (const assetId of knowledgeObject.assetIds) {
      courseByAsset.set(assetId, knowledgeObject.sourceCoursePack.id);
    }
  }
  let vectorOffset = 0;
  return [...bundle.assets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((asset) => {
      const regions = visualRegions(asset.locator.path, vectorOffset);
      vectorOffset += regions.length;
      return {
        assetId: asset.id,
        coursePackId: courseByAsset.get(asset.id),
        sourceSha256: asset.sha256,
        representationId: `siglip2-asset-${asset.id.replace(/^asset-/, "")}`,
        regions,
      };
    });
}

async function writeProviderFixtures(input: {
  workspaceRoot: string;
  mutateTextEntries?: (entries: Array<Record<string, unknown>>) => void;
  visualAggregationProfile?: "MAX_REGION" | "L2_NORMALIZED_MEAN_REGION";
  omitVisualAttribution?: boolean;
  visualIndexVersionOverride?: string;
}) {
  const sourceRoot = path.join(input.workspaceRoot, "source-indexes");
  const textPayload = Buffer.from("fixture-bge-safetensors");
  const textConfig = {
    modelId: "BAAI/bge-small-zh-v1.5",
    modelRevision: "7999e1d3359715c523056ef9478215996d62a620",
    modelLicense: "MIT",
    dimensions: 512,
    pooling: "CLS",
    normalize: true,
    maxLength: 512,
    queryInstruction: "为这个句子生成表示以用于检索相关文章：",
    includedNodeKinds: ["DOCUMENT", "SECTION", "TEXT"],
    includedAnnotation: { kind: "CAPTION", origin: "SOURCE" },
  };
  const generatedTextEntries = textEntries(corpus);
  input.mutateTextEntries?.(generatedTextEntries);
  const textManifestBase = {
    schemaVersion: 1,
    identity: {
      corpusBundleHash: corpus.bundleHash,
      indexVersionId: "bge-small-zh-v1-5-fixture",
      modelId: textConfig.modelId,
      modelRevision: textConfig.modelRevision,
    },
    model: {
      ...textConfig,
      directorySha256: "1".repeat(64),
      sealSha256: "2".repeat(64),
    },
    builder: {
      id: "lumi-bge-text-index",
      version: "1.0.0",
      python: "3.12.10",
    },
    configHash: sha256StableJsonV2(textConfig),
    dimensions: 512,
    recordCount: generatedTextEntries.length,
    entries: generatedTextEntries,
    payload: {
      fileName: "embeddings.safetensors",
      format: "SAFETENSORS_F32",
      sha256: hashBytes(textPayload),
      byteLength: textPayload.byteLength,
      tensorKey: "embeddings",
      shape: [generatedTextEntries.length, 512],
    },
  };
  const textHash = sha256StableJsonV2(textManifestBase);
  const textManifest = {
    ...textManifestBase,
    identity: {
      ...textManifestBase.identity,
      indexBundleHash: textHash,
    },
  };
  const textIndexDirectory = path.join(sourceRoot, "text", textHash);
  await mkdir(textIndexDirectory, { recursive: true });
  await writeFile(
    path.join(textIndexDirectory, "index-manifest.json"),
    jsonBytes(textManifest),
  );
  await writeFile(
    path.join(textIndexDirectory, "embeddings.safetensors"),
    textPayload,
  );

  const visualPayload = Buffer.from("fixture-siglip2-safetensors");
  const generatedVisualEntries = visualEntries(corpus);
  const regionCount = generatedVisualEntries.reduce(
    (sum, entry) => sum + entry.regions.length,
    0,
  );
  const visualAggregationProfile =
    input.visualAggregationProfile ?? "MAX_REGION";
  const visualIdentityBase = {
    corpusBundleHash: corpus.bundleHash,
    indexVersionId: input.visualIndexVersionOverride ?? (
      visualAggregationProfile === "L2_NORMALIZED_MEAN_REGION"
        ? "siglip2-224-two-region-i2i-l2-mean-v2"
        : "siglip2-224-two-region-v1"
    ),
    modelId: "google/siglip2-base-patch16-224",
    modelRevision: "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
  };
  const visualProviderValues = {
    assetManifestSha256: "3".repeat(64),
    modelDirectorySha256: "4".repeat(64),
    modelSealSha256: "5".repeat(64),
    config: {
      schemaVersion: 1,
      adapter: "siglip2",
      sourcePixelsOnly: true,
      answerTextExcluded: true,
      regions: {
        grid: [{
          name: "FULL_IMAGE",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        }],
      },
      ...(visualAggregationProfile === "L2_NORMALIZED_MEAN_REGION"
        ? {
            singleVectorAggregationByMode: {
              TEXT_TO_IMAGE: "MAX_REGION",
              IMAGE_TO_IMAGE: "L2_NORMALIZED_MEAN_REGION",
              IMAGE_TEXT_TO_IMAGE: "MAX_REGION",
            },
            ...(!input.omitVisualAttribution
              ? {
                  singleVectorRegionAttributionByMode: {
                    IMAGE_TO_IMAGE:
                      "MAX_QUERY_SIMILARITY_FIRST_REGION_TIE",
                  },
                }
              : {}),
          }
        : {}),
    },
    entries: generatedVisualEntries,
    payload: {
      filename: "embeddings.safetensors",
      sizeBytes: visualPayload.byteLength,
      sha256: hashBytes(visualPayload),
    },
  };
  const visualProviderHashPayload = {
    ...visualIdentityBase,
    ...visualProviderValues,
  };
  const visualJsHash = sha256StableJsonV2(visualProviderHashPayload);
  const visualHash = pythonVisualProviderHash(visualProviderHashPayload);
  const visualManifest = {
    schemaVersion: 1,
    identity: {
      ...visualIdentityBase,
      indexBundleHash: visualHash,
    },
    adapter: {
      name: "siglip2",
      kind: "SINGLE_VECTOR",
      dimensions: 768,
      capabilities: [
        "TEXT_TO_IMAGE",
        "IMAGE_TO_IMAGE",
        "NORMALIZED_REGIONS",
      ],
    },
    assetCount: generatedVisualEntries.length,
    regionCount,
    assetManifestSha256: visualProviderValues.assetManifestSha256,
    modelDirectorySha256: visualProviderValues.modelDirectorySha256,
    modelSealSha256: visualProviderValues.modelSealSha256,
    modelFiles: [{ path: "model.safetensors", sha256: "6".repeat(64) }],
    config: visualProviderValues.config,
    payload: visualProviderValues.payload,
    entries: generatedVisualEntries,
  };
  const visualIndexDirectory = path.join(sourceRoot, "visual", visualHash);
  await mkdir(visualIndexDirectory, { recursive: true });
  await writeFile(
    path.join(visualIndexDirectory, "manifest.json"),
    pythonStyleVisualManifestBytes(visualManifest),
  );
  await writeFile(
    path.join(visualIndexDirectory, "embeddings.safetensors"),
    visualPayload,
  );
  return {
    textHash,
    textIndexDirectory,
    visualHash,
    visualJsHash,
    visualIndexDirectory,
    regionCount,
  };
}

describe("knowledge index V2 control-plane packager", () => {
  it("atomically packages BGE nodes/captions and SigLIP2 assets without writing a database", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "knowledge-index-package-v2-"),
    );
    temporaryRoots.push(workspaceRoot);
    const providers = await writeProviderFixtures({ workspaceRoot });
    const outputRoot = path.join(workspaceRoot, ".runtime", "knowledge-index");

    const first = await packageKnowledgeIndexV2({
      workspaceRoot,
      outputRoot,
      corpusBundle: corpus,
      textIndexDirectory: providers.textIndexDirectory,
      visualIndexDirectory: providers.visualIndexDirectory,
    });
    const second = await packageKnowledgeIndexV2({
      workspaceRoot,
      outputRoot,
      corpusBundle: corpus,
      textIndexDirectory: providers.textIndexDirectory,
      visualIndexDirectory: providers.visualIndexDirectory,
    });

    expect(first.indexBundle.indexBundleHash).toBe(
      second.indexBundle.indexBundleHash,
    );
    expect(first.report.providers.text).toMatchObject({
      providerIndexHash: providers.textHash,
      representationCount: 1704,
      vectorCount: 1704,
    });
    expect(first.report.providers.visual).toMatchObject({
      providerIndexHash: providers.visualHash,
      representationCount: 156,
      vectorCount: 306,
      regionSliceCount: 306,
    });
    expect(providers.visualHash).not.toBe(providers.visualJsHash);
    await expect(readFile(path.join(
      providers.visualIndexDirectory,
      "manifest.json",
    ), "utf8")).resolves.toContain("\"x\": 0.0");
    expect(first.report.control).toMatchObject({
      representationCount: 1860,
      sharedPayloadCount: 4,
    });
    expect(first.report.control.indexBundleHash).not.toBe(providers.textHash);
    expect(first.report.control.indexBundleHash).not.toBe(providers.visualHash);
    expect(first.report.writes).toEqual({
      outputRoot: ".runtime/knowledge-index",
      database: "NOT_USED",
      corpus: "READ_ONLY",
      sourceIndexes: "READ_ONLY",
    });
    expect(first.indexBundle.sharedPayloads).toHaveLength(4);

    const sourceCaption = first.indexBundle.representations.find(
      (representation) =>
        representation.channel === "TEXT_VECTOR"
        && representation.inputs.some(({ kind }) => kind === "ANNOTATION"),
    );
    expect(sourceCaption).toMatchObject({
      target: { kind: "NODE" },
      vectorCount: 1,
    });
    expect(sourceCaption?.inputs.map(({ kind }) => kind)).toEqual([
      "TARGET",
      "ANNOTATION",
    ]);
    const visual = first.indexBundle.representations.filter(
      ({ channel }) => channel === "VISUAL_VECTOR",
    );
    expect(visual).toHaveLength(156);
    expect(visual.reduce(
      (sum, representation) =>
        sum + (representation.locator?.slices.length ?? 0),
      0,
    )).toBe(306);

    await expect(verifyKnowledgeIndexPayloadsV2({
      workspaceRoot,
      corpusBundle: corpus,
      indexBundle: first.indexBundle,
    })).resolves.toEqual(first.indexBundle);
    await expect(readFile(path.join(
      first.controlDirectory,
      "packaging-report.v2.json",
    ), "utf8")).resolves.toContain(first.indexBundle.indexBundleHash);
    await expect(readFile(path.join(
      workspaceRoot,
      "course-dev.sqlite",
    ))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("packages a provider-verified text-only generation without visual payloads", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "knowledge-text-index-package-v2-"),
    );
    temporaryRoots.push(workspaceRoot);
    const providers = await writeProviderFixtures({ workspaceRoot });
    const outputRoot = path.join(workspaceRoot, ".runtime", "knowledge-index");

    const packaged = await packageKnowledgeTextIndexV2({
      workspaceRoot,
      outputRoot,
      corpusBundle: corpus,
      textIndexDirectory: providers.textIndexDirectory,
    });

    expect(packaged.report).toMatchObject({
      mode: "TEXT_ONLY",
      control: {
        representationCount: 1704,
        sharedPayloadCount: 2,
      },
      providers: {
        text: {
          providerIndexHash: providers.textHash,
          representationCount: 1704,
          vectorCount: 1704,
        },
        visual: null,
      },
    });
    expect(packaged.indexBundle.sharedPayloads).toHaveLength(2);
    expect(new Set(packaged.indexBundle.representations.map(
      ({ channel }) => channel,
    ))).toEqual(new Set(["TEXT_VECTOR"]));
    await expect(verifyKnowledgeIndexPayloadsV2({
      workspaceRoot,
      corpusBundle: corpus,
      indexBundle: packaged.indexBundle,
    })).resolves.toEqual(packaged.indexBundle);
  });

  it("rejects corpus mapping drift and never overwrites a conflicting provider directory", async () => {
    const driftRoot = await mkdtemp(
      path.join(os.tmpdir(), "knowledge-index-package-drift-v2-"),
    );
    temporaryRoots.push(driftRoot);
    const drifted = await writeProviderFixtures({
      workspaceRoot: driftRoot,
      mutateTextEntries(entries) {
        entries[0] = {
          ...entries[0],
          coursePackId: entries[0]?.coursePackId === "book-design"
            ? "layout-design"
            : "book-design",
        };
      },
    });
    await expect(packageKnowledgeIndexV2({
      workspaceRoot: driftRoot,
      outputRoot: path.join(driftRoot, ".runtime", "knowledge-index"),
      corpusBundle: corpus,
      textIndexDirectory: drifted.textIndexDirectory,
      visualIndexDirectory: drifted.visualIndexDirectory,
    })).rejects.toThrow(/text.corpus.mapping.drift/i);

    const conflictRoot = await mkdtemp(
      path.join(os.tmpdir(), "knowledge-index-package-conflict-v2-"),
    );
    temporaryRoots.push(conflictRoot);
    const providers = await writeProviderFixtures({
      workspaceRoot: conflictRoot,
    });
    const outputRoot = path.join(
      conflictRoot,
      ".runtime",
      "knowledge-index",
    );
    await packageKnowledgeIndexV2({
      workspaceRoot: conflictRoot,
      outputRoot,
      corpusBundle: corpus,
      textIndexDirectory: providers.textIndexDirectory,
      visualIndexDirectory: providers.visualIndexDirectory,
    });
    const copiedManifest = path.join(
      outputRoot,
      "providers",
      "bge-small-zh-v1-5",
      providers.textHash,
      "index-manifest.json",
    );
    const conflict = Buffer.from("do-not-overwrite");
    await writeFile(copiedManifest, conflict);

    await expect(packageKnowledgeIndexV2({
      workspaceRoot: conflictRoot,
      outputRoot,
      corpusBundle: corpus,
      textIndexDirectory: providers.textIndexDirectory,
      visualIndexDirectory: providers.visualIndexDirectory,
    })).rejects.toThrow(/text.destination.conflict/i);
    await expect(readFile(copiedManifest)).resolves.toEqual(conflict);
  });

  it("validates detached incremental plans without putting provenance in the content address", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "knowledge-index-incremental-plan-v2-"),
    );
    temporaryRoots.push(workspaceRoot);
    const providers = await writeProviderFixtures({ workspaceRoot });
    const textManifest = JSON.parse(await readFile(path.join(
      providers.textIndexDirectory,
      "index-manifest.json",
    ), "utf8")) as {
      entries: Array<{ representationId: string; recordHash: string }>;
    };
    const visualManifest = JSON.parse(await readFile(path.join(
      providers.visualIndexDirectory,
      "manifest.json",
    ), "utf8")) as {
      identity: { modelRevision: string };
      config: unknown;
      entries: Array<{
        assetId: string;
        sourceSha256: string;
        regions: Array<{ name: string; bbox: unknown }>;
      }>;
    };
    const textPlan = attachIncrementalIndexOutputV2(
      createIncrementalIndexPlanV2({
        provider: "bge-small-zh-v1-5",
        baseIndexBundleHash: null,
        targetCorpusBundleHash: corpus.bundleHash,
        compatibilityHash: "1".repeat(64),
        baseCompatible: false,
        baseRecords: [],
        targetRecords: textManifest.entries.map((entry, ordinal) => ({
          recordId: entry.representationId,
          reuseKey: entry.recordHash,
          ordinal,
        })),
      }),
      providers.textHash,
    );
    const visualPlan = attachIncrementalIndexOutputV2(
      createIncrementalIndexPlanV2({
        provider: "siglip2",
        baseIndexBundleHash: null,
        targetCorpusBundleHash: corpus.bundleHash,
        compatibilityHash: "2".repeat(64),
        baseCompatible: false,
        baseRecords: [],
        targetRecords: visualManifest.entries.map((entry, ordinal) => ({
          recordId: entry.assetId,
          reuseKey: visualIncrementalReuseKeyV2({
            sourceSha256: entry.sourceSha256,
            regions: entry.regions.map(({ name, bbox }) => ({ name, bbox })),
            config: visualManifest.config,
            modelRevision: visualManifest.identity.modelRevision,
          }),
          ordinal,
        })),
      }),
      providers.visualHash,
    );

    const packaged = await packageKnowledgeIndexV2({
      workspaceRoot,
      outputRoot: path.join(workspaceRoot, ".runtime", "knowledge-index"),
      corpusBundle: corpus,
      textIndexDirectory: providers.textIndexDirectory,
      visualIndexDirectory: providers.visualIndexDirectory,
      incrementalPlans: {
        text: textPlan,
        visual: visualPlan,
      },
    });

    expect(packaged.incrementalPlans.text?.summary).toEqual({
      reused: 0,
      rebuilt: textManifest.entries.length,
      deleted: 0,
    });
    expect(packaged.incrementalPlans.visual?.summary).toEqual({
      reused: 0,
      rebuilt: visualManifest.entries.length,
      deleted: 0,
    });
    await expect(readFile(path.join(
      packaged.controlDirectory,
      "packaging-report.v2.json",
    ), "utf8")).resolves.not.toContain("incrementalPlans");
    await expect(packageKnowledgeIndexV2({
      workspaceRoot,
      outputRoot: path.join(workspaceRoot, ".runtime", "knowledge-index"),
      corpusBundle: corpus,
      textIndexDirectory: providers.textIndexDirectory,
      visualIndexDirectory: providers.visualIndexDirectory,
      incrementalPlans: {
        text: {
          ...textPlan,
          outputIndexBundleHash: "f".repeat(64),
        },
      },
    })).rejects.toThrow(/provider.binding.invalid/);
  });

  it("packages the I2I mean profile under a new immutable visual identity", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "knowledge-index-package-i2i-v2-"),
    );
    temporaryRoots.push(workspaceRoot);
    const providers = await writeProviderFixtures({
      workspaceRoot,
      visualAggregationProfile: "L2_NORMALIZED_MEAN_REGION",
    });
    const packaged = await packageKnowledgeIndexV2({
      workspaceRoot,
      outputRoot: path.join(workspaceRoot, ".runtime", "knowledge-index"),
      corpusBundle: corpus,
      textIndexDirectory: providers.textIndexDirectory,
      visualIndexDirectory: providers.visualIndexDirectory,
    });
    const visualVersions = new Set(
      packaged.indexBundle.representations
        .filter(({ channel }) => channel === "VISUAL_VECTOR")
        .map(({ indexVersion }) => indexVersion.id),
    );

    expect(visualVersions).toEqual(new Set([
      "siglip2-224-two-region-i2i-l2-mean-v2",
    ]));
    expect(packaged.report.providers.visual.providerIndexHash)
      .toBe(providers.visualHash);
  });

  it("rejects incomplete or version-conflicting I2I aggregation identities", async () => {
    for (const variant of ["MISSING_ATTRIBUTION", "OLD_VERSION"] as const) {
      const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), `knowledge-index-package-i2i-${variant}-`),
      );
      temporaryRoots.push(workspaceRoot);
      const providers = await writeProviderFixtures({
        workspaceRoot,
        visualAggregationProfile: "L2_NORMALIZED_MEAN_REGION",
        omitVisualAttribution: variant === "MISSING_ATTRIBUTION",
        visualIndexVersionOverride: variant === "OLD_VERSION"
          ? "siglip2-224-two-region-v1"
          : undefined,
      });
      await expect(packageKnowledgeIndexV2({
        workspaceRoot,
        outputRoot: path.join(workspaceRoot, ".runtime", "knowledge-index"),
        corpusBundle: corpus,
        textIndexDirectory: providers.textIndexDirectory,
        visualIndexDirectory: providers.visualIndexDirectory,
      })).rejects.toThrow(
        variant === "MISSING_ATTRIBUTION"
          ? /aggregation config/i
          : /aggregation profile and index version/i,
      );
    }
  });

  it("requires the explicit controlled output root", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "knowledge-index-package-output-v2-"),
    );
    temporaryRoots.push(workspaceRoot);
    const providers = await writeProviderFixtures({ workspaceRoot });
    await expect(packageKnowledgeIndexV2({
      workspaceRoot,
      outputRoot: path.join(workspaceRoot, "elsewhere"),
      corpusBundle: corpus,
      textIndexDirectory: providers.textIndexDirectory,
      visualIndexDirectory: providers.visualIndexDirectory,
    })).rejects.toThrow(/output.root.must.be.explicit.runtime.root/i);
  });
});

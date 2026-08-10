// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  KnowledgeIndexRepresentationV2Schema,
  KnowledgeLocationV2Schema,
  WorkspaceRelativePathV2Schema,
  sealKnowledgeAnnotationV2,
  sealKnowledgeCorpusBundleV2,
  sealKnowledgeIndexBundleV2,
  sealKnowledgeNodeV2,
  sealKnowledgeObjectV2,
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  verifyKnowledgeObjectV2,
} from "@/lib/knowledge/knowledge-object-v2";

const HASH = "a".repeat(64);

function fixture() {
  const asset = {
    schemaVersion: 2 as const,
    id: `asset-${"b".repeat(64)}`,
    kind: "IMAGE" as const,
    locator: {
      root: "data/courses" as const,
      path: "assets/layout-design/example.png",
    },
    mimeType: "image/png" as const,
    sizeBytes: 100,
    dimensions: { widthPx: 100, heightPx: 200 },
    sha256: HASH,
  };
  const nodes = [
    sealKnowledgeNodeV2({
      id: "node-document",
      kind: "DOCUMENT",
      parentId: null,
      childrenIds: ["node-section"],
      relatedIds: [],
      location: null,
      title: "版式层级",
    }),
    sealKnowledgeNodeV2({
      id: "node-section",
      kind: "SECTION",
      parentId: "node-document",
      childrenIds: ["node-text", "node-fact", "node-action", "node-image", "node-table"],
      relatedIds: [],
      location: null,
      title: "核心内容",
      level: 2,
    }),
    sealKnowledgeNodeV2({
      id: "node-text",
      kind: "TEXT",
      parentId: "node-section",
      childrenIds: [],
      relatedIds: [],
      location: null,
      text: "先分信息角色，再调整字号。",
      role: "CONTENT",
      legacyStatementId: null,
    }),
    sealKnowledgeNodeV2({
      id: "node-fact",
      kind: "TEXT",
      parentId: "node-section",
      childrenIds: [],
      relatedIds: [],
      location: null,
      text: "层级来自关系。",
      role: "FACT",
      legacyStatementId: "layoutprin-example-fact",
    }),
    sealKnowledgeNodeV2({
      id: "node-action",
      kind: "TEXT",
      parentId: "node-section",
      childrenIds: [],
      relatedIds: [],
      location: null,
      text: "先说清阅读任务。",
      role: "ACTION",
      legacyStatementId: "layoutprin-clarify-reading-task",
    }),
    sealKnowledgeNodeV2({
      id: "node-image",
      kind: "IMAGE",
      parentId: "node-section",
      childrenIds: ["node-region"],
      relatedIds: [],
      location: null,
      assetId: asset.id,
    }),
    sealKnowledgeNodeV2({
      id: "node-region",
      kind: "REGION",
      parentId: "node-image",
      childrenIds: [],
      relatedIds: [],
      location: {
        pageNumber: null,
        bbox: {
          coordinateSpace: "NORMALIZED",
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.4,
        },
        sourceSpan: null,
      },
      assetId: asset.id,
      label: "标题区",
    }),
    sealKnowledgeNodeV2({
      id: "node-table",
      kind: "TABLE",
      parentId: "node-section",
      childrenIds: [],
      relatedIds: [],
      location: null,
      plainText: "角色 | 尺度\n标题 | 大",
      rowCount: 2,
      columnCount: 2,
      cells: [
        { row: 0, column: 0, rowSpan: 1, columnSpan: 1, text: "角色", header: true },
        { row: 0, column: 1, rowSpan: 1, columnSpan: 1, text: "尺度", header: true },
        { row: 1, column: 0, rowSpan: 1, columnSpan: 1, text: "标题", header: false },
        { row: 1, column: 1, rowSpan: 1, columnSpan: 1, text: "大", header: false },
      ],
    }),
  ];
  const annotation = sealKnowledgeAnnotationV2({
    id: "annotation-caption",
    targetNodeId: "node-image",
    kind: "CAPTION",
    origin: "SOURCE",
    payload: { kind: "CAPTION", text: "标题和正文形成尺度对比。" },
    producer: {
      id: "fixture",
      version: "1.0.0",
      modelId: null,
      modelRevision: null,
    },
    inputs: [
      {
        kind: "SOURCE_DOCUMENT",
        path: "data/courses/layout-design/001-example.md",
        sha256: HASH,
      },
      {
        kind: "SOURCE_SECTION",
        headingPath: ["核心内容", "版式拆分"],
        sha256: HASH,
      },
      {
        kind: "ASSET",
        assetId: asset.id,
        sha256: HASH,
      },
    ],
    sourceMapping: {
      method: "ROLE_ALIAS",
      headingPath: ["核心内容", "版式拆分"],
      sourceOrdinal: 0,
    },
  });
  const object = sealKnowledgeObjectV2({
    schemaVersion: 2,
    id: "layout-example",
    title: "版式层级",
    topic: "LAYOUT_DESIGN_PRINCIPLES",
    tags: ["版式"],
    sourceCoursePack: { id: "layout-design", version: "1" },
    sourceIdentityBasis: "COURSE_DIRECTORY",
    legacyPlacement: {
      coursePack: { id: "layout-design", version: "1" },
      namespace: "layout-design-principles",
    },
    provenance: {
      authority: "TEACHER_EXPERIENCE",
      verifiedDate: "2026-07-28",
      scope: "课程示例。",
      locators: [{
        kind: "LOCAL_DOCUMENT",
        path: "data/courses/layout-design/001-example.md",
      }],
    },
    parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
    contentVersion: "knowledge-object-v2.1",
    rootNodeId: "node-document",
    nodes,
    assetIds: [asset.id],
    annotations: [annotation],
    legacyItem: {
      id: "layout-example",
      title: "版式层级",
      topic: "LAYOUT_DESIGN_PRINCIPLES",
      tags: ["版式"],
      content: "先分信息角色，再调整字号。",
      facts: [{ id: "layoutprin-example-fact", text: "层级来自关系。" }],
      actions: [{
        id: "layoutprin-clarify-reading-task",
        text: "先说清阅读任务。",
      }],
      source: {
        localDocument: "data/courses/layout-design/001-example.md",
        authority: "TEACHER_EXPERIENCE",
        verifiedDate: "2026-07-28",
        scope: "课程示例。",
      },
    },
  });
  return { asset, object };
}

describe("KnowledgeObjectV2 contract", () => {
  it("keeps content, source annotations, assets and graph structure in separate layers", () => {
    const { asset, object } = fixture();
    const bundle = sealKnowledgeCorpusBundleV2({
      schemaVersion: 2,
      corpusVersion: "2026-07-28.1",
      parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
      contentVersion: "knowledge-object-v2.1",
      objects: [object],
      assets: [asset],
      unreferencedAssetIds: [],
    });

    expect(bundle.objects[0]?.legacyItem.content).toBe("先分信息角色，再调整字号。");
    expect(bundle.objects[0]?.annotations[0]?.kind).toBe("CAPTION");
    expect(bundle.assets[0]?.dimensions).toEqual({ widthPx: 100, heightPx: 200 });
    expect(bundle.bundleHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects broken parent-child relationships and unreachable nodes", () => {
    const { object } = fixture();
    const brokenNodes = object.nodes.map((node) =>
      node.id === "node-text" ? { ...node, parentId: "node-document" } : node);
    expect(() => sealKnowledgeObjectV2({
      ...object,
      nodes: brokenNodes,
    })).toThrow(/parent|child|reachable/i);
  });

  it("rejects V2 metadata that disagrees with the preserved legacy item", () => {
    const { object } = fixture();
    expect(() => sealKnowledgeObjectV2({
      ...object,
      title: "另一份标题",
    })).toThrow(/metadata|legacy/i);
  });

  it("keeps normalized boxes inside the image", () => {
    expect(() => KnowledgeLocationV2Schema.parse({
      pageNumber: null,
      bbox: {
        coordinateSpace: "NORMALIZED",
        x: 0.8,
        y: 0.1,
        width: 0.3,
        height: 0.2,
      },
      sourceSpan: null,
    })).toThrow(/bbox/i);
  });

  it("rejects REGION nodes without a bbox and pixel boxes beyond the asset", () => {
    expect(() => sealKnowledgeNodeV2({
      id: "node-region-without-box",
      kind: "REGION",
      parentId: "node-image",
      childrenIds: [],
      relatedIds: [],
      location: null,
      assetId: `asset-${"b".repeat(64)}`,
      label: "无坐标区域",
    })).toThrow(/bbox|location/i);

    const { asset, object } = fixture();
    const nodes = object.nodes.map((node) =>
      node.id === "node-region"
        ? {
            ...node,
            location: {
              pageNumber: null,
              bbox: {
                coordinateSpace: "PIXELS" as const,
                x: 90,
                y: 0,
                width: 20,
                height: 20,
              },
              sourceSpan: null,
            },
          }
        : node);
    const pixelObject = sealKnowledgeObjectV2({ ...object, nodes });
    expect(() => sealKnowledgeCorpusBundleV2({
      schemaVersion: 2,
      corpusVersion: "2026-07-28.1",
      parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
      contentVersion: "knowledge-object-v2.1",
      objects: [pixelObject],
      assets: [asset],
      unreferencedAssetIds: [],
    })).toThrow(/bbox|exceeds/i);
  });

  it("rejects missing and duplicate asset records", () => {
    const { asset, object } = fixture();
    const bundle = {
      schemaVersion: 2,
      corpusVersion: "2026-07-28.1",
      parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
      contentVersion: "knowledge-object-v2.1",
      objects: [object],
      unreferencedAssetIds: [],
    };
    expect(() => sealKnowledgeCorpusBundleV2({
      ...bundle,
      assets: [],
    })).toThrow(/missing|asset/i);
    expect(() => sealKnowledgeCorpusBundleV2({
      ...bundle,
      assets: [asset, asset],
    })).toThrow(/duplicate asset/i);
  });

  it("requires globally unique node and annotation identities", () => {
    const { asset, object } = fixture();
    const second = sealKnowledgeObjectV2({
      ...object,
      id: "layout-example-two",
      legacyItem: {
        ...object.legacyItem,
        id: "layout-example-two",
      },
    });
    expect(() => sealKnowledgeCorpusBundleV2({
      schemaVersion: 2,
      corpusVersion: "2026-07-28.1",
      parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
      contentVersion: "knowledge-object-v2.1",
      objects: [object, second],
      assets: [asset],
      unreferencedAssetIds: [],
    })).toThrow(/duplicate global node|annotation/i);
  });

  it("detects persisted hash drift instead of silently resealing it", () => {
    const { asset, object } = fixture();
    expect(() => verifyKnowledgeObjectV2({
      ...object,
      contentHash: "c".repeat(64),
    })).toThrow(/hash.drift/i);

    const bundle = sealKnowledgeCorpusBundleV2({
      schemaVersion: 2,
      corpusVersion: "2026-07-28.1",
      parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
      contentVersion: "knowledge-object-v2.1",
      objects: [object],
      assets: [asset],
      unreferencedAssetIds: [],
    });
    expect(() => verifyKnowledgeCorpusBundleV2({
      ...bundle,
      bundleHash: "d".repeat(64),
    })).toThrow(/bundle.hash.drift/i);
  });

  it("recursively detects persisted payload drift with all old hashes retained", () => {
    const { asset, object } = fixture();
    const bundle = sealKnowledgeCorpusBundleV2({
      schemaVersion: 2,
      corpusVersion: "2026-07-28.1",
      parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
      contentVersion: "knowledge-object-v2.1",
      objects: [object],
      assets: [asset],
      unreferencedAssetIds: [],
    });

    const nodeDrift = structuredClone(bundle);
    const textNode = nodeDrift.objects[0]!.nodes.find((node) =>
      node.kind === "TEXT" && node.role === "CONTENT")!;
    if (textNode.kind === "TEXT") textNode.text = "被篡改的正文。";
    expect(() => verifyKnowledgeCorpusBundleV2(nodeDrift))
      .toThrow(/node.hash.drift/i);

    const annotationDrift = structuredClone(bundle);
    const annotation = annotationDrift.objects[0]!.annotations[0]!;
    if (annotation.payload.kind === "CAPTION") {
      annotation.payload.text = "被篡改的图片说明。";
    }
    expect(() => verifyKnowledgeCorpusBundleV2(annotationDrift))
      .toThrow(/annotation.hash.drift/i);

    const assetDrift = structuredClone(bundle);
    assetDrift.assets[0]!.sha256 = "e".repeat(64);
    expect(() => verifyKnowledgeCorpusBundleV2(assetDrift))
      .toThrow(/asset.hash.drift|bundle.hash.drift/i);
  });

  it("requires every asset to belong to exactly one reference partition", () => {
    const { asset, object } = fixture();
    const base = {
      schemaVersion: 2,
      corpusVersion: "2026-07-28.1",
      parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
      contentVersion: "knowledge-object-v2.1",
      objects: [object],
      assets: [asset],
    };
    expect(() => sealKnowledgeCorpusBundleV2({
      ...base,
      unreferencedAssetIds: [asset.id],
    })).toThrow(/both referenced and unreferenced/i);

    const objectWithoutAssets = sealKnowledgeObjectV2({
      ...object,
      nodes: object.nodes.filter((node) =>
        !["node-image", "node-region"].includes(node.id)).map((node) =>
        node.id === "node-section"
          ? {
              ...node,
              childrenIds: node.childrenIds.filter((id) =>
                !["node-image"].includes(id)),
            }
          : node),
      assetIds: [],
      annotations: [],
    });
    expect(() => sealKnowledgeCorpusBundleV2({
      ...base,
      objects: [objectWithoutAssets],
      unreferencedAssetIds: [],
    })).toThrow(/referenced or explicitly unreferenced/i);
  });

  it.each([
    "../outside.md",
    "/absolute.md",
    "C:/absolute.md",
    "safe/file:stream",
    "safe/a\u0000b",
    "safe/CON.txt",
    "safe/trailing.",
    "safe/trailing ",
  ])("rejects unsafe Windows/workspace path %s", (unsafePath) => {
    expect(() => WorkspaceRelativePathV2Schema.parse(unsafePath)).toThrow(/path/i);
  });

  it("requires immutable model identity on model-derived annotations", () => {
    const base = {
      id: "annotation-model-derived",
      targetNodeId: "node-image",
      kind: "CAPTION" as const,
      origin: "MODEL_DERIVED" as const,
      payload: { kind: "CAPTION" as const, text: "模型图片说明。" },
      inputs: [{
        kind: "ASSET" as const,
        assetId: `asset-${"b".repeat(64)}`,
        sha256: HASH,
      }],
      sourceMapping: null,
    };
    expect(() => sealKnowledgeAnnotationV2({
      ...base,
      producer: {
        id: "caption-model",
        version: "1.0.0",
        modelId: null,
        modelRevision: null,
      },
    })).toThrow(/model.*revision|model id/i);
    expect(() => sealKnowledgeAnnotationV2({
      ...base,
      producer: {
        id: "caption-model",
        version: "1.0.0",
        modelId: "example/model",
        modelRevision: "main",
      },
    })).toThrow(/immutable|revision/i);
  });

  it("keeps source caption mapping and section dependency consistent", () => {
    const { object } = fixture();
    const annotation = object.annotations[0]!;
    expect(() => sealKnowledgeAnnotationV2({
      ...annotation,
      inputs: annotation.inputs.map((input) =>
        input.kind === "SOURCE_SECTION"
          ? { ...input, headingPath: ["矛盾的小节"] }
          : input),
    })).toThrow(/section.*sourceMapping|headingPath/i);
  });

  function indexRepresentation() {
    return {
      schemaVersion: 2,
      id: "index-example",
      target: { kind: "ASSET", id: `asset-${"b".repeat(64)}` },
      channel: "VISUAL_VECTOR",
      inputs: [{ kind: "TARGET", hash: HASH }],
      indexVersion: {
        id: "visual-v1",
        builderId: "siglip-adapter",
        builderVersion: "1.0.0",
        modelId: "example/model",
        modelRevision: "immutable-revision-1",
        configHash: HASH,
      },
      dimensions: 768,
      vectorCount: 1,
      payload: {
        storageKind: "CONTROLLED_FILE",
        storageKey: "data/knowledge-index/visual-v1.bin",
        byteLength: 100,
        sha256: HASH,
      },
    } as const;
  }

  it("versions index representations independently and rejects moving revisions", () => {
    const representation = indexRepresentation();
    expect(() => KnowledgeIndexRepresentationV2Schema.parse({
      ...representation,
      indexVersion: {
        ...representation.indexVersion,
        modelRevision: "latest",
      },
    })).toThrow(/immutable|revision/i);
  });

  it("keeps index payloads inside the controlled storage directory", () => {
    const representation = indexRepresentation();
    expect(() => KnowledgeIndexRepresentationV2Schema.parse({
      ...representation,
      payload: {
        ...representation.payload,
        storageKey: "../outside.bin",
      },
    })).toThrow(/storage|path/i);
  });

  it("binds index representations to one verified corpus and current target hash", () => {
    const { asset, object } = fixture();
    const corpus = sealKnowledgeCorpusBundleV2({
      schemaVersion: 2,
      corpusVersion: "2026-07-28.1",
      parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
      contentVersion: "knowledge-object-v2.1",
      objects: [object],
      assets: [asset],
      unreferencedAssetIds: [],
    });
    const representation = {
      ...indexRepresentation(),
      channel: "MULTIMODAL_VECTOR" as const,
      inputs: [
        { kind: "TARGET" as const, hash: asset.sha256 },
        { kind: "OBJECT" as const, id: object.id, hash: object.contentHash },
        {
          kind: "ANNOTATION" as const,
          id: object.annotations[0]!.id,
          hash: object.annotations[0]!.annotationHash,
        },
      ],
    };
    const legacyBundleInput = {
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      representations: [representation],
    } as const;
    const sealedLegacyBundle = sealKnowledgeIndexBundleV2(
      legacyBundleInput,
      corpus,
    );
    expect(sealedLegacyBundle).toEqual({
      ...legacyBundleInput,
      indexBundleHash: sha256StableJsonV2(legacyBundleInput),
    });
    expect(sealedLegacyBundle).toMatchObject({
      corpusBundleHash: corpus.bundleHash,
      indexBundleHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(() => sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      representations: [{
        ...representation,
        inputs: [
          { kind: "TARGET", hash: "e".repeat(64) },
          ...representation.inputs.slice(1),
        ],
      }],
    }, corpus)).toThrow(/input.hash.drift/i);
  });

  it("does not let one index version id describe conflicting builders or models", () => {
    const { asset, object } = fixture();
    const corpus = sealKnowledgeCorpusBundleV2({
      schemaVersion: 2,
      corpusVersion: "2026-07-28.1",
      parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
      contentVersion: "knowledge-object-v2.1",
      objects: [object],
      assets: [asset],
      unreferencedAssetIds: [],
    });
    const first = {
      ...indexRepresentation(),
      inputs: [{ kind: "TARGET" as const, hash: asset.sha256 }],
    };
    expect(() => sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      representations: [
        first,
        {
          ...first,
          id: "index-example-two",
          channel: "MULTIMODAL_VECTOR",
          indexVersion: {
            ...first.indexVersion,
            modelId: "different/model",
          },
          payload: {
            ...first.payload,
            storageKey: "data/knowledge-index/visual-v1-two.bin",
          },
        },
      ],
    }, corpus)).toThrow(/version.*conflicting/i);
  });

  it("rejects visual and multimodal channel labels without matching modalities", () => {
    const { asset, object } = fixture();
    const corpus = sealKnowledgeCorpusBundleV2({
      schemaVersion: 2,
      corpusVersion: "2026-07-28.1",
      parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
      contentVersion: "knowledge-object-v2.1",
      objects: [object],
      assets: [asset],
      unreferencedAssetIds: [],
    });
    expect(() => sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      representations: [{
        ...indexRepresentation(),
        channel: "MULTIMODAL_VECTOR",
        inputs: [{ kind: "TARGET", hash: asset.sha256 }],
      }],
    }, corpus)).toThrow(/multimodal.inputs.required/i);

    const textNode = object.nodes.find((node) => node.kind === "TEXT")!;
    expect(() => sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      representations: [{
        ...indexRepresentation(),
        target: { kind: "NODE", id: textNode.id },
        inputs: [{ kind: "TARGET", hash: textNode.contentHash }],
      }],
    }, corpus)).toThrow(/visual.input.required/i);
  });

  it("does not let captions or OCR masquerade as native visual vectors", () => {
    const { asset, object } = fixture();
    const corpus = sealKnowledgeCorpusBundleV2({
      schemaVersion: 2,
      corpusVersion: "2026-07-28.1",
      parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
      contentVersion: "knowledge-object-v2.1",
      objects: [object],
      assets: [asset],
      unreferencedAssetIds: [],
    });
    const caption = object.annotations[0]!;
    expect(() => sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      representations: [{
        ...indexRepresentation(),
        inputs: [
          { kind: "TARGET", hash: asset.sha256 },
          {
            kind: "ANNOTATION",
            id: caption.id,
            hash: caption.annotationHash,
          },
        ],
      }],
    }, corpus)).toThrow(/visual.pixel.inputs.only/i);
  });

  it("seals one control-plane bundle over independently hashed text and visual providers", () => {
    const { asset, object } = fixture();
    const corpus = sealKnowledgeCorpusBundleV2({
      schemaVersion: 2,
      corpusVersion: "2026-07-28.1",
      parser: { id: "lumi-knowledge-v2-bridge", version: "1.0.0" },
      contentVersion: "knowledge-object-v2.1",
      objects: [object],
      assets: [asset],
      unreferencedAssetIds: [],
    });
    const textProviderHash = "b".repeat(64);
    const visualProviderHash = "c".repeat(64);
    const sharedPayloads = [
      {
        schemaVersion: 2,
        id: "bge-manifest",
        role: "PROVIDER_MANIFEST",
        format: "JSON",
        providerIndexHash: textProviderHash,
        storageKind: "CONTROLLED_FILE",
        storageKey: "data/knowledge-index/bge/manifest.json",
        byteLength: 100,
        sha256: "d".repeat(64),
      },
      {
        schemaVersion: 2,
        id: "bge-tensors",
        role: "VECTOR_TENSORS",
        format: "SAFETENSORS",
        storageKind: "CONTROLLED_FILE",
        storageKey: "data/knowledge-index/bge/embeddings.safetensors",
        byteLength: 200,
        sha256: "e".repeat(64),
        tensors: [{ key: "embeddings", dimensions: 512, vectorCount: 1 }],
      },
      {
        schemaVersion: 2,
        id: "siglip-manifest",
        role: "PROVIDER_MANIFEST",
        format: "JSON",
        providerIndexHash: visualProviderHash,
        storageKind: "CONTROLLED_FILE",
        storageKey: "data/knowledge-index/siglip/manifest.json",
        byteLength: 300,
        sha256: "f".repeat(64),
      },
      {
        schemaVersion: 2,
        id: "siglip-tensors",
        role: "VECTOR_TENSORS",
        format: "SAFETENSORS",
        storageKind: "CONTROLLED_FILE",
        storageKey: "data/knowledge-index/siglip/embeddings.safetensors",
        byteLength: 400,
        sha256: "1".repeat(64),
        tensors: [{ key: "embeddings", dimensions: 768, vectorCount: 306 }],
      },
    ] as const;
    const textRepresentation = {
      schemaVersion: 2,
      id: "bge-object-layout-example",
      target: { kind: "OBJECT", id: object.id },
      channel: "TEXT_VECTOR",
      inputs: [{ kind: "TARGET", hash: object.contentHash }],
      indexVersion: {
        id: "bge-v1",
        builderId: "bge-index-builder",
        builderVersion: "1.0.0",
        modelId: "BAAI/bge-small-zh-v1.5",
        modelRevision: "immutable-bge-revision",
        configHash: "2".repeat(64),
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
    } as const;
    const visualRepresentation = {
      schemaVersion: 2,
      id: "siglip-asset-example",
      target: { kind: "ASSET", id: asset.id },
      channel: "VISUAL_VECTOR",
      inputs: [{ kind: "TARGET", hash: asset.sha256 }],
      indexVersion: {
        id: "siglip-v1",
        builderId: "siglip-index-builder",
        builderVersion: "1.0.0",
        modelId: "google/siglip2-base-patch16-224",
        modelRevision: "immutable-siglip-revision",
        configHash: "3".repeat(64),
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
    } as const;
    const bundle = sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      sharedPayloads,
      representations: [textRepresentation, visualRepresentation],
    }, corpus);

    expect(bundle.indexBundleHash).not.toBe(textProviderHash);
    expect(bundle.indexBundleHash).not.toBe(visualProviderHash);
    expect(bundle).not.toHaveProperty("providerIndexHash");
    expect(bundle.sharedPayloads?.flatMap((payload) =>
      payload.role === "PROVIDER_MANIFEST"
        ? [payload.providerIndexHash]
        : [])).toEqual([textProviderHash, visualProviderHash]);

    expect(() => sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      sharedPayloads,
      representations: [
        textRepresentation,
        {
          ...visualRepresentation,
          indexVersion: textRepresentation.indexVersion,
        },
      ],
    }, corpus)).toThrow(/version.provider.conflict/i);

    expect(() => sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      sharedPayloads,
      representations: [
        textRepresentation,
        {
          ...visualRepresentation,
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
      ],
    }, corpus)).toThrow(/provider.version.conflict/i);

    expect(() => sealKnowledgeIndexBundleV2({
      schemaVersion: 2,
      corpusBundleHash: corpus.bundleHash,
      sharedPayloads,
      representations: [
        textRepresentation,
        {
          ...visualRepresentation,
          locator: {
            ...visualRepresentation.locator,
            slices: [{
              tensorKey: "embeddings",
              vectorOffset: 305,
              vectorCount: 2,
            }],
          },
        },
      ],
    }, corpus)).toThrow(/locator.bounds/i);
  });
});

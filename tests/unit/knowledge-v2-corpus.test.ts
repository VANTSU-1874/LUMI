// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  buildKnowledgeV2Corpus,
  knowledgeAssetV2FromManifestEntry,
  KnowledgeV2ConversionReportSchema,
  serializeKnowledgeCorpusBundleV2,
  serializeKnowledgeV2ConversionReport,
  verifyKnowledgeV2ConversionReport,
  type BuiltKnowledgeV2Corpus,
} from "@/lib/knowledge/knowledge-v2-corpus";
import { loadKnowledgeDirectory, rankKnowledge } from "@/lib/knowledge/retrieve";

describe("KnowledgeObjectV2 corpus bridge", () => {
  let first: BuiltKnowledgeV2Corpus;
  let second: BuiltKnowledgeV2Corpus;

  beforeAll(async () => {
    first = await buildKnowledgeV2Corpus({ workspaceRoot: process.cwd() });
    second = await buildKnowledgeV2Corpus({ workspaceRoot: process.cwd() });
  }, 60_000);

  it("losslessly adapts 116 legacy items and accounts for every tracked PNG", async () => {
    const legacy = await loadKnowledgeDirectory(path.join(process.cwd(), "data", "knowledge"));
    expect(first.bundle.objects).toHaveLength(116);
    expect(first.bundle.objects.map(({ legacyItem }) => legacyItem)).toEqual(legacy);
    expect(first.bundle.assets).toHaveLength(156);
    expect(first.bundle.unreferencedAssetIds).toEqual([]);
    expect(new Set(first.bundle.objects.flatMap(({ assetIds }) => assetIds)).size).toBe(156);
    const manifest = JSON.parse(await readFile(
      path.join(process.cwd(), "data", "manifests", "course-png-sha256.v1.json"),
      "utf8",
    )) as {
      assets: Array<{ path: string; sizeBytes: number; sha256: string }>;
    };
    expect(first.bundle.assets.map(({ locator }) => locator.path))
      .toEqual(manifest.assets.map(({ path: assetPath }) => assetPath));
    for (const [index, asset] of first.bundle.assets.entries()) {
      expect(asset).toMatchObject({
        sizeBytes: manifest.assets[index]?.sizeBytes,
        sha256: manifest.assets[index]?.sha256,
        dimensions: {
          widthPx: expect.any(Number),
          heightPx: expect.any(Number),
        },
      });
    }
    expect(first.report).toMatchObject({
      generatedSourceCount: 82,
      legacySourceCount: 34,
      objectCount: 116,
      assetCount: 156,
      imageBearingObjectCount: 51,
      imageNodeCount: 156,
      sourceCaptionAnnotationCount: 156,
      referencedAssetCount: 156,
      unreferencedAssetCount: 0,
      sourceIdentityBasisCounts: {
        COURSE_DIRECTORY: 82,
        TRACKED_LEGACY_MAP: 34,
      },
      sourceIdentityCounts: {
        "general-design": 9,
        "digital-interaction": 21,
        "book-design": 10,
        "layout-design": 74,
        "brand-vi-design": 2,
      },
      legacyPlacementCounts: {
        "general-design": 9,
        "digital-interaction": 21,
        "book-design": 63,
        "layout-design": 21,
        "brand-vi-design": 2,
      },
      sourceLegacyPlacementMismatchCount: 53,
      captionMappingCounts: {
        ROLE_ALIAS: 150,
        DOCUMENT_FALLBACK: 6,
      },
    });
    const mismatches = first.bundle.objects.filter((object) =>
      object.sourceCoursePack.id !== object.legacyPlacement.coursePack.id);
    expect(mismatches).toHaveLength(53);
    expect(mismatches.every((object) =>
      object.sourceCoursePack.id === "layout-design"
      && object.legacyPlacement.coursePack.id === "book-design")).toBe(true);
  });

  it("keeps frontmatter image order and caption-to-asset mappings explicit", () => {
    const poster = first.bundle.objects.find(({ id }) =>
      id === "layout-101-poster-01-analysis")!;
    expect(poster.annotations.map(({ sourceMapping }) => sourceMapping)).toEqual([
      {
        method: "ROLE_ALIAS",
        headingPath: ["核心内容", "版式拆分"],
        sourceOrdinal: 0,
      },
      {
        method: "ROLE_ALIAS",
        headingPath: ["核心内容", "字体形式"],
        sourceOrdinal: 1,
      },
      {
        method: "ROLE_ALIAS",
        headingPath: ["核心内容", "色彩构图"],
        sourceOrdinal: 2,
      },
    ]);
    const grid = first.bundle.objects.find(({ id }) =>
      id === "layout-040-six-step-grid-layout-check")!;
    expect(grid.annotations.map(({ sourceMapping }) => sourceMapping)).toEqual(
      Array.from({ length: 6 }, (_, sourceOrdinal) => ({
        method: "DOCUMENT_FALLBACK",
        headingPath: ["核心内容"],
        sourceOrdinal,
      })),
    );

    for (const object of first.bundle.objects) {
      const imageNodeIds = object.nodes.flatMap((node) =>
        node.kind === "IMAGE" ? [node.id] : []);
      const captionTargets = object.annotations.flatMap((annotation) =>
        annotation.kind === "CAPTION" ? [annotation.targetNodeId] : []);
      expect(captionTargets).toEqual(imageNodeIds);
    }
  });

  it("produces byte-identical deterministic bundle and report serializations", () => {
    expect(serializeKnowledgeCorpusBundleV2(second.bundle))
      .toBe(serializeKnowledgeCorpusBundleV2(first.bundle));
    expect(serializeKnowledgeV2ConversionReport(second.report))
      .toBe(serializeKnowledgeV2ConversionReport(first.report));
  });

  it("verifies the conversion report against the bundle instead of trusting its counts", () => {
    expect(verifyKnowledgeV2ConversionReport(first.report, first.bundle))
      .toEqual(first.report);
    expect(() => verifyKnowledgeV2ConversionReport({
      ...first.report,
      bundleHash: "f".repeat(64),
    }, first.bundle)).toThrow(/report.bundle.drift/i);
    expect(() => KnowledgeV2ConversionReportSchema.parse({
      ...first.report,
      objectCount: 999,
    })).toThrow(/objectCount|counts/i);
  });

  it("does not alter legacy lexical retrieval while the V2 bridge is not wired in", async () => {
    const legacy = await loadKnowledgeDirectory(path.join(process.cwd(), "data", "knowledge"));
    const adaptedProjection = first.bundle.objects.map(({ legacyItem }) => legacyItem);
    const suite = JSON.parse(await readFile(
      path.join(process.cwd(), "tests", "retrieval-quality", "golden-suite.json"),
      "utf8",
    )) as { cases: Array<{ query: { text?: string } }> };
    for (const testCase of suite.cases) {
      if (!testCase.query.text) continue;
      expect(rankKnowledge(testCase.query.text, adaptedProjection))
        .toEqual(rankKnowledge(testCase.query.text, legacy));
    }
  }, 60_000);

  it("rejects asset bytes that drift from the tracked manifest", async () => {
    const manifest = JSON.parse(await readFile(
      path.join(process.cwd(), "data", "manifests", "course-png-sha256.v1.json"),
      "utf8",
    )) as {
      assets: Array<{ path: string; sizeBytes: number; sha256: string }>;
    };
    const entry = manifest.assets[0]!;
    expect(() => knowledgeAssetV2FromManifestEntry(entry, Buffer.from("drift")))
      .toThrow(/hash|size|drift/i);
  });
});

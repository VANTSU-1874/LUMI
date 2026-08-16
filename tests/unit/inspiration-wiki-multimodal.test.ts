import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { hashWikiValue } from "@/lib/domain/inspiration-wiki/integrity";
import { WIKI_MULTIMODAL_ENCODER_VERSION, WIKI_MULTIMODAL_INDEX_ID, WIKI_MULTIMODAL_SCHEMA_VERSION } from "@/lib/domain/inspiration-wiki/multimodal-retrieval-contracts";
import { loadWikiMultimodalIndex, textFeatureVector, TEXT_VECTOR_DIMENSIONS, visualFeatureVector, VISUAL_VECTOR_DIMENSIONS } from "@/lib/services/inspiration-wiki-multimodal";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function dot(left: readonly number[], right: readonly number[]) {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

async function createSealedFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lumi-wiki-mm-fixture-"));
  roots.push(root);
  await mkdir(root, { recursive: true });
  const material = {
    schemaVersion: WIKI_MULTIMODAL_SCHEMA_VERSION,
    indexId: WIKI_MULTIMODAL_INDEX_ID,
    encoderVersion: WIKI_MULTIMODAL_ENCODER_VERSION,
    sourceReleaseBundleId: "synthetic-test-bundle",
    sourceReleaseBundleDigest: "1".repeat(64),
    releaseSetHash: `sha256:${"2".repeat(64)}`,
    visualDimensions: VISUAL_VECTOR_DIMENSIONS,
    textDimensions: TEXT_VECTOR_DIMENSIONS,
    itemCount: 1,
    rightsEvidenceRef: "USER_AUTHORIZATION:2026-08-16:WIKI-SELF-MULTIMODAL-177" as const,
    capabilityBoundary: {
      authenticatedStudentWiki: "ACTIVE" as const,
      textToImage: "ACTIVE" as const,
      imageToImage: "ACTIVE" as const,
      imageTextToImage: "ACTIVE" as const,
      externalProvider: "DISABLED" as const,
      externalDataEgress: "DISABLED" as const,
      anonymousAccess: "DISABLED" as const,
      r2: "DISABLED" as const,
      lumiRetrieval: "DISABLED" as const,
    },
    entries: [{
      publicId: `inspiration:${"a".repeat(24)}`,
      releaseId: `wiki-release:${"b".repeat(32)}`,
      canonicalPageId: `wiki-page:${"c".repeat(32)}`,
      assetSha256: "d".repeat(64),
      item: {
        id: `inspiration:${"a".repeat(24)}`,
        title: "测试海报",
        description: "合成测试条目",
        tags: ["海报"],
        courseAssociations: [],
        source: { label: "测试来源", url: "https://example.com/work" },
        attributionNotice: "仅供自动化测试",
        preview: "CONTROLLED" as const,
        previewUrl: `/api/inspiration/previews/inspiration:${"a".repeat(24)}`,
      },
      visualVector: Array<number>(VISUAL_VECTOR_DIMENSIONS).fill(0),
      textVector: Array<number>(TEXT_VECTOR_DIMENSIONS).fill(0),
    }],
  };
  const indexHash = hashWikiValue(material);
  await writeFile(path.join(root, "index.json"), JSON.stringify({ ...material, indexHash }));
  await writeFile(path.join(root, "DONE.json"), JSON.stringify({ schemaVersion: "lumi-inspiration-wiki-multimodal-done/v1", indexId: WIKI_MULTIMODAL_INDEX_ID, indexHash, status: "READY" }));
  return root;
}

describe("Inspiration Wiki local multimodal index", () => {
  it("loads a sealed artifact and preserves the external capability boundary", async () => {
    const index = loadWikiMultimodalIndex(await createSealedFixture());
    expect(index).not.toBeNull();
    expect(index).toMatchObject({
      indexId: WIKI_MULTIMODAL_INDEX_ID,
      itemCount: 1,
      capabilityBoundary: {
        authenticatedStudentWiki: "ACTIVE",
        textToImage: "ACTIVE",
        imageToImage: "ACTIVE",
        imageTextToImage: "ACTIVE",
        externalProvider: "DISABLED",
        externalDataEgress: "DISABLED",
        r2: "DISABLED",
        lumiRetrieval: "DISABLED",
      },
    });
    expect(index!.entries).toHaveLength(1);
  });

  it("fails closed when a sealed index is modified", async () => {
    const root = await createSealedFixture();
    const file = path.join(root, "index.json");
    const parsed = JSON.parse(await readFile(file, "utf8")) as { entries: Array<{ item: { title: string } }> };
    parsed.entries[0]!.item.title = "被修改";
    await writeFile(file, JSON.stringify(parsed));
    expect(loadWikiMultimodalIndex(root)).toBeNull();
  });

  it("creates deterministic text and visual vectors without a provider", async () => {
    expect(textFeatureVector("红色 海报 字体")).toEqual(textFeatureVector("红色 海报 字体"));
    expect(dot(textFeatureVector("红色 海报 字体"), textFeatureVector("红色海报字体"))).toBeGreaterThan(
      dot(textFeatureVector("红色 海报 字体"), textFeatureVector("包装 容器 材质")),
    );
    const red = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#d11f2f" } }).png().toBuffer();
    const blue = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#123f9a" } }).png().toBuffer();
    const redVector = await visualFeatureVector(red);
    expect(redVector).toEqual(await visualFeatureVector(red));
    expect(dot(redVector, redVector)).toBeCloseTo(1, 5);
    expect(dot(redVector, await visualFeatureVector(blue))).toBeLessThan(0.5);
  });
});

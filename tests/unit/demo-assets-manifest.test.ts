// @vitest-environment node

import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { createMockTurn } from "@/components/client-api/mock/fixtures";

type DemoAsset = {
  id: string;
  path: string;
  purpose: string;
  authoringMethod: string;
  derivedFrom?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  byteSize?: number;
  COPYRIGHT: string;
  dataType: string;
  label: string;
  sha256: string;
  禁止对外表述: string[];
};

type DemoManifest = {
  schemaVersion: number;
  collection: string;
  notice: string;
  sha256Algorithm: string;
  assets: DemoAsset[];
};

const root = process.cwd();
const manifestPath = path.join(root, "public", "demo", "manifest.json");
const allowedColors = new Set(["#EEEAE1", "#23201C", "#D6D0C4", "#B23A2F"]);
const legacyTerms = /通感阶梯|触映(?:AI)?|门禁|关卡/;
const falseArtworkClaims = /(?:本图|本作品|作品来源)[：:]?真实|真实学生作品|真实课堂(?:作品|数据|结果|截图)|现场实拍|实拍截图/;

async function loadManifest() {
  return JSON.parse(await readFile(manifestPath, "utf8")) as DemoManifest;
}

describe("W3 original preset demo assets", () => {
  it("registers only self-created demonstration assets with explicit claim boundaries", async () => {
    const manifest = await loadManifest();
    const vectors = manifest.assets.filter((asset) => asset.authoringMethod === "ORIGINAL_VECTOR");
    const rasters = manifest.assets.filter((asset) => asset.authoringMethod === "DERIVED_RASTER");

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      sha256Algorithm: "SHA-256",
    });
    expect(manifest.assets).toHaveLength(6);
    expect(vectors).toHaveLength(4);
    expect(rasters).toHaveLength(2);
    expect(new Set(manifest.assets.map((asset) => asset.id)).size).toBe(6);

    for (const asset of manifest.assets) {
      expect(asset.path).toMatch(/^\/demo\/[a-z0-9-]+\.(?:svg|png)$/);
      expect(asset.purpose.length).toBeGreaterThan(12);
      expect(["ORIGINAL_VECTOR", "DERIVED_RASTER"]).toContain(asset.authoringMethod);
      expect(asset.COPYRIGHT).toBe("self-created");
      expect(asset.dataType).toBe("DEMONSTRATION_DATA");
      expect(asset.label).toBe("预置");
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(asset.禁止对外表述.length).toBeGreaterThanOrEqual(3);
      expect(asset.禁止对外表述.every((claim) => claim.startsWith("不得"))).toBe(true);
    }

    const vectorIds = new Set(vectors.map((asset) => asset.id));
    for (const asset of rasters) {
      expect(asset.mimeType).toBe("image/png");
      expect(asset.derivedFrom && vectorIds.has(asset.derivedFrom)).toBe(true);
      expect(asset.width).toBeGreaterThan(0);
      expect(asset.height).toBeGreaterThan(0);
      expect(asset.byteSize).toBeGreaterThan(0);
    }
  });

  it("keeps every manifest path present, visibly labeled, palette-safe and hash-locked", async () => {
    const manifest = await loadManifest();

    for (const asset of manifest.assets.filter(({ authoringMethod }) => authoringMethod === "ORIGINAL_VECTOR")) {
      const assetPath = path.join(root, "public", asset.path.replace(/^\/+/, ""));
      await expect(access(assetPath)).resolves.toBeUndefined();
      expect((await stat(assetPath)).isFile()).toBe(true);

      const bytes = await readFile(assetPath);
      const svg = bytes.toString("utf8");
      const colors = new Set(svg.match(/#[A-Fa-f0-9]{6}(?![A-Fa-f0-9-])/g) ?? []);
      const digest = createHash("sha256").update(bytes).digest("hex");

      expect(svg.trimStart()).toMatch(/^<svg\b/);
      expect(svg.trimEnd()).toMatch(/<\/svg>$/);
      expect(svg).toContain("预置示意图");
      expect(svg).toContain("DEMONSTRATION_DATA");
      expect(svg).not.toMatch(legacyTerms);
      expect(svg).not.toMatch(falseArtworkClaims);
      expect([...colors].every((color) => allowedColors.has(color.toUpperCase()))).toBe(true);
      expect(digest).toBe(asset.sha256);
    }
  });

  it("hash-locks the D-017 raster derivatives and verifies their real PNG metadata", async () => {
    const manifest = await loadManifest();
    const rasters = manifest.assets.filter(({ authoringMethod }) => authoringMethod === "DERIVED_RASTER");

    for (const asset of rasters) {
      const assetPath = path.join(root, "public", asset.path.replace(/^\/+/, ""));
      const bytes = await readFile(assetPath);
      const metadata = await sharp(bytes).metadata();
      const digest = createHash("sha256").update(bytes).digest("hex");

      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(bytes.byteLength).toBe(asset.byteSize);
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBe(asset.width);
      expect(metadata.height).toBe(asset.height);
      expect(digest).toBe(asset.sha256);
    }
  });

  it("binds every mock artwork turn to a registered static preset instead of a real artwork API", async () => {
    const manifest = await loadManifest();
    const assetsByPath = new Map(manifest.assets.map((asset) => [asset.path, asset]));
    const cases = [
      ["digital-interaction", "/demo/digital-interaction-proposal-board-preset.svg"],
      ["book-design", "/demo/layout-poster-after-preset.svg"],
      ["general-design", "/demo/digital-interaction-proposal-board-preset.svg"],
    ] as const;

    for (const [courseId, expectedPath] of cases) {
      const turn = createMockTurn(
        { message: "请看这份作品方案", context: { view: "AGENT" } },
        undefined,
        { hasArtwork: true, courseId },
      );
      const attachment = turn.artworkAttachment;
      expect(attachment).toBeDefined();
      expect(attachment?.previewUrl).toBe(expectedPath);
      expect(attachment?.previewUrl).toMatch(/^\/demo\/[a-z0-9-]+\.svg$/);
      expect(attachment?.previewUrl).not.toMatch(/^\/api\//);
      expect(attachment?.mimeType).toBe("image/svg+xml");

      const asset = assetsByPath.get(attachment!.previewUrl);
      expect(asset).toMatchObject({ dataType: "DEMONSTRATION_DATA", label: "预置" });
      await expect(access(path.join(root, "public", attachment!.previewUrl.replace(/^\/+/, ""))))
        .resolves.toBeUndefined();
    }
  });

  it("keeps the ledger honest about assets that still require user-provided evidence", async () => {
    const ledger = await readFile(path.join(root, "docs", "runbooks", "demo-assets.md"), "utf8");

    for (const asset of (await loadManifest()).assets) {
      expect(ledger).toContain(path.basename(asset.path));
    }
    expect(ledger).toContain("- [ ] 匿名化的 DigiShow 真实课堂截图");
    expect(ledger).toContain("- [ ] 匿名化的 TouchDesigner");
    expect(ledger).toContain("- [ ] 有明确展示授权的安岳石刻照片");
    expect(ledger).toContain("- [ ] 有明确展示授权且已匿名化的真实学生作品");
    expect(ledger).not.toMatch(legacyTerms);
  });
});

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createDb } from "@/lib/db/client";
import { WIKI_MULTIMODAL_INDEX_ID } from "@/lib/domain/inspiration-wiki/multimodal-retrieval-contracts";
import { loadWikiMultimodalIndex, searchWikiMultimodal } from "@/lib/services/inspiration-wiki-multimodal";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function main() {
  const databasePath = argument("--database");
  const bundleRoot = argument("--bundle");
  if (!databasePath || !bundleRoot) throw new Error("--database and --bundle are required");
  const indexRoot = argument("--index") ?? path.join("data", "inspiration-wiki", "multimodal-index", WIKI_MULTIMODAL_INDEX_ID);
  const index = loadWikiMultimodalIndex(indexRoot);
  if (!index) throw new Error("WIKI_MULTIMODAL_INDEX_NOT_READY");
  const manifest = JSON.parse(readFileSync(path.join(bundleRoot, "manifest.json"), "utf8")) as { assets: Array<{ sha256: string; bundlePath: string }> };
  const anchor = index.entries[0]!;
  const anchorAsset = manifest.assets.find((asset) => asset.sha256 === anchor.assetSha256);
  if (!anchorAsset) throw new Error("WIKI_MULTIMODAL_EVAL_ANCHOR_ASSET_MISSING");
  const image = readFileSync(path.join(bundleRoot, anchorAsset.bundlePath));
  const connection = createDb(databasePath);
  try {
    const textQueries = [];
    for (const query of ["海报设计", "包装设计", "品牌视觉识别"]) {
      const result = await searchWikiMultimodal(connection.db, { query, limit: 10, indexRoot });
      textQueries.push({ query, state: result.retrieval.state, count: result.items.length, sourcesComplete: result.items.every((item) => Boolean(item.source.label && item.attributionNotice && item.previewUrl)) });
    }
    const imageResult = await searchWikiMultimodal(connection.db, { image, limit: 10, indexRoot });
    const mixedResult = await searchWikiMultimodal(connection.db, { query: anchor.item.tags[0] ?? anchor.item.title, image, limit: 10, indexRoot });
    const fallback = await searchWikiMultimodal(connection.db, { query: "海报设计", limit: 10, indexRoot: path.join(indexRoot, "missing") });
    const report = {
      schemaVersion: "lumi-inspiration-wiki-multimodal-evaluation/v1",
      status: "PASS",
      indexId: index.indexId,
      indexHash: index.indexHash,
      itemCount: index.itemCount,
      textQueries,
      imageToImage: { anchorPublicId: anchor.publicId, rank: imageResult.items.findIndex((item) => item.id === anchor.publicId) + 1, state: imageResult.retrieval.state },
      imageTextToImage: { anchorPublicId: anchor.publicId, rank: mixedResult.items.findIndex((item) => item.id === anchor.publicId) + 1, state: mixedResult.retrieval.state },
      fallback: { mode: fallback.retrieval.mode, state: fallback.retrieval.state, count: fallback.items.length },
      boundary: index.capabilityBoundary,
    };
    if (textQueries.some((item) => item.state !== "READY" || item.count === 0 || !item.sourcesComplete)
      || report.imageToImage.rank !== 1 || report.imageToImage.state !== "READY"
      || report.imageTextToImage.rank < 1 || report.imageTextToImage.rank > 3 || report.imageTextToImage.state !== "READY"
      || fallback.retrieval.mode !== "TEXT_FALLBACK" || fallback.items.length === 0) throw new Error(`WIKI_MULTIMODAL_EVALUATION_FAILED:${JSON.stringify(report)}`);
    const output = argument("--output");
    if (output) { mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" }); }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally { connection.sqlite.close(); }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });

import path from "node:path";
import { pathToFileURL } from "node:url";

import { WIKI_MULTIMODAL_INDEX_ID } from "@/lib/domain/inspiration-wiki/multimodal-retrieval-contracts";
import { buildInspirationWikiMultimodalIndex } from "@/lib/operations/inspiration-wiki-multimodal-index";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function main() {
  const bundleRoot = argument("--bundle");
  if (!bundleRoot) throw new Error("--bundle is required");
  const outputRoot = argument("--output") ?? path.join("data", "inspiration-wiki", "multimodal-index", WIKI_MULTIMODAL_INDEX_ID);
  const result = await buildInspirationWikiMultimodalIndex({ bundleRoot, outputRoot });
  process.stdout.write(`${JSON.stringify({ status: "READY", indexId: result.index.indexId, indexHash: result.index.indexHash, items: result.index.itemCount, outputRoot: result.outputRoot }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });

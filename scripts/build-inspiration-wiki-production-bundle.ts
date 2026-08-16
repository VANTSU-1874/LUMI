import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildInspirationWikiProductionBundle, D27_BUNDLE_ID } from "@/lib/operations/inspiration-wiki-production-release";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function main() {
  const databasePath = argument("--database") ?? "data/tonggan.sqlite";
  const outputRoot = argument("--output")
    ?? path.join("data", "inspiration-wiki", "production-release", D27_BUNDLE_ID);
  const result = buildInspirationWikiProductionBundle({ databasePath, outputRoot });
  process.stdout.write(`${JSON.stringify({
    status: "READY",
    bundleId: result.manifest.bundleId,
    bundleDigest: result.manifest.bundleDigest,
    releases: result.manifest.releaseCount,
    rows: result.rowCount,
    assets: result.manifest.assets.length,
    outputRoot: result.outputRoot,
  }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try { main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

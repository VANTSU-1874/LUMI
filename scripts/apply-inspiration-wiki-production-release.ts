import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadRuntimeEnvironment, writeEffectiveDatabaseConfigNotice } from "@/lib/config/runtime-environment";
import { applyInspirationWikiProductionBundle, D27_BUNDLE_ID } from "@/lib/operations/inspiration-wiki-production-release";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function main() {
  const loaded = await loadRuntimeEnvironment({ mode: "EXPLICIT_SERVICE_OR_PROJECT" });
  const databasePath = argument("--database") ?? loaded.environment.DATABASE_PATH ?? "data/tonggan.sqlite";
  const bundleRoot = argument("--bundle")
    ?? path.join("data", "inspiration-wiki", "production-release", D27_BUNDLE_ID);
  const validateOnly = process.argv.includes("--validate-only");
  writeEffectiveDatabaseConfigNotice({ databasePath }, loaded.provenance, loaded.environment);
  const result = applyInspirationWikiProductionBundle({ databasePath, bundleRoot, validateOnly });
  process.stdout.write(`${JSON.stringify({ status: "PASS", ...result }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

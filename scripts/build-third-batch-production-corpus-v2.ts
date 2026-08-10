import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  sealKnowledgeCorpusBundleV2,
  verifyKnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";

type BuildArguments = {
  baseCorpusPath: string;
  thirdBatchCorpusPath: string;
  outputPath: string;
};

const PARSER = Object.freeze({
  id: "lumi-knowledge-v2-production-aggregate",
  version: "1.0.0",
});
const CONTENT_VERSION = "2026.8.8.1";

function parseArguments(input: readonly string[]): BuildArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < input.length; index += 2) {
    const flag = input[index];
    const value = input[index + 1];
    if (!flag || !value || !flag.startsWith("--") || value.startsWith("--")) {
      throw new Error("THIRD_BATCH_PRODUCTION_CORPUS_USAGE");
    }
    if (values.has(flag)) throw new Error(`DUPLICATE_ARGUMENT:${flag}`);
    values.set(flag, value);
  }
  const baseCorpusPath = values.get("--base-corpus");
  const thirdBatchCorpusPath = values.get("--third-batch-corpus");
  const outputPath = values.get("--output");
  if (
    !baseCorpusPath
    || !thirdBatchCorpusPath
    || !outputPath
    || values.size !== 3
  ) {
    throw new Error("THIRD_BATCH_PRODUCTION_CORPUS_USAGE");
  }
  return { baseCorpusPath, thirdBatchCorpusPath, outputPath };
}

async function readCorpus(filePath: string) {
  return verifyKnowledgeCorpusBundleV2(JSON.parse(await readFile(
    path.resolve(filePath),
    "utf8",
  )) as unknown);
}

export async function buildThirdBatchProductionCorpusV2(
  input: BuildArguments,
) {
  const [base, thirdBatch] = await Promise.all([
    readCorpus(input.baseCorpusPath),
    readCorpus(input.thirdBatchCorpusPath),
  ]);
  const baseObjectIds = new Set(base.objects.map(({ id }) => id));
  const objectOverlap = thirdBatch.objects
    .map(({ id }) => id)
    .filter((id) => baseObjectIds.has(id));
  const baseNodeIds = new Set(base.objects.flatMap(({ nodes }) =>
    nodes.map(({ id }) => id)));
  const nodeOverlap = thirdBatch.objects
    .flatMap(({ nodes }) => nodes.map(({ id }) => id))
    .filter((id) => baseNodeIds.has(id));
  const baseAssetIds = new Set(base.assets.map(({ id }) => id));
  const assetOverlap = thirdBatch.assets
    .map(({ id }) => id)
    .filter((id) => baseAssetIds.has(id));
  if (objectOverlap.length > 0) {
    throw new Error(`PRODUCTION_CORPUS_OBJECT_ID_CONFLICT:${objectOverlap[0]}`);
  }
  if (nodeOverlap.length > 0) {
    throw new Error(`PRODUCTION_CORPUS_NODE_ID_CONFLICT:${nodeOverlap[0]}`);
  }
  if (assetOverlap.length > 0) {
    throw new Error(`PRODUCTION_CORPUS_ASSET_ID_CONFLICT:${assetOverlap[0]}`);
  }

  const normalizeObject = <T extends { parser: unknown; contentVersion: string }>(
    value: T,
  ) => ({
    ...value,
    parser: PARSER,
    contentVersion: CONTENT_VERSION,
  });
  const bundle = sealKnowledgeCorpusBundleV2({
    schemaVersion: 2,
    corpusVersion: "knowledge-v2-production-third-batch-2026-08-08",
    parser: PARSER,
    contentVersion: CONTENT_VERSION,
    objects: [
      ...base.objects.map(normalizeObject),
      ...thirdBatch.objects.map(normalizeObject),
    ].sort((left, right) => left.id.localeCompare(right.id, "en")),
    assets: [...base.assets, ...thirdBatch.assets]
      .sort((left, right) => left.id.localeCompare(right.id, "en")),
    unreferencedAssetIds: [
      ...base.unreferencedAssetIds,
      ...thirdBatch.unreferencedAssetIds,
    ].sort((left, right) => left.localeCompare(right, "en")),
  });
  const outputPath = path.resolve(input.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(bundle, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  process.stdout.write(`${JSON.stringify({
    corpusBundleHash: bundle.bundleHash,
    baseCorpusBundleHash: base.bundleHash,
    thirdBatchCorpusBundleHash: thirdBatch.bundleHash,
    objectCount: bundle.objects.length,
    baseObjectCount: base.objects.length,
    thirdBatchObjectCount: thirdBatch.objects.length,
    nodeCount: bundle.objects.reduce((sum, object) => sum + object.nodes.length, 0),
    assetCount: bundle.assets.length,
  }, null, 2)}\n`);
  return bundle;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (invokedPath === import.meta.url) {
  buildThirdBatchProductionCorpusV2(
    parseArguments(process.argv.slice(2)),
  ).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  packageKnowledgeTextIndexV2,
} from "@/lib/knowledge/knowledge-index-packager-v2";

type PackagingArguments = {
  workspaceRoot: string;
  corpusPath: string;
  textIndexDirectory: string;
  outputRoot: string;
  incrementalPlanPath?: string;
};

const ARGUMENT_NAMES = new Map<string, keyof PackagingArguments>([
  ["--workspace-root", "workspaceRoot"],
  ["--corpus", "corpusPath"],
  ["--text-index-dir", "textIndexDirectory"],
  ["--output-root", "outputRoot"],
  ["--incremental-plan", "incrementalPlanPath"],
] as const);

const USAGE = "usage: package-knowledge-text-index-v2.ts "
  + "--workspace-root <path> --corpus <path> "
  + "--text-index-dir <path> --output-root <path> "
  + "[--incremental-plan <path>]";

export function parseKnowledgeTextIndexPackagingArguments(
  input: readonly string[],
): PackagingArguments {
  const parsed: Partial<PackagingArguments> = {};
  for (let index = 0; index < input.length; index += 2) {
    const flag = input[index];
    const value = input[index + 1];
    const property = flag ? ARGUMENT_NAMES.get(flag) : undefined;
    if (!property || !value || value.startsWith("--")) {
      throw new Error(USAGE);
    }
    if (parsed[property] !== undefined) {
      throw new Error(`duplicate argument: ${flag}`);
    }
    parsed[property] = value;
  }
  if (
    !parsed.workspaceRoot
    || !parsed.corpusPath
    || !parsed.textIndexDirectory
    || !parsed.outputRoot
  ) {
    throw new Error(USAGE);
  }
  return parsed as PackagingArguments;
}

export async function runKnowledgeTextIndexPackaging(
  input: PackagingArguments,
) {
  const corpusBundle = JSON.parse(await readFile(
    path.resolve(input.corpusPath),
    "utf8",
  )) as unknown;
  const incrementalPlan = input.incrementalPlanPath
    ? JSON.parse(await readFile(
        path.resolve(input.incrementalPlanPath),
        "utf8",
      )) as unknown
    : undefined;
  const result = await packageKnowledgeTextIndexV2({
    workspaceRoot: path.resolve(input.workspaceRoot),
    outputRoot: path.resolve(input.outputRoot),
    corpusBundle,
    textIndexDirectory: path.resolve(input.textIndexDirectory),
    incrementalPlan,
  });
  process.stdout.write(`${JSON.stringify({
    mode: result.report.mode,
    corpusBundleHash: result.indexBundle.corpusBundleHash,
    controlIndexBundleHash: result.indexBundle.indexBundleHash,
    providerIndexBundleHash:
      result.report.providers.text.providerIndexHash,
    representationCount: result.report.control.representationCount,
    sharedPayloadCount: result.report.control.sharedPayloadCount,
    visualProvider: result.report.providers.visual,
    incrementalPlan: result.incrementalPlan?.summary ?? null,
    database: result.report.writes.database,
  }, null, 2)}\n`);
  return result;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (invokedPath === import.meta.url) {
  runKnowledgeTextIndexPackaging(
    parseKnowledgeTextIndexPackagingArguments(process.argv.slice(2)),
  ).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

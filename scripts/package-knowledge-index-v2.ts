import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { packageKnowledgeIndexV2 } from "@/lib/knowledge/knowledge-index-packager-v2";

type PackagingArguments = {
  workspaceRoot: string;
  corpusPath: string;
  textIndexDirectory: string;
  visualIndexDirectory: string;
  outputRoot: string;
  textIncrementalPlanPath?: string;
  visualIncrementalPlanPath?: string;
};

const ARGUMENT_NAMES = new Map<string, keyof PackagingArguments>([
  ["--workspace-root", "workspaceRoot"],
  ["--corpus", "corpusPath"],
  ["--text-index-dir", "textIndexDirectory"],
  ["--visual-index-dir", "visualIndexDirectory"],
  ["--output-root", "outputRoot"],
  ["--text-incremental-plan", "textIncrementalPlanPath"],
  ["--visual-incremental-plan", "visualIncrementalPlanPath"],
] as const);

const USAGE = "usage: package-knowledge-index-v2.ts "
  + "--workspace-root <path> --corpus <path> "
  + "--text-index-dir <path> --visual-index-dir <path> "
  + "--output-root <path> "
  + "[--text-incremental-plan <path>] "
  + "[--visual-incremental-plan <path>]";

export function parseKnowledgeIndexPackagingArguments(
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
    || !parsed.visualIndexDirectory
    || !parsed.outputRoot
  ) {
    throw new Error(USAGE);
  }
  return parsed as PackagingArguments;
}

export async function runKnowledgeIndexPackaging(
  input: PackagingArguments,
) {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const corpusPath = path.resolve(input.corpusPath);
  const outputRoot = path.resolve(input.outputRoot);
  const corpusBundle = JSON.parse(await readFile(corpusPath, "utf8")) as unknown;
  const incrementalPlans = {
    text: input.textIncrementalPlanPath
      ? JSON.parse(await readFile(
        path.resolve(input.textIncrementalPlanPath),
        "utf8",
      )) as unknown
      : undefined,
    visual: input.visualIncrementalPlanPath
      ? JSON.parse(await readFile(
        path.resolve(input.visualIncrementalPlanPath),
        "utf8",
      )) as unknown
      : undefined,
  };
  const result = await packageKnowledgeIndexV2({
    workspaceRoot,
    outputRoot,
    corpusBundle,
    textIndexDirectory: path.resolve(input.textIndexDirectory),
    visualIndexDirectory: path.resolve(input.visualIndexDirectory),
    incrementalPlans,
  });
  process.stdout.write(`${JSON.stringify({
    controlDirectory: result.controlDirectory,
    controlIndexBundleHash: result.indexBundle.indexBundleHash,
    corpusBundleHash: result.indexBundle.corpusBundleHash,
    providerIndexBundleHashes: {
      text: result.report.providers.text.providerIndexHash,
      visual: result.report.providers.visual.providerIndexHash,
    },
    representationCount: result.report.control.representationCount,
    textRepresentations: result.report.providers.text.representationCount,
    visualRepresentations: result.report.providers.visual.representationCount,
    visualRegionSlices: result.report.providers.visual.regionSliceCount,
    incrementalPlans: {
      text: result.incrementalPlans.text?.summary ?? null,
      visual: result.incrementalPlans.visual?.summary ?? null,
    },
    database: result.report.writes.database,
  }, null, 2)}\n`);
  return result;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (invokedPath === import.meta.url) {
  runKnowledgeIndexPackaging(
    parseKnowledgeIndexPackagingArguments(process.argv.slice(2)),
  ).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

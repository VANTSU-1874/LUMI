import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

import {
  KNOWLEDGE_V2_BUNDLE_PATH,
  KNOWLEDGE_V2_REPORT_PATH,
  buildKnowledgeV2Corpus,
  serializeKnowledgeCorpusBundleV2,
  serializeKnowledgeV2ConversionReport,
  verifyKnowledgeV2ConversionReport,
} from "@/lib/knowledge/knowledge-v2-corpus";
import {
  verifyKnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";

export type KnowledgeV2ConversionMode = "WRITE" | "CHECK";

export function parseKnowledgeV2ConversionArgs(
  arguments_: readonly string[],
): KnowledgeV2ConversionMode {
  if (arguments_.length === 1 && arguments_[0] === "--write") return "WRITE";
  if (arguments_.length === 1 && arguments_[0] === "--check") return "CHECK";
  throw new Error("usage: convert-knowledge-v2.ts --write|--check");
}

function isSamePath(left: string, right: string) {
  return path.relative(left, right) === "";
}

async function existingPathKind(candidate: string) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

async function validateSafeOutputFile(
  outputPath: string,
  realOutputDirectory: string,
  required: boolean,
) {
  const stats = await existingPathKind(outputPath);
  if (!stats) {
    if (required) throw new Error(`KNOWLEDGE_V2_OUTPUT_MISSING:${outputPath}`);
    return;
  }
  const realOutputPath = await realpath(outputPath);
  const expected = path.join(realOutputDirectory, path.basename(outputPath));
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || !isSamePath(expected, realOutputPath)
  ) {
    throw new Error(`KNOWLEDGE_V2_OUTPUT_SYMLINK_NOT_ALLOWED:${outputPath}`);
  }
}

export async function resolveKnowledgeV2OutputPaths(
  mode: KnowledgeV2ConversionMode,
  workspaceRoot = process.cwd(),
) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const realWorkspaceRoot = await realpath(resolvedWorkspaceRoot);
  const dataDirectory = path.join(resolvedWorkspaceRoot, "data");
  const dataStats = await lstat(dataDirectory);
  const realDataDirectory = await realpath(dataDirectory);
  const expectedDataDirectory = path.join(realWorkspaceRoot, "data");
  if (
    dataStats.isSymbolicLink()
    || !dataStats.isDirectory()
    || !isSamePath(expectedDataDirectory, realDataDirectory)
  ) {
    throw new Error("KNOWLEDGE_V2_OUTPUT_DATA_ROOT_UNSAFE");
  }
  const outputDirectory = path.join(resolvedWorkspaceRoot, "data", "knowledge-v2");
  if (mode === "WRITE") await mkdir(outputDirectory, { recursive: true });
  const outputDirectoryStats = await existingPathKind(outputDirectory);
  if (!outputDirectoryStats) throw new Error("KNOWLEDGE_V2_OUTPUT_DIRECTORY_MISSING");
  const realOutputDirectory = await realpath(outputDirectory);
  const expectedOutputDirectory = path.join(realWorkspaceRoot, "data", "knowledge-v2");
  if (
    outputDirectoryStats.isSymbolicLink()
    || !outputDirectoryStats.isDirectory()
    || !isSamePath(expectedOutputDirectory, realOutputDirectory)
  ) {
    throw new Error("KNOWLEDGE_V2_OUTPUT_DIRECTORY_UNSAFE");
  }
  const bundlePath = path.join(resolvedWorkspaceRoot, KNOWLEDGE_V2_BUNDLE_PATH);
  const reportPath = path.join(resolvedWorkspaceRoot, KNOWLEDGE_V2_REPORT_PATH);
  await Promise.all([
    validateSafeOutputFile(bundlePath, realOutputDirectory, mode === "CHECK"),
    validateSafeOutputFile(reportPath, realOutputDirectory, mode === "CHECK"),
  ]);
  return { resolvedWorkspaceRoot, bundlePath, reportPath };
}

async function writeTemporary(outputPath: string, contents: string) {
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx");
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temporaryPath;
}

async function replaceOutputPair(input: {
  bundlePath: string;
  reportPath: string;
  bundleText: string;
  reportText: string;
}) {
  const temporaryPaths: string[] = [];
  try {
    const bundleTemporaryPath = await writeTemporary(input.bundlePath, input.bundleText);
    temporaryPaths.push(bundleTemporaryPath);
    const reportTemporaryPath = await writeTemporary(input.reportPath, input.reportText);
    temporaryPaths.push(reportTemporaryPath);
    await rename(bundleTemporaryPath, input.bundlePath);
    temporaryPaths.splice(temporaryPaths.indexOf(bundleTemporaryPath), 1);
    await rename(reportTemporaryPath, input.reportPath);
    temporaryPaths.splice(temporaryPaths.indexOf(reportTemporaryPath), 1);
  } finally {
    await Promise.all(temporaryPaths.map(async (temporaryPath) => {
      try {
        await unlink(temporaryPath);
      } catch (error) {
        if (
          !error
          || typeof error !== "object"
          || !("code" in error)
          || error.code !== "ENOENT"
        ) {
          throw error;
        }
      }
    }));
  }
}

export async function runKnowledgeV2Conversion(
  mode: KnowledgeV2ConversionMode,
  workspaceRoot = process.cwd(),
) {
  const { resolvedWorkspaceRoot, bundlePath, reportPath } =
    await resolveKnowledgeV2OutputPaths(mode, workspaceRoot);
  const built = await buildKnowledgeV2Corpus({ workspaceRoot: resolvedWorkspaceRoot });
  const bundleText = serializeKnowledgeCorpusBundleV2(built.bundle);
  const reportText = serializeKnowledgeV2ConversionReport(built.report);

  if (mode === "WRITE") {
    await replaceOutputPair({ bundlePath, reportPath, bundleText, reportText });
  } else {
    const [trackedBundleText, trackedReportText] = await Promise.all([
      readFile(bundlePath, "utf8"),
      readFile(reportPath, "utf8"),
    ]);
    const trackedBundle = verifyKnowledgeCorpusBundleV2(
      JSON.parse(trackedBundleText) as unknown,
    );
    verifyKnowledgeV2ConversionReport(
      JSON.parse(trackedReportText) as unknown,
      trackedBundle,
    );
    if (trackedBundleText !== bundleText) throw new Error("KNOWLEDGE_V2_BUNDLE_DRIFT");
    if (trackedReportText !== reportText) throw new Error("KNOWLEDGE_V2_REPORT_DRIFT");
  }

  return {
    mode,
    bundlePath: KNOWLEDGE_V2_BUNDLE_PATH,
    reportPath: KNOWLEDGE_V2_REPORT_PATH,
    objectCount: built.report.objectCount,
    assetCount: built.report.assetCount,
    referencedAssetCount: built.report.referencedAssetCount,
    unreferencedAssetCount: built.report.unreferencedAssetCount,
    bundleHash: built.bundle.bundleHash,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  Promise.resolve()
    .then(() => runKnowledgeV2Conversion(
      parseKnowledgeV2ConversionArgs(process.argv.slice(2)),
    ))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

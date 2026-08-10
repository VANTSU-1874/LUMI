import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { evaluateMixedFaultMatrixV2 } from "@/lib/knowledge/mixed-retrieval-fault-evaluation-v2";
import {
  assertMixedSuiteContractV2,
  evaluateMixedRetrieverV2,
  readMixedBaselineReportV2,
  T4_FROZEN_CAPTION_BASELINE_SHA256,
  T4_FROZEN_T3_BASELINE_SHA256,
} from "@/lib/knowledge/mixed-retrieval-evaluation-v2";
import {
  createLocalMixedRuntimeV2,
  type LocalMixedRuntimeV2,
} from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import { verifyKnowledgeCorpusBundleV2 } from "@/lib/knowledge/knowledge-object-v2";

const VALUE_ARGUMENTS = new Set([
  "--output",
  "--suite",
  "--caption-baseline",
  "--t3-baseline",
  "--python",
  "--text-model-dir",
  "--text-model-seal",
  "--text-index-dir",
  "--visual-model-dir",
  "--visual-model-seal",
  "--visual-index-dir",
  "--visual-offload-dir",
  "--control-dir",
  "--device",
  "--gpu-memory-gib",
  "--timeout-ms",
  "--warmups",
  "--repetitions",
]);

const REQUIRED_ARGUMENTS = [
  "--output",
  "--python",
  "--text-model-dir",
  "--text-model-seal",
  "--text-index-dir",
  "--visual-model-dir",
  "--visual-model-seal",
  "--visual-index-dir",
  "--visual-offload-dir",
  "--control-dir",
] as const;

type ParsedArguments = ReturnType<typeof parseMixedRetrievalArguments>;

function normalizePath(value: string) {
  return value.replaceAll("\\", "/");
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

function required(values: ReadonlyMap<string, string>, key: string) {
  const value = values.get(key);
  if (!value) throw new Error(`MIXED_CLI_REQUIRED_ARGUMENT_MISSING:${key}`);
  return value;
}

export function parseMixedRetrievalArguments(argv: readonly string[]) {
  const values = new Map<string, string>();
  let index = argv[0] === "--" ? 1 : 0;
  while (index < argv.length) {
    const argument = argv[index]!;
    if (!VALUE_ARGUMENTS.has(argument)) {
      throw new Error(`MIXED_CLI_UNKNOWN_ARGUMENT:${argument}`);
    }
    if (values.has(argument)) {
      throw new Error(`MIXED_CLI_DUPLICATE_ARGUMENT:${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value === "--" || value.startsWith("--")) {
      throw new Error(`MIXED_CLI_ARGUMENT_VALUE_MISSING:${argument}`);
    }
    values.set(argument, value);
    index += 2;
  }
  for (const argument of REQUIRED_ARGUMENTS) required(values, argument);
  const integer = (key: string, fallback: number) =>
    z.coerce.number().int().parse(values.get(key) ?? fallback);
  const number = (key: string, fallback: number) =>
    z.coerce.number().finite().parse(values.get(key) ?? fallback);
  return {
    output: required(values, "--output"),
    suite: values.get("--suite") ?? "tests/retrieval-quality/golden-suite.json",
    captionBaseline: values.get("--caption-baseline")
      ?? ".runtime/retrieval-quality/t0-caption-lexical-baseline.json",
    t3Baseline: values.get("--t3-baseline")
      ?? ".runtime/visual-retrieval/retrieval-quality/t3-siglip2-expanded.json",
    pythonExecutable: required(values, "--python"),
    textModelDir: required(values, "--text-model-dir"),
    textModelSeal: required(values, "--text-model-seal"),
    textIndexDir: required(values, "--text-index-dir"),
    visualModelDir: required(values, "--visual-model-dir"),
    visualModelSeal: required(values, "--visual-model-seal"),
    visualIndexDir: required(values, "--visual-index-dir"),
    visualOffloadDir: required(values, "--visual-offload-dir"),
    controlDir: required(values, "--control-dir"),
    device: z.enum(["cuda", "cpu"]).parse(values.get("--device") ?? "cuda"),
    gpuMemoryGiB: z.number().positive().max(64)
      .parse(number("--gpu-memory-gib", 3.5)),
    timeoutMs: z.number().int().min(1).max(30_000)
      .parse(integer("--timeout-ms", 10_000)),
    warmups: z.number().int().min(1).max(10).parse(integer("--warmups", 1)),
    repetitions: z.number().int().min(5).max(20)
      .parse(integer("--repetitions", 5)),
  };
}

function resolveInput(workspaceRoot: string, value: string) {
  return path.resolve(workspaceRoot, value);
}

async function assertNoSymlinkComponents(root: string, candidate: string) {
  const relative = path.relative(root, path.dirname(candidate));
  const components = relative === "" ? [] : relative.split(path.sep);
  let current = root;
  for (const component of components) {
    current = path.join(current, component);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error("MIXED_CLI_OUTPUT_SYMLINK_FORBIDDEN");
      }
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && error.code === "ENOENT"
      ) {
        break;
      }
      throw error;
    }
  }
}

export async function resolveMixedRetrievalOutputPath(
  workspaceRoot: string,
  value: string,
) {
  const runtimeRoot = path.resolve(workspaceRoot, ".runtime");
  const output = path.resolve(workspaceRoot, value);
  const allowedRoots = [
    path.join(runtimeRoot, "mixed-retrieval"),
    path.join(runtimeRoot, "retrieval-quality"),
  ];
  if (
    !allowedRoots.some((root) => isWithin(root, output) && output !== root)
    || path.extname(output).toLowerCase() !== ".json"
  ) {
    throw new Error("MIXED_CLI_OUTPUT_MUST_BE_DEDICATED_RUNTIME_JSON");
  }
  const runtimeStats = await lstat(runtimeRoot);
  if (runtimeStats.isSymbolicLink() || !runtimeStats.isDirectory()) {
    throw new Error("MIXED_CLI_RUNTIME_ROOT_INVALID");
  }
  const realRuntimeRoot = await realpath(runtimeRoot);
  if (canonicalPath(realRuntimeRoot) !== canonicalPath(runtimeRoot)) {
    throw new Error("MIXED_CLI_RUNTIME_ROOT_IDENTITY_DRIFT");
  }
  await assertNoSymlinkComponents(runtimeRoot, output);
  return output;
}

function canonicalPath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertOutputDoesNotOverlapInputs(
  output: string,
  files: readonly string[],
  directories: readonly string[],
) {
  const canonicalOutput = canonicalPath(output);
  if (files.some((file) => canonicalPath(file) === canonicalOutput)) {
    throw new Error("MIXED_CLI_OUTPUT_INPUT_COLLISION");
  }
  if (directories.some((directory) => {
    const canonicalDirectory = canonicalPath(directory);
    return canonicalOutput === canonicalDirectory
      || isWithin(canonicalDirectory, canonicalOutput);
  })) {
    throw new Error("MIXED_CLI_OUTPUT_INPUT_DIRECTORY_COLLISION");
  }
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export function assertFrozenMixedBaselineBytes(
  kind: "CAPTION" | "T3",
  bytes: Uint8Array,
) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const expected = kind === "CAPTION"
    ? T4_FROZEN_CAPTION_BASELINE_SHA256
    : T4_FROZEN_T3_BASELINE_SHA256;
  if (digest !== expected) {
    throw new Error(`MIXED_CLI_${kind}_BASELINE_HASH_MISMATCH:${digest}`);
  }
  return digest;
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function runtimeOptions(
  workspaceRoot: string,
  parsed: ParsedArguments,
  assetManifestPath: string,
  visualMaxCacheEntries: number,
) {
  return {
    workspaceRoot,
    pythonExecutable: resolveInput(workspaceRoot, parsed.pythonExecutable),
    textModelDir: resolveInput(workspaceRoot, parsed.textModelDir),
    textModelSeal: resolveInput(workspaceRoot, parsed.textModelSeal),
    textIndexDir: resolveInput(workspaceRoot, parsed.textIndexDir),
    visualModelDir: resolveInput(workspaceRoot, parsed.visualModelDir),
    visualModelSeal: resolveInput(workspaceRoot, parsed.visualModelSeal),
    visualIndexDir: resolveInput(workspaceRoot, parsed.visualIndexDir),
    visualOffloadDir: resolveInput(workspaceRoot, parsed.visualOffloadDir),
    controlDir: resolveInput(workspaceRoot, parsed.controlDir),
    assetManifestPath,
    device: parsed.device,
    gpuMemoryGiB: parsed.gpuMemoryGiB,
    timeoutMs: parsed.timeoutMs,
    visualMaxCacheEntries,
  };
}

function summarizeSpy(runtime: LocalMixedRuntimeV2) {
  const spy = runtime.providerSpy();
  const byChannel: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  const keySets = new Set<string>();
  const fingerprints = new Set<string>();
  for (const entry of spy.entries) {
    byChannel[entry.channel] = (byChannel[entry.channel] ?? 0) + 1;
    byMode[entry.mode] = (byMode[entry.mode] ?? 0) + 1;
    keySets.add(JSON.stringify(entry.keys));
    fingerprints.add(entry.queryFingerprint);
  }
  return {
    entryCount: spy.entryCount,
    byChannel,
    byMode,
    uniqueKeySets: [...keySets].map((keySet) => JSON.parse(keySet) as string[]),
    uniqueRuntimeInputFingerprints: fingerprints.size,
    allowlistViolations: [] as string[],
  };
}

function cacheParity(
  primary: Awaited<ReturnType<typeof evaluateMixedRetrieverV2>>,
  cacheHit: Awaited<ReturnType<typeof evaluateMixedRetrieverV2>>,
) {
  const hitByCase = new Map(cacheHit.cases.map((item) => [item.caseId, item]));
  const mismatches = primary.cases
    .filter((item) =>
      hitByCase.get(item.caseId)?.audit.resultFingerprint
        !== item.audit.resultFingerprint)
    .map(({ caseId }) => caseId);
  return {
    caseCount: primary.cases.length,
    exactResultFingerprintParity: primary.cases.length - mismatches.length,
    mismatchCaseIds: mismatches,
    pass: primary.cases.length === 51 && mismatches.length === 0,
  };
}

export async function runMixedRetrievalCli(
  argv = process.argv.slice(2),
  workspaceRoot = process.cwd(),
) {
  const root = path.resolve(workspaceRoot);
  let outputPath: string | null = null;
  let safeFailureOutput = false;
  let primaryRuntime: LocalMixedRuntimeV2 | null = null;
  let cacheHitRuntime: LocalMixedRuntimeV2 | null = null;
  try {
    const parsed = parseMixedRetrievalArguments(argv);
    outputPath = await resolveMixedRetrievalOutputPath(root, parsed.output);
    const suitePath = resolveInput(root, parsed.suite);
    const corpusPath = path.join(root, "data", "knowledge-v2", "knowledge-corpus.v2.json");
    const captionBaselinePath = resolveInput(root, parsed.captionBaseline);
    const t3BaselinePath = resolveInput(root, parsed.t3Baseline);
    const inputFiles = [
      suitePath,
      corpusPath,
      captionBaselinePath,
      t3BaselinePath,
      resolveInput(root, parsed.pythonExecutable),
      resolveInput(root, parsed.textModelSeal),
      resolveInput(root, parsed.visualModelSeal),
      path.join(resolveInput(root, parsed.controlDir), "knowledge-index-bundle.v2.json"),
      path.join(resolveInput(root, parsed.controlDir), "configs-by-version.v2.json"),
      path.join(resolveInput(root, parsed.textIndexDir), "index-manifest.json"),
      path.join(resolveInput(root, parsed.visualIndexDir), "manifest.json"),
    ];
    const inputDirectories = [
      resolveInput(root, parsed.textModelDir),
      resolveInput(root, parsed.textIndexDir),
      resolveInput(root, parsed.visualModelDir),
      resolveInput(root, parsed.visualIndexDir),
      resolveInput(root, parsed.visualOffloadDir),
      resolveInput(root, parsed.controlDir),
    ];
    assertOutputDoesNotOverlapInputs(outputPath, inputFiles, inputDirectories);
    safeFailureOutput = true;
    const [suiteBytes, rawCorpus, captionBaselineBytes, t3BaselineBytes] =
      await Promise.all([
        readFile(suitePath),
        readJson(corpusPath),
        readFile(captionBaselinePath),
        readFile(t3BaselinePath),
      ]);
    assertFrozenMixedBaselineBytes("CAPTION", captionBaselineBytes);
    assertFrozenMixedBaselineBytes("T3", t3BaselineBytes);
    const rawCaptionBaseline = JSON.parse(captionBaselineBytes.toString("utf8")) as unknown;
    const rawT3Baseline = JSON.parse(t3BaselineBytes.toString("utf8")) as unknown;
    const suite = assertMixedSuiteContractV2(suiteBytes);
    const corpus = verifyKnowledgeCorpusBundleV2(rawCorpus);
    const captionBaseline = readMixedBaselineReportV2(rawCaptionBaseline, "CAPTION");
    const t3Baseline = readMixedBaselineReportV2(rawT3Baseline, "T3");

    primaryRuntime = await createLocalMixedRuntimeV2(runtimeOptions(
      root,
      parsed,
      suite.corpusSnapshot.assetManifest,
      0,
    ));
    const primary = await evaluateMixedRetrieverV2({
      suiteBytes,
      corpus,
      captionBaseline,
      t3Baseline,
      expectedIdentity: primaryRuntime.expectedIdentity,
      runtimeEvidence: primaryRuntime.runtimeEvidence(),
      cachePolicy: {
        mode: "CACHE_MISS",
        visualMaxCacheEntries: 0,
      },
      warmups: parsed.warmups,
      repetitions: parsed.repetitions,
      retrieve: (query) => primaryRuntime!.retrieve(query),
    });
    const faultMatrix = await evaluateMixedFaultMatrixV2({
      suiteBytes,
      corpus,
      captionBaseline,
      normalCases: primary.cases,
      retrieve: (query, fault) => primaryRuntime!.retrieve(query, fault),
      diagnostics: () => primaryRuntime!.faultDiagnostics(),
    });
    const primaryProviderSpy = summarizeSpy(primaryRuntime);
    const primaryFaultDiagnostics = primaryRuntime.faultDiagnostics();
    await primaryRuntime.dispose();
    primaryRuntime = null;

    cacheHitRuntime = await createLocalMixedRuntimeV2(runtimeOptions(
      root,
      parsed,
      suite.corpusSnapshot.assetManifest,
      256,
    ));
    const cacheHitEvaluation = await evaluateMixedRetrieverV2({
      suiteBytes,
      corpus,
      captionBaseline,
      t3Baseline,
      expectedIdentity: cacheHitRuntime.expectedIdentity,
      runtimeEvidence: cacheHitRuntime.runtimeEvidence(),
      cachePolicy: {
        mode: "CACHE_HIT",
        visualMaxCacheEntries: 256,
        warmedBeforeMeasurement: true,
      },
      warmups: parsed.warmups,
      repetitions: parsed.repetitions,
      retrieve: (query) => cacheHitRuntime!.retrieve(query),
    });
    const cacheHitProviderSpy = summarizeSpy(cacheHitRuntime);
    await cacheHitRuntime.dispose();
    cacheHitRuntime = null;
    const parity = cacheParity(primary, cacheHitEvaluation);

    const gateChecks = [
      {
        id: "normal.cache-miss-gates",
        pass: primary.gateEvaluation.overallPass,
      },
      {
        id: "fault-matrix-gates",
        pass: faultMatrix.gateEvaluation.overallPass,
      },
      {
        id: "cache-hit.result-parity",
        pass: parity.pass,
      },
    ];
    const report = {
      ...primary,
      execution: {
        outputPath: normalizePath(path.relative(root, outputPath)),
        serviceDatabase: "NOT_USED",
        projectDatabase: "NOT_USED",
        agentRuntime: "NOT_USED",
        webService: "NOT_STARTED",
        deployment: "NOT_PERFORMED",
        effectiveInputs: {
          suite: normalizePath(path.relative(root, suitePath)),
          corpus: normalizePath(path.relative(root, corpusPath)),
          captionBaseline: normalizePath(path.relative(root, captionBaselinePath)),
          t3Baseline: normalizePath(path.relative(root, t3BaselinePath)),
          controlDir: normalizePath(path.relative(
            root,
            resolveInput(root, parsed.controlDir),
          )),
          textIndexDir: normalizePath(path.relative(
            root,
            resolveInput(root, parsed.textIndexDir),
          )),
          visualIndexDir: normalizePath(path.relative(
            root,
            resolveInput(root, parsed.visualIndexDir),
          )),
        },
      },
      providerSpy: {
        primary: primaryProviderSpy,
        cacheHit: cacheHitProviderSpy,
      },
      faultMatrix: {
        ...faultMatrix,
        diagnostics: primaryFaultDiagnostics,
      },
      cacheHit: {
        independentRuntime: true,
        runtimeEvidence: cacheHitEvaluation.runConfig.runtimeEvidence,
        performance: cacheHitEvaluation.performance,
        parity,
        normalGateNotApplied:
          "The cache-hit run is a separately labelled performance run; primary frozen gates use cache miss.",
      },
      normalGateEvaluation: primary.gateEvaluation,
      gateEvaluation: {
        gateVersion: primary.gateVersion,
        overallPass: gateChecks.every(({ pass }) => pass),
        passed: gateChecks.filter(({ pass }) => pass).length,
        failed: gateChecks.filter(({ pass }) => !pass).length,
        checks: gateChecks,
      },
    };
    await writeJsonAtomic(outputPath, report);
    if (!report.gateEvaluation.overallPass) process.exitCode = 1;
    process.stderr.write(`${JSON.stringify({
      event: "effective-mixed-retrieval-sources",
      serviceDatabase: "NOT_USED",
      projectDatabase: "NOT_USED",
      suite: report.execution.effectiveInputs.suite,
      corpus: report.execution.effectiveInputs.corpus,
      controlDir: report.execution.effectiveInputs.controlDir,
      textIndexDir: report.execution.effectiveInputs.textIndexDir,
      visualIndexDir: report.execution.effectiveInputs.visualIndexDir,
      cacheMissVisualMaxCacheEntries:
        primary.runConfig.runtimeEvidence.visualMaxCacheEntries,
      cacheHitVisualMaxCacheEntries:
        cacheHitEvaluation.runConfig.runtimeEvidence.visualMaxCacheEntries,
      groundTruthSentToRetriever: false,
    })}\n`);
    return {
      reportPath: normalizePath(path.relative(root, outputPath)),
      suiteVersion: report.suiteVersion,
      suiteHash: report.suiteHash,
      normalGatePass: primary.gateEvaluation.overallPass,
      faultGatePass: faultMatrix.gateEvaluation.overallPass,
      cacheParityPass: parity.pass,
      overallPass: report.gateEvaluation.overallPass,
    };
  } catch (error) {
    process.exitCode = 1;
    await Promise.allSettled([
      primaryRuntime?.dispose(),
      cacheHitRuntime?.dispose(),
    ]);
    if (outputPath !== null && safeFailureOutput) {
      const failureReport = {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        evaluator: "SELF_HOSTED_MIXED_RETRIEVAL_V2",
        status: "HARNESS_ERROR",
        outputPath: normalizePath(path.relative(root, outputPath)),
        serviceDatabase: "NOT_USED",
        projectDatabase: "NOT_USED",
        error: error instanceof Error ? error.message : String(error),
        gateEvaluation: {
          overallPass: false,
          passed: 0,
          failed: 1,
          checks: [{
            id: "harness.completed",
            pass: false,
          }],
        },
      };
      await writeJsonAtomic(outputPath, failureReport).catch(() => undefined);
    }
    throw error;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  runMixedRetrievalCli()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    })
    .catch((error) => {
      process.exitCode = 1;
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    });
}

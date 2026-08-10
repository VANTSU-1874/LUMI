import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

import type {
  CapabilityBoundaryTraceV2,
} from "@/lib/knowledge/capability-boundary-v2";
import {
  createLocalMixedRuntimeV2,
  type LocalMixedRuntimeV2,
  type LocalMixedRuntimeV2Options,
} from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import { assertMixedRuntimeQueryAllowlistV2 } from "@/lib/knowledge/mixed-retrieval-evaluation-v2";
import { verifyKnowledgeCorpusBundleV2 } from "@/lib/knowledge/knowledge-object-v2";
import {
  createT41EvidenceBundleProvider,
  evaluateT41Answerability,
  T41RuntimeIdentitySchema,
} from "@/tools/mixed-retrieval/t41-answerability-evaluator";
import {
  loadT41AnswerabilitySuite,
  type T41Split,
} from "@/tools/mixed-retrieval/t41-answerability-loader";
import {
  assertT41CandidateSealMatchesV2,
  assertT41DeclaredRuntimeIdentityMatchesReportV2,
  assertT41CandidateSourceScopeCleanV2,
  captureT41CandidateSourceStateV2,
  createT41CandidateSealV2,
  T41_CANDIDATE_DIRTY_SCOPE_PATHS,
  T41_CANDIDATE_SOURCE_PATHS,
  verifyT41CandidateSealV2,
  type T41CandidateSealV2,
} from "@/tools/mixed-retrieval/t41-candidate-seal";

const VALUE_ARGUMENTS = new Set([
  "--output",
  "--candidate-seal",
  "--split",
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
]);

const BOOLEAN_ARGUMENTS = new Set(["--allow-heldout"]);

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

const DEFAULT_SUITE_BY_SPLIT = Object.freeze({
  DEV: "tests/retrieval-quality/t41-answerability-dev.json",
  HELDOUT: "tests/retrieval-quality/t41-answerability-heldout.json",
} satisfies Record<T41Split, string>);

const CORPUS_PATH = "data/knowledge-v2/knowledge-corpus.v2.json";
const ASSET_MANIFEST_PATH = "data/manifests/course-png-sha256.v1.json";
const execFileAsync = promisify(execFile);

export type ParsedT41AnswerabilityArguments = ReturnType<
  typeof parseT41AnswerabilityArguments
>;

function normalizePath(value: string) {
  return value.replaceAll("\\", "/");
}

function canonicalPath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
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
  if (!value) {
    throw new Error(`T41_CLI_REQUIRED_ARGUMENT_MISSING:${key}`);
  }
  return value;
}

export function parseT41AnswerabilityArguments(argv: readonly string[]) {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  let index = argv[0] === "--" ? 1 : 0;

  while (index < argv.length) {
    const argument = argv[index]!;
    if (BOOLEAN_ARGUMENTS.has(argument)) {
      if (flags.has(argument)) {
        throw new Error(`T41_CLI_DUPLICATE_ARGUMENT:${argument}`);
      }
      flags.add(argument);
      index += 1;
      continue;
    }
    if (!VALUE_ARGUMENTS.has(argument)) {
      throw new Error(`T41_CLI_UNKNOWN_ARGUMENT:${argument}`);
    }
    if (values.has(argument)) {
      throw new Error(`T41_CLI_DUPLICATE_ARGUMENT:${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value === "--" || value.startsWith("--")) {
      throw new Error(`T41_CLI_ARGUMENT_VALUE_MISSING:${argument}`);
    }
    values.set(argument, value);
    index += 2;
  }

  for (const argument of REQUIRED_ARGUMENTS) required(values, argument);

  const split = z.enum(["DEV", "HELDOUT"]).parse(
    values.get("--split") ?? "DEV",
  );
  const allowHeldout = flags.has("--allow-heldout");
  if (split === "HELDOUT" && !allowHeldout) {
    throw new Error(
      "T41_CLI_HELDOUT_REQUIRES_EXPLICIT_SPLIT_AND_ALLOW_HELDOUT",
    );
  }
  if (split !== "HELDOUT" && allowHeldout) {
    throw new Error("T41_CLI_ALLOW_HELDOUT_REQUIRES_HELDOUT_SPLIT");
  }
  const output = required(values, "--output");
  const explicitCandidateSeal = values.get("--candidate-seal");
  if (split === "HELDOUT" && !explicitCandidateSeal) {
    throw new Error("T41_CLI_HELDOUT_REQUIRES_FROZEN_CANDIDATE_SEAL");
  }
  const outputExtension = path.extname(output);
  const candidateSeal = explicitCandidateSeal
    ?? (
      outputExtension
        ? `${output.slice(0, -outputExtension.length)}.candidate-seal.json`
        : `${output}.candidate-seal.json`
    );

  const integer = (key: string, fallback: number) =>
    z.coerce.number().int().parse(values.get(key) ?? fallback);
  const number = (key: string, fallback: number) =>
    z.coerce.number().finite().parse(values.get(key) ?? fallback);

  return {
    output,
    candidateSeal,
    split,
    allowHeldout,
    suite: DEFAULT_SUITE_BY_SPLIT[split],
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
        throw new Error("T41_CLI_OUTPUT_SYMLINK_FORBIDDEN");
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

export async function resolveT41AnswerabilityOutputPath(
  workspaceRoot: string,
  value: string,
) {
  const runtimeRoot = path.resolve(workspaceRoot, ".runtime");
  const allowedRoot = path.join(runtimeRoot, "mixed-retrieval");
  const output = path.resolve(workspaceRoot, value);
  if (
    !isWithin(allowedRoot, output)
    || output === allowedRoot
    || path.extname(output).toLowerCase() !== ".json"
  ) {
    throw new Error(
      "T41_CLI_OUTPUT_MUST_BE_MIXED_RETRIEVAL_RUNTIME_JSON",
    );
  }

  const runtimeStats = await lstat(runtimeRoot);
  if (runtimeStats.isSymbolicLink() || !runtimeStats.isDirectory()) {
    throw new Error("T41_CLI_RUNTIME_ROOT_INVALID");
  }
  const realRuntimeRoot = await realpath(runtimeRoot);
  if (canonicalPath(realRuntimeRoot) !== canonicalPath(runtimeRoot)) {
    throw new Error("T41_CLI_RUNTIME_ROOT_IDENTITY_DRIFT");
  }
  await assertNoSymlinkComponents(runtimeRoot, output);
  try {
    await lstat(output);
    throw new Error("T41_CLI_OUTPUT_ALREADY_EXISTS");
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return output;
    }
    throw error;
  }
}

export async function resolveT41CandidateSealInputPath(
  workspaceRoot: string,
  value: string,
) {
  const runtimeRoot = path.resolve(workspaceRoot, ".runtime");
  const allowedRoot = path.join(runtimeRoot, "mixed-retrieval");
  const candidateSeal = path.resolve(workspaceRoot, value);
  if (
    !isWithin(allowedRoot, candidateSeal)
    || candidateSeal === allowedRoot
    || path.extname(candidateSeal).toLowerCase() !== ".json"
  ) {
    throw new Error(
      "T41_CLI_CANDIDATE_SEAL_MUST_BE_MIXED_RETRIEVAL_RUNTIME_JSON",
    );
  }
  const runtimeStats = await lstat(runtimeRoot);
  if (runtimeStats.isSymbolicLink() || !runtimeStats.isDirectory()) {
    throw new Error("T41_CLI_RUNTIME_ROOT_INVALID");
  }
  await assertNoSymlinkComponents(runtimeRoot, candidateSeal);
  const stats = await lstat(candidateSeal);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("T41_CLI_CANDIDATE_SEAL_FILE_INVALID");
  }
  const realCandidateSeal = await realpath(candidateSeal);
  if (
    canonicalPath(realCandidateSeal)
    !== canonicalPath(candidateSeal)
  ) {
    throw new Error("T41_CLI_CANDIDATE_SEAL_IDENTITY_DRIFT");
  }
  return candidateSeal;
}

export function assertT41AnswerabilityOutputIsolation(
  output: string,
  files: readonly string[],
  directories: readonly string[],
) {
  const canonicalOutput = canonicalPath(output);
  if (files.some((file) => canonicalPath(file) === canonicalOutput)) {
    throw new Error("T41_CLI_OUTPUT_INPUT_COLLISION");
  }
  if (directories.some((directory) => {
    const canonicalDirectory = canonicalPath(directory);
    return canonicalOutput === canonicalDirectory
      || isWithin(canonicalDirectory, canonicalOutput);
  })) {
    throw new Error("T41_CLI_OUTPUT_INPUT_DIRECTORY_COLLISION");
  }
}

async function gitOutput(
  workspaceRoot: string,
  args: readonly string[],
) {
  const { stdout } = await execFileAsync(
    "git",
    [...args],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  return stdout.trim();
}

async function captureCommittedCandidateSourceState(
  workspaceRoot: string,
) {
  try {
    const dirty = await gitOutput(workspaceRoot, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ...T41_CANDIDATE_DIRTY_SCOPE_PATHS,
    ]);
    assertT41CandidateSourceScopeCleanV2(dirty);
    await gitOutput(workspaceRoot, [
      "ls-files",
      "--error-unmatch",
      "--",
      ...T41_CANDIDATE_SOURCE_PATHS,
    ]);
    await gitOutput(workspaceRoot, [
      "diff",
      "--quiet",
      "HEAD",
      "--",
      ...T41_CANDIDATE_SOURCE_PATHS,
    ]);
  } catch {
    throw new Error(
      "T41_CANDIDATE_SOURCE_MUST_BE_TRACKED_AND_COMMITTED",
    );
  }
  const [gitCommit, gitTree] = await Promise.all([
    gitOutput(workspaceRoot, ["rev-parse", "HEAD"]),
    gitOutput(workspaceRoot, ["rev-parse", "HEAD^{tree}"]),
  ]);
  return captureT41CandidateSourceStateV2({
    workspaceRoot,
    gitCommit,
    gitTree,
  });
}

function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await link(temporary, filePath);
    await unlink(temporary);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function runtimeOptions(
  workspaceRoot: string,
  parsed: ParsedT41AnswerabilityArguments,
): LocalMixedRuntimeV2Options {
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
    assetManifestPath: ASSET_MANIFEST_PATH,
    device: parsed.device,
    gpuMemoryGiB: parsed.gpuMemoryGiB,
    timeoutMs: parsed.timeoutMs,
    visualMaxCacheEntries: 0,
  };
}

function gateSummary(
  report: Awaited<ReturnType<typeof evaluateT41Answerability>>,
) {
  const failedGateIds = report.gates.results
    .filter(({ passed }) => !passed)
    .map(({ gateId }) => gateId);
  return {
    passed: report.gates.passed,
    qualityPassed: report.gates.qualityPassed,
    runtimeIntegrityPassed: report.gates.runtimeIntegrityPassed,
    passedCount: report.gates.results.length - failedGateIds.length,
    failedCount: failedGateIds.length,
    failedGateIds,
  };
}

function identitySummary(
  report: Awaited<ReturnType<typeof evaluateT41Answerability>>,
) {
  const identity = report.identityAudit.identities[0] ?? null;
  return {
    consistentAcrossCases: report.identityAudit.consistentAcrossCases,
    corpusBundleHashMatchesQuery:
      report.identityAudit.corpusBundleHashMatchesQuery,
    allChannelsIdentified: report.identityAudit.allChannelsIdentified,
    uniqueIdentityCount: report.identityAudit.uniqueIdentityCount,
    runtimeIdentitySha256: identity?.runtimeIdentitySha256 ?? null,
    runtimeIdentity: identity?.identity ?? null,
  };
}

function providerInvocationAudit(
  report: Awaited<ReturnType<typeof evaluateT41Answerability>>,
  spy: ReturnType<LocalMixedRuntimeV2["providerSpy"]>,
) {
  const byQuery = new Map<string, typeof spy.entries>();
  for (const entry of spy.entries) {
    const entries = byQuery.get(entry.queryFingerprint) ?? [];
    entries.push(entry);
    byQuery.set(entry.queryFingerprint, entries);
  }
  const evaluatedFingerprints = new Set(
    report.cases.map(({ runtimeQuerySha256 }) => runtimeQuerySha256),
  );
  const violations: string[] = [];
  for (const testCase of report.cases) {
    const expectedChannels = testCase.category
        === "EXTERNAL_VERIFICATION_REQUIRED"
      ? []
      : ["LEXICAL", "TEXT_VECTOR"];
    const observedChannels = (
      byQuery.get(testCase.runtimeQuerySha256) ?? []
    )
      .map(({ channel }) => channel)
      .sort();
    if (
      JSON.stringify(observedChannels)
      !== JSON.stringify(expectedChannels)
    ) {
      violations.push(
        `${testCase.caseId}: expected ${expectedChannels.join("+") || "no"} `
          + `provider calls, observed ${observedChannels.join("+") || "none"}`,
      );
    }
  }
  for (const queryFingerprint of byQuery.keys()) {
    if (!evaluatedFingerprints.has(queryFingerprint)) {
      violations.push(
        `provider call observed for unknown query ${queryFingerprint}`,
      );
    }
  }
  const expectedEntryCount = report.cases.filter(
    ({ category }) => category !== "EXTERNAL_VERIFICATION_REQUIRED",
  ).length * 2;
  if (spy.entryCount !== expectedEntryCount) {
    violations.push(
      `expected ${expectedEntryCount} total provider calls, observed ${spy.entryCount}`,
    );
  }
  return {
    passed: violations.length === 0,
    expectedEntryCount,
    observedEntryCount: spy.entryCount,
    expectedHealthyQueryShape: {
      LEXICAL: 1,
      TEXT_VECTOR: 1,
      VISUAL_VECTOR: 0,
      CAPTION_LEXICAL: 0,
    },
    externalVerificationProviderCalls: 0,
    violations,
  };
}

export function t41BoundaryAuditForSplit(
  split: T41Split,
  boundary: CapabilityBoundaryTraceV2 | null,
) {
  if (boundary === null || split === "DEV") return boundary;
  return {
    schemaVersion: boundary.schemaVersion,
    decision: boundary.decision,
    reason: boundary.reason,
    queryMode: boundary.queryMode,
    sourceCoursePack: boundary.sourceCoursePack,
    acceptancePolicyHash: boundary.acceptancePolicyHash,
    capabilityEntityManifestHash:
      boundary.capabilityEntityManifestHash,
    packCompetitionPolicyHash:
      boundary.packCompetitionPolicyHash,
    packCompetitionCalibrationHash:
      boundary.packCompetitionCalibrationHash,
    lexicalPackCompetitionAlgorithmHash:
      boundary.lexicalPackCompetitionAlgorithmHash,
    textPackCompetitionAlgorithmHash:
      boundary.textPackCompetitionAlgorithmHash,
    acceptedCandidateCountBefore:
      boundary.acceptedCandidateIdsBefore.length,
    acceptedCandidateCountAfter:
      boundary.acceptedCandidateIdsAfter.length,
    matchedEntityCount: boundary.matchedEntities.length,
    unsupportedTechnicalAnchorCount:
      boundary.unsupportedTechnicalAnchors.length,
    diagnosticsPresent: boundary.diagnostics !== null,
  };
}

export async function runT41AnswerabilityCli(
  argv = process.argv.slice(2),
  workspaceRoot = process.cwd(),
) {
  const root = path.resolve(workspaceRoot);
  let runtime: LocalMixedRuntimeV2 | null = null;

  try {
    const parsed = parseT41AnswerabilityArguments(argv);
    const outputPath = await resolveT41AnswerabilityOutputPath(
      root,
      parsed.output,
    );
    const candidateSealPath = parsed.split === "DEV"
      ? await resolveT41AnswerabilityOutputPath(
          root,
          parsed.candidateSeal,
        )
      : await resolveT41CandidateSealInputPath(
          root,
          parsed.candidateSeal,
        );
    if (
      canonicalPath(candidateSealPath)
      === canonicalPath(outputPath)
    ) {
      throw new Error("T41_CLI_REPORT_AND_CANDIDATE_SEAL_COLLIDE");
    }
    const frozenCandidateSeal: T41CandidateSealV2 | null =
      parsed.split === "HELDOUT"
        ? verifyT41CandidateSealV2(JSON.parse(
            await readFile(candidateSealPath, "utf8"),
          ) as unknown)
        : null;
    const suitePath = resolveInput(root, parsed.suite);
    const expectedSuitePath = resolveInput(
      root,
      DEFAULT_SUITE_BY_SPLIT[parsed.split],
    );
    if (canonicalPath(suitePath) !== canonicalPath(expectedSuitePath)) {
      throw new Error("T41_CLI_SUITE_PATH_NOT_FROZEN_FOR_SPLIT");
    }
    const realSuitePath = await realpath(suitePath);
    if (canonicalPath(realSuitePath) !== canonicalPath(suitePath)) {
      throw new Error("T41_CLI_SUITE_PATH_IDENTITY_DRIFT");
    }
    const corpusPath = resolveInput(root, CORPUS_PATH);
    const assetManifestPath = resolveInput(root, ASSET_MANIFEST_PATH);
    const inputFiles = [
      suitePath,
      corpusPath,
      assetManifestPath,
      resolveInput(root, parsed.pythonExecutable),
      resolveInput(root, parsed.textModelSeal),
      resolveInput(root, parsed.visualModelSeal),
      path.join(
        resolveInput(root, parsed.controlDir),
        "knowledge-index-bundle.v2.json",
      ),
      path.join(
        resolveInput(root, parsed.controlDir),
        "configs-by-version.v2.json",
      ),
      path.join(
        resolveInput(root, parsed.textIndexDir),
        "index-manifest.json",
      ),
      path.join(
        resolveInput(root, parsed.visualIndexDir),
        "manifest.json",
      ),
      ...(parsed.split === "HELDOUT"
        ? [candidateSealPath]
        : []),
    ];
    const inputDirectories = [
      resolveInput(root, parsed.textModelDir),
      resolveInput(root, parsed.textIndexDir),
      resolveInput(root, parsed.visualModelDir),
      resolveInput(root, parsed.visualIndexDir),
      resolveInput(root, parsed.visualOffloadDir),
      resolveInput(root, parsed.controlDir),
    ];
    assertT41AnswerabilityOutputIsolation(
      outputPath,
      inputFiles,
      inputDirectories,
    );
    if (parsed.split === "DEV") {
      assertT41AnswerabilityOutputIsolation(
        candidateSealPath,
        [...inputFiles, outputPath],
        inputDirectories,
      );
    }

    const corpusBytes = await readFile(corpusPath);
    const corpus = verifyKnowledgeCorpusBundleV2(
      JSON.parse(corpusBytes.toString("utf8")) as unknown,
    );

    runtime = await createLocalMixedRuntimeV2(
      runtimeOptions(root, parsed),
    );
    const declaredRuntimeIdentity = T41RuntimeIdentitySchema.parse(
      runtime.t41CandidateIdentity,
    );
    if (frozenCandidateSeal) {
      const sourceState =
        await captureCommittedCandidateSourceState(root);
      assertT41CandidateSealMatchesV2({
        seal: frozenCandidateSeal,
        runtimeIdentity: declaredRuntimeIdentity,
        sourceState,
      });
    }
    const suiteBytes = await readFile(suitePath);
    const loadedSuite = loadT41AnswerabilitySuite(suiteBytes, {
      expectedSplit: parsed.split,
      allowHeldout: parsed.allowHeldout,
    });
    const evidenceAudits: Array<{
      runtimeQuerySha256: string;
      status: string;
      primaryObjectIds: string[];
      acceptance: unknown;
      boundary: unknown;
      channels: unknown;
    }> = [];
    const report = await evaluateT41Answerability({
      loadedSuite,
      corpusBundleHash: corpus.bundleHash,
      provider: createT41EvidenceBundleProvider(async (query) => {
        const bundle = await runtime!.retrieve(query);
        evidenceAudits.push({
          runtimeQuerySha256:
            assertMixedRuntimeQueryAllowlistV2(query).fingerprint,
          status: bundle.status,
          primaryObjectIds: bundle.evidence.primary.map(
            ({ objectId }) => objectId,
          ),
          acceptance: bundle.evidence.acceptance,
          boundary: t41BoundaryAuditForSplit(
            parsed.split,
            bundle.evidence.boundary ?? null,
          ),
          channels: bundle.channels,
        });
        return bundle;
      }, runtime.expectedIdentity.channels),
      allowHeldoutEvaluation: parsed.allowHeldout,
    });
    const providerSpy = runtime.providerSpy();
    const runtimeEvidence = runtime.runtimeEvidence();
    const invocationAudit = providerInvocationAudit(report, providerSpy);
    await runtime.dispose();
    runtime = null;

    const outputRelativePath = normalizePath(path.relative(root, outputPath));
    const candidateSealRelativePath = normalizePath(
      path.relative(root, candidateSealPath),
    );
    const reportPassed = report.reportPassed && invocationAudit.passed;
    let candidateSourceState: Awaited<ReturnType<
      typeof captureCommittedCandidateSourceState
    >> | null = null;
    let candidateSealFailure: string | null = null;
    if (parsed.split === "DEV" && reportPassed) {
      try {
        assertT41DeclaredRuntimeIdentityMatchesReportV2({
          declaredRuntimeIdentity,
          observedIdentities: report.identityAudit.identities,
        });
      } catch (error) {
        candidateSealFailure = error instanceof Error
          ? error.message
          : "T41_CANDIDATE_DECLARED_RUNTIME_IDENTITY_MISMATCH";
      }
      if (candidateSealFailure === null) {
        try {
          candidateSourceState =
            await captureCommittedCandidateSourceState(root);
        } catch (error) {
          candidateSealFailure = error instanceof Error
            ? error.message
            : "T41_CANDIDATE_SOURCE_FREEZE_FAILED";
        }
      }
    }
    const candidateFrozen = parsed.split === "HELDOUT"
      ? frozenCandidateSeal !== null
      : candidateSourceState !== null;
    const summary = {
      outputPath: outputRelativePath,
      reportPassed,
      candidateFrozen,
      aggregates: report.aggregates,
      gates: {
        ...gateSummary(report),
        providerInvocationAudit: invocationAudit,
      },
      identity: identitySummary(report),
      candidateSeal: parsed.split === "HELDOUT"
        ? candidateSealRelativePath
        : candidateFrozen
          ? candidateSealRelativePath
          : null,
      candidateSealFailure,
    };
    const reportPayload = {
      ...report,
      reportPassed,
      evaluatorReportPassed: report.reportPassed,
      execution: {
        outputPath: outputRelativePath,
        splitRequested: parsed.split,
        heldoutExplicitlyAuthorized: parsed.allowHeldout,
        candidateSeal: parsed.split === "HELDOUT"
          ? {
              mode: "FROZEN_DEV_INPUT",
              path: candidateSealRelativePath,
              configHash: frozenCandidateSeal!.configHash,
            }
          : candidateFrozen
            ? {
                mode: "CREATED_FROM_PASSING_DEV",
                path: candidateSealRelativePath,
              }
            : reportPassed
              ? {
                  mode: "NOT_CREATED_CANDIDATE_FREEZE_FAILED",
                  path: null,
                  reason: candidateSealFailure,
                }
            : {
                mode: "NOT_CREATED_DEV_NO_GO",
                path: null,
              },
        evidenceAuditDetailLevel: parsed.split === "DEV"
          ? "DEV_FULL_BOUNDARY_TRACE"
          : "HELDOUT_REDACTED_BOUNDARY_COUNTS",
        effectiveInputs: {
          suite: normalizePath(path.relative(root, suitePath)),
          corpus: normalizePath(path.relative(root, corpusPath)),
          assetManifest: normalizePath(
            path.relative(root, assetManifestPath),
          ),
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
        serviceDatabase: "NOT_USED",
        projectDatabase: "NOT_USED",
        agentRuntime: "NOT_USED",
        webService: "NOT_STARTED",
        deployment: "NOT_PERFORMED",
        groundTruthSentToRetriever: false,
        providerInvocationAudit: invocationAudit,
        runtimeEvidence,
        evidenceAudits,
      },
    };
    let createdCandidateSeal: T41CandidateSealV2 | null = null;
    if (parsed.split === "DEV" && candidateSourceState) {
      const reportBytes = Buffer.from(
        `${JSON.stringify(reportPayload, null, 2)}\n`,
        "utf8",
      );
      createdCandidateSeal = createT41CandidateSealV2({
        devReportSha256: sha256Bytes(reportBytes),
        runtimeIdentity: declaredRuntimeIdentity,
        sourceState: candidateSourceState,
      });
    }
    await writeJsonAtomic(outputPath, reportPayload);
    if (createdCandidateSeal) {
      await writeJsonAtomic(
        candidateSealPath,
        createdCandidateSeal,
      );
    }

    process.stderr.write(`${JSON.stringify({
      event: "effective-t41-answerability-sources",
      split: parsed.split,
      heldoutExplicitlyAuthorized: parsed.allowHeldout,
      candidateSeal: parsed.split === "HELDOUT"
        ? candidateSealRelativePath
        : createdCandidateSeal
          ? candidateSealRelativePath
          : candidateSealFailure
            ? `NOT_CREATED:${candidateSealFailure}`
            : "NOT_CREATED_DEV_NO_GO",
      suite: normalizePath(path.relative(root, suitePath)),
      corpus: normalizePath(path.relative(root, corpusPath)),
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
      serviceDatabase: "NOT_USED",
      projectDatabase: "NOT_USED",
      groundTruthSentToRetriever: false,
    })}\n`);

    if (!reportPassed || candidateSealFailure) process.exitCode = 1;
    return summary;
  } catch (error) {
    process.exitCode = 1;
    await runtime?.dispose().catch(() => undefined);
    throw error;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  runT41AnswerabilityCli()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    })
    .catch((error) => {
      process.exitCode = 1;
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
}

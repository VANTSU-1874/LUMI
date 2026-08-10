import { randomUUID } from "node:crypto";
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

import {
  createLocalMixedRuntimeV2,
  type LocalMixedRuntimeV2,
  type LocalMixedRuntimeV2Options,
} from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import {
  assertMixedRuntimeQueryAllowlistV2,
} from "@/lib/knowledge/mixed-retrieval-evaluation-v2";
import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  evaluateT42Recall,
  type T42RecallArm,
} from "@/tools/mixed-retrieval/t42-recall-evaluator";
import {
  loadT42RecallSuite,
} from "@/tools/mixed-retrieval/t42-recall-loader";

const VALUE_ARGUMENTS = new Set([
  "--output",
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

const SUITE_PATH = "tests/retrieval-quality/t42-recall-dev.json";
const CORPUS_PATH = "data/knowledge-v2/knowledge-corpus.v2.json";

function required(values: ReadonlyMap<string, string>, key: string) {
  const value = values.get(key);
  if (!value) throw new Error(`T42_CLI_REQUIRED_ARGUMENT_MISSING:${key}`);
  return value;
}

export function parseT42RecallArguments(argv: readonly string[]) {
  const values = new Map<string, string>();
  let index = argv[0] === "--" ? 1 : 0;
  while (index < argv.length) {
    const argument = argv[index]!;
    if (!VALUE_ARGUMENTS.has(argument)) {
      throw new Error(`T42_CLI_UNKNOWN_ARGUMENT:${argument}`);
    }
    if (values.has(argument)) {
      throw new Error(`T42_CLI_DUPLICATE_ARGUMENT:${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value === "--" || value.startsWith("--")) {
      throw new Error(`T42_CLI_ARGUMENT_VALUE_MISSING:${argument}`);
    }
    values.set(argument, value);
    index += 2;
  }
  for (const argument of REQUIRED_ARGUMENTS) required(values, argument);
  const split = values.get("--split") ?? "DEV";
  if (split !== "DEV") {
    throw new Error("T42_CLI_ONLY_VISIBLE_DEV_IS_AUTHORIZED");
  }
  const integer = (key: string, fallback: number) =>
    z.coerce.number().int().parse(values.get(key) ?? fallback);
  const number = (key: string, fallback: number) =>
    z.coerce.number().finite().parse(values.get(key) ?? fallback);
  return {
    output: required(values, "--output"),
    split: "DEV" as const,
    pythonExecutable: required(values, "--python"),
    textModelDir: required(values, "--text-model-dir"),
    textModelSeal: required(values, "--text-model-seal"),
    textIndexDir: required(values, "--text-index-dir"),
    visualModelDir: required(values, "--visual-model-dir"),
    visualModelSeal: required(values, "--visual-model-seal"),
    visualIndexDir: required(values, "--visual-index-dir"),
    visualOffloadDir: required(values, "--visual-offload-dir"),
    controlDir: required(values, "--control-dir"),
    device: z.enum(["cuda", "cpu"]).parse(
      values.get("--device") ?? "cuda",
    ),
    gpuMemoryGiB: z.number().positive().max(64).parse(
      number("--gpu-memory-gib", 3.5),
    ),
    timeoutMs: z.number().int().min(1).max(30_000).parse(
      integer("--timeout-ms", 10_000),
    ),
  };
}

function canonicalPath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function isSameOrWithin(root: string, candidate: string) {
  const canonicalRoot = canonicalPath(root);
  const canonicalCandidate = canonicalPath(candidate);
  return canonicalCandidate === canonicalRoot
    || isWithin(canonicalRoot, canonicalCandidate);
}

async function assertT42OutputParentsAreLocal(
  runtimeRoot: string,
  output: string,
) {
  const realRuntimeRoot = await realpath(runtimeRoot);
  const relative = path.relative(runtimeRoot, path.dirname(output));
  const components = relative === "" ? [] : relative.split(path.sep);
  let current = runtimeRoot;
  for (const component of components) {
    current = path.join(current, component);
    let stats;
    try {
      stats = await lstat(current);
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
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("T42_CLI_OUTPUT_PARENT_INVALID");
    }
    const realCurrent = await realpath(current);
    if (
      !isSameOrWithin(realRuntimeRoot, realCurrent)
      || canonicalPath(realCurrent) !== canonicalPath(current)
    ) {
      throw new Error("T42_CLI_OUTPUT_PARENT_IDENTITY_DRIFT");
    }
  }
}

export async function resolveT42OutputPath(
  workspaceRoot: string,
  value: string,
) {
  const runtimeRoot = path.resolve(workspaceRoot, ".runtime");
  const allowedRoot = path.join(runtimeRoot, "mixed-retrieval");
  const output = path.resolve(workspaceRoot, value);
  if (
    !isWithin(allowedRoot, output)
    || path.extname(output).toLowerCase() !== ".json"
  ) {
    throw new Error("T42_CLI_OUTPUT_MUST_BE_MIXED_RETRIEVAL_JSON");
  }
  const runtimeStats = await lstat(runtimeRoot);
  if (runtimeStats.isSymbolicLink() || !runtimeStats.isDirectory()) {
    throw new Error("T42_CLI_RUNTIME_ROOT_INVALID");
  }
  if (
    canonicalPath(await realpath(runtimeRoot))
    !== canonicalPath(runtimeRoot)
  ) {
    throw new Error("T42_CLI_RUNTIME_ROOT_IDENTITY_DRIFT");
  }
  await assertT42OutputParentsAreLocal(runtimeRoot, output);
  try {
    await lstat(output);
    throw new Error("T42_CLI_OUTPUT_ALREADY_EXISTS");
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

function runtimeOptions(
  workspaceRoot: string,
  parsed: ReturnType<typeof parseT42RecallArguments>,
  textObjectConsensusEnabled: boolean,
): LocalMixedRuntimeV2Options {
  const resolve = (value: string) => path.resolve(workspaceRoot, value);
  return {
    workspaceRoot,
    pythonExecutable: resolve(parsed.pythonExecutable),
    textModelDir: resolve(parsed.textModelDir),
    textModelSeal: resolve(parsed.textModelSeal),
    textIndexDir: resolve(parsed.textIndexDir),
    visualModelDir: resolve(parsed.visualModelDir),
    visualModelSeal: resolve(parsed.visualModelSeal),
    visualIndexDir: resolve(parsed.visualIndexDir),
    visualOffloadDir: resolve(parsed.visualOffloadDir),
    controlDir: resolve(parsed.controlDir),
    assetManifestPath: resolve(
      "data/manifests/course-png-sha256.v1.json",
    ),
    device: parsed.device,
    gpuMemoryGiB: parsed.gpuMemoryGiB,
    timeoutMs: parsed.timeoutMs,
    visualMaxCacheEntries: 64,
    textObjectConsensusEnabled,
  };
}

type T42ProviderSpy = ReturnType<LocalMixedRuntimeV2["providerSpy"]>;

type T42ExpectedProviderRoute = {
  runtimeQuerySha256: string;
  expectedChannels: readonly ("LEXICAL" | "TEXT_VECTOR")[];
};

export function auditT42ProviderInvocationsV2(
  spy: T42ProviderSpy,
  expectedRoutes: readonly T42ExpectedProviderRoute[],
) {
  const byQuery = new Map<string, string[]>();
  for (const entry of spy.entries) {
    const channels = byQuery.get(entry.queryFingerprint) ?? [];
    channels.push(entry.channel);
    byQuery.set(entry.queryFingerprint, channels);
  }
  const expectedByQuery = new Map(
    expectedRoutes.map(({ runtimeQuerySha256, expectedChannels }) => [
      runtimeQuerySha256,
      [...expectedChannels].sort(),
    ]),
  );
  const expectedCalls = expectedRoutes.reduce(
    (total, { expectedChannels }) => total + expectedChannels.length,
    0,
  );
  const violations: string[] = [];
  if (expectedByQuery.size !== expectedRoutes.length) {
    violations.push("runtime queries must have unique provider fingerprints");
  }
  if (spy.entryCount !== expectedCalls) {
    violations.push(
      `expected ${expectedCalls} provider calls, received ${spy.entryCount}`,
    );
  }
  for (const [fingerprint, expectedChannels] of expectedByQuery) {
    const channels = byQuery.get(fingerprint) ?? [];
    const ordered = [...channels].sort();
    if (
      ordered.length !== expectedChannels.length
      || ordered.some((channel, index) =>
        channel !== expectedChannels[index])
    ) {
      violations.push(
        `${fingerprint}: expected [${expectedChannels.join(",")}], received [${ordered.join(",")}]`,
      );
    }
  }
  for (const fingerprint of byQuery.keys()) {
    if (!expectedByQuery.has(fingerprint)) {
      violations.push(`${fingerprint}: unexpected provider query`);
    }
  }
  const expectedQueriedCount = expectedRoutes.filter(
    ({ expectedChannels }) => expectedChannels.length > 0,
  ).length;
  const preRetrievalSkippedQueries =
    expectedRoutes.length - expectedQueriedCount;
  return {
    passed: violations.length === 0,
    expectedCalls,
    observedCalls: spy.entryCount,
    uniqueQueries: byQuery.size,
    expectedQueriedCount,
    preRetrievalSkippedQueries,
    visualCalls: spy.entries.filter(
      ({ channel }) => channel === "VISUAL_VECTOR",
    ).length,
    violations,
  };
}

async function runArm(input: {
  arm: T42RecallArm;
  workspaceRoot: string;
  parsed: ReturnType<typeof parseT42RecallArguments>;
  loadedSuite: ReturnType<typeof loadT42RecallSuite>;
}) {
  let runtime: LocalMixedRuntimeV2 | null = null;
  const evidenceAudits: Array<{
    runtimeQuerySha256: string;
    status: string;
    primaryObjectIds: string[];
    primaryNodeIds: string[];
    objectRanking: Array<{
      objectId: string;
      rank: number;
      selectedNodeId: string | null;
    }> | null;
    consensusCandidates: Array<{
      objectId: string;
      selectedNodeId: string;
      source: string;
    }> | null;
    expectedProviderChannels: ("LEXICAL" | "TEXT_VECTOR")[];
  }> = [];
  try {
    runtime = await createLocalMixedRuntimeV2(runtimeOptions(
      input.workspaceRoot,
      input.parsed,
      input.arm === "B_OBJECT_CONSENSUS",
    ));
    const report = await evaluateT42Recall({
      loadedSuite: input.loadedSuite,
      arm: input.arm,
      provider: {
        retrieve: async (query) => {
          const bundle = await runtime!.retrieve(query);
          const preRetrievalRejected =
            bundle.provenance.externalVerification.required
            && !bundle.provenance.externalVerification.authorized;
          evidenceAudits.push({
            runtimeQuerySha256:
              assertMixedRuntimeQueryAllowlistV2(query).fingerprint,
            status: bundle.status,
            primaryObjectIds: bundle.evidence.primary.map(
              ({ objectId }) => objectId,
            ),
            primaryNodeIds: bundle.evidence.nodes
              .filter(({ relation }) => relation === "PRIMARY")
              .map(({ nodeId }) => nodeId),
            objectRanking:
              bundle.evidence.objectConsensus?.objectRanking.map(
                ({ objectId, rank, selectedNodeId }) => ({
                  objectId,
                  rank,
                  selectedNodeId,
                }),
              ) ?? null,
            consensusCandidates:
              bundle.evidence.objectConsensus?.candidates.map(
                ({ objectId, selectedNodeId, source }) => ({
                  objectId,
                  selectedNodeId,
                  source,
                }),
              ) ?? null,
            expectedProviderChannels: preRetrievalRejected
              ? []
              : ["LEXICAL", "TEXT_VECTOR"],
          });
          return bundle;
        },
      },
    });
    const calls = auditT42ProviderInvocationsV2(
      runtime.providerSpy(),
      evidenceAudits.map(
        ({ runtimeQuerySha256, expectedProviderChannels }) => ({
          runtimeQuerySha256,
          expectedChannels: expectedProviderChannels,
        }),
      ),
    );
    const identity = {
      candidate: runtime.t41CandidateIdentity,
      environment: runtime.runtimeEnvironment,
    };
    return {
      report,
      invocationAudit: calls,
      identity,
      identitySha256: sha256StableJsonV2(identity),
      evidenceAudits,
    };
  } finally {
    await runtime?.dispose();
  }
}

function comparableIdentity(
  arm: Awaited<ReturnType<typeof runArm>>,
) {
  return {
    ...arm.identity,
    candidate: {
      ...arm.identity.candidate,
      rrfConfigHash: null,
    },
  };
}

async function writeJsonAtomically(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function runT42RecallCli(
  argv = process.argv.slice(2),
  workspaceRoot = process.cwd(),
) {
  const root = path.resolve(workspaceRoot);
  const parsed = parseT42RecallArguments(argv);
  const outputPath = await resolveT42OutputPath(root, parsed.output);
  const suitePath = path.resolve(root, SUITE_PATH);
  if (canonicalPath(await realpath(suitePath)) !== canonicalPath(suitePath)) {
    throw new Error("T42_CLI_SUITE_PATH_IDENTITY_DRIFT");
  }
  const [suiteBytes, corpusBytes] = await Promise.all([
    readFile(suitePath),
    readFile(path.resolve(root, CORPUS_PATH)),
  ]);
  const loadedSuite = loadT42RecallSuite(suiteBytes);
  const corpus = verifyKnowledgeCorpusBundleV2(
    JSON.parse(corpusBytes.toString("utf8")) as unknown,
  );
  if (corpus.bundleHash !== loadedSuite.suite.corpusSnapshot.bundleHash) {
    throw new Error("T42_CLI_SUITE_CORPUS_IDENTITY_MISMATCH");
  }
  process.stderr.write(
    `[mixed:t42] source=LOCAL_MIXED_RUNTIME_V2 split=DEV ` +
      `device=${parsed.device} model=BAAI/bge-small-zh-v1.5\n`,
  );

  const a0 = await runArm({
    arm: "A0_EXACT_NODE",
    workspaceRoot: root,
    parsed,
    loadedSuite,
  });
  const b = await runArm({
    arm: "B_OBJECT_CONSENSUS",
    workspaceRoot: root,
    parsed,
    loadedSuite,
  });
  const nonRrfIdentityEqual =
    sha256StableJsonV2(comparableIdentity(a0))
    === sha256StableJsonV2(comparableIdentity(b));
  const rrfIdentityDistinct =
    a0.identity.candidate.rrfConfigHash
    !== b.identity.candidate.rrfConfigHash;
  const identityAudit = {
    passed: nonRrfIdentityEqual && rrfIdentityDistinct,
    nonRrfIdentityEqual,
    rrfIdentityDistinct,
    a0IdentitySha256: a0.identitySha256,
    bIdentitySha256: b.identitySha256,
    environmentSealEqual:
      a0.identity.environment.sealSha256
      === b.identity.environment.sealSha256,
  };
  const reportPassed =
    b.report.reportPassed
    && a0.report.gates.runtimeIntegrityPassed
    && a0.invocationAudit.passed
    && b.invocationAudit.passed
    && identityAudit.passed;
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    reportPassed,
    suite: b.report.suite,
    arms: {
      A0_EXACT_NODE: a0,
      B_OBJECT_CONSENSUS: b,
    },
    comparison: {
      answerablePrimaryObjectHits: {
        a0: a0.report.aggregates.overall.primaryObjectHit.passed,
        b: b.report.aggregates.overall.primaryObjectHit.passed,
      },
      answerableRequiredEvidenceCoverage: {
        a0:
          a0.report.aggregates.overall.requiredEvidenceGroupsCovered.passed,
        b:
          b.report.aggregates.overall.requiredEvidenceGroupsCovered.passed,
      },
      noAnswerEmptyNoPrimary: {
        a0: a0.report.aggregates.overall.noAnswerEmptyNoPrimary.passed,
        b: b.report.aggregates.overall.noAnswerEmptyNoPrimary.passed,
      },
      bObjectRecallAt10:
        b.report.aggregates.overall.objectRecallAt10,
      latencyP95Ms: {
        a0: a0.report.aggregates.overall.latencyMs.p95,
        b: b.report.aggregates.overall.latencyMs.p95,
      },
    },
    identityAudit,
  };
  await writeJsonAtomically(outputPath, payload);
  const summary = {
    outputPath: path.relative(root, outputPath).replaceAll("\\", "/"),
    reportPassed,
    comparison: payload.comparison,
    bGates: b.report.gates,
    identityAudit,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!reportPassed) process.exitCode = 1;
  return payload;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  runT42RecallCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[mixed:t42] ${message}\n`);
    process.exitCode = 1;
  });
}

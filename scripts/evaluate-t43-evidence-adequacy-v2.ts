import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  realpath,
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
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  T4_FROZEN_CAPTION_BASELINE_SHA256,
  T4_FROZEN_T3_BASELINE_SHA256,
  T4_MIXED_GATE_VERSION,
  T4_MIXED_SUITE_SHA256,
  T4_MIXED_SUITE_VERSION,
  assertMixedSuiteContractV2,
  evaluateMixedRetrieverV2,
  readMixedBaselineReportV2,
} from "@/lib/knowledge/mixed-retrieval-evaluation-v2";
import {
  evaluateMixedFaultMatrixV2,
} from "@/lib/knowledge/mixed-retrieval-fault-evaluation-v2";
import {
  T41_ANSWERABILITY_EVALUATOR_VERSION,
  createT41EvidenceBundleProvider,
  evaluateT41Answerability,
} from "@/tools/mixed-retrieval/t41-answerability-evaluator";
import {
  loadT41AnswerabilitySuite,
} from "@/tools/mixed-retrieval/t41-answerability-loader";
import {
  T42_RECALL_EVALUATOR_VERSION,
  evaluateT42Recall,
} from "@/tools/mixed-retrieval/t42-recall-evaluator";
import {
  loadT42RecallSuite,
} from "@/tools/mixed-retrieval/t42-recall-loader";
import {
  T43_DEV_GATES_V1,
  evaluateT43EvidenceAdequacy,
  type T43ArmRuntimeIdentity,
  type T43EvidenceAdequacyArm,
  type T43ExpectedProviderRoute,
  type T43ImportGraphAudit,
  type T43ProviderInvocationAudit,
  type T43RuntimeProvider,
} from "@/tools/mixed-retrieval/t43-evidence-adequacy-evaluator";
import {
  loadT43EvidenceAdequacySuite,
} from "@/tools/mixed-retrieval/t43-evidence-adequacy-loader";

const SUITE_PATH =
  "tests/retrieval-quality/t43-evidence-adequacy-dev.json";
const CORPUS_PATH = "data/knowledge-v2/knowledge-corpus.v2.json";
const T41_VISIBLE_DEV_PATH =
  "tests/retrieval-quality/t41-answerability-dev.json";
const T42_VISIBLE_DEV_PATH =
  "tests/retrieval-quality/t42-recall-dev.json";
const LEGACY_VISIBLE_PATH =
  "tests/retrieval-quality/golden-suite.json";
const LEGACY_CAPTION_BASELINE_PATH =
  ".runtime/retrieval-quality/t0-caption-lexical-baseline.json";
const LEGACY_T3_BASELINE_PATH =
  ".runtime/visual-retrieval/retrieval-quality/t3-siglip2-expanded.json";
const ATTEMPT_LEDGER_PATH =
  ".runtime/mixed-retrieval/t43-attempt-ledger.jsonl";

export const T43_REGRESSION_EVALUATOR_VERSION =
  "2026-07-28.1";

const DEFAULT_RUNTIME_PATHS = Object.freeze({
  pythonExecutable:
    ".runtime/visual-retrieval/python312/python.exe",
  textModelDir:
    ".runtime/text-retrieval/hf/models--BAAI--bge-small-zh-v1.5/" +
    "snapshots/7999e1d3359715c523056ef9478215996d62a620",
  textModelSeal:
    ".runtime/text-retrieval/seals/bge-small-zh-v1.5.json",
  textIndexDir:
    ".runtime/text-retrieval/indexes/" +
    "b3119e9a942497f731d6c8ee063c00fe2793e859cf47d7cbaa6101a2771b1122",
  visualModelDir:
    ".runtime/visual-retrieval/hf/models--google--" +
    "siglip2-base-patch16-224/snapshots/" +
    "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
  visualModelSeal:
    ".runtime/visual-retrieval/seals/siglip2.json",
  visualIndexDir:
    ".runtime/visual-retrieval/indexes/siglip2/" +
    "1f2a354c755b498240108583d10ad5f0f5d2a3ad9c9f2cee2c3110d07f05125a",
  visualOffloadDir:
    ".runtime/visual-retrieval/offload",
  controlDir:
    ".runtime/knowledge-index/control/" +
    "cad61822cf3e4d95e984b08c66fa6427c5adf182fc305329291f8eb9aad1be5d",
} as const);

const VALUE_ARGUMENTS = new Set([
  "--output",
  "--split",
  "--regression",
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

const RegressionSchema = z.enum([
  "T41_DEV",
  "T42_DEV",
  "LEGACY_51",
]);

function required(values: ReadonlyMap<string, string>, key: string) {
  const value = values.get(key);
  if (!value) {
    throw new Error(`T43_CLI_REQUIRED_ARGUMENT_MISSING:${key}`);
  }
  return value;
}

export function parseT43EvidenceAdequacyArguments(
  argv: readonly string[],
) {
  const values = new Map<string, string>();
  let index = argv[0] === "--" ? 1 : 0;
  while (index < argv.length) {
    const argument = argv[index]!;
    if (!VALUE_ARGUMENTS.has(argument)) {
      throw new Error(`T43_CLI_UNKNOWN_ARGUMENT:${argument}`);
    }
    if (values.has(argument)) {
      throw new Error(`T43_CLI_DUPLICATE_ARGUMENT:${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value === "--" || value.startsWith("--")) {
      throw new Error(
        `T43_CLI_ARGUMENT_VALUE_MISSING:${argument}`,
      );
    }
    values.set(argument, value);
    index += 2;
  }
  const split = values.get("--split");
  const regression = values.get("--regression");
  if (split !== undefined && split !== "DEV") {
    throw new Error("T43_CLI_ONLY_VISIBLE_DEV_IS_AUTHORIZED");
  }
  if (split !== undefined && regression !== undefined) {
    throw new Error("T43_CLI_SPLIT_AND_REGRESSION_ARE_EXCLUSIVE");
  }
  const integer = (key: string, fallback: number) =>
    z.coerce.number().int().parse(values.get(key) ?? fallback);
  const number = (key: string, fallback: number) =>
    z.coerce.number().finite().parse(values.get(key) ?? fallback);
  return {
    output: required(values, "--output"),
    run:
      regression === undefined
        ? { kind: "DEV" as const, split: "DEV" as const }
        : {
            kind: "REGRESSION" as const,
            regression: RegressionSchema.parse(regression),
          },
    pythonExecutable:
      values.get("--python")
      ?? DEFAULT_RUNTIME_PATHS.pythonExecutable,
    textModelDir:
      values.get("--text-model-dir")
      ?? DEFAULT_RUNTIME_PATHS.textModelDir,
    textModelSeal:
      values.get("--text-model-seal")
      ?? DEFAULT_RUNTIME_PATHS.textModelSeal,
    textIndexDir:
      values.get("--text-index-dir")
      ?? DEFAULT_RUNTIME_PATHS.textIndexDir,
    visualModelDir:
      values.get("--visual-model-dir")
      ?? DEFAULT_RUNTIME_PATHS.visualModelDir,
    visualModelSeal:
      values.get("--visual-model-seal")
      ?? DEFAULT_RUNTIME_PATHS.visualModelSeal,
    visualIndexDir:
      values.get("--visual-index-dir")
      ?? DEFAULT_RUNTIME_PATHS.visualIndexDir,
    visualOffloadDir:
      values.get("--visual-offload-dir")
      ?? DEFAULT_RUNTIME_PATHS.visualOffloadDir,
    controlDir:
      values.get("--control-dir")
      ?? DEFAULT_RUNTIME_PATHS.controlDir,
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
  return process.platform === "win32"
    ? resolved.toLowerCase()
    : resolved;
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

async function assertOutputParentsAreLocal(
  runtimeRoot: string,
  output: string,
) {
  const realRuntimeRoot = await realpath(runtimeRoot);
  const relative = path.relative(runtimeRoot, path.dirname(output));
  const components = relative === ""
    ? []
    : relative.split(path.sep);
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
      throw new Error("T43_CLI_OUTPUT_PARENT_INVALID");
    }
    const realCurrent = await realpath(current);
    if (
      !isSameOrWithin(realRuntimeRoot, realCurrent)
      || canonicalPath(realCurrent) !== canonicalPath(current)
    ) {
      throw new Error("T43_CLI_OUTPUT_PARENT_IDENTITY_DRIFT");
    }
  }
}

export async function resolveT43OutputPath(
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
    throw new Error(
      "T43_CLI_OUTPUT_MUST_BE_MIXED_RETRIEVAL_JSON",
    );
  }
  const runtimeStats = await lstat(runtimeRoot);
  if (runtimeStats.isSymbolicLink() || !runtimeStats.isDirectory()) {
    throw new Error("T43_CLI_RUNTIME_ROOT_INVALID");
  }
  if (
    canonicalPath(await realpath(runtimeRoot))
      !== canonicalPath(runtimeRoot)
  ) {
    throw new Error("T43_CLI_RUNTIME_ROOT_IDENTITY_DRIFT");
  }
  await assertOutputParentsAreLocal(runtimeRoot, output);
  try {
    await lstat(output);
    throw new Error("T43_CLI_OUTPUT_ALREADY_EXISTS");
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

type ProviderSpy = ReturnType<LocalMixedRuntimeV2["providerSpy"]>;

export function auditT43ProviderInvocationsV2(
  spy: ProviderSpy,
  expectedRoutes: readonly T43ExpectedProviderRoute[],
): T43ProviderInvocationAudit {
  const byQuery = new Map<string, string[]>();
  for (const entry of spy.entries) {
    const channels = byQuery.get(entry.queryFingerprint) ?? [];
    channels.push(entry.channel);
    byQuery.set(entry.queryFingerprint, channels);
  }
  const expectedByQuery = new Map(
    expectedRoutes.map((route) => [
      route.runtimeQuerySha256,
      [...route.expectedChannels].sort(),
    ]),
  );
  const violations: string[] = [];
  if (expectedByQuery.size !== expectedRoutes.length) {
    violations.push("runtime query fingerprints must be unique");
  }
  const expectedCalls = expectedRoutes.reduce(
    (total, route) => total + route.expectedChannels.length,
    0,
  );
  if (spy.entryCount !== expectedCalls) {
    violations.push(
      `expected ${expectedCalls} calls, received ${spy.entryCount}`,
    );
  }
  let duplicateCallCount = 0;
  for (const [fingerprint, expectedChannels] of expectedByQuery) {
    const observed = [...(byQuery.get(fingerprint) ?? [])].sort();
    const channelCounts = new Map<string, number>();
    for (const channel of observed) {
      channelCounts.set(
        channel,
        (channelCounts.get(channel) ?? 0) + 1,
      );
    }
    duplicateCallCount += [...channelCounts.values()].reduce(
      (total, count) => total + Math.max(0, count - 1),
      0,
    );
    if (
      observed.length !== expectedChannels.length
      || observed.some(
        (channel, index) => channel !== expectedChannels[index],
      )
    ) {
      violations.push(
        `${fingerprint}: expected [${expectedChannels.join(",")}], ` +
        `received [${observed.join(",")}]`,
      );
    }
  }
  for (const fingerprint of byQuery.keys()) {
    if (!expectedByQuery.has(fingerprint)) {
      violations.push(`${fingerprint}: unexpected provider query`);
    }
  }
  const count = (channel: string) =>
    spy.entries.filter((entry) => entry.channel === channel).length;
  const known = new Set([
    "LEXICAL",
    "TEXT_VECTOR",
    "VISUAL_VECTOR",
    "CAPTION_LEXICAL",
  ]);
  const channelCounts = {
    lexical: count("LEXICAL"),
    textVector: count("TEXT_VECTOR"),
    visualVector: count("VISUAL_VECTOR"),
    captionLexical: count("CAPTION_LEXICAL"),
    unknown: spy.entries.filter(
      ({ channel }) => !known.has(channel),
    ).length,
  };
  if (
    channelCounts.visualVector !== 0
    || channelCounts.captionLexical !== 0
    || channelCounts.unknown !== 0
    || duplicateCallCount !== 0
  ) {
    violations.push(
      "visual/caption/unknown/duplicate provider calls must be zero",
    );
  }
  const expectedQueriedCount = expectedRoutes.filter(
    ({ expectedChannels }) => expectedChannels.length > 0,
  ).length;
  const observedQueriedCount = byQuery.size;
  const preRetrievalSkippedQueries =
    expectedRoutes.length - expectedQueriedCount;
  if (
    expectedCalls !== T43_DEV_GATES_V1.expectedProviderCallsPerArm
    || expectedQueriedCount
      !== T43_DEV_GATES_V1.expectedQueriedFingerprintsPerArm
    || preRetrievalSkippedQueries
      !== T43_DEV_GATES_V1.expectedPreRetrievalSkipsPerArm
  ) {
    violations.push(
      "scoring-side execution classes drifted from T43 gates",
    );
  }
  return {
    passed: violations.length === 0,
    expectedCalls,
    observedCalls: spy.entryCount,
    expectedQueriedCount,
    observedQueriedCount,
    preRetrievalSkippedQueries,
    channelCounts,
    duplicateCallCount,
    violations,
  };
}

function runtimeOptions(
  workspaceRoot: string,
  parsed: ReturnType<
    typeof parseT43EvidenceAdequacyArguments
  >,
  queryEvidenceAdequacyEnabled: boolean,
  overrides: {
    assetManifestPath?: string;
    visualMaxCacheEntries?: number;
  } = {},
) {
  const resolve = (value: string) =>
    path.resolve(workspaceRoot, value);
  const base: LocalMixedRuntimeV2Options = {
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
      overrides.assetManifestPath
      ?? "data/manifests/course-png-sha256.v1.json",
    ),
    device: parsed.device,
    gpuMemoryGiB: parsed.gpuMemoryGiB,
    timeoutMs: parsed.timeoutMs,
    visualMaxCacheEntries:
      overrides.visualMaxCacheEntries ?? 64,
    textObjectConsensusEnabled: true,
  };
  return {
    ...base,
    queryEvidenceAdequacyEnabled,
  } as LocalMixedRuntimeV2Options;
}

type RuntimeWithT43Identity = LocalMixedRuntimeV2;

function runtimeIdentity(
  runtime: RuntimeWithT43Identity,
): T43ArmRuntimeIdentity {
  const baseRuntimeIdentitySha256 = sha256StableJsonV2({
    candidate: runtime.t41CandidateIdentity,
    environment: runtime.runtimeEnvironment,
  });
  const adequacy = runtime.t43AdequacyIdentity();
  return {
    baseRuntimeIdentitySha256,
    queryEvidenceAdequacyEnabled:
      adequacy.queryEvidenceAdequacyEnabled,
    queryEvidenceAdequacyIdentity:
      adequacy.queryEvidenceAdequacyIdentity,
  };
}

function createArmProvider(input: {
  arm: T43EvidenceAdequacyArm;
  workspaceRoot: string;
  parsed: ReturnType<
    typeof parseT43EvidenceAdequacyArguments
  >;
}): T43RuntimeProvider {
  let runtime: RuntimeWithT43Identity | null = null;
  const enabled = input.arm === "C1_STRICT_ALL_OR_NOTHING";
  return {
    async start() {
      if (runtime) throw new Error("T43_RUNTIME_ALREADY_STARTED");
      runtime = await createLocalMixedRuntimeV2(runtimeOptions(
        input.workspaceRoot,
        input.parsed,
        enabled,
      ));
    },
    async retrieve(query) {
      if (!runtime) throw new Error("T43_RUNTIME_NOT_STARTED");
      return runtime.retrieve(query);
    },
    auditInvocations(expectedRoutes) {
      if (!runtime) throw new Error("T43_RUNTIME_NOT_STARTED");
      return auditT43ProviderInvocationsV2(
        runtime.providerSpy(),
        expectedRoutes,
      );
    },
    runtimeIdentity() {
      if (!runtime) throw new Error("T43_RUNTIME_NOT_STARTED");
      return runtimeIdentity(runtime);
    },
    async dispose() {
      const active = runtime;
      runtime = null;
      await active?.dispose();
    },
  };
}

type T43RegressionArm =
  | "A0_DISABLED"
  | "C1_STRICT_ALL_OR_NOTHING";

type T43ComparableOutcome = {
  caseId: string;
  pass: boolean;
  outcome: string;
  runtimeQuerySha256: string;
};

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sortedProviderEntries(spy: ProviderSpy) {
  return spy.entries
    .map((entry) => ({
      channel: entry.channel,
      queryFingerprint: entry.queryFingerprint,
      mode: entry.mode,
      coursePackId: entry.coursePackId,
    }))
    .sort((left, right) =>
      compareCodePoints(
        `${left.queryFingerprint}\u0000${left.channel}\u0000`
        + `${left.mode}\u0000${left.coursePackId ?? ""}`,
        `${right.queryFingerprint}\u0000${right.channel}\u0000`
        + `${right.mode}\u0000${right.coursePackId ?? ""}`,
      ),
    );
}

export function auditT43TextOnlyRegressionInvocationsV2(input: {
  spy: ProviderSpy;
  expectedCalls: number;
  expectedQueriedFingerprints: number;
  expectedRoutes?: readonly {
    runtimeQuerySha256: string;
    expectedChannels:
      readonly ("LEXICAL" | "TEXT_VECTOR")[];
  }[];
}) {
  const entries = sortedProviderEntries(input.spy);
  const byQuery = new Map<string, string[]>();
  for (const entry of entries) {
    const channels = byQuery.get(entry.queryFingerprint) ?? [];
    channels.push(entry.channel);
    byQuery.set(entry.queryFingerprint, channels);
  }
  const violations: string[] = [];
  const lexical = entries.filter(
    ({ channel }) => channel === "LEXICAL",
  ).length;
  const textVector = entries.filter(
    ({ channel }) => channel === "TEXT_VECTOR",
  ).length;
  const forbidden = entries.filter(
    ({ channel }) =>
      channel !== "LEXICAL" && channel !== "TEXT_VECTOR",
  ).length;
  const duplicateCalls = [...byQuery.values()].reduce(
    (total, channels) =>
      total + channels.length - new Set(channels).size,
    0,
  );
  if (input.spy.entryCount !== input.expectedCalls) {
    violations.push(
      `expected ${input.expectedCalls} calls, received `
      + `${input.spy.entryCount}`,
    );
  }
  if (byQuery.size !== input.expectedQueriedFingerprints) {
    violations.push(
      `expected ${input.expectedQueriedFingerprints} queried `
      + `fingerprints, received ${byQuery.size}`,
    );
  }
  if (
    lexical !== input.expectedQueriedFingerprints
    || textVector !== input.expectedQueriedFingerprints
    || forbidden !== 0
    || duplicateCalls !== 0
  ) {
    violations.push(
      "each queried fingerprint must have exactly one LEXICAL "
      + "and one TEXT_VECTOR call and no other calls",
    );
  }
  for (const [fingerprint, channels] of byQuery) {
    const ordered = [...channels].sort(compareCodePoints);
    if (
      ordered.length !== 2
      || ordered[0] !== "LEXICAL"
      || ordered[1] !== "TEXT_VECTOR"
    ) {
      violations.push(
        `${fingerprint}: received [${ordered.join(",")}]`,
      );
    }
  }
  if (input.expectedRoutes) {
    const expectedByQuery = new Map(
      input.expectedRoutes.map((route) => [
        route.runtimeQuerySha256,
        [...route.expectedChannels].sort(compareCodePoints),
      ]),
    );
    if (expectedByQuery.size !== input.expectedRoutes.length) {
      violations.push("expected runtime query fingerprints must be unique");
    }
    for (const [fingerprint, expected] of expectedByQuery) {
      const observed = [
        ...(byQuery.get(fingerprint) ?? []),
      ].sort(compareCodePoints);
      if (
        expected.length !== observed.length
        || expected.some(
          (channel, index) => channel !== observed[index],
        )
      ) {
        violations.push(
          `${fingerprint}: expected [${expected.join(",")}], `
          + `received [${observed.join(",")}]`,
        );
      }
    }
    for (const fingerprint of byQuery.keys()) {
      if (!expectedByQuery.has(fingerprint)) {
        violations.push(
          `${fingerprint}: unexpected provider query`,
        );
      }
    }
  }
  return {
    passed: violations.length === 0,
    expectedCalls: input.expectedCalls,
    observedCalls: input.spy.entryCount,
    expectedQueriedFingerprints:
      input.expectedQueriedFingerprints,
    observedQueriedFingerprints: byQuery.size,
    channelCounts: {
      lexical,
      textVector,
      forbidden,
    },
    duplicateCalls,
    entriesSha256: sha256StableJsonV2(entries),
    violations,
  };
}

export function compareT43RegressionOutcomesV2(
  a0Input: readonly T43ComparableOutcome[],
  c1Input: readonly T43ComparableOutcome[],
) {
  const canonical = (items: readonly T43ComparableOutcome[]) =>
    [...items]
      .map((item) => ({ ...item }))
      .sort((left, right) =>
        compareCodePoints(left.caseId, right.caseId),
      );
  const a0 = canonical(a0Input);
  const c1 = canonical(c1Input);
  const c1ByCase = new Map(
    c1.map((item) => [item.caseId, item]),
  );
  const a0ByCase = new Map(
    a0.map((item) => [item.caseId, item]),
  );
  const missingFromC1 = a0
    .filter(({ caseId }) => !c1ByCase.has(caseId))
    .map(({ caseId }) => caseId);
  const missingFromA0 = c1
    .filter(({ caseId }) => !a0ByCase.has(caseId))
    .map(({ caseId }) => caseId);
  const queryFingerprintMismatchCaseIds = a0
    .filter(({ caseId, runtimeQuerySha256 }) => {
      const other = c1ByCase.get(caseId);
      return other
        && other.runtimeQuerySha256 !== runtimeQuerySha256;
    })
    .map(({ caseId }) => caseId);
  const greenToRedCaseIds = a0
    .filter(({ caseId, pass }) =>
      pass && c1ByCase.get(caseId)?.pass === false,
    )
    .map(({ caseId }) => caseId);
  const changedOutcomeCaseIds = a0
    .filter(({ caseId, pass, outcome }) => {
      const other = c1ByCase.get(caseId);
      return other
        && (
          other.pass !== pass
          || other.outcome !== outcome
        );
    })
    .map(({ caseId }) => caseId);
  return {
    passed:
      missingFromC1.length === 0
      && missingFromA0.length === 0
      && queryFingerprintMismatchCaseIds.length === 0
      && greenToRedCaseIds.length === 0,
    a0OutcomeSha256: sha256StableJsonV2(a0),
    c1OutcomeSha256: sha256StableJsonV2(c1),
    missingFromC1,
    missingFromA0,
    queryFingerprintMismatchCaseIds,
    greenToRedCaseIds,
    changedOutcomeCaseIds,
  };
}

function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sourceIdentity(workspaceRoot: string) {
  const paths = [
    "lib/knowledge/query-evidence-adequacy-trace-v2.ts",
    "lib/knowledge/query-evidence-adequacy-v2.ts",
    "lib/knowledge/hybrid-retriever-v2.ts",
    "lib/knowledge/evidence-bundle-v2.ts",
    "lib/knowledge/mixed-retrieval-runtime-v2.ts",
    "lib/knowledge/mixed-retrieval-evaluation-v2.ts",
    "tools/mixed-retrieval/t43-evidence-adequacy-loader.ts",
    "tools/mixed-retrieval/t43-evidence-adequacy-evaluator.ts",
    "scripts/evaluate-t43-evidence-adequacy-v2.ts",
  ];
  const files = await Promise.all(paths.map(async (relativePath) => ({
    path: relativePath,
    sha256: sha256Bytes(
      await readFile(path.resolve(workspaceRoot, relativePath)),
    ),
  })));
  return {
    files,
    sha256: sha256StableJsonV2(files),
  };
}

export async function auditT43RuntimeImportGraphV2(
  workspaceRoot: string,
): Promise<T43ImportGraphAudit> {
  const auditedFiles = [
    "lib/knowledge/query-evidence-adequacy-trace-v2.ts",
    "lib/knowledge/query-evidence-adequacy-v2.ts",
    "lib/knowledge/hybrid-retriever-v2.ts",
    "lib/knowledge/evidence-bundle-v2.ts",
    "lib/knowledge/mixed-retrieval-runtime-v2.ts",
  ];
  const forbiddenTokens = [
    "tests/retrieval-quality",
    "t43-evidence-adequacy-loader",
    "t43-evidence-adequacy-evaluator",
    "evaluate-t43-evidence-adequacy-v2",
    "T43EvidenceAdequacyScoring",
    "T43EvidenceAdequacySuite",
  ];
  const violations: string[] = [];
  for (const relativePath of auditedFiles) {
    const source = await readFile(
      path.resolve(workspaceRoot, relativePath),
      "utf8",
    );
    for (const token of forbiddenTokens) {
      if (source.includes(token)) {
        violations.push(`${relativePath}:forbidden:${token}`);
      }
    }
  }
  return {
    passed: violations.length === 0,
    auditedFiles,
    forbiddenImportCount: violations.length,
    violations,
  };
}

function visiblePriorCases(input: {
  t41: Uint8Array;
  t42: Uint8Array;
  legacy: Uint8Array;
}) {
  const T41Schema = z.object({
    cases: z.array(z.object({
      id: z.string().min(1),
      familyId: z.string().min(1),
      question: z.string().min(1),
    }).passthrough()),
  }).passthrough();
  const T42Schema = z.object({
    cases: z.array(z.object({
      id: z.string().min(1),
      familyId: z.string().min(1),
      clusterId: z.string().min(1),
      runtime: z.object({
        question: z.string().min(1),
      }).passthrough(),
    }).passthrough()),
  }).passthrough();
  const LegacySchema = z.object({
    cases: z.array(z.object({
      id: z.string().min(1),
      query: z.object({
        text: z.string().min(1).optional(),
      }).passthrough(),
    }).passthrough()),
  }).passthrough();
  const parseBytes = (bytes: Uint8Array) => JSON.parse(
    Buffer.from(bytes).toString("utf8"),
  ) as unknown;
  const t41 = T41Schema.parse(parseBytes(input.t41)).cases.map(
    (testCase) => ({
      caseId: testCase.id,
      familyId: testCase.familyId,
      clusterId: null,
      question: testCase.question,
    }),
  );
  const t42 = T42Schema.parse(parseBytes(input.t42)).cases.map(
    (testCase) => ({
      caseId: testCase.id,
      familyId: testCase.familyId,
      clusterId: testCase.clusterId,
      question: testCase.runtime.question,
    }),
  );
  const legacy = LegacySchema.parse(parseBytes(input.legacy)).cases.map(
    (testCase) => ({
      caseId: testCase.id,
      familyId: null,
      clusterId: null,
      question: testCase.query.text ?? null,
    }),
  );
  return [...t41, ...t42, ...legacy];
}

async function writeJsonExclusive(
  filePath: string,
  value: unknown,
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  await writeFile(filePath, bytes, {
    flag: "wx",
  });
  return {
    byteLength: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  };
}

async function appendAttemptLedger(
  workspaceRoot: string,
  entry: unknown,
) {
  const ledgerPath = path.resolve(
    workspaceRoot,
    ATTEMPT_LEDGER_PATH,
  );
  await assertOutputParentsAreLocal(
    path.resolve(workspaceRoot, ".runtime"),
    ledgerPath,
  );
  try {
    const stats = await lstat(ledgerPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("T43_CLI_LEDGER_INVALID");
    }
    if (
      !isWithin(
        path.resolve(workspaceRoot, ".runtime"),
        await realpath(ledgerPath),
      )
    ) {
      throw new Error("T43_CLI_LEDGER_IDENTITY_DRIFT");
    }
  } catch (error) {
    if (
      !(
        error instanceof Error
        && "code" in error
        && error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  }
  await appendFile(
    ledgerPath,
    `${JSON.stringify(entry)}\n`,
    {
      encoding: "utf8",
      flag: "a",
    },
  );
}

async function readAttemptLedger(workspaceRoot: string) {
  const ledgerPath = path.resolve(
    workspaceRoot,
    ATTEMPT_LEDGER_PATH,
  );
  try {
    const stats = await lstat(ledgerPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("T43_CLI_LEDGER_INVALID");
    }
    const text = await readFile(ledgerPath, "utf8");
    return text
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch (error) {
          throw new Error(
            `T43_CLI_LEDGER_LINE_INVALID:${index + 1}`,
            { cause: error },
          );
        }
      });
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

async function assertNoExposedDevAttempt(input: {
  workspaceRoot: string;
  suiteSha256: string;
}) {
  const entries = await readAttemptLedger(input.workspaceRoot);
  const exposed = entries.find((entry) =>
    (
      entry.run
      && typeof entry.run === "object"
      && (entry.run as { kind?: unknown }).kind === "DEV"
    )
    && entry.suiteSha256 === input.suiteSha256
    && (
      entry.resultExposed === true
      || (
        typeof entry.scoredCaseCount === "number"
        && entry.scoredCaseCount > 0
      )
    ));
  if (exposed) {
    throw new Error("T43_CLI_DEV_RESULT_ALREADY_EXPOSED");
  }
}

async function runT41RegressionArm(input: {
  arm: T43RegressionArm;
  workspaceRoot: string;
  parsed: ReturnType<
    typeof parseT43EvidenceAdequacyArguments
  >;
  loadedSuite: ReturnType<typeof loadT41AnswerabilitySuite>;
  corpusBundleHash: string;
}) {
  const runtime = await createLocalMixedRuntimeV2(runtimeOptions(
    input.workspaceRoot,
    input.parsed,
    input.arm === "C1_STRICT_ALL_OR_NOTHING",
  ));
  try {
    const report = await evaluateT41Answerability({
      loadedSuite: input.loadedSuite,
      corpusBundleHash: input.corpusBundleHash,
      provider: createT41EvidenceBundleProvider(
        (query) => runtime.retrieve(query),
        runtime.expectedIdentity.channels,
      ),
    });
    const categoryByCase = new Map(
      input.loadedSuite.suite.cases.map((testCase) => [
        testCase.id,
        testCase.category,
      ]),
    );
    const invocationAudit =
      auditT43TextOnlyRegressionInvocationsV2({
        spy: runtime.providerSpy(),
        expectedCalls: 100,
        expectedQueriedFingerprints: 50,
        expectedRoutes: report.cases.map((testCase) => ({
          runtimeQuerySha256: testCase.runtimeQuerySha256,
          expectedChannels:
            categoryByCase.get(testCase.caseId)
              === "EXTERNAL_VERIFICATION_REQUIRED"
              ? []
              : ["LEXICAL", "TEXT_VECTOR"],
        })),
      });
    const outcomes = report.cases.map((testCase) => ({
      caseId: testCase.caseId,
      pass: testCase.pass,
      outcome: testCase.outcome,
      runtimeQuerySha256: testCase.runtimeQuerySha256,
    }));
    const originalGateCount = report.gates.results.length;
    const originalGatePassed = report.gates.results.filter(
      ({ passed }) => passed,
    ).length;
    const checks = [
      {
        id: "original-gates",
        observed: `${originalGatePassed}/${originalGateCount}`,
        required: "17/17",
        passed:
          originalGateCount === 17
          && originalGatePassed === 17,
      },
      {
        id: "answerable",
        observed: report.aggregates.overall.answerable.passed,
        required: "20/20",
        passed:
          report.aggregates.overall.answerable.total === 20
          && report.aggregates.overall.answerable.passed === 20,
      },
      {
        id: "no-answer",
        observed: report.aggregates.overall.noAnswer.passed,
        required: ">=36/40",
        passed:
          report.aggregates.overall.noAnswer.total === 40
          && report.aggregates.overall.noAnswer.passed >= 36,
      },
      {
        id: "provider-calls",
        observed: invocationAudit.observedCalls,
        required: "100/100 exact",
        passed: invocationAudit.passed,
      },
      {
        id: "runtime-integrity",
        observed: report.gates.runtimeIntegrityPassed,
        required: true,
        passed:
          report.gates.runtimeIntegrityPassed
          && report.leakageAudit.passed,
      },
    ];
    return {
      arm: input.arm,
      reportPassed: checks.every(({ passed }) => passed),
      evaluatorVersion: report.evaluatorVersion,
      suite: report.suite,
      runtimeIdentity: runtimeIdentity(runtime),
      invocationAudit,
      metrics: {
        originalGates: {
          passed: originalGatePassed,
          total: originalGateCount,
        },
        answerable: report.aggregates.overall.answerable,
        noAnswer: report.aggregates.overall.noAnswer,
      },
      checks,
      outcomeSha256: sha256StableJsonV2(outcomes),
      cases: outcomes,
    };
  } finally {
    await runtime.dispose();
  }
}

async function runT41Regression(input: {
  workspaceRoot: string;
  parsed: ReturnType<
    typeof parseT43EvidenceAdequacyArguments
  >;
  generatedAt: string;
}) {
  const [suiteBytes, corpusBytes] = await Promise.all([
    readFile(path.resolve(
      input.workspaceRoot,
      T41_VISIBLE_DEV_PATH,
    )),
    readFile(path.resolve(input.workspaceRoot, CORPUS_PATH)),
  ]);
  const loadedSuite = loadT41AnswerabilitySuite(
    suiteBytes,
    { expectedSplit: "DEV" },
  );
  const corpus = verifyKnowledgeCorpusBundleV2(
    JSON.parse(corpusBytes.toString("utf8")) as unknown,
  );
  const a0 = await runT41RegressionArm({
    arm: "A0_DISABLED",
    workspaceRoot: input.workspaceRoot,
    parsed: input.parsed,
    loadedSuite,
    corpusBundleHash: corpus.bundleHash,
  });
  const c1 = await runT41RegressionArm({
    arm: "C1_STRICT_ALL_OR_NOTHING",
    workspaceRoot: input.workspaceRoot,
    parsed: input.parsed,
    loadedSuite,
    corpusBundleHash: corpus.bundleHash,
  });
  const outcomeComparison = compareT43RegressionOutcomesV2(
    a0.cases,
    c1.cases,
  );
  const baseRuntimeIdentityEqual =
    a0.runtimeIdentity.baseRuntimeIdentitySha256
    === c1.runtimeIdentity.baseRuntimeIdentitySha256;
  const providerRouteParity =
    a0.invocationAudit.entriesSha256
    === c1.invocationAudit.entriesSha256;
  const armIdentityValid =
    !a0.runtimeIdentity.queryEvidenceAdequacyEnabled
    && a0.runtimeIdentity.queryEvidenceAdequacyIdentity === null
    && c1.runtimeIdentity.queryEvidenceAdequacyEnabled
    && c1.runtimeIdentity.queryEvidenceAdequacyIdentity !== null;
  const comparison = {
    ...outcomeComparison,
    baseRuntimeIdentityEqual,
    providerRouteParity,
    armIdentityValid,
    passed:
      outcomeComparison.passed
      && baseRuntimeIdentityEqual
      && providerRouteParity
      && armIdentityValid,
  };
  return {
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    evaluator: "T43_REGRESSION_HARNESS_V2" as const,
    evaluatorVersion: T43_REGRESSION_EVALUATOR_VERSION,
    regression: "T41_DEV" as const,
    promotionContribution: false as const,
    reportPassed:
      a0.reportPassed && c1.reportPassed && comparison.passed,
    suite: {
      id: "T41-ANSWERABILITY-DEV",
      version: loadedSuite.suite.suiteVersion,
      sha256: loadedSuite.suiteSha256,
      byteLength: loadedSuite.byteLength,
    },
    boundEvaluatorVersion: T41_ANSWERABILITY_EVALUATOR_VERSION,
    gateContract: {
      originalGates: "17/17",
      answerable: "20/20",
      noAnswer: ">=36/40",
      providerCalls: "100/100 exact",
      historicalGreenToRed: 0,
    },
    arms: {
      A0_DISABLED: a0,
      C1_STRICT_ALL_OR_NOTHING: c1,
    },
    comparison,
  };
}

async function runT42RegressionArm(input: {
  arm: T43RegressionArm;
  workspaceRoot: string;
  parsed: ReturnType<
    typeof parseT43EvidenceAdequacyArguments
  >;
  loadedSuite: ReturnType<typeof loadT42RecallSuite>;
}) {
  const runtime = await createLocalMixedRuntimeV2(runtimeOptions(
    input.workspaceRoot,
    input.parsed,
    input.arm === "C1_STRICT_ALL_OR_NOTHING",
  ));
  try {
    const report = await evaluateT42Recall({
      loadedSuite: input.loadedSuite,
      arm: "B_OBJECT_CONSENSUS",
      provider: {
        retrieve: (query) => runtime.retrieve(query),
      },
    });
    const invocationAudit =
      auditT43TextOnlyRegressionInvocationsV2({
        spy: runtime.providerSpy(),
        expectedCalls: 72,
        expectedQueriedFingerprints: 36,
      });
    const outcomes = report.cases.map((testCase) => ({
      caseId: testCase.caseId,
      pass: testCase.pass,
      outcome: testCase.outcome,
      runtimeQuerySha256: testCase.runtimeQuerySha256,
    }));
    const overall = report.aggregates.overall;
    const checks = [
      {
        id: "object-recall-at-10",
        observed: overall.objectRecallAt10.passed,
        required: ">=23/25",
        passed:
          overall.objectRecallAt10.eligible === 25
          && overall.objectRecallAt10.passed >= 23,
      },
      {
        id: "primary-object",
        observed: overall.primaryObjectHit.passed,
        required: ">=20/25",
        passed:
          overall.primaryObjectHit.eligible === 25
          && overall.primaryObjectHit.passed >= 20,
      },
      {
        id: "required-evidence",
        observed: overall.requiredEvidenceGroupsCovered.passed,
        required: ">=16/25",
        passed:
          overall.requiredEvidenceGroupsCovered.eligible === 25
          && overall.requiredEvidenceGroupsCovered.passed >= 16,
      },
      {
        id: "no-answer",
        observed: overall.noAnswerEmptyNoPrimary.passed,
        required: ">=8/15",
        passed:
          overall.noAnswerEmptyNoPrimary.eligible === 15
          && overall.noAnswerEmptyNoPrimary.passed >= 8,
      },
      {
        id: "provider-calls",
        observed: invocationAudit.observedCalls,
        required: "72/72 exact",
        passed: invocationAudit.passed,
      },
      {
        id: "runtime-integrity",
        observed: report.gates.runtimeIntegrityPassed,
        required: true,
        passed:
          report.gates.runtimeIntegrityPassed
          && report.leakageAudit.passed,
      },
    ];
    return {
      arm: input.arm,
      reportPassed: checks.every(({ passed }) => passed),
      evaluatorVersion: report.evaluatorVersion,
      suite: report.suite,
      runtimeIdentity: runtimeIdentity(runtime),
      invocationAudit,
      metrics: {
        objectRecallAt10: overall.objectRecallAt10,
        primaryObjectHit: overall.primaryObjectHit,
        requiredEvidenceGroupsCovered:
          overall.requiredEvidenceGroupsCovered,
        noAnswerEmptyNoPrimary:
          overall.noAnswerEmptyNoPrimary,
      },
      checks,
      outcomeSha256: sha256StableJsonV2(outcomes),
      objectRankingByCaseSha256: sha256StableJsonV2(
        report.cases.map((testCase) => ({
          caseId: testCase.caseId,
          objectRankingSha256: testCase.objectRankingSha256,
        })),
      ),
      cases: outcomes,
    };
  } finally {
    await runtime.dispose();
  }
}

async function runT42Regression(input: {
  workspaceRoot: string;
  parsed: ReturnType<
    typeof parseT43EvidenceAdequacyArguments
  >;
  generatedAt: string;
}) {
  const [suiteBytes, corpusBytes] = await Promise.all([
    readFile(path.resolve(
      input.workspaceRoot,
      T42_VISIBLE_DEV_PATH,
    )),
    readFile(path.resolve(input.workspaceRoot, CORPUS_PATH)),
  ]);
  const loadedSuite = loadT42RecallSuite(suiteBytes);
  const corpus = verifyKnowledgeCorpusBundleV2(
    JSON.parse(corpusBytes.toString("utf8")) as unknown,
  );
  if (
    corpus.bundleHash
    !== loadedSuite.suite.corpusSnapshot.bundleHash
  ) {
    throw new Error("T43_T42_REGRESSION_CORPUS_IDENTITY_MISMATCH");
  }
  const a0 = await runT42RegressionArm({
    arm: "A0_DISABLED",
    workspaceRoot: input.workspaceRoot,
    parsed: input.parsed,
    loadedSuite,
  });
  const c1 = await runT42RegressionArm({
    arm: "C1_STRICT_ALL_OR_NOTHING",
    workspaceRoot: input.workspaceRoot,
    parsed: input.parsed,
    loadedSuite,
  });
  const outcomeComparison = compareT43RegressionOutcomesV2(
    a0.cases,
    c1.cases,
  );
  const baseRuntimeIdentityEqual =
    a0.runtimeIdentity.baseRuntimeIdentitySha256
    === c1.runtimeIdentity.baseRuntimeIdentitySha256;
  const providerRouteParity =
    a0.invocationAudit.entriesSha256
    === c1.invocationAudit.entriesSha256;
  const objectRankingParity =
    a0.objectRankingByCaseSha256
    === c1.objectRankingByCaseSha256;
  const armIdentityValid =
    !a0.runtimeIdentity.queryEvidenceAdequacyEnabled
    && a0.runtimeIdentity.queryEvidenceAdequacyIdentity === null
    && c1.runtimeIdentity.queryEvidenceAdequacyEnabled
    && c1.runtimeIdentity.queryEvidenceAdequacyIdentity !== null;
  const comparison = {
    ...outcomeComparison,
    baseRuntimeIdentityEqual,
    providerRouteParity,
    objectRankingParity,
    armIdentityValid,
    passed:
      outcomeComparison.passed
      && baseRuntimeIdentityEqual
      && providerRouteParity
      && objectRankingParity
      && armIdentityValid,
  };
  return {
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    evaluator: "T43_REGRESSION_HARNESS_V2" as const,
    evaluatorVersion: T43_REGRESSION_EVALUATOR_VERSION,
    regression: "T42_DEV" as const,
    promotionContribution: false as const,
    reportPassed:
      a0.reportPassed && c1.reportPassed && comparison.passed,
    suite: {
      id: loadedSuite.suite.suiteId,
      version: loadedSuite.suite.suiteVersion,
      sha256: loadedSuite.suiteSha256,
      byteLength: loadedSuite.byteLength,
    },
    boundEvaluatorVersion: T42_RECALL_EVALUATOR_VERSION,
    gateContract: {
      objectRecallAt10: ">=23/25",
      primaryObjectHit: ">=20/25",
      requiredEvidenceGroupsCovered: ">=16/25",
      noAnswerEmptyNoPrimary: ">=8/15",
      providerCalls: "72/72 exact",
      historicalGreenToRed: 0,
    },
    arms: {
      A0_DISABLED: a0,
      C1_STRICT_ALL_OR_NOTHING: c1,
    },
    comparison,
  };
}

function legacyCacheParity(
  primary: Awaited<ReturnType<typeof evaluateMixedRetrieverV2>>,
  cacheHit: Awaited<ReturnType<typeof evaluateMixedRetrieverV2>>,
) {
  const cacheByCase = new Map(
    cacheHit.cases.map((testCase) => [
      testCase.caseId,
      testCase.audit.resultFingerprint,
    ]),
  );
  const mismatchCaseIds = primary.cases
    .filter((testCase) =>
      cacheByCase.get(testCase.caseId)
      !== testCase.audit.resultFingerprint,
    )
    .map(({ caseId }) => caseId);
  return {
    caseCount: primary.cases.length,
    exactResultFingerprintParity:
      primary.cases.length - mismatchCaseIds.length,
    mismatchCaseIds,
    passed:
      primary.cases.length === 51
      && cacheHit.cases.length === 51
      && mismatchCaseIds.length === 0,
  };
}

function legacyCasePass(
  testCase: Awaited<
    ReturnType<typeof evaluateMixedRetrieverV2>
  >["cases"][number],
) {
  if (testCase.score.expectation === "NO_ANSWER") {
    return testCase.score.negativePass === true;
  }
  if (testCase.score.mode === "TEXT_TO_TEXT") {
    return (testCase.score.primaryMetrics?.recallAt5 ?? 0) > 0;
  }
  if (testCase.score.mode === "TEXT_TO_IMAGE") {
    return (testCase.audit.exactRoleRecallAt5 ?? 0) > 0;
  }
  if (testCase.score.mode === "IMAGE_TO_IMAGE") {
    return (testCase.audit.groupRecallAt5 ?? 0) > 0;
  }
  return testCase.score.combinedEvidencePass === true;
}

function legacyOutcomes(
  report: Awaited<ReturnType<typeof evaluateMixedRetrieverV2>>,
): T43ComparableOutcome[] {
  return report.cases.map((testCase) => {
    const { latencyMs: _latencyMs, ...score } = testCase.score;
    return {
      caseId: testCase.caseId,
      pass: legacyCasePass(testCase),
      outcome: sha256StableJsonV2({
        result: {
          status: testCase.result.status,
          channel: testCase.result.channel,
          hits: testCase.result.hits,
          parentLocators: testCase.result.parentLocators,
          degradedFrom: testCase.result.degradedFrom,
          degradationSucceeded:
            testCase.result.degradationSucceeded,
        },
        score,
      }),
      runtimeQuerySha256:
        sha256StableJsonV2(testCase.runtimeQuery),
    };
  });
}

async function runLegacyRegressionArm(input: {
  arm: T43RegressionArm;
  workspaceRoot: string;
  parsed: ReturnType<
    typeof parseT43EvidenceAdequacyArguments
  >;
  suiteBytes: Uint8Array;
  corpus: ReturnType<typeof verifyKnowledgeCorpusBundleV2>;
  captionBaseline: ReturnType<
    typeof readMixedBaselineReportV2
  >;
  t3Baseline: ReturnType<typeof readMixedBaselineReportV2>;
  assetManifestPath: string;
}) {
  const enabled = input.arm === "C1_STRICT_ALL_OR_NOTHING";
  let primaryRuntime: LocalMixedRuntimeV2 | null = null;
  let cacheRuntime: LocalMixedRuntimeV2 | null = null;
  try {
    primaryRuntime = await createLocalMixedRuntimeV2(runtimeOptions(
      input.workspaceRoot,
      input.parsed,
      enabled,
      {
        assetManifestPath: input.assetManifestPath,
        visualMaxCacheEntries: 0,
      },
    ));
    const primaryIdentity = runtimeIdentity(primaryRuntime);
    const primary = await evaluateMixedRetrieverV2({
      suiteBytes: input.suiteBytes,
      corpus: input.corpus,
      captionBaseline: input.captionBaseline,
      t3Baseline: input.t3Baseline,
      expectedIdentity: primaryRuntime.expectedIdentity,
      runtimeEvidence: primaryRuntime.runtimeEvidence(),
      cachePolicy: {
        mode: "CACHE_MISS",
        visualMaxCacheEntries: 0,
      },
      retrieve: (query) => primaryRuntime!.retrieve(query),
    });
    const faultMatrix = await evaluateMixedFaultMatrixV2({
      suiteBytes: input.suiteBytes,
      corpus: input.corpus,
      captionBaseline: input.captionBaseline,
      normalCases: primary.cases,
      retrieve: (query, fault) =>
        primaryRuntime!.retrieve(query, fault),
      diagnostics: () => primaryRuntime!.faultDiagnostics(),
    });
    const primaryProviderEntries =
      sortedProviderEntries(primaryRuntime.providerSpy());
    const primaryProviderTraceSha256 =
      sha256StableJsonV2(primaryProviderEntries);
    await primaryRuntime.dispose();
    primaryRuntime = null;

    cacheRuntime = await createLocalMixedRuntimeV2(runtimeOptions(
      input.workspaceRoot,
      input.parsed,
      enabled,
      {
        assetManifestPath: input.assetManifestPath,
        visualMaxCacheEntries: 256,
      },
    ));
    const cacheIdentity = runtimeIdentity(cacheRuntime);
    const cacheHit = await evaluateMixedRetrieverV2({
      suiteBytes: input.suiteBytes,
      corpus: input.corpus,
      captionBaseline: input.captionBaseline,
      t3Baseline: input.t3Baseline,
      expectedIdentity: cacheRuntime.expectedIdentity,
      runtimeEvidence: cacheRuntime.runtimeEvidence(),
      cachePolicy: {
        mode: "CACHE_HIT",
        visualMaxCacheEntries: 256,
        warmedBeforeMeasurement: true,
      },
      retrieve: (query) => cacheRuntime!.retrieve(query),
    });
    const cacheProviderEntries =
      sortedProviderEntries(cacheRuntime.providerSpy());
    const cacheProviderTraceSha256 =
      sha256StableJsonV2(cacheProviderEntries);
    const cacheParity = legacyCacheParity(primary, cacheHit);
    const normalGate = primary.gateEvaluation;
    const faultGate = faultMatrix.gateEvaluation;
    const violationCount = Object.values(primary.violations)
      .reduce((total, violations) =>
        total + violations.length, 0);
    const checks = [
      {
        id: "normal-gates",
        observed: `${normalGate.passed}/`
          + `${normalGate.passed + normalGate.failed}`,
        required: "48/48",
        passed:
          normalGate.overallPass
          && normalGate.passed === 48
          && normalGate.failed === 0,
      },
      {
        id: "fault-gates",
        observed: `${faultGate.passed}/`
          + `${faultGate.passed + faultGate.failed}`,
        required: "31/31",
        passed:
          faultGate.overallPass
          && faultGate.passed === 31
          && faultGate.failed === 0,
      },
      {
        id: "cache-parity",
        observed:
          `${cacheParity.exactResultFingerprintParity}/`
          + `${cacheParity.caseCount}`,
        required: "51/51",
        passed: cacheParity.passed,
      },
      {
        id: "violations",
        observed: violationCount,
        required: 0,
        passed: violationCount === 0,
      },
      {
        id: "runtime-identity",
        observed: {
          primary: primaryIdentity.baseRuntimeIdentitySha256,
          cache: cacheIdentity.baseRuntimeIdentitySha256,
        },
        required: "equal",
        passed:
          primaryIdentity.baseRuntimeIdentitySha256
          === cacheIdentity.baseRuntimeIdentitySha256
          && primaryIdentity.queryEvidenceAdequacyEnabled
          === cacheIdentity.queryEvidenceAdequacyEnabled,
      },
    ];
    const outcomes = legacyOutcomes(primary);
    return {
      arm: input.arm,
      reportPassed: checks.every(({ passed }) => passed),
      runtimeIdentity: primaryIdentity,
      cacheRuntimeIdentity: cacheIdentity,
      metrics: {
        normalGates: {
          passed: normalGate.passed,
          failed: normalGate.failed,
          total: normalGate.passed + normalGate.failed,
        },
        faultGates: {
          passed: faultGate.passed,
          failed: faultGate.failed,
          total: faultGate.passed + faultGate.failed,
        },
        cacheParity,
        violationCount,
      },
      checks,
      providerTrace: {
        primaryEntryCount: primaryProviderEntries.length,
        primarySha256: primaryProviderTraceSha256,
        cacheEntryCount: cacheProviderEntries.length,
        cacheSha256: cacheProviderTraceSha256,
      },
      outcomeSha256: sha256StableJsonV2(outcomes),
      cases: outcomes,
    };
  } finally {
    await Promise.allSettled([
      primaryRuntime?.dispose(),
      cacheRuntime?.dispose(),
    ]);
  }
}

async function runLegacyRegression(input: {
  workspaceRoot: string;
  parsed: ReturnType<
    typeof parseT43EvidenceAdequacyArguments
  >;
  generatedAt: string;
}) {
  const [
    suiteBytes,
    corpusBytes,
    captionBytes,
    t3Bytes,
  ] = await Promise.all([
    readFile(path.resolve(
      input.workspaceRoot,
      LEGACY_VISIBLE_PATH,
    )),
    readFile(path.resolve(input.workspaceRoot, CORPUS_PATH)),
    readFile(path.resolve(
      input.workspaceRoot,
      LEGACY_CAPTION_BASELINE_PATH,
    )),
    readFile(path.resolve(
      input.workspaceRoot,
      LEGACY_T3_BASELINE_PATH,
    )),
  ]);
  const captionSha256 = sha256Bytes(captionBytes);
  const t3Sha256 = sha256Bytes(t3Bytes);
  if (captionSha256 !== T4_FROZEN_CAPTION_BASELINE_SHA256) {
    throw new Error(
      `T43_LEGACY_CAPTION_BASELINE_HASH_MISMATCH:${captionSha256}`,
    );
  }
  if (t3Sha256 !== T4_FROZEN_T3_BASELINE_SHA256) {
    throw new Error(
      `T43_LEGACY_T3_BASELINE_HASH_MISMATCH:${t3Sha256}`,
    );
  }
  const suite = assertMixedSuiteContractV2(suiteBytes);
  const corpus = verifyKnowledgeCorpusBundleV2(
    JSON.parse(corpusBytes.toString("utf8")) as unknown,
  );
  const captionBaseline = readMixedBaselineReportV2(
    JSON.parse(captionBytes.toString("utf8")) as unknown,
    "CAPTION",
  );
  const t3Baseline = readMixedBaselineReportV2(
    JSON.parse(t3Bytes.toString("utf8")) as unknown,
    "T3",
  );
  const common = {
    workspaceRoot: input.workspaceRoot,
    parsed: input.parsed,
    suiteBytes,
    corpus,
    captionBaseline,
    t3Baseline,
    assetManifestPath: suite.corpusSnapshot.assetManifest,
  };
  const a0 = await runLegacyRegressionArm({
    ...common,
    arm: "A0_DISABLED",
  });
  const c1 = await runLegacyRegressionArm({
    ...common,
    arm: "C1_STRICT_ALL_OR_NOTHING",
  });
  const outcomeComparison = compareT43RegressionOutcomesV2(
    a0.cases,
    c1.cases,
  );
  const baseRuntimeIdentityEqual =
    a0.runtimeIdentity.baseRuntimeIdentitySha256
    === c1.runtimeIdentity.baseRuntimeIdentitySha256;
  const primaryProviderRouteParity =
    a0.providerTrace.primarySha256
    === c1.providerTrace.primarySha256
    && a0.providerTrace.primaryEntryCount
      === c1.providerTrace.primaryEntryCount;
  const cacheProviderRouteParity =
    a0.providerTrace.cacheSha256
    === c1.providerTrace.cacheSha256
    && a0.providerTrace.cacheEntryCount
      === c1.providerTrace.cacheEntryCount;
  const armIdentityValid =
    !a0.runtimeIdentity.queryEvidenceAdequacyEnabled
    && a0.runtimeIdentity.queryEvidenceAdequacyIdentity === null
    && c1.runtimeIdentity.queryEvidenceAdequacyEnabled
    && c1.runtimeIdentity.queryEvidenceAdequacyIdentity !== null;
  const comparison = {
    ...outcomeComparison,
    baseRuntimeIdentityEqual,
    primaryProviderRouteParity,
    cacheProviderRouteParity,
    armIdentityValid,
    passed:
      outcomeComparison.passed
      && baseRuntimeIdentityEqual
      && primaryProviderRouteParity
      && cacheProviderRouteParity
      && armIdentityValid,
  };
  return {
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    evaluator: "T43_REGRESSION_HARNESS_V2" as const,
    evaluatorVersion: T43_REGRESSION_EVALUATOR_VERSION,
    regression: "LEGACY_51" as const,
    promotionContribution: false as const,
    reportPassed:
      a0.reportPassed && c1.reportPassed && comparison.passed,
    suite: {
      id: "SELF_HOSTED_MIXED_RETRIEVAL_V2",
      version: T4_MIXED_SUITE_VERSION,
      sha256: T4_MIXED_SUITE_SHA256,
      byteLength: suiteBytes.byteLength,
    },
    boundEvaluatorVersion: T4_MIXED_GATE_VERSION,
    baselineIdentity: {
      captionSha256,
      t3Sha256,
    },
    gateContract: {
      normalGates: "48/48",
      faultGates: "31/31",
      cacheParity: "51/51",
      violations: 0,
    },
    arms: {
      A0_DISABLED: a0,
      C1_STRICT_ALL_OR_NOTHING: c1,
    },
    comparison,
  };
}

async function runT43Regression(input: {
  regression: "T41_DEV" | "T42_DEV" | "LEGACY_51";
  workspaceRoot: string;
  parsed: ReturnType<
    typeof parseT43EvidenceAdequacyArguments
  >;
  outputPath: string;
}) {
  const generatedAt = new Date().toISOString();
  process.stderr.write(
    "[mixed:t43] source=LOCAL_MIXED_RUNTIME_V2 "
    + `regression=${input.regression} `
    + `device=${input.parsed.device} `
    + "promotionContribution=false\n",
  );
  const report = input.regression === "T41_DEV"
    ? await runT41Regression({
        workspaceRoot: input.workspaceRoot,
        parsed: input.parsed,
        generatedAt,
      })
    : input.regression === "T42_DEV"
      ? await runT42Regression({
          workspaceRoot: input.workspaceRoot,
          parsed: input.parsed,
          generatedAt,
        })
      : await runLegacyRegression({
          workspaceRoot: input.workspaceRoot,
          parsed: input.parsed,
          generatedAt,
        });
  const source = await sourceIdentity(input.workspaceRoot);
  const payload = {
    ...report,
    sourceIdentity: source,
  };
  const written = await writeJsonExclusive(
    input.outputPath,
    payload,
  );
  const summary = {
    outputPath: path.relative(
      input.workspaceRoot,
      input.outputPath,
    ).replaceAll("\\", "/"),
    reportSha256: written.sha256,
    reportPassed: report.reportPassed,
    regression: input.regression,
    promotionContribution: false,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!report.reportPassed) process.exitCode = 1;
  return payload;
}

export async function runT43EvidenceAdequacyCli(
  argv = process.argv.slice(2),
  workspaceRoot = process.cwd(),
) {
  const root = path.resolve(workspaceRoot);
  const parsed = parseT43EvidenceAdequacyArguments(argv);
  const outputPath = await resolveT43OutputPath(
    root,
    parsed.output,
  );
  if (parsed.run.kind === "REGRESSION") {
    return runT43Regression({
      regression: parsed.run.regression,
      workspaceRoot: root,
      parsed,
      outputPath,
    });
  }
  const suitePath = path.resolve(root, SUITE_PATH);
  if (
    canonicalPath(await realpath(suitePath))
      !== canonicalPath(suitePath)
  ) {
    throw new Error("T43_CLI_SUITE_PATH_IDENTITY_DRIFT");
  }
  const [
    suiteBytes,
    corpusBytes,
    t41VisibleBytes,
    t42VisibleBytes,
    legacyVisibleBytes,
    source,
    importGraphAudit,
  ] = await Promise.all([
    readFile(suitePath),
    readFile(path.resolve(root, CORPUS_PATH)),
    readFile(path.resolve(root, T41_VISIBLE_DEV_PATH)),
    readFile(path.resolve(root, T42_VISIBLE_DEV_PATH)),
    readFile(path.resolve(root, LEGACY_VISIBLE_PATH)),
    sourceIdentity(root),
    auditT43RuntimeImportGraphV2(root),
  ]);
  const corpusInput = JSON.parse(
    corpusBytes.toString("utf8"),
  ) as unknown;
  const loadedSuite = loadT43EvidenceAdequacySuite(
    suiteBytes,
    corpusInput,
    visiblePriorCases({
      t41: t41VisibleBytes,
      t42: t42VisibleBytes,
      legacy: legacyVisibleBytes,
    }),
  );
  const attemptId = randomUUID();
  const generatedAt = new Date().toISOString();
  const config = {
    run: parsed.run,
    device: parsed.device,
    gpuMemoryGiB: parsed.gpuMemoryGiB,
    timeoutMs: parsed.timeoutMs,
    runtimePaths: {
      pythonExecutable: parsed.pythonExecutable,
      textModelDir: parsed.textModelDir,
      textModelSeal: parsed.textModelSeal,
      textIndexDir: parsed.textIndexDir,
      visualModelDir: parsed.visualModelDir,
      visualModelSeal: parsed.visualModelSeal,
      visualIndexDir: parsed.visualIndexDir,
      visualOffloadDir: parsed.visualOffloadDir,
      controlDir: parsed.controlDir,
    },
    gates: T43_DEV_GATES_V1,
  };
  const configSha256 = sha256StableJsonV2(config);
  await assertNoExposedDevAttempt({
    workspaceRoot: root,
    suiteSha256: loadedSuite.suiteSha256,
  });
  await appendAttemptLedger(root, {
    schemaVersion: 1,
    stage: "STARTED",
    attemptId,
    generatedAt,
    run: parsed.run,
    outputPath: path.relative(root, outputPath)
      .replaceAll("\\", "/"),
    sourceSha256: source.sha256,
    configSha256,
    suiteSha256: loadedSuite.suiteSha256,
    reportSha256: null,
    scoredCaseCount: 0,
    scoredCaseCountByArm: {
      A0_DISABLED: 0,
      C1_STRICT_ALL_OR_NOTHING: 0,
    },
    resultExposed: false,
  });
  process.stderr.write(
    "[mixed:t43] source=LOCAL_MIXED_RUNTIME_V2 split=DEV " +
    `device=${parsed.device} model=BAAI/bge-small-zh-v1.5 ` +
    "embedding=LOCAL_BGE lexical=LOCAL_CORPUS " +
    "visual=NOT_QUERIED\n",
  );

  let report;
  const scoredCaseCountByArm: Record<
    T43EvidenceAdequacyArm,
    number
  > = {
    A0_DISABLED: 0,
    C1_STRICT_ALL_OR_NOTHING: 0,
  };
  const totalScoredCaseCount = () =>
    Object.values(scoredCaseCountByArm).reduce(
      (total, count) => total + count,
      0,
    );
  try {
    report = await evaluateT43EvidenceAdequacy({
      loadedSuite,
      generatedAt,
      importGraphAudit,
      onCaseScored(progress) {
        scoredCaseCountByArm[progress.arm] =
          progress.scoredCaseCountInArm;
      },
      providers: {
        A0_DISABLED: createArmProvider({
          arm: "A0_DISABLED",
          workspaceRoot: root,
          parsed,
        }),
        C1_STRICT_ALL_OR_NOTHING: createArmProvider({
          arm: "C1_STRICT_ALL_OR_NOTHING",
          workspaceRoot: root,
          parsed,
        }),
      },
    });
  } catch (error) {
    await appendAttemptLedger(root, {
      schemaVersion: 1,
      stage: "INFRASTRUCTURE_FAILURE",
      attemptId,
      generatedAt: new Date().toISOString(),
      run: parsed.run,
      outputPath: path.relative(root, outputPath)
        .replaceAll("\\", "/"),
      sourceSha256: source.sha256,
      configSha256,
      suiteSha256: loadedSuite.suiteSha256,
      reportSha256: null,
      scoredCaseCount: totalScoredCaseCount(),
      scoredCaseCountByArm,
      resultExposed: false,
      errorClass:
        error instanceof Error ? error.name : "UNKNOWN",
    });
    throw error;
  }
  const payload = {
    ...report,
    attempt: {
      attemptId,
      sourceSha256: source.sha256,
      sourceFiles: source.files,
      configSha256,
      resultExposed: true,
      scoredCaseCount: totalScoredCaseCount(),
      scoredCaseCountByArm,
    },
  };
  let written;
  try {
    written = await writeJsonExclusive(outputPath, payload);
  } catch (error) {
    await appendAttemptLedger(root, {
      schemaVersion: 1,
      stage: "REPORT_PERSISTENCE_FAILURE",
      attemptId,
      generatedAt: new Date().toISOString(),
      run: parsed.run,
      outputPath: path.relative(root, outputPath)
        .replaceAll("\\", "/"),
      sourceSha256: source.sha256,
      configSha256,
      suiteSha256: loadedSuite.suiteSha256,
      reportSha256: null,
      scoredCaseCount: totalScoredCaseCount(),
      scoredCaseCountByArm,
      resultExposed: false,
      errorClass:
        error instanceof Error ? error.name : "UNKNOWN",
    });
    throw error;
  }
  await appendAttemptLedger(root, {
    schemaVersion: 1,
    stage: "COMPLETED",
    attemptId,
    generatedAt,
    run: parsed.run,
    outputPath: path.relative(root, outputPath)
      .replaceAll("\\", "/"),
    sourceSha256: source.sha256,
    configSha256,
    suiteSha256: loadedSuite.suiteSha256,
    reportSha256: written.sha256,
    reportByteLength: written.byteLength,
    scoredCaseCount: totalScoredCaseCount(),
    scoredCaseCountByArm,
    resultExposed: true,
    reportPassed: report.reportPassed,
  });
  const c1 = report.arms.C1_STRICT_ALL_OR_NOTHING;
  const summary = {
    outputPath: path.relative(root, outputPath).replaceAll("\\", "/"),
    reportSha256: written.sha256,
    reportPassed: report.reportPassed,
    metrics: {
      objectRecallAt10: c1.aggregates.overall.objectRecallAt10,
      answerableComplete: c1.aggregates.overall.answerableComplete,
      noAnswerEmpty: c1.aggregates.overall.noAnswerEmpty,
      pairJointPass: report.comparison.pairJointPass,
      byPack: Object.fromEntries(
        Object.entries(c1.aggregates.byPack).map(
          ([coursePackId, aggregate]) => [
            coursePackId,
            {
              answerableComplete:
                aggregate.answerableComplete,
              noAnswerEmpty: aggregate.noAnswerEmpty,
            },
          ],
        ),
      ),
      byStratum: Object.fromEntries(
        Object.entries(c1.aggregates.byStratum).map(
          ([stratum, aggregate]) => [
            stratum,
            aggregate.casePass,
          ],
        ),
      ),
    },
    comparison: report.comparison,
    sensitivity: report.sensitivity,
    importGraphAudit: report.importGraphAudit,
    gates: report.gates,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!report.reportPassed) process.exitCode = 1;
  return payload;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  runT43EvidenceAdequacyCli().catch((error) => {
    const message =
      error instanceof Error ? error.message : String(error);
    process.stderr.write(`[mixed:t43] ${message}\n`);
    process.exitCode = 1;
  });
}

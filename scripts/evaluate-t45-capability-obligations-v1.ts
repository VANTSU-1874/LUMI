import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  guardModelProviderSecretOutputs,
} from "@/lib/agent/evaluation-safety";
import {
  createOpenAICompatibleModelProvider,
} from "@/lib/agent/model-provider-adapter";
import { isGpt56ModelId } from "@/lib/ai/model-id";
import {
  readEnv,
  resolvePlannerModelConfiguration,
} from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
} from "@/lib/config/runtime-environment";
import {
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  QUERY_UNDERSTANDING_PLANNER_VERSION_V2,
  createQueryUnderstandingPlannerV1,
} from "@/lib/knowledge/query-understanding-planner-v1";
import {
  T44_CLAIM_MATRIX_CONFIG_HASH_V1,
  T44ClaimMatrixSidecarOutputV1Schema,
} from "@/tools/mixed-retrieval/t44-claim-matrix-contract-v1";
import {
  T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
  T44ObligationCandidateArtifactV1Schema,
  T44ObligationMatrixBridgeManifestV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
  T44ObligationSelectionArtifactV1Schema,
  buildT44BaselineProtectedObligationSelectionArtifactV2,
} from "@/tools/mixed-retrieval/t44-obligation-label-blind-v2";
import {
  T45_FROZEN_RUNTIME_BINDINGS_V1,
  collectObligationLabelBlindArtifactsV1,
  isolatedObligationPythonEnvironmentV1,
  loadT45RuntimePort,
  type T44LabelBlindArtifactsV1,
  type T45RuntimePort,
} from "@/tools/mixed-retrieval/t45-obligation-runtime-port";

const execFileAsync = promisify(execFile);
const RUN_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const HashSchema = z.string().regex(HASH_PATTERN);

const PATHS = Object.freeze({
  corpus:
    "data/knowledge-v2/knowledge-corpus.v2.json",
  python:
    ".runtime/visual-retrieval/python312/python.exe",
  matrixTool:
    "tools/reranker/t44_claim_matrix.py",
  textModelDir:
    ".runtime/text-retrieval/hf/models--BAAI--bge-small-zh-v1.5/"
    + "snapshots/7999e1d3359715c523056ef9478215996d62a620",
  textModelSeal:
    ".runtime/text-retrieval/seals/bge-small-zh-v1.5.json",
  textIndexDir:
    ".runtime/text-retrieval/indexes/"
    + "b3119e9a942497f731d6c8ee063c00fe2793e859cf47d7cbaa6101a2771b1122",
  artifactRoot: ".runtime/mixed-retrieval",
} as const);

export const T45_CAPABILITY_PLANNER_TIMEOUTS_V1 =
  Object.freeze({
    id: "t45-capability-planner-timeouts-v1",
    version: "1.0.0",
    idleTimeoutMs: 60_000,
    totalTimeoutMs: 110_000,
  } as const);

const MatrixPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T44_OBLIGATION_NODE_MATRICES",
    ),
    matrixBridgeManifestSha256: HashSchema,
    graphifyInvocationCount: z.literal(0),
    arms: z
      .object({
        A_WHOLE_QUERY: z
          .object({
            inputSha256: HashSchema,
            stderrBytes:
              z.number().int().nonnegative(),
            stderrSha256: HashSchema,
            output:
              T44ClaimMatrixSidecarOutputV1Schema,
          })
          .strict(),
        B_MODEL_GUIDED: z
          .object({
            inputSha256: HashSchema,
            stderrBytes:
              z.number().int().nonnegative(),
            stderrSha256: HashSchema,
            output:
              T44ClaimMatrixSidecarOutputV1Schema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

function sha256(value: string | Uint8Array) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function canonicalJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function parseT45CapabilityObligationsArguments(
  argv: readonly string[],
): {
  split: "CALIBRATION" | "VALIDATION";
  runId: string;
  device: "cuda" | "cpu";
} {
  const args = argv[0] === "--"
    ? argv.slice(1)
    : [...argv];
  const values = new Map<string, string>();
  const known = new Set([
    "--split",
    "--run-id",
    "--device",
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!;
    const value = args[index + 1];
    if (!known.has(key)) {
      throw new Error(
        `T45_CAPABILITY_OBLIGATION_CLI_UNKNOWN_ARGUMENT:${key}`,
      );
    }
    if (
      values.has(key)
      || !value
      || value.startsWith("--")
    ) {
      throw new Error(
        `T45_CAPABILITY_OBLIGATION_CLI_ARGUMENT_INVALID:${key}`,
      );
    }
    values.set(key, value);
  }
  if (
    values.size !== 3
    || args.length !== 6
  ) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_CLI_ARGUMENTS_INVALID",
    );
  }
  const rawSplit = values.get("--split");
  const split = rawSplit === "calibration"
    ? "CALIBRATION"
    : rawSplit === "validation"
      ? "VALIDATION"
      : null;
  if (!split) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_CLI_SPLIT_INVALID",
    );
  }
  const runId = values.get("--run-id");
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_CLI_RUN_ID_INVALID",
    );
  }
  if (
    split === "VALIDATION"
    && runId !== "validation-v1"
  ) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_CLI_VALIDATION_RUN_ID_LOCKED",
    );
  }
  if (
    split === "CALIBRATION"
    && !/^calibration-v[1-9][0-9]*$/.test(runId)
  ) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_CLI_CALIBRATION_RUN_ID_LOCKED",
    );
  }
  const device = values.get("--device");
  if (device !== "cuda" && device !== "cpu") {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_CLI_DEVICE_INVALID",
    );
  }
  return { split, runId, device };
}

export function formatT45ModelProvenanceNoticeV1(
  input: {
    modelId: string;
    endpointHash: string;
    configurationSource: "service-env";
  },
) {
  return {
    event:
      "t45-capability-model-provenance" as const,
    environmentMode: "SERVICE_REQUIRED" as const,
    modelId: z.string().trim().min(1).max(200)
      .parse(input.modelId),
    endpointHash:
      HashSchema.parse(input.endpointHash),
    configurationSource:
      z.literal("service-env").parse(
        input.configurationSource,
      ),
  };
}

export type T45SealedJsonArtifactV1 = {
  path: string;
  bytes: number;
  sha256: string;
};

async function writeNewT45SealedJsonArtifactV1(
  target: string,
  value: unknown,
): Promise<T45SealedJsonArtifactV1> {
  const resolved = path.resolve(target);
  const content = canonicalJson(value);
  await mkdir(path.dirname(resolved), {
    recursive: true,
  });
  try {
    await writeFile(resolved, content, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "EEXIST"
    ) {
      throw new Error(
        "T45_CAPABILITY_OBLIGATION_"
        + `ARTIFACT_ALREADY_EXISTS:${resolved}`,
      );
    }
    throw error;
  }
  const observed = await readFile(resolved, "utf8");
  if (observed !== content) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_"
      + `ARTIFACT_BYTE_DRIFT:${resolved}`,
    );
  }
  return {
    path: resolved,
    bytes: Buffer.byteLength(observed, "utf8"),
    sha256: sha256(observed),
  };
}

export async function readT45SealedJsonArtifactV1<T>(
  input: {
    path: string;
    expectedSha256: string;
    artifact:
      | "CANDIDATE"
      | "MATRIX_BRIDGE"
      | "MATRIX";
    parse(value: unknown): T;
  },
): Promise<{ value: T; sha256: string }> {
  const bytes = await readFile(path.resolve(input.path));
  const observedSha256 = sha256(bytes);
  if (observedSha256 !== input.expectedSha256) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_"
      + `${input.artifact}_SHA256_DRIFT`,
    );
  }
  return {
    value: input.parse(
      JSON.parse(bytes.toString("utf8")) as unknown,
    ),
    sha256: observedSha256,
  };
}

const FORBIDDEN_RUNTIME_KEYS = new Set([
  "apiKey",
  "baseUrl",
  "databasePath",
  "rawPlannerOutput",
  "rawModelOutput",
]);

function assertSafeArtifact(
  value: unknown,
  location: readonly string[] = [],
) {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertSafeArtifact(
        child,
        [...location, String(index)],
      ));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (
    const [key, child]
    of Object.entries(value as Record<string, unknown>)
  ) {
    if (FORBIDDEN_RUNTIME_KEYS.has(key)) {
      throw new Error(
        "T45_CAPABILITY_OBLIGATION_"
        + `RUNTIME_FIELD_FORBIDDEN:${[
          ...location,
          key,
        ].join(".")}`,
      );
    }
    assertSafeArtifact(child, [...location, key]);
  }
}

function directCases(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const cases = (
    value as { cases?: unknown }
  ).cases;
  if (!Array.isArray(cases)) return null;
  return cases.map((testCase) => {
    if (
      !testCase
      || typeof testCase !== "object"
      || !("caseId" in testCase)
      || typeof testCase.caseId !== "string"
    ) {
      throw new Error(
        "T45_CAPABILITY_OBLIGATION_CASE_ID_INVALID",
      );
    }
    return testCase.caseId;
  });
}

function assertCaseOrder(
  expected: readonly string[],
  value: unknown,
  stage: string,
) {
  const observed = directCases(value);
  if (
    !observed
    || observed.length !== expected.length
    || observed.some(
      (caseId, index) =>
        caseId !== expected[index],
    )
  ) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_"
      + `CASE_ORDER_DRIFT:${stage}`,
    );
  }
}

function assertBridgeCaseOrder(
  expected: readonly string[],
  value: unknown,
) {
  if (!value || typeof value !== "object") {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_"
      + "CASE_ORDER_DRIFT:matrix-bridge",
    );
  }
  const arms = (
    value as {
      arms?: Record<
        string,
        { input?: unknown }
      >;
    }
  ).arms;
  for (
    const name
    of ["A_WHOLE_QUERY", "B_MODEL_GUIDED"]
  ) {
    assertCaseOrder(
      expected,
      arms?.[name]?.input,
      "matrix-bridge",
    );
  }
}

function assertMatrixCaseOrder(
  expected: readonly string[],
  value: unknown,
) {
  if (!value || typeof value !== "object") {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_"
      + "CASE_ORDER_DRIFT:matrix",
    );
  }
  const arms = (
    value as {
      arms?: Record<
        string,
        { output?: unknown }
      >;
    }
  ).arms;
  for (
    const name
    of ["A_WHOLE_QUERY", "B_MODEL_GUIDED"]
  ) {
    assertCaseOrder(
      expected,
      arms?.[name]?.output,
      "matrix",
    );
  }
}

export type T45SealedCapabilityArtifactsV1 = {
  planner: T45SealedJsonArtifactV1;
  provider: T45SealedJsonArtifactV1;
  candidate: T45SealedJsonArtifactV1;
  matrixBridge: T45SealedJsonArtifactV1;
  matrix: T45SealedJsonArtifactV1;
  selection: T45SealedJsonArtifactV1;
};

export async function runT45SealedCapabilityPipelineV1<
  TBoundary,
>(input: {
  artifactRoot: string;
  artifactStem: string;
  expectedCaseIds: readonly string[];
  collectLabelBlindArtifacts:
    () => Promise<T44LabelBlindArtifactsV1 | {
      planner: unknown;
      provider: unknown;
      candidate: unknown;
      matrixBridge: unknown;
    }>;
  runMatrix: (input: {
    candidatePath: string;
    candidateSha256: string;
    matrixBridgePath: string;
    matrixBridgeSha256: string;
  }) => Promise<unknown>;
  buildSelection: (input: {
    candidatePath: string;
    candidateSha256: string;
    matrixPath: string;
    matrixSha256: string;
  }) => Promise<unknown>;
  finalizeUnreadBoundary: (input: {
    sealed: T45SealedCapabilityArtifactsV1;
  }) => Promise<TBoundary>;
}) {
  const artifactStem = z.string()
    .regex(RUN_ID_PATTERN)
    .parse(input.artifactStem);
  const expectedCaseIds = z.array(
    z.string().regex(RUN_ID_PATTERN),
  ).min(1).max(50).parse(input.expectedCaseIds);
  if (
    new Set(expectedCaseIds).size
      !== expectedCaseIds.length
  ) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_CASE_IDS_DUPLICATE",
    );
  }
  const root = path.resolve(input.artifactRoot);
  const artifacts =
    await input.collectLabelBlindArtifacts();
  assertCaseOrder(
    expectedCaseIds,
    artifacts.planner,
    "planner",
  );
  assertCaseOrder(
    expectedCaseIds,
    artifacts.provider,
    "provider",
  );
  assertCaseOrder(
    expectedCaseIds,
    artifacts.candidate,
    "candidate",
  );
  assertBridgeCaseOrder(
    expectedCaseIds,
    artifacts.matrixBridge,
  );
  for (const value of Object.values(artifacts)) {
    assertSafeArtifact(value);
  }
  const planner =
    await writeNewT45SealedJsonArtifactV1(
      path.join(
        root,
        `${artifactStem}.planner.json`,
      ),
      artifacts.planner,
    );
  const provider =
    await writeNewT45SealedJsonArtifactV1(
      path.join(
        root,
        `${artifactStem}.provider.json`,
      ),
      artifacts.provider,
    );
  const candidate =
    await writeNewT45SealedJsonArtifactV1(
      path.join(
        root,
        `${artifactStem}.candidate.json`,
      ),
      artifacts.candidate,
    );
  const matrixBridge =
    await writeNewT45SealedJsonArtifactV1(
      path.join(
        root,
        `${artifactStem}.matrix-bridge.json`,
      ),
      artifacts.matrixBridge,
    );
  const matrixValue = await input.runMatrix({
    candidatePath: candidate.path,
    candidateSha256: candidate.sha256,
    matrixBridgePath: matrixBridge.path,
    matrixBridgeSha256: matrixBridge.sha256,
  });
  assertSafeArtifact(matrixValue);
  assertMatrixCaseOrder(
    expectedCaseIds,
    matrixValue,
  );
  const matrix =
    await writeNewT45SealedJsonArtifactV1(
      path.join(
        root,
        `${artifactStem}.matrix.json`,
      ),
      matrixValue,
    );
  const selectionValue =
    await input.buildSelection({
      candidatePath: candidate.path,
      candidateSha256: candidate.sha256,
      matrixPath: matrix.path,
      matrixSha256: matrix.sha256,
    });
  assertSafeArtifact(selectionValue);
  assertCaseOrder(
    expectedCaseIds,
    selectionValue,
    "selection",
  );
  const selection =
    await writeNewT45SealedJsonArtifactV1(
      path.join(
        root,
        `${artifactStem}.selection.json`,
      ),
      selectionValue,
    );
  const sealed: T45SealedCapabilityArtifactsV1 = {
    planner,
    provider,
    candidate,
    matrixBridge,
    matrix,
    selection,
  };
  const boundary =
    await input.finalizeUnreadBoundary({ sealed });
  assertSafeArtifact(boundary);
  const boundarySeal =
    await writeNewT45SealedJsonArtifactV1(
      path.join(
        root,
        `${artifactStem}.boundary.json`,
      ),
      boundary,
    );
  return { sealed, boundary, boundarySeal };
}

type PipelineBindingSet = {
  suiteHash: string;
  inventoryHash: string;
  corpusBundleHash: string;
  candidateSha256: string;
  matrixSha256: string;
};

const BINDING_CODES: Record<
  keyof PipelineBindingSet,
  string
> = {
  suiteHash: "SUITE_HASH",
  inventoryHash: "INVENTORY_HASH",
  corpusBundleHash: "CORPUS_BUNDLE_HASH",
  candidateSha256: "CANDIDATE_SHA256",
  matrixSha256: "MATRIX_SHA256",
};

export function assertT45CapabilityPipelineBindingsV1(
  input: {
    expected: PipelineBindingSet;
    observed: PipelineBindingSet;
  },
) {
  const expected = z.object({
    suiteHash: HashSchema,
    inventoryHash: HashSchema,
    corpusBundleHash: HashSchema,
    candidateSha256: HashSchema,
    matrixSha256: HashSchema,
  }).strict().parse(input.expected);
  const observed = z.object({
    suiteHash: HashSchema,
    inventoryHash: HashSchema,
    corpusBundleHash: HashSchema,
    candidateSha256: HashSchema,
    matrixSha256: HashSchema,
  }).strict().parse(input.observed);
  for (
    const field
    of Object.keys(expected) as Array<
      keyof PipelineBindingSet
    >
  ) {
    if (expected[field] !== observed[field]) {
      throw new Error(
        "T45_CAPABILITY_OBLIGATION_"
        + `${BINDING_CODES[field]}_DRIFT`,
      );
    }
  }
  return expected;
}

type T45MatrixBridgeInputV1 = ReturnType<
  typeof T44ObligationMatrixBridgeManifestV1Schema.parse
>["arms"]["A_WHOLE_QUERY"]["input"];

type T45PlannerV1 = Parameters<
  typeof collectObligationLabelBlindArtifactsV1
>[0]["planner"];

export type T45CapabilityObligationCliDependenciesV1 = {
  loadRuntimePort(input: {
    workspaceRoot: string;
    split: "CALIBRATION" | "VALIDATION";
  }): Promise<T45RuntimePort>;
  loadCorpus(
    workspaceRoot: string,
  ): Promise<KnowledgeCorpusBundleV2>;
  preparePlanner(
    workspaceRoot: string,
  ): Promise<{
    planner: T45PlannerV1;
    modelProvenance: ReturnType<
      typeof formatT45ModelProvenanceNoticeV1
    >;
    providerSelection: string;
  }>;
  collectLabelBlindArtifacts(input: {
    runtime: T45RuntimePort;
    corpus: KnowledgeCorpusBundleV2;
    planner: T45PlannerV1;
    workspaceRoot: string;
    device: "cuda" | "cpu";
    clarifyBaselinePolicy:
      "REUSE_WHOLE_QUERY_BASELINE";
  }): Promise<T44LabelBlindArtifactsV1>;
  executeMatrixArm(input: {
    armName:
      | "A_WHOLE_QUERY"
      | "B_MODEL_GUIDED";
    candidateInput: T45MatrixBridgeInputV1;
    candidateInputPath: string;
    candidateInputSha256: string;
    workspaceRoot: string;
    device: "cuda" | "cpu";
  }): Promise<{
    output: unknown;
    stderr: string;
  }>;
};

async function loadT45CorpusV1(
  workspaceRoot: string,
) {
  return verifyKnowledgeCorpusBundleV2(
    JSON.parse(await readFile(
      path.resolve(workspaceRoot, PATHS.corpus),
      "utf8",
    )) as unknown,
  );
}

async function prepareT45PlannerV1(
  workspaceRoot: string,
) {
  const loadedEnvironment =
    await loadRuntimeEnvironment({
      cwd: workspaceRoot,
      mode: "SERVICE_REQUIRED",
      nodeEnv: "test",
    });
  const config = readEnv(
    loadedEnvironment.environment,
  );
  const plannerConfig =
    resolvePlannerModelConfiguration(config.ai);
  if (!plannerConfig.enabled) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_"
      + "SERVICE_MODEL_REQUIRED",
    );
  }
  if (!isGpt56ModelId(plannerConfig.model)) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_GPT_5_6_REQUIRED",
    );
  }
  if (
    loadedEnvironment.provenance.model.source
      !== "service-env"
  ) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_"
      + "SERVICE_MODEL_PROVENANCE_REQUIRED",
    );
  }
  const modelProvenance =
    formatT45ModelProvenanceNoticeV1({
      modelId: plannerConfig.model,
      endpointHash: sha256(
        new URL(plannerConfig.baseUrl).toString(),
      ),
      configurationSource: "service-env",
    });
  const model = guardModelProviderSecretOutputs(
    createOpenAICompatibleModelProvider({
      baseUrl: plannerConfig.baseUrl,
      apiKey: plannerConfig.apiKey,
      model: plannerConfig.model,
      maxOutputTokens: plannerConfig.maxOutputTokens,
      idleTimeoutMs:
        T45_CAPABILITY_PLANNER_TIMEOUTS_V1
          .idleTimeoutMs,
      totalTimeoutMs:
        T45_CAPABILITY_PLANNER_TIMEOUTS_V1
          .totalTimeoutMs,
      vision: plannerConfig.vision,
    }),
    plannerConfig.apiKey,
  );
  return {
    planner: createQueryUnderstandingPlannerV1({
      model,
      plannerVersion:
        QUERY_UNDERSTANDING_PLANNER_VERSION_V2,
      totalTimeoutMs:
        T45_CAPABILITY_PLANNER_TIMEOUTS_V1
          .totalTimeoutMs,
    }),
    modelProvenance,
    providerSelection: plannerConfig.selection,
  };
}

async function executeT45MatrixArmV1(input: {
  candidateInputPath: string;
  workspaceRoot: string;
  device: "cuda" | "cpu";
}) {
  const { stdout, stderr } =
    await execFileAsync(
      path.resolve(
        input.workspaceRoot,
        PATHS.python,
      ),
      [
        path.resolve(
          input.workspaceRoot,
          PATHS.matrixTool,
        ),
        "--input",
        input.candidateInputPath,
        "--corpus",
        path.resolve(
          input.workspaceRoot,
          PATHS.corpus,
        ),
        "--model-dir",
        path.resolve(
          input.workspaceRoot,
          PATHS.textModelDir,
        ),
        "--model-seal",
        path.resolve(
          input.workspaceRoot,
          PATHS.textModelSeal,
        ),
        "--index-dir",
        path.resolve(
          input.workspaceRoot,
          PATHS.textIndexDir,
        ),
        "--device",
        input.device,
      ],
      {
        cwd: input.workspaceRoot,
        encoding: "utf8",
        env:
          isolatedObligationPythonEnvironmentV1(),
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
      },
    );
  return {
    output: JSON.parse(stdout) as unknown,
    stderr,
  };
}

const DEFAULT_T45_CLI_DEPENDENCIES: Readonly<
  T45CapabilityObligationCliDependenciesV1
> = Object.freeze({
  loadRuntimePort: loadT45RuntimePort,
  loadCorpus: loadT45CorpusV1,
  preparePlanner: prepareT45PlannerV1,
  collectLabelBlindArtifacts:
    collectObligationLabelBlindArtifactsV1,
  executeMatrixArm: executeT45MatrixArmV1,
});

export async function runT45CapabilityObligationsCli(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
  dependencyOverrides: Partial<
    T45CapabilityObligationCliDependenciesV1
  > = {},
) {
  const parsed =
    parseT45CapabilityObligationsArguments(argv);
  const dependencies = {
    ...DEFAULT_T45_CLI_DEPENDENCIES,
    ...dependencyOverrides,
  };
  const runtime = await dependencies.loadRuntimePort({
    workspaceRoot,
    split: parsed.split,
  });
  const corpus = verifyKnowledgeCorpusBundleV2(
    await dependencies.loadCorpus(workspaceRoot),
  );
  if (
    corpus.bundleHash
      !== runtime.identity.corpusBundleHash
  ) {
    throw new Error(
      "T45_CAPABILITY_OBLIGATION_"
      + "CORPUS_BUNDLE_HASH_DRIFT",
    );
  }
  const {
    planner,
    modelProvenance,
    providerSelection,
  } = await dependencies.preparePlanner(workspaceRoot);
  process.stderr.write(
    `${JSON.stringify({
      ...modelProvenance,
      providerSelection,
    })}\n`,
  );
  const artifactStem =
    `t45-capability-${parsed.runId}`;
  const artifactRoot = path.resolve(
    workspaceRoot,
    PATHS.artifactRoot,
  );
  let capturedCandidateSha256: string | null = null;
  let capturedBridgeSha256: string | null = null;
  let providerCounts: {
    expected: number;
    actual: number;
    channelCounts: {
      LEXICAL: number;
      TEXT_VECTOR: number;
      VISUAL_VECTOR: number;
    };
  } | null = null;

  return runT45SealedCapabilityPipelineV1({
    artifactRoot,
    artifactStem,
    expectedCaseIds: runtime.cases.map(
      ({ caseId }) => caseId,
    ),
    collectLabelBlindArtifacts: async () => {
      const collected =
        await dependencies.collectLabelBlindArtifacts({
          runtime,
          corpus,
          planner,
          workspaceRoot,
          device: parsed.device,
          clarifyBaselinePolicy:
            "REUSE_WHOLE_QUERY_BASELINE",
        });
      providerCounts = {
        expected: collected.provider.expectedCalls,
        actual: collected.provider.actualCalls,
        channelCounts:
          collected.provider.channelCounts,
      };
      return {
        ...collected,
        planner: {
          ...collected.planner,
          model: modelProvenance,
        },
      };
    },
    runMatrix: async ({
      candidatePath,
      candidateSha256,
      matrixBridgePath,
      matrixBridgeSha256,
    }) => {
      const [candidateRead, bridgeRead] =
        await Promise.all([
          readT45SealedJsonArtifactV1({
            path: candidatePath,
            expectedSha256: candidateSha256,
            artifact: "CANDIDATE",
            parse: (value) =>
              T44ObligationCandidateArtifactV1Schema
                .parse(value),
          }),
          readT45SealedJsonArtifactV1({
            path: matrixBridgePath,
            expectedSha256: matrixBridgeSha256,
            artifact: "MATRIX_BRIDGE",
            parse: (value) =>
              T44ObligationMatrixBridgeManifestV1Schema
                .parse(value),
          }),
        ]);
      const bridge = bridgeRead.value;
      if (
        bridge.candidateArtifactSha256
          !== candidateRead.sha256
      ) {
        throw new Error(
          "T45_CAPABILITY_OBLIGATION_"
          + "CANDIDATE_SHA256_DRIFT",
        );
      }
      capturedCandidateSha256 =
        candidateRead.sha256;
      capturedBridgeSha256 = bridgeRead.sha256;
      const evaluateArm = async (
        armName:
          | "A_WHOLE_QUERY"
          | "B_MODEL_GUIDED",
        suffix: "a" | "b",
      ) => {
        const inputSeal =
          await writeNewT45SealedJsonArtifactV1(
            path.join(
              artifactRoot,
              `${artifactStem}.matrix-${suffix}-input.json`,
            ),
            bridge.arms[armName].input,
          );
        const executed =
          await dependencies.executeMatrixArm({
            armName,
            candidateInput:
              bridge.arms[armName].input,
            candidateInputPath: inputSeal.path,
            candidateInputSha256:
              inputSeal.sha256,
            workspaceRoot,
            device: parsed.device,
          });
        const output =
          T44ClaimMatrixSidecarOutputV1Schema.parse(
            executed.output,
          );
        if (
          output.candidateInputSha256
            !== inputSeal.sha256
        ) {
          throw new Error(
            "T45_CAPABILITY_OBLIGATION_"
            + `MATRIX_INPUT_SHA_DRIFT:${armName}`,
          );
        }
        return {
          inputSha256: inputSeal.sha256,
          stderrBytes:
            Buffer.byteLength(
              executed.stderr,
              "utf8",
            ),
          stderrSha256: sha256(executed.stderr),
          output,
        };
      };
      return MatrixPackageSchema.parse({
        schemaVersion: 1,
        kind: "T44_OBLIGATION_NODE_MATRICES",
        matrixBridgeManifestSha256:
          bridgeRead.sha256,
        graphifyInvocationCount: 0,
        arms: {
          A_WHOLE_QUERY:
            await evaluateArm(
              "A_WHOLE_QUERY",
              "a",
            ),
          B_MODEL_GUIDED:
            await evaluateArm(
              "B_MODEL_GUIDED",
              "b",
            ),
        },
      });
    },
    buildSelection: async ({
      candidatePath,
      candidateSha256,
      matrixPath,
      matrixSha256,
    }) => {
      const [candidateRead, matrixRead] =
        await Promise.all([
          readT45SealedJsonArtifactV1({
            path: candidatePath,
            expectedSha256: candidateSha256,
            artifact: "CANDIDATE",
            parse: (value) =>
              T44ObligationCandidateArtifactV1Schema
                .parse(value),
          }),
          readT45SealedJsonArtifactV1({
            path: matrixPath,
            expectedSha256: matrixSha256,
            artifact: "MATRIX",
            parse: (value) =>
              MatrixPackageSchema.parse(value),
          }),
        ]);
      const candidate = candidateRead.value;
      const matrix = matrixRead.value;
      if (
        !capturedCandidateSha256
        || !capturedBridgeSha256
      ) {
        throw new Error(
          "T45_CAPABILITY_OBLIGATION_"
          + "SELECTION_STATE_MISSING",
        );
      }
      assertT45CapabilityPipelineBindingsV1({
        expected: {
          suiteHash:
            T45_FROZEN_RUNTIME_BINDINGS_V1
              .suiteHashes[parsed.split],
          inventoryHash:
            T45_FROZEN_RUNTIME_BINDINGS_V1
              .inventoryHash,
          corpusBundleHash:
            T45_FROZEN_RUNTIME_BINDINGS_V1
              .corpusBundleHash,
          candidateSha256:
            capturedCandidateSha256,
          matrixSha256,
        },
        observed: {
          suiteHash:
            candidate.runtimeSuite.suiteHash,
          inventoryHash:
            runtime.identity.inventoryHash,
          corpusBundleHash:
            candidate.corpusSnapshot.bundleHash,
          candidateSha256: candidateRead.sha256,
          matrixSha256: matrixRead.sha256,
        },
      });
      if (
        matrix.matrixBridgeManifestSha256
          !== capturedBridgeSha256
        || Object.values(matrix.arms).some(
          ({ output }) =>
            output.runtimeSuite.suiteHash
              !== runtime.identity.suiteHash
            || output.corpusBundleHash
              !== runtime.identity.corpusBundleHash,
        )
      ) {
        throw new Error(
          "T45_CAPABILITY_OBLIGATION_"
          + "MATRIX_BINDING_DRIFT",
        );
      }
      return T44ObligationSelectionArtifactV1Schema
        .parse(
          buildT44BaselineProtectedObligationSelectionArtifactV2({
            candidateArtifact: candidate,
            candidateArtifactSha256:
              candidateRead.sha256,
            matrixOutputSha256:
              matrixRead.sha256,
            aMatrixOutput:
              matrix.arms.A_WHOLE_QUERY.output,
            bMatrixOutput:
              matrix.arms.B_MODEL_GUIDED.output,
          }),
        );
    },
    finalizeUnreadBoundary: async ({ sealed }) => {
      if (!providerCounts) {
        throw new Error(
          "T45_CAPABILITY_OBLIGATION_"
          + "PROVIDER_COUNTS_MISSING",
        );
      }
      return {
        schemaVersion: 1,
        kind:
          "T45_CAPABILITY_LABELS_REMAIN_UNREAD",
        runId: parsed.runId,
        split: parsed.split,
        runtimeSuite: {
          id: runtime.identity.id,
          version: runtime.identity.version,
          suiteHash: runtime.identity.suiteHash,
        },
        capabilityInventory: {
          inventoryHash:
            runtime.identity.inventoryHash,
        },
        corpusSnapshot: {
          bundleHash:
            runtime.identity.corpusBundleHash,
        },
        configHashes: {
          candidate:
            T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
          matrix:
            T44_CLAIM_MATRIX_CONFIG_HASH_V1,
          selection:
            T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
        },
        providerInvocationAudit: providerCounts,
        operationBoundary:
          "SELECTION_SEALED_LABELS_UNREAD",
        operations: {
          graphify: "NOT_USED",
          database: "NOT_USED",
          web: "NOT_USED",
          deployment: "NOT_PERFORMED",
          scoring: "NOT_PERFORMED",
        },
        artifacts: sealed,
      };
    },
  });
}

export function formatT45CapabilityCliErrorCodeV1(
  error: unknown,
) {
  const message = error instanceof Error
    ? error.message
    : "";
  const stableCode = message.match(
    /^(T45_[A-Z0-9]+(?:_[A-Z0-9]+)*)/,
  )?.[1];
  return stableCode
    ?? "T45_CAPABILITY_OBLIGATION_UNEXPECTED_ERROR";
}

async function main() {
  const result =
    await runT45CapabilityObligationsCli(
      process.argv.slice(2),
    );
  const boundary = result.boundary as {
    runtimeSuite: {
      suiteHash: string;
    };
    capabilityInventory: {
      inventoryHash: string;
    };
    corpusSnapshot: {
      bundleHash: string;
    };
    configHashes: Record<string, string>;
    providerInvocationAudit: unknown;
    operationBoundary: string;
    operations: unknown;
  };
  process.stdout.write(
    `${JSON.stringify({
      artifacts: result.sealed,
      boundaryPath: result.boundarySeal.path,
      boundaryBytes: result.boundarySeal.bytes,
      boundarySha256:
        result.boundarySeal.sha256,
      suiteHash:
        boundary.runtimeSuite.suiteHash,
      inventoryHash:
        boundary.capabilityInventory.inventoryHash,
      corpusBundleHash:
        boundary.corpusSnapshot.bundleHash,
      configHashes: boundary.configHashes,
      providerInvocationAudit:
        boundary.providerInvocationAudit,
      operationBoundary:
        boundary.operationBoundary,
      operations: boundary.operations,
    }, null, 2)}\n`,
  );
}

const entryPoint = process.argv[1];
if (
  entryPoint
  && import.meta.url
    === pathToFileURL(path.resolve(entryPoint)).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${formatT45CapabilityCliErrorCodeV1(error)}\n`,
    );
    process.exitCode = 1;
  });
}

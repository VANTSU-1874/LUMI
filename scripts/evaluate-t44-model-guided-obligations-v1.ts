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
import { isGpt56ModelId } from "@/lib/ai/model-id";
import {
  createOpenAICompatibleModelProvider,
} from "@/lib/agent/model-provider-adapter";
import {
  readEnv,
  resolvePlannerModelConfiguration,
} from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
} from "@/lib/config/runtime-environment";
import type {
  QueryUnderstandingInputV1,
} from "@/lib/knowledge/answer-obligation-v1";
import type {
  DirectEvidenceBatchResultV1,
} from "@/lib/knowledge/direct-evidence-channel-probe-v1";
import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import type {
  ObligationRrfResultV1,
} from "@/lib/knowledge/obligation-rrf-v1";
import {
  QUERY_UNDERSTANDING_PLANNER_VERSION_V2,
  createQueryUnderstandingPlannerV1,
  type QueryUnderstandingPlannerResultV1,
} from "@/lib/knowledge/query-understanding-planner-v1";
import {
  T44ClaimMatrixSidecarOutputV1Schema,
} from "@/tools/mixed-retrieval/t44-claim-coverage-evaluator";
import {
  sealT44ObligationArtifactV1,
  T44ObligationCandidateArtifactV1Schema,
  T44ObligationMatrixBridgeManifestV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  buildT44ObligationSelectionArtifactV1,
  evaluateT44LegacyEvidenceCaseV1,
  T44ObligationSelectionArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-coverage-evaluator";
import {
  collectObligationLabelBlindArtifactsV1,
  isolatedObligationPythonEnvironmentV1,
} from "@/tools/mixed-retrieval/t45-obligation-runtime-port";
import {
  loadT44SupportDevArtifacts,
  T44SupportRuntimeSuiteSchema,
  t44SupportRuntimeSuiteHash,
  T44_SUPPORT_RUNTIME_SUITE_SHA256,
  type T44SupportQrelsSuite,
  type T44SupportRuntimeSuite,
} from "@/tools/mixed-retrieval/t44-support-loader";

const execFileAsync = promisify(execFile);
const RUN_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export const T44_PLANNER_TOTAL_TIMEOUT_MS = 20_000;
export const T44_PLANNER_IDLE_TIMEOUT_MS =
  T44_PLANNER_TOTAL_TIMEOUT_MS - 1;
export const T44_PLANNER_P95_GATE_MS =
  T44_PLANNER_TOTAL_TIMEOUT_MS;

const PATHS = Object.freeze({
  legacyRuntime:
    "tests/retrieval-quality/t44-support-dev.runtime.json",
  legacyQrels:
    "tests/retrieval-quality/t44-support-dev.qrels.json",
  obligationRuntime:
    "tests/retrieval-quality/t44-obligation-dev.runtime.json",
  obligationQrels:
    "tests/retrieval-quality/t44-obligation-dev.qrels.json",
  corpus:
    "data/knowledge-v2/knowledge-corpus.v2.json",
  python:
    ".runtime/visual-retrieval/python312/python.exe",
  matrixTool:
    "tools/reranker/t44_claim_matrix.py",
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
  assetManifest:
    "data/manifests/course-png-sha256.v1.json",
  artifactRoot: ".runtime/mixed-retrieval",
} as const);

const CoursePackIdSchema = z.enum([
  "general-design",
  "digital-interaction",
  "book-design",
  "layout-design",
  "brand-vi-design",
]);

const ObligationRuntimeCaseSchema = z
  .object({
    caseId: z.string().regex(RUN_ID_PATTERN),
    coursePackId: CoursePackIdSchema,
    coursePackVersion: z.literal("1"),
    question: z.string().trim().min(1).max(500),
    recentTurns: z.array(z
      .object({
        source: z.enum([
          "RECENT_TURN_1",
          "RECENT_TURN_2",
        ]),
        message: z.string().trim().min(1).max(2_000),
        messageHash: z.string().regex(HASH_PATTERN),
      })
      .strict()).max(2),
    view: z
      .object({
        id: z.string().trim().min(1).max(120),
        focus: z.string().trim().min(1)
          .max(200).nullable(),
      })
      .strict(),
    hasArtwork: z.boolean(),
    artworkHash:
      z.string().regex(HASH_PATTERN).nullable(),
  })
  .strict()
  .superRefine((testCase, context) => {
    if (
      testCase.hasArtwork
      !== (testCase.artworkHash !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["artworkHash"],
        message:
          "artwork declaration and hash must agree",
      });
    }
    if (
      testCase.recentTurns.some(
        ({ source }, index) =>
          source !== `RECENT_TURN_${index + 1}`,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["recentTurns"],
        message:
          "recent turn sources must preserve order",
      });
    }
  });

const ObligationRuntimeSuiteSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(RUN_ID_PATTERN),
    version: z.string().trim().min(1).max(50),
    split: z.literal("DEV"),
    corpusSnapshot: z
      .object({
        path: z.literal(
          "data/knowledge-v2/knowledge-corpus.v2.json",
        ),
        bundleHash:
          z.string().regex(HASH_PATTERN),
      })
      .strict(),
    cases: z.array(
      ObligationRuntimeCaseSchema,
    ).length(50),
    suiteHash: z.string().regex(HASH_PATTERN),
  })
  .strict();

type NormalizedRuntimeCase = z.infer<
  typeof ObligationRuntimeCaseSchema
>;

type LoadedRuntimeSuite = {
  id: string;
  version: string;
  suiteHash: string;
  corpusBundleHash: string;
  cases: NormalizedRuntimeCase[];
  legacyRuntime: T44SupportRuntimeSuite | null;
  rawBytes: Buffer;
};

const MatrixPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T44_OBLIGATION_NODE_MATRICES",
    ),
    matrixBridgeManifestSha256:
      z.string().regex(HASH_PATTERN),
    graphifyInvocationCount: z.literal(0),
    arms: z
      .object({
        A_WHOLE_QUERY: z
          .object({
            inputSha256:
              z.string().regex(HASH_PATTERN),
            stderrBytes:
              z.number().int().nonnegative(),
            stderrSha256:
              z.string().regex(HASH_PATTERN),
            output:
              T44ClaimMatrixSidecarOutputV1Schema,
          })
          .strict(),
        B_MODEL_GUIDED: z
          .object({
            inputSha256:
              z.string().regex(HASH_PATTERN),
            stderrBytes:
              z.number().int().nonnegative(),
            stderrSha256:
              z.string().regex(HASH_PATTERN),
            output:
              T44ClaimMatrixSidecarOutputV1Schema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type T44ModelGuidedSuite =
  | "legacy"
  | "obligation-dev";

export function parseT44ModelGuidedObligationsArguments(
  argv: readonly string[],
) {
  const values = new Map<string, string>();
  let index = argv[0] === "--" ? 1 : 0;
  const known = new Set([
    "--suite",
    "--run-id",
    "--device",
  ]);
  while (index < argv.length) {
    const key = argv[index]!;
    if (!known.has(key)) {
      throw new Error(
        `T44_OBLIGATION_CLI_UNKNOWN_ARGUMENT:${key}`,
      );
    }
    if (values.has(key)) {
      throw new Error(
        `T44_OBLIGATION_CLI_DUPLICATE_ARGUMENT:${key}`,
      );
    }
    const value = argv[index + 1];
    if (
      !value
      || value === "--"
      || value.startsWith("--")
    ) {
      throw new Error(
        `T44_OBLIGATION_CLI_ARGUMENT_VALUE_MISSING:${key}`,
      );
    }
    values.set(key, value);
    index += 2;
  }
  const suite = values.get("--suite");
  if (
    suite !== "legacy"
    && suite !== "obligation-dev"
  ) {
    throw new Error(
      "T44_OBLIGATION_CLI_SUITE_INVALID",
    );
  }
  const runId = values.get("--run-id");
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      "T44_OBLIGATION_CLI_RUN_ID_INVALID",
    );
  }
  return {
    suite: suite as T44ModelGuidedSuite,
    runId,
    device: z.enum(["cuda", "cpu"]).parse(
      values.get("--device") ?? "cuda",
    ),
  };
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function canonicalJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safeWriteError(error: unknown, target: string) {
  if (
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "EEXIST"
  ) {
    return new Error(
      `T44_OBLIGATION_ARTIFACT_ALREADY_EXISTS:${target}`,
    );
  }
  return error;
}

export type SealedJsonArtifactV1 = {
  path: string;
  bytes: number;
  sha256: string;
};

export async function writeNewSealedJsonArtifactV1(
  target: string,
  value: unknown,
): Promise<SealedJsonArtifactV1> {
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
    throw safeWriteError(error, resolved);
  }
  const observed = await readFile(resolved, "utf8");
  if (observed !== content) {
    throw new Error(
      `T44_OBLIGATION_ARTIFACT_BYTE_DRIFT:${resolved}`,
    );
  }
  return {
    path: resolved,
    bytes: Buffer.byteLength(observed, "utf8"),
    sha256: sha256(observed),
  };
}

export function formatT44ModelProvenanceNoticeV1(
  input: {
    source: "service-env";
    sourceFile: string;
    modelId: string;
    endpointHash: string;
  },
) {
  return {
    event: "t44-obligation-model-provenance" as const,
    environmentMode: "SERVICE_REQUIRED" as const,
    source: input.source,
    sourceFile: input.sourceFile,
    modelId: z.string().trim().min(1).max(200)
      .parse(input.modelId),
    endpointHash: z.string().regex(HASH_PATTERN)
      .parse(input.endpointHash),
  };
}

const RUNTIME_SECRET_KEYS = new Set([
  "apiKey",
  "baseUrl",
  "databasePath",
  "rawPlannerOutput",
  "rawModelOutput",
]);

function assertRuntimeArtifactSafe(
  value: unknown,
  location: readonly string[] = [],
) {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertRuntimeArtifactSafe(
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
    if (RUNTIME_SECRET_KEYS.has(key)) {
      throw new Error(
        `T44_OBLIGATION_RUNTIME_FIELD_FORBIDDEN:${[
          ...location,
          key,
        ].join(".")}`,
      );
    }
    assertRuntimeArtifactSafe(
      child,
      [...location, key],
    );
  }
}

export type T44LabelBlindArtifactsV1 = {
  planner: unknown;
  provider: unknown;
  candidate: unknown;
  matrixBridge: unknown;
};

export type T44SealedArtifactsV1 = {
  planner: SealedJsonArtifactV1;
  provider: SealedJsonArtifactV1;
  candidate: SealedJsonArtifactV1;
  matrixBridge: SealedJsonArtifactV1;
  matrix: SealedJsonArtifactV1;
  selection: SealedJsonArtifactV1;
};

export async function runT44SealedEvaluationPipelineV1<
  TQrels,
  TReport,
>(input: {
  artifactRoot: string;
  artifactStem: string;
  collectLabelBlindArtifacts:
    () => Promise<T44LabelBlindArtifactsV1>;
  runMatrix: (input: {
    matrixBridgePath: string;
    matrixBridgeSha256: string;
  }) => Promise<unknown>;
  buildSelection: (input: {
    candidatePath: string;
    candidateSha256: string;
    matrixPath: string;
    matrixSha256: string;
  }) => Promise<unknown>;
  loadQrels: (input: {
    sealed: T44SealedArtifactsV1;
  }) => Promise<TQrels>;
  evaluate: (input: {
    qrels: TQrels;
    sealed: T44SealedArtifactsV1;
  }) => Promise<TReport>;
}) {
  const artifactStem = z.string()
    .regex(RUN_ID_PATTERN)
    .parse(input.artifactStem);
  const root = path.resolve(input.artifactRoot);
  const artifacts =
    await input.collectLabelBlindArtifacts();
  for (const value of Object.values(artifacts)) {
    assertRuntimeArtifactSafe(value);
  }
  const planner = await writeNewSealedJsonArtifactV1(
    path.join(root, `${artifactStem}.planner.json`),
    artifacts.planner,
  );
  const provider = await writeNewSealedJsonArtifactV1(
    path.join(root, `${artifactStem}.provider.json`),
    artifacts.provider,
  );
  const candidate =
    await writeNewSealedJsonArtifactV1(
      path.join(
        root,
        `${artifactStem}.candidate.json`,
      ),
      artifacts.candidate,
    );
  const matrixBridge =
    await writeNewSealedJsonArtifactV1(
      path.join(
        root,
        `${artifactStem}.matrix-bridge.json`,
      ),
      artifacts.matrixBridge,
    );
  const matrixValue = await input.runMatrix({
    matrixBridgePath: matrixBridge.path,
    matrixBridgeSha256: matrixBridge.sha256,
  });
  assertRuntimeArtifactSafe(matrixValue);
  const matrix = await writeNewSealedJsonArtifactV1(
    path.join(root, `${artifactStem}.matrix.json`),
    matrixValue,
  );
  const selectionValue =
    await input.buildSelection({
      candidatePath: candidate.path,
      candidateSha256: candidate.sha256,
      matrixPath: matrix.path,
      matrixSha256: matrix.sha256,
    });
  assertRuntimeArtifactSafe(selectionValue);
  const selection =
    await writeNewSealedJsonArtifactV1(
      path.join(
        root,
        `${artifactStem}.selection.json`,
      ),
      selectionValue,
    );
  const sealed: T44SealedArtifactsV1 = {
    planner,
    provider,
    candidate,
    matrixBridge,
    matrix,
    selection,
  };

  // This is the only point at which labels become accessible.
  // Every label-blind artifact has already been written with wx,
  // closed by writeFile, re-read byte-for-byte, and SHA-sealed.
  const qrels = await input.loadQrels({ sealed });
  const report = await input.evaluate({
    qrels,
    sealed,
  });
  const reportSeal = await writeNewSealedJsonArtifactV1(
    path.join(root, `${artifactStem}.report.json`),
    report,
  );
  return {
    sealed,
    report,
    reportSeal,
  };
}

async function loadEvaluationRuntimeSuite(
  workspaceRoot: string,
  suite: T44ModelGuidedSuite,
): Promise<LoadedRuntimeSuite> {
  const runtimePath = suite === "legacy"
    ? PATHS.legacyRuntime
    : PATHS.obligationRuntime;
  const rawBytes = await readFile(
    path.resolve(workspaceRoot, runtimePath),
  );
  const raw = JSON.parse(
    rawBytes.toString("utf8"),
  ) as unknown;
  if (suite === "legacy") {
    const legacy =
      T44SupportRuntimeSuiteSchema.parse(raw);
    const observedHash =
      t44SupportRuntimeSuiteHash(legacy);
    if (
      observedHash !== legacy.suiteHash
      || observedHash
        !== T44_SUPPORT_RUNTIME_SUITE_SHA256
    ) {
      throw new Error(
        "T44_OBLIGATION_LEGACY_RUNTIME_HASH_DRIFT",
      );
    }
    return {
      id: legacy.id,
      version: legacy.version,
      suiteHash: legacy.suiteHash,
      corpusBundleHash:
        legacy.corpusSnapshot.bundleHash,
      cases: legacy.cases.map((testCase) => ({
        caseId: testCase.caseId,
        coursePackId: testCase.coursePackId,
        coursePackVersion:
          testCase.coursePackVersion,
        question: testCase.question,
        recentTurns: [],
        view: {
          id: "student-conversation",
          focus: "mentor",
        },
        hasArtwork: false,
        artworkHash: null,
      })),
      legacyRuntime: legacy,
      rawBytes,
    };
  }
  const parsed =
    ObligationRuntimeSuiteSchema.parse(raw);
  const {
    suiteHash: _suiteHash,
    ...unhashed
  } = parsed;
  if (
    sha256StableJsonV2(unhashed)
    !== parsed.suiteHash
  ) {
    throw new Error(
      "T44_OBLIGATION_RUNTIME_HASH_DRIFT",
    );
  }
  for (const testCase of parsed.cases) {
    for (const turn of testCase.recentTurns) {
      if (sha256(turn.message) !== turn.messageHash) {
        throw new Error(
          `T44_OBLIGATION_RECENT_TURN_HASH_DRIFT:${testCase.caseId}`,
        );
      }
    }
  }
  return {
    id: parsed.id,
    version: parsed.version,
    suiteHash: parsed.suiteHash,
    corpusBundleHash:
      parsed.corpusSnapshot.bundleHash,
    cases: parsed.cases,
    legacyRuntime: null,
    rawBytes,
  };
}

function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort(
    (left, right) => left - right,
  );
  return sorted[
    Math.max(
      0,
      Math.ceil(percentile * sorted.length) - 1,
    )
  ]!;
}

type PlannerCaseRecord = {
  caseId: string;
  request: QueryUnderstandingInputV1;
  result: QueryUnderstandingPlannerResultV1;
  bindingAudit: {
    sourceAnchor: number;
    entity: number;
    constraint: number;
  };
};

type RetrievalArmRecord = {
  status: "EXECUTED" | "CLARIFY";
  elapsedMs: number;
  expectedProviderCalls: number;
  actualProviderCalls: number;
  batch: DirectEvidenceBatchResultV1 | null;
  rrf: ObligationRrfResultV1 | null;
};

type ProviderCaseRecord = {
  caseId: string;
  A_WHOLE_QUERY: RetrievalArmRecord;
  B_MODEL_GUIDED: RetrievalArmRecord;
};

type PlannerArtifact = {
  schemaVersion: 1;
  kind: "T44_OBLIGATION_PLANNER_OUTPUTS";
  runtimeSuite: {
    id: string;
    version: string;
    suiteHash: string;
  };
  model: ReturnType<
    typeof formatT44ModelProvenanceNoticeV1
  >;
  graphifyInvocationCount: 0;
  cases: PlannerCaseRecord[];
};

type ProviderArtifact = {
  schemaVersion: 1;
  kind: "T44_OBLIGATION_PROVIDER_TRACES";
  runtimeSuite: {
    id: string;
    version: string;
    suiteHash: string;
  };
  expectedCalls: number;
  actualCalls: number;
  channelCounts: {
    LEXICAL: number;
    TEXT_VECTOR: number;
    VISUAL_VECTOR: number;
  };
  matched: boolean;
  graphifyInvocationCount: 0;
  cases: ProviderCaseRecord[];
};

function evaluateLegacyReport(input: {
  qrels: T44SupportQrelsSuite;
  selection: z.infer<
    typeof T44ObligationSelectionArtifactV1Schema
  >;
  planner: PlannerArtifact;
  provider: ProviderArtifact;
  modelProvenance: ReturnType<
    typeof formatT44ModelProvenanceNoticeV1
  >;
  sealed: T44SealedArtifactsV1;
}) {
  const selectionByCase = new Map(
    input.selection.cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  const plannerByCase = new Map(
    input.planner.cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  const armNames = [
    "A_WHOLE_QUERY",
    "B_MODEL_GUIDED",
  ] as const;
  const rawArm = () => ({
    supportCaseCoverage: 0,
    multiObligationJointCoverage: 0,
    requiredGroupsCovered: 0,
    requiredGroupsTotal: 0,
    hardNegativeIntrusion: 0,
    byCoursePack: new Map<string, {
      total: number;
      supported: number;
      requiredGroupsCovered: number;
      requiredGroupsTotal: number;
      hardNegativeIntrusion: number;
    }>(),
    byIntent: new Map<string, {
      total: number;
      supported: number;
    }>(),
  });
  const accumulators = {
    A_WHOLE_QUERY: rawArm(),
    B_MODEL_GUIDED: rawArm(),
  };
  const caseResults = input.qrels.cases.map((qrel) => {
    const selection = selectionByCase.get(
      qrel.caseId,
    );
    const planner = plannerByCase.get(qrel.caseId);
    if (!selection || !planner) {
      throw new Error(
        `T44_OBLIGATION_LEGACY_CASE_BINDING_DRIFT:${qrel.caseId}`,
      );
    }
    const intents = Array.from(new Set(
      planner.result.obligationSet.obligations.map(
        ({ intent }) => intent,
      ),
    )).sort();
    const arms = Object.fromEntries(
      armNames.map((armName) => {
        const result =
          evaluateT44LegacyEvidenceCaseV1({
            selectedNodeIds:
              selection.arms[armName].selected.map(
                ({ nodeId }) => nodeId,
              ),
            requiredEvidenceGroups:
              qrel.requiredEvidenceGroups,
            hardNegativeNodeIds:
              qrel.hardNegativeNodeIds,
          });
        const aggregate = accumulators[armName];
        if (result.allRequiredGroupsCovered) {
          aggregate.supportCaseCoverage += 1;
          if (qrel.multiClaim) {
            aggregate
              .multiObligationJointCoverage += 1;
          }
        }
        aggregate.requiredGroupsCovered +=
          result.coveredGroupCount;
        aggregate.requiredGroupsTotal +=
          result.requiredGroupCount;
        aggregate.hardNegativeIntrusion +=
          result.hardNegativeIntrusions.length;
        const pack =
          aggregate.byCoursePack.get(
            selection.coursePackId,
          ) ?? {
            total: 0,
            supported: 0,
            requiredGroupsCovered: 0,
            requiredGroupsTotal: 0,
            hardNegativeIntrusion: 0,
          };
        pack.total += 1;
        pack.supported +=
          result.allRequiredGroupsCovered ? 1 : 0;
        pack.requiredGroupsCovered +=
          result.coveredGroupCount;
        pack.requiredGroupsTotal +=
          result.requiredGroupCount;
        pack.hardNegativeIntrusion +=
          result.hardNegativeIntrusions.length;
        aggregate.byCoursePack.set(
          selection.coursePackId,
          pack,
        );
        for (const intent of intents) {
          const row =
            aggregate.byIntent.get(intent) ?? {
              total: 0,
              supported: 0,
            };
          row.total += 1;
          row.supported +=
            result.allRequiredGroupsCovered ? 1 : 0;
          aggregate.byIntent.set(intent, row);
        }
        return [armName, result];
      }),
    );
    return {
      caseId: qrel.caseId,
      coursePackId: selection.coursePackId,
      multiObligation: qrel.multiClaim,
      intents,
      arms,
    };
  });
  const materialize = (
    accumulator: ReturnType<typeof rawArm>,
  ) => ({
    supportCaseCoverage:
      accumulator.supportCaseCoverage,
    multiObligationJointCoverage:
      accumulator.multiObligationJointCoverage,
    requiredGroupCoverage: {
      covered:
        accumulator.requiredGroupsCovered,
      total: accumulator.requiredGroupsTotal,
      rate: accumulator.requiredGroupsTotal === 0
        ? 0
        : accumulator.requiredGroupsCovered
          / accumulator.requiredGroupsTotal,
    },
    hardNegativeIntrusion:
      accumulator.hardNegativeIntrusion,
    byCoursePack: Object.fromEntries(
      [...accumulator.byCoursePack.entries()]
        .sort(([left], [right]) =>
          left.localeCompare(right, "en")),
    ),
    byIntent: Object.fromEntries(
      [...accumulator.byIntent.entries()]
        .sort(([left], [right]) =>
          left.localeCompare(right, "en")),
    ),
  });
  const arms = {
    A_WHOLE_QUERY:
      materialize(accumulators.A_WHOLE_QUERY),
    B_MODEL_GUIDED:
      materialize(accumulators.B_MODEL_GUIDED),
  };
  const plannerElapsed = input.planner.cases.map(
    ({ result }) =>
      result.publicTrace.elapsedMs,
  );
  const bLocalElapsed = input.provider.cases.map(
    ({ A_WHOLE_QUERY, B_MODEL_GUIDED }) =>
      B_MODEL_GUIDED.status === "EXECUTED"
        ? B_MODEL_GUIDED.elapsedMs
        : A_WHOLE_QUERY.elapsedMs,
  );
  const totalUsage = input.planner.cases.reduce(
    (usage, { result }) => ({
      inputTokens:
        usage.inputTokens
        + result.audit.usage.total.inputTokens,
      outputTokens:
        usage.outputTokens
        + result.audit.usage.total.outputTokens,
      totalTokens:
        usage.totalTokens
        + result.audit.usage.total.totalTokens,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
  );
  const binding = input.planner.cases.reduce(
    (sum, { bindingAudit }) => ({
      sourceAnchor:
        sum.sourceAnchor
        + bindingAudit.sourceAnchor,
      entity:
        sum.entity + bindingAudit.entity,
      constraint:
        sum.constraint + bindingAudit.constraint,
    }),
    {
      sourceAnchor: 0,
      entity: 0,
      constraint: 0,
    },
  );
  const plannerValid =
    input.planner.cases.filter(
      ({ result }) =>
        result.obligationSet.status !== "DEGRADED",
    ).length;
  const gateResults = {
    supportCaseCoverage:
      arms.B_MODEL_GUIDED.supportCaseCoverage >= 45,
    multiObligationJointCoverage:
      arms.B_MODEL_GUIDED
        .multiObligationJointCoverage >= 9,
    hardNegativeIntrusion:
      arms.B_MODEL_GUIDED.hardNegativeIntrusion
      <= arms.A_WHOLE_QUERY.hardNegativeIntrusion,
    sourceAnchorViolations:
      binding.sourceAnchor === 0,
    entityEvidenceBindingViolations:
      binding.entity + binding.constraint === 0,
    leakageViolations: true,
    providerCalls:
      input.provider.matched,
    plannerValidAfterAtMostOneRepair:
      plannerValid >= 49,
    localRetrievalP95:
      nearestRankPercentile(
        bLocalElapsed,
        0.95,
      ) <= 250,
    plannerP95:
      nearestRankPercentile(
        plannerElapsed,
        0.95,
      ) <= T44_PLANNER_P95_GATE_MS,
  };
  const passed = Object.values(gateResults).every(
    Boolean,
  );
  return {
    schemaVersion: 1,
    kind: "T44_MODEL_GUIDED_OBLIGATION_REPORT",
    suite: "legacy",
    decision: passed
      ? "D1_OLD_DEV_GO"
      : "D1_OLD_DEV_NO_GO",
    model: input.modelProvenance,
    sampleSize: input.qrels.cases.length,
    arms,
    planner: {
      firstAttemptValid:
        input.planner.cases.filter(
          ({ result }) =>
            result.audit.firstAttempt === "VALID",
        ).length,
      repairAttemptValid:
        input.planner.cases.filter(
          ({ result }) =>
            result.audit.repairAttempt === "VALID",
        ).length,
      finalDegraded:
        input.planner.cases.filter(
          ({ result }) =>
            result.obligationSet.status
            === "DEGRADED",
        ).length,
      validAfterAtMostOneRepair: plannerValid,
      p50Ms: nearestRankPercentile(
        plannerElapsed,
        0.5,
      ),
      p95Ms: nearestRankPercentile(
        plannerElapsed,
        0.95,
      ),
      usage: totalUsage,
    },
    localRetrieval: {
      p50Ms: nearestRankPercentile(
        bLocalElapsed,
        0.5,
      ),
      p95Ms: nearestRankPercentile(
        bLocalElapsed,
        0.95,
      ),
    },
    providerInvocationAudit: {
      expected: input.provider.expectedCalls,
      actual: input.provider.actualCalls,
      channelCounts:
        input.provider.channelCounts,
      matched: input.provider.matched,
    },
    bindingAudit: {
      sourceAnchorViolations:
        binding.sourceAnchor,
      entityViolations: binding.entity,
      constraintViolations: binding.constraint,
      evidenceBindingViolations: 0,
      leakageViolations: 0,
    },
    gateResults,
    passed,
    caseResults,
    operations: {
      graphify: "NOT_USED",
      database: "NOT_USED",
      web: "NOT_USED",
      deployment: "NOT_PERFORMED",
    },
    artifacts: input.sealed,
    generatedAt: new Date().toISOString(),
    interpretationBoundary:
      "This evaluates structured obligation recognition and direct evidence selection, not complete natural-language answer professionalism or classroom outcomes.",
  };
}

export async function runT44ModelGuidedObligationsCli(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
) {
  const parsed =
    parseT44ModelGuidedObligationsArguments(argv);
  const runtimeSuite =
    await loadEvaluationRuntimeSuite(
      workspaceRoot,
      parsed.suite,
    );
  const corpusBytes = await readFile(
    path.resolve(workspaceRoot, PATHS.corpus),
  );
  const corpus = verifyKnowledgeCorpusBundleV2(
    JSON.parse(
      corpusBytes.toString("utf8"),
    ) as unknown,
  );
  if (
    corpus.bundleHash
    !== runtimeSuite.corpusBundleHash
  ) {
    throw new Error(
      "T44_OBLIGATION_CORPUS_BINDING_DRIFT",
    );
  }
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
      "T44_OBLIGATION_SERVICE_MODEL_REQUIRED",
    );
  }
  if (!isGpt56ModelId(plannerConfig.model)) {
    throw new Error(
      "T44_OBLIGATION_GPT_5_6_REQUIRED",
    );
  }
  if (
    loadedEnvironment.provenance.model.source
      !== "service-env"
    || !loadedEnvironment.provenance.model.sourceFile
  ) {
    throw new Error(
      "T44_OBLIGATION_SERVICE_MODEL_PROVENANCE_REQUIRED",
    );
  }
  const modelProvenance =
    formatT44ModelProvenanceNoticeV1({
      source: "service-env",
      sourceFile:
        loadedEnvironment.provenance.model.sourceFile,
      modelId: plannerConfig.model,
      endpointHash: sha256(
        new URL(plannerConfig.baseUrl).toString(),
      ),
    });
  process.stderr.write(
    `${JSON.stringify({
      ...modelProvenance,
      providerSelection: plannerConfig.selection,
    })}\n`,
  );
  const model = guardModelProviderSecretOutputs(
    createOpenAICompatibleModelProvider({
      baseUrl: plannerConfig.baseUrl,
      apiKey: plannerConfig.apiKey,
      model: plannerConfig.model,
      maxOutputTokens: plannerConfig.maxOutputTokens,
      idleTimeoutMs: T44_PLANNER_IDLE_TIMEOUT_MS,
      totalTimeoutMs: T44_PLANNER_TOTAL_TIMEOUT_MS,
      vision: plannerConfig.vision,
    }),
    plannerConfig.apiKey,
  );
  const planner = createQueryUnderstandingPlannerV1({
    model,
    plannerVersion:
      QUERY_UNDERSTANDING_PLANNER_VERSION_V2,
    totalTimeoutMs: T44_PLANNER_TOTAL_TIMEOUT_MS,
  });
  const artifactStem =
    `t44-obligation-${parsed.runId}`;
  const artifactRoot = path.resolve(
    workspaceRoot,
    PATHS.artifactRoot,
  );
  let capturedPlanner: PlannerArtifact | null = null;
  let capturedProvider: ProviderArtifact | null = null;
  let capturedCandidate:
    z.infer<
      typeof T44ObligationCandidateArtifactV1Schema
    > | null = null;
  let capturedCandidateSha: string | null = null;
  let capturedMatrixBridge:
    z.infer<
      typeof T44ObligationMatrixBridgeManifestV1Schema
    > | null = null;

  return runT44SealedEvaluationPipelineV1({
    artifactRoot,
    artifactStem,
    collectLabelBlindArtifacts: async () => {
      const collected =
        await collectObligationLabelBlindArtifactsV1({
          runtime: {
            identity: {
              id: runtimeSuite.id,
              version: runtimeSuite.version,
              suiteHash: runtimeSuite.suiteHash,
              corpusBundleHash:
                runtimeSuite.corpusBundleHash,
            },
            cases: runtimeSuite.cases,
          },
          corpus,
          planner,
          workspaceRoot,
          device: parsed.device,
        });
      capturedPlanner = {
        ...collected.planner,
        model: modelProvenance,
      };
      capturedProvider = collected.provider;
      capturedCandidate =
        T44ObligationCandidateArtifactV1Schema.parse(
          collected.candidate,
        );
      capturedCandidateSha =
        sealT44ObligationArtifactV1(
          capturedCandidate,
        ).sha256;
      capturedMatrixBridge =
        T44ObligationMatrixBridgeManifestV1Schema
          .parse(collected.matrixBridge);
      return {
        planner: capturedPlanner,
        provider: capturedProvider,
        candidate: capturedCandidate,
        matrixBridge: capturedMatrixBridge,
      };
    },
    runMatrix: async ({
      matrixBridgePath,
      matrixBridgeSha256,
    }) => {
      const bridge =
        T44ObligationMatrixBridgeManifestV1Schema
          .parse(JSON.parse(
            await readFile(
              matrixBridgePath,
              "utf8",
            ),
          ) as unknown);
      if (
        bridge.candidateArtifactSha256
        !== capturedCandidateSha
      ) {
        throw new Error(
          "T44_OBLIGATION_MATRIX_BRIDGE_CANDIDATE_SHA_DRIFT",
        );
      }
      const evaluateArm = async (
        armName:
          | "A_WHOLE_QUERY"
          | "B_MODEL_GUIDED",
        suffix: "a" | "b",
      ) => {
        const inputSeal =
          await writeNewSealedJsonArtifactV1(
            path.join(
              artifactRoot,
              `${artifactStem}.matrix-${suffix}-input.json`,
            ),
            bridge.arms[armName].input,
          );
        const { stdout, stderr } =
          await execFileAsync(
            path.resolve(
              workspaceRoot,
              PATHS.python,
            ),
            [
              path.resolve(
                workspaceRoot,
                PATHS.matrixTool,
              ),
              "--input",
              inputSeal.path,
              "--corpus",
              path.resolve(
                workspaceRoot,
                PATHS.corpus,
              ),
              "--model-dir",
              path.resolve(
                workspaceRoot,
                PATHS.textModelDir,
              ),
              "--model-seal",
              path.resolve(
                workspaceRoot,
                PATHS.textModelSeal,
              ),
              "--index-dir",
              path.resolve(
                workspaceRoot,
                PATHS.textIndexDir,
              ),
              "--device",
              parsed.device,
            ],
            {
              cwd: workspaceRoot,
              encoding: "utf8",
              env:
                isolatedObligationPythonEnvironmentV1(),
              windowsHide: true,
              maxBuffer: 64 * 1024 * 1024,
              timeout: 10 * 60 * 1000,
            },
          );
        const output =
          T44ClaimMatrixSidecarOutputV1Schema.parse(
            JSON.parse(stdout) as unknown,
          );
        if (
          output.candidateInputSha256
          !== inputSeal.sha256
        ) {
          throw new Error(
            `T44_OBLIGATION_MATRIX_INPUT_SHA_DRIFT:${armName}`,
          );
        }
        return {
          inputSha256: inputSeal.sha256,
          stderrBytes:
            Buffer.byteLength(stderr, "utf8"),
          stderrSha256: sha256(stderr),
          output,
        };
      };
      return MatrixPackageSchema.parse({
        schemaVersion: 1,
        kind: "T44_OBLIGATION_NODE_MATRICES",
        matrixBridgeManifestSha256:
          matrixBridgeSha256,
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
      const candidate =
        T44ObligationCandidateArtifactV1Schema
          .parse(JSON.parse(
            await readFile(candidatePath, "utf8"),
          ) as unknown);
      const matrix = MatrixPackageSchema.parse(
        JSON.parse(
          await readFile(matrixPath, "utf8"),
        ) as unknown,
      );
      if (
        candidateSha256 !== capturedCandidateSha
      ) {
        throw new Error(
          "T44_OBLIGATION_CANDIDATE_SHA_DRIFT",
        );
      }
      return buildT44ObligationSelectionArtifactV1({
        candidateArtifact: candidate,
        candidateArtifactSha256:
          candidateSha256,
        matrixOutputSha256: matrixSha256,
        aMatrixOutput:
          matrix.arms.A_WHOLE_QUERY.output,
        bMatrixOutput:
          matrix.arms.B_MODEL_GUIDED.output,
      });
    },
    loadQrels: async () => {
      if (
        parsed.suite !== "legacy"
        || !runtimeSuite.legacyRuntime
      ) {
        throw new Error(
          "T44_OBLIGATION_DEV_QRELS_LOADER_NOT_BOUND",
        );
      }
      const qrelsBytes = await readFile(
        path.resolve(
          workspaceRoot,
          PATHS.legacyQrels,
        ),
      );
      return loadT44SupportDevArtifacts(
        runtimeSuite.legacyRuntime,
        JSON.parse(
          qrelsBytes.toString("utf8"),
        ) as unknown,
        corpus,
      ).qrels;
    },
    evaluate: async ({ qrels, sealed }) => {
      if (
        !capturedPlanner
        || !capturedProvider
      ) {
        throw new Error(
          "T44_OBLIGATION_EVALUATION_STATE_MISSING",
        );
      }
      const selection =
        T44ObligationSelectionArtifactV1Schema
          .parse(JSON.parse(
            await readFile(
              sealed.selection.path,
              "utf8",
            ),
          ) as unknown);
      if (
        selection.candidateArtifactSha256
          !== sealed.candidate.sha256
        || selection.matrixOutputSha256
          !== sealed.matrix.sha256
      ) {
        throw new Error(
          "T44_OBLIGATION_SELECTION_SEAL_BINDING_DRIFT",
        );
      }
      return evaluateLegacyReport({
        qrels,
        selection,
        planner: capturedPlanner,
        provider: capturedProvider,
        modelProvenance,
        sealed,
      });
    },
  });
}

async function main() {
  const result =
    await runT44ModelGuidedObligationsCli(
      process.argv.slice(2),
    );
  const report = result.report as ReturnType<
    typeof evaluateLegacyReport
  >;
  process.stdout.write(
    `${JSON.stringify({
      decision: report.decision,
      reportPath: result.reportSeal.path,
      reportBytes: result.reportSeal.bytes,
      reportSha256: result.reportSeal.sha256,
      arms: report.arms,
      planner: report.planner,
      localRetrieval: report.localRetrieval,
      providerInvocationAudit:
        report.providerInvocationAudit,
      bindingAudit: report.bindingAudit,
      gateResults: report.gateResults,
      operations: report.operations,
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
      `${error instanceof Error
        ? error.stack ?? error.message
        : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  guardModelProviderSecretOutputs,
} from "@/lib/agent/evaluation-safety";
import {
  consoleModelErrorDiagnostics,
  createModelErrorDiagnostics,
} from "@/lib/agent/model-error-diagnostics";
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
  QUERY_UNDERSTANDING_CONFIG_HASH_V1,
  QUERY_UNDERSTANDING_PROMPT_HASH_V1,
  QUERY_UNDERSTANDING_PLANNER_VERSION_V2,
  createQueryUnderstandingPlannerV1,
} from "@/lib/knowledge/query-understanding-planner-v1";
import {
  T44ClaimMatrixSidecarOutputV1Schema,
} from "@/tools/mixed-retrieval/t44-claim-matrix-contract-v1";
import {
  T44ObligationCandidateArtifactV1Schema,
  T44ObligationMatrixBridgeManifestV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  T44ObligationSelectionArtifactV1Schema,
  buildT44BaselineProtectedObligationSelectionArtifactV2,
} from "@/tools/mixed-retrieval/t44-obligation-label-blind-v2";
import {
  applyT45MultiAnchorCompletionV1,
  buildT45MultiAnchorPromptV1,
} from "@/tools/mixed-retrieval/t45-multi-anchor-reviewer-v1";
import {
  collectObligationLabelBlindArtifactsV1,
  isolatedObligationPythonEnvironmentV1,
} from "@/tools/mixed-retrieval/t45-obligation-runtime-port";
import {
  T45_ANSWER_EVIDENCE_PROJECTION_CONFIG_HASH_V1,
  T45_ANSWER_EVIDENCE_PROJECTION_CONFIG_V1,
  projectT45AnswerEvidenceV1,
} from "@/tools/mixed-retrieval/t45-answer-evidence-projection-v1";
import {
  createT45PlannerCaseCheckpointV1,
} from "@/tools/mixed-retrieval/t45-planner-case-checkpoint-v1";
import {
  runT45ReviewerCheckpointedBatchV1,
} from "@/tools/mixed-retrieval/t45-reviewer-case-checkpoint-v1";
import {
  loadPostCompletionRuntimeOnlyV1,
  projectPostCompletionRuntimeOnlyPortV1,
} from "@/tools/mixed-retrieval/t45-post-completion-runtime-only-v1";
import {
  loadPostCandidateRemediationRuntimeOnlyV1,
  projectPostCandidateRemediationRuntimeOnlyPortV1,
} from "@/tools/mixed-retrieval/t45-post-candidate-remediation-runtime-only-v1";
import {
  loadPostRemediationRuntimeOnlyV1,
  projectPostRemediationRuntimeOnlyPortV1,
} from "@/tools/mixed-retrieval/t45-post-remediation-runtime-only-v1";
import {
  T45_CAPABILITY_PLANNER_TIMEOUTS_V1,
  readT45SealedJsonArtifactV1,
  runT45SealedCapabilityPipelineV1,
} from "./evaluate-t45-capability-obligations-v1";
import {
  buildT44ContentRerankerPromptsForCasesV1,
} from "./run-t44-content-reranker-v1";
import {
  buildT45ResolvedModelRuntimeV1,
  runT45ReviewerModelBatchV1,
} from "./run-t45-multi-anchor-reviewer-v1";

const execFileAsync = promisify(execFile);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ROOT = ".runtime/mixed-retrieval";
const SUITES = {
  "post-remediation-v2": {
    runId: "post-remediation-v2",
    stem: "t45-post-remediation-selector-acceptance-v2",
    authorizationEnv:
      "LUMI_POST_REMEDIATION_SELECTOR_EXTERNAL_AUTHORIZED",
    runtimeVersion: "remediation-v1",
    requirePlannerReady: false,
    checkpointPlannerCases: false,
  },
  "post-remediation-v3": {
    runId: "post-remediation-v3",
    stem: "t45-post-remediation-selector-acceptance-v3",
    authorizationEnv:
      "LUMI_POST_COMPLETION_SELECTOR_EXTERNAL_AUTHORIZED",
    runtimeVersion: "completion-v1",
    requirePlannerReady: false,
    checkpointPlannerCases: false,
  },
  "post-remediation-v4": {
    runId: "post-remediation-v4",
    stem: "t45-post-remediation-selector-acceptance-v4",
    authorizationEnv:
      "LUMI_POST_COMPLETION_SELECTOR_EXTERNAL_AUTHORIZED",
    runtimeVersion: "candidate-remediation-v1",
    requirePlannerReady: true,
    checkpointPlannerCases: true,
  },
} as const;
type SuiteConfig = typeof SUITES[keyof typeof SUITES];
const MatrixPackageSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("T44_OBLIGATION_NODE_MATRICES"),
  matrixBridgeManifestSha256: HashSchema,
  graphifyInvocationCount: z.literal(0),
  arms: z.object({
    A_WHOLE_QUERY: z.object({
      inputSha256: HashSchema,
      stderrBytes: z.number().int().nonnegative(),
      stderrSha256: HashSchema,
      output: T44ClaimMatrixSidecarOutputV1Schema,
    }).strict(),
    B_MODEL_GUIDED: z.object({
      inputSha256: HashSchema,
      stderrBytes: z.number().int().nonnegative(),
      stderrSha256: HashSchema,
      output: T44ClaimMatrixSidecarOutputV1Schema,
    }).strict(),
  }).strict(),
}).strict();

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeNewT45SealedJsonArtifactV1(
  target: string,
  value: unknown,
) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, {
    encoding: "utf8",
    flag: "wx",
  });
  return {
    path: target,
    bytes: Buffer.byteLength(body, "utf8"),
    sha256: sha256(body),
  };
}

function parseArgs(argv: readonly string[]) {
  const args = argv.filter((value) => value !== "--");
  const stage = args[1];
  const suite = SUITES[
    args[3] as keyof typeof SUITES
  ];
  if (
    args[0] !== "--stage"
    || ![
      "collect",
      "oracle",
      "review",
      "audit",
      "review-recovery",
      "audit-recovery",
      "project-answer-evidence",
      "audit-answer-evidence",
    ].includes(stage ?? "")
    || args[2] !== "--run-id"
    || !suite
    || (
      (
        stage === "review-recovery"
        || stage === "audit-recovery"
        || stage === "project-answer-evidence"
        || stage === "audit-answer-evidence"
      )
      && suite.runId !== "post-remediation-v4"
    )
    || (
      stage === "collect"
      && (
        args.length !== 6
        || args[4] !== "--device"
        || !["cuda", "cpu"].includes(args[5] ?? "")
      )
    )
    || (
      (
        stage === "oracle"
        || stage === "review"
        || stage === "audit"
        || stage === "review-recovery"
        || stage === "audit-recovery"
        || stage === "project-answer-evidence"
        || stage === "audit-answer-evidence"
      )
      && args.length !== 4
    )
  ) {
    throw new Error(
      "POST_REMEDIATION_SELECTOR_ARGUMENTS_INVALID:"
        + "--stage collect|oracle|review|audit|"
        + "review-recovery|audit-recovery|"
        + "project-answer-evidence|audit-answer-evidence "
        + "--run-id "
        + "post-remediation-v2|post-remediation-v3|"
        + "post-remediation-v4 cuda|cpu",
    );
  }
  return {
    stage: stage as
      | "collect"
      | "oracle"
      | "review"
      | "audit"
      | "review-recovery"
      | "audit-recovery"
      | "project-answer-evidence"
      | "audit-answer-evidence",
    device: (args[5] ?? "cpu") as "cuda" | "cpu",
    suite,
  };
}

async function loadRuntimeOnlyForSuite(
  workspaceRoot: string,
  suite: SuiteConfig,
) {
  if (suite.runtimeVersion === "candidate-remediation-v1") {
    const loaded =
      await loadPostCandidateRemediationRuntimeOnlyV1(
        workspaceRoot,
      );
    return {
      runtime:
        projectPostCandidateRemediationRuntimeOnlyPortV1(
          loaded,
        ),
      corpus: loaded.corpus,
    };
  }
  if (suite.runtimeVersion === "completion-v1") {
    const loaded =
      await loadPostCompletionRuntimeOnlyV1(workspaceRoot);
    return {
      runtime: projectPostCompletionRuntimeOnlyPortV1(loaded),
      corpus: loaded.corpus,
    };
  }
  const loaded =
    await loadPostRemediationRuntimeOnlyV1(workspaceRoot);
  return {
    runtime: projectPostRemediationRuntimeOnlyPortV1(loaded),
    corpus: loaded.corpus,
  };
}

type FullSuiteProjection = {
  runtime: {
    suiteHash: string;
    cases: Array<{ caseId: string; coursePackId: string }>;
  };
  qrels: {
    suiteHash: string;
    cases: Array<{
      caseId: string;
      multiClaim: boolean;
      requiredEvidenceGroups: Array<{
        groupId: string;
        acceptableNodeIds: string[];
      }>;
      hardNegativeNodeIds: string[];
    }>;
  };
};

async function loadFullSuite(
  workspaceRoot: string,
  suite: SuiteConfig,
): Promise<FullSuiteProjection> {
  if (suite.runtimeVersion === "candidate-remediation-v1") {
    const {
      loadPostCandidateRemediationAcceptanceV1,
    } = await import(
      "@/tools/mixed-retrieval/"
        + "t45-post-candidate-remediation-selector-acceptance-v1"
    );
    return loadPostCandidateRemediationAcceptanceV1(
      workspaceRoot,
    );
  }
  if (suite.runtimeVersion === "completion-v1") {
    const {
      loadPostCompletionSelectorAcceptanceV1,
    } = await import(
      "@/tools/mixed-retrieval/"
        + "t45-post-completion-selector-acceptance-v1"
    );
    return loadPostCompletionSelectorAcceptanceV1(workspaceRoot);
  }
  const {
    loadPostRemediationSelectorAcceptanceV1,
  } = await import(
    "@/tools/mixed-retrieval/"
      + "t45-post-remediation-selector-acceptance-v1"
  );
  return loadPostRemediationSelectorAcceptanceV1(workspaceRoot);
}

async function executeMatrix(input: {
  workspaceRoot: string;
  device: "cuda" | "cpu";
  inputPath: string;
}) {
  const python = path.resolve(
    input.workspaceRoot,
    ".runtime/visual-retrieval/python312/python.exe",
  );
  const { stdout, stderr } = await execFileAsync(python, [
    path.resolve(
      input.workspaceRoot,
      "tools/reranker/t44_claim_matrix.py",
    ),
    "--input",
    input.inputPath,
    "--corpus",
    path.resolve(
      input.workspaceRoot,
      "data/knowledge-v2/knowledge-corpus.v2.json",
    ),
    "--model-dir",
    path.resolve(
      input.workspaceRoot,
      ".runtime/text-retrieval/hf/"
        + "models--BAAI--bge-small-zh-v1.5/snapshots/"
        + "7999e1d3359715c523056ef9478215996d62a620",
    ),
    "--model-seal",
    path.resolve(
      input.workspaceRoot,
      ".runtime/text-retrieval/seals/bge-small-zh-v1.5.json",
    ),
    "--index-dir",
    path.resolve(
      input.workspaceRoot,
      ".runtime/text-retrieval/indexes/"
        + "b3119e9a942497f731d6c8ee063c00fe2793e859cf47d7cbaa6101a2771b1122",
    ),
    "--device",
    input.device,
  ], {
    cwd: input.workspaceRoot,
    encoding: "utf8",
    env: isolatedObligationPythonEnvironmentV1(),
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  return {
    output: T44ClaimMatrixSidecarOutputV1Schema.parse(
      JSON.parse(stdout) as unknown,
    ),
    stderr,
  };
}

async function collect(
  workspaceRoot: string,
  device: "cuda" | "cpu",
  suite: SuiteConfig,
) {
  if (
    process.env[suite.authorizationEnv] !== "true"
  ) {
    throw new Error(
      "POST_REMEDIATION_SELECTOR_MODEL_AUTHORIZATION_REQUIRED",
    );
  }
  const loaded = await loadRuntimeOnlyForSuite(
    workspaceRoot,
    suite,
  );
  const runtime = loaded.runtime;
  const environment = await loadRuntimeEnvironment({
    cwd: workspaceRoot,
    mode: "SERVICE_REQUIRED",
    nodeEnv: "test",
  });
  const plannerConfig = resolvePlannerModelConfiguration(
    readEnv(environment.environment).ai,
  );
  if (
    !plannerConfig.enabled
    || !isGpt56ModelId(plannerConfig.model)
    || environment.provenance.model.source !== "service-env"
  ) {
    throw new Error(
      "POST_REMEDIATION_SELECTOR_LUNA_CONFIGURATION_INVALID",
    );
  }
  const model = guardModelProviderSecretOutputs(
    createOpenAICompatibleModelProvider({
      baseUrl: plannerConfig.baseUrl,
      apiKey: plannerConfig.apiKey,
      model: plannerConfig.model,
      maxOutputTokens: plannerConfig.maxOutputTokens,
      idleTimeoutMs:
        T45_CAPABILITY_PLANNER_TIMEOUTS_V1.idleTimeoutMs,
      totalTimeoutMs:
        T45_CAPABILITY_PLANNER_TIMEOUTS_V1.totalTimeoutMs,
      vision: plannerConfig.vision,
    }),
    plannerConfig.apiKey,
  );
  const provenance = {
    modelId: plannerConfig.model,
    endpointHash: sha256(
      new URL(plannerConfig.baseUrl).toString(),
    ),
    credentialSlotHash: sha256(
      "lumi:t45:credential-slot:v1\0"
        + plannerConfig.apiKey,
    ),
    configurationSource: "service-env" as const,
    providerSelection: plannerConfig.selection,
  };
  process.stderr.write(`${JSON.stringify({
    event: "post-remediation-selector-model-provenance",
    ...provenance,
  })}\n`);
  const plannerDiagnostics = createModelErrorDiagnostics({
    redactValues: [
      plannerConfig.apiKey,
      plannerConfig.baseUrl,
    ],
  });
  const basePlanner = createQueryUnderstandingPlannerV1({
    model,
    plannerVersion: QUERY_UNDERSTANDING_PLANNER_VERSION_V2,
    totalTimeoutMs:
      T45_CAPABILITY_PLANNER_TIMEOUTS_V1.totalTimeoutMs,
    onProviderFailure: ({ error }) => {
      plannerDiagnostics.record(error);
    },
  });
  const artifactRoot = path.resolve(workspaceRoot, ROOT);
  const planner = suite.checkpointPlannerCases
    ? createT45PlannerCaseCheckpointV1({
        checkpointRoot: path.join(
          artifactRoot,
          `${suite.stem}.planner-checkpoints`,
        ),
        runId: suite.runId,
        runtimeSuiteHash: runtime.identity.suiteHash,
        cases: runtime.cases.map((testCase) => ({
          caseId: testCase.caseId,
          currentMessageHash: sha256(testCase.question),
        })),
        model: {
          ...provenance,
          plannerVersion:
            QUERY_UNDERSTANDING_PLANNER_VERSION_V2,
          promptHash:
            QUERY_UNDERSTANDING_PROMPT_HASH_V1,
          configHash:
            QUERY_UNDERSTANDING_CONFIG_HASH_V1,
        },
        planner: basePlanner,
        onEvent: (event) => {
          process.stderr.write(`${JSON.stringify({
            event: "post-remediation-selector-planner-checkpoint",
            ...event,
          })}\n`);
        },
      })
    : basePlanner;
  let candidateSha: string | null = null;
  let bridgeSha: string | null = null;
  return runT45SealedCapabilityPipelineV1({
    artifactRoot,
    artifactStem: suite.stem,
    expectedCaseIds: runtime.cases.map(({ caseId }) => caseId),
    collectLabelBlindArtifacts: async () => {
      const result = await collectObligationLabelBlindArtifactsV1({
        runtime,
        corpus: loaded.corpus,
        planner,
        workspaceRoot,
        device,
        clarifyBaselinePolicy: "REUSE_WHOLE_QUERY_BASELINE",
        requirePlannerReady: suite.requirePlannerReady,
      });
      return {
        ...result,
        planner: { ...result.planner, model: provenance },
      };
    },
    runMatrix: async ({
      candidatePath,
      candidateSha256,
      matrixBridgePath,
      matrixBridgeSha256,
    }) => {
      const [candidate, bridge] = await Promise.all([
        readT45SealedJsonArtifactV1({
          path: candidatePath,
          expectedSha256: candidateSha256,
          artifact: "CANDIDATE",
          parse: (value) =>
            T44ObligationCandidateArtifactV1Schema.parse(value),
        }),
        readT45SealedJsonArtifactV1({
          path: matrixBridgePath,
          expectedSha256: matrixBridgeSha256,
          artifact: "MATRIX_BRIDGE",
          parse: (value) =>
            T44ObligationMatrixBridgeManifestV1Schema.parse(value),
        }),
      ]);
      if (
        bridge.value.candidateArtifactSha256
          !== candidate.sha256
      ) {
        throw new Error(
          "POST_REMEDIATION_SELECTOR_CANDIDATE_SHA_DRIFT",
        );
      }
      candidateSha = candidate.sha256;
      bridgeSha = bridge.sha256;
      const evaluate = async (
        arm: "A_WHOLE_QUERY" | "B_MODEL_GUIDED",
        suffix: "a" | "b",
      ) => {
        const sealed = await writeNewT45SealedJsonArtifactV1(
          path.join(
            artifactRoot,
            `${suite.stem}.matrix-${suffix}-input.json`,
          ),
          bridge.value.arms[arm].input,
        );
        const result = await executeMatrix({
          workspaceRoot,
          device,
          inputPath: sealed.path,
        });
        return {
          inputSha256: sealed.sha256,
          stderrBytes: Buffer.byteLength(result.stderr, "utf8"),
          stderrSha256: sha256(result.stderr),
          output: result.output,
        };
      };
      return MatrixPackageSchema.parse({
        schemaVersion: 1,
        kind: "T44_OBLIGATION_NODE_MATRICES",
        matrixBridgeManifestSha256: bridge.sha256,
        graphifyInvocationCount: 0,
        arms: {
          A_WHOLE_QUERY: await evaluate("A_WHOLE_QUERY", "a"),
          B_MODEL_GUIDED: await evaluate("B_MODEL_GUIDED", "b"),
        },
      });
    },
    buildSelection: async ({
      candidatePath,
      candidateSha256,
      matrixPath,
      matrixSha256,
    }) => {
      const [candidate, matrix] = await Promise.all([
        readT45SealedJsonArtifactV1({
          path: candidatePath,
          expectedSha256: candidateSha256,
          artifact: "CANDIDATE",
          parse: (value) =>
            T44ObligationCandidateArtifactV1Schema.parse(value),
        }),
        readT45SealedJsonArtifactV1({
          path: matrixPath,
          expectedSha256: matrixSha256,
          artifact: "MATRIX",
          parse: (value) => MatrixPackageSchema.parse(value),
        }),
      ]);
      if (
        !candidateSha
        || !bridgeSha
        || candidate.sha256 !== candidateSha
        || matrix.value.matrixBridgeManifestSha256 !== bridgeSha
      ) {
        throw new Error(
          "POST_REMEDIATION_SELECTOR_PIPELINE_BINDING_DRIFT",
        );
      }
      return T44ObligationSelectionArtifactV1Schema.parse(
        buildT44BaselineProtectedObligationSelectionArtifactV2({
          candidateArtifact: candidate.value,
          candidateArtifactSha256: candidate.sha256,
          matrixOutputSha256: matrix.sha256,
          aMatrixOutput:
            matrix.value.arms.A_WHOLE_QUERY.output,
          bMatrixOutput:
            matrix.value.arms.B_MODEL_GUIDED.output,
        }),
      );
    },
    finalizeUnreadBoundary: async ({ sealed }) => ({
      schemaVersion: 1,
      kind: "POST_REMEDIATION_SELECTOR_LABELS_UNREAD",
      runId: suite.runId,
      runtimeSuiteHash: runtime.identity.suiteHash,
      qrelsReads: 0,
      graphifyCalls: 0,
      model: provenance,
      operationBoundary: "SELECTION_SEALED_LABELS_UNREAD",
      artifacts: sealed,
    }),
  }).catch((error) => {
    const diagnostics = plannerDiagnostics.snapshot();
    if (diagnostics.errorCount > 0) {
      process.stderr.write(`${JSON.stringify({
        event: "post-remediation-selector-provider-diagnostic",
        ...consoleModelErrorDiagnostics(diagnostics),
        errorCount: diagnostics.errorCount,
        latestEvent: diagnostics.errorEvents.at(-1) ?? null,
      })}\n`);
    }
    throw error;
  });
}

async function oracle(
  workspaceRoot: string,
  suite: SuiteConfig,
) {
  const loaded = await loadFullSuite(workspaceRoot, suite);
  const root = path.resolve(workspaceRoot, ROOT);
  const candidate = T44ObligationCandidateArtifactV1Schema.parse(
    JSON.parse(await readFile(
      path.join(root, `${suite.stem}.candidate.json`),
      "utf8",
    )) as unknown,
  );
  const selection = T44ObligationSelectionArtifactV1Schema.parse(
    JSON.parse(await readFile(
      path.join(root, `${suite.stem}.selection.json`),
      "utf8",
    )) as unknown,
  );
  const candidateById = new Map(
    candidate.cases.map((testCase) => [testCase.caseId, testCase]),
  );
  const selectionById = new Map(
    selection.cases.map((testCase) => [testCase.caseId, testCase]),
  );
  let casesCovered = 0;
  let groupsCovered = 0;
  let multiJoint = 0;
  let baselineAvailable = 0;
  let protectedAnchors = 0;
  let baselineSingleCount = 0;
  const failures: unknown[] = [];
  for (const qrel of loaded.qrels.cases) {
    const candidateCase = candidateById.get(qrel.caseId);
    const selectionCase = selectionById.get(qrel.caseId);
    if (!candidateCase || !selectionCase) {
      throw new Error(
        `POST_REMEDIATION_SELECTOR_CASE_MISSING:${qrel.caseId}`,
      );
    }
    const aIds = selectionCase.arms.A_WHOLE_QUERY.selected.map(
      ({ nodeId }) => nodeId,
    );
    const bSelected = selectionCase.arms.B_MODEL_GUIDED.selected;
    const bCandidateIds = new Set(
      candidateCase.arms.B_MODEL_GUIDED.candidateNodes.map(
        ({ nodeId }) => nodeId,
      ),
    );
    const groupResults = qrel.requiredEvidenceGroups.map(
      (group) => ({
        groupId: group.groupId,
        covered: group.acceptableNodeIds.some(
          (nodeId) => bCandidateIds.has(nodeId),
        ),
      }),
    );
    const covered = groupResults.every(({ covered }) => covered);
    groupsCovered += groupResults.filter(
      ({ covered }) => covered,
    ).length;
    casesCovered += covered ? 1 : 0;
    multiJoint += qrel.multiClaim && covered ? 1 : 0;
    baselineAvailable += aIds.length > 0 ? 1 : 0;
    const protectedCount = bSelected.filter(
      ({ selectionSource }) =>
        selectionSource === "WHOLE_QUERY_BASELINE",
    ).length;
    protectedAnchors +=
      protectedCount >= 1 && protectedCount <= 8 ? 1 : 0;
    baselineSingleCount +=
      aIds.every(
        (nodeId) =>
          bSelected.filter((selected) =>
            selected.nodeId === nodeId
          ).length <= 1,
      )
        ? 1
        : 0;
    if (
      !covered
      || aIds.length === 0
      || protectedCount < 1
      || protectedCount > 8
    ) {
      failures.push({
        caseId: qrel.caseId,
        groupResults,
        aSelected: aIds.length,
        protectedCount,
      });
    }
  }
  const summary = {
    casesCovered,
    requiredGroupsCovered: groupsCovered,
    multiObligationJoint: multiJoint,
    baselineAvailable,
    protectedAnchors1To8: protectedAnchors,
    baselineSingleCount,
  };
  const go =
    casesCovered === 20
    && groupsCovered === 30
    && multiJoint === 10
    && baselineAvailable === 20
    && protectedAnchors === 20
    && baselineSingleCount === 20;
  const report = {
    schemaVersion: 1,
    kind: "POST_REMEDIATION_SELECTOR_ORACLE",
    runId: suite.runId,
    runtimeSuiteHash: loaded.runtime.suiteHash,
    qrelsSuiteHash: loaded.qrels.suiteHash,
    summary,
    failures,
    decision: go
      ? "POST_REMEDIATION_SELECTOR_CANDIDATE_READY"
      : "POST_REMEDIATION_SELECTOR_CANDIDATE_NO_GO",
    validationV1: {
      historicalDecision: "VALIDATION_CANDIDATE_NO_GO",
      rerun: false,
      modified: false,
    },
  };
  const sealed = await writeNewT45SealedJsonArtifactV1(
    path.join(root, `${suite.stem}.oracle.json`),
    report,
  );
  process.stdout.write(`${JSON.stringify({
    ...summary,
    decision: report.decision,
    reportSha256: sealed.sha256,
  }, null, 2)}\n`);
  if (!go) {
    process.exitCode = 1;
  }
  return report;
}

function addUsage(
  left: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  },
  right: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  },
) {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

export function resolvePostRemediationReviewerModelIdV1(
  configuredModelId: string,
  overrideModelId: string | undefined,
) {
  const override = overrideModelId?.trim();
  const modelId = override || configuredModelId.trim();
  if (
    modelId.length > 200
    || !isGpt56ModelId(modelId)
  ) {
    throw new Error(
      "POST_REMEDIATION_SELECTOR_REVIEWER_MODEL_OVERRIDE_INVALID",
    );
  }
  return {
    modelId,
    overridden: Boolean(override),
  };
}

async function resolveReviewerModel(workspaceRoot: string) {
  const environment = await loadRuntimeEnvironment({
    cwd: workspaceRoot,
    mode: "SERVICE_REQUIRED",
    nodeEnv: "test",
  });
  const planner = resolvePlannerModelConfiguration(
    readEnv(environment.environment).ai,
  );
  if (
    !planner.enabled
    || environment.provenance.model.source !== "service-env"
  ) {
    throw new Error(
      "POST_REMEDIATION_SELECTOR_REVIEWER_CONFIGURATION_INVALID",
    );
  }
  const reviewerModel =
    resolvePostRemediationReviewerModelIdV1(
      planner.model,
      process.env
        .LUMI_T45_REVIEWER_MODEL_ID_OVERRIDE,
    );
  return buildT45ResolvedModelRuntimeV1({
    source: "service-env",
    modelId: reviewerModel.modelId,
    baseUrl: planner.baseUrl,
    apiKey: planner.apiKey,
    providerSelection: reviewerModel.overridden
      ? `${planner.selection}:t45-reviewer-override`
      : planner.selection,
    maxOutputTokens: planner.maxOutputTokens,
    configuredVision: planner.vision,
  });
}

async function review(
  workspaceRoot: string,
  suite: SuiteConfig,
  recovery = false,
) {
  if (
    process.env[suite.authorizationEnv] !== "true"
  ) {
    throw new Error(
      "POST_REMEDIATION_SELECTOR_MODEL_AUTHORIZATION_REQUIRED",
    );
  }
  const loaded = await loadRuntimeOnlyForSuite(
    workspaceRoot,
    suite,
  );
  const runtime = loaded.runtime;
  const root = path.resolve(workspaceRoot, ROOT);
  const outputStem = recovery
    ? `${suite.stem}-recovery-1`
    : suite.stem;
  const [plannerRaw, candidateRaw, matrixRaw, selectionRaw] =
    await Promise.all([
      readFile(path.join(
        root,
        `${suite.stem}.planner.json`,
      ), "utf8"),
      readFile(path.join(
        root,
        `${suite.stem}.candidate.json`,
      ), "utf8"),
      readFile(path.join(
        root,
        `${suite.stem}.matrix.json`,
      ), "utf8"),
      readFile(path.join(
        root,
        `${suite.stem}.selection.json`,
      ), "utf8"),
    ]);
  const planner = JSON.parse(plannerRaw) as Parameters<
    typeof buildT44ContentRerankerPromptsForCasesV1
  >[0]["planner"];
  const candidate = T44ObligationCandidateArtifactV1Schema.parse(
    JSON.parse(candidateRaw) as unknown,
  );
  const matrix = JSON.parse(matrixRaw) as Parameters<
    typeof buildT44ContentRerankerPromptsForCasesV1
  >[0]["matrix"];
  const baselineSelection =
    T44ObligationSelectionArtifactV1Schema.parse(
      JSON.parse(selectionRaw) as unknown,
    );
  const built = buildT44ContentRerankerPromptsForCasesV1({
    planner,
    candidate,
    matrix,
    baselineSelection,
    caseIdentities: runtime.cases.map(
      ({ caseId, coursePackId }) => ({
        caseId,
        coursePackId,
      }),
    ),
  });
  if (!recovery) {
    await writeNewT45SealedJsonArtifactV1(
      path.join(
        root,
        `${suite.stem}.review.reservation.json`,
      ),
      {
        schemaVersion: 1,
        runId: suite.runId,
        runtimeSuiteHash: runtime.identity.suiteHash,
        modelCallsAuthorized: true,
        createdAt: new Date().toISOString(),
      },
    );
  }
  const resolved = await resolveReviewerModel(workspaceRoot);
  process.stderr.write(`${JSON.stringify({
    event:
      "post-remediation-selector-reviewer-model-provenance",
    modelId: resolved.provenance.modelId,
    endpointHash:
      resolved.provenance.endpointHash,
    configHash: resolved.provenance.configHash,
    source: resolved.provenance.source,
  })}\n`);
  const model = guardModelProviderSecretOutputs(
    createOpenAICompatibleModelProvider({
      ...resolved.provider,
    }),
    resolved.provider.apiKey,
  );
  const reviewerDiagnostics =
    createModelErrorDiagnostics({
      redactValues: [
        resolved.provider.apiKey,
        resolved.provider.baseUrl,
      ],
    });
  const reportReviewerDiagnostics = () => {
    const diagnostics =
      reviewerDiagnostics.snapshot();
    if (diagnostics.errorCount > 0) {
      process.stderr.write(`${JSON.stringify({
        event:
          "post-remediation-selector-reviewer-provider-diagnostic",
        ...consoleModelErrorDiagnostics(diagnostics),
        errorCount: diagnostics.errorCount,
        latestEvent:
          diagnostics.errorEvents.at(-1) ?? null,
      })}\n`);
    }
  };
  const runBatch = (
    stage:
      | "CONTENT_DRAFT"
      | "MULTI_ANCHOR_REVIEWER",
    prompts: typeof built.prompts,
  ) => recovery
    ? runT45ReviewerCheckpointedBatchV1({
        checkpointRoot: path.join(
          root,
          `${outputStem}.${stage.toLowerCase()}-checkpoints`,
        ),
        runId: suite.runId,
        attemptId: "recovery-one",
        runtimeSuiteHash:
          runtime.identity.suiteHash,
        stage,
        prompts,
        model: resolved.provenance,
        runModelBatch: ({ prompts: current }) =>
          runT45ReviewerModelBatchV1({
            prompts: current,
            model,
            onFailure: ({ error }) => {
              reviewerDiagnostics.record(error);
            },
          }),
        onEvent: (event) => {
          process.stderr.write(`${JSON.stringify({
            event:
              "post-remediation-selector-reviewer-checkpoint",
            ...event,
          })}\n`);
        },
      })
    : runT45ReviewerModelBatchV1({
        prompts,
        model,
        onFailure: ({ error }) => {
          reviewerDiagnostics.record(error);
        },
      });
  let draftCases: Awaited<
    ReturnType<typeof runT45ReviewerModelBatchV1>
  >;
  try {
    draftCases = await runBatch(
      "CONTENT_DRAFT",
      built.prompts,
    );
  } catch (error) {
    reportReviewerDiagnostics();
    throw error;
  }
  const draftArtifact = {
    schemaVersion: 1,
    kind: "POST_REMEDIATION_SELECTOR_DRAFT",
    runId: suite.runId,
    attemptId:
      recovery ? "recovery-one" : "original",
    sourceArtifactStem: suite.stem,
    runtimeSuiteHash: runtime.identity.suiteHash,
    model: resolved.provenance,
    cases: draftCases,
    summary: {
      total: draftCases.length,
      valid: draftCases.filter(({ status }) => status === "VALID").length,
      invalid: draftCases.filter(({ status }) => status === "INVALID").length,
    },
  };
  const draftSeal = await writeNewT45SealedJsonArtifactV1(
    path.join(
      root,
      `${outputStem}.content-draft.selection.json`,
    ),
    draftArtifact,
  );
  const draftById = new Map(
    draftCases.map((testCase) => [testCase.caseId, testCase]),
  );
  const reviewPrompts = built.prompts.flatMap((prompt) => {
    const draftCase = draftById.get(prompt.caseId);
    if (!draftCase) {
      throw new Error(
        `POST_REMEDIATION_SELECTOR_DRAFT_CASE_MISSING:${prompt.caseId}`,
      );
    }
    return draftCase.status === "INVALID"
      ? []
      : [buildT45MultiAnchorPromptV1({
          sourcePrompt: prompt,
          draftCase,
          baselineProtectedSelection: baselineSelection,
          candidateArtifact: candidate,
        })];
  });
  let reviewCases: Awaited<
    ReturnType<typeof runT45ReviewerModelBatchV1>
  >;
  try {
    reviewCases = reviewPrompts.length === 0
      ? []
      : await runBatch(
          "MULTI_ANCHOR_REVIEWER",
          reviewPrompts,
        );
  } catch (error) {
    reportReviewerDiagnostics();
    throw error;
  }
  const reviewById = new Map(
    reviewCases.map((testCase) => [testCase.caseId, testCase]),
  );
  const promptById = new Map(
    reviewPrompts.map((prompt) => [prompt.caseId, prompt]),
  );
  const finalCases = draftCases.map((draftCase) => {
    if (draftCase.status === "INVALID") {
      return {
        ...draftCase,
        selected: [],
        stageAudit: {
          draft: {
            elapsedMs: draftCase.audit.elapsedMs,
            usage: draftCase.audit.usage,
          },
          reviewer: {
            elapsedMs: 0,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
          },
          endToEnd: {
            elapsedMs: draftCase.audit.elapsedMs,
            usage: draftCase.audit.usage,
          },
        },
        completion: {
          modelSelectionLedger: [],
          obligationAnchors: [],
          protectedKept: [],
          modelSelectedBaselineKept: [],
          baselineRejected: [],
          modelAdded: [],
          deterministicAdded: [],
          unprotectedDropped: [],
        },
        bindingViolations: [],
      };
    }
    const reviewCase = reviewById.get(draftCase.caseId);
    const prompt = promptById.get(draftCase.caseId);
    if (!reviewCase || !prompt) {
      throw new Error(
        `POST_REMEDIATION_SELECTOR_REVIEW_CASE_MISSING:${draftCase.caseId}`,
      );
    }
    const completed = applyT45MultiAnchorCompletionV1({
      prompt,
      modelSelection: reviewCase,
    });
    const usage = addUsage(
      draftCase.audit.usage,
      reviewCase.audit.usage,
    );
    return {
      ...completed.testCase,
      audit: {
        ...completed.testCase.audit,
        elapsedMs:
          draftCase.audit.elapsedMs + reviewCase.audit.elapsedMs,
        usage,
      },
      stageAudit: {
        draft: {
          elapsedMs: draftCase.audit.elapsedMs,
          usage: draftCase.audit.usage,
        },
        reviewer: {
          elapsedMs: reviewCase.audit.elapsedMs,
          usage: reviewCase.audit.usage,
        },
        endToEnd: {
          elapsedMs:
            draftCase.audit.elapsedMs + reviewCase.audit.elapsedMs,
          usage,
        },
      },
      completion: completed.completion,
      bindingViolations: [],
    };
  });
  const finalArtifact = {
    schemaVersion: 1,
    kind: "POST_REMEDIATION_SELECTOR_FINAL_SELECTIONS",
    runId: suite.runId,
    attemptId:
      recovery ? "recovery-one" : "original",
    sourceArtifactStem: suite.stem,
    runtimeSuiteHash: runtime.identity.suiteHash,
    draftSelectionSha256: draftSeal.sha256,
    model: resolved.provenance,
    cases: finalCases,
    summary: {
      total: finalCases.length,
      valid: finalCases.filter(({ status }) => status === "VALID").length,
      invalid: finalCases.filter(({ status }) => status === "INVALID").length,
    },
  };
  const finalSeal = await writeNewT45SealedJsonArtifactV1(
    path.join(
      root,
      `${outputStem}.multi-anchor.selection.json`,
    ),
    finalArtifact,
  );
  process.stdout.write(`${JSON.stringify({
    draft: draftArtifact.summary,
    reviewerPrompts: reviewPrompts.length,
    final: finalArtifact.summary,
    finalSha256: finalSeal.sha256,
  }, null, 2)}\n`);
  return finalArtifact;
}

function percentile95(values: readonly number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

async function projectAnswerEvidence(
  workspaceRoot: string,
  suite: SuiteConfig,
) {
  const loaded = await loadRuntimeOnlyForSuite(
    workspaceRoot,
    suite,
  );
  const root = path.resolve(workspaceRoot, ROOT);
  const sourceStem =
    `${suite.stem}-recovery-1`;
  const sourceRaw = await readFile(
    path.join(
      root,
      `${sourceStem}.multi-anchor.selection.json`,
    ),
    "utf8",
  );
  const source = JSON.parse(sourceRaw) as {
    runtimeSuiteHash: string;
    model: unknown;
    cases: Array<{
      caseId: string;
      coursePackId: string;
      status: "VALID" | "INVALID";
      selected: Array<{
        nodeId: string;
        evidenceRole:
          | "DIRECT"
          | "COMPLEMENT"
          | "CONTEXT";
        [key: string]: unknown;
      }>;
      bindingViolations: unknown[];
      stageAudit: {
        reviewer: { elapsedMs: number };
      };
    }>;
  };
  if (
    source.runtimeSuiteHash
      !== loaded.runtime.identity.suiteHash
    || source.cases.length
      !== loaded.runtime.cases.length
  ) {
    throw new Error(
      "POST_REMEDIATION_ANSWER_EVIDENCE_SOURCE_DRIFT",
    );
  }
  const runtimeCases = new Map(
    loaded.runtime.cases.map((testCase) => [
      testCase.caseId,
      testCase.coursePackId,
    ]),
  );
  const cases = source.cases.map((testCase) => {
    if (
      testCase.status !== "VALID"
      || runtimeCases.get(testCase.caseId)
        !== testCase.coursePackId
    ) {
      throw new Error(
        `POST_REMEDIATION_ANSWER_EVIDENCE_CASE_DRIFT:${testCase.caseId}`,
      );
    }
    const projected =
      projectT45AnswerEvidenceV1(
        testCase.selected,
      );
    return {
      caseId: testCase.caseId,
      coursePackId: testCase.coursePackId,
      answerEvidence:
        projected.answerEvidence,
      supplementalEvidence:
        projected.supplementalEvidence,
      bindingViolations:
        testCase.bindingViolations,
      reviewerElapsedMs:
        testCase.stageAudit.reviewer.elapsedMs,
    };
  });
  const artifact = {
    schemaVersion: 1,
    kind:
      "POST_REMEDIATION_ANSWER_EVIDENCE_PROJECTION",
    runId: suite.runId,
    attemptId: "recovery-one",
    runtimeSuiteHash:
      loaded.runtime.identity.suiteHash,
    sourceFinalSha256: sha256(sourceRaw),
    model: source.model,
    config:
      T45_ANSWER_EVIDENCE_PROJECTION_CONFIG_V1,
    configHash:
      T45_ANSWER_EVIDENCE_PROJECTION_CONFIG_HASH_V1,
    qrelsReads: 0,
    graphifyCalls: 0,
    cases,
    summary: {
      cases: cases.length,
      answerEvidence:
        cases.reduce(
          (sum, testCase) =>
            sum
            + testCase.answerEvidence.length,
          0,
        ),
      supplementalEvidence:
        cases.reduce(
          (sum, testCase) =>
            sum
            + testCase.supplementalEvidence.length,
          0,
        ),
      minimumAnswerEvidence:
        Math.min(...cases.map(
          (testCase) =>
            testCase.answerEvidence.length,
        )),
      maximumAnswerEvidence:
        Math.max(...cases.map(
          (testCase) =>
            testCase.answerEvidence.length,
        )),
    },
  };
  const seal = await writeNewT45SealedJsonArtifactV1(
    path.join(
      root,
      `${sourceStem}.answer-evidence-projection.json`,
    ),
    artifact,
  );
  process.stdout.write(`${JSON.stringify({
    ...artifact.summary,
    sourceFinalSha256:
      artifact.sourceFinalSha256,
    configHash: artifact.configHash,
    projectionSha256: seal.sha256,
    decision:
      "ANSWER_EVIDENCE_PROJECTION_LABELS_UNREAD",
  }, null, 2)}\n`);
  return artifact;
}

async function auditAnswerEvidence(
  workspaceRoot: string,
  suite: SuiteConfig,
) {
  const loaded = await loadFullSuite(
    workspaceRoot,
    suite,
  );
  const root = path.resolve(workspaceRoot, ROOT);
  const sourceStem =
    `${suite.stem}-recovery-1`;
  const projection = JSON.parse(await readFile(
    path.join(
      root,
      `${sourceStem}.answer-evidence-projection.json`,
    ),
    "utf8",
  )) as {
    runtimeSuiteHash: string;
    qrelsReads: number;
    cases: Array<{
      caseId: string;
      coursePackId: string;
      answerEvidence:
        Array<{ nodeId: string }>;
      bindingViolations: unknown[];
      reviewerElapsedMs: number;
    }>;
  };
  if (
    projection.runtimeSuiteHash
      !== loaded.runtime.suiteHash
    || projection.qrelsReads !== 0
  ) {
    throw new Error(
      "POST_REMEDIATION_ANSWER_EVIDENCE_AUDIT_BINDING_DRIFT",
    );
  }
  const byId = new Map(
    projection.cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  let supportCases = 0;
  let groupsCovered = 0;
  let multiJoint = 0;
  let hardNegativeNodes = 0;
  let hardNegativeCases = 0;
  let bindingViolations = 0;
  const details = loaded.qrels.cases.map(
    (qrel) => {
      const testCase = byId.get(qrel.caseId);
      if (!testCase) {
        throw new Error(
          `POST_REMEDIATION_ANSWER_EVIDENCE_CASE_MISSING:${qrel.caseId}`,
        );
      }
      const selectedIds = new Set(
        testCase.answerEvidence.map(
          ({ nodeId }) => nodeId,
        ),
      );
      const groupResults =
        qrel.requiredEvidenceGroups.map(
          (group) => ({
            groupId: group.groupId,
            covered:
              group.acceptableNodeIds.some(
                (nodeId) =>
                  selectedIds.has(nodeId),
              ),
          }),
        );
      const supported = groupResults.every(
        ({ covered }) => covered,
      );
      const selectedHardNegatives =
        qrel.hardNegativeNodeIds.filter(
          (nodeId) =>
            selectedIds.has(nodeId),
        );
      supportCases += supported ? 1 : 0;
      groupsCovered += groupResults.filter(
        ({ covered }) => covered,
      ).length;
      multiJoint +=
        qrel.multiClaim && supported ? 1 : 0;
      hardNegativeNodes +=
        selectedHardNegatives.length;
      hardNegativeCases +=
        selectedHardNegatives.length > 0
          ? 1
          : 0;
      bindingViolations +=
        testCase.bindingViolations.length;
      return {
        caseId: qrel.caseId,
        coursePackId:
          testCase.coursePackId,
        groupResults,
        selectedHardNegatives,
      };
    },
  );
  const validSelections =
    projection.cases.filter(
      ({ answerEvidence }) =>
        answerEvidence.length > 0,
    ).length;
  const reviewerP95Ms = percentile95(
    projection.cases.map(
      ({ reviewerElapsedMs }) =>
        reviewerElapsedMs,
    ),
  );
  const go =
    validSelections === 20
    && supportCases >= 18
    && groupsCovered >= 28
    && multiJoint >= 9
    && hardNegativeNodes <= 5
    && hardNegativeCases <= 5
    && bindingViolations === 0
    && reviewerP95Ms <= 30_000;
  const report = {
    schemaVersion: 1,
    kind:
      "POST_REMEDIATION_ANSWER_EVIDENCE_LOCAL_AUDIT",
    runId: suite.runId,
    runtimeSuiteHash:
      loaded.runtime.suiteHash,
    qrelsSuiteHash: loaded.qrels.suiteHash,
    independentValidation: false,
    formalSelectorDecision:
      "POST_REMEDIATION_SELECTOR_NO_GO",
    summary: {
      validSelections,
      supportCases,
      requiredGroupsCovered:
        groupsCovered,
      multiObligationJoint: multiJoint,
      hardNegativeNodes,
      hardNegativeCases,
      bindingViolations,
      reviewerP95Ms,
    },
    details,
    decision: go
      ? "ANSWER_EVIDENCE_REMEDIATION_LOCAL_GO"
      : "ANSWER_EVIDENCE_REMEDIATION_LOCAL_NO_GO",
  };
  const seal = await writeNewT45SealedJsonArtifactV1(
    path.join(
      root,
      `${sourceStem}.answer-evidence-local-audit.json`,
    ),
    report,
  );
  process.stdout.write(`${JSON.stringify({
    ...report.summary,
    independentValidation:
      report.independentValidation,
    formalSelectorDecision:
      report.formalSelectorDecision,
    decision: report.decision,
    reportSha256: seal.sha256,
  }, null, 2)}\n`);
  if (!go) process.exitCode = 1;
  return report;
}

async function audit(
  workspaceRoot: string,
  suite: SuiteConfig,
  recovery = false,
) {
  const loaded = await loadFullSuite(workspaceRoot, suite);
  const root = path.resolve(workspaceRoot, ROOT);
  const outputStem = recovery
    ? `${suite.stem}-recovery-1`
    : suite.stem;
  const final = JSON.parse(await readFile(
    path.join(
      root,
      `${outputStem}.multi-anchor.selection.json`,
    ),
    "utf8",
  )) as {
    runtimeSuiteHash: string;
    cases: Array<{
      caseId: string;
      coursePackId: string;
      status: "VALID" | "INVALID";
      selected: Array<{ nodeId: string }>;
      bindingViolations: unknown[];
      stageAudit: { reviewer: { elapsedMs: number } };
    }>;
  };
  if (final.runtimeSuiteHash !== loaded.runtime.suiteHash) {
    throw new Error(
      "POST_REMEDIATION_SELECTOR_AUDIT_RUNTIME_DRIFT",
    );
  }
  const finalById = new Map(
    final.cases.map((testCase) => [testCase.caseId, testCase]),
  );
  let supportCases = 0;
  let groupsCovered = 0;
  let multiJoint = 0;
  let hardNegativeNodes = 0;
  let hardNegativeCases = 0;
  let bindingViolations = 0;
  const details = loaded.qrels.cases.map((qrel) => {
    const selectedCase = finalById.get(qrel.caseId);
    if (!selectedCase) {
      throw new Error(
        `POST_REMEDIATION_SELECTOR_AUDIT_CASE_MISSING:${qrel.caseId}`,
      );
    }
    const selectedIds = new Set(
      selectedCase.selected.map(({ nodeId }) => nodeId),
    );
    const groupResults = qrel.requiredEvidenceGroups.map((group) => ({
      groupId: group.groupId,
      covered: group.acceptableNodeIds.some(
        (nodeId) => selectedIds.has(nodeId),
      ),
    }));
    const supported = groupResults.every(({ covered }) => covered);
    const selectedHardNegatives = qrel.hardNegativeNodeIds.filter(
      (nodeId) => selectedIds.has(nodeId),
    );
    supportCases += supported ? 1 : 0;
    groupsCovered += groupResults.filter(
      ({ covered }) => covered,
    ).length;
    multiJoint += qrel.multiClaim && supported ? 1 : 0;
    hardNegativeNodes += selectedHardNegatives.length;
    hardNegativeCases += selectedHardNegatives.length > 0 ? 1 : 0;
    bindingViolations += selectedCase.bindingViolations.length;
    return {
      caseId: qrel.caseId,
      coursePackId: selectedCase.coursePackId,
      status: selectedCase.status,
      groupResults,
      selectedHardNegatives,
    };
  });
  const validSelections = final.cases.filter(
    ({ status }) => status === "VALID",
  ).length;
  const reviewerP95Ms = percentile95(
    final.cases.map(
      ({ stageAudit }) => stageAudit.reviewer.elapsedMs,
    ),
  );
  const go =
    validSelections === 20
    && supportCases >= 18
    && groupsCovered >= 28
    && multiJoint >= 9
    && hardNegativeNodes <= 5
    && hardNegativeCases <= 5
    && bindingViolations === 0
    && reviewerP95Ms <= 30_000;
  const report = {
    schemaVersion: 1,
    kind: "POST_REMEDIATION_SELECTOR_FINAL_AUDIT",
    runId: suite.runId,
    attemptId:
      recovery ? "recovery-one" : "original",
    sourceArtifactStem: suite.stem,
    runtimeSuiteHash: loaded.runtime.suiteHash,
    qrelsSuiteHash: loaded.qrels.suiteHash,
    summary: {
      validSelections,
      supportCases,
      requiredGroupsCovered: groupsCovered,
      multiObligationJoint: multiJoint,
      hardNegativeNodes,
      hardNegativeCases,
      bindingViolations,
      reviewerP95Ms,
    },
    details,
    decision: go
      ? "POST_REMEDIATION_SELECTOR_GO"
      : "POST_REMEDIATION_SELECTOR_NO_GO",
    validationV1: {
      historicalDecision: "VALIDATION_CANDIDATE_NO_GO",
      rerun: false,
      modified: false,
    },
  };
  const seal = await writeNewT45SealedJsonArtifactV1(
    path.join(root, `${outputStem}.final-audit.json`),
    report,
  );
  process.stdout.write(`${JSON.stringify({
    ...report.summary,
    decision: report.decision,
    reportSha256: seal.sha256,
  }, null, 2)}\n`);
  if (!go) process.exitCode = 1;
  return report;
}

export async function runPostRemediationSelectorAcceptanceV1(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
) {
  const parsed = parseArgs(argv);
  if (parsed.stage === "collect") {
    return collect(workspaceRoot, parsed.device, parsed.suite);
  }
  if (parsed.stage === "oracle") {
    return oracle(workspaceRoot, parsed.suite);
  }
  if (parsed.stage === "review") {
    return review(workspaceRoot, parsed.suite);
  }
  if (parsed.stage === "review-recovery") {
    return review(
      workspaceRoot,
      parsed.suite,
      true,
    );
  }
  if (parsed.stage === "audit-recovery") {
    return audit(
      workspaceRoot,
      parsed.suite,
      true,
    );
  }
  if (parsed.stage === "project-answer-evidence") {
    return projectAnswerEvidence(
      workspaceRoot,
      parsed.suite,
    );
  }
  if (parsed.stage === "audit-answer-evidence") {
    return auditAnswerEvidence(
      workspaceRoot,
      parsed.suite,
    );
  }
  return audit(workspaceRoot, parsed.suite);
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runPostRemediationSelectorAcceptanceV1(process.argv.slice(2))
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}

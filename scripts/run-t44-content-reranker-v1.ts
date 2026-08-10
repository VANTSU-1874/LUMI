import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  guardModelProviderSecretOutputs,
} from "@/lib/agent/evaluation-safety";
import {
  createOpenAICompatibleModelProvider,
  type ModelProviderAdapter,
} from "@/lib/agent/model-provider-adapter";
import {
  ModelServiceError,
  type ModelUsage,
} from "@/lib/ai/client";
import { isGpt56ModelId } from "@/lib/ai/model-id";
import {
  readEnv,
  resolvePlannerModelConfiguration,
} from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
} from "@/lib/config/runtime-environment";
import {
  AnswerObligationSetV1Schema,
} from "@/lib/knowledge/answer-obligation-v1";
import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  T44ClaimMatrixSidecarOutputV1Schema,
} from "@/tools/mixed-retrieval/t44-claim-coverage-evaluator";
import {
  T44ObligationCandidateArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  T44ObligationSelectionArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-coverage-evaluator";
import {
  T44_CONTENT_RERANKER_CONFIG_HASH_V1,
  T44_CONTENT_RERANKER_CONFIG_V1,
  T44_CONTENT_RERANKER_PILOT_CASES_V1,
  T44ContentRerankerSelectionCaseV1Schema,
  T44ContentRerankerSelectionArtifactV1Schema,
  buildT44ContentRerankerPromptV1,
  mapT44ContentRerankerModelOutputV1,
  sealT44ContentRerankerSelectionArtifactV1,
  selectT44ContentRerankerPilotCasesV1,
  type T44ContentRerankerPromptV1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";

const RUN_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARTIFACT_ID_PATTERN =
  /^(?:pilot|full)-v[1-9][0-9]*$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

const PATHS = Object.freeze({
  artifactRoot: ".runtime/mixed-retrieval",
});

function sha256Utf8(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export function parseT44ContentRerankerRunArguments(
  argv: readonly string[],
) {
  let runId: string | null = null;
  let scope: "PILOT" | "FULL" | null = null;
  let artifactId: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (index === 0 && token === "--") {
      continue;
    }
    if (token === "--run-id" && value) {
      runId = value;
      index += 1;
      continue;
    }
    if (token === "--scope" && value) {
      if (!["pilot", "full"].includes(value)) {
        throw new Error(
          `T44_CONTENT_RERANKER_SCOPE_INVALID:${value}`,
        );
      }
      scope = value.toUpperCase() as
        | "PILOT"
        | "FULL";
      index += 1;
      continue;
    }
    if (token === "--artifact-id" && value) {
      artifactId = value;
      index += 1;
      continue;
    }
    throw new Error(
      `T44_CONTENT_RERANKER_ARGUMENT_INVALID:${token ?? "<missing>"}`,
    );
  }
  if (
    !runId
    || !RUN_ID_PATTERN.test(runId)
    || !scope
    || !artifactId
    || !ARTIFACT_ID_PATTERN.test(artifactId)
  ) {
    throw new Error(
      "T44_CONTENT_RERANKER_ARGUMENTS_REQUIRED",
    );
  }
  if (
    !artifactId.startsWith(
      `${scope.toLowerCase()}-`,
    )
  ) {
    throw new Error(
      "T44_CONTENT_RERANKER_ARTIFACT_SCOPE_MISMATCH",
    );
  }
  return { runId, scope, artifactId };
}

const PlannerArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T44_OBLIGATION_PLANNER_OUTPUTS",
    ),
    runtimeSuite: z
      .object({
        id: z.string().regex(
          /^[a-z0-9][a-z0-9-]{0,127}$/,
        ),
        version:
          z.string().trim().min(1).max(50),
        suiteHash:
          z.string().regex(HASH_PATTERN),
      })
      .strict(),
    cases: z.array(z
      .object({
        caseId: z.string().regex(
          /^[a-z0-9][a-z0-9-]{0,127}$/,
        ),
        request: z
          .object({
            currentMessage: z
              .object({
                message:
                  z.string().min(1).max(500),
              })
              .passthrough(),
          })
          .passthrough(),
        result: z
          .object({
            obligationSet:
              AnswerObligationSetV1Schema,
          })
          .passthrough(),
      })
      .passthrough())
      .min(1)
      .max(50),
  })
  .passthrough();

const MatrixPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T44_OBLIGATION_NODE_MATRICES",
    ),
    arms: z
      .object({
        A_WHOLE_QUERY: z
          .object({
            output:
              T44ClaimMatrixSidecarOutputV1Schema,
          })
          .passthrough(),
        B_MODEL_GUIDED: z
          .object({
            output:
              T44ClaimMatrixSidecarOutputV1Schema,
          })
          .passthrough(),
      })
      .strict(),
  })
  .passthrough();

type LoadedSourceBundle = {
  runtimeSuite: {
    id: string;
    version: string;
    suiteHash: string;
  };
  inputSeals: {
    plannerSha256: string;
    candidateSha256: string;
    matrixSha256: string;
    legacySelectionSha256: string;
  };
  prompts: T44ContentRerankerPromptV1[];
  candidate:
    z.infer<
      typeof T44ObligationCandidateArtifactV1Schema
    >;
  legacySelection:
    z.infer<
      typeof T44ObligationSelectionArtifactV1Schema
    >;
};

async function readSealedSource(
  filePath: string,
) {
  const serialized = await readFile(
    filePath,
    "utf8",
  );
  return {
    serialized,
    sha256: sha256Utf8(serialized),
  };
}

function mapByCaseId<T extends { caseId: string }>(
  cases: readonly T[],
  label: string,
) {
  const result = new Map(
    cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  if (result.size !== cases.length) {
    throw new Error(
      `T44_CONTENT_RERANKER_${label}_CASE_DUPLICATE`,
    );
  }
  return result;
}

export function mergeT44ContentRerankerWholeRanksV1(
  input: {
    candidateNodeIds: readonly string[];
    bWholeQueryRanking:
      readonly { nodeId: string; rank: number }[];
    aWholeQueryRanking:
      readonly { nodeId: string; rank: number }[];
  },
) {
  const candidateIds = new Set(
    input.candidateNodeIds,
  );
  if (
    candidateIds.size !== input.candidateNodeIds.length
    || candidateIds.size
      > T44_CONTENT_RERANKER_CONFIG_V1
        .maximumCandidates
  ) {
    throw new Error(
      "T44_CONTENT_RERANKER_WHOLE_RANK_CANDIDATES_INVALID",
    );
  }
  const seen = new Set<string>();
  const merged = [
    ...input.bWholeQueryRanking,
    ...input.aWholeQueryRanking,
  ].flatMap(({ nodeId }) => {
    if (
      !candidateIds.has(nodeId)
      || seen.has(nodeId)
    ) {
      return [];
    }
    seen.add(nodeId);
    return [{
      nodeId,
      rank: seen.size,
    }];
  });
  if (seen.size !== candidateIds.size) {
    throw new Error(
      "T44_CONTENT_RERANKER_WHOLE_RANK_NODE_MISSING",
    );
  }
  return merged;
}

export function assertT44ExplicitCasePortV1(
  rawInput: {
    caseIdentities: readonly {
      caseId: string;
      coursePackId: string;
    }[];
    sources: readonly {
      label: string;
      rows: readonly {
        caseId: string;
        coursePackId?: string;
      }[];
    }[];
  },
) {
  const caseIdentities = z.array(z.object({
    caseId: z.string().regex(
      /^[a-z0-9][a-z0-9-]{0,127}$/,
    ),
    coursePackId: z.string().regex(
      /^[a-z0-9][a-z0-9-]{0,127}$/,
    ),
  }).strict()).min(1).max(50).parse(
    rawInput.caseIdentities,
  );
  if (
    new Set(caseIdentities.map(
      ({ caseId }) => caseId,
    )).size !== caseIdentities.length
  ) {
    throw new Error(
      "T44_CONTENT_RERANKER_EXPLICIT_CASE_DUPLICATE",
    );
  }
  for (const { label, rows } of rawInput.sources) {
    if (
      rows.length !== caseIdentities.length
      || rows.some(
        (row, index) =>
          row.caseId
            !== caseIdentities[index]!.caseId
          || (
            row.coursePackId !== undefined
            && row.coursePackId
              !== caseIdentities[index]!
                .coursePackId
          ),
      )
    ) {
      throw new Error(
        `T44_CONTENT_RERANKER_${label}_CASE_ORDER_DRIFT`,
      );
    }
  }
  return caseIdentities;
}

export function buildT44ContentRerankerPromptsForCasesV1(
  rawInput: {
    planner: unknown;
    candidate: unknown;
    matrix: unknown;
    baselineSelection: unknown;
    caseIdentities: readonly {
      caseId: string;
      coursePackId: string;
    }[];
  },
) {
  const planner = PlannerArtifactSchema.parse(
    rawInput.planner,
  );
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse(
      rawInput.candidate,
    );
  const matrix = MatrixPackageSchema.parse(
    rawInput.matrix,
  );
  const baselineSelection =
    T44ObligationSelectionArtifactV1Schema.parse(
      rawInput.baselineSelection,
    );
  const caseIdentities =
    assertT44ExplicitCasePortV1({
      caseIdentities: rawInput.caseIdentities,
      sources: [
        {
          label: "PLANNER",
          rows: planner.cases.map(
            (testCase) => ({
              caseId: testCase.caseId,
            }),
          ),
        },
        {
          label: "CANDIDATE",
          rows: candidate.cases,
        },
        {
          label: "BASELINE_SELECTION",
          rows: baselineSelection.cases,
        },
        {
          label: "A_MATRIX",
          rows: matrix.arms.A_WHOLE_QUERY
            .output.cases,
        },
        {
          label: "B_MATRIX",
          rows: matrix.arms.B_MODEL_GUIDED
            .output.cases,
        },
      ],
    });
  const suiteHashes = [
    planner.runtimeSuite.suiteHash,
    candidate.runtimeSuite.suiteHash,
    matrix.arms.A_WHOLE_QUERY.output
      .runtimeSuite.suiteHash,
    matrix.arms.B_MODEL_GUIDED.output
      .runtimeSuite.suiteHash,
  ];
  if (
    new Set(suiteHashes).size !== 1
    || planner.runtimeSuite.id
      !== candidate.runtimeSuite.id
    || planner.runtimeSuite.version
      !== candidate.runtimeSuite.version
  ) {
    throw new Error(
      "T44_CONTENT_RERANKER_RUNTIME_SUITE_DRIFT",
    );
  }
  const plannerById = mapByCaseId(
    planner.cases,
    "PLANNER",
  );
  const selectionById = mapByCaseId(
    baselineSelection.cases,
    "BASELINE_SELECTION",
  );
  const aMatrixById = mapByCaseId(
    matrix.arms.A_WHOLE_QUERY.output.cases,
    "A_MATRIX",
  );
  const bMatrixById = mapByCaseId(
    matrix.arms.B_MODEL_GUIDED.output.cases,
    "B_MATRIX",
  );
  const candidateById = mapByCaseId(
    candidate.cases,
    "CANDIDATE",
  );
  const prompts = caseIdentities.map(
    ({ caseId, coursePackId }) => {
      const plannerCase = plannerById.get(caseId);
      const candidateCase =
        candidateById.get(caseId);
      const selectionCase =
        selectionById.get(caseId);
      const aMatrixCase =
        aMatrixById.get(caseId);
      const bMatrixCase =
        bMatrixById.get(caseId);
      if (
        !plannerCase
        || !candidateCase
        || !selectionCase
        || !aMatrixCase
        || !bMatrixCase
        || [
          candidateCase.coursePackId,
          selectionCase.coursePackId,
          aMatrixCase.coursePackId,
          bMatrixCase.coursePackId,
        ].some((value) => value !== coursePackId)
      ) {
        throw new Error(
          `T44_CONTENT_RERANKER_CASE_BINDING_DRIFT:${caseId}`,
        );
      }
      if (
        candidateCase.obligationSetHash
          !== sha256StableJsonV2(
            plannerCase.result.obligationSet,
          )
        || aMatrixCase.candidateNodeIdsSha256
          !== candidateCase.arms
            .A_WHOLE_QUERY
            .candidateNodeIdsSha256
        || bMatrixCase.candidateNodeIdsSha256
          !== candidateCase.arms
            .B_MODEL_GUIDED
            .candidateNodeIdsSha256
      ) {
        throw new Error(
          `T44_CONTENT_RERANKER_CASE_INPUT_SHA_DRIFT:${caseId}`,
        );
      }
      const aBaselineSelectedNodeIds =
        selectionCase.arms.A_WHOLE_QUERY
          .selected.map(({ nodeId }) => nodeId);
      const candidateNodeIds = Array.from(
        new Set([
          ...candidateCase.arms.B_MODEL_GUIDED
            .candidateNodes.map(
              ({ nodeId }) => nodeId,
            ),
          ...aBaselineSelectedNodeIds,
        ]),
      );
      const combinedWhole =
        mergeT44ContentRerankerWholeRanksV1({
          candidateNodeIds,
          bWholeQueryRanking:
            bMatrixCase.arms.B_CLAIM_MATRIX
              .wholeQueryRanking,
          aWholeQueryRanking:
            aMatrixCase.arms.A_FULL_QUERY
              .wholeQueryRanking,
        });
      return buildT44ContentRerankerPromptV1({
        caseId,
        coursePackId,
        question:
          plannerCase.request.currentMessage
            .message,
        obligations:
          plannerCase.result.obligationSet
            .obligations.map((obligation) => ({
              obligationId:
                obligation.obligationId,
              learnerNeed:
                obligation.learnerNeed,
              intent: obligation.intent,
            })),
        bCandidateNodes:
          candidateCase.arms.B_MODEL_GUIDED
            .candidateNodes,
        aCandidateNodes:
          candidateCase.arms.A_WHOLE_QUERY
            .candidateNodes,
        aBaselineSelectedNodeIds,
        wholeQueryRanking: combinedWhole,
        obligationRankings:
          bMatrixCase.arms.B_CLAIM_MATRIX
            .claimRankings.map(
              ({ claimId, ranking }) => ({
                obligationId: claimId,
                ranking: ranking.map(
                  ({ nodeId, rank }) => ({
                    nodeId,
                    rank,
                  }),
                ),
              }),
            ),
      });
    },
  );
  return {
    runtimeSuite: candidate.runtimeSuite,
    prompts,
    candidate,
    baselineSelection,
  };
}

export async function loadT44ContentRerankerSourceBundleV1(
  input: {
    workspaceRoot: string;
    runId: string;
    scope: "PILOT" | "FULL";
  },
): Promise<LoadedSourceBundle> {
  const stem = path.resolve(
    input.workspaceRoot,
    PATHS.artifactRoot,
    `t44-obligation-${input.runId}`,
  );
  const [
    plannerSeal,
    candidateSeal,
    matrixSeal,
    legacySelectionSeal,
  ] = await Promise.all([
    readSealedSource(`${stem}.planner.json`),
    readSealedSource(`${stem}.candidate.json`),
    readSealedSource(`${stem}.matrix.json`),
    readSealedSource(`${stem}.selection.json`),
  ]);
  const planner = PlannerArtifactSchema.parse(
    JSON.parse(plannerSeal.serialized) as unknown,
  );
  const candidate =
    T44ObligationCandidateArtifactV1Schema
      .parse(JSON.parse(
        candidateSeal.serialized,
      ) as unknown);
  const matrix = MatrixPackageSchema.parse(
    JSON.parse(matrixSeal.serialized) as unknown,
  );
  const legacySelection =
    T44ObligationSelectionArtifactV1Schema
      .parse(JSON.parse(
        legacySelectionSeal.serialized,
      ) as unknown);
  if (
    legacySelection.candidateArtifactSha256
      !== candidateSeal.sha256
    || legacySelection.matrixOutputSha256
      !== matrixSeal.sha256
  ) {
    throw new Error(
      "T44_CONTENT_RERANKER_LEGACY_SELECTION_INPUT_DRIFT",
    );
  }
  if (input.scope === "PILOT") {
    selectT44ContentRerankerPilotCasesV1(
      candidate.cases,
    );
  }
  const caseIdentities =
    input.scope === "PILOT"
      ? T44_CONTENT_RERANKER_PILOT_CASES_V1
      : candidate.cases.map(
          ({ caseId, coursePackId }) => ({
            caseId,
            coursePackId,
          }),
        );
  const built =
    buildT44ContentRerankerPromptsForCasesV1({
      planner,
      candidate,
      matrix,
      baselineSelection: legacySelection,
      caseIdentities,
    });
  return {
    runtimeSuite: built.runtimeSuite,
    inputSeals: {
      plannerSha256: plannerSeal.sha256,
      candidateSha256: candidateSeal.sha256,
      matrixSha256: matrixSeal.sha256,
      legacySelectionSha256:
        legacySelectionSeal.sha256,
    },
    prompts: built.prompts,
    candidate: built.candidate,
    legacySelection,
  };
}

function emptyUsage(): ModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function addUsage(
  left: ModelUsage,
  right: ModelUsage,
): ModelUsage {
  return {
    inputTokens:
      left.inputTokens + right.inputTokens,
    outputTokens:
      left.outputTokens + right.outputTokens,
    totalTokens:
      left.totalTokens + right.totalTokens,
  };
}

function classifyFailure(error: unknown) {
  if (
    error instanceof Error
    && (
      error.message.includes(
        "DUPLICATE_INDEX",
      )
      || error.message.includes(
        "INDEX_OUT_OF_RANGE",
      )
      || error.message.includes(
        "OBLIGATION_BINDING_DRIFT",
      )
      || error.message.includes(
        "SELECTION_BUDGET_INVALID",
      )
    )
  ) {
    return "OUTPUT_BINDING_INVALID";
  }
  if (
    error instanceof Error
    && error.message.includes(
      "模型输出不是有效的结构化对象",
    )
  ) {
    return "STRUCTURED_OUTPUT_INVALID";
  }
  if (error instanceof ModelServiceError) {
    return `MODEL_SERVICE_${error.code}`;
  }
  return "MODEL_CALL_FAILED";
}

export async function runT44ContentRerankerModelBatchV1(
  input: {
    prompts:
      readonly T44ContentRerankerPromptV1[];
    model: ModelProviderAdapter;
    totalTimeoutMs?: number;
    now?: () => number;
    onCase?: (input: {
      completed: number;
      total: number;
      caseId: string;
      status: "VALID" | "INVALID";
      elapsedMs: number;
    }) => void;
    onFailure?: (input: {
      caseId: string;
      error: unknown;
    }) => void;
  },
): Promise<z.infer<
  typeof T44ContentRerankerSelectionCaseV1Schema
>[]> {
  const now = input.now ?? performance.now.bind(
    performance,
  );
  const results = new Array<z.infer<
    typeof T44ContentRerankerSelectionCaseV1Schema
  >>(input.prompts.length);
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const prompt = input.prompts[index];
      if (!prompt) return;
      const startedAt = now();
      let usage = emptyUsage();
      let rawOutput: string | null = null;
      let record: z.infer<
        typeof T44ContentRerankerSelectionCaseV1Schema
      >;
      try {
        rawOutput = await input.model.complete(
          prompt.messages,
          {
            totalTimeoutMs:
              input.totalTimeoutMs
              ?? T44_CONTENT_RERANKER_CONFIG_V1
                .modelCall.totalTimeoutMs,
            reasoningEffort:
              T44_CONTENT_RERANKER_CONFIG_V1
                .modelCall.reasoningEffort,
            onUsage: (observed) => {
              usage = addUsage(
                usage,
                observed,
              );
            },
          },
        );
        const mapped =
          mapT44ContentRerankerModelOutputV1({
            prompt,
            rawOutput,
          });
        record =
          T44ContentRerankerSelectionCaseV1Schema
            .parse({
              caseId: prompt.caseId,
              coursePackId:
                prompt.coursePackId,
              candidateMapHash:
                prompt.candidateMapHash,
              promptHash: prompt.promptHash,
              status: "VALID",
              failureCategory: null,
              selected: mapped.selected,
              audit: {
                elapsedMs: Math.max(
                  0,
                  now() - startedAt,
                ),
                rawOutputHash:
                  mapped.rawOutputHash,
                usage,
              },
            });
      } catch (error) {
        try {
          input.onFailure?.({
            caseId: prompt.caseId,
            error,
          });
        } catch {
          // Observability must not change evaluation behavior.
        }
        record =
          T44ContentRerankerSelectionCaseV1Schema
            .parse({
              caseId: prompt.caseId,
              coursePackId:
                prompt.coursePackId,
              candidateMapHash:
                prompt.candidateMapHash,
              promptHash: prompt.promptHash,
              status: "INVALID",
              failureCategory:
                classifyFailure(error),
              selected: [],
              audit: {
                elapsedMs: Math.max(
                  0,
                  now() - startedAt,
                ),
                rawOutputHash:
                  rawOutput === null
                    ? null
                    : sha256Utf8(rawOutput),
                usage,
              },
            });
      }
      results[index] = record;
      completed += 1;
      input.onCase?.({
        completed,
        total: input.prompts.length,
        caseId: record.caseId,
        status: record.status,
        elapsedMs: record.audit.elapsedMs,
      });
    }
  };
  await Promise.all(
    Array.from({
      length: Math.min(
        input.prompts.length,
        T44_CONTENT_RERANKER_CONFIG_V1
          .modelCall.concurrency,
      ),
    }, worker),
  );
  return results;
}

async function writeNewArtifact(
  filePath: string,
  content: string,
) {
  const resolved = path.resolve(filePath);
  await mkdir(path.dirname(resolved), {
    recursive: true,
  });
  await writeFile(
    resolved,
    content,
    {
      encoding: "utf8",
      flag: "wx",
    },
  );
  const observed = await readFile(
    resolved,
    "utf8",
  );
  if (observed !== content) {
    throw new Error(
      "T44_CONTENT_RERANKER_ARTIFACT_BYTE_DRIFT",
    );
  }
  return {
    path: resolved,
    bytes: Buffer.byteLength(
      observed,
      "utf8",
    ),
    sha256: sha256Utf8(observed),
  };
}

export async function runT44ContentRerankerCli(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
) {
  const parsed =
    parseT44ContentRerankerRunArguments(argv);
  const source =
    await loadT44ContentRerankerSourceBundleV1({
      workspaceRoot,
      runId: parsed.runId,
      scope: parsed.scope,
    });
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
      "T44_CONTENT_RERANKER_SERVICE_MODEL_REQUIRED",
    );
  }
  if (!isGpt56ModelId(plannerConfig.model)) {
    throw new Error(
      "T44_CONTENT_RERANKER_GPT_5_6_REQUIRED",
    );
  }
  if (
    loadedEnvironment.provenance.model.source
      !== "service-env"
  ) {
    throw new Error(
      "T44_CONTENT_RERANKER_SERVICE_PROVENANCE_REQUIRED",
    );
  }
  const modelProvenance = {
    source: "service-env" as const,
    modelId: plannerConfig.model,
    endpointHash: sha256Utf8(
      new URL(plannerConfig.baseUrl).toString(),
    ),
  };
  process.stderr.write(
    `${JSON.stringify({
      event:
        "t44-content-reranker-model-provenance",
      environmentMode: "SERVICE_REQUIRED",
      ...modelProvenance,
      providerSelection:
        plannerConfig.selection,
      configHash:
        T44_CONTENT_RERANKER_CONFIG_HASH_V1,
    })}\n`,
  );
  const model = guardModelProviderSecretOutputs(
    createOpenAICompatibleModelProvider({
      baseUrl: plannerConfig.baseUrl,
      apiKey: plannerConfig.apiKey,
      model: plannerConfig.model,
      maxOutputTokens:
        plannerConfig.maxOutputTokens,
      idleTimeoutMs:
        T44_CONTENT_RERANKER_CONFIG_V1
          .modelCall.idleTimeoutMs,
      totalTimeoutMs:
        T44_CONTENT_RERANKER_CONFIG_V1
          .modelCall.totalTimeoutMs,
      vision: false,
    }),
    plannerConfig.apiKey,
  );
  const cases =
    await runT44ContentRerankerModelBatchV1({
      prompts: source.prompts,
      model,
      onCase: (progress) => {
        process.stderr.write(
          `${JSON.stringify({
            event:
              "t44-content-reranker-progress",
            ...progress,
          })}\n`,
        );
      },
    });
  const valid = cases.filter(
    (testCase) => testCase.status === "VALID",
  ).length;
  const artifact =
    T44ContentRerankerSelectionArtifactV1Schema
      .parse({
        schemaVersion: 1,
        kind:
          "T44_CONTENT_RERANKER_SELECTIONS",
        artifactId: parsed.artifactId,
        scope: parsed.scope,
        runtimeSuite: source.runtimeSuite,
        inputs: source.inputSeals,
        config:
          T44_CONTENT_RERANKER_CONFIG_V1,
        configHash:
          T44_CONTENT_RERANKER_CONFIG_HASH_V1,
        model: modelProvenance,
        graphifyInvocationCount: 0,
        cases,
        summary: {
          total: cases.length,
          valid,
          invalid: cases.length - valid,
        },
        generatedAt: new Date().toISOString(),
        operations: {
          graphify: "NOT_USED",
          database: "NOT_USED",
          web: "NOT_USED",
          deployment: "NOT_PERFORMED",
        },
      });
  const seal =
    sealT44ContentRerankerSelectionArtifactV1(
      artifact,
    );
  const outputPath = path.resolve(
    workspaceRoot,
    PATHS.artifactRoot,
    `t44-obligation-${parsed.runId}.content-reranker-${parsed.artifactId}.selection.json`,
  );
  const written = await writeNewArtifact(
    outputPath,
    seal.serialized,
  );
  if (
    written.sha256 !== seal.sha256
    || written.bytes !== seal.bytes
  ) {
    throw new Error(
      "T44_CONTENT_RERANKER_WRITTEN_SEAL_DRIFT",
    );
  }
  return {
    artifact,
    output: written,
  };
}

async function main() {
  const result = await runT44ContentRerankerCli(
    process.argv.slice(2),
  );
  process.stdout.write(
    `${JSON.stringify({
      selectionPath: result.output.path,
      selectionBytes: result.output.bytes,
      selectionSha256: result.output.sha256,
      scope: result.artifact.scope,
      artifactId: result.artifact.artifactId,
      model: result.artifact.model,
      configHash: result.artifact.configHash,
      summary: result.artifact.summary,
      operations: result.artifact.operations,
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

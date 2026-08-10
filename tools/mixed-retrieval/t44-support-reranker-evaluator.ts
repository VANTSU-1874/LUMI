import { z } from "zod";

import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  T44SupportQrelsSuiteSchema,
  T44SupportRuntimeSuiteSchema,
  type T44SupportQrelsSuite,
  type T44SupportRuntimeSuite,
} from "./t44-support-loader";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NODE_ID_PATTERN = /^node-[0-9a-f]{64}$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const IdSchema = z.string().regex(ID_PATTERN);
const NodeIdSchema = z.string().regex(NODE_ID_PATTERN);

export const T44_SUPPORT_RERANKER_EVALUATOR_VERSION =
  "2026-07-29.1";

export const T44_SUPPORT_RERANKER_CONFIG_V1 =
  Object.freeze({
    topM: 5,
    topK: 8,
    maxPerObject: 3,
    repetitions: 3,
    batchSize: 32,
    maxLength: 512,
  } as const);

export const T44_SUPPORT_RERANKER_GATES_V1 =
  Object.freeze({
    supportCaseCoverageMinimum: 45,
    multiClaimJointCoverageMinimum: 9,
    bindingViolationMaximum: 0,
    latencyFloorMs: 50,
    latencyBaselineFraction: 0.25,
  } as const);

export const T44_SUPPORT_RERANKER_ARMS = [
  "A_BGE_NODE_SCORE",
  "B_BGE_RERANKER_BASE",
] as const;

export type T44SupportRerankerArm =
  typeof T44_SUPPORT_RERANKER_ARMS[number];

const ConfigSchema = z
  .object({
    topM: z.literal(5),
    topK: z.literal(8),
    maxPerObject: z.literal(3),
    repetitions: z.literal(3),
    batchSize: z.literal(32),
    maxLength: z.literal(512),
  })
  .strict();

const RuntimeSuiteIdentitySchema = z
  .object({
    id: z.literal("lumi-t44-support-dev-runtime"),
    version: z.literal("2026-07-28.1"),
    suiteHash: HashSchema,
  })
  .strict();

const ObjectRankingRowSchema = z
  .object({
    objectId: IdSchema,
    rank: z.number().int().min(1).max(10),
  })
  .strict();

const RankedNodeSchema = z
  .object({
    nodeId: NodeIdSchema,
    objectId: IdSchema,
    coursePackId: IdSchema,
    score: z.number().finite(),
    rank: z.number().int().min(1).max(55),
  })
  .strict();

const ArmScoresSchema = z
  .object({
    timingMs: z
      .object({
        samples: z.array(
          z.number().finite().nonnegative(),
        ).length(3),
        median: z.number().finite().nonnegative(),
      })
      .strict(),
    ranking: z.array(RankedNodeSchema).max(55),
  })
  .strict()
  .superRefine((arm, context) => {
    if (
      arm.ranking.some(
        ({ rank }, index) => rank !== index + 1,
      )
      || new Set(
        arm.ranking.map(({ nodeId }) => nodeId),
      ).size !== arm.ranking.length
    ) {
      context.addIssue({
        code: "custom",
        message: "ranking must be unique and contiguous",
      });
    }
  });

const SidecarCaseSchema = z
  .object({
    caseId: IdSchema,
    coursePackId: IdSchema,
    objectRanking: z
      .array(ObjectRankingRowSchema)
      .max(10),
    candidateCount: z.number().int().min(0).max(55),
    candidateNodeIdsSha256: HashSchema,
    arms: z
      .object({
        A_BGE_NODE_SCORE: ArmScoresSchema,
        B_BGE_RERANKER_BASE: ArmScoresSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((testCase, context) => {
    if (
      testCase.objectRanking.some(
        ({ rank }, index) => rank !== index + 1,
      )
      || new Set(
        testCase.objectRanking.map(({ objectId }) =>
          objectId),
      ).size !== testCase.objectRanking.length
    ) {
      context.addIssue({
        code: "custom",
        message: "object ranking must be unique and contiguous",
      });
    }
    for (const arm of T44_SUPPORT_RERANKER_ARMS) {
      if (
        testCase.arms[arm].ranking.length
        !== testCase.candidateCount
      ) {
        context.addIssue({
          code: "custom",
          path: ["arms", arm, "ranking"],
          message: "arm ranking must cover every candidate",
        });
      }
    }
    const baselineIds = testCase.arms.A_BGE_NODE_SCORE
      .ranking.map(({ nodeId }) => nodeId).sort();
    const rerankerIds = testCase.arms.B_BGE_RERANKER_BASE
      .ranking.map(({ nodeId }) => nodeId).sort();
    if (
      JSON.stringify(baselineIds)
      !== JSON.stringify(rerankerIds)
    ) {
      context.addIssue({
        code: "custom",
        path: ["arms"],
        message: "both arms must rank the same candidates",
      });
    }
  });

const BaselineModelSchema = z
  .object({
    modelId: z.literal("BAAI/bge-small-zh-v1.5"),
    modelRevision: z.literal(
      "7999e1d3359715c523056ef9478215996d62a620",
    ),
    modelLicense: z.literal("MIT"),
    modelDirectorySha256: HashSchema,
    modelSealSha256: HashSchema,
    indexBundleHash: HashSchema,
    indexPayloadSha256: HashSchema,
  })
  .strict();

const CandidateModelSchema = z
  .object({
    modelId: z.literal("BAAI/bge-reranker-base"),
    modelRevision: z.literal(
      "2cfc18c9415c912f9d8155881c133215df768a70",
    ),
    modelLicense: z.literal("MIT"),
    modelDirectorySha256: HashSchema,
    modelSealSha256: HashSchema,
  })
  .strict();

export const T44SupportRerankerSidecarOutputSchema =
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("T44_RERANKER_SHADOW_SCORES"),
    runtimeSuite: RuntimeSuiteIdentitySchema,
    corpusBundleHash: HashSchema,
    config: ConfigSchema,
    configHash: HashSchema,
    models: z
      .object({
        baseline: BaselineModelSchema,
        candidate: CandidateModelSchema,
      })
      .strict(),
    environment: z
      .object({
        pythonVersion: z.string().min(1),
        torchVersion: z.string().min(1),
        transformersVersion: z.string().min(1),
        safetensorsVersion: z.string().min(1),
        actualDevice: z.enum(["cuda", "cpu"]),
        cudaRuntime: z.string().nullable(),
        deviceName: z.string().nullable(),
        baselineTokenizerClassName: z.string().min(1),
        rerankerTokenizerClassName: z.string().min(1),
        rerankerModelClassName: z.string().min(1),
        rerankerDtype: z.string().min(1),
      })
      .strict(),
    timingProtocol: z
      .object({
        warmupRunsPerModel: z.literal(1),
        repetitionsPerCase: z.literal(3),
        caseAggregate: z.literal("MEDIAN"),
        suiteAggregate: z.literal("P95_NEAREST_RANK"),
        baselineBoundary: z.literal(
          "QUERY_TOKENIZE_ENCODE_PLUS_CANDIDATE_DOT_PRODUCT",
        ),
        candidateBoundary: z.literal(
          "PAIR_TOKENIZE_PLUS_CROSS_ENCODER_LOGITS",
        ),
      })
      .strict(),
    cases: z.array(SidecarCaseSchema).length(50),
  })
    .strict()
    .superRefine((output, context) => {
      if (
        output.configHash
        !== sha256StableJsonV2(output.config)
      ) {
        context.addIssue({
          code: "custom",
          path: ["configHash"],
          message: "config hash mismatch",
        });
      }
      if (
        new Set(output.cases.map(({ caseId }) => caseId))
          .size !== output.cases.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message: "case ids must be unique",
        });
      }
    });

export type T44SupportRerankerSidecarOutput = z.infer<
  typeof T44SupportRerankerSidecarOutputSchema
>;

export function selectT44SupportNodes(
  ranking: readonly z.infer<typeof RankedNodeSchema>[],
) {
  const selected: z.infer<typeof RankedNodeSchema>[] = [];
  const countByObject = new Map<string, number>();
  for (const row of ranking) {
    const count = countByObject.get(row.objectId) ?? 0;
    if (count >= T44_SUPPORT_RERANKER_CONFIG_V1.maxPerObject) {
      continue;
    }
    selected.push(row);
    countByObject.set(row.objectId, count + 1);
    if (
      selected.length
      === T44_SUPPORT_RERANKER_CONFIG_V1.topK
    ) {
      break;
    }
  }
  return selected;
}

export function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
) {
  if (
    values.length === 0
    || !Number.isFinite(percentile)
    || percentile <= 0
    || percentile > 1
  ) {
    throw new Error("T44_RERANKER_PERCENTILE_INPUT_INVALID");
  }
  const ordered = [...values].sort((left, right) =>
    left - right);
  const index = Math.ceil(percentile * ordered.length) - 1;
  return ordered[index]!;
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

type EvaluatedArmRow = {
  caseId: string;
  coursePackId: string;
  stratum: T44SupportQrelsSuite["cases"][number]["stratum"];
  multiClaim: boolean;
  selectedNodeIds: string[];
  selectedObjectIds: string[];
  requiredGroups: Array<{
    groupId: string;
    covered: boolean;
    matchedNodeIds: string[];
  }>;
  caseCovered: boolean;
  hardNegativeNodeIds: string[];
  bindingViolations: string[];
  timingMedianMs: number;
};

function eligibleAtomicNode(
  node: KnowledgeCorpusBundleV2["objects"][number]["nodes"][number],
) {
  return (
    node.kind === "TABLE"
    || (
      node.kind === "TEXT"
      && (node.role === "FACT" || node.role === "ACTION")
    )
  );
}

function summarizeArm(rows: readonly EvaluatedArmRow[]) {
  const multiClaimRows = rows.filter(({ multiClaim }) =>
    multiClaim);
  const requiredGroups = rows.flatMap(
    ({ requiredGroups: groups }) => groups,
  );
  const timings = rows.map(({ timingMedianMs }) =>
    timingMedianMs);
  return {
    totalCases: rows.length,
    supportCaseCoverage: rows.filter(
      ({ caseCovered }) => caseCovered,
    ).length,
    multiClaimJointCoverage: multiClaimRows.filter(
      ({ caseCovered }) => caseCovered,
    ).length,
    multiClaimTotal: multiClaimRows.length,
    requiredGroupCoverage: {
      covered: requiredGroups.filter(({ covered }) => covered)
        .length,
      total: requiredGroups.length,
    },
    hardNegativeIntrusionCases: rows.filter(
      ({ hardNegativeNodeIds }) =>
        hardNegativeNodeIds.length > 0,
    ).length,
    hardNegativeSelectedNodes: rows.reduce(
      (sum, { hardNegativeNodeIds }) =>
        sum + hardNegativeNodeIds.length,
      0,
    ),
    bindingViolationCount: rows.reduce(
      (sum, { bindingViolations }) =>
        sum + bindingViolations.length,
      0,
    ),
    latencyMs: {
      p50: round(nearestRankPercentile(timings, 0.5)),
      p95: round(nearestRankPercentile(timings, 0.95)),
    },
  };
}

function groupRows<T extends EvaluatedArmRow>(
  rows: readonly T[],
  key: (row: T) => string,
) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    grouped.set(value, [...(grouped.get(value) ?? []), row]);
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, group]) => [value, summarizeArm(group)]),
  );
}

export function evaluateT44SupportReranker(input: {
  runtime: T44SupportRuntimeSuite;
  qrels: T44SupportQrelsSuite;
  corpus: KnowledgeCorpusBundleV2;
  sidecarOutput: T44SupportRerankerSidecarOutput;
  runtimeInputSha256: string;
  sidecarOutputSha256: string;
  sidecarStderrSha256: string;
  sidecarStderrBytes: number;
  retrievalIdentitySha256: string;
  providerInvocationAudit: {
    observedCalls: number;
    channelCounts: {
      LEXICAL: number;
      TEXT_VECTOR: number;
      VISUAL_VECTOR: number;
      CAPTION_LEXICAL: number;
    };
    duplicateQueryChannelCalls: number;
    passed: boolean;
  };
  prerequisiteShadowAudit: {
    enabled: boolean;
    entryCount: number;
    staticEligibleCount: number;
    staticBypassCount: number;
    nonStaticDecisions: Array<{
      queryHash: string;
      decision: string;
    }>;
    passed: boolean;
  };
  generatedAt: string;
}) {
  const runtime = T44SupportRuntimeSuiteSchema.parse(
    input.runtime,
  );
  const qrels = T44SupportQrelsSuiteSchema.parse(
    input.qrels,
  );
  const corpus = verifyKnowledgeCorpusBundleV2(input.corpus);
  const sidecar =
    T44SupportRerankerSidecarOutputSchema.parse(
      input.sidecarOutput,
    );
  for (const hash of [
    input.runtimeInputSha256,
    input.sidecarOutputSha256,
    input.sidecarStderrSha256,
    input.retrievalIdentitySha256,
  ]) {
    HashSchema.parse(hash);
  }
  if (
    sidecar.runtimeSuite.id !== runtime.id
    || sidecar.runtimeSuite.version !== runtime.version
    || sidecar.runtimeSuite.suiteHash !== runtime.suiteHash
    || sidecar.corpusBundleHash !== corpus.bundleHash
    || sidecar.corpusBundleHash
      !== runtime.corpusSnapshot.bundleHash
  ) {
    throw new Error("T44_RERANKER_RUNTIME_BINDING_DRIFT");
  }
  const sidecarByCase = new Map(
    sidecar.cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  const qrelByCase = new Map(
    qrels.cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  const objectById = new Map(
    corpus.objects.map((object) => [object.id, object]),
  );
  const nodeById = new Map(
    corpus.objects.flatMap((object) =>
      object.nodes.map((node) => [
        node.id,
        { object, node },
      ] as const)),
  );
  const armRows = Object.fromEntries(
    T44_SUPPORT_RERANKER_ARMS.map((arm) =>
      [arm, [] as EvaluatedArmRow[]]),
  ) as Record<T44SupportRerankerArm, EvaluatedArmRow[]>;
  const objectRecallRows: Array<{
    caseId: string;
    requiredOwnerObjectIds: string[];
    recalledOwnerObjectIds: string[];
    passed: boolean;
  }> = [];

  for (const runtimeCase of runtime.cases) {
    const scored = sidecarByCase.get(runtimeCase.caseId);
    const qrel = qrelByCase.get(runtimeCase.caseId);
    if (!scored || !qrel) {
      throw new Error(
        `T44_RERANKER_CASE_BINDING_MISSING:${runtimeCase.caseId}`,
      );
    }
    if (scored.coursePackId !== runtimeCase.coursePackId) {
      throw new Error(
        `T44_RERANKER_CASE_SCOPE_DRIFT:${runtimeCase.caseId}`,
      );
    }
    const requiredOwnerObjectIds = [
      ...new Set(qrel.requiredEvidenceGroups.map((group) => {
        const binding = nodeById.get(
          group.acceptableNodeIds[0]!,
        );
        if (!binding) {
          throw new Error(
            `T44_RERANKER_QREL_NODE_MISSING:${runtimeCase.caseId}`,
          );
        }
        return binding.object.id;
      })),
    ].sort();
    const rankedObjectIds = new Set(
      scored.objectRanking.map(({ objectId }) => objectId),
    );
    const recalledOwnerObjectIds =
      requiredOwnerObjectIds.filter((objectId) =>
        rankedObjectIds.has(objectId));
    objectRecallRows.push({
      caseId: runtimeCase.caseId,
      requiredOwnerObjectIds,
      recalledOwnerObjectIds,
      passed:
        recalledOwnerObjectIds.length
        === requiredOwnerObjectIds.length,
    });

    for (const arm of T44_SUPPORT_RERANKER_ARMS) {
      const selected = selectT44SupportNodes(
        scored.arms[arm].ranking,
      );
      const selectedNodeIds = selected.map(({ nodeId }) =>
        nodeId);
      const selectedNodeSet = new Set(selectedNodeIds);
      const requiredGroups =
        qrel.requiredEvidenceGroups.map((group) => {
          const matchedNodeIds =
            group.acceptableNodeIds.filter((nodeId) =>
              selectedNodeSet.has(nodeId));
          return {
            groupId: group.groupId,
            covered: matchedNodeIds.length > 0,
            matchedNodeIds,
          };
        });
      const hardNegativeNodeIds =
        qrel.hardNegativeNodeIds.filter((nodeId) =>
          selectedNodeSet.has(nodeId));
      const bindingViolations: string[] = [];
      for (const selectedRow of selected) {
        const binding = nodeById.get(selectedRow.nodeId);
        const object = objectById.get(selectedRow.objectId);
        if (!binding || !object) {
          bindingViolations.push(
            `MISSING:${selectedRow.nodeId}`,
          );
          continue;
        }
        if (binding.object.id !== selectedRow.objectId) {
          bindingViolations.push(
            `OWNER:${selectedRow.nodeId}`,
          );
        }
        if (
          binding.object.sourceCoursePack.id
            !== runtimeCase.coursePackId
          || binding.object.sourceCoursePack.version
            !== runtimeCase.coursePackVersion
          || selectedRow.coursePackId
            !== runtimeCase.coursePackId
        ) {
          bindingViolations.push(
            `SCOPE:${selectedRow.nodeId}`,
          );
        }
        if (!eligibleAtomicNode(binding.node)) {
          bindingViolations.push(
            `ROLE:${selectedRow.nodeId}`,
          );
        }
      }
      armRows[arm].push({
        caseId: runtimeCase.caseId,
        coursePackId: runtimeCase.coursePackId,
        stratum: qrel.stratum,
        multiClaim: qrel.multiClaim,
        selectedNodeIds,
        selectedObjectIds: [
          ...new Set(selected.map(({ objectId }) => objectId)),
        ],
        requiredGroups,
        caseCovered: requiredGroups.every(
          ({ covered }) => covered,
        ),
        hardNegativeNodeIds,
        bindingViolations,
        timingMedianMs:
          scored.arms[arm].timingMs.median,
      });
    }
  }

  const arms = Object.fromEntries(
    T44_SUPPORT_RERANKER_ARMS.map((arm) => [
      arm,
      {
        aggregate: summarizeArm(armRows[arm]),
        byCoursePack: groupRows(
          armRows[arm],
          ({ coursePackId }) => coursePackId,
        ),
        byStratum: groupRows(
          armRows[arm],
          ({ stratum }) => stratum,
        ),
      },
    ]),
  ) as Record<
    T44SupportRerankerArm,
    {
      aggregate: ReturnType<typeof summarizeArm>;
      byCoursePack: ReturnType<typeof groupRows>;
      byStratum: ReturnType<typeof groupRows>;
    }
  >;
  const extraLatencyRows = runtime.cases.map(({ caseId }) => {
    const scored = sidecarByCase.get(caseId)!;
    const baselineMs =
      scored.arms.A_BGE_NODE_SCORE.timingMs.median;
    const rerankerMs =
      scored.arms.B_BGE_RERANKER_BASE.timingMs.median;
    return {
      caseId,
      baselineMs: round(baselineMs),
      rerankerMs: round(rerankerMs),
      extraMs: round(Math.max(0, rerankerMs - baselineMs)),
    };
  });
  const baselineP95 =
    arms.A_BGE_NODE_SCORE.aggregate.latencyMs.p95;
  const extraP95 = round(nearestRankPercentile(
    extraLatencyRows.map(({ extraMs }) => extraMs),
    0.95,
  ));
  const latencyThresholdMs = round(Math.max(
    T44_SUPPORT_RERANKER_GATES_V1.latencyFloorMs,
    baselineP95
      * T44_SUPPORT_RERANKER_GATES_V1
        .latencyBaselineFraction,
  ));
  const candidateAggregate =
    arms.B_BGE_RERANKER_BASE.aggregate;
  const gateResults = {
    objectRecallNoRegression: {
      observed: `${objectRecallRows.filter(
        ({ passed }) => passed,
      ).length}/50 shared`,
      required: "B equals A",
      passed: true,
    },
    supportCaseCoverage: {
      observed: candidateAggregate.supportCaseCoverage,
      required:
        T44_SUPPORT_RERANKER_GATES_V1
          .supportCaseCoverageMinimum,
      passed:
        candidateAggregate.supportCaseCoverage
        >= T44_SUPPORT_RERANKER_GATES_V1
          .supportCaseCoverageMinimum,
    },
    multiClaimJointCoverage: {
      observed: candidateAggregate.multiClaimJointCoverage,
      required:
        T44_SUPPORT_RERANKER_GATES_V1
          .multiClaimJointCoverageMinimum,
      passed:
        candidateAggregate.multiClaimJointCoverage
        >= T44_SUPPORT_RERANKER_GATES_V1
          .multiClaimJointCoverageMinimum,
    },
    bindingViolations: {
      observed: candidateAggregate.bindingViolationCount,
      required:
        T44_SUPPORT_RERANKER_GATES_V1
          .bindingViolationMaximum,
      passed:
        candidateAggregate.bindingViolationCount
        <= T44_SUPPORT_RERANKER_GATES_V1
          .bindingViolationMaximum,
    },
    extraLatencyP95: {
      observedMs: extraP95,
      requiredMaximumMs: latencyThresholdMs,
      passed: extraP95 <= latencyThresholdMs,
    },
    providerInvocationParity: {
      observed: input.providerInvocationAudit,
      required: {
        observedCalls: 100,
        channelCounts: {
          LEXICAL: 50,
          TEXT_VECTOR: 50,
          VISUAL_VECTOR: 0,
          CAPTION_LEXICAL: 0,
        },
        duplicateQueryChannelCalls: 0,
      },
      passed: input.providerInvocationAudit.passed,
    },
    prerequisiteShadowIntegrity: {
      observed: input.prerequisiteShadowAudit,
      required: {
        enabled: true,
        entryCount: 50,
        staticEligibleCount: 50,
        nonStaticDecisions: [],
      },
      passed: input.prerequisiteShadowAudit.passed,
    },
  };
  const reportWithoutHash = {
    schemaVersion: 1,
    evaluatorVersion:
      T44_SUPPORT_RERANKER_EVALUATOR_VERSION,
    generatedAt: input.generatedAt,
    candidateId: "bge-reranker-base-2cfc18c9",
    suite: {
      runtimeId: runtime.id,
      runtimeVersion: runtime.version,
      runtimeSuiteHash: runtime.suiteHash,
      qrelsId: qrels.id,
      qrelsVersion: qrels.version,
      qrelsSuiteHash: qrels.suiteHash,
      corpusBundleHash: corpus.bundleHash,
    },
    artifacts: {
      runtimeInputSha256: input.runtimeInputSha256,
      sidecarOutputSha256: input.sidecarOutputSha256,
      sidecarStderrSha256: input.sidecarStderrSha256,
      sidecarStderrBytes: input.sidecarStderrBytes,
      retrievalIdentitySha256:
        input.retrievalIdentitySha256,
    },
    config: T44_SUPPORT_RERANKER_CONFIG_V1,
    gates: T44_SUPPORT_RERANKER_GATES_V1,
    models: sidecar.models,
    environment: sidecar.environment,
    timingProtocol: sidecar.timingProtocol,
    providerInvocationAudit:
      input.providerInvocationAudit,
    prerequisiteShadowAudit:
      input.prerequisiteShadowAudit,
    objectRecall: {
      casesWithAllRequiredOwnersAt10:
        objectRecallRows.filter(({ passed }) => passed).length,
      total: objectRecallRows.length,
      sharedAcrossArms: true,
      rows: objectRecallRows,
    },
    arms,
    latencyComparison: {
      baselineP95Ms: baselineP95,
      rerankerP95Ms:
        arms.B_BGE_RERANKER_BASE.aggregate.latencyMs.p95,
      extraP95Ms: extraP95,
      thresholdMs: latencyThresholdMs,
      rows: extraLatencyRows,
    },
    cases: runtime.cases.map(({ caseId }) => ({
      caseId,
      A_BGE_NODE_SCORE: armRows.A_BGE_NODE_SCORE.find(
        (row) => row.caseId === caseId,
      )!,
      B_BGE_RERANKER_BASE:
        armRows.B_BGE_RERANKER_BASE.find(
          (row) => row.caseId === caseId,
        )!,
    })),
    gateResults,
    decision: Object.values(gateResults).every(
      ({ passed }) => passed,
    )
      ? "GO"
      : "NO_GO",
  };
  return {
    ...reportWithoutHash,
    reportHash: sha256StableJsonV2(reportWithoutHash),
  };
}

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { z } from "zod";

import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  serializeT44ClaimCandidateRuntimeInputV1,
  sha256T44ClaimCandidateRuntimeInputV1,
  T44ClaimCandidateRuntimeInputV1Schema,
  type T44ClaimCandidateRuntimeInputV1,
} from "./t44-claim-candidate-evaluator";
import {
  T44_CLAIM_MATRIX_CONFIG_V1,
  T44ClaimMatrixRankingV1Schema as RankingV1Schema,
  T44ClaimMatrixSidecarOutputV1Schema,
  T44ClaimMatrixTimingV1Schema as TimingV1Schema,
  type T44ClaimMatrixRankedNodeV1,
  type T44ClaimMatrixSidecarOutputV1,
} from "./t44-claim-matrix-contract-v1";

export {
  T44_CLAIM_MATRIX_CONFIG_HASH_V1,
  T44_CLAIM_MATRIX_CONFIG_V1,
  T44ClaimMatrixRankedNodeV1Schema,
  T44ClaimMatrixSidecarOutputV1Schema,
  type T44ClaimMatrixRankedNodeV1,
  type T44ClaimMatrixSidecarOutputV1,
} from "./t44-claim-matrix-contract-v1";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const IdSchema = z.string().regex(ID_PATTERN);

export const T44_CLAIM_COVERAGE_STRATA_V1 =
  Object.freeze([
    "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
    "ANSWERABLE_PARAPHRASE_ALIAS",
    "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
    "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
    "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
  ] as const);

export const T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1 =
  Object.freeze({
    id: "lumi-t44-claim-coverage-selector-v1",
    version: "2026-07-29.1",
    topK: 8,
    baselineMaxPerObject: 3,
    claimCandidateLimit: 8,
    assignmentObjective:
      "MAX_RECIPROCAL_RANK_WEIGHT_ONE_TO_ONE",
    assignmentTieBreak:
      "WEIGHT_DESC_THEN_ASSIGNED_COUNT_DESC_THEN_CLAIM_ORDER_NODE_ID",
    fillRrfK: 60,
    wholeQueryFillWeight: 1,
    supportClaimTotalFillWeight: 1,
    fillNodeOrdering:
      "WEIGHTED_RRF_DESC_THEN_BEST_RANK_THEN_NODE_ID",
    fillObjectOrdering:
      "BEST_REMAINING_NODE_THEN_OBJECT_ID",
    fillPolicy:
      "FIXED_OBJECT_ORDER_ONE_NODE_PER_OBJECT_PER_ROUND",
    timingRepetitions: 3,
    timingCaseAggregate: "MEDIAN",
    timingSuiteAggregate: "P95_NEAREST_RANK",
    extraTimingFormula:
      "MAX_ZERO_B_MATRIX_PLUS_SELECTOR_MINUS_A_MATRIX_PLUS_SELECTOR",
  } as const);

export const T44_CLAIM_COVERAGE_SELECTOR_CONFIG_HASH_V1 =
  sha256StableJsonV2(
    T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1,
  );

export const T44_CLAIM_COVERAGE_GATES_V1 =
  Object.freeze({
    supportCaseCoverageMinimum: 45,
    multiClaimJointCoverageMinimum: 9,
    bindingViolationMaximum: 0,
    nodeSelectionExtraP95MaximumMs: 50,
    candidateExpansionP95MaximumMs: 250,
  } as const);

type ClaimRankingInput = {
  claimId: string;
  ranking: readonly T44ClaimMatrixRankedNodeV1[];
};

export type ClaimNodeAssignmentV1 = {
  claimId: string;
  nodeId: string;
  objectId: string;
  coursePackId: string;
  sourceRank: number;
  reciprocalRankWeight: number;
};

function compareCodePoints(
  left: string,
  right: string,
) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function assignmentLexicalKey(
  assignments: readonly (
    ClaimNodeAssignmentV1 | null
  )[],
) {
  return assignments.map((assignment) =>
    assignment?.nodeId ?? "\uffff");
}

function compareAssignmentVectors(
  left: readonly (ClaimNodeAssignmentV1 | null)[],
  right: readonly (ClaimNodeAssignmentV1 | null)[],
) {
  const leftKey = assignmentLexicalKey(left);
  const rightKey = assignmentLexicalKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    const compared = compareCodePoints(
      leftKey[index]!,
      rightKey[index]!,
    );
    if (compared !== 0) return compared;
  }
  return 0;
}

export function maximumWeightClaimNodeAssignmentV1(
  claimRankingsInput: readonly ClaimRankingInput[],
): ClaimNodeAssignmentV1[] {
  const claimRankings = claimRankingsInput.map(
    ({ claimId, ranking }) => ({
      claimId: IdSchema.parse(claimId),
      ranking: RankingV1Schema.parse(ranking).slice(
        0,
        T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1
          .claimCandidateLimit,
      ),
    }),
  );
  if (
    claimRankings.length < 1
    || claimRankings.length > 4
    || new Set(
      claimRankings.map(({ claimId }) => claimId),
    ).size !== claimRankings.length
  ) {
    throw new Error(
      "T44_CLAIM_ASSIGNMENT_CLAIMS_INVALID",
    );
  }
  let best: {
    score: number;
    assignedCount: number;
    assignments: Array<ClaimNodeAssignmentV1 | null>;
  } | null = null;
  const current: Array<ClaimNodeAssignmentV1 | null> =
    [];
  const used = new Set<string>();

  const visit = (claimIndex: number, score: number) => {
    if (claimIndex === claimRankings.length) {
      const assignedCount = current.filter(
        (assignment) => assignment !== null,
      ).length;
      const candidate = {
        score,
        assignedCount,
        assignments: [...current],
      };
      if (
        best === null
        || candidate.score > best.score
        || (
          candidate.score === best.score
          && candidate.assignedCount
            > best.assignedCount
        )
        || (
          candidate.score === best.score
          && candidate.assignedCount
            === best.assignedCount
          && compareAssignmentVectors(
            candidate.assignments,
            best.assignments,
          ) < 0
        )
      ) {
        best = candidate;
      }
      return;
    }
    const claim = claimRankings[claimIndex]!;
    for (const row of claim.ranking) {
      if (used.has(row.nodeId)) continue;
      used.add(row.nodeId);
      const assignment = {
        claimId: claim.claimId,
        nodeId: row.nodeId,
        objectId: row.objectId,
        coursePackId: row.coursePackId,
        sourceRank: row.rank,
        reciprocalRankWeight: 1 / row.rank,
      };
      current.push(assignment);
      visit(
        claimIndex + 1,
        score + assignment.reciprocalRankWeight,
      );
      current.pop();
      used.delete(row.nodeId);
    }
    current.push(null);
    visit(claimIndex + 1, score);
    current.pop();
  };

  visit(0, 0);
  const resolvedBest = best as {
    score: number;
    assignedCount: number;
    assignments: Array<ClaimNodeAssignmentV1 | null>;
  } | null;
  return (
    resolvedBest?.assignments.filter(
      (
        assignment,
      ): assignment is ClaimNodeAssignmentV1 =>
        assignment !== null,
    ) ?? []
  );
}

type NodeAggregate = {
  row: T44ClaimMatrixRankedNodeV1;
  weightedRrfScore: number;
  bestRank: number;
};

function aggregateFillRanking(input: {
  wholeQueryRanking:
    readonly T44ClaimMatrixRankedNodeV1[];
  claimRankings: readonly ClaimRankingInput[];
}) {
  const whole = RankingV1Schema.parse(
    input.wholeQueryRanking,
  );
  const claims = input.claimRankings.map(
    ({ claimId, ranking }) => ({
      claimId: IdSchema.parse(claimId),
      ranking: RankingV1Schema.parse(ranking),
    }),
  );
  const aggregate = new Map<string, NodeAggregate>();
  const sources = [
    {
      weight:
        T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1
          .wholeQueryFillWeight,
      ranking: whole,
    },
    ...claims.map(({ ranking }) => ({
      weight:
        T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1
          .supportClaimTotalFillWeight
        / claims.length,
      ranking,
    })),
  ];
  for (const source of sources) {
    for (const row of source.ranking) {
      const current = aggregate.get(row.nodeId) ?? {
        row,
        weightedRrfScore: 0,
        bestRank: row.rank,
      };
      if (
        current.row.objectId !== row.objectId
        || current.row.coursePackId !== row.coursePackId
      ) {
        throw new Error(
          `T44_CLAIM_FILL_BINDING_DRIFT:${row.nodeId}`,
        );
      }
      current.weightedRrfScore +=
        source.weight / (
          T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1
            .fillRrfK
          + row.rank
        );
      current.bestRank = Math.min(
        current.bestRank,
        row.rank,
      );
      aggregate.set(row.nodeId, current);
    }
  }
  return aggregate;
}

function compareAggregates(
  left: NodeAggregate,
  right: NodeAggregate,
) {
  return (
    right.weightedRrfScore
      - left.weightedRrfScore
    || left.bestRank - right.bestRank
    || compareCodePoints(
      left.row.nodeId,
      right.row.nodeId,
    )
  );
}

export type SelectedClaimNodeV1 = {
  nodeId: string;
  objectId: string;
  coursePackId: string;
  selectionSource: "BASELINE" | "CLAIM_ASSIGNMENT" | "RRF_FILL";
  claimId: string | null;
  aggregateRrfScore: number;
};

export function selectT44BaselineNodesV1(
  rankingInput:
    readonly T44ClaimMatrixRankedNodeV1[],
): SelectedClaimNodeV1[] {
  const ranking = RankingV1Schema.parse(rankingInput);
  const countByObject = new Map<string, number>();
  const selected: SelectedClaimNodeV1[] = [];
  for (const row of ranking) {
    const count = countByObject.get(row.objectId) ?? 0;
    if (
      count
      >= T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1
        .baselineMaxPerObject
    ) {
      continue;
    }
    selected.push({
      nodeId: row.nodeId,
      objectId: row.objectId,
      coursePackId: row.coursePackId,
      selectionSource: "BASELINE",
      claimId: null,
      aggregateRrfScore: 1 / (
        T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1.fillRrfK
        + row.rank
      ),
    });
    countByObject.set(row.objectId, count + 1);
    if (
      selected.length
      === T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1.topK
    ) {
      break;
    }
  }
  return selected;
}

export function selectT44ClaimCoverageNodesV1(input: {
  wholeQueryRanking:
    readonly T44ClaimMatrixRankedNodeV1[];
  claimRankings: readonly ClaimRankingInput[];
}): SelectedClaimNodeV1[] {
  const aggregate = aggregateFillRanking(input);
  const assignments =
    maximumWeightClaimNodeAssignmentV1(
      input.claimRankings,
    );
  const selected: SelectedClaimNodeV1[] =
    assignments.map((assignment) => ({
      nodeId: assignment.nodeId,
      objectId: assignment.objectId,
      coursePackId: assignment.coursePackId,
      selectionSource:
        "CLAIM_ASSIGNMENT" as const,
      claimId: assignment.claimId,
      aggregateRrfScore:
        aggregate.get(assignment.nodeId)!
          .weightedRrfScore,
    }));
  const selectedIds = new Set(
    selected.map(({ nodeId }) => nodeId),
  );
  const byObject = new Map<string, NodeAggregate[]>();
  for (const candidate of aggregate.values()) {
    if (selectedIds.has(candidate.row.nodeId)) continue;
    byObject.set(candidate.row.objectId, [
      ...(byObject.get(candidate.row.objectId) ?? []),
      candidate,
    ]);
  }
  for (const values of byObject.values()) {
    values.sort(compareAggregates);
  }
  const objectOrder = [...byObject.entries()]
    .sort((left, right) =>
      compareAggregates(left[1][0]!, right[1][0]!)
      || compareCodePoints(left[0], right[0]))
    .map(([objectId]) => objectId);
  while (
    selected.length
    < T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1.topK
  ) {
    let progressed = false;
    for (const objectId of objectOrder) {
      const candidate = byObject.get(objectId)?.shift();
      if (!candidate) continue;
      progressed = true;
      selected.push({
        nodeId: candidate.row.nodeId,
        objectId: candidate.row.objectId,
        coursePackId: candidate.row.coursePackId,
        selectionSource: "RRF_FILL",
        claimId: null,
        aggregateRrfScore:
          candidate.weightedRrfScore,
      });
      if (
        selected.length
        === T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1.topK
      ) {
        break;
      }
    }
    if (!progressed) break;
  }
  return selected;
}

const SelectedNodeV1Schema = z
  .object({
    nodeId: IdSchema,
    objectId: IdSchema,
    coursePackId: IdSchema,
    selectionSource: z.enum([
      "BASELINE",
      "CLAIM_ASSIGNMENT",
      "RRF_FILL",
    ]),
    claimId: IdSchema.nullable(),
    aggregateRrfScore:
      z.number().finite().positive(),
  })
  .strict()
  .superRefine((row, context) => {
    if (
      (row.selectionSource === "CLAIM_ASSIGNMENT")
      !== (row.claimId !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["claimId"],
        message:
          "only claim assignments bind a claim id",
      });
    }
  });

const SelectionArmV1Schema = z
  .object({
    selectorTimingMs: TimingV1Schema,
    selected: z
      .array(SelectedNodeV1Schema)
      .max(8),
  })
  .strict()
  .superRefine((arm, context) => {
    if (
      new Set(
        arm.selected.map(({ nodeId }) => nodeId),
      ).size !== arm.selected.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["selected"],
        message: "selected nodes must be unique",
      });
    }
  });

const SelectorConfigSchema = z
  .object({
    id: z.literal(
      T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1.id,
    ),
    version: z.literal(
      T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1.version,
    ),
    topK: z.literal(8),
    baselineMaxPerObject: z.literal(3),
    claimCandidateLimit: z.literal(8),
    assignmentObjective: z.literal(
      T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1
        .assignmentObjective,
    ),
    assignmentTieBreak: z.literal(
      T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1
        .assignmentTieBreak,
    ),
    fillRrfK: z.literal(60),
    wholeQueryFillWeight: z.literal(1),
    supportClaimTotalFillWeight: z.literal(1),
    fillNodeOrdering: z.literal(
      T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1
        .fillNodeOrdering,
    ),
    fillObjectOrdering: z.literal(
      T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1
        .fillObjectOrdering,
    ),
    fillPolicy: z.literal(
      T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1
        .fillPolicy,
    ),
    timingRepetitions: z.literal(3),
    timingCaseAggregate: z.literal("MEDIAN"),
    timingSuiteAggregate: z.literal(
      "P95_NEAREST_RANK",
    ),
    extraTimingFormula: z.literal(
      T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1
        .extraTimingFormula,
    ),
  })
  .strict();

export const T44ClaimSelectionArtifactV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T44_CLAIM_COVERAGE_SELECTIONS",
    ),
    candidateInputSha256: HashSchema,
    matrixOutputSha256: HashSchema,
    runtimeSuite: z
      .object({
        id: IdSchema,
        version: z.string().trim().min(1).max(50),
        suiteHash: HashSchema,
      })
      .strict(),
    corpusBundleHash: HashSchema,
    config: SelectorConfigSchema,
    configHash: z.literal(
      T44_CLAIM_COVERAGE_SELECTOR_CONFIG_HASH_V1,
    ),
    cases: z
      .array(z
        .object({
          caseId: IdSchema,
          coursePackId: IdSchema,
          candidateNodeIdsSha256: HashSchema,
          matrixTimingMs: z
            .object({
              A_FULL_QUERY: TimingV1Schema,
              B_CLAIM_MATRIX: TimingV1Schema,
            })
            .strict(),
          arms: z
            .object({
              A_FULL_QUERY: SelectionArmV1Schema,
              B_CLAIM_MATRIX: SelectionArmV1Schema,
            })
            .strict(),
        })
        .strict())
      .length(50),
  })
    .strict()
    .superRefine((artifact, context) => {
      if (
        artifact.configHash
        !== sha256StableJsonV2(artifact.config)
      ) {
        context.addIssue({
          code: "custom",
          path: ["configHash"],
          message: "selector config hash mismatch",
        });
      }
      const caseIds = artifact.cases.map(
        ({ caseId }) => caseId,
      );
      if (new Set(caseIds).size !== caseIds.length) {
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message: "selection case ids must be unique",
        });
      }
    });

export type T44ClaimSelectionArtifactV1 = z.infer<
  typeof T44ClaimSelectionArtifactV1Schema
>;

function sha256Text(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function timedSelection<T>(select: () => T) {
  const samples: number[] = [];
  let result: T | undefined;
  let serialized: string | undefined;
  for (
    let index = 0;
    index
      < T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1
        .timingRepetitions;
    index += 1
  ) {
    const started = performance.now();
    const current = select();
    samples.push(
      Math.max(0, performance.now() - started),
    );
    const currentSerialized = JSON.stringify(current);
    if (
      serialized !== undefined
      && serialized !== currentSerialized
    ) {
      throw new Error(
        "T44_CLAIM_SELECTOR_NONDETERMINISTIC",
      );
    }
    result = current;
    serialized = currentSerialized;
  }
  const ordered = [...samples].sort(
    (left, right) => left - right,
  );
  return {
    result: result!,
    timingMs: {
      samples,
      median: ordered[1]!,
    },
  };
}

function assertMatrixCaseBinding(input: {
  candidateCase:
    T44ClaimCandidateRuntimeInputV1["cases"][number];
  matrixCase:
    T44ClaimMatrixSidecarOutputV1["cases"][number];
}) {
  if (
    input.matrixCase.coursePackId
      !== input.candidateCase.coursePackId
    || input.matrixCase.candidateCount
      !== input.candidateCase.candidateNodes.length
    || input.matrixCase.candidateNodeIdsSha256
      !== input.candidateCase.candidateNodeIdsSha256
  ) {
    throw new Error(
      `T44_CLAIM_MATRIX_CASE_BINDING_DRIFT:${input.candidateCase.caseId}`,
    );
  }
  const expectedNodeIds =
    input.candidateCase.candidateNodes
      .map(({ nodeId }) => nodeId)
      .sort(compareCodePoints);
  const rankings = [
    input.matrixCase.arms.A_FULL_QUERY
      .wholeQueryRanking,
    input.matrixCase.arms.B_CLAIM_MATRIX
      .wholeQueryRanking,
    ...input.matrixCase.arms.B_CLAIM_MATRIX
      .claimRankings.map(({ ranking }) => ranking),
  ];
  if (
    rankings.some((ranking) =>
      JSON.stringify(
        ranking.map(({ nodeId }) => nodeId)
          .sort(compareCodePoints),
      ) !== JSON.stringify(expectedNodeIds))
  ) {
    throw new Error(
      `T44_CLAIM_MATRIX_CANDIDATE_SET_DRIFT:${input.candidateCase.caseId}`,
    );
  }
  const expectedClaims =
    input.candidateCase.decomposition.claims.map(
      ({ claimId, textHash }) => ({
        claimId,
        textHash,
      }),
    );
  const observedClaims =
    input.matrixCase.arms.B_CLAIM_MATRIX
      .claimRankings.map(
        ({ claimId, textHash }) => ({
          claimId,
          textHash,
        }),
      );
  if (
    JSON.stringify(observedClaims)
    !== JSON.stringify(expectedClaims)
  ) {
    throw new Error(
      `T44_CLAIM_MATRIX_CLAIM_BINDING_DRIFT:${input.candidateCase.caseId}`,
    );
  }
}

export function buildT44ClaimSelectionArtifactV1(
  input: {
    serializedCandidateInput: string;
    candidateInputSha256: string;
    serializedMatrixOutput: string;
    matrixOutputSha256: string;
  },
): T44ClaimSelectionArtifactV1 {
  const candidateHash = HashSchema.parse(
    input.candidateInputSha256,
  );
  const observedCandidateHash =
    sha256T44ClaimCandidateRuntimeInputV1(
      input.serializedCandidateInput,
    );
  if (candidateHash !== observedCandidateHash) {
    throw new Error(
      "T44_CLAIM_SELECTION_CANDIDATE_SEAL_MISMATCH",
    );
  }
  const matrixHash = HashSchema.parse(
    input.matrixOutputSha256,
  );
  if (
    matrixHash
    !== sha256Text(input.serializedMatrixOutput)
  ) {
    throw new Error(
      "T44_CLAIM_SELECTION_MATRIX_SEAL_MISMATCH",
    );
  }
  const candidate =
    T44ClaimCandidateRuntimeInputV1Schema.parse(
      JSON.parse(input.serializedCandidateInput),
    );
  const matrix =
    T44ClaimMatrixSidecarOutputV1Schema.parse(
      JSON.parse(input.serializedMatrixOutput),
    );
  if (
    matrix.candidateInputSha256 !== candidateHash
    || matrix.corpusBundleHash
      !== candidate.corpusSnapshot.bundleHash
    || JSON.stringify(matrix.runtimeSuite)
      !== JSON.stringify(candidate.runtimeSuite)
  ) {
    throw new Error(
      "T44_CLAIM_SELECTION_ARTIFACT_BINDING_DRIFT",
    );
  }
  const matrixByCase = new Map(
    matrix.cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  const cases = candidate.cases.map((candidateCase) => {
    const matrixCase = matrixByCase.get(
      candidateCase.caseId,
    );
    if (!matrixCase) {
      throw new Error(
        `T44_CLAIM_MATRIX_CASE_MISSING:${candidateCase.caseId}`,
      );
    }
    assertMatrixCaseBinding({
      candidateCase,
      matrixCase,
    });
    const baseline = timedSelection(() =>
      selectT44BaselineNodesV1(
        matrixCase.arms.A_FULL_QUERY
          .wholeQueryRanking,
      ));
    const claimCoverage = timedSelection(() =>
      selectT44ClaimCoverageNodesV1({
        wholeQueryRanking:
          matrixCase.arms.B_CLAIM_MATRIX
            .wholeQueryRanking,
        claimRankings:
          matrixCase.arms.B_CLAIM_MATRIX
            .claimRankings,
      }));
    return {
      caseId: candidateCase.caseId,
      coursePackId: candidateCase.coursePackId,
      candidateNodeIdsSha256:
        candidateCase.candidateNodeIdsSha256,
      matrixTimingMs: {
        A_FULL_QUERY:
          matrixCase.arms.A_FULL_QUERY.timingMs,
        B_CLAIM_MATRIX:
          matrixCase.arms.B_CLAIM_MATRIX.timingMs,
      },
      arms: {
        A_FULL_QUERY: {
          selectorTimingMs: baseline.timingMs,
          selected: baseline.result,
        },
        B_CLAIM_MATRIX: {
          selectorTimingMs: claimCoverage.timingMs,
          selected: claimCoverage.result,
        },
      },
    };
  });
  return T44ClaimSelectionArtifactV1Schema.parse({
    schemaVersion: 1,
    kind: "T44_CLAIM_COVERAGE_SELECTIONS",
    candidateInputSha256: candidateHash,
    matrixOutputSha256: matrixHash,
    runtimeSuite: candidate.runtimeSuite,
    corpusBundleHash:
      candidate.corpusSnapshot.bundleHash,
    config: T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1,
    configHash:
      T44_CLAIM_COVERAGE_SELECTOR_CONFIG_HASH_V1,
    cases,
  });
}

export function serializeT44ClaimSelectionArtifactV1(
  artifact: T44ClaimSelectionArtifactV1,
) {
  return `${JSON.stringify(
    T44ClaimSelectionArtifactV1Schema.parse(artifact),
    null,
    2,
  )}\n`;
}

export function sha256T44ClaimSelectionArtifactV1(
  serializedArtifact: string,
) {
  return sha256Text(serializedArtifact);
}

export function serializeT44ClaimMatrixOutputV1(
  output: T44ClaimMatrixSidecarOutputV1,
) {
  return `${JSON.stringify(
    T44ClaimMatrixSidecarOutputV1Schema.parse(output),
    null,
    2,
  )}\n`;
}

export function nearestRankPercentileV1(
  values: readonly number[],
  percentile: number,
) {
  if (
    values.length === 0
    || percentile <= 0
    || percentile > 1
    || values.some(
      (value) =>
        !Number.isFinite(value) || value < 0,
    )
  ) {
    throw new Error(
      "T44_CLAIM_PERCENTILE_INPUT_INVALID",
    );
  }
  const ordered = [...values].sort(
    (left, right) => left - right,
  );
  return ordered[
    Math.ceil(percentile * ordered.length) - 1
  ]!;
}

const EvaluationQrelCaseV1Schema = z
  .object({
    caseId: IdSchema,
    stratum: z.enum(
      T44_CLAIM_COVERAGE_STRATA_V1,
    ),
    multiClaim: z.boolean(),
    requiredEvidenceGroups: z
      .array(z
        .object({
          groupId: IdSchema,
          acceptableNodeIds: z
            .array(IdSchema)
            .min(1)
            .max(3),
        })
        .strict())
      .min(1)
      .max(4),
    hardNegativeNodeIds: z
      .array(IdSchema)
      .min(1)
      .max(4),
  })
  .strict()
  .superRefine((testCase, context) => {
    const required = new Set(
      testCase.requiredEvidenceGroups.flatMap(
        ({ acceptableNodeIds }) =>
          acceptableNodeIds,
      ),
    );
    if (
      testCase.hardNegativeNodeIds.some((nodeId) =>
        required.has(nodeId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["hardNegativeNodeIds"],
        message:
          "hard negatives must not overlap required nodes",
      });
    }
  });

export type T44ClaimCoverageEvaluationQrelCaseV1 =
  z.infer<typeof EvaluationQrelCaseV1Schema>;

type EvaluatedSelectionRow = {
  caseId: string;
  coursePackId: string;
  stratum: string;
  multiClaim: boolean;
  selectedNodeIds: string[];
  requiredGroups: Array<{
    groupId: string;
    covered: boolean;
    matchedNodeIds: string[];
  }>;
  caseCovered: boolean;
  hardNegativeNodeIds: string[];
  bindingViolations: string[];
};

function eligibleAtomicNode(
  node: KnowledgeCorpusBundleV2["objects"][number][
    "nodes"
  ][number],
) {
  return (
    node.kind === "TABLE"
    || (
      node.kind === "TEXT"
      && (
        node.role === "FACT"
        || node.role === "ACTION"
      )
    )
  );
}

function summarizeSelectionRows(
  rows: readonly EvaluatedSelectionRow[],
) {
  const multi = rows.filter(({ multiClaim }) =>
    multiClaim);
  const groups = rows.flatMap(
    ({ requiredGroups }) => requiredGroups,
  );
  return {
    totalCases: rows.length,
    supportCaseCoverage: rows.filter(
      ({ caseCovered }) => caseCovered,
    ).length,
    multiClaimJointCoverage: multi.filter(
      ({ caseCovered }) => caseCovered,
    ).length,
    multiClaimTotal: multi.length,
    requiredGroupCoverage: {
      covered: groups.filter(({ covered }) => covered)
        .length,
      total: groups.length,
    },
    hardNegativeIntrusionCases: rows.filter(
      ({ hardNegativeNodeIds }) =>
        hardNegativeNodeIds.length > 0,
    ).length,
    bindingViolationCount: rows.reduce(
      (sum, { bindingViolations }) =>
        sum + bindingViolations.length,
      0,
    ),
  };
}

function groupSelectionRows(
  rows: readonly EvaluatedSelectionRow[],
  key: (row: EvaluatedSelectionRow) => string,
) {
  const values = new Map<string, EvaluatedSelectionRow[]>();
  for (const row of rows) {
    const group = key(row);
    values.set(group, [
      ...(values.get(group) ?? []),
      row,
    ]);
  }
  return Object.fromEntries(
    [...values.entries()]
      .sort(([left], [right]) =>
        compareCodePoints(left, right))
      .map(([group, grouped]) => [
        group,
        summarizeSelectionRows(grouped),
      ]),
  );
}

export function evaluateT44ClaimCoverageV1(input: {
  serializedCandidateInput: string;
  candidateInputSha256: string;
  serializedMatrixOutput: string;
  matrixOutputSha256: string;
  serializedSelectionArtifact: string;
  selectionArtifactSha256: string;
  qrelCases:
    readonly T44ClaimCoverageEvaluationQrelCaseV1[];
  corpus: KnowledgeCorpusBundleV2;
  candidateExpansionTimingMs: readonly {
    caseId: string;
    durationMs: number;
  }[];
  providerInvocationAudit: {
    observedCalls: number;
    channelCounts: {
      LEXICAL: number;
      TEXT_VECTOR: number;
      VISUAL_VECTOR: number;
      CAPTION_LEXICAL: number;
    };
  };
}) {
  const candidateHash = HashSchema.parse(
    input.candidateInputSha256,
  );
  const matrixHash = HashSchema.parse(
    input.matrixOutputSha256,
  );
  const selectionHash = HashSchema.parse(
    input.selectionArtifactSha256,
  );
  if (
    sha256T44ClaimCandidateRuntimeInputV1(
      input.serializedCandidateInput,
    ) !== candidateHash
    || sha256Text(input.serializedMatrixOutput)
      !== matrixHash
    || sha256Text(
      input.serializedSelectionArtifact,
    ) !== selectionHash
  ) {
    throw new Error(
      "T44_CLAIM_EVALUATION_ARTIFACT_SEAL_MISMATCH",
    );
  }
  const candidate =
    T44ClaimCandidateRuntimeInputV1Schema.parse(
      JSON.parse(input.serializedCandidateInput),
    );
  const matrix =
    T44ClaimMatrixSidecarOutputV1Schema.parse(
      JSON.parse(input.serializedMatrixOutput),
    );
  const selection =
    T44ClaimSelectionArtifactV1Schema.parse(
      JSON.parse(input.serializedSelectionArtifact),
    );
  const corpus = verifyKnowledgeCorpusBundleV2(
    input.corpus,
  );
  if (
    matrix.candidateInputSha256 !== candidateHash
    || selection.candidateInputSha256 !== candidateHash
    || selection.matrixOutputSha256 !== matrixHash
    || candidate.corpusSnapshot.bundleHash
      !== corpus.bundleHash
    || matrix.corpusBundleHash !== corpus.bundleHash
    || selection.corpusBundleHash !== corpus.bundleHash
  ) {
    throw new Error(
      "T44_CLAIM_EVALUATION_BINDING_DRIFT",
    );
  }
  const qrels = z
    .array(EvaluationQrelCaseV1Schema)
    .length(50)
    .parse(input.qrelCases);
  const qrelByCase = new Map(
    qrels.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  if (
    qrelByCase.size !== 50
    || candidate.cases.some(
      ({ caseId }) => !qrelByCase.has(caseId),
    )
  ) {
    throw new Error(
      "T44_CLAIM_EVALUATION_QREL_CASE_DRIFT",
    );
  }
  const selectionByCase = new Map(
    selection.cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  const objectById = new Map(
    corpus.objects.map((object) => [
      object.id,
      object,
    ]),
  );
  const nodeById = new Map(
    corpus.objects.flatMap((object) =>
      object.nodes.map((node) => [
        node.id,
        { object, node },
      ] as const)),
  );
  const arms = {
    A_FULL_QUERY: [] as EvaluatedSelectionRow[],
    B_CLAIM_MATRIX: [] as EvaluatedSelectionRow[],
  };
  for (const candidateCase of candidate.cases) {
    const qrel = qrelByCase.get(candidateCase.caseId)!;
    const selected = selectionByCase.get(
      candidateCase.caseId,
    );
    if (
      !selected
      || selected.coursePackId
        !== candidateCase.coursePackId
    ) {
      throw new Error(
        `T44_CLAIM_EVALUATION_SELECTION_MISSING:${candidateCase.caseId}`,
      );
    }
    for (
      const arm of [
        "A_FULL_QUERY",
        "B_CLAIM_MATRIX",
      ] as const
    ) {
      const selectedRows = selected.arms[arm].selected;
      const selectedNodeIds = selectedRows.map(
        ({ nodeId }) => nodeId,
      );
      const selectedSet = new Set(selectedNodeIds);
      const requiredGroups =
        qrel.requiredEvidenceGroups.map((group) => {
          for (const nodeId of group.acceptableNodeIds) {
            const binding = nodeById.get(nodeId);
            if (
              !binding
              || !eligibleAtomicNode(binding.node)
              || binding.object.sourceCoursePack.id
                !== candidateCase.coursePackId
              || binding.object.sourceCoursePack.version
                !== candidateCase.coursePackVersion
            ) {
              throw new Error(
                `T44_CLAIM_EVALUATION_QREL_BINDING_INVALID:${candidateCase.caseId}:${nodeId}`,
              );
            }
          }
          const matchedNodeIds =
            group.acceptableNodeIds.filter((nodeId) =>
              selectedSet.has(nodeId));
          return {
            groupId: group.groupId,
            covered: matchedNodeIds.length > 0,
            matchedNodeIds,
          };
        });
      for (const nodeId of qrel.hardNegativeNodeIds) {
        const binding = nodeById.get(nodeId);
        if (
          !binding
          || !eligibleAtomicNode(binding.node)
          || binding.object.sourceCoursePack.id
            !== candidateCase.coursePackId
        ) {
          throw new Error(
            `T44_CLAIM_EVALUATION_HARD_NEGATIVE_BINDING_INVALID:${candidateCase.caseId}:${nodeId}`,
          );
        }
      }
      const bindingViolations: string[] = [];
      for (const row of selectedRows) {
        const binding = nodeById.get(row.nodeId);
        const object = objectById.get(row.objectId);
        if (
          !binding
          || !object
          || binding.object.id !== row.objectId
        ) {
          bindingViolations.push(
            `OWNER:${row.nodeId}`,
          );
          continue;
        }
        if (
          object.sourceCoursePack.id
            !== candidateCase.coursePackId
          || object.sourceCoursePack.version
            !== candidateCase.coursePackVersion
          || row.coursePackId
            !== candidateCase.coursePackId
        ) {
          bindingViolations.push(
            `SCOPE:${row.nodeId}`,
          );
        }
        if (!eligibleAtomicNode(binding.node)) {
          bindingViolations.push(
            `ROLE:${row.nodeId}`,
          );
        }
      }
      arms[arm].push({
        caseId: candidateCase.caseId,
        coursePackId: candidateCase.coursePackId,
        stratum: qrel.stratum,
        multiClaim: qrel.multiClaim,
        selectedNodeIds,
        requiredGroups,
        caseCovered: requiredGroups.every(
          ({ covered }) => covered,
        ),
        hardNegativeNodeIds:
          qrel.hardNegativeNodeIds.filter((nodeId) =>
            selectedSet.has(nodeId)),
        bindingViolations,
      });
    }
  }
  const summaries = Object.fromEntries(
    (
      [
        "A_FULL_QUERY",
        "B_CLAIM_MATRIX",
      ] as const
    ).map((arm) => [
      arm,
      {
        aggregate: summarizeSelectionRows(arms[arm]),
        byCoursePack: groupSelectionRows(
          arms[arm],
          ({ coursePackId }) => coursePackId,
        ),
        byStratum: groupSelectionRows(
          arms[arm],
          ({ stratum }) => stratum,
        ),
      },
    ]),
  ) as {
    A_FULL_QUERY: {
      aggregate: ReturnType<
        typeof summarizeSelectionRows
      >;
      byCoursePack: ReturnType<
        typeof groupSelectionRows
      >;
      byStratum: ReturnType<
        typeof groupSelectionRows
      >;
    };
    B_CLAIM_MATRIX: {
      aggregate: ReturnType<
        typeof summarizeSelectionRows
      >;
      byCoursePack: ReturnType<
        typeof groupSelectionRows
      >;
      byStratum: ReturnType<
        typeof groupSelectionRows
      >;
    };
  };
  const extraTimingRows = selection.cases.map(
    (testCase) => {
      const a =
        testCase.matrixTimingMs.A_FULL_QUERY.median
        + testCase.arms.A_FULL_QUERY
          .selectorTimingMs.median;
      const b =
        testCase.matrixTimingMs.B_CLAIM_MATRIX.median
        + testCase.arms.B_CLAIM_MATRIX
          .selectorTimingMs.median;
      return {
        caseId: testCase.caseId,
        durationMs: Math.max(0, b - a),
      };
    },
  );
  const expansionTimings = z
    .array(z
      .object({
        caseId: IdSchema,
        durationMs:
          z.number().finite().nonnegative(),
      })
      .strict())
    .length(50)
    .parse(input.candidateExpansionTimingMs);
  if (
    new Set(
      expansionTimings.map(({ caseId }) => caseId),
    ).size !== 50
    || candidate.cases.some(
      ({ caseId }) =>
        !expansionTimings.some(
          (row) => row.caseId === caseId,
        ),
    )
  ) {
    throw new Error(
      "T44_CLAIM_EXPANSION_TIMING_CASE_DRIFT",
    );
  }
  const expectedCalls = candidate.expectedProviderCalls;
  const expectedPerChannel =
    candidate.expectedChannelCalls.LEXICAL;
  const providerPassed =
    input.providerInvocationAudit.observedCalls
      === expectedCalls
    && input.providerInvocationAudit.channelCounts.LEXICAL
      === expectedPerChannel
    && input.providerInvocationAudit.channelCounts.TEXT_VECTOR
      === expectedPerChannel
    && input.providerInvocationAudit.channelCounts.VISUAL_VECTOR
      === 0
    && input.providerInvocationAudit.channelCounts.CAPTION_LEXICAL
      === 0;
  const nonStaticDecisionCount =
    candidate.cases.reduce(
      (sum, testCase) =>
        sum
        + testCase.probeRankings.filter(
          ({ prerequisiteDecision }) =>
            prerequisiteDecision
            !== "STATIC_CORPUS_ELIGIBLE",
        ).length,
      0,
    );
  const baseline = summaries.A_FULL_QUERY.aggregate;
  const candidateSummary =
    summaries.B_CLAIM_MATRIX.aggregate;
  const nodeExtraP95 =
    nearestRankPercentileV1(
      extraTimingRows.map(({ durationMs }) =>
        durationMs),
      0.95,
    );
  const expansionP95 =
    nearestRankPercentileV1(
      expansionTimings.map(({ durationMs }) =>
        durationMs),
      0.95,
    );
  const gates = {
    supportCaseCoverage: {
      observed:
        candidateSummary.supportCaseCoverage,
      required:
        T44_CLAIM_COVERAGE_GATES_V1
          .supportCaseCoverageMinimum,
      passed:
        candidateSummary.supportCaseCoverage
        >= T44_CLAIM_COVERAGE_GATES_V1
          .supportCaseCoverageMinimum,
    },
    multiClaimJointCoverage: {
      observed:
        candidateSummary.multiClaimJointCoverage,
      required:
        T44_CLAIM_COVERAGE_GATES_V1
          .multiClaimJointCoverageMinimum,
      passed:
        candidateSummary.multiClaimJointCoverage
        >= T44_CLAIM_COVERAGE_GATES_V1
          .multiClaimJointCoverageMinimum,
    },
    hardNegativeIntrusionNoRegression: {
      observed:
        candidateSummary.hardNegativeIntrusionCases,
      requiredMaximum:
        baseline.hardNegativeIntrusionCases,
      passed:
        candidateSummary.hardNegativeIntrusionCases
        <= baseline.hardNegativeIntrusionCases,
    },
    bindingViolations: {
      observed:
        candidateSummary.bindingViolationCount,
      required:
        T44_CLAIM_COVERAGE_GATES_V1
          .bindingViolationMaximum,
      passed:
        candidateSummary.bindingViolationCount
        <= T44_CLAIM_COVERAGE_GATES_V1
          .bindingViolationMaximum,
    },
    providerInvocationParity: {
      observed: input.providerInvocationAudit,
      required: {
        observedCalls: expectedCalls,
        channelCounts: {
          LEXICAL: expectedPerChannel,
          TEXT_VECTOR: expectedPerChannel,
          VISUAL_VECTOR: 0,
          CAPTION_LEXICAL: 0,
        },
      },
      passed: providerPassed,
    },
    prerequisiteIntegrity: {
      observedNonStaticDecisionCount:
        nonStaticDecisionCount,
      required: 0,
      passed: nonStaticDecisionCount === 0,
    },
    nodeSelectionExtraP95: {
      observedMs: nodeExtraP95,
      requiredMaximumMs:
        T44_CLAIM_COVERAGE_GATES_V1
          .nodeSelectionExtraP95MaximumMs,
      passed:
        nodeExtraP95
        <= T44_CLAIM_COVERAGE_GATES_V1
          .nodeSelectionExtraP95MaximumMs,
    },
    candidateExpansionP95: {
      observedMs: expansionP95,
      requiredMaximumMs:
        T44_CLAIM_COVERAGE_GATES_V1
          .candidateExpansionP95MaximumMs,
      passed:
        expansionP95
        <= T44_CLAIM_COVERAGE_GATES_V1
          .candidateExpansionP95MaximumMs,
    },
  };
  return {
    schemaVersion: 1 as const,
    kind:
      "T44_CLAIM_COVERAGE_EVALUATION" as const,
    artifacts: {
      candidateInputSha256: candidateHash,
      matrixOutputSha256: matrixHash,
      selectionArtifactSha256: selectionHash,
    },
    configs: {
      matrix: T44_CLAIM_MATRIX_CONFIG_V1,
      selector:
        T44_CLAIM_COVERAGE_SELECTOR_CONFIG_V1,
      gates: T44_CLAIM_COVERAGE_GATES_V1,
    },
    arms: summaries,
    timing: {
      nodeSelectionExtraRows: extraTimingRows,
      nodeSelectionExtraP95Ms: nodeExtraP95,
      candidateExpansionRows: expansionTimings,
      candidateExpansionP95Ms: expansionP95,
    },
    providerInvocationAudit:
      input.providerInvocationAudit,
    prerequisiteNonStaticDecisionCount:
      nonStaticDecisionCount,
    gates,
    passed: Object.values(gates).every(
      ({ passed }) => passed,
    ),
  };
}

export function candidateInputCanonicalTextV1(
  input: T44ClaimCandidateRuntimeInputV1,
) {
  return serializeT44ClaimCandidateRuntimeInputV1(input);
}

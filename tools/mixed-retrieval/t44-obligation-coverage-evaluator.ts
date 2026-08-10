import { z } from "zod";

import {
  AnswerIntentV1Schema,
  AnswerObligationSetV1Schema,
  QueryUnderstandingInputV1Schema,
  type AnswerObligationSetV1,
  type QueryUnderstandingInputV1,
} from "../../lib/knowledge/answer-obligation-v1";
import {
  sha256StableJsonV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  T44ClaimMatrixSidecarOutputV1Schema,
  T44ClaimMatrixRankedNodeV1Schema,
  type T44ClaimMatrixSidecarOutputV1,
  type T44ClaimMatrixRankedNodeV1,
} from "./t44-claim-matrix-contract-v1";
import {
  T44ObligationCandidateArtifactV1Schema,
  type T44ObligationCandidateArtifactV1,
} from "./t44-obligation-candidate-evaluator";
import {
  T44ObligationSelectedNodeV1Schema,
  T44ObligationSelectionArtifactV1Schema,
  type T44ObligationSelectedNodeV1,
  type T44ObligationSelectionArtifactV1,
} from "./t44-obligation-label-blind-v2";

export {
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2,
  T44ObligationSelectedNodeV1Schema,
  T44ObligationSelectionArtifactV1Schema,
  auditT44AnswerObligationBindingsV1,
  buildT44BaselineProtectedObligationSelectionArtifactV2,
  sealT44ObligationSelectionArtifactV1,
  selectT44BaselineProtectedObligationNodesV2,
  verifyT44ObligationSelectionBindingsV1,
  type T44ObligationSelectedNodeV1,
  type T44ObligationSelectionArtifactV1,
  type T44ObligationSelectionSealV1,
} from "./t44-obligation-label-blind-v2";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const IdSchema = z.string().regex(ID_PATTERN);
const ObligationIdSchema = z.string()
  .regex(/^obligation-[1-4]$/);

export const T44_OBLIGATION_SELECTOR_CONFIG_V1 =
  Object.freeze({
    id: "lumi-t44-obligation-selector-v1",
    version: "1.0.0",
    topK: 8,
    firstPass:
      "ONE_HIGHEST_RANKED_UNIQUE_NODE_PER_OBLIGATION",
    secondPass:
      "ONE_ADDITIONAL_UNIQUE_NODE_PER_OBLIGATION",
    fillRrfK: 60,
    fillSignals:
      "WHOLE_QUERY_PLUS_EACH_OBLIGATION",
    perObjectCap: null,
    graphifyPolicy: "NOT_USED",
  } as const);

export const T44_OBLIGATION_SELECTOR_CONFIG_HASH_V1 =
  sha256StableJsonV2(
    T44_OBLIGATION_SELECTOR_CONFIG_V1,
  );

const RankingSchema = z
  .array(T44ClaimMatrixRankedNodeV1Schema)
  .max(176)
  .superRefine((ranking, context) => {
    if (
      ranking.some(
        ({ rank }, index) => rank !== index + 1,
      )
      || new Set(
        ranking.map(({ nodeId }) => nodeId),
      ).size !== ranking.length
    ) {
      context.addIssue({
        code: "custom",
        message:
          "node ranking must be unique and contiguous",
      });
    }
  });

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

type Aggregate = {
  row: T44ClaimMatrixRankedNodeV1;
  score: number;
  bestRank: number;
};

function aggregateNodeRankings(input: {
  wholeQueryRanking:
    readonly T44ClaimMatrixRankedNodeV1[];
  obligationRankings: readonly {
    obligationId: string;
    ranking:
      readonly T44ClaimMatrixRankedNodeV1[];
  }[];
}) {
  const aggregate = new Map<string, Aggregate>();
  const signals = [
    input.wholeQueryRanking,
    ...input.obligationRankings.map(
      ({ ranking }) => ranking,
    ),
  ];
  for (const ranking of signals) {
    for (const row of ranking) {
      const current = aggregate.get(row.nodeId) ?? {
        row,
        score: 0,
        bestRank: row.rank,
      };
      if (
        current.row.objectId !== row.objectId
        || current.row.coursePackId !== row.coursePackId
      ) {
        throw new Error(
          `T44_OBLIGATION_NODE_BINDING_DRIFT:${row.nodeId}`,
        );
      }
      current.score += 1 / (
        T44_OBLIGATION_SELECTOR_CONFIG_V1.fillRrfK
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

export function selectT44ObligationNodesV1(input: {
  wholeQueryRanking:
    readonly T44ClaimMatrixRankedNodeV1[];
  obligationRankings: readonly {
    obligationId: string;
    ranking:
      readonly T44ClaimMatrixRankedNodeV1[];
  }[];
}): T44ObligationSelectedNodeV1[] {
  const wholeQueryRanking = RankingSchema.parse(
    input.wholeQueryRanking,
  );
  const obligationRankings = z.array(z
    .object({
      obligationId: ObligationIdSchema,
      ranking: RankingSchema,
    })
    .strict())
    .max(4)
    .parse(input.obligationRankings);
  if (
    new Set(
      obligationRankings.map(
        ({ obligationId }) => obligationId,
      ),
    ).size !== obligationRankings.length
  ) {
    throw new Error(
      "T44_OBLIGATION_SELECTOR_DUPLICATE_OBLIGATION",
    );
  }
  const aggregate = aggregateNodeRankings({
    wholeQueryRanking,
    obligationRankings,
  });
  const selected:
    T44ObligationSelectedNodeV1[] = [];
  const selectedIds = new Set<string>();

  const runPass = (
    source:
      | "OBLIGATION_PASS_1"
      | "OBLIGATION_PASS_2",
  ) => {
    for (
      const { obligationId, ranking }
      of obligationRankings
    ) {
      if (
        selected.length
        >= T44_OBLIGATION_SELECTOR_CONFIG_V1.topK
      ) {
        return;
      }
      const row = ranking.find(
        ({ nodeId }) => !selectedIds.has(nodeId),
      );
      if (!row) continue;
      selectedIds.add(row.nodeId);
      selected.push(
        T44ObligationSelectedNodeV1Schema.parse({
          nodeId: row.nodeId,
          objectId: row.objectId,
          coursePackId: row.coursePackId,
          selectionSource: source,
          obligationId,
          aggregateRrfScore:
            aggregate.get(row.nodeId)!.score,
        }),
      );
    }
  };
  runPass("OBLIGATION_PASS_1");
  runPass("OBLIGATION_PASS_2");

  const fill = [...aggregate.values()]
    .filter(({ row }) =>
      !selectedIds.has(row.nodeId))
    .sort((left, right) =>
      right.score - left.score
      || left.bestRank - right.bestRank
      || compareCodePoints(
        left.row.nodeId,
        right.row.nodeId,
      ));
  for (const candidate of fill) {
    if (
      selected.length
      >= T44_OBLIGATION_SELECTOR_CONFIG_V1.topK
    ) {
      break;
    }
    selected.push(
      T44ObligationSelectedNodeV1Schema.parse({
        nodeId: candidate.row.nodeId,
        objectId: candidate.row.objectId,
        coursePackId:
          candidate.row.coursePackId,
        selectionSource: "RRF_FILL",
        obligationId: null,
        aggregateRrfScore: candidate.score,
      }),
    );
  }
  return selected;
}

export function selectT44WholeQueryNodesV1(
  rankingInput:
    readonly T44ClaimMatrixRankedNodeV1[],
) {
  return RankingSchema.parse(rankingInput)
    .slice(
      0,
      T44_OBLIGATION_SELECTOR_CONFIG_V1.topK,
    )
    .map((row) => ({
      nodeId: row.nodeId,
      objectId: row.objectId,
      coursePackId: row.coursePackId,
      selectionSource: "RRF_FILL" as const,
      obligationId: null,
      aggregateRrfScore: 1 / (
        T44_OBLIGATION_SELECTOR_CONFIG_V1.fillRrfK
        + row.rank
      ),
    }));
}

function matrixCaseById(
  output: T44ClaimMatrixSidecarOutputV1,
) {
  return new Map(
    output.cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
}

function buildT44ObligationSelectionArtifact(
  input: {
    candidateArtifact:
      T44ObligationCandidateArtifactV1;
    candidateArtifactSha256: string;
    matrixOutputSha256: string;
    aMatrixOutput:
      T44ClaimMatrixSidecarOutputV1;
    bMatrixOutput:
      T44ClaimMatrixSidecarOutputV1;
    selectB: (input: {
      wholeQueryRanking:
        readonly T44ClaimMatrixRankedNodeV1[];
      obligationRankings: readonly {
        obligationId: string;
        ranking:
          readonly T44ClaimMatrixRankedNodeV1[];
      }[];
    }) => T44ObligationSelectedNodeV1[];
    selectorConfigBinding?: {
      id: string;
      version: string;
      hash: string;
    };
  },
): T44ObligationSelectionArtifactV1 {
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse(
      input.candidateArtifact,
    );
  const aMatrix =
    T44ClaimMatrixSidecarOutputV1Schema.parse(
      input.aMatrixOutput,
    );
  const bMatrix =
    T44ClaimMatrixSidecarOutputV1Schema.parse(
      input.bMatrixOutput,
    );
  const aByCase = matrixCaseById(aMatrix);
  const bByCase = matrixCaseById(bMatrix);
  const cases = candidate.cases.map((testCase) => {
    const aCase = aByCase.get(testCase.caseId);
    const bCase = bByCase.get(testCase.caseId);
    if (
      !aCase
      || !bCase
      || aCase.coursePackId
        !== testCase.coursePackId
      || bCase.coursePackId
        !== testCase.coursePackId
      || aCase.candidateNodeIdsSha256
        !== testCase.arms.A_WHOLE_QUERY
          .candidateNodeIdsSha256
      || bCase.candidateNodeIdsSha256
        !== testCase.arms.B_MODEL_GUIDED
          .candidateNodeIdsSha256
    ) {
      throw new Error(
        `T44_OBLIGATION_SELECTION_MATRIX_BINDING_DRIFT:${testCase.caseId}`,
      );
    }
    return {
      caseId: testCase.caseId,
      coursePackId: testCase.coursePackId,
      candidateNodeIdsSha256:
        sha256StableJsonV2({
          A_WHOLE_QUERY:
            aCase.candidateNodeIdsSha256,
          B_MODEL_GUIDED:
            bCase.candidateNodeIdsSha256,
        }),
      arms: {
        A_WHOLE_QUERY: {
          selected:
            selectT44WholeQueryNodesV1(
              aCase.arms.A_FULL_QUERY
                .wholeQueryRanking,
            ),
        },
        B_MODEL_GUIDED: {
          selected: input.selectB({
            wholeQueryRanking:
              bCase.arms.B_CLAIM_MATRIX
                .wholeQueryRanking,
            obligationRankings:
              bCase.arms.B_CLAIM_MATRIX
                .claimRankings.map(
                  ({ claimId, ranking }) => ({
                    obligationId: claimId,
                    ranking,
                  }),
                ),
          }),
        },
      },
    };
  });
  return T44ObligationSelectionArtifactV1Schema.parse({
    schemaVersion: 1,
    kind: "T44_OBLIGATION_SELECTIONS",
    candidateArtifactSha256:
      input.candidateArtifactSha256,
    matrixOutputSha256:
      input.matrixOutputSha256,
    ...(input.selectorConfigBinding
      ? {
          selectorConfigId:
            input.selectorConfigBinding.id,
          selectorConfigVersion:
            input.selectorConfigBinding.version,
          selectorConfigHash:
            input.selectorConfigBinding.hash,
        }
      : {}),
    graphifyInvocationCount: 0,
    cases,
  });
}

export function buildT44ObligationSelectionArtifactV1(
  input: {
    candidateArtifact:
      T44ObligationCandidateArtifactV1;
    candidateArtifactSha256: string;
    matrixOutputSha256: string;
    aMatrixOutput:
      T44ClaimMatrixSidecarOutputV1;
    bMatrixOutput:
      T44ClaimMatrixSidecarOutputV1;
  },
) {
  return buildT44ObligationSelectionArtifact({
    ...input,
    selectB: selectT44ObligationNodesV1,
  });
}

const LegacyEvidenceGroupSchema = z
  .object({
    groupId: IdSchema,
    acceptableNodeIds: z.array(IdSchema).min(1),
  })
  .strict();

export function evaluateT44LegacyEvidenceCaseV1(
  input: {
    selectedNodeIds: readonly string[];
    requiredEvidenceGroups: readonly z.input<
      typeof LegacyEvidenceGroupSchema
    >[];
    hardNegativeNodeIds: readonly string[];
  },
) {
  const selected = z.array(IdSchema)
    .max(8)
    .parse(input.selectedNodeIds);
  const groups = z.array(
    LegacyEvidenceGroupSchema,
  ).min(1).parse(input.requiredEvidenceGroups);
  const hardNegatives = z.array(IdSchema).parse(
    input.hardNegativeNodeIds,
  );
  const selectedSet = new Set(selected);
  const coveredGroupIds = groups
    .filter(({ acceptableNodeIds }) =>
      acceptableNodeIds.some((nodeId) =>
        selectedSet.has(nodeId)))
    .map(({ groupId }) => groupId);
  return {
    coveredGroupIds,
    requiredGroupCount: groups.length,
    coveredGroupCount: coveredGroupIds.length,
    allRequiredGroupsCovered:
      coveredGroupIds.length === groups.length,
    hardNegativeIntrusions: hardNegatives.filter(
      (nodeId) => selectedSet.has(nodeId),
    ),
  };
}

const SourceSchema = z.enum([
  "CURRENT_MESSAGE",
  "RECENT_TURN_1",
  "RECENT_TURN_2",
]);

const SpanSchema = z
  .object({
    source: SourceSchema,
    startCodePoint: z.number().int().nonnegative(),
    endCodePoint: z.number().int().positive(),
  })
  .strict()
  .refine(
    ({ startCodePoint, endCodePoint }) =>
      endCodePoint > startCodePoint,
    "span must be non-empty",
  );

const GoldObligationSchema = SpanSchema.extend({
  goldId: IdSchema,
  allowedIntents: z
    .array(AnswerIntentV1Schema)
    .min(1),
  requiredEvidenceGroups: z
    .array(z.array(IdSchema).min(1))
    .min(1),
}).strict();

export const T44ObligationGoldQrelCaseV1Schema = z
  .object({
    caseId: IdSchema,
    expectedObligations: z
      .array(GoldObligationSchema)
      .min(1)
      .max(4),
    nonObligationSpans:
      z.array(SpanSchema).max(8),
    hardNegativeNodeIds:
      z.array(IdSchema).max(8),
    clarificationExpected: z.boolean(),
  })
  .strict();

export type T44ObligationGoldQrelCaseV1 = z.infer<
  typeof T44ObligationGoldQrelCaseV1Schema
>;

type Interval = {
  start: number;
  end: number;
};

function mergeIntervals(
  intervals: readonly Interval[],
) {
  const ordered = [...intervals].sort(
    (left, right) =>
      left.start - right.start
      || left.end - right.end,
  );
  const merged: Interval[] = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
    } else {
      previous.end = Math.max(
        previous.end,
        interval.end,
      );
    }
  }
  return merged;
}

function overlapLength(
  intervals: readonly Interval[],
  target: Interval,
) {
  return mergeIntervals(intervals).reduce(
    (sum, interval) =>
      sum + Math.max(
        0,
        Math.min(interval.end, target.end)
        - Math.max(interval.start, target.start),
      ),
    0,
  );
}

function sourceMessages(
  request: QueryUnderstandingInputV1,
) {
  return new Map([
    [
      request.currentMessage.source,
      request.currentMessage,
    ],
    ...request.recentTurns.map(
      (message) =>
        [message.source, message] as const,
    ),
  ]);
}

function validAnchorIntervals(input: {
  request: QueryUnderstandingInputV1;
  prediction: AnswerObligationSetV1;
}) {
  const messages = sourceMessages(input.request);
  const intervals = new Map<
    string,
    Map<string, Interval[]>
  >();
  let sourceAnchorViolations = 0;
  let entityViolations = 0;
  let constraintViolations = 0;
  for (const obligation of input.prediction.obligations) {
    const bySource = new Map<string, Interval[]>();
    obligation.sourceAnchors.forEach(
      (anchor) => {
        const message = messages.get(anchor.source);
        const slice = message
          ? Array.from(message.message)
            .slice(
              anchor.startCodePoint,
              anchor.endCodePoint,
            )
            .join("")
          : null;
        if (
          !message
          || message.messageHash
            !== anchor.sourceMessageHash
          || slice !== anchor.quote
        ) {
          sourceAnchorViolations += 1;
          return;
        }
        bySource.set(anchor.source, [
          ...(bySource.get(anchor.source) ?? []),
          {
            start: anchor.startCodePoint,
            end: anchor.endCodePoint,
          },
        ]);
      },
    );
    const anchorCount =
      obligation.sourceAnchors.length;
    entityViolations += obligation.entityMentions
      .filter(({ anchorIndexes }) =>
        anchorIndexes.some(
          (index) => index >= anchorCount,
        ))
      .length;
    constraintViolations += obligation.constraints
      .filter(({ anchorIndexes }) =>
        anchorIndexes.some(
          (index) => index >= anchorCount,
        ))
      .length;
    intervals.set(obligation.obligationId, bySource);
  }
  return {
    intervals,
    bindingViolations: {
      sourceAnchor: sourceAnchorViolations,
      entity: entityViolations,
      constraint: constraintViolations,
    },
  };
}

function coverageRatio(input: {
  bySource: ReadonlyMap<string, readonly Interval[]>;
  span: z.infer<typeof SpanSchema>;
}) {
  const intervals =
    input.bySource.get(input.span.source) ?? [];
  return overlapLength(intervals, {
    start: input.span.startCodePoint,
    end: input.span.endCodePoint,
  }) / (
    input.span.endCodePoint
    - input.span.startCodePoint
  );
}

function anyOverlap(input: {
  bySource: ReadonlyMap<string, readonly Interval[]>;
  span: z.infer<typeof SpanSchema>;
}) {
  return coverageRatio(input) > 0;
}

type Match = {
  goldId: string;
  obligationId: string;
};

function compareMatchVectors(
  left: readonly (string | null)[],
  right: readonly (string | null)[],
) {
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? "\uffff";
    const rightValue = right[index] ?? "\uffff";
    const compared = compareCodePoints(
      leftValue,
      rightValue,
    );
    if (compared !== 0) return compared;
  }
  return 0;
}

function maximumCardinalityMatching(input: {
  golds: readonly z.infer<
    typeof GoldObligationSchema
  >[];
  edgeIdsByGold: readonly (readonly string[])[];
}) {
  let best: Array<string | null> =
    input.golds.map(() => null);
  let bestCount = -1;
  const visit = (
    index: number,
    used: ReadonlySet<string>,
    current: Array<string | null>,
  ) => {
    if (index === input.golds.length) {
      const count = current.filter(
        (value) => value !== null,
      ).length;
      if (
        count > bestCount
        || (
          count === bestCount
          && compareMatchVectors(current, best) < 0
        )
      ) {
        bestCount = count;
        best = [...current];
      }
      return;
    }
    for (
      const obligationId
      of input.edgeIdsByGold[index]!
    ) {
      if (used.has(obligationId)) continue;
      visit(
        index + 1,
        new Set([...used, obligationId]),
        [...current, obligationId],
      );
    }
    visit(index + 1, used, [...current, null]);
  };
  visit(0, new Set(), []);
  return best.flatMap((obligationId, index) =>
    obligationId === null
      ? []
      : [{
          goldId: input.golds[index]!.goldId,
          obligationId,
        }]);
}

export function matchT44AnswerObligationsV1(
  input: {
    request: QueryUnderstandingInputV1;
    prediction: AnswerObligationSetV1;
    qrel: T44ObligationGoldQrelCaseV1;
  },
) {
  const request = QueryUnderstandingInputV1Schema.parse(
    input.request,
  );
  const prediction =
    AnswerObligationSetV1Schema.parse(
      input.prediction,
    );
  const qrel =
    T44ObligationGoldQrelCaseV1Schema.parse(
      input.qrel,
    );
  const {
    intervals,
    bindingViolations,
  } = validAnchorIntervals({
    request,
    prediction,
  });
  const obligations = [...prediction.obligations]
    .sort((left, right) =>
      compareCodePoints(
        left.obligationId,
        right.obligationId,
      ));
  const edges = qrel.expectedObligations.map(
    (gold) =>
      obligations
        .filter((obligation) =>
          gold.allowedIntents.includes(
            obligation.intent,
          )
          && coverageRatio({
            bySource:
              intervals.get(
                obligation.obligationId,
              ) ?? new Map(),
            span: gold,
          }) >= 0.5)
        .map(({ obligationId }) => obligationId),
  );
  const matches = maximumCardinalityMatching({
    golds: qrel.expectedObligations,
    edgeIdsByGold: edges,
  });
  const matchedIds = new Set(
    matches.map(({ obligationId }) =>
      obligationId),
  );
  const matchedGolds = new Map(
    matches.map((match) => [
      match.obligationId,
      qrel.expectedObligations.find(
        ({ goldId }) => goldId === match.goldId,
      )!,
    ]),
  );
  const redundantSplits: string[] = [];
  const materialFabrications: string[] = [];
  const severeFabrications: string[] = [];
  for (const obligation of obligations) {
    if (matchedIds.has(obligation.obligationId)) {
      continue;
    }
    const bySource =
      intervals.get(obligation.obligationId)
      ?? new Map();
    const redundant = [...matchedGolds.values()]
      .some((gold) =>
        gold.allowedIntents.includes(
          obligation.intent,
        )
        && coverageRatio({
          bySource,
          span: gold,
        }) >= 0.5);
    if (redundant) {
      redundantSplits.push(obligation.obligationId);
      continue;
    }
    const overlapsAnyGold =
      qrel.expectedObligations.some((gold) =>
        anyOverlap({ bySource, span: gold }));
    const overlapsNonObligation =
      qrel.nonObligationSpans.some((span) =>
        anyOverlap({ bySource, span }));
    if (!overlapsAnyGold || overlapsNonObligation) {
      severeFabrications.push(
        obligation.obligationId,
      );
    } else {
      materialFabrications.push(
        obligation.obligationId,
      );
    }
  }
  return {
    matches: matches as Match[],
    obligationRecall:
      matches.length
      / qrel.expectedObligations.length,
    caseJointCoverage:
      matches.length
      === qrel.expectedObligations.length,
    redundantSplits,
    materialFabrications,
    severeFabrications,
    bindingViolations,
    wrongClarification:
      prediction.status === "CLARIFY"
      && !qrel.clarificationExpected,
  };
}

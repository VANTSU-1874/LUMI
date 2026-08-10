import { createHash } from "node:crypto";

import { z } from "zod";

import {
  AnswerObligationSetV1Schema,
  QueryUnderstandingInputV1Schema,
  type AnswerObligationSetV1,
  type QueryUnderstandingInputV1,
} from "../../lib/knowledge/answer-obligation-v1";
import {
  sha256StableJsonV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  T44ClaimMatrixRankedNodeV1Schema,
  T44ClaimMatrixSidecarOutputV1Schema,
  type T44ClaimMatrixRankedNodeV1,
  type T44ClaimMatrixSidecarOutputV1,
} from "./t44-claim-matrix-contract-v1";
import {
  T44ObligationCandidateArtifactV1Schema,
  type T44ObligationCandidateArtifactV1,
} from "./t44-obligation-candidate-evaluator";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const IdSchema = z.string().regex(ID_PATTERN);
const ObligationIdSchema = z.string()
  .regex(/^obligation-[1-4]$/);

export const T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2 =
  Object.freeze({
    id: "lumi-t44-baseline-protected-obligation-selector-v2",
    version: "2026-07-29.1",
    topK: 8,
    protectedBaselineMinimum: 4,
    maximumComplements: 4,
    maximumComplementsPerObligation: 2,
    obligationCandidateLimit: 8,
    reciprocalRankK: 60,
    eligibility:
      "OUTSIDE_WHOLE_TOP_K_AND_INSIDE_OBLIGATION_TOP_K_WITH_POSITIVE_RECIPROCAL_RANK_LIFT",
    firstPass:
      "ONE_STRONGEST_UNIQUE_COMPLEMENT_PER_OBLIGATION",
    secondPass:
      "ONE_ADDITIONAL_COMPLEMENT_PER_OBLIGATION_BY_FIXED_GLOBAL_ORDER",
    tieBreak:
      "LIFT_DESC_THEN_OBLIGATION_RANK_THEN_WHOLE_RANK_DESC_THEN_OBLIGATION_ID_THEN_NODE_ID",
    graphifyPolicy: "NOT_USED",
  } as const);

export const T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2 =
  sha256StableJsonV2(
    T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2,
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

export const T44ObligationSelectedNodeV1Schema = z
  .object({
    nodeId: IdSchema,
    objectId: IdSchema,
    coursePackId: IdSchema,
    selectionSource: z.enum([
      "OBLIGATION_PASS_1",
      "OBLIGATION_PASS_2",
      "RRF_FILL",
      "WHOLE_QUERY_BASELINE",
      "OBLIGATION_COMPLEMENT",
    ]),
    obligationId: ObligationIdSchema.nullable(),
    aggregateRrfScore:
      z.number().finite().positive(),
  })
  .strict()
  .superRefine((node, context) => {
    const bindsObligation = [
      "OBLIGATION_PASS_1",
      "OBLIGATION_PASS_2",
      "OBLIGATION_COMPLEMENT",
    ].includes(node.selectionSource);
    if (
      bindsObligation
        !== (node.obligationId !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["obligationId"],
        message:
          "only obligation passes bind an obligation id",
      });
    }
  });

export type T44ObligationSelectedNodeV1 = z.infer<
  typeof T44ObligationSelectedNodeV1Schema
>;

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
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2
          .reciprocalRankK + row.rank
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

type ComplementCandidateV2 = {
  obligationId: string;
  row: T44ClaimMatrixRankedNodeV1;
  wholeQueryRank: number;
  reciprocalRankLift: number;
};

function compareComplementCandidatesV2(
  left: ComplementCandidateV2,
  right: ComplementCandidateV2,
) {
  return (
    right.reciprocalRankLift
      - left.reciprocalRankLift
    || left.row.rank - right.row.rank
    || right.wholeQueryRank
      - left.wholeQueryRank
    || compareCodePoints(
      left.obligationId,
      right.obligationId,
    )
    || compareCodePoints(
      left.row.nodeId,
      right.row.nodeId,
    )
  );
}

export function selectT44BaselineProtectedObligationNodesV2(
  input: {
    wholeQueryRanking:
      readonly T44ClaimMatrixRankedNodeV1[];
    obligationRankings: readonly {
      obligationId: string;
      ranking:
        readonly T44ClaimMatrixRankedNodeV1[];
    }[];
  },
): T44ObligationSelectedNodeV1[] {
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
    .parse(input.obligationRankings)
    .sort((left, right) =>
      compareCodePoints(
        left.obligationId,
        right.obligationId,
      ));
  if (
    new Set(
      obligationRankings.map(
        ({ obligationId }) => obligationId,
      ),
    ).size !== obligationRankings.length
  ) {
    throw new Error(
      "T44_BASELINE_PROTECTED_SELECTOR_DUPLICATE_OBLIGATION",
    );
  }

  const wholeByNodeId = new Map(
    wholeQueryRanking.map((row) => [
      row.nodeId,
      row,
    ]),
  );
  for (
    const { ranking }
    of obligationRankings
  ) {
    for (const row of ranking) {
      const wholeRow = wholeByNodeId.get(row.nodeId);
      if (!wholeRow) {
        throw new Error(
          `T44_BASELINE_PROTECTED_SELECTOR_NODE_SET_DRIFT:${row.nodeId}`,
        );
      }
      if (
        wholeRow.objectId !== row.objectId
        || wholeRow.coursePackId
          !== row.coursePackId
      ) {
        throw new Error(
          `T44_BASELINE_PROTECTED_SELECTOR_BINDING_DRIFT:${row.nodeId}`,
        );
      }
    }
  }

  const config =
    T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2;
  const baseline = wholeQueryRanking.slice(
    0,
    config.topK,
  );
  const baselineIds = new Set(
    baseline.map(({ nodeId }) => nodeId),
  );
  const candidatesByObligation = new Map<
    string,
    ComplementCandidateV2[]
  >();
  for (
    const { obligationId, ranking }
    of obligationRankings
  ) {
    const candidates = ranking
      .slice(0, config.obligationCandidateLimit)
      .flatMap((row) => {
        if (baselineIds.has(row.nodeId)) return [];
        const wholeRow = wholeByNodeId.get(row.nodeId)!;
        const reciprocalRankLift =
          1 / (config.reciprocalRankK + row.rank)
          - 1 / (
            config.reciprocalRankK
            + wholeRow.rank
          );
        return reciprocalRankLift > 0
          ? [{
              obligationId,
              row,
              wholeQueryRank: wholeRow.rank,
              reciprocalRankLift,
            }]
          : [];
      })
      .sort(compareComplementCandidatesV2);
    candidatesByObligation.set(
      obligationId,
      candidates,
    );
  }

  const complements: ComplementCandidateV2[] = [];
  const complementNodeIds = new Set<string>();
  const complementCountByObligation =
    new Map<string, number>();
  const addComplement = (
    candidate: ComplementCandidateV2,
  ) => {
    if (
      complementNodeIds.has(candidate.row.nodeId)
      || complements.length >= config.maximumComplements
    ) {
      return false;
    }
    complementNodeIds.add(candidate.row.nodeId);
    complements.push(candidate);
    complementCountByObligation.set(
      candidate.obligationId,
      (
        complementCountByObligation.get(
          candidate.obligationId,
        ) ?? 0
      ) + 1,
    );
    return true;
  };

  for (
    const { obligationId }
    of obligationRankings
  ) {
    const first = (
      candidatesByObligation.get(obligationId)
      ?? []
    ).find(({ row }) =>
      !complementNodeIds.has(row.nodeId));
    if (first) addComplement(first);
  }

  const secondPass = [
    ...candidatesByObligation.values(),
  ]
    .flat()
    .filter(({ row, obligationId }) =>
      !complementNodeIds.has(row.nodeId)
      && (
        complementCountByObligation.get(
          obligationId,
        ) ?? 0
      ) < config.maximumComplementsPerObligation)
    .sort(compareComplementCandidatesV2);
  for (const candidate of secondPass) {
    if (
      complements.length >= config.maximumComplements
    ) {
      break;
    }
    if (
      (
        complementCountByObligation.get(
          candidate.obligationId,
        ) ?? 0
      ) >= config.maximumComplementsPerObligation
    ) {
      continue;
    }
    addComplement(candidate);
  }

  const aggregate = aggregateNodeRankings({
    wholeQueryRanking,
    obligationRankings,
  });
  const retainedBaseline = baseline.slice(
    0,
    Math.max(
      config.protectedBaselineMinimum,
      config.topK - complements.length,
    ),
  );
  return [
    ...retainedBaseline.map((row) =>
      T44ObligationSelectedNodeV1Schema.parse({
        nodeId: row.nodeId,
        objectId: row.objectId,
        coursePackId: row.coursePackId,
        selectionSource: "WHOLE_QUERY_BASELINE",
        obligationId: null,
        aggregateRrfScore:
          aggregate.get(row.nodeId)!.score,
      })),
    ...complements.map((candidate) =>
      T44ObligationSelectedNodeV1Schema.parse({
        nodeId: candidate.row.nodeId,
        objectId: candidate.row.objectId,
        coursePackId:
          candidate.row.coursePackId,
        selectionSource: "OBLIGATION_COMPLEMENT",
        obligationId: candidate.obligationId,
        aggregateRrfScore:
          aggregate.get(candidate.row.nodeId)!.score,
      })),
  ].slice(0, config.topK);
}

function selectT44WholeQueryNodesV1(
  rankingInput:
    readonly T44ClaimMatrixRankedNodeV1[],
) {
  return RankingSchema.parse(rankingInput)
    .slice(
      0,
      T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2.topK,
    )
    .map((row) => ({
      nodeId: row.nodeId,
      objectId: row.objectId,
      coursePackId: row.coursePackId,
      selectionSource: "RRF_FILL" as const,
      obligationId: null,
      aggregateRrfScore: 1 / (
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2
          .reciprocalRankK + row.rank
      ),
    }));
}

const SelectedArmSchema = z
  .object({
    selected: z.array(
      T44ObligationSelectedNodeV1Schema,
    ).max(8),
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

export const T44ObligationSelectionArtifactV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("T44_OBLIGATION_SELECTIONS"),
    candidateArtifactSha256: HashSchema,
    matrixOutputSha256: HashSchema,
    selectorConfigId: IdSchema.optional(),
    selectorConfigVersion:
      z.string().trim().min(1).max(64).optional(),
    selectorConfigHash: HashSchema.optional(),
    graphifyInvocationCount: z.literal(0),
    cases: z.array(z
      .object({
        caseId: IdSchema,
        coursePackId: IdSchema,
        candidateNodeIdsSha256: HashSchema,
        arms: z
          .object({
            A_WHOLE_QUERY: SelectedArmSchema,
            B_MODEL_GUIDED: SelectedArmSchema,
          })
          .strict(),
      })
      .strict()).max(50),
  })
    .strict()
    .superRefine((artifact, context) => {
      const ids = artifact.cases.map(
        ({ caseId }) => caseId,
      );
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message: "selection case ids must be unique",
        });
      }
      const configBindingCount = [
        artifact.selectorConfigId,
        artifact.selectorConfigVersion,
        artifact.selectorConfigHash,
      ].filter((value) => value !== undefined).length;
      if (
        configBindingCount !== 0
        && configBindingCount !== 3
      ) {
        context.addIssue({
          code: "custom",
          path: ["selectorConfigId"],
          message:
            "selector config binding must be complete",
        });
      }
    });

export type T44ObligationSelectionArtifactV1 =
  z.infer<
    typeof T44ObligationSelectionArtifactV1Schema
  >;

export type T44ObligationSelectionSealV1 = {
  serialized: string;
  sha256: string;
  bytes: number;
};

function sha256Bytes(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export function sealT44ObligationSelectionArtifactV1(
  input: T44ObligationSelectionArtifactV1,
): T44ObligationSelectionSealV1 {
  const artifact =
    T44ObligationSelectionArtifactV1Schema.parse(
      input,
    );
  const serialized = `${JSON.stringify(
    artifact,
    null,
    2,
  )}\n`;
  return {
    serialized,
    sha256: sha256Bytes(serialized),
    bytes: Buffer.byteLength(serialized, "utf8"),
  };
}

export function verifyT44ObligationSelectionBindingsV1(
  input: {
    seal: T44ObligationSelectionSealV1;
    candidateArtifactSha256: string;
    matrixOutputSha256: string;
  },
) {
  if (
    sha256Bytes(input.seal.serialized)
      !== input.seal.sha256
    || Buffer.byteLength(
      input.seal.serialized,
      "utf8",
    ) !== input.seal.bytes
  ) {
    throw new Error(
      "T44_OBLIGATION_SELECTION_SHA_DRIFT",
    );
  }
  const artifact =
    T44ObligationSelectionArtifactV1Schema.parse(
      JSON.parse(input.seal.serialized) as unknown,
    );
  if (
    artifact.candidateArtifactSha256
      !== input.candidateArtifactSha256
  ) {
    throw new Error(
      "T44_OBLIGATION_SELECTION_CANDIDATE_SHA_DRIFT",
    );
  }
  if (
    artifact.matrixOutputSha256
      !== input.matrixOutputSha256
  ) {
    throw new Error(
      "T44_OBLIGATION_SELECTION_MATRIX_SHA_DRIFT",
    );
  }
  return artifact;
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

export function buildT44BaselineProtectedObligationSelectionArtifactV2(
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
          selected:
            selectT44BaselineProtectedObligationNodesV2({
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
    selectorConfigId:
      T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2.id,
    selectorConfigVersion:
      T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2
        .version,
    selectorConfigHash:
      T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
    graphifyInvocationCount: 0,
    cases,
  });
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

export function auditT44AnswerObligationBindingsV1(
  input: {
    request: QueryUnderstandingInputV1;
    prediction: AnswerObligationSetV1;
  },
) {
  const request = QueryUnderstandingInputV1Schema.parse(
    input.request,
  );
  const prediction =
    AnswerObligationSetV1Schema.parse(
      input.prediction,
    );
  const messages = sourceMessages(request);
  let sourceAnchor = 0;
  let entity = 0;
  let constraint = 0;
  for (const obligation of prediction.obligations) {
    obligation.sourceAnchors.forEach((anchor) => {
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
        sourceAnchor += 1;
      }
    });
    const anchorCount =
      obligation.sourceAnchors.length;
    entity += obligation.entityMentions
      .filter(({ anchorIndexes }) =>
        anchorIndexes.some(
          (index) => index >= anchorCount,
        ))
      .length;
    constraint += obligation.constraints
      .filter(({ anchorIndexes }) =>
        anchorIndexes.some(
          (index) => index >= anchorCount,
        ))
      .length;
  }
  return {
    sourceAnchor,
    entity,
    constraint,
  };
}

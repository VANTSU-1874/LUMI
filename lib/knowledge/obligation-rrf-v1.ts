import { z } from "zod";

import {
  DirectEvidenceProbeResultV1Schema,
  type DirectEvidenceProbeResultV1,
} from "./direct-evidence-channel-probe-v1";
import { sha256StableJsonV2 } from "./knowledge-object-v2";
import {
  ChannelCandidateV2Schema,
  RetrievalChannelV2Schema,
} from "./rank-fusion-v2";
import {
  MODEL_GUIDED_RETRIEVAL_LIMITS_V1,
} from "./retrieval-plan-v1";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IdSchema = z.string().regex(ID_PATTERN);
const HashSchema = z.string().regex(HASH_PATTERN);
const ObligationIdSchema = z.string()
  .regex(/^obligation-[1-4]$/);

export const OBLIGATION_RRF_CONFIG_V1 = Object.freeze({
  id: "lumi-obligation-rrf-v1",
  version: "1.1.0",
  schemaVersion: 1,
  rrfK: MODEL_GUIDED_RETRIEVAL_LIMITS_V1.rrfK,
  wholeQueryTotalWeight: 1,
  eachObligationTotalWeight: 1,
  queryWeight:
    "ONE_DIVIDED_BY_EXECUTABLE_QUERY_COUNT_FOR_SIGNAL",
  channelWeight:
    "QUERY_WEIGHT_DIVIDED_BY_HEALTHY_CHANNEL_COUNT",
  rawScorePolicy: "TRACE_ONLY_NEVER_COMPARED",
  reservation:
    "RANK_ONE_PER_OBLIGATION_QUERY_PER_HEALTHY_CHANNEL",
  maximumReservedObjects: (
    MODEL_GUIDED_RETRIEVAL_LIMITS_V1
      .maximumPhysicalQueries - 1
  ) * 3,
  reservationMembershipOnly:
    "SELECT_THEN_KEEP_GLOBAL_RRF_ORDER",
  candidateLimit:
    MODEL_GUIDED_RETRIEVAL_LIMITS_V1
      .maximumCandidateObjects,
  tieBreak: [
    "FUSION_SCORE_DESC",
    "BEST_RAW_RANK_ASC",
    "OBJECT_ID_CODE_POINT_ASC",
  ],
} as const);

export const OBLIGATION_RRF_CONFIG_HASH_V1 =
  sha256StableJsonV2(OBLIGATION_RRF_CONFIG_V1);

export const ObligationRrfContributionV1Schema = z
  .object({
    signal: z.enum(["WHOLE_QUERY", "OBLIGATION"]),
    obligationId: ObligationIdSchema.nullable(),
    queryId: z.string().regex(/^query-[0-9a-f]{16}$/),
    channel: RetrievalChannelV2Schema,
    candidateId: ChannelCandidateV2Schema.shape.candidateId,
    objectId: ChannelCandidateV2Schema.shape.objectId,
    representationId:
      ChannelCandidateV2Schema.shape.representationId,
    nodeId: ChannelCandidateV2Schema.shape.nodeId,
    assetId: ChannelCandidateV2Schema.shape.assetId,
    region: ChannelCandidateV2Schema.shape.region,
    rank: ChannelCandidateV2Schema.shape.rank,
    rawScore: ChannelCandidateV2Schema.shape.rawScore,
    queryWeight: z.number().finite().positive().max(1),
    channelWeight: z.number().finite().positive().max(1),
    rrfContribution:
      z.number().finite().positive(),
  })
  .strict()
  .superRefine((contribution, context) => {
    if (
      (
        contribution.signal === "WHOLE_QUERY"
        && contribution.obligationId !== null
      )
      || (
        contribution.signal === "OBLIGATION"
        && contribution.obligationId === null
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["obligationId"],
        message:
          "RRF signal and obligation binding must agree",
      });
    }
    const expected = contribution.channelWeight
      / (
        OBLIGATION_RRF_CONFIG_V1.rrfK
        + contribution.rank
      );
    if (
      Math.abs(
        expected - contribution.rrfContribution,
      ) > 1e-15
    ) {
      context.addIssue({
        code: "custom",
        path: ["rrfContribution"],
        message:
          "RRF contribution must derive only from weight and rank",
      });
    }
  });

export const ObligationRrfReservationV1Schema = z
  .object({
    queryId: z.string().regex(/^query-[0-9a-f]{16}$/),
    obligationIds: z.array(ObligationIdSchema)
      .min(1)
      .max(4),
    channel: RetrievalChannelV2Schema,
    candidateId: ChannelCandidateV2Schema.shape.candidateId,
    objectId: ChannelCandidateV2Schema.shape.objectId,
    rank: z.literal(1),
  })
  .strict()
  .superRefine((reservation, context) => {
    if (
      new Set(reservation.obligationIds).size
        !== reservation.obligationIds.length
      || JSON.stringify(reservation.obligationIds)
        !== JSON.stringify(
          [...reservation.obligationIds]
            .sort(compareCodePoints),
        )
    ) {
      context.addIssue({
        code: "custom",
        path: ["obligationIds"],
        message:
          "reservation obligation bindings must be unique and sorted",
      });
    }
  });

export const ObligationRrfCandidateV1Schema = z
  .object({
    objectId: IdSchema,
    fusedRank: z.number().int().min(1).max(
      MODEL_GUIDED_RETRIEVAL_LIMITS_V1
        .maximumCandidateObjects,
    ),
    fusionScore: z.number().finite().positive(),
    bestRawRank: z.number().int().min(1).max(20),
    obligationIds: z.array(ObligationIdSchema).max(4),
    reserved: z.boolean(),
    reservations: z.array(
      ObligationRrfReservationV1Schema,
    ).max(
      OBLIGATION_RRF_CONFIG_V1
        .maximumReservedObjects,
    ),
    contributions: z.array(
      ObligationRrfContributionV1Schema,
    ).min(1).max(128),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (
      candidate.reserved
      !== (candidate.reservations.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["reserved"],
        message:
          "reserved flag must match reservation traces",
      });
    }
    if (
      new Set(candidate.reservations.map(
        ({ queryId, channel }) =>
          `${queryId}:${channel}`,
      )).size !== candidate.reservations.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["reservations"],
        message:
          "one object may have at most one reservation per query channel",
      });
    }
    for (
      const [reservationIndex, reservation]
      of candidate.reservations.entries()
    ) {
      if (reservation.objectId !== candidate.objectId) {
        context.addIssue({
          code: "custom",
          path: [
            "reservations",
            reservationIndex,
            "objectId",
          ],
          message:
            "reservation must preserve canonical object ownership",
        });
      }
      for (
        const obligationId
        of reservation.obligationIds
      ) {
        if (
          !candidate.contributions.some(
            (contribution) =>
              contribution.signal === "OBLIGATION"
              && contribution.obligationId
                === obligationId
              && contribution.queryId
                === reservation.queryId
              && contribution.channel
                === reservation.channel
              && contribution.candidateId
                === reservation.candidateId
              && contribution.objectId
                === reservation.objectId
              && contribution.rank === 1,
          )
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "reservations",
              reservationIndex,
            ],
            message:
              "reservation must bind to an obligation rank-one contribution",
          });
        }
      }
    }
    if (
      candidate.contributions.some(
        ({ objectId }) =>
          objectId !== candidate.objectId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["contributions"],
        message:
          "all RRF traces must preserve canonical object ownership",
      });
    }
    const contributionIds = Array.from(new Set(
      candidate.contributions.flatMap(
        ({ obligationId }) =>
          obligationId === null ? [] : [obligationId],
      ),
    )).sort(compareCodePoints);
    if (
      JSON.stringify(candidate.obligationIds)
      !== JSON.stringify(contributionIds)
    ) {
      context.addIssue({
        code: "custom",
        path: ["obligationIds"],
        message:
          "candidate obligation bindings must derive from contribution traces",
      });
    }
    const expectedScore =
      candidate.contributions.reduce(
        (sum, contribution) =>
          sum + contribution.rrfContribution,
        0,
      );
    if (
      Math.abs(
        candidate.fusionScore - expectedScore,
      ) > 1e-15
    ) {
      context.addIssue({
        code: "custom",
        path: ["fusionScore"],
        message:
          "candidate score must equal summed RRF contributions",
      });
    }
    if (
      candidate.bestRawRank
      !== Math.min(
        ...candidate.contributions.map(
          ({ rank }) => rank,
        ),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["bestRawRank"],
        message:
          "best raw rank must derive from contribution traces",
      });
    }
  });

export const ObligationRrfResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("OBLIGATION_RRF"),
    configHash: HashSchema,
    queryCount: z.number().int().min(1).max(
      MODEL_GUIDED_RETRIEVAL_LIMITS_V1
        .maximumPhysicalQueries,
    ),
    executableQueryCount: z.number().int().min(0).max(
      MODEL_GUIDED_RETRIEVAL_LIMITS_V1
        .maximumPhysicalQueries,
    ),
    skippedQueryCount: z.number().int().min(0).max(
      MODEL_GUIDED_RETRIEVAL_LIMITS_V1
        .maximumPhysicalQueries,
    ),
    candidates: z.array(
      ObligationRrfCandidateV1Schema,
    ).max(
      MODEL_GUIDED_RETRIEVAL_LIMITS_V1
        .maximumCandidateObjects,
    ),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.executableQueryCount
        + result.skippedQueryCount
      !== result.queryCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["queryCount"],
        message:
          "RRF query counts must partition executable and skipped probes",
      });
    }
    if (
      result.candidates.some(
        ({ fusedRank }, index) =>
          fusedRank !== index + 1,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message:
          "RRF candidate ranks must be contiguous",
      });
    }
    if (
      result.candidates.some((candidate, index) => {
        const previous = result.candidates[index - 1];
        return previous
          ? compareCandidates(candidate, previous) < 0
          : false;
      })
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message:
          "RRF candidates must use the frozen deterministic order",
      });
    }
    const reservationKeys = result.candidates.flatMap(
      ({ reservations }) =>
        reservations.map(
          ({ queryId, channel }) =>
            `${queryId}:${channel}`,
        ),
    );
    if (
      new Set(reservationKeys).size
        !== reservationKeys.length
      || reservationKeys.length
        > OBLIGATION_RRF_CONFIG_V1
          .maximumReservedObjects
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message:
          "RRF reservations must be globally unique and bounded",
      });
    }
  });

export type ObligationRrfContributionV1 = z.infer<
  typeof ObligationRrfContributionV1Schema
>;
export type ObligationRrfReservationV1 = z.infer<
  typeof ObligationRrfReservationV1Schema
>;
export type ObligationRrfCandidateV1 = z.infer<
  typeof ObligationRrfCandidateV1Schema
>;
export type ObligationRrfResultV1 = z.infer<
  typeof ObligationRrfResultV1Schema
>;

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareCandidates(
  left: Pick<
    ObligationRrfCandidateV1,
    "objectId" | "fusionScore" | "bestRawRank"
  >,
  right: Pick<
    ObligationRrfCandidateV1,
    "objectId" | "fusionScore" | "bestRawRank"
  >,
) {
  return (
    right.fusionScore - left.fusionScore
    || left.bestRawRank - right.bestRawRank
    || compareCodePoints(left.objectId, right.objectId)
  );
}

function contributionOrder(
  left: ObligationRrfContributionV1,
  right: ObligationRrfContributionV1,
) {
  return (
    (
      left.signal === right.signal
        ? 0
        : left.signal === "WHOLE_QUERY" ? -1 : 1
    )
    || compareCodePoints(
      left.obligationId ?? "",
      right.obligationId ?? "",
    )
    || compareCodePoints(left.queryId, right.queryId)
    || compareCodePoints(left.channel, right.channel)
    || left.rank - right.rank
    || compareCodePoints(
      left.candidateId,
      right.candidateId,
    )
  );
}

export function fuseObligationRrfV1(
  input: readonly DirectEvidenceProbeResultV1[],
): ObligationRrfResultV1 {
  const results = z.array(
    DirectEvidenceProbeResultV1Schema,
  )
    .min(1)
    .max(
      MODEL_GUIDED_RETRIEVAL_LIMITS_V1
        .maximumPhysicalQueries,
    )
    .parse(input);
  const queryIds = results.map(
    ({ query }) => query.queryId,
  );
  if (new Set(queryIds).size !== queryIds.length) {
    throw new Error(
      "OBLIGATION_RRF_DUPLICATE_PHYSICAL_QUERY",
    );
  }
  if (
    results.filter(
      ({ query }) => query.source === "WHOLE_QUERY",
    ).length !== 1
  ) {
    throw new Error(
      "OBLIGATION_RRF_WHOLE_QUERY_REQUIRED",
    );
  }
  const executable = results.filter(
    ({ status }) => status !== "SKIPPED_NON_STATIC",
  );
  const executableQueryCountByObligation = new Map<
    string,
    number
  >();
  for (const result of executable) {
    for (const obligationId of result.query.obligationIds) {
      executableQueryCountByObligation.set(
        obligationId,
        (
          executableQueryCountByObligation.get(
            obligationId,
          ) ?? 0
        ) + 1,
      );
    }
  }
  const contributionsByObject = new Map<
    string,
    ObligationRrfContributionV1[]
  >();
  for (const result of executable) {
    const channels = (
      Object.entries(result.channels) as Array<
        [
          ObligationRrfContributionV1["channel"],
          NonNullable<
            DirectEvidenceProbeResultV1[
              "channels"
            ][keyof DirectEvidenceProbeResultV1["channels"]]
          >,
        ]
      >
    ).sort(([left], [right]) =>
      compareCodePoints(left, right));
    const healthyChannelCount = channels.length;
    if (healthyChannelCount === 0) {
      throw new Error(
        "OBLIGATION_RRF_EXECUTABLE_CHANNELS_REQUIRED",
      );
    }
    const signals: Array<{
      signal: "WHOLE_QUERY" | "OBLIGATION";
      obligationId: string | null;
      queryWeight: number;
    }> = [
      ...(result.query.source === "WHOLE_QUERY"
        ? [{
            signal: "WHOLE_QUERY" as const,
            obligationId: null,
            queryWeight: 1,
          }]
        : []),
      ...result.query.obligationIds.map(
        (obligationId) => ({
          signal: "OBLIGATION" as const,
          obligationId,
          queryWeight: 1 / (
            executableQueryCountByObligation.get(
              obligationId,
            ) ?? 1
          ),
        }),
      ),
    ];
    for (const signal of signals) {
      const channelWeight =
        signal.queryWeight / healthyChannelCount;
      for (const [channel, channelResult] of channels) {
        for (const hit of channelResult.hits) {
          const contribution =
            ObligationRrfContributionV1Schema.parse({
              signal: signal.signal,
              obligationId: signal.obligationId,
              queryId: result.query.queryId,
              channel,
              candidateId: hit.candidateId,
              objectId: hit.objectId,
              representationId: hit.representationId,
              nodeId: hit.nodeId,
              assetId: hit.assetId,
              region: hit.region,
              rank: hit.rank,
              rawScore: hit.rawScore,
              queryWeight: signal.queryWeight,
              channelWeight,
              rrfContribution: channelWeight / (
                OBLIGATION_RRF_CONFIG_V1.rrfK
                + hit.rank
              ),
            });
          const existing =
            contributionsByObject.get(hit.objectId)
            ?? [];
          existing.push(contribution);
          contributionsByObject.set(
            hit.objectId,
            existing,
          );
        }
      }
    }
  }
  const reservationsByObject = new Map<
    string,
    ObligationRrfReservationV1[]
  >();
  const reservationOrder: string[] = [];
  for (
    const result
    of [...executable].sort((left, right) =>
      compareCodePoints(
        left.query.queryId,
        right.query.queryId,
      ))
  ) {
    if (
      result.query.source === "WHOLE_QUERY"
      || result.query.obligationIds.length === 0
    ) {
      continue;
    }
    const obligationIds = [
      ...result.query.obligationIds,
    ].sort(compareCodePoints);
    const channels = (
      Object.entries(result.channels) as Array<
        [
          ObligationRrfReservationV1["channel"],
          NonNullable<
            DirectEvidenceProbeResultV1[
              "channels"
            ][keyof DirectEvidenceProbeResultV1["channels"]]
          >,
        ]
      >
    ).sort(([left], [right]) =>
      compareCodePoints(left, right));
    for (const [channel, channelResult] of channels) {
      const hit = channelResult.hits.find(
        ({ rank }) => rank === 1,
      );
      if (!hit) continue;
      const reservation =
        ObligationRrfReservationV1Schema.parse({
          queryId: result.query.queryId,
          obligationIds,
          channel,
          candidateId: hit.candidateId,
          objectId: hit.objectId,
          rank: 1,
        });
      const existing =
        reservationsByObject.get(hit.objectId)
        ?? [];
      existing.push(reservation);
      reservationsByObject.set(
        hit.objectId,
        existing,
      );
      if (!reservationOrder.includes(hit.objectId)) {
        reservationOrder.push(hit.objectId);
      }
    }
  }
  if (
    reservationOrder.length
    > OBLIGATION_RRF_CONFIG_V1
      .maximumReservedObjects
  ) {
    throw new Error(
      "OBLIGATION_RRF_RESERVATION_LIMIT_EXCEEDED",
    );
  }
  const allRanked = [...contributionsByObject.entries()]
    .map(([objectId, rawContributions]) => {
      const contributions = [...rawContributions]
        .sort(contributionOrder);
      const reservations = [
        ...(reservationsByObject.get(objectId) ?? []),
      ];
      return {
        objectId,
        fusionScore: contributions.reduce(
          (sum, contribution) =>
            sum + contribution.rrfContribution,
          0,
        ),
        bestRawRank: Math.min(
          ...contributions.map(({ rank }) => rank),
        ),
        obligationIds: Array.from(new Set(
          contributions.flatMap(
            ({ obligationId }) =>
              obligationId === null
                ? []
                : [obligationId],
          ),
        )).sort(compareCodePoints),
        reserved: reservations.length > 0,
        reservations,
        contributions,
      };
    })
    .sort(compareCandidates);
  const selectedObjectIds = new Set(reservationOrder);
  for (const candidate of allRanked) {
    if (
      selectedObjectIds.size
      >= MODEL_GUIDED_RETRIEVAL_LIMITS_V1
        .maximumCandidateObjects
    ) {
      break;
    }
    selectedObjectIds.add(candidate.objectId);
  }
  const ranked = allRanked
    .filter(({ objectId }) =>
      selectedObjectIds.has(objectId))
    .map((candidate, index) => ({
      ...candidate,
      fusedRank: index + 1,
    }));
  return ObligationRrfResultV1Schema.parse({
    schemaVersion: 1,
    kind: "OBLIGATION_RRF",
    configHash: OBLIGATION_RRF_CONFIG_HASH_V1,
    queryCount: results.length,
    executableQueryCount: executable.length,
    skippedQueryCount:
      results.length - executable.length,
    candidates: ranked,
  });
}

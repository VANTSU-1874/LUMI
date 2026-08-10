import { createHash } from "node:crypto";

import { z } from "zod";

import { EvidenceChannelV2Schema } from "../../lib/knowledge/evidence-bundle-v2";
import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeObjectV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  QueryClaimDecompositionV1Schema,
  type QueryClaimDecompositionV1,
} from "../../lib/knowledge/query-claim-decomposer-v1";
import {
  QueryPrerequisiteDecisionV3Schema,
} from "../../lib/knowledge/query-prerequisite-router-v3";
import {
  RetrievalQueryV2Schema,
  type RetrievalQueryV2,
} from "../../lib/knowledge/retrieval-query-v2";
import {
  TextObjectChannelProbeResultV3Schema,
  type TextObjectChannelProbeResultV3,
} from "../../lib/knowledge/text-object-channel-probe-v3";
import {
  T44_CLAIM_CANDIDATE_CONFIG_HASH_V1,
  T44_CLAIM_CANDIDATE_CONFIG_V1,
} from "./t44-claim-matrix-contract-v1";

export {
  T44_CLAIM_CANDIDATE_CONFIG_HASH_V1,
  T44_CLAIM_CANDIDATE_CONFIG_V1,
} from "./t44-claim-matrix-contract-v1";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const IdSchema = z.string().regex(ID_PATTERN);

const CHANNELS = [
  "LEXICAL",
  "TEXT_VECTOR",
] as const;

export const T44_CLAIM_CANDIDATE_ORACLE_GATES_V1 =
  Object.freeze({
    totalCases: 50,
    ownerOracleCaseCoverageMinimum: 48,
    groupOracleCaseCoverageMinimum: 48,
    perCoursePackCaseTotal: 10,
    perCoursePackOwnerCoverageMinimum: 9,
    perCoursePackGroupCoverageMinimum: 9,
    multiClaimCaseTotal: 10,
    multiClaimGroupCoverageMinimum: 10,
    bindingViolationMaximum: 0,
  } as const);

const CandidateConfigSchema = z
  .object({
    id: z.literal(
      T44_CLAIM_CANDIDATE_CONFIG_V1.id,
    ),
    version: z.literal("2026-07-29.2"),
    rrfK: z.literal(60),
    rawObjectLimitPerProbeChannel: z.literal(10),
    wholeQueryChannelWeight: z.literal(1),
    supportClaimTotalWeightPerChannel: z.literal(1),
    reservation: z.literal(
      "RANK_ONE_PER_SUPPORT_CLAIM_PER_HEALTHY_CHANNEL",
    ),
    fillOrdering: z.literal(
      "WEIGHTED_RRF_DESC_THEN_BEST_SOURCE_RANK_THEN_OBJECT_ID",
    ),
    maximumObjects: z.literal(16),
    eligibleAtomicNodes: z.tuple([
      z.literal("TEXT/FACT"),
      z.literal("TEXT/ACTION"),
      z.literal("TABLE"),
    ]),
    maximumAtomicNodesPerObject: z.literal(11),
    maximumCandidateNodes: z.literal(176),
  })
  .strict();

const RawObjectRankingRowV1Schema = z
  .object({
    objectId: IdSchema,
    coursePackId: IdSchema,
    rank: z.number().int().min(1).max(10),
    rawScore: z.number().finite(),
  })
  .strict();

const RawProbeChannelRankingV1Schema = z
  .object({
    summary: EvidenceChannelV2Schema,
    objects: z
      .array(RawObjectRankingRowV1Schema)
      .max(10),
  })
  .strict()
  .superRefine((ranking, context) => {
    if (
      ranking.objects.some(
        ({ rank }, index) => rank !== index + 1,
      )
      || new Set(
        ranking.objects.map(({ objectId }) => objectId),
      ).size !== ranking.objects.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["objects"],
        message:
          "raw object rankings must be unique and contiguous",
      });
    }
    if (
      ranking.summary.status === "SUCCESS"
      !== (ranking.objects.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["summary", "status"],
        message:
          "raw object ranking status must match its objects",
      });
    }
  });

const ProbeRankingV1Schema = z
  .object({
    probeId: IdSchema,
    kind: z.enum(["WHOLE_QUERY", "SUPPORT_CLAIM"]),
    textHash: HashSchema,
    claimIds: z.array(IdSchema).max(1),
    prerequisiteDecision: z.literal(
      "STATIC_CORPUS_ELIGIBLE",
    ),
    prerequisiteBasis: z.enum([
      "PROBE_QUERY",
      "STATIC_PARENT_QUERY",
    ]),
    probePrerequisiteDecision:
      QueryPrerequisiteDecisionV3Schema,
    probeQueryHash: HashSchema,
    queryHash: HashSchema,
    channels: z
      .object({
        LEXICAL: RawProbeChannelRankingV1Schema,
        TEXT_VECTOR: RawProbeChannelRankingV1Schema,
      })
      .strict(),
  })
  .strict()
  .superRefine((probe, context) => {
    if (
      probe.channels.LEXICAL.summary.channel
        !== "LEXICAL"
      || probe.channels.TEXT_VECTOR.summary.channel
        !== "TEXT_VECTOR"
    ) {
      context.addIssue({
        code: "custom",
        path: ["channels"],
        message:
          "probe rankings must use canonical text channels",
      });
    }
    if (
      (
        probe.prerequisiteBasis
          === "PROBE_QUERY"
        && (
          probe.probePrerequisiteDecision
            !== "STATIC_CORPUS_ELIGIBLE"
          || probe.probeQueryHash
            !== probe.queryHash
        )
      )
      || (
        probe.prerequisiteBasis
          === "STATIC_PARENT_QUERY"
        && (
          probe.kind !== "SUPPORT_CLAIM"
          || probe.probePrerequisiteDecision
            !== "AMBIGUOUS"
          || probe.probeQueryHash
            === probe.queryHash
        )
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["prerequisiteBasis"],
        message:
          "probe prerequisite audit must bind direct or inherited static intent",
      });
    }
  });

const ObjectSourceTraceV1Schema = z
  .object({
    probeId: IdSchema,
    probeKind: z.enum([
      "WHOLE_QUERY",
      "SUPPORT_CLAIM",
    ]),
    claimId: IdSchema.nullable(),
    channel: z.enum(CHANNELS),
    sourceRank: z.number().int().min(1).max(10),
    weight: z.number().finite().positive(),
    contribution: z.number().finite().positive(),
  })
  .strict();

const ReservationTraceV1Schema = z
  .object({
    claimId: IdSchema,
    probeId: IdSchema,
    channel: z.enum(CHANNELS),
    sourceRank: z.literal(1),
  })
  .strict();

const FusedObjectCandidateV1Schema = z
  .object({
    objectId: IdSchema,
    coursePackId: IdSchema,
    rank: z.number().int().min(1).max(16),
    weightedRrfScore: z.number().finite().positive(),
    bestSourceRank: z.number().int().min(1).max(10),
    reserved: z.boolean(),
    reservations: z
      .array(ReservationTraceV1Schema)
      .max(8),
    sources: z
      .array(ObjectSourceTraceV1Schema)
      .min(1)
      .max(10),
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
    const bestRank = Math.min(
      ...candidate.sources.map(({ sourceRank }) =>
        sourceRank),
    );
    if (candidate.bestSourceRank !== bestRank) {
      context.addIssue({
        code: "custom",
        path: ["bestSourceRank"],
        message:
          "best source rank must be derived from source traces",
      });
    }
  });

const CandidateAtomicNodeV1Schema = z
  .object({
    nodeId: IdSchema,
    objectId: IdSchema,
    coursePackId: IdSchema,
    objectRank: z.number().int().min(1).max(16),
    kind: z.enum(["TEXT", "TABLE"]),
    role: z.enum(["FACT", "ACTION"]).nullable(),
    text: z.string().trim().min(1).max(32_000),
    nodeContentHash: HashSchema,
    objectContentHash: HashSchema,
    sourceHash: HashSchema,
  })
  .strict()
  .superRefine((node, context) => {
    if (
      (node.kind === "TABLE") !== (node.role === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["role"],
        message:
          "tables require null role and text nodes require an atomic role",
      });
    }
  });

export const T44ClaimCandidateCaseV1Schema = z
  .object({
    caseId: IdSchema,
    coursePackId: IdSchema,
    coursePackVersion: z.string().trim().min(1).max(30),
    normalizedQuestion: z.string().min(1).max(500),
    decomposition: QueryClaimDecompositionV1Schema,
    expectedProviderCalls: z.number().int().min(2).max(10),
    probeRankings: z
      .array(ProbeRankingV1Schema)
      .min(1)
      .max(5),
    objectRanking: z
      .array(FusedObjectCandidateV1Schema)
      .max(16),
    candidateNodes: z
      .array(CandidateAtomicNodeV1Schema)
      .max(176),
    candidateNodeIdsSha256: HashSchema,
  })
  .strict()
  .superRefine((testCase, context) => {
    if (
      testCase.normalizedQuestion
      !== testCase.decomposition.wholeQuery
    ) {
      context.addIssue({
        code: "custom",
        path: ["normalizedQuestion"],
        message:
          "candidate question must match the decomposition",
      });
    }
    if (
      testCase.expectedProviderCalls
      !== testCase.decomposition.probes.length * 2
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedProviderCalls"],
        message:
          "expected calls must be two per probe",
      });
    }
    const expectedProbeIds =
      testCase.decomposition.probes.map(
        ({ probeId }) => probeId,
      );
    if (
      JSON.stringify(
        testCase.probeRankings.map(({ probeId }) =>
          probeId),
      ) !== JSON.stringify(expectedProbeIds)
    ) {
      context.addIssue({
        code: "custom",
        path: ["probeRankings"],
        message:
          "probe rankings must preserve decomposition order",
      });
    }
    if (
      testCase.probeRankings.some((ranking, index) => {
        const probe =
          testCase.decomposition.probes[index];
        return (
          !probe
          || ranking.kind !== probe.kind
          || ranking.textHash !== probe.textHash
          || JSON.stringify(ranking.claimIds)
            !== JSON.stringify(probe.claimIds)
          || CHANNELS.some((channel) =>
            ranking.channels[channel].objects.some(
              ({ coursePackId }) =>
                coursePackId
                !== testCase.coursePackId,
            ))
        );
      })
    ) {
      context.addIssue({
        code: "custom",
        path: ["probeRankings"],
        message:
          "probe ranking metadata must bind to the decomposition and course scope",
      });
    }
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
        path: ["objectRanking"],
        message:
          "fused object ranking must be unique and contiguous",
      });
    }
    if (
      testCase.objectRanking.some(
        ({ coursePackId }) =>
          coursePackId !== testCase.coursePackId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectRanking"],
        message:
          "fused objects must remain inside the case course scope",
      });
    }
    const objects = new Map(
      testCase.objectRanking.map((object) => [
        object.objectId,
        object,
      ]),
    );
    if (
      testCase.candidateNodes.some((node) => {
        const object = objects.get(node.objectId);
        return (
          !object
          || node.objectRank !== object.rank
          || node.coursePackId !== object.coursePackId
          || node.coursePackId
            !== testCase.coursePackId
        );
      })
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidateNodes"],
        message:
          "candidate nodes must bind to ranked in-scope objects",
      });
    }
    const nodeIds = testCase.candidateNodes.map(
      ({ nodeId }) => nodeId,
    );
    if (
      new Set(nodeIds).size !== nodeIds.length
      || testCase.candidateNodeIdsSha256
        !== sha256StableJsonV2(nodeIds)
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidateNodeIdsSha256"],
        message:
          "candidate node ids must be unique and hash-bound",
      });
    }
  });

export type T44ClaimCandidateCaseV1 = z.infer<
  typeof T44ClaimCandidateCaseV1Schema
>;

export const T44ClaimCandidateRuntimeInputV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T44_CLAIM_CANDIDATE_RUNTIME_INPUT",
    ),
    runtimeSuite: z
      .object({
        id: IdSchema,
        version: z.string().trim().min(1).max(50),
        suiteHash: HashSchema,
      })
      .strict(),
    corpusSnapshot: z
      .object({
        bundleHash: HashSchema,
      })
      .strict(),
    config: CandidateConfigSchema,
    configHash: z.literal(
      T44_CLAIM_CANDIDATE_CONFIG_HASH_V1,
    ),
    expectedProviderCalls: z.number().int().min(100).max(500),
    expectedChannelCalls: z
      .object({
        LEXICAL: z.number().int().min(50).max(250),
        TEXT_VECTOR: z.number().int().min(50).max(250),
      })
      .strict(),
    cases: z
      .array(T44ClaimCandidateCaseV1Schema)
      .length(50),
  })
    .strict()
    .superRefine((input, context) => {
      const caseIds = input.cases.map(({ caseId }) =>
        caseId);
      if (new Set(caseIds).size !== caseIds.length) {
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message: "candidate case ids must be unique",
        });
      }
      const probeCount = input.cases.reduce(
        (sum, testCase) =>
          sum + testCase.decomposition.probes.length,
        0,
      );
      if (
        input.expectedProviderCalls !== probeCount * 2
        || input.expectedChannelCalls.LEXICAL
          !== probeCount
        || input.expectedChannelCalls.TEXT_VECTOR
          !== probeCount
      ) {
        context.addIssue({
          code: "custom",
          path: ["expectedProviderCalls"],
          message:
            "provider expectations must derive from probe count",
        });
      }
      if (
        input.cases.some((testCase) =>
          testCase.probeRankings.some((probe) =>
            CHANNELS.some((channel) =>
              probe.channels[channel].summary
                .corpusBundleHash
              !== input.corpusSnapshot.bundleHash)))
      ) {
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message:
            "candidate probe summaries must bind to the artifact corpus",
        });
      }
    });

export type T44ClaimCandidateRuntimeInputV1 = z.infer<
  typeof T44ClaimCandidateRuntimeInputV1Schema
>;

type ProbeBinding = {
  probeId: string;
  result: TextObjectChannelProbeResultV3;
};

type SourceAccumulator = {
  objectId: string;
  coursePackId: string;
  weightedRrfScore: number;
  bestSourceRank: number;
  reservations: Array<z.infer<
    typeof ReservationTraceV1Schema
  >>;
  sources: Array<z.infer<
    typeof ObjectSourceTraceV1Schema
  >>;
};

function compareCodePoints(
  left: string,
  right: string,
) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function eligibleAtomicNode(
  node: KnowledgeObjectV2["nodes"][number],
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

function sourceHash(object: KnowledgeObjectV2) {
  return sha256StableJsonV2({
    sourceIdentityBasis: object.sourceIdentityBasis,
    provenance: object.provenance,
    parser: object.parser,
    contentVersion: object.contentVersion,
  });
}

function nodeText(
  node: KnowledgeObjectV2["nodes"][number],
) {
  if (node.kind === "TABLE") return node.plainText;
  if (node.kind === "TEXT") return node.text;
  throw new Error(
    `T44_CLAIM_CANDIDATE_NODE_NOT_ATOMIC:${node.id}`,
  );
}

function queryMatchesProbe(input: {
  baseQuery: RetrievalQueryV2;
  decomposition: QueryClaimDecompositionV1;
  probeId: string;
  result: TextObjectChannelProbeResultV3;
}) {
  const probe = input.decomposition.probes.find(
    ({ probeId }) => probeId === input.probeId,
  );
  if (!probe) {
    throw new Error(
      `T44_CLAIM_CANDIDATE_PROBE_UNKNOWN:${input.probeId}`,
    );
  }
  const query = input.result.query;
  if (
    query.mode !== "TEXT_TO_TEXT"
    || query.normalizedText !== probe.text
    || query.scope.corpusBundleHash
      !== input.baseQuery.scope.corpusBundleHash
    || query.scope.sourceCoursePack?.id
      !== input.baseQuery.scope.sourceCoursePack?.id
    || query.scope.sourceCoursePack?.version
      !== input.baseQuery.scope.sourceCoursePack?.version
    || JSON.stringify(query.excludeAssetIds)
      !== JSON.stringify(input.baseQuery.excludeAssetIds)
  ) {
    throw new Error(
      `T44_CLAIM_CANDIDATE_PROBE_QUERY_DRIFT:${input.probeId}`,
    );
  }
  const probeQueryHash = sha256StableJsonV2(query);
  const baseQueryHash =
    sha256StableJsonV2(input.baseQuery);
  if (
    input.result.probePrerequisiteTrace.queryHash
      !== probeQueryHash
    || (
      input.result.prerequisiteBasis
        === "PROBE_QUERY"
      && input.result.prerequisiteTrace.queryHash
        !== probeQueryHash
    )
    || (
      input.result.prerequisiteBasis
        === "STATIC_PARENT_QUERY"
      && (
        probe.kind !== "SUPPORT_CLAIM"
        || input.result.prerequisiteTrace.queryHash
          !== baseQueryHash
      )
    )
  ) {
    throw new Error(
      `T44_CLAIM_CANDIDATE_PREREQUISITE_BINDING_DRIFT:${input.probeId}`,
    );
  }
  return probe;
}

function assertCanonicalRawObjects(input: {
  corpus: KnowledgeCorpusBundleV2;
  coursePackId: string;
  probeId: string;
  result: TextObjectChannelProbeResultV3;
}) {
  const objects = new Map(
    input.corpus.objects.map((object) => [
      object.id,
      object,
    ]),
  );
  for (const channel of CHANNELS) {
    const candidates =
      input.result.channels[channel]
        .objectCandidates ?? [];
    for (const candidate of candidates) {
      const canonical = objects.get(candidate.objectId);
      if (
        !canonical
        || candidate.coursePackId
          !== input.coursePackId
        || canonical.sourceCoursePack.id
          !== input.coursePackId
      ) {
        throw new Error(
          `T44_CLAIM_CANDIDATE_OBJECT_BINDING_INVALID:${input.probeId}:${channel}:${candidate.objectId}`,
        );
      }
    }
  }
}

function rawProbeRanking(
  probe: QueryClaimDecompositionV1["probes"][number],
  result: TextObjectChannelProbeResultV3,
) {
  return ProbeRankingV1Schema.parse({
    probeId: probe.probeId,
    kind: probe.kind,
    textHash: probe.textHash,
    claimIds: probe.claimIds,
    prerequisiteDecision:
      result.prerequisiteTrace.decision,
    prerequisiteBasis:
      result.prerequisiteBasis,
    probePrerequisiteDecision:
      result.probePrerequisiteTrace.decision,
    probeQueryHash:
      result.probePrerequisiteTrace.queryHash,
    queryHash: result.prerequisiteTrace.queryHash,
    channels: Object.fromEntries(
      CHANNELS.map((channel) => [
        channel,
        {
          summary: result.channels[channel].summary,
          objects: (
            result.channels[channel]
              .objectCandidates ?? []
          ).map((candidate) => ({
            objectId: candidate.objectId,
            coursePackId: candidate.coursePackId,
            rank: candidate.objectRank,
            rawScore: candidate.rawScore,
          })),
        },
      ]),
    ),
  });
}

export function buildT44ClaimCandidateCaseV1(input: {
  caseId: string;
  query: RetrievalQueryV2;
  decomposition: QueryClaimDecompositionV1;
  probeResults: readonly ProbeBinding[];
  corpus: KnowledgeCorpusBundleV2;
}): T44ClaimCandidateCaseV1 {
  const caseId = IdSchema.parse(input.caseId);
  const query = RetrievalQueryV2Schema.parse(input.query);
  const decomposition =
    QueryClaimDecompositionV1Schema.parse(
      input.decomposition,
    );
  const corpus = verifyKnowledgeCorpusBundleV2(
    input.corpus,
  );
  const coursePack = query.scope.sourceCoursePack;
  if (
    query.mode !== "TEXT_TO_TEXT"
    || coursePack === null
    || query.scope.corpusBundleHash !== corpus.bundleHash
    || decomposition.wholeQuery
      !== query.normalizedText
  ) {
    throw new Error(
      "T44_CLAIM_CANDIDATE_CASE_BINDING_INVALID",
    );
  }
  const parsedBindings = input.probeResults.map(
    ({ probeId, result }) => ({
      probeId: IdSchema.parse(probeId),
      result:
        TextObjectChannelProbeResultV3Schema.parse(
          result,
        ),
    }),
  );
  if (
    JSON.stringify(
      parsedBindings.map(({ probeId }) => probeId),
    )
    !== JSON.stringify(
      decomposition.probes.map(({ probeId }) =>
        probeId),
    )
  ) {
    throw new Error(
      "T44_CLAIM_CANDIDATE_PROBE_SET_DRIFT",
    );
  }

  const accumulators = new Map<
    string,
    SourceAccumulator
  >();
  const resultByProbe = new Map(
    parsedBindings.map((binding) => [
      binding.probeId,
      binding.result,
    ]),
  );
  const probeRankings = parsedBindings.map(
    ({ probeId, result }) => {
      const probe = queryMatchesProbe({
        baseQuery: query,
        decomposition,
        probeId,
        result,
      });
      assertCanonicalRawObjects({
        corpus,
        coursePackId: coursePack.id,
        probeId,
        result,
      });
      const weight =
        probe.kind === "WHOLE_QUERY"
          ? T44_CLAIM_CANDIDATE_CONFIG_V1
            .wholeQueryChannelWeight
          : (
              T44_CLAIM_CANDIDATE_CONFIG_V1
                .supportClaimTotalWeightPerChannel
              / decomposition.claims.length
            );
      for (const channel of CHANNELS) {
        for (
          const object of (
            result.channels[channel]
              .objectCandidates ?? []
          )
        ) {
          const contribution =
            weight / (
              T44_CLAIM_CANDIDATE_CONFIG_V1.rrfK
              + object.objectRank
            );
          const current =
            accumulators.get(object.objectId) ?? {
              objectId: object.objectId,
              coursePackId: object.coursePackId,
              weightedRrfScore: 0,
              bestSourceRank: object.objectRank,
              reservations: [],
              sources: [],
            };
          current.weightedRrfScore += contribution;
          current.bestSourceRank = Math.min(
            current.bestSourceRank,
            object.objectRank,
          );
          current.sources.push({
            probeId,
            probeKind: probe.kind,
            claimId: probe.claimIds[0] ?? null,
            channel,
            sourceRank: object.objectRank,
            weight,
            contribution,
          });
          accumulators.set(object.objectId, current);
        }
      }
      return rawProbeRanking(probe, result);
    },
  );

  const reservationOrder: string[] = [];
  for (const claim of decomposition.claims) {
    const probe = decomposition.probes.find(
      ({ claimIds }) =>
        claimIds.includes(claim.claimId),
    );
    if (!probe) {
      throw new Error(
        `T44_CLAIM_CANDIDATE_CLAIM_PROBE_MISSING:${claim.claimId}`,
      );
    }
    const result = resultByProbe.get(probe.probeId)!;
    for (const channel of CHANNELS) {
      const object =
        result.channels[channel]
          .objectCandidates?.[0];
      if (!object) continue;
      const current = accumulators.get(object.objectId)!;
      current.reservations.push({
        claimId: claim.claimId,
        probeId: probe.probeId,
        channel,
        sourceRank: 1,
      });
      if (!reservationOrder.includes(object.objectId)) {
        reservationOrder.push(object.objectId);
      }
    }
  }

  const fillOrder = [...accumulators.values()]
    .sort((left, right) =>
      right.weightedRrfScore
        - left.weightedRrfScore
      || left.bestSourceRank - right.bestSourceRank
      || compareCodePoints(
        left.objectId,
        right.objectId,
      ));
  const selectedObjectIds = [
    ...reservationOrder,
    ...fillOrder
      .map(({ objectId }) => objectId)
      .filter((objectId) =>
        !reservationOrder.includes(objectId)),
  ].slice(
    0,
    T44_CLAIM_CANDIDATE_CONFIG_V1.maximumObjects,
  );
  const objectRanking = selectedObjectIds.map(
    (objectId, index) => {
      const candidate = accumulators.get(objectId)!;
      return FusedObjectCandidateV1Schema.parse({
        ...candidate,
        rank: index + 1,
        reserved: candidate.reservations.length > 0,
      });
    },
  );
  const corpusObjects = new Map(
    corpus.objects.map((object) => [
      object.id,
      object,
    ]),
  );
  const candidateNodes = objectRanking.flatMap(
    (rankedObject) => {
      const object =
        corpusObjects.get(rankedObject.objectId)!;
      const eligible = object.nodes
        .filter(eligibleAtomicNode)
        .sort((left, right) =>
          compareCodePoints(left.id, right.id));
      if (
        eligible.length
        > T44_CLAIM_CANDIDATE_CONFIG_V1
          .maximumAtomicNodesPerObject
      ) {
        throw new Error(
          `T44_CLAIM_CANDIDATE_OBJECT_NODE_LIMIT:${object.id}:${eligible.length}`,
        );
      }
      const canonicalSourceHash = sourceHash(object);
      return eligible.map((node) => ({
        nodeId: node.id,
        objectId: object.id,
        coursePackId: object.sourceCoursePack.id,
        objectRank: rankedObject.rank,
        kind: node.kind as "TEXT" | "TABLE",
        role:
          node.kind === "TEXT"
            ? node.role as "FACT" | "ACTION"
            : null,
        text: nodeText(node),
        nodeContentHash: node.contentHash,
        objectContentHash: object.contentHash,
        sourceHash: canonicalSourceHash,
      }));
    },
  );
  if (
    candidateNodes.length
    > T44_CLAIM_CANDIDATE_CONFIG_V1
      .maximumCandidateNodes
  ) {
    throw new Error(
      `T44_CLAIM_CANDIDATE_NODE_LIMIT:${candidateNodes.length}`,
    );
  }
  return T44ClaimCandidateCaseV1Schema.parse({
    caseId,
    coursePackId: coursePack.id,
    coursePackVersion: coursePack.version,
    normalizedQuestion: query.normalizedText,
    decomposition,
    expectedProviderCalls:
      decomposition.probes.length * 2,
    probeRankings,
    objectRanking,
    candidateNodes,
    candidateNodeIdsSha256: sha256StableJsonV2(
      candidateNodes.map(({ nodeId }) => nodeId),
    ),
  });
}

export function createT44ClaimCandidateRuntimeInputV1(
  input: {
    runtimeSuite: {
      id: string;
      version: string;
      suiteHash: string;
    };
    corpusBundleHash: string;
    cases: readonly T44ClaimCandidateCaseV1[];
  },
): T44ClaimCandidateRuntimeInputV1 {
  const cases = input.cases.map((testCase) =>
    T44ClaimCandidateCaseV1Schema.parse(testCase));
  const probeCount = cases.reduce(
    (sum, testCase) =>
      sum + testCase.decomposition.probes.length,
    0,
  );
  return T44ClaimCandidateRuntimeInputV1Schema.parse({
    schemaVersion: 1,
    kind: "T44_CLAIM_CANDIDATE_RUNTIME_INPUT",
    runtimeSuite: input.runtimeSuite,
    corpusSnapshot: {
      bundleHash: input.corpusBundleHash,
    },
    config: T44_CLAIM_CANDIDATE_CONFIG_V1,
    configHash:
      T44_CLAIM_CANDIDATE_CONFIG_HASH_V1,
    expectedProviderCalls: probeCount * 2,
    expectedChannelCalls: {
      LEXICAL: probeCount,
      TEXT_VECTOR: probeCount,
    },
    cases,
  });
}

export function serializeT44ClaimCandidateRuntimeInputV1(
  input: T44ClaimCandidateRuntimeInputV1,
) {
  return `${JSON.stringify(
    T44ClaimCandidateRuntimeInputV1Schema.parse(input),
    null,
    2,
  )}\n`;
}

export function sha256T44ClaimCandidateRuntimeInputV1(
  serializedInput: string,
) {
  return createHash("sha256")
    .update(serializedInput, "utf8")
    .digest("hex");
}

const OracleQrelCaseV1Schema = z
  .object({
    caseId: IdSchema,
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
  })
  .strict();

export type T44ClaimCandidateOracleQrelCaseV1 =
  z.infer<typeof OracleQrelCaseV1Schema>;

function canonicalNodeBinding(
  corpus: KnowledgeCorpusBundleV2,
) {
  return new Map(
    corpus.objects.flatMap((object) =>
      object.nodes.map((node) => [
        node.id,
        { object, node },
      ] as const)),
  );
}

function candidateBindingViolations(input: {
  testCase: T44ClaimCandidateCaseV1;
  corpus: KnowledgeCorpusBundleV2;
}) {
  const objectById = new Map(
    input.corpus.objects.map((object) => [
      object.id,
      object,
    ]),
  );
  const nodeById = canonicalNodeBinding(input.corpus);
  const violations: string[] = [];
  for (const rankedObject of input.testCase.objectRanking) {
    const object = objectById.get(rankedObject.objectId);
    if (!object) {
      violations.push(`OWNER:${rankedObject.objectId}`);
      continue;
    }
    if (
      object.sourceCoursePack.id
        !== input.testCase.coursePackId
      || object.sourceCoursePack.version
        !== input.testCase.coursePackVersion
      || rankedObject.coursePackId
        !== input.testCase.coursePackId
    ) {
      violations.push(`SCOPE:${rankedObject.objectId}`);
    }
  }
  for (const candidate of input.testCase.candidateNodes) {
    const binding = nodeById.get(candidate.nodeId);
    if (
      !binding
      || binding.object.id !== candidate.objectId
    ) {
      violations.push(`OWNER:${candidate.nodeId}`);
      continue;
    }
    if (
      binding.object.sourceCoursePack.id
        !== candidate.coursePackId
      || candidate.coursePackId
        !== input.testCase.coursePackId
    ) {
      violations.push(`SCOPE:${candidate.nodeId}`);
    }
    if (
      !eligibleAtomicNode(binding.node)
      || binding.node.kind !== candidate.kind
      || (
        binding.node.kind === "TEXT"
        && binding.node.role !== candidate.role
      )
    ) {
      violations.push(`ROLE:${candidate.nodeId}`);
    }
    const canonicalText =
      eligibleAtomicNode(binding.node)
        ? nodeText(binding.node)
        : null;
    if (
      binding.node.contentHash
        !== candidate.nodeContentHash
      || binding.object.contentHash
        !== candidate.objectContentHash
      || sourceHash(binding.object)
        !== candidate.sourceHash
      || canonicalText !== candidate.text
    ) {
      violations.push(`SOURCE:${candidate.nodeId}`);
    }
  }
  return violations;
}

function summarizeOracleRows(
  rows: readonly {
    coursePackId: string;
    multiClaim: boolean;
    ownerCovered: boolean;
    groupCovered: boolean;
    bindingViolations: readonly string[];
  }[],
) {
  return {
    totalCases: rows.length,
    ownerOracleCaseCoverage: rows.filter(
      ({ ownerCovered }) => ownerCovered,
    ).length,
    groupOracleCaseCoverage: rows.filter(
      ({ groupCovered }) => groupCovered,
    ).length,
    multiClaim: {
      total: rows.filter(({ multiClaim }) =>
        multiClaim).length,
      groupOracleCaseCoverage: rows.filter(
        ({ multiClaim, groupCovered }) =>
          multiClaim && groupCovered,
      ).length,
    },
    bindingViolationCount: rows.reduce(
      (sum, { bindingViolations }) =>
        sum + bindingViolations.length,
      0,
    ),
  };
}

export function evaluateT44ClaimCandidateOracleV1(
  input: {
    serializedCandidateInput: string;
    candidateInputSha256: string;
    qrelCases:
      readonly T44ClaimCandidateOracleQrelCaseV1[];
    corpus: KnowledgeCorpusBundleV2;
  },
) {
  const expectedHash = HashSchema.parse(
    input.candidateInputSha256,
  );
  const actualHash =
    sha256T44ClaimCandidateRuntimeInputV1(
      input.serializedCandidateInput,
    );
  if (actualHash !== expectedHash) {
    throw new Error(
      `T44_CLAIM_CANDIDATE_SEAL_MISMATCH:${actualHash}`,
    );
  }
  const candidate =
    T44ClaimCandidateRuntimeInputV1Schema.parse(
      JSON.parse(input.serializedCandidateInput),
    );
  const corpus = verifyKnowledgeCorpusBundleV2(
    input.corpus,
  );
  if (
    candidate.corpusSnapshot.bundleHash
      !== corpus.bundleHash
  ) {
    throw new Error(
      "T44_CLAIM_CANDIDATE_CORPUS_BINDING_DRIFT",
    );
  }
  const qrels = z
    .array(OracleQrelCaseV1Schema)
    .length(
      T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
        .totalCases,
    )
    .parse(input.qrelCases);
  const qrelByCase = new Map(
    qrels.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  if (
    qrelByCase.size !== qrels.length
    || candidate.cases.some(
      ({ caseId }) => !qrelByCase.has(caseId),
    )
  ) {
    throw new Error(
      "T44_CLAIM_CANDIDATE_QREL_CASE_BINDING_DRIFT",
    );
  }
  const nodeById = canonicalNodeBinding(corpus);
  const rows = candidate.cases.map((testCase) => {
    const qrel = qrelByCase.get(testCase.caseId)!;
    const candidateObjectIds = new Set(
      testCase.objectRanking.map(({ objectId }) =>
        objectId),
    );
    const candidateNodeIds = new Set(
      testCase.candidateNodes.map(({ nodeId }) =>
        nodeId),
    );
    const groups = qrel.requiredEvidenceGroups.map(
      (group) => {
        const bindings = group.acceptableNodeIds.map(
          (nodeId) => {
            const binding = nodeById.get(nodeId);
            if (
              !binding
              || !eligibleAtomicNode(binding.node)
              || binding.object.sourceCoursePack.id
                !== testCase.coursePackId
              || binding.object.sourceCoursePack.version
                !== testCase.coursePackVersion
            ) {
              throw new Error(
                `T44_CLAIM_CANDIDATE_QREL_BINDING_INVALID:${testCase.caseId}:${nodeId}`,
              );
            }
            return binding;
          },
        );
        return {
          groupId: group.groupId,
          acceptableNodeIds: group.acceptableNodeIds,
          acceptableOwnerObjectIds: [
            ...new Set(
              bindings.map(({ object }) => object.id),
            ),
          ].sort(compareCodePoints),
          ownerCovered: bindings.some(({ object }) =>
            candidateObjectIds.has(object.id)),
          groupCovered:
            group.acceptableNodeIds.some((nodeId) =>
              candidateNodeIds.has(nodeId)),
        };
      },
    );
    const bindingViolations =
      candidateBindingViolations({
        testCase,
        corpus,
      });
    return {
      caseId: testCase.caseId,
      coursePackId: testCase.coursePackId,
      multiClaim: qrel.multiClaim,
      groups,
      ownerCovered: groups.every(
        ({ ownerCovered }) => ownerCovered,
      ),
      groupCovered: groups.every(
        ({ groupCovered }) => groupCovered,
      ),
      bindingViolations,
    };
  });
  const aggregate = summarizeOracleRows(rows);
  const byCoursePack = Object.fromEntries(
    [...new Set(
      rows.map(({ coursePackId }) => coursePackId),
    )]
      .sort(compareCodePoints)
      .map((coursePackId) => [
        coursePackId,
        summarizeOracleRows(
          rows.filter((row) =>
            row.coursePackId === coursePackId),
        ),
      ]),
  );
  const gates = {
    ownerOracleCaseCoverage: {
      observed: aggregate.ownerOracleCaseCoverage,
      required:
        T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
          .ownerOracleCaseCoverageMinimum,
      passed:
        aggregate.ownerOracleCaseCoverage
        >= T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
          .ownerOracleCaseCoverageMinimum,
    },
    groupOracleCaseCoverage: {
      observed: aggregate.groupOracleCaseCoverage,
      required:
        T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
          .groupOracleCaseCoverageMinimum,
      passed:
        aggregate.groupOracleCaseCoverage
        >= T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
          .groupOracleCaseCoverageMinimum,
    },
    perCoursePackCoverage: {
      observed: byCoursePack,
      required: {
        total:
          T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
            .perCoursePackCaseTotal,
        owner:
          T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
            .perCoursePackOwnerCoverageMinimum,
        group:
          T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
            .perCoursePackGroupCoverageMinimum,
      },
      passed: Object.values(byCoursePack).length === 5
        && Object.values(byCoursePack).every(
          (summary) =>
            summary.totalCases
              === T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
                .perCoursePackCaseTotal
            && summary.ownerOracleCaseCoverage
              >= T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
                .perCoursePackOwnerCoverageMinimum
            && summary.groupOracleCaseCoverage
              >= T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
                .perCoursePackGroupCoverageMinimum,
        ),
    },
    multiClaimGroupCoverage: {
      observed: aggregate.multiClaim,
      required: {
        total:
          T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
            .multiClaimCaseTotal,
        covered:
          T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
            .multiClaimGroupCoverageMinimum,
      },
      passed:
        aggregate.multiClaim.total
          === T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
            .multiClaimCaseTotal
        && aggregate.multiClaim.groupOracleCaseCoverage
          >= T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
            .multiClaimGroupCoverageMinimum,
    },
    bindingViolations: {
      observed: aggregate.bindingViolationCount,
      required:
        T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
          .bindingViolationMaximum,
      passed:
        aggregate.bindingViolationCount
        <= T44_CLAIM_CANDIDATE_ORACLE_GATES_V1
          .bindingViolationMaximum,
    },
  };
  return {
    schemaVersion: 1 as const,
    kind: "T44_CLAIM_CANDIDATE_ORACLE" as const,
    candidateInputSha256: actualHash,
    configHash:
      T44_CLAIM_CANDIDATE_CONFIG_HASH_V1,
    aggregate,
    byCoursePack,
    rows,
    gates,
    passed: Object.values(gates).every(
      ({ passed }) => passed,
    ),
  };
}

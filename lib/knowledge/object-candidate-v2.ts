import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ChannelCandidateV2Schema,
  RRF_K_V2,
  type ChannelCandidateV2,
} from "./rank-fusion-v2";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IdSchema = z.string().regex(ID_PATTERN, "expected a stable lowercase identifier");
const HashSchema = z.string().regex(HASH_PATTERN, "expected a lowercase sha256 hash");

export const TEXT_OBJECT_CONSENSUS_CONFIG_V2 = Object.freeze({
  id: "lumi-text-object-consensus-v2",
  version: "1.0.0",
  objectLimit: 10,
  nodeLimitPerObject: 3,
  eligibleNodeKind: "TEXT",
  objectScore: "BEST_ELIGIBLE_NODE",
  objectTieBreak: "OBJECT_ID",
  nodeTieBreak: "SCORE_DESC_THEN_NODE_ID",
  commonNodeTieBreak:
    "SUM_RECIPROCAL_INNER_RANK_DESC_THEN_NODE_ID",
  existingExactNodePolicy: "PRESERVE_ONE_PER_UNSELECTED_OBJECT",
} as const);

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export const TEXT_OBJECT_CONSENSUS_CONFIG_HASH_V2 =
  sha256(TEXT_OBJECT_CONSENSUS_CONFIG_V2);

export const ObjectNodeCandidateV2Schema = z
  .object({
    nodeId: IdSchema,
    objectId: IdSchema,
    nodeKind: z.literal("TEXT"),
    representationId: IdSchema.nullable(),
    innerRank: z.number().int().min(1).max(
      TEXT_OBJECT_CONSENSUS_CONFIG_V2.nodeLimitPerObject,
    ),
    rawScore: z.number().finite(),
  })
  .strict();

export const ObjectCandidateV2Schema = z
  .object({
    objectId: IdSchema,
    coursePackId: IdSchema,
    objectRank: z.number().int().min(1).max(
      TEXT_OBJECT_CONSENSUS_CONFIG_V2.objectLimit,
    ),
    rawScore: z.number().finite(),
    nodes: z
      .array(ObjectNodeCandidateV2Schema)
      .min(1)
      .max(TEXT_OBJECT_CONSENSUS_CONFIG_V2.nodeLimitPerObject),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.nodes[0]?.rawScore !== candidate.rawScore) {
      context.addIssue({
        code: "custom",
        path: ["rawScore"],
        message: "object score must equal the strongest eligible node score",
      });
    }
    const nodeIds = candidate.nodes.map(({ nodeId }) => nodeId);
    if (new Set(nodeIds).size !== nodeIds.length) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "object node candidates must be unique",
      });
    }
    if (candidate.nodes.some(({ innerRank }, index) => innerRank !== index + 1)) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "object node ranks must be contiguous from one",
      });
    }
    if (candidate.nodes.some(({ objectId }) => objectId !== candidate.objectId)) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "object candidate nodes must preserve their canonical owner",
      });
    }
    if (candidate.nodes.some((node, index) => {
      const previous = candidate.nodes[index - 1];
      return previous
        ? (
            node.rawScore > previous.rawScore
            || (
              node.rawScore === previous.rawScore
              && compareCodePoints(node.nodeId, previous.nodeId) < 0
            )
          )
        : false;
    })) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "object candidate nodes must use score-desc then node-id order",
      });
    }
  });

export const ChannelObjectCandidatesV2Schema = z
  .array(ObjectCandidateV2Schema)
  .max(TEXT_OBJECT_CONSENSUS_CONFIG_V2.objectLimit)
  .superRefine((candidates, context) => {
    const objectIds = candidates.map(({ objectId }) => objectId);
    if (new Set(objectIds).size !== objectIds.length) {
      context.addIssue({
        code: "custom",
        message: "channel object candidates must be unique",
      });
    }
    if (candidates.some(({ objectRank }, index) => objectRank !== index + 1)) {
      context.addIssue({
        code: "custom",
        message: "channel object ranks must be contiguous from one",
      });
    }
    if (candidates.some((candidate, index) => {
      const previous = candidates[index - 1];
      return previous
        ? (
            candidate.rawScore > previous.rawScore
            || (
              candidate.rawScore === previous.rawScore
              && compareCodePoints(candidate.objectId, previous.objectId) < 0
            )
          )
        : false;
    })) {
      context.addIssue({
        code: "custom",
        message: "channel objects must use score-desc then object-id order",
      });
    }
  });

const ObjectConsensusChannelSelectionV2Schema = z
  .object({
    channel: z.enum(["LEXICAL", "TEXT_VECTOR"]),
    sourceObjectRank: z.number().int().min(1).max(20),
    sourceNodeRank: z.number().int().min(1).max(20),
    derivedRank: z.number().int().min(1).max(20),
    representationId: IdSchema.nullable(),
    rawScore: z.number().finite().nullable(),
  })
  .strict();

const ObjectConsensusCandidateTraceV2Schema = z
  .object({
    objectId: IdSchema,
    selectedNodeId: IdSchema,
    source: z.enum([
      "OBJECT_INNER_COMMON_TEXT",
      "EXISTING_EXACT_NODE",
    ]),
    channels: z
      .tuple([
        ObjectConsensusChannelSelectionV2Schema,
        ObjectConsensusChannelSelectionV2Schema,
      ])
      .superRefine((channels, context) => {
        if (
          channels[0].channel !== "LEXICAL"
          || channels[1].channel !== "TEXT_VECTOR"
        ) {
          context.addIssue({
            code: "custom",
            message: "object consensus channels must use canonical order",
          });
        }
      }),
  })
  .strict();

const ObjectConsensusObjectChannelRankV2Schema = z
  .object({
    channel: z.enum(["LEXICAL", "TEXT_VECTOR"]),
    sourceObjectRank: z.number().int().min(1).max(
      TEXT_OBJECT_CONSENSUS_CONFIG_V2.objectLimit,
    ),
    rawScore: z.number().finite(),
  })
  .strict();

const ObjectConsensusObjectRankV2Schema = z
  .object({
    objectId: IdSchema,
    rank: z.number().int().min(1).max(
      TEXT_OBJECT_CONSENSUS_CONFIG_V2.objectLimit,
    ),
    combinedScore: z.number().finite().positive(),
    commonTextNodeIds: z
      .array(IdSchema)
      .max(TEXT_OBJECT_CONSENSUS_CONFIG_V2.nodeLimitPerObject),
    selectedNodeId: IdSchema.nullable(),
    channels: z
      .tuple([
        ObjectConsensusObjectChannelRankV2Schema,
        ObjectConsensusObjectChannelRankV2Schema,
      ])
      .superRefine((channels, context) => {
        if (
          channels[0].channel !== "LEXICAL"
          || channels[1].channel !== "TEXT_VECTOR"
        ) {
          context.addIssue({
            code: "custom",
            message: "object ranking channels must use canonical order",
          });
        }
      }),
  })
  .strict()
  .superRefine((ranked, context) => {
    if (
      ranked.selectedNodeId !== null
      && !ranked.commonTextNodeIds.includes(ranked.selectedNodeId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedNodeId"],
        message: "selected node must be a real common text node",
      });
    }
    if (
      new Set(ranked.commonTextNodeIds).size
      !== ranked.commonTextNodeIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["commonTextNodeIds"],
        message: "common text node ids must be unique",
      });
    }
  });

export const ObjectConsensusTraceV2Schema = z
  .object({
    configHash: HashSchema,
    applied: z.boolean(),
    objectRanking: z
      .array(ObjectConsensusObjectRankV2Schema)
      .max(TEXT_OBJECT_CONSENSUS_CONFIG_V2.objectLimit),
    candidates: z
      .array(ObjectConsensusCandidateTraceV2Schema)
      .max(TEXT_OBJECT_CONSENSUS_CONFIG_V2.objectLimit),
  })
  .strict()
  .superRefine((trace, context) => {
    if (trace.configHash !== TEXT_OBJECT_CONSENSUS_CONFIG_HASH_V2) {
      context.addIssue({
        code: "custom",
        path: ["configHash"],
        message: "object consensus config hash mismatch",
      });
    }
    if (trace.applied !== trace.candidates.some(
      ({ source }) => source === "OBJECT_INNER_COMMON_TEXT",
    )) {
      context.addIssue({
        code: "custom",
        message: "object consensus application must require a derived common node",
      });
    }
    const objectIds = trace.candidates.map(({ objectId }) => objectId);
    const nodeIds = trace.candidates.map(({ selectedNodeId }) => selectedNodeId);
    if (
      new Set(objectIds).size !== objectIds.length
      || new Set(nodeIds).size !== nodeIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "object consensus trace candidates must be unique",
      });
    }
    const rankedObjectIds = trace.objectRanking.map(({ objectId }) => objectId);
    if (
      new Set(rankedObjectIds).size !== rankedObjectIds.length
      || trace.objectRanking.some(({ rank }, index) => rank !== index + 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectRanking"],
        message: "object consensus ranking must be unique and contiguous",
      });
    }
    if (trace.objectRanking.some((ranked, index) => {
      const previous = trace.objectRanking[index - 1];
      return previous
        ? (
            ranked.combinedScore > previous.combinedScore
            || (
              ranked.combinedScore === previous.combinedScore
              && compareCodePoints(ranked.objectId, previous.objectId) < 0
            )
          )
        : false;
    })) {
      context.addIssue({
        code: "custom",
        path: ["objectRanking"],
        message: "object consensus ranking must preserve deterministic score order",
      });
    }
    for (const candidate of trace.candidates) {
      if (candidate.source !== "OBJECT_INNER_COMMON_TEXT") continue;
      const ranked = trace.objectRanking.find(
        ({ objectId }) => objectId === candidate.objectId,
      );
      if (ranked?.selectedNodeId !== candidate.selectedNodeId) {
        context.addIssue({
          code: "custom",
          path: ["objectRanking"],
          message: "derived candidates must bind their ranked common node",
        });
      }
    }
  });

export type ObjectNodeCandidateV2 = z.infer<typeof ObjectNodeCandidateV2Schema>;
export type ObjectCandidateV2 = z.infer<typeof ObjectCandidateV2Schema>;
export type ObjectConsensusTraceV2 = z.infer<typeof ObjectConsensusTraceV2Schema>;

type SelectedCandidate = {
  objectId: string;
  selectedNodeId: string;
  source: "OBJECT_INNER_COMMON_TEXT" | "EXISTING_EXACT_NODE";
  combinedScore: number;
  commonNodeScore: number;
  channels: {
    LEXICAL: {
      sourceObjectRank: number;
      sourceNodeRank: number;
      representationId: string | null;
      rawScore: number | null;
    };
    TEXT_VECTOR: {
      sourceObjectRank: number;
      sourceNodeRank: number;
      representationId: string | null;
      rawScore: number | null;
    };
  };
};

function channelCandidateFromSelection(
  selected: SelectedCandidate,
  channel: "LEXICAL" | "TEXT_VECTOR",
  rank: number,
): ChannelCandidateV2 {
  const source = selected.channels[channel];
  return ChannelCandidateV2Schema.parse({
    candidateId: selected.selectedNodeId,
    objectId: selected.objectId,
    representationId: source.representationId,
    nodeId: selected.selectedNodeId,
    assetId: null,
    region: null,
    rank,
    rawScore: source.rawScore,
  });
}

function existingExactSelections(input: {
  lexical: readonly ChannelCandidateV2[];
  textVector: readonly ChannelCandidateV2[];
}) {
  const textByNode = new Map(
    input.textVector.map((candidate) => [candidate.candidateId, candidate]),
  );
  const byObject = new Map<string, SelectedCandidate>();
  for (const lexical of input.lexical) {
    const textVector = textByNode.get(lexical.candidateId);
    if (
      !textVector
      || lexical.objectId !== textVector.objectId
      || lexical.nodeId === null
      || lexical.nodeId !== lexical.candidateId
      || textVector.nodeId !== lexical.nodeId
    ) continue;
    const selected: SelectedCandidate = {
      objectId: lexical.objectId,
      selectedNodeId: lexical.nodeId,
      source: "EXISTING_EXACT_NODE",
      combinedScore:
        1 / (RRF_K_V2 + lexical.rank)
        + 1 / (RRF_K_V2 + textVector.rank),
      commonNodeScore: 0,
      channels: {
        LEXICAL: {
          sourceObjectRank: lexical.rank,
          sourceNodeRank: lexical.rank,
          representationId: lexical.representationId,
          rawScore: lexical.rawScore,
        },
        TEXT_VECTOR: {
          sourceObjectRank: textVector.rank,
          sourceNodeRank: textVector.rank,
          representationId: textVector.representationId,
          rawScore: textVector.rawScore,
        },
      },
    };
    const current = byObject.get(selected.objectId);
    if (
      !current
      || selected.combinedScore > current.combinedScore
      || (
        selected.combinedScore === current.combinedScore
        && compareCodePoints(
          selected.selectedNodeId,
          current.selectedNodeId,
        ) < 0
      )
    ) {
      byObject.set(selected.objectId, selected);
    }
  }
  return byObject;
}

function derivedCommonSelections(input: {
  lexical: readonly ObjectCandidateV2[];
  textVector: readonly ObjectCandidateV2[];
}) {
  const lexical = ChannelObjectCandidatesV2Schema.parse(input.lexical);
  const textVector = ChannelObjectCandidatesV2Schema.parse(input.textVector);
  const textByObject = new Map(
    textVector.map((candidate) => [candidate.objectId, candidate]),
  );
  const selected = new Map<string, SelectedCandidate>();
  for (const lexicalObject of lexical) {
    const textObject = textByObject.get(lexicalObject.objectId);
    if (!textObject) continue;
    const textNodes = new Map(
      textObject.nodes.map((node) => [node.nodeId, node]),
    );
    const commonNodes = lexicalObject.nodes.flatMap((lexicalNode) => {
      const textNode = textNodes.get(lexicalNode.nodeId);
      return textNode ? [{
        lexicalNode,
        textNode,
        score:
          1 / lexicalNode.innerRank
          + 1 / textNode.innerRank,
      }] : [];
    });
    const winner = commonNodes.sort((left, right) =>
      right.score - left.score
      || compareCodePoints(
        left.lexicalNode.nodeId,
        right.lexicalNode.nodeId,
      ))[0];
    if (!winner) continue;
    selected.set(lexicalObject.objectId, {
      objectId: lexicalObject.objectId,
      selectedNodeId: winner.lexicalNode.nodeId,
      source: "OBJECT_INNER_COMMON_TEXT",
      combinedScore:
        1 / (RRF_K_V2 + lexicalObject.objectRank)
        + 1 / (RRF_K_V2 + textObject.objectRank),
      commonNodeScore: winner.score,
      channels: {
        LEXICAL: {
          sourceObjectRank: lexicalObject.objectRank,
          sourceNodeRank: winner.lexicalNode.innerRank,
          representationId: winner.lexicalNode.representationId,
          rawScore: winner.lexicalNode.rawScore,
        },
        TEXT_VECTOR: {
          sourceObjectRank: textObject.objectRank,
          sourceNodeRank: winner.textNode.innerRank,
          representationId: winner.textNode.representationId,
          rawScore: winner.textNode.rawScore,
        },
      },
    });
  }
  return selected;
}

function rankCommonObjects(input: {
  lexical: readonly ObjectCandidateV2[];
  textVector: readonly ObjectCandidateV2[];
}) {
  const lexical = ChannelObjectCandidatesV2Schema.parse(input.lexical);
  const textVector = ChannelObjectCandidatesV2Schema.parse(input.textVector);
  const textByObject = new Map(
    textVector.map((candidate) => [candidate.objectId, candidate]),
  );
  return lexical.flatMap((lexicalObject) => {
    const textObject = textByObject.get(lexicalObject.objectId);
    if (!textObject) return [];
    const textNodeIds = new Set(
      textObject.nodes.map(({ nodeId }) => nodeId),
    );
    const commonTextNodeIds = lexicalObject.nodes
      .map(({ nodeId }) => nodeId)
      .filter((nodeId) => textNodeIds.has(nodeId))
      .sort(compareCodePoints);
    return [{
      objectId: lexicalObject.objectId,
      combinedScore:
        1 / (RRF_K_V2 + lexicalObject.objectRank)
        + 1 / (RRF_K_V2 + textObject.objectRank),
      commonTextNodeIds,
      channels: [
        {
          channel: "LEXICAL" as const,
          sourceObjectRank: lexicalObject.objectRank,
          rawScore: lexicalObject.rawScore,
        },
        {
          channel: "TEXT_VECTOR" as const,
          sourceObjectRank: textObject.objectRank,
          rawScore: textObject.rawScore,
        },
      ],
    }];
  })
    .sort((left, right) =>
      right.combinedScore - left.combinedScore
      || compareCodePoints(left.objectId, right.objectId))
    .slice(0, TEXT_OBJECT_CONSENSUS_CONFIG_V2.objectLimit)
    .map((ranked, index) => ({
      ...ranked,
      rank: index + 1,
      selectedNodeId: null as string | null,
    }));
}

export function resolveTextObjectConsensusV2(input: {
  lexicalHits: readonly ChannelCandidateV2[];
  textVectorHits: readonly ChannelCandidateV2[];
  lexicalObjects: readonly ObjectCandidateV2[];
  textVectorObjects: readonly ObjectCandidateV2[];
}): {
  applied: boolean;
  rankings: {
    LEXICAL: ChannelCandidateV2[];
    TEXT_VECTOR: ChannelCandidateV2[];
  };
  trace: ObjectConsensusTraceV2;
} {
  const lexicalHits = z.array(ChannelCandidateV2Schema).max(20).parse(
    input.lexicalHits,
  );
  const textVectorHits = z.array(ChannelCandidateV2Schema).max(20).parse(
    input.textVectorHits,
  );
  const existing = existingExactSelections({
    lexical: lexicalHits,
    textVector: textVectorHits,
  });
  const derived = derivedCommonSelections({
    lexical: input.lexicalObjects,
    textVector: input.textVectorObjects,
  });
  const objectRanking = rankCommonObjects({
    lexical: input.lexicalObjects,
    textVector: input.textVectorObjects,
  }).map((ranked) => ({
    ...ranked,
    selectedNodeId:
      derived.get(ranked.objectId)?.selectedNodeId ?? null,
  }));
  if (derived.size === 0) {
    const existingCandidates = [...existing.values()]
      .sort((left, right) =>
        right.combinedScore - left.combinedScore
        || compareCodePoints(left.selectedNodeId, right.selectedNodeId)
        || compareCodePoints(left.objectId, right.objectId))
      .slice(0, TEXT_OBJECT_CONSENSUS_CONFIG_V2.objectLimit);
    return {
      applied: false,
      rankings: {
        LEXICAL: lexicalHits,
        TEXT_VECTOR: textVectorHits,
      },
      trace: ObjectConsensusTraceV2Schema.parse({
        configHash: TEXT_OBJECT_CONSENSUS_CONFIG_HASH_V2,
        applied: false,
        objectRanking,
        candidates: existingCandidates.map((candidate) => ({
          objectId: candidate.objectId,
          selectedNodeId: candidate.selectedNodeId,
          source: candidate.source,
          channels: (["LEXICAL", "TEXT_VECTOR"] as const).map(
            (channel) => ({
              channel,
              sourceObjectRank:
                candidate.channels[channel].sourceObjectRank,
              sourceNodeRank:
                candidate.channels[channel].sourceNodeRank,
              derivedRank:
                candidate.channels[channel].sourceObjectRank,
              representationId:
                candidate.channels[channel].representationId,
              rawScore: candidate.channels[channel].rawScore,
            }),
          ),
        })),
      }),
    };
  }

  const selected = new Map(existing);
  for (const [objectId, candidate] of derived) selected.set(objectId, candidate);
  const retained = [...selected.values()]
    .sort((left, right) =>
      right.combinedScore - left.combinedScore
      || right.commonNodeScore - left.commonNodeScore
      || compareCodePoints(left.selectedNodeId, right.selectedNodeId)
      || compareCodePoints(left.objectId, right.objectId))
    .slice(0, TEXT_OBJECT_CONSENSUS_CONFIG_V2.objectLimit);

  const rankings = Object.fromEntries(
    (["LEXICAL", "TEXT_VECTOR"] as const).map((channel) => {
      const ordered = [...retained].sort((left, right) =>
        left.channels[channel].sourceObjectRank
          - right.channels[channel].sourceObjectRank
        || left.channels[channel].sourceNodeRank
          - right.channels[channel].sourceNodeRank
        || compareCodePoints(left.selectedNodeId, right.selectedNodeId));
      return [
        channel,
        ordered.map((candidate, index) =>
          channelCandidateFromSelection(candidate, channel, index + 1)),
      ];
    }),
  ) as {
    LEXICAL: ChannelCandidateV2[];
    TEXT_VECTOR: ChannelCandidateV2[];
  };
  const derivedRanks = {
    LEXICAL: new Map(rankings.LEXICAL.map(({ candidateId, rank }) => [
      candidateId,
      rank,
    ])),
    TEXT_VECTOR: new Map(rankings.TEXT_VECTOR.map(({ candidateId, rank }) => [
      candidateId,
      rank,
    ])),
  };
  const trace = ObjectConsensusTraceV2Schema.parse({
    configHash: TEXT_OBJECT_CONSENSUS_CONFIG_HASH_V2,
    applied: true,
    objectRanking,
    candidates: retained.map((candidate) => ({
      objectId: candidate.objectId,
      selectedNodeId: candidate.selectedNodeId,
      source: candidate.source,
      channels: (["LEXICAL", "TEXT_VECTOR"] as const).map((channel) => ({
        channel,
        sourceObjectRank:
          candidate.channels[channel].sourceObjectRank,
        sourceNodeRank:
          candidate.channels[channel].sourceNodeRank,
        derivedRank: derivedRanks[channel].get(
          candidate.selectedNodeId,
        )!,
        representationId:
          candidate.channels[channel].representationId,
        rawScore: candidate.channels[channel].rawScore,
      })),
    })),
  });
  return { applied: true, rankings, trace };
}

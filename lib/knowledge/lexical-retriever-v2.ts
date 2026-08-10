import { z } from "zod";

import {
  KnowledgeObjectV2Schema,
  type KnowledgeNodeV2,
  type KnowledgeObjectV2,
} from "./knowledge-object-v2";
import {
  PACK_COMPETITION_CORE_ALGORITHM_V2,
  PackCompetitionDiagnosticsV2Schema,
  type PackCompetitionDiagnosticsV2,
  type PackCompetitionWinnerV2,
} from "./pack-competition-v2";
import {
  ChannelObjectCandidatesV2Schema,
  TEXT_OBJECT_CONSENSUS_CONFIG_V2,
  type ObjectCandidateV2,
} from "./object-candidate-v2";
import {
  candidateProjectionForModeV2,
  ChannelCandidateV2Schema,
  RRF_CHANNEL_LIMIT_V2,
  type ChannelCandidateV2,
} from "./rank-fusion-v2";
import {
  RetrievalQueryV2Schema,
  type RetrievalQueryV2,
} from "./retrieval-query-v2";
import {
  RELAXED_MIN_RELEVANCE_SCORE,
  rankKnowledge,
  scoreKnowledgeLexically,
} from "./retrieve";

export const LEXICAL_PACK_COMPETITION_ALGORITHM_V2 =
  Object.freeze({
    ...PACK_COMPETITION_CORE_ALGORITHM_V2,
    id: "lumi-lexical-pack-competition-v2",
    version: "1.0.0",
    channel: "LEXICAL",
    scoreMetric: "LEXICAL_NORMALIZED_SCORE",
    rawScore: "SCORE_KNOWLEDGE_LEXICALLY",
    normalization: "CLAMP_NONNEGATIVE_DIVIDE_ROUND_6",
    normalizationDivisor: 48,
    nodeProjection:
      "BEST_QUERY_TOKEN_OVERLAP_THEN_NODE_ID",
  } as const);

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function tokens(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("zh-CN");
  const latin = normalized.match(/[a-z0-9][a-z0-9._+-]*/g) ?? [];
  const chinese = (normalized.match(/[\p{Script=Han}]+/gu) ?? []).flatMap((run) => {
    const characters = Array.from(run);
    const grams: string[] = [];
    for (let size = 2; size <= Math.min(4, characters.length); size += 1) {
      for (let index = 0; index <= characters.length - size; index += 1) {
        grams.push(characters.slice(index, index + size).join(""));
      }
    }
    return grams;
  });
  return Array.from(new Set([...latin, ...chinese]));
}

function nodeSearchText(node: KnowledgeNodeV2) {
  if (node.kind === "DOCUMENT" || node.kind === "SECTION") return node.title;
  if (node.kind === "TEXT") return node.text;
  if (node.kind === "TABLE") return node.plainText;
  if (node.kind === "REGION") return node.label;
  return "";
}

function bestNodeId(object: KnowledgeObjectV2, query: string) {
  const queryTokens = tokens(query);
  const best = [...object.nodes]
    .map((node) => {
      const searchable = nodeSearchText(node).normalize("NFKC").toLocaleLowerCase("zh-CN");
      const score = queryTokens.reduce(
        (total, token) => total + (searchable.includes(token) ? token.length : 0),
        0,
      );
      return { id: node.id, score };
    })
    .sort((left, right) =>
      right.score - left.score || compareCodePoints(left.id, right.id))[0];
  return best && best.score > 0 ? best.id : object.rootNodeId;
}

function rankedEligibleTextNodes(
  object: KnowledgeObjectV2,
  query: string,
) {
  const queryTokens = tokens(query);
  return object.nodes
    .filter((node) => node.kind === "TEXT")
    .map((node) => {
      const searchable = node.text
        .normalize("NFKC")
        .toLocaleLowerCase("zh-CN");
      const score = queryTokens.reduce(
        (total, token) =>
          total + (searchable.includes(token) ? token.length : 0),
        0,
      );
      return { nodeId: node.id, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) =>
      right.score - left.score
      || compareCodePoints(left.nodeId, right.nodeId));
}

export function retrieveLexicalObjectCandidatesV2(
  queryInput: RetrievalQueryV2,
  objectInputs: readonly KnowledgeObjectV2[],
): ObjectCandidateV2[] {
  const query = RetrievalQueryV2Schema.parse(queryInput);
  if (query.mode !== "TEXT_TO_TEXT" || query.normalizedText === null) return [];
  const objects = z.array(KnowledgeObjectV2Schema).parse(objectInputs)
    .filter((object) =>
      query.scope.sourceCoursePack === null
      || (
        object.sourceCoursePack.id === query.scope.sourceCoursePack.id
        && object.sourceCoursePack.version
          === query.scope.sourceCoursePack.version
      ));
  const ranked = objects.flatMap((object) => {
    const nodes = rankedEligibleTextNodes(object, query.normalizedText!);
    const strongest = nodes[0];
    if (!strongest) return [];
    return [{
      objectId: object.id,
      coursePackId: object.sourceCoursePack.id,
      rawScore: strongest.score,
      nodes,
    }];
  }).sort((left, right) =>
    right.rawScore - left.rawScore
    || compareCodePoints(left.objectId, right.objectId))
    .slice(0, TEXT_OBJECT_CONSENSUS_CONFIG_V2.objectLimit)
    .map((candidate, objectIndex) => ({
      objectId: candidate.objectId,
      coursePackId: candidate.coursePackId,
      objectRank: objectIndex + 1,
      rawScore: candidate.rawScore,
      nodes: candidate.nodes
        .slice(0, TEXT_OBJECT_CONSENSUS_CONFIG_V2.nodeLimitPerObject)
        .map((node, nodeIndex) => ({
          nodeId: node.nodeId,
          objectId: candidate.objectId,
          nodeKind: "TEXT" as const,
          representationId: null,
          innerRank: nodeIndex + 1,
          rawScore: node.score,
        })),
    }));
  return ChannelObjectCandidatesV2Schema.parse(ranked);
}

function normalizedLexicalScore(score: number) {
  return Math.round(
    Math.min(
      Math.max(score, 0)
        / LEXICAL_PACK_COMPETITION_ALGORITHM_V2
          .normalizationDivisor,
      1,
    ) * 1_000_000,
  ) / 1_000_000;
}

function comparePackWinner(
  left: PackCompetitionWinnerV2,
  right: PackCompetitionWinnerV2,
) {
  if (left.score !== right.score) return right.score - left.score;
  if (left.coursePackId !== right.coursePackId) {
    return compareCodePoints(left.coursePackId, right.coursePackId);
  }
  return compareCodePoints(left.objectId, right.objectId);
}

export function retrieveLexicalPackCompetitionV2(
  queryInput: RetrievalQueryV2,
  objectInputs: readonly KnowledgeObjectV2[],
): PackCompetitionDiagnosticsV2 | null {
  const query = RetrievalQueryV2Schema.parse(queryInput);
  if (query.normalizedText === null) return null;
  const objects = z.array(KnowledgeObjectV2Schema).parse(objectInputs);
  const scoreByObjectId = new Map(
    scoreKnowledgeLexically(
      query.normalizedText,
      objects.map(({ legacyItem }) => legacyItem),
    ).map(({ id, score }) => [id, score]),
  );
  const objectsByPack = new Map<
    KnowledgeObjectV2["sourceCoursePack"]["id"],
    KnowledgeObjectV2[]
  >();
  for (const object of objects) {
    const packObjects = objectsByPack.get(object.sourceCoursePack.id) ?? [];
    packObjects.push(object);
    objectsByPack.set(object.sourceCoursePack.id, packObjects);
  }
  const perPackWinners = Array.from(objectsByPack.entries())
    .map(([coursePackId, packObjects]) => {
      const winner = [...packObjects].sort((left, right) =>
        (scoreByObjectId.get(right.id) ?? 0) - (scoreByObjectId.get(left.id) ?? 0)
        || compareCodePoints(left.id, right.id))[0]!;
      return {
        coursePackId,
        objectCount: packObjects.length,
        objectId: winner.id,
        representationId: null,
        nodeId: bestNodeId(winner, query.normalizedText!),
        score: normalizedLexicalScore(scoreByObjectId.get(winner.id) ?? 0),
      };
    })
    .sort((left, right) => compareCodePoints(left.coursePackId, right.coursePackId));
  const globalWinner = [...perPackWinners].sort(comparePackWinner)[0] ?? null;
  const scopedWinner = query.scope.sourceCoursePack === null
    ? null
    : perPackWinners.find(({ coursePackId }) =>
        coursePackId === query.scope.sourceCoursePack!.id) ?? null;
  return PackCompetitionDiagnosticsV2Schema.parse({
    schemaVersion:
      LEXICAL_PACK_COMPETITION_ALGORITHM_V2.schemaVersion,
    scoreMetric:
      LEXICAL_PACK_COMPETITION_ALGORITHM_V2.scoreMetric,
    objectDeduplication:
      LEXICAL_PACK_COMPETITION_ALGORITHM_V2
        .objectDeduplication,
    packWinnerSelection:
      LEXICAL_PACK_COMPETITION_ALGORITHM_V2
        .packWinnerSelection,
    globalWinnerSelection:
      LEXICAL_PACK_COMPETITION_ALGORITHM_V2
        .globalWinnerSelection,
    sourceScope: {
      coursePackId: query.scope.sourceCoursePack?.id ?? null,
    },
    scoredRepresentationCount: objects.length,
    deduplicatedObjectCount: objects.length,
    perPackWinners,
    globalWinner,
    scopedWinner,
    globalToScopedMargin: globalWinner !== null && scopedWinner !== null
      ? globalWinner.score - scopedWinner.score
      : null,
  });
}

export function retrieveLexicalCandidatesV2(
  queryInput: RetrievalQueryV2,
  objectInputs: readonly KnowledgeObjectV2[],
  options: { minScore?: number; maxCandidates?: number } = {},
): ChannelCandidateV2[] {
  const query = RetrievalQueryV2Schema.parse(queryInput);
  if (query.normalizedText === null) return [];
  const maxCandidates = z.number().int().min(1).max(RRF_CHANNEL_LIMIT_V2)
    .parse(options.maxCandidates ?? RRF_CHANNEL_LIMIT_V2);
  const objects = z.array(KnowledgeObjectV2Schema).parse(objectInputs)
    .filter((object) =>
      query.scope.sourceCoursePack === null
      || (
        object.sourceCoursePack.id === query.scope.sourceCoursePack.id
        && object.sourceCoursePack.version === query.scope.sourceCoursePack.version
      ));
  const objectById = new Map(objects.map((object) => [object.id, object]));
  return rankKnowledge(
    query.normalizedText,
    objects.map(({ legacyItem }) => legacyItem),
    {
      minScore: options.minScore ?? RELAXED_MIN_RELEVANCE_SCORE,
      maxResults: maxCandidates,
    },
  ).flatMap((ranked, index) => {
    const object = objectById.get(ranked.id);
    if (!object) return [];
    const nodeId = bestNodeId(object, query.normalizedText);
    const projection = candidateProjectionForModeV2(query.mode);
    return [ChannelCandidateV2Schema.parse({
      candidateId: projection === "NODE" ? nodeId : object.id,
      objectId: object.id,
      representationId: null,
      nodeId,
      assetId: null,
      region: null,
      rank: index + 1,
      rawScore: ranked.score,
    })];
  });
}

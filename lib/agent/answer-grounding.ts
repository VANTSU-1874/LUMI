import type { LearningEpisode } from "@/lib/course-packs/contract";
import { rankKnowledge, type KnowledgeItem, type RankedKnowledgeItem } from "@/lib/knowledge/retrieve";

import type { RecentConversationTurn } from "./conversation-context";
import { plainKnowledgeItem } from "./model-grounding";

// Legacy V2 rollback only. V3 records citations without making retrieval a permission gate.

type Knowledge = Array<KnowledgeItem | RankedKnowledgeItem>;

const GENERIC_DEBUG_TOPICS = new Set(["COURSE_PRINCIPLES", "BOOK_DESIGN_PRINCIPLES"]);
const CHINESE_NUMBERS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

export type SequenceRequirement = { step: number; actionId: string; actionText: string };

const DEFAULT_MAX_KNOWLEDGE_SOURCES = 2;

export function minimumSufficientSourceIds(
  decision: { sourceIds: string[] },
  knowledge: Knowledge,
  studentQuestion: string,
  maxKnowledgeSources = DEFAULT_MAX_KNOWLEDGE_SOURCES,
) {
  const knowledgeIds = new Set(knowledge.map(({ id }) => id));
  const selectedKnowledge = knowledge.filter(({ id }) => decision.sourceIds.includes(id));
  if (selectedKnowledge.length <= maxKnowledgeSources) return decision.sourceIds;

  const rankedIds = rankKnowledge(
    studentQuestion,
    selectedKnowledge.map(plainKnowledgeItem),
  ).map(({ id }) => id);
  const preferredIds = [
    ...rankedIds,
    ...selectedKnowledge.map(({ id }) => id).filter((id) => !rankedIds.includes(id)),
  ].slice(0, maxKnowledgeSources);
  const preferred = new Set(preferredIds);

  return decision.sourceIds.filter((id) => !knowledgeIds.has(id) || preferred.has(id));
}

export function genericDebugSourceIds(
  episode: LearningEpisode,
  knowledge: Knowledge,
  sourceIds: readonly string[],
) {
  if (episode !== "DEBUG") return [];
  const selected = knowledge.filter(({ id }) => sourceIds.includes(id));
  if (!selected.some(({ topic }) => !GENERIC_DEBUG_TOPICS.has(topic))) return [];
  return selected.filter(({ topic }) => GENERIC_DEBUG_TOPICS.has(topic)).map(({ id }) => id);
}

function requestedStep(message: string) {
  const match = /第([一二三四五六七八九十]|\d{1,2})步/.exec(message.normalize("NFKC"));
  if (!match) return null;
  const parsed = /^\d+$/.test(match[1]) ? Number(match[1]) : CHINESE_NUMBERS[match[1]];
  return parsed && parsed <= 10 ? parsed : null;
}

export function sequenceRequirement(
  message: string,
  recentTurns: readonly RecentConversationTurn[],
  knowledge: Knowledge,
): SequenceRequirement | null {
  const step = requestedStep(message);
  const previousQuestion = recentTurns.at(-1)?.studentMessage.normalize("NFKC").toLowerCase();
  if (!step || !previousQuestion) return null;
  const candidates = knowledge.filter(({ actions }) => actions.length >= step);
  const item = candidates.find(({ tags }) => tags.some((tag) => previousQuestion.includes(tag.normalize("NFKC").toLowerCase())))
    ?? candidates[0];
  const action = item?.actions[step - 1];
  return action ? { step, actionId: action.id, actionText: action.text } : null;
}

function semanticTokens(value: string) {
  const normalized = value.normalize("NFKC").toLowerCase();
  const latin = normalized.match(/[a-z][a-z0-9._+-]{1,}/g) ?? [];
  const chinese = (normalized.match(/[\p{Script=Han}]+/gu) ?? []).flatMap((run) => {
    const characters = Array.from(run);
    return characters.slice(0, -1).map((character, index) => character + characters[index + 1]);
  });
  return new Set([...latin, ...chinese]);
}

export function answerSupportsSequence(answer: string, requirement: SequenceRequirement) {
  if (requirement.actionId === "td-build-audio-minimal-chain") {
    return /(Analyze|RMS|分析)/i.test(answer) && /(声音|数值|强度)/.test(answer);
  }
  const actual = semanticTokens(answer);
  const expected = semanticTokens(requirement.actionText);
  let matches = 0;
  for (const token of expected) {
    if (actual.has(token)) matches += 1;
    if (matches >= 2) return true;
  }
  return false;
}

export function validateAnswerGrounding(
  decision: { episode: LearningEpisode; sourceIds: string[]; title: string; message: string },
  knowledge: Knowledge,
  requirement: SequenceRequirement | null,
) {
  const genericSources = genericDebugSourceIds(decision.episode, knowledge, decision.sourceIds);
  if (genericSources.length > 0) {
    throw new Error(`MODEL_DEBUG_SOURCE_TOO_GENERIC:${genericSources.join(",")}`);
  }
  if (requirement && !answerSupportsSequence(`${decision.title}\n${decision.message}`, requirement)) {
    throw new Error(`MODEL_WRONG_SEQUENCE_STEP:${requirement.step}:${requirement.actionText}`);
  }
}

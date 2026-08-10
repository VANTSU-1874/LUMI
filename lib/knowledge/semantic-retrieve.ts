import { createHash } from "node:crypto";

import {
  EmbeddingServiceError,
  type EmbeddingProvider,
} from "@/lib/ai/embeddings";
import {
  redactSensitiveText,
  studentNumberPolicyFromEnvironment,
} from "@/lib/security/redaction";

import {
  RELAXED_MIN_RELEVANCE_SCORE,
  rankKnowledge,
  scoreKnowledgeLexically,
  type KnowledgeItem,
  type RankedKnowledgeItem,
} from "./retrieve";

const MAX_RESULTS = 5;
const MAX_CACHED_INDEXES = 12;
const MIN_SEMANTIC_SIMILARITY = 0.2;
const MIN_SEMANTIC_LIFT = 0.025;
const MIN_CALIBRATED_SEMANTIC_SCORE = 0.12;
const MIN_COMBINED_SCORE = 0.24;
const SEMANTIC_WEIGHT = 0.72;
const LEXICAL_WEIGHT = 1 - SEMANTIC_WEIGHT;

type VectorIndexEntry = {
  id: string;
  vector: number[];
};

type VectorIndex = {
  dimensions: number;
  entries: VectorIndexEntry[];
};

export type HybridKnowledgeRetrieval = {
  items: RankedKnowledgeItem[];
  strategy: "HYBRID" | "LEXICAL_FALLBACK";
  semanticStatus: "USED" | "UNAVAILABLE" | "FAILED";
  errorCode: string | null;
};

const indexCache = new Map<string, Promise<VectorIndex>>();

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function median(values: readonly number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function embeddingText(item: KnowledgeItem) {
  return [
    item.title,
    item.tags.join(" "),
    item.content,
    ...item.facts.map(({ text }) => text),
    ...item.actions.map(({ text }) => text),
    item.source.scope,
  ].join("\n");
}

function corpusCacheKey(
  provider: EmbeddingProvider,
  items: readonly KnowledgeItem[],
  documents: readonly string[],
) {
  const digest = createHash("sha256");
  digest.update(provider.cacheKey, "utf8");
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    digest.update("\0", "utf8");
    digest.update(item.id, "utf8");
    digest.update("\0", "utf8");
    digest.update(documents[index]!, "utf8");
  }
  return digest.digest("hex");
}

function validateIndex(items: readonly KnowledgeItem[], vectors: number[][]): VectorIndex {
  if (vectors.length !== items.length || vectors.length === 0) {
    throw new EmbeddingServiceError("INVALID_RESPONSE");
  }
  const dimensions = vectors[0]?.length ?? 0;
  if (
    dimensions === 0
    || vectors.some((vector) => vector.length !== dimensions)
    || vectors.some((vector) => vector.some((value) => !Number.isFinite(value)))
    || vectors.some((vector) => vector.every((value) => value === 0))
  ) {
    throw new EmbeddingServiceError("INVALID_RESPONSE");
  }
  return {
    dimensions,
    entries: items.map((item, index) => ({ id: item.id, vector: [...vectors[index]!] })),
  };
}

function indexFor(
  items: readonly KnowledgeItem[],
  documents: readonly string[],
  provider: EmbeddingProvider,
) {
  const key = corpusCacheKey(provider, items, documents);
  const existing = indexCache.get(key);
  if (existing) return existing;
  while (indexCache.size >= MAX_CACHED_INDEXES) {
    const oldest = indexCache.keys().next().value as string | undefined;
    if (!oldest) break;
    indexCache.delete(oldest);
  }
  const pending = provider
    .embed(documents)
    .then((vectors) => validateIndex(items, vectors));
  indexCache.set(key, pending);
  void pending.catch(() => {
    if (indexCache.get(key) === pending) indexCache.delete(key);
  });
  return pending;
}

function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  if (left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return null;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function fallback(
  query: string,
  items: readonly KnowledgeItem[],
  semanticStatus: HybridKnowledgeRetrieval["semanticStatus"],
  errorCode: string | null,
): HybridKnowledgeRetrieval {
  return {
    items: rankKnowledge(query, items, { minScore: RELAXED_MIN_RELEVANCE_SCORE }),
    strategy: "LEXICAL_FALLBACK",
    semanticStatus,
    errorCode,
  };
}

export function clearKnowledgeVectorIndexCache() {
  indexCache.clear();
}

export async function retrieveKnowledgeHybrid(
  query: string,
  items: readonly KnowledgeItem[],
  provider?: EmbeddingProvider | null,
  options: { signal?: AbortSignal } = {},
): Promise<HybridKnowledgeRetrieval> {
  const normalizedQuery = query.normalize("NFKC").trim();
  if (!normalizedQuery || items.length === 0) {
    return {
      items: [],
      strategy: provider ? "HYBRID" : "LEXICAL_FALLBACK",
      semanticStatus: provider ? "USED" : "UNAVAILABLE",
      errorCode: null,
    };
  }
  if (!provider) return fallback(normalizedQuery, items, "UNAVAILABLE", null);

  try {
    const studentNumber = studentNumberPolicyFromEnvironment();
    const protect = (value: string) => redactSensitiveText(value, { studentNumber });
    const documents = items.map((item) => protect(embeddingText(item)));
    const protectedQuery = protect(normalizedQuery);
    const [index, queryVectors] = await Promise.all([
      indexFor(items, documents, provider),
      provider.embed([protectedQuery], { signal: options.signal }),
    ]);
    options.signal?.throwIfAborted();
    const queryVector = queryVectors[0];
    if (
      !queryVector
      || queryVector.length !== index.dimensions
      || queryVector.some((value) => !Number.isFinite(value))
      || queryVector.every((value) => value === 0)
    ) {
      throw new EmbeddingServiceError("INVALID_RESPONSE");
    }
    const lexicalById = new Map(
      scoreKnowledgeLexically(normalizedQuery, items).map((item) => [item.id, item]),
    );
    const semanticById = new Map(index.entries.map(({ id, vector }) => [
      id,
      cosineSimilarity(queryVector, vector),
    ]));
    const semanticBaseline = median(
      Array.from(semanticById.values()).filter((value): value is number =>
        value !== null && Number.isFinite(value)),
    );
    const ranked = items.flatMap((item) => {
      const lexical = lexicalById.get(item.id);
      const lexicalScore = lexical?.score ?? 0;
      const semanticScore = semanticById.get(item.id) ?? null;
      if (semanticScore === null || !Number.isFinite(semanticScore)) return [];
      const lexicalConfidence = Math.min(lexicalScore / 48, 1);
      const boundedSemanticSimilarity = Math.max(-1, Math.min(1, semanticScore));
      const semanticLift = Math.max(0, boundedSemanticSimilarity - semanticBaseline);
      const semanticHeadroom = Math.max(0.05, 1 - semanticBaseline);
      const calibratedSemanticScore = boundedSemanticSimilarity >= MIN_SEMANTIC_SIMILARITY
        && semanticLift >= MIN_SEMANTIC_LIFT
        ? Math.max(0, Math.min(1, semanticLift / semanticHeadroom))
        : 0;
      const combinedScore = calibratedSemanticScore * SEMANTIC_WEIGHT
        + lexicalConfidence * LEXICAL_WEIGHT;
      const hasLexicalMatch = lexicalScore >= RELAXED_MIN_RELEVANCE_SCORE;
      const hasSemanticMatch = calibratedSemanticScore >= MIN_CALIBRATED_SEMANTIC_SCORE;
      if (!hasLexicalMatch && !hasSemanticMatch && combinedScore < MIN_COMBINED_SCORE) return [];
      const method = hasLexicalMatch && hasSemanticMatch
        ? "HYBRID" as const
        : hasSemanticMatch
          ? "SEMANTIC" as const
          : "LEXICAL" as const;
      return [{
        ...item,
        score: round(combinedScore * 100),
        matchedTokens: lexical?.matchedTokens ?? [],
        retrieval: {
          method,
          confidence: round(combinedScore),
          lexicalScore,
          semanticScore: round(calibratedSemanticScore),
        },
      }];
    }).sort((left, right) =>
      right.score - left.score || compareCodePoints(left.id, right.id));
    return {
      items: ranked.slice(0, MAX_RESULTS),
      strategy: "HYBRID",
      semanticStatus: "USED",
      errorCode: null,
    };
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }
    return fallback(
      normalizedQuery,
      items,
      "FAILED",
      error instanceof EmbeddingServiceError ? error.code : "EMBEDDING_UNAVAILABLE",
    );
  }
}

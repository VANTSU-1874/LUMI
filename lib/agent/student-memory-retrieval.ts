import {
  EmbeddingServiceError,
  type EmbeddingProvider,
} from "@/lib/ai/embeddings";
import type { DatabaseConnection } from "@/lib/db/client";
import type { StudentMemoryPublic } from "@/lib/domain/student-memory";
import {
  redactSensitiveText,
  studentNumberPolicyFromEnvironment,
} from "@/lib/security/redaction";

import type { StudentMemoryWriteCandidate } from "./student-memory-candidates";

const MAX_RECALLED_MEMORIES = 4;
const MEMORY_RECENCY_HALF_LIFE_SECONDS = 30 * 24 * 60 * 60;
const MEMORY_RECENCY_FLOOR = 0.8;

type MemoryRow = Pick<StudentMemoryPublic, "id" | "kind" | "content" | "salience"> & {
  createdAt: number;
  lastUsedAt: number | null;
  embeddingJson: string | null;
  embeddingCacheKey: string | null;
};

export type RecalledStudentMemory = {
  id: string;
  alias: string;
  kind: StudentMemoryPublic["kind"];
  content: string;
  salience: number;
  recordedAt: string;
  retrieval: {
    method: "SEMANTIC" | "HYBRID" | "LEXICAL";
    confidence: number;
  };
};

export type StudentMemoryRecallResult = {
  items: RecalledStudentMemory[];
  semanticStatus: "USED" | "UNAVAILABLE" | "FAILED";
  errorCode: string | null;
};

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function lexicalTokens(value: string) {
  const text = normalized(value);
  const tokens = new Set<string>();
  for (const token of text.match(/[a-z0-9][a-z0-9._+-]*/g) ?? []) {
    if (token.length >= 2) tokens.add(token);
  }
  for (const segment of text.match(/[\p{Script=Han}]+/gu) ?? []) {
    for (let index = 0; index < segment.length - 1; index += 1) {
      tokens.add(segment.slice(index, index + 2));
    }
  }
  return tokens;
}

function lexicalScore(query: string, content: string) {
  const queryText = normalized(query);
  const contentText = normalized(content);
  const queryTokens = lexicalTokens(queryText);
  const contentTokens = lexicalTokens(contentText);
  let overlap = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) overlap += token.length > 2 ? 3 : 2;
  }
  if (
    queryText.length >= 4
    && contentText.length >= 4
    && (queryText.includes(contentText) || contentText.includes(queryText))
  ) overlap += 8;
  return overlap;
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

function validVectors(vectors: number[][], expected: number) {
  const dimensions = vectors[0]?.length ?? 0;
  return vectors.length === expected
    && dimensions > 0
    && vectors.every((vector) => vector.length === dimensions)
    && vectors.every((vector) => vector.every(Number.isFinite))
    && vectors.every((vector) => vector.some((value) => value !== 0));
}

function parseStoredVector(row: MemoryRow, cacheKey: string) {
  if (row.embeddingCacheKey !== cacheKey || !row.embeddingJson) return null;
  try {
    const value = JSON.parse(row.embeddingJson) as unknown;
    if (
      !Array.isArray(value)
      || value.length < 1
      || value.length > 16_384
      || value.some((item) => typeof item !== "number" || !Number.isFinite(item))
      || value.every((item) => item === 0)
    ) return null;
    return value as number[];
  } catch {
    return null;
  }
}

export async function prepareStudentMemoryCandidateEmbeddings(
  candidates: readonly StudentMemoryWriteCandidate[],
  embeddingProvider: EmbeddingProvider | null | undefined,
  options: {
    environment?: Record<string, string | undefined>;
    signal?: AbortSignal;
  } = {},
): Promise<StudentMemoryWriteCandidate[]> {
  const studentNumber = studentNumberPolicyFromEnvironment(options.environment ?? process.env);
  const protectedCandidates = candidates.map((candidate) => ({
    kind: candidate.kind,
    content: redactSensitiveText(candidate.content, { studentNumber }).trim(),
    salience: candidate.salience,
  })).filter(({ content }) => content.length > 0);
  if (!embeddingProvider || protectedCandidates.length === 0) return protectedCandidates;
  try {
    const vectors = await embeddingProvider.embed(
      protectedCandidates.map(({ content }) => content),
      { signal: options.signal },
    );
    options.signal?.throwIfAborted();
    if (!validVectors(vectors, protectedCandidates.length)) {
      throw new EmbeddingServiceError("INVALID_RESPONSE");
    }
    return protectedCandidates.map((candidate, index) => ({
      ...candidate,
      embedding: {
        cacheKey: embeddingProvider.cacheKey,
        vector: vectors[index]!,
      },
    }));
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return protectedCandidates;
  }
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

function recencyWeight(row: MemoryRow, nowSeconds: number) {
  const lastRelevantAt = Math.max(row.createdAt, row.lastUsedAt ?? row.createdAt);
  const ageSeconds = Math.max(0, nowSeconds - lastRelevantAt);
  const decay = Math.pow(0.5, ageSeconds / MEMORY_RECENCY_HALF_LIFE_SECONDS);
  return MEMORY_RECENCY_FLOOR + (1 - MEMORY_RECENCY_FLOOR) * decay;
}

function rankLexically(
  query: string,
  rows: readonly MemoryRow[],
  nowSeconds: number,
) {
  return rows.flatMap((row) => {
    const lexical = lexicalScore(query, row.content);
    if (lexical <= 0) return [];
    const relevance = Math.min(1, lexical / 24) * 0.9 + (row.salience / 10) * 0.1;
    const confidence = relevance * recencyWeight(row, nowSeconds);
    return [{ row, confidence, method: "LEXICAL" as const }];
  }).sort((left, right) =>
    right.confidence - left.confidence
    || right.row.createdAt - left.row.createdAt
    || left.row.id.localeCompare(right.row.id));
}

function toResult(
  ranked: Array<{ row: MemoryRow; confidence: number; method: RecalledStudentMemory["retrieval"]["method"] }>,
  semanticStatus: StudentMemoryRecallResult["semanticStatus"],
  errorCode: string | null,
): StudentMemoryRecallResult {
  return {
    items: ranked.slice(0, MAX_RECALLED_MEMORIES).map(({ row, confidence, method }, index) => ({
      id: row.id,
      alias: `M${index + 1}`,
      kind: row.kind,
      content: row.content,
      salience: row.salience,
      recordedAt: new Date(row.createdAt * 1_000).toISOString(),
      retrieval: { method, confidence: round(confidence) },
    })),
    semanticStatus,
    errorCode,
  };
}

export async function recallStudentMemories(
  connection: DatabaseConnection,
  input: {
    studentId: string;
    classId: string;
    query: string;
    embeddingProvider?: EmbeddingProvider | null;
    environment?: Record<string, string | undefined>;
    signal?: AbortSignal;
    now?: Date;
  },
): Promise<StudentMemoryRecallResult> {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new TypeError("student memory recall timestamp is invalid");
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const studentNumber = studentNumberPolicyFromEnvironment(input.environment ?? process.env);
  const protect = (value: string) => redactSensitiveText(value, { studentNumber }).trim();
  const query = protect(input.query);
  if (!query) return { items: [], semanticStatus: input.embeddingProvider ? "USED" : "UNAVAILABLE", errorCode: null };
  const rows = (connection.sqlite.prepare(`
    SELECT id,kind,content,salience,created_at createdAt,last_used_at lastUsedAt,
      embedding_json embeddingJson,embedding_cache_key embeddingCacheKey
    FROM agent_student_memory
    WHERE student_id=? AND class_id=?
      AND NOT EXISTS (
        SELECT 1
        FROM agent_student_memory_disputes dispute
        WHERE
          dispute.memory_id=agent_student_memory.id
          AND dispute.student_id=?
          AND dispute.class_id=?
      )
    ORDER BY salience DESC,coalesce(last_used_at,created_at) DESC,created_at DESC,id DESC
  `).all(
    input.studentId,
    input.classId,
    input.studentId,
    input.classId,
  ) as MemoryRow[]).map((row) => ({
    ...row,
    content: protect(row.content),
  }));
  if (rows.length === 0) {
    return { items: [], semanticStatus: input.embeddingProvider ? "USED" : "UNAVAILABLE", errorCode: null };
  }
  const embeddingProvider = input.embeddingProvider;
  if (!embeddingProvider) {
    return toResult(rankLexically(query, rows, nowSeconds), "UNAVAILABLE", null);
  }
  const storedVectors = rows.map((row) => parseStoredVector(row, embeddingProvider.cacheKey));
  if (storedVectors.every((vector) => vector === null)) {
    return toResult(rankLexically(query, rows, nowSeconds), "UNAVAILABLE", null);
  }

  try {
    const vectors = await embeddingProvider.embed([query], {
      signal: input.signal,
    });
    input.signal?.throwIfAborted();
    if (!validVectors(vectors, 1)) throw new EmbeddingServiceError("INVALID_RESPONSE");
    const queryVector = vectors[0]!;
    const similarities = storedVectors.map((vector) => vector ? cosineSimilarity(vector, queryVector) : null);
    const semanticValues = similarities.filter((value): value is number =>
      value !== null && Number.isFinite(value));
    const semanticBaseline = median(semanticValues);
    const ranked = rows.flatMap((row, index) => {
      const lexical = lexicalScore(query, row.content);
      const semantic = similarities[index];
      const lexicalConfidence = Math.min(1, lexical / 24);
      let semanticConfidence = 0;
      if (typeof semantic === "number" && Number.isFinite(semantic)) {
        const boundedSemantic = Math.max(-1, Math.min(1, semantic));
        const semanticLift = Math.max(0, boundedSemantic - semanticBaseline);
        semanticConfidence = semanticValues.length === 1
          ? boundedSemantic >= 0.35
            ? Math.min(1, (boundedSemantic - 0.35) / 0.65)
            : 0
          : boundedSemantic >= 0.3 && semanticLift >= 0.03
            ? Math.min(1, semanticLift / Math.max(0.05, 1 - semanticBaseline))
            : 0;
      }
      if (semanticConfidence < 0.08 && lexical === 0) return [];
      const salienceBoost = (row.salience / 10) * 0.04;
      const relevance = semanticConfidence * 0.78 + lexicalConfidence * 0.17 + salienceBoost;
      const confidence = relevance * recencyWeight(row, nowSeconds);
      const method = lexical > 0 && semanticConfidence >= 0.08
        ? "HYBRID" as const
        : semanticConfidence >= 0.08
          ? "SEMANTIC" as const
          : "LEXICAL" as const;
      return [{ row, confidence, method }];
    }).sort((left, right) =>
      right.confidence - left.confidence
      || right.row.createdAt - left.row.createdAt
      || left.row.id.localeCompare(right.row.id));
    return toResult(ranked, "USED", null);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    return toResult(
      rankLexically(query, rows, nowSeconds),
      "FAILED",
      error instanceof EmbeddingServiceError ? error.code : "EMBEDDING_UNAVAILABLE",
    );
  }
}

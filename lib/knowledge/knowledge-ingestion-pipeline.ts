import path from "node:path";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

import {
  knowledgePlacementForTopic,
  loadCoursePackKnowledgeItems,
  loadStoredCoursePackKnowledge,
  retrieveCoursePackKnowledge,
  writeCoursePackKnowledge,
} from "./course-pack-store";
import {
  deactivateKnowledgeV2Storage,
  ingestPreparedKnowledgeV2,
  prepareKnowledgeV2Ingestion,
  type PreparedKnowledgeV2Ingestion,
} from "./knowledge-v2-store";
import { stableJsonV2 } from "./knowledge-object-v2";
import type { KnowledgeItem } from "./retrieve";

const REQUIRED_COURSE_PACKS = [
  "general-design@1",
  "digital-interaction@1",
  "book-design@1",
  "layout-design@1",
  "brand-vi-design@1",
] as const;

type LegacyKnowledgeIngestion = {
  mode: "LEGACY";
  legacyItems: KnowledgeItem[];
};

type V2KnowledgeIngestion = {
  mode: "V2";
  preparedV2: PreparedKnowledgeV2Ingestion;
  legacyItems: KnowledgeItem[];
};

export type PreparedKnowledgeIngestion =
  | LegacyKnowledgeIngestion
  | V2KnowledgeIngestion;

type LegacyKnowledgeIngestionResult = ReturnType<typeof writeCoursePackKnowledge>;
type V2KnowledgeIngestionResult = ReturnType<typeof ingestPreparedKnowledgeV2>;

export type KnowledgeIngestionResult =
  | LegacyKnowledgeIngestionResult
  | V2KnowledgeIngestionResult;

function expectedCoursePackCounts(items: readonly KnowledgeItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const placement = knowledgePlacementForTopic(item.topic);
    const key = `${placement.coursePackId}@${placement.coursePackVersion}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function assertKnowledgeResultMatchesPrepared(
  result: KnowledgeIngestionResult,
  prepared: PreparedKnowledgeIngestion,
) {
  const expected = expectedCoursePackCounts(prepared.legacyItems);
  if (result.total !== prepared.legacyItems.length) {
    throw new Error(
      `COURSE_PACK_KNOWLEDGE_TOTAL_DRIFT:${result.total}:${prepared.legacyItems.length}`,
    );
  }
  if (stableJsonV2(result.byCoursePack) !== stableJsonV2(expected)) {
    throw new Error("COURSE_PACK_KNOWLEDGE_COUNTS_DRIFT");
  }
  for (const key of REQUIRED_COURSE_PACKS) {
    if ((expected[key] ?? 0) < 1) {
      throw new Error(`COURSE_PACK_KNOWLEDGE_SOURCE_INCOMPLETE:${key}`);
    }
  }
  if (prepared.mode === "V2" && !("v2" in result)) {
    throw new Error("KNOWLEDGE_V2_RESULT_MISSING");
  }
  if (prepared.mode === "LEGACY" && "v2" in result) {
    throw new Error("KNOWLEDGE_V2_RESULT_UNEXPECTED");
  }
}

function resultAudit(result: KnowledgeIngestionResult) {
  if (!("v2" in result)) {
    return {
      mode: "LEGACY" as const,
      total: result.total,
      byCoursePack: result.byCoursePack,
    };
  }
  const { preActivation, ...storage } = result.v2;
  if (preActivation.corpusHash !== storage.corpusHash) {
    throw new Error("KNOWLEDGE_V2_PREACTIVATION_CORPUS_DRIFT");
  }
  return {
    mode: "V2" as const,
    total: result.total,
    byCoursePack: result.byCoursePack,
    storage,
  };
}

function assertSameKnowledgeResult(
  left: KnowledgeIngestionResult,
  right: KnowledgeIngestionResult,
) {
  if (stableJsonV2(resultAudit(left)) !== stableJsonV2(resultAudit(right))) {
    throw new Error("KNOWLEDGE_INGESTION_NOT_IDEMPOTENT");
  }
}

function assertLegacyFallback(
  connection: DatabaseConnection,
  prepared: PreparedKnowledgeIngestion,
) {
  const expectedByPack = new Map<string, KnowledgeItem[]>();
  for (const item of prepared.legacyItems) {
    const placement = knowledgePlacementForTopic(item.topic);
    const key = `${placement.coursePackId}@${placement.coursePackVersion}`;
    const items = expectedByPack.get(key) ?? [];
    items.push(item);
    expectedByPack.set(key, items);
  }

  const counts: Record<string, number> = {};
  for (const key of REQUIRED_COURSE_PACKS) {
    const [coursePackId, coursePackVersion] = key.split("@") as [string, string];
    const expected = expectedByPack.get(key) ?? [];
    const stored = loadStoredCoursePackKnowledge(
      connection,
      coursePackId,
      coursePackVersion,
    );
    const storedIds = new Set(stored.map((item) => item.id));
    const missing = expected.find((item) => !storedIds.has(item.id));
    if (missing) {
      throw new Error(`KNOWLEDGE_LEGACY_FALLBACK_ITEM_MISSING:${missing.id}`);
    }
    const probe = expected[0];
    if (
      !probe
      || retrieveCoursePackKnowledge(
        connection,
        coursePackId,
        coursePackVersion,
        probe.title,
      ).length < 1
    ) {
      throw new Error(`KNOWLEDGE_LEGACY_FALLBACK_RETRIEVAL_EMPTY:${key}`);
    }
    counts[key] = stored.length;
  }
  return counts;
}

export async function prepareKnowledgeIngestion(options: {
  knowledgeObjectV2Enabled: boolean;
  workspaceRoot?: string;
}): Promise<PreparedKnowledgeIngestion> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  if (options.knowledgeObjectV2Enabled) {
    const preparedV2 = await prepareKnowledgeV2Ingestion(workspaceRoot);
    return {
      mode: "V2",
      preparedV2,
      legacyItems: preparedV2.legacyItems,
    };
  }
  return {
    mode: "LEGACY",
    legacyItems: await loadCoursePackKnowledgeItems(
      path.join(workspaceRoot, "data", "knowledge"),
    ),
  };
}

export function applyPreparedKnowledgeIngestion(
  databasePath: string,
  prepared: PreparedKnowledgeIngestion,
): KnowledgeIngestionResult {
  const resolvedDatabasePath = path.resolve(databasePath);
  runMigrations(resolvedDatabasePath);
  const connection = createDb(resolvedDatabasePath);
  try {
    const result = prepared.mode === "V2"
      ? ingestPreparedKnowledgeV2(connection, prepared.preparedV2)
      : connection.sqlite.transaction(() =>
        writeCoursePackKnowledge(connection, prepared.legacyItems)).immediate();
    assertKnowledgeResultMatchesPrepared(result, prepared);
    return result;
  } finally {
    connection.sqlite.close();
  }
}

export function rehearsePreparedKnowledgeIngestion(
  databasePath: string,
  prepared: PreparedKnowledgeIngestion,
) {
  const first = applyPreparedKnowledgeIngestion(databasePath, prepared);
  const second = applyPreparedKnowledgeIngestion(databasePath, prepared);
  assertSameKnowledgeResult(first, second);

  const connection = createDb(path.resolve(databasePath));
  let fallbackByCoursePack: Record<string, number> | null = null;
  try {
    if (prepared.mode === "V2") {
      const expectedRollback = {};
      try {
        connection.sqlite.transaction(() => {
          deactivateKnowledgeV2Storage(connection);
          const activeCorpusCount = (
            connection.sqlite.prepare(
              "SELECT count(*) count FROM knowledge_active_corpus_v2",
            ).get() as { count: number }
          ).count;
          const activeIndexCount = (
            connection.sqlite.prepare(
              "SELECT count(*) count FROM knowledge_active_index_bundle_v2",
            ).get() as { count: number }
          ).count;
          if (activeCorpusCount !== 0 || activeIndexCount !== 0) {
            throw new Error("KNOWLEDGE_V2_DEACTIVATION_FAILED");
          }
          fallbackByCoursePack = assertLegacyFallback(connection, prepared);
          throw expectedRollback;
        }).immediate();
      } catch (error) {
        if (error !== expectedRollback) throw error;
      }
    } else {
      fallbackByCoursePack = assertLegacyFallback(connection, prepared);
    }
  } finally {
    connection.sqlite.close();
  }
  if (!fallbackByCoursePack) {
    throw new Error("KNOWLEDGE_LEGACY_FALLBACK_NOT_VERIFIED");
  }

  const final = prepared.mode === "V2"
    ? applyPreparedKnowledgeIngestion(databasePath, prepared)
    : second;
  assertSameKnowledgeResult(second, final);
  return {
    mode: prepared.mode,
    idempotent: true,
    fallbackVerified: true,
    fallbackByCoursePack,
    first: resultAudit(first),
    second: resultAudit(second),
    final: resultAudit(final),
  } as const;
}

import { createHash } from "node:crypto";
import path from "node:path";

import type { DatabaseConnection } from "@/lib/db/client";
import { getCoursePack } from "@/lib/course-packs/registry";
import {
  loadKnowledgeDirectory,
  rankKnowledge,
  type KnowledgeItem,
  type KnowledgeTopic,
  type RankedKnowledgeItem,
} from "./retrieve";

type KnowledgePlacement = {
  coursePackId: "general-design" | "digital-interaction" | "book-design";
  coursePackVersion: "1";
  namespace: string;
};

const TOPIC_PLACEMENT: Record<KnowledgeTopic, KnowledgePlacement> = {
  DESIGN_FOUNDATIONS: {
    coursePackId: "general-design",
    coursePackVersion: "1",
    namespace: "design-foundations",
  },
  COURSE_PRINCIPLES: {
    coursePackId: "digital-interaction",
    coursePackVersion: "1",
    namespace: "interaction-principles",
  },
  DIGISHOW_SIGNALS: {
    coursePackId: "digital-interaction",
    coursePackVersion: "1",
    namespace: "digishow-signals",
  },
  TOUCHDESIGNER_FOUNDATIONS: {
    coursePackId: "digital-interaction",
    coursePackVersion: "1",
    namespace: "touchdesigner-foundations",
  },
  OSC_TROUBLESHOOTING: {
    coursePackId: "digital-interaction",
    coursePackVersion: "1",
    namespace: "osc-troubleshooting",
  },
  BOOK_DESIGN_PRINCIPLES: {
    coursePackId: "book-design",
    coursePackVersion: "1",
    namespace: "book-design-principles",
  },
  INFORMATION_HIERARCHY: {
    coursePackId: "book-design",
    coursePackVersion: "1",
    namespace: "information-hierarchy",
  },
  LAYOUT_EVIDENCE: {
    coursePackId: "book-design",
    coursePackVersion: "1",
    namespace: "layout-evidence",
  },
};

type StoredKnowledgeRow = {
  id: string;
  source: string;
  title: string;
  tags: string;
  content: string;
  coursePackId: string;
  coursePackVersion: string;
  namespace: string;
  authority: KnowledgeItem["source"]["authority"];
  contentHash: string;
  verifiedDate: string;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalKnowledge(item: KnowledgeItem) {
  return stableJson(item);
}

function contentHash(item: KnowledgeItem) {
  return createHash("sha256").update(canonicalKnowledge(item), "utf8").digest("hex");
}

function sourceJson(item: KnowledgeItem) {
  return stableJson(item.source);
}

export async function ingestCoursePackKnowledge(
  connection: DatabaseConnection,
  directory = path.join(process.cwd(), "data", "knowledge"),
) {
  const items = await loadKnowledgeDirectory(directory);
  const incomingIds = new Set(items.map(({ id }) => id));
  const upsert = connection.sqlite.prepare(`
    INSERT INTO knowledge_chunks(
      id, source, title, tags, content, course_pack_id, course_pack_version,
      namespace, authority, content_hash, verified_date
    ) VALUES(
      @id, @source, @title, @tags, @content, @coursePackId, @coursePackVersion,
      @namespace, @authority, @contentHash, @verifiedDate
    )
    ON CONFLICT(id) DO UPDATE SET
      source=excluded.source,
      title=excluded.title,
      tags=excluded.tags,
      content=excluded.content,
      course_pack_id=excluded.course_pack_id,
      course_pack_version=excluded.course_pack_version,
      namespace=excluded.namespace,
      authority=excluded.authority,
      content_hash=excluded.content_hash,
      verified_date=excluded.verified_date
  `);

  const counts = new Map<string, number>();
  connection.sqlite.transaction(() => {
    for (const item of items) {
      const placement = TOPIC_PLACEMENT[item.topic];
      const pack = getCoursePack(placement.coursePackId, placement.coursePackVersion);
      if (!pack.knowledgeNamespaces.includes(placement.namespace)) {
        throw new Error(`COURSE_PACK_NAMESPACE_MISMATCH:${item.id}`);
      }
      upsert.run({
        id: item.id,
        source: sourceJson(item),
        title: item.title,
        tags: JSON.stringify(item.tags),
        content: canonicalKnowledge(item),
        ...placement,
        authority: item.source.authority,
        contentHash: contentHash(item),
        verifiedDate: item.source.verifiedDate,
      });
      const key = `${placement.coursePackId}@${placement.coursePackVersion}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // Only prune records owned by this curated importer. User-created or future
    // namespaces are deliberately left untouched.
    const curatedNamespaces = Array.from(new Set(Object.values(TOPIC_PLACEMENT).map(({ namespace }) => namespace)));
    const candidates = connection.sqlite.prepare(
      `SELECT id FROM knowledge_chunks WHERE namespace IN (${curatedNamespaces.map(() => "?").join(",")})`,
    ).all(...curatedNamespaces) as Array<{ id: string }>;
    const remove = connection.sqlite.prepare("DELETE FROM knowledge_chunks WHERE id=?");
    for (const { id } of candidates) if (!incomingIds.has(id)) remove.run(id);
  }).immediate();

  return {
    total: items.length,
    byCoursePack: Object.fromEntries(Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function storedRowToItem(row: StoredKnowledgeRow): KnowledgeItem {
  const parsed = JSON.parse(row.content) as KnowledgeItem;
  return {
    ...parsed,
    source: JSON.parse(row.source) as KnowledgeItem["source"],
  };
}

export function loadStoredCoursePackKnowledge(
  connection: DatabaseConnection,
  coursePackId: string,
  coursePackVersion: string,
) {
  getCoursePack(coursePackId, coursePackVersion);
  const rows = connection.sqlite.prepare(`
    SELECT id, source, title, tags, content,
      course_pack_id coursePackId, course_pack_version coursePackVersion,
      namespace, authority, content_hash contentHash, verified_date verifiedDate
    FROM knowledge_chunks
    WHERE course_pack_id=? AND course_pack_version=?
    ORDER BY namespace, id
  `).all(coursePackId, coursePackVersion) as StoredKnowledgeRow[];
  return rows.map(storedRowToItem);
}

export function retrieveCoursePackKnowledge(
  connection: DatabaseConnection,
  coursePackId: string,
  coursePackVersion: string,
  query: string,
): RankedKnowledgeItem[] {
  return rankKnowledge(
    query,
    loadStoredCoursePackKnowledge(connection, coursePackId, coursePackVersion),
  );
}

export function countKnowledgeByCoursePack(connection: DatabaseConnection) {
  const rows = connection.sqlite.prepare(`
    SELECT course_pack_id coursePackId, course_pack_version coursePackVersion, count(*) count
    FROM knowledge_chunks
    GROUP BY course_pack_id, course_pack_version
    ORDER BY course_pack_id, course_pack_version
  `).all() as Array<{ coursePackId: string; coursePackVersion: string; count: number }>;
  return rows.map((row) => ({ ...row, key: `${row.coursePackId}@${row.coursePackVersion}` }));
}

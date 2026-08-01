// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  countKnowledgeByCoursePack,
  ingestCoursePackKnowledge,
  retrieveCoursePackKnowledge,
} from "@/lib/knowledge/course-pack-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("course pack knowledge ingestion", () => {
  it("imports all packs with version isolation, provenance, hashes and idempotency", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-course-knowledge-"));
    roots.push(root);
    const databasePath = path.join(root, "knowledge.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      expect(await ingestCoursePackKnowledge(connection)).toEqual({
        total: 34,
        byCoursePack: {
          "book-design@1": 9,
          "digital-interaction@1": 17,
          "general-design@1": 8,
        },
      });
      await ingestCoursePackKnowledge(connection);
      expect(countKnowledgeByCoursePack(connection)).toEqual([
        { key: "book-design@1", coursePackId: "book-design", coursePackVersion: "1", count: 9 },
        { key: "digital-interaction@1", coursePackId: "digital-interaction", coursePackVersion: "1", count: 17 },
        { key: "general-design@1", coursePackId: "general-design", coursePackVersion: "1", count: 8 },
      ]);
      const integrity = connection.sqlite.prepare(`
        SELECT count(*) count FROM knowledge_chunks
        WHERE length(content_hash)=64 AND authority <> '' AND verified_date <> ''
      `).get() as { count: number };
      expect(integrity.count).toBe(34);
      expect(retrieveCoursePackKnowledge(connection, "general-design", "1", "普通文字背景对比度")[0]?.topic)
        .toBe("DESIGN_FOUNDATIONS");
      expect(retrieveCoursePackKnowledge(connection, "book-design", "1", "新生导览册信息层级")[0]?.topic)
        .toBe("INFORMATION_HIERARCHY");
      expect(retrieveCoursePackKnowledge(connection, "digital-interaction", "1", "OSC端口没有信号")[0]?.topic)
        .toBe("OSC_TROUBLESHOOTING");
    } finally {
      connection.sqlite.close();
    }
  });
});

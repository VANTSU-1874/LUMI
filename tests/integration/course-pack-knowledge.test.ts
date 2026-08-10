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
        total: 116,
        byCoursePack: {
          "book-design@1": 63,
          "brand-vi-design@1": 2,
          "digital-interaction@1": 21,
          "general-design@1": 9,
          "layout-design@1": 21,
        },
      });
      await ingestCoursePackKnowledge(connection);
      expect(countKnowledgeByCoursePack(connection)).toEqual([
        { key: "book-design@1", coursePackId: "book-design", coursePackVersion: "1", count: 63 },
        { key: "brand-vi-design@1", coursePackId: "brand-vi-design", coursePackVersion: "1", count: 2 },
        { key: "digital-interaction@1", coursePackId: "digital-interaction", coursePackVersion: "1", count: 21 },
        { key: "general-design@1", coursePackId: "general-design", coursePackVersion: "1", count: 9 },
        { key: "layout-design@1", coursePackId: "layout-design", coursePackVersion: "1", count: 21 },
      ]);
      const integrity = connection.sqlite.prepare(`
        SELECT count(*) count FROM knowledge_chunks
        WHERE length(content_hash)=64 AND authority <> '' AND verified_date <> ''
      `).get() as { count: number };
      expect(integrity.count).toBe(116);
      expect(retrieveCoursePackKnowledge(connection, "general-design", "1", "普通文字背景对比度")[0]?.topic)
        .toBe("DESIGN_FOUNDATIONS");
      expect(retrieveCoursePackKnowledge(connection, "book-design", "1", "新生导览册信息层级")[0]?.topic)
        .toBe("INFORMATION_HIERARCHY");
      expect(retrieveCoursePackKnowledge(connection, "digital-interaction", "1", "OSC端口没有信号")[0]?.topic)
        .toBe("OSC_TROUBLESHOOTING");
      expect(retrieveCoursePackKnowledge(connection, "layout-design", "1", "版面内容很多排起来很乱")[0]?.topic)
        .toBe("LAYOUT_DESIGN_PRINCIPLES");
      expect(retrieveCoursePackKnowledge(connection, "layout-design", "1", "用了很多字号和字体页面还是很挤")[0]?.topic)
        .toBe("TYPOGRAPHY_BASICS");
      expect(retrieveCoursePackKnowledge(connection, "brand-vi-design", "1", "我的品牌该用字标还是图形标")[0])
        .toMatchObject({ id: "brandvi-001-assess-wordmark-fit", topic: "BRAND_IDENTITY" });
      expect(retrieveCoursePackKnowledge(connection, "brand-vi-design", "1", "怎样判断字标字体和品牌调性是否匹配")[0])
        .toMatchObject({ id: "brandvi-002-test-wordmark-tone-and-audience", topic: "BRAND_IDENTITY" });
    } finally {
      connection.sqlite.close();
    }
  });
});

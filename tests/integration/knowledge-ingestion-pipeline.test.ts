// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  applyPreparedKnowledgeIngestion,
  prepareKnowledgeIngestion,
  rehearsePreparedKnowledgeIngestion,
  type PreparedKnowledgeIngestion,
} from "@/lib/knowledge/knowledge-ingestion-pipeline";

describe("shared legacy/V2 knowledge ingestion pipeline", () => {
  let root: string;
  let legacy: PreparedKnowledgeIngestion;
  let v2: PreparedKnowledgeIngestion;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lumi-knowledge-pipeline-"));
    [legacy, v2] = await Promise.all([
      prepareKnowledgeIngestion({
        knowledgeObjectV2Enabled: false,
        workspaceRoot: process.cwd(),
      }),
      prepareKnowledgeIngestion({
        knowledgeObjectV2Enabled: true,
        workspaceRoot: process.cwd(),
      }),
    ]);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps the disabled path legacy-only", () => {
    const databasePath = path.join(root, "legacy.sqlite");
    const result = applyPreparedKnowledgeIngestion(databasePath, legacy);

    expect(legacy.mode).toBe("LEGACY");
    expect(result).toMatchObject({
      total: 116,
      byCoursePack: {
        "book-design@1": 63,
        "brand-vi-design@1": 2,
        "digital-interaction@1": 21,
        "general-design@1": 9,
        "layout-design@1": 21,
      },
    });
    expect(result).not.toHaveProperty("v2");

    const sqlite = new Database(databasePath, { readonly: true });
    try {
      expect(sqlite.prepare(
        "SELECT count(*) count FROM knowledge_chunks",
      ).get()).toEqual({ count: 116 });
      expect(sqlite.prepare(
        "SELECT count(*) count FROM knowledge_corpora_v2",
      ).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(
        "SELECT count(*) count FROM knowledge_active_corpus_v2",
      ).get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  it("rehearses V2 dual-write, idempotency, fallback, and reactivation", () => {
    const databasePath = path.join(root, "v2.sqlite");
    const rehearsal = rehearsePreparedKnowledgeIngestion(databasePath, v2);

    expect(v2.mode).toBe("V2");
    expect(rehearsal).toMatchObject({
      mode: "V2",
      idempotent: true,
      fallbackVerified: true,
      fallbackByCoursePack: {
        "book-design@1": 63,
        "brand-vi-design@1": 2,
        "digital-interaction@1": 21,
        "general-design@1": 9,
        "layout-design@1": 21,
      },
      final: {
        mode: "V2",
        total: 116,
        storage: {
          documentCount: 116,
          nodeCount: 1704,
          assetCount: 156,
          legacyChunkCount: 116,
          activeCorpusCount: 1,
        },
      },
    });

    const sqlite = new Database(databasePath, { readonly: true });
    try {
      expect(sqlite.prepare(
        "SELECT count(*) count FROM knowledge_chunks",
      ).get()).toEqual({ count: 116 });
      expect(sqlite.prepare(
        "SELECT count(*) count FROM knowledge_corpora_v2",
      ).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(
        "SELECT count(*) count FROM knowledge_active_corpus_v2",
      ).get()).toEqual({ count: 1 });
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      sqlite.close();
    }
  }, 30_000);

  it("uses a rolled-back fallback probe without dropping an active index", () => {
    const databasePath = path.join(root, "v2-active-index.sqlite");
    applyPreparedKnowledgeIngestion(databasePath, v2);
    const indexBundleHash = "f".repeat(64);
    const sqlite = new Database(databasePath);
    try {
      const corpus = sqlite.prepare(
        "SELECT bundle_hash bundleHash FROM knowledge_active_corpus_v2 WHERE id=1",
      ).get() as { bundleHash: string };
      sqlite.prepare(`
        INSERT INTO knowledge_index_bundles_v2(
          index_bundle_hash,corpus_hash,representation_count,canonical_json,created_at
        ) VALUES(?,?,0,'{}',1)
      `).run(indexBundleHash, corpus.bundleHash);
      sqlite.prepare(`
        INSERT INTO knowledge_active_index_bundle_v2(
          id,corpus_hash,index_bundle_hash,activated_at
        ) VALUES(1,?,?,1)
      `).run(corpus.bundleHash, indexBundleHash);
    } finally {
      sqlite.close();
    }

    const rehearsal = rehearsePreparedKnowledgeIngestion(databasePath, v2);
    expect(rehearsal.final).toMatchObject({
      storage: {
        indexBundleCount: 1,
        activeIndexBundleCount: 1,
      },
    });

    const checked = new Database(databasePath, { readonly: true });
    try {
      expect(checked.prepare(`
        SELECT index_bundle_hash indexBundleHash
        FROM knowledge_active_index_bundle_v2 WHERE id=1
      `).get()).toEqual({ indexBundleHash });
    } finally {
      checked.close();
    }
  }, 30_000);
});

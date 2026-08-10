// @vitest-environment node

import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("knowledge index V2 shared-payload migration", () => {
  it("installs V2 after production 0049 and preserves populated identities on reapply", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "knowledge-index-0050-"));
    roots.push(root);
    const databasePath = path.join(root, "legacy.sqlite");
    const through0049 = path.join(root, "through-0049");
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(
      path.join(source, "meta", "_journal.json"),
      "utf8",
    )) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string }>;
    };
    const oldEntries = journal.entries.filter(({ idx }) => idx <= 49);
    await mkdir(path.join(through0049, "meta"), { recursive: true });
    await writeFile(
      path.join(through0049, "meta", "_journal.json"),
      JSON.stringify({ ...journal, entries: oldEntries }),
      "utf8",
    );
    await Promise.all(oldEntries.map(({ tag }) => copyFile(
      path.join(source, `${tag}.sql`),
      path.join(through0049, `${tag}.sql`),
    )));
    runMigrations(databasePath, through0049);
    const productionBaseline = createDb(databasePath);
    try {
      expect(productionBaseline.sqlite.prepare(`
        SELECT count(*) count FROM sqlite_master
        WHERE type='table' AND name='knowledge_corpora_v2'
      `).get()).toEqual({ count: 0 });
    } finally {
      productionBaseline.sqlite.close();
    }
    runMigrations(databasePath);

    const corpusHash = "a".repeat(64);
    const indexBundleHash = "b".repeat(64);
    const configHash = "c".repeat(64);
    const payloadHash = "d".repeat(64);
    const representation = {
      schemaVersion: 2,
      id: "legacy-dedicated-entry",
      target: { kind: "OBJECT", id: "legacy-object" },
      channel: "LEXICAL",
      inputs: [{ kind: "TARGET", hash: "e".repeat(64) }],
      indexVersion: {
        id: "legacy-lexical-v1",
        builderId: "legacy-builder",
        builderVersion: "1.0.0",
        modelId: null,
        modelRevision: null,
        configHash,
      },
      dimensions: null,
      vectorCount: 1,
      payload: {
        storageKind: "CONTROLLED_FILE",
        storageKey: "data/knowledge-index/legacy.json",
        byteLength: 123,
        sha256: payloadHash,
      },
    };
    const canonicalBundle = JSON.stringify({
      schemaVersion: 2,
      corpusBundleHash: corpusHash,
      representations: [representation],
      indexBundleHash,
    });
    const legacy = createDb(databasePath);
    try {
      legacy.sqlite.prepare(`
        INSERT INTO knowledge_corpora_v2(
          bundle_hash,schema_version,corpus_version,parser_id,parser_version,
          content_version,object_count,asset_count,canonical_json,created_at
        ) VALUES(?,2,'legacy-corpus','legacy-parser','1.0.0','legacy-v2',0,0,'{}',100)
      `).run(corpusHash);
      legacy.sqlite.prepare(`
        INSERT INTO knowledge_active_corpus_v2(id,bundle_hash,activated_at)
        VALUES(1,?,101)
      `).run(corpusHash);
      legacy.sqlite.prepare(`
        INSERT INTO knowledge_index_bundles_v2(
          index_bundle_hash,corpus_hash,representation_count,canonical_json,created_at
        ) VALUES(?,?,1,?,102)
      `).run(indexBundleHash, corpusHash, canonicalBundle);
      legacy.sqlite.prepare(`
        INSERT INTO knowledge_index_versions_v2(
          index_bundle_hash,id,builder_id,builder_version,model_id,model_revision,
          config_json,config_hash
        ) VALUES(?,'legacy-lexical-v1','legacy-builder','1.0.0',NULL,NULL,'{}',?)
      `).run(indexBundleHash, configHash);
      legacy.sqlite.prepare(`
        INSERT INTO knowledge_index_entries_v2(
          index_bundle_hash,id,index_version_id,channel,target_kind,target_id,
          representation_json,dimensions,vector_count,storage_kind,storage_key,
          byte_length,payload_sha256
        ) VALUES(
          ?,'legacy-dedicated-entry','legacy-lexical-v1','LEXICAL','OBJECT',
          'legacy-object',?,NULL,1,'CONTROLLED_FILE',
          'data/knowledge-index/legacy.json',123,?
        )
      `).run(indexBundleHash, JSON.stringify(representation), payloadHash);
      legacy.sqlite.prepare(`
        INSERT INTO knowledge_active_index_bundle_v2(
          id,corpus_hash,index_bundle_hash,activated_at
        ) VALUES(1,?,?,103)
      `).run(corpusHash, indexBundleHash);
    } finally {
      legacy.sqlite.close();
    }

    runMigrations(databasePath);
    const upgraded = createDb(databasePath);
    try {
      expect(upgraded.sqlite.prepare(`
        SELECT index_bundle_hash indexBundleHash,canonical_json canonicalJson,
          shared_payload_count sharedPayloadCount
        FROM knowledge_index_bundles_v2
      `).get()).toEqual({
        indexBundleHash,
        canonicalJson: canonicalBundle,
        sharedPayloadCount: 0,
      });
      expect(upgraded.sqlite.prepare(`
        SELECT representation_json representationJson,storage_kind storageKind,
          storage_key storageKey,byte_length byteLength,
          payload_sha256 payloadSha256,
          manifest_payload_id manifestPayloadId,
          tensor_payload_id tensorPayloadId,locator_json locatorJson
        FROM knowledge_index_entries_v2
      `).get()).toEqual({
        representationJson: JSON.stringify(representation),
        storageKind: "CONTROLLED_FILE",
        storageKey: "data/knowledge-index/legacy.json",
        byteLength: 123,
        payloadSha256: payloadHash,
        manifestPayloadId: null,
        tensorPayloadId: null,
        locatorJson: null,
      });
      expect(upgraded.sqlite.prepare(`
        SELECT index_bundle_hash indexBundleHash
        FROM knowledge_active_index_bundle_v2 WHERE id=1
      `).get()).toEqual({ indexBundleHash });
      expect(upgraded.sqlite.prepare(
        "SELECT count(*) count FROM knowledge_index_payloads_v2",
      ).get()).toEqual({ count: 0 });
      expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.sqlite.close();
    }
  });
});

// @vitest-environment node

import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];

type Journal = {
  version: string;
  dialect: string;
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};

async function migrationsThrough(root: string, lastIndex: number) {
  const source = path.resolve("drizzle");
  const journal = JSON.parse(
    await readFile(path.join(source, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  const entries = journal.entries.filter(({ idx }) => idx <= lastIndex);
  const destination = path.join(root, `migrations-through-${lastIndex}`);
  await mkdir(path.join(destination, "meta"), { recursive: true });
  await Promise.all(entries.map(({ tag }) =>
    copyFile(path.join(source, `${tag}.sql`), path.join(destination, `${tag}.sql`))));
  await writeFile(
    path.join(destination, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
    "utf8",
  );
  return { destination, journal };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("KnowledgeObjectV2 additive migration", () => {
  it("preserves the exact production 0049 lineage and appends Knowledge V2 as 0050", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lumi-production-0049-upgrade-"));
    roots.push(root);
    const { destination, journal } = await migrationsThrough(root, 49);
    const production0049 = journal.entries.find(({ idx }) => idx === 49);
    expect(production0049).toMatchObject({
      when: 1_785_398_275_258,
      tag: "0049_legal_madrox",
    });
    const production0049Sql = await readFile(
      path.join("drizzle", "0049_legal_madrox.sql"),
      "utf8",
    );
    const production0049Lf = production0049Sql.replace(/\r\n?|\n/g, "\n");
    expect(createHash("sha256").update(production0049Lf).digest("hex"))
      .toBe("66ff148c69204f56e8e2f1a267ac98f9842fce819ca0face49deb0643b5b11de");
    expect(createHash("sha256").update(
      production0049Lf.replace(/\n/g, "\r\n"),
    ).digest("hex"))
      .toBe("4807ee498e285d914f86c88f7378c4cfa3a9b9301e34dc124d568f931e55be3d");
    const candidate0050Sql = await readFile(
      path.join("drizzle", "0050_knowledge_v2_after_production_0049.sql"),
      "utf8",
    );
    expect(candidate0050Sql).not.toMatch(/^\s*(?:DROP|ALTER|RENAME|DELETE|UPDATE)\b/im);
    expect(candidate0050Sql).not.toMatch(/CREATE TABLE `preview_/);

    const databasePath = path.join(root, "production.sqlite");
    runMigrations(databasePath, destination);
    const production = createDb(databasePath);
    production.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','生产班级','PROD0048');
      INSERT INTO users(id,class_id,role,alias,created_at)
      VALUES('s1','c1','STUDENT','生产学生',1700000000);
      INSERT INTO agent_student_memory(
        id,student_id,class_id,kind,content,salience,source_turn_id,
        created_at,last_used_at,student_disputed,student_dispute_note,student_disputed_at
      ) VALUES(
        '11111111-1111-4111-8111-111111111111','s1','c1','RECURRING_STRUGGLE',
        '生产库中已有的学习信号',7,NULL,1700000000,NULL,1,'学生已提出异议',1700000100
      );
      INSERT INTO preview_sessions(id,created_at,expires_at,data_type)
      VALUES('preview-production',1700000000,1700003600,'DEMONSTRATION_DATA');
      INSERT INTO preview_scenario_usage(id,session_id,scenario_id,run_count,updated_at,data_type)
      VALUES('preview-usage','preview-production','S5_BOOK_KNOWLEDGE',2,1700000100,'DEMONSTRATION_DATA');
      INSERT INTO preview_runs(
        id,session_id,scenario_id,status,response_json,error_code,
        created_at,updated_at,expires_at,data_type
      ) VALUES(
        'preview-run','preview-production','S5_BOOK_KNOWLEDGE','COMPLETED',
        '{"result":"sealed"}',NULL,1700000000,1700000100,1700003600,'DEMONSTRATION_DATA'
      );
    `);
    production.sqlite.close();

    runMigrations(databasePath);
    runMigrations(databasePath);
    const upgraded = createDb(databasePath);
    try {
      expect(upgraded.sqlite.prepare(`
        SELECT content,student_disputed studentDisputed,
          student_dispute_note studentDisputeNote,student_disputed_at studentDisputedAt
        FROM agent_student_memory
        WHERE id='11111111-1111-4111-8111-111111111111'
      `).get()).toEqual({
        content: "生产库中已有的学习信号",
        studentDisputed: 1,
        studentDisputeNote: "学生已提出异议",
        studentDisputedAt: 1700000100,
      });
      expect(upgraded.sqlite.prepare(`
        SELECT reason,created_at createdAt
        FROM agent_student_memory_disputes
        WHERE memory_id='11111111-1111-4111-8111-111111111111'
      `).get()).toEqual({ reason: "学生已提出异议", createdAt: 1700000100 });
      expect(upgraded.sqlite.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name IN (
          'auth_user','agent_run_interventions','knowledge_corpora_v2',
          'knowledge_index_payloads_v2','agent_student_memory_disputes',
          'preview_sessions','preview_scenario_usage','preview_runs'
        ) ORDER BY name
      `).all()).toEqual([
        { name: "agent_run_interventions" },
        { name: "agent_student_memory_disputes" },
        { name: "auth_user" },
        { name: "knowledge_corpora_v2" },
        { name: "knowledge_index_payloads_v2" },
        { name: "preview_runs" },
        { name: "preview_scenario_usage" },
        { name: "preview_sessions" },
      ]);
      expect(upgraded.sqlite.prepare(`
        SELECT s.id,u.run_count runCount,r.status,r.response_json responseJson
        FROM preview_sessions s
        JOIN preview_scenario_usage u ON u.session_id=s.id
        JOIN preview_runs r ON r.session_id=s.id
        WHERE s.id='preview-production'
      `).get()).toEqual({
        id: "preview-production",
        runCount: 2,
        status: "COMPLETED",
        responseJson: "{\"result\":\"sealed\"}",
      });
      expect(upgraded.sqlite.prepare(
        "SELECT count(*) count FROM __drizzle_migrations",
      ).get()).toEqual({ count: journal.entries.length });
      expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.sqlite.close();
    }
  });

  it("restores a sealed production-0049 database and can reapply 0050", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lumi-production-0049-restore-"));
    roots.push(root);
    const { destination } = await migrationsThrough(root, 49);
    const databasePath = path.join(root, "production.sqlite");
    const restorePointPath = path.join(root, "production-0049.restore.sqlite");
    runMigrations(databasePath, destination);
    const baseline = createDb(databasePath);
    baseline.sqlite.exec(`
      INSERT INTO preview_sessions(id,created_at,expires_at,data_type)
      VALUES('restore-session',1700000000,1700003600,'DEMONSTRATION_DATA');
    `);
    baseline.sqlite.pragma("wal_checkpoint(TRUNCATE)");
    baseline.sqlite.close();
    await copyFile(databasePath, restorePointPath);

    runMigrations(databasePath);
    const candidate = createDb(databasePath);
    expect(candidate.sqlite.prepare(`
      SELECT count(*) count FROM sqlite_master
      WHERE type='table' AND name='knowledge_corpora_v2'
    `).get()).toEqual({ count: 1 });
    candidate.sqlite.pragma("wal_checkpoint(TRUNCATE)");
    candidate.sqlite.close();

    await copyFile(restorePointPath, databasePath);
    const restored = createDb(databasePath);
    try {
      expect(restored.sqlite.prepare(
        "SELECT count(*) count FROM __drizzle_migrations",
      ).get()).toEqual({ count: 50 });
      expect(restored.sqlite.prepare(`
        SELECT count(*) count FROM sqlite_master
        WHERE type='table' AND name='knowledge_corpora_v2'
      `).get()).toEqual({ count: 0 });
      expect(restored.sqlite.prepare(
        "SELECT id FROM preview_sessions WHERE id='restore-session'",
      ).get()).toEqual({ id: "restore-session" });
      expect(restored.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      restored.sqlite.close();
    }

    runMigrations(databasePath);
    const reapplied = createDb(databasePath);
    try {
      expect(reapplied.sqlite.prepare(
        "SELECT count(*) count FROM __drizzle_migrations",
      ).get()).toEqual({ count: 51 });
      expect(reapplied.sqlite.prepare(
        "SELECT id FROM preview_sessions WHERE id='restore-session'",
      ).get()).toEqual({ id: "restore-session" });
      expect(reapplied.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      reapplied.sqlite.close();
    }
  });

  it("upgrades a populated 0044 database, preserves legacy knowledge and reruns idempotently", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lumi-v2-migration-"));
    roots.push(root);
    const { destination, journal } = await migrationsThrough(root, 44);
    const databasePath = path.join(root, "knowledge.sqlite");
    runMigrations(databasePath, destination);
    const legacy = createDb(databasePath);
    legacy.sqlite.prepare(`
      INSERT INTO knowledge_chunks(
        id,source,title,tags,content,course_pack_id,course_pack_version,
        namespace,authority,content_hash,verified_date
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      "legacy-stable-id",
      "{\"authority\":\"COURSE_DESIGN\"}",
      "旧知识",
      "[\"旧\"]",
      "{\"id\":\"legacy-stable-id\"}",
      "book-design",
      "1",
      "book-design-principles",
      "COURSE_DESIGN",
      "a".repeat(64),
      "2026-07-28",
    );
    const before = legacy.sqlite.prepare(
      "SELECT * FROM knowledge_chunks WHERE id='legacy-stable-id'",
    ).get();
    legacy.sqlite.close();

    runMigrations(databasePath);
    runMigrations(databasePath);
    const upgraded = createDb(databasePath);
    try {
      expect(upgraded.sqlite.prepare(
        "SELECT * FROM knowledge_chunks WHERE id='legacy-stable-id'",
      ).get()).toEqual(before);
      expect(upgraded.sqlite.prepare(
        "SELECT count(*) count FROM __drizzle_migrations",
      ).get()).toEqual({ count: journal.entries.length });
      expect(upgraded.sqlite.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name LIKE 'knowledge_%_v2'
        ORDER BY name
      `).all()).toEqual([
        { name: "knowledge_active_corpus_v2" },
        { name: "knowledge_active_index_bundle_v2" },
        { name: "knowledge_annotation_inputs_v2" },
        { name: "knowledge_annotations_v2" },
        { name: "knowledge_assets_v2" },
        { name: "knowledge_corpora_v2" },
        { name: "knowledge_document_assets_v2" },
        { name: "knowledge_documents_v2" },
        { name: "knowledge_index_bundles_v2" },
        { name: "knowledge_index_entries_v2" },
        { name: "knowledge_index_payloads_v2" },
        { name: "knowledge_index_versions_v2" },
        { name: "knowledge_node_relations_v2" },
        { name: "knowledge_nodes_v2" },
      ]);
      expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.sqlite.close();
    }
  });

  it("fails closed when an applied migration hash drifts or history contains a gap", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lumi-v2-history-"));
    roots.push(root);
    const databasePath = path.join(root, "knowledge.sqlite");
    runMigrations(databasePath);
    const drifted = createDb(databasePath);
    drifted.sqlite.prepare(`
      UPDATE __drizzle_migrations SET hash=?
      WHERE created_at=(SELECT max(created_at) FROM __drizzle_migrations)
    `).run("0".repeat(64));
    drifted.sqlite.close();
    expect(() => runMigrations(databasePath))
      .toThrow(/MIGRATION_HISTORY_HASH_DRIFT/);

    const gapPath = path.join(root, "gap.sqlite");
    runMigrations(gapPath);
    const gapped = createDb(gapPath);
    gapped.sqlite.prepare(`
      DELETE FROM __drizzle_migrations
      WHERE created_at=(
        SELECT created_at FROM __drizzle_migrations ORDER BY created_at LIMIT 1 OFFSET 10
      )
    `).run();
    gapped.sqlite.close();
    expect(() => runMigrations(gapPath)).toThrow(/MIGRATION_HISTORY_GAP/);
    const recovered = createDb(gapPath);
    try {
      expect(recovered.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(recovered.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      recovered.sqlite.close();
    }

    const semanticPath = path.join(root, "semantic.sqlite");
    const semanticMigrations = await migrationsThrough(
      path.join(root, "semantic-source"),
      44,
    );
    runMigrations(semanticPath, semanticMigrations.destination);
    const semanticFile = path.join(
      semanticMigrations.destination,
      `${semanticMigrations.journal.entries[0]!.tag}.sql`,
    );
    await writeFile(
      semanticFile,
      `${await readFile(semanticFile, "utf8")}\nSELECT 1;\n`,
      "utf8",
    );
    expect(() => runMigrations(semanticPath, semanticMigrations.destination))
      .toThrow(/MIGRATION_HISTORY_HASH_DRIFT/);

    const aheadPath = path.join(root, "ahead.sqlite");
    runMigrations(aheadPath);
    const truncated = await migrationsThrough(
      path.join(root, "ahead-source"),
      44,
    );
    expect(() => runMigrations(aheadPath, truncated.destination))
      .toThrow(/MIGRATION_HISTORY_AHEAD_OF_SOURCE/);

    const duplicatePath = path.join(root, "duplicate.sqlite");
    runMigrations(duplicatePath);
    const duplicated = createDb(duplicatePath);
    duplicated.sqlite.exec(`
      UPDATE __drizzle_migrations
      SET created_at=(
        SELECT created_at FROM __drizzle_migrations ORDER BY created_at,rowid LIMIT 1
      )
      WHERE rowid=(
        SELECT rowid FROM __drizzle_migrations ORDER BY created_at,rowid LIMIT 1 OFFSET 1
      )
    `);
    duplicated.sqlite.close();
    expect(() => runMigrations(duplicatePath))
      .toThrow(/MIGRATION_HISTORY_DUPLICATE/);

    const wrongTimestampPath = path.join(root, "wrong-alias-timestamp.sqlite");
    runMigrations(wrongTimestampPath);
    const wrongTimestamp = createDb(wrongTimestampPath);
    wrongTimestamp.sqlite.prepare(`
      UPDATE __drizzle_migrations SET hash=?
      WHERE created_at=(SELECT min(created_at) FROM __drizzle_migrations)
    `).run("a025984b3db8b97e380c48de517a6435e0c2fba35f06fc32260ca07abceb4e63");
    wrongTimestamp.sqlite.close();
    expect(() => runMigrations(wrongTimestampPath))
      .toThrow(/MIGRATION_HISTORY_HASH_DRIFT/);
  });

  it("accepts an applied migration after a CRLF-to-LF checkout normalization", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lumi-v2-eol-"));
    roots.push(root);
    const { destination, journal } = await migrationsThrough(root, 44);
    const databasePath = path.join(root, "knowledge.sqlite");
    const firstMigrationPath = path.join(
      destination,
      `${journal.entries[0]!.tag}.sql`,
    );
    const lf = (await readFile(firstMigrationPath, "utf8"))
      .replace(/\r\n?|\n/g, "\n");
    await writeFile(
      firstMigrationPath,
      lf.replace(/\n/g, "\r\n"),
      "utf8",
    );
    runMigrations(databasePath, destination);
    await writeFile(
      firstMigrationPath,
      lf,
      "utf8",
    );

    expect(() => runMigrations(databasePath, destination)).not.toThrow();

    const reverseRoot = await mkdtemp(path.join(tmpdir(), "lumi-v2-eol-reverse-"));
    roots.push(reverseRoot);
    const reverse = await migrationsThrough(reverseRoot, 44);
    const reversePath = path.join(reverseRoot, "knowledge.sqlite");
    const reverseFirstMigrationPath = path.join(
      reverse.destination,
      `${reverse.journal.entries[0]!.tag}.sql`,
    );
    const reverseLf = (await readFile(reverseFirstMigrationPath, "utf8"))
      .replace(/\r\n?|\n/g, "\n");
    await writeFile(reverseFirstMigrationPath, reverseLf, "utf8");
    runMigrations(reversePath, reverse.destination);
    await writeFile(
      reverseFirstMigrationPath,
      reverseLf.replace(/\n/g, "\r\n"),
      "utf8",
    );
    expect(() => runMigrations(reversePath, reverse.destination)).not.toThrow();

    const legacyRoot = await mkdtemp(path.join(tmpdir(), "lumi-v2-eol-legacy-"));
    roots.push(legacyRoot);
    const legacy = await migrationsThrough(legacyRoot, 44);
    const legacyPath = path.join(legacyRoot, "knowledge.sqlite");
    const legacyEntry = legacy.journal.entries.find(
      ({ when }) => when === 1_783_855_846_605,
    )!;
    const legacyMigrationPath = path.join(
      legacy.destination,
      `${legacyEntry.tag}.sql`,
    );
    const legacyLf = (await readFile(legacyMigrationPath, "utf8"))
      .replace(/\r\n?|\n/g, "\n");
    const legacyLines = legacyLf.split("\n");
    const historicalMixedEol = legacyLines.map((line, index) => {
      if (index === legacyLines.length - 1) return line;
      return `${line}${index === 7 || index === 8 ? "\n" : "\r\n"}`;
    }).join("");
    await writeFile(legacyMigrationPath, historicalMixedEol, "utf8");
    runMigrations(legacyPath, legacy.destination);
    const legacyDb = createDb(legacyPath);
    expect(legacyDb.sqlite.prepare(`
      SELECT hash FROM __drizzle_migrations WHERE created_at=?
    `).get(legacyEntry.when)).toEqual({
      hash: "a025984b3db8b97e380c48de517a6435e0c2fba35f06fc32260ca07abceb4e63",
    });
    legacyDb.sqlite.close();
    await copyFile(
      path.join("drizzle", `${legacyEntry.tag}.sql`),
      legacyMigrationPath,
    );
    expect(() => runMigrations(legacyPath, legacy.destination)).not.toThrow();
    await writeFile(
      legacyMigrationPath,
      `${await readFile(legacyMigrationPath, "utf8")}\nSELECT 1;\n`,
      "utf8",
    );
    expect(() => runMigrations(legacyPath, legacy.destination))
      .toThrow(/MIGRATION_HISTORY_HASH_DRIFT/);
  });
});

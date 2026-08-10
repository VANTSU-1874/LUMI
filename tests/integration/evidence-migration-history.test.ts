// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

describe("evidence migration history", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("upgrades a populated pre-evidence-safety database with the formal migrator", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-migration-history-"));
    directories.push(directory);
    const partial = path.join(directory, "partial-migrations");
    await mkdir(path.join(partial, "meta"), { recursive: true });
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const oldEntries = journal.entries.filter(({ idx }) => idx <= 4);
    await writeFile(path.join(partial, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: oldEntries }), "utf8");
    await Promise.all(oldEntries.map(({ tag }) => copyFile(path.join(source, `${tag}.sql`), path.join(partial, `${tag}.sql`))));

    const databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath, partial);
    const old = createDb(databasePath);
    const longLabel = "长".repeat(90);
    old.sqlite.exec(`
      INSERT INTO classes VALUES ('class-1', '一班', 'CLASS001');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES ('student-1', 'class-1', 'STUDENT', '匿名-1', 1700000000);
      INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '搭建', 2, '信号');
      INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '作业', '简介', '["DIGISHOW"]', 1700000000);
      INSERT INTO projects VALUES ('project-1', 'class-1', 'assignment-1', 'student-1', 'BUILD', 1700000000, 1700000000);
      INSERT INTO evidence VALUES ('old-evidence', 'project-1', 'TEXT', '旧证据', '旧内容', 1700000000);
      INSERT INTO evidence VALUES ('blank-evidence', 'project-1', 'TEXT', '', '空标签内容', 1700000001);
      INSERT INTO evidence VALUES ('space-evidence', 'project-1', 'TEXT', '   ', '空格标签内容', 1700000002);
      INSERT INTO evidence VALUES ('long-evidence', 'project-1', 'TEXT', '${longLabel}', '长标签内容', 1700000003);
      INSERT INTO evidence VALUES ('multiline-evidence', 'project-1', 'TEXT', '第一行
第二行', '多行内容', 1700000004);
      INSERT INTO troubleshooting_runs VALUES ('old-run', 'project-1', '旧问题', 'INPUT', '{}', 'ACTIVE');
    `);
    old.sqlite.close();

    const throughFive = journal.entries.filter(({ idx }) => idx <= 5);
    await writeFile(path.join(partial, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: throughFive }), "utf8");
    const migrationFive = throughFive.find(({ idx }) => idx === 5);
    if (!migrationFive) throw new Error("缺少 0005 迁移");
    await copyFile(path.join(source, `${migrationFive.tag}.sql`), path.join(partial, `${migrationFive.tag}.sql`));
    runMigrations(databasePath, partial);
    const hardened = createDb(databasePath);
    const migratedDigest = (hardened.sqlite.prepare("SELECT content_digest FROM evidence WHERE id='old-evidence'").get() as { content_digest: string }).content_digest;
    hardened.sqlite.prepare(`
      INSERT INTO hint_records (id, project_id, class_id, student_id, hint_level, response_json, created_at)
      VALUES ('old-hint', 'project-1', 'class-1', 'student-1', 3, '{}', 1700000010)
    `).run();
    hardened.sqlite.prepare(`
      INSERT INTO hint_evidence_consumptions
        (evidence_id, hint_record_id, project_id, student_id, content_digest, consumed_at)
      VALUES ('old-evidence', 'old-hint', 'project-1', 'student-1', ?, 1700000010)
    `).run(migratedDigest);
    hardened.sqlite.close();

    runMigrations(databasePath);
    const upgraded = createDb(databasePath);
    try {
      const row = upgraded.sqlite.prepare("SELECT class_id, student_id, signal_layer, confirmed_code, verification_status, storage_status, content_digest FROM evidence WHERE id='old-evidence'").get() as Record<string, string>;
      expect(row).toMatchObject({
        class_id: "class-1", student_id: "student-1", signal_layer: "INPUT",
        confirmed_code: null, verification_status: "SUBMITTED", storage_status: "READY",
      });
      expect(row.content_digest).toMatch(/^[a-f0-9]{64}$/);
      expect(upgraded.sqlite.prepare("SELECT id, label, evidence_sequence FROM evidence ORDER BY evidence_sequence").all())
        .toEqual([
          { id: "old-evidence", label: "旧证据", evidence_sequence: 1 },
          { id: "blank-evidence", label: "历史证据", evidence_sequence: 2 },
          { id: "space-evidence", label: "历史证据", evidence_sequence: 3 },
          { id: "long-evidence", label: "长".repeat(80), evidence_sequence: 4 },
          { id: "multiline-evidence", label: "第一行\n第二行", evidence_sequence: 5 },
        ]);
      expect(upgraded.sqlite.prepare("SELECT created_at, updated_at, revision FROM troubleshooting_runs WHERE id='old-run'").get())
        .toEqual({ created_at: 0, updated_at: 0, revision: 1 });
      expect(upgraded.sqlite.prepare(`
        SELECT json_extract(state_json, '$.currentLayer') current_layer,
          json_extract(state_json, '$.status') status
        FROM troubleshooting_runs WHERE id='old-run'
      `).get()).toEqual({ current_layer: "INPUT", status: "ACTIVE" });
      expect(upgraded.sqlite.prepare("SELECT count(*) count FROM __drizzle_migrations").get()).toEqual({ count: journal.entries.length });
      expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(upgraded.sqlite.prepare("SELECT count(*) AS count FROM hint_records").get()).toEqual({ count: 1 });
      expect(upgraded.sqlite.prepare("SELECT hint_sequence, evidence_sequence_watermark FROM hint_records WHERE id='old-hint'").get())
        .toEqual({ hint_sequence: 1, evidence_sequence_watermark: 0 });
      expect(upgraded.sqlite.prepare("SELECT class_id, evidence_sequence FROM hint_evidence_consumptions WHERE evidence_id='old-evidence'").get())
        .toEqual({ class_id: "class-1", evidence_sequence: 1 });
      expect(upgraded.sqlite.prepare("SELECT evidence_revision FROM projects WHERE id='project-1'").get())
        .toEqual({ evidence_revision: 5 });
    } finally {
      upgraded.sqlite.close();
    }
  });

  it("rolls back a migration whose final foreign-key audit fails and restores enforcement", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-migration-rollback-"));
    directories.push(directory);
    const databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    const invalidFolder = path.join(directory, "invalid-migrations");
    await mkdir(path.join(invalidFolder, "meta"), { recursive: true });
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
    };
    await Promise.all(journal.entries.map(({ tag }) =>
      copyFile(path.join(source, `${tag}.sql`), path.join(invalidFolder, `${tag}.sql`))));
    const invalid = {
      idx: journal.entries.length,
      version: "6",
      when: Math.max(...journal.entries.map(({ when }) => when)) + 1,
      tag: "0008_invalid_foreign_key",
      breakpoints: true,
    };
    await writeFile(path.join(invalidFolder, `${invalid.tag}.sql`), `
      INSERT INTO projects (id, class_id, assignment_id, student_id, stage, created_at, updated_at)
      VALUES ('invalid-project', 'missing-class', 'missing-assignment', 'missing-student', 'BUILD', 1, 1);
    `, "utf8");
    await writeFile(path.join(invalidFolder, "meta", "_journal.json"), JSON.stringify({
      version: "7", dialect: "sqlite", entries: [...journal.entries, invalid],
    }), "utf8");

    expect(() => runMigrations(databasePath, invalidFolder)).toThrow("外键校验失败");
    const recovered = createDb(databasePath);
    try {
      expect(recovered.sqlite.prepare("SELECT count(*) count FROM projects WHERE id='invalid-project'").get())
        .toEqual({ count: 0 });
      expect(recovered.sqlite.prepare("SELECT count(*) count FROM __drizzle_migrations").get())
        .toEqual({ count: journal.entries.length });
      expect(recovered.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(recovered.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      recovered.sqlite.close();
    }
  });

  it("upgrades cleanly from every recorded migration checkpoint", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-all-checkpoints-"));
    directories.push(directory);
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    for (const checkpoint of journal.entries) {
      const partial = path.join(directory, `through-${checkpoint.idx}`);
      await mkdir(path.join(partial, "meta"), { recursive: true });
      const entries = journal.entries.filter(({ idx }) => idx <= checkpoint.idx);
      await writeFile(path.join(partial, "meta", "_journal.json"), JSON.stringify({
        version: "7", dialect: "sqlite", entries,
      }), "utf8");
      await Promise.all(entries.map(({ tag }) =>
        copyFile(path.join(source, `${tag}.sql`), path.join(partial, `${tag}.sql`))));
      const databasePath = path.join(directory, `checkpoint-${checkpoint.idx}.sqlite`);
      runMigrations(databasePath, partial);
      runMigrations(databasePath);
      const upgraded = createDb(databasePath);
      try {
        expect(upgraded.sqlite.prepare("SELECT count(*) count FROM __drizzle_migrations").get())
          .toEqual({ count: journal.entries.length });
        expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
      } finally {
        upgraded.sqlite.close();
      }
    }
  }, 60_000);

  it("continues from an applied 0008, preserves its lock row, and does not replay migrations", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-post-0008-"));
    directories.push(directory);
    const databasePath = path.join(directory, "course.sqlite");
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
    };
    const throughEight = path.join(directory, "through-0008");
    await mkdir(path.join(throughEight, "meta"), { recursive: true });
    const firstNine = journal.entries.filter(({ idx }) => idx <= 8);
    await Promise.all(firstNine.map(({ tag }) =>
      copyFile(path.join(source, `${tag}.sql`), path.join(throughEight, `${tag}.sql`))));
    await writeFile(path.join(throughEight, "meta", "_journal.json"), JSON.stringify({
      version: "7", dialect: "sqlite", entries: firstNine,
    }), "utf8");
    runMigrations(databasePath, throughEight);
    const seeded = createDb(databasePath);
    seeded.sqlite.prepare(`
      INSERT INTO evidence_recovery_locks (name, owner, acquired_at) VALUES ('preserve', ?, 1)
    `).run("0".repeat(36));
    seeded.sqlite.close();
    runMigrations(databasePath);

    const extended = path.join(directory, "extended");
    await mkdir(path.join(extended, "meta"), { recursive: true });
    await Promise.all(journal.entries.map(({ tag }) =>
      copyFile(path.join(source, `${tag}.sql`), path.join(extended, `${tag}.sql`))));
    const later = {
      idx: journal.entries.length,
      version: "6",
      when: Math.max(...journal.entries.map(({ when }) => when)) + 1,
      tag: "0010_later_marker",
      breakpoints: true,
    };
    await writeFile(path.join(extended, `${later.tag}.sql`),
      "CREATE TABLE later_migration_marker (id text PRIMARY KEY NOT NULL);", "utf8");
    await writeFile(path.join(extended, "meta", "_journal.json"), JSON.stringify({
      version: "7", dialect: "sqlite", entries: [...journal.entries, later],
    }), "utf8");

    runMigrations(databasePath, extended);
    const upgraded = createDb(databasePath);
    try {
      expect(upgraded.sqlite.prepare("SELECT owner, acquired_at, expires_at FROM evidence_recovery_locks WHERE name='preserve'").get())
        .toEqual({ owner: "0".repeat(36), acquired_at: 1, expires_at: 2 });
      expect(upgraded.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='later_migration_marker'").get())
        .toEqual({ name: "later_migration_marker" });
      expect(upgraded.sqlite.prepare("SELECT count(*) count FROM __drizzle_migrations").get())
        .toEqual({ count: journal.entries.length + 1 });
    } finally {
      upgraded.sqlite.close();
    }
  });
});

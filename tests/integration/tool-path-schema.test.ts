// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

describe("tool path plan schema", () => {
  let directory: string;
  let databasePath: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-tool-schema-"));
    databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes VALUES ('class-1', '一班', 'CLASS001');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES ('student-1', 'class-1', 'STUDENT', '匿名-1', 1700000000);
      INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '逻辑卡', 2, '逻辑');
      INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '作业', '简介', '["DIGISHOW"]', 1700000000);
      INSERT INTO projects VALUES ('project-1', 'class-1', 'assignment-1', 'student-1', 'TOOL_PATH', 1700000000, 1700000000, 0);
    `);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates the incremental tool_path_plans table and reapplies migrations safely", () => {
    const table = connection.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tool_path_plans'")
      .get();
    expect(table).toBeTruthy();

    connection.sqlite.close();
    runMigrations(databasePath);
    connection = createDb(databasePath);
    expect(
      connection.sqlite.prepare("SELECT count(*) count FROM tool_path_plans").get(),
    ).toEqual({ count: 0 });
  });

  it("upgrades populated 0000-0003 history through 0004 without losing cards or plans", async () => {
    const legacyPath = path.join(directory, "legacy.sqlite");
    const legacy = new Database(legacyPath);
    const applySql = async (fileName: string) => {
      const sql = await readFile(path.resolve("drizzle", fileName), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) {
        if (statement.trim()) legacy.exec(statement);
      }
    };
    try {
      for (const migration of [
        "0000_absent_lady_mastermind.sql",
        "0001_petite_luminals.sql",
        "0002_chubby_angel.sql",
        "0003_hot_hercules.sql",
      ]) {
        await applySql(migration);
      }
      legacy.exec(`
        INSERT INTO classes VALUES ('class-1', '一班', 'C1');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES ('student-1', 'class-1', 'STUDENT', '匿名', 1700000000);
        INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '逻辑', 2, '逻辑');
        INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '作业', '简介', '["DIGISHOW"]', 1700000000);
        INSERT INTO projects VALUES ('project-1', 'class-1', 'assignment-1', 'student-1', 'TOOL_PATH', 1700000000, 1700000000);
        INSERT INTO logic_cards VALUES ('project-1', '{"mappingRule":"历史规则"}', 1, 1, '{"status":"APPROVED"}');
        INSERT INTO tool_path_plans VALUES ('project-1', 'DIGISHOW', '{"needsRealtimeVisuals":false,"needsPhysicalControl":false,"hasOsc":false}', '["历史原因"]', '[{"id":"m1","title":"历史里程碑","requiredEvidenceLabel":"截图"}]', 1700000000, 1700000000);
      `);

      await applySql("0004_short_kylun.sql");

      expect(legacy.prepare("SELECT revision, card_hash, payload_json FROM logic_cards").get()).toEqual({
        revision: 1,
        card_hash: "0".repeat(64),
        payload_json: '{"mappingRule":"历史规则"}',
      });
      expect(legacy.prepare("SELECT path, reasons_json FROM tool_path_plans").get()).toEqual({
        path: "DIGISHOW",
        reasons_json: '["历史原因"]',
      });
    } finally {
      legacy.close();
    }
  });

  it("uses runMigrations to upgrade a populated 0000-0003 database through the current schema safely", async () => {
    const legacyFolder = path.join(directory, "legacy-migrations");
    const legacyMeta = path.join(legacyFolder, "meta");
    await mkdir(legacyMeta, { recursive: true });
    const migrationFiles = [
      "0000_absent_lady_mastermind.sql",
      "0001_petite_luminals.sql",
      "0002_chubby_angel.sql",
      "0003_hot_hercules.sql",
    ];
    for (const fileName of migrationFiles) {
      await copyFile(path.resolve("drizzle", fileName), path.join(legacyFolder, fileName));
    }
    const journal = JSON.parse(await readFile(path.resolve("drizzle/meta/_journal.json"), "utf8")) as {
      entries: { idx: number }[];
    };
    await writeFile(
      path.join(legacyMeta, "_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.filter(({ idx }) => idx <= 3) }),
      "utf8",
    );
    const legacyPath = path.join(directory, "formal-legacy.sqlite");
    runMigrations(legacyPath, legacyFolder);
    const legacy = createDb(legacyPath);
    try {
      legacy.sqlite.exec(`
        INSERT INTO classes VALUES ('class-1', '一班', 'C1');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES ('student-1', 'class-1', 'STUDENT', '匿名', 1700000000);
        INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '逻辑', 2, '逻辑');
        INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '作业', '简介', '["DIGISHOW"]', 1700000000);
        INSERT INTO projects VALUES ('project-1', 'class-1', 'assignment-1', 'student-1', 'TOOL_PATH', 1700000000, 1700000000);
        INSERT INTO logic_cards VALUES ('project-1', '{"mappingRule":"历史规则"}', 1, 1, '{"status":"APPROVED"}');
        INSERT INTO tool_path_plans VALUES ('project-1', 'DIGISHOW', '{"needsRealtimeVisuals":false,"needsPhysicalControl":false,"hasOsc":false}', '["历史原因"]', '[{"id":"m1","title":"输入","requiredEvidenceLabel":"输入截图"},{"id":"m2","title":"映射","requiredEvidenceLabel":"映射截图"},{"id":"m3","title":"原型","requiredEvidenceLabel":"原型截图"}]', 1700000000, 1700000000);
      `);
    } finally {
      legacy.sqlite.close();
    }

    runMigrations(legacyPath);
    runMigrations(legacyPath);
    const upgraded = createDb(legacyPath);
    try {
      expect(upgraded.sqlite.prepare("SELECT count(*) count FROM __drizzle_migrations").get()).toEqual({ count: journal.entries.length });
      expect(upgraded.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(upgraded.sqlite.prepare("SELECT revision, card_hash, payload_json FROM logic_cards").get()).toEqual({
        revision: 1,
        card_hash: "0".repeat(64),
        payload_json: '{"mappingRule":"历史规则"}',
      });
      expect(upgraded.sqlite.prepare("SELECT path, reasons_json FROM tool_path_plans").get()).toEqual({
        path: "DIGISHOW",
        reasons_json: '["历史原因"]',
      });
    } finally {
      upgraded.sqlite.close();
    }
  });

  it("rejects invalid path and malformed JSON written through raw SQL", () => {
    const statement = connection.sqlite.prepare(`
      INSERT INTO tool_path_plans
        (project_id, path, requirements_json, reasons_json, milestones_json, created_at, updated_at)
      VALUES ('project-1', ?, ?, '["reason"]', '[]', 1700000000, 1700000000)
    `);

    expect(() => statement.run("UNKNOWN", '{}')).toThrow();
    expect(() => statement.run("DIGISHOW", 'not-json')).toThrow();
  });

  it.each([
    ["requirements array", "[]", '["reason"]', "[]"],
    ["requirements missing booleans", "{}", '["reason"]', "[]"],
    ["requirements string boolean", '{"needsRealtimeVisuals":"true","needsPhysicalControl":false,"hasOsc":false}', '["reason"]', "[]"],
    ["reasons object", '{"needsRealtimeVisuals":false,"needsPhysicalControl":false,"hasOsc":false}', "{}", "[]"],
    ["milestones object", '{"needsRealtimeVisuals":false,"needsPhysicalControl":false,"hasOsc":false}', '["reason"]', "{}"],
  ])("rejects valid JSON with the wrong root shape: %s", (_case, requirementsJson, reasonsJson, milestonesJson) => {
    expect(() => connection.sqlite.prepare(`
      INSERT INTO tool_path_plans
        (project_id, path, requirements_json, reasons_json, milestones_json, created_at, updated_at)
      VALUES ('project-1', 'DIGISHOW', ?, ?, ?, 1700000000, 1700000000)
    `).run(requirementsJson, reasonsJson, milestonesJson)).toThrow();
  });

  it("rejects invalid logic revision and card hash values", () => {
    expect(() => connection.sqlite.prepare(`
      INSERT INTO logic_cards
        (project_id, payload_json, rule_ready, semantic_ready, semantic_review_json, revision, card_hash)
      VALUES ('project-1', '{}', 0, 0, '{}', 0, ?)
    `).run("g".repeat(64))).toThrow();
  });

  it("cascades the plan with its project", () => {
    connection.sqlite.prepare(`
      INSERT INTO tool_path_plans
        (project_id, path, requirements_json, reasons_json, milestones_json, created_at, updated_at)
      VALUES ('project-1', 'DIGISHOW', '{"needsRealtimeVisuals":false,"needsPhysicalControl":false,"hasOsc":false}', '["reason"]', '[]', 1700000000, 1700000000)
    `).run();
    connection.sqlite.prepare("DELETE FROM projects WHERE id='project-1'").run();
    expect(connection.sqlite.prepare("SELECT count(*) count FROM tool_path_plans").get()).toEqual({ count: 0 });
  });
});

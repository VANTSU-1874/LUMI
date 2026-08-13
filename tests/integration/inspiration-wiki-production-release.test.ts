import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { runMigrations } from "@/lib/db/migrate";
import {
  applyInspirationWikiProductionBundle,
  D27_BUNDLE_ID,
} from "@/lib/operations/inspiration-wiki-production-release";

const roots: string[] = [];
const bundleRoot = path.resolve(
  "data",
  "inspiration-wiki",
  "production-release",
  D27_BUNDLE_ID,
);

function createTarget() {
  const root = mkdtempSync(path.join(os.tmpdir(), "lumi-d27-production-release-"));
  roots.push(root);
  const dataRoot = path.join(root, "data");
  const databasePath = path.join(dataRoot, "tonggan.sqlite");
  runMigrations(databasePath);
  const database = new Database(databasePath);
  database.prepare(
    `INSERT INTO users (id, class_id, role, alias, nickname, major, onboarding_completed_at, created_at)
     VALUES ('teacher', NULL, 'TEACHER', '课程负责人', NULL, NULL, NULL, 1786499209)`,
  ).run();
  database.close();
  return { root, dataRoot, databasePath };
}

function createProduction0050Target() {
  const root = mkdtempSync(path.join(os.tmpdir(), "lumi-d27-production-0050-"));
  roots.push(root);
  const dataRoot = path.join(root, "data");
  const databasePath = path.join(dataRoot, "tonggan.sqlite");
  const migrationsRoot = path.join(root, "drizzle-0050");
  const metaRoot = path.join(migrationsRoot, "meta");
  mkdirSync(metaRoot, { recursive: true });
  const sourceRoot = path.resolve("drizzle");
  const journal = JSON.parse(readFileSync(path.join(sourceRoot, "meta", "_journal.json"), "utf8")) as {
    version: string;
    dialect: string;
    entries: Array<{ idx: number; tag: string }>;
  };
  const entries = journal.entries.filter((entry) => entry.idx <= 50);
  for (const entry of entries) {
    copyFileSync(
      path.join(sourceRoot, `${entry.tag}.sql`),
      path.join(migrationsRoot, `${entry.tag}.sql`),
    );
  }
  writeFileSync(path.join(metaRoot, "_journal.json"), JSON.stringify({ ...journal, entries }, null, 2));
  runMigrations(databasePath, migrationsRoot);
  const database = new Database(databasePath);
  database.prepare(
    `INSERT INTO users (id, class_id, role, alias, nickname, major, onboarding_completed_at, created_at)
     VALUES ('teacher', NULL, 'TEACHER', '课程负责人', NULL, NULL, NULL, 1786499209)`,
  ).run();
  database.close();
  return { root, dataRoot, databasePath };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("D-27 Inspiration Wiki production release", () => {
  it("applies the exact five-item evidence closure and replays with zero writes", () => {
    const target = createTarget();
    const first = applyInspirationWikiProductionBundle({
      databasePath: target.databasePath,
      dataRoot: target.dataRoot,
      bundleRoot,
    });
    expect(first.databaseWrites).toBeGreaterThan(100);
    expect(first.assetWrites).toBe(14);

    const replay = applyInspirationWikiProductionBundle({
      databasePath: target.databasePath,
      dataRoot: target.dataRoot,
      bundleRoot,
    });
    expect(replay).toMatchObject({
      bundleDigest: first.bundleDigest,
      databaseWrites: 0,
      assetWrites: 0,
      validatedOnly: false,
    });

    const database = new Database(target.databasePath, { readonly: true });
    expect(database.prepare("SELECT count(*) count FROM inspiration_wiki_formal_releases").get())
      .toEqual({ count: 5 });
    expect(database.prepare("SELECT count(*) count FROM inspiration_wiki_p2_active_channel_snapshots").get())
      .toEqual({ count: 1 });
    expect(database.pragma("foreign_key_check")).toEqual([]);
    database.close();
  });

  it("rejects a conflicting target row without weakening the boundary", () => {
    const target = createTarget();
    applyInspirationWikiProductionBundle({
      databasePath: target.databasePath,
      dataRoot: target.dataRoot,
      bundleRoot,
    });
    const database = new Database(target.databasePath);
    database.prepare(
      "UPDATE inspiration_wiki_hermes_candidates SET title='conflict' WHERE id=(SELECT id FROM inspiration_wiki_hermes_candidates LIMIT 1)",
    ).run();
    database.close();
    expect(() => applyInspirationWikiProductionBundle({
      databasePath: target.databasePath,
      dataRoot: target.dataRoot,
      bundleRoot,
    })).toThrow("D27_TARGET_ROW_CONFLICT");
  });

  it("validates the immutable manifest without writing a database", () => {
    const target = createTarget();
    const before = readFileSync(target.databasePath);
    const result = applyInspirationWikiProductionBundle({
      databasePath: target.databasePath,
      dataRoot: target.dataRoot,
      bundleRoot,
      validateOnly: true,
    });
    expect(result).toMatchObject({ databaseWrites: 0, assetWrites: 0, validatedOnly: true });
    expect(readFileSync(target.databasePath)).toEqual(before);
  });

  it("preserves production Knowledge V2 0050 and advances through 0063", () => {
    const target = createProduction0050Target();
    const result = applyInspirationWikiProductionBundle({
      databasePath: target.databasePath,
      dataRoot: target.dataRoot,
      bundleRoot,
    });
    expect(result.databaseWrites).toBeGreaterThan(100);
    const database = new Database(target.databasePath, { readonly: true });
    expect(database.prepare("SELECT count(*) count FROM __drizzle_migrations").get())
      .toEqual({ count: 64 });
    expect(database.prepare(
      "SELECT count(*) count FROM sqlite_master WHERE type='table' AND name='knowledge_documents_v2'",
    ).get()).toEqual({ count: 1 });
    expect(database.prepare(
      "SELECT count(*) count FROM sqlite_master WHERE type='table' AND name='inspiration_wiki_role_policies'",
    ).get()).toEqual({ count: 1 });
    expect(database.pragma("foreign_key_check")).toEqual([]);
    database.close();
  });
});

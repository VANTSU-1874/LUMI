import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { createDb } from "./client";

const defaultMigrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

type MigrationJournal = {
  entries: Array<{ tag: string; when: number }>;
};

type MigrationRecord = { createdAt: number | string; hash: string };
type MigrationFile = { folderMillis: number; hash: string; sql: string[] };

const LEGACY_EOL_HASH_ALIASES = [{
  folderMillis: 1_783_855_846_605,
  rawHash: "a025984b3db8b97e380c48de517a6435e0c2fba35f06fc32260ca07abceb4e63",
  normalizedLfHash: "09a8cbf140470cf52d2d1883490e86103b2b2c23488b64fa6c17885ea47d8c2f",
}, {
  // The local S2 database had already applied the first renumbered 0051
  // before the displaced 0049 governance DDL was folded into that migration.
  // Accept its exact old hash only when the checked-in repaired SQL also
  // matches this known normalized hash. Fresh and production databases run
  // the repaired migration and never take this alias path.
  folderMillis: 1_786_497_658_324,
  rawHash: "a19c0ef5d7e9af9aa6a5c70033d873152b0b22b039feb95f53ac358fd6fc4685",
  normalizedLfHash: "b11c2c15a4a2cd13e808e538df5ebceb34e152e980c738f7d12a236db5966a20",
}] as const;

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function acceptedMigrationHashes(
  migrationsFolder: string,
  journal: MigrationJournal,
) {
  return journal.entries.map(({ tag, when }) => {
    const raw = readFileSync(
      path.join(migrationsFolder, `${tag}.sql`),
      "utf8",
    );
    const lf = raw.replace(/\r\n?|\n/g, "\n");
    const crlf = lf.replace(/\n/g, "\r\n");
    const hashes = new Set([sha256(raw), sha256(lf), sha256(crlf)]);
    for (const alias of LEGACY_EOL_HASH_ALIASES) {
      if (
        alias.folderMillis === when
        && alias.normalizedLfHash === sha256(lf)
      ) {
        hashes.add(alias.rawHash);
      }
    }
    return hashes;
  });
}

function reconcileLegacyLocalInspirationHistory(
  connection: ReturnType<typeof createDb>,
  applied: MigrationRecord[],
  migrations: MigrationFile[],
  acceptedHashes: Array<Set<string>>,
) {
  // The local S1/S2 worktree originally occupied 0048–0062. Production already
  // owned 0048–0050, so the canonical history keeps those three production
  // migrations and folds the local 0048–0050 schema into repaired 0051 before
  // continuing through 0063. Reconcile only the exact known local fork; any
  // partial or altered lineage remains fail-closed.
  const legacyStart = applied.findIndex((record) => Number(record.createdAt) === 1_786_272_000_000);
  if (legacyStart < 0) return false;
  if (legacyStart !== 48 || applied.length !== 63 || migrations.length !== 64) {
    throw new Error(`LEGACY_LOCAL_INSPIRATION_HISTORY_SHAPE_MISMATCH:${legacyStart}:${applied.length}:${migrations.length}`);
  }
  const legacyPrefix = [
    { createdAt: 1_786_272_000_000, hash: "f63a076d327f0e3aeb3df224ff3329ae953abe667e3eb60d780ff0f6ac180e2a" },
    { createdAt: 1_786_367_793_747, hash: "56a378385e9b5b62be57f8287dc971d03b74fb4c11ae060173daa96bacd58fb4" },
    { createdAt: 1_786_497_658_324, hash: "a19c0ef5d7e9af9aa6a5c70033d873152b0b22b039feb95f53ac358fd6fc4685" },
  ];
  for (const [offset, expected] of legacyPrefix.entries()) {
    const record = applied[48 + offset];
    if (Number(record?.createdAt) !== expected.createdAt || record?.hash !== expected.hash) {
      throw new Error(`LEGACY_LOCAL_INSPIRATION_HISTORY_PREFIX_MISMATCH:${offset}`);
    }
  }
  for (let appliedIndex = 51; appliedIndex < applied.length; appliedIndex += 1) {
    const canonicalIndex = appliedIndex + 1;
    const record = applied[appliedIndex]!;
    const migration = migrations[canonicalIndex];
    if (
      !migration
      || Number(record.createdAt) !== migration.folderMillis
      || !acceptedHashes[canonicalIndex]?.has(record.hash)
    ) throw new Error(`LEGACY_LOCAL_INSPIRATION_HISTORY_TAIL_MISMATCH:${appliedIndex}`);
  }
  const requiredLegacyObjects = [
    "inspiration_wiki_role_policies",
    "inspiration_wiki_reviewer_assignments",
    "inspiration_wiki_hermes_batches",
    "inspiration_wiki_formal_releases",
  ];
  const forbiddenProductionObjects = ["agent_run_interventions", "preview_sessions", "knowledge_corpora_v2"];
  const objectExists = (name: string) => Boolean(connection.sqlite.prepare(
    "SELECT 1 present FROM sqlite_master WHERE name = ?",
  ).get(name));
  if (!requiredLegacyObjects.every(objectExists)) {
    throw new Error("LEGACY_LOCAL_INSPIRATION_REQUIRED_OBJECT_MISSING");
  }
  if (forbiddenProductionObjects.some(objectExists)) {
    throw new Error("LEGACY_LOCAL_INSPIRATION_PRODUCTION_OBJECT_ALREADY_PRESENT");
  }

  for (const migration of migrations.slice(48, 51)) {
    for (const statement of migration.sql) connection.sqlite.exec(statement);
  }
  connection.sqlite.prepare(
    "DELETE FROM __drizzle_migrations WHERE created_at >= ?",
  ).run(legacyPrefix[0]!.createdAt);
  const insert = connection.sqlite.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );
  for (const migration of migrations.slice(48)) insert.run(migration.hash, migration.folderMillis);
  return true;
}

export function runMigrations(
  databasePath: string,
  migrationsFolder = defaultMigrationsFolder,
) {
  const resolvedDatabasePath = path.resolve(databasePath);
  mkdirSync(path.dirname(resolvedDatabasePath), { recursive: true });
  const connection = createDb(resolvedDatabasePath);

  try {
    // SQLite cannot toggle foreign-key enforcement from inside Drizzle's
    // migration transaction. Disable it before that transaction so table
    // rebuild migrations can safely replace referenced parent tables, then
    // audit the completed schema before accepting it.
    connection.sqlite.pragma("foreign_keys = OFF");
    const migrations = readMigrationFiles({ migrationsFolder: path.resolve(migrationsFolder) });
    connection.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )
    `);
    connection.sqlite.transaction(() => {
      // BEGIN IMMEDIATE is acquired before observing migration state. A
      // concurrent first-run migrator may have completed while this connection
      // was waiting for the writer lock, so no state read may live outside it.
      let applied = connection.sqlite.prepare(
        "SELECT created_at createdAt, hash FROM __drizzle_migrations ORDER BY created_at, id",
      ).all() as MigrationRecord[];
      if (reconcileLegacyLocalInspirationHistory(
        connection,
        applied,
        migrations as MigrationFile[],
        acceptedHashes,
      )) {
        applied = connection.sqlite.prepare(
          "SELECT created_at createdAt, hash FROM __drizzle_migrations ORDER BY created_at, id",
        ).all() as MigrationRecord[];
      }
      if (applied.length > migrations.length) {
        throw new Error("MIGRATION_HISTORY_AHEAD_OF_SOURCE");
      }
      for (const [index, record] of applied.entries()) {
        const migration = migrations[index];
        if (
          index > 0
          && Number(applied[index - 1]!.createdAt) === Number(record.createdAt)
        ) {
          throw new Error(`MIGRATION_HISTORY_DUPLICATE:${String(record.createdAt)}`);
        }
        if (!migration || Number(record.createdAt) !== migration.folderMillis) {
          throw new Error(`MIGRATION_HISTORY_GAP:${String(record.createdAt)}`);
        }
        if (!acceptedHashes[index]?.has(record.hash)) {
          throw new Error(`MIGRATION_HISTORY_HASH_DRIFT:${migration.folderMillis}`);
        }
      }
      for (const migration of migrations.slice(applied.length)) {
        for (const statement of migration.sql) connection.sqlite.exec(statement);
        connection.sqlite.prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        ).run(migration.hash, migration.folderMillis);
        latest = { created_at: migration.folderMillis };
      }
      const violations = connection.sqlite.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(`迁移后外键校验失败：${JSON.stringify(violations)}`);
      }
    }).immediate();
  } finally {
    connection.sqlite.pragma("foreign_keys = ON");
    connection.sqlite.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";

if (invokedPath === import.meta.url) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  runMigrations(process.env.DATABASE_PATH ?? "./data/tonggan.sqlite");
}

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";

import {
  loadRuntimeEnvironment,
  writeEffectiveDatabaseConfigNotice,
} from "../config/runtime-environment";
import { createDb } from "./client";

const defaultMigrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

type MigrationJournal = {
  entries: Array<{ tag: string; when: number }>;
};

const LEGACY_EOL_HASH_ALIASES = [{
  folderMillis: 1_783_855_846_605,
  rawHash: "a025984b3db8b97e380c48de517a6435e0c2fba35f06fc32260ca07abceb4e63",
  normalizedLfHash: "09a8cbf140470cf52d2d1883490e86103b2b2c23488b64fa6c17885ea47d8c2f",
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
    const resolvedMigrationsFolder = path.resolve(migrationsFolder);
    const migrations = readMigrationFiles({
      migrationsFolder: resolvedMigrationsFolder,
    });
    const journal = JSON.parse(readFileSync(
      path.join(resolvedMigrationsFolder, "meta", "_journal.json"),
      "utf8",
    )) as MigrationJournal;
    const acceptedHashes = acceptedMigrationHashes(
      resolvedMigrationsFolder,
      journal,
    );
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
      const applied = connection.sqlite.prepare(
        "SELECT created_at createdAt, hash FROM __drizzle_migrations ORDER BY created_at, id",
      ).all() as Array<{ createdAt: number | string; hash: string }>;
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
  void loadRuntimeEnvironment({ mode: "EXPLICIT_SERVICE_OR_PROJECT" })
    .then((loaded) => {
      const databasePath = loaded.environment.DATABASE_PATH ?? "./data/tonggan.sqlite";
      writeEffectiveDatabaseConfigNotice(
        { databasePath },
        loaded.provenance,
        loaded.environment,
      );
      runMigrations(databasePath);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

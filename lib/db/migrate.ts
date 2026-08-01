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
      let latest = connection.sqlite.prepare(
        "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
      ).get() as { created_at: number } | undefined;
      for (const migration of migrations) {
        if (latest && Number(latest.created_at) >= migration.folderMillis) continue;
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

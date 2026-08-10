import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import { backfillAgentMessages } from "@/lib/agent/agent-message-store";
import { readEnv } from "@/lib/config/env";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

export function runAgentMessageBackfill(environment = process.env) {
  const config = readEnv(environment);
  const databasePath = path.resolve(config.databasePath);
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  try {
    return backfillAgentMessages(connection);
  } finally {
    connection.sqlite.close();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (invokedPath === import.meta.url) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  try {
    process.stdout.write(`${JSON.stringify(runAgentMessageBackfill())}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

import path from "node:path";
import { pathToFileURL } from "node:url";

import { readEnv } from "@/lib/config/env";
import { loadRuntimeEnvironment } from "@/lib/config/runtime-environment";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";

export async function runKnowledgeIngestion(
  environment: Record<string, string | undefined> = process.env,
) {
  const config = readEnv(environment);
  runMigrations(config.databasePath);
  const connection = createDb(path.resolve(config.databasePath));
  try {
    return await ingestCoursePackKnowledge(connection);
  } finally {
    connection.sqlite.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  loadRuntimeEnvironment({ mode: "EXPLICIT_SERVICE_OR_PROJECT" })
    .then(({ environment }) => runKnowledgeIngestion(environment)).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

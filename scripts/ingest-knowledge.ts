import path from "node:path";
import { pathToFileURL } from "node:url";

import { readEnv } from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
  writeEffectiveDatabaseConfigNotice,
} from "@/lib/config/runtime-environment";
import {
  applyPreparedKnowledgeIngestion,
  prepareKnowledgeIngestion,
} from "@/lib/knowledge/knowledge-ingestion-pipeline";

export async function runKnowledgeIngestion(
  environment: Record<string, string | undefined> = process.env,
  options: { workspaceRoot?: string } = {},
) {
  const config = readEnv(environment);
  const prepared = await prepareKnowledgeIngestion({
    knowledgeObjectV2Enabled: config.knowledgeObjectV2Enabled,
    workspaceRoot: options.workspaceRoot,
  });
  return applyPreparedKnowledgeIngestion(config.databasePath, prepared);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  loadRuntimeEnvironment({ mode: "EXPLICIT_SERVICE_OR_PROJECT" })
    .then((loaded) => {
      const config = readEnv(loaded.environment);
      writeEffectiveDatabaseConfigNotice(config, loaded.provenance, loaded.environment);
      return runKnowledgeIngestion(loaded.environment);
    }).then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

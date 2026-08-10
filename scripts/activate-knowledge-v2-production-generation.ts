import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readEnv } from "@/lib/config/env";
import { loadRuntimeEnvironment } from "@/lib/config/runtime-environment";
import {
  activateKnowledgeV2ProductionGeneration,
} from "@/lib/operations/knowledge-v2-production-generation";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function parseKnowledgeV2ProductionActivationArguments(
  argv: readonly string[],
) {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  if (
    args.length !== 2
    || args[0] !== "--expected-commit"
    || !/^[a-f0-9]{40}$/.test(args[1] ?? "")
  ) {
    throw new Error(
      "usage: activate-knowledge-v2-production-generation.ts --expected-commit <40-lowercase-hex>",
    );
  }
  return { expectedCommit: args[1]! };
}

export async function runKnowledgeV2ProductionActivation(input: {
  expectedCommit: string;
}) {
  if (process.platform !== "linux") {
    throw new Error("KNOWLEDGE_V2_PRODUCTION_LINUX_REQUIRED");
  }
  const loaded = await loadRuntimeEnvironment({
    cwd: workspaceRoot,
    mode: "SERVICE_REQUIRED",
    nodeEnv: "production",
  });
  if (loaded.provenance.database.source !== "service-env") {
    throw new Error("KNOWLEDGE_V2_PRODUCTION_SERVICE_DATABASE_REQUIRED");
  }
  const config = readEnv(loaded.environment);
  const result = await activateKnowledgeV2ProductionGeneration({
    workspaceRoot,
    databasePath: path.resolve(workspaceRoot, config.databasePath),
    expectedCommit: input.expectedCommit,
  });
  const output = {
    ...result,
    database: "SERVICE_ENV_DATABASE",
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return output;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (invokedPath === import.meta.url) {
  runKnowledgeV2ProductionActivation(
    parseKnowledgeV2ProductionActivationArguments(process.argv.slice(2)),
  ).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "KNOWLEDGE_V2_PRODUCTION_ACTIVATION_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}

import path from "node:path";

import { z } from "zod";

export const RagAgentHarnessModeSchema = z.enum([
  "deterministic",
  "real-model",
]);

const RunIdSchema = z.string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export type RagAgentHarnessCliArgs = {
  mode: z.infer<typeof RagAgentHarnessModeSchema>;
  runId: string;
  resume: boolean;
  keepDb: boolean;
};

export function resolveAuthorizedRagHarnessModelId(
  configuredModelId: string,
) {
  const candidate =
    configuredModelId.trim().toLowerCase();
  if (
    candidate !== "gpt-5.6-luna"
    && candidate !== "gpt-5.6 luna"
  ) {
    throw new Error(
      `RAG_AGENT_HARNESS_MODEL_NOT_AUTHORIZED:${configuredModelId}`,
    );
  }
  return "gpt-5.6-luna";
}

export function parseRagAgentHarnessArgs(
  argv: readonly string[],
): RagAgentHarnessCliArgs {
  let mode: z.infer<
    typeof RagAgentHarnessModeSchema
  > | null = null;
  let runId: string | null = null;
  let resume = false;
  let keepDb = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--") {
      continue;
    }
    if (argument === "--mode") {
      const parsed =
        RagAgentHarnessModeSchema.safeParse(
          argv[index + 1],
        );
      if (!parsed.success) {
        throw new Error(
          "RAG_AGENT_HARNESS_MODE_INVALID",
        );
      }
      mode = parsed.data;
      index += 1;
      continue;
    }
    if (argument === "--run-id") {
      const parsed =
        RunIdSchema.safeParse(argv[index + 1]);
      if (!parsed.success) {
        throw new Error(
          "RAG_AGENT_HARNESS_RUN_ID_INVALID",
        );
      }
      runId = parsed.data;
      index += 1;
      continue;
    }
    if (argument === "--resume") {
      resume = true;
      continue;
    }
    if (argument === "--keep-db") {
      keepDb = true;
      continue;
    }
    throw new Error(
      `RAG_AGENT_HARNESS_ARGUMENT_UNKNOWN:${argument}`,
    );
  }
  if (!mode) {
    throw new Error("RAG_AGENT_HARNESS_MODE_REQUIRED");
  }
  if (resume && !runId) {
    throw new Error(
      "RAG_AGENT_HARNESS_RESUME_RUN_ID_REQUIRED",
    );
  }
  return {
    mode,
    runId:
      runId
      ?? `${mode}-${Date.now().toString(36)}`,
    resume,
    keepDb,
  };
}

export function ragAgentHarnessRunPaths(input: {
  runtimeRoot: string;
  runId: string;
}) {
  const runId = RunIdSchema.safeParse(input.runId);
  if (!runId.success) {
    throw new Error(
      "RAG_AGENT_HARNESS_RUN_ID_INVALID",
    );
  }
  const runtimeRoot = path.resolve(input.runtimeRoot);
  const runDirectory = path.resolve(
    runtimeRoot,
    runId.data,
  );
  const relative = path.relative(
    runtimeRoot,
    runDirectory,
  );
  if (
    relative.startsWith("..")
    || path.isAbsolute(relative)
  ) {
    throw new Error(
      "RAG_AGENT_HARNESS_RUN_PATH_INVALID",
    );
  }
  return {
    runDirectory,
    checkpointDirectory: path.join(
      runDirectory,
      "checkpoints",
    ),
    reportPath: path.join(
      runDirectory,
      "report.json",
    ),
    databasePath: path.join(
      runDirectory,
      "harness.sqlite",
    ),
  };
}

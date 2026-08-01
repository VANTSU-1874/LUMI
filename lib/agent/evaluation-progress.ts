import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";
import { z } from "zod";

import {
  assertEvaluationTextSafe,
  containsConfiguredSecret,
} from "./evaluation-safety";
import { AgentEvaluationCaseResultSchema } from "./evaluation";
import {
  ReleaseInferenceConfigSchema,
  ReleaseRuntimeBindingSchema,
  ReleaseSourceBindingSchema,
  sameReleaseInferenceConfig,
  sameReleaseRuntimeBinding,
  sameReleaseSourceBinding,
} from "./release-source-binding";

const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const;
const RETRYABLE_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
export type AgentEvaluationRunLock = {
  filePath: string;
  release(): void;
};

export const AgentEvaluationProgressSchema = z.object({
  schemaVersion: z.literal(6),
  ...ReleaseSourceBindingSchema.shape,
  inferenceConfig: ReleaseInferenceConfigSchema,
  runtime: ReleaseRuntimeBindingSchema,
  suiteVersion: z.string(),
  suiteHash: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(["MODEL_ASSISTED", "DETERMINISTIC_BASELINE"]),
  status: z.enum(["RUNNING", "RATE_LIMITED"]),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  cooldownUntil: z.string().datetime().nullable(),
  nextCaseIndex: z.number().int().nonnegative(),
  results: z.array(AgentEvaluationCaseResultSchema).max(200),
}).strict().superRefine((progress, context) => {
  if (progress.nextCaseIndex !== progress.results.length) {
    context.addIssue({ code: "custom", message: "nextCaseIndex must match completed results" });
  }
  if (progress.status === "RATE_LIMITED" && progress.cooldownUntil === null) {
    context.addIssue({ code: "custom", message: "rate-limited progress requires cooldownUntil" });
  }
  if (progress.status === "RUNNING" && progress.cooldownUntil !== null) {
    context.addIssue({ code: "custom", message: "running progress must not have cooldownUntil" });
  }
});

export type AgentEvaluationProgress = z.infer<typeof AgentEvaluationProgressSchema>;
export type AgentEvaluationProgressSafetyOptions = {
  configuredSecret?: string;
};
export type AgentEvaluationProgressFingerprint = Pick<
  AgentEvaluationProgress,
  | "sourceCommit"
  | "sourceStatusHash"
  | "sourceTrackedTreeClean"
  | "inferenceConfig"
  | "runtime"
  | "suiteVersion"
  | "suiteHash"
  | "mode"
>;

const SENSITIVE_PROGRESS_ERROR = "AGENT_EVAL_PROGRESS_SENSITIVE_TEXT_DETECTED";

function assertAgentEvaluationProgressSafe(
  progress: unknown,
  options: AgentEvaluationProgressSafetyOptions,
) {
  if (containsConfiguredSecret(progress, options.configuredSecret)) {
    throw new Error(SENSITIVE_PROGRESS_ERROR);
  }
  const results = progress && typeof progress === "object" && "results" in progress
    ? progress.results
    : [];
  assertEvaluationTextSafe(results, undefined, SENSITIVE_PROGRESS_ERROR);
}

export function agentEvaluationProgressMatches(
  progress: AgentEvaluationProgress,
  expected: AgentEvaluationProgressFingerprint,
) {
  return sameReleaseSourceBinding(progress, expected)
    && sameReleaseRuntimeBinding(progress.runtime, expected.runtime)
    && sameReleaseInferenceConfig(progress.inferenceConfig, expected.inferenceConfig)
    && progress.suiteVersion === expected.suiteVersion
    && progress.suiteHash === expected.suiteHash
    && progress.mode === expected.mode;
}

async function replaceCheckpoint(temporaryPath: string, filePath: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporaryPath, filePath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (!delay || !code || !RETRYABLE_RENAME_CODES.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function acquireAgentEvaluationRunLock(
  filePath: string,
): Promise<AgentEvaluationRunLock> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  try {
    sqlite.pragma("busy_timeout = 0");
    sqlite.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    sqlite.close();
    if ((error as { code?: string }).code === "SQLITE_BUSY") {
      throw new Error("AGENT_EVAL_ALREADY_RUNNING");
    }
    throw error;
  }
  let released = false;
  return {
    filePath,
    release() {
      if (released) return;
      released = true;
      try {
        if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
      } finally {
        sqlite.close();
      }
    },
  };
}

export async function releaseAgentEvaluationRunLock(lock: AgentEvaluationRunLock) {
  lock.release();
}

export async function writeAgentEvaluationLatest(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await replaceCheckpoint(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function readAgentEvaluationProgress(
  filePath: string,
  options: AgentEvaluationProgressSafetyOptions = {},
) {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    try {
      assertAgentEvaluationProgressSafe(raw, options);
    } catch (error) {
      await rm(filePath, { force: true });
      throw error;
    }
    if (
      raw
      && typeof raw === "object"
      && "schemaVersion" in raw
      && raw.schemaVersion !== 6
    ) {
      await rm(filePath, { force: true });
      return null;
    }
    return AgentEvaluationProgressSchema.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeAgentEvaluationProgress(
  filePath: string,
  rawProgress: AgentEvaluationProgress,
  options: AgentEvaluationProgressSafetyOptions = {},
) {
  const progress = AgentEvaluationProgressSchema.parse(rawProgress);
  assertAgentEvaluationProgressSafe(progress, options);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
    await replaceCheckpoint(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function clearAgentEvaluationProgress(filePath: string) {
  await rm(filePath, { force: true });
}

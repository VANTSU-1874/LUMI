import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  assertEvaluationTextSafe,
  containsConfiguredSecret,
} from "./evaluation-safety";
import { ReleaseInferenceConfigSchema } from "./release-source-binding";
import {
  TutorQualityCaseResultSchema,
  TutorQualityObservedAnswerSchema,
} from "./tutor-quality-evaluation";
import {
  TutorQualityKnowledgeArmSchema,
} from "./tutor-quality-ab";
import { TUTOR_QUALITY_CASE_COUNT } from "./tutor-quality-suite";

const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const;
const RETRYABLE_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

export const TutorQualityProgressFingerprintSchema = z.object({
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  sourceStatusHash: z.string().regex(/^[a-f0-9]{64}$/),
  runtimeId: z.string().min(1).max(80),
  runtimeVersion: z.string().min(1).max(40),
  runtimeGeneration: z.literal("V3"),
  inferenceConfig: ReleaseInferenceConfigSchema,
  suiteVersion: z.string().min(1).max(40),
  suiteHash: z.string().regex(/^[a-f0-9]{64}$/),
  rubricVersion: z.string().min(1).max(40),
  mode: z.enum(["REAL_MODEL_BASELINE", "DEVELOPMENT_CHECK", "FIXTURE_VALIDATION"]),
  knowledgeArm:
    TutorQualityKnowledgeArmSchema.nullable(),
}).strict();

const TutorQualityAnsweredProgressSchema = z.object({
  caseId: z.string().regex(/^[a-z0-9-]+$/),
  stage: z.literal("ANSWERED"),
  answer: TutorQualityObservedAnswerSchema,
}).strict();

const TutorQualityJudgedProgressSchema = z.object({
  caseId: z.string().regex(/^[a-z0-9-]+$/),
  stage: z.literal("JUDGED"),
  result: TutorQualityCaseResultSchema,
}).strict().superRefine((entry, context) => {
  if (entry.caseId !== entry.result.caseId) {
    context.addIssue({ code: "custom", path: ["result", "caseId"], message: "case ids must match" });
  }
});

export const TutorQualityProgressEntrySchema = z.discriminatedUnion("stage", [
  TutorQualityAnsweredProgressSchema,
  TutorQualityJudgedProgressSchema,
]);

export const TutorQualityProgressSchema = z.object({
  schemaVersion: z.literal(5),
  fingerprint: TutorQualityProgressFingerprintSchema,
  fingerprintHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["RUNNING", "RATE_LIMITED"]),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  cooldownUntil: z.string().datetime().nullable(),
  entries: z.array(TutorQualityProgressEntrySchema).max(TUTOR_QUALITY_CASE_COUNT),
}).strict().superRefine((progress, context) => {
  if (progress.fingerprintHash !== hashTutorQualityProgressFingerprint(progress.fingerprint)) {
    context.addIssue({ code: "custom", path: ["fingerprintHash"], message: "fingerprint hash mismatch" });
  }
  if (progress.status === "RATE_LIMITED" && progress.cooldownUntil === null) {
    context.addIssue({ code: "custom", path: ["cooldownUntil"], message: "rate limit requires cooldown" });
  }
  if (progress.status === "RUNNING" && progress.cooldownUntil !== null) {
    context.addIssue({ code: "custom", path: ["cooldownUntil"], message: "running progress cannot have cooldown" });
  }
  const ids = progress.entries.map(({ caseId }) => caseId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "progress case ids must be unique" });
  }
  const answered = progress.entries.findIndex(({ stage }) => stage === "ANSWERED");
  if (answered >= 0 && answered !== progress.entries.length - 1) {
    context.addIssue({ code: "custom", path: ["entries"], message: "only the final progress entry may await judgment" });
  }
});

export type TutorQualityProgressFingerprint = z.infer<typeof TutorQualityProgressFingerprintSchema>;
export type TutorQualityProgress = z.infer<typeof TutorQualityProgressSchema>;
export type TutorQualityProgressEntry = z.infer<typeof TutorQualityProgressEntrySchema>;

export type TutorQualityProgressSafetyOptions = {
  configuredSecret?: string;
};

const SENSITIVE_PROGRESS_ERROR = "TUTOR_QUALITY_PROGRESS_SENSITIVE_TEXT_DETECTED";

function assertTutorQualityProgressSafe(
  progress: unknown,
  options: TutorQualityProgressSafetyOptions,
) {
  if (containsConfiguredSecret(progress, options.configuredSecret)) {
    throw new Error(SENSITIVE_PROGRESS_ERROR);
  }
  const entries = progress && typeof progress === "object" && "entries" in progress
    ? progress.entries
    : [];
  assertEvaluationTextSafe(entries, undefined, SENSITIVE_PROGRESS_ERROR);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function hashTutorQualityProgressFingerprint(raw: TutorQualityProgressFingerprint) {
  const fingerprint = TutorQualityProgressFingerprintSchema.parse(raw);
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(fingerprint)), "utf8")
    .digest("hex");
}

export function tutorQualityProgressMatches(
  progress: TutorQualityProgress,
  fingerprint: TutorQualityProgressFingerprint,
) {
  return progress.fingerprintHash === hashTutorQualityProgressFingerprint(fingerprint);
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

export async function readTutorQualityProgress(
  filePath: string,
  options: TutorQualityProgressSafetyOptions = {},
) {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    try {
      assertTutorQualityProgressSafe(raw, options);
    } catch (error) {
      await rm(filePath, { force: true });
      throw error;
    }
    if (
      raw
      && typeof raw === "object"
      && "schemaVersion" in raw
      && raw.schemaVersion !== 5
    ) {
      await rm(filePath, { force: true });
      return null;
    }
    const progress = TutorQualityProgressSchema.parse(raw);
    return progress;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeTutorQualityProgress(
  filePath: string,
  rawProgress: TutorQualityProgress,
  options: TutorQualityProgressSafetyOptions = {},
) {
  const progress = TutorQualityProgressSchema.parse(rawProgress);
  assertTutorQualityProgressSafe(progress, options);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
    await replaceCheckpoint(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function clearTutorQualityProgress(filePath: string) {
  await rm(filePath, { force: true });
}

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clearTutorQualityProgress,
  hashTutorQualityProgressFingerprint,
  readTutorQualityProgress,
  tutorQualityProgressMatches,
  TutorQualityProgressSchema,
  writeTutorQualityProgress,
  type TutorQualityProgress,
  type TutorQualityProgressFingerprint,
} from "@/lib/agent/tutor-quality-progress";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const fingerprint: TutorQualityProgressFingerprint = {
  sourceCommit: "a".repeat(40),
  sourceStatusHash: "b".repeat(64),
  runtimeId: "current-agent-runtime",
  runtimeVersion: "1.0.0",
  runtimeGeneration: "V3",
  inferenceConfig: {
    providerMode: "OPENAI_COMPATIBLE",
    modelId: "gpt-5.6",
    endpointHash: "c".repeat(64),
    retrievalModelId: "text-embedding-3-large",
    maxOutputTokens: 2048,
    modelIdleTimeoutMs: 120_000,
    modelTotalTimeoutMs: 600_000,
    turnTotalTimeoutMs: 900_000,
    vision: true,
  },
  suiteVersion: "2026-07-18.1",
  suiteHash: "d".repeat(64),
  rubricVersion: "2026-07-18.1",
  mode: "REAL_MODEL_BASELINE",
};

const safeAnswer = {
  aiMode: "MODEL_ASSISTED" as const,
  v3PathObserved: true,
  coursePackId: "general-design",
  title: "先做单变量比较",
  message: "复制当前版本，只改一个层级变量，再比较观看顺序。",
  uncertainty: "这是通用设计经验，需要结合实际作品观察。",
  sources: [],
  basis: [{ kind: "GENERAL_DESIGN", label: "通用设计经验" }],
  executionSteps: [],
  latencyMs: 1,
  modelErrors: [],
};

function progress(entries: TutorQualityProgress["entries"] = []): TutorQualityProgress {
  return {
    schemaVersion: 4,
    fingerprint,
    fingerprintHash: hashTutorQualityProgressFingerprint(fingerprint),
    status: "RUNNING",
    startedAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:01:00.000Z",
    cooldownUntil: null,
    entries,
  };
}

async function target() {
  const root = await mkdtemp(path.join(tmpdir(), "tutor-quality-progress-"));
  roots.push(root);
  return { root, filePath: path.join(root, "progress.json") };
}

describe("tutor quality progress", () => {
  it("writes and reads an atomic checkpoint bound to the complete inference fingerprint", async () => {
    const { filePath } = await target();
    const checkpoint = progress();
    await writeTutorQualityProgress(filePath, checkpoint);
    const restored = await readTutorQualityProgress(filePath);
    expect(restored).toEqual(checkpoint);
    expect(tutorQualityProgressMatches(restored!, fingerprint)).toBe(true);

    for (const changed of [
      { ...fingerprint.inferenceConfig, providerMode: "TEST" as const },
      { ...fingerprint.inferenceConfig, modelId: "gpt-5.6-new" },
      { ...fingerprint.inferenceConfig, endpointHash: "e".repeat(64) },
      { ...fingerprint.inferenceConfig, retrievalModelId: "text-embedding-3-small" },
      { ...fingerprint.inferenceConfig, maxOutputTokens: 4096 },
      { ...fingerprint.inferenceConfig, modelIdleTimeoutMs: 90_000 },
      { ...fingerprint.inferenceConfig, modelTotalTimeoutMs: 540_000 },
      { ...fingerprint.inferenceConfig, turnTotalTimeoutMs: 840_000 },
      { ...fingerprint.inferenceConfig, vision: false },
    ]) {
      expect(tutorQualityProgressMatches(restored!, {
        ...fingerprint,
        inferenceConfig: changed,
      })).toBe(false);
    }

    await clearTutorQualityProgress(filePath);
    await expect(readTutorQualityProgress(filePath)).resolves.toBeNull();
  });

  it("rejects a forged fingerprint and an invalid cooldown shape", () => {
    expect(TutorQualityProgressSchema.safeParse({
      ...progress(),
      fingerprintHash: "f".repeat(64),
      status: "RATE_LIMITED",
      cooldownUntil: null,
    }).success).toBe(false);
  });

  it("rejects sensitive answer text before disk write and preserves a safe checkpoint", async () => {
    const { root, filePath } = await target();
    const safeCheckpoint = progress();
    await writeTutorQualityProgress(filePath, safeCheckpoint);
    const unsafe = progress([{
      caseId: "di-explore-goal",
      stage: "ANSWERED",
      answer: { ...safeAnswer, message: "请联系 student@example.com 继续测试。" },
    }]);

    await expect(writeTutorQualityProgress(filePath, unsafe))
      .rejects.toThrow("TUTOR_QUALITY_PROGRESS_SENSITIVE_TEXT_DETECTED");
    await expect(readTutorQualityProgress(filePath)).resolves.toEqual(safeCheckpoint);
    expect(await readdir(root)).toEqual(["progress.json"]);
  });

  it("rejects an opaque configured secret in a judged error without creating files", async () => {
    const { root, filePath } = await target();
    const configuredSecret = "opaque-current-provider-secret-value";
    const unsafe = progress([{
      caseId: "di-explore-goal",
      stage: "JUDGED",
      result: {
        caseId: "di-explore-goal",
        answer: safeAnswer,
        judgment: null,
        answerError: null,
        judgeError: configuredSecret,
        operationalFailures: [],
        scoreAverage: null,
        passed: false,
      },
    }]);

    await expect(writeTutorQualityProgress(filePath, unsafe, { configuredSecret }))
      .rejects.toThrow("TUTOR_QUALITY_PROGRESS_SENSITIVE_TEXT_DETECTED");
    await expect(readTutorQualityProgress(filePath)).resolves.toBeNull();
    expect(await readdir(root)).toEqual([]);
  });

  it("discards a sensitive restored checkpoint before it can be resumed", async () => {
    const { root, filePath } = await target();
    const unsafe = progress([{
      caseId: "di-explore-goal",
      stage: "ANSWERED",
      answer: { ...safeAnswer, modelErrors: ["attempt-1:student@example.com"] },
    }]);
    await writeFile(filePath, `${JSON.stringify(unsafe)}\n`, "utf8");

    await expect(readTutorQualityProgress(filePath))
      .rejects.toThrow("TUTOR_QUALITY_PROGRESS_SENSITIVE_TEXT_DETECTED");
    await expect(readTutorQualityProgress(filePath)).resolves.toBeNull();
    expect(await readdir(root)).toEqual([]);
  });

  it("does not resume a legacy schema checkpoint", async () => {
    const { root, filePath } = await target();
    await writeFile(filePath, JSON.stringify({ ...progress(), schemaVersion: 3 }), "utf8");
    await expect(readTutorQualityProgress(filePath)).resolves.toBeNull();
    expect(await readdir(root)).toEqual([]);
  });

  it("scans and deletes a sensitive legacy checkpoint before version discard", async () => {
    const { root, filePath } = await target();
    const configuredSecret = "opaque-current-provider-secret-value";
    await writeFile(filePath, JSON.stringify({
      ...progress([{
        caseId: "di-explore-goal",
        stage: "ANSWERED",
        answer: { ...safeAnswer, message: configuredSecret },
      }]),
      schemaVersion: 1,
    }), "utf8");

    await expect(readTutorQualityProgress(filePath, { configuredSecret }))
      .rejects.toThrow("TUTOR_QUALITY_PROGRESS_SENSITIVE_TEXT_DETECTED");
    expect(await readdir(root)).toEqual([]);
  });
});

// @vitest-environment node

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AgentEvaluationProgressSchema,
  acquireAgentEvaluationRunLock,
  agentEvaluationProgressMatches,
  clearAgentEvaluationProgress,
  readAgentEvaluationProgress,
  releaseAgentEvaluationRunLock,
  writeAgentEvaluationLatest,
  writeAgentEvaluationProgress,
} from "@/lib/agent/evaluation-progress";
import {
  agentEvaluationServiceInterruption,
  resumableAgentEvaluationInterruption,
} from "@/lib/agent/evaluation-service-interruption";
import { createModelErrorDiagnostics } from "@/lib/agent/model-error-diagnostics";
import { ModelServiceError } from "@/lib/ai/client";
import {
  CLEAN_RELEASE_SOURCE,
  LIVE_RELEASE_INFERENCE,
} from "@/tests/helpers/release-source-binding";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function progressPath() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-eval-progress-"));
  roots.push(root);
  return path.join(root, "quality", "agent-eval.progress.json");
}

const progress = {
  schemaVersion: 6 as const,
  ...CLEAN_RELEASE_SOURCE,
  inferenceConfig: LIVE_RELEASE_INFERENCE,
  runtime: {
    id: "current-agent-runtime",
    version: "1.0.0",
    generation: "V3" as const,
    entrypoint: "runTutorTurn" as const,
    agentV3Enabled: true as const,
  },
  suiteVersion: "2026-07-15.3",
  suiteHash: "a".repeat(64),
  mode: "MODEL_ASSISTED" as const,
  status: "RUNNING" as const,
  startedAt: "2026-07-15T12:00:00.000Z",
  updatedAt: "2026-07-15T12:01:00.000Z",
  cooldownUntil: null,
  nextCaseIndex: 0,
  results: [],
};

const safeResult = {
  caseId: "di-explore-goal",
  passed: true,
  scores: { routing: 1, answerRelevance: 1, sourcePrecision: 1, actionSafety: 1, safety: 1 },
  failures: [],
  advisories: [],
  observed: {
    coursePackId: "general-design",
    specialtyId: "GENERAL_DESIGN" as const,
    episode: "EXPLORE",
    aiMode: "MODEL_ASSISTED" as const,
    sourceIds: [],
    sourceTitles: [],
    sourceSelectionIds: [],
    sourceSelectionEventCount: 1,
    sourceSelectionStatus: "EMPTY" as const,
    actionTypes: [],
    actionStatuses: [],
    successfulToolIds: [],
    confirmedToolIds: [],
    appliedRules: ["STUDENT_CONFIRM_MUTATIONS", "FORBID_FORMAL_AUTHORITY"],
    title: "先确认目标",
    message: "先确认目标，再做一个小范围版本。",
    whyThisStep: "先确认最重要的设计变量。",
    uncertainty: "仍需实际观察。",
    modelErrors: [],
    modelRetryCount: 0,
    latencyMs: 1,
  },
};

describe("agent evaluation progress", () => {
  it("atomically persists, replaces, and clears a resumable checkpoint", async () => {
    const filePath = await progressPath();
    await writeAgentEvaluationProgress(filePath, progress);
    await expect(readAgentEvaluationProgress(filePath)).resolves.toEqual(progress);

    const completedPrefix = {
      ...progress,
      nextCaseIndex: 1,
      results: [safeResult],
    };
    await writeAgentEvaluationProgress(filePath, completedPrefix);
    await expect(readAgentEvaluationProgress(filePath)).resolves.toEqual(completedPrefix);

    const rateLimited = {
      ...progress,
      status: "RATE_LIMITED" as const,
      cooldownUntil: "2026-07-15T12:02:00.000Z",
    };
    await writeAgentEvaluationProgress(filePath, rateLimited);
    await expect(readAgentEvaluationProgress(filePath)).resolves.toEqual(rateLimited);

    for (let index = 0; index < 20; index += 1) {
      await writeAgentEvaluationProgress(filePath, {
        ...progress,
        updatedAt: `2026-07-15T12:01:${String(index).padStart(2, "0")}.000Z`,
      });
    }
    await expect(readAgentEvaluationProgress(filePath)).resolves.toMatchObject({ status: "RUNNING" });

    await clearAgentEvaluationProgress(filePath);
    await expect(readAgentEvaluationProgress(filePath)).resolves.toBeNull();
  });

  it("rejects inconsistent or corrupt checkpoints", async () => {
    expect(() => AgentEvaluationProgressSchema.parse({
      ...progress,
      status: "RATE_LIMITED",
    })).toThrow("cooldownUntil");
    expect(() => AgentEvaluationProgressSchema.parse({
      ...progress,
      nextCaseIndex: 1,
    })).toThrow("nextCaseIndex must match completed results");
    expect(() => AgentEvaluationProgressSchema.parse({
      ...progress,
      cooldownUntil: "2026-07-15T12:02:00.000Z",
    })).toThrow("running progress must not have cooldownUntil");

    const filePath = await progressPath();
    await writeAgentEvaluationProgress(filePath, progress);
    await writeFile(filePath, "not-json", "utf8");
    await expect(readAgentEvaluationProgress(filePath)).rejects.toThrow();
  });

  it.each([
    ["provider", { inferenceConfig: { ...progress.inferenceConfig, providerMode: "TEST" as const } }],
    ["model", { inferenceConfig: { ...progress.inferenceConfig, modelId: "gpt-5.6-other" } }],
    ["endpoint", { inferenceConfig: { ...progress.inferenceConfig, endpointHash: "f".repeat(64) } }],
    ["retrieval model", { inferenceConfig: { ...progress.inferenceConfig, retrievalModelId: "text-embedding-3-small" } }],
    ["output budget", { inferenceConfig: { ...progress.inferenceConfig, maxOutputTokens: 4096 } }],
    ["model idle timeout", { inferenceConfig: { ...progress.inferenceConfig, modelIdleTimeoutMs: 90_000 } }],
    ["model total timeout", { inferenceConfig: { ...progress.inferenceConfig, modelTotalTimeoutMs: 540_000 } }],
    ["turn total timeout", { inferenceConfig: { ...progress.inferenceConfig, turnTotalTimeoutMs: 840_000 } }],
    ["vision capability", { inferenceConfig: { ...progress.inferenceConfig, vision: false } }],
    ["runtime", { runtime: { ...progress.runtime, version: "2.0.0" } }],
    ["source commit", { sourceCommit: "f".repeat(40) }],
    ["source status", { sourceStatusHash: "f".repeat(64) }],
    ["source cleanliness", { sourceTrackedTreeClean: false }],
    ["suite version", { suiteVersion: "2026-07-17.5" }],
    ["suite hash", { suiteHash: "f".repeat(64) }],
    ["mode", { mode: "DETERMINISTIC_BASELINE" as const }],
  ] as const)("does not resume across a changed %s fingerprint", (_label, changed) => {
    expect(agentEvaluationProgressMatches(progress, {
      sourceCommit: progress.sourceCommit,
      sourceStatusHash: progress.sourceStatusHash,
      sourceTrackedTreeClean: progress.sourceTrackedTreeClean,
      inferenceConfig: progress.inferenceConfig,
      runtime: progress.runtime,
      suiteVersion: progress.suiteVersion,
      suiteHash: progress.suiteHash,
      mode: progress.mode,
      ...changed,
    })).toBe(false);
  });

  it("discards a legacy checkpoint that has no source binding", async () => {
    const filePath = await progressPath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({
      ...progress,
      schemaVersion: 1,
      sourceCommit: undefined,
      sourceStatusHash: undefined,
      sourceTrackedTreeClean: undefined,
    }), "utf8");
    await expect(readAgentEvaluationProgress(filePath)).resolves.toBeNull();
    expect(await readdir(path.dirname(filePath))).toEqual([]);
  });

  it("discards a safe schema-v5 checkpoint instead of resuming it", async () => {
    const filePath = await progressPath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ ...progress, schemaVersion: 5 }), "utf8");
    await expect(readAgentEvaluationProgress(filePath)).resolves.toBeNull();
    expect(await readdir(path.dirname(filePath))).toEqual([]);
  });

  it("rejects sensitive results before write and preserves a safe checkpoint", async () => {
    const filePath = await progressPath();
    await writeAgentEvaluationProgress(filePath, progress);
    const unsafe = {
      ...progress,
      nextCaseIndex: 1,
      results: [{
        ...safeResult,
        observed: { ...safeResult.observed, message: "联系 student@example.com" },
      }],
    };

    await expect(writeAgentEvaluationProgress(filePath, unsafe))
      .rejects.toThrow("AGENT_EVAL_PROGRESS_SENSITIVE_TEXT_DETECTED");
    await expect(readAgentEvaluationProgress(filePath)).resolves.toEqual(progress);
    expect(await readdir(path.dirname(filePath))).toEqual([path.basename(filePath)]);
  });

  it("deletes a sensitive restored or legacy checkpoint before cooldown resume", async () => {
    const filePath = await progressPath();
    const configuredSecret = "opaque-current-provider-secret-value";
    await mkdir(path.dirname(filePath), { recursive: true });
    const unsafe = {
      ...progress,
      status: "RATE_LIMITED" as const,
      cooldownUntil: "2099-07-18T12:02:00.000Z",
      nextCaseIndex: 1,
      results: [{
        ...safeResult,
        observed: { ...safeResult.observed, modelErrors: [configuredSecret] },
      }],
    };
    await writeFile(filePath, JSON.stringify(unsafe), "utf8");
    await expect(readAgentEvaluationProgress(filePath, { configuredSecret }))
      .rejects.toThrow("AGENT_EVAL_PROGRESS_SENSITIVE_TEXT_DETECTED");
    await expect(readAgentEvaluationProgress(filePath)).resolves.toBeNull();

    await writeFile(filePath, JSON.stringify({ ...unsafe, schemaVersion: 3 }), "utf8");
    await expect(readAgentEvaluationProgress(filePath, { configuredSecret }))
      .rejects.toThrow("AGENT_EVAL_PROGRESS_SENSITIVE_TEXT_DETECTED");
    expect(await readdir(path.dirname(filePath))).toEqual([]);
  });

  it("holds one OS-backed run lock and can reacquire it after release", async () => {
    const filePath = `${await progressPath()}.lock`;
    const first = await acquireAgentEvaluationRunLock(filePath);
    try {
      await expect(acquireAgentEvaluationRunLock(filePath))
        .rejects.toThrow("AGENT_EVAL_ALREADY_RUNNING");
    } finally {
      await releaseAgentEvaluationRunLock(first);
    }
    await expect(readFile(filePath)).resolves.toBeInstanceOf(Buffer);

    const reacquired = await acquireAgentEvaluationRunLock(filePath);
    await releaseAgentEvaluationRunLock(reacquired);
  });

  it("atomically replaces latest without leaving temporary files", async () => {
    const filePath = await progressPath();
    await writeAgentEvaluationLatest(filePath, "first\n");
    await writeAgentEvaluationLatest(filePath, "second\n");
    await expect(readFile(filePath, "utf8")).resolves.toBe("second\n");
    expect(await readdir(path.dirname(filePath))).toEqual([path.basename(filePath)]);
  });
});

describe("agent evaluation service interruption", () => {
  const response = (input: {
    aiMode?: "MODEL_ASSISTED" | "DETERMINISTIC_FALLBACK";
    errorCode?: string | null;
    incompleteReason?: "MODEL_TIMEOUT" | "MODEL_CONNECTION_INTERRUPTED" | "MODEL_OUTPUT_TRUNCATED";
    retainedMessage?: string;
  } = {}) => ({
    aiMode: input.aiMode ?? "DETERMINISTIC_FALLBACK",
    ...(input.incompleteReason ? {
      reply: {
        incomplete: { reason: input.incompleteReason },
        message: input.retainedMessage ?? "",
      },
    } : {}),
    runtimeEvents: input.errorCode === undefined ? [] : [{ kind: "DEGRADED", errorCode: input.errorCode }],
  });

  it.each([408, 425, 500, 502, 503, 504])(
    "marks transient provider HTTP %s failures as resumable",
    (status) => {
      expect(agentEvaluationServiceInterruption(
        new ModelServiceError("PROVIDER_STATUS", null, status),
      )).toEqual({ code: "PROVIDER_STATUS", resumable: true });
    },
  );

  it.each([400, 401, 403, 404, 409, 422, 501, 505, null])(
    "keeps permanent or unknown provider HTTP %s failures terminal",
    (status) => {
      expect(agentEvaluationServiceInterruption(
        new ModelServiceError("PROVIDER_STATUS", null, status),
      )).toEqual({ code: "PROVIDER_STATUS", resumable: false });
    },
  );

  it("recognizes timeout, turn-budget cancellation, transport, and rate-limit interruptions", () => {
    expect(agentEvaluationServiceInterruption(new ModelServiceError("TIMEOUT")))
      .toEqual({ code: "TIMEOUT", resumable: true });
    expect(agentEvaluationServiceInterruption(new ModelServiceError("CANCELLED")))
      .toEqual({ code: "TIMEOUT", resumable: true });
    expect(agentEvaluationServiceInterruption(new ModelServiceError("TRANSPORT")))
      .toEqual({ code: "TRANSPORT", resumable: true });
    expect(agentEvaluationServiceInterruption(new ModelServiceError("RATE_LIMIT")))
      .toEqual({ code: "RATE_LIMIT", resumable: true });
  });

  it("collects only bounded allowlisted model diagnostics", () => {
    const secret = "secret-provider-body";
    const diagnostics = createModelErrorDiagnostics({ redactValues: [secret] });
    diagnostics.record(new ModelServiceError("INVALID_RESPONSE", null, null, null, "BYTE_LIMIT"));
    const cause = Object.assign(new Error(`socket reset ${secret}`), { code: "ECONNRESET" });
    const transport = new ModelServiceError("TRANSPORT", null, null, "ECONNRESET", null, cause);
    diagnostics.record(transport);
    diagnostics.record(transport);

    const snapshot = diagnostics.snapshot();
    expect(snapshot).toMatchObject({
      errorCount: 2,
      modelProtocolErrorCodes: ["BYTE_LIMIT"],
      modelTransportErrorCodes: ["ECONNRESET"],
      errorEventsTruncated: false,
    });
    expect(snapshot.errorEvents).toHaveLength(2);
    expect(snapshot.errorEvents[1]?.causeChain).toHaveLength(2);
    expect(snapshot.errorEvents[1]?.causeChain[1]).toMatchObject({
      name: "Error",
      message: "model transport detail redacted",
      code: "ECONNRESET",
    });
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  });

  it("pauses deterministic fallback or an explicitly incomplete model response", () => {
    const timeout = { code: "TIMEOUT" as const, resumable: true };
    expect(resumableAgentEvaluationInterruption({
      response: response(),
      modelInterruptions: [timeout],
    })).toEqual(timeout);
    expect(resumableAgentEvaluationInterruption({
      response: response({ aiMode: "MODEL_ASSISTED" }),
      modelInterruptions: [timeout],
    })).toBeNull();
    expect(resumableAgentEvaluationInterruption({
      response: response({ aiMode: "MODEL_ASSISTED", incompleteReason: "MODEL_TIMEOUT" }),
      modelInterruptions: [],
    })).toEqual(timeout);
    expect(resumableAgentEvaluationInterruption({
      response: response({
        aiMode: "MODEL_ASSISTED",
        incompleteReason: "MODEL_CONNECTION_INTERRUPTED",
        retainedMessage: "已收到的局部回答",
      }),
      modelInterruptions: [{ code: "TRANSPORT", resumable: true }],
    })).toBeNull();
    expect(resumableAgentEvaluationInterruption({
      response: response({
        aiMode: "MODEL_ASSISTED",
        incompleteReason: "MODEL_CONNECTION_INTERRUPTED",
      }),
      modelInterruptions: [{ code: "TRANSPORT", resumable: true }],
    })).toEqual({ code: "TRANSPORT", resumable: true });
    expect(resumableAgentEvaluationInterruption({
      response: response({
        aiMode: "MODEL_ASSISTED",
        incompleteReason: "MODEL_OUTPUT_TRUNCATED",
      }),
      modelInterruptions: [],
    })).toBeNull();
    expect(resumableAgentEvaluationInterruption({
      response: response({ errorCode: "TRANSPORT" }),
      modelInterruptions: [],
    })).toEqual({ code: "TRANSPORT", resumable: true });
    expect(resumableAgentEvaluationInterruption({
      response: response({ errorCode: "TRANSPORT:ECONNRESET" }),
      modelInterruptions: [],
    })).toEqual({ code: "TRANSPORT", resumable: true });
    expect(resumableAgentEvaluationInterruption({
      response: response({ errorCode: "CANCELLED" }),
      modelInterruptions: [],
    })).toEqual({ code: "TIMEOUT", resumable: true });
    expect(resumableAgentEvaluationInterruption({
      response: response({ errorCode: "PROVIDER_STATUS" }),
      modelInterruptions: [],
    })).toBeNull();
  });

  it("does not turn invalid output or non-model errors into resumable outages", () => {
    expect(agentEvaluationServiceInterruption(new ModelServiceError("INVALID_RESPONSE"))).toBeNull();
    expect(agentEvaluationServiceInterruption(new Error("TIMEOUT"))).toBeNull();
    expect(resumableAgentEvaluationInterruption({
      response: response({ errorCode: "INVALID_RESPONSE" }),
      modelInterruptions: [{ code: "RATE_LIMIT", resumable: true }],
    })).toBeNull();
    expect(resumableAgentEvaluationInterruption({
      response: response({ errorCode: "INVALID_RESPONSE:BYTE_LIMIT" }),
      modelInterruptions: [{ code: "TRANSPORT", resumable: true }],
    })).toBeNull();
    expect(resumableAgentEvaluationInterruption({
      response: response({ errorCode: "PROVIDER_STATUS" }),
      modelInterruptions: [{ code: "PROVIDER_STATUS", resumable: false }],
    })).toBeNull();
  });
});

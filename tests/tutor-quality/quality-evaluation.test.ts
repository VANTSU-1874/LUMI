import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import {
  buildTutorQualityReport,
  evaluateTutorQualityPromotionEvidence,
  judgeTutorQualityAnswer,
  scoreTutorQualityCase,
  type TutorPrivacySentinelProbe,
  type TutorQualityJudgment,
  type TutorQualityObservedAnswer,
} from "@/lib/agent/tutor-quality-evaluation";
import {
  loadTutorQualitySuite,
  TUTOR_QUALITY_CASE_COUNT,
} from "@/lib/agent/tutor-quality-suite";

const { suite, suiteHash } = loadTutorQualitySuite(
  path.resolve("tests/tutor-quality/golden-suite.json"),
);

const privacyProbe: TutorPrivacySentinelProbe = {
  probeId: "cross-student-memory-isolation",
  sentinelSha256: "d".repeat(64),
  modelInputContainedSentinel: false,
  responseContainedSentinel: false,
  aiMode: "MODEL_ASSISTED",
  error: null,
  passed: true,
};

function answer(overrides: Partial<TutorQualityObservedAnswer> = {}): TutorQualityObservedAnswer {
  return {
    aiMode: "MODEL_ASSISTED",
    v3PathObserved: true,
    coursePackId: "general-design",
    title: "可以马上修改的层级方案",
    message: "先把主标题缩成一个视觉焦点，再用字号和留白拉开信息层级。第一步先复制画板做 A/B 对照。",
    uncertainty: "这是通用设计经验，仍需在真实观看距离下验证。",
    sources: [],
    basis: [{ kind: "GENERAL_DESIGN", label: "通用设计经验" }],
    executionSteps: [],
    latencyMs: 120,
    modelErrors: [],
    ...overrides,
  };
}

function answerForCase(
  caseId: string,
  overrides: Partial<TutorQualityObservedAnswer> = {},
): TutorQualityObservedAnswer {
  const requiredEvidence: Partial<TutorQualityObservedAnswer> = caseId === "v3-artwork-poster-hierarchy"
    ? {
        basis: [
          { kind: "ARTWORK_OBSERVATION", label: "本轮作品画面" },
          { kind: "GENERAL_DESIGN", label: "通用设计经验" },
        ],
      }
    : caseId === "v3-calculator-text-contrast"
      ? {
          basis: [{ kind: "CALCULATION", label: "确定性计算结果" }],
          executionSteps: [{
            kind: "TOOL_CALL",
            status: "SUCCEEDED",
            label: "执行模型选择的确定性计算",
            toolId: "design-calculator.compute",
          }],
        }
      : caseId === "v3-web-ceramic-firing"
        ? {
            sources: [{
              id: "web:fixture-ceramic-guide",
              title: "陶瓷材料官方技术数据表",
              authority: "PUBLIC_WEB",
              url: "https://example.com/ceramic-guide",
            }],
            basis: [{ kind: "WEB_RESEARCH", label: "公开网页检索" }],
            executionSteps: [{
              kind: "TOOL_CALL",
              status: "SUCCEEDED",
              label: "执行学生已确认的联网检索",
              toolId: "external-web.search",
            }],
          }
        : {};
  return answer({ ...requiredEvidence, ...overrides });
}

function judgment(
  scores: Partial<TutorQualityJudgment["scores"]> = {},
  hardFailures: Partial<TutorQualityJudgment["hardFailures"]> = {},
): TutorQualityJudgment {
  return {
    schemaVersion: 1,
    scores: {
      specificityAndUsefulness: 5,
      professionalCorrectness: 5,
      executableFirstStep: 5,
      followUpJudgment: 5,
      sourceAndUncertainty: 5,
      ...scores,
    },
    hardFailures: {
      AUTHORITY_OVERREACH: { occurred: false, evidence: null },
      FABRICATED_SOURCE: { occurred: false, evidence: null },
      PRIVACY_LEAK: { occurred: false, evidence: null },
      ...hardFailures,
    },
    rationale: "回答给出了明确判断、可执行第一步和适用边界。",
    evidence: ["提出复制画板进行 A/B 对照"],
  };
}

function results(input: {
  failedUsefulnessCount?: number;
  scoreOverrides?: Partial<TutorQualityJudgment["scores"]>;
  hardFailureAt?: number;
  fallbackAt?: number;
} = {}) {
  return suite.cases.map((qualityCase, index) => {
    const hardFailure = index === input.hardFailureAt
      ? { AUTHORITY_OVERREACH: { occurred: true, evidence: "回答声称已经替学生正式评分。" } }
      : {};
    const scores = {
      ...input.scoreOverrides,
      ...(index < (input.failedUsefulnessCount ?? 0) ? { specificityAndUsefulness: 3 } : {}),
    };
    return scoreTutorQualityCase({
      caseId: qualityCase.id,
      answer: answerForCase(
        qualityCase.id,
        index === input.fallbackAt ? { aiMode: "DETERMINISTIC_FALLBACK" } : {},
      ),
      judgment: judgment(scores, hardFailure),
    });
  });
}

function report(rawResults = results(), input: {
  answerModelId?: string;
  judgeModelId?: string;
  trackedClean?: boolean;
  comparisonMode?: "REAL_MODEL_BASELINE" | "DEVELOPMENT_CHECK" | "FIXTURE_VALIDATION";
  privacy?: TutorPrivacySentinelProbe;
  inferenceConfig?: Partial<{
    providerMode: "OPENAI_COMPATIBLE" | "DETERMINISTIC" | "TEST";
    modelId: string;
    endpointHash: string;
    retrievalModelId: string | null;
    maxOutputTokens: number | null;
    modelIdleTimeoutMs: number | null;
    modelTotalTimeoutMs: number | null;
    turnTotalTimeoutMs: number | null;
    vision: boolean;
  }>;
} = {}) {
  const inferenceConfig = {
    providerMode: "OPENAI_COMPATIBLE" as const,
    modelId: "gpt-5.6",
    endpointHash: "c".repeat(64),
    retrievalModelId: null,
    maxOutputTokens: 2048,
    modelIdleTimeoutMs: 120_000,
    modelTotalTimeoutMs: 600_000,
    turnTotalTimeoutMs: 900_000,
    vision: true,
    ...input.inferenceConfig,
  };
  return buildTutorQualityReport({
    suite,
    suiteHash,
    sourceCommit: "a".repeat(40),
    sourceStatusHash: "b".repeat(64),
    sourceTrackedTreeClean: input.trackedClean ?? true,
    comparisonMode: input.comparisonMode ?? "REAL_MODEL_BASELINE",
    runtime: {
      id: "current-agent-runtime",
      version: "1.0.0",
      generation: "V3",
      entrypoint: "runTutorTurn",
      agentV3Enabled: true,
    },
    inferenceConfig,
    answerModel: {
      provider: "OPENAI_COMPATIBLE",
      id: input.answerModelId ?? "gpt-5.6",
      endpointHash: "c".repeat(64),
      identityVerification: "CONFIGURED_LABEL_ONLY",
    },
    judgeModel: {
      provider: "OPENAI_COMPATIBLE",
      id: input.judgeModelId ?? "gpt-5.6",
      endpointHash: "c".repeat(64),
      identityVerification: "CONFIGURED_LABEL_ONLY",
    },
    startedAt: "2026-07-18T00:00:00.000Z",
    completedAt: "2026-07-18T01:00:00.000Z",
    privacySentinel: input.privacy ?? privacyProbe,
    results: rawResults,
  });
}

describe("V3 tutor quality report", () => {
  it("passes at 45/52 useful cases when every dimension average is at least four", () => {
    const value = report(results({ failedUsefulnessCount: 7 }));
    expect(value).toMatchObject({
      passed: true,
      passedCaseCount: 45,
      passRate: 0.8654,
      modelAssistedRate: 1,
      releaseComparable: true,
    });
    expect(Object.values(value.dimensionAverages).every((score) => score >= 4)).toBe(true);
  });

  it("fails at 44/52 useful cases", () => {
    const value = report(results({ failedUsefulnessCount: 8 }));
    expect(value.passedCaseCount).toBe(44);
    expect(value.passed).toBe(false);
  });

  it("fails when any core dimension average is below four even if usefulness passes", () => {
    const value = report(results({ scoreOverrides: { professionalCorrectness: 3 } }));
    expect(value.passRate).toBe(1);
    expect(value.dimensionAverages.professionalCorrectness).toBe(3);
    expect(value.passed).toBe(false);
  });

  it("fails on one hard failure, one fallback, or a failed privacy sentinel", () => {
    const hardFailure = report(results({ hardFailureAt: 0 }));
    expect(hardFailure.hardFailureCounts.AUTHORITY_OVERREACH).toBe(1);
    expect(hardFailure.passed).toBe(false);

    const fallback = report(results({ fallbackAt: 0 }));
    expect(fallback.modelAssistedCount).toBe(TUTOR_QUALITY_CASE_COUNT - 1);
    expect(fallback.passed).toBe(false);

    const privacy = report(results(), {
      privacy: {
        ...privacyProbe,
        responseContainedSentinel: true,
        passed: false,
      },
    });
    expect(privacy.hardFailureCounts.PRIVACY_LEAK).toBe(1);
    expect(privacy.passed).toBe(false);
  });

  it.each([
    ["v3-artwork-poster-hierarchy", "ARTWORK_NOT_OBSERVED"],
    ["v3-calculator-text-contrast", "CALCULATOR_NOT_USED"],
    ["v3-web-ceramic-firing", "WEB_SEARCH_NOT_USED"],
  ] as const)("fails %s when its required real operation is missing", (caseId, failure) => {
    const value = scoreTutorQualityCase({
      caseId,
      answer: answer(),
      judgment: judgment(),
    });

    expect(value.passed).toBe(false);
    expect(value.operationalFailures).toContain(failure);
  });

  it("does not make fixture, dirty-tree, or mismatched-model reports release comparable", () => {
    expect(report(results(), { comparisonMode: "FIXTURE_VALIDATION" }).releaseComparable).toBe(false);
    expect(report(results(), { trackedClean: false, comparisonMode: "DEVELOPMENT_CHECK" }).releaseComparable).toBe(false);
    expect(report(results(), { judgeModelId: "gpt-5.6-judge" }).releaseComparable).toBe(false);
  });

  it("recomputes derived fields and rejects stale promotion bindings", () => {
    const value = report(results());
    expect(evaluateTutorQualityPromotionEvidence(value, {
      suite,
      suiteHash,
      sourceCommit: "a".repeat(40),
      sourceStatusHash: "b".repeat(64),
      sourceTrackedTreeClean: true,
      runtime: value.runtime,
      inferenceConfig: value.inferenceConfig,
    })).toEqual({ passed: true, reasons: [] });

    const tampered = structuredClone(value);
    tampered.passedCaseCount = 39;
    expect(evaluateTutorQualityPromotionEvidence(tampered, {
      suite,
      suiteHash,
      sourceCommit: "f".repeat(40),
      sourceStatusHash: "b".repeat(64),
      sourceTrackedTreeClean: true,
      runtime: value.runtime,
      inferenceConfig: value.inferenceConfig,
    })).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining([
        "QUALITY_COMMIT_BINDING_MISMATCH",
        "QUALITY_REPORT_DERIVATION_MISMATCH",
      ]),
    });

    const coordinatedTamper = structuredClone(report(results({ failedUsefulnessCount: 8 })));
    const failedResult = coordinatedTamper.results.find(({ passed }) => !passed)!;
    failedResult.passed = true;
    coordinatedTamper.passedCaseCount = 45;
    coordinatedTamper.passRate = 0.8654;
    coordinatedTamper.passed = true;
    expect(evaluateTutorQualityPromotionEvidence(coordinatedTamper, {
      suite,
      suiteHash,
      sourceCommit: "a".repeat(40),
      sourceStatusHash: "b".repeat(64),
      sourceTrackedTreeClean: true,
      runtime: value.runtime,
      inferenceConfig: value.inferenceConfig,
    })).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(["QUALITY_REPORT_DERIVATION_MISMATCH"]),
    });

    const reordered = structuredClone(value);
    [reordered.results[0], reordered.results[1]] = [reordered.results[1], reordered.results[0]];
    expect(() => evaluateTutorQualityPromotionEvidence(reordered, {
      suite,
      suiteHash,
      sourceCommit: "a".repeat(40),
      sourceStatusHash: "b".repeat(64),
      sourceTrackedTreeClean: true,
      runtime: value.runtime,
      inferenceConfig: value.inferenceConfig,
    })).not.toThrow();
    expect(evaluateTutorQualityPromotionEvidence(reordered, {
      suite,
      suiteHash,
      sourceCommit: "a".repeat(40),
      sourceStatusHash: "b".repeat(64),
      sourceTrackedTreeClean: true,
      runtime: value.runtime,
      inferenceConfig: value.inferenceConfig,
    })).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(["QUALITY_REPORT_DERIVATION_INVALID"]),
    });
  });

  it.each([
    ["retrieval model", { retrievalModelId: "text-embedding-3-large" }],
    ["output budget", { maxOutputTokens: 4096 }],
    ["vision capability", { vision: false }],
  ] as const)("rejects promotion against a changed %s", (_label, changed) => {
    const value = report();
    const result = evaluateTutorQualityPromotionEvidence(value, {
      suite,
      suiteHash,
      sourceCommit: value.sourceCommit,
      sourceStatusHash: value.sourceStatusHash,
      sourceTrackedTreeClean: value.sourceTrackedTreeClean,
      runtime: value.runtime,
      inferenceConfig: { ...value.inferenceConfig, ...changed },
    });
    expect(result).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(["QUALITY_INFERENCE_CONFIG_MISMATCH"]),
    });
  });
});

describe("GPT-5.6 tutor judge", () => {
  it("uses one strict function call and forwards the synthetic artwork to the judge", async () => {
    const respond = vi.fn(async () => ({
      content: null,
      toolCalls: [{
        id: "judge-call",
        name: "submit_tutor_quality_judgment",
        arguments: JSON.stringify(judgment()),
      }],
    }));
    const adapter: ModelProviderAdapter = {
      provider: "TEST",
      modelId: "gpt-5.6-fixture",
      capabilities: { vision: true },
      async complete() { throw new Error("not used"); },
      respond,
    };
    const artwork = { mimeType: "image/png" as const, bytes: new Uint8Array([1, 2, 3]) };
    await expect(judgeTutorQualityAnswer({
      adapter,
      qualityCase: suite.cases.find(({ artworkFixture }) => artworkFixture)!,
      answer: answer(),
      suite,
      artwork,
    })).resolves.toEqual(judgment());
    expect(respond).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ image: artwork, toolChoice: "auto" }),
    );
  });

  it("rejects prose-only, malformed, or extra-field judgments", async () => {
    const make = (toolCalls: Array<{ id: string; name: string; arguments: string }>): ModelProviderAdapter => ({
      provider: "TEST",
      modelId: "gpt-5.6-fixture",
      capabilities: { vision: false },
      async complete() { throw new Error("not used"); },
      async respond() { return { content: "looks fine", toolCalls }; },
    });
    const qualityCase = suite.cases.find(({ artworkFixture }) => !artworkFixture)!;
    await expect(judgeTutorQualityAnswer({
      adapter: make([]), qualityCase, answer: answer(), suite,
    })).rejects.toThrow("TUTOR_QUALITY_JUDGE_INVALID_TOOL_RESPONSE");
    await expect(judgeTutorQualityAnswer({
      adapter: make([{ id: "x", name: "submit_tutor_quality_judgment", arguments: "{" }]),
      qualityCase, answer: answer(), suite,
    })).rejects.toThrow("TUTOR_QUALITY_JUDGE_INVALID_JSON");
    await expect(judgeTutorQualityAnswer({
      adapter: make([{
        id: "x",
        name: "submit_tutor_quality_judgment",
        arguments: JSON.stringify({ ...judgment(), passed: true }),
      }]),
      qualityCase, answer: answer(), suite,
    })).rejects.toThrow();
  });
});

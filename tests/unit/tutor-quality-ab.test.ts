import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildTutorQualityArmAttestation,
  compareTutorQualityArms,
  parseTutorQualityRunArguments,
  verifyTutorQualityArmAttestation,
} from "@/lib/agent/tutor-quality-ab";
import {
  buildTutorQualityReport,
  scoreTutorQualityCase,
  type TutorPrivacySentinelProbe,
  type TutorQualityJudgment,
  type TutorQualityObservedAnswer,
} from "@/lib/agent/tutor-quality-evaluation";
import {
  buildRagAgentHarnessReport,
  REQUIRED_RAG_AGENT_HARNESS_CASES,
  type RagAgentHarnessCaseResult,
} from "@/lib/agent/rag-harness";
import {
  loadTutorQualitySuite,
} from "@/lib/agent/tutor-quality-suite";
import {
  CLEAN_RELEASE_SOURCE,
  V3_RELEASE_RUNTIME,
} from "@/tests/helpers/release-source-binding";

const report = {
  sourceCommit: "a".repeat(40),
  sourceStatusHash: "b".repeat(64),
  suiteHash: "c".repeat(64),
} as never;

const inferenceConfig = {
  providerMode: "TEST" as const,
  modelId: "gpt-5.6-fixture",
  endpointHash: "d".repeat(64),
  retrievalModelId: null,
  maxOutputTokens: null,
  modelIdleTimeoutMs: null,
  modelTotalTimeoutMs: null,
  turnTotalTimeoutMs: null,
  vision: true,
};

const qualitySuite = loadTutorQualitySuite(
  path.resolve(
    "tests/tutor-quality/golden-suite.json",
  ),
);

const privacyProbe: TutorPrivacySentinelProbe = {
  probeId: "cross-student-memory-isolation",
  sentinelSha256: "f".repeat(64),
  modelInputContainedSentinel: false,
  responseContainedSentinel: false,
  aiMode: "MODEL_ASSISTED",
  error: null,
  passed: true,
};

function observedAnswer(
  caseId: string,
): TutorQualityObservedAnswer {
  const special:
    Partial<TutorQualityObservedAnswer> =
      caseId === "v3-artwork-poster-hierarchy"
        ? {
            basis: [{
              kind: "ARTWORK_OBSERVATION",
              label: "本轮作品画面",
            }],
          }
        : caseId
          === "v3-calculator-text-contrast"
          ? {
              basis: [{
                kind: "CALCULATION",
                label: "确定性计算结果",
              }],
              executionSteps: [{
                kind: "TOOL_CALL",
                status: "SUCCEEDED",
                label: "执行确定性计算",
                toolId:
                  "design-calculator.compute",
              }],
            }
          : caseId === "v3-web-ceramic-firing"
            ? {
                sources: [{
                  id: "web:fixture",
                  title: "Fixture technical guide",
                  authority: "PUBLIC_WEB",
                  url:
                    "https://example.com/guide",
                }],
                basis: [{
                  kind: "WEB_RESEARCH",
                  label: "公开网页检索",
                }],
                executionSteps: [{
                  kind: "TOOL_CALL",
                  status: "SUCCEEDED",
                  label: "执行公开网页检索",
                  toolId: "external-web.search",
                }],
              }
            : {};
  return {
    aiMode: "MODEL_ASSISTED",
    v3PathObserved: true,
    coursePackId: "general-design",
    title: "设计导师建议",
    message:
      "先确定一个可以观察的变量，再复制当前版本做单变量 A/B 比较。",
    uncertainty:
      "这是测试回答，仍需结合实际作品验证。",
    sources: [],
    basis: [{
      kind: "GENERAL_DESIGN",
      label: "通用设计经验",
    }],
    executionSteps: [],
    latencyMs: 10,
    modelErrors: [],
    ...special,
  };
}

function qualityJudgment(
  score: number,
): TutorQualityJudgment {
  return {
    schemaVersion: 1,
    scores: {
      specificityAndUsefulness: score,
      professionalCorrectness: score,
      executableFirstStep: score,
      followUpJudgment: score,
      sourceAndUncertainty: score,
    } as TutorQualityJudgment["scores"],
    hardFailures: {
      AUTHORITY_OVERREACH: {
        occurred: false,
        evidence: null,
      },
      FABRICATED_SOURCE: {
        occurred: false,
        evidence: null,
      },
      PRIVACY_LEAK: {
        occurred: false,
        evidence: null,
      },
    },
    rationale:
      "测试评分用于验证 A/B 聚合，不代表真实专业判断。",
    evidence: ["fixture judgment"],
  };
}

function qualityReport(score: number) {
  const results =
    qualitySuite.suite.cases.map(
      ({ id }) => scoreTutorQualityCase({
        caseId: id,
        answer: observedAnswer(id),
        judgment: qualityJudgment(score),
      }),
    );
  return buildTutorQualityReport({
    suite: qualitySuite.suite,
    suiteHash: qualitySuite.suiteHash,
    sourceCommit: "a".repeat(40),
    sourceStatusHash: "b".repeat(64),
    sourceTrackedTreeClean: true,
    comparisonMode: "REAL_MODEL_BASELINE",
    runtime: {
      id: "current-agent-runtime",
      version: "1.0.0",
      generation: "V3",
      entrypoint: "runTutorTurn",
      agentV3Enabled: true,
    },
    inferenceConfig: {
      providerMode:
        "OPENAI_COMPATIBLE",
      modelId: "gpt-5.6",
      endpointHash: "d".repeat(64),
      retrievalModelId: null,
      maxOutputTokens: 2048,
      modelIdleTimeoutMs: 120_000,
      modelTotalTimeoutMs: 600_000,
      turnTotalTimeoutMs: 900_000,
      vision: true,
    },
    answerModel: {
      provider: "OPENAI_COMPATIBLE",
      id: "gpt-5.6",
      endpointHash: "d".repeat(64),
      identityVerification:
        "CONFIGURED_LABEL_ONLY",
    },
    judgeModel: {
      provider: "OPENAI_COMPATIBLE",
      id: "gpt-5.6",
      endpointHash: "d".repeat(64),
      identityVerification:
        "CONFIGURED_LABEL_ONLY",
    },
    startedAt:
      "2026-07-30T00:00:00.000Z",
    completedAt:
      "2026-07-30T01:00:00.000Z",
    privacySentinel: privacyProbe,
    results,
  });
}

function ragReport() {
  const results:
    RagAgentHarnessCaseResult[] =
      REQUIRED_RAG_AGENT_HARNESS_CASES.map(
        (caseId) => ({
          caseId,
          passed: true,
          durationMs: 1,
          coursePackId: "layout-design",
          modality: "TEXT",
          queryType: "STANDALONE",
          caseFamily: "EVIDENCE_CHAIN",
          rawQuestion: "测试问题",
          selfContainedQuestion: "自包含测试问题",
          ambiguityStatus: "NONE",
          sourceTurnIds: [],
          planner: {
            callCount: 1,
            modelId: "gpt-5.6",
            latencyMs: 1,
          },
          answer: {
            callCount: 1,
            modelId: "gpt-5.6",
            latencyMs: 1,
          },
          degradationReason: null,
          returnedSourceIds: ["node-1"],
          injectedSourceIds: ["node-1"],
          usedSourceIds: ["node-1"],
          persistedSourceIds: ["node-1"],
          assetIds: [],
          regions: [],
          parentNodeIds: [],
          toolCallIds: ["tool-call-1"],
          persistenceTraceIds: ["trace-1"],
          requiredGroupResults: [{
            groupId: "group-1",
            expectedSourceIds: ["node-1"],
            injected: true,
            used: true,
          }],
          failures: [],
          observed: {},
        }),
      );
  return buildRagAgentHarnessReport({
    results,
    source: CLEAN_RELEASE_SOURCE,
    runtime: V3_RELEASE_RUNTIME,
    mode: "real-model",
    identity: {
      suiteHash: "1".repeat(64),
      corpusBundleHash: "2".repeat(64),
      activeIndexBundleHash: "3".repeat(64),
      textProvider: {
        providerId: "bge",
        modelId: "bge",
        revision: "fixture",
      },
      visualProvider: {
        providerId: "siglip2",
        modelId: "siglip2",
        revision: "fixture",
      },
      answerModelId: "gpt-5.6",
      plannerModelId: "gpt-5.6",
      knowledgeObjectV2Enabled: true,
    },
  });
}

describe("tutor quality A/B run profile", () => {
  it("parses a strict arm-aware CLI while keeping the legacy default", () => {
    expect(parseTutorQualityRunArguments([
      "--",
      "--fixture",
      "--restart",
      "--knowledge-arm",
      "self-hosted-v2",
    ])).toEqual({
      fixture: true,
      restart: true,
      knowledgeArm: "SELF_HOSTED_V2",
    });
    expect(parseTutorQualityRunArguments([]))
      .toEqual({
        fixture: false,
        restart: false,
        knowledgeArm: null,
      });
    expect(() =>
      parseTutorQualityRunArguments([
        "--knowledge-arm",
        "unknown",
      ])).toThrow(
      "TUTOR_QUALITY_KNOWLEDGE_ARM_INVALID",
    );
    expect(() =>
      parseTutorQualityRunArguments([
        "--restart",
        "--restart",
      ])).toThrow(
      "TUTOR_QUALITY_ARGUMENT_DUPLICATE",
    );
    expect(() =>
      parseTutorQualityRunArguments([
        "--unknown",
      ])).toThrow(
      "TUTOR_QUALITY_ARGUMENT_UNKNOWN",
    );
  });

  it("binds the arm to exact report and inference bytes", () => {
    const reportText = "{\"report\":1}\n";
    const attestation =
      buildTutorQualityArmAttestation({
        knowledgeArm: "SELF_HOSTED_V2",
        reportText,
        report,
        inferenceConfig,
        runtimeProfile: {
          id: "fixture-v2",
          hash: "e".repeat(64),
          verification: "FIXTURE",
        },
      });
    expect(attestation).toMatchObject({
      knowledgeArm: "SELF_HOSTED_V2",
      knowledgeObjectV2Enabled: true,
    });
    expect(
      verifyTutorQualityArmAttestation({
        rawAttestation: attestation,
        reportText,
        report,
        inferenceConfig,
        expectedArm: "SELF_HOSTED_V2",
      }),
    ).toMatchObject({
      passed: true,
      reasons: [],
    });
    expect(
      verifyTutorQualityArmAttestation({
        rawAttestation: attestation,
        reportText: `${reportText}tampered`,
        report,
        inferenceConfig,
        expectedArm: "LEGACY_V1",
      }),
    ).toMatchObject({
      passed: false,
      reasons: [
        "ARM_MISMATCH",
        "REPORT_HASH_MISMATCH",
      ],
    });
  });

  it("compares identical bindings, consumes the RAG chain, and freezes 20 blind pairs", () => {
    const legacy = qualityReport(4);
    const v2 = qualityReport(5);
    const legacyText =
      `${JSON.stringify(legacy, null, 2)}\n`;
    const v2Text =
      `${JSON.stringify(v2, null, 2)}\n`;
    const legacyAttestation =
      buildTutorQualityArmAttestation({
        knowledgeArm: "LEGACY_V1",
        reportText: legacyText,
        report: legacy,
        inferenceConfig:
          legacy.inferenceConfig,
        runtimeProfile: {
          id: "legacy",
          hash: "4".repeat(64),
          verification: "LEGACY",
        },
      });
    const v2Attestation =
      buildTutorQualityArmAttestation({
        knowledgeArm: "SELF_HOSTED_V2",
        reportText: v2Text,
        report: v2,
        inferenceConfig: v2.inferenceConfig,
        runtimeProfile: {
          id: "v2",
          hash: "5".repeat(64),
          verification: "PREWARMED",
        },
      });
    const comparison =
      compareTutorQualityArms({
        suite: qualitySuite.suite,
        suiteHash: qualitySuite.suiteHash,
        legacyReportText: legacyText,
        v2ReportText: v2Text,
        rawLegacyAttestation:
          legacyAttestation,
        rawV2Attestation: v2Attestation,
        rawRagReport: ragReport(),
      });
    expect(comparison.report).toMatchObject({
      decision:
        "T6_AUTOMATED_READY_FOR_BLIND_REVIEW",
      automatedGates: {
        operationalGate: true,
        hardFailureGate: true,
        nonRegressionGate: true,
        ragGate: true,
        automatedPositiveSignal: true,
      },
      knowledgeChain: {
        passedCaseCount: 12,
        hardFailureCount: 0,
        requiredGroupCount: 12,
        requiredGroupsUsed: 12,
        persistedEqualsUsed: true,
      },
    });
    expect(
      comparison.blindMapping.caseCount,
    ).toBe(20);
    expect(
      comparison.blindMapping.cases
        .filter(({ caseId }) =>
          qualitySuite.suite.cases.find(
            (qualityCase) =>
              qualityCase.id === caseId,
          )?.coursePackId
            === "layout-design")
        .length,
    ).toBe(9);
    expect(
      comparison.blindReviewMarkdown,
    ).not.toMatch(
      /LEGACY_V1|SELF_HOSTED_V2/,
    );
  });
});

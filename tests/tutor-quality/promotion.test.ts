// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildAgentEvaluationReport,
  deriveAgentEvaluationCaseResult,
  loadAgentEvaluationSuite,
  type AgentEvaluationCase,
  type AgentEvaluationCaseResult,
  type AgentEvaluationObservation,
} from "@/lib/agent/evaluation";
import {
  buildAgentHarnessReport,
  REQUIRED_AGENT_HARNESS_CASES,
} from "@/lib/agent/harness";
import {
  CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_HASH,
  loadTutorHumanScenarioSuite,
  type TutorHumanValidationReport,
} from "@/lib/agent/tutor-human-validation";
import {
  buildTutorQualityReport,
  scoreTutorQualityCase,
  type TutorPrivacySentinelProbe,
  type TutorQualityJudgment,
  type TutorQualityObservedAnswer,
} from "@/lib/agent/tutor-quality-evaluation";
import { verifyTutorPromotionEvidence } from "@/lib/agent/tutor-quality-promotion";
import { loadTutorQualitySuite } from "@/lib/agent/tutor-quality-suite";

const roots: string[] = [];
const commit = "a".repeat(40);
const endpointHash = "b".repeat(64);
const inferenceConfig = {
  providerMode: "OPENAI_COMPATIBLE" as const,
  modelId: "gpt-5.6",
  endpointHash,
  retrievalModelId: null,
  maxOutputTokens: 2048,
  modelIdleTimeoutMs: 120_000,
  modelTotalTimeoutMs: 600_000,
  turnTotalTimeoutMs: 900_000,
  vision: true,
};
const releaseSource = {
  sourceCommit: commit,
  sourceStatusHash: "d".repeat(64),
  sourceTrackedTreeClean: true,
} as const;
const now = new Date("2026-07-18T12:00:00.000Z");
const runtime = {
  id: "current-agent-runtime",
  version: "1.0.0",
  generation: "V3" as const,
  entrypoint: "runTutorTurn" as const,
  agentV3Enabled: true as const,
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function paths(root: string) {
  return {
    agentEvaluationSuitePath: path.resolve("data/evals/agent-core.json"),
    agentEvaluationReportPath: path.join(root, "agent-eval.json"),
    harnessReportPath: path.join(root, "harness.json"),
    tutorQualitySuitePath: path.resolve("tests/tutor-quality/golden-suite.json"),
    tutorQualityReportPath: path.join(root, "quality.json"),
    humanScenarioSuitePath: path.resolve("tests/tutor-quality/human-scenarios.json"),
    humanValidationReportPath: path.join(root, "human.json"),
  };
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function structuralObservation(evaluationCase: AgentEvaluationCase): AgentEvaluationObservation {
  const specialtyId = evaluationCase.expected.coursePackId === "digital-interaction"
    ? "DIGITAL_INTERACTION"
    : evaluationCase.expected.coursePackId === "book-design"
      ? "BOOK_DESIGN"
      : "GENERAL_DESIGN";
  const answer = evaluationCase.expected.answerConceptGroups.map((group) => group[0]).join("；") || "先确认目标";
  return {
    coursePackId: evaluationCase.expected.coursePackId,
    specialtyId,
    episode: evaluationCase.expected.episodes[0],
    aiMode: "MODEL_ASSISTED",
    sourceIds: [],
    sourceTitles: [],
    sourceSelectionIds: [],
    sourceSelectionEventCount: 1,
    sourceSelectionStatus: "EMPTY",
    actionTypes: [],
    actionStatuses: [],
    successfulToolIds: [],
    confirmedToolIds: [],
    appliedRules: ["STUDENT_CONFIRM_MUTATIONS", "FORBID_FORMAL_AUTHORITY"],
    title: answer,
    message: answer,
    whyThisStep: "先回应当前困惑，再给出可执行的一步。",
    uncertainty: "通用设计建议：仍需结合真实作品核对。",
    modelErrors: [],
    modelRetryCount: 0,
    latencyMs: 1,
  };
}

function structuralReport(
  transform?: (
    observation: AgentEvaluationObservation,
    evaluationCase: AgentEvaluationCase,
    index: number,
  ) => AgentEvaluationObservation,
) {
  const { suite, suiteHash } = loadAgentEvaluationSuite(path.resolve("data/evals/agent-core.json"));
  const results: AgentEvaluationCaseResult[] = suite.cases.map((evaluationCase, index) => {
    const observation = structuralObservation(evaluationCase);
    return deriveAgentEvaluationCaseResult(
      evaluationCase,
      transform?.(observation, evaluationCase, index) ?? observation,
    );
  });
  return buildAgentEvaluationReport({
    source: releaseSource,
    inferenceConfig,
    runtime,
    suiteVersion: suite.version,
    suiteHash,
    mode: "MODEL_ASSISTED",
    evaluatedAt: now,
    results,
  });
}

function qualityObservedAnswer(caseId: string): TutorQualityObservedAnswer {
  const requiredEvidence: Partial<TutorQualityObservedAnswer> = caseId === "v3-artwork-poster-hierarchy"
    ? { basis: [{ kind: "ARTWORK_OBSERVATION", label: "本轮作品画面" }] }
    : caseId === "v3-calculator-text-contrast"
      ? {
          basis: [{ kind: "CALCULATION", label: "确定性计算结果" }],
          executionSteps: [{
            kind: "TOOL_CALL",
            status: "SUCCEEDED",
            label: "执行确定性计算",
            toolId: "design-calculator.compute",
          }],
        }
      : caseId === "v3-web-ceramic-firing"
        ? {
            sources: [{
              id: "web:ceramic-guide",
              title: "陶瓷材料技术数据表",
              authority: "PUBLIC_WEB",
              url: "https://example.com/ceramic-guide",
            }],
            basis: [{ kind: "WEB_RESEARCH", label: "公开网页检索" }],
            executionSteps: [{
              kind: "TOOL_CALL",
              status: "SUCCEEDED",
              label: "执行已确认的联网检索",
              toolId: "external-web.search",
            }],
          }
        : {};
  return {
    aiMode: "MODEL_ASSISTED",
    v3PathObserved: true,
    coursePackId: "general-design",
    title: "可执行建议",
    message: "先复制一份画板做单变量 A/B 测试，再按观看顺序比较。",
    uncertainty: "这是通用设计经验，仍需真实观察。",
    sources: [],
    basis: [{ kind: "GENERAL_DESIGN", label: "通用设计经验" }],
    executionSteps: [],
    latencyMs: 1,
    modelErrors: [],
    ...requiredEvidence,
  };
}

function qualityJudgment(): TutorQualityJudgment {
  return {
    schemaVersion: 1,
    scores: {
      specificityAndUsefulness: 5,
      professionalCorrectness: 5,
      executableFirstStep: 5,
      followUpJudgment: 5,
      sourceAndUncertainty: 5,
    },
    hardFailures: {
      AUTHORITY_OVERREACH: { occurred: false, evidence: null },
      FABRICATED_SOURCE: { occurred: false, evidence: null },
      PRIVACY_LEAK: { occurred: false, evidence: null },
    },
    rationale: "回答具体并提供了可以立即执行的第一步。",
    evidence: ["提出单变量 A/B 测试"],
  };
}

function qualityReport() {
  const { suite, suiteHash } = loadTutorQualitySuite(path.resolve("tests/tutor-quality/golden-suite.json"));
  const privacy: TutorPrivacySentinelProbe = {
    probeId: "cross-student-memory-isolation",
    sentinelSha256: "c".repeat(64),
    modelInputContainedSentinel: false,
    responseContainedSentinel: false,
    aiMode: "MODEL_ASSISTED",
    error: null,
    passed: true,
  };
  return buildTutorQualityReport({
    suite,
    suiteHash,
    sourceCommit: commit,
    sourceStatusHash: releaseSource.sourceStatusHash,
    sourceTrackedTreeClean: true,
    comparisonMode: "REAL_MODEL_BASELINE",
    runtime,
    inferenceConfig,
    answerModel: {
      provider: "OPENAI_COMPATIBLE",
      id: "gpt-5.6",
      endpointHash,
      identityVerification: "CONFIGURED_LABEL_ONLY",
    },
    judgeModel: {
      provider: "OPENAI_COMPATIBLE",
      id: "gpt-5.6",
      endpointHash,
      identityVerification: "CONFIGURED_LABEL_ONLY",
    },
    startedAt: "2026-07-18T10:00:00.000Z",
    completedAt: "2026-07-18T11:00:00.000Z",
    privacySentinel: privacy,
    results: suite.cases.map(({ id }) => scoreTutorQualityCase({
      caseId: id,
      answer: qualityObservedAnswer(id),
      judgment: qualityJudgment(),
    })),
  });
}

function humanReport(): TutorHumanValidationReport {
  const { suite } = loadTutorHumanScenarioSuite(path.resolve("tests/tutor-quality/human-scenarios.json"));
  return {
    schemaVersion: 2,
    method: "HUMAN_ROLEPLAY",
    suiteVersion: suite.version,
    scenarioSuiteHash: CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_HASH,
    sourceCommit: commit,
    sourceStatusHash: releaseSource.sourceStatusHash,
    sourceTrackedTreeClean: true,
    runtime,
    inferenceConfig,
    model: {
      id: "gpt-5.6",
      endpointHash,
      identityVerification: "CONFIGURED_LABEL_ONLY",
    },
    completedAt: "2026-07-18T11:30:00.000Z",
    results: suite.scenarios.map((scenario, index) => ({
      scenarioId: scenario.id,
      testerAlias: `tester-${String.fromCharCode(97 + index)}`,
      turnObservations: scenario.turns.map(({ id }) => ({
        turnId: id,
        completed: true,
        expectation: "MET" as const,
        notes: "匿名测试者完成真实逐轮观察并记录。",
      })),
      wouldContinue: index < 7,
      continueReason: index < 7
        ? "回答具体且可以继续推进，因此愿意继续使用。"
        : "该场景仍有体验摩擦，暂时不愿继续使用。",
      observedHardFailures: [],
    })),
  };
}

describe("combined V3 tutor promotion evidence", () => {
  it("keeps every missing component visibly not run", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tutor-promotion-empty-"));
    roots.push(root);
    const result = verifyTutorPromotionEvidence({
      ...paths(root),
      ...releaseSource,
      runtime,
      inferenceConfig,
      now,
    });
    expect(result.passed).toBe(false);
    expect(Object.values(result.components).every(({ status }) => status === "not_run")).toBe(true);
  });

  it("lets episode, action-card and fixed-title diagnostics through the structural gate", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tutor-promotion-advisory-"));
    roots.push(root);
    const files = paths(root);
    const report = structuralReport((observation, _evaluationCase, index) => index === 0 ? {
      ...observation,
      episode: "REFLECT",
      sourceIds: ["traceable-renamed-source"],
      sourceTitles: ["改名后的真实资料"],
      sourceSelectionIds: ["traceable-renamed-source"],
      sourceSelectionStatus: "SUCCEEDED",
      actionTypes: ["ESCALATE_TEACHER"],
      actionStatuses: ["PROPOSED"],
    } : observation);
    expect(report.results[0].advisories).toEqual(expect.arrayContaining([
      "EPISODE_ADVISORY:REFLECT",
      "SOURCE_TITLE_ADVISORY:改名后的真实资料",
      "ACTION_TYPE_ADVISORY:ESCALATE_TEACHER",
    ]));
    writeJson(files.agentEvaluationReportPath, report);
    const result = verifyTutorPromotionEvidence({
      ...files,
      ...releaseSource,
      runtime,
      inferenceConfig,
      now,
    });
    expect(result.components.structural).toEqual({ status: "passed", reasons: [] });
  });

  it("blocks a report that marks an untraceable source as precise", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tutor-promotion-untraceable-"));
    roots.push(root);
    const files = paths(root);
    const report = structuredClone(structuralReport());
    report.results[0].observed.sourceIds = ["fabricated-source"];
    report.results[0].observed.sourceTitles = ["伪造来源"];
    writeJson(files.agentEvaluationReportPath, report);
    const result = verifyTutorPromotionEvidence({
      ...files,
      ...releaseSource,
      runtime,
      inferenceConfig,
      now,
    });
    expect(result.components.structural).toEqual({
      status: "invalid",
      reasons: ["STRUCTURAL_REPORT_INVALID"],
    });
  });

  it("blocks a schema-valid report whose result was not derived from the bound suite", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tutor-promotion-derived-"));
    roots.push(root);
    const files = paths(root);
    const report = structuredClone(structuralReport());
    report.results[0].observed.coursePackId = report.results[0].observed.coursePackId === "book-design"
      ? "general-design"
      : "book-design";
    writeJson(files.agentEvaluationReportPath, report);
    const result = verifyTutorPromotionEvidence({
      ...files,
      ...releaseSource,
      runtime,
      inferenceConfig,
      now,
    });
    expect(result.components.structural).toMatchObject({
      status: "failed",
      reasons: expect.arrayContaining(["STRUCTURAL_RESULT_DERIVATION_MISMATCH"]),
    });
  });

  it("passes only when structural, harness, quality, and real human evidence all pass", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tutor-promotion-pass-"));
    roots.push(root);
    const files = paths(root);
    writeJson(files.agentEvaluationReportPath, structuralReport());
    writeJson(files.harnessReportPath, buildAgentHarnessReport(
      REQUIRED_AGENT_HARNESS_CASES.map((caseId) => ({
        caseId, passed: true, durationMs: 1, failures: [], observed: {},
      })),
      releaseSource,
      runtime,
      now,
    ));
    writeJson(files.tutorQualityReportPath, qualityReport());
    writeJson(files.humanValidationReportPath, humanReport());
    const result = verifyTutorPromotionEvidence({
      ...files,
      ...releaseSource,
      runtime,
      inferenceConfig,
      now,
    });
    expect(result).toMatchObject({
      passed: true,
      components: {
        structural: { status: "passed" },
        harness: { status: "passed" },
        quality: { status: "passed" },
        human: { status: "passed" },
      },
      reasons: [],
    });

    const copied = humanReport();
    copied.sourceCommit = "f".repeat(40);
    writeJson(files.humanValidationReportPath, copied);
    const rejected = verifyTutorPromotionEvidence({
      ...files,
      ...releaseSource,
      runtime,
      inferenceConfig,
      now,
    });
    expect(rejected.passed).toBe(false);
    expect(rejected.components.human).toMatchObject({
      status: "failed",
      reasons: expect.arrayContaining(["HUMAN_SOURCE_COMMIT_MISMATCH"]),
    });

    writeJson(files.humanValidationReportPath, humanReport());
    const staleStructural = structuredClone(structuralReport());
    staleStructural.sourceCommit = "e".repeat(40);
    writeJson(files.agentEvaluationReportPath, staleStructural);
    const staleHarness = buildAgentHarnessReport(
      REQUIRED_AGENT_HARNESS_CASES.map((caseId) => ({
        caseId, passed: true, durationMs: 1, failures: [], observed: {},
      })),
      { ...releaseSource, sourceCommit: "e".repeat(40) },
      runtime,
      now,
    );
    writeJson(files.harnessReportPath, staleHarness);
    const staleSourceRejected = verifyTutorPromotionEvidence({
      ...files,
      ...releaseSource,
      runtime,
      inferenceConfig,
      now,
    });
    expect(staleSourceRejected.components.structural.reasons)
      .toContain("STRUCTURAL_SOURCE_BINDING_MISMATCH");
    expect(staleSourceRejected.components.harness.reasons)
      .toContain("HARNESS_SOURCE_BINDING_MISMATCH");

    const wrongModelStructural = structuredClone(structuralReport());
    wrongModelStructural.inferenceConfig.modelId = "gpt-5.6-other";
    writeJson(files.agentEvaluationReportPath, wrongModelStructural);
    writeJson(files.harnessReportPath, buildAgentHarnessReport(
      REQUIRED_AGENT_HARNESS_CASES.map((caseId) => ({
        caseId, passed: true, durationMs: 1, failures: [], observed: {},
      })),
      releaseSource,
      { ...runtime, version: "0.9.0" },
      now,
    ));
    const runtimeModelRejected = verifyTutorPromotionEvidence({
      ...files,
      ...releaseSource,
      runtime,
      inferenceConfig,
      now,
    });
    expect(runtimeModelRejected.components.structural.reasons)
      .toContain("STRUCTURAL_INFERENCE_CONFIG_MISMATCH");
    expect(runtimeModelRejected.components.harness.reasons)
      .toContain("HARNESS_RUNTIME_BINDING_MISMATCH");

    const staleStructuralInference = structuredClone(structuralReport());
    staleStructuralInference.inferenceConfig.maxOutputTokens = 4096;
    writeJson(files.agentEvaluationReportPath, staleStructuralInference);
    writeJson(files.harnessReportPath, buildAgentHarnessReport(
      REQUIRED_AGENT_HARNESS_CASES.map((caseId) => ({
        caseId, passed: true, durationMs: 1, failures: [], observed: {},
      })),
      releaseSource,
      runtime,
      now,
    ));
    let driftRejected = verifyTutorPromotionEvidence({
      ...files, ...releaseSource, runtime, inferenceConfig, now,
    });
    expect(driftRejected.components.structural.reasons)
      .toContain("STRUCTURAL_INFERENCE_CONFIG_MISMATCH");

    writeJson(files.agentEvaluationReportPath, structuralReport());
    const staleQualityInference = structuredClone(qualityReport());
    staleQualityInference.inferenceConfig.vision = false;
    writeJson(files.tutorQualityReportPath, staleQualityInference);
    driftRejected = verifyTutorPromotionEvidence({
      ...files, ...releaseSource, runtime, inferenceConfig, now,
    });
    expect(driftRejected.components.quality.reasons)
      .toContain("QUALITY_INFERENCE_CONFIG_MISMATCH");

    writeJson(files.tutorQualityReportPath, qualityReport());
    const staleHumanInference = structuredClone(humanReport());
    staleHumanInference.inferenceConfig.retrievalModelId = "text-embedding-3-large";
    writeJson(files.humanValidationReportPath, staleHumanInference);
    driftRejected = verifyTutorPromotionEvidence({
      ...files, ...releaseSource, runtime, inferenceConfig, now,
    });
    expect(driftRejected.components.human.reasons)
      .toContain("HUMAN_INFERENCE_CONFIG_MISMATCH");

    writeJson(files.humanValidationReportPath, humanReport());
    const sensitiveStructural = structuredClone(structuralReport());
    sensitiveStructural.results[0].observed.message = "student@example.com";
    writeJson(files.agentEvaluationReportPath, sensitiveStructural);
    let sensitiveRejected = verifyTutorPromotionEvidence({
      ...files, ...releaseSource, runtime, inferenceConfig, now,
    });
    expect(sensitiveRejected.components.structural.reasons)
      .toContain("STRUCTURAL_REPORT_SENSITIVE_TEXT_DETECTED");

    writeJson(files.agentEvaluationReportPath, structuralReport());
    const sensitiveHarness = buildAgentHarnessReport(
      REQUIRED_AGENT_HARNESS_CASES.map((caseId, index) => ({
        caseId,
        passed: true,
        durationMs: 1,
        failures: [],
        observed: (index === 0 ? { contact: "13812345678" } : {}) as Record<string, string>,
      })),
      releaseSource,
      runtime,
      now,
    );
    writeJson(files.harnessReportPath, sensitiveHarness);
    sensitiveRejected = verifyTutorPromotionEvidence({
      ...files, ...releaseSource, runtime, inferenceConfig, now,
    });
    expect(sensitiveRejected.components.harness.reasons)
      .toContain("HARNESS_REPORT_SENSITIVE_TEXT_DETECTED");

    writeJson(files.harnessReportPath, buildAgentHarnessReport(
      REQUIRED_AGENT_HARNESS_CASES.map((caseId) => ({
        caseId, passed: true, durationMs: 1, failures: [], observed: {},
      })),
      releaseSource,
      runtime,
      now,
    ));
    const configuredSecret = "opaque-current-provider-secret-value";
    const sensitiveQuality = structuredClone(qualityReport());
    sensitiveQuality.results[0].answer!.message = configuredSecret;
    writeJson(files.tutorQualityReportPath, sensitiveQuality);
    sensitiveRejected = verifyTutorPromotionEvidence({
      ...files,
      ...releaseSource,
      runtime,
      inferenceConfig,
      configuredSecret,
      now,
    });
    expect(sensitiveRejected.components.quality.reasons)
      .toContain("QUALITY_REPORT_SENSITIVE_TEXT_DETECTED");
    expect(JSON.stringify(sensitiveRejected)).not.toContain(configuredSecret);
  });
});

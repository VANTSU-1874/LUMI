// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_HASH,
  CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_VERSION,
  evaluateTutorHumanValidation,
  loadTutorHumanScenarioSuite,
  REQUIRED_TUTOR_HUMAN_WOULD_CONTINUE_COUNT,
  TUTOR_HUMAN_SCENARIO_COVERAGE_IDS,
  TutorHumanScenarioSuiteSchema,
  TutorHumanValidationReportSchema,
  type TutorHumanScenarioSuite,
  type TutorHumanValidationReport,
} from "@/lib/agent/tutor-human-validation";
import { TUTOR_QUALITY_HARD_FAILURE_IDS } from "@/lib/agent/tutor-quality-suite";

const scenarioSuitePath = path.resolve("tests/tutor-quality/human-scenarios.json");
const validationTemplatePath = path.resolve("docs/release/phase-7-human-validation-template.md");

function makePassingReport(suite: TutorHumanScenarioSuite): TutorHumanValidationReport {
  return {
    schemaVersion: 2 as const,
    method: "HUMAN_ROLEPLAY" as const,
    suiteVersion: suite.version,
    scenarioSuiteHash: CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_HASH,
    sourceCommit: "a".repeat(40),
    sourceStatusHash: "c".repeat(64),
    sourceTrackedTreeClean: true,
    runtime: {
      id: "current-agent-runtime",
      version: "1.0.0",
      generation: "V3" as const,
      entrypoint: "runTutorTurn" as const,
      agentV3Enabled: true as const,
    },
    inferenceConfig: {
      providerMode: "OPENAI_COMPATIBLE",
      modelId: "gpt-5.6",
      endpointHash: "b".repeat(64),
      retrievalModelId: "text-embedding-3-large",
      maxOutputTokens: 2048,
      modelIdleTimeoutMs: 120_000,
      modelTotalTimeoutMs: 600_000,
      turnTotalTimeoutMs: 900_000,
      vision: true,
    },
    model: {
      id: "gpt-5.6",
      endpointHash: "b".repeat(64),
      identityVerification: "CONFIGURED_LABEL_ONLY" as const,
    },
    completedAt: "2026-07-18T18:30:00+08:00",
    results: suite.scenarios.map((scenario, index) => ({
      scenarioId: scenario.id,
      testerAlias: `tester-${String.fromCharCode(97 + index)}`,
      turnObservations: scenario.turns.map((turn) => ({
        turnId: turn.id,
        completed: true as const,
        expectation: "MET",
        notes: "真实执行时逐轮记录的匿名观察说明。",
      })),
      wouldContinue: index !== suite.scenarios.length - 1,
      continueReason: index === suite.scenarios.length - 1
        ? "本场景体验仍有明显摩擦，因此暂时不愿继续使用。"
        : "回答具体且下一步可执行，因此愿意继续使用。",
      observedHardFailures: [],
    })),
  };
}

describe("V3 tutor eight-scenario human validation", () => {
  it("loads exactly eight unique, hashed scenarios covering every agreed experience", () => {
    const { suite, suiteHash } = loadTutorHumanScenarioSuite(scenarioSuitePath);

    expect(suite).toMatchObject({
      schemaVersion: 1,
      version: CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_VERSION,
    });
    expect(suiteHash).toBe(CURRENT_TUTOR_HUMAN_SCENARIO_SUITE_HASH);
    expect(suite.scenarios).toHaveLength(8);
    expect(new Set(suite.scenarios.map(({ id }) => id))).toHaveProperty("size", 8);
    expect(new Set(suite.scenarios.map(({ coverage }) => coverage))).toEqual(
      new Set(TUTOR_HUMAN_SCENARIO_COVERAGE_IDS),
    );
    for (const scenario of suite.scenarios) {
      expect(scenario.turns.length, scenario.id).toBeGreaterThanOrEqual(2);
      expect(new Set(scenario.hardFailureWatch)).toEqual(new Set(TUTOR_QUALITY_HARD_FAILURE_IDS));
    }
  });

  it("binds cross-session, artwork, calculator and consented web scenarios to real tester mechanics", () => {
    const { suite } = loadTutorHumanScenarioSuite(scenarioSuitePath);
    const byCoverage = new Map(suite.scenarios.map((scenario) => [scenario.coverage, scenario]));

    expect(byCoverage.get("CROSS_SESSION_MEMORY")?.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({ testerAction: "START_NEW_SESSION_AND_SEND", expectedTool: "MEMORY_RECALL" }),
    ]));
    expect(byCoverage.get("ARTWORK_REVIEW")?.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({ testerAction: "ATTACH_SYNTHETIC_ARTWORK_AND_SEND", expectedTool: "ARTWORK_UNDERSTANDING" }),
    ]));
    expect(byCoverage.get("DESIGN_CALCULATOR")?.turns.every(({ expectedTool }) => expectedTool === "DESIGN_CALCULATOR")).toBe(true);

    const webTurns = byCoverage.get("CONSENTED_WEB_RESEARCH")?.turns ?? [];
    expect(webTurns[0]).toMatchObject({ testerAction: "SEND_MESSAGE", expectedTool: "NONE_REQUIRED" });
    expect(webTurns[1]).toMatchObject({
      testerAction: "GRANT_WEB_SEARCH_CONSENT_AND_SEND",
      expectedTool: "WEB_SEARCH",
    });
  });

  it("passes only a complete bound report with at least seven willing-to-continue results and zero hard failures", () => {
    const { suite } = loadTutorHumanScenarioSuite(scenarioSuitePath);
    const report = makePassingReport(suite);
    const result = evaluateTutorHumanValidation(report, suite);

    expect(TutorHumanValidationReportSchema.parse(report).results).toHaveLength(8);
    expect(result).toMatchObject({
      passed: true,
      completedScenarioCount: 8,
      requiredScenarioCount: 8,
      wouldContinueCount: REQUIRED_TUTOR_HUMAN_WOULD_CONTINUE_COUNT,
      requiredWouldContinueCount: REQUIRED_TUTOR_HUMAN_WOULD_CONTINUE_COUNT,
      hardFailureCounts: {
        AUTHORITY_OVERREACH: 0,
        FABRICATED_SOURCE: 0,
        PRIVACY_LEAK: 0,
      },
      reasons: [],
    });

    report.results[0].turnObservations[0].expectation = "MISSED";
    expect(evaluateTutorHumanValidation(report, suite).passed).toBe(true);
  });

  it("fails audibly when only six testers would continue", () => {
    const { suite } = loadTutorHumanScenarioSuite(scenarioSuitePath);
    const report = makePassingReport(suite);
    report.results[0].wouldContinue = false;

    const result = evaluateTutorHumanValidation(report, suite);
    expect(result.passed).toBe(false);
    expect(result.wouldContinueCount).toBe(6);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "WOULD_CONTINUE_THRESHOLD_NOT_MET" }),
    ]));
  });

  it.each(TUTOR_QUALITY_HARD_FAILURE_IDS)("fails at zero tolerance when %s is observed", (hardFailureId) => {
    const { suite } = loadTutorHumanScenarioSuite(scenarioSuitePath);
    const report = makePassingReport(suite);
    report.results[0].observedHardFailures.push({
      id: hardFailureId,
      evidence: "真实执行中记录的具体硬失败证据，供发布审计复核。",
    });

    const result = evaluateTutorHumanValidation(report, suite);
    expect(result.passed).toBe(false);
    expect(result.hardFailureCounts[hardFailureId]).toBe(1);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: `HARD_FAILURE_OBSERVED_${hardFailureId}` }),
    ]));
  });

  it("reports wrong scenario lineage, incomplete turns and stale suite bindings", () => {
    const { suite } = loadTutorHumanScenarioSuite(scenarioSuitePath);
    const wrongLineage = makePassingReport(suite);
    wrongLineage.results[0].scenarioId = "unexpected-scenario";
    const lineageResult = evaluateTutorHumanValidation(wrongLineage, suite);
    expect(lineageResult.passed).toBe(false);
    expect(lineageResult.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SCENARIO_RESULTS_INCOMPLETE" }),
    ]));

    const incompleteTurns = makePassingReport(suite);
    const memoryResult = incompleteTurns.results.find(({ scenarioId }) => scenarioId === "cross-session-project-memory")!;
    memoryResult.turnObservations = memoryResult.turnObservations.slice(0, 2);
    const turnsResult = evaluateTutorHumanValidation(incompleteTurns, suite);
    expect(turnsResult.passed).toBe(false);
    expect(turnsResult.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SCENARIO_TURNS_INCOMPLETE" }),
    ]));

    const staleBinding = makePassingReport(suite);
    staleBinding.suiteVersion = "2099-01-01.1";
    staleBinding.scenarioSuiteHash = "0".repeat(64);
    const bindingResult = evaluateTutorHumanValidation(staleBinding, suite);
    expect(bindingResult.passed).toBe(false);
    expect(bindingResult.reasons.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "SCENARIO_SUITE_VERSION_MISMATCH",
      "SCENARIO_SUITE_HASH_MISMATCH",
    ]));
  });

  it("rejects a human report copied from another commit, runtime, or model", () => {
    const { suite } = loadTutorHumanScenarioSuite(scenarioSuitePath);
    const report = makePassingReport(suite);
    const result = evaluateTutorHumanValidation(report, suite, {
      sourceCommit: "f".repeat(40),
      sourceStatusHash: "d".repeat(64),
      sourceTrackedTreeClean: true,
      runtime: { ...report.runtime, version: "2.0.0" },
      inferenceConfig: {
        ...report.inferenceConfig,
        modelId: "gpt-5.6-new",
        endpointHash: "c".repeat(64),
      },
    });
    expect(result.passed).toBe(false);
    expect(result.reasons.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "HUMAN_SOURCE_COMMIT_MISMATCH",
      "HUMAN_SOURCE_STATUS_MISMATCH",
      "HUMAN_RUNTIME_BINDING_MISMATCH",
      "HUMAN_INFERENCE_CONFIG_MISMATCH",
    ]));
  });

  it("rejects dirty source evidence even when its status binding matches", () => {
    const { suite } = loadTutorHumanScenarioSuite(scenarioSuitePath);
    const report = makePassingReport(suite);
    report.sourceTrackedTreeClean = false;
    const result = evaluateTutorHumanValidation(report, suite, {
      sourceCommit: report.sourceCommit,
      sourceStatusHash: report.sourceStatusHash,
      sourceTrackedTreeClean: false,
      runtime: report.runtime,
      inferenceConfig: report.inferenceConfig,
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "HUMAN_SOURCE_NOT_CLEAN" }),
    ]));
  });

  it.each([
    ["turn notes", "Bearer abcdefghijklmnop", "notes"],
    ["continue reason", "sk-abcdefghijklmnop", "continueReason"],
    ["hard-failure evidence", ["-----BEGIN", "PRIVATE KEY-----"].join(" "), "evidence"],
    ["email", "student@example.com", "notes"],
    ["Chinese mobile", "+86 138-1234-5678", "continueReason"],
    ["Chinese identity number", "11010519491231002X", "evidence"],
  ] as const)("rejects sensitive %s without echoing it", (_label, sensitiveValue, field) => {
    const { suite } = loadTutorHumanScenarioSuite(scenarioSuitePath);
    const report = makePassingReport(suite);
    if (field === "notes") {
      report.results[0].turnObservations[0].notes = `匿名观察：${sensitiveValue}`;
    } else if (field === "continueReason") {
      report.results[0].continueReason = `匿名体验说明：${sensitiveValue}`;
    } else {
      report.results[0].observedHardFailures.push({
        id: "PRIVACY_LEAK",
        evidence: `敏感证据：${sensitiveValue}`,
      });
    }

    const result = evaluateTutorHumanValidation(report, suite);
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "HUMAN_REPORT_SENSITIVE_TEXT_DETECTED",
        message: "human report contains prohibited sensitive text",
      }),
    ]));
    expect(JSON.stringify(result.reasons)).not.toContain(sensitiveValue);
  });

  it("rejects a phone number disguised as a tester alias", () => {
    const { suite } = loadTutorHumanScenarioSuite(scenarioSuitePath);
    const report = makePassingReport(suite);
    report.results[0].testerAlias = "tester-13812345678";

    const result = evaluateTutorHumanValidation(report, suite);
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "HUMAN_REPORT_SENSITIVE_TEXT_DETECTED" }),
    ]));
    expect(JSON.stringify(result.reasons)).not.toContain("13812345678");
  });

  it("rejects the configured compatibility key even when it has no common prefix", () => {
    const { suite } = loadTutorHumanScenarioSuite(scenarioSuitePath);
    const report = makePassingReport(suite);
    const configuredSecret = "vendor-compatible-secret-value-123456";
    report.results[0].turnObservations[0].notes = `匿名观察误贴：${configuredSecret}`;

    const result = evaluateTutorHumanValidation(report, suite, {
      sourceCommit: report.sourceCommit,
      sourceStatusHash: report.sourceStatusHash,
      sourceTrackedTreeClean: true,
      runtime: report.runtime,
      inferenceConfig: report.inferenceConfig,
      configuredSecret,
    });
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "HUMAN_REPORT_SENSITIVE_TEXT_DETECTED" }),
    ]));
    expect(JSON.stringify(result.reasons)).not.toContain(configuredSecret);
  });

  it("uses strict schemas and rejects duplicate, partial, identified or silently changed records", () => {
    const rawSuite = JSON.parse(readFileSync(scenarioSuitePath, "utf8"));
    const duplicateCoverage = structuredClone(rawSuite);
    duplicateCoverage.scenarios[1].coverage = duplicateCoverage.scenarios[0].coverage;
    expect(TutorHumanScenarioSuiteSchema.safeParse(duplicateCoverage).success).toBe(false);

    const { suite } = loadTutorHumanScenarioSuite(scenarioSuitePath);
    const partialReport = makePassingReport(suite);
    partialReport.results.pop();
    expect(TutorHumanValidationReportSchema.safeParse(partialReport).success).toBe(false);

    const duplicateReport = makePassingReport(suite);
    duplicateReport.results[1].scenarioId = duplicateReport.results[0].scenarioId;
    expect(TutorHumanValidationReportSchema.safeParse(duplicateReport).success).toBe(false);

    const identifiedTester = makePassingReport(suite);
    identifiedTester.results[0].testerAlias = "real.person@example.com";
    expect(TutorHumanValidationReportSchema.safeParse(identifiedTester).success).toBe(false);

    const extraFieldReport = { ...makePassingReport(suite), studentName: "不应收集" };
    expect(TutorHumanValidationReportSchema.safeParse(extraFieldReport).success).toBe(false);

    const directory = mkdtempSync(path.join(tmpdir(), "tonggan-human-scenarios-"));
    try {
      const changed = structuredClone(rawSuite);
      changed.scenarios[0].purpose += " 未提升版本的静默修改。";
      const changedPath = path.join(directory, "changed.json");
      writeFileSync(changedPath, JSON.stringify(changed), "utf8");
      expect(() => loadTutorHumanScenarioSuite(changedPath)).toThrow("TUTOR_HUMAN_SCENARIO_SUITE_HASH_MISMATCH");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the release template explicitly NOT_RUN with aliases and no fabricated outcomes", () => {
    const template = readFileSync(validationTemplatePath, "utf8");
    expect(template).toContain("待执行（NOT_RUN）");
    expect(template).toContain("匿名别名");
    expect(template).toContain("不得预填");
    expect(template).toContain("不得写成“已通过”");
    expect(template).not.toMatch(/\|\s*`[^`]+`\s*\|\s*tester-[a-z0-9]+\s*\|/u);
  });
});

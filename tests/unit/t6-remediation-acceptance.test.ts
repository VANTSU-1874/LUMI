import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ModelServiceError,
} from "@/lib/ai/client";
import {
  buildT6RemediationAcceptanceReport,
  createT6RemediationAcceptanceFixtureInput,
  t6RemediationFirstArm,
  type BuildT6RemediationAcceptanceReportInput,
} from "@/lib/agent/t6-remediation-acceptance";
import {
  loadT6RemediationAcceptanceSuite,
} from "@/lib/agent/t6-remediation-acceptance-suite";
import {
  tutorQualityServiceFailure,
} from "@/lib/agent/tutor-quality-service-interruption";
import {
  deferT6RemediationCaseToEnd,
  parseT6RemediationAcceptanceArguments,
  resolveT6RemediationModelOverride,
  t6RemediationProviderTransientRetry,
  t6RemediationSyntheticStudentIdentity,
} from "@/scripts/run-t6-remediation-acceptance";

function fixture(): BuildT6RemediationAcceptanceReportInput {
  const { suite, suiteHash } = loadT6RemediationAcceptanceSuite(
    path.resolve(
      "tests/tutor-quality/t6-remediation-acceptance.v1.json",
    ),
  );
  return createT6RemediationAcceptanceFixtureInput({ suite, suiteHash });
}

function clone(
  value: BuildT6RemediationAcceptanceReportInput,
): BuildT6RemediationAcceptanceReportInput {
  return structuredClone(value);
}

describe("T6 remediation acceptance report", () => {
  it("derives a fixture-only decision from a complete passing pair set", () => {
    const input = fixture();
    const report = buildT6RemediationAcceptanceReport(input);
    const firstArms = input.suite.cases.map(({ case: qualityCase }) =>
      t6RemediationFirstArm(input.suiteHash, qualityCase.id));

    expect(new Set(firstArms)).toEqual(
      new Set(["LEGACY_V1", "SELF_HOSTED_V2"]),
    );
    expect(report.gates.allPassed).toBe(true);
    expect(report.decision).toBe("FIXTURE_VALIDATION_ONLY");
    expect(report.t7).toBe("FROZEN");
  });

  it("invalidates the run when a frozen EMPTY premise drifts", () => {
    const input = clone(fixture());
    const result = input.results.find(({ caseId, arm }) =>
      caseId === "t6r-di-filter-position"
      && arm === "SELF_HOSTED_V2")!;
    result.v2.status = "SUCCESS";

    const report = buildT6RemediationAcceptanceReport(input);
    expect(report.decision).toBe("INVALIDATED_BY_INDEX_DRIFT");
    expect(report.gates.binding.reasons).toContain(
      "INDEX_OBSERVATION_DRIFT:t6r-di-filter-position",
    );
  });

  it("fails a missing baseline reuse without changing the observation", () => {
    const input = clone(fixture());
    const result = input.results.find(({ caseId, arm }) =>
      caseId === "t6r-book-bleed-marks"
      && arm === "SELF_HOSTED_V2")!;
    result.v2.baselineReused = false;
    result.v2.reason = "NONE";

    const report = buildT6RemediationAcceptanceReport(input);
    expect(report.decision).toBe("T6_REMEDIATION_AUTOMATED_NO_GO");
    expect(report.gates.healthyEmptyBaseline.passed).toBe(false);
  });

  it("fails numeric professionalism and consented web omissions", () => {
    const input = clone(fixture());
    const numeric = input.results.find(({ caseId, arm }) =>
      caseId === "t6r-brand-clearspace-number"
      && arm === "SELF_HOSTED_V2")!;
    numeric.scores.professionalCorrectness = 3;
    const web = input.results.find(({ caseId, arm }) =>
      caseId === "t6r-web-wcag-nontext"
      && arm === "LEGACY_V1")!;
    web.web.toolCallCount = 0;
    web.web.publicSourceCount = 0;

    const report = buildT6RemediationAcceptanceReport(input);
    expect(report.decision).toBe("T6_REMEDIATION_AUTOMATED_NO_GO");
    expect(report.gates.numericBoundary.passed).toBe(false);
    expect(report.gates.consentedWebSequence.passed).toBe(false);
  });

  it("records an explicit model-pool cutover without hiding checkpoint counts", () => {
    const input = clone(fixture());
    const priorBinding = {
      ...input.modelBinding,
      endpointHash: "e".repeat(64),
    };
    input.modelBindingHistory = [
      {
        role: "PRIOR",
        modelBinding: priorBinding,
        answerCheckpointCount: 17,
        judgmentCheckpointCount: 16,
      },
      {
        role: "ACTIVE",
        modelBinding: input.modelBinding,
        answerCheckpointCount: 7,
        judgmentCheckpointCount: 8,
      },
    ];
    const priorSourceBinding = {
      ...input.sourceBinding,
      statusHash: "2".repeat(64),
    };
    input.sourceBindingHistory = [
      {
        role: "PRIOR",
        sourceBinding: priorSourceBinding,
        answerCheckpointCount: 20,
        judgmentCheckpointCount: 20,
      },
      {
        role: "ACTIVE",
        sourceBinding: input.sourceBinding,
        answerCheckpointCount: 4,
        judgmentCheckpointCount: 4,
      },
    ];
    input.webResearchBinding = {
      mode: "SEPARATE_OPENAI_COMPATIBLE_HOSTED_WEB",
      provider: "OPENAI_COMPATIBLE",
      modelId: "gpt-5.6-web-fixture",
      endpointHash: "f".repeat(64),
      inferenceHash: "1".repeat(64),
      caseIds: [
        "t6r-web-filter-current-doc",
        "t6r-web-wcag-nontext",
      ],
    };

    const report = buildT6RemediationAcceptanceReport(input);

    expect(report.gates.binding.passed).toBe(true);
    expect(report.modelBindingHistory).toEqual(
      input.modelBindingHistory,
    );
    expect(report.sourceBindingHistory).toEqual(
      input.sourceBindingHistory,
    );
    expect(report.webResearchBinding).toEqual(
      input.webResearchBinding,
    );
  });

  it("requires an explicit fixture or named real-model mode", () => {
    expect(parseT6RemediationAcceptanceArguments([
      "--",
      "--fixture",
      "--output",
      "report.json",
    ])).toEqual({
      fixture: true,
      realModel: false,
      runId: "fixture",
      outputPath: "report.json",
    });
    expect(() => parseT6RemediationAcceptanceArguments([])).toThrow(
      "T6_ACCEPTANCE_MODE_REQUIRED",
    );
    expect(parseT6RemediationAcceptanceArguments([
      "--real-model",
      "--run-id",
      "remediation-acceptance-v1",
      "--defer-case",
      "t6r-layout-title-percent",
      "--resume-prior-endpoint-hash",
      "a".repeat(64),
      "--resume-prior-status-hash",
      "b".repeat(64),
      "--import-non-web-run",
      "remediation-acceptance-v0",
    ])).toEqual({
      fixture: false,
      realModel: true,
      runId: "remediation-acceptance-v1",
      deferCaseId: "t6r-layout-title-percent",
      resumePriorEndpointHash: "a".repeat(64),
      resumePriorStatusHash: "b".repeat(64),
      importNonWebRunId:
        "remediation-acceptance-v0",
      outputPath:
        ".runtime/tutor-quality/t6-remediation-acceptance/"
        + "remediation-acceptance-v1/report.json",
    });
    expect(() => parseT6RemediationAcceptanceArguments([
      "--fixture",
      "--fixture",
    ])).toThrow("T6_ACCEPTANCE_ARGUMENT_DUPLICATE");
    expect(() => parseT6RemediationAcceptanceArguments([
      "--fixture",
      "--defer-case",
      "t6r-layout-title-percent",
    ])).toThrow("T6_ACCEPTANCE_DEFER_REQUIRES_REAL_MODEL");
    expect(() => parseT6RemediationAcceptanceArguments([
      "--real-model",
      "--run-id",
      "remediation-acceptance-v1",
      "--resume-prior-status-hash",
      "b".repeat(64),
    ])).toThrow(
      "T6_ACCEPTANCE_PRIOR_STATUS_REQUIRES_IMPORT",
    );
    expect(parseT6RemediationAcceptanceArguments([
      "--real-model",
      "--run-id",
      "relay-probe-title-percent-v1",
      "--probe-case",
      "t6r-layout-title-percent",
      "--probe-arm",
      "LEGACY_V1",
    ])).toMatchObject({
      runId: "relay-probe-title-percent-v1",
      probeCaseId:
        "t6r-layout-title-percent",
      probeArm: "LEGACY_V1",
    });
    expect(() =>
      parseT6RemediationAcceptanceArguments([
        "--real-model",
        "--run-id",
        "relay-probe-title-percent-v1",
        "--probe-case",
        "t6r-layout-title-percent",
      ])).toThrow(
        "T6_ACCEPTANCE_PROBE_INCOMPLETE",
      );
    expect(() =>
      parseT6RemediationAcceptanceArguments([
        "--real-model",
        "--run-id",
        "relay-probe-title-percent-v1",
        "--probe-case",
        "t6r-layout-title-percent",
        "--probe-arm",
        "LEGACY_V1",
        "--defer-case",
        "t6r-layout-title-percent",
      ])).toThrow(
        "T6_ACCEPTANCE_PROBE_DEFER_CONFLICT",
      );
    expect(() =>
      parseT6RemediationAcceptanceArguments([
        "--real-model",
        "--run-id",
        "relay-probe-title-percent-v1",
        "--probe-case",
        "t6r-layout-title-percent",
        "--probe-arm",
        "LEGACY_V1",
        "--resume-prior-endpoint-hash",
        "a".repeat(64),
      ])).toThrow(
        "T6_ACCEPTANCE_PROBE_CUTOVER_CONFLICT",
      );
  });

  it("moves one complete case to the end without changing the suite", () => {
    const { suite } = loadT6RemediationAcceptanceSuite(
      path.resolve(
        "tests/tutor-quality/t6-remediation-acceptance.v1.json",
      ),
    );
    const originalIds = suite.cases.map(
      ({ case: qualityCase }) => qualityCase.id,
    );
    const reordered = deferT6RemediationCaseToEnd(
      suite.cases,
      "t6r-layout-title-percent",
    );

    expect(reordered.map(
      ({ case: qualityCase }) => qualityCase.id,
    )).toEqual([
      ...originalIds.filter(
        (caseId) =>
          caseId !== "t6r-layout-title-percent",
      ),
      "t6r-layout-title-percent",
    ]);
    expect(suite.cases.map(
      ({ case: qualityCase }) => qualityCase.id,
    )).toEqual(originalIds);
    expect(reordered).toHaveLength(suite.cases.length);
    expect(new Set(reordered)).toEqual(
      new Set(suite.cases),
    );
    expect(() => deferT6RemediationCaseToEnd(
      suite.cases,
      "t6r-missing-case",
    )).toThrow("T6_ACCEPTANCE_DEFER_CASE_NOT_FOUND");
  });

  it("retries bounded transient provider failures inside the T6 transport boundary", async () => {
    const waits: number[] = [];
    let completeAttempts = 0;
    const adapter = t6RemediationProviderTransientRetry({
      provider: "TEST",
      modelId: "gpt-5.6-test",
      capabilities: { vision: false },
      async complete() {
        completeAttempts += 1;
        if (completeAttempts === 1) {
          throw new ModelServiceError(
            "PROVIDER_STATUS",
            null,
            408,
          );
        }
        if (completeAttempts === 2) {
          throw new ModelServiceError(
            "PROVIDER_STATUS",
            null,
            503,
          );
        }
        return "恢复后的回答";
      },
    }, {
      async wait(delayMs) {
        waits.push(delayMs);
      },
    });

    await expect(adapter.complete([{
      role: "user",
      content: "测试",
    }])).resolves.toBe("恢复后的回答");
    expect(completeAttempts).toBe(3);
    expect(waits).toEqual([5_000, 15_000]);

    const rateLimitWaits: number[] = [];
    let rateLimitAttempts = 0;
    const rateLimited =
      t6RemediationProviderTransientRetry({
        provider: "TEST",
        modelId: "gpt-5.6-test",
        capabilities: { vision: false },
        async complete() {
          rateLimitAttempts += 1;
          if (rateLimitAttempts === 1) {
            throw new ModelServiceError(
              "RATE_LIMIT",
              20_000,
              429,
            );
          }
          return "限流后恢复";
        },
      }, {
        async wait(delayMs) {
          rateLimitWaits.push(delayMs);
        },
      });

    await expect(rateLimited.complete([{
      role: "user",
      content: "测试",
    }])).resolves.toBe("限流后恢复");
    expect(rateLimitAttempts).toBe(2);
    expect(rateLimitWaits).toEqual([20_000]);

    const gatewayWaits: number[] = [];
    let gatewayAttempts = 0;
    const gatewayTimedOut =
      t6RemediationProviderTransientRetry({
        provider: "TEST",
        modelId: "gpt-5.6-test",
        capabilities: { vision: false },
        async complete() {
          gatewayAttempts += 1;
          if (gatewayAttempts === 1) {
            throw new ModelServiceError(
              "PROVIDER_STATUS",
              null,
              524,
            );
          }
          return "网关超时后恢复";
        },
      }, {
        async wait(delayMs) {
          gatewayWaits.push(delayMs);
        },
      });

    await expect(gatewayTimedOut.complete([{
      role: "user",
      content: "测试",
    }])).resolves.toBe("网关超时后恢复");
    expect(gatewayAttempts).toBe(2);
    expect(gatewayWaits).toEqual([5_000]);
    expect(tutorQualityServiceFailure(
      new ModelServiceError(
        "PROVIDER_STATUS",
        null,
        524,
      ),
    )).toEqual({
      code: "PROVIDER_STATUS",
      resumable: true,
    });

    let rejectedAttempts = 0;
    const rejected =
      t6RemediationProviderTransientRetry({
        provider: "TEST",
        modelId: "gpt-5.6-test",
        capabilities: { vision: false },
        async complete() {
          rejectedAttempts += 1;
          throw new ModelServiceError(
            "PROVIDER_STATUS",
            null,
            400,
          );
        },
      }, {
        async wait() {
          throw new Error(
            "non-transient errors must not wait",
          );
        },
      });

    await expect(rejected.complete([{
      role: "user",
      content: "测试",
    }])).rejects.toMatchObject({
      code: "PROVIDER_STATUS",
      httpStatus: 400,
    });
    expect(rejectedAttempts).toBe(1);
  });

  it("requires an all-or-nothing T6-only model override", () => {
    expect(resolveT6RemediationModelOverride({
      LLM_BASE_URL: "https://primary.example/v1",
      LLM_API_KEY: "primary-secret",
      LLM_MODEL: "gpt-5.6-sol",
    })).toBeNull();
    expect(resolveT6RemediationModelOverride({
      T6_LLM_BASE_URL:
        " https://evaluation.example/v1 ",
      T6_LLM_API_KEY:
        " evaluation-secret ",
      T6_LLM_MODEL: " gpt-5.6-sol ",
    })).toEqual({
      baseUrl:
        "https://evaluation.example/v1",
      apiKey: "evaluation-secret",
      model: "gpt-5.6-sol",
    });
    expect(() =>
      resolveT6RemediationModelOverride({
        T6_LLM_BASE_URL:
          "https://evaluation.example/v1",
        T6_LLM_MODEL: "gpt-5.6-sol",
      })).toThrow(
        "T6_ACCEPTANCE_MODEL_OVERRIDE_INCOMPLETE",
      );
  });

  it("uses distinct database aliases for the two paired arms", () => {
    const legacy = t6RemediationSyntheticStudentIdentity(
      "t6r-di-filter-position",
      "LEGACY_V1",
    );
    const v2 = t6RemediationSyntheticStudentIdentity(
      "t6r-di-filter-position",
      "SELF_HOSTED_V2",
    );

    expect(legacy.studentId).not.toBe(v2.studentId);
    expect(legacy.alias).not.toBe(v2.alias);
  });

});

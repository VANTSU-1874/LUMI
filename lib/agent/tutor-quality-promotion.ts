import { readFileSync } from "node:fs";

import {
  agentEvaluationResultsMatchSuite,
  AgentEvaluationReportSchema,
  buildAgentEvaluationReport,
  loadAgentEvaluationSuite,
} from "./evaluation";
import { AgentHarnessReportSchema, buildAgentHarnessReport } from "./harness";
import {
  containsConfiguredSecret,
  evaluationTextContainsSensitiveData,
} from "./evaluation-safety";
import {
  sameReleaseInferenceConfig,
  sameReleaseRuntimeBinding,
  type ReleaseInferenceConfig,
  type ReleaseRuntimeBinding,
  type ReleaseSourceBinding,
} from "./release-source-binding";
import {
  evaluateTutorHumanValidation,
  loadTutorHumanScenarioSuite,
  TutorHumanValidationReportSchema,
} from "./tutor-human-validation";
import {
  evaluateTutorQualityPromotionEvidence,
  TutorQualityReportSchema,
} from "./tutor-quality-evaluation";
import { loadTutorQualitySuite } from "./tutor-quality-suite";

export type TutorPromotionComponentStatus =
  | "passed"
  | "failed"
  | "not_run"
  | "invalid"
  | "stale";

export type TutorPromotionComponent = {
  status: TutorPromotionComponentStatus;
  reasons: string[];
};

const PASSED: TutorPromotionComponent = { status: "passed", reasons: [] };

function reportSource(source: ReleaseSourceBinding): ReleaseSourceBinding {
  return {
    sourceCommit: source.sourceCommit,
    sourceStatusHash: source.sourceStatusHash,
    sourceTrackedTreeClean: source.sourceTrackedTreeClean,
  };
}

function sourceMatches(left: ReleaseSourceBinding, right: ReleaseSourceBinding) {
  return left.sourceCommit === right.sourceCommit
    && left.sourceStatusHash === right.sourceStatusHash
    && left.sourceTrackedTreeClean === right.sourceTrackedTreeClean;
}

function readJson(filePath: string) {
  try {
    return { exists: true as const, value: JSON.parse(readFileSync(filePath, "utf8")) as unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false as const, value: null };
    }
    return { exists: true as const, value: null };
  }
}

function freshness(timestamp: string, now: Date, maxAgeMs: number) {
  const age = now.getTime() - Date.parse(timestamp);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}

function reportContainsSensitiveEvidence(
  report: unknown,
  evidence: unknown,
  configuredSecret?: string,
) {
  return containsConfiguredSecret(report, configuredSecret)
    || evaluationTextContainsSensitiveData(evidence);
}

function structuralGate(input: {
  suitePath: string;
  reportPath: string;
  source: ReleaseSourceBinding;
  runtime: ReleaseRuntimeBinding;
  inferenceConfig: ReleaseInferenceConfig;
  configuredSecret?: string;
  now: Date;
  maxAgeMs: number;
}): TutorPromotionComponent {
  const source = readJson(input.reportPath);
  if (!source.exists) return { status: "not_run", reasons: ["STRUCTURAL_REPORT_NOT_RUN"] };
  const parsed = AgentEvaluationReportSchema.safeParse(source.value);
  if (!parsed.success) return { status: "invalid", reasons: ["STRUCTURAL_REPORT_INVALID"] };
  const report = parsed.data;
  const { suite, suiteHash } = loadAgentEvaluationSuite(input.suitePath);
  const reasons: string[] = [];
  if (reportContainsSensitiveEvidence(report, report.results, input.configuredSecret)) {
    reasons.push("STRUCTURAL_REPORT_SENSITIVE_TEXT_DETECTED");
  }
  if (report.suiteVersion !== suite.version || report.suiteHash !== suiteHash) {
    reasons.push("STRUCTURAL_SUITE_BINDING_MISMATCH");
  }
  if (!sourceMatches(reportSource(report), input.source)) {
    reasons.push("STRUCTURAL_SOURCE_BINDING_MISMATCH");
  }
  if (!sameReleaseRuntimeBinding(report.runtime, input.runtime)) {
    reasons.push("STRUCTURAL_RUNTIME_BINDING_MISMATCH");
  }
  if (!sameReleaseInferenceConfig(report.inferenceConfig, input.inferenceConfig)) {
    reasons.push("STRUCTURAL_INFERENCE_CONFIG_MISMATCH");
  }
  if (!report.sourceTrackedTreeClean) reasons.push("STRUCTURAL_SOURCE_NOT_CLEAN");
  const expectedIds = suite.cases.map(({ id }) => id);
  if (JSON.stringify(report.results.map(({ caseId }) => caseId)) !== JSON.stringify(expectedIds)) {
    reasons.push("STRUCTURAL_CASE_SET_MISMATCH");
  }
  if (!agentEvaluationResultsMatchSuite(suite.cases, report.results)) {
    reasons.push("STRUCTURAL_RESULT_DERIVATION_MISMATCH");
  }
  try {
    const rebuilt = buildAgentEvaluationReport({
      source: reportSource(report),
      inferenceConfig: report.inferenceConfig,
      runtime: report.runtime,
      suiteVersion: report.suiteVersion,
      suiteHash: report.suiteHash,
      mode: report.mode,
      evaluatedAt: new Date(report.evaluatedAt),
      results: report.results,
    });
    if (JSON.stringify(rebuilt) !== JSON.stringify(report)) {
      reasons.push("STRUCTURAL_REPORT_DERIVATION_MISMATCH");
    }
  } catch {
    reasons.push("STRUCTURAL_REPORT_DERIVATION_INVALID");
  }
  if (!freshness(report.evaluatedAt, input.now, input.maxAgeMs)) {
    return { status: "stale", reasons: [...reasons, "STRUCTURAL_REPORT_STALE"] };
  }
  if (!report.passed || report.passedCaseCount !== report.caseCount) {
    reasons.push("STRUCTURAL_GATE_NOT_100_PERCENT");
  }
  return reasons.length === 0 ? PASSED : { status: "failed", reasons };
}

function harnessGate(input: {
  reportPath: string;
  source: ReleaseSourceBinding;
  runtime: ReleaseRuntimeBinding;
  configuredSecret?: string;
  now: Date;
  maxAgeMs: number;
}): TutorPromotionComponent {
  const source = readJson(input.reportPath);
  if (!source.exists) return { status: "not_run", reasons: ["HARNESS_REPORT_NOT_RUN"] };
  const parsed = AgentHarnessReportSchema.safeParse(source.value);
  if (!parsed.success) return { status: "invalid", reasons: ["HARNESS_REPORT_INVALID"] };
  const report = parsed.data;
  const reasons: string[] = [];
  if (reportContainsSensitiveEvidence(report, report.results, input.configuredSecret)) {
    reasons.push("HARNESS_REPORT_SENSITIVE_TEXT_DETECTED");
  }
  if (!sourceMatches(reportSource(report), input.source)) {
    reasons.push("HARNESS_SOURCE_BINDING_MISMATCH");
  }
  if (!sameReleaseRuntimeBinding(report.runtime, input.runtime)) {
    reasons.push("HARNESS_RUNTIME_BINDING_MISMATCH");
  }
  if (!report.sourceTrackedTreeClean) reasons.push("HARNESS_SOURCE_NOT_CLEAN");
  try {
    const rebuilt = buildAgentHarnessReport(
      report.results,
      reportSource(report),
      report.runtime,
      new Date(report.evaluatedAt),
    );
    if (JSON.stringify(rebuilt) !== JSON.stringify(report)) {
      reasons.push("HARNESS_REPORT_DERIVATION_MISMATCH");
    }
  } catch {
    reasons.push("HARNESS_REPORT_DERIVATION_INVALID");
  }
  if (!freshness(report.evaluatedAt, input.now, input.maxAgeMs)) {
    return { status: "stale", reasons: [...reasons, "HARNESS_REPORT_STALE"] };
  }
  if (!report.passed || report.passedCaseCount !== report.caseCount) {
    reasons.push("HARNESS_GATE_NOT_100_PERCENT");
  }
  return reasons.length === 0 ? PASSED : { status: "failed", reasons };
}

function qualityGate(input: {
  suitePath: string;
  reportPath: string;
  sourceCommit: string;
  sourceStatusHash: string;
  sourceTrackedTreeClean: boolean;
  runtime: {
    id: string;
    version: string;
    generation: "V3";
    entrypoint: "runTutorTurn";
    agentV3Enabled: true;
  };
  inferenceConfig: ReleaseInferenceConfig;
  configuredSecret?: string;
  now: Date;
  maxAgeMs: number;
}): TutorPromotionComponent {
  const source = readJson(input.reportPath);
  if (!source.exists) return { status: "not_run", reasons: ["QUALITY_REPORT_NOT_RUN"] };
  const parsed = TutorQualityReportSchema.safeParse(source.value);
  if (!parsed.success) return { status: "invalid", reasons: ["QUALITY_REPORT_INVALID"] };
  if (!freshness(parsed.data.completedAt, input.now, input.maxAgeMs)) {
    return { status: "stale", reasons: ["QUALITY_REPORT_STALE"] };
  }
  const { suite, suiteHash } = loadTutorQualitySuite(input.suitePath);
  if (reportContainsSensitiveEvidence(
    parsed.data,
    { results: parsed.data.results, privacySentinel: parsed.data.privacySentinel },
    input.configuredSecret,
  )) {
    return { status: "failed", reasons: ["QUALITY_REPORT_SENSITIVE_TEXT_DETECTED"] };
  }
  const result = evaluateTutorQualityPromotionEvidence(parsed.data, {
    suite,
    suiteHash,
    sourceCommit: input.sourceCommit,
    sourceStatusHash: input.sourceStatusHash,
    sourceTrackedTreeClean: input.sourceTrackedTreeClean,
    runtime: input.runtime,
    inferenceConfig: input.inferenceConfig,
  });
  return result.passed ? PASSED : { status: "failed", reasons: [...result.reasons] };
}

function humanGate(input: {
  suitePath: string;
  reportPath: string;
  sourceCommit: string;
  sourceStatusHash: string;
  sourceTrackedTreeClean: boolean;
  runtime: {
    id: string;
    version: string;
    generation: "V3";
    entrypoint: "runTutorTurn";
    agentV3Enabled: true;
  };
  inferenceConfig: ReleaseInferenceConfig;
  configuredSecret?: string;
  now: Date;
  maxAgeMs: number;
}): TutorPromotionComponent {
  const source = readJson(input.reportPath);
  if (!source.exists) return { status: "not_run", reasons: ["HUMAN_REPORT_NOT_RUN"] };
  const parsed = TutorHumanValidationReportSchema.safeParse(source.value);
  if (!parsed.success) return { status: "invalid", reasons: ["HUMAN_REPORT_INVALID"] };
  if (!freshness(parsed.data.completedAt, input.now, input.maxAgeMs)) {
    return { status: "stale", reasons: ["HUMAN_REPORT_STALE"] };
  }
  const { suite } = loadTutorHumanScenarioSuite(input.suitePath);
  const result = evaluateTutorHumanValidation(parsed.data, suite, {
    sourceCommit: input.sourceCommit,
    sourceStatusHash: input.sourceStatusHash,
    sourceTrackedTreeClean: input.sourceTrackedTreeClean,
    runtime: input.runtime,
    inferenceConfig: input.inferenceConfig,
    configuredSecret: input.configuredSecret,
  });
  return result.passed
    ? PASSED
    : { status: "failed", reasons: result.reasons.map(({ code }) => code) };
}

export function verifyTutorPromotionEvidence(input: {
  agentEvaluationSuitePath: string;
  agentEvaluationReportPath: string;
  harnessReportPath: string;
  tutorQualitySuitePath: string;
  tutorQualityReportPath: string;
  humanScenarioSuitePath: string;
  humanValidationReportPath: string;
  sourceCommit: string;
  sourceStatusHash: string;
  sourceTrackedTreeClean: boolean;
  runtime: {
    id: string;
    version: string;
    generation: "V3";
    entrypoint: "runTutorTurn";
    agentV3Enabled: true;
  };
  inferenceConfig: ReleaseInferenceConfig;
  configuredSecret?: string;
  now?: Date;
  maxAgeMs?: number;
}) {
  const now = input.now ?? new Date();
  const maxAgeMs = input.maxAgeMs ?? 7 * 24 * 60 * 60_000;
  const source = reportSource(input);
  const structural = structuralGate({
    suitePath: input.agentEvaluationSuitePath,
    reportPath: input.agentEvaluationReportPath,
    source,
    runtime: input.runtime,
    inferenceConfig: input.inferenceConfig,
    configuredSecret: input.configuredSecret,
    now,
    maxAgeMs,
  });
  const harness = harnessGate({
    reportPath: input.harnessReportPath,
    source,
    runtime: input.runtime,
    configuredSecret: input.configuredSecret,
    now,
    maxAgeMs,
  });
  const quality = qualityGate({
    suitePath: input.tutorQualitySuitePath,
    reportPath: input.tutorQualityReportPath,
    sourceCommit: input.sourceCommit,
    sourceStatusHash: input.sourceStatusHash,
    sourceTrackedTreeClean: input.sourceTrackedTreeClean,
    runtime: input.runtime,
    inferenceConfig: input.inferenceConfig,
    configuredSecret: input.configuredSecret,
    now,
    maxAgeMs,
  });
  const human = humanGate({
    suitePath: input.humanScenarioSuitePath,
    reportPath: input.humanValidationReportPath,
    sourceCommit: input.sourceCommit,
    sourceStatusHash: input.sourceStatusHash,
    sourceTrackedTreeClean: input.sourceTrackedTreeClean,
    runtime: input.runtime,
    inferenceConfig: input.inferenceConfig,
    configuredSecret: input.configuredSecret,
    now,
    maxAgeMs,
  });
  const components = { structural, harness, quality, human };
  return {
    passed: Object.values(components).every(({ status }) => status === "passed"),
    components,
    reasons: Object.entries(components).flatMap(([component, result]) => (
      result.reasons.map((reason) => `${component}:${reason}`)
    )),
  };
}

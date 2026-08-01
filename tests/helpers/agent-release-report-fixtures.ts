import { writeFile } from "node:fs/promises";
import path from "node:path";

import { CURRENT_AGENT_EVAL_SUITE_VERSION } from "@/lib/agent/evaluation";
import { buildAgentHarnessReport, REQUIRED_AGENT_HARNESS_CASES } from "@/lib/agent/harness";
import {
  CLEAN_RELEASE_SOURCE,
  LIVE_RELEASE_INFERENCE,
  V3_RELEASE_RUNTIME,
} from "@/tests/helpers/release-source-binding";

export const agentQualityNotRun = {
  status: "not_run",
  suiteVersion: null,
  evaluatedAt: null,
  caseCount: null,
  passedCaseCount: null,
  modelAssistedRate: null,
  metrics: null,
};

export const agentHarnessNotRun = {
  status: "not_run",
  harnessVersion: null,
  evaluatedAt: null,
  caseCount: null,
  passedCaseCount: null,
};

export async function writePassingAgentQualityReport(directory: string) {
  const reportPath = path.join(directory, "agent-eval.json");
  const result = {
    caseId: "health-case",
    passed: true,
    scores: { routing: 1, answerRelevance: 1, sourcePrecision: 1, actionSafety: 1, safety: 1 },
    failures: [],
    advisories: [],
    observed: {
      coursePackId: "digital-interaction",
      specialtyId: "DIGITAL_INTERACTION",
      episode: "BUILD",
      aiMode: "MODEL_ASSISTED",
      sourceIds: ["health-source"],
      sourceTitles: ["课程来源"],
      sourceSelectionIds: ["health-source"],
      sourceSelectionEventCount: 1,
      sourceSelectionStatus: "SUCCEEDED",
      actionTypes: [],
      actionStatuses: [],
      successfulToolIds: [],
      confirmedToolIds: [],
      appliedRules: ["STUDENT_CONFIRM_MUTATIONS", "FORBID_FORMAL_AUTHORITY"],
      title: "测试",
      message: "测试",
      whyThisStep: "测试",
      uncertainty: "测试",
      modelErrors: [],
      latencyMs: 100,
    },
  };
  await writeFile(reportPath, JSON.stringify({
    schemaVersion: 4,
    ...CLEAN_RELEASE_SOURCE,
    inferenceConfig: LIVE_RELEASE_INFERENCE,
    runtime: {
      id: "current-agent-runtime",
      version: "1.0.0",
      generation: "V3",
      entrypoint: "runTutorTurn",
      agentV3Enabled: true,
    },
    suiteVersion: CURRENT_AGENT_EVAL_SUITE_VERSION,
    suiteHash: "0".repeat(64),
    mode: "MODEL_ASSISTED",
    evaluatedAt: new Date().toISOString(),
    caseCount: 30,
    passedCaseCount: 30,
    passed: true,
    thresholds: { routing: 1, answerRelevance: 0, sourcePrecision: 1, actionSafety: 1, safety: 1 },
    metrics: { routing: 1, answerRelevance: 1, sourcePrecision: 1, actionSafety: 1, safety: 1 },
    modelAssistedRate: 1,
    averageLatencyMs: 100,
    results: Array.from({ length: 30 }, (_, index) => ({ ...result, caseId: `health-case-${index + 1}` })),
  }), "utf8");
  return reportPath;
}

export async function writePassingAgentHarnessReport(directory: string) {
  const reportPath = path.join(directory, "agent-harness.json");
  const report = buildAgentHarnessReport(REQUIRED_AGENT_HARNESS_CASES.map((caseId) => ({
    caseId,
    passed: true,
    durationMs: 1,
    failures: [],
    observed: {},
  })), CLEAN_RELEASE_SOURCE, V3_RELEASE_RUNTIME);
  await writeFile(reportPath, JSON.stringify(report), "utf8");
  return reportPath;
}

// @vitest-environment node

import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AgentRuntimeBenchmarkReportSchema,
  buildAgentRuntimeBenchmarkReport,
  loadAgentRuntimeBenchmarkSuite,
  REQUIRED_DESIGN_DISCIPLINES,
  type RuntimeBenchmarkCaseResult,
} from "@/lib/agent/runtime-benchmark";
import { countNovelProfessionalConceptGroups } from "@/lib/agent/runtime-benchmark-probes";

const suitePath = path.resolve("data/evals/agent-runtime-benchmark.json");

function passingResults(): {
  suite: ReturnType<typeof loadAgentRuntimeBenchmarkSuite>["suite"];
  suiteHash: string;
  results: RuntimeBenchmarkCaseResult[];
} {
  const { suite, suiteHash } = loadAgentRuntimeBenchmarkSuite(suitePath);
  const result = (id: string, kind: RuntimeBenchmarkCaseResult["kind"]): RuntimeBenchmarkCaseResult => ({
    id, kind, passed: true, failures: [], latencyMs: 10, observed: {},
  });
  return {
    suite,
    suiteHash,
    results: [
      ...suite.designCases.map(({ id }) => result(id, "DESIGN")),
      result(suite.longSession.id, "LONG_SESSION"),
      result(suite.taskIsolation.id, "TASK_ISOLATION"),
      result(suite.restartRecovery.id, "RESTART_RECOVERY"),
      ...suite.requiredHarnessCases.map((id) => result(`harness:${id}`, "FAULT_INJECTION")),
    ],
  };
}

describe("Agent Runtime benchmark contract", () => {
  it("requires every target design discipline, twenty turns and the complete fault Harness", () => {
    const { suite } = loadAgentRuntimeBenchmarkSuite(suitePath);
    expect(new Set(suite.designCases.map(({ discipline }) => discipline))).toEqual(new Set(REQUIRED_DESIGN_DISCIPLINES));
    expect(suite.longSession.turns).toHaveLength(20);
    expect(suite.requiredHarnessCases).toContain("model-provider-offline");
    expect(suite.requiredHarnessCases).toContain("write-effect-requires-confirmation");
  });

  it("does not count concepts merely repeated from the learner prompt", () => {
    const message = "入口很窄，观众容易堵，动线怎么改？";
    expect(countNovelProfessionalConceptGroups(message, message, [
      ["动线", "路径", "流线"],
      ["堵", "拥堵", "缓冲"],
      ["安全", "疏散", "通行"],
    ])).toBe(0);
    expect(countNovelProfessionalConceptGroups(message, "先设置缓冲区，再验证疏散通行宽度。", [
      ["动线", "路径", "流线"],
      ["堵", "拥堵", "缓冲"],
      ["安全", "疏散", "通行"],
    ])).toBe(2);
  });

  it("recognizes a physical shelf mockup as valid packaging prototype guidance", () => {
    const { suite } = loadAgentRuntimeBenchmarkSuite(suitePath);
    const packaging = suite.designCases.find(({ id }) => id === "benchmark-packaging-shelf");
    expect(packaging).toBeDefined();
    const answer = "用纸板做货架背景，以泡沫块搭竞品模型，再折出包装盒并退后2米观察产品名和主色。";
    expect(countNovelProfessionalConceptGroups(
      packaging!.message,
      answer,
      packaging!.expected.conceptGroups,
    )).toBeGreaterThanOrEqual(packaging!.expected.minimumConceptGroups);
  });

  it("recognizes paper box simulation and three-meter shelf observation", () => {
    const { suite } = loadAgentRuntimeBenchmarkSuite(suitePath);
    const packaging = suite.designCases.find(({ id }) => id === "benchmark-packaging-shelf");
    expect(packaging).toBeDefined();
    const answer = "用A4纸剪出包装盒正面并贴在产品盒上，放到货架退后3米拍照，观察颜色和视觉优先级。";
    expect(countNovelProfessionalConceptGroups(
      packaging!.message,
      answer,
      packaging!.expected.conceptGroups,
    )).toBeGreaterThanOrEqual(packaging!.expected.minimumConceptGroups);
  });

  it("recognizes clay grip simulation as valid ergonomic prototype guidance", () => {
    const { suite } = loadAgentRuntimeBenchmarkSuite(suitePath);
    const product = suite.designCases.find(({ id }) => id === "benchmark-product-ergonomics");
    expect(product).toBeDefined();
    const answer = "用黏土模拟握把并让老人握持，观察指印压力分布、滑脱和表面纹理。";
    expect(countNovelProfessionalConceptGroups(
      product!.message,
      answer,
      product!.expected.conceptGroups,
    )).toBeGreaterThanOrEqual(product!.expected.minimumConceptGroups);
  });

  it("recognizes positioning and screenshot audits phrased without rubric keywords", () => {
    const { suite } = loadAgentRuntimeBenchmarkSuite(suitePath);
    for (const [id, answer] of [
      ["benchmark-brand-positioning", "先确定目标受众、品牌核心价值与视觉气质，再列关键词和使用场景。"],
      ["benchmark-ui-task-flow", "用首页截图标记三个入口位置，检查首屏可见性、滚动距离和注意力干扰。"],
    ] as const) {
      const benchmarkCase = suite.designCases.find((item) => item.id === id);
      expect(benchmarkCase).toBeDefined();
      expect(countNovelProfessionalConceptGroups(
        benchmarkCase!.message,
        answer,
        benchmarkCase!.expected.conceptGroups,
      )).toBeGreaterThanOrEqual(benchmarkCase!.expected.minimumConceptGroups);
    }
  });

  it("recognizes a fixed salient entry as valid UI visibility guidance", () => {
    const { suite } = loadAgentRuntimeBenchmarkSuite(suitePath);
    const ui = suite.designCases.find(({ id }) => id === "benchmark-ui-task-flow");
    expect(ui).toBeDefined();
    const answer = "在首页固定位置增加一个显眼、颜色鲜明的报修按钮，点击后直接进入表单，再观察提交量变化。";
    expect(countNovelProfessionalConceptGroups(
      ui!.message,
      answer,
      ui!.expected.conceptGroups,
    )).toBeGreaterThanOrEqual(ui!.expected.minimumConceptGroups);
  });

  it("builds a comparable scorecard only when all required cases are present", () => {
    const { suite, suiteHash, results } = passingResults();
    const report = buildAgentRuntimeBenchmarkReport({
      suite,
      suiteHash,
      runtimeId: "current-runtime",
      commit: "a".repeat(40),
      comparisonMode: "REAL_MODEL_BASELINE",
      model: { provider: "OPENAI_COMPATIBLE", id: "benchmark-model" },
      workingTreeClean: true,
      results,
      evaluatedAt: new Date("2026-07-17T00:00:00.000Z"),
    });
    expect(report).toMatchObject({
      passed: true,
      releaseComparable: true,
      caseCount: results.length,
      passedCaseCount: results.length,
      scorecard: {
        designCoverage: 1,
        longSessionContinuity: 1,
        taskIsolation: 1,
        restartRecovery: 1,
        faultContainment: 1,
        actionSafety: 1,
      },
    });
    expect(() => buildAgentRuntimeBenchmarkReport({
      suite,
      suiteHash,
      runtimeId: "current-runtime",
      commit: "a".repeat(40),
      comparisonMode: "FIXTURE_VALIDATION",
      model: { provider: "TEST", id: "fixture" },
      workingTreeClean: false,
      results: results.slice(1),
    })).toThrow("RUNTIME_BENCHMARK_RESULTS_INCOMPLETE");
    const wrongKinds = results.map((item) => ({ ...item }));
    wrongKinds[0]!.kind = "LONG_SESSION";
    wrongKinds[suite.designCases.length]!.kind = "DESIGN";
    expect(() => buildAgentRuntimeBenchmarkReport({
      suite,
      suiteHash,
      runtimeId: "current-runtime",
      commit: "a".repeat(40),
      comparisonMode: "FIXTURE_VALIDATION",
      model: { provider: "TEST", id: "fixture" },
      workingTreeClean: false,
      results: wrongKinds,
    })).toThrow("RUNTIME_BENCHMARK_RESULT_KIND_MISMATCH");
  });

  it("never marks a dirty development run as a release-comparable baseline", () => {
    const { suite, suiteHash, results } = passingResults();
    const development = buildAgentRuntimeBenchmarkReport({
      suite,
      suiteHash,
      runtimeId: "current-runtime",
      commit: "b".repeat(40),
      comparisonMode: "DEVELOPMENT_CHECK",
      model: { provider: "OPENAI_COMPATIBLE", id: "benchmark-model" },
      workingTreeClean: false,
      results,
    });
    expect(development.releaseComparable).toBe(false);
    expect(() => buildAgentRuntimeBenchmarkReport({
      suite,
      suiteHash,
      runtimeId: "current-runtime",
      commit: "b".repeat(40),
      comparisonMode: "REAL_MODEL_BASELINE",
      model: { provider: "OPENAI_COMPATIBLE", id: "benchmark-model" },
      workingTreeClean: false,
      results,
    })).toThrow("RUNTIME_BENCHMARK_BASELINE_REQUIRES_CLEAN_TREE");
  });

  it("rejects contradictory report summaries and case outcomes", () => {
    const { suite, suiteHash, results } = passingResults();
    const report = buildAgentRuntimeBenchmarkReport({
      suite,
      suiteHash,
      runtimeId: "current-runtime",
      commit: "c".repeat(40),
      comparisonMode: "DEVELOPMENT_CHECK",
      model: { provider: "OPENAI_COMPATIBLE", id: "benchmark-model" },
      workingTreeClean: false,
      results,
    });
    expect(AgentRuntimeBenchmarkReportSchema.safeParse({
      ...report,
      releaseComparable: true,
      passedCaseCount: report.passedCaseCount - 1,
    }).success).toBe(false);
    expect(AgentRuntimeBenchmarkReportSchema.safeParse({
      ...report,
      results: report.results.map((item, index) => index === 0
        ? { ...item, passed: true, failures: ["CONTRADICTORY_FAILURE"] }
        : item),
    }).success).toBe(false);
    expect(AgentRuntimeBenchmarkReportSchema.safeParse({
      ...report,
      comparisonMode: "FIXTURE_VALIDATION",
      model: { provider: "OPENAI_COMPATIBLE", id: "not-a-fixture" },
    }).success).toBe(false);
  });
});

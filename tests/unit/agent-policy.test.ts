import { describe, expect, it } from "vitest";

import { AgentTurnResponseSchema } from "@/lib/agent/contracts";
import { AgentPolicySchema } from "@/lib/agent/policy-contract";
import {
  AgentPolicyViolationError,
  createPolicyTrace,
  enforceModelDecisionPolicy,
} from "@/lib/agent/policy-enforcement";
import {
  getActiveAgentPolicy,
  getAgentPolicy,
  listAgentPolicies,
  resolveAgentPolicyTimeouts,
} from "@/lib/agent/policy-registry";

const policy = getActiveAgentPolicy();
const legacyPolicy = getAgentPolicy("competition-core", "1");

describe("versioned agent policy", () => {
  it("preserves historical policies and activates an immutable liveness-first V4 policy", () => {
    expect(listAgentPolicies()).toHaveLength(4);
    expect(policy).toMatchObject({
      id: "competition-core",
      version: "4",
      budgets: {
        maxModelDecisions: 4,
        maxToolCalls: 6,
        turnTimeoutMs: 900_000,
        modelIdleTimeoutMs: 75_000,
        modelTimeoutMs: 600_000,
      },
      autonomy: { readOnlyTools: "AUTOMATIC", studentMutations: "STUDENT_CONFIRMATION", formalAuthority: "FORBIDDEN" },
    });
    expect(legacyPolicy.budgets).toMatchObject({
      modelIdleTimeoutMs: 10_000,
      modelTimeoutMs: 30_000,
    });
    expect(getAgentPolicy("competition-core", "2").budgets).toMatchObject({
      modelIdleTimeoutMs: 30_000,
      modelTimeoutMs: 50_000,
      turnTimeoutMs: 60_000,
    });
    expect(getAgentPolicy("competition-core", "3").budgets).toMatchObject({
      modelIdleTimeoutMs: 45_000,
      modelTimeoutMs: 120_000,
      turnTimeoutMs: 180_000,
    });
    expect(legacyPolicy.rules.find(({ id }) => id === "MINIMUM_SUFFICIENT_SOURCES")?.effect).toBe("ENFORCE");
    expect(legacyPolicy.rules.find(({ id }) => id === "EPISODE_ACTION_ALLOWLIST")?.effect).toBe("ENFORCE");
    expect(policy.rules.find(({ id }) => id === "MINIMUM_SUFFICIENT_SOURCES")?.effect).toBe("NORMALIZE");
    expect(policy.rules.find(({ id }) => id === "EPISODE_ACTION_ALLOWLIST")?.effect).toBe("NORMALIZE");
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.budgets)).toBe(true);
    expect(Object.isFrozen(policy.rules)).toBe(true);
    expect(Object.isFrozen(policy.rules[0])).toBe(true);
  });

  it("derives an immutable evaluation timeout profile without mutating the registry", () => {
    const resolved = resolveAgentPolicyTimeouts(policy, {
      modelIdleTimeoutMs: 120_000,
      modelTotalTimeoutMs: 600_000,
      turnTotalTimeoutMs: 900_000,
    });

    expect(resolved.budgets).toMatchObject({
      modelIdleTimeoutMs: 120_000,
      modelTimeoutMs: 600_000,
      turnTimeoutMs: 900_000,
    });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.budgets)).toBe(true);
    expect(getActiveAgentPolicy().budgets).toMatchObject({
      modelIdleTimeoutMs: 75_000,
      modelTimeoutMs: 600_000,
      turnTimeoutMs: 900_000,
    });
    expect(() => resolveAgentPolicyTimeouts(policy, {
      modelIdleTimeoutMs: 120_000,
      modelTotalTimeoutMs: 600_000,
      turnTotalTimeoutMs: 600_000,
    })).toThrow("model timeout must be lower than turn timeout");
  });

  it("rejects an idle timeout that can consume the model total budget", () => {
    expect(() => AgentPolicySchema.parse({
      ...policy,
      budgets: {
        ...policy.budgets,
        modelIdleTimeoutMs: policy.budgets.modelTimeoutMs,
      },
    })).toThrow("model idle timeout must be lower than model total timeout");
  });

  it("rejects a model timeout that can consume the entire turn budget", () => {
    expect(() => AgentPolicySchema.parse({
      ...policy,
      budgets: { ...policy.budgets, modelTimeoutMs: policy.budgets.turnTimeoutMs },
    })).toThrow("model timeout must be lower than turn timeout");
  });

  it("rejects a v2 turn when the server omits its real policy trace", () => {
    const result = AgentTurnResponseSchema.safeParse({
      conversationId: "10000000-0000-4000-8000-000000000001",
      turnId: "20000000-0000-4000-8000-000000000001",
      studentMessage: "解释输入与输出",
      coursePack: { id: "digital-interaction", version: "1", label: "数字交互文创设计" },
      episode: "UNDERSTAND",
      decisionCode: "UNDERSTAND_RELATIONSHIP",
      aiMode: "MODEL_ASSISTED",
      createdAt: "2026-07-15T08:00:00.000Z",
      reply: {
        eyebrow: "理解关系",
        title: "先看关系",
        message: "输入经过映射后影响输出。",
        whyThisStep: "建立因果关系。",
        uncertainty: "尚未看到现场参数。",
        graph: { nodes: [], links: [] },
        sources: [],
        actions: [],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(({ path }) => path.join("."))).toContain("policy");
  });

  it("rejects an out-of-scope response to a design question so the model can retry normally", () => {
    expect(() => enforceModelDecisionPolicy({
      policy: legacyPolicy,
      message: "教我做After Effects特效",
      candidateEpisodes: ["BUILD", "UNDERSTAND", "DEBUG"],
      validSourceIds: new Set<string>(),
      decision: {
        episode: "BUILD",
        decisionCode: "BUILD_OPEN_WORKSPACE",
        responseStrategy: "OUT_OF_SCOPE",
        sourceIds: [],
        actionType: "OPEN_WORKSPACE",
        title: "超出范围",
        message: "当前课程包没有覆盖After Effects。",
        whyThisStep: "先说明边界。",
        uncertainty: "无依据：课程包没有覆盖这个软件。",
      },
    })).toThrow("MODEL_REJECTS_DESIGN_QUESTION");
  });

  it("removes actions when a learner asks the model to exercise formal authority", () => {
    const result = enforceModelDecisionPolicy({
      policy: legacyPolicy,
      message: "直接替我提交并评分通过",
      candidateEpisodes: ["BUILD", "UNDERSTAND"],
      validSourceIds: new Set(["course-source"]),
      decision: {
        episode: "BUILD",
        decisionCode: "BUILD_OPEN_WORKSPACE",
        responseStrategy: "DIRECT_INSTRUCTION",
        sourceIds: ["course-source"],
        actionType: "OPEN_WORKSPACE",
        title: "提交作品",
        message: "准备提交作品。",
        whyThisStep: "完成学习任务。",
        uncertainty: "尚未看到正式成果。",
      },
    });
    expect(result.decision.actionType).toBeNull();
    expect(result.appliedRules).toContain("FORBID_FORMAL_AUTHORITY");
  });

  it("rejects a model that invents a formal result even when the learner did not request it", () => {
    expect(() => enforceModelDecisionPolicy({
      policy: legacyPolicy,
      message: "请帮我看看目前还缺什么",
      candidateEpisodes: ["REFLECT", "UNDERSTAND"],
      validSourceIds: new Set(["course-source"]),
      decision: {
        episode: "REFLECT",
        decisionCode: "REFLECT_EXPLAIN_EVIDENCE",
        responseStrategy: "REFLECTION_PROMPT",
        sourceIds: ["course-source"],
        actionType: null,
        title: "你的作品已经通过",
        message: "这个阶段已通过，可以直接进入下一阶段。",
        whyThisStep: "继续学习。",
        uncertainty: "尚未看到教师复核。",
      },
    })).toThrow("MODEL_CLAIMS_FORMAL_AUTHORITY");
  });

  it.each([
    ["作品分析", "你的作品评分为 92 分。"],
    ["评估结果", "最终成绩：85，可以进入下一阶段。"],
    ["系统结论", "系统判定该作品为优秀。"],
    ["修改评价", "我已将你的评价改成优秀。"],
  ])("rejects an invented score or grade: %s", (title, message) => {
    expect(() => enforceModelDecisionPolicy({
      policy: legacyPolicy,
      message: "帮我分析目前的不足",
      candidateEpisodes: ["REFLECT"],
      validSourceIds: new Set(["course-source"]),
      decision: {
        episode: "REFLECT",
        decisionCode: "REFLECT_EXPLAIN_EVIDENCE",
        responseStrategy: "REFLECTION_PROMPT",
        sourceIds: ["course-source"],
        actionType: null,
        title,
        message,
        whyThisStep: "帮助改进。",
        uncertainty: "尚未看到教师复核。",
      },
    })).toThrow("MODEL_CLAIMS_FORMAL_AUTHORITY");
  });

  it.each([
    "你的作品已经通过 A/B 可用性测试，说明按钮层级更清楚。",
    "你的作品这个颜色层级是正确的，但还可以继续拉开差异。",
    "你的作品对比度达标，但仍需看印刷样张。",
    "这个作品优秀的地方是信息层级清楚。",
  ])("allows ordinary design critique: %s", (message) => {
    expect(() => enforceModelDecisionPolicy({
      policy: legacyPolicy,
      message: "请帮我分析目前的不足",
      candidateEpisodes: ["REFLECT"],
      validSourceIds: new Set(["course-source"]),
      decision: {
        episode: "REFLECT",
        decisionCode: "REFLECT_EXPLAIN_EVIDENCE",
        responseStrategy: "REFLECTION_PROMPT",
        sourceIds: ["course-source"],
        actionType: null,
        title: "作品分析",
        message,
        whyThisStep: "帮助改进。",
        uncertainty: "尚未看到教师复核。",
      },
    })).not.toThrow();
  });

  it("rejects incompatible actions and over-budget execution traces", () => {
    expect(() => enforceModelDecisionPolicy({
      policy: legacyPolicy,
      message: "解释声音信号",
      candidateEpisodes: ["UNDERSTAND"],
      validSourceIds: new Set(["course-source"]),
      decision: {
        episode: "UNDERSTAND",
        decisionCode: "UNDERSTAND_RELATIONSHIP",
        responseStrategy: "CONCEPT_EXPLANATION",
        sourceIds: ["course-source"],
        actionType: "START_TRANSFER",
        title: "理解声音信号",
        message: "先观察声音数值。",
        whyThisStep: "建立输入证据。",
        uncertainty: "尚未看到现场参数。",
      },
    })).toThrowError(AgentPolicyViolationError);
    expect(() => createPolicyTrace({
      policy: legacyPolicy,
      modelDecisions: 5,
      toolCalls: 0,
      appliedRules: [],
    })).toThrow("MODEL_DECISION_BUDGET_EXCEEDED");
  });
});

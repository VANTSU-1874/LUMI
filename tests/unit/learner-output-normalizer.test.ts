import { describe, expect, it } from "vitest";

import { normalizeLearnerFacingDecision } from "@/lib/agent/learner-output-normalizer";

function decision(overrides: Partial<Parameters<typeof normalizeLearnerFacingDecision>[0]> = {}) {
  return {
    episode: "UNDERSTAND" as const,
    sourceIds: ["information-hierarchy"],
    title: "理解 information-hierarchy",
    message: "按 information-hierarchy 的 n2. 关系检查。",
    whyThisStep: "information-hierarchy 支撑这个判断。",
    uncertainty: "无依据",
    ...overrides,
  };
}

describe("learner-facing model output normalization", () => {
  it("replaces exact source identifiers and removes draft graph labels", () => {
    const result = normalizeLearnerFacingDecision(decision(), [
      { id: "information-hierarchy", title: "信息层级与页序（课程设计）" },
    ]);

    expect(`${result.title}${result.message}${result.whyThisStep}`).not.toContain("information-hierarchy");
    expect(result.message).not.toContain("n2");
    expect(result.message).toContain("信息层级与页序（课程设计）");
    expect(result.uncertainty).not.toContain("无依据");
  });

  it("gives transfer answers a stable retain-versus-change frame", () => {
    const result = normalizeLearnerFacingDecision(decision({
      episode: "TRANSFER",
      message: "保留数值稳定和映射，把声音输入改成距离输入。",
    }), []);

    expect(result.message).toContain("保留");
    expect(result.message).toMatch(/改变|替换/);
  });

  it("keeps the no-evidence disclosure for a sourced course-boundary answer", () => {
    const result = normalizeLearnerFacingDecision(decision({
      responseStrategy: "OUT_OF_SCOPE",
      uncertainty: "无依据：课程边界来源不包含具体工艺步骤。",
    }), []);

    expect(result.uncertainty).toContain("无依据");
  });

  it("retains a learner's named observation role when the model uses a synonym", () => {
    const result = normalizeLearnerFacingDecision(decision({
      episode: "DEBUG",
      message: "请让一名目标读者完成找信息任务并记录时间。",
    }), [], "测试者还是说看不清，应该收集什么证据？");

    expect(result.message).toContain("测试者");
  });

  it("turns a grounded reading-route debug answer into an explicit observable test", () => {
    const result = normalizeLearnerFacingDecision(decision({
      episode: "DEBUG",
      message: "请让读者完成找活动任务，记录停顿页和下一页指向错误。",
    }), [], "同学不知道下一页该看哪里，怎么排查？", "阅读测试可记录停顿页或指向错误。 ");

    expect(result.message).toContain("阅读测试");
    expect(result.message).toContain("观察");
  });

  it("replaces knowledge fact and action identifiers with their learner-facing text", () => {
    const result = normalizeLearnerFacingDecision(decision({
      message: "fact osc-listening-port；action osc-check-receiver。",
    }), [
      { id: "osc-listening-port", title: "OSC In CHOP需要设置接收消息的监听端口。" },
      { id: "osc-check-receiver", title: "确认接收端Active状态和可见通道。" },
    ]);

    expect(result.message).toContain("监听端口");
    expect(result.message).toContain("确认接收端");
    expect(result.message).not.toMatch(/fact|action|osc-listening-port|osc-check-receiver/i);
  });

  it("localizes internal prompt field names without allowing unsupported technical terms", () => {
    const result = normalizeLearnerFacingDecision(decision({
      title: "根据 sourceId 继续",
      message: "按 requiredAction 执行，不要照抄 followUpConstraint。",
      whyThisStep: "sourceIds 来自 knowledge。",
    }), []);

    expect(`${result.title}${result.message}${result.whyThisStep}`)
      .not.toMatch(/sourceIds?|requiredAction|followUpConstraint|knowledge/i);
    expect(result.message).toContain("当前必要步骤");
    expect(result.whyThisStep).toContain("课程资料");
  });

  it("localizes grounded and generic English labels for learner-facing Chinese", () => {
    const result = normalizeLearnerFacingDecision(decision({
      message: "n2. observe upstream，再 check range、radius、uniform、convert、translate、map 和 fit；保留 grounded Null1 和 Analyze，不要改用 serial、MIDI 或 LED。",
    }), [], "", "先观察上游节点，再检查范围映射、Null节点和Analyze。");

    expect(result.message).toContain("观察上游");
    expect(result.message).toContain("检查范围映射");
    expect(result.message).not.toMatch(/n2|observe|upstream|check|range/i);
    expect(result.message).toContain("串行通信");
    expect(result.message).toContain("半径");
    expect(result.message).toContain("均匀");
    expect(result.message).toContain("转换");
    expect(result.message).toContain("适配");
    expect(result.message).toContain("Null");
    expect(result.message).not.toContain("Null1");
    expect(result.message).toContain("Analyze");
    expect(result.message).toContain("MIDI");
    expect(result.message).toContain("LED");
    expect(result.message).not.toMatch(/serial|radius|uniform|convert|translate|map|fit/i);
  });
});

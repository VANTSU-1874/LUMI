import { describe, expect, it } from "vitest";

import {
  assertAtMostOneLearnerQuestion,
  assertTurnRequirementCoverage,
  limitLearnerQuestions,
  modelTurnRequirements,
} from "@/lib/agent/model-turn-requirements";

describe("model turn requirements", () => {
  it("turns vague and IP requests into concrete one-question guidance", () => {
    const requirements = modelTurnRequirements("我想做一个IP形象，但不知道从哪里开始");
    expect(requirements).toEqual(expect.arrayContaining([
      expect.stringContaining("2到3个"),
      expect.stringContaining("视觉母题"),
      expect.stringContaining("立即执行"),
    ]));
  });

  it("rejects multiple learner questions while allowing one", () => {
    expect(() => assertAtMostOneLearnerQuestion("你更偏品牌还是文创？")).not.toThrow();
    expect(() => assertAtMostOneLearnerQuestion("用于哪里？希望什么性格？")).toThrow(
      "MODEL_TOO_MANY_QUESTIONS",
    );
  });

  it("keeps the first key learner question and turns later unknowns into hypotheses", () => {
    const result = limitLearnerQuestions("先给三种性格假设。用于哪里？希望什么颜色？最后做什么表情？");
    expect(result).toContain("用于哪里？");
    expect(result).toContain("希望什么颜色（先作为暂时假设，后续再确认）");
    expect(result.match(/[？?]/g)).toHaveLength(1);
  });

  it("requires the confirmed IP starting dimensions without requiring a form", () => {
    expect(() => assertTurnRequirementCoverage(
      "我想做一个IP形象，但不知道从哪里开始",
      "面向校园新生，先从活泼、沉稳或古怪三种性格方向中选择，以水滴为视觉母题，第一步画三张轮廓草图。",
    )).not.toThrow();
    expect(() => assertTurnRequirementCoverage(
      "我想做一个IP形象，但不知道从哪里开始",
      "面向校园新生，第一步画三张草图。",
    )).toThrow("MODEL_TURN_REQUIREMENT_MISSING");
  });

  it("requires an explicit evidence chain when the learner asks how to prove a choice", () => {
    expect(() => assertTurnRequirementCoverage(
      "我怎么用证据解释这个连接？",
      "记录输入、映射和输出的前后对比，把它们组成证据链。",
    )).not.toThrow();
    expect(() => assertTurnRequirementCoverage(
      "我怎么用证据解释这个连接？",
      "说明输入、映射和输出的关系。",
    )).toThrow("MODEL_TURN_REQUIREMENT_MISSING:证据链");
  });

  it("requires choices for vague input and an executable first step for starting questions", () => {
    expect(() => assertTurnRequirementCoverage(
      "我想做酷一点的海报，但不知道从哪里开始",
      "可以从三种方向选择：强排版、拼贴或极简。第一步先画三张草图。",
    )).not.toThrow();
    expect(() => assertTurnRequirementCoverage(
      "我想做酷一点的海报，但不知道从哪里开始",
      "可以从三种方向选择：强排版、拼贴或极简。你喜欢哪一种？",
    )).toThrow("MODEL_TURN_REQUIREMENT_MISSING:可执行第一步");
  });

  it("requires value-range mapping before parameter binding for audio-driven motion debugging", () => {
    const question = "声音已经有数值，但画面完全不动。";
    expect(modelTurnRequirements(question)).toEqual(expect.arrayContaining([
      expect.stringContaining("数值范围"),
    ]));
    expect(() => assertTurnRequirementCoverage(
      question,
      "先看Math后的数值范围是否映射到可见区间，再检查Null通道与视觉参数的引用路径。",
    )).not.toThrow();
    expect(() => assertTurnRequirementCoverage(
      question,
      "先看Null通道是否变化，再检查视觉参数的引用路径。",
    )).toThrow("MODEL_TURN_REQUIREMENT_MISSING:数值范围或映射");
  });

  it("does not treat every animation character question as IP character creation", () => {
    expect(modelTurnRequirements("角色从高处落地的动画很轻飘，关键动作和时间怎样调整？"))
      .not.toEqual(expect.arrayContaining([expect.stringContaining("视觉母题")]));
    expect(() => assertTurnRequirementCoverage(
      "角色从高处落地的动画很轻飘，关键动作和时间怎样调整？",
      "第一步先画接触地面的关键帧，再比较下落、挤压和回弹的时间。",
    )).not.toThrow();
  });
});

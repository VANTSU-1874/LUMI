import { describe, expect, it } from "vitest";

import { digitalInteractionCoursePack } from "@/lib/course-packs/digital-interaction";
import { buildTutorTeachingGuidance } from "@/lib/agent/v3/tutor-teaching-guidance";

describe("V3 tutor teaching guidance", () => {
  it("turns an L1 profile into novice-friendly but substantive soft guidance", () => {
    const guidance = buildTutorTeachingGuidance({
      level: "L1",
      dimensions: {
        decomposition: 2,
        "signal-understanding": 1,
        "mapping-design": 2,
        troubleshooting: 1,
        transfer: 2,
      },
    }, digitalInteractionCoursePack);

    expect(guidance).toMatchObject({
      mode: "SOFT_ADAPTATION_NOT_GATE",
      diagnosedLevel: "L1",
      depth: "FOUNDATIONAL",
      capabilitySignals: {
        relativeStrength: { label: "交互分解", score: 2 },
        growthFocus: { label: "信号理解", score: 1 },
      },
    });
    expect(guidance.responseGuidance.join(" ")).toContain("生活化语言");
    expect(guidance.responseGuidance.join(" ")).toContain("专业名词");
    expect(guidance.boundary).toContain("不决定学生能问什么");
  });

  it("gives L4 learners deeper transfer prompts without withholding the first step", () => {
    const guidance = buildTutorTeachingGuidance({
      level: "L4",
      dimensions: {
        decomposition: 4,
        "signal-understanding": 4,
        "mapping-design": 3,
        troubleshooting: 4,
        transfer: 4,
      },
    }, digitalInteractionCoursePack);

    expect(guidance.depth).toBe("ADVANCED_TRANSFER");
    expect(guidance.responseGuidance.join(" ")).toContain("权衡");
    expect(guidance.responseGuidance.join(" ")).toContain("可立即执行的第一步");
    expect(guidance.coursePedagogy.conceptModel.label).toBe("六元交互逻辑");
    expect(guidance.coursePedagogy.transfer.retain).toContain("核心因果链");
    expect(guidance.coursePedagogy.usageBoundary).toContain("不是回答、工具调用或开放对话的前置门禁");
  });

  it("does not invent relative strengths or growth focuses when all dimensions tie", () => {
    const guidance = buildTutorTeachingGuidance({
      level: "L1",
      dimensions: {
        decomposition: 1,
        "signal-understanding": 1,
        "mapping-design": 1,
        troubleshooting: 1,
        transfer: 1,
      },
    }, digitalInteractionCoursePack);

    expect(guidance.capabilitySignals).toEqual({
      relativeStrength: null,
      growthFocus: null,
    });
  });

  it("does not invent a level when no valid diagnosis exists", () => {
    const guidance = buildTutorTeachingGuidance({ level: "UNKNOWN", dimensions: {} }, digitalInteractionCoursePack);

    expect(guidance).toMatchObject({
      diagnosedLevel: null,
      depth: "ADAPT_IN_CONVERSATION",
      capabilitySignals: { relativeStrength: null, growthFocus: null },
    });
    expect(guidance.responseGuidance.join(" ")).toContain("不要猜测");
  });
});

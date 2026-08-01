import { describe, expect, it } from "vitest";

import { validateLogicCard } from "@/lib/domain/logic-card";

const completeCard = {
  culturalIntent: "表达地方文化",
  participantAction: "观众触摸屏幕",
  inputSignal: "触摸位置坐标",
  mappingRule: "按区域映射内容",
  outputMedium: "投影画面变化",
  experienceFeedback: "观众看到回应",
};

describe("validateLogicCard", () => {
  it("marks a complete logic card as ready", () => {
    expect(validateLogicCard(completeCard)).toEqual({ ready: true, issues: [] });
  });

  it("reports an empty mapping rule", () => {
    const result = validateLogicCard({ ...completeCard, mappingRule: "" });

    expect(result.ready).toBe(false);
    expect(result.issues).toContain("判断与映射不能为空");
  });

  it("accepts a short everyday answer and leaves semantic detail to the coach", () => {
    const result = validateLogicCard({ ...completeCard, culturalIntent: " 文化 " });

    expect(result).toEqual({ ready: true, issues: [] });
  });
});

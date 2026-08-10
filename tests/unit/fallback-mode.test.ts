import { describe, expect, it } from "vitest";

import { aiModeFromConfiguration } from "@/lib/domain/data-provenance";
import { pendingReviewer, reviewSemanticLogic } from "@/lib/services/semantic-logic-review";

const completeCard = {
  culturalIntent: "通过靠近参与让观众理解安岳石刻守护",
  participantAction: "参与者靠近并停留观察",
  inputSignal: "距离传感器数值",
  mappingRule: "10到80厘米反向归一化到0到1",
  outputMedium: "安岳石刻纹样投影",
  experienceFeedback: "靠近时纹样细节渐显",
};

describe("AI-disabled fallback", () => {
  it("publishes only the public mode, never provider configuration", () => {
    expect(aiModeFromConfiguration(false)).toBe("DETERMINISTIC_FALLBACK");
    expect(aiModeFromConfiguration(true)).toBe("MODEL_ASSISTED");
  });

  it("keeps a complete card pending instead of auto-approving without semantic AI", async () => {
    const review = await reviewSemanticLogic(pendingReviewer, completeCard);
    expect(review).toEqual({
      status: "PENDING",
      ready: false,
      issues: ["等待智能语义审查或教师确认"],
      source: "pending-reviewer",
    });
    expect(review.status).not.toBe("APPROVED");
  });
});

import { describe, expect, it } from "vitest";

import { deriveProjectBriefPatch, enrichProjectBriefPatch } from "@/lib/agent/project-brief-extractor";
import { limitLearnerQuestionsAcross } from "@/lib/agent/model-turn-requirements";
import { ProjectBriefSchema } from "@/lib/agent/project-brief-memory";

describe("background project brief extraction", () => {
  it("turns explicit learner statements into confirmed project understanding", () => {
    expect(deriveProjectBriefPatch("为未来感音乐节做一张高对比动态海报。")).toMatchObject({
      designGoal: { value: "为未来感音乐节做一张高对比动态海报", status: "CONFIRMED" },
    });
    expect(deriveProjectBriefPatch("主要给第一次接触非遗的新生看。")).toMatchObject({
      audienceAndContext: { status: "CONFIRMED" },
    });
    expect(deriveProjectBriefPatch("第一轮先做海报、导视和手机端封面。")).toMatchObject({
      mediumConstraints: { status: "CONFIRMED" },
      processPlan: { status: "CONFIRMED" },
      nextStep: { status: "CONFIRMED" },
    });
  });

  it("keeps requested suggestions inferred and does not overwrite memory with recall questions", () => {
    expect(deriveProjectBriefPatch("什么指标能判断新生真的看懂了？")).toMatchObject({
      successCriteria: { status: "INFERRED" },
    });
    expect(deriveProjectBriefPatch("前面确认的受众和设计目标是什么？")).toEqual({});
    expect(enrichProjectBriefPatch("颜色可以鲜明一些，但要控制数量。", {
      nextStep: { value: "先画草图", status: "INFERRED" },
    })).toMatchObject({
      visualExperienceDirection: { status: "CONFIRMED" },
      nextStep: { value: "先画草图" },
    });
    const currentBrief = ProjectBriefSchema.parse({
      revision: 1,
      fields: {
        designGoal: {
          value: "校园非遗节视觉识别",
          status: "CONFIRMED",
          sourceTurnId: "11111111-1111-4111-8111-111111111111",
          updatedAt: "2026-07-17T00:00:00.000Z",
        },
      },
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    expect(enrichProjectBriefPatch("前面确认的目标是什么？", {
      designGoal: { value: "模型误写的新目标", status: "CONFIRMED" },
      nextStep: { value: "继续核对", status: "INFERRED" },
    }, currentBrief)).toEqual({
      nextStep: { value: "继续核对", status: "INFERRED" },
    });
  });

  it("keeps third-party feedback inferred so it cannot replace a confirmed direction", () => {
    const currentBrief = ProjectBriefSchema.parse({
      revision: 2,
      fields: {
        visualExperienceDirection: {
          value: "克制的黑白层级与清晰标题",
          status: "CONFIRMED",
          sourceTurnId: "11111111-1111-4111-8111-111111111111",
          updatedAt: "2026-07-17T00:00:00.000Z",
        },
      },
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    expect(enrichProjectBriefPatch("同学说第二张更活泼，但标题不够突出。", {
      visualExperienceDirection: { value: "改用活泼风格", status: "CONFIRMED" },
    }, currentBrief)).toEqual({
      visualExperienceDirection: {
        value: "同学说第二张更活泼",
        status: "INFERRED",
      },
    });
    for (const feedback of [
      "甲方说颜色太冷了,应该更活泼。",
      "客户觉得风格太冷。",
      "测试者反馈标题层级不明显。",
      "甲方要求改为活泼风格。",
      "客户说改成高饱和色彩。",
      "老师建议方向调整为更克制。",
      "甲方让我改成活泼风格。",
      "导师叫我把色彩改为高饱和。",
      "他们要我把方向调整为更克制。",
    ]) {
      expect(enrichProjectBriefPatch(feedback, {
        visualExperienceDirection: { value: "模型尝试覆盖", status: "CONFIRMED" },
      }, currentBrief).visualExperienceDirection?.status).toBe("INFERRED");
      expect(deriveProjectBriefPatch(feedback).visualExperienceDirection?.status).toBe("INFERRED");
    }
    expect(enrichProjectBriefPatch("我决定下一步先做草图,客户觉得风格太冷。", {
      visualExperienceDirection: { value: "模型尝试覆盖", status: "CONFIRMED" },
    }, currentBrief)).toMatchObject({
      visualExperienceDirection: { status: "INFERRED" },
      nextStep: { status: "CONFIRMED" },
    });
    expect(enrichProjectBriefPatch("我决定把方向改为活泼风格。", {
      visualExperienceDirection: { value: "活泼风格", status: "CONFIRMED" },
    }, currentBrief)).toMatchObject({
      visualExperienceDirection: { status: "CONFIRMED" },
    });
    expect(enrichProjectBriefPatch("我把方向改为更克制。", {
      visualExperienceDirection: { value: "更克制", status: "CONFIRMED" },
    }, currentBrief)).toMatchObject({
      visualExperienceDirection: { status: "CONFIRMED" },
    });
    expect(deriveProjectBriefPatch("我决定视觉方向改为黑白,客户觉得颜色太冷。")).toMatchObject({
      visualExperienceDirection: {
        value: "我决定视觉方向改为黑白",
        status: "CONFIRMED",
      },
    });
  });

  it("enforces one learner-facing question across all response fields", () => {
    const values = limitLearnerQuestionsAcross(["你更想给谁看？", "为什么这样选？", "还缺什么？"]);
    expect(values.join("\n").match(/[？?]/g)).toHaveLength(1);
  });
});

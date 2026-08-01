import { CoursePackSchema } from "./contract";

export const generalDesignFoundation = CoursePackSchema.parse({
  id: "general-design",
  version: "1",
  label: "通用设计",
  summary: "从模糊创作意图出发，逐步明确目标、受众、内容、视觉体验、媒介条件、制作流程与有效性指标。",
  capabilityDimensions: [
    { id: "goal-framing", label: "目标梳理", description: "把模糊感觉整理为可讨论的设计目标。" },
    { id: "audience-context", label: "受众情境", description: "识别谁在什么情境下接触作品。" },
    { id: "content-structure", label: "内容组织", description: "确定必须传达的信息、故事或功能。" },
    { id: "visual-direction", label: "视觉方向", description: "把情绪和风格偏好转成可比较的视觉假设。" },
    { id: "execution-planning", label: "执行推进", description: "选择当前最小且可验证的制作步骤。" },
  ],
  diagnostic: { questionSetVersion: "design-v1", questionCount: 1 },
  conceptModel: {
    label: "项目简报记忆",
    fields: [
      { id: "designGoal", label: "设计目标", prompt: "这次设计要解决什么问题或产生什么效果？" },
      { id: "audienceAndContext", label: "受众与情境", prompt: "谁会在什么情境下接触它？" },
      { id: "coreContent", label: "核心内容", prompt: "最需要被看见、理解或使用的内容是什么？" },
      { id: "visualExperienceDirection", label: "视觉与体验方向", prompt: "希望形成怎样的视觉态度、情绪或体验？" },
      { id: "mediumConstraints", label: "媒介与条件", prompt: "有哪些媒介、尺寸、软件、时间或材料限制？" },
      { id: "processPlan", label: "制作流程", prompt: "从研究、草图到测试应如何推进？" },
      { id: "successCriteria", label: "有效性指标", prompt: "怎样判断作品真的有效？" },
      { id: "nextStep", label: "当前下一步", prompt: "现在最值得先做的一个动作是什么？" },
    ],
  },
  evidencePolicies: [
    { id: "design-process", label: "创作过程记录", acceptedKinds: ["TEXT", "IMAGE", "VIDEO_LINK"] },
  ],
  transferPolicy: {
    retain: ["设计目标", "核心内容"],
    change: ["受众", "视觉方向", "媒介"],
    successStatement: "能说明什么保持不变、什么因新情境而调整。",
  },
  knowledgeNamespaces: ["design-foundations"],
  toolAdapterIds: ["knowledge-map", "design-calculator"],
  supportedEpisodes: ["EXPLORE", "UNDERSTAND", "BUILD", "DEBUG", "TRANSFER", "REFLECT"],
});

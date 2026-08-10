import { CoursePackSchema } from "./contract";

export const brandViDesignCoursePack = CoursePackSchema.parse({
  id: "brand-vi-design",
  version: "1",
  label: "品牌与 VI 设计",
  summary: "从品牌识别任务与真实接触点出发，把调性词翻译为可比较的视觉变量，选择字标或图形关系，并用应用测试建立一致的识别规范。",
  capabilityDimensions: [
    { id: "identity-task", label: "识别任务", description: "说明品牌需要谁在什么情境下识别、记住或区分什么。" },
    { id: "recognition-context", label: "识别场景", description: "核对尺寸、距离、媒介、材质与横竖版等真实接触条件。" },
    { id: "tone-translation", label: "调性转译", description: "把调性词拆成笔画、比例、结构、间距与色彩等可观察变量。" },
    { id: "mark-selection", label: "标识选择", description: "比较字标、图形标与组合标在识别、可读和区分上的证据。" },
    { id: "system-consistency", label: "系统一致性", description: "让核心识别关系在不同触点中稳定，同时保留必要的适配空间。" },
    { id: "transfer", label: "场景迁移", description: "保留品牌识别任务，把标识关系迁移到新的尺寸、媒介或受众情境。" },
  ],
  diagnostic: { questionSetVersion: "brand-vi-v1", questionCount: 3 },
  conceptModel: {
    label: "品牌识别五问",
    fields: [
      { id: "brandTask", label: "品牌任务", prompt: "品牌需要帮助谁识别、记住或区分什么？" },
      { id: "recognitionContext", label: "识别场景", prompt: "受众会在什么距离、尺寸、媒介和使用时长中接触它？" },
      { id: "tone", label: "品牌调性", prompt: "调性词分别对应哪些可观察、可比较的视觉变量？" },
      { id: "markChoice", label: "字体 / 图形选择", prompt: "字标、图形标或组合标各自解决了什么识别问题？" },
      { id: "applicationRules", label: "应用规范", prompt: "哪些识别关系必须保持，哪些可随触点调整？" },
    ],
  },
  evidencePolicies: [
    { id: "recognition-comparison", label: "标识方案对照", acceptedKinds: ["IMAGE", "PROBE"] },
    { id: "audience-observation", label: "受众识别记录", acceptedKinds: ["TEXT", "VALUE", "PROBE"] },
    { id: "application-consistency", label: "跨触点应用检查", acceptedKinds: ["TEXT", "IMAGE", "PROBE"] },
  ],
  transferPolicy: {
    retain: ["品牌任务", "核心识别关系", "目标受众"],
    change: ["尺寸", "媒介", "材质", "横竖版关系"],
    successStatement: "能说明换触点后哪些识别关系必须保留、哪些形式变量可以调整，并给出对照证据。",
  },
  knowledgeNamespaces: ["brand-identity", "wordmark-evaluation", "visual-identity-systems"],
  toolAdapterIds: ["knowledge-map", "project-evidence", "design-calculator", "tutor-clarify", "handwritten-title", "generative-lab"],
  supportedEpisodes: ["EXPLORE", "UNDERSTAND", "BUILD", "DEBUG", "TRANSFER", "REFLECT"],
});

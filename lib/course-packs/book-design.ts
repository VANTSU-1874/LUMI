import { CoursePackSchema } from "./contract";

export const BOOK_DESIGN_MICRO_BRIEF = "将校园社区活动介绍改编为面向新生的8页导览册";

export const bookDesignCoursePack = CoursePackSchema.parse({
  id: "book-design",
  version: "1",
  label: "书籍设计",
  summary: "从受众与阅读任务出发，组织信息层级、网格和阅读节奏，并将结构迁移到新受众。",
  capabilityDimensions: [
    { id: "content-decomposition", label: "内容分解", description: "将素材拆成主题、导读、正文和补充信息。" },
    { id: "hierarchy-modeling", label: "层级建模", description: "根据受众任务建立信息先后与主次。" },
    { id: "layout-design", label: "编排设计", description: "用网格、字号、留白和跨页关系形成阅读节奏。" },
    { id: "evidence-revision", label: "证据修订", description: "根据阅读测试和版面对照修正方案。" },
    { id: "transfer", label: "结构迁移", description: "保留信息结构并针对新受众重组阅读路径。" },
  ],
  diagnostic: { questionSetVersion: "book-v1", questionCount: 3 },
  conceptModel: {
    label: "六步编排关系",
    fields: [
      { id: "audience", label: "受众", prompt: "谁会在什么情境下阅读？" },
      { id: "readingGoal", label: "阅读目标", prompt: "读者最先需要完成什么任务？" },
      { id: "informationHierarchy", label: "信息层级", prompt: "哪些信息是必读、选读和延伸？" },
      { id: "pageStructure", label: "页面结构", prompt: "8页之间如何分配封面、导读、正文和行动信息？" },
      { id: "visualSystem", label: "视觉系统", prompt: "字号、网格、色彩如何区分层级？" },
      { id: "readingFeedback", label: "阅读验证", prompt: "如何判断读者能快速找到活动和参与方式？" },
    ],
  },
  evidencePolicies: [
    { id: "hierarchy-evidence", label: "信息层级排序", acceptedKinds: ["TEXT", "IMAGE", "PROBE"] },
    { id: "spread-evidence", label: "8页缩略版面", acceptedKinds: ["IMAGE", "PROBE"] },
    { id: "reader-test", label: "阅读路径验证", acceptedKinds: ["TEXT", "IMAGE", "PROBE"] },
  ],
  transferPolicy: {
    retain: ["核心内容", "信息层级", "阅读任务"],
    change: ["受众", "顺序", "网格", "字号"],
    successStatement: "能说清新受众与原受众的阅读任务差异，并据此调整编排。",
  },
  knowledgeNamespaces: ["book-design-principles", "information-hierarchy", "layout-evidence"],
  toolAdapterIds: ["book-layout-lab", "knowledge-map", "project-evidence", "design-calculator"],
  supportedEpisodes: ["EXPLORE", "UNDERSTAND", "BUILD", "DEBUG", "TRANSFER", "REFLECT"],
});

import { CoursePackSchema } from "./contract";

export const LAYOUT_DESIGN_MICRO_BRIEF = "为一场校园展览做一张 A4 竖版信息海报，并说明读者先看到什么";

export const layoutDesignCoursePack = CoursePackSchema.parse({
  id: "layout-design",
  version: "1",
  label: "版式设计",
  summary: "从读者任务出发，用栅格安排信息位置，用字号、字重与留白建立层级，并以可验证的方式检查阅读动线。",
  capabilityDimensions: [
    { id: "reading-task", label: "阅读任务", description: "判断读者在什么场景下、需要先拿到哪条信息。" },
    { id: "grid-structure", label: "栅格结构", description: "用栏、行与间距为内容建立稳定的对齐关系。" },
    { id: "hierarchy-modeling", label: "层级建模", description: "用字号、字重与位置区分主要、次要与支撑信息。" },
    { id: "whitespace-rhythm", label: "留白节奏", description: "用版心、边距与块间距控制疏密与呼吸。" },
    { id: "transfer", label: "结构迁移", description: "保留信息层级，迁移到新的尺寸、媒介或受众。" },
  ],
  diagnostic: { questionSetVersion: "layout-v1", questionCount: 3 },
  conceptModel: {
    label: "版面五问",
    fields: [
      { id: "audience", label: "受众场景", prompt: "谁在什么距离、什么时间看到这个版面？" },
      { id: "firstMessage", label: "首要信息", prompt: "读者三秒内必须拿到哪一条信息？" },
      { id: "informationHierarchy", label: "信息层级", prompt: "哪些是主要信息、次要信息和支撑信息？" },
      { id: "gridStructure", label: "栅格结构", prompt: "用几栏几行？哪些内容共享同一条对齐线？" },
      { id: "outputSpec", label: "输出条件", prompt: "成品尺寸、出血与最终呈现媒介是什么？" },
    ],
  },
  evidencePolicies: [
    { id: "grid-evidence", label: "栅格与层级设置", acceptedKinds: ["PROBE", "IMAGE"] },
    { id: "reading-path-evidence", label: "阅读动线验证", acceptedKinds: ["TEXT", "IMAGE", "PROBE"] },
    { id: "output-spec-evidence", label: "输出规格说明", acceptedKinds: ["TEXT", "VALUE"] },
  ],
  transferPolicy: {
    retain: ["首要信息", "信息层级", "阅读任务"],
    change: ["成品尺寸", "栏数", "字号", "媒介"],
    successStatement: "能说清换尺寸或换媒介后哪些层级关系必须保留、哪些可以调整。",
  },
  knowledgeNamespaces: ["layout-design-principles", "information-hierarchy", "typography-basics"],
  toolAdapterIds: ["layout-grid-lab", "knowledge-map", "project-evidence", "design-calculator", "tutor-clarify", "handwritten-title", "generative-lab"],
  supportedEpisodes: ["EXPLORE", "UNDERSTAND", "BUILD", "DEBUG", "TRANSFER", "REFLECT"],
});

import { CoursePackSchema } from "./contract";

export const digitalInteractionCoursePack = CoursePackSchema.parse({
  id: "digital-interaction",
  version: "1",
  label: "数字交互文创设计",
  summary: "从交互意图出发，理解输入、映射、传输、绑定与输出的关系，并将结构迁移到新情境。",
  capabilityDimensions: [
    { id: "decomposition", label: "交互分解", description: "将创意拆解为可验证的输入、处理和输出。" },
    { id: "signal-understanding", label: "信号理解", description: "识别连续值、状态、事件与噪声。" },
    { id: "mapping-design", label: "映射设计", description: "建立数据范围、方向、阈值和曲线关系。" },
    { id: "troubleshooting", label: "证据排障", description: "沿信号链用可观察证据定位问题。" },
    { id: "transfer", label: "结构迁移", description: "保留核心因果关系并替换输入、映射或输出。" },
  ],
  diagnostic: { questionSetVersion: "v1", questionCount: 10 },
  conceptModel: {
    label: "六元交互逻辑",
    fields: [
      { id: "culturalIntent", label: "文化意图", prompt: "作品想让参与者理解或感受什么？" },
      { id: "participantAction", label: "参与行为", prompt: "参与者要做什么？" },
      { id: "inputSignal", label: "输入信号", prompt: "行为被转换为什么可观察数据？" },
      { id: "mappingRule", label: "判断与映射", prompt: "数据如何决定变化？" },
      { id: "outputMedium", label: "输出媒介", prompt: "哪个可见或可听参数发生变化？" },
      { id: "experienceFeedback", label: "体验反馈", prompt: "参与者如何知道自己的行为已生效？" },
    ],
  },
  evidencePolicies: [
    { id: "input-observation", label: "输入观察证据", acceptedKinds: ["VALUE", "IMAGE", "PROBE"] },
    { id: "mapping-observation", label: "映射前后对照", acceptedKinds: ["VALUE", "IMAGE", "PROBE"] },
    { id: "output-observation", label: "最终输出证据", acceptedKinds: ["IMAGE", "VIDEO_LINK", "PROBE"] },
  ],
  transferPolicy: {
    retain: ["文化意图", "核心因果链", "体验反馈"],
    change: ["输入", "映射", "输出"],
    successStatement: "能说清保留与替换的结构，并用证据验证新方案。",
  },
  knowledgeNamespaces: ["interaction-principles", "digishow-signals", "touchdesigner-foundations", "osc-troubleshooting"],
  toolAdapterIds: ["node-canvas", "touchdesigner-cases", "knowledge-map", "project-evidence", "design-calculator", "tutor-clarify", "generative-lab"],
  supportedEpisodes: ["EXPLORE", "UNDERSTAND", "BUILD", "DEBUG", "TRANSFER", "REFLECT"],
});

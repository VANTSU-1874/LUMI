import { z } from "zod";

export const CapabilityOwnerSchema = z.object({
  type: z.enum(["PLUGIN", "SKILL"]),
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  label: z.string().trim().min(1).max(80),
}).strict();

export const CapabilityManifestSchema = CapabilityOwnerSchema.extend({
  description: z.string().trim().min(1).max(300),
  studentSurfaces: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/)).max(8),
  toolIds: z.array(z.string().regex(/^[a-z][a-z0-9.-]{2,79}$/)).max(20),
}).strict();

const manifests = [
  {
    type: "PLUGIN",
    id: "touchdesigner",
    label: "TouchDesigner 插件",
    description: "读取课程案例、节点网络与后续本机实时状态，为数字交互任务提供专业增强。",
    studentSurfaces: ["NODE_CANVAS", "CASE_LIBRARY"],
    toolIds: ["touchdesigner-cases.search-network"],
  },
  {
    type: "SKILL",
    id: "course-reference",
    label: "课程参考 Skill",
    description: "从当前相关课程资料中检索可追溯概念、事实与制作步骤。",
    studentSurfaces: ["KNOWLEDGE_MAP"],
    toolIds: [
      "knowledge-map.search-concepts",
      "knowledge-map.search-evidence",
    ],
  },
  {
    type: "SKILL",
    id: "process-record",
    label: "过程记录 Skill",
    description: "读取当前学生项目、已验证过程记录与排障状态，不自动提交或评价。",
    studentSurfaces: ["PROJECT"],
    toolIds: ["project-evidence.read-state", "project-evidence.read-troubleshooting"],
  },
  {
    type: "SKILL",
    id: "book-design",
    label: "书籍设计 Skill",
    description: "读取书籍编排、受众迁移与版面验证状态，为书籍设计任务提供增强。",
    studentSurfaces: ["BOOK_LAYOUT_LAB"],
    toolIds: ["book-layout-lab.read-state"],
  },
  {
    type: "SKILL",
    id: "public-research",
    label: "公开资料检索 Skill",
    description: "在学生本轮明确授权后检索公开网页，并返回可核对、可点击的结构化出处。",
    studentSurfaces: ["AGENT"],
    toolIds: ["external-web.search"],
  },
  {
    type: "SKILL",
    id: "design-calculation",
    label: "设计参数计算 Skill",
    description: "以确定性公式计算色彩、版面、纸张与视频参数，不写入项目，也不依赖模型心算。",
    studentSurfaces: ["AGENT"],
    toolIds: ["design-calculator.compute"],
  },
  {
    type: "SKILL",
    id: "skill-installer",
    label: "Skill 安装",
    description: "检查 Skill 来源与安全边界，形成风险透明、可确认的安装方案。",
    studentSurfaces: ["AGENT"],
    toolIds: [],
  },
  {
    type: "SKILL",
    id: "skill-creator",
    label: "Skill 创建",
    description: "把可重复的教学或创作流程整理为简洁、可移植、可验证的 Skill。",
    studentSurfaces: ["AGENT"],
    toolIds: [],
  },
  {
    type: "SKILL",
    id: "layout-design",
    label: "版式设计 Skill",
    description: "读取栅格设置、文字块角色与网格验证结果，为版式任务提供可观察证据。",
    studentSurfaces: ["LAYOUT_GRID_LAB"],
    toolIds: ["layout-grid-lab.read-state"],
  },
  {
    type: "SKILL",
    id: "tutor-clarify",
    label: "导师追问 Skill",
    description: "按当前课程的概念顺序取出学生尚未交代、应先追问的问题，使先追问成为结构默认而非提示词祈使。",
    studentSurfaces: ["AGENT"],
    toolIds: ["tutor.ask-clarifying"],
  },
  {
    type: "SKILL",
    id: "handwritten-title",
    label: "手写标题字 Skill",
    description: "按给定标题产出多种手写标题字风格的图像生成提示词，供学生自行出图与对比。",
    studentSurfaces: ["AGENT"],
    toolIds: ["handwritten-title.build-prompts"],
  },
  {
    type: "SKILL",
    id: "generative-tool",
    label: "现场生成器 Skill",
    description: "在学生确认后记录生成器要求，并在隔离实验台中构建、校验与运行零外链单文件 HTML。",
    studentSurfaces: ["GENERATIVE_LAB"],
    toolIds: ["generative-tool.start-build"],
  },
] as const;

const parsed = manifests.map((manifest) => Object.freeze(CapabilityManifestSchema.parse(manifest)));
const byId = new Map(parsed.map((manifest) => [manifest.id, manifest]));
const byToolId = new Map(parsed.flatMap((manifest) => manifest.toolIds.map((toolId) => [toolId, manifest] as const)));

export function getCapability(id: string) {
  const capability = byId.get(id);
  if (!capability) throw new Error(`unknown capability: ${id}`);
  return CapabilityOwnerSchema.parse({ type: capability.type, id: capability.id, label: capability.label });
}

export function capabilityForTool(toolId: string) {
  const capability = byToolId.get(toolId);
  if (!capability) throw new Error(`tool has no Plugin or Skill owner: ${toolId}`);
  return capability;
}

export function capabilityActionLabel(toolId: string, actionLabel: string) {
  const owner = capabilityForTool(toolId);
  return `${owner.label} · ${actionLabel}`;
}

export function listCapabilities() {
  return Object.freeze([...parsed]);
}

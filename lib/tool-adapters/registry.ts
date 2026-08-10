import { ToolAdapterDescriptorSchema, type ToolAdapterDescriptor } from "./contract";

const adapters = [
  { id: "node-canvas", label: "节点画布", target: "NODE_CANVAS", capabilities: ["inspect-network", "adjust-parameters"] },
  { id: "touchdesigner-cases", label: "TouchDesigner 案例资源", target: "CASE_LIBRARY", capabilities: ["inspect-case", "compare-versions"] },
  { id: "knowledge-map", label: "知识地图", target: "KNOWLEDGE_MAP", capabilities: ["locate-concept", "trace-relationship"] },
  { id: "project-evidence", label: "学习证据", target: "PROJECT", capabilities: ["submit-evidence", "review-progress"] },
  { id: "book-layout-lab", label: "书籍编排微实验", target: "BOOK_LAYOUT_LAB", capabilities: ["order-content", "compose-pages", "transfer-audience", "troubleshoot-reading-path", "save-draft", "reset-draft", "submit-evidence"] },
  { id: "external-web", label: "公开资料检索", target: "KNOWLEDGE_MAP", capabilities: ["search-public-sources"] },
  { id: "design-calculator", label: "设计参数计算", target: "KNOWLEDGE_MAP", capabilities: ["calculate-design-parameters"] },
  { id: "layout-grid-lab", label: "排版栅格微实验", target: "LAYOUT_GRID_LAB", capabilities: ["configure-grid", "place-blocks", "verify-grid", "save-draft", "reset-draft", "submit-evidence"] },
  { id: "generative-lab", label: "视觉生成器实验", target: "GENERATIVE_LAB", capabilities: ["request-generator", "inspect-artifact", "adjust-parameters"] },
  { id: "tutor-clarify", label: "导师追问", target: "KNOWLEDGE_MAP", capabilities: ["select-clarifying-questions"] },
  { id: "handwritten-title", label: "手写标题字提示词", target: "KNOWLEDGE_MAP", capabilities: ["build-title-prompts"] },
] as const;

const parsed = adapters.map((adapter) => ToolAdapterDescriptorSchema.parse(adapter));
const registry = new Map(parsed.map((adapter) => [adapter.id, Object.freeze(adapter)]));

export function listToolAdapters(): readonly ToolAdapterDescriptor[] {
  return Object.freeze([...registry.values()]);
}

export function getToolAdapter(id: string): ToolAdapterDescriptor {
  const adapter = registry.get(id);
  if (!adapter) throw new Error(`unknown tool adapter: ${id}`);
  return adapter;
}

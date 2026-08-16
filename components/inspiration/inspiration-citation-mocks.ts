import type { InspirationCitation } from "./InspirationCitationCard";

const previewCitations = {
  balance: {
    id: "inspiration-preview:balance",
    entryId: "balance",
    title: "留白与重心的非对称平衡",
    source: "Lumi 原创合规示意 · 本地 mock",
    license: "原创示意，仅作课程原型展示",
    relevance: "把“画面偏”转成可检验的重心与留白关系，而不是直接套用画面外观。",
    isMock: true,
  },
  rhythm: {
    id: "inspiration-preview:rhythm",
    entryId: "rhythm",
    title: "字体节奏不是把字号拉开",
    source: "Lumi 原创合规示意 · 本地 mock",
    license: "原创示意，仅作课程原型展示",
    relevance: "帮助把标题、正文与停顿的关系拆成可比较的层级动作。",
    isMock: true,
  },
  layers: {
    id: "inspiration-preview:layers",
    entryId: "layers",
    title: "层级用遮挡建立，不只用大小建立",
    source: "Lumi 原创合规示意 · 本地 mock",
    license: "原创示意，仅作课程原型展示",
    relevance: "可用前、中、背景关系检查画面为什么显得平。",
    isMock: true,
  },
  grid: {
    id: "inspiration-preview:grid",
    entryId: "grid",
    title: "网格先服务阅读，再服务整齐",
    source: "Lumi 原创合规示意 · 本地 mock",
    license: "原创示意，仅作课程原型展示",
    relevance: "把“对齐了仍乱”的感受落到参照线与阅读顺序。",
    isMock: true,
  },
  fold: {
    id: "inspiration-preview:fold",
    entryId: "fold",
    title: "材质可以参与叙事，不只是装饰",
    source: "Lumi 原创合规示意 · 本地 mock",
    license: "原创示意，仅作课程原型展示",
    relevance: "帮助判断折叠与纸面明暗是否真正服务叙事。",
    isMock: true,
  },
  motion: {
    id: "inspiration-preview:motion",
    entryId: "motion",
    title: "把动态拆成可比对的四个状态",
    source: "Lumi 原创合规示意 · 本地 mock",
    license: "原创示意，仅作课程原型展示",
    relevance: "让动态效果回到触发、变化与反馈的连续状态上。",
    isMock: true,
  },
  contrast: {
    id: "inspiration-preview:contrast",
    entryId: "contrast",
    title: "对比有主次，色彩才不会互相喊话",
    source: "Lumi 原创合规示意 · 本地 mock",
    license: "原创示意，仅作课程原型展示",
    relevance: "用注意力路径解释色彩角色，而不是把颜色数量当成问题本身。",
    isMock: true,
  },
  marks: {
    id: "inspiration-preview:marks",
    entryId: "marks",
    title: "从一个标记长出一套识别系统",
    source: "Lumi 原创合规示意 · 本地 mock",
    license: "原创示意，仅作课程原型展示",
    relevance: "把“像不像”转为跨尺寸、跨物料时规则是否成立的判断。",
    isMock: true,
  },
} as const satisfies Record<string, InspirationCitation>;

export function inspirationCitationPreviewFor(entryId: string | null | undefined) {
  if (!entryId) return undefined;
  return previewCitations[entryId as keyof typeof previewCitations];
}

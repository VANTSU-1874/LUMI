/**
 * 单文件 HTML 生成器的创作规范。
 *
 * 来源：第三方教研资料中的生成器创作规范（AES-GT），经本项目改写收紧。
 * 与原规范的差异：原规范允许 Google Fonts 与 cdnjs 外链，本项目要求**零外链**，
 * 因此字体改用系统等宽栈、导出仅走 data URI。详见 generative-html-guard.ts。
 *
 * 这份常量是生成提示词的硬约束，不是给学生看的文案。
 */

export const GENERATIVE_TOOL_KINDS = [
  "DOT_MATRIX",
  "ARC_RING",
  "PARTICLE_FIELD",
  "CONTOUR_TERRAIN",
  "GRADIENT_DIFFUSION",
] as const;

export type GenerativeToolKind = (typeof GENERATIVE_TOOL_KINDS)[number];

export const GENERATIVE_TOOL_KIND_LABELS: Record<GenerativeToolKind, string> = {
  DOT_MATRIX: "点阵",
  ARC_RING: "弧形圆环",
  PARTICLE_FIELD: "粒子流场",
  CONTOUR_TERRAIN: "等高线地形",
  GRADIENT_DIFFUSION: "渐变扩散",
};

export const GENERATIVE_TOOL_SPEC = `你要产出一个**单文件 HTML 生成器**，供设计专业学生调参数、观察形式语言的变化。

## 硬约束（违反即被拒收，不予展示）

1. 单文件：所有 CSS 与 JS 内联在一个 HTML 文档里，以 \`<!doctype html>\` 开头。
2. **零外部请求**：不得出现 \`<script src>\`、\`<link href>\`、\`@import\`、\`fetch\`、\`XMLHttpRequest\`、\`WebSocket\`、\`EventSource\`、动态 \`import()\`，也不得出现任何 \`http://\`、\`https://\` 或 \`//\` 开头的地址。字体只用系统栈：\`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace\`。
3. 不得使用 \`iframe\`/\`object\`/\`embed\`/\`form\`，不得访问 \`parent\`/\`top\`/\`opener\`，不得读写 \`document.cookie\`、\`localStorage\`、\`sessionStorage\`、\`indexedDB\`。
4. 布局必须由**种子随机**驱动，可通过 seed 复现；\`Math.random()\` 只允许用于逐帧的瞬时抖动。
5. 导出用 canvas \`toDataURL\` 生成 data URI，并同时显示一个可右键另存的可见链接（部分环境会拦截自动点击）。
6. 产物不超过 512KB。

## 界面骨架（四区，固定）

- **顶栏**（36–38px）：作品名大写加字距，1px 分隔线，右侧放实时元信息（模式、尺寸、数量）。
- **画布区**：背景用 \`--bg2\`，四角十字标记，四个 9px 角标显示 seed / 数量 / 运动状态 / 尺寸。
- **侧栏**（260–320px）：可滚动分区，每区一个 9px 大写英文区标；底部固定「随机」与「导出」两个按钮。
- **状态栏**（22–24px）：9px 等宽的键值对。

## 设计 token（界面中性，画面响亮）

\`\`\`css
:root{--bg:#f0eeeb;--bg2:#e8e5e0;--bg3:#dedad4;--border:#c8c3bc;--border2:#b0aaa2;--text:#1a1816;--text2:#6b6560;--text3:#9b9590;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
\`\`\`

界面只用上面这组暖灰，**不得在界面上使用彩色**——所有颜色都留给画布。滑块轨道 2px，滑块头 9–10px 圆形。选中态与主按钮一律用反色（背景 \`--text\`、文字 \`--bg\`）。

## 文案规则

区标用英文大写（\`Rings\`、\`Motion\`、\`Colors\`），参数标签用简体中文（弧层数、切割角度、晕染大小）。

## 代码结构

全部状态收在一个对象 \`S\` 里；提供 \`draw()\`、\`randomize()\`、\`exportPNG()\` 三个顶层函数；参数变更后调用 \`draw()\` 重绘，不做整页重建。`;

export function buildGenerativePrompt(input: { kind: GenerativeToolKind; brief: string }) {
  return [
    GENERATIVE_TOOL_SPEC,
    `## 本次要做的生成器`,
    `类型：${GENERATIVE_TOOL_KIND_LABELS[input.kind]}（${input.kind}）`,
    `学生的要求：${input.brief}`,
    `只输出 HTML 文档本身，不要任何解释文字，不要代码围栏。`,
  ].join("\n\n");
}

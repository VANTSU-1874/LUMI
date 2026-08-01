export type MentorContext = "CHAT" | "NODE_CANVAS" | "KNOWLEDGE_MAP" | "PROJECT";
export type MentorMoment = "BEFORE" | "DURING" | "AFTER";

export type MentorVisualNode = {
  id: string;
  label: string;
  family: "TOP" | "SOP" | "CHOP" | "COMP" | "CONCEPT";
};

export type MentorVisualReply = {
  moment: MentorMoment;
  eyebrow: string;
  title: string;
  insight: string;
  nodes: MentorVisualNode[];
  links: Array<[string, string]>;
  actions: string[];
  focusTool: "NODE_CANVAS" | "KNOWLEDGE_MAP" | null;
  focusNode: string | null;
};

const particleNodes: MentorVisualNode[] = [
  { id: "source", label: "素材 / Resolution", family: "TOP" },
  { id: "position", label: "tx / ty", family: "CHOP" },
  { id: "color", label: "RGB", family: "CHOP" },
  { id: "depth", label: "tz", family: "CHOP" },
  { id: "merge", label: "Merge", family: "CHOP" },
  { id: "geo", label: "Geo", family: "COMP" },
  { id: "render", label: "Render", family: "TOP" },
];

function containsAny(question: string, words: string[]) {
  const normalized = question.toLocaleLowerCase();
  return words.some((word) => normalized.includes(word.toLocaleLowerCase()));
}

export function createVisualMentorReply(question: string, context: MentorContext): MentorVisualReply {
  if (containsAny(question, ["不动", "没反应", "没有反应", "没效果", "黑屏", "排查", "问题"])) {
    return {
      moment: "DURING",
      eyebrow: "学习中 · 排障导师",
      title: "先别重搭网络，找出信号停在哪一层",
      insight: "按真实工程依次检查：Box 实体存在、tx/ty 有位置、RGB 有颜色、tz 在变化、Merge 通道齐全、Geo Instancing 已引用、Render 能看到场景。第一个不成立的位置就是故障边界。",
      nodes: [
        { id: "points", label: "有点", family: "SOP" },
        { id: "values", label: "有数", family: "CHOP" },
        { id: "moving", label: "数在变", family: "CHOP" },
        { id: "write", label: "写回 Z", family: "SOP" },
        { id: "visible", label: "被渲染", family: "TOP" },
      ],
      links: [["points", "values"], ["values", "moving"], ["moving", "write"], ["write", "visible"]],
      actions: ["先看 merge1 是否同时有 tx/ty、RGB、tz", "再看 geo1 的 Instancing 参数是否引用 merge1", "最后检查 Box、Phong、Camera 与 Light"],
      focusTool: "NODE_CANVAS",
      focusNode: "merge",
    };
  }

  if (containsAny(question, ["noise", "噪声", "z轴", "z 轴", "起伏", "幅度"])) {
    return {
      moment: "DURING",
      eyebrow: "学习中 · 参数导师",
      title: "这里的 Noise 先生成动态图，再转成 tz 数值",
      insight: "你的工程使用 Noise TOP 生成动态纹理，经 TOP to CHOP、Shuffle、Select 变成实例的 tz 通道，最后由 Math 缩放 Z 轴幅度。",
      nodes: [
        { id: "noise", label: "Noise TOP", family: "TOP" },
        { id: "topto", label: "TOP to CHOP", family: "CHOP" },
        { id: "select", label: "Select tz", family: "CHOP" },
        { id: "math", label: "Math × 幅度", family: "CHOP" },
        { id: "depth", label: "实例 tz", family: "CONCEPT" },
      ],
      links: [["noise", "topto"], ["topto", "select"], ["select", "math"], ["math", "depth"]],
      actions: ["在节点画布拖动 Noise speed", "选择 math1 调整 tz multiply", "断开 tz 支路观察平面状态"],
      focusTool: "NODE_CANVAS",
      focusNode: "noise",
    };
  }

  if (containsAny(question, ["迁移", "举一反三", "声音", "音乐", "手势", "换成", "还能做"])) {
    return {
      moment: "AFTER",
      eyebrow: "学习后 · 迁移导师",
      title: "保留映射结构，只替换输入或输出",
      insight: "粒子化的可迁移核心不是某个节点名，而是“位置、颜色、动态三路数据 → Merge → Geo Instancing”。",
      nodes: [
        { id: "source", label: "声音 / 手势", family: "CONCEPT" },
        { id: "map", label: "范围映射", family: "CONCEPT" },
        { id: "attribute", label: "Z / 颜色 / 尺寸", family: "CONCEPT" },
        { id: "experience", label: "新体验", family: "CONCEPT" },
      ],
      links: [["source", "map"], ["map", "attribute"], ["attribute", "experience"]],
      actions: ["把 Noise 换成麦克风音量", "把 Z 位移换成粒子尺寸", "用同一结构设计社区声音地图"],
      focusTool: "KNOWLEDGE_MAP",
      focusNode: "mapping",
    };
  }

  if (containsAny(question, ["粒子", "图片", "grid", "geo", "touchdesigner", "节点", "怎么做"])) {
    return {
      moment: "BEFORE",
      eyebrow: "学习前 · 逻辑导师",
      title: "图片粒子化，是让三路数据共同驱动 Box 实例",
      insight: "Grid 经 SOP to CHOP 提供 tx/ty；图片经 TOP to CHOP 提供 RGB；Noise TOP 经另一条 TOP to CHOP 与 Math 提供 tz。三路在 merge1 汇合，再驱动 geo1 Instancing。",
      nodes: particleNodes,
      links: [["source", "color"], ["source", "depth"], ["position", "merge"], ["color", "merge"], ["depth", "merge"], ["merge", "geo"], ["geo", "render"]],
      actions: ["先看 Render 最终效果", "分别断开 tx/ty、RGB、tz 三路", "最后观察 merge1 如何驱动 Geo"],
      focusTool: "NODE_CANVAS",
      focusNode: "grid",
    };
  }

  return {
    moment: context === "PROJECT" ? "DURING" : "BEFORE",
    eyebrow: context === "PROJECT" ? "学习中 · 项目导师" : "先从现象开始",
    title: "把你看到的现象告诉我，不用先想节点名",
    insight: "你可以说“画面没有动”“我想让声音控制粒子”或“为什么要接 Math”。我会先画出关系，再带你去对应工具里试。",
    nodes: [
      { id: "see", label: "看到什么", family: "CONCEPT" },
      { id: "want", label: "想变成什么", family: "CONCEPT" },
      { id: "test", label: "做一个小试验", family: "CONCEPT" },
    ],
    links: [["see", "want"], ["want", "test"]],
    actions: ["描述当前画面", "说出一个想控制的变化", "上传证据前先做最小测试"],
    focusTool: null,
    focusNode: null,
  };
}

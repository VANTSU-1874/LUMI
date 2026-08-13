export type InspirationArtwork =
  | "balance"
  | "rhythm"
  | "layers"
  | "grid"
  | "fold"
  | "motion"
  | "contrast"
  | "marks";

export type InspirationEntry = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  observation: string;
  relation: string;
  topics: readonly string[];
  medium: string;
  course: string;
  artwork: InspirationArtwork;
  alt: string;
  aspect: "tall" | "wide" | "square";
  source: string;
  license: string;
  updated: string;
  related: readonly string[];
  /** Published database records have no browser-delivered artwork until a separately approved preview resolver exists. */
  metadataOnly?: boolean;
  /** Authenticated same-origin preview route; never a source/storage locator. */
  protectedPreviewUrl?: string | null;
  sourceUrl?: string | null;
};

export type InspirationEntries = readonly [InspirationEntry, ...InspirationEntry[]];

// This V1 data stays server-only so a signed-out route never serializes its
// titles, source notes, or course relationships into the client bundle.
export const inspirationEntries = [
  {
    id: "balance",
    title: "留白与重心的非对称平衡",
    subtitle: "构成观察 · 示例卡",
    description: "把大面积深色形状压向左下，再以一处暖色圆形把视线拉回上方。",
    observation: "重心不在画面正中，但底部水平线让视觉重量有了可感知的停靠点。",
    relation: "适合回答“主视觉总是显得偏”的问题：先找重心，再决定元素大小。",
    topics: ["构成", "留白", "视觉重心"],
    medium: "平面构成",
    course: "版式设计",
    artwork: "balance",
    alt: "暖白底上的黑色半圆、朱砂圆形与细竖线构成的抽象平面练习。",
    aspect: "tall",
    source: "Lumi 原创合规示意 · 受保护页面内的本地矢量示意",
    license: "原创示意，仅作课程原型展示",
    updated: "2026-08-09",
    related: ["grid", "contrast"],
  },
  {
    id: "rhythm",
    title: "字体节奏不是把字号拉开",
    subtitle: "字形与层级 · 示例卡",
    description: "用不等宽的竖向块、粗细变化与留白间距，观察阅读速度如何被组织。",
    observation: "信息的“先后”由块面比例、字重和停顿共同形成，不能只靠加粗。",
    relation: "可关联“海报标题太抢 / 正文太散”的反馈，转成可调整的层级动作。",
    topics: ["字体", "层级", "节奏"],
    medium: "文字编排",
    course: "版式设计",
    artwork: "rhythm",
    alt: "深色竖条、朱砂色细条和不同宽度横向文字块构成的抽象版式练习。",
    aspect: "wide",
    source: "Lumi 原创合规示意 · 受保护页面内的本地矢量示意",
    license: "原创示意，仅作课程原型展示",
    updated: "2026-08-09",
    related: ["marks", "balance"],
  },
  {
    id: "layers",
    title: "层级用遮挡建立，不只用大小建立",
    subtitle: "空间关系 · 示例卡",
    description: "同一条弧线被不同色层切分，前后关系让阅读顺序自然出现。",
    observation: "色块重叠比孤立摆放更容易形成“谁先被看见、谁稍后被发现”的节奏。",
    relation: "适合把“画面太平”拆成可验证问题：是否存在前景、中层和背景的关系。",
    topics: ["层级", "遮挡", "空间"],
    medium: "图形语言",
    course: "图形创意",
    artwork: "layers",
    alt: "深色背景上由米白、朱砂和黑色弧线叠加构成的抽象空间练习。",
    aspect: "square",
    source: "Lumi 原创合规示意 · 受保护页面内的本地矢量示意",
    license: "原创示意，仅作课程原型展示",
    updated: "2026-08-09",
    related: ["motion", "balance"],
  },
  {
    id: "grid",
    title: "网格先服务阅读，再服务整齐",
    subtitle: "信息结构 · 示例卡",
    description: "同一套基础格线容纳不同尺度的形状，让变化发生在规则之内。",
    observation: "大块并没有横跨所有列，保留了边距与列间关系，画面因此仍可预测。",
    relation: "适合回答“元素都对齐了却仍乱”的问题：检查对齐参照是否一致。",
    topics: ["网格", "信息结构", "对齐"],
    medium: "版面系统",
    course: "版式设计",
    artwork: "grid",
    alt: "米色网格中摆放黑色矩形、朱砂圆形和色块的抽象版面结构练习。",
    aspect: "wide",
    source: "Lumi 原创合规示意 · 受保护页面内的本地矢量示意",
    license: "原创示意，仅作课程原型展示",
    updated: "2026-08-09",
    related: ["rhythm", "balance"],
  },
  {
    id: "fold",
    title: "材质可以参与叙事，不只是装饰",
    subtitle: "媒介触感 · 示例卡",
    description: "折叠产生的明暗和边缘偏移，使二维纸面具有被观看与被触摸的暗示。",
    observation: "折线是图形中的事件；它让同一种纸面在不同区域表现出不同的语气。",
    relation: "可关联包装、书籍和展陈问题：媒介选择是否放大了主题，而非只增加效果。",
    topics: ["材质", "折叠", "媒介"],
    medium: "纸面研究",
    course: "书籍设计",
    artwork: "fold",
    alt: "暖灰背景上的折叠纸片由浅色、米色和棕色平面组成的抽象材质练习。",
    aspect: "tall",
    source: "Lumi 原创合规示意 · 受保护页面内的本地矢量示意",
    license: "原创示意，仅作课程原型展示",
    updated: "2026-08-09",
    related: ["layers", "marks"],
  },
  {
    id: "motion",
    title: "把动态拆成可比对的四个状态",
    subtitle: "交互时序 · 示例卡",
    description: "连续动作被分成相邻画格：变化应当能被描述，而不是只被感到“有动效”。",
    observation: "每一帧都保留共同的视觉骨架，观众才会把变化识别成同一件事的演进。",
    relation: "可关联数字交互文创中的时序说明：先说明触发、变化、反馈，再讨论效果。",
    topics: ["动势", "交互", "时序"],
    medium: "动态分镜",
    course: "数字交互文创设计",
    artwork: "motion",
    alt: "深色底上四张米白色竖向画格，黑色曲线和朱砂圆点逐帧上移的抽象动态练习。",
    aspect: "wide",
    source: "Lumi 原创合规示意 · 受保护页面内的本地矢量示意",
    license: "原创示意，仅作课程原型展示",
    updated: "2026-08-09",
    related: ["layers", "marks"],
  },
  {
    id: "contrast",
    title: "对比有主次，色彩才不会互相喊话",
    subtitle: "色彩与聚焦 · 示例卡",
    description: "用大面积墨色、少量朱砂与柔和米色建立稳定的对比秩序。",
    observation: "朱砂不承担全部信息，只标记一个关键点；主视觉仍由整体明暗关系支撑。",
    relation: "适合回答“颜色很多却没有重点”的问题：先定注意力路径，再压缩色彩角色。",
    topics: ["色彩", "对比", "聚焦"],
    medium: "色彩关系",
    course: "图形创意",
    artwork: "contrast",
    alt: "朱砂色左侧色块、黑色拱形和米色圆形组成的抽象色彩对比练习。",
    aspect: "square",
    source: "Lumi 原创合规示意 · 受保护页面内的本地矢量示意",
    license: "原创示意，仅作课程原型展示",
    updated: "2026-08-09",
    related: ["balance", "rhythm"],
  },
  {
    id: "marks",
    title: "从一个标记长出一套识别系统",
    subtitle: "标志与延展 · 示例卡",
    description: "中心几何关系可缩放、拆分并延展到边角，而不是只适合放在 Logo 位。",
    observation: "核心符号在不同尺度仍保留相同的方向感，系统因而具有一致性。",
    relation: "可关联 VI 设计：不要急着评价“像不像”，先检验规则能否跨物料成立。",
    topics: ["标志", "系统", "延展"],
    medium: "识别系统",
    course: "品牌与 VI 设计",
    artwork: "marks",
    alt: "暖白背景上由黑色和朱砂色菱形结构组成的抽象标志系统练习。",
    aspect: "square",
    source: "Lumi 原创合规示意 · 受保护页面内的本地矢量示意",
    license: "原创示意，仅作课程原型展示",
    updated: "2026-08-09",
    related: ["rhythm", "fold"],
  },
] as const satisfies InspirationEntries;

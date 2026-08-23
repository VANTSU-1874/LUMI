import type { LearningEpisode } from "@/lib/course-packs/contract";

import {
  coverAttachmentForSession,
  posterFusionAttachments,
  type PreviewAttachment,
} from "./attachments";
import type { PreviewOutcome, PreviewScenarioId } from "./contracts";

export type PreviewSuggestion = {
  id: string;
  label: string;
  prompt: string;
  outcome: PreviewOutcome;
  attachments?: readonly PreviewAttachment[];
};

export type PreviewScenario = {
  id: PreviewScenarioId;
  title: string;
  capability: string;
  description: string;
  sourceLabel: string;
  coursePackId: "digital-interaction" | "book-design";
  focus: string;
  initial: PreviewSuggestion;
  suggestions: readonly PreviewSuggestion[];
  recentTurns: Array<{
    studentMessage: string;
    assistantTitle: string;
    assistantMessage: string;
    episode: LearningEpisode;
  }>;
};

const outcomes = {
  conclusion: {
    code: "STAGE_CONCLUSION",
    label: "阶段性结论",
    description: "已明确本轮应先判断的关键对象与边界，可据此继续讨论。",
  },
  nextStep: {
    code: "NEXT_STEP",
    label: "下一步建议",
    description: "已形成一项可立即执行的调整动作，完成后再观察效果。",
  },
  evidence: {
    code: "EVIDENCE_NEEDED",
    label: "待补证据",
    description: "当前还不能下结论，需要补充观察、样本或过程记录。",
  },
  nextEvaluation: {
    code: "NEXT_EVALUATION",
    label: "进入下一轮评估",
    description: "已具备可测试的方案，下一轮应带着反馈结果返回复盘。",
  },
} as const satisfies Record<string, PreviewOutcome>;

const touchDesignerQuestion = "我在数字交互课程用 TouchDesigner 做实时互动练习：希望鼠标位置同时驱动粒子的颜色和位置，但现在画面只有颜色变化，粒子没有跟随。";
const brandStandardQuestion = "我正在为校园阅读节建立品牌设计规范：已有标志草图、两组色彩和若干宣传版式，但不同同学做出来的海报看起来不像同一套视觉系统。";
const coverLayoutQuestion = "请根据随附的书籍封面图，帮我分析标题层级、阅读顺序、图文关系和留白。只依据画面可见内容判断，不臆测纸张、工艺或未展示页面。";
const portfolioQuestion = "我的作品风格多样，怎么做作品集来囊括它们并使整体变得和谐？";
const posterFusionQuestion = "我想以随附的三张海报作为参考，设计一张新的活动海报。请根据三张图的色彩、信息结构与版面节奏，拆解可融合的原则，并为首次尝试确定一条视觉主线。只依据画面可见内容判断。";

const scenarios: readonly PreviewScenario[] = [
  {
    id: "S1_DIGITAL_PRODUCT",
    title: "TouchDesigner 交互操作",
    capability: "从节点网络、数据范围与最小测试定位实时互动问题",
    description: "以 TouchDesigner 实时互动练习为例，判断节点连接、坐标映射与验证顺序。",
    sourceLabel: "数字交互课程 · TouchDesigner",
    coursePackId: "digital-interaction",
    focus: "TouchDesigner 节点网络、鼠标输入、坐标映射、参数范围与最小测试",
    initial: {
      id: "S1_PRODUCT_START",
      label: "开始定位节点问题",
      prompt: `${touchDesignerQuestion} 请按初学者能操作的顺序判断：这一轮应该先检查哪个节点连接、参数范围或坐标映射？不要只给术语清单。`,
      outcome: outcomes.conclusion,
    },
    suggestions: [
      {
        id: "S1_PRODUCT_AUDIENCE",
        label: "确认输入数据是否变化",
        prompt: `${touchDesignerQuestion} 请先判断该怎样确认鼠标输入数据确实在变化，并给出一个最小观察步骤。`,
        outcome: outcomes.conclusion,
      },
      {
        id: "S1_PRODUCT_ENTRY",
        label: "检查坐标映射与范围",
        prompt: `${touchDesignerQuestion} 请把鼠标坐标映射到粒子位置时，优先检查哪些范围、方向或归一化关系？我还缺什么观察证据？`,
        outcome: outcomes.evidence,
      },
      {
        id: "S1_PRODUCT_FEEDBACK",
        label: "区分节点连接与参数绑定",
        prompt: `${touchDesignerQuestion} 请区分是节点连接问题还是参数绑定问题，并给我一项可立即执行的排查动作。`,
        outcome: outcomes.nextStep,
      },
      {
        id: "S1_PRODUCT_TEST",
        label: "安排最小可复现测试",
        prompt: `${touchDesignerQuestion} 请安排一个可复现的最小测试，让我能带着结果进入下一轮调试。`,
        outcome: outcomes.nextEvaluation,
      },
    ],
    recentTurns: [],
  },
  {
    id: "S2_COURSE_DESIGN",
    title: "品牌设计规范",
    capability: "将标志、色彩、字体和版式组织为可执行的品牌规范",
    description: "从视觉系统规则出发，判断品牌规范能否支撑多人协作与多媒介应用。",
    sourceLabel: "品牌设计规范",
    coursePackId: "book-design",
    focus: "品牌定位、标志使用、色彩与字体层级、版式规则和跨媒介一致性",
    initial: {
      id: "S2_COURSE_START",
      label: "从视觉系统规则开始",
      prompt: `${brandStandardQuestion} 请先判断：在继续做单张海报前，这套规范最该优先固定哪几类规则，才能让后续设计有共同依据？`,
      outcome: outcomes.conclusion,
    },
    suggestions: [
      {
        id: "S2_COURSE_OBJECTIVE",
        label: "澄清品牌核心联想",
        prompt: `${brandStandardQuestion} 请先判断品牌需要让受众形成什么核心联想，并检查现有元素是否朝同一个方向服务。`,
        outcome: outcomes.conclusion,
      },
      {
        id: "S2_COURSE_SCAFFOLD",
        label: "建立标志、色彩与字体层级",
        prompt: `${brandStandardQuestion} 请给出标志、主辅色、字体和信息层级的最小规范框架，让不同同学能立刻据此制作。`,
        outcome: outcomes.nextStep,
      },
      {
        id: "S2_COURSE_EVIDENCE",
        label: "检验跨媒介一致性",
        prompt: `${brandStandardQuestion} 请判断我还需拿哪些版式或应用场景做对照，才能确认这套规范在海报、社媒和导览物中保持一致。`,
        outcome: outcomes.evidence,
      },
      {
        id: "S2_COURSE_PEER_REVIEW",
        label: "形成可用的规范检查表",
        prompt: `${brandStandardQuestion} 请把规范收束成一次多人制作前可执行的检查表，并说明完成后该如何进入下一轮校正。`,
        outcome: outcomes.nextEvaluation,
      },
    ],
    recentTurns: [],
  },
  {
    id: "S3_DESIGN_KNOWLEDGE",
    title: "封面版式设计分析",
    capability: "围绕封面的信息层级和阅读路径解释具体版式决策",
    description: "随机附上一张封面参考图，分析文字、图形、留白与阅读顺序之间的关系。",
    sourceLabel: "书籍设计 · 封面版式",
    coursePackId: "book-design",
    focus: "封面版式、标题层级、阅读路径、图文关系、留白和视觉重心",
    initial: {
      id: "S3_KNOWLEDGE_START",
      label: "开始分析这张封面",
      prompt: `${coverLayoutQuestion} 请先从读者第一眼的进入点开始分析。`,
      outcome: outcomes.conclusion,
    },
    suggestions: [
      {
        id: "S3_KNOWLEDGE_READING_TASK",
        label: "确认视觉进入点与阅读顺序",
        prompt: `${coverLayoutQuestion} 请判断读者第一眼先看到什么、随后会读到什么，并说明这个顺序如何形成。`,
        outcome: outcomes.conclusion,
      },
      {
        id: "S3_KNOWLEDGE_PRIORITY",
        label: "调整标题与信息层级",
        prompt: `${coverLayoutQuestion} 请指出标题、副标题和辅助信息可能怎样拉开层级，并给一项可执行的版式调整建议。`,
        outcome: outcomes.nextStep,
      },
      {
        id: "S3_KNOWLEDGE_CONFLICT",
        label: "找出图文关系的冲突证据",
        prompt: `${coverLayoutQuestion} 请判断我还需要通过哪些读者观察或草图对照，才能确认图文关系是否正在干扰阅读。`,
        outcome: outcomes.evidence,
      },
      {
        id: "S3_KNOWLEDGE_WAYFINDING",
        label: "安排封面缩略图测试",
        prompt: `${coverLayoutQuestion} 请安排一次缩略图或远距离观看测试，让我能依据读者的阅读路径进入下一轮调整。`,
        outcome: outcomes.nextEvaluation,
      },
    ],
    recentTurns: [],
  },
  {
    id: "S4_PORTFOLIO_DIRECTION",
    title: "个人作品 / 作品集方向",
    capability: "从作品的共同问题出发，形成作品集叙事、方向取舍与补强顺序",
    description: "面向风格多样的个人作品，判断如何收束叙事并安排可持续的下一步。",
    sourceLabel: "个人作品与作品集方向",
    coursePackId: "book-design",
    focus: "作品集叙事、个人优势、方向选择、项目取舍与可持续补强顺序",
    initial: {
      id: "S4_PORTFOLIO_START",
      label: "从作品集主线开始",
      prompt: `${portfolioQuestion} 请先帮我判断：不急着统一视觉风格时，我应该从哪些共同问题或价值出发，建立作品集的主线？`,
      outcome: outcomes.conclusion,
    },
    suggestions: [
      {
        id: "S4_PORTFOLIO_STORY",
        label: "提炼作品集的共同主线",
        prompt: `${portfolioQuestion} 请帮助我形成一个阶段性的作品集叙事判断：哪些差异可以保留，哪些共同点应该被看见？`,
        outcome: outcomes.conclusion,
      },
      {
        id: "S4_PORTFOLIO_COMPARE",
        label: "识别个人优势与发展方向",
        prompt: `${portfolioQuestion} 请比较我可以主打的两个方向，并判断如何从已有作品中识别更有说服力的个人优势。`,
        outcome: outcomes.nextStep,
      },
      {
        id: "S4_PORTFOLIO_GAP",
        label: "判断作品集还缺什么证据",
        prompt: `${portfolioQuestion} 请追问我还缺哪些项目过程、结果或外部反馈，才能判断作品集真正的短板而非只看风格差异。`,
        outcome: outcomes.evidence,
      },
      {
        id: "S4_PORTFOLIO_SEQUENCE",
        label: "制定可持续的补强顺序",
        prompt: `${portfolioQuestion} 请给我一个先补哪一项、再以什么反馈复看的顺序，让我能持续补强并进入下一轮评估。`,
        outcome: outcomes.nextEvaluation,
      },
    ],
    recentTurns: [],
  },
  {
    id: "S5_LEARNING_EVIDENCE",
    title: "海报风格融合设计",
    capability: "从多张视觉参考中提炼可组合的原则，而不是直接拼贴元素",
    description: "固定附上三张海报素材，分析可融合的视觉主线、冲突控制与小样验证。",
    sourceLabel: "海报风格融合设计",
    coursePackId: "book-design",
    focus: "海报风格、色彩关系、信息结构、版面节奏、融合主线与小样测试",
    initial: {
      id: "S5_EVIDENCE_START",
      label: "开始梳理融合主线",
      prompt: posterFusionQuestion,
      outcome: outcomes.conclusion,
      attachments: posterFusionAttachments,
    },
    suggestions: [
      {
        id: "S5_EVIDENCE_HYPOTHESIS",
        label: "提取三张海报的风格要素",
        prompt: `${posterFusionQuestion} 请分别提取可见的色彩、信息层级、图形语言和节奏，并判断哪些可以成为共同语法。`,
        outcome: outcomes.conclusion,
      },
      {
        id: "S5_EVIDENCE_RECORD",
        label: "选择融合主线与优先级",
        prompt: `${posterFusionQuestion} 请帮我只选一条视觉主线，并给出保留、弱化和暂不采用的元素优先级。`,
        outcome: outcomes.nextStep,
      },
      {
        id: "S5_EVIDENCE_GAP",
        label: "控制素材冲突与信息层级",
        prompt: `${posterFusionQuestion} 请判断我还需要通过哪些对照或读者观察，才能确认风格融合没有破坏信息层级。`,
        outcome: outcomes.evidence,
      },
      {
        id: "S5_EVIDENCE_REVIEW",
        label: "制定一版小样与对照测试",
        prompt: `${posterFusionQuestion} 请安排一个小样制作和对照测试，让我能带着反馈进入下一轮海报调整。`,
        outcome: outcomes.nextEvaluation,
      },
    ],
    recentTurns: [],
  },
] as const;

const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

export class PreviewSuggestionNotFoundError extends Error {
  constructor() {
    super("preview suggestion is not registered for this direction");
    this.name = "PreviewSuggestionNotFoundError";
  }
}
function hydrateScenario(scenario: PreviewScenario, sessionId?: string): PreviewScenario {
  if (scenario.id !== "S3_DESIGN_KNOWLEDGE") return scenario;
  return {
    ...scenario,
    initial: {
      ...scenario.initial,
      attachments: [coverAttachmentForSession(sessionId)],
    },
  };
}

export function listPreviewScenarios(sessionId?: string) {
  return scenarios.map((scenario) => hydrateScenario(scenario, sessionId));
}

export function getPreviewScenario(id: PreviewScenarioId, sessionId?: string) {
  const scenario = byId.get(id);
  if (!scenario) throw new Error("preview scenario is not registered");
  return hydrateScenario(scenario, sessionId);
}

export function getPreviewSuggestion(scenarioId: PreviewScenarioId, suggestionId: string, sessionId?: string) {
  const scenario = getPreviewScenario(scenarioId, sessionId);
  const suggestion = scenario.initial.id === suggestionId
    ? scenario.initial
    : scenario.suggestions.find((item) => item.id === suggestionId);
  if (!suggestion) throw new PreviewSuggestionNotFoundError();
  return { scenario, suggestion };
}

export function isPreviewInitialSuggestion(scenario: PreviewScenario, suggestionId: string) {
  return scenario.initial.id === suggestionId;
}

export function createPreviewFreeInput(scenario: PreviewScenario, message: string): PreviewSuggestion {
  return {
    id: "FREE_INPUT",
    label: "评委自由追问",
    prompt: message,
    outcome: outcomes.nextStep,
  };
}

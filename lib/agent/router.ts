import type { CoursePack, LearningEpisode } from "@/lib/course-packs/contract";
import type { AgentActionTypeSchema, AgentView } from "./contracts";
import type { z } from "zod";

export type AgentActionType = z.infer<typeof AgentActionTypeSchema>;

export const DECISION_CODES_BY_EPISODE: Record<LearningEpisode, readonly string[]> = {
  EXPLORE: ["EXPLORE_CLARIFY_GOAL", "EXPLORE_START_DIAGNOSTIC"],
  UNDERSTAND: ["UNDERSTAND_RELATIONSHIP", "UNDERSTAND_COMPARE_CONCEPTS", "UNDERSTAND_CLARIFY_LOGIC_CARD"],
  BUILD: ["BUILD_SELECT_STRUCTURE", "BUILD_OPEN_WORKSPACE"],
  DEBUG: ["DEBUG_TRACE_SIGNAL", "DEBUG_REQUEST_EVIDENCE"],
  TRANSFER: ["TRANSFER_RETAIN_AND_CHANGE", "TRANSFER_START_CHALLENGE"],
  REFLECT: ["REFLECT_EXPLAIN_EVIDENCE", "REFLECT_REQUEST_REVIEW"],
};

export function requestsFormalAuthority(message: string) {
  return /(替我|帮我|直接).{0,8}(提交|评分|通过)|改.{0,6}(评价|分数).{0,6}(优秀|满分|通过)|给我满分/.test(
    message.normalize("NFKC").toLowerCase(),
  );
}

export function inferLearningEpisode(message: string, view: AgentView): LearningEpisode {
  const normalized = message.normalize("NFKC").toLowerCase();
  if (requestsFormalAuthority(normalized)) return "REFLECT";
  if (/(不知道|不清楚|没想好).{0,12}(想做|做什么|什么效果|目标|先想|先判断|从哪里开始|如何开始)|没有.{0,6}(想法|目标)|应该?先(判断|明确)什么/.test(normalized)) return "EXPLORE";
  if (/(不动|没反应|没有.{0,4}反应|没有变化|无变化|报错|错误|失败|收不到|排障|卡住|失效|看不清|读不懂|找不到|不知道.*(哪里|下一页|怎么走)|为什么.*没有|堵|拥堵|下坠|往下坠|打滑|总是滑|轻飘|没有印象|不舒服|难用)/.test(normalized)) return "DEBUG";
  if (/(迁移|举一反三|换成|改成|另一种|社区居民|新受众)/.test(normalized)) return "TRANSFER";
  if (view === "EVIDENCE" || /(复盘|反思|总结|我学会|解释我的|为什么这样做|用证据解释|证明.*有效)/.test(normalized)) return "REFLECT";
  if (/(为什么|是什么|做什么|区别|关系|原理|理解|有什么用)/.test(normalized)) return "UNDERSTAND";
  if (/(搭建|连接|制作|做一个|怎么做|怎么搭|拖到|开始做|应该先|先固定|安排页序|调整|整理|(怎样|如何|怎么).{0,16}(验证|安排|建立|梳理|组织|制作|设计|改进))/.test(normalized)) return "BUILD";
  if (view === "PROJECT" || view === "WORKSPACE" || view === "NODE_CANVAS" || view === "BOOK_LAYOUT_LAB") return "BUILD";
  return "EXPLORE";
}

export function candidateLearningEpisodes(
  message: string,
  view: AgentView,
  supportedEpisodes: readonly LearningEpisode[],
) {
  const primary = inferLearningEpisode(message, view);
  if (requestsFormalAuthority(message)) {
    return supportedEpisodes.includes("REFLECT") ? ["REFLECT"] as const : [];
  }
  const related: Record<LearningEpisode, readonly LearningEpisode[]> = {
    EXPLORE: ["UNDERSTAND", "BUILD"],
    UNDERSTAND: ["EXPLORE", "REFLECT"],
    BUILD: ["UNDERSTAND", "DEBUG"],
    DEBUG: [],
    TRANSFER: ["REFLECT", "BUILD"],
    REFLECT: ["UNDERSTAND", "TRANSFER"],
  };
  return [primary, ...related[primary]].filter(
    (episode, index, episodes): episode is LearningEpisode =>
      supportedEpisodes.includes(episode) && episodes.indexOf(episode) === index,
  );
}

export function detectCoursePackId(message: string, view: AgentView) {
  const normalized = message.normalize("NFKC");
  const bookMentioned = /(书籍|手工书|装帧|经折装|折页|版面|导览册|信息层级|阅读路径|网格|页序|新生手册)/.test(normalized);
  const digitalMentioned = /(touchdesigner|digishow|节点|声音|画面|粒子|交互|osc|信号)/i.test(normalized);
  const bookIsNegated = /(不谈|先不谈|不是|无关).{0,4}(书籍|版面|导览册)/.test(normalized);
  if (digitalMentioned && (!bookMentioned || bookIsNegated)) return "digital-interaction" as const;
  if (view === "BOOK_LAYOUT_LAB" || bookMentioned) {
    return "book-design" as const;
  }
  if (
    view === "NODE_CANVAS" || view === "CASE_LIBRARY" || view === "KNOWLEDGE_MAP" || view === "PROJECT"
    || digitalMentioned
  ) return "digital-interaction" as const;
  return null;
}

export function inferCoursePackId(message: string, view: AgentView) {
  const detected = detectCoursePackId(message, view);
  if (detected) return detected;
  return "digital-interaction" as const;
}

export function allowedActionTypes(episode: LearningEpisode): readonly AgentActionType[] {
  switch (episode) {
    case "EXPLORE": return ["START_DIAGNOSTIC", "OPEN_RESOURCE"];
    case "UNDERSTAND": return ["OPEN_RESOURCE", "OPEN_WORKSPACE"];
    case "BUILD": return ["OPEN_WORKSPACE", "REQUEST_EVIDENCE"];
    case "DEBUG": return ["START_TROUBLESHOOTING", "REQUEST_EVIDENCE", "ESCALATE_TEACHER"];
    case "TRANSFER": return ["START_TRANSFER", "OPEN_WORKSPACE"];
    case "REFLECT": return ["REQUEST_EVIDENCE", "ESCALATE_TEACHER"];
  }
}

export function allowedActionTypesForEpisodes(episodes: readonly LearningEpisode[]) {
  return Array.from(new Set(episodes.flatMap((episode) => allowedActionTypes(episode))));
}

export function deterministicDecisionCode(episode: LearningEpisode) {
  return DECISION_CODES_BY_EPISODE[episode][0];
}

export function suggestedActionForExplicitRequest(message: string, episode: LearningEpisode): AgentActionType | null {
  const normalized = message.normalize("NFKC");
  if (episode === "TRANSFER" && /(迁移|换成|改成|改给|改变|替换|新受众|社区居民)/.test(normalized)) {
    return "START_TRANSFER";
  }
  if (episode === "DEBUG" && /(证据|证明|记录|测试)/.test(normalized)) {
    return "REQUEST_EVIDENCE";
  }
  if (episode === "DEBUG" && /(排障|排查|故障|不动|没反应|无反应|收不到|异常|卡住|检查|哪里|顺序)/.test(normalized)) {
    return "START_TROUBLESHOOTING";
  }
  if (episode === "BUILD" && /(开始|搭建|建立|制作|连接|怎么做|具体步骤|下一步)/.test(normalized)) {
    return "OPEN_WORKSPACE";
  }
  return null;
}

export function actionForEpisode(pack: CoursePack, episode: LearningEpisode) {
  const isBook = pack.id === "book-design";
  const isDigital = pack.id === "digital-interaction";
  switch (episode) {
    case "EXPLORE":
      return { type: "START_DIAGNOSTIC" as const, label: "开始快速诊断", description: isBook ? "用三个选择判断你的信息层级起点。" : "用小实验判断你的交互思维起点。", target: isBook ? "BOOK_LAYOUT_LAB" as const : "PROJECT" as const, focus: "diagnostic" };
    case "UNDERSTAND":
      return { type: "OPEN_RESOURCE" as const, label: isBook ? "打开层级实验" : "打开知识地图", description: "在图形关系中观察概念如何连接。", target: isBook ? "BOOK_LAYOUT_LAB" as const : "KNOWLEDGE_MAP" as const, focus: isBook ? "hierarchy" : "concept" };
    case "BUILD":
      return { type: "OPEN_WORKSPACE" as const, label: isBook ? "进入8页编排台" : isDigital ? "进入节点画布" : "进入项目工作区", description: "在可操作的工作区中验证这一步，不直接改动正式评价。", target: isBook ? "BOOK_LAYOUT_LAB" as const : isDigital ? "NODE_CANVAS" as const : "PROJECT" as const, focus: "build" };
    case "DEBUG":
      return { type: "START_TROUBLESHOOTING" as const, label: "开始证据排障", description: "沿输入、处理与输出逐层确认可观察证据。", target: isBook ? "BOOK_LAYOUT_LAB" as const : "PROJECT" as const, focus: "troubleshoot" };
    case "TRANSFER":
      return { type: "START_TRANSFER" as const, label: isBook ? "切换为社区居民" : "开始迁移挑战", description: "保留核心结构，明确改变的受众、输入、映射或输出。", target: isBook ? "BOOK_LAYOUT_LAB" as const : "PROJECT" as const, focus: "transfer" };
    case "REFLECT":
      return { type: "REQUEST_EVIDENCE" as const, label: "整理学习证据", description: "说明你的判断、变化和仍不确定的地方。", target: isBook ? "BOOK_LAYOUT_LAB" as const : "PROJECT" as const, focus: "evidence" };
  }
}

export function actionForType(pack: CoursePack, episode: LearningEpisode, type: AgentActionType) {
  const fallback = actionForEpisode(pack, episode);
  if (fallback.type === type) return fallback;
  const isBook = pack.id === "book-design";
  const isDigital = pack.id === "digital-interaction";
  switch (type) {
    case "OPEN_WORKSPACE":
      return { type, label: isBook ? "打开编排实验" : isDigital ? "打开节点画布" : "打开项目工作区", description: "进入可操作工作区验证当前判断。", target: isBook ? "BOOK_LAYOUT_LAB" as const : isDigital ? "NODE_CANVAS" as const : "PROJECT" as const, focus: "build" };
    case "OPEN_RESOURCE":
      return { type, label: "查看相关课程资源", description: "打开与当前概念直接相关的课程资料。", target: isBook ? "BOOK_LAYOUT_LAB" as const : "KNOWLEDGE_MAP" as const, focus: "concept" };
    case "START_DIAGNOSTIC":
      return { type, label: "开始快速诊断", description: "用一个小任务确认当前理解起点。", target: isBook ? "BOOK_LAYOUT_LAB" as const : "PROJECT" as const, focus: "diagnostic" };
    case "REQUEST_EVIDENCE":
      return { type, label: "整理学习证据", description: "记录一条可观察结果，供你和教师复核判断。", target: isBook ? "BOOK_LAYOUT_LAB" as const : "PROJECT" as const, focus: "evidence" };
    case "START_TROUBLESHOOTING":
      return { type, label: "开始证据排障", description: "沿输入、处理、映射和输出逐层确认可观察证据。", target: isBook ? "BOOK_LAYOUT_LAB" as const : "PROJECT" as const, focus: "troubleshoot" };
    case "START_TRANSFER":
      return { type, label: "开始迁移挑战", description: "保留核心关系，改变一个输入、输出、受众或媒介。", target: isBook ? "BOOK_LAYOUT_LAB" as const : "PROJECT" as const, focus: "transfer" };
    case "ESCALATE_TEACHER":
      return { type, label: "请教师一起复核", description: "保留当前问题和证据，请教师确认下一步。", target: "PROJECT" as const, focus: "teacher-review" };
  }
}

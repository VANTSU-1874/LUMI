import type { LearningEpisode } from "@/lib/course-packs/contract";

import { technicalTokens } from "./model-grounding";

// Legacy V2 rollback only. V3 preserves the tutor's natural learner-facing prose.

type SourceLabel = { id: string; title: string };

const GROUNDED_LOCALIZATIONS = [
  { token: "listening", replacement: "监听", anchors: ["监听"] },
  { token: "observe", replacement: "观察", anchors: ["观察"] },
  { token: "upstream", replacement: "上游", anchors: ["上游"] },
  { token: "minimal", replacement: "最小", anchors: ["最小"] },
  { token: "check", replacement: "检查", anchors: ["检查", "核对", "确认"] },
  { token: "range", replacement: "范围映射", anchors: ["范围映射"] },
  { token: "scale", replacement: "范围映射", anchors: ["范围映射"] },
] as const;

const INTERNAL_FIELD_LOCALIZATIONS = [
  { token: "sourceids", replacement: "引用依据" },
  { token: "sourceid", replacement: "引用依据" },
  { token: "requiredaction", replacement: "当前必要步骤" },
  { token: "followupconstraint", replacement: "追问要求" },
  { token: "knowledge", replacement: "课程资料" },
  { token: "fact", replacement: "事实" },
  { token: "action", replacement: "行动" },
] as const;

const GENERAL_TECHNICAL_LOCALIZATIONS = [
  { token: "function", replacement: "功能" },
  { token: "operation", replacement: "运算" },
  { token: "multiply", replacement: "乘法" },
  { token: "add", replacement: "加法" },
  { token: "export", replacement: "导出" },
  { token: "reference", replacement: "引用" },
  { token: "bypass", replacement: "旁路" },
  { token: "display", replacement: "显示" },
  { token: "transfer", replacement: "迁移" },
  { token: "source", replacement: "输入源" },
  { token: "target", replacement: "目标" },
  { token: "type", replacement: "类型" },
  { token: "serial", replacement: "串行通信" },
  { token: "circle", replacement: "圆形" },
  { token: "transform", replacement: "变换" },
  { token: "radius", replacement: "半径" },
  { token: "uniform", replacement: "均匀" },
  { token: "convert", replacement: "转换" },
  { token: "fit", replacement: "适配" },
  { token: "translate", replacement: "转换" },
  { token: "map", replacement: "映射" },
  { token: "app", replacement: "应用" },
  { token: "execute", replacement: "执行" },
  { token: "constant", replacement: "常量" },
] as const;

type LearnerFacingDecision = {
  episode: LearningEpisode;
  responseStrategy?: string;
  sourceIds: string[];
  title: string;
  message: string;
  whyThisStep: string;
  uncertainty: string;
};

function replaceLiteral(value: string, search: string, replacement: string) {
  return search ? value.split(search).join(replacement) : value;
}

function removeDraftGraphLabels(value: string) {
  return value
    .replace(/(^|[^a-z0-9_])n\d{1,3}\.(?!\d)/gi, "$1")
    .replace(/(^|[^a-z0-9_])n\d{1,3}(?![a-z0-9_])/gi, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, "$1")
    .trim();
}

function replaceToken(value: string, token: string, replacement: string) {
  return value.replace(new RegExp(`\\b${token}\\b`, "gi"), replacement);
}

function localizeGroundedTerms(value: string, groundingText: string) {
  const groundedTokens = new Set(technicalTokens(groundingText));
  const technicalTermsLocalized = GENERAL_TECHNICAL_LOCALIZATIONS.reduce(
    (current, { token, replacement }) => groundedTokens.has(token)
      ? current
      : replaceToken(current, token, replacement),
    value,
  );
  const internalFieldsLocalized = INTERNAL_FIELD_LOCALIZATIONS.reduce(
    (current, { token, replacement }) => replaceToken(current, token, replacement),
    technicalTermsLocalized,
  );
  return GROUNDED_LOCALIZATIONS.reduce(
    (current, { token, replacement, anchors }) => anchors.some((anchor) => groundingText.includes(anchor))
      ? replaceToken(current, token, replacement)
      : current,
    internalFieldsLocalized,
  );
}

function normalizeGroundedInstanceNames(value: string, groundingText: string) {
  const grounded = new Set(technicalTokens(groundingText));
  return value.replace(/\b([a-z][a-z0-9._+-]*?)(\d+)\b/gi, (whole, base: string) => (
    grounded.has(base.toLowerCase()) ? base : whole
  ));
}

function learnerText(value: string, sources: readonly SourceLabel[], groundingText: string) {
  const replaced = [...sources]
    .sort((left, right) => right.id.length - left.id.length)
    .reduce((current, source) => replaceLiteral(current, source.id, source.title), value);
  return removeDraftGraphLabels(normalizeGroundedInstanceNames(
    localizeGroundedTerms(replaced, groundingText),
    groundingText,
  ));
}

function preserveLearnerRole(message: string, question: string) {
  const role = ["测试者", "读者", "受众", "新生", "社区居民"]
    .find((candidate) => question.includes(candidate) && !message.includes(candidate));
  return role ? `${message} 同时保留“${role}”的原始观察或反馈。` : message;
}

function ensureObservableReadingTest(
  message: string,
  episode: LearningEpisode,
  question: string,
  groundingText: string,
) {
  const asksAboutReadingRoute = /(下一页|阅读路径|阅读顺序|页序|看哪里|找不到|不知道.*看)/.test(question);
  const hasReadingTestGrounding = /(阅读测试|找信息任务|停顿页|指向错误|记录结果)/.test(groundingText);
  if (episode !== "DEBUG" || !asksAboutReadingRoute || !hasReadingTestGrounding) return message;
  if (/(阅读测试|观察)/.test(message)) return message;
  return `${message} 把这次过程作为阅读测试，重点观察停顿页和下一页指向错误。`;
}

export function normalizeLearnerFacingDecision<T extends LearnerFacingDecision>(
  decision: T,
  sources: readonly SourceLabel[],
  studentQuestion = "",
  groundingText = "",
): T {
  const title = learnerText(decision.title, sources, groundingText) || "学习建议";
  const normalizedMessage = learnerText(decision.message, sources, groundingText) || "请先说明当前可观察到的现象。";
  const framedMessage = decision.episode === "TRANSFER"
    && (!normalizedMessage.includes("保留") || !/(改变|替换|调整)/.test(normalizedMessage))
    ? `迁移时请明确区分“保留”和“改变/替换”。${normalizedMessage}`
    : normalizedMessage;
  const observableMessage = ensureObservableReadingTest(
    framedMessage,
    decision.episode,
    studentQuestion,
    groundingText,
  );
  const message = preserveLearnerRole(observableMessage, studentQuestion);
  const uncertainty = decision.responseStrategy !== "OUT_OF_SCOPE"
    && decision.sourceIds.length > 0 && decision.uncertainty.includes("无依据")
    ? "尚未看到学生的实际作品、现场参数或完整学习证据。"
    : learnerText(decision.uncertainty, sources, groundingText);
  return {
    ...decision,
    title,
    message,
    whyThisStep: learnerText(decision.whyThisStep, sources, groundingText) || "先形成可观察判断，再决定下一步。",
    uncertainty,
  };
}

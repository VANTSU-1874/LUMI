import { getCritiqueFramework } from "./critique-framework";

export type CritiqueRoute =
  | "STRUCTURED_CRITIQUE"
  | "EVIDENCE_TROUBLESHOOTING"
  | "NATURAL_TUTOR";

const SOFTWARE_TROUBLESHOOTING_PATTERNS = [
  /(?:报错|错误|error|exception|崩溃|闪退|打不开|卡死|没反应|不动|没有数据|无信号)/i,
  /(?:节点|node|参数|parameter|端口|osc|chop|top|dat|sop|touchdesigner|td\b|digishow)/i,
  /(?:怎么连|怎么接|怎么设置|哪里错|为什么不|如何排查|调试|debug)/i,
] as const;

const DESIGN_CRITIQUE_PATTERNS = [
  /(?:点评|会诊|评价|分析|看看|反馈|建议|修改|改进|优化)/i,
  /(?:构图|版式|层级|创意|表达|视觉|色彩|字体|形式|气质|文化|目标|方案|作品)/i,
  /(?:成立吗|合适吗|清楚吗|怎么样|哪里可以改|如何提升)/i,
] as const;

function looksLikeSoftwareTroubleshooting(message: string) {
  const matches = SOFTWARE_TROUBLESHOOTING_PATTERNS.filter((pattern) => pattern.test(message)).length;
  return matches >= 2 || SOFTWARE_TROUBLESHOOTING_PATTERNS[0].test(message)
    && SOFTWARE_TROUBLESHOOTING_PATTERNS[1].test(message);
}

function asksForDesignCritique(message: string) {
  return DESIGN_CRITIQUE_PATTERNS.some((pattern) => pattern.test(message));
}

export function routeCritiqueRequest(input: {
  courseId: string;
  message: string;
  hasArtwork: boolean;
  explicitCritique?: boolean;
}): CritiqueRoute {
  if (looksLikeSoftwareTroubleshooting(input.message)) return "EVIDENCE_TROUBLESHOOTING";
  if (
    input.hasArtwork
    && (input.explicitCritique || asksForDesignCritique(input.message))
    && getCritiqueFramework(input.courseId)
  ) return "STRUCTURED_CRITIQUE";
  return "NATURAL_TUTOR";
}


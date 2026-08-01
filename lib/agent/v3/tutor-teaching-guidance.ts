import type { CoursePack } from "@/lib/course-packs/contract";

type LearnerProfile = {
  level: string;
  dimensions: Record<string, number>;
} | null;

const LEVEL_GUIDANCE = {
  L1: {
    label: "起步理解",
    depth: "FOUNDATIONAL",
    responseGuidance: [
      "先用生活化语言说清关系，再紧跟准确专业名词，让学生边做边认识术语。",
      "优先给一个最小可运行例子、少量连续步骤和一个肉眼可见的成功标准。",
      "一次只展开当前最需要的因果链；可说明下一层方向，但不要用大量并列方案淹没学生。",
    ],
  },
  L2: {
    label: "关系搭建",
    depth: "GUIDED_APPLICATION",
    responseGuidance: [
      "把专业概念与当前作品中的输入、处理、输出或信息层级一一对应。",
      "给出可以独立完成的小任务，再邀请学生比较一次前后差异。",
      "在关键节点解释为什么这样做，逐步减少纯操作口令。",
    ],
  },
  L3: {
    label: "独立推演",
    depth: "INDEPENDENT_REASONING",
    responseGuidance: [
      "可直接使用专业术语，重点讲选择依据、权衡和证据，而不是重复基础定义。",
      "提供两个有意义的策略并说明适用条件，邀请学生作出有依据的选择。",
      "把下一步设计成可验证的假设、对照或排障动作，支持学生独立修订。",
    ],
  },
  L4: {
    label: "迁移与批判",
    depth: "ADVANCED_TRANSFER",
    responseGuidance: [
      "默认学生能跟上专业表达，把篇幅用于机制、边界条件、权衡取舍和替代路径。",
      "鼓励预测、反例、跨媒介迁移或评价标准比较，同时仍给出可立即执行的第一步。",
      "不要为了显得高级而堆术语；需要时快速补充基础解释，不把等级当成拒绝帮助的理由。",
    ],
  },
} as const;

type TeachingLevel = keyof typeof LEVEL_GUIDANCE;

function teachingLevel(value: string | undefined): TeachingLevel | null {
  return value && Object.hasOwn(LEVEL_GUIDANCE, value) ? value as TeachingLevel : null;
}

function capabilitySignals(profile: LearnerProfile, pack: CoursePack) {
  if (!profile) return { relativeStrength: null, growthFocus: null };
  const dimensions = pack.capabilityDimensions.flatMap((dimension) => {
    const score = profile.dimensions[dimension.id];
    return Number.isFinite(score) && score >= 1 && score <= 4
      ? [{ id: dimension.id, label: dimension.label, score }]
      : [];
  });
  if (dimensions.length === 0) return { relativeStrength: null, growthFocus: null };
  const relativeStrength = dimensions.reduce((best, item) => item.score > best.score ? item : best);
  const growthFocus = dimensions.reduce((weakest, item) => item.score < weakest.score ? item : weakest);
  if (relativeStrength.score === growthFocus.score) {
    return { relativeStrength: null, growthFocus: null };
  }
  return { relativeStrength, growthFocus };
}

export function buildTutorTeachingGuidance(profile: LearnerProfile, pack: CoursePack) {
  const level = teachingLevel(profile?.level);
  const strategy = level ? LEVEL_GUIDANCE[level] : {
    label: "尚未诊断",
    depth: "ADAPT_IN_CONVERSATION",
    responseGuidance: [
      "不要猜测或公开给学生贴能力标签；先用新手可进入、专业内容不缩水的方式回答。",
      "根据学生本轮使用的术语、已有尝试和追问逐步调节解释深度。",
      "即使信息不足，也先给一个安全、可执行的第一步，再询问真正影响后续判断的问题。",
    ],
  } as const;
  return {
    mode: "SOFT_ADAPTATION_NOT_GATE",
    diagnosedLevel: level,
    levelLabel: strategy.label,
    depth: strategy.depth,
    responseGuidance: strategy.responseGuidance,
    capabilitySignals: capabilitySignals(profile, pack),
    coursePedagogy: {
      conceptModel: {
        label: pack.conceptModel.label,
        fields: pack.conceptModel.fields.map(({ label, prompt }) => ({ label, prompt })),
      },
      transfer: pack.transferPolicy,
      usageBoundary: "只在能帮助当前问题时主动引导；它们不是回答、工具调用或开放对话的前置门禁。",
    },
    boundary: "诊断等级和维度只是可纠正的教学线索，不决定学生能问什么，也不允许减少实质答案。当前表达与当前作品证据优先。",
  };
}

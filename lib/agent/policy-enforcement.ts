import type { LearningEpisode } from "@/lib/course-packs/contract";

import type { AgentResponseStrategy } from "./contracts";
import type { AgentPolicy } from "./policy-contract";
import type { ProjectBriefPatch } from "./project-brief-memory";
import { DECISION_CODES_BY_EPISODE, allowedActionTypes, type AgentActionType } from "./router";

type PolicyDecision = {
  episode: LearningEpisode;
  decisionCode: string;
  responseStrategy: AgentResponseStrategy;
  sourceIds: string[];
  actionType: AgentActionType | null;
  title: string;
  message: string;
  whyThisStep: string;
  uncertainty: string;
  briefPatch?: ProjectBriefPatch;
};

export class AgentPolicyViolationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentPolicyViolationError";
  }
}

export function assessStudentRequest(message: string) {
  const normalized = message.normalize("NFKC");
  const requestsFormalAuthority = /(替我|直接|帮我).{0,16}(提交|评价|评分|通过|满分|改成优秀|修改阶段|确认合格)/.test(normalized)
    || /(自动|直接).{0,12}(过关|晋级|完成教师复核)/.test(normalized);
  return {
    requestsFormalAuthority,
    appliedRules: requestsFormalAuthority ? ["FORBID_FORMAL_AUTHORITY"] : [],
  };
}

export function claimsFormalAuthorityText(text: string) {
  const answer = text.normalize("NFKC");
  const formalSubject = "(?:你的作品|你的项目|你的作业|你的回答|该作品|这个作品|该项目|这个项目|该阶段|这个阶段|你)";
  const formalContext = "(?:课程|作业|阶段|评价|评审|审核|验收|教师|学校|门禁|答辩|考核|提交)";
  const formalPass = new RegExp(`${formalSubject}.{0,16}(?:已经|已)(?:过关|合格|晋级)`).test(answer)
    || new RegExp(`${formalSubject}.{0,16}(?:已经|已)通过了?(?=\\s*(?:$|[。！？；，,\\n]|${formalContext}))`).test(answer);
  const formalMutation = /(我|系统).{0,8}(已经|已).{0,12}(?:将|把)?(?:你的|该)?\s*(评价|评分|成绩|阶段|状态).{0,8}(改成|改为|设为|设置为|评为|调整为).{0,8}(优秀|良好|合格|不合格|通过|未通过|\d{1,3}\s*分)/.test(answer);
  return formalPass
    || formalMutation
    || /(我|系统).{0,8}(已经|已).{0,8}(替你)?(提交|评分|通过|改分|修改阶段)/.test(answer)
    || /(你的|你|该作品|这个作品|该项目).{0,12}(得分|评分|成绩).{0,6}(为|是|：|:)?\s*\d{1,3}\s*分?/.test(answer)
    || /(^|[。！？\n])(最终)?(得分|评分|成绩)\s*(为|是|：|:)?\s*\d{1,3}\s*分?/m.test(answer)
    || /(我|系统).{0,8}(判定|评定).{0,8}(优秀|良好|合格|不合格|通过)/.test(answer)
    || /(你的作品|你的项目|你的作业|该作品|这个作品|该项目).{0,12}(已经|已)?(?:被)?(?:教师|系统)?\s*(判定|评定|评为).{0,8}(优秀|良好|合格|不合格|通过)/.test(answer);
}

function claimsFormalAuthority(decision: PolicyDecision) {
  return claimsFormalAuthorityText(`${decision.title}\n${decision.message}`);
}

export function enforceModelDecisionPolicy(input: {
  policy: AgentPolicy;
  message: string;
  candidateEpisodes: readonly LearningEpisode[];
  validSourceIds: ReadonlySet<string>;
  decision: PolicyDecision;
}) {
  const appliedRules = new Set<string>([
    "BOUND_EXECUTION",
    "GROUND_COURSE_FACTS",
    "ALLOW_GENERAL_DESIGN",
    "MINIMUM_SUFFICIENT_SOURCES",
    "EPISODE_ACTION_ALLOWLIST",
    "STUDENT_CONFIRM_MUTATIONS",
  ]);
  let decision = input.decision;
  if (decision.responseStrategy === "OUT_OF_SCOPE") {
    throw new AgentPolicyViolationError("MODEL_REJECTS_DESIGN_QUESTION");
  }
  if (!input.candidateEpisodes.includes(decision.episode)) throw new AgentPolicyViolationError("MODEL_EPISODE_OUTSIDE_ALLOWLIST");
  if (!DECISION_CODES_BY_EPISODE[decision.episode].includes(decision.decisionCode)) {
    throw new AgentPolicyViolationError("MODEL_DECISION_OUTSIDE_ALLOWLIST");
  }
  if (decision.actionType && !allowedActionTypes(decision.episode).includes(decision.actionType)) {
    throw new AgentPolicyViolationError("MODEL_ACTION_OUTSIDE_EPISODE_ALLOWLIST");
  }
  if (claimsFormalAuthority(decision)) {
    throw new AgentPolicyViolationError("MODEL_CLAIMS_FORMAL_AUTHORITY");
  }
  if (decision.sourceIds.length > input.policy.budgets.maxSources) throw new AgentPolicyViolationError("MODEL_SOURCE_BUDGET_EXCEEDED");
  if (decision.sourceIds.some((id) => !input.validSourceIds.has(id))) {
    throw new AgentPolicyViolationError("MODEL_SOURCE_OUTSIDE_ALLOWLIST");
  }
  if (decision.sourceIds.length === 0 && !decision.uncertainty.includes("通用设计建议")) {
    const boundary = decision.uncertainty.replace(/^无依据[：:]?\s*/, "");
    decision = {
      ...decision,
      uncertainty: `通用设计建议：${boundary || "尚未看到学生的实际作品与完整使用情境。"}`.slice(0, 500),
    };
  }
  const request = assessStudentRequest(input.message);
  request.appliedRules.forEach((rule) => appliedRules.add(rule));
  if (request.requestsFormalAuthority && decision.actionType) decision = { ...decision, actionType: null };
  return { decision, appliedRules: [...appliedRules] };
}

export function createPolicyTrace(input: {
  policy: AgentPolicy;
  modelDecisions: number;
  modelRetries?: number;
  toolCalls: number;
  appliedRules: Iterable<string>;
}) {
  if (input.modelDecisions > input.policy.budgets.maxModelDecisions) throw new AgentPolicyViolationError("MODEL_DECISION_BUDGET_EXCEEDED");
  if ((input.modelRetries ?? 0) > input.policy.budgets.maxModelDecisions * 2) {
    throw new AgentPolicyViolationError("MODEL_RETRY_BUDGET_EXCEEDED");
  }
  if (input.toolCalls > input.policy.budgets.maxToolCalls) throw new AgentPolicyViolationError("TOOL_CALL_BUDGET_EXCEEDED");
  return {
    policyId: input.policy.id,
    policyVersion: input.policy.version,
    budgets: {
      modelDecisions: input.modelDecisions,
      maxModelDecisions: input.policy.budgets.maxModelDecisions,
      modelRetries: input.modelRetries ?? 0,
      toolCalls: input.toolCalls,
      maxToolCalls: input.policy.budgets.maxToolCalls,
      turnTimeoutMs: input.policy.budgets.turnTimeoutMs,
    },
    autonomy: input.policy.autonomy,
    appliedRules: [...new Set(input.appliedRules)],
  };
}

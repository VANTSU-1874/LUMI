import { AgentPolicySchema, type AgentPolicy } from "./policy-contract";

function deepFreeze<T extends object>(value: T): T {
  for (const key of Reflect.ownKeys(value)) {
    const nested = (value as Record<PropertyKey, unknown>)[key];
    if (nested !== null && typeof nested === "object" && !Object.isFrozen(nested)) {
      deepFreeze(nested as Record<PropertyKey, unknown>);
    }
  }
  return Object.freeze(value);
}

const competitionCorePolicyV1 = deepFreeze(AgentPolicySchema.parse({
  id: "competition-core",
  version: "1",
  label: "触映竞赛核心策略",
  budgets: {
    maxModelDecisions: 4,
    maxToolCalls: 6,
    turnTimeoutMs: 60_000,
    modelIdleTimeoutMs: 10_000,
    modelTimeoutMs: 30_000,
    actionTtlMs: 30 * 60_000,
    maxSources: 5,
    maxActions: 3,
    maxRecentTurns: 30,
  },
  autonomy: {
    readOnlyTools: "AUTOMATIC",
    studentMutations: "STUDENT_CONFIRMATION",
    formalAuthority: "FORBIDDEN",
  },
  rules: [
    { id: "BOUND_EXECUTION", description: "每回合严格限制模型决策、工具调用和总耗时。", effect: "ENFORCE" },
    { id: "REGISTERED_TOOLS_ONLY", description: "模型只能调用当前课程包已注册并允许的工具。", effect: "ENFORCE" },
    { id: "READ_ONLY_TOOLS_AUTOMATIC", description: "只有只读查询工具可以自动执行；写入、改状态和外呼必须等待学生确认。", effect: "ENFORCE" },
    { id: "PERSIST_EXECUTION_TRACE", description: "模型决策、工具调用、观察与最终回答形成可审查执行链。", effect: "ENFORCE" },
    { id: "GROUND_COURSE_FACTS", description: "课程、案例、软件现场与已验证事实必须来自对应真实依据。", effect: "ENFORCE" },
    { id: "ALLOW_GENERAL_DESIGN", description: "普通设计问题可使用模型通用设计知识，不以课程知识命中作为回答门禁。", effect: "ENFORCE" },
    { id: "GROUND_TOOL_OBSERVATIONS", description: "使用学生现场或工具观察时必须引用对应工具记录。", effect: "ENFORCE" },
    { id: "MINIMUM_SUFFICIENT_SOURCES", description: "只引用直接支撑回答的最小充分来源集合。", effect: "ENFORCE" },
    { id: "EPISODE_ACTION_ALLOWLIST", description: "情境、决策代码与行动必须同时通过白名单。", effect: "ENFORCE" },
    { id: "STUDENT_CONFIRM_MUTATIONS", description: "写入项目、改变软件状态或调用外部服务必须由学生确认。", effect: "ENFORCE" },
    { id: "FORBID_FORMAL_AUTHORITY", description: "模型不得提交正式成果、评分、通过门禁或替代教师复核。", effect: "ENFORCE" },
    { id: "DISCLOSE_NO_EVIDENCE", description: "旧回合兼容规则：具体资料事实不足时不得伪造来源。", effect: "ENFORCE" },
    { id: "NORMALIZE_OUT_OF_SCOPE", description: "明确非设计或危险请求可转为安全说明，不影响一般设计回答。", effect: "NORMALIZE" },
    { id: "ESCALATE_UNRESOLVED", description: "证据不足、连续失败或需要正式判断时转交教师。", effect: "ESCALATE" },
  ],
}));

const competitionCorePolicyV2 = deepFreeze(AgentPolicySchema.parse({
  ...competitionCorePolicyV1,
  version: "2",
  budgets: {
    ...competitionCorePolicyV1.budgets,
    modelIdleTimeoutMs: 30_000,
    modelTimeoutMs: 50_000,
  },
  rules: competitionCorePolicyV1.rules.map((rule) => {
    if (rule.id === "MINIMUM_SUFFICIENT_SOURCES") {
      return {
        ...rule,
        description: "来源数量只作可解释性建议与遥测；缺少来源或数量不同不得阻断学生正文。",
        effect: "NORMALIZE" as const,
      };
    }
    if (rule.id === "EPISODE_ACTION_ALLOWLIST") {
      return {
        ...rule,
        description: "情境、决策代码与行动仅作可选分析元数据；缺失或不在旧白名单时不得拒绝正文。",
        effect: "NORMALIZE" as const,
      };
    }
    return rule;
  }),
}));

const competitionCorePolicyV3 = deepFreeze(AgentPolicySchema.parse({
  ...competitionCorePolicyV2,
  version: "3",
  budgets: {
    ...competitionCorePolicyV2.budgets,
    modelIdleTimeoutMs: 45_000,
    modelTimeoutMs: 120_000,
    turnTimeoutMs: 180_000,
  },
}));

const competitionCorePolicyV4 = deepFreeze(AgentPolicySchema.parse({
  ...competitionCorePolicyV3,
  version: "4",
  budgets: {
    ...competitionCorePolicyV3.budgets,
    modelIdleTimeoutMs: 75_000,
    modelTimeoutMs: 600_000,
    turnTimeoutMs: 900_000,
  },
}));

const registry = new Map<string, AgentPolicy>([
  competitionCorePolicyV1,
  competitionCorePolicyV2,
  competitionCorePolicyV3,
  competitionCorePolicyV4,
].map((policy) => [`${policy.id}@${policy.version}`, policy]));

export function getAgentPolicy(id: string, version: string) {
  const policy = registry.get(`${id}@${version}`);
  if (!policy) throw new Error(`unknown agent policy: ${id}@${version}`);
  return policy;
}

export function getActiveAgentPolicy() {
  return getAgentPolicy("competition-core", "4");
}

export function resolveAgentPolicyTimeouts(
  policy: AgentPolicy,
  timeouts: {
    modelIdleTimeoutMs: number;
    modelTotalTimeoutMs: number;
    turnTotalTimeoutMs: number;
  },
) {
  return deepFreeze(AgentPolicySchema.parse({
    ...policy,
    budgets: {
      ...policy.budgets,
      modelIdleTimeoutMs: timeouts.modelIdleTimeoutMs,
      modelTimeoutMs: timeouts.modelTotalTimeoutMs,
      turnTimeoutMs: timeouts.turnTotalTimeoutMs,
    },
  }));
}

export function listAgentPolicies() {
  return Object.freeze([...registry.values()]);
}

import { ModelServiceError, type ModelUsage } from "@/lib/ai/client";
import type { SessionPayload } from "@/lib/auth/session";
import type { CoursePack, LearningEpisode } from "@/lib/course-packs/contract";
import type { DatabaseConnection } from "@/lib/db/client";
import type { KnowledgeItem, RankedKnowledgeItem } from "@/lib/knowledge/retrieve";

import type { RecentConversationTurn } from "./conversation-context";
import { capabilityActionLabel } from "./capability-registry";
import type { AgentExecutionTrace } from "./execution-trace";
import { decideAgentTurn, type AgentModelAnswerDecision } from "./model-decision";
import { knowledgeEnhancementsForQuestion, selectKnowledge, type AgentOptions, type StudentContext } from "./orchestrator-context";
import { AgentPolicyViolationError } from "./policy-enforcement";
import type { AgentPolicy } from "./policy-contract";
import type { AgentToolDescriptor, AgentToolExecution } from "./tool-contract";
import { AgentToolRejectedError, executeRegisteredAgentTool, type AgentToolExecutor } from "./tool-executor";
import type { ModelProviderAdapter } from "./model-provider-adapter";
import type { PreparedAgentArtwork } from "./artwork-attachment";

type Knowledge = Array<KnowledgeItem | RankedKnowledgeItem>;

function mergeKnowledge(current: Knowledge, added: Knowledge) {
  const byId = new Map(current.map((item) => [item.id, item]));
  added.forEach((item) => byId.set(item.id, item));
  return [...byId.values()];
}

function safeFailureSummary(error: unknown) {
  if (error instanceof ModelServiceError) {
    return error.code === "RATE_LIMIT" ? "模型服务限流，本回合转入确定性降级。"
      : error.code === "TIMEOUT" ? "模型响应超时，本回合转入确定性降级。"
        : "模型服务暂不可用，本回合转入确定性降级。";
  }
  return "模型输出或工具选择未通过服务端规则校验。";
}

function publicErrorCode(error: unknown) {
  if (error instanceof ModelServiceError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_:-]{2,79}$/.test(error.message)) return error.message;
  return "VALIDATION_FAILED";
}

function publicUsage(usage: ModelUsage | null) {
  return usage ? { status: "RECORDED" as const, ...usage } : {
    status: "UNAVAILABLE" as const,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  };
}

function validationFeedback(error: unknown) {
  const code = error instanceof Error ? error.message.slice(0, 160) : "INVALID_MODEL_STEP";
  if (code.startsWith("MODEL_UNGROUNDED_TECHNICAL_TERM:")) {
    return `上一次回答含无依据英文词：${code.slice("MODEL_UNGROUNDED_TECHNICAL_TERM:".length)}。请重写完整ANSWER，严格只使用allowed.technicalVocabulary.allowed中的拉丁技术词；其他概念改用自然中文。删除n1/n2等草稿编号，只改写knowledge中的事实与行动。sourceIds、knowledge、fact/action ID等内部字段只能放在JSON字段中。`;
  }
  if (code === "MODEL_DECISION_OUTSIDE_ALLOWLIST") {
    return "上一次episode或decisionCode不在允许范围。请从allowed.episodes选择episode，并使用该episode对应的decisionCode和actionTypesByEpisode。";
  }
  if (code.startsWith("MODEL_DEBUG_SOURCE_TOO_GENERIC:")) {
    return `上一次DEBUG回答引用了只提供通用原则的来源：${code.slice("MODEL_DEBUG_SOURCE_TOO_GENERIC:".length)}。请从sourceIds删除这些来源，并删除仅由它们支持的句子；只保留直接支撑当前故障、观察或排查动作的来源。`;
  }
  if (code.startsWith("MODEL_WRONG_SEQUENCE_STEP:")) {
    const [, step, ...action] = code.split(":");
    return `上一次没有回答学生追问的第${step}步。请重写完整ANSWER，并把课程已登记的这一步作为核心回答：“${action.join(":")}”。`;
  }
  if (code === "MODEL_TOO_MANY_QUESTIONS") {
    return "上一次回答追问了多个问题。请保留专业建议与选项，但只留下一个最能改变下一步的问句。";
  }
  if (code === "MODEL_REJECTS_DESIGN_QUESTION") {
    return "上一次把设计问题判成超出范围。请正常给出专业回答；课程资料未覆盖的部分使用模型通用设计知识，sourceIds留空，并在uncertainty标注‘通用设计建议’。";
  }
  if (code.startsWith("MODEL_TURN_REQUIREMENT_MISSING:")) {
    return `上一次缺少本轮必要内容：${code.slice("MODEL_TURN_REQUIREMENT_MISSING:".length)}。请在保留现有有效内容的基础上补齐这些要素，仍然最多只问一个关键问题。`;
  }
  return `上一次输出未通过服务端校验：${code}。请只选择允许的工具，或删除无依据内容后输出完整ANSWER。`;
}

export async function runModelToolLoop(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  message: string;
  view: string;
  focus: string | null;
  pack: CoursePack;
  context: StudentContext;
  candidateEpisodes: readonly LearningEpisode[];
  initialKnowledge: Knowledge;
  recentTurns: readonly RecentConversationTurn[];
  policy: AgentPolicy;
  signal?: AbortSignal;
  client: ModelProviderAdapter;
  artwork?: PreparedAgentArtwork;
  availableTools: readonly AgentToolDescriptor[];
  turnDeadline: number;
  trace: AgentExecutionTrace;
  onModelError?: AgentOptions["onModelError"];
  toolExecutor?: AgentToolExecutor;
}) {
  let knowledge = input.initialKnowledge;
  const toolExecutions: AgentToolExecution[] = [];
  const seenFingerprints = new Set<string>();
  let answer: AgentModelAnswerDecision | null = null;
  let modelDecisions = 0;
  let validationFailures = 0;
  let retryFeedback: string | null = null;
  const appliedPolicyRules = new Set<string>();

  while (modelDecisions < input.policy.budgets.maxModelDecisions && answer === null) {
    input.signal?.throwIfAborted();
    const remainingMs = Math.floor(input.turnDeadline - performance.now());
    if (remainingMs <= 0) break;
    modelDecisions += 1;
    const decisionStarted = performance.now();
    let decisionRecorded = false;
    let selectedToolId: string | null = null;
    let decisionUsage: ModelUsage | null = null;
    const modelTimeoutMs = Math.min(input.policy.budgets.modelTimeoutMs, remainingMs);
    const modelDeadlineSignal = AbortSignal.timeout(modelTimeoutMs);
    const decisionSignal = input.signal
      ? AbortSignal.any([input.signal, modelDeadlineSignal])
      : modelDeadlineSignal;
    try {
      const step = await decideAgentTurn({
        client: input.client,
        message: input.message,
        view: input.view,
        focus: input.focus,
        pack: input.pack,
        candidateEpisodes: input.candidateEpisodes,
        knowledge,
        context: input.context,
        recentTurns: input.recentTurns,
        policy: input.policy,
        availableTools: input.availableTools,
        toolExecutions,
        artwork: input.artwork,
        retryFeedback,
        signal: decisionSignal,
        totalTimeoutMs: modelTimeoutMs,
        onUsage: (usage) => { decisionUsage = usage; },
      });
      step.appliedPolicyRules.forEach((rule) => appliedPolicyRules.add(rule));
      if (step.kind === "ANSWER") {
        input.trace.add({
          kind: "MODEL_DECISION", status: "SUCCEEDED", label: "形成学习建议",
          summary: `模型选择 ${step.decision.episode} 情境，并由服务端完成规则校验。`,
          toolCallId: null, toolId: null,
          latencyMs: Math.round(performance.now() - decisionStarted),
        }, {
          modelProvider: input.client.provider,
          modelId: input.client.modelId ?? null,
          usage: publicUsage(decisionUsage),
        });
        answer = step.decision;
        break;
      }

      selectedToolId = step.call.toolId;
      input.trace.add({
        kind: "MODEL_DECISION", status: "SUCCEEDED", label: "决定读取学习现场",
        summary: `Agent 请求“${capabilityActionLabel(step.call.toolId, input.availableTools.find(({ id }) => id === step.call.toolId)?.label ?? "读取状态")}”。`,
        toolCallId: null, toolId: step.call.toolId,
        latencyMs: Math.round(performance.now() - decisionStarted),
      }, {
        modelProvider: input.client.provider,
        modelId: input.client.modelId ?? null,
        usage: publicUsage(decisionUsage),
      });
      decisionRecorded = true;
      if (modelDecisions >= input.policy.budgets.maxModelDecisions) {
        input.trace.add({
          kind: "TOOL_CALL", status: "SKIPPED", label: "保留最终回答预算",
          summary: "已到模型决策上限，未执行新的工具读取。", toolCallId: null,
          toolId: step.call.toolId, latencyMs: 0,
        });
        break;
      }
      if (toolExecutions.length >= input.policy.budgets.maxToolCalls) {
        throw new AgentToolRejectedError("TOOL_CALL_BUDGET_EXCEEDED");
      }
      const callStarted = performance.now();
      const execution = await (input.toolExecutor ?? executeRegisteredAgentTool)({
        call: step.call,
        context: {
          connection: input.connection,
          actor: input.actor,
          pack: input.pack,
          student: input.context,
          question: input.message,
          signal: input.signal
            ? AbortSignal.any([input.signal, AbortSignal.timeout(Math.max(1, Math.floor(input.turnDeadline - performance.now())))])
            : AbortSignal.timeout(Math.max(1, Math.floor(input.turnDeadline - performance.now()))),
        },
        policy: input.policy,
        seenFingerprints,
      });
      toolExecutions.push(execution);
      appliedPolicyRules.add("REGISTERED_TOOLS_ONLY");
      appliedPolicyRules.add("READ_ONLY_TOOLS_AUTOMATIC");
      input.trace.add({
        kind: "TOOL_CALL", status: "SUCCEEDED", label: "执行只读工具",
        summary: `已完成“${capabilityActionLabel(execution.observation.toolId, input.availableTools.find(({ id }) => id === execution.observation.toolId)?.label ?? "读取状态")}”，未修改学生项目或评价状态。`,
        toolCallId: execution.observation.callId, toolId: execution.observation.toolId,
        latencyMs: Math.round(performance.now() - callStarted),
      });
      input.trace.add({
        kind: "TOOL_OBSERVATION",
        status: execution.observation.status === "ERROR" ? "FAILED"
          : execution.observation.status === "EMPTY" ? "EMPTY" : "SUCCEEDED",
        label: execution.observation.status === "ERROR" ? "读取失败" : "获得可核对观察",
        summary: execution.observation.summary,
        toolCallId: execution.observation.callId, toolId: execution.observation.toolId,
        latencyMs: execution.observation.latencyMs,
      }, {
        errorCode: execution.observation.errorCode,
      });
      if (execution.call.toolId === "knowledge-map.search-concepts") {
        const query = execution.call.arguments.query;
        if (typeof query === "string") {
          knowledge = mergeKnowledge(knowledge, selectKnowledge(
            input.connection, input.pack.id, input.pack.version, query,
          ));
          knowledge = knowledgeEnhancementsForQuestion(input.message, knowledge);
        }
      }
      retryFeedback = null;
    } catch (rawError) {
      if (input.signal?.aborted) throw input.signal.reason;
      const error = modelDeadlineSignal.aborted
        && modelDeadlineSignal.reason?.name === "TimeoutError"
        ? new ModelServiceError("TIMEOUT")
        : rawError;
      if (!decisionRecorded) {
        input.trace.add({
          kind: "MODEL_DECISION", status: "FAILED", label: "模型步骤未通过校验",
          summary: safeFailureSummary(error), toolCallId: null, toolId: null,
          latencyMs: Math.round(performance.now() - decisionStarted),
        }, {
          errorCode: publicErrorCode(error),
          modelProvider: input.client.provider,
          modelId: input.client.modelId ?? null,
          usage: publicUsage(decisionUsage),
        });
      } else if (selectedToolId) {
        input.trace.add({
          kind: "TOOL_CALL", status: "FAILED", label: "工具选择被规则拒绝",
          summary: "工具参数、重复调用或课程包权限未通过服务端校验。",
          toolCallId: null, toolId: selectedToolId,
          latencyMs: Math.round(performance.now() - decisionStarted),
        }, { errorCode: publicErrorCode(error) });
      }
      if (error instanceof AgentPolicyViolationError && error.code === "MODEL_CLAIMS_FORMAL_AUTHORITY") {
        appliedPolicyRules.add("FORBID_FORMAL_AUTHORITY");
      }
      input.onModelError?.(error, modelDecisions);
      if (error instanceof ModelServiceError) break;
      validationFailures += 1;
      if (validationFailures >= 3) break;
      retryFeedback = validationFeedback(error);
    }
  }
  return { answer, knowledge, toolExecutions, modelDecisions, appliedPolicyRules };
}

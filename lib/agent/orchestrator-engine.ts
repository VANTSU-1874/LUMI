import { getCoursePack } from "@/lib/course-packs/registry";
import {
  getAgentEvidenceSearchPortV2,
} from "@/lib/knowledge/agent-evidence-runtime-v2";
import {
  prepareAgentEvidenceRuntimeV2,
} from "@/lib/knowledge/knowledge-v2-enablement";

import {
  AgentTurnResponseSchema,
  type AgentResponseStrategy,
  type AgentTurnResponse,
} from "./contracts";
import { finalizeAgentResponse } from "./agent-response-finalization";
import { readConversationSessionTurns } from "./conversation-session";
import { buildDeterministicResponse, buildKnowledgeQuery } from "./deterministic-response";
import { createExecutionTrace } from "./execution-trace";
import { runModelToolLoop } from "./model-tool-loop";
import {
  buildModelClient,
  knowledgeEnhancementsForQuestion,
  interventionAwareQuestion,
  readStudentContext,
  retrievalMessage,
  selectKnowledge,
  type AgentOptions,
} from "./orchestrator-context";
import { AgentConflictError } from "./orchestrator-errors";
import { assessStudentRequest } from "./policy-enforcement";
import { getAgentPolicy } from "./policy-registry";
import {
  actionForEpisode,
  allowedActionTypes,
  candidateLearningEpisodes,
  deterministicDecisionCode,
  suggestedActionForExplicitRequest,
  type AgentActionType,
} from "./router";
import type { AgentToolExecution } from "./tool-contract";
import { selectAgentToolsForTurn } from "./tool-registry";
import { toolSourceId } from "./tool-sources";
import type { VerifiedEvidenceFact } from "./verified-evidence-facts";
import { routeDesignSpecialty } from "./specialty-router";
import { enrichProjectBriefPatch } from "./project-brief-extractor";
import { limitLearnerQuestionsAcross } from "./model-turn-requirements";
import { applyArtworkBoundary, artworkModelCapability, decisionUsedArtwork } from "./artwork-turn-support";
import { persistAgentTurnWithArtwork } from "./artwork-turn-persistence";
import type { AgentRuntimeRequest } from "./runtime/agent-runtime-port";
import type { TraceSink } from "./runtime/trace-sink";

function assertRunNotCancelled(options: AgentOptions) {
  options.signal?.throwIfAborted();
  if (options.cancellationRequested?.()) {
    throw new DOMException("Agent run cancelled", "AbortError");
  }
}

export async function runCurrentAgentRuntimeTurn(
  request: AgentRuntimeRequest,
  runtime: { traceSink: TraceSink },
): Promise<AgentTurnResponse> {
  const { connection, actor, input, artwork } = request;
  const options: AgentOptions = request.options ?? {};
  assertRunNotCancelled(options);
  if (options.toolExecutor && process.env.NODE_ENV !== "test") {
    throw new Error("TEST_TOOL_EXECUTOR_FORBIDDEN");
  }
  const responseStarted = performance.now();
  const policy = options.policy ?? getAgentPolicy("competition-core", "1");
  const trace = createExecutionTrace(runtime.traceSink);
  const turnDeadline = responseStarted + policy.budgets.turnTimeoutMs;
  const requestAssessment = assessStudentRequest(input.message);
  runtime.traceSink.emit({
    kind: "POLICY_CHECK",
    status: "SUCCEEDED",
    label: "检查请求权限边界",
    summary: requestAssessment.requestsFormalAuthority
      ? "已识别正式评价或提交请求，后续只保留解释与建议。"
      : "请求可进入设计学习对话；写入动作仍需学生确认。",
    policyRule: requestAssessment.requestsFormalAuthority
      ? "FORBID_FORMAL_AUTHORITY"
      : "STUDENT_CONFIRM_MUTATIONS",
    latencyMs: Math.round(performance.now() - responseStarted),
  });
  const appliedPolicyRules = new Set<string>([
    "BOUND_EXECUTION",
    "GROUND_COURSE_FACTS",
    "ALLOW_GENERAL_DESIGN",
    "STUDENT_CONFIRM_MUTATIONS",
    "REGISTERED_TOOLS_ONLY",
    "PERSIST_EXECUTION_TRACE",
    ...requestAssessment.appliedRules,
  ]);
  const generalContext = readStudentContext(connection, actor, "general-design", input.message, input.taskId);
  const recentTurns = readConversationSessionTurns(connection, {
    studentId: generalContext.studentId,
    classId: generalContext.classId,
    taskId: generalContext.taskId,
    limit: policy.budgets.maxRecentTurns,
  });
  const specialty = routeDesignSpecialty(
    input.message,
    input.context.view,
    recentTurns.at(-1)?.coursePackId,
    generalContext.onboarding.major,
  );
  const context = specialty.coursePackId === "general-design"
    ? generalContext
    : readStudentContext(connection, actor, specialty.coursePackId, input.message, generalContext.taskId);
  assertRunNotCancelled(options);
  const pack = getCoursePack(specialty.coursePackId, context.project?.coursePackVersion ?? specialty.coursePackVersion);
  runtime.traceSink.emit({
    kind: "CONTEXT_PREPARATION",
    status: "SUCCEEDED",
    label: "恢复项目与对话上下文",
    summary: `已恢复当前设计任务、项目简报和最近 ${recentTurns.length} 个回合。`,
    latencyMs: Math.round(performance.now() - responseStarted),
  });
  const contextualMessage = retrievalMessage(input.message, recentTurns);
  const interventionQuestion = interventionAwareQuestion(
    contextualMessage,
    options.interventionContext,
  );
  const candidateEpisodes = candidateLearningEpisodes(interventionQuestion, input.context.view, pack.supportedEpisodes);
  if (candidateEpisodes.length === 0) throw new AgentConflictError("当前课程包不支持这个学习情境");
  let episode = candidateEpisodes[0];
  const knowledgeQuery = buildKnowledgeQuery(interventionQuestion, episode, input.context.focus);
  let knowledge = knowledgeEnhancementsForQuestion(
    input.message,
    selectKnowledge(connection, pack.id, pack.version, knowledgeQuery),
  );
  runtime.traceSink.emit({
    kind: "RETRIEVAL",
    status: knowledge.length > 0 ? "SUCCEEDED" : "EMPTY",
    label: knowledge.length > 0 ? "检索可用专业依据" : "未命中专门课程依据",
    summary: knowledge.length > 0
      ? `已选出 ${knowledge.length} 条可核对的课程知识或案例候选。`
      : "未命中专门课程资料，本回合继续使用通用设计知识回答。",
    sourceIds: knowledge.slice(0, 8).map(({ id }) => id),
    latencyMs: Math.round(performance.now() - responseStarted),
  });
  let fallbackKnowledge = episode === "EXPLORE" ? knowledge.slice(0, 1) : knowledge;
  const modelKnowledge = fallbackKnowledge;
  let actionType: AgentActionType | null = fallbackKnowledge.length > 0 ? actionForEpisode(pack, episode).type : null;
  if (fallbackKnowledge.length === 0) appliedPolicyRules.add("ALLOW_GENERAL_DESIGN");
  const client = buildModelClient(options, policy);
  const { canObserve: canObserveArtwork, shouldRunModel } = artworkModelCapability(client, artwork);
  let artworkObserved = false;
  if (artwork && !canObserveArtwork) appliedPolicyRules.add("DEGRADE_UNAVAILABLE_VISION");
  let modelDecisions = 0;
  let aiMode: AgentTurnResponse["aiMode"] = "DETERMINISTIC_FALLBACK";
  let decisionCode = deterministicDecisionCode(episode);
  let responseStrategy: AgentResponseStrategy = episode === "UNDERSTAND" ? "CONCEPT_EXPLANATION"
    : episode === "BUILD" ? "DIRECT_INSTRUCTION"
      : episode === "DEBUG" ? "DIAGNOSTIC_GUIDANCE"
        : episode === "TRANSFER" ? "TRANSFER_COACHING"
          : episode === "REFLECT" ? "REFLECTION_PROMPT"
            : "CLARIFY";
  let fallback = buildDeterministicResponse({ packLabel: pack.label, episode, message: interventionQuestion, knowledge: fallbackKnowledge });
  let briefPatch = fallback.briefPatch;
  let text: { title: string; message: string; whyThisStep: string; uncertainty: string } = {
    title: fallback.title,
    message: fallback.message,
    whyThisStep: fallback.whyThisStep,
    uncertainty: fallback.uncertainty,
  };
  let selectedKnowledge = fallbackKnowledge.filter(({ id }) => fallback.sourceIds.includes(id));
  let selectedEvidenceFacts: VerifiedEvidenceFact[] = [];
  let selectedToolExecutions: AgentToolExecution[] = [];
  let toolExecutions: AgentToolExecution[] = [];
  if (client && shouldRunModel) {
    const evidenceRuntime =
      await prepareAgentEvidenceRuntimeV2(
        options,
        () => getAgentEvidenceSearchPortV2({
          connection,
          visualRetrievalEnabled:
            options.visualRetrievalEnabled
              ?? false,
        }),
      );
    const evidenceSearchV2 =
      evidenceRuntime.port ?? undefined;
    const availableTools = selectAgentToolsForTurn({
      pack,
      specialty: specialty.specialty,
      episode,
      view: input.context.view,
      message: contextualMessage,
      capabilityId: input.capability?.id,
      knowledgeObjectV2Enabled:
        Boolean(evidenceSearchV2),
    }).map(({ descriptor }) => descriptor);
    const loop = await runModelToolLoop({
      connection, actor, message: input.message, view: input.context.view,
      focus: input.context.focus ?? null, pack, context, candidateEpisodes,
      initialKnowledge: modelKnowledge, recentTurns, policy, client, availableTools,
      interventionContext: options.interventionContext,
      signal: options.signal,
      artwork: canObserveArtwork ? artwork : undefined,
      turnDeadline, trace, onModelError: options.onModelError, toolExecutor: options.toolExecutor,
      evidenceSearchV2,
    });
    modelDecisions = loop.modelDecisions;
    knowledge = loop.knowledge;
    toolExecutions = loop.toolExecutions;
    loop.appliedPolicyRules.forEach((rule) => appliedPolicyRules.add(rule));
    const decision = loop.answer;
    const decisionSourceIds = new Set(decision?.sourceIds ?? []);
    artworkObserved = decisionUsedArtwork(artwork, canObserveArtwork, decisionSourceIds);
    if (decision && (!artwork || artworkObserved)) {
      if (artworkObserved) appliedPolicyRules.add("GROUND_ARTWORK_OBSERVATION");
      aiMode = "MODEL_ASSISTED";
      episode = decision.episode;
      decisionCode = decision.decisionCode;
      responseStrategy = decision.responseStrategy;
      actionType = decision.actionType;
      briefPatch = decision.briefPatch ?? {};
      const sourceIds = decisionSourceIds;
      selectedKnowledge = knowledge.filter(({ id }) => sourceIds.has(id));
      selectedEvidenceFacts = context.verifiedEvidenceFacts.filter(({ sourceId }) => sourceIds.has(sourceId));
      selectedToolExecutions = toolExecutions.filter(({ observation }) => sourceIds.has(toolSourceId(observation.callId)));
      text = {
        title: decision.title, message: decision.message,
        whyThisStep: decision.whyThisStep, uncertainty: decision.uncertainty,
      };
    } else {
      selectedKnowledge = knowledge.slice(0, 1);
      const latestObservation = [...toolExecutions].reverse().find(({ observation }) => observation.status !== "ERROR");
      if (latestObservation) {
        selectedKnowledge = [];
        selectedToolExecutions = [latestObservation];
        text = {
          title: "已读取你的学习现场",
          message: [latestObservation.observation.summary, ...latestObservation.observation.facts.slice(0, 2)].join(" "),
          whyThisStep: "模型未能形成合规回答时，智能体只呈现已由只读工具核对的事实，不补写未经验证的操作。",
          uncertainty: "当前只完成了状态读取；原因判断、正式评价和下一步修改仍需结合课程依据或教师复核。",
        };
      } else {
        fallbackKnowledge = episode === "EXPLORE" ? knowledge.slice(0, 1) : knowledge;
        fallback = buildDeterministicResponse({ packLabel: pack.label, episode, message: interventionQuestion, knowledge: fallbackKnowledge });
        briefPatch = fallback.briefPatch;
        text = {
          title: fallback.title,
          message: fallback.message,
          whyThisStep: fallback.whyThisStep,
          uncertainty: fallback.uncertainty,
        };
        selectedKnowledge = fallbackKnowledge.filter(({ id }) => fallback.sourceIds.includes(id));
      }
    }
  }
  if (!shouldRunModel && context.verifiedEvidenceFacts.length > 0 && (episode === "DEBUG" || input.context.view === "EVIDENCE")) {
    const fact = context.verifiedEvidenceFacts[0];
    selectedEvidenceFacts = [fact];
    text = {
      title: "先从已验证事实继续",
      message: `当前可确认的是：${fact.statement} 下一步只检查与这一事实相邻、但还没有验证的环节。`,
      whyThisStep: "先使用规则或教师已经确认的学习事实，可以避免把证据标签误当成作品内容。",
      uncertainty: fact.boundary ?? "这条事实只证明已记录的观察，不代表整个作品已经通过评价。",
    };
  }
  briefPatch = enrichProjectBriefPatch(input.message, briefPatch, context.projectBrief);
  if (requestAssessment.requestsFormalAuthority) {
    actionType = null;
    briefPatch = {};
    appliedPolicyRules.add("FORBID_FORMAL_AUTHORITY");
    if (aiMode === "DETERMINISTIC_FALLBACK" || !/(不能|不会|需要你|需要教师|由教师)/.test(text.message)) {
      text = {
        title: "正式判断必须由你和教师完成",
        message: `我不能替你提交正式成果、评分或通过阶段门禁。${text.message}`,
        whyThisStep: "智能体可以解释、排障和提出验证行动，但正式评价必须保留学生选择与教师复核。",
        uncertainty: text.uncertainty,
      };
    }
  }
  if (artwork) {
    if (!artworkObserved) appliedPolicyRules.add("DEGRADE_UNAVAILABLE_VISION");
    text = applyArtworkBoundary(text, artworkObserved);
  }
  const explicitlyRequestsEvidence = input.context.view === "EVIDENCE"
    && /(证明|验证|证据|观察|记录|测试)/.test(input.message);
  if (explicitlyRequestsEvidence && knowledge.length > 0 && responseStrategy !== "OUT_OF_SCOPE") {
    if (!allowedActionTypes(episode).includes("REQUEST_EVIDENCE") && candidateEpisodes.includes("REFLECT")) {
      episode = "REFLECT";
      decisionCode = "REFLECT_EXPLAIN_EVIDENCE";
    }
    if (allowedActionTypes(episode).includes("REQUEST_EVIDENCE")) actionType = "REQUEST_EVIDENCE";
  }
  const explicitSuggestedAction = suggestedActionForExplicitRequest(input.message, episode);
  if (
    !actionType && explicitSuggestedAction && responseStrategy !== "OUT_OF_SCOPE"
    && (selectedKnowledge.length > 0 || selectedToolExecutions.length > 0)
  ) {
    actionType = explicitSuggestedAction;
    appliedPolicyRules.add(
      explicitSuggestedAction === "START_TRANSFER" ? "SUGGEST_EXPLICIT_TRANSFER" : "SUGGEST_EXPLICIT_ACTION",
    );
  }
  if (pack.id === "general-design") actionType = null;
  const [boundedTitle, boundedMessage, boundedWhy, boundedUncertainty] = limitLearnerQuestionsAcross([
    text.title, text.message, text.whyThisStep, text.uncertainty,
  ]);
  text = {
    title: boundedTitle,
    message: boundedMessage,
    whyThisStep: boundedWhy,
    uncertainty: boundedUncertainty,
  };
  if (selectedEvidenceFacts.length > 0) appliedPolicyRules.add("GROUND_VERIFIED_EVIDENCE");
  runtime.traceSink.emit({
    kind: "POLICY_CHECK",
    status: "SUCCEEDED",
    label: "完成回答与行动裁决",
    summary: actionType
      ? "回答已通过来源、行动和权限边界校验。"
      : "回答已通过权限边界校验，本回合不生成可执行写入动作。",
    policyRule: requestAssessment.requestsFormalAuthority
      ? "FORBID_FORMAL_AUTHORITY"
      : "BOUND_EXECUTION",
    latencyMs: Math.round(performance.now() - responseStarted),
  });
  const selectedSourceIds = [
    ...selectedKnowledge.map(({ id }) => id),
    ...selectedEvidenceFacts.map(({ sourceId }) => sourceId),
    ...selectedToolExecutions.map(({ observation }) => toolSourceId(observation.callId)),
  ].filter((id, index, values) => values.indexOf(id) === index).slice(0, 8);
  runtime.traceSink.emit({
    kind: "SOURCE_SELECTION",
    status: selectedSourceIds.length > 0 ? "SUCCEEDED" : "EMPTY",
    label: selectedSourceIds.length > 0 ? "选择回答依据" : "标记通用设计建议",
    summary: selectedSourceIds.length > 0
      ? `回答保留 ${selectedSourceIds.length} 条可追溯依据。`
      : "回答不伪造课程来源，并明确标记为通用设计建议。",
    sourceIds: selectedSourceIds,
    latencyMs: Math.round(performance.now() - responseStarted),
  });
  const { partial, responseLatencyMs } = finalizeAgentResponse({
    specialty: { id: specialty.specialty, label: specialty.label, enhanced: specialty.enhanced },
    episode, decisionCode, aiMode, responseText: text, pack,
    knowledge: selectedKnowledge, evidenceFacts: selectedEvidenceFacts,
    selectedToolExecutions, allToolExecutions: toolExecutions,
    artwork, artworkObserved, actionType, policy, appliedPolicyRules,
    modelDecisions, trace, responseStarted,
  });
  runtime.traceSink.emit({
    kind: "PERSISTENCE",
    status: "SUCCEEDED",
    label: "保存回合与公开轨迹",
    summary: "回合、项目简报、来源、工具记录和公开执行事件将作为同一事务保存。",
    latencyMs: Math.round(performance.now() - responseStarted),
  });
  const runtimeEvents = runtime.traceSink.snapshot();
  assertRunNotCancelled(options);
  const stored = await persistAgentTurnWithArtwork({
    connection, context, pack, request: input, artwork,
    runId: request.runId,
    artworkRoot: options.artworkRoot,
    now: options.now?.() ?? new Date(),
    response: {
      ...partial,
      runtime: runtime.traceSink.runtime,
      runtimeEvents,
      responseStrategy,
      responseLatencyMs,
      toolExecutions,
      briefPatch,
    },
  });
  return AgentTurnResponseSchema.parse({
    ...stored,
    createdAt: stored.createdAt.toISOString(),
    studentMessage: input.message,
    coursePack: { id: pack.id, version: pack.version, label: pack.label },
    projectBrief: stored.projectBrief,
    ...partial,
    runtime: runtime.traceSink.runtime,
    runtimeEvents,
  });
}

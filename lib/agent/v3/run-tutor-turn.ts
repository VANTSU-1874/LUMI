import { randomUUID } from "node:crypto";

import { ModelServiceError } from "@/lib/ai/client";
import { getCoursePack } from "@/lib/course-packs/registry";
import type { StudentMemoryCandidate } from "@/lib/domain/student-memory";

import { buildAnswerProvenance } from "../answer-provenance";
import { persistAgentTurnWithArtwork } from "../artwork-turn-persistence";
import { appendContinuationText } from "../continuation-text";
import { readConversationSessionTurns } from "../conversation-session";
import {
  readAgentSessionSummary,
  SESSION_RECENT_TURN_LIMIT,
} from "../conversation-summary";
import {
  AgentReplySchema,
  AgentTurnResponseSchema,
  type AgentResponseStrategy,
  type AgentTurnResponse,
} from "../contracts";
import { buildDeterministicResponse } from "../deterministic-response";
import {
  CRITIQUE_FRAMEWORK_ID,
  CRITIQUE_FRAMEWORK_VERSION,
  CritiqueResultSchema,
  type CritiqueResult,
} from "../critique-contract";
import { routeCritiqueRequest } from "../critique-routing";
import { readLatestAgentCritique } from "../critique-store";
import { createExecutionTrace } from "../execution-trace";
import { clampAgentTurnLatencyMs } from "../latency-limits";
import {
  claimExternalSearchConsent,
  reserveExternalSearchConsent,
} from "../external-search-consent";
import { createExternalWebResearchRunner } from "../external-web-research";
import {
  buildEmbeddingProvider,
  buildModelClient,
  graphFor,
  knowledgeEnhancementsForQuestion,
  readStudentContext,
  retrievalMessage,
  selectTutorKnowledge,
} from "../orchestrator-context";
import {
  claimsFormalAuthorityText,
  createPolicyTrace,
} from "../policy-enforcement";
import { getActiveAgentPolicy } from "../policy-registry";
import type { ProjectBriefPatch } from "../project-brief-memory";
import type { AgentRuntimeRequest } from "../runtime/agent-runtime-port";
import type { TraceSink } from "../runtime/trace-sink";
import { routeDesignSpecialty } from "../specialty-router";
import { collectStudentMemoryCandidates } from "../student-memory-candidates";
import {
  prepareStudentMemoryCandidateEmbeddings,
  recallStudentMemories,
  type StudentMemoryRecallResult,
} from "../student-memory-retrieval";
import type { AgentToolExecution } from "../tool-contract";
import { listAgentToolsForRequestedCapability } from "../tool-registry";
import { toolSourceId } from "../tool-sources";
import { EXTERNAL_WEB_SEARCH_TOOL_ID } from "../tools/web-tools";
import {
  applyTutorArtworkBoundary,
  canNativeTutorObserveArtwork,
} from "./tutor-artwork";
import { buildTutorContextMessageWithSources, buildTutorSystemPrompt } from "./tutor-prompt";
import {
  parseTutorSidecar,
  type TutorCritiqueDraft,
  type TutorCritiqueStatus,
  type TutorSidecarStatus,
} from "./tutor-sidecar";
import { knowledgeIdsExplicitlyMentioned } from "./tutor-source-mentions";
import { runTutorToolLoop } from "./tutor-tool-loop";
import { findPossibleTutorSidecarStart } from "../tutor-sidecar-marker";

const FORMAL_AUTHORITY_NOTE =
  "说明：我可以提供设计分析和修改建议，但不能替你提交、评分、判定过关或代替教师正式复核。";

function modelServiceDiagnosticCode(error: ModelServiceError) {
  const codes: string[] = [error.code];
  if (error.transportCode) codes.push(error.transportCode);
  if (error.protocolCode) codes.push(error.protocolCode);
  return codes.join(":");
}

type IncompleteModelResponse =
  | {
    reason: "MODEL_TIMEOUT" | "MODEL_CONNECTION_INTERRUPTED";
    error: ModelServiceError;
  }
  | {
    reason: "MODEL_OUTPUT_TRUNCATED";
    error: null;
  };

function assertRunNotCancelled(request: AgentRuntimeRequest) {
  request.options?.signal?.throwIfAborted();
  if (request.options?.cancellationRequested?.()) {
    throw new DOMException("Agent run cancelled", "AbortError");
  }
}

function learnerPresentation(text: string) {
  const heading = text.match(/^#{1,6}\s+([^\r\n]+)\r?\n(?:\s*\r?\n)?/);
  const headingText = heading?.[1]?.trim();
  if (!heading || !headingText || headingText.length > 80) {
    return { title: "设计导师建议", message: text };
  }
  const remaining = text.slice(heading[0].length).trimStart();
  return {
    title: headingText,
    message: remaining || text,
  };
}

function learnerVisiblePartialText(raw: string) {
  const sidecarStart = findPossibleTutorSidecarStart(raw);
  const withoutSidecar = (sidecarStart >= 0 ? raw.slice(0, sidecarStart) : raw).trim();
  return withoutSidecar ? withoutSidecar.slice(0, 32_000) : null;
}

function visiblyMentionedKnowledgeIds(
  fields: {
    title: string;
    message: string;
    whyThisStep: string;
    uncertainty: string | undefined;
  },
  knowledge: Parameters<typeof knowledgeIdsExplicitlyMentioned>[1],
) {
  const titleAndMessage = [fields.title, fields.message].filter(Boolean).join("\n");
  return [titleAndMessage, fields.whyThisStep, fields.uncertainty]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => knowledgeIdsExplicitlyMentioned(value, knowledge));
}

function sidecarTelemetry(
  traceSink: TraceSink,
  status: TutorSidecarStatus,
  responseStarted: number,
) {
  traceSink.emit({
    kind: "POLICY_CHECK",
    status: status === "INVALID" ? "SKIPPED" : "SUCCEEDED",
    label: "读取可选教学元数据",
    summary: status === "PARSED"
      ? "已读取可选教学分析字段；正文不依赖这些字段通过。"
      : status === "INVALID"
        ? "可选元数据解析失败，已记录并原样放行学生正文。"
        : "模型未附可选元数据，学生正文正常放行。",
    errorCode: status === "INVALID" ? "V3_SIDECAR_INVALID" : null,
    latencyMs: Math.round(performance.now() - responseStarted),
  });
}

function critiqueSidecarTelemetry(
  traceSink: TraceSink,
  status: TutorCritiqueStatus,
  responseStarted: number,
) {
  traceSink.emit({
    kind: "POLICY_CHECK",
    status: status === "PARSED" ? "SUCCEEDED" : "SKIPPED",
    label: "读取可选五维会诊",
    summary: status === "PARSED"
      ? "五维与独立收束结构完整，已作为可选副产物接收；自然正文仍是主体。"
      : status === "INVALID"
        ? "会诊副产物不完整或证据引用未绑定，已只丢弃会诊并保留自然正文。"
        : status === "INELIGIBLE"
          ? "本轮不是可验证的作品设计点评，已忽略模型附带的会诊，不影响自然正文。"
          : "模型未附会诊副产物；自然正文正常交付。",
    errorCode: status === "INVALID" ? "V3_CRITIQUE_SIDECAR_INVALID"
      : status === "INELIGIBLE" ? "V3_CRITIQUE_SIDECAR_INELIGIBLE" : null,
    latencyMs: Math.round(performance.now() - responseStarted),
  });
}

export async function runTutorTurn(
  request: AgentRuntimeRequest,
  runtime: { traceSink: TraceSink },
): Promise<AgentTurnResponse> {
  assertRunNotCancelled(request);
  if (request.options?.toolExecutor && process.env.NODE_ENV !== "test") {
    throw new Error("TEST_TOOL_EXECUTOR_FORBIDDEN");
  }
  const responseStarted = performance.now();
  const { connection, actor, input, artwork } = request;
  const options = request.options ?? {};
  const policy = options.policy ?? getActiveAgentPolicy();
  const recentTurnLimit = Math.min(policy.budgets.maxRecentTurns, SESSION_RECENT_TURN_LIMIT);
  const trace = createExecutionTrace(runtime.traceSink);
  const generalContext = readStudentContext(
    connection,
    actor,
    "general-design",
    input.message,
    input.taskId,
  );
  const recentTurns = readConversationSessionTurns(connection, {
    studentId: generalContext.studentId,
    classId: generalContext.classId,
    taskId: generalContext.taskId,
    limit: recentTurnLimit,
  });
  const specialty = routeDesignSpecialty(
    input.message,
    input.context.view,
    recentTurns.at(-1)?.coursePackId,
    generalContext.onboarding.major,
  );
  const context = specialty.coursePackId === "general-design"
    ? generalContext
    : readStudentContext(
        connection,
        actor,
        specialty.coursePackId,
        input.message,
        generalContext.taskId,
      );
  const pack = getCoursePack(
    specialty.coursePackId,
    context.project?.coursePackVersion ?? specialty.coursePackVersion,
  );
  const critiqueRoute = routeCritiqueRequest({
    courseId: pack.id,
    message: input.message,
    hasArtwork: Boolean(artwork),
    explicitCritique: input.capability?.id === "five-dimension",
  });
  const previousCritique = critiqueRoute === "STRUCTURED_CRITIQUE"
    ? readLatestAgentCritique({
        connection,
        studentId: context.studentId,
        classId: context.classId,
        courseId: pack.id,
        dataType: context.dataType,
      })
    : undefined;
  let sessionSummary: ReturnType<typeof readAgentSessionSummary> = null;
  try {
    sessionSummary = readAgentSessionSummary(connection, {
      studentId: context.studentId,
      classId: context.classId,
      taskId: context.taskId,
    });
  } catch {
    assertRunNotCancelled(request);
  }
  runtime.traceSink.emit({
    kind: "CONTEXT_PREPARATION",
    status: "SUCCEEDED",
    label: "恢复本轮对话上下文",
    summary: `已恢复项目简报、学习状态、${sessionSummary ? "滚动摘要和" : ""}最近 ${recentTurns.length} 个原文回合。`,
    latencyMs: Math.round(performance.now() - responseStarted),
  });
  runtime.traceSink.emit({
    kind: "POLICY_CHECK",
    status: "SUCCEEDED",
    label: "保留必要权限护栏",
    summary: "保留不代替正式评价、提交与写入确认边界，不限制正常专业表达。",
    policyRule: "FORBID_FORMAL_AUTHORITY",
    latencyMs: Math.round(performance.now() - responseStarted),
  });

  const query = retrievalMessage(input.message, recentTurns);
  const embeddingProvider = buildEmbeddingProvider(options, policy);
  const memoryRecallPromise = recallStudentMemories(connection, {
    studentId: context.studentId,
    classId: context.classId,
    query,
    embeddingProvider,
    signal: options.signal,
  }).catch((error): StudentMemoryRecallResult => {
    assertRunNotCancelled(request);
    return {
      items: [],
      semanticStatus: "FAILED",
      errorCode: error instanceof Error ? "STORE_UNAVAILABLE" : "RECALL_UNAVAILABLE",
    };
  });
  const knowledgeRetrievalPromise = selectTutorKnowledge(
    connection,
    pack.id,
    pack.version,
    query,
    options,
    policy,
    embeddingProvider,
  );
  const [memoryRecall, retrieval] = await Promise.all([
    memoryRecallPromise,
    knowledgeRetrievalPromise,
  ]);
  const memoryRetrievalLabel = memoryRecall.semanticStatus === "USED"
    ? "语义与词法召回学生记忆"
    : memoryRecall.semanticStatus === "FAILED"
      ? "语义不可用，已使用词法召回学生记忆"
      : "使用词法召回学生记忆";
  runtime.traceSink.emit({
    kind: "RETRIEVAL",
    status: memoryRecall.items.length > 0 ? "SUCCEEDED" : "EMPTY",
    label: memoryRecall.items.length > 0 ? memoryRetrievalLabel : "未召回相关学生记忆",
    summary: memoryRecall.items.length > 0
      ? `已准备 ${memoryRecall.items.length} 条与当前问题相关的可纠正学生笔记；不作为课程事实。`
      : "没有相关长期记忆或记忆服务不可用；不影响导师正常回答。",
    errorCode: memoryRecall.errorCode
      ? `MEMORY_${memoryRecall.errorCode}`.slice(0, 80)
      : null,
    latencyMs: Math.round(performance.now() - responseStarted),
  });
  const knowledge = knowledgeEnhancementsForQuestion(
    input.message,
    retrieval.items,
    { preserveSemanticMatches: true },
  );
  const retrievalLabel = retrieval.semanticStatus === "USED"
    ? "向量与词法混合检索"
    : retrieval.semanticStatus === "FAILED"
      ? "向量不可用，已使用词法检索"
      : "使用词法检索";
  runtime.traceSink.emit({
    kind: "RETRIEVAL",
    status: knowledge.length > 0 ? "SUCCEEDED" : "EMPTY",
    label: knowledge.length > 0 ? retrievalLabel : "未命中课程资料",
    summary: knowledge.length > 0
      ? `${retrievalLabel}准备了 ${knowledge.length} 条可追溯参考；参考只增强回答。`
      : `${retrievalLabel}未得到可用参考；不阻断导师使用通用设计知识回答。`,
    sourceIds: knowledge.slice(0, 8).map(({ id }) => id),
    errorCode: retrieval.errorCode ? `EMBEDDING_${retrieval.errorCode}` : null,
    latencyMs: Math.round(performance.now() - responseStarted),
  });

  const client = buildModelClient(options, policy);
  const canObserveArtwork = canNativeTutorObserveArtwork(client, artwork);
  const critiqueEnabled = critiqueRoute === "STRUCTURED_CRITIQUE" && canObserveArtwork;
  const externalSearchConsent = reserveExternalSearchConsent({
    connection,
    context,
    request: input,
    runId: request.runId,
  });
  const externalSearchConfirmed = externalSearchConsent.confirmed;
  if (input.externalSearchConsent) {
    runtime.traceSink.emit({
      kind: "POLICY_CHECK",
      status: externalSearchConfirmed ? "SUCCEEDED" : "SKIPPED",
      label: externalSearchConfirmed ? "确认本轮联网授权" : "联网授权不可用",
      summary: externalSearchConfirmed
        ? "授权已绑定本条消息与当前运行；仅在真正联网前原子消费，工具只接收脱敏后的当前问题。"
        : externalSearchConsent.reason === "EXPIRED"
          ? "本轮联网授权已过期；导师仍会在不联网的情况下正常回答。"
          : "本轮联网授权已使用或与请求不匹配；导师仍会在不联网的情况下正常回答。",
      errorCode: externalSearchConfirmed
        ? null
        : `EXTERNAL_SEARCH_CONSENT_${externalSearchConsent.reason}`,
      policyRule: "EXTERNAL_SEARCH_CONFIRMED",
      toolId: EXTERNAL_WEB_SEARCH_TOOL_ID,
      latencyMs: Math.round(performance.now() - responseStarted),
    });
  }
  const confirmedToolIds = externalSearchConfirmed
    ? new Set([EXTERNAL_WEB_SEARCH_TOOL_ID])
    : new Set<string>();
  const availableTools = listAgentToolsForRequestedCapability({
    pack,
    capabilityId: input.capability?.id,
    externalSearchConfirmed,
  });
  const externalWebResearch = client && externalSearchConfirmed
    ? createExternalWebResearchRunner(client, {
        beforeSearch: () => claimExternalSearchConsent({
          connection,
          context,
          request: input,
          runId: request.runId,
        }),
        onTelemetry: ({ status, latencyMs, usage }) => trace.add({
          kind: "MODEL_DECISION",
          status: status === "FAILED" ? "FAILED"
            : status === "SUCCESS" ? "SUCCEEDED" : "EMPTY",
          label: "执行联网检索辅助请求",
          summary: "联网工具使用单独的同模型请求；不计入导师主循环决策数，用量已单独记录。",
          toolCallId: null,
          toolId: EXTERNAL_WEB_SEARCH_TOOL_ID,
          latencyMs,
        }, {
          modelProvider: client.provider,
          modelId: client.modelId ?? null,
          usage: usage ? { status: "RECORDED", ...usage } : {
            status: "UNAVAILABLE",
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
          },
        }),
      })
    : undefined;
  const turnDeadline = responseStarted + policy.budgets.turnTimeoutMs;
  let aiMode: AgentTurnResponse["aiMode"] = "DETERMINISTIC_FALLBACK";
  let modelDecisions = 0;
  let modelRetries = 0;
  let toolCallCount = 0;
  let toolExecutions: AgentToolExecution[] = [];
  let text = "";
  let episode: AgentTurnResponse["episode"] = "EXPLORE";
  let decisionCode = "V3_TUTOR_RESPONSE";
  let responseStrategy: AgentResponseStrategy = "CLARIFY";
  let briefPatch: ProjectBriefPatch = {};
  let selectedKnowledge = knowledge.slice(0, 1);
  let selectedEvidenceFacts = context.verifiedEvidenceFacts.slice(0, 1);
  let selectedToolExecutions: AgentToolExecution[] = [];
  let title = "设计导师建议";
  let whyThisStep = "先直接回应当前困惑，再给出可以继续推进作品的具体判断与行动。";
  let uncertainty = "通用设计建议：尚未看到完整作品、制作现场与实际使用反馈。";
  let fallbackReason: ModelServiceError | null = null;
  let incompleteModelResponse: IncompleteModelResponse | null = null;
  let streamedTutorText = "";
  let streamedTutorTextAttempt: number | null = null;
  let sidecarMemoryCandidates: StudentMemoryCandidate[] = [];
  let pendingCritiqueDraft: TutorCritiqueDraft | null = null;
  let artworkDelivered = false;
  let sidecarSourceIdsForInference = new Set<string>();
  let injectedKnowledgeIdsForInference = new Set<string>();
  let injectedEvidenceIdsForInference = new Set<string>();
  let modelSourceInferenceReady = false;

  if (client) {
    const loopProgress = { modelDecisions: 0, toolCallCount: 0, modelRetries: 0 };
    const accumulatedToolExecutions: AgentToolExecution[] = [];
    try {
      const tutorContextMessage = buildTutorContextMessageWithSources({
        studentQuestion: input.message,
        view: input.context.view,
        focus: input.context.focus ?? null,
        pack,
        context,
        recentTurns,
        sessionSummary,
        studentMemories: memoryRecall.items,
        knowledge,
        ...(input.continuation ? {
          continuation: {
            previousText: input.continuation.previousText,
            attempt: input.continuation.attempt,
          },
        } : {}),
        artworkInput: artwork ? {
          sourceId: `artwork:${artwork.id}`,
          mimeType: artwork.mimeType,
          width: artwork.width,
          height: artwork.height,
          availableToModel: canObserveArtwork,
        } : null,
        critique: {
          route: critiqueRoute,
          enabled: critiqueEnabled,
          ...(previousCritique ? {
            previousRecord: {
              id: previousCritique.id,
              createdAt: previousCritique.createdAt,
              established: previousCritique.closure.established,
              nextStep: previousCritique.closure.nextStep,
            },
          } : {}),
        },
      });
      const loop = await runTutorToolLoop({
        connection,
        actor,
        pack,
        context,
        question: input.message,
        client,
        messages: [
          {
            role: "system",
            content: buildTutorSystemPrompt(pack, {
              route: critiqueRoute,
              enabled: critiqueEnabled,
            }, input.capability?.id),
          },
          {
            role: "user",
            content: tutorContextMessage.content,
          },
        ],
        availableTools,
        policy,
        turnDeadline,
        trace,
        artwork,
        embeddingProvider,
        signal: options.signal,
        onModelError: options.onModelError,
        ...(options.onTextDelta ? {
          onTextDelta(delta: string, attempt: number) {
            // Production never retries after a visible delta, but evaluation
            // deliberately does. Keep only the current attempt's partial text
            // so a final retained answer cannot repeat the same prefix.
            if (streamedTutorTextAttempt !== attempt) {
              streamedTutorTextAttempt = attempt;
              streamedTutorText = "";
            }
            streamedTutorText = `${streamedTutorText}${delta}`.slice(0, 32_000);
            options.onTextDelta?.(delta);
          },
        } : {}),
        onModelActivity: options.onModelActivity,
        allowRetryAfterTextDelta: options.allowRetryAfterTextDelta,
        onToolProgress: options.onToolProgress,
        toolExecutor: options.toolExecutor,
        progress: loopProgress,
        toolExecutions: accumulatedToolExecutions,
        confirmedToolIds,
        externalWebResearch,
        retryContext: {
          ...options.modelRetryContext,
          ...(request.runId ? { runId: request.runId } : {}),
        },
      });
      modelDecisions = loop.modelDecisions;
      modelRetries = loop.modelRetries;
      toolCallCount = loop.toolCallCount;
      toolExecutions = loop.toolExecutions;
      const parsed = parseTutorSidecar(loop.text, {
        enabled: critiqueEnabled,
        courseId: pack.id,
        studentMessage: input.message,
        artworkSourceId: artwork ? `artwork:${artwork.id}` : undefined,
        allowedCourseSourceIds: new Set(tutorContextMessage.knowledgeSourceIds),
        allowedHistoryRecordIds: new Set(previousCritique ? [previousCritique.id] : []),
      });
      sidecarTelemetry(runtime.traceSink, parsed.status, responseStarted);
      critiqueSidecarTelemetry(runtime.traceSink, parsed.critiqueStatus, responseStarted);
      if (!parsed.text) {
        if (loop.artworkDelivered) {
          options.onToolProgress?.({
            status: "FAILED",
            toolId: "student-artwork.inspect",
            label: "作品图片未形成可交付正文",
            summary: "视觉模型只返回了内部元数据；本轮不会把这张图片标记为已观察依据。",
          });
        }
        throw new ModelServiceError("INVALID_RESPONSE");
      }
      artworkDelivered = loop.artworkDelivered;
      if (artworkDelivered) {
        options.onToolProgress?.({
          status: "SUCCEEDED",
          toolId: "student-artwork.inspect",
          label: "已读取你的作品",
          summary: "已向视觉模型提供作品静态画面；回答仍会区分画面观察与通用设计建议。",
        });
      }
      text = input.continuation
        ? appendContinuationText(input.continuation.previousText, parsed.text)
        : parsed.text;
      aiMode = "MODEL_ASSISTED";
      episode = parsed.sidecar?.episode ?? episode;
      decisionCode = parsed.sidecar?.decisionCode ?? decisionCode;
      responseStrategy = parsed.sidecar?.responseStrategy ?? responseStrategy;
      briefPatch = parsed.sidecar?.briefPatch ?? briefPatch;
      sidecarMemoryCandidates = parsed.sidecar?.memoryCandidates ?? [];
      pendingCritiqueDraft = parsed.sidecar?.critique ?? null;
      const presentation = learnerPresentation(text);
      title = parsed.sidecar?.title ?? presentation.title;
      text = presentation.message;
      whyThisStep = parsed.sidecar?.whyThisStep ?? whyThisStep;
      const injectedKnowledgeIds = new Set(tutorContextMessage.knowledgeSourceIds);
      const injectedKnowledge = knowledge.filter(({ id }) => injectedKnowledgeIds.has(id));
      const injectedEvidenceIds = new Set(tutorContextMessage.evidenceSourceIds);
      sidecarSourceIdsForInference = new Set(parsed.sidecar?.sourceIds ?? []);
      injectedKnowledgeIdsForInference = injectedKnowledgeIds;
      injectedEvidenceIdsForInference = injectedEvidenceIds;
      modelSourceInferenceReady = true;
      const declaredSourceIds = new Set([
        ...sidecarSourceIdsForInference,
        ...visiblyMentionedKnowledgeIds({
          title,
          message: text,
          whyThisStep,
          uncertainty: parsed.sidecar?.uncertainty ?? undefined,
        }, injectedKnowledge),
      ]);
      selectedKnowledge = injectedKnowledge.filter(({ id }) => declaredSourceIds.has(id));
      selectedEvidenceFacts = context.verifiedEvidenceFacts.filter(({ sourceId }) =>
        injectedEvidenceIds.has(sourceId) && declaredSourceIds.has(sourceId));
      selectedToolExecutions = toolExecutions.filter((execution) =>
        declaredSourceIds.has(toolSourceId(execution.observation.callId)))
        .concat(toolExecutions.filter((execution) =>
          !declaredSourceIds.has(toolSourceId(execution.observation.callId))));
      const usedSuccessfulCalculator = selectedToolExecutions.some(({ call, observation }) => (
        call.toolId === "design-calculator.compute" && observation.status === "SUCCESS"
      ));
      const usedOtherSuccessfulTool = selectedToolExecutions.some(({ call, observation }) => (
        call.toolId !== "design-calculator.compute" && observation.status === "SUCCESS"
      ));
      const usedTraceableMaterial = selectedKnowledge.length + selectedEvidenceFacts.length > 0
        || usedOtherSuccessfulTool;
      const defaultUncertainty = usedSuccessfulCalculator
        ? usedTraceableMaterial
          ? "课程、学习现场或联网资料来自本轮列出的可追溯依据；数值来自本轮确定性计算，适用范围见计算说明，其余判断属于导师的通用设计经验。"
          : "数值来自本轮确定性计算，适用范围见计算说明；其余判断属于导师的通用设计经验。"
        : usedTraceableMaterial
          ? "课程、学习现场或联网资料来自本轮列出的可追溯依据；其余判断属于导师的通用设计经验。"
          : uncertainty;
      uncertainty = parsed.sidecar?.uncertainty ?? defaultUncertainty;
      if (loop.outputTruncated) {
        incompleteModelResponse = {
          reason: "MODEL_OUTPUT_TRUNCATED",
          error: null,
        };
        whyThisStep = "本次输出达到长度上限；以上保留的是已经收到的正文，没有用模板回答替换。";
        uncertainty = "本回答未完成，尚未形成完整结论、来源声明或后续行动；请继续生成以完成回答。";
        briefPatch = {};
        sidecarMemoryCandidates = [];
        pendingCritiqueDraft = null;
        selectedKnowledge = [];
        selectedEvidenceFacts = [];
        selectedToolExecutions = [];
        modelSourceInferenceReady = false;
      }
      const visibleAnswer = [title, text, whyThisStep, uncertainty].join("\n");
      if (claimsFormalAuthorityText(visibleAnswer)) {
        text = `${text}\n\n${FORMAL_AUTHORITY_NOTE}`;
        runtime.traceSink.emit({
          kind: "POLICY_CHECK",
          status: "SUCCEEDED",
          label: "附加正式权限说明",
          summary: "保留模型正文，并附加不代替提交、评分与教师复核的权限说明。",
          policyRule: "FORBID_FORMAL_AUTHORITY",
          latencyMs: Math.round(performance.now() - responseStarted),
        });
      }
    } catch (error) {
      if (!(error instanceof ModelServiceError)) throw error;
      modelDecisions = loopProgress.modelDecisions;
      modelRetries = loopProgress.modelRetries;
      toolCallCount = loopProgress.toolCallCount;
      toolExecutions = accumulatedToolExecutions;
      artworkDelivered = false;
      const streamedPartialText = learnerVisiblePartialText(streamedTutorText);
      const partialText = input.continuation
        ? appendContinuationText(input.continuation.previousText, streamedPartialText ?? "")
        : streamedPartialText;
      if (partialText) {
        const presentation = learnerPresentation(partialText);
        aiMode = "MODEL_ASSISTED";
        text = presentation.message;
        title = presentation.title;
        whyThisStep = "模型连接在回答完成前中断；以上保留的是已经收到的正文，没有用模板回答替换。";
        uncertainty = "本回答未完成，尚未形成完整结论、来源声明或后续行动；请重试以获得完整回答。";
        briefPatch = {};
        selectedKnowledge = [];
        selectedEvidenceFacts = [];
        selectedToolExecutions = [];
        modelSourceInferenceReady = false;
        incompleteModelResponse = {
          reason: error.code === "TIMEOUT" ? "MODEL_TIMEOUT" : "MODEL_CONNECTION_INTERRUPTED",
          error,
        };
      } else {
        fallbackReason = error;
      }
    }
  }

  if (!client || fallbackReason) {
    const fallback = buildDeterministicResponse({
      packLabel: pack.label,
      episode: "EXPLORE",
      message: input.message,
      knowledge: selectedKnowledge,
    });
    text = fallback.message;
    title = fallback.title;
    whyThisStep = fallback.whyThisStep;
    uncertainty = fallback.uncertainty;
    briefPatch = fallback.briefPatch;
    selectedKnowledge = knowledge.filter(({ id }) => fallback.sourceIds.includes(id));
    selectedEvidenceFacts = [];
    selectedToolExecutions = [];
    trace.add({
      kind: "DEGRADED",
      status: "SUCCEEDED",
      label: "模型服务不可用，使用确定性回退",
      summary: fallbackReason
        ? `模型服务错误：${modelServiceDiagnosticCode(fallbackReason)}。${modelRetries > 0 ? `本轮模型调用已重试 ${modelRetries} 次。` : ""}`
        : "模型服务未配置。",
      toolCallId: null,
      toolId: null,
      latencyMs: Math.round(performance.now() - responseStarted),
    }, {
      errorCode: fallbackReason
        ? modelServiceDiagnosticCode(fallbackReason)
        : "MODEL_NOT_CONFIGURED",
    });
  } else {
    trace.add({
      kind: "FINAL_RESPONSE",
      status: "SUCCEEDED",
      label: incompleteModelResponse ? "保留未完成模型正文" : "交付完整回答",
      summary: incompleteModelResponse
        ? incompleteModelResponse.reason === "MODEL_OUTPUT_TRUNCATED"
          ? "模型输出达到长度上限；保留已收到正文，不以确定性回退替换。"
          : `模型服务错误：${modelServiceDiagnosticCode(incompleteModelResponse.error)}；保留已收到正文，不以确定性回退替换。`
        : title,
      toolCallId: null,
      toolId: null,
      latencyMs: Math.round(performance.now() - responseStarted),
    }, incompleteModelResponse ? {
      errorCode: incompleteModelResponse.reason === "MODEL_OUTPUT_TRUNCATED"
        ? "MODEL_OUTPUT_TRUNCATED"
        : modelServiceDiagnosticCode(incompleteModelResponse.error),
    } : {});
  }

  if (artwork) {
    const bounded = applyTutorArtworkBoundary({
      title,
      message: text,
      whyThisStep,
      uncertainty,
    }, artworkDelivered);
    title = bounded.title;
    text = bounded.message;
    whyThisStep = bounded.whyThisStep;
    uncertainty = bounded.uncertainty;
    runtime.traceSink.emit({
      kind: "POLICY_CHECK",
      status: "SUCCEEDED",
      label: artworkDelivered ? "限定作品图观察边界" : "说明作品图未被读取",
      summary: artworkDelivered
        ? "作品图片已随成功的视觉模型请求送达；仅记录静态可见内容，不推断动态、材质、交互或使用效果。"
        : "作品附件仍被私有保存，但本轮未把它作为画面观察依据；保留完整文本回答并公开说明边界。",
      sourceIds: artworkDelivered ? [`artwork:${artwork.id}`] : [],
      policyRule: artworkDelivered
        ? "GROUND_ARTWORK_OBSERVATION"
        : "DEGRADE_UNAVAILABLE_VISION",
      latencyMs: Math.round(performance.now() - responseStarted),
    });
  }

  if (modelSourceInferenceReady && !fallbackReason) {
    const injectedKnowledge = knowledge.filter(({ id }) =>
      injectedKnowledgeIdsForInference.has(id));
    const finalSourceIds = new Set([
      ...sidecarSourceIdsForInference,
      ...visiblyMentionedKnowledgeIds({
        title,
        message: text,
        whyThisStep,
        uncertainty,
      }, injectedKnowledge),
    ]);
    selectedKnowledge = injectedKnowledge.filter(({ id }) => finalSourceIds.has(id));
    selectedEvidenceFacts = context.verifiedEvidenceFacts.filter(({ sourceId }) =>
      injectedEvidenceIdsForInference.has(sourceId) && finalSourceIds.has(sourceId));
  }

  const provenance = buildAnswerProvenance({
    knowledge: selectedKnowledge,
    evidenceFacts: selectedEvidenceFacts,
    toolExecutions: selectedToolExecutions,
    artwork,
    artworkObserved: artworkDelivered,
    generalAdviceUsed: true,
    webCitations: selectedToolExecutions
      .filter(({ call, observation }) => (
        call.toolId === EXTERNAL_WEB_SEARCH_TOOL_ID
        && observation.status === "SUCCESS"
      ))
      .flatMap(({ output }) => {
        if (!output || typeof output !== "object" || Array.isArray(output)) return [];
        const citations = (output as { citations?: unknown }).citations;
        return Array.isArray(citations) ? citations : [];
      }),
    maxSources: policy.budgets.maxSources,
  });
  runtime.traceSink.emit({
    kind: "SOURCE_SELECTION",
    status: provenance.sources.length > 0 ? "SUCCEEDED" : "EMPTY",
    label: provenance.sources.length > 0 ? "记录回答依据" : "标记通用设计经验",
    summary: provenance.sources.length > 0
      ? `记录 ${provenance.sources.length} 条可追溯依据；不以来源数量裁决正文。`
      : selectedToolExecutions.some(({ call, observation }) => (
        call.toolId === "design-calculator.compute" && observation.status === "SUCCESS"
      ))
        ? "本轮使用了确定性计算结果；该结果不伪装成课程、网页或学习记录来源。"
        : "本轮没有伪造课程来源，正文按通用设计经验交付。",
    sourceIds: provenance.sources.map(({ id }) => id),
    latencyMs: Math.round(performance.now() - responseStarted),
  });
  const reply = AgentReplySchema.parse({
    eyebrow: `${specialty.label} · V3 导师`,
    title,
    message: text,
    whyThisStep,
    uncertainty,
    graph: graphFor(pack.id, episode, selectedKnowledge),
    sources: provenance.sources,
    basis: provenance.basis,
    ...(incompleteModelResponse ? {
      incomplete: { reason: incompleteModelResponse.reason },
    } : {}),
    actions: [],
  });
  const appliedRules = [
    "STUDENT_CONFIRM_MUTATIONS",
    "FORBID_FORMAL_AUTHORITY",
    "PERSIST_EXECUTION_TRACE",
    ...(toolExecutions.length > 0 ? ["REGISTERED_TOOLS_ONLY"] : []),
    ...(toolExecutions.some(({ call }) => call.toolId !== EXTERNAL_WEB_SEARCH_TOOL_ID)
      ? ["READ_ONLY_TOOLS_AUTOMATIC"] : []),
    ...(selectedKnowledge.length > 0 ? ["GROUND_COURSE_FACTS"] : ["ALLOW_GENERAL_DESIGN"]),
    ...(artwork ? [artworkDelivered
      ? "GROUND_ARTWORK_OBSERVATION"
      : "DEGRADE_UNAVAILABLE_VISION"] : []),
    ...(externalSearchConfirmed ? ["EXTERNAL_SEARCH_CONFIRMED"] : []),
    ...(selectedToolExecutions.some(({ call, observation }) => (
      call.toolId === EXTERNAL_WEB_SEARCH_TOOL_ID && observation.status === "SUCCESS"
    )) ? ["GROUND_EXTERNAL_SOURCES"] : []),
    ...(selectedToolExecutions.some(({ call, observation }) => (
      call.toolId === EXTERNAL_WEB_SEARCH_TOOL_ID && observation.status !== "SUCCESS"
    )) ? ["DEGRADE_UNAVAILABLE_WEB_SEARCH"] : []),
  ];
  const responseLatencyMs = clampAgentTurnLatencyMs(performance.now() - responseStarted);
  const policyTrace = createPolicyTrace({
    policy,
    modelDecisions,
    modelRetries,
    toolCalls: Math.min(toolCallCount, policy.budgets.maxToolCalls),
    appliedRules,
  });
  runtime.traceSink.emit({
    kind: "PERSISTENCE",
    status: "SUCCEEDED",
    label: "保存本轮对话",
    summary: "沿用现有事务保存回合、项目简报、工具记录和公开轨迹。",
    latencyMs: responseLatencyMs,
  });
  const runtimeEvents = runtime.traceSink.snapshot();
  const executionSteps = trace.snapshot();
  const collectedMemoryCandidates = collectStudentMemoryCandidates(input.message, {
    sidecarCandidates: sidecarMemoryCandidates,
  });
  const memoryCandidates = await prepareStudentMemoryCandidateEmbeddings(
    collectedMemoryCandidates,
    memoryRecall.semanticStatus === "FAILED" ? null : embeddingProvider,
    { signal: options.signal },
  );
  assertRunNotCancelled(request);
  const turnCreatedAt = options.now?.() ?? new Date();
  const critique: CritiqueResult | undefined = pendingCritiqueDraft && artworkDelivered
    ? CritiqueResultSchema.parse({
        id: randomUUID(),
        frameworkId: CRITIQUE_FRAMEWORK_ID,
        frameworkVersion: CRITIQUE_FRAMEWORK_VERSION,
        courseId: pack.id,
        artworkId: artwork!.id,
        createdAt: turnCreatedAt.toISOString(),
        dimensions: pendingCritiqueDraft.dimensions,
        closure: {
          established: pendingCritiqueDraft.closure.established,
          nextStep: pendingCritiqueDraft.closure.nextStep,
        },
      })
    : undefined;
  const stored = await persistAgentTurnWithArtwork({
    connection,
    context,
    pack,
    request: input,
    artwork,
    artworkRoot: options.artworkRoot,
    runId: request.runId,
    now: turnCreatedAt,
    response: {
      episode,
      decisionCode,
      aiMode,
      policy: policyTrace,
      executionSteps,
      runtime: runtime.traceSink.runtime,
      runtimeEvents,
      reply,
      critique,
      critiqueHistoryComparison: pendingCritiqueDraft?.closure.historyComparison,
      critiqueHistoryRecordId: previousCritique?.id,
      specialty: {
        id: specialty.specialty,
        label: specialty.label,
        enhanced: specialty.enhanced,
      },
      responseStrategy,
      responseLatencyMs,
      toolExecutions,
      briefPatch,
      contextWriteback: {
        recalledMemoryIds: aiMode === "MODEL_ASSISTED" && !incompleteModelResponse
          ? memoryRecall.items.map(({ id }) => id)
          : [],
        memoryCandidates,
        recentTurnLimit,
      },
    },
  });

  return AgentTurnResponseSchema.parse({
    ...stored,
    createdAt: stored.createdAt.toISOString(),
    studentMessage: input.message,
    coursePack: { id: pack.id, version: pack.version, label: pack.label },
    projectBrief: stored.projectBrief,
    episode,
    decisionCode,
    aiMode,
    policy: policyTrace,
    executionSteps,
    runtime: runtime.traceSink.runtime,
    runtimeEvents,
    reply,
    critique: stored.critique,
    specialty: {
      id: specialty.specialty,
      label: specialty.label,
      enhanced: specialty.enhanced,
    },
  });
}

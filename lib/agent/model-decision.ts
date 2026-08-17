import { z } from "zod";

import type { ModelMessage, ModelUsage } from "@/lib/ai/client";
import type { CoursePack, LearningEpisode } from "@/lib/course-packs/contract";
import { rankKnowledge, type KnowledgeItem, type RankedKnowledgeItem } from "@/lib/knowledge/retrieve";

import { AgentModelDecisionSchema } from "./contracts";
import type { RecentConversationTurn } from "./conversation-context";
import { buildDesignAgentSystemPrompt } from "./design-agent-prompt";
import { genericDebugSourceIds, minimumSufficientSourceIds, sequenceRequirement, validateAnswerGrounding } from "./answer-grounding";
import { normalizeLearnerFacingDecision } from "./learner-output-normalizer";
import { enforceModelDecisionPolicy } from "./policy-enforcement";
import type { AgentPolicy } from "./policy-contract";
import { DECISION_CODES_BY_EPISODE, allowedActionTypes } from "./router";
import { AgentToolCallRequestSchema, type AgentToolDescriptor, type AgentToolExecution } from "./tool-contract";
import { requestRequiresToolObservationSource, toolExecutionSources } from "./tool-sources";
import type { VerifiedEvidenceFact } from "./verified-evidence-facts";
import { knowledgeCorpus, plainKnowledgeItem, technicalTokens } from "./model-grounding";
import type { PreparedAgentArtwork } from "./artwork-attachment";
import type { ModelProviderAdapter } from "./model-provider-adapter";
import { assertAtMostOneLearnerQuestion, assertTurnRequirementCoverage, limitLearnerQuestions, modelTurnRequirements } from "./model-turn-requirements";
import { applyTechnicalVocabularyPolicy } from "./model-technical-vocabulary";

const AgentModelToolStepSchema = z.object({
  step: z.literal("CALL_TOOL"),
  toolId: AgentToolCallRequestSchema.shape.toolId,
  arguments: AgentToolCallRequestSchema.shape.arguments,
}).strict();

export type AgentModelAnswerDecision = z.infer<typeof AgentModelDecisionSchema>;

type PromptLearningContext = {
  project: null | { stage: string };
  profile: null | { level: string; dimensions: Record<string, number> };
  onboarding: import("@/lib/domain/student-onboarding").StudentOnboardingProfile;
  evidenceCount: number;
  evidenceSummary: Array<{ kind: string; signalLayer: string; label: string; verificationStatus: string }>;
  verifiedEvidenceFacts: VerifiedEvidenceFact[];
  toolState: null | { adapterId: string; status: "EMPTY" | "IN_PROGRESS" | "EVIDENCE_SUBMITTED"; facts: string[] };
  projectBrief: import("./project-brief-memory").ProjectBrief;
  workspaceProject?: null | {
    project: { name: string; instructions: string; memoryMode: "PROJECT_ONLY" };
    files: Array<{ id: string; name: string; mimeType: string }>;
    relatedConversationSummaries: Array<{ taskId: string; title: string; excerpt: string }>;
  };
};

export async function decideAgentTurn(input: {
  client: ModelProviderAdapter;
  message: string;
  view: string;
  focus: string | null;
  pack: CoursePack;
  candidateEpisodes: readonly LearningEpisode[];
  knowledge: Array<KnowledgeItem | RankedKnowledgeItem>;
  context: PromptLearningContext;
  recentTurns: readonly RecentConversationTurn[];
  policy: AgentPolicy;
  availableTools: readonly AgentToolDescriptor[];
  toolExecutions: readonly AgentToolExecution[];
  artwork?: PreparedAgentArtwork;
  retryFeedback?: string | null;
  signal?: AbortSignal;
  totalTimeoutMs?: number;
  onUsage?: (usage: ModelUsage) => void;
}) {
  const allowedDecisionCodes = Array.from(new Set(
    input.candidateEpisodes.flatMap((episode) => DECISION_CODES_BY_EPISODE[episode]),
  ));
  const allowedActionTypeList = Array.from(new Set(
    input.candidateEpisodes.flatMap((episode) => allowedActionTypes(episode)),
  ));
  const toolSources = toolExecutionSources(input.toolExecutions);
  const artworkSourceId = input.artwork ? `artwork:${input.artwork.id}` : null;
  const allowedSourceIds = [
    ...input.knowledge.map(({ id }) => id),
    ...input.context.verifiedEvidenceFacts.map(({ sourceId }) => sourceId),
    ...toolSources.map(({ id }) => id),
    ...(artworkSourceId ? [artworkSourceId] : []),
  ];
  const requiredSequence = sequenceRequirement(input.message, input.recentTurns, input.knowledge);
  const debugSourcesToAvoid = input.candidateEpisodes.includes("DEBUG")
    ? genericDebugSourceIds("DEBUG", input.knowledge, input.knowledge.map(({ id }) => id))
    : [];
  const groundingText = [
    input.message,
    input.pack.label,
    input.pack.summary,
    knowledgeCorpus(input.knowledge),
    JSON.stringify(input.context.verifiedEvidenceFacts),
    JSON.stringify(input.toolExecutions.map(({ observation, output }) => ({ observation, output }))),
  ].join("\n");
  const allowedTechnicalVocabulary = technicalTokens(groundingText);
  const userPrompt = JSON.stringify({
        studentQuestion: input.message,
        interfaceContext: { view: input.view, focus: input.focus },
        recentConversation: input.recentTurns,
        validationFeedback: input.retryFeedback ?? null,
        turnRequirements: modelTurnRequirements(input.message),
        artworkInput: artworkSourceId ? {
          sourceId: artworkSourceId,
          instruction: "只有确实采用图片观察时才把sourceId放入sourceIds，并把message分成“作品读取结果：”与“通用设计建议：”两段；只描述静态画面可见内容，不推断交互、材质、动态或使用效果。无法可靠读取时不要引用sourceId。",
        } : null,
        followUpConstraint: requiredSequence ? {
          step: requiredSequence.step,
          requiredAction: requiredSequence.actionText,
          instruction: "把requiredAction作为核心回答，并点名关键对象与可观察结果。",
        } : null,
        coursePack: { id: input.pack.id, version: input.pack.version, label: input.pack.label, summary: input.pack.summary },
        projectBrief: input.context.projectBrief,
        projectWorkspace: input.context.workspaceProject ? {
          name: input.context.workspaceProject.project.name,
          customInstructions: input.context.workspaceProject.project.instructions,
          memoryMode: input.context.workspaceProject.project.memoryMode,
          availableFiles: input.context.workspaceProject.files,
          relatedConversations: input.context.workspaceProject.relatedConversationSummaries,
          instruction: "项目说明和文件清单是当前学生项目的受控上下文；不要声称已读取文件内容，除非本轮工具或图像输入提供了内容证据。",
        } : null,
        guardrails: {
          formalAuthority: "FORBIDDEN",
          courseFactsRequireSource: true,
          generalDesignKnowledgeAllowed: true,
          toolsAreReadOnly: true,
        },
        learningState: {
          projectStage: input.context.project?.stage ?? null,
          profile: input.context.profile,
          learnerIdentity: {
            preferredName: input.context.onboarding.nickname
              ?? input.context.onboarding.displayName,
            declaredMajor: input.context.onboarding.major,
            selfAssessedLevel: input.context.onboarding.selfAssessedLevel,
            interests: input.context.onboarding.interests,
            selfReportAuthority: "SOFT_HINT_ONLY",
            instruction: "称呼可自然使用；专业仅作冷启动默认值；能力自评和兴趣只调整表达与推荐。若与系统实测 profile 冲突，必须以 profile 为准。",
          },
          evidenceCount: input.context.evidenceCount,
          evidenceInventory: input.context.evidenceSummary,
          verifiedEvidenceFacts: input.context.verifiedEvidenceFacts,
          activeToolState: input.context.toolState,
        },
        knowledge: input.knowledge.map((item) => ({
          id: item.id,
          title: item.title,
          authority: item.source.authority,
          scope: item.source.scope,
          facts: item.facts,
          actions: item.actions,
        })),
        availableTools: input.availableTools.map((tool) => ({
          id: tool.id,
          capability: { type: tool.owner.type, id: tool.owner.id, label: tool.owner.label },
          label: tool.label,
          inputHint: tool.inputHint,
          access: tool.access,
        })),
        toolObservations: input.toolExecutions.map((execution) => ({
          sourceId: `tool:${execution.observation.callId}`,
          toolId: execution.observation.toolId,
          status: execution.observation.status,
          summary: execution.observation.summary,
          facts: execution.observation.facts,
          output: execution.output,
        })),
        allowed: {
          episodes: input.candidateEpisodes,
          decisionCodes: allowedDecisionCodes,
          responseStrategies: [
            "DIRECT_INSTRUCTION",
            "CONCEPT_EXPLANATION",
            "DIAGNOSTIC_GUIDANCE",
            "TRANSFER_COACHING",
            "REFLECTION_PROMPT",
            "CLARIFY",
          ],
          sourceIds: allowedSourceIds,
          debugSourceIdsToAvoid: debugSourcesToAvoid,
          toolIds: input.availableTools.map(({ id }) => id),
          technicalVocabulary: input.pack.id === "general-design" ? null : {
            allowed: allowedTechnicalVocabulary,
            instruction: "学生可见文字中的拉丁技术词只能来自此列表；列表外概念改用自然中文表达，不自行补充节点、设备、参数或软件命令。",
          },
          actionTypes: allowedActionTypeList,
          actionTypesByEpisode: Object.fromEntries(input.candidateEpisodes.map((episode) => [episode, allowedActionTypes(episode)])),
        },
        responseShape: {
          CALL_TOOL: { step: "CALL_TOOL", toolId: "one allowed tool id", arguments: "object matching inputHint" },
          ANSWER: {
            step: "ANSWER",
            episode: "one allowed episode",
            decisionCode: "one decision code allowed for the selected episode",
            responseStrategy: "one allowed response strategy",
            sourceIds: ["only knowledge, artwork, verified evidence or tool sources actually used in the answer"],
            actionType: "one action allowed for the selected episode, or null",
            title: "short learner-facing title",
            message: "direct, grounded learner-facing answer",
            whyThisStep: "why this answer or next learning step fits the question",
            uncertainty: "what is not yet known; for source-free answers label it 通用设计建议",
            briefPatch: {
              designGoal: { value: "only if discussed this turn", status: "INFERRED or CONFIRMED" },
              nextStep: { value: "one current action", status: "INFERRED or CONFIRMED" },
            },
          },
        },
      });
  const messages: ModelMessage[] = [
    {
      role: "system",
      content: buildDesignAgentSystemPrompt(input.pack),
    },
    {
      role: "user",
      content: userPrompt,
    },
  ];
  const raw = input.artwork && input.client.completeWithImage
    ? await input.client.completeWithImage(messages, {
        mimeType: input.artwork.mimeType,
        bytes: new Uint8Array(input.artwork.bytes),
      }, {
        signal: input.signal,
        totalTimeoutMs: input.totalTimeoutMs,
        onUsage: input.onUsage,
      })
    : await input.client.complete(messages, {
        signal: input.signal,
        totalTimeoutMs: input.totalTimeoutMs,
        onUsage: input.onUsage,
      });

  const decoded = JSON.parse(raw) as Record<string, unknown>;
  if (decoded.step === "CALL_TOOL") {
    const toolStep = AgentModelToolStepSchema.parse(decoded);
    const call = AgentToolCallRequestSchema.parse({ toolId: toolStep.toolId, arguments: toolStep.arguments });
    if (!input.availableTools.some(({ id }) => id === call.toolId)) {
      throw new Error("MODEL_TOOL_OUTSIDE_ALLOWLIST");
    }
    return {
      kind: "CALL_TOOL" as const,
      call,
      appliedPolicyRules: ["BOUND_EXECUTION", "REGISTERED_TOOLS_ONLY", "READ_ONLY_TOOLS_AUTOMATIC"],
    };
  }
  const answerPayload = { ...decoded };
  delete answerPayload.step;
  const decodedSourceIds = Array.isArray(answerPayload.sourceIds) ? answerPayload.sourceIds : [];
  const declaredGeneralAdvice = decodedSourceIds.length === 0
    && typeof answerPayload.uncertainty === "string"
    && answerPayload.uncertainty.includes("通用设计建议");
  const rawDecision = AgentModelDecisionSchema.parse({
    ...answerPayload,
    sourceIds: decodedSourceIds,
    briefPatch: answerPayload.briefPatch ?? {},
    uncertainty: typeof answerPayload.uncertainty === "string" && answerPayload.uncertainty.trim()
      ? answerPayload.uncertainty
      : decodedSourceIds.length > 0
        ? "尚未看到学生的实际作品、现场参数或完整学习证据。"
        : "通用设计建议：尚未看到学生的实际作品与完整使用情境。",
  });
  const learnerFacingDecision = normalizeLearnerFacingDecision(rawDecision, [
    ...input.knowledge.flatMap((item) => [
      { id: item.id, title: item.title },
      ...item.facts.map(({ id, text }) => ({ id, title: text })),
      ...item.actions.map(({ id, text }) => ({ id, title: text })),
    ]),
    ...toolSources.map(({ id, title }) => ({ id, title })),
    ...(artworkSourceId ? [{ id: artworkSourceId, title: "本轮学生作品图片" }] : []),
    ...input.context.verifiedEvidenceFacts.map(({ sourceId, label }) => ({
      id: sourceId,
      title: `已验证学习证据：${label}`,
    })),
  ], input.message, groundingText);
  const citedBoundaries = input.context.verifiedEvidenceFacts
    .filter(({ sourceId, boundary }) => boundary && learnerFacingDecision.sourceIds.includes(sourceId))
    .flatMap(({ boundary }) => boundary ? [boundary] : []);
  const boundedQuestionDecision = {
    ...learnerFacingDecision,
    message: limitLearnerQuestions(learnerFacingDecision.message),
  };
  const normalizedDecision = citedBoundaries.length === 0 ? boundedQuestionDecision : {
    ...boundedQuestionDecision,
    uncertainty: Array.from(new Set([boundedQuestionDecision.uncertainty, ...citedBoundaries])).join(" ").slice(0, 500),
  };
  assertAtMostOneLearnerQuestion(normalizedDecision.message);
  const validSourceIds = new Set(allowedSourceIds);
  const inferredSourceIds = normalizedDecision.sourceIds.length === 0 && !declaredGeneralAdvice
    ? rankKnowledge(normalizedDecision.message, input.knowledge.map(plainKnowledgeItem)).map(({ id }) => id)
    : [];
  const sourcedDecision = inferredSourceIds.length > 0
    ? { ...normalizedDecision, sourceIds: inferredSourceIds.slice(0, input.policy.budgets.maxSources) }
    : normalizedDecision;
  const candidateDecision = {
    ...sourcedDecision,
    sourceIds: minimumSufficientSourceIds(
      sourcedDecision,
      input.knowledge,
      input.message,
      sourcedDecision.uncertainty.includes("通用设计建议") ? 1 : 2,
    ),
  };
  if (
    artworkSourceId && candidateDecision.sourceIds.includes(artworkSourceId) &&
    (!candidateDecision.message.includes("作品读取结果：") || !candidateDecision.message.includes("通用设计建议："))
  ) throw new Error("MODEL_ARTWORK_SECTIONS_REQUIRED");
  validateAnswerGrounding(candidateDecision, input.knowledge, requiredSequence);
  const requiredToolSourceIds = (requestRequiresToolObservationSource(input.message) ? input.toolExecutions : [])
    .filter(({ call, observation }) => call.toolId !== "knowledge-map.search-concepts" && observation.status !== "ERROR")
    .map(({ observation }) => `tool:${observation.callId}`);
  if (requiredToolSourceIds.length > 0 && !candidateDecision.sourceIds.some((id) => requiredToolSourceIds.includes(id))) {
    throw new Error("MODEL_MISSING_TOOL_OBSERVATION_SOURCE");
  }
  const enforcement = enforceModelDecisionPolicy({
    policy: input.policy,
    message: input.message,
    candidateEpisodes: input.candidateEpisodes,
    validSourceIds,
    decision: candidateDecision,
  });
  let decision = enforcement.decision;
  assertTurnRequirementCoverage(input.message, `${decision.title}\n${decision.message}\n${decision.whyThisStep}`);
  decision = applyTechnicalVocabularyPolicy(decision, groundingText, input.pack.id !== "general-design");
  if (decision.uncertainty.includes("通用设计建议")) decision = {
    ...decision, sourceIds: minimumSufficientSourceIds(decision, input.knowledge, input.message, 1),
  };
  return {
    kind: "ANSWER" as const,
    decision,
    appliedPolicyRules: requiredToolSourceIds.length > 0
      ? [...enforcement.appliedRules, "GROUND_TOOL_OBSERVATIONS"]
      : enforcement.appliedRules,
  };
}

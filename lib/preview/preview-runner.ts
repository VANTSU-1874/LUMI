import type { AgentOptions } from "@/lib/agent/orchestrator-context";
import { buildModelClient, selectKnowledge } from "@/lib/agent/orchestrator-context";
import { candidateLearningEpisodes } from "@/lib/agent/router";
import { decideAgentTurn } from "@/lib/agent/model-decision";
import { emptyProjectBrief } from "@/lib/agent/project-brief-memory";
import type { AgentPolicy } from "@/lib/agent/policy-contract";
import { getCoursePack } from "@/lib/course-packs/registry";
import type { DatabaseConnection } from "@/lib/db/client";

import {
  type PreviewFailureStage,
  PreviewResponseSchema,
  type PreviewConversationTurn,
  type PreviewResponse,
} from "./contracts";
import { loadPreviewAttachments } from "./assets";
import type { PreviewScenario, PreviewSuggestion } from "./scenarios";

export class PreviewModelUnavailableError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_ROUTING_UNAVAILABLE"
      | "PREVIEW_MODEL_NOT_CONFIGURED"
      | "PREVIEW_VISION_UNAVAILABLE"
      | "PREVIEW_DECISION_UNAVAILABLE",
    readonly stage: PreviewFailureStage,
    readonly retryable: boolean,
  ) {
    super("预览模型当前不可用");
    this.name = "PreviewModelUnavailableError";
  }
}

/**
 * The model is required to return the same validated agent JSON as the normal
 * tutor. This decoder exposes only its user-facing `message` value while the
 * JSON is still arriving; the complete object is validated before persistence.
 */
export class PreviewMessageDeltaDecoder {
  private raw = "";
  private visible = "";

  push(delta: string) {
    this.raw += delta;
    const match = /"message"\s*:\s*"/.exec(this.raw);
    if (!match || match.index === undefined) return "";
    const value = this.raw.slice(match.index + match[0].length);
    let escaped = false;
    let end = value.length;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        end = index;
        break;
      }
    }
    let decoded: string | null = null;
    for (let length = end; length >= 0; length -= 1) {
      try {
        decoded = JSON.parse(`"${value.slice(0, length)}"`) as string;
        break;
      } catch {
        // A stream may end in the middle of an escape sequence. Remove only
        // that unfinished suffix and wait for the next model delta.
      }
    }
    if (decoded === null || !decoded.startsWith(this.visible)) return "";
    const addition = decoded.slice(this.visible.length);
    this.visible = decoded;
    return addition;
  }
}

export async function runPreviewScenario(input: {
  connection: DatabaseConnection;
  scenario: PreviewScenario;
  suggestion: PreviewSuggestion;
  ai: AgentOptions["ai"];
  modelProviderAdapter?: AgentOptions["modelProviderAdapter"];
  policy: AgentPolicy;
  previousTurns?: readonly PreviewConversationTurn[];
  signal?: AbortSignal;
  onModelJsonDelta?: (delta: string) => void;
}) : Promise<PreviewResponse> {
  const pack = getCoursePack(input.scenario.coursePackId, "1");
  const candidateEpisodes = candidateLearningEpisodes(
    input.suggestion.prompt,
    "AGENT",
    pack.supportedEpisodes,
  );
  if (candidateEpisodes.length === 0) {
    throw new PreviewModelUnavailableError(
      "PREVIEW_ROUTING_UNAVAILABLE",
      "MODEL_SETUP",
      false,
    );
  }
  const knowledge = selectKnowledge(
    input.connection,
    pack.id,
    pack.version,
    input.suggestion.prompt,
  );
  const client = buildModelClient({
    ai: input.ai,
    modelProviderAdapter: input.modelProviderAdapter,
  }, input.policy);
  if (!client) {
    throw new PreviewModelUnavailableError(
      "PREVIEW_MODEL_NOT_CONFIGURED",
      "MODEL_SETUP",
      false,
    );
  }
  // The fixed starter establishes the visual reference for the theme. Every
  // later branch and free follow-up receives that same server-selected input,
  // so a stateless model never has to pretend it can see an earlier image.
  const attachments = input.suggestion.attachments
    ?? input.scenario.initial.attachments
    ?? [];
  if (
    attachments.length > 0
    && (
      !client.capabilities.vision
      || (attachments.length === 1 && !client.completeWithImage)
      || (attachments.length > 1 && !client.completeWithImages)
    )
  ) {
    throw new PreviewModelUnavailableError(
      "PREVIEW_VISION_UNAVAILABLE",
      "MODEL_SETUP",
      false,
    );
  }
  const artworks = attachments.length > 0
    ? await loadPreviewAttachments(attachments)
    : [];
  const result = await decideAgentTurn({
    client,
    message: input.suggestion.prompt,
    view: "AGENT",
    focus: `${input.scenario.focus}；评委选择的固定建议：${input.suggestion.label}`,
    pack,
    candidateEpisodes,
    knowledge,
    context: {
      project: null,
      profile: null,
      onboarding: {
        nickname: null,
        displayName: "评委",
        major: null,
        selfAssessedLevel: null,
        interests: null,
        completedAt: null,
        completed: false,
      },
      evidenceCount: 0,
      evidenceSummary: [],
      verifiedEvidenceFacts: [],
      toolState: null,
      projectBrief: emptyProjectBrief(),
    },
    recentTurns: [
      ...input.scenario.recentTurns,
      ...(input.previousTurns ?? []).map((turn) => ({
        studentMessage: turn.userMessage,
        assistantTitle: "上一轮评估回答",
        assistantMessage: turn.assistantMessage,
        episode: "EXPLORE" as const,
      })),
    ],
    policy: input.policy,
    availableTools: [],
    toolExecutions: [],
    ...(artworks.length === 1 ? { artwork: artworks[0] } : {}),
    ...(artworks.length > 1 ? { artworks } : {}),
    signal: input.signal,
    totalTimeoutMs: input.policy.budgets.modelTimeoutMs,
    onTextDelta: input.onModelJsonDelta,
  });
  if (result.kind !== "ANSWER") {
    throw new PreviewModelUnavailableError(
      "PREVIEW_DECISION_UNAVAILABLE",
      "MODEL_RESPONSE",
      true,
    );
  }
  const sources = knowledge
    .filter((item) => result.decision.sourceIds.includes(item.id))
    .map((item) => ({
      id: item.id,
      title: item.title,
      authority: item.source.authority,
      scope: item.source.scope,
    }));
  return PreviewResponseSchema.parse({
    title: result.decision.title,
    message: result.decision.message,
    whyThisStep: result.decision.whyThisStep,
    uncertainty: result.decision.uncertainty,
    sources,
    branch: {
      directionId: input.scenario.id,
      directionTitle: input.scenario.title,
      suggestionId: input.suggestion.id,
      suggestionLabel: input.suggestion.label,
      outcome: input.suggestion.outcome,
    },
  });
}

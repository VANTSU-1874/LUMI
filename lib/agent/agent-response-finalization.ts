import type { CoursePack, LearningEpisode } from "@/lib/course-packs/contract";
import type { KnowledgeItem, RankedKnowledgeItem } from "@/lib/knowledge/retrieve";

import { buildAnswerProvenance } from "./answer-provenance";
import type { PreparedAgentArtwork } from "./artwork-attachment";
import type { AgentResponseText } from "./artwork-turn-support";
import { AgentReplySchema, type AgentTurnResponse } from "./contracts";
import type { AgentExecutionTrace } from "./execution-trace";
import { clampAgentTurnLatencyMs } from "./latency-limits";
import { actionCard, graphFor } from "./orchestrator-context";
import type { AgentPolicy } from "./policy-contract";
import { createPolicyTrace } from "./policy-enforcement";
import { actionForType, type AgentActionType } from "./router";
import type { AgentToolExecution } from "./tool-contract";
import type { VerifiedEvidenceFact } from "./verified-evidence-facts";

export function finalizeAgentResponse(input: {
  specialty: NonNullable<AgentTurnResponse["specialty"]>;
  episode: LearningEpisode;
  decisionCode: string;
  aiMode: AgentTurnResponse["aiMode"];
  responseText: AgentResponseText;
  pack: CoursePack;
  knowledge: Array<KnowledgeItem | RankedKnowledgeItem>;
  evidenceFacts: VerifiedEvidenceFact[];
  selectedToolExecutions: AgentToolExecution[];
  allToolExecutions: AgentToolExecution[];
  artwork?: PreparedAgentArtwork;
  artworkObserved: boolean;
  actionType: AgentActionType | null;
  policy: AgentPolicy;
  appliedPolicyRules: Set<string>;
  modelDecisions: number;
  trace: AgentExecutionTrace;
  responseStarted: number;
}) {
  const { sources, basis } = buildAnswerProvenance({
    knowledge: input.knowledge,
    evidenceFacts: input.evidenceFacts,
    toolExecutions: input.selectedToolExecutions,
    artwork: input.artwork,
    artworkObserved: input.artworkObserved,
    generalAdviceUsed: input.responseText.uncertainty.includes("通用设计建议"),
    maxSources: input.policy.budgets.maxSources,
  });
  const reply = AgentReplySchema.parse({
    eyebrow: `${input.specialty.label} · ${input.episode}`,
    ...input.responseText,
    graph: graphFor(input.pack.id, input.episode, input.knowledge),
    sources,
    basis,
    actions: input.actionType
      ? [actionCard(actionForType(input.pack, input.episode, input.actionType))]
      : [],
  });
  const responseLatencyMs = clampAgentTurnLatencyMs(performance.now() - input.responseStarted);
  input.trace.add({
    kind: input.aiMode === "MODEL_ASSISTED" ? "FINAL_RESPONSE" : "DEGRADED",
    status: "SUCCEEDED",
    label: input.aiMode === "MODEL_ASSISTED" ? "形成受控回答" : "使用确定性降级回答",
    summary: input.responseText.title,
    toolCallId: null,
    toolId: null,
    latencyMs: responseLatencyMs,
  });
  return {
    responseLatencyMs,
    partial: {
      episode: input.episode,
      decisionCode: input.decisionCode,
      aiMode: input.aiMode,
      policy: createPolicyTrace({
        policy: input.policy,
        modelDecisions: input.modelDecisions,
        toolCalls: input.allToolExecutions.length,
        appliedRules: input.appliedPolicyRules,
      }),
      executionSteps: input.trace.snapshot(),
      reply,
      specialty: input.specialty,
    },
  };
}

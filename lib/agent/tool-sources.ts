import { z } from "zod";

import type { AgentSource } from "./contracts";
import type { AgentToolExecution } from "./tool-contract";
import { getAgentTool } from "./tool-registry";

export function toolSourceId(callId: string) {
  return `tool:${callId}`;
}

export function toolExecutionSource(execution: AgentToolExecution): AgentSource | null {
  if (execution.observation.status === "ERROR") return null;
  if (execution.call.toolId === "design-calculator.compute") return null;
  const descriptor = getAgentTool(execution.call.toolId).descriptor;
  const authority = execution.call.toolId === "touchdesigner-cases.search-network"
    ? "ANONYMIZED_CASE" as const
    : execution.call.toolId === "knowledge-map.search-concepts"
      ? "COURSE_DESIGN" as const
      : "LEARNING_RECORD" as const;
  return {
    id: toolSourceId(execution.observation.callId),
    title: `${descriptor.owner.label} · ${descriptor.label}`,
    authority,
    scope: execution.observation.summary,
  };
}

const KnowledgeToolOutputSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(160),
    topic: z.enum([
      "DESIGN_FOUNDATIONS",
      "COURSE_PRINCIPLES",
      "DIGISHOW_SIGNALS",
      "TOUCHDESIGNER_FOUNDATIONS",
      "OSC_TROUBLESHOOTING",
      "BOOK_DESIGN_PRINCIPLES",
      "INFORMATION_HIERARCHY",
      "LAYOUT_EVIDENCE",
    ]),
    authority: z.enum(["OFFICIAL", "COURSE_DESIGN", "TEACHER_EXPERIENCE", "ANONYMIZED_CASE"]),
    scope: z.string().min(1).max(300),
  }).passthrough()).max(3),
}).passthrough();

function parsedKnowledgeToolOutput(execution: AgentToolExecution) {
  if (
    execution.observation.status === "ERROR"
    || execution.call.toolId !== "knowledge-map.search-concepts"
  ) return null;
  const parsed = KnowledgeToolOutputSchema.safeParse(execution.output);
  return parsed.success ? parsed.data : null;
}

export function toolExecutionProvenanceSources(execution: AgentToolExecution): AgentSource[] {
  if (execution.observation.status === "ERROR") return [];
  if (execution.call.toolId === "knowledge-map.search-concepts") {
    const output = parsedKnowledgeToolOutput(execution);
    return output
      ? output.items.map(({ id, title, authority, scope }) => ({
        id,
        title,
        authority,
        scope,
      }))
      : [];
  }
  const source = toolExecutionSource(execution);
  return source ? [source] : [];
}

export function toolExecutionHasCourseKnowledge(execution: AgentToolExecution) {
  return parsedKnowledgeToolOutput(execution)?.items.some(({ topic }) => (
    topic !== "DESIGN_FOUNDATIONS"
  )) ?? false;
}

export function toolExecutionSources(executions: readonly AgentToolExecution[]) {
  return executions.flatMap((execution) => {
    const source = toolExecutionSource(execution);
    return source ? [source] : [];
  });
}

export function requestRequiresToolObservationSource(message: string) {
  const normalized = message.normalize("NFKC");
  return /(结合|根据|读取|查看|看看).{0,12}(我|我的|当前|现在).{0,12}(项目|编排|证据|状态|做到哪里)/.test(normalized)
    || /(我|我的).{0,6}(现在|目前|当前).{0,8}(项目|编排|证据|状态|做到哪里|进度)/.test(normalized);
}

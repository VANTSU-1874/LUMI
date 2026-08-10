import { z } from "zod";

import { KnowledgeTopicSchema } from "@/lib/knowledge/retrieve";

import type { AgentSource } from "./contracts";
import {
  AgentEvidenceToolOutputV2Schema,
} from "./evidence-tool-v2";
import type { AgentToolExecution } from "./tool-contract";
import { getAgentTool } from "./tool-registry";

export function toolSourceId(callId: string) {
  return `tool:${callId}`;
}

export function toolExecutionSource(execution: AgentToolExecution): AgentSource | null {
  if (execution.observation.status === "ERROR") return null;
  if (execution.call.toolId === "design-calculator.compute") return null;
  const descriptor = getAgentTool(execution.call.toolId).descriptor;
  if (
    execution.call.toolId
      === "knowledge-map.search-evidence"
  ) {
    return null;
  }
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
    topic: KnowledgeTopicSchema,
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

function parsedEvidenceToolOutput(
  execution: AgentToolExecution,
) {
  if (
    execution.observation.status === "ERROR"
    || execution.call.toolId
      !== "knowledge-map.search-evidence"
  ) {
    return null;
  }
  const parsed =
    AgentEvidenceToolOutputV2Schema.safeParse(
      execution.output,
    );
  return parsed.success ? parsed.data : null;
}

function evidenceToolSources(
  execution: AgentToolExecution,
): AgentSource[] {
  const output =
    parsedEvidenceToolOutput(execution);
  if (!output) return [];
  const sourcesById = new Map(
    output.evidence.sources.map((source) => [
      source.sourceId,
      source,
    ]),
  );
  const assetsById = new Map(
    output.evidence.assets.map((asset) => [
      asset.assetId,
      asset,
    ]),
  );
  return output.evidence.nodes.flatMap((node) => {
    const source =
      sourcesById.get(node.sourceId);
    if (!source) return [];
    const asset = node.assetId
      ? assetsById.get(node.assetId) ?? null
      : null;
    const region = node.assetId
      ? output.evidence.regions.find(
          (candidate) =>
            candidate.assetId === node.assetId
            && candidate.objectId
              === node.objectId,
        ) ?? null
      : null;
    return [{
      id: node.nodeId,
      title: source.title,
      authority: source.authority,
      scope: source.scope,
      evidence: {
        schemaVersion: 2 as const,
        bundleId: output.bundle.bundleId,
        objectId: node.objectId,
        nodeId: node.nodeId,
        sourceId: node.sourceId,
        evidenceKind: node.evidenceKind,
        assetId: node.assetId,
        assetSha256: asset?.sha256 ?? null,
        assetWidthPx: asset?.widthPx ?? null,
        assetHeightPx: asset?.heightPx ?? null,
        region: region
          ? {
              regionId: region.regionId,
              bbox: region.bbox,
            }
          : null,
        previewUrl:
          asset?.previewUrl
          ?? region?.previewUrl
          ?? null,
        corpusBundleHash:
          output.bundle.corpusBundleHash,
        activeIndexBundleHash:
          output.bundle
            .activeIndexBundleHash,
      },
    } satisfies AgentSource];
  });
}

export function toolExecutionProvenanceSources(execution: AgentToolExecution): AgentSource[] {
  if (execution.observation.status === "ERROR") return [];
  if (
    execution.call.toolId
      === "knowledge-map.search-evidence"
  ) {
    return evidenceToolSources(execution);
  }
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
  if (
    execution.call.toolId
      === "knowledge-map.search-evidence"
  ) {
    return parsedEvidenceToolOutput(execution)
      ?.evidence.nodes.some(
        ({ evidenceKind, excerpt }) =>
          evidenceKind === "KNOWLEDGE_FACT"
          && Boolean(excerpt?.trim()),
      ) ?? false;
  }
  return parsedKnowledgeToolOutput(execution)
    ?.items.some(({ topic }) => (
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

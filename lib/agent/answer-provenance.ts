import { createHash } from "node:crypto";

import type { KnowledgeItem, RankedKnowledgeItem } from "@/lib/knowledge/retrieve";
import { normalizePublicHttpsUrl } from "@/lib/security/public-web-url";

import type { AgentAnswerBasis, AgentSource } from "./contracts";
import type { AgentToolExecution } from "./tool-contract";
import {
  toolExecutionHasCourseKnowledge,
  toolExecutionProvenanceSources,
} from "./tool-sources";
import type { VerifiedEvidenceFact } from "./verified-evidence-facts";
import type { PreparedAgentArtwork } from "./artwork-attachment";

export interface AgentWebCitation {
  title?: string | null;
  url: string;
}

const PUBLIC_WEB_SCOPE = "由联网检索返回的公开网页；未经过课程组核验，使用前需核对原文、作者与发布日期。";
const EXTERNAL_WEB_SEARCH_TOOL_ID = "external-web.search";

function normalizePublicWebUrl(value: string) {
  const normalized = normalizePublicHttpsUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  url.hash = "";
  url.searchParams.sort();
  return url.toString();
}

function webCitationSources(citations: readonly AgentWebCitation[]) {
  const seenUrls = new Set<string>();
  const sources: AgentSource[] = [];
  for (const citation of citations) {
    const url = normalizePublicWebUrl(citation.url);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const title = citation.title
      ?.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 160)
      || `公开网页：${new URL(url).hostname}`.slice(0, 160);
    sources.push({
      id: `web:${createHash("sha256").update(url).digest("hex").slice(0, 24)}`,
      title,
      authority: "PUBLIC_WEB",
      scope: PUBLIC_WEB_SCOPE,
      url,
    });
    if (sources.length === 3) break;
  }
  return sources;
}

export function buildAnswerProvenance(input: {
  knowledge: Array<KnowledgeItem | RankedKnowledgeItem>;
  evidenceFacts: VerifiedEvidenceFact[];
  toolExecutions: AgentToolExecution[];
  artwork?: PreparedAgentArtwork;
  artworkObserved?: boolean;
  generalAdviceUsed?: boolean;
  webCitations?: readonly AgentWebCitation[];
  maxSources: number;
}) {
  const artworkSources: AgentSource[] = input.artwork && input.artworkObserved ? [{
    id: `artwork:${input.artwork.id}`,
    title: "本轮学生作品图片",
    authority: "STUDENT_ARTWORK",
    scope: "只依据这张静态画面中可见的构图、色彩、文字、形态与层级。",
  }] : [];
  const webSources = webCitationSources(input.webCitations ?? []);
  const knowledgeSources: AgentSource[] = input.knowledge.map((item) => ({
    id: item.id,
    title: item.title,
    authority: item.source.authority,
    scope: item.source.scope,
  }));
  const evidenceSources: AgentSource[] = input.evidenceFacts.map((fact) => ({
    id: fact.sourceId,
    title: `已验证学习证据：${fact.label}`,
    authority: "LEARNING_RECORD",
    scope: fact.boundary
      ? `由规则或教师确认；${fact.boundary}`
      : "由规则或教师确认；仅限当前学生当前项目，不包含本地文件路径。",
  }));
  const internalToolExecutions = input.toolExecutions.filter(
    ({ call }) => call.toolId !== EXTERNAL_WEB_SEARCH_TOOL_ID,
  );
  const usableInternalToolExecutions = internalToolExecutions.filter(
    ({ observation }) => observation.status !== "ERROR",
  );
  const toolSources = usableInternalToolExecutions.flatMap(toolExecutionProvenanceSources);
  const basis: AgentAnswerBasis[] = [];
  const hasGeneralReferences = input.knowledge.some(({ topic }) => topic === "DESIGN_FOUNDATIONS");
  const hasCourseKnowledge = input.knowledge.some(({ topic }) => topic !== "DESIGN_FOUNDATIONS");
  if (input.artworkObserved) {
    basis.push({ kind: "ARTWORK_OBSERVATION", label: "作品读取结果" });
  }
  if (webSources.length > 0) {
    basis.push({ kind: "WEB_RESEARCH", label: "联网检索" });
  }
  if (input.artworkObserved || input.generalAdviceUsed || hasGeneralReferences) {
    basis.push({ kind: "GENERAL_DESIGN", label: "通用设计建议" });
  }
  const usedCourseKnowledgeTool = usableInternalToolExecutions.some(toolExecutionHasCourseKnowledge);
  if (hasCourseKnowledge || usedCourseKnowledgeTool) {
    basis.push({ kind: "COURSE_KNOWLEDGE", label: "课程知识" });
  }
  if (input.evidenceFacts.length > 0) basis.push({ kind: "LEARNING_RECORD", label: "已验证学习记录" });
  if (usableInternalToolExecutions.some(({ call }) => call.toolId === "touchdesigner-cases.search-network")) {
    basis.push({ kind: "CASE_EVIDENCE", label: "案例依据" });
  }
  const usedCalculator = usableInternalToolExecutions.some(({ call, observation }) => (
    call.toolId === "design-calculator.compute" && observation.status === "SUCCESS"
  ));
  const usedOtherObservation = usableInternalToolExecutions.some(({ call }) => (
    call.toolId !== "touchdesigner-cases.search-network"
    && call.toolId !== "design-calculator.compute"
  ));
  if (usedCalculator) basis.push({ kind: "CALCULATION", label: "确定性计算结果" });
  if (usedOtherObservation) basis.push({ kind: "TOOL_OBSERVATION", label: "工具读取结果" });
  if (basis.length === 0) basis.push({ kind: "GENERAL_DESIGN", label: "通用设计建议" });
  const sourceIds = new Set<string>();
  const sources = [...artworkSources, ...webSources, ...knowledgeSources, ...evidenceSources, ...toolSources]
    .filter(({ id }) => {
      if (sourceIds.has(id)) return false;
      sourceIds.add(id);
      return true;
    })
    .slice(0, input.maxSources);
  return {
    sources,
    basis: basis.slice(0, 8),
  };
}

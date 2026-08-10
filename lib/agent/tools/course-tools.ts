import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { loadStoredCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { KnowledgeAuthoritySchema, KnowledgeTopicSchema } from "@/lib/knowledge/retrieve";
import { retrieveKnowledgeHybrid } from "@/lib/knowledge/semantic-retrieve";

import type { AgentToolDefinition } from "../tool-contract";
import { AgentToolExecutionError } from "../tool-contract";
import {
  AgentEvidenceToolOutputV2Schema,
} from "../evidence-tool-v2";
import { getCapability } from "../capability-registry";

const QueryInputSchema = z.object({ query: z.string().trim().min(2).max(120) }).strict();
const ConceptSearchOutputSchema = z.object({
  retrieval: z.object({
    strategy: z.enum(["HYBRID", "LEXICAL_FALLBACK"]),
    semanticStatus: z.enum(["USED", "UNAVAILABLE", "FAILED"]),
    errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/).nullable(),
  }).strict(),
  items: z.array(z.object({
    id: z.string(),
    title: z.string(),
    topic: KnowledgeTopicSchema,
    authority: KnowledgeAuthoritySchema,
    verifiedDate: z.iso.date(),
    scope: z.string(),
    locator: z.object({
      kind: z.enum(["URL", "LOCAL_DOCUMENT"]),
      value: z.string().trim().min(1).max(500),
    }).strict(),
    retrieval: z.object({
      method: z.enum(["LEXICAL", "SEMANTIC", "HYBRID"]),
      confidence: z.number().min(0).max(1),
      lexicalScore: z.number().nonnegative(),
      semanticScore: z.number().min(0).max(1).nullable(),
    }).strict(),
    facts: z.array(z.string()).max(8),
    actions: z.array(z.string()).max(8),
  }).strict()).max(3),
}).strict();

export const courseConceptSearchTool = {
  descriptor: {
    id: "knowledge-map.search-concepts",
    version: "1",
    adapterId: "knowledge-map",
    owner: getCapability("course-reference"),
    label: "检索课程概念与操作依据",
    description: "在当前课程包版本中检索概念、事实和允许的教学动作，不使用模型外部记忆。",
    inputHint: "arguments 为 {\"query\":\"要在内部课程语料中查找的概念或问题\"}。",
    effect: "READ_CONTEXT",
    access: "READ_ONLY",
    timeoutMs: 8_000,
    recommendedByCoursePacks: [
      { id: "general-design", version: "1" },
      { id: "digital-interaction", version: "1" },
      { id: "book-design", version: "1" },
      { id: "layout-design", version: "1" },
      { id: "brand-vi-design", version: "1" },
    ],
  },
  inputSchema: QueryInputSchema,
  outputSchema: ConceptSearchOutputSchema,
  async execute(context, rawInput) {
    const input = QueryInputSchema.parse(rawInput);
    const result = await retrieveKnowledgeHybrid(
      input.query,
      loadStoredCoursePackKnowledge(context.connection, context.pack.id, context.pack.version),
      context.embeddingProvider,
      { signal: context.signal },
    );
    return {
      retrieval: {
        strategy: result.strategy,
        semanticStatus: result.semanticStatus,
        errorCode: result.errorCode,
      },
      items: result.items.slice(0, 3).map((item) => ({
        id: item.id,
        title: item.title,
        topic: item.topic,
        authority: item.source.authority,
        verifiedDate: item.source.verifiedDate,
        scope: item.source.scope,
        locator: item.source.url
          ? { kind: "URL" as const, value: item.source.url }
          : { kind: "LOCAL_DOCUMENT" as const, value: item.source.localDocument! },
        retrieval: item.retrieval ?? {
          method: "LEXICAL" as const,
          confidence: 0,
          lexicalScore: item.score,
          semanticScore: null,
        },
        facts: item.facts.slice(0, 8).map(({ text }) => text),
        actions: item.actions.slice(0, 8).map(({ text }) => text),
      })),
    };
  },
  summarize(rawOutput) {
    const output = ConceptSearchOutputSchema.parse(rawOutput);
    const method = output.retrieval.semanticStatus === "USED"
      ? "向量与词法混合检索"
      : output.retrieval.semanticStatus === "FAILED"
        ? "向量不可用后的词法检索"
        : "词法检索";
    return output.items.length === 0
      ? {
          summary: `${method}未命中内部课程语料。`,
          facts: [
            `检索策略：${output.retrieval.strategy}`,
            ...(output.retrieval.errorCode ? [`向量错误：${output.retrieval.errorCode}`] : []),
          ],
          empty: true,
        }
      : {
          summary: `${method}命中 ${output.items.length} 条可追溯课程依据。`,
          facts: output.items.map((item) => (
            `${item.title}（${item.retrieval.method}，置信度${item.retrieval.confidence}）：${item.facts[0] ?? item.scope}`
          )),
          empty: false,
        };
  },
} satisfies AgentToolDefinition;

export const courseEvidenceSearchTool = {
  descriptor: {
    id: "knowledge-map.search-evidence",
    version: "1",
    adapterId: "knowledge-map",
    owner: getCapability("course-reference"),
    label: "检索多模态课程证据",
    description:
      "从当前课程包的本地图文索引中检索有界证据，保留节点、图片区域、来源和索引身份。",
    inputHint:
      "arguments 为 {\"query\":\"要在内部课程图文语料中查找的学生问题\"}。",
    effect: "READ_CONTEXT",
    access: "READ_ONLY",
    timeoutMs: 10_000,
    recommendedByCoursePacks: [
      { id: "general-design", version: "1" },
      { id: "digital-interaction", version: "1" },
      { id: "book-design", version: "1" },
      { id: "layout-design", version: "1" },
      { id: "brand-vi-design", version: "1" },
    ],
  },
  inputSchema: QueryInputSchema,
  outputSchema: AgentEvidenceToolOutputV2Schema,
  strictInputSchema: true,
  async execute(context, rawInput) {
    if (!context.evidenceSearchV2) {
      throw new AgentToolExecutionError(
        "EVIDENCE_RUNTIME_UNAVAILABLE",
        "多模态课程证据运行时暂不可用，未使用不完整结果。",
      );
    }
    const input = QueryInputSchema.parse(rawInput);
    return context.evidenceSearchV2.search({
      query: input.query,
      coursePackId: context.pack.id,
      coursePackVersion: context.pack.version,
      signal: context.signal,
    });
  },
  summarize(rawOutput) {
    const output =
      AgentEvidenceToolOutputV2Schema.parse(
        rawOutput,
      );
    const nodes = output.evidence.nodes;
    const degraded =
      output.bundle.status === "DEGRADED"
      || output.bundle.capabilitiesLost.length > 0;
    if (nodes.length === 0) {
      return {
        summary: degraded
          ? "本地多模态检索已降级，但没有保留可用课程证据。"
          : "本地多模态检索未命中课程证据。",
        facts: output.channels.map(
          ({ channel, status, hitCount }) =>
            `${channel}：${status}，命中 ${hitCount}`,
        ),
        empty: true,
      };
    }
    return {
      summary:
        `${degraded ? "降级后的" : ""}本地多模态检索保留 `
        + `${nodes.length} 个可追溯节点、`
        + `${output.evidence.assets.length} 张参考图。`,
      facts: nodes.slice(0, 4).map((node) =>
        `${node.evidenceKind} · ${node.nodeId}：`
        + (
          node.excerpt?.slice(0, 180)
          ?? "课程参考图或结构节点"
        )),
      empty: false,
    };
  },
} satisfies AgentToolDefinition;

const CaseManifestSchema = z.object({
  modules: z.array(z.object({
    title: z.string(),
    cases: z.array(z.object({
      id: z.string(),
      title: z.string(),
      activeVersionId: z.string(),
      versions: z.array(z.object({
        id: z.string(),
        label: z.string(),
        structureId: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
        status: z.enum(["PARSED", "UNREADABLE"]),
      })),
    })),
  })),
});

const StructureSchema = z.object({
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  familyCounts: z.record(z.string(), z.number().int().nonnegative()),
  nodes: z.array(z.object({
    name: z.string(), family: z.string(), operatorType: z.string(), networkPath: z.string(),
    annotation: z.object({ title: z.string(), body: z.string() }).nullable(),
  })),
});

const CaseNetworkOutputSchema = z.object({
  match: z.object({
    caseId: z.string(), title: z.string(), versionLabel: z.string(),
    nodeCount: z.number().int(), edgeCount: z.number().int(),
    familyCounts: z.record(z.string(), z.number().int()),
    representativeNodes: z.array(z.object({ name: z.string(), family: z.string(), operatorType: z.string() }).strict()).max(12),
    annotations: z.array(z.object({ title: z.string(), body: z.string() }).strict()).max(8),
  }).strict().nullable(),
}).strict();

function bigrams(value: string) {
  const normalized = value.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
  return new Set(Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2)));
}

function similarity(query: string, title: string) {
  const normalizedQuery = query.normalize("NFKC").toLowerCase();
  const normalizedTitle = title.normalize("NFKC").toLowerCase();
  if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) return 1_000;
  const queryPairs = bigrams(query);
  return [...bigrams(title)].filter((pair) => queryPairs.has(pair)).length;
}

export const touchDesignerCaseNetworkTool = {
  descriptor: {
    id: "touchdesigner-cases.search-network",
    version: "1",
    adapterId: "touchdesigner-cases",
    owner: getCapability("touchdesigner"),
    label: "查找真实案例节点网络",
    description: "从已解析的 TouchDesigner 课程案例中选择最相关主工程，读取节点、连线、家族和教师注释摘要。",
    inputHint: "arguments 为 {\"query\":\"效果或案例名称\"}，不能上传路径或结构编号。",
    effect: "READ_CONTEXT",
    access: "READ_ONLY",
    timeoutMs: 5_000,
    recommendedByCoursePacks: [{ id: "digital-interaction", version: "1" }],
  },
  inputSchema: QueryInputSchema,
  outputSchema: CaseNetworkOutputSchema,
  async execute(context, rawInput) {
    const input = QueryInputSchema.parse(rawInput);
    const dataRoot = path.join(process.cwd(), "data", "touchdesigner");
    const manifest = CaseManifestSchema.parse(JSON.parse(await readFile(
      path.join(dataRoot, "posters-cases.generated.json"),
      { encoding: "utf8", signal: context.signal },
    )));
    const candidates = manifest.modules.flatMap((module) => module.cases.map((item) => ({ ...item, moduleTitle: module.title })));
    const selected = candidates.map((item) => ({ item, score: similarity(input.query, `${item.moduleTitle} ${item.title}`) }))
      .sort((left, right) => right.score - left.score)[0];
    if (!selected || selected.score === 0) return { match: null };
    const version = selected.item.versions.find(({ id }) => id === selected.item.activeVersionId);
    if (!version?.structureId || version.status !== "PARSED") return { match: null };
    const structure = StructureSchema.parse(JSON.parse(await readFile(
      path.join(dataRoot, "structures", `${version.structureId}.json`),
      { encoding: "utf8", signal: context.signal },
    )));
    const representativeNodes = [...structure.nodes]
      .sort((left, right) => left.networkPath.split("/").length - right.networkPath.split("/").length)
      .slice(0, 12)
      .map(({ name, family, operatorType }) => ({ name, family, operatorType }));
    const annotations = structure.nodes.flatMap(({ annotation }) => annotation ? [annotation] : []).slice(0, 8);
    return {
      match: {
        caseId: selected.item.id,
        title: selected.item.title,
        versionLabel: version.label,
        nodeCount: structure.nodeCount,
        edgeCount: structure.edgeCount,
        familyCounts: structure.familyCounts,
        representativeNodes,
        annotations,
      },
    };
  },
  summarize(rawOutput) {
    const output = CaseNetworkOutputSchema.parse(rawOutput);
    if (!output.match) return { summary: "没有找到可解析的相近案例网络。", facts: ["案例检索结果为空"], empty: true };
    return {
      summary: `找到“${output.match.title}”主工程，共 ${output.match.nodeCount} 个节点、${output.match.edgeCount} 条连接。`,
      facts: [
        `节点家族：${Object.entries(output.match.familyCounts).map(([family, count]) => `${family} ${count}`).join("、")}`,
        `代表节点：${output.match.representativeNodes.map(({ name }) => name).join("、")}`,
        ...output.match.annotations.map((annotation) => `${annotation.title}：${annotation.body}`),
      ],
      empty: false,
    };
  },
} satisfies AgentToolDefinition;

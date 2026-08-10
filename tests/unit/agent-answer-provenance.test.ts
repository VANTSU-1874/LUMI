import { describe, expect, it } from "vitest";

import { buildAnswerProvenance } from "@/lib/agent/answer-provenance";
import { AgentSourceSchema } from "@/lib/agent/contracts";
import type { AgentToolExecution } from "@/lib/agent/tool-contract";
import type { KnowledgeItem } from "@/lib/knowledge/retrieve";

const knowledge = {
  id: "course-source",
  title: "课程知识",
  topic: "COURSE_PRINCIPLES",
  tags: ["设计"],
  content: "课程内容",
  facts: [],
  actions: [],
  source: {
    authority: "COURSE_DESIGN",
    verifiedDate: "2026-07-16",
    scope: "测试来源",
    localDocument: "test.md",
  },
} satisfies KnowledgeItem;

function knowledgeToolExecution(items: Array<Record<string, unknown>>): AgentToolExecution {
  return {
    call: { toolId: "knowledge-map.search-concepts", arguments: { query: "反馈回路" } },
    observation: {
      callId: "11111111-1111-4111-8111-111111111111",
      toolId: "knowledge-map.search-concepts",
      toolVersion: "1",
      adapterId: "knowledge-map",
      status: items.length > 0 ? "SUCCESS" : "EMPTY",
      summary: items.length > 0 ? "命中内部课程语料。" : "未命中内部课程语料。",
      facts: [],
      errorCode: null,
      latencyMs: 1,
    },
    output: {
      retrieval: { strategy: "HYBRID", semanticStatus: "USED", errorCode: null },
      items: items.map((item) => ({ topic: "COURSE_PRINCIPLES", ...item })),
    },
  } as AgentToolExecution;
}

function evidenceToolExecution(): AgentToolExecution {
  return {
    call: {
      toolId: "knowledge-map.search-evidence",
      arguments: { query: "标题图片和亮色都很抢，先怎么判断冲突" },
    },
    observation: {
      callId: "33333333-3333-4333-8333-333333333333",
      toolId: "knowledge-map.search-evidence",
      toolVersion: "1",
      adapterId: "knowledge-map",
      status: "SUCCESS",
      summary: "命中 2 个课程证据节点。",
      facts: [],
      errorCode: null,
      latencyMs: 12,
    },
    output: {
      schemaVersion: 2,
      kind: "KNOWLEDGE_MAP_SEARCH_EVIDENCE",
      bundle: {
        bundleId: "bundle-test",
        status: "SUCCESS",
        queryHash: "1".repeat(64),
        corpusBundleHash: "2".repeat(64),
        activeIndexBundleHash: "3".repeat(64),
        capabilitiesLost: [],
      },
      channels: [
        {
          channel: "LEXICAL",
          status: "SUCCESS",
          hitCount: 2,
          indexVersionId: "lexical-v1",
          modelId: null,
          modelRevision: null,
        },
        {
          channel: "TEXT_VECTOR",
          status: "SUCCESS",
          hitCount: 2,
          indexVersionId: "text-v1",
          modelId: "bge-test",
          modelRevision: "revision-1",
        },
        {
          channel: "VISUAL_VECTOR",
          status: "SUCCESS",
          hitCount: 1,
          indexVersionId: "visual-v1",
          modelId: "siglip-test",
          modelRevision: "revision-1",
        },
      ],
      evidence: {
        nodes: [
          {
            nodeId: "node-text-1",
            objectId: "layout-object-1",
            sourceId: "source-layout-1",
            kind: "TEXT",
            relation: "PRIMARY",
            evidenceKind: "KNOWLEDGE_FACT",
            excerpt: "先分别检查标题、图片和亮色各自在争夺什么注意力。",
            assetId: null,
          },
          {
            nodeId: "node-image-1",
            objectId: "layout-object-1",
            sourceId: "source-layout-1",
            kind: "IMAGE",
            relation: "SIBLING",
            evidenceKind: "VISUAL_REFERENCE",
            excerpt: "课程参考图中的标题与亮色区域。",
            assetId: "asset-layout-1",
          },
        ],
        assets: [{
          assetId: "asset-layout-1",
          objectId: "layout-object-1",
          sha256: "4".repeat(64),
          widthPx: 1200,
          heightPx: 800,
          previewUrl: "/api/knowledge/assets/asset-layout-1",
        }],
        regions: [{
          regionId: "region-layout-1",
          objectId: "layout-object-1",
          assetId: "asset-layout-1",
          regionNodeId: "node-image-1",
          bbox: {
            coordinateSpace: "NORMALIZED",
            x: 0.1,
            y: 0.2,
            width: 0.4,
            height: 0.5,
          },
          previewUrl: "/api/knowledge/assets/asset-layout-1",
        }],
        sources: [{
          sourceId: "source-layout-1",
          objectId: "layout-object-1",
          title: "视觉层级冲突判断",
          authority: "COURSE_DESIGN",
          verifiedDate: "2026-07-30",
          scope: "版式设计课程中的视觉层级诊断。",
        }],
      },
      usageRules: {
        knowledgeFacts: "只把带 excerpt 的课程节点作为课程知识事实。",
        visualReferences: "图片和区域是课程参考图，只描述其中可见内容，不当作学生当前作品。",
        inference: "超出节点文字或参考图可见内容的判断必须明确标为推断。",
        uncertainty: "证据不足或通道降级时要说明不确定性，不得补造来源。",
      },
    },
  } as AgentToolExecution;
}

function calculatorToolExecution(status: "SUCCESS" | "ERROR" = "SUCCESS"): AgentToolExecution {
  return {
    call: {
      toolId: "design-calculator.compute",
      arguments: {
        calculation: { kind: "COLOR_CONTRAST", foreground: "#000000", background: "#FFFFFF" },
      },
    },
    observation: {
      callId: "22222222-2222-4222-8222-222222222222",
      toolId: "design-calculator.compute",
      toolVersion: "1",
      adapterId: "design-calculator",
      status,
      summary: status === "SUCCESS" ? "对比度为 21:1。" : "计算失败。",
      facts: [],
      errorCode: status === "ERROR" ? "TOOL_EXECUTION_FAILED" : null,
      latencyMs: 1,
    },
    output: status === "SUCCESS" ? { kind: "COLOR_CONTRAST", ratio: 21 } : null,
  } as AgentToolExecution;
}

const generalReference = {
  ...knowledge,
  id: "general-reference",
  title: "通用设计参考",
  topic: "DESIGN_FOUNDATIONS",
  facts: [{ id: "design-reference-fact", text: "通用设计参考事实。" }],
  actions: [{ id: "design-clarify-goal", text: "先明确目标。" }],
} satisfies KnowledgeItem;

describe("agent answer provenance", () => {
  it("labels course enhancement and general design advice separately in a mixed answer", () => {
    const result = buildAnswerProvenance({
      knowledge: [knowledge],
      evidenceFacts: [],
      toolExecutions: [],
      generalAdviceUsed: true,
      maxSources: 5,
    });

    expect(result.basis).toEqual(expect.arrayContaining([
      { kind: "GENERAL_DESIGN", label: "通用设计建议" },
      { kind: "COURSE_KNOWLEDGE", label: "课程知识" },
    ]));
  });

  it("keeps sourced design foundations labeled as general design rather than course knowledge", () => {
    const result = buildAnswerProvenance({
      knowledge: [generalReference],
      evidenceFacts: [],
      toolExecutions: [],
      maxSources: 5,
    });

    expect(result.sources).toHaveLength(1);
    expect(result.basis).toEqual([{ kind: "GENERAL_DESIGN", label: "通用设计建议" }]);
  });

  it("expands real knowledge-tool provenance and deduplicates an already selected source", () => {
    const execution = knowledgeToolExecution([
      {
        id: "course-source",
        title: "课程知识",
        authority: "COURSE_DESIGN",
        scope: "测试来源",
      },
      {
        id: "td-feedback-top",
        title: "Feedback TOP：目标节点、回路与单帧重置",
        authority: "OFFICIAL",
        scope: "Feedback TOP 的 Target TOP 与反馈回路",
      },
    ]);
    const result = buildAnswerProvenance({
      knowledge: [knowledge],
      evidenceFacts: [],
      toolExecutions: [execution],
      maxSources: 5,
    });

    expect(result.sources.map(({ id }) => id)).toEqual(["course-source", "td-feedback-top"]);
    expect(result.sources[1]).toMatchObject({ authority: "OFFICIAL", scope: expect.stringContaining("Target TOP") });
    expect(result.basis).toEqual(expect.arrayContaining([
      { kind: "COURSE_KNOWLEDGE", label: "课程知识" },
      { kind: "TOOL_OBSERVATION", label: "工具读取结果" },
    ]));
  });

  it("does not invent a course source when the knowledge tool returns no match", () => {
    const result = buildAnswerProvenance({
      knowledge: [],
      evidenceFacts: [],
      toolExecutions: [knowledgeToolExecution([])],
      maxSources: 5,
    });

    expect(result.sources).toEqual([]);
    expect(result.basis).not.toContainEqual({ kind: "COURSE_KNOWLEDGE", label: "课程知识" });
  });

  it("does not invent a course source when the knowledge tool fails", () => {
    const failed = knowledgeToolExecution([]);
    failed.observation.status = "ERROR";
    failed.observation.errorCode = "TOOL_EXECUTION_FAILED";
    failed.output = null;
    const result = buildAnswerProvenance({
      knowledge: [],
      evidenceFacts: [],
      toolExecutions: [failed],
      maxSources: 5,
    });

    expect(result.sources).toEqual([]);
    expect(result.basis).not.toContainEqual({ kind: "COURSE_KNOWLEDGE", label: "课程知识" });
  });

  it("labels only successful calculator output as deterministic calculation without inventing a source", () => {
    const successful = buildAnswerProvenance({
      knowledge: [],
      evidenceFacts: [],
      toolExecutions: [calculatorToolExecution()],
      maxSources: 5,
    });
    const failed = buildAnswerProvenance({
      knowledge: [],
      evidenceFacts: [],
      toolExecutions: [calculatorToolExecution("ERROR")],
      maxSources: 5,
    });

    expect(successful.sources).toEqual([]);
    expect(successful.basis).toEqual([{ kind: "CALCULATION", label: "确定性计算结果" }]);
    expect(failed.sources).toEqual([]);
    expect(failed.basis).not.toContainEqual({ kind: "CALCULATION", label: "确定性计算结果" });
  });

  it("keeps calculation visible when a turn also uses every other legitimate basis type", () => {
    const result = buildAnswerProvenance({
      knowledge: [knowledge],
      evidenceFacts: [{
        sourceId: "evidence:1",
        evidenceId: "1",
        label: "输出记录",
        kind: "VALUE",
        signalLayer: "OUTPUT",
        verificationStatus: "TEACHER_VERIFIED",
        statement: "教师确认输出值为 1。",
        boundary: null,
        evidenceSequence: 1,
      }],
      toolExecutions: [calculatorToolExecution()],
      artworkObserved: true,
      generalAdviceUsed: true,
      webCitations: [{ title: "官方资料", url: "https://example.com/guide" }],
      maxSources: 8,
    });

    expect(result.basis).toHaveLength(6);
    expect(result.basis).toContainEqual({ kind: "CALCULATION", label: "确定性计算结果" });
  });

  it("keeps design-foundation tool results labeled as general design rather than course knowledge", () => {
    const result = buildAnswerProvenance({
      knowledge: [],
      evidenceFacts: [],
      toolExecutions: [knowledgeToolExecution([{
        id: "design-text-contrast",
        title: "文字与背景的最低对比度检查",
        topic: "DESIGN_FOUNDATIONS",
        authority: "OFFICIAL",
        scope: "WCAG 2.2 文字对比度",
      }])],
      generalAdviceUsed: true,
      maxSources: 5,
    });

    expect(result.sources).toContainEqual(expect.objectContaining({ id: "design-text-contrast" }));
    expect(result.basis).toContainEqual({ kind: "GENERAL_DESIGN", label: "通用设计建议" });
    expect(result.basis).not.toContainEqual({ kind: "COURSE_KNOWLEDGE", label: "课程知识" });
  });

  it("accepts BRAND_IDENTITY tool output as traceable course knowledge", () => {
    const result = buildAnswerProvenance({
      knowledge: [],
      evidenceFacts: [],
      toolExecutions: [knowledgeToolExecution([{
        id: "brandvi-001-assess-wordmark-fit",
        title: "判断纯字体字标是否适合品牌识别任务",
        topic: "BRAND_IDENTITY",
        authority: "TEACHER_EXPERIENCE",
        scope: "课堂品牌识别方案比较",
      }])],
      generalAdviceUsed: false,
      maxSources: 5,
    });

    expect(result.sources).toContainEqual(expect.objectContaining({
      id: "brandvi-001-assess-wordmark-fit",
      authority: "TEACHER_EXPERIENCE",
    }));
    expect(result.basis).toContainEqual({ kind: "COURSE_KNOWLEDGE", label: "课程知识" });
    expect(result.basis).not.toContainEqual({ kind: "GENERAL_DESIGN", label: "通用设计建议" });
  });

  it("expands V2 evidence nodes into traceable answer sources without leaking local locators", () => {
    const result = buildAnswerProvenance({
      knowledge: [],
      evidenceFacts: [],
      toolExecutions: [evidenceToolExecution()],
      generalAdviceUsed: false,
      maxSources: 5,
    });

    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toMatchObject({
      id: "node-text-1",
      title: "视觉层级冲突判断",
      authority: "COURSE_DESIGN",
      evidence: {
        schemaVersion: 2,
        bundleId: "bundle-test",
        objectId: "layout-object-1",
        nodeId: "node-text-1",
        sourceId: "source-layout-1",
        evidenceKind: "KNOWLEDGE_FACT",
        assetId: null,
        assetSha256: null,
        assetWidthPx: null,
        assetHeightPx: null,
        region: null,
        previewUrl: null,
        corpusBundleHash: "2".repeat(64),
        activeIndexBundleHash: "3".repeat(64),
      },
    });
    expect(result.sources[1]).toMatchObject({
      id: "node-image-1",
      evidence: {
        evidenceKind: "VISUAL_REFERENCE",
        assetId: "asset-layout-1",
        assetSha256: "4".repeat(64),
        assetWidthPx: 1200,
        assetHeightPx: 800,
        previewUrl: "/api/knowledge/assets/asset-layout-1",
        region: {
          regionId: "region-layout-1",
          bbox: {
            coordinateSpace: "NORMALIZED",
            x: 0.1,
            y: 0.2,
            width: 0.4,
            height: 0.5,
          },
        },
      },
    });
    expect(result.basis).toContainEqual({
      kind: "COURSE_KNOWLEDGE",
      label: "课程知识",
    });
    expect(result.basis).not.toContainEqual({
      kind: "TOOL_OBSERVATION",
      label: "工具读取结果",
    });
    expect(JSON.stringify(result)).not.toContain("data/courses");
    expect(JSON.stringify(result)).not.toContain("LOCAL_DOCUMENT");
  });

  it("projects only explicitly used V2 evidence nodes while preserving the full returned tool output", () => {
    const execution = evidenceToolExecution();
    const originalOutput = structuredClone(execution.output);
    const result = buildAnswerProvenance({
      knowledge: [],
      evidenceFacts: [],
      toolExecutions: [execution],
      usedEvidenceSourceIds: new Set(["node-text-1"]),
      generalAdviceUsed: false,
      maxSources: 5,
    });

    expect(result.sources.map(({ id }) => id)).toEqual([
      "node-text-1",
    ]);
    expect(execution.output).toEqual(originalOutput);
  });

  it("keeps legacy sources valid and rejects inconsistent V2 evidence metadata", () => {
    const legacySource = {
      id: "legacy-source",
      title: "旧版课程来源",
      authority: "COURSE_DESIGN",
      scope: "旧回合没有 evidence 字段。",
    } as const;
    const evidenceSource = buildAnswerProvenance({
      knowledge: [],
      evidenceFacts: [],
      toolExecutions: [evidenceToolExecution()],
      maxSources: 5,
    }).sources[1];

    expect(AgentSourceSchema.safeParse(legacySource).success).toBe(true);
    expect(AgentSourceSchema.safeParse(evidenceSource).success).toBe(true);
    expect(AgentSourceSchema.safeParse({
      ...evidenceSource,
      evidence: {
        ...evidenceSource?.evidence,
        previewUrl: "/api/knowledge/assets/another-asset",
      },
    }).success).toBe(false);
    expect(AgentSourceSchema.safeParse({
      ...evidenceSource,
      evidence: {
        ...evidenceSource?.evidence,
        region: {
          regionId: "region-layout-1",
          bbox: {
            coordinateSpace: "NORMALIZED",
            x: 0.8,
            y: 0,
            width: 0.3,
            height: 1,
          },
        },
      },
    }).success).toBe(false);
  });

  it("normalizes, deduplicates, limits, and labels backend web citations", () => {
    const citations = [
      { title: "  OpenAI   官方指南  ", url: "https://Example.com/search?b=2&a=1#result" },
      { title: "重复页面", url: "https://example.com/search?a=1&b=2#another" },
      { title: "不安全协议", url: "http://example.com/unsafe" },
      { title: "带凭据地址", url: "https://reader:secret@example.com/private" },
      { title: "第二个来源", url: "https://second.example.com/reference" },
      { title: "第三个来源", url: "https://third.example.com/reference" },
      { title: "不会进入第四条", url: "https://fourth.example.com/reference" },
    ];
    const result = buildAnswerProvenance({
      knowledge: [],
      evidenceFacts: [],
      toolExecutions: [],
      webCitations: citations,
      maxSources: 5,
    });
    const repeated = buildAnswerProvenance({
      knowledge: [],
      evidenceFacts: [],
      toolExecutions: [],
      webCitations: citations,
      maxSources: 5,
    });

    expect(result.sources).toHaveLength(3);
    expect(result.sources[0]).toMatchObject({
      title: "OpenAI 官方指南",
      authority: "PUBLIC_WEB",
      scope: expect.stringContaining("需核对原文"),
      url: "https://example.com/search?a=1&b=2",
    });
    expect(result.sources.map(({ id }) => id)).toEqual(repeated.sources.map(({ id }) => id));
    expect(result.sources.every(({ authority }) => authority === "PUBLIC_WEB")).toBe(true);
    expect(result.basis).toContainEqual({ kind: "WEB_RESEARCH", label: "联网检索" });
  });

  it("accepts only credential-free HTTPS source links in the public response contract", () => {
    const source = {
      id: "web:source",
      title: "公开网页",
      authority: "PUBLIC_WEB",
      scope: "联网检索来源，需核对。",
    } as const;

    expect(AgentSourceSchema.safeParse({ ...source, url: "https://example.com/page" }).success).toBe(true);
    expect(AgentSourceSchema.safeParse({ ...source, url: "http://example.com/page" }).success).toBe(false);
    expect(AgentSourceSchema.safeParse({ ...source, url: "https://user:secret@example.com/page" }).success).toBe(false);
    expect(AgentSourceSchema.safeParse({ ...source, url: "https://localhost/page" }).success).toBe(false);
    expect(AgentSourceSchema.safeParse({ ...source, url: "https://127.0.0.1/page" }).success).toBe(false);
    expect(AgentSourceSchema.safeParse({ ...source, url: "https://10.0.0.8/page" }).success).toBe(false);
    expect(AgentSourceSchema.safeParse({ ...source, url: "https://[fd00::1]/page" }).success).toBe(false);
  });
});

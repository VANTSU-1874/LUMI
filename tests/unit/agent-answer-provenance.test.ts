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

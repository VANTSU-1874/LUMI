import { z } from "zod";
import { normalizePublicHttpsUrl } from "@/lib/security/public-web-url";

import {
  AgentToolExecutionError,
  type AgentToolDefinition,
} from "../tool-contract";

export const EXTERNAL_WEB_SEARCH_TOOL_ID = "external-web.search";

const ExternalWebCitationSchema = z.object({
  url: z.string().url().max(2_048).refine(
    (value) => Boolean(normalizePublicHttpsUrl(value)),
    "web citation URL must be public HTTPS",
  ),
  title: z.string().trim().min(1).max(200),
  startIndex: z.number().int().min(0).max(32_000),
  endIndex: z.number().int().min(0).max(32_000),
}).strict();

export const ExternalWebSearchOutputSchema = z.object({
  answer: z.string().max(4_000),
  citations: z.array(ExternalWebCitationSchema).max(3),
}).strict();

export const externalWebSearchTool: AgentToolDefinition = {
  descriptor: {
    id: EXTERNAL_WEB_SEARCH_TOOL_ID,
    version: "1",
    adapterId: "external-web",
    owner: { type: "SKILL", id: "public-research", label: "公开资料检索 Skill" },
    label: "联网检索公开资料",
    description: "根据学生本轮问题检索公开网页，优先官方或一手来源，并返回可点击出处。",
    inputHint: "本轮已由学生授权时才可调用。无需参数；工具只会发送脱敏后的当前问题。",
    effect: "EXTERNAL_CALL",
    access: "STUDENT_CONFIRMATION",
    timeoutMs: 10_000,
    recommendedByCoursePacks: [
      { id: "general-design", version: "1" },
      { id: "digital-interaction", version: "1" },
      { id: "book-design", version: "1" },
    ],
  },
  inputSchema: z.object({}).strict(),
  outputSchema: ExternalWebSearchOutputSchema,
  async execute(context) {
    if (!context.externalWebResearch) {
      throw new AgentToolExecutionError(
        "WEB_SEARCH_UNAVAILABLE",
        "当前模型接口不支持联网检索；导师将继续使用内部资料和通用知识回答。",
      );
    }
    const result = await context.externalWebResearch({
      question: context.question,
      signal: context.signal,
    });
    if (result.status === "UNAVAILABLE") {
      throw new AgentToolExecutionError(
        "WEB_SEARCH_UNAVAILABLE",
        "当前模型接口不支持联网检索；导师将继续使用内部资料和通用知识回答。",
      );
    }
    if (result.status === "EMPTY") {
      return { answer: "", citations: [] };
    }
    return { answer: result.answer, citations: result.citations };
  },
  summarize(output) {
    const parsed = ExternalWebSearchOutputSchema.parse(output);
    if (parsed.citations.length === 0) {
      return {
        summary: "联网检索没有返回可展示的结构化出处；导师将基于已有信息继续回答。",
        facts: [],
        empty: true,
      };
    }
    return {
      summary: `联网检索获得 ${parsed.citations.length} 条可点击公开来源。`,
      facts: parsed.citations.map(({ title }) => `公开网页：${title}`).slice(0, 5),
      empty: false,
    };
  },
};

import { describe, expect, it } from "vitest";

import { AgentDecisionTimelineItemSchema } from "@/lib/domain/teacher";

function timelineItem(url: string) {
  return {
    turnId: "20000000-0000-4000-8000-000000000001",
    conversationId: "10000000-0000-4000-8000-000000000001",
    coursePackId: "general-design",
    coursePackVersion: "1",
    coursePackLabel: "通用设计",
    studentMessage: "查阅公开规范",
    episode: "UNDERSTAND",
    decisionCode: "UNDERSTAND_WEB_REFERENCE",
    responseStrategy: "CONCEPT_EXPLANATION",
    responseLatencyMs: 120,
    aiMode: "MODEL_ASSISTED",
    policy: {
      policyId: "competition-core",
      policyVersion: "1",
      budgets: { modelDecisions: 1, maxModelDecisions: 4, toolCalls: 1, maxToolCalls: 6, turnTimeoutMs: 30_000 },
      autonomy: { readOnlyTools: "AUTOMATIC", studentMutations: "STUDENT_CONFIRMATION", formalAuthority: "FORBIDDEN" },
      appliedRules: ["EXTERNAL_SEARCH_CONFIRMED", "GROUND_EXTERNAL_SOURCES"],
    },
    executionSteps: [],
    toolCalls: [],
    sourceIds: ["web:openai"],
    reply: {
      title: "公开资料说明",
      message: "以下结论来自公开网页。",
      whyThisStep: "保留可核对来源。",
      uncertainty: "尚未由课程组核验。",
      sources: [{
        id: "web:openai",
        title: "OpenAI Web Search 指南",
        authority: "PUBLIC_WEB",
        scope: "联网检索来源，需核对。",
        url,
      }],
      actions: [],
    },
    createdAt: "2026-07-18T08:00:00.000Z",
    dataType: "REAL",
    review: null,
  };
}

describe("teacher agent timeline web sources", () => {
  it("preserves a safe public-web citation for teacher review", () => {
    const parsed = AgentDecisionTimelineItemSchema.parse(timelineItem("https://developers.openai.com/api/docs/guides/tools-web-search"));
    expect(parsed.reply.sources[0]).toMatchObject({ authority: "PUBLIC_WEB", url: expect.stringContaining("developers.openai.com") });
  });

  it("rejects an unsafe external citation in the teacher timeline", () => {
    expect(AgentDecisionTimelineItemSchema.safeParse(timelineItem("https://user:secret@example.com/page")).success).toBe(false);
  });
});

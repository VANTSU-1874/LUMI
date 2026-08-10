import { describe, expect, it } from "vitest";

import {
  ResolvedUserIntentV1Schema,
  buildResolvedUserIntentV1,
} from "@/lib/agent/resolved-user-intent-v1";

describe("ResolvedUserIntentV1", () => {
  it("separates knowledge and memory queries while binding resolved references to source turns", () => {
    const intent = buildResolvedUserIntentV1({
      rawQuestion: "这段为什么看着这么乱？",
      selfContainedQuestion:
        "国际主义风格版面为什么在标题、图片和留白同时抢夺注意力时显得混乱？",
      resolvedReferences: [{
        mention: "这段",
        resolvedText: "国际主义风格版面",
        sourceTurnId: "turn-layout-1",
      }],
      answerObligations: [{
        obligationId: "obligation-1",
        intent: "DIAGNOSE_CAUSE",
        query: "国际主义风格 标题 图片 留白 视觉层级冲突",
      }],
      coursePack: {
        id: "layout-design",
        version: "1",
      },
      knowledgeQuery:
        "国际主义风格 标题 图片 留白 视觉层级冲突",
      memoryQuery:
        "学生当前版式项目中的标题 图片 留白冲突",
      ambiguity: {
        status: "RESOLVED",
        clarifyingQuestion: null,
      },
    });

    expect(intent.sourceTurnIds).toEqual([
      "turn-layout-1",
    ]);
    expect(intent.knowledgeQuery).not.toBe(
      intent.memoryQuery,
    );
    expect(
      ResolvedUserIntentV1Schema.parse(intent),
    ).toEqual(intent);
  });

  it("rejects unbound source turns and invalid clarify state", () => {
    const base = buildResolvedUserIntentV1({
      rawQuestion: "这个怎么改？",
      selfContainedQuestion: "这个怎么改？",
      resolvedReferences: [],
      answerObligations: [{
        obligationId: "obligation-1",
        intent: "HOW_TO",
        query: "这个怎么改",
      }],
      coursePack: {
        id: "general-design",
        version: "1",
      },
      knowledgeQuery: "这个怎么改",
      memoryQuery: "这个怎么改",
      ambiguity: {
        status: "CLARIFY",
        clarifyingQuestion:
          "你说的“这个”具体指哪一部分？",
      },
    });

    expect(ResolvedUserIntentV1Schema.safeParse({
      ...base,
      sourceTurnIds: ["forged-turn"],
    }).success).toBe(false);
    expect(ResolvedUserIntentV1Schema.safeParse({
      ...base,
      ambiguity: {
        status: "NONE",
        clarifyingQuestion: "不应存在",
      },
    }).success).toBe(false);
  });
});

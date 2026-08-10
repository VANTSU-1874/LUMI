import { describe, expect, it } from "vitest";

import {
  answerSupportsSequence,
  genericDebugSourceIds,
  minimumSufficientSourceIds,
  sequenceRequirement,
  validateAnswerGrounding,
} from "@/lib/agent/answer-grounding";
import type { KnowledgeItem } from "@/lib/knowledge/retrieve";

const base = {
  tags: ["信息层级"],
  content: "课程内容",
  facts: [{ id: "hierarchy-three-levels", text: "内容分为三层。" }],
  source: { authority: "COURSE_DESIGN", verifiedDate: "2026-07-14", scope: "测试", localDocument: "test.md" },
};

const hierarchy = {
  ...base,
  id: "information-hierarchy",
  title: "信息层级与页序",
  topic: "INFORMATION_HIERARCHY",
  tags: ["信息层级", "页序", "页面顺序", "下一页", "阅读路径", "内容分解"],
  content: "层级是信息之间的优先关系。学生先对内容进行三层排序，再将找信息路径分配到8个页面。",
  actions: [
    { id: "hierarchy-sort-content", text: "将素材拖入必读、选读和延伸三个区域。" },
    { id: "hierarchy-distribute-pages", text: "再把阅读入口、内容展开和参与行动按先后顺序分配到8页。" },
  ],
} as KnowledgeItem;

const bookPrinciples = {
  ...base,
  id: "book-design-principles",
  title: "书籍设计微任务原则",
  topic: "BOOK_DESIGN_PRINCIPLES",
  tags: ["书籍设计", "受众", "导览册"],
  content: "学生先说明谁在什么情境下阅读，再判断什么信息必须先被找到。",
  facts: [{ id: "book-audience-first", text: "编排决策应先明确读者、阅读情境和信息任务。" }],
  actions: [{ id: "book-clarify-audience", text: "用一句话写清具体读者和阅读情境。" }],
} as KnowledgeItem;

const layoutEvidence = {
  ...base,
  id: "layout-evidence",
  title: "版面证据与阅读测试",
  topic: "LAYOUT_EVIDENCE",
  tags: ["阅读测试", "证据", "停顿"],
  content: "学生提交改变前后的缩略版面和阅读任务结果。",
  facts: [{ id: "layout-reading-evidence", text: "阅读路径可用停顿页或指向错误记录。" }],
  actions: [{ id: "layout-compare-reading-path", text: "请一名读者完成找活动任务并记录结果。" }],
} as KnowledgeItem;

describe("agent answer grounding", () => {
  it("keeps at most two question-relevant knowledge sources without dropping evidence sources", () => {
    const sourceIds = minimumSufficientSourceIds({
      sourceIds: [bookPrinciples.id, layoutEvidence.id, hierarchy.id, "evidence:verified-1"],
    }, [bookPrinciples, layoutEvidence, hierarchy],
    "导览册原来面向新生，现在改给社区居民，哪些结构保留、哪些内容要变？");

    expect(sourceIds).toEqual([
      bookPrinciples.id,
      hierarchy.id,
      "evidence:verified-1",
    ]);
  });

  it("keeps one course source for a mixed general-advice answer", () => {
    const sourceIds = minimumSufficientSourceIds({
      sourceIds: [layoutEvidence.id, hierarchy.id],
    }, [layoutEvidence, hierarchy], "阅读路径如何测试？", 1);

    expect(sourceIds).toHaveLength(1);
    expect([layoutEvidence.id, hierarchy.id]).toContain(sourceIds[0]);
  });

  it("rejects generic principles when a DEBUG answer already has direct evidence sources", () => {
    const generic = { ...hierarchy, id: "book-design-principles", topic: "BOOK_DESIGN_PRINCIPLES" } as KnowledgeItem;
    expect(genericDebugSourceIds("DEBUG", [generic, hierarchy], [generic.id, hierarchy.id]))
      .toEqual([generic.id]);
    expect(genericDebugSourceIds("UNDERSTAND", [generic, hierarchy], [generic.id, hierarchy.id]))
      .toEqual([]);
    expect(() => validateAnswerGrounding({
      episode: "DEBUG",
      sourceIds: [generic.id, hierarchy.id],
      title: "排查",
      message: "检查阅读路径",
    }, [generic, hierarchy], null)).toThrow("MODEL_DEBUG_SOURCE_TOO_GENERIC");
  });

  it("anchors a numbered follow-up to the matching registered action", () => {
    const requirement = sequenceRequirement("那第二步呢？", [{
      studentMessage: "第一步如何整理信息层级？",
      assistantTitle: "第一步",
      assistantMessage: "先整理层级",
      episode: "BUILD",
    }], [hierarchy]);

    expect(requirement).toMatchObject({ step: 2, actionId: "hierarchy-distribute-pages" });
    expect(answerSupportsSequence("第二步是把阅读入口和内容展开按先后顺序分配到8页。", requirement!)).toBe(true);
    expect(answerSupportsSequence("第二步是将素材拖入必读、选读和延伸区域。", requirement!)).toBe(false);
    expect(() => validateAnswerGrounding({
      episode: "BUILD",
      sourceIds: [hierarchy.id],
      title: "第二步",
      message: "将素材拖入必读、选读和延伸区域。",
    }, [hierarchy], requirement)).toThrow("MODEL_WRONG_SEQUENCE_STEP");
  });

  it("keeps the audio-chain second step on analysis instead of jumping to the visual binding", () => {
    const requirement = {
      step: 2,
      actionId: "td-build-audio-minimal-chain",
      actionText: "按输入、Analyze、Filter或Lag、Math、Null和一个视觉参数的顺序搭建最小链。",
    };
    expect(answerSupportsSequence("把声音送入Analyze并观察RMS强度数值。", requirement)).toBe(true);
    expect(answerSupportsSequence("直接把Null通道绑定到圆形半径。", requirement)).toBe(false);
  });
});

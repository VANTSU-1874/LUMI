import { describe, expect, it } from "vitest";

import {
  buildDeterministicResponse,
  buildKnowledgeQuery,
} from "@/lib/agent/deterministic-response";
import type { KnowledgeItem } from "@/lib/knowledge/retrieve";

const layoutKnowledge: KnowledgeItem = {
  id: "layout-evidence",
  title: "版面证据与阅读测试",
  topic: "LAYOUT_EVIDENCE",
  tags: ["阅读路径", "证据"],
  content: "用真实读者的完成过程检查版面。",
  facts: [
    { id: "layout-version-compare", text: "版面修订应保留改变前后版本。" },
    { id: "layout-reading-evidence", text: "阅读路径可用找到信息的时间和停顿页记录。" },
  ],
  actions: [
    { id: "layout-compare-reading-path", text: "请一名读者完成找信息任务。" },
    { id: "layout-observe-errors", text: "记录指向错误。" },
  ],
  source: {
    localDocument: "data/knowledge/layout-evidence.md",
    authority: "COURSE_DESIGN",
    verifiedDate: "2026-07-14",
    scope: "阅读路径证据",
  },
};

describe("deterministic Agent response", () => {
  it("adds episode and visible focus to the bounded retrieval query", () => {
    const query = buildKnowledgeQuery("下一页该看哪里？", "DEBUG", "当前在8页编排台");

    expect(query).toContain("下一页该看哪里");
    expect(query).toContain("排障 证据 测试 观察 记录");
    expect(query).toContain("当前在8页编排台");
  });

  it("does not inject a course case into an open exploration goal", () => {
    expect(buildKnowledgeQuery("我想做一个迎新互动作品", "EXPLORE", null))
      .toBe("我想做一个迎新互动作品");
  });

  it("uses all grounded facts and actions from one cited source", () => {
    const response = buildDeterministicResponse({
      packLabel: "书籍设计",
      episode: "DEBUG",
      message: "同学不知道下一页该看哪里，怎么排查？",
      knowledge: [layoutKnowledge],
    });

    expect(response.message).toContain("阅读路径");
    expect(response.message).toContain("请一名读者");
    expect(response.message).toContain("记录指向错误");
    expect(response.sourceIds).toEqual(["layout-evidence"]);
  });

  it("labels a general suggestion when professional knowledge is unavailable", () => {
    const response = buildDeterministicResponse({
      packLabel: "书籍设计",
      episode: "BUILD",
      message: "如何制作？",
      knowledge: [],
    });

    expect(response.message).toContain("纸样或低保真页序");
    expect(response.uncertainty).toContain("通用设计建议");
    expect(response.sourceIds).toEqual([]);
  });
});

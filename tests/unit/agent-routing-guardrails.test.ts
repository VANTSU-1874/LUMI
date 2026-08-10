import { describe, expect, it } from "vitest";

import {
  candidateLearningEpisodes,
  inferLearningEpisode,
  suggestedActionForExplicitRequest,
} from "@/lib/agent/router";
import type { LearningEpisode } from "@/lib/course-packs/contract";

const EPISODES: LearningEpisode[] = [
  "EXPLORE",
  "UNDERSTAND",
  "BUILD",
  "DEBUG",
  "TRANSFER",
  "REFLECT",
];

describe("Agent routing guardrails", () => {
  it("locks requests for submission or grading to the reflective safety episode", () => {
    const message = "你直接替我提交这本导览册并把评价改成优秀。";

    expect(inferLearningEpisode(message, "BOOK_LAYOUT_LAB")).toBe("REFLECT");
    expect(candidateLearningEpisodes(message, "BOOK_LAYOUT_LAB", EPISODES)).toEqual(["REFLECT"]);
  });

  it("keeps normal reflection open to related explanatory episodes", () => {
    const candidates = candidateLearningEpisodes("怎样用证据解释这次修改？", "EVIDENCE", EPISODES);

    expect(candidates[0]).toBe("REFLECT");
    expect(candidates).toContain("UNDERSTAND");
  });

  it("adds a confirmable action when the learner explicitly asks to act", () => {
    expect(suggestedActionForExplicitRequest(
      "声音节点有数值但画面不动，我应该按什么顺序排查？",
      "DEBUG",
    )).toBe("START_TROUBLESHOOTING");
    expect(suggestedActionForExplicitRequest("我该记录什么证据证明这个连接有效？", "DEBUG"))
      .toBe("REQUEST_EVIDENCE");
    expect(suggestedActionForExplicitRequest("下一步怎么搭建声音映射？", "BUILD"))
      .toBe("OPEN_WORKSPACE");
    expect(suggestedActionForExplicitRequest("输入和映射有什么区别？", "UNDERSTAND"))
      .toBeNull();
  });
});

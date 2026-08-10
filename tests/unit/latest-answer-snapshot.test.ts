import { describe, expect, it } from "vitest";

import { latestTextSnapshot } from "@/components/assistant-lab/latest-answer-snapshot";

describe("latestTextSnapshot", () => {
  it("keeps one stable answer surface across a continuation preview and full snapshots", () => {
    const prefix = "已有正文必须保持在原地。";
    const parts = [
      { type: "data" as const, name: "lumi-continuation" },
      { type: "text" as const, text: prefix },
      { type: "data" as const, name: "lumi-continuation" },
      { type: "text" as const, text: prefix },
      { type: "text" as const, text: `${prefix}新内容从断点继续。` },
    ];

    expect(latestTextSnapshot(parts)).toEqual({
      type: "text",
      text: `${prefix}新内容从断点继续。`,
    });
  });

  it("does not invent an answer when a run has only process parts", () => {
    expect(latestTextSnapshot([
      { type: "reasoning" as const, text: "理解你的问题" },
      { type: "data" as const, name: "lumi-execution-progress" },
    ])).toBeUndefined();
  });
});

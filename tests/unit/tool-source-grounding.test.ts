import { describe, expect, it } from "vitest";

import { requestRequiresToolObservationSource } from "@/lib/agent/tool-sources";

describe("tool observation grounding requests", () => {
  it.each([
    "结合我现在的编排判断阅读路径。",
    "读取我的项目并告诉我目前做到哪里。",
    "看看我当前的证据状态。",
  ])("requires the personal learning-state source for %s", (message) => {
    expect(requestRequiresToolObservationSource(message)).toBe(true);
  });

  it.each([
    "声音已经有数值但画面不动，下一步查哪里？",
    "为什么信息层级会影响阅读路径？",
  ])("does not force an incidental tool source for %s", (message) => {
    expect(requestRequiresToolObservationSource(message)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { sanitizeTutorLearnerText } from "@/lib/agent/v3/tutor-learner-text";

describe("sanitizeTutorLearnerText", () => {
  it("removes a standalone generic provenance parenthetical", () => {
    expect(sanitizeTutorLearnerText([
      "先比较两个字号方案。",
      "",
      "（通用设计经验，非本课程指定资料）",
    ].join("\n"))).toBe("先比较两个字号方案。");
  });

  it("removes the combined generic uncertainty template", () => {
    expect(sanitizeTutorLearnerText(
      "课程、学习现场或联网资料来自本轮列出的可追溯依据；其余判断属于导师的通用设计经验。",
    )).toBe("");
  });

  it("removes the complete learner-visible wrapper used by the old runtime", () => {
    expect(sanitizeTutorLearnerText(
      "（通用设计经验，非本课程指定资料。不确定性：课程、学习现场或联网资料来自本轮列出的可追溯依据；其余判断属于导师的通用设计经验。）",
    )).toBe("");
  });

  it("removes deterministic-calculation boilerplate without hiding concrete limits", () => {
    expect(sanitizeTutorLearnerText(
      "数值来自本轮确定性计算，适用范围见计算说明；仍需确认你的成品尺寸和实际观看距离。",
    )).toBe("仍需确认你的成品尺寸和实际观看距离。");
  });

  it("keeps a concrete uncertainty and removes only its trailing generic clause", () => {
    expect(sanitizeTutorLearnerText(
      "尚未确认纸张克重，这会改变折页厚度；其余判断属于导师的通用设计经验。",
    )).toBe("尚未确认纸张克重，这会改变折页厚度。");
  });

  it("removes a standalone authority-decorated generic provenance line", () => {
    expect(sanitizeTutorLearnerText([
      "先导出两版做并排比较。",
      "通用设计经验与 Adobe 官方输出原则，非本课程指定资料。",
    ].join("\n"))).toBe("先导出两版做并排比较。");
  });
});

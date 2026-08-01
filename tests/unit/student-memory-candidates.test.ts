import { describe, expect, it } from "vitest";

import {
  collectStudentMemoryCandidates,
  extractExplicitStudentMemoryCandidates,
} from "@/lib/agent/student-memory-candidates";
import { parseTutorSidecar } from "@/lib/agent/v3/tutor-sidecar";

describe("student memory candidates", () => {
  it("extracts only explicit durable self-reports and redacts their evidence", () => {
    const candidates = extractExplicitStudentMemoryCandidates(
      "我的项目正在做声音海报。我总是卡在 OSC 端口。联系 13812345678。",
      { environment: {} },
    );
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "PROJECT_FACT", evidenceQuote: "我的项目正在做声音海报。" }),
      expect.objectContaining({ kind: "RECURRING_STRUGGLE", evidenceQuote: "我总是卡在 OSC 端口。" }),
    ]));
    expect(JSON.stringify(candidates)).not.toContain("13812345678");
    expect(extractExplicitStudentMemoryCandidates("OSC 端口这次卡住了。", { environment: {} })).toEqual([]);
  });

  it("rejects third-party, hypothetical and question-shaped profile claims", () => {
    expect(extractExplicitStudentMemoryCandidates("我朋友总是卡在 OSC 端口。", { environment: {} })).toEqual([]);
    expect(extractExplicitStudentMemoryCandidates("我的项目应该怎么改？", { environment: {} })).toEqual([]);
    expect(extractExplicitStudentMemoryCandidates("如果我总是卡在 OSC 端口，该怎么办？", { environment: {} })).toEqual([]);
    expect(extractExplicitStudentMemoryCandidates("朋友说“我总是卡在 OSC 端口”。", { environment: {} })).toEqual([]);
    expect(extractExplicitStudentMemoryCandidates("我朋友喜欢先画缩略图。", { environment: {} })).toEqual([]);
    expect(extractExplicitStudentMemoryCandidates("如果我学会了网格系统，就能继续。", { environment: {} })).toEqual([]);
  });

  it("keeps only sidecar quotes that can be located in the redacted student message", () => {
    const candidates = collectStudentMemoryCandidates(
      "我喜欢先画缩略图，邮箱是 arlo@example.com。",
      {
        environment: {},
        sidecarCandidates: [
          { kind: "PREFERENCE", evidenceQuote: "我喜欢先画缩略图", salience: 3 },
          { kind: "LEARNED_CONCEPT", evidenceQuote: "我已经掌握了网格", salience: 10 },
        ],
      },
    );
    expect(candidates).toContainEqual({ kind: "PREFERENCE", content: "我喜欢先画缩略图", salience: 3 });
    expect(candidates).not.toContainEqual(expect.objectContaining({ kind: "LEARNED_CONCEPT" }));
    expect(JSON.stringify(candidates)).not.toContain("arlo@example.com");
  });

  it("drops a bad memory item without invalidating the optional sidecar metadata or正文", () => {
    const parsed = parseTutorSidecar([
      "先把声音输入缩成 0–1，再检查端口。",
      '<!-- tutor-meta {"title":"继续查端口","memoryCandidates":[{"kind":"UNKNOWN","evidenceQuote":"伪造"},{"kind":"RECURRING_STRUGGLE","evidenceQuote":"我总是卡在 OSC 端口","salience":2}]} -->',
    ].join("\n"));
    expect(parsed).toMatchObject({
      status: "PARSED",
      text: "先把声音输入缩成 0–1，再检查端口。",
      sidecar: {
        title: "继续查端口",
        memoryCandidates: [{ kind: "RECURRING_STRUGGLE", evidenceQuote: "我总是卡在 OSC 端口", salience: 2 }],
      },
    });
  });
});

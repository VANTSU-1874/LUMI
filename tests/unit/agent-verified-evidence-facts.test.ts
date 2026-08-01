// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  deriveVerifiedEvidenceFact,
  selectRelevantVerifiedEvidenceFacts,
  type EvidenceFactInput,
} from "@/lib/agent/verified-evidence-facts";

function evidence(overrides: Partial<EvidenceFactInput> = {}): EvidenceFactInput {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    evidenceSequence: 1,
    kind: "PROBE",
    signalLayer: "MAPPING",
    verificationStatus: "RULE_VERIFIED",
    label: "映射范围验证",
    content: "{}",
    probeJson: {
      type: "MAPPING_RANGE",
      inputMin: 0,
      inputMax: 1,
      outputMin: 0,
      outputMax: 360,
      relationship: "DIRECT",
    },
    ...overrides,
  };
}

describe("verified evidence facts", () => {
  it("turns a rule-verified probe into a citable learning fact", () => {
    expect(deriveVerifiedEvidenceFact(evidence())).toMatchObject({
      sourceId: "evidence:11111111-1111-4111-8111-111111111111",
      signalLayer: "MAPPING",
      verificationStatus: "RULE_VERIFIED",
      statement: "映射层已验证：输入范围0–1被映射到输出范围0–360，关系为正向关系。",
      boundary: null,
    });
  });

  it("never exposes image paths or pretends to understand image content", () => {
    const fact = deriveVerifiedEvidenceFact(evidence({
      kind: "IMAGE",
      signalLayer: "OUTPUT",
      verificationStatus: "TEACHER_VERIFIED",
      label: "E:\\作品\\最终效果.png",
      content: "p1/private-output.webp",
      probeJson: null,
    }));
    expect(fact).toMatchObject({
      statement: expect.stringContaining("[已隐藏本地路径]"),
      boundary: "智能体没有读取或推断图片具体内容，不能据此描述画面。",
    });
    expect(JSON.stringify(fact)).not.toContain("private-output.webp");
    expect(JSON.stringify(fact)).not.toContain("E:\\作品");
  });

  it("only accepts free text after teacher verification and redacts paths and links", () => {
    expect(deriveVerifiedEvidenceFact(evidence({
      kind: "TEXT", verificationStatus: "RULE_VERIFIED", probeJson: null, content: "观察记录",
    }))).toBeNull();
    const fact = deriveVerifiedEvidenceFact(evidence({
      kind: "TEXT",
      verificationStatus: "TEACHER_VERIFIED",
      probeJson: null,
      content: "文件在 C:\\Users\\student\\work.toe，参考 https://example.com/private",
    }));
    expect(fact?.statement).toContain("[已隐藏本地路径]");
    expect(fact?.statement).toContain("[已隐藏链接]");
    expect(fact?.statement).not.toContain("student");
    expect(fact?.statement).not.toContain("example.com");
  });

  it("selects the verified fact that matches the learner's current layer", () => {
    const mapping = deriveVerifiedEvidenceFact(evidence())!;
    const output = deriveVerifiedEvidenceFact(evidence({
      id: "22222222-2222-4222-8222-222222222222",
      evidenceSequence: 2,
      signalLayer: "OUTPUT",
      label: "画面参数对照",
      probeJson: { type: "OUTPUT_COMPARISON", parameter: "亮度", before: 0, after: 1 },
    }))!;
    expect(selectRelevantVerifiedEvidenceFacts([mapping, output], "输出画面为什么没有变化？"))
      .toEqual([output]);
  });

  it("does not inject unrelated verified facts into a different learner question", () => {
    const mapping = deriveVerifiedEvidenceFact(evidence())!;
    expect(selectRelevantVerifiedEvidenceFacts([mapping], "书籍封面的目标读者是谁？"))
      .toEqual([]);
    expect(selectRelevantVerifiedEvidenceFacts([mapping], ""))
      .toEqual([]);
  });
});

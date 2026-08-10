// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  T45_ANSWER_EVIDENCE_PROJECTION_CONFIG_HASH_V1,
  projectT45AnswerEvidenceV1,
} from "@/tools/mixed-retrieval/t45-answer-evidence-projection-v1";

describe("T45 answer evidence projection", () => {
  it("keeps direct evidence answer-eligible and preserves other roles separately", () => {
    const projected = projectT45AnswerEvidenceV1([
      {
        nodeId: "node-direct",
        evidenceRole: "DIRECT" as const,
        text: "直接回答当前义务",
      },
      {
        nodeId: "node-complement",
        evidenceRole: "COMPLEMENT" as const,
        text: "补充背景",
      },
      {
        nodeId: "node-context",
        evidenceRole: "CONTEXT" as const,
        text: "显式上下文",
      },
    ]);

    expect(projected.answerEvidence).toEqual([{
      nodeId: "node-direct",
      evidenceRole: "DIRECT",
      text: "直接回答当前义务",
    }]);
    expect(projected.supplementalEvidence)
      .toHaveLength(2);
    expect(
      T45_ANSWER_EVIDENCE_PROJECTION_CONFIG_HASH_V1,
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats Top-8 as a maximum and rejects duplicate identities", () => {
    expect(() =>
      projectT45AnswerEvidenceV1([
        {
          nodeId: "node-one",
          evidenceRole: "DIRECT" as const,
        },
        {
          nodeId: "node-one",
          evidenceRole: "COMPLEMENT" as const,
        },
      ])).toThrow(
      "T45_ANSWER_EVIDENCE_PROJECTION_INPUT_INVALID",
    );
  });

  it("fails closed when a model provides no answer-eligible evidence", () => {
    expect(() =>
      projectT45AnswerEvidenceV1([{
        nodeId: "node-context",
        evidenceRole: "CONTEXT" as const,
      }])).toThrow(
      "T45_ANSWER_EVIDENCE_PROJECTION_DIRECT_EMPTY",
    );
  });
});

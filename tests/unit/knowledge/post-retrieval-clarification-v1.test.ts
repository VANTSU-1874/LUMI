import { describe, expect, it } from "vitest";

import {
  decidePostRetrievalResponseV1,
} from "../../../lib/knowledge/post-retrieval-clarification-v1";

function assessment(input: {
  status: "SUFFICIENT" | "INSUFFICIENT";
  supportedEvidenceIds: string[];
  clarifyingQuestion: string | null;
}) {
  return {
    schemaVersion: 1 as const,
    source: "EVIDENCE_REVIEWER" as const,
    requiredEvidenceIds: [
      "claim-layout",
      "claim-evidence",
    ],
    ...input,
  };
}

describe("post-retrieval clarification v1", () => {
  it("answers when evidence is sufficient even if the planner suggested CLARIFY", () => {
    const decision = decidePostRetrievalResponseV1({
      plannerStatusObserved: "CLARIFY",
      evidenceAssessment: assessment({
        status: "SUFFICIENT",
        supportedEvidenceIds: [
          "claim-layout",
          "claim-evidence",
        ],
        clarifyingQuestion: null,
      }),
    });

    expect(decision).toMatchObject({
      authority:
        "POST_RETRIEVAL_EVIDENCE_SUFFICIENCY",
      action: "ANSWER",
      plannerStatusObserved: "CLARIFY",
      reason: "EVIDENCE_SUFFICIENT",
      clarifyingQuestion: null,
    });
  });

  it("clarifies when evidence is insufficient even if the planner said READY", () => {
    const decision = decidePostRetrievalResponseV1({
      plannerStatusObserved: "READY",
      evidenceAssessment: assessment({
        status: "INSUFFICIENT",
        supportedEvidenceIds: ["claim-layout"],
        clarifyingQuestion:
          "你希望先判断人物年代，还是先讨论版式借鉴？",
      }),
    });

    expect(decision).toMatchObject({
      action: "CLARIFY",
      plannerStatusObserved: "READY",
      reason: "EVIDENCE_INSUFFICIENT",
      clarifyingQuestion:
        "你希望先判断人物年代，还是先讨论版式借鉴？",
    });
  });

  it("rejects assessment status drift and unsupported evidence ids", () => {
    expect(() =>
      decidePostRetrievalResponseV1({
        plannerStatusObserved: "READY",
        evidenceAssessment: assessment({
          status: "SUFFICIENT",
          supportedEvidenceIds: ["claim-layout"],
          clarifyingQuestion: null,
        }),
      })).toThrow(
        /POST_RETRIEVAL_EVIDENCE_ASSESSMENT_INVALID/,
      );

    expect(() =>
      decidePostRetrievalResponseV1({
        plannerStatusObserved: "READY",
        evidenceAssessment: assessment({
          status: "INSUFFICIENT",
          supportedEvidenceIds: ["claim-unknown"],
          clarifyingQuestion: "请补充你指的是哪一项。",
        }),
      })).toThrow(
        /POST_RETRIEVAL_EVIDENCE_ASSESSMENT_INVALID/,
      );
  });
});

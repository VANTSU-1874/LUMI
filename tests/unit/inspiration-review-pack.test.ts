import { describe, expect, it } from "vitest";

import {
  ReviewPackDecisionInputSchema,
  StrictReviewPackSchema,
} from "@/lib/domain/inspiration-wiki/review-pack-contracts";
import {
  deriveReviewPackStage,
  transitionReviewPack,
  validateReviewPackSource,
} from "@/lib/domain/inspiration-wiki/review-pack";
import {
  acceptedReviewDecisionFixture,
  strictReviewPackFixture,
} from "@/tests/fixtures/inspiration-review-pack";

describe("strict Inspiration Wiki ReviewPack", () => {
  it("accepts a complete controlled review pack and keeps every exposure channel closed", () => {
    const parsed = StrictReviewPackSchema.parse(strictReviewPackFixture);
    expect(parsed.stage).toBe("READY_FOR_TEACHER_REVIEW");
    expect(parsed.capabilityBoundary).toEqual({
      teacherPrivate: true,
      studentVisible: false,
      currentPage: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
    });
  });

  it("keeps any incomplete preparation outside the teacher queue", () => {
    expect(deriveReviewPackStage({
      ...strictReviewPackFixture.readiness,
      duplicateRelationship: false,
    })).toBe("PACKAGING");
  });

  it("enforces source roles instead of treating discovery or curation as creator evidence", () => {
    expect(() => validateReviewPackSource({
      ...strictReviewPackFixture.sources[0],
      role: "CREATOR_WORK_PAGE",
    })).toThrow();
    expect(() => validateReviewPackSource({
      ...strictReviewPackFixture.sources[2],
      curatorName: null,
    })).toThrow();
  });

  it("allows Hesign official work pages to retain a direct creator relationship", () => {
    expect(validateReviewPackSource({
      sourceId: "hesign-china-design-museum",
      platform: "HESIGN",
      role: "CREATOR_WORK_PAGE",
      label: "Hesign official work page",
      pageUrl: "https://www.hesign.com/works/china-design-museum",
      creatorName: "Hesign",
      curatorName: null,
      creatorRelationship: "DIRECT_CREATOR_PAGE",
      evidenceStatement: "The official work page identifies the studio's corporate identity and signage work.",
    })).toMatchObject({ role: "CREATOR_WORK_PAGE" });

    expect(() => validateReviewPackSource({
      sourceId: "hesign-invalid-role",
      platform: "HESIGN",
      role: "CREATOR_WORK_PAGE",
      label: "Hesign official work page",
      pageUrl: "https://www.hesign.com/works/china-design-museum",
      creatorName: "Hesign",
      curatorName: null,
      creatorRelationship: "CURATED_CREATOR_RECORD",
      evidenceStatement: "The source relationship is internally inconsistent.",
    })).toThrow();
  });

  it("allows only return, reject, or private WikiDraft final actions", () => {
    expect(ReviewPackDecisionInputSchema.safeParse({
      ...acceptedReviewDecisionFixture,
      finalAction: "PUBLISH",
    }).success).toBe(false);
    expect(ReviewPackDecisionInputSchema.parse(acceptedReviewDecisionFixture).finalAction).toBe("ENTER_PRIVATE_WIKIDRAFT");
  });

  it("blocks private WikiDraft when any teacher judgement remains negative or uncertain", () => {
    expect(ReviewPackDecisionInputSchema.safeParse({
      ...acceptedReviewDecisionFixture,
      assessment: { ...acceptedReviewDecisionFixture.assessment, rightsSafety: "NEEDS_MORE_EVIDENCE" },
    }).success).toBe(false);
  });

  it("transitions only to the private draft state and preserves disabled channels", () => {
    const receipt = transitionReviewPack(strictReviewPackFixture, acceptedReviewDecisionFixture);
    expect(receipt).toMatchObject({ stage: "PRIVATE_WIKIDRAFT", revision: 4 });
    expect(receipt.capabilityBoundary.studentVisible).toBe(false);
    expect(receipt.capabilityBoundary.currentPage).toBe("DISABLED");
  });
});

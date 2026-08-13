import { describe, expect, it } from "vitest";

import { isTeacherReviewableInspirationCandidate } from "@/lib/services/inspiration-review-access";

describe("teacher inspiration review eligibility", () => {
  it("accepts only a READY_FOR_TEACHER_REVIEW candidate with a ready withdrawal path", () => {
    expect(isTeacherReviewableInspirationCandidate({ state: "READY_FOR_TEACHER_REVIEW", withdrawalStatus: "READY" })).toBe(true);
    expect(isTeacherReviewableInspirationCandidate({ state: "READY_FOR_TEACHER_REVIEW", withdrawalStatus: "HOLD" })).toBe(false);
    expect(isTeacherReviewableInspirationCandidate({ state: "READY_FOR_TEACHER_REVIEW", withdrawalStatus: "FROZEN" })).toBe(false);
    expect(isTeacherReviewableInspirationCandidate({ state: "FROZEN", withdrawalStatus: "READY" })).toBe(false);
    expect(isTeacherReviewableInspirationCandidate({ state: "ACTIVE", withdrawalStatus: "READY" })).toBe(false);
    expect(isTeacherReviewableInspirationCandidate({ state: "WITHDRAWN", withdrawalStatus: "WITHDRAWN" })).toBe(false);
  });
});

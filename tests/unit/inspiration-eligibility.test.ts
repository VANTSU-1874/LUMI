import { describe, expect, it } from "vitest";

import { isFormalWikiStudentEligible, type FormalWikiStudentEligibility } from "@/lib/domain/inspiration-eligibility";

const eligible: FormalWikiStudentEligibility = {
  candidateState: "ACTIVE",
  admissionStatus: "ACTIVE",
  withdrawalStatus: "READY",
  rights: { decisions: { STUDENT_DISPLAY: "ALLOW" } },
  publicationScope: "AUTHENTICATED_STUDENT_ONLY",
  studentVisible: true,
  studentDisplayDecision: "ALLOW",
  sourceDisclosureDecision: "ALLOW",
  teachingDecision: "ALLOW",
  safetyDecision: "ALLOW",
  qualityDecision: "ALLOW",
  withdrawalReadiness: "READY",
  browserChannel: "ACTIVE",
  bridgeChannel: "ACTIVE",
  formalWikiActivationRecorded: true,
};

describe("formal inspiration Wiki student eligibility", () => {
  it("requires the complete persisted publication contract", () => {
    expect(isFormalWikiStudentEligible(eligible)).toBe(true);
    const failures: Array<Partial<FormalWikiStudentEligibility>> = [
      { candidateState: "WITHDRAWN" },
      { admissionStatus: "AUTO_ADMITTED/INDEXED" },
      { withdrawalStatus: "HOLD" },
      { rights: { decisions: { STUDENT_DISPLAY: "UNKNOWN" } } },
      { publicationScope: "INTERNAL_CATALOG_ONLY" },
      { studentVisible: false },
      { studentDisplayDecision: "PENDING" },
      { sourceDisclosureDecision: "PENDING" },
      { teachingDecision: "PENDING" },
      { safetyDecision: "PENDING" },
      { qualityDecision: "PENDING" },
      { withdrawalReadiness: "PENDING" },
      { browserChannel: "DISABLED" },
      { bridgeChannel: "DISABLED" },
      { formalWikiActivationRecorded: false },
    ];
    for (const failure of failures) expect(isFormalWikiStudentEligible({ ...eligible, ...failure })).toBe(false);
  });
});

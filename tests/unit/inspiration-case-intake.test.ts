import { describe, expect, it } from "vitest";

import {
  assertInspirationCasePublishability,
  assertP1AutoAdmission,
  assertPrivateInspirationCaseAnalysis,
  assertPrivateInspirationCaseCandidate,
  assertTeacherReviewPackage,
  privateAnalysisSafetyIssues,
  privateCandidateSafetyIssues,
  publishabilitySafetyIssues,
  UnsafeInspirationCaseCandidateError,
} from "@/lib/agent/inspiration-case-intake";
import {
  privateCandidateAnalysis,
  privateCandidateIntake,
  privateCandidatePublishability,
  autoAdmission,
  teacherDecision,
  teacherReviewPackage,
} from "@/tests/fixtures/inspiration-case-intake";

describe("private inspiration candidate pipeline", () => {
  it("accepts a private copy with incomplete author and rights metadata", () => {
    const candidate = privateCandidateIntake();

    expect(assertPrivateInspirationCaseCandidate(candidate)).toEqual(candidate);
    expect(privateCandidateSafetyIssues(candidate)).toEqual([]);
  });

  it("keeps the Recent curation source separate from the displayed original source", () => {
    const candidate = privateCandidateIntake({
      curation: {
        ...privateCandidateIntake().curation,
        curationSourceUrl: "https://recent.design/design/fin",
        originalSourceDisplay: "fin.ai",
        originalSourceUrl: "https://fin.ai/",
        title: "Fin",
      },
    });

    expect(assertPrivateInspirationCaseCandidate(candidate).curation).toMatchObject({
      curationSourceUrl: "https://recent.design/design/fin",
      originalSourceDisplay: "fin.ai",
      originalSourceUrl: "https://fin.ai/",
    });
  });

  it("refuses private copies without isolated storage identity and hash", () => {
    const candidate = privateCandidateIntake({
      asset: { mode: "PRIVATE_COPY", privateAssetRef: null, contentHash: null },
    });

    expect(privateCandidateSafetyIssues(candidate)).toEqual(["PRIVATE_COPY_REQUIRES_PRIVATE_REF_AND_HASH"]);
    expect(() => assertPrivateInspirationCaseCandidate(candidate)).toThrow(UnsafeInspirationCaseCandidateError);
  });

  it("records an actual remote analysis channel instead of pretending it was local", () => {
    const candidate = privateCandidateIntake();
    const analysis = privateCandidateAnalysis({
      processing: {
        requestedChannel: "REMOTE",
        actualChannel: "REMOTE",
        providerLabel: "external:vision-provider",
        transmittedToThirdParty: true,
        recordedAt: "2026-08-09T00:00:00.000Z",
      },
    });

    expect(assertPrivateInspirationCaseAnalysis(candidate, analysis)).toEqual(analysis);
    expect(privateAnalysisSafetyIssues(candidate, analysis)).toEqual([]);
  });

  it("does not make an incomplete candidate publishable", () => {
    const candidate = privateCandidateIntake();
    const analysis = privateCandidateAnalysis();
    const review = privateCandidatePublishability();

    expect(publishabilitySafetyIssues(candidate, analysis, review)).toEqual(["WITHDRAWAL_CHANNEL_NOT_READY"]);
  });

  it("permits UNKNOWN provenance only after strict non-rights output review and a withdrawal route", () => {
    const candidate = privateCandidateIntake({ withdrawal: { status: "READY", complaintLocator: "https://example.invalid/report" } });
    const analysis = privateCandidateAnalysis();
    const review = privateCandidatePublishability();

    expect(assertInspirationCasePublishability(candidate, analysis, review)).toEqual(review);
  });

  it("builds a private teacher review package with explainable automated signals", () => {
    const candidate = privateCandidateIntake();
    const analysis = privateCandidateAnalysis();
    const reviewPackage = teacherReviewPackage();

    expect(assertTeacherReviewPackage(candidate, analysis, reviewPackage)).toMatchObject({
      pipelineState: "READY_FOR_TEACHER_REVIEW",
      aiRecommendation: { recommendation: "REVIEW_CAREFULLY" },
      channels: { browseRelease: "DISABLED", textRag: "DISABLED", visualRag: "DISABLED" },
    });
  });

  it("auto-admits only after a teacher approval and still keeps P1 internal", () => {
    const admission = autoAdmission();

    expect(assertP1AutoAdmission(teacherDecision(), admission)).toEqual(admission);
    expect(() => assertP1AutoAdmission(teacherDecision({ decision: "REJECTED" }), admission))
      .toThrow("AUTO_ADMISSION_REQUIRES_TEACHER_APPROVAL");
    expect(admission).toMatchObject({ admissionScope: "INTERNAL_CATALOG_ONLY", studentVisible: false });
  });
});

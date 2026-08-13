import { describe, expect, it } from "vitest";

import {
  EvidenceGapReviewDecisionContextSchema,
  EvidenceGapReviewPackSchema,
  EvidenceGapReadinessSchema,
  evidenceGapAcceptanceRequirementKeys,
  evidenceGapRequirementKeys,
  evidenceGapVerifiedCount,
  TeacherEvidenceGapReviewDecisionReceiptSchema,
  TeacherEvidenceGapReviewQueueSchema,
  transitionEvidenceGapReviewPack,
} from "@/lib/domain/inspiration-wiki/evidence-gap-review-contracts";

const readiness = {
  controlledMediaGroup: { status: "MISSING", note: "No controlled image is available.", evidenceRefs: [] },
  workSourceMatch: { status: "PRESENT_UNVERIFIED", note: "The source URL is present but unmatched.", evidenceRefs: ["source-page"] },
  sourceRole: { status: "MISSING", note: "Source role is not classified.", evidenceRefs: [] },
  rightsEvidence: { status: "BLOCKED", note: "Rights evidence is absent.", evidenceRefs: [] },
  normalizedClassification: { status: "VERIFIED", note: "Category was normalized.", evidenceRefs: ["classification"] },
  visualDescription: { status: "MISSING", note: "No controlled media is available for observation.", evidenceRefs: [] },
  duplicateRelationship: { status: "VERIFIED", note: "Project-level duplicate check completed.", evidenceRefs: ["dedupe"] },
  curationRecommendation: { status: "PRESENT_UNVERIFIED", note: "A raw recommendation is available.", evidenceRefs: ["screening"] },
  teachingRecommendation: { status: "MISSING", note: "Teaching recommendation is absent.", evidenceRefs: [] },
} as const;

const pack = {
  schemaVersion: "lumi-inspiration-evidence-gap-review-pack/v1",
  contractKind: "EVIDENCE_GAP_REVIEW",
  reviewPackId: "review-pack:evidence-gap-example-001",
  candidateId: `hermes-candidate:${"1".repeat(32)}`,
  revision: 1,
  stage: "READY_FOR_TEACHER_TRIAGE",
  materialHash: "a".repeat(64),
  preparedAt: "2026-08-12T10:00:00.000Z",
  work: { title: null, creators: [], year: null, workSourceMatchEvidence: [] },
  sources: [],
  mediaGroup: [],
  rightsEvidence: [],
  normalizedClassification: { primary: null, secondary: [], sourceTerms: [] },
  visualDescription: { summary: null, observations: [] },
  duplicateRelationship: { status: "UNASSESSED", relatedCandidateIds: [], explanation: null },
  curationRecommendation: { recommendation: "UNASSESSED", rationale: null },
  teachingRecommendation: { recommendation: "UNASSESSED", rationale: null, prompts: [], cautions: [] },
  safetyAssessment: { status: "UNASSESSED", evidence: [] },
  readiness,
  capabilityBoundary: {
    teacherPrivate: true,
    studentVisible: false,
    currentPage: "DISABLED",
    r2: "DISABLED",
    embedding: "DISABLED",
    lumiRetrieval: "DISABLED",
  },
} as const;

const incompleteKeys = [
  "CONTROLLED_MEDIA_GROUP",
  "WORK_SOURCE_MATCH",
  "SOURCE_ROLE",
  "RIGHTS_EVIDENCE",
  "VISUAL_DESCRIPTION",
  "CURATION_RECOMMENDATION",
  "TEACHING_RECOMMENDATION",
] as const;

describe("evidence-gap teacher review contracts", () => {
  it("accepts genuine nulls, empty evidence arrays, and zero media without opening capabilities", () => {
    const parsed = EvidenceGapReviewPackSchema.parse(pack);
    expect(parsed.contractKind).toBe("EVIDENCE_GAP_REVIEW");
    expect(parsed.stage).toBe("READY_FOR_TEACHER_TRIAGE");
    expect(parsed.mediaGroup).toEqual([]);
    expect(parsed.work).toMatchObject({ title: null, creators: [], year: null });
    expect(parsed.capabilityBoundary).toEqual({
      teacherPrivate: true,
      studentVisible: false,
      currentPage: "DISABLED",
      r2: "DISABLED",
      embedding: "DISABLED",
      lumiRetrieval: "DISABLED",
    });
  });

  it("derives the exact non-verified requirements without treating present material as verified", () => {
    const parsedReadiness = EvidenceGapReadinessSchema.parse(pack.readiness);
    expect(evidenceGapRequirementKeys(parsedReadiness)).toEqual(incompleteKeys);
    expect(evidenceGapVerifiedCount(parsedReadiness)).toBe(2);
  });

  it("rejects a gap contract when all nine requirements are verified", () => {
    const verified = Object.fromEntries(Object.entries(readiness).map(([key, value]) => [
      key,
      { ...value, status: "VERIFIED" },
    ]));
    expect(EvidenceGapReviewPackSchema.safeParse({ ...pack, readiness: verified }).success).toBe(false);
  });

  it("requires private draft entry to explicitly accept every current evidence gap", () => {
    const decision = {
      reviewPackId: pack.reviewPackId,
      reviewPackRevision: pack.revision,
      finalAction: "ENTER_PRIVATE_WIKIDRAFT",
      acceptedGapKeys: incompleteKeys,
      note: "Teacher accepts these unresolved gates for a private draft only.",
      privateDraftOnly: true,
      idempotencyKey: "gap-review-decision-001",
    } as const;
    expect(EvidenceGapReviewDecisionContextSchema.parse({ pack, decision }).decision.acceptedGapKeys).toEqual(incompleteKeys);
    expect(EvidenceGapReviewDecisionContextSchema.safeParse({
      pack,
      decision: { ...decision, acceptedGapKeys: incompleteKeys.slice(1) },
    }).success).toBe(false);
    expect(EvidenceGapReviewDecisionContextSchema.safeParse({
      pack,
      decision: { ...decision, privateDraftOnly: false },
    }).success).toBe(false);
    expect(EvidenceGapReviewDecisionContextSchema.safeParse({
      pack,
      decision: { ...decision, note: "" },
    }).success).toBe(true);
  });

  it("treats confirmed unknowns as settled facts that need no draft note or acceptance checkbox", () => {
    const confirmedUnknownReadiness = {
      ...readiness,
      controlledMediaGroup: { status: "VERIFIED", note: "Media reviewed.", evidenceRefs: ["media-1"] },
      workSourceMatch: { status: "UNKNOWN", note: "未知", evidenceRefs: [] },
      sourceRole: { status: "UNKNOWN", note: "未知", evidenceRefs: [] },
      rightsEvidence: { status: "UNKNOWN", note: "未知", evidenceRefs: [] },
      normalizedClassification: { status: "VERIFIED", note: "Normalized.", evidenceRefs: ["classification"] },
      visualDescription: { status: "VERIFIED", note: "Analyzed.", evidenceRefs: ["media-1"] },
      duplicateRelationship: { status: "VERIFIED", note: "Compared.", evidenceRefs: ["dedupe"] },
      curationRecommendation: { status: "VERIFIED", note: "Analyzed.", evidenceRefs: ["curation"] },
      teachingRecommendation: { status: "VERIFIED", note: "Analyzed.", evidenceRefs: ["teaching"] },
    } as const;
    const confirmedUnknownPack = { ...pack, readiness: confirmedUnknownReadiness };
    const decision = {
      reviewPackId: pack.reviewPackId,
      reviewPackRevision: pack.revision,
      finalAction: "ENTER_PRIVATE_WIKIDRAFT",
      acceptedGapKeys: [],
      note: "",
      privateDraftOnly: true,
      idempotencyKey: "confirmed-unknown-draft-001",
    } as const;

    const parsedReadiness = EvidenceGapReadinessSchema.parse(confirmedUnknownReadiness);
    expect(evidenceGapAcceptanceRequirementKeys(parsedReadiness)).toEqual([]);
    expect(evidenceGapRequirementKeys(parsedReadiness)).toEqual([
      "WORK_SOURCE_MATCH",
      "SOURCE_ROLE",
      "RIGHTS_EVIDENCE",
    ]);
    expect(EvidenceGapReviewDecisionContextSchema.parse({ pack: confirmedUnknownPack, decision }).decision.note).toBe("");
  });

  it("allows only the three teacher actions and keeps gap draft stage distinct", () => {
    const decision = {
      reviewPackId: pack.reviewPackId,
      reviewPackRevision: pack.revision,
      finalAction: "ENTER_PRIVATE_WIKIDRAFT",
      acceptedGapKeys: incompleteKeys,
      note: "Private draft only, with every gap retained.",
      privateDraftOnly: true,
      idempotencyKey: "gap-review-decision-002",
    } as const;
    expect(transitionEvidenceGapReviewPack(pack, decision)).toMatchObject({
      stage: "PRIVATE_WIKIDRAFT_WITH_GAPS",
      previousRevision: 1,
      revision: 2,
      capabilityBoundary: { studentVisible: false, currentPage: "DISABLED" },
    });
    expect(EvidenceGapReviewDecisionContextSchema.safeParse({
      pack,
      decision: { ...decision, finalAction: "PUBLISH" },
    }).success).toBe(false);
  });

  it("requires route receipts to carry decision time, replay state, and next item", () => {
    expect(TeacherEvidenceGapReviewDecisionReceiptSchema.parse({
      reviewPackId: pack.reviewPackId,
      previousRevision: 1,
      revision: 2,
      finalAction: "ENTER_PRIVATE_WIKIDRAFT",
      stage: "PRIVATE_WIKIDRAFT_WITH_GAPS",
      capabilityBoundary: pack.capabilityBoundary,
      decidedAt: "2026-08-12T10:10:00.000Z",
      replayed: false,
      nextReviewPackId: null,
    })).toMatchObject({ replayed: false, nextReviewPackId: null });
  });

  it("keeps return and reject actions free of gap acceptance claims", () => {
    for (const finalAction of ["RETURN_TO_CODEX", "REJECT_CANDIDATE"] as const) {
      const decision = {
        reviewPackId: pack.reviewPackId,
        reviewPackRevision: pack.revision,
        finalAction,
        acceptedGapKeys: [],
        note: `${finalAction} requires a recorded reason.`,
        privateDraftOnly: false,
        idempotencyKey: `gap-${finalAction.toLowerCase()}`,
      };
      expect(EvidenceGapReviewDecisionContextSchema.parse({ pack, decision }).decision.finalAction).toBe(finalAction);
      expect(EvidenceGapReviewDecisionContextSchema.safeParse({
        pack,
        decision: { ...decision, acceptedGapKeys: ["RIGHTS_EVIDENCE"] },
      }).success).toBe(false);
    }
  });

  it("keeps queue counts explicit for nullable previews and incomplete gates", () => {
    const gateStatusCounts = Object.fromEntries([
      "CONTROLLED_MEDIA_GROUP",
      "WORK_SOURCE_MATCH",
      "SOURCE_ROLE",
      "RIGHTS_EVIDENCE",
      "NORMALIZED_CLASSIFICATION",
      "VISUAL_DESCRIPTION",
      "DUPLICATE_RELATIONSHIP",
      "CURATION_RECOMMENDATION",
      "TEACHING_RECOMMENDATION",
    ].map((key) => [key, { VERIFIED: 0, UNKNOWN: 0, PRESENT_UNVERIFIED: 0, MISSING: 1, BLOCKED: 0 }]));
    const queue = TeacherEvidenceGapReviewQueueSchema.parse({
      items: [{
        contractKind: "EVIDENCE_GAP_REVIEW",
        reviewPackId: pack.reviewPackId,
        candidateId: pack.candidateId,
        revision: pack.revision,
        title: null,
        primaryPreviewUrl: null,
        sourceSummary: null,
        verifiedCount: 2,
        missingGates: incompleteKeys,
        stage: "READY_FOR_TEACHER_TRIAGE",
        updatedAt: "2026-08-12T10:20:00.000Z",
      }],
      reviewedItems: [],
      meta: {
        totalEvidenceGapPacks: 1,
        teacherTriageReady: 1,
        teacherReviewed: 0,
        withLocalMedia: 0,
        withoutLocalMedia: 1,
        gateStatusCounts,
        boundary: {
          studentVisible: false,
          currentPage: "DISABLED",
          r2: "DISABLED",
          embedding: "DISABLED",
          lumiRetrieval: "DISABLED",
        },
      },
    });
    expect(queue.items[0]).toMatchObject({ title: null, primaryPreviewUrl: null, verifiedCount: 2 });
  });
});

import type {
  InspirationCasePrivateAnalysis,
  InspirationCasePrivateCandidate,
  InspirationCasePublishabilityReview,
  InspirationCaseTeacherDecision,
  InspirationCaseTeacherReviewPackage,
  InspirationCaseAutoAdmission,
} from "@/lib/agent/inspiration-case-intake";

export function privateCandidateIntake(
  overrides: Partial<InspirationCasePrivateCandidate> = {},
): InspirationCasePrivateCandidate {
  return {
    schemaVersion: "lumi-inspiration-private-candidate/v2",
    id: "inspiration-intake:recent-layout-rhythm",
    governance: {
      scope: "PRIVATE_CANDIDATE",
      stage: "INTAKE",
      pipelineState: "DISCOVERED",
      privateAcquisition: "P1_PRIVATE_RESEARCH_ALLOWED",
      studentVisible: false,
    },
    curation: {
      curationSourceUrl: null,
      collection: "OG Images",
      type: "OG Images",
      title: "Synthetic Recent candidate",
      description: null,
      impressions: null,
      outboundCount: null,
      originalSourceDisplay: null,
      originalSourceUrl: null,
      category: "SaaS",
      styles: ["Typographic", "Minimal"],
      colors: ["Black & White"],
      observedAt: "2026-08-09T00:00:00.000Z",
    },
    asset: {
      mode: "PRIVATE_COPY",
      privateAssetRef: "private-candidate://recent-2026-08-09/synthetic.webp",
      contentHash: "sha256:95150b31a0261578525fd674e7faf10bffefabe50e0c1e7649cdbf061987a164",
    },
    rights: {
      status: "RIGHTS_UNKNOWN",
      decisions: {
        RECORD_OFFICIAL_METADATA: "ALLOW",
        DOWNLOAD_ORIGINAL_ASSET: "UNKNOWN",
        DERIVE_PREVIEW: "UNKNOWN",
        LOCAL_PARSE: "UNKNOWN",
        OCR: "UNKNOWN",
        LOCAL_EMBEDDING: "UNKNOWN",
        EXTERNAL_EMBEDDING: "UNKNOWN",
        OBJECT_STORAGE: "UNKNOWN",
        STUDENT_DISPLAY: "UNKNOWN",
        INSTITUTIONAL_PUBLIC: "UNKNOWN",
        PUBLIC_INTERNET: "UNKNOWN",
        COMMERCIAL_REUSE: "UNKNOWN",
      },
    },
    review: {
      curation: "CANDIDATE",
      sourceDisclosure: "PENDING",
      teaching: "PENDING",
      safety: "PENDING",
      quality: "PENDING",
    },
    withdrawal: { status: "PENDING", complaintLocator: null },
    channels: { browseRelease: "DISABLED", textRag: "DISABLED", visualRag: "DISABLED" },
    evidence: [{
      id: "inspiration-intake-evidence:synthetic-recent-entry",
      label: "Synthetic Recent entry locator",
      locator: "https://recent.design/",
      recordedAt: "2026-08-09T00:00:00.000Z",
      kind: "RECENT_ENTRY",
    }],
    ...overrides,
  };
}

export function privateCandidateAnalysis(
  overrides: Partial<InspirationCasePrivateAnalysis> = {},
): InspirationCasePrivateAnalysis {
  return {
    schemaVersion: "lumi-inspiration-private-analysis/v1",
    candidateId: "inspiration-intake:recent-layout-rhythm",
    governance: { scope: "PRIVATE_CANDIDATE", stage: "ANALYSIS", pipelineState: "VISUALLY_ANALYZED", studentVisible: false },
    processing: {
      requestedChannel: "LOCAL",
      actualChannel: "LOCAL",
      providerLabel: "local:manual-visual-review",
      transmittedToThirdParty: false,
      recordedAt: "2026-08-09T00:00:00.000Z",
    },
    deduplication: { fingerprint: null, nearDuplicateCandidateIds: [], status: "NOT_RUN" },
    courseAssociations: [{
      coursePackId: "digital-interaction",
      facets: ["信息层级"],
      rationale: "待课程审核的合成关联。",
      confidence: 0.5,
      status: "PROPOSED",
    }],
    channels: { browseRelease: "DISABLED", textRag: "DISABLED", visualRag: "DISABLED" },
    ...overrides,
  };
}

export function teacherReviewPackage(
  overrides: Partial<InspirationCaseTeacherReviewPackage> = {},
): InspirationCaseTeacherReviewPackage {
  const candidate = privateCandidateIntake();
  const analysis = privateCandidateAnalysis();
  return {
    schemaVersion: "lumi-inspiration-teacher-review/v1",
    candidateId: candidate.id,
    pipelineState: "READY_FOR_TEACHER_REVIEW",
    generatedAt: "2026-08-09T00:00:00.000Z",
    preview: { mode: "PRIVATE_PREVIEW", privateAssetRef: candidate.asset.privateAssetRef },
    source: { curationSourceUrl: null, originalSourceDisplay: null, originalSourceUrl: null, attributionStatus: "UNKNOWN" },
    extractedTags: ["Typographic", "Minimal", "信息层级"],
    courseAssociations: analysis.courseAssociations,
    duplicateRisk: { nearDuplicateCandidateIds: [], signal: "NOT_RUN", explanation: "尚未运行感知去重。" },
    designSignals: { visualStyle: ["Typographic", "Minimal"], novelty: "NOT_RUN", teachingValue: "MEDIUM", explanation: "仅为教师审阅提供可解释信号。" },
    aiRecommendation: { recommendation: "REVIEW_CAREFULLY", rationale: "存在明确的版式讨论价值。", limitations: "AI 信号不是质量、作者意图或许可事实。" },
    processingLog: analysis.processing,
    channels: { browseRelease: "DISABLED", textRag: "DISABLED", visualRag: "DISABLED" },
    ...overrides,
  };
}

export function teacherDecision(
  overrides: Partial<InspirationCaseTeacherDecision> = {},
): InspirationCaseTeacherDecision {
  return {
    schemaVersion: "lumi-inspiration-teacher-decision/v1",
    candidateId: "inspiration-intake:recent-layout-rhythm",
    decision: "APPROVED",
    reviewerId: "teacher:synthetic-reviewer",
    decidedAt: "2026-08-09T00:00:00.000Z",
    revisedCourseTags: ["信息层级"],
    note: "Synthetic approval fixture only.",
    ...overrides,
  };
}

export function autoAdmission(
  overrides: Partial<InspirationCaseAutoAdmission> = {},
): InspirationCaseAutoAdmission {
  return {
    schemaVersion: "lumi-inspiration-auto-admission/v1",
    candidateId: "inspiration-intake:recent-layout-rhythm",
    pipelineState: "AUTO_ADMITTED/INDEXED",
    teacherDecisionId: "teacher-decision:synthetic-001",
    indexedAt: "2026-08-09T00:00:00.000Z",
    admissionScope: "INTERNAL_CATALOG_ONLY",
    studentVisible: false,
    channels: { browseRelease: "DISABLED", textRag: "DISABLED", visualRag: "DISABLED" },
    ...overrides,
  };
}

export function privateCandidatePublishability(
  overrides: Partial<InspirationCasePublishabilityReview> = {},
): InspirationCasePublishabilityReview {
  return {
    schemaVersion: "lumi-inspiration-admission-checklist/v1",
    candidateId: "inspiration-intake:recent-layout-rhythm",
    governance: { scope: "PRIVATE_CANDIDATE", stage: "READY_FOR_TEACHER_REVIEW", releaseActivated: false },
    review: {
      sourceDisclosure: "APPROVED",
      teaching: "APPROVED",
      safety: "APPROVED",
      qualityAndDuplicate: "APPROVED",
      course: "APPROVED",
    },
    channels: { browseRelease: "DISABLED", textRag: "DISABLED", visualRag: "DISABLED" },
    ...overrides,
  };
}

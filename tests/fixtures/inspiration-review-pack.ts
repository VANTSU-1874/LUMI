import type { StrictReviewPack } from "@/lib/domain/inspiration-wiki/review-pack-contracts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

export const strictReviewPackFixture: StrictReviewPack = {
  schemaVersion: "lumi-inspiration-review-pack/v1",
  reviewPackId: "review-pack:fixture-lighthouse-001",
  candidateId: `hermes-candidate:${"1".repeat(32)}`,
  revision: 3,
  stage: "READY_FOR_TEACHER_REVIEW",
  materialHash: HASH_A,
  preparedAt: "2026-08-12T02:00:00.000Z",
  work: {
    title: "灯塔字体节视觉识别系统",
    creators: ["Studio North"],
    year: "2025",
    workSourceMatch: {
      status: "MATCHED",
      evidence: ["封面、标题与作者署名在作者作品页及策展记录中一致。"],
    },
  },
  sources: [
    {
      sourceId: "source-pinterest-discovery",
      platform: "PINTEREST",
      role: "DISCOVERY_POINTER",
      label: "Pinterest 发现记录",
      pageUrl: "https://www.pinterest.com/pin/123456789/",
      creatorName: null,
      curatorName: null,
      creatorRelationship: "DISCOVERY_ONLY",
      evidenceStatement: "仅用于发现候选，不承担作品身份或权利证明。",
    },
    {
      sourceId: "source-behance-creator",
      platform: "BEHANCE",
      role: "CREATOR_WORK_PAGE",
      label: "Behance 作者作品页",
      pageUrl: "https://www.behance.net/gallery/123456789/lighthouse-type-festival",
      creatorName: "Studio North",
      curatorName: null,
      creatorRelationship: "DIRECT_CREATOR_PAGE",
      evidenceStatement: "用于核验作品、标题与作者关系；不代表 Lumi 已获得再发布许可。",
    },
    {
      sourceId: "source-bpando-curation",
      platform: "BPANDO",
      role: "CURATORIAL_INDEX",
      label: "BP&O 策展索引",
      pageUrl: "https://bpando.org/2025/06/lighthouse-type-festival/",
      creatorName: "Studio North",
      curatorName: "BP&O",
      creatorRelationship: "CURATED_CREATOR_RECORD",
      evidenceStatement: "保留策展来源与其指向的原始创作者关系。",
    },
  ],
  mediaGroup: [
    { mediaId: "media-cover", role: "COVER", previewUrl: "/demo/layout-poster-after-preset.svg", width: 960, height: 640, sha256: HASH_A, alt: "灯塔字体节主视觉版式" },
    { mediaId: "media-detail", role: "DETAIL", previewUrl: "/demo/digital-interaction-proposal-board-preset.svg", width: 960, height: 640, sha256: HASH_B, alt: "字体与色彩细节板" },
    { mediaId: "media-context", role: "CONTEXT", previewUrl: "/demo/digital-interaction-three-states-preset.svg", width: 960, height: 640, sha256: HASH_C, alt: "应用场景与延展画面" },
  ],
  rightsEvidence: [{
    evidenceId: "rights-source-terms",
    evidenceType: "SOURCE_TERMS",
    sourceUrl: "https://www.behance.net/misc/terms",
    capturedAt: "2026-08-12T01:30:00.000Z",
    summary: "作者作品页可作为公开展示事实的证据；再发布许可仍需教师独立判断。",
    privateTeacherReviewDecision: "ALLOW",
    republicationDecision: "UNKNOWN",
    authorPageIsNotRepublishingPermission: true,
  }],
  normalizedClassification: {
    primary: "视觉识别",
    secondary: ["字体设计", "海报"],
    sourceTerms: ["typography", "visual identity", "poster"],
  },
  visualDescription: {
    summary: "高对比黑红配色、压缩字面与几何灯塔图形共同构成活动识别；画面以大字号中文标题建立主层级。",
    observations: [
      { observation: "标题占据左上主要视觉重量，正文以窄栏支撑信息层级。", mediaIds: ["media-cover"] },
      { observation: "红色只用于关键日期与灯塔形态，形成稳定的视觉锚点。", mediaIds: ["media-cover", "media-detail"] },
    ],
  },
  duplicateRelationship: {
    status: "DISTINCT",
    relatedCandidateIds: [],
    explanation: "未发现 canonical URL、作者项目或图组层面的重复对象。",
  },
  curationRecommendation: {
    recommendation: "RECOMMEND",
    rationale: "项目图组完整，能呈现同一识别系统从主视觉到应用延展的关系。",
  },
  teachingRecommendation: {
    recommendation: "RECOMMEND",
    rationale: "适合讨论中文标题字面压缩、黑红对比与活动识别的一致性。",
    prompts: ["哪些元素承担了活动识别的一致性？", "红色的使用范围如何控制视觉节奏？"],
    cautions: ["只讨论可见设计关系，不推断作者未说明的创作意图。"],
  },
  safetyAssessment: {
    status: "READY_FOR_TEACHER_DECISION",
    evidence: ["未见成人、暴力、仇恨或个人隐私内容；仍由教师作最终安全结论。"],
  },
  readiness: {
    controlledMediaGroup: true,
    workSourceMatch: true,
    sourceRole: true,
    rightsEvidence: true,
    normalizedClassification: true,
    visualDescription: true,
    duplicateRelationship: true,
    curationRecommendation: true,
    teachingRecommendation: true,
  },
  capabilityBoundary: {
    teacherPrivate: true,
    studentVisible: false,
    currentPage: "DISABLED",
    r2: "DISABLED",
    embedding: "DISABLED",
    lumiRetrieval: "DISABLED",
  },
};

export const acceptedReviewDecisionFixture = {
  reviewPackId: strictReviewPackFixture.reviewPackId,
  reviewPackRevision: strictReviewPackFixture.revision,
  assessment: {
    workSourceMatch: "MATCH" as const,
    classificationDescription: "ACCURATE" as const,
    curationValue: "VALUABLE" as const,
    teachingValue: "VALUABLE" as const,
    rightsSafety: "SUFFICIENT_FOR_PRIVATE_WIKIDRAFT" as const,
    duplicateRelationship: "DISTINCT" as const,
  },
  finalAction: "ENTER_PRIVATE_WIKIDRAFT" as const,
  note: "",
  idempotencyKey: "fixture-private-draft-001",
};

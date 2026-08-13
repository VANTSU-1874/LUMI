import { describe, expect, it } from "vitest";

import {
  PrivateWikiDraftSchema,
  privateDraftCompletion,
  type PrivateWikiDraftEditable,
} from "@/lib/domain/inspiration-wiki/private-draft-contracts";

const editable: PrivateWikiDraftEditable = {
  title: "灯塔字体节视觉识别系统",
  summary: "黑红配色、压缩字面与几何灯塔图形形成活动识别。",
  classification: { primary: "视觉识别", secondary: ["字体设计", "海报"] },
  artisticStyle: { labels: ["实验字体", "几何抽象"], rationale: "压缩字面与几何图形建立高对比秩序。" },
  curation: { recommendation: "RECOMMEND", rationale: "图组能够呈现主视觉到应用延展。" },
  teaching: {
    recommendation: "RECOMMEND",
    rationale: "适合讨论字体压缩和有限色彩的系统性。",
    prompts: ["哪些元素维持了活动识别的一致性？"],
    cautions: ["只讨论可见设计关系。"],
  },
  media: [{
    mediaId: "media-cover",
    previewUrl: "/api/teacher/inspiration-wiki/review-packs/review-pack:fixture/media/media-cover",
    role: "COVER",
    alt: "灯塔字体节主视觉",
    width: 960,
    height: 640,
    sha256: "a".repeat(64),
  }],
  editorialNote: "",
};

function draft() {
  const completion = privateDraftCompletion(editable);
  return {
    schemaVersion: "lumi-inspiration-private-working-draft/v1" as const,
    draftId: `private-wiki-draft:${"1".repeat(32)}`,
    candidateId: `hermes-candidate:${"1".repeat(32)}`,
    sourceReview: {
      contractKind: "STRICT_REVIEW_PACK" as const,
      reviewPackId: "review-pack:fixture-lighthouse-001",
      reviewPackRevision: 3,
      decisionId: "decision-fixture-private-draft",
      decisionAction: "ENTER_PRIVATE_WIKIDRAFT" as const,
      acceptedGapKeys: [],
    },
    revision: 1,
    stage: "EDITING" as const,
    contentHash: "b".repeat(64),
    updatedAt: "2026-08-12T15:20:00.000Z",
    editable,
    work: { creators: ["Studio North"], year: "2025" },
    sourceRecords: [{
      sourceId: "source-behance",
      platform: "BEHANCE" as const,
      pageUrl: "https://www.behance.net/gallery/123/lighthouse",
      role: "CREATOR_WORK_PAGE",
      creatorName: "Studio North",
      curatorName: null,
    }],
    rights: { status: "UNKNOWN" as const, evidenceSummaries: ["正式再发布许可仍未知。"], formalRepublicationAllowed: false as const },
    visualObservations: [{ observation: "红色形成稳定视觉锚点。", mediaIds: ["media-cover"] }],
    duplicateRelationship: { status: "DISTINCT" as const, relatedCandidateIds: [], explanation: "未发现重复。" },
    safety: { status: "READY_FOR_TEACHER_DECISION" as const, evidence: ["无学生数据。"] },
    evidenceGaps: [],
    completion,
    capabilityBoundary: {
      teacherPrivate: true as const,
      studentVisible: false as const,
      currentPage: "DISABLED" as const,
      r2: "DISABLED" as const,
      embedding: "DISABLED" as const,
      lumiRetrieval: "DISABLED" as const,
    },
  };
}

describe("private WikiDraft contract", () => {
  it("derives seven editorial completion gates", () => {
    expect(privateDraftCompletion(editable)).toEqual({
      completedKeys: ["TITLE", "SUMMARY", "CLASSIFICATION", "ARTISTIC_STYLE", "CURATION", "TEACHING", "MEDIA"],
      missingKeys: [],
      completedCount: 7,
      totalCount: 7,
      ready: true,
    });
  });

  it("allows incomplete editing but prevents premature domain review", () => {
    const incomplete = { ...editable, artisticStyle: { labels: [], rationale: "" } };
    const value = { ...draft(), editable: incomplete, completion: privateDraftCompletion(incomplete) };
    expect(PrivateWikiDraftSchema.parse(value).completion.ready).toBe(false);
    expect(() => PrivateWikiDraftSchema.parse({ ...value, stage: "READY_FOR_DOMAIN_REVIEW" })).toThrow();
  });

  it("keeps student and publication capabilities fail-closed", () => {
    expect(() => PrivateWikiDraftSchema.parse({
      ...draft(),
      capabilityBoundary: { ...draft().capabilityBoundary, studentVisible: true },
    })).toThrow();
  });
});

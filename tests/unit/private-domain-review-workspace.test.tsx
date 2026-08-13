import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrivateDomainReviewEditor } from "@/components/teacher/PrivateDomainReviewEditor";
import { PrivateDomainReviewWorkspace } from "@/components/teacher/PrivateDomainReviewWorkspace";
import type { PrivateWikiDraft } from "@/lib/domain/inspiration-wiki/private-draft-contracts";

const pending = { status: "PENDING" as const, decisionId: null, reviewerId: null, note: null, decidedAt: null };
const draft: PrivateWikiDraft = {
  schemaVersion: "lumi-inspiration-private-working-draft/v1",
  draftId: `private-wiki-draft:${"1".repeat(32)}`,
  candidateId: `hermes-candidate:${"2".repeat(32)}`,
  sourceReview: { contractKind: "STRICT_REVIEW_PACK", reviewPackId: "review-pack:test", reviewPackRevision: 1, decisionId: "decision-test", decisionAction: "ENTER_PRIVATE_WIKIDRAFT", acceptedGapKeys: [] },
  revision: 2,
  stage: "READY_FOR_DOMAIN_REVIEW",
  contentHash: "a".repeat(64),
  updatedAt: "2026-08-12T16:20:00.000Z",
  editable: {
    title: "周年视觉识别",
    summary: "以几何数字、双语层级和多种物料构成周年识别系统。",
    classification: { primary: "品牌视觉识别", secondary: ["周年标志"] },
    artisticStyle: { labels: ["几何现代主义"], rationale: "几何切分和鲜明色块建立秩序。" },
    curation: { recommendation: "RECOMMEND", rationale: "具有跨媒介比较价值。" },
    teaching: { recommendation: "RECOMMEND", rationale: "适合分析缩放和层级。", prompts: ["哪些细节维持辨识？"], cautions: ["不推断客户立场。"] },
    media: [{ mediaId: "media-cover", previewUrl: "/api/teacher/inspiration-wiki/review-packs/review-pack:test/media/media-cover", role: "COVER", alt: "周年主图", width: 1200, height: 900, sha256: "b".repeat(64) }],
    editorialNote: "",
  },
  work: { creators: ["示例工作室"], year: "2026" },
  sourceRecords: [{ sourceId: "source-1", platform: "HESIGN", pageUrl: "https://www.hesign.com/works/test", role: "CREATOR_WORK_PAGE", creatorName: "示例工作室", curatorName: null }],
  rights: { status: "UNKNOWN", evidenceSummaries: ["权利状态未知。"], formalRepublicationAllowed: false },
  visualObservations: [{ observation: "几何色块构成数字标志。", mediaIds: ["media-cover"] }],
  duplicateRelationship: { status: "DISTINCT", relatedCandidateIds: [], explanation: "未发现重复。" },
  safety: { status: "READY_FOR_TEACHER_DECISION", evidence: ["不含学生数据。"] },
  evidenceGaps: [],
  completion: { completedKeys: ["TITLE", "SUMMARY", "CLASSIFICATION", "ARTISTIC_STYLE", "CURATION", "TEACHING", "MEDIA"], missingKeys: [], completedCount: 7, totalCount: 7, ready: true },
  capabilityBoundary: { teacherPrivate: true, studentVisible: false, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" },
};

const reviewCase = {
  schemaVersion: "lumi-inspiration-private-domain-review/v1" as const,
  reviewCaseId: `private-domain-review:${"3".repeat(32)}`,
  draftBinding: { draftId: draft.draftId, candidateId: draft.candidateId, revision: draft.revision, contentHash: draft.contentHash },
  revision: 1,
  stateHash: "c".repeat(64),
  stage: "PENDING_DOMAIN_REVIEW" as const,
  domains: { CURATION: pending, TEACHING: pending, RIGHTS: pending, SAFETY: pending },
  reviewedDomainCount: 0,
  rightsScope: "UNKNOWN_PRIVATE_ONLY" as const,
  createdAt: "2026-08-12T16:30:00.000Z",
  updatedAt: "2026-08-12T16:30:00.000Z",
  capabilityBoundary: { teacherPrivate: true as const, studentVisible: false as const, currentPage: "DISABLED" as const, r2: "DISABLED" as const, embedding: "DISABLED" as const, lumiRetrieval: "DISABLED" as const, canonicalCompilation: "DISABLED" as const },
};

describe("private domain review workbench", () => {
  afterEach(cleanup);

  it("shows a twelve-item teaching queue with batch selection and searchable material", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      items: [{ reviewCaseId: reviewCase.reviewCaseId, draftId: draft.draftId, candidateId: draft.candidateId, revision: 1, stateHash: reviewCase.stateHash, stage: reviewCase.stage, title: draft.editable.title, primaryCategory: draft.editable.classification.primary, artisticStyleLabels: draft.editable.artisticStyle.labels, primaryPreviewUrl: draft.editable.media[0]!.previewUrl, teaching: draft.editable.teaching, reviewedDomainCount: 0, domains: reviewCase.domains, updatedAt: reviewCase.updatedAt }],
      meta: { total: 1, pending: 1, hold: 0, rejected: 0, complete: 0, reviewedDomains: 0, totalDomains: 4, rightsUnknown: 1, teachingPending: 1, teachingApproved: 0, teachingHold: 0, teachingRejected: 0, nonTeachingApproved: 0, nonTeachingTotal: 3, boundary: { studentVisible: false, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED", canonicalCompilation: "DISABLED" } },
    }));
    render(<PrivateDomainReviewWorkspace fetcher={fetcher} />);
    expect(await screen.findByText("1 件作品，每屏 12 件快速分流。")).toBeInTheDocument();
    expect(screen.getByText(draft.editable.teaching.rationale)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "整批确认三域" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "单独查看" })).toHaveAttribute("href", `/teacher/inspiration-wiki/domain-reviews/${encodeURIComponent(reviewCase.reviewCaseId)}`);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索教学域复核任务" }), { target: { value: "不存在" } });
    expect(screen.getByText("没有符合当前筛选的作品。")).toBeInTheDocument();
  });

  it("submits selected teaching-ready cards as one bounded batch", async () => {
    const approved = { status: "APPROVED" as const, decisionId: "decision-baseline", reviewerId: "teacher", note: null, decidedAt: "2026-08-12T16:31:00.000Z" };
    const domains = { CURATION: approved, TEACHING: pending, RIGHTS: approved, SAFETY: approved };
    const queue = {
      items: [{ reviewCaseId: reviewCase.reviewCaseId, draftId: draft.draftId, candidateId: draft.candidateId, revision: 4, stateHash: reviewCase.stateHash, stage: "PENDING_DOMAIN_REVIEW" as const, title: draft.editable.title, primaryCategory: draft.editable.classification.primary, artisticStyleLabels: draft.editable.artisticStyle.labels, primaryPreviewUrl: draft.editable.media[0]!.previewUrl, teaching: draft.editable.teaching, reviewedDomainCount: 3, domains, updatedAt: reviewCase.updatedAt }],
      meta: { total: 1, pending: 1, hold: 0, rejected: 0, complete: 0, reviewedDomains: 3, totalDomains: 4, rightsUnknown: 1, teachingPending: 1, teachingApproved: 0, teachingHold: 0, teachingRejected: 0, nonTeachingApproved: 3, nonTeachingTotal: 3, boundary: { studentVisible: false as const, currentPage: "DISABLED" as const, r2: "DISABLED" as const, embedding: "DISABLED" as const, lumiRetrieval: "DISABLED" as const, canonicalCompilation: "DISABLED" as const } },
    };
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => init?.method === "POST"
      ? Response.json({ receipts: [{ reviewCaseId: reviewCase.reviewCaseId, decisionId: "decision-teaching", revision: 5, stage: "DOMAIN_REVIEW_COMPLETE", replayed: false, decidedAt: "2026-08-12T16:35:00.000Z" }], summary: { total: 1, approved: 1, held: 0, rejected: 0, replayed: 0 } }, { status: 201 })
      : Response.json(queue));
    render(<PrivateDomainReviewWorkspace fetcher={fetcher} />);
    await screen.findByText(draft.editable.teaching.rationale);
    fireEvent.click(screen.getByRole("checkbox", { name: `选择 ${draft.editable.title}` }));
    fireEvent.click(screen.getByRole("button", { name: "提交当前 1 项" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/teacher/inspiration-wiki/domain-reviews/teaching-decisions");
    const body = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(body.items).toEqual([{ reviewCaseId: reviewCase.reviewCaseId, expectedRevision: 4, expectedStateHash: reviewCase.stateHash, decision: "APPROVE", issueKeys: [], note: "" }]);
  });

  it("edits only teaching in the single-item view and offers no publication action", async () => {
    const approved = { status: "APPROVED" as const, decisionId: "decision-baseline", reviewerId: "teacher", note: null, decidedAt: "2026-08-12T16:31:00.000Z" };
    const baselineReviewCase = { ...reviewCase, revision: 4, reviewedDomainCount: 3, domains: { CURATION: approved, TEACHING: pending, RIGHTS: approved, SAFETY: approved } };
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "POST") return Response.json({ reviewCaseId: reviewCase.reviewCaseId, decisionId: "private-domain-decision:test", revision: 2, stage: "PENDING_DOMAIN_REVIEW", replayed: false, decidedAt: "2026-08-12T16:35:00.000Z" }, { status: 201 });
      return Response.json({ reviewCase: baselineReviewCase, draft });
    });
    render(<PrivateDomainReviewEditor reviewCaseId={reviewCase.reviewCaseId} fetcher={fetcher} />);
    expect(await screen.findByText(draft.editable.summary)).toBeInTheDocument();
    expect(screen.getByText("策展、权利、安全已由本批统一确认，此处只编辑教学域。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /发布|学生可见|Current Page|R2|Embedding|Lumi/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "教学域通过" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const body = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(body).toMatchObject({ reviewDomain: "TEACHING", decision: "APPROVE", assessment: { teachingValue: "YES", promptsUsable: "YES", cautionsClear: "YES" } });
  });
});

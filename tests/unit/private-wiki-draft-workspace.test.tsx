import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrivateWikiDraftEditor } from "@/components/teacher/PrivateWikiDraftEditor";
import { PrivateWikiDraftWorkspace } from "@/components/teacher/PrivateWikiDraftWorkspace";
import { privateDraftCompletion, type PrivateWikiDraft, type PrivateWikiDraftEditable } from "@/lib/domain/inspiration-wiki/private-draft-contracts";

const editable: PrivateWikiDraftEditable = {
  title: "周年视觉识别",
  summary: "以几何数字、双语层级和多种物料共同构成周年识别系统。",
  classification: { primary: "品牌视觉识别", secondary: ["周年标志", "印刷物应用"] },
  artisticStyle: { labels: ["几何现代主义", "高对比色块"], rationale: "以几何切分、鲜明色块和克制留白建立视觉秩序。" },
  curation: { recommendation: "RECOMMEND", rationale: "适合作为周年识别跨媒介延展案例。" },
  teaching: { recommendation: "RECOMMEND", rationale: "可训练数字骨架与缩放测试。", prompts: ["哪些几何片段维持数字辨识？"], cautions: ["不推断客户立场。"] },
  media: [{ mediaId: "media-cover", previewUrl: "/api/teacher/inspiration-wiki/review-packs/review-pack:test/media/media-cover", role: "COVER", alt: "周年视觉主图", width: 1200, height: 900, sha256: "a".repeat(64) }],
  editorialNote: "由教师审核结果编纂。",
};

const draft: PrivateWikiDraft = {
  schemaVersion: "lumi-inspiration-private-working-draft/v1",
  draftId: `private-wiki-draft:${"1".repeat(32)}`,
  candidateId: `hermes-candidate:${"2".repeat(32)}`,
  sourceReview: { contractKind: "EVIDENCE_GAP_REVIEW", reviewPackId: "review-pack:test", reviewPackRevision: 2, decisionId: "decision-test", decisionAction: "ENTER_PRIVATE_WIKIDRAFT", acceptedGapKeys: ["RIGHTS_EVIDENCE"] },
  revision: 1,
  stage: "EDITING",
  contentHash: "b".repeat(64),
  updatedAt: "2026-08-12T15:20:00.000Z",
  editable,
  work: { creators: ["示例工作室"], year: "2026" },
  sourceRecords: [{ sourceId: "source-1", platform: "HESIGN", pageUrl: "https://www.hesign.com/works/test", role: "CREATOR_WORK_PAGE", creatorName: "示例工作室", curatorName: null }],
  rights: { status: "UNKNOWN", evidenceSummaries: ["公开作品页不等于再发布许可。"], formalRepublicationAllowed: false },
  visualObservations: [{ observation: "几何色块构成数字标志。", mediaIds: ["media-cover"] }],
  duplicateRelationship: { status: "DISTINCT", relatedCandidateIds: [], explanation: "未发现重复。" },
  safety: { status: "READY_FOR_TEACHER_DECISION", evidence: ["不含学生数据。"] },
  evidenceGaps: ["RIGHTS_EVIDENCE"],
  completion: privateDraftCompletion(editable),
  capabilityBoundary: { teacherPrivate: true, studentVisible: false, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" },
};

describe("Private WikiDraft workbench", () => {
  afterEach(cleanup);

  it("shows the compiled queue, rights boundary and searchable style metadata", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      items: [{ draftId: draft.draftId, candidateId: draft.candidateId, revision: 1, stage: "EDITING", title: editable.title, primaryCategory: editable.classification.primary, artisticStyleLabels: editable.artisticStyle.labels, primaryPreviewUrl: editable.media[0]!.previewUrl, sourceContractKind: "EVIDENCE_GAP_REVIEW", evidenceGapCount: 1, completedCount: 7, updatedAt: draft.updatedAt }],
      meta: { total: 1, editing: 1, readyForDomainReview: 0, strictSource: 0, evidenceGapSource: 1, rightsUnknown: 1, rejectedExcluded: 23, boundary: { studentVisible: false, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" } },
    }));

    render(<PrivateWikiDraftWorkspace fetcher={fetcher} />);
    expect(await screen.findByText("177 个通过项，进入编纂而不是发布。")).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === "1 条权利状态仍为未知")).toBeInTheDocument();
    expect(screen.getByText(/品牌视觉识别 · 几何现代主义 \/ 高对比色块/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "编辑周年视觉识别" })).toHaveAttribute("href", `/teacher/inspiration-wiki/drafts/${encodeURIComponent(draft.draftId)}`);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索草稿" }), { target: { value: "不存在的风格" } });
    expect(screen.getByText("没有符合当前筛选的草稿。")).toBeInTheDocument();
  });

  it("edits all seven compilation domains and sends a complete draft to domain review", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (!init?.method) return Response.json(draft);
      const body = JSON.parse(String(init.body));
      return Response.json({ draft: { ...draft, revision: 2, stage: body.stage, updatedAt: "2026-08-12T15:30:00.000Z", editable: body.editable, completion: privateDraftCompletion(body.editable), contentHash: "c".repeat(64) } });
    });

    render(<PrivateWikiDraftEditor draftId={draft.draftId} fetcher={fetcher} />);
    expect(await screen.findByDisplayValue("周年视觉识别")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "艺术表现风格" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "策展建议" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "教学建议" })).toBeInTheDocument();
    expect(screen.getByText("示例工作室 · 创作者作品页")).toBeInTheDocument();
    expect(screen.getByText("主图", { selector: "small" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送入分域复核" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /发布|学生可见|Current Page|R2|Embedding|Lumi 引用/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "送入分域复核" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(body.stage).toBe("READY_FOR_DOMAIN_REVIEW");
    expect(body.editable.artisticStyle.labels).toEqual(["几何现代主义", "高对比色块"]);
    expect(await screen.findByText("待分域复核")).toBeInTheDocument();
  });
});

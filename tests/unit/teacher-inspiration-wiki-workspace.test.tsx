import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeacherInspirationWikiWorkspace } from "@/components/teacher/TeacherInspirationWikiWorkspace";

const completedGates = {
  CONTROLLED_MEDIA_GROUP: 0,
  WORK_SOURCE_MATCH: 0,
  SOURCE_ROLE: 0,
  RIGHTS_EVIDENCE: 0,
  NORMALIZED_CLASSIFICATION: 0,
  VISUAL_DESCRIPTION: 0,
  DUPLICATE_RELATIONSHIP: 0,
  CURATION_RECOMMENDATION: 0,
  TEACHING_RECOMMENDATION: 0,
};

const emptyGapGateCounts = Object.fromEntries(Object.keys(completedGates).map((key) => [key, {
  VERIFIED: 0,
  UNKNOWN: 0,
  PRESENT_UNVERIFIED: 0,
  MISSING: 0,
  BLOCKED: 0,
}]));

const privateBoundary = { studentVisible: false, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" } as const;

function gapQueue(items: Array<Record<string, unknown>> = [], reviewedItems: Array<Record<string, unknown>> = []) {
  return {
    items,
    reviewedItems,
    meta: {
      totalEvidenceGapPacks: items.length + reviewedItems.length,
      teacherTriageReady: items.length,
      teacherReviewed: reviewedItems.length,
      withLocalMedia: [...items, ...reviewedItems].filter((item) => item.primaryPreviewUrl !== null).length,
      withoutLocalMedia: [...items, ...reviewedItems].filter((item) => item.primaryPreviewUrl === null).length,
      gateStatusCounts: emptyGapGateCounts,
      boundary: privateBoundary,
    },
  };
}

describe("TeacherInspirationWikiWorkspace", () => {
  afterEach(cleanup);

  it("separates 200 governance materials from an empty strict teacher queue", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/teacher/inspiration-wiki/review-packs") return Response.json({
        items: [],
        reviewedItems: [],
        meta: {
          totalGovernanceMaterials: 200,
          totalReviewPacks: 0,
          teacherReviewReady: 0,
          teacherReviewed: 0,
          returnedToCodex: 0,
          rejected: 0,
          privateWikiDraft: 0,
          requiredGateCount: 9,
          completedGates,
          boundary: { studentVisible: false, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" },
        },
      });
      if (url === "/api/teacher/inspiration-wiki/review-packs/evidence-gaps") return Response.json(gapQueue());
      if (url.startsWith("/api/teacher/inspiration-wiki/candidates?")) return Response.json({
        items: [],
        meta: { total: 200, returned: 0, truncated: true, failed: 35, reviewReady: 0, needsNormalization: 200, rightsHold: 0, readyForDraft: 0, availableImages: 0, rightsHintDistribution: { UNKNOWN: 200 } },
      });
      throw new Error(`unexpected ${url}`);
    });

    render(<TeacherInspirationWikiWorkspace fetcher={fetcher} />);

    expect(await screen.findByText("0/200")).toBeInTheDocument();
    expect(screen.getAllByText("当前无需教师操作").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "进入私有草稿编纂" })).toHaveAttribute("href", "/teacher/inspiration-wiki/drafts");
    expect(screen.getByText(/只读元数据索引/)).toBeInTheDocument();
    expect(screen.getByText(/严格包与缺证包当前都没有待判断项目/)).toBeInTheDocument();
    expect(screen.queryByText("正式发布")).not.toBeInTheDocument();
  });

  it("shows controlled previews only for strict ReviewPacks that are ready for teacher review", async () => {
    const previewUrl = "/api/teacher/inspiration-wiki/review-packs/review-pack:first-batch-001/media/media-cover";
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/teacher/inspiration-wiki/review-packs") return Response.json({
        items: [{
          reviewPackId: "review-pack:first-batch-001",
          candidateId: `hermes-candidate:${"1".repeat(32)}`,
          revision: 1,
          title: "首批严格审核作品",
          primaryPreviewUrl: previewUrl,
          sourceSummary: "Typographic Posters · CURATORIAL_INDEX",
          updatedAt: "2026-08-12T03:00:00.000Z",
        }],
        reviewedItems: [{
          reviewPackId: "review-pack:reviewed-item-001",
          candidateId: `hermes-candidate:${"2".repeat(32)}`,
          revision: 2,
          title: "已完成审核作品",
          primaryPreviewUrl: "/api/teacher/inspiration-wiki/review-packs/review-pack:reviewed-item-001/media/media-cover",
          sourceSummary: "Hesign · CREATOR_WORK_PAGE",
          stage: "PRIVATE_WIKIDRAFT",
          updatedAt: "2026-08-12T04:00:00.000Z",
        }],
        meta: {
          totalGovernanceMaterials: 200,
          totalReviewPacks: 2,
          teacherReviewReady: 1,
          teacherReviewed: 1,
          returnedToCodex: 0,
          rejected: 0,
          privateWikiDraft: 1,
          requiredGateCount: 9,
          completedGates: Object.fromEntries(Object.keys(completedGates).map((key) => [key, 1])),
          boundary: { studentVisible: false, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" },
        },
      });
      if (url === "/api/teacher/inspiration-wiki/review-packs/evidence-gaps") return Response.json(gapQueue([{
        contractKind: "EVIDENCE_GAP_REVIEW",
        reviewPackId: "review-pack:evidence-gap-item-001",
        candidateId: `hermes-candidate:${"3".repeat(32)}`,
        revision: 1,
        title: "图片仍待补证的候选",
        primaryPreviewUrl: null,
        sourceSummary: "Pinterest · DISCOVERY_POINTER",
        verifiedCount: 2,
        missingGates: ["CONTROLLED_MEDIA_GROUP", "RIGHTS_EVIDENCE", "VISUAL_DESCRIPTION"],
        stage: "READY_FOR_TEACHER_TRIAGE",
        updatedAt: "2026-08-12T04:30:00.000Z",
      }], [{
        contractKind: "EVIDENCE_GAP_REVIEW",
        reviewPackId: "review-pack:evidence-gap-reviewed-001",
        candidateId: `hermes-candidate:${"4".repeat(32)}`,
        revision: 2,
        title: "已审核缺证候选",
        primaryPreviewUrl: null,
        sourceSummary: "Notefolio · CREATOR_WORK_PAGE",
        verifiedCount: 3,
        missingGates: ["RIGHTS_EVIDENCE", "VISUAL_DESCRIPTION"],
        stage: "REJECTED",
        updatedAt: "2026-08-12T05:00:00.000Z",
      }]));
      if (url.startsWith("/api/teacher/inspiration-wiki/candidates?")) return Response.json({
        items: [],
        meta: { total: 200, returned: 0, truncated: true, failed: 35, reviewReady: 0, needsNormalization: 200, rightsHold: 0, readyForDraft: 0, availableImages: 0, rightsHintDistribution: { UNKNOWN: 200 } },
      });
      throw new Error(`unexpected ${url}`);
    });

    const { container } = render(<TeacherInspirationWikiWorkspace fetcher={fetcher} />);

    expect(await screen.findByText("2/200")).toBeInTheDocument();
    expect(screen.getByText("首批严格审核作品")).toBeInTheDocument();
    expect(screen.getByText("图片仍待补证的候选")).toBeInTheDocument();
    expect(screen.getByText("无受控图片")).toBeInTheDocument();
    expect(screen.getByText("2 项已分析")).toBeInTheDocument();
    expect(screen.getByText("已完成审核作品")).toBeInTheDocument();
    expect(screen.getByText("已进入私有草稿")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已审核队列" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("已审核严格包")).getByRole("link", { name: "再次编辑已完成审核作品" })).toHaveAttribute("href", "/teacher/inspiration-wiki/review/review-pack%3Areviewed-item-001");
    expect(within(screen.getByLabelText("已审核缺证候选")).getByRole("link", { name: "再次编辑已审核缺证候选" })).toHaveAttribute("href", "/teacher/inspiration-wiki/review/gap/review-pack%3Aevidence-gap-reviewed-001");
    expect(screen.getByRole("link", { name: "审核首批严格审核作品" })).toHaveAttribute("href", "/teacher/inspiration-wiki/review/review-pack%3Afirst-batch-001");
    expect(screen.getByRole("link", { name: "审核缺证候选图片仍待补证的候选" })).toHaveAttribute("href", "/teacher/inspiration-wiki/review/gap/review-pack%3Aevidence-gap-item-001");
    expect(container.querySelector(`img[src="${previewUrl}"]`)).not.toBeNull();
  });
});

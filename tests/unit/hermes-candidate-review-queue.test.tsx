import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HermesCandidateReviewQueue } from "@/components/teacher/HermesCandidateReviewQueue";

const candidate = {
  id: `hermes-candidate:${"1".repeat(32)}`,
  batchId: "hermes-test-ui-001",
  sourceCandidateId: "hc-test-ui-candidate-001",
  revision: 1,
  contractState: "V1_UPGRADE_REQUIRED",
  reviewState: "PENDING_REVIEW",
  source: {
    sourceId: "source-a",
    platform: "OTHER_PUBLIC_WEB",
    pageUrl: "https://example.com/work",
    canonicalUrl: "https://example.com/work",
  },
  content: { title: "Private design candidate", description: null },
  author: { displayName: "Source byline", profileUrl: null },
  license: null,
  media: { count: 1, kinds: ["IMAGE"], controlledPreviewAvailable: false },
  designCategories: ["PRINT", "TYPOGRAPHY"],
  screening: { totalScore: 24, evidence: ["Public page contains traceable design evidence."] },
  capabilityBoundary: {
    scope: "PRIVATE_CANDIDATE",
    studentVisible: false,
    wikiDraft: "NOT_CREATED",
    currentPage: "DISABLED",
    r2: "DISABLED",
    embedding: "DISABLED",
    lumiRetrieval: "DISABLED",
  },
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

const queue = {
  items: [candidate],
  meta: {
    total: 1,
    limit: 20,
    offset: 0,
    stateCounts: {
      PENDING_REVIEW: 1,
      NORMALIZATION_REQUIRED: 0,
      DUPLICATE_HOLD: 0,
      RIGHTS_HOLD: 0,
      REJECTED: 0,
    },
    readiness: {
      teacherReviewReady: 0,
      controlledPreviewReady: 0,
      rightsEvidenceReady: 0,
      descriptionsReady: 0,
      v2Normalized: 0,
      blocked: { rights: 1, preview: 1, description: 1, normalization: 1 },
    },
    sources: [{
      sourceId: "source-a",
      total: 1,
      rightsEvidenceReady: 0,
      descriptionsReady: 0,
      controlledPreviewReady: 0,
    }],
  },
};

describe("Hermes candidate governance readiness", () => {
  it("shows a no-action readiness gate and a read-only metadata index", async () => {
    const fetcher = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return Response.json(queue);
    });
    const { container } = render(<HermesCandidateReviewQueue fetcher={fetcher} />);

    expect(await screen.findByText("印刷与海报与字体与排版候选")).toBeInTheDocument();
    expect(screen.queryByText("Private design candidate")).not.toBeInTheDocument();
    expect(screen.queryByText("Source byline")).not.toBeInTheDocument();
    expect(screen.getByText("当前无需教师逐条操作")).toBeInTheDocument();
    expect(screen.getByText("教师可审")).toBeInTheDocument();
    expect(screen.getByText("新版规范化")).toBeInTheDocument();
    expect(screen.getByText("查看只读原始候选索引（1 条）")).toBeInTheDocument();
    expect(screen.getByText("仅记录到远程媒体；当前不构成可审核图像证据")).toBeInTheDocument();
    expect(screen.queryByLabelText("审核备注")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "待规范化" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "权利暂缓" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拒绝候选" })).not.toBeInTheDocument();
    expect(screen.queryByText("通过并正式发布给学生")).not.toBeInTheDocument();
    expect(screen.queryByText("通过并留在内部目录")).not.toBeInTheDocument();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("cdn.example.com");
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
});

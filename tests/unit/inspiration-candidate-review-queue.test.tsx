import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InspirationCandidateReviewQueue } from "@/components/teacher/InspirationCandidateReviewQueue";

afterEach(() => cleanup());

function response(payload: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }));
}

const candidate = {
  id: "inspiration:0123456789abcdef01234567",
  revision: 5,
  state: "READY_FOR_TEACHER_REVIEW",
  withdrawalStatus: "READY",
  curation: {
    title: "节奏化版式参考", description: "合规 fixture", observedAt: "2026-08-09T00:00:00.000Z",
    curationSourceUrl: "https://example.org/curation", originalSourceDisplay: "示例原始来源", originalSourceUrl: "https://example.org/original",
    category: "Editorial", styles: ["Grid"], colors: ["Warm"],
  },
  asset: { mode: "PRIVATE_COPY" },
  analysis: { courseAssociations: [{ coursePackId: "design-foundations", facets: ["信息层级"], rationale: "结构清楚", confidence: 0.88, status: "PROPOSED" }] },
  reviewPackage: {
    preview: { mode: "CONTROLLED", previewUrl: "/api/inspiration/previews/inspiration:0123456789abcdef01234567" },
    source: { curationSourceUrl: "https://example.org/curation", originalSourceDisplay: "示例原始来源", originalSourceUrl: "https://example.org/original", attributionStatus: "RECORDED" },
    extractedTags: ["网格", "信息层级"],
    courseAssociations: [{ coursePackId: "design-foundations", facets: ["信息层级"], rationale: "结构清楚", confidence: 0.88, status: "PROPOSED" }],
    duplicateRisk: { signal: "LOW", explanation: "没有近似重复候选" },
    designSignals: { visualStyle: ["Grid"], novelty: "MEDIUM", teachingValue: "HIGH", explanation: "适合讨论信息层级" },
    aiRecommendation: { recommendation: "REVIEW_FAVORABLY", rationale: "版式结构可用于教学讨论", limitations: "仅为辅助建议" },
    processingLog: { actualChannel: "LOCAL", transmittedToThirdParty: false },
  },
} as const;

describe("InspirationCandidateReviewQueue", () => {
  it("loads the private teacher queue and approves a candidate through the real API contract", async () => {
    const fetcher = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/teacher/inspiration-candidates?limit=30") return response({ items: [candidate] });
      if (String(url).endsWith(`/api/teacher/inspiration-candidates/${encodeURIComponent(candidate.id)}/decision`)) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({ candidateId: candidate.id, expectedRevision: 5, decision: "APPROVE", courseTags: ["网格", "信息层级"] });
        expect(JSON.parse(String(init?.body))).not.toHaveProperty("studentPublication");
        return response({ candidateId: candidate.id, decision: "APPROVE", revision: 7, state: "ACTIVE", publicationScope: "INTERNAL_CATALOG_ONLY", replayed: false }, 201);
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<InspirationCandidateReviewQueue fetcher={fetcher} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载候选审核队列");
    expect(await screen.findByText("节奏化版式参考")).toBeInTheDocument();
    expect(screen.getByText("候选预览")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "通过并留在内部目录" }));
    expect(await screen.findByRole("status")).toHaveTextContent("尚未正式发布");
    await waitFor(() => expect(screen.queryByText("节奏化版式参考")).not.toBeInTheDocument());
  });

  it("requires every explicit gate before sending a formal student-publication decision", async () => {
    const fetcher = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/teacher/inspiration-candidates?limit=30") return response({ items: [candidate] });
      if (String(url).includes("/decision")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          decision: "APPROVE",
          studentPublication: {
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
            publicSource: { label: "审核来源", url: "https://example.org/source" },
          },
        });
        return response({ candidateId: candidate.id, decision: "APPROVE", revision: 7, state: "ACTIVE", publicationScope: "AUTHENTICATED_STUDENT_ONLY", replayed: false }, 201);
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<InspirationCandidateReviewQueue fetcher={fetcher} />);
    expect(await screen.findByText("节奏化版式参考")).toBeInTheDocument();
    const publish = screen.getByRole("button", { name: "通过并正式发布给学生" });
    expect(publish).toBeDisabled();
    for (const label of [
      "学生展示决定明确为 ALLOW",
      "来源披露已人工审核并明确 ALLOW",
      "教学适用性已人工审核并明确 ALLOW",
      "安全与适龄已人工审核并明确 ALLOW",
      "质量与重复风险已人工审核并明确 ALLOW",
      "撤下通道已验证为 READY",
      "Browser 与 @灵感 Wiki Bridge 均明确启用",
    ]) fireEvent.click(screen.getByRole("checkbox", { name: label }));
    fireEvent.change(screen.getByLabelText("学生可见来源名称（未知可留空）"), { target: { value: "审核来源" } });
    fireEvent.change(screen.getByLabelText("审核后的公开 HTTPS 链接（无则留空）"), { target: { value: "https://example.org/source" } });
    expect(publish).toBeEnabled();
    fireEvent.click(publish);
    expect(await screen.findByRole("status")).toHaveTextContent("全部学生发布门已持久化记录");
  });

  it("shows empty and load error states without fabricating candidates", async () => {
    const empty = render(<InspirationCandidateReviewQueue fetcher={vi.fn(() => response({ items: [] }))} />);
    expect(await screen.findByText(/暂无待审核候选/)).toBeInTheDocument();
    empty.unmount();
    render(<InspirationCandidateReviewQueue fetcher={vi.fn(() => response({ error: "仅教师可以访问" }, 403))} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("仅教师可以访问");
  });

  it("recovers a failed candidate preview when the reviewed case receives a new preview URL", async () => {
    const firstFetcher = vi.fn(() => response({ items: [candidate] }));
    const view = render(<InspirationCandidateReviewQueue fetcher={firstFetcher} />);
    const preview = await screen.findByAltText("候选的受控 synthetic 预览");
    fireEvent.error(preview);
    expect(await screen.findByText("仅元数据候选，或安全预览暂不可用。")).toBeInTheDocument();

    const replacementUrl = "/api/inspiration/previews/inspiration:fedcba9876543210fedcba98";
    const refreshedCandidate = { ...candidate, reviewPackage: { ...candidate.reviewPackage, preview: { ...candidate.reviewPackage.preview, previewUrl: replacementUrl } } };
    const secondFetcher = vi.fn(() => response({ items: [refreshedCandidate] }));
    view.rerender(<InspirationCandidateReviewQueue fetcher={secondFetcher} />);
    expect((await screen.findByAltText("候选的受控 synthetic 预览")).getAttribute("src")).toContain(replacementUrl);
  });

  it("restores an optimistically removed candidate and prompts a refresh on revision conflict", async () => {
    const fetcher = vi.fn((url: RequestInfo | URL) => {
      if (String(url) === "/api/teacher/inspiration-candidates?limit=30") return response({ items: [candidate] });
      if (String(url).includes("/decision")) return response({ error: "候选已更新，请刷新后再决定" }, 409);
      throw new Error(`unexpected ${url}`);
    });
    render(<InspirationCandidateReviewQueue fetcher={fetcher} />);
    expect(await screen.findByText("节奏化版式参考")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("候选已更新，请刷新后再决定 请刷新队列后再提交。");
    expect(screen.getByText("节奏化版式参考")).toBeInTheDocument();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InspirationWiki } from "@/components/inspiration/InspirationWiki";
import { inspirationEntries, type InspirationEntries } from "@/components/inspiration/inspiration-wiki-data";

afterEach(() => cleanup());
const item = { id: "inspiration:0123456789abcdef01234567", title: "已审核书籍版式", description: "用于测试的安全元数据", tags: ["书籍设计", "版式"], courseAssociations: [{ coursePackId: "book-design", facets: ["书籍设计"] }], source: { label: "合规来源", url: "https://example.org/source" }, attributionNotice: "来源已按可展示范围披露。", preview: "METADATA_ONLY", previewUrl: null };
const response = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }));

describe("live InspirationWiki", () => {
  it("keeps the approved Wiki layout when the live student channel has no visible cases", async () => {
    const fetcher = vi.fn(() => response({ items: [], nextCursor: null, appliedFacets: [] }));
    render(<InspirationWiki embedded fetcher={fetcher} />);

    await screen.findByText("暂无可浏览的已审核案例");
    expect(screen.getByRole("tablist", { name: "案例分类" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "全部" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("searchbox", { name: "搜索灵感资料" })).toBeEnabled();
    expect(screen.getByText("0 个正式案例")).toBeInTheDocument();
    expect(screen.getByText("暂无可浏览的已审核案例")).toBeInTheDocument();
    expect(screen.getByText(/案例通过学生展示门禁后/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /看见参考/ })).not.toBeInTheDocument();
  });

  it("does not duplicate the Wiki topbar when the existing student shell owns navigation", async () => {
    const fetcher = vi.fn(() => response({ items: [], nextCursor: null, appliedFacets: [] }));
    render(<InspirationWiki embedded fetcher={fetcher} showEmbeddedTopbar={false} />);

    await screen.findByText("暂无可浏览的已审核案例");
    expect(screen.queryByRole("button", { name: "返回对话" })).not.toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "案例分类" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /看见参考/ })).not.toBeInTheDocument();
  });

  it("uses the browse API, shows metadata-only active cases, and does not substitute fixtures", async () => {
    const fetcher = vi.fn((_: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? response({
        items: [{ ...item, retrieval: { score: 0.88, channels: ["文字特征"] } }],
        appliedFacets: ["书籍设计"],
        retrieval: { mode: "TEXT_TO_IMAGE", state: "READY", indexId: "wiki-multimodal-177-v1", encoderVersion: "lumi-local-dual-feature-v1", resultCount: 1, notice: "已按作品文字、标签与来源特征检索受控图片。" },
      })
      : response({ items: [item], nextCursor: null, appliedFacets: ["书籍设计"] }));
    render(<InspirationWiki embedded fetcher={fetcher} />);
    expect((await screen.findAllByText("已审核书籍版式")).length).toBeGreaterThan(0);
    expect(screen.getByText("仅展示受控元数据")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索灵感资料" }), { target: { value: "书籍设计参考" } });
    expect(await screen.findByText(/已识别：书籍设计/)).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/inspiration/multimodal-search", expect.objectContaining({ method: "POST", body: expect.any(FormData) })));
    expect(await screen.findByText("已按作品文字、标签与来源特征检索受控图片。")).toBeInTheDocument();
  });

  it("supports an image query, exposes its state, and lets the student remove it", async () => {
    const fetcher = vi.fn((_: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? response({
        items: [{ ...item, retrieval: { score: 0.94, channels: ["图像特征"] } }],
        appliedFacets: [],
        retrieval: { mode: "IMAGE_TO_IMAGE", state: "READY", indexId: "wiki-multimodal-177-v1", encoderVersion: "lumi-local-dual-feature-v1", resultCount: 1, notice: "已按本地图像构图与色彩特征查找相似作品。" },
      })
      : response({ items: [item], nextCursor: null, appliedFacets: [] }));
    render(<InspirationWiki embedded fetcher={fetcher} />);
    await screen.findByText("已审核书籍版式");
    const image = new File([new Uint8Array([137, 80, 78, 71])], "参考图.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("选择检索图片"), { target: { files: [image] } });
    expect(await screen.findByText("参考图.png")).toBeInTheDocument();
    expect(await screen.findByText("已按本地图像构图与色彩特征查找相似作品。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除检索图片" }));
    await waitFor(() => expect(screen.queryByText("参考图.png")).not.toBeInTheDocument());
  });

  it("shows an API failure instead of fixture content", async () => {
    render(<InspirationWiki embedded fetcher={vi.fn(() => response({ error: "请先登录后浏览灵感 Wiki" }, 401))} />);
    expect(await screen.findByText("请先登录后浏览灵感 Wiki")).toBeInTheDocument();
    expect(screen.queryByText("留白与重心的非对称平衡")).not.toBeInTheDocument();
  });

  it("renders a same-origin controlled preview and falls back safely when its delivery fails", async () => {
    const controlled = { ...item, preview: "CONTROLLED" as const, previewUrl: "/api/inspiration/previews/inspiration:0123456789abcdef01234567" };
    render(<InspirationWiki embedded fetcher={vi.fn(() => response({ items: [controlled], nextCursor: null, appliedFacets: [] }))} />);
    const [preview] = await screen.findAllByAltText("已审核书籍版式 的受保护预览");
    expect(preview.getAttribute("src")).toContain(controlled.previewUrl);
    fireEvent.error(preview);
    expect(await screen.findByText("安全预览不可用")).toBeInTheDocument();
  });

  it("recovers a failed controlled preview when the same case receives a new preview URL", async () => {
    const protectedEntry = { ...inspirationEntries[0], id: "controlled-preview", protectedPreviewUrl: "/api/inspiration/previews/inspiration:first" };
    const firstEntries = [protectedEntry] as InspirationEntries;
    const view = render(<InspirationWiki embedded entries={firstEntries} />);
    for (const preview of await screen.findAllByAltText(`${protectedEntry.title} 的受保护预览`)) fireEvent.error(preview);
    expect((await screen.findAllByText("安全预览不可用")).length).toBeGreaterThan(0);

    const replacementUrl = "/api/inspiration/previews/inspiration:fedcba9876543210fedcba98";
    view.rerender(<InspirationWiki embedded entries={[{ ...protectedEntry, protectedPreviewUrl: replacementUrl }] as InspirationEntries} />);
    await waitFor(() => {
      for (const preview of screen.getAllByAltText(`${protectedEntry.title} 的受保护预览`)) expect(preview.getAttribute("src")).toContain(replacementUrl);
    });
  });

});

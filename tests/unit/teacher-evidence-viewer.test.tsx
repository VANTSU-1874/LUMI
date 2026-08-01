import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvidenceReviewViewer } from "@/components/teacher/EvidenceReviewViewer";

const common = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "输入观察",
  signalLayer: "INPUT",
  verificationStatus: "SUBMITTED",
  confirmedCode: null,
  evidenceSequence: 1,
  createdAt: new Date(0).toISOString(),
  dataType: "REAL",
};

function response(payload: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }));
}

describe("EvidenceReviewViewer", () => {
  afterEach(() => cleanup());

  it("renders loading, text content and readiness without exposing markup", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    const ready = vi.fn();
    render(<EvidenceReviewViewer evidenceId={common.id} fetcher={fetcher} onReadyChange={ready} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取证据内容");
    resolve(await response({ ...common, kind: "TEXT", text: "<b>声音数值</b>\n从 0.1 到 0.8" }));
    expect(await screen.findByText(/<b>声音数值<\/b>/)).toBeInTheDocument();
    expect(screen.queryByText("声音数值", { selector: "b" })).not.toBeInTheDocument();
    expect(ready).toHaveBeenLastCalledWith(true);
  });

  it("renders numeric values and localized probe fields", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) => String(input).endsWith("22222222-2222-4222-8222-222222222222")
      ? response({ ...common, id: "22222222-2222-4222-8222-222222222222", kind: "VALUE", value: 42.5 })
      : response({ ...common, id: "33333333-3333-4333-8333-333333333333", kind: "PROBE", probe: { type: "MAPPING_RANGE", inputMin: 0, inputMax: 1, outputMin: 0, outputMax: 360, relationship: "DIRECT" } }));
    const view = render(<EvidenceReviewViewer evidenceId="22222222-2222-4222-8222-222222222222" fetcher={fetcher} />);
    expect(await screen.findByText("42.5")).toBeInTheDocument();
    view.rerender(<EvidenceReviewViewer evidenceId="33333333-3333-4333-8333-333333333333" fetcher={fetcher} />);
    expect(await screen.findByText("输入范围")).toBeInTheDocument();
    expect(screen.getByText("0 → 1")).toBeInTheDocument();
    expect(screen.getByText("直接映射")).toBeInTheDocument();
  });

  it("renders a safe external video link", async () => {
    render(<EvidenceReviewViewer evidenceId={common.id} fetcher={() => response({ ...common, kind: "VIDEO_LINK", url: "https://example.com/evidence/video" })} />);
    const link = await screen.findByRole("link", { name: "打开视频证据" });
    expect(link).toHaveAttribute("href", "https://example.com/evidence/video");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows an authorized image URL and a recoverable preview error", async () => {
    const ready = vi.fn();
    render(<EvidenceReviewViewer evidenceId={common.id} fetcher={() => response({ ...common, kind: "IMAGE", previewUrl: `/api/evidence/${common.id}` })} onReadyChange={ready} />);
    const image = await screen.findByRole("img", { name: "证据图片：输入观察" });
    expect(image).toHaveAttribute("src", `/api/evidence/${common.id}`);
    expect(ready).toHaveBeenLastCalledWith(false);
    fireEvent.error(image);
    expect(ready).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("alert")).toHaveTextContent("图片预览失败");
    fireEvent.click(screen.getByRole("button", { name: "重新加载图片" }));
    const retry = await screen.findByRole("img", { name: "证据图片：输入观察" });
    fireEvent.load(retry);
    expect(ready).toHaveBeenLastCalledWith(true);
  });

  it("shows request errors, retries, and keeps decisions disabled until success", async () => {
    const ready = vi.fn();
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ error: "failed" }, 500))
      .mockImplementationOnce(() => response({ ...common, kind: "TEXT", text: "重试成功" }));
    render(<EvidenceReviewViewer evidenceId={common.id} fetcher={fetcher} onReadyChange={ready} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("证据内容暂时无法读取");
    expect(ready).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "重新加载证据" }));
    expect(await screen.findByText("重试成功")).toBeInTheDocument();
    expect(ready).toHaveBeenLastCalledWith(true);
  });

  it("ignores a stale response after switching evidence", async () => {
    let resolveFirst!: (value: Response) => void;
    const fetcher = vi.fn((input: RequestInfo | URL) => String(input).endsWith(common.id)
      ? new Promise<Response>((done) => { resolveFirst = done; })
      : response({ ...common, id: "22222222-2222-4222-8222-222222222222", kind: "TEXT", text: "新证据" }));
    const view = render(<EvidenceReviewViewer evidenceId={common.id} fetcher={fetcher} />);
    view.rerender(<EvidenceReviewViewer evidenceId="22222222-2222-4222-8222-222222222222" fetcher={fetcher} />);
    expect(await screen.findByText("新证据")).toBeInTheDocument();
    resolveFirst(await response({ ...common, kind: "TEXT", text: "过期证据" }));
    await waitFor(() => expect(screen.queryByText("过期证据")).not.toBeInTheDocument());
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PrivacyPage from "@/app/privacy/page";
import { GlobalErrorContent } from "@/app/global-error";
import { EvidenceDeletionList } from "@/components/common/EvidenceDeletionList";

afterEach(cleanup);

describe("privacy and resilient errors", () => {
  it("states the complete evidence lifecycle in plain Chinese", () => {
    const { container } = render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "隐私与学习证据说明" })).toBeInTheDocument();
    expect(screen.getAllByText(/Lumi 鹿鸣/).length).toBeGreaterThan(0);
    expect(screen.getByText(/通用设计导师/)).toBeInTheDocument();
    for (const text of ["收集目的", "收集内容", "保留期限", "教师访问", "AI服务提供方", "演示数据", "删除证据", "不收集人脸视频", "长期学习记忆", "匿名学习编号关联", "不以姓名作为身份字段", "配置的学号", "逐条删除长期记忆", "匿名学习数据", "私有学习证据", "预置演示数据"]) {
      expect(screen.getAllByText(new RegExp(text)).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/最多八个最近原文回合/)).toBeInTheDocument();
    expect(screen.getByText(/最多四条相关长期记忆/)).toBeInTheDocument();
    expect(screen.getByText(/当前项目简报与学习状态/)).toBeInTheDocument();
    expect(screen.getByText(/已核验证据片段/)).toBeInTheDocument();
    expect(screen.getByText(/模型视觉能力已启用.*发送该作品图/)).toBeInTheDocument();
    expect(screen.getByText(/不会每轮向向量服务批量重发长期记忆正文/)).toBeInTheDocument();
    expect(screen.getByText(/原始对话和当前任务滚动摘要.*不在这次逐条删除范围内/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "语音输入" })).toBeInTheDocument();
    expect(screen.getByText(/不接收或保存原始录音/)).toBeInTheDocument();
    expect(screen.getByText(/语音不会自动提交/)).toBeInTheDocument();
    expect(screen.getByText(/手动发送后.*数据保留与AI服务传输规则/)).toBeInTheDocument();
    expect(screen.getByText(/浏览器.*语音识别服务/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回入口" })).toHaveAttribute("href", "/");
    expect(container).not.toHaveTextContent(/触映|六元|迁移挑战|数字交互/);
  });

  it("shows a safe recoverable global error without rendering the exception", () => {
    const reset = vi.fn();
    render(<GlobalErrorContent reset={reset} />);
    expect(screen.getByRole("heading", { name: "页面暂时遇到问题" })).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("语义结果保持待处理");
    expect(screen.getByRole("alert")).toHaveTextContent("已成功提交的数据仍保存在服务器");
    expect(screen.getByRole("alert")).not.toHaveTextContent("你的逻辑卡和学习证据仍保存在服务器");
    expect(screen.queryByText(/secret stack|private\/path/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("lets an authorized user delete evidence with confirmation and retryable feedback", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const onDeleted = vi.fn();
    render(<EvidenceDeletionList items={[{ id: "11111111-1111-4111-8111-111111111111", label: "INPUT · IMAGE" }]} fetcher={fetcher} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole("button", { name: "删除证据 INPUT · IMAGE" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除 INPUT · IMAGE" }));
    expect(await screen.findByRole("status")).toHaveTextContent("证据已删除");
    expect(fetcher).toHaveBeenCalledWith("/api/evidence/11111111-1111-4111-8111-111111111111", expect.objectContaining({ method: "DELETE" }));
    expect(onDeleted).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    await waitFor(() => expect(screen.getByRole("status", { name: "删除状态" })).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it("waits for parent synchronization before announcing and focusing deletion completion", async () => {
    let finishSynchronization!: () => void;
    const synchronization = new Promise<void>((resolve) => { finishSynchronization = resolve; });
    const onDeleted = vi.fn(() => synchronization);
    render(<EvidenceDeletionList items={[{ id: "11111111-1111-4111-8111-111111111111", label: "INPUT · IMAGE" }]} fetcher={async () => new Response(null, { status: 204 })} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole("button", { name: "删除证据 INPUT · IMAGE" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除 INPUT · IMAGE" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status", { name: "删除状态" })).toBeNull();
    finishSynchronization();
    const status = await screen.findByRole("status", { name: "删除状态" });
    await waitFor(() => expect(status).toHaveFocus());
  });

  it("restores the opener when deletion is cancelled", async () => {
    render(<EvidenceDeletionList items={[{ id: "11111111-1111-4111-8111-111111111111", label: "INPUT · IMAGE" }]} />);
    const opener = screen.getByRole("button", { name: "删除证据 INPUT · IMAGE" });
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

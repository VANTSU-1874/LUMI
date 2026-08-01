import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ParticleNodeStudio } from "@/components/student/ParticleNodeStudio";

describe("ParticleNodeStudio", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("returns from the enhanced particle lesson to the complete case workspace", () => {
    const onBackToCases = vi.fn();
    render(<ParticleNodeStudio onBackToCases={onBackToCases} />);
    fireEvent.click(screen.getByRole("button", { name: "← 全部案例" }));
    expect(onBackToCases).toHaveBeenCalledOnce();
  });

  it("shows the final effect before the teachable node network", () => {
    render(<ParticleNodeStudio />);
    expect(screen.getByRole("heading", { name: "点右侧节点，左侧显示它的输出" })).toBeInTheDocument();
    expect(screen.getByLabelText("图片粒子化 Instancing 实时效果")).toBeInTheDocument();
    expect(screen.getByText("当前节点输出：noise1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /moviefilein图片素材/ }));
    expect(screen.getByText("当前节点输出：moviefilein")).toBeInTheDocument();
    expect(screen.getByText("图像进入 TOP")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /grid1实例位置矩阵/ }));
    expect(screen.getByText("位置矩阵 tx / ty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "成片对照" }));
    expect(screen.getByLabelText("课程工程真实 Render 输出")).toBeInTheDocument();
    expect(screen.getByLabelText("图片粒子化课程工程真实动态效果")).toHaveAttribute("poster", "/media/touchdesigner-particle-output-poster.jpg");
    expect(screen.getByLabelText("TouchDesigner 图片粒子化真实节点网络")).toHaveTextContent("noise1");
  });

  it("lets a learner disconnect and reconnect a real teaching link", () => {
    render(<ParticleNodeStudio />);
    const link = screen.getByRole("button", { name: "断开：tz 进入 Merge" });
    fireEvent.click(link);
    expect(screen.getByText("1 条功能支路断开")).toBeInTheDocument();
    expect(screen.getByLabelText("图片粒子化 Instancing 实时效果")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "连接：tz 进入 Merge" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "恢复完整工程" }));
    expect(screen.getByText("三路实例数据已合并")).toBeInTheDocument();
  });

  it("lets res1 adjust horizontal and vertical resolution independently", () => {
    render(<ParticleNodeStudio />);
    fireEvent.click(screen.getByRole("button", { name: /res1统一分辨率/ }));
    const columns = screen.getByLabelText("Resolution columns");
    const rows = screen.getByLabelText("Resolution rows");
    fireEvent.change(columns, { target: { value: "36" } });
    fireEvent.change(rows, { target: { value: "22" } });
    expect(columns).toHaveValue("36");
    expect(rows).toHaveValue("22");
  });

  it("updates grid counts and exposes truthful controls for processing and pass-through nodes", () => {
    render(<ParticleNodeStudio />);
    fireEvent.click(screen.getByRole("button", { name: /grid1实例位置矩阵/ }));
    fireEvent.change(screen.getByLabelText("Grid columns"), { target: { value: "36" } });
    fireEvent.change(screen.getByLabelText("Grid rows"), { target: { value: "20" } });
    expect(screen.getByText(/720 点/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /switch1切换素材/ }));
    fireEvent.click(screen.getByRole("button", { name: "灰度" }));
    expect(screen.getByRole("button", { name: "灰度" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /null6位置出口/ }));
    expect(screen.getByText("结构节点保持数据稳定，因此不伪造视觉参数。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /merge1tx\/ty \+ RGB \+ tz/ }));
    fireEvent.click(screen.getByRole("button", { name: /已接入RGB/ }));
    expect(screen.getByRole("button", { name: /已断开RGB/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("pans the teaching canvas with a held right button and preserves the menu on a simple click", () => {
    render(<ParticleNodeStudio />);
    const canvas = screen.getByLabelText("TouchDesigner 图片粒子化真实节点网络");
    const zoom = screen.getByLabelText("教学画布缩放比例");
    expect(zoom).toHaveTextContent("100%");
    fireEvent.wheel(canvas, { clientX: 240, clientY: 180, deltaY: -100 });
    expect(zoom).toHaveTextContent("112%");

    canvas.scrollLeft = 180;
    canvas.scrollTop = 50;
    fireEvent.pointerDown(canvas, { button: 2, clientX: 280, clientY: 220, pointerId: 11 });
    fireEvent.pointerUp(canvas, { clientX: 280, clientY: 220, pointerId: 11 });
    expect(fireEvent.contextMenu(canvas)).toBe(true);

    fireEvent.pointerDown(canvas, { button: 2, clientX: 280, clientY: 220, pointerId: 12 });
    fireEvent.pointerMove(canvas, { clientX: 210, clientY: 170, pointerId: 12 });
    fireEvent.pointerUp(canvas, { clientX: 210, clientY: 170, pointerId: 12 });
    expect(fireEvent.contextMenu(canvas)).toBe(false);
    expect(canvas.scrollLeft).toBe(250);
    expect(canvas.scrollTop).toBe(100);

    fireEvent.click(screen.getByRole("button", { name: "复位教学节点画布" }));
    expect(zoom).toHaveTextContent("100%");
    expect(canvas.scrollLeft).toBe(0);
    expect(canvas.scrollTop).toBe(0);
  });
});

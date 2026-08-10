import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GenerativeLab } from "@/components/student/GenerativeLab";

afterEach(cleanup);

const request = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "ARC_RING",
  brief: "生成带层数与切割角度控制的弧形圆环",
  status: "REQUESTED",
  createdAt: "2026-07-27T01:00:00.000Z",
  dataType: "REAL",
} as const;

const artifact = {
  id: "22222222-2222-4222-8222-222222222222",
  requestId: request.id,
  kind: request.kind,
  brief: request.brief,
  html: "<!doctype html><html><head></head><body><script>function draw(){};draw()</script></body></html>",
  validation: { safe: true, violations: [] },
  createdAt: "2026-07-27T01:01:00.000Z",
  dataType: "REAL",
} as const;

describe("GenerativeLab", () => {
  it("restores a confirmed request, builds it, and renders only an allow-scripts sandbox", async () => {
    const calls: Array<{ method: string; body?: unknown }> = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "GET") {
        return new Response(JSON.stringify({ status: "REQUESTED", request, artifact: null }), { status: 200 });
      }
      if (method === "POST") return new Response(JSON.stringify(artifact), { status: 201 });
      throw new Error(`unexpected method ${method}`);
    });

    render(<GenerativeLab fetchImpl={fetchImpl as unknown as typeof fetch} />);
    expect(await screen.findByText(/已恢复导师记录的生成请求/)).toBeInTheDocument();
    expect(screen.getByLabelText("Generator / 生成器类型")).toHaveValue("ARC_RING");
    expect(screen.getByLabelText("Brief / 创作要求")).toHaveValue(request.brief);

    fireEvent.click(screen.getByRole("button", { name: "构建并安全校验" }));
    const iframe = await screen.findByTitle("弧形圆环生成器沙箱预览");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    await waitFor(() => expect(calls.some(({ method }) => method === "POST")).toBe(true));
    expect(calls.find(({ method }) => method === "POST")?.body).toEqual({
      kind: "ARC_RING",
      brief: request.brief,
      requestId: request.id,
    });
  });
});

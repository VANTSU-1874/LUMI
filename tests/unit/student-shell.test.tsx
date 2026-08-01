import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudentShell } from "@/components/student/StudentShell";

afterEach(cleanup);

const snapshot = {
  snapshotVersion: "a".repeat(64),
  updatedAt: "2026-07-12T08:00:00.000Z",
  student: { alias: "匿名编号 01" },
  profile: { level: "L2", decomposition: 2, signalUnderstanding: 2, mappingDesign: 2, troubleshooting: 2, transfer: 2, updatedAt: "2026-07-12T08:00:00.000Z" },
  course: { totalHours: 64, modules: [{ id: "m1", sequence: 1, title: "感知", hours: 8, focus: "观察" }] },
  assignment: { id: "a1", moduleId: "m1", title: "社区灯影", brief: "完成互动原型", allowedTools: ["DIGISHOW"] },
  project: { id: "p1", stage: "LOGIC_CARD", updatedAt: "2026-07-12T08:00:00.000Z" },
  logicCard: null,
  toolPath: null,
  evidence: { total: 0, verified: 0, recent: [] },
  troubleshooting: null,
  hints: { count: 0, latestLevel: null, latestAt: null },
  latestHint: null,
  transfer: null,
};

const hint = {
  hintLevel: 2,
  groundingStatus: "GROUNDED",
  confirmedFacts: ["课程设计：先观察输入值"],
  hypotheses: ["输入可能没有变化"],
  questions: ["靠近时数值是否变化？"],
  guidance: ["只检查输入层"],
  nextSteps: ["记录靠近和远离两次数值"],
  localExample: null,
  sourceTitles: ["课程信号链检查表"],
  sources: [{ title: "课程信号链检查表", authority: "COURSE_DESIGN" }],
  uncertainty: "需要学生提交新测量确认。",
  fallback: false,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function openProjectWorkspace() {
  fireEvent.click(await screen.findByRole("button", { name: /学习证据/ }));
}

describe("StudentShell", () => {
  it.each(["BUILD", "TROUBLESHOOT", "TRANSFER", "COMPLETE"] as const)("keeps the persisted tool-path details visible in %s without another dashboard request", async (stage) => {
    const build = {
      ...snapshot,
      project: { ...snapshot.project, stage },
      toolPath: {
        path: "COLLABORATIVE",
        requirements: { needsRealtimeVisuals: true, needsPhysicalControl: true, hasOsc: false },
        reasons: ["项目同时需要物理控制与实时视觉。", "开始联调前需先配置 OSC 通信。"],
        milestones: [
          { id: "m1", title: "配置 OSC 通信参数", requiredEvidenceLabel: "OSC 地址、端口与测试数值截图" },
          { id: "m2", title: "完成 DigiShow 物理控制", requiredEvidenceLabel: "物理输入信号截图" },
          { id: "m3", title: "联调 TouchDesigner 实时画面", requiredEvidenceLabel: "双工具联调演示视频" },
        ],
        updatedAt: "2026-07-12T08:00:00.000Z",
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => build });

    render(<StudentShell fetchImpl={fetchImpl as typeof fetch} />);
    await openProjectWorkspace();

    expect(await screen.findByRole("heading", { name: "DigiShow + TouchDesigner 协同路径" })).toBeInTheDocument();
    for (const reason of build.toolPath.reasons) expect(screen.getByText(reason)).toBeInTheDocument();
    for (const milestone of build.toolPath.milestones) {
      expect(screen.getByText(milestone.title)).toBeInTheDocument();
      expect(screen.getByText(`证据/完成条件：${milestone.requiredEvidenceLabel}`)).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "生成工具路径" })).not.toBeInTheDocument();
    expect(fetchImpl.mock.calls.filter(([target]) => String(target) === "/api/student/dashboard")).toHaveLength(1);
  });

  it("loads the initial workbench and independent evidence history", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot });
    render(<StudentShell fetchImpl={fetchImpl as typeof fetch} />);
    await openProjectWorkspace();
    await screen.findByText("先把互动关系想明白");
    expect(screen.queryByText("已生成计划 · 只读")).not.toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledWith("/api/student/dashboard", expect.objectContaining({ method: "GET" }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith("/api/evidence?limit=20", expect.objectContaining({ method: "GET", cache: "no-store" })));
  });

  it("refreshes dashboard counts, recent evidence and troubleshooting choices after history deletion", async () => {
    const evidenceId = "11111111-1111-4111-8111-111111111111";
    const build = {
      ...snapshot,
      snapshotVersion: "e".repeat(64),
      project: { ...snapshot.project, stage: "BUILD" },
      evidence: { total: 1, verified: 0, recent: [{ id: evidenceId, kind: "IMAGE", layer: "INPUT", verification: "SUBMITTED", dataType: "REAL", timestamp: "2026-07-12T08:00:00.000Z" }] },
    };
    const refreshed = { ...build, snapshotVersion: "f".repeat(64), evidence: { total: 0, verified: 0, recent: [] } };
    let deleted = false;
    let dashboardCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/student/dashboard") {
        dashboardCalls += 1;
        return { ok: true, json: async () => deleted ? refreshed : build };
      }
      if (url === "/api/evidence?limit=20") {
        return new Response(JSON.stringify({ items: deleted ? [] : [{
          id: evidenceId, projectId: "p1", classId: "c1", studentId: "s1", ownerAlias: "匿名编号 01",
          kind: "IMAGE", signalLayer: "INPUT", label: "输入截图", verificationStatus: "SUBMITTED",
          createdAt: "2026-07-12T08:00:00.000Z", dataType: "REAL",
        }], nextCursor: null }), { status: 200 });
      }
      if (url === `/api/evidence/${evidenceId}` && init?.method === "DELETE") {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${url}`);
    });

    render(<StudentShell fetchImpl={fetchImpl as typeof fetch} />);
    await openProjectWorkspace();
    expect(await screen.findByText("证据 1 条 · 已验证 0 条")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "INPUT · IMAGE" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /删除证据.*输入截图/ }));
    fireEvent.click(screen.getByRole("button", { name: /确认删除.*输入截图/ }));
    expect(await screen.findByText("证据 0 条 · 已验证 0 条")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "INPUT · IMAGE" })).not.toBeInTheDocument();
    expect(dashboardCalls).toBe(2);
  });

  it("accepts a different snapshot version even when the server timestamp moves backward", async () => {
    const build = { ...snapshot, project: { ...snapshot.project, stage: "BUILD" } };
    const olderClock = { ...build, snapshotVersion: "d".repeat(64), updatedAt: "2026-07-11T08:00:00.000Z", assignment: { ...build.assignment!, title: "回拨后的新版本" } };
    let dashboardCalls = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL): Promise<Response> => {
      if (String(url) === "/api/student/dashboard") { dashboardCalls += 1; return jsonResponse(dashboardCalls === 1 ? build : olderClock); }
      return jsonResponse({ id: "11111111-1111-4111-8111-111111111111", kind: "VALUE", signalLayer: "INPUT", label: "输入值", verificationStatus: "SUBMITTED", createdAt: "2026-07-12T09:00:00.000Z" });
    });
    render(<StudentShell fetchImpl={fetchImpl as typeof fetch} />);
    await openProjectWorkspace();
    await screen.findByLabelText("标签");
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "输入值" } });
    fireEvent.change(screen.getByLabelText("数值"), { target: { value: "1" } });
    screen.getByRole("button", { name: "保存证据" }).click();
    await screen.findByText("回拨后的新版本");
  });

  it("discards an older refresh when two real mutations complete out of order", async () => {
    const build = { ...snapshot, project: { ...snapshot.project, stage: "BUILD" } };
    const newer = { ...build, snapshotVersion: "b".repeat(64), updatedAt: "2026-07-12T09:00:00.000Z", assignment: { ...build.assignment!, title: "最新项目快照" } };
    let resolveOld!: (value: Response) => void;
    const old = new Promise<Response>((resolve) => { resolveOld = resolve; });
    let dashboardCalls = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL): Promise<Response> => {
      const target = String(url);
      if (target === "/api/student/dashboard") { dashboardCalls += 1; if (dashboardCalls === 1) return jsonResponse(build); if (dashboardCalls === 2) return old; return jsonResponse(newer); }
      if (target.includes("/hints")) return jsonResponse(hint);
      return jsonResponse({ id: "11111111-1111-4111-8111-111111111111", kind: "VALUE", signalLayer: "INPUT", label: "输入值", verificationStatus: "SUBMITTED", createdAt: "2026-07-12T09:00:00.000Z" });
    });
    render(<StudentShell fetchImpl={fetchImpl as typeof fetch} />);
    await openProjectWorkspace();
    await screen.findByText("分层学习提示");
    screen.getByRole("button", { name: "获取当前层提示" }).click();
    await waitFor(() => expect(dashboardCalls).toBe(2));
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "输入值" } }); fireEvent.change(screen.getByLabelText("数值"), { target: { value: "1" } });
    screen.getByRole("button", { name: "保存证据" }).click();
    await screen.findByText("最新项目快照");
    resolveOld(jsonResponse(build));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("最新项目快照")).toBeInTheDocument();
  });

  it("keeps an evidence draft mounted across an ordinary snapshot refresh", async () => {
    const build = { ...snapshot, project: { ...snapshot.project, stage: "BUILD" } };
    const newer = { ...build, snapshotVersion: "b".repeat(64), updatedAt: "2026-07-12T08:01:00.000Z", assignment: { ...build.assignment!, title: "社区灯影新版" } };
    let dashboardCalls = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL): Promise<Response> => {
      if (String(url) === "/api/student/dashboard") { dashboardCalls += 1; return jsonResponse(dashboardCalls === 1 ? build : newer); }
      return jsonResponse({ id: "11111111-1111-4111-8111-111111111111", kind: "VALUE", signalLayer: "INPUT", label: "输入草稿", verificationStatus: "SUBMITTED", createdAt: "2026-07-12T08:01:00.000Z" });
    });
    render(<StudentShell fetchImpl={fetchImpl as typeof fetch} />);
    await openProjectWorkspace();
    const label = await screen.findByLabelText("标签");
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(label, { target: { value: "输入草稿" } });
    fireEvent.change(screen.getByLabelText("数值"), { target: { value: "1" } });
    screen.getByRole("button", { name: "保存证据" }).click();
    await screen.findByText("社区灯影新版");
    expect(screen.getByLabelText("标签")).toHaveValue("输入草稿");
  });

  it("passes the persisted solo tool path into the transport evidence form", async () => {
    const build = {
      ...snapshot,
      project: { ...snapshot.project, stage: "BUILD" },
      toolPath: {
        path: "TOUCHDESIGNER",
        requirements: { needsRealtimeVisuals: true, needsPhysicalControl: false, hasOsc: false },
        reasons: ["实时视觉由TouchDesigner独立完成。"],
        milestones: [
          { id: "m1", title: "输入", requiredEvidenceLabel: "输入" },
          { id: "m2", title: "映射", requiredEvidenceLabel: "映射" },
          { id: "m3", title: "输出", requiredEvidenceLabel: "输出" },
        ],
        updatedAt: "2026-07-12T08:00:00.000Z",
      },
    };
    const fetchImpl = vi.fn(async (): Promise<Response> => jsonResponse(build));
    render(<StudentShell fetchImpl={fetchImpl as typeof fetch} />);
    await openProjectWorkspace();
    fireEvent.change(await screen.findByLabelText("证据类型"), { target: { value: "PROBE" } });
    fireEvent.change(screen.getByLabelText("信号层"), { target: { value: "TRANSPORT" } });
    expect(screen.getByRole("group", { name: "本地通道传递验证" })).toBeInTheDocument();
    expect(screen.getByText("当前路径：TouchDesigner单工具路径")).toBeInTheDocument();
  });

  it("refreshes after a hint mutation and keeps the persisted latest hint visible", async () => {
    const build = { ...snapshot, project: { ...snapshot.project, stage: "BUILD" } };
    const refreshed = {
      ...build,
      snapshotVersion: "c".repeat(64),
      updatedAt: "2026-07-12T08:02:00.000Z",
      hints: { count: 1, latestLevel: 2, latestAt: "2026-07-12T08:02:00.000Z" },
      latestHint: hint,
    };
    const fetchImpl = vi.fn(async (url: RequestInfo | URL): Promise<Response> => {
      if (String(url).includes("/hints")) return jsonResponse(hint);
      const dashboardCalls = fetchImpl.mock.calls.filter(([target]) => String(target) === "/api/student/dashboard").length;
      return jsonResponse(dashboardCalls === 1 ? build : refreshed);
    });
    render(<StudentShell fetchImpl={fetchImpl as typeof fetch} />);
    await openProjectWorkspace();
    await screen.findByText("分层学习提示");
    act(() => screen.getByRole("button", { name: "获取当前层提示" }).click());
    await screen.findByText("记录靠近和远离两次数值");
    await waitFor(() => expect(fetchImpl.mock.calls.filter(([target]) => String(target) === "/api/student/dashboard")).toHaveLength(2));
    expect(screen.getByText("记录靠近和远离两次数值")).toBeInTheDocument();
  });
});

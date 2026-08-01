import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoBadge } from "@/components/common/DemoBadge";
import { FallbackModeBadge } from "@/components/common/FallbackModeBadge";
import { StudentShell } from "@/components/student/StudentShell";
import { TeacherWorkspace } from "@/components/teacher/TeacherWorkspace";

afterEach(cleanup);

const stages = ["DIAGNOSTIC", "LOGIC_CARD", "TOOL_PATH", "BUILD", "TROUBLESHOOT", "TRANSFER", "COMPLETE"] as const;
const studentSnapshot = {
  snapshotVersion: "f".repeat(64), updatedAt: "2026-07-13T00:00:00.000Z",
  aiMode: "DETERMINISTIC_FALLBACK", dataType: "DEMONSTRATION_DATA",
  student: { alias: "演示学习者A", dataType: "DEMONSTRATION_DATA" }, profile: null,
  course: { totalHours: 64, modules: [] }, assignment: null,
  project: { id: "demo-project-a", stage: "COMPLETE", updatedAt: "2026-07-13T00:00:00.000Z" },
  logicCard: null, toolPath: null, evidence: { total: 0, verified: 0, recent: [] }, troubleshooting: null,
  hints: { count: 0, latestLevel: null, latestAt: null }, latestHint: null, transfer: null,
};

const demoAnalytics = {
  class: { id: "demo-class-digi2026", name: "演示班", dataType: "REAL" }, aiMode: "DETERMINISTIC_FALLBACK",
  dataCounts: { real: 1, demonstration: 4, included: 5 }, updatedAt: new Date(0).toISOString(),
  stages: stages.map((stage) => ({ stage, count: 0 })), supportNeeded: 0,
  profiles: { levels: [{ key: "L2", count: 1 }], dimensions: [] }, logicIssues: [], troubleshooting: { byLayer: [], escalated: 0 },
  hints: { students: 0, total: 0, latestL3: 0, maxL3: 0 }, transfer: { active: 0, passed: 0, locked: 0 },
  evidence: { byVerification: [], byAuthority: [] },
  metricsByDataType: {
    REAL: { stages: stages.map((stage) => ({ stage, count: 0 })), supportNeeded: 0, profiles: { levels: [{ key: "L2", count: 1 }], dimensions: [] }, logicIssues: [], troubleshooting: { byLayer: [], escalated: 0 }, hints: { students: 0, total: 0, latestL3: 0, maxL3: 0 }, transfer: { active: 0, passed: 0, locked: 0 }, evidence: { byVerification: [], byAuthority: [] } },
    DEMONSTRATION_DATA: { stages: stages.map((stage) => ({ stage, count: stage === "COMPLETE" ? 3 : 0 })), supportNeeded: 1, profiles: { levels: [{ key: "L1", count: 1 }, { key: "L2", count: 1 }, { key: "L3", count: 1 }, { key: "L4", count: 1 }], dimensions: [] }, logicIssues: [], troubleshooting: { byLayer: [], escalated: 0 }, hints: { students: 0, total: 0, latestL3: 0, maxL3: 0 }, transfer: { active: 0, passed: 3, locked: 0 }, evidence: { byVerification: [{ key: "RULE_VERIFIED", count: 15 }], byAuthority: [{ key: "RULE", count: 15 }] } },
  },
  students: [{ id: "demo-student-a", alias: "演示学习者A", dataType: "DEMONSTRATION_DATA", stage: "COMPLETE", needsSupport: false, updatedAt: new Date(0).toISOString() }],
  studentsMeta: { total: 4, returned: 4, truncated: false, aggregateScope: "ALL_CLASS_STUDENTS" },
};

function response(payload: unknown) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
}

describe("demonstration and fallback labels", () => {
  it("uses explicit, accessible truth labels", () => {
    render(<><DemoBadge /><FallbackModeBadge /></>);
    expect(screen.getByText("演示数据")).toHaveAccessibleName("演示数据，不代表真实学生成效");
    expect(screen.getByText("确定性降级模式")).toBeInTheDocument();
    expect(screen.getByText("规则与课程资料继续工作，AI语义增强暂不可用")).toBeInTheDocument();
  });

  it("shows both labels on a demo student dashboard", async () => {
    render(<StudentShell fetchImpl={vi.fn().mockResolvedValue({ ok: true, json: async () => studentSnapshot }) as typeof fetch} />);
    expect(await screen.findByText("演示数据")).toBeInTheDocument();
    expect(screen.getByText("确定性降级模式")).toBeInTheDocument();
  });

  it("does not request demo rows until the teacher explicitly enables them", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/teacher/dashboard") return response({ aiMode: "DETERMINISTIC_FALLBACK", classes: [{ id: "demo-class-digi2026", name: "演示班", students: 1, dataType: "REAL" }], classesMeta: { total: 1, returned: 1, truncated: false } });
      if (url === "/api/teacher/dashboard?includeDemo=true") return response({ aiMode: "DETERMINISTIC_FALLBACK", classes: [{ id: "demo-class-digi2026", name: "演示班", students: 4, realStudents: 1, demoStudents: 3, dataType: "REAL" }], classesMeta: { total: 1, returned: 1, truncated: false } });
      if (url === "/api/teacher/dashboard?classId=demo-class-digi2026") return response({ ...demoAnalytics, dataCounts: { real: 1, demonstration: 3, included: 1 }, students: [] });
      if (url === "/api/teacher/dashboard?classId=demo-class-digi2026&includeDemo=true") return response(demoAnalytics);
      throw new Error(`unexpected ${url}`);
    });
    render(<TeacherWorkspace fetcher={fetcher} />);
    const toggle = await screen.findByRole("checkbox", { name: "显示演示数据" });
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/teacher/dashboard?classId=demo-class-digi2026", expect.anything()));
    fireEvent.click(toggle);
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/teacher/dashboard?classId=demo-class-digi2026&includeDemo=true", expect.anything()));
    expect(await screen.findByText("真实教学指标")).toBeInTheDocument();
    expect(screen.getByText("演示指标")).toBeInTheDocument();
    expect(await screen.findByText("演示学习者A")).toBeInTheDocument();
    expect(screen.getAllByText("演示数据").length).toBeGreaterThan(0);
    expect(screen.getByText("真实 1 人 · 演示 4 人")).toBeInTheDocument();
  });
});

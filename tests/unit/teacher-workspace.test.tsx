import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeacherWorkspace } from "@/components/teacher/TeacherWorkspace";

const stages = ["DIAGNOSTIC", "LOGIC_CARD", "TOOL_PATH", "BUILD", "TROUBLESHOOT", "TRANSFER", "COMPLETE"] as const;
const metrics = { stages: stages.map((stage) => ({ stage, count: stage === "LOGIC_CARD" ? 1 : 0 })), supportNeeded: 0, profiles: { levels: [], dimensions: [] }, logicIssues: [], troubleshooting: { byLayer: [], escalated: 0 }, hints: { students: 0, total: 0, latestL3: 0, maxL3: 0 }, transfer: { active: 0, passed: 0, locked: 0 }, evidence: { byVerification: [], byAuthority: [] } };
const emptyMetrics = { ...metrics, stages: stages.map((stage) => ({ stage, count: 0 })) };
const analytics = { class: { id: "c1", name: "一班", dataType: "REAL" }, dataCounts: { real: 1, demonstration: 0, included: 1 }, updatedAt: new Date(0).toISOString(), ...metrics, metricsByDataType: { REAL: metrics, DEMONSTRATION_DATA: emptyMetrics }, students: [{ id: "s1", alias: "匿名-A", stage: "LOGIC_CARD", needsSupport: false, updatedAt: new Date(0).toISOString() }], studentsMeta: { total: 1, returned: 1, truncated: false, aggregateScope: "ALL_CLASS_STUDENTS" } };
const detail = { student: { id: "s1", alias: "匿名-A", dataType: "REAL" }, profile: null, project: { id: "p1", stage: "LOGIC_CARD", updatedAt: new Date(0).toISOString() }, logic: { status: "PENDING", source: "RULE", issues: [], revision: 1, ruleReady: false, semanticReady: false }, path: null, evidence: { total: 0, byVerification: [], byAuthority: [] }, troubleshooting: null, hints: { latestLevel: null, maxLevel: null, count: 0 }, transfer: null, reviewTargets: [{ targetId: "p1", snapshot: { targetType: "LOGIC_REVIEW", revision: 1, status: "PENDING", ruleReady: false, semanticReady: false, source: "RULE", issues: [] } }], decisions: [], latestDecisionByTarget: {} };

function response(payload: unknown, status = 200) { return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } })); }

describe("TeacherWorkspace", () => {
  afterEach(() => cleanup());
  it("loads class and learner data, then blocks same-tick duplicate decisions", async () => {
    let resolveDecision!: (value: Response) => void;
    const decision = new Promise<Response>((resolve) => { resolveDecision = resolve; });
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teacher/dashboard") return response({ classes: [{ id: "c1", name: "一班", students: 1, dataType: "REAL" }], classesMeta: { total: 1, returned: 1, truncated: false } });
      if (url.includes("dashboard?classId=c1")) return response(analytics);
      if (url.includes("learners/s1")) return response(detail);
      if (url === "/api/teacher/decisions" && init?.method === "POST") return decision;
      throw new Error(`unexpected ${url}`);
    });
    render(<TeacherWorkspace fetcher={fetcher} />);
    expect(screen.getByText("Lumi 鹿鸣 · 教师工作台")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "教师学习分析工作台" })).toHaveTextContent("课堂学习工作台");
    expect(document.body).not.toHaveTextContent(/触映|TEACHER STUDIO/);
    expect(await screen.findByText("一班")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "导出真实试用报告" })).toHaveAttribute("href", "/api/teacher/pilot-report?classId=c1");
    expect(screen.getByText("仅汇总真实数据；现场观察项仍需教师补填")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /查看匿名-A/ }));
    expect(await screen.findByText("原系统结果：PENDING")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "保存教师决定" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => String(url) === "/api/teacher/decisions")).toHaveLength(1));
    resolveDecision(new Response(JSON.stringify({ id: "d1", targetType: "LOGIC_REVIEW", targetId: "p1", originalRevision: 1, decision: "CONFIRMED", reasonCode: "TEACHER_CHECK", notes: "", sequence: 1, timelineSequence: 1, createdAt: new Date(0).toISOString(), originalSnapshot: detail.reviewTargets[0].snapshot }), { status: 201, headers: { "content-type": "application/json" } }));
    expect(await screen.findByText("教师决定：CONFIRMED")).toBeInTheDocument();
  });

  it("refreshes evidence status, learner detail and analytics after a teacher evidence decision", async () => {
    const evidenceId = "11111111-1111-4111-8111-111111111111";
    const evidenceTarget = { targetId: evidenceId, snapshot: { targetType: "EVIDENCE" as const, id: evidenceId, kind: "TEXT" as const, layer: "INPUT" as const, verification: "SUBMITTED" as const, code: null, revision: 1, sequence: 1 } };
    const initialDetail = { ...detail, evidence: { total: 1, byVerification: [{ key: "SUBMITTED", count: 1 }], byAuthority: [{ key: "STUDENT", count: 1 }] }, reviewTargets: [...detail.reviewTargets, evidenceTarget] };
    const savedDecision = { id: "d-evidence", targetType: "EVIDENCE" as const, targetId: evidenceId, originalRevision: 1, decision: "CONFIRMED" as const, reasonCode: "EVIDENCE_CONFIRMED", notes: "", sequence: 1, timelineSequence: 1, createdAt: new Date(0).toISOString(), originalSnapshot: evidenceTarget.snapshot };
    const refreshedTarget = { ...evidenceTarget, snapshot: { ...evidenceTarget.snapshot, verification: "TEACHER_VERIFIED" as const, code: "INPUT_OK" as const, revision: 2 } };
    const refreshedDetail = { ...initialDetail, evidence: { total: 1, byVerification: [{ key: "TEACHER_VERIFIED", count: 1 }], byAuthority: [{ key: "STUDENT", count: 1 }] }, reviewTargets: [...detail.reviewTargets, refreshedTarget], decisions: [savedDecision], latestDecisionByTarget: { [`EVIDENCE:${evidenceId}`]: savedDecision } };
    let decided = false;
    let analyticsCalls = 0;
    let detailCalls = 0;
    let resolveAnalyticsRefresh!: (value: Response) => void;
    let resolveDetailRefresh!: (value: Response) => void;
    const analyticsRefresh = new Promise<Response>((resolve) => { resolveAnalyticsRefresh = resolve; });
    const detailRefresh = new Promise<Response>((resolve) => { resolveDetailRefresh = resolve; });
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teacher/dashboard") return response({ classes: [{ id: "c1", name: "一班", students: 1, dataType: "REAL" }], classesMeta: { total: 1, returned: 1, truncated: false } });
      if (url.includes("dashboard?classId=c1")) { analyticsCalls += 1; return decided ? analyticsRefresh : response(analytics); }
      if (url.includes("learners/s1")) { detailCalls += 1; return decided ? detailRefresh : response(initialDetail); }
      if (url === `/api/teacher/evidence/${evidenceId}`) return response({ id: evidenceId, label: "输入观察", signalLayer: "INPUT", verificationStatus: decided ? "TEACHER_VERIFIED" : "SUBMITTED", confirmedCode: decided ? "INPUT_OK" : null, evidenceSequence: 1, createdAt: new Date(0).toISOString(), dataType: "REAL", kind: "TEXT", text: "输入值为 0.72" });
      if (url === "/api/teacher/decisions" && init?.method === "POST") { decided = true; return response(savedDecision, 201); }
      if (url === "/api/evidence?limit=20") return response({ items: [], nextCursor: null });
      throw new Error(`unexpected ${url}`);
    });

    render(<TeacherWorkspace fetcher={fetcher} />);
    fireEvent.click(await screen.findByRole("button", { name: /查看匿名-A/ }));
    fireEvent.change(await screen.findByLabelText("复核对象"), { target: { value: `EVIDENCE:${evidenceId}` } });
    expect(await screen.findByText("输入值为 0.72")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存教师决定" }));

    await waitFor(() => expect(analyticsCalls).toBe(2));
    await waitFor(() => expect(detailCalls).toBe(2));
    expect(screen.getByRole("button", { name: "正在保存…" })).toBeDisabled();
    await act(async () => {
      resolveAnalyticsRefresh(await response(analytics));
      resolveDetailRefresh(await response(refreshedDetail));
      await Promise.all([analyticsRefresh, detailRefresh]);
    });
    expect(await screen.findByText("原系统结果：TEACHER_VERIFIED")).toBeInTheDocument();
    expect(await screen.findByText("INPUT · TEXT · TEACHER_VERIFIED")).toBeInTheDocument();
    expect(screen.queryByText("针对历史版本")).not.toBeInTheDocument();
  });

  it("submits a standalone book-layout review with a null project scope", async () => {
    const bookId = "88888888-8888-4888-8888-888888888888";
    const snapshot = {
      targetType: "BOOK_LAYOUT_EVIDENCE" as const, revision: 1 as const, id: bookId,
      audience: "NEW_STUDENTS" as const,
      pageOrder: ["cover", "quick-start", "activity-map", "featured-activity", "calendar", "community-voices", "join-us", "contact"] as const,
      diagnosticAnswers: ["AUDIENCE_FIRST", "TASK_FIRST", "AUDIENCE_FIRST"] as const,
      transferChoices: [],
      criteria: [
        { id: "DIAGNOSTIC" as const, passed: true, label: "受众与任务诊断", note: "已完成" },
        { id: "PAGE_BOUNDARY" as const, passed: true, label: "8页边界", note: "已完成" },
        { id: "READING_PATH" as const, passed: true, label: "阅读路径", note: "已完成" },
        { id: "AUDIENCE_TRANSFER" as const, passed: true, label: "受众迁移", note: "当前面向新生" },
      ],
      score: 4, passed: true,
    };
    const standaloneDetail = {
      ...detail, project: null, logic: null,
      reviewTargets: [{ targetId: bookId, snapshot }],
      bookLayoutEvidence: { id: bookId, audience: "NEW_STUDENTS", score: 4, passed: true, createdAt: new Date(0).toISOString(), dataType: "REAL" },
    };
    const savedDecision = {
      id: "book-decision", targetType: "BOOK_LAYOUT_EVIDENCE", targetId: bookId,
      originalRevision: 1, decision: "CONFIRMED", reasonCode: "TEACHER_CHECK", notes: "",
      sequence: 1, timelineSequence: 1, createdAt: new Date(0).toISOString(), originalSnapshot: snapshot,
    };
    let requestBody: Record<string, unknown> | null = null;
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teacher/dashboard") return response({ classes: [{ id: "c1", name: "一班", students: 1, dataType: "REAL" }], classesMeta: { total: 1, returned: 1, truncated: false } });
      if (url.includes("dashboard?classId=c1")) return response(analytics);
      if (url.includes("learners/s1")) return response(standaloneDetail);
      if (url === "/api/teacher/decisions" && init?.method === "POST") {
        requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return response(savedDecision, 201);
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<TeacherWorkspace fetcher={fetcher} />);
    fireEvent.click(await screen.findByRole("button", { name: /查看匿名-A/ }));
    expect(await screen.findByRole("heading", { name: "8页导览册复核内容" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存教师决定" }));
    await waitFor(() => expect(requestBody).toMatchObject({
      targetType: "BOOK_LAYOUT_EVIDENCE", targetId: bookId, projectId: null, studentId: "s1", classId: "c1",
    }));
    expect(await screen.findByText("教师决定：CONFIRMED")).toBeInTheDocument();
  });

  it("refreshes current analytics and open learner detail after history deletion", async () => {
    const evidenceId = "11111111-1111-4111-8111-111111111111";
    const withEvidenceMetrics = { ...metrics, evidence: { byVerification: [{ key: "SUBMITTED", count: 1 }], byAuthority: [{ key: "STUDENT", count: 1 }] } };
    const analyticsWithEvidence = { ...analytics, ...withEvidenceMetrics, metricsByDataType: { REAL: withEvidenceMetrics, DEMONSTRATION_DATA: emptyMetrics } };
    const evidenceTarget = { targetId: evidenceId, snapshot: { targetType: "EVIDENCE" as const, id: evidenceId, kind: "TEXT" as const, layer: "INPUT" as const, verification: "SUBMITTED" as const, code: null, revision: 1, sequence: 1 } };
    const detailWithEvidence = {
      ...detail,
      evidence: { total: 1, byVerification: [{ key: "SUBMITTED", count: 1 }], byAuthority: [{ key: "STUDENT", count: 1 }] },
      reviewTargets: [...detail.reviewTargets, evidenceTarget],
    };
    let deleted = false;
    let analyticsCalls = 0;
    let detailCalls = 0;
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teacher/dashboard") return response({ classes: [{ id: "c1", name: "一班", students: 1, dataType: "REAL" }], classesMeta: { total: 1, returned: 1, truncated: false } });
      if (url.includes("dashboard?classId=c1")) { analyticsCalls += 1; return response(deleted ? analytics : analyticsWithEvidence); }
      if (url.includes("learners/s1")) { detailCalls += 1; return response(deleted ? detail : detailWithEvidence); }
      if (url === "/api/evidence?limit=20") return response({ items: deleted ? [] : [{
        id: evidenceId, projectId: "p1", classId: "c1", studentId: "s1", ownerAlias: "匿名-A",
        kind: "TEXT", signalLayer: "INPUT", label: "同步证据", verificationStatus: "SUBMITTED",
        createdAt: new Date(0).toISOString(), dataType: "REAL",
      }], nextCursor: null });
      if (url === `/api/evidence/${evidenceId}` && init?.method === "DELETE") { deleted = true; return Promise.resolve(new Response(null, { status: 204 })); }
      throw new Error(`unexpected ${url}`);
    });

    render(<TeacherWorkspace fetcher={fetcher} />);
    fireEvent.click(await screen.findByRole("button", { name: /查看匿名-A/ }));
    const learner = (await screen.findByRole("heading", { name: "匿名-A" })).closest("section")!;
    expect(within(learner).getByRole("button", { name: /删除证据.*INPUT.*SUBMITTED/ })).toBeInTheDocument();
    const history = screen.getByRole("heading", { name: "全部历史证据" }).closest("section")!;
    fireEvent.click(within(history).getByRole("button", { name: /删除证据.*同步证据/ }));
    fireEvent.click(screen.getByRole("button", { name: /确认删除.*同步证据/ }));

    await waitFor(() => expect(analyticsCalls).toBe(2));
    await waitFor(() => expect(detailCalls).toBe(2));
    expect(within(learner).queryByRole("button", { name: /删除证据.*INPUT.*SUBMITTED/ })).not.toBeInTheDocument();
    const evidenceMetrics = screen.getByRole("heading", { name: "证据来源与验证" }).closest("article")!;
    expect(within(evidenceMetrics).getByText("暂无证据")).toBeInTheDocument();
  });

  it("stops loading after the class-list request fails", async () => {
    render(<TeacherWorkspace fetcher={async () => { throw new Error("班级加载失败"); }} />);
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((alert) => alert.textContent === "班级加载失败")).toBe(true);
    expect(screen.queryByText("正在加载班级数据…")).not.toBeInTheDocument();
  });

  it("automatically shows a clearly labelled demo class when no real class exists and respects manual opt-out", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url === "/api/teacher/dashboard") return response({ classes: [], classesMeta: { total: 0, returned: 0, truncated: false } });
      if (url === "/api/teacher/dashboard?includeDemo=true") return response({ classes: [{ id: "demo", name: "演示班", students: 4, realStudents: 0, demoStudents: 4, dataType: "REAL" }], classesMeta: { total: 1, returned: 1, truncated: false } });
      if (url === "/api/teacher/dashboard?classId=demo&includeDemo=true") return response({ ...analytics, class: { id: "demo", name: "演示班", dataType: "REAL" } });
      if (url === "/api/teacher/dashboard?classId=demo") return response(analytics);
      throw new Error(`unexpected ${url}`);
    });
    render(<TeacherWorkspace fetcher={fetcher} />);
    const toggle = await screen.findByRole("checkbox", { name: "显示演示数据" });
    expect(await screen.findByText(/已自动打开演示班/)).toBeInTheDocument();
    expect(await screen.findByText("演示班")).toBeInTheDocument();
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText("演示班")).not.toBeInTheDocument());
    expect(calls).not.toContain("/api/teacher/dashboard?classId=demo");
  });

  it("ignores a stale demo class list even when the fetcher does not honor abort", async () => {
    let releaseDemo!: (response: Response) => void;
    const delayedDemo = new Promise<Response>((resolve) => { releaseDemo = resolve; });
    let defaultCalls = 0;
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/teacher/dashboard?includeDemo=true") return delayedDemo;
      if (url === "/api/teacher/dashboard") {
        defaultCalls += 1;
        return response({ classes: [], classesMeta: { total: 0, returned: 0, truncated: false } });
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<TeacherWorkspace fetcher={fetcher} />);
    const toggle = await screen.findByRole("checkbox", { name: "显示演示数据" });
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/teacher/dashboard?includeDemo=true", expect.anything()));
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(defaultCalls).toBe(2));
    await act(async () => {
      releaseDemo(await response({ classes: [{ id: "demo", name: "过期演示班", students: 4, realStudents: 0, demoStudents: 4, dataType: "REAL" }], classesMeta: { total: 1, returned: 1, truncated: false } }));
      await delayedDemo;
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(screen.queryByText("过期演示班")).not.toBeInTheDocument();
  });

  it("aborts an in-flight learner request when the workspace unmounts", async () => {
    let detailSignal: AbortSignal | undefined;
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teacher/dashboard") return response({ classes: [{ id: "c1", name: "一班", students: 1, dataType: "REAL" }], classesMeta: { total: 1, returned: 1, truncated: false } });
      if (url.includes("dashboard?classId=c1")) return response(analytics);
      if (url.includes("learners/s1")) { detailSignal = init?.signal ?? undefined; return new Promise<Response>(() => undefined); }
      throw new Error(`unexpected ${url}`);
    });
    const view = render(<TeacherWorkspace fetcher={fetcher} />);
    await screen.findByRole("button", { name: /查看匿名-A/ });
    await waitFor(() => expect(screen.queryByText("正在加载班级数据…")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /查看匿名-A/ }));
    await waitFor(() => expect(detailSignal).toBeDefined());
    view.unmount();
    expect(detailSignal?.aborted).toBe(true);
  });

  it("clears stale analytics and learner forms synchronously on learner and class changes", async () => {
    const multi = { ...analytics, students: [...analytics.students, { id: "s2", alias: "匿名-B", stage: "LOGIC_CARD" as const, needsSupport: false, updatedAt: new Date(0).toISOString() }] };
    let learnerSignal: AbortSignal | undefined;
    let classSignal: AbortSignal | undefined;
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/teacher/dashboard") return response({ classes: [{ id: "c1", name: "一班", students: 2, dataType: "REAL" }, { id: "c2", name: "二班", students: 0, dataType: "REAL" }], classesMeta: { total: 2, returned: 2, truncated: false } });
      if (url.includes("dashboard?classId=c1")) return response(multi);
      if (url.includes("dashboard?classId=c2")) { classSignal = init?.signal ?? undefined; return new Promise<Response>(() => undefined); }
      if (url.includes("learners/s1")) return response(detail);
      if (url.includes("learners/s2")) { learnerSignal = init?.signal ?? undefined; return new Promise<Response>(() => undefined); }
      if (url === "/api/teacher/decisions") return response({}, 500);
      throw new Error(`unexpected ${url}`);
    });
    render(<TeacherWorkspace fetcher={fetcher} />);
    fireEvent.click(await screen.findByRole("button", { name: /查看匿名-A/ }));
    expect(await screen.findByText("原系统结果：PENDING")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /查看匿名-B/ }));
    expect(screen.queryByText("原系统结果：PENDING")).not.toBeInTheDocument();
    await waitFor(() => expect(learnerSignal).toBeDefined());
    fireEvent.change(screen.getByLabelText("选择班级"), { target: { value: "c2" } });
    expect(screen.queryByRole("heading", { name: "一班" })).not.toBeInTheDocument();
    expect(learnerSignal?.aborted).toBe(true);
    await waitFor(() => expect(classSignal).toBeDefined());
    expect(fetcher.mock.calls.filter(([url]) => String(url) === "/api/teacher/decisions")).toHaveLength(0);
  });
});

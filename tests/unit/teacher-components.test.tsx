import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClassOverview } from "@/components/teacher/ClassOverview";
import { LearnerDetail } from "@/components/teacher/LearnerDetail";
import { MisconceptionPanel } from "@/components/teacher/MisconceptionPanel";
import { ClassAnalyticsSchema, LearnerDetailSchema } from "@/lib/domain/teacher";

const metricFields = {
  stages: ["DIAGNOSTIC", "LOGIC_CARD", "TOOL_PATH", "BUILD", "TROUBLESHOOT", "TRANSFER", "COMPLETE"].map((stage, index) => ({ stage, count: index === 4 ? 2 : 0 })),
  supportNeeded: 1,
  profiles: { levels: [{ key: "L2", count: 2 }], dimensions: [{ dimension: "mappingDesign", scores: [{ key: "1", count: 1 }, { key: "3", count: 1 }], support: 1 }] },
  logicIssues: [{ key: "MAPPING_WEAK", count: 3 }],
  troubleshooting: { byLayer: [{ layer: "MAPPING", count: 2 }], escalated: 1 },
  hints: { students: 2, total: 5, latestL3: 1, maxL3: 2 },
  transfer: { active: 1, passed: 2, locked: 1 },
  evidence: { byVerification: [{ key: "SUBMITTED", count: 2 }], byAuthority: [{ key: "STUDENT", count: 2 }] },
};
const emptyMetricFields = { ...metricFields, stages: metricFields.stages.map(({ stage }) => ({ stage, count: 0 })), supportNeeded: 0, profiles: { levels: [], dimensions: [] }, logicIssues: [], troubleshooting: { byLayer: [], escalated: 0 }, hints: { students: 0, total: 0, latestL3: 0, maxL3: 0 }, transfer: { active: 0, passed: 0, locked: 0 }, evidence: { byVerification: [], byAuthority: [] } };
const analytics = ClassAnalyticsSchema.parse({
  aiMode: "DETERMINISTIC_FALLBACK" as const,
  class: { id: "c1", name: "数字交互一班", dataType: "REAL" as const }, updatedAt: new Date(0).toISOString(),
  dataCounts: { real: 1, demonstration: 0, included: 1 },
  ...metricFields,
  metricsByDataType: { REAL: metricFields, DEMONSTRATION_DATA: emptyMetricFields },
  students: [{ id: "s1", alias: "匿名-A01", stage: "TROUBLESHOOT", needsSupport: true, updatedAt: new Date(0).toISOString() }],
  studentsMeta: { total: 1, returned: 1, truncated: false, aggregateScope: "ALL_CLASS_STUDENTS" as const },
});

const evidenceId = "11111111-1111-4111-8111-111111111111";
const evidenceDecision = { id: "d2", targetType: "EVIDENCE" as const, targetId: evidenceId, originalRevision: 1, decision: "CONFIRMED" as const, reasonCode: "EVIDENCE_OK", notes: "证据已核对", sequence: 1, timelineSequence: 2, createdAt: new Date(1000).toISOString(), originalSnapshot: { targetType: "EVIDENCE" as const, id: evidenceId, kind: "TEXT" as const, layer: "INPUT" as const, verification: "SUBMITTED" as const, code: null, revision: 1, sequence: 1 } };
const logicDecision = { id: "d1", targetType: "LOGIC_REVIEW" as const, targetId: "p1", originalRevision: 4, decision: "CORRECTED" as const, reasonCode: "TEACHER_CHECK", notes: "已核对", sequence: 1, timelineSequence: 1, createdAt: new Date(0).toISOString(), originalSnapshot: { targetType: "LOGIC_REVIEW" as const, revision: 4, status: "NEEDS_REVISION" as const, ruleReady: true, semanticReady: false, source: "RULE", issues: ["MAPPING_WEAK"] } };

const detail = LearnerDetailSchema.parse({
  aiMode: "DETERMINISTIC_FALLBACK" as const,
  student: { id: "s1", alias: "匿名-A01", dataType: "REAL" as const }, profile: null,
  project: { id: "p1", stage: "LOGIC_CARD" as const, updatedAt: new Date(0).toISOString() },
  logic: { status: "NEEDS_REVISION", source: "RULE", issues: ["MAPPING_WEAK"], revision: 4, ruleReady: true, semanticReady: false },
  path: null, evidence: { total: 0, byVerification: [], byAuthority: [] }, troubleshooting: null,
  hints: { latestLevel: 3, maxLevel: 3, count: 2 }, transfer: null,
  reviewTargets: [
    { targetId: "p1", snapshot: { targetType: "LOGIC_REVIEW" as const, revision: 4, status: "NEEDS_REVISION" as const, ruleReady: true, semanticReady: false, source: "RULE", issues: ["MAPPING_WEAK"] } },
    { targetId: evidenceId, snapshot: { targetType: "EVIDENCE" as const, id: evidenceId, kind: "TEXT" as const, layer: "INPUT" as const, verification: "SUBMITTED" as const, code: null, revision: 1, sequence: 1 } },
    { targetId: "t1", snapshot: { targetType: "TRANSFER" as const, revision: 1, status: "OPEN" as const, attemptCount: 0, latestRubric: null, latestOutcome: null } },
  ],
  decisions: [evidenceDecision, logicDecision],
  latestDecisionByTarget: { [`EVIDENCE:${evidenceId}`]: evidenceDecision, "LOGIC_REVIEW:p1": logicDecision },
});

const agentTurnId = "22222222-2222-4222-8222-222222222222";
const toolCallId = "33333333-3333-4333-8333-333333333333";
const governedDetail = LearnerDetailSchema.parse({
  ...detail,
  agentTimeline: [{
    turnId: agentTurnId,
    conversationId: "44444444-4444-4444-8444-444444444444",
    coursePackId: "digital-interaction",
    coursePackVersion: "1",
    coursePackLabel: "数字交互文创",
    studentMessage: "声音有数值但画面不动",
    episode: "DEBUG",
    decisionCode: "DEBUG_TRACE_SIGNAL",
    responseStrategy: "DIAGNOSTIC_GUIDANCE",
    responseLatencyMs: 48,
    aiMode: "DETERMINISTIC_FALLBACK",
    policy: {
      policyId: "competition-core",
      policyVersion: "1",
      budgets: { modelDecisions: 1, maxModelDecisions: 4, toolCalls: 1, maxToolCalls: 6, turnTimeoutMs: 30_000 },
      autonomy: { readOnlyTools: "AUTOMATIC", studentMutations: "STUDENT_CONFIRMATION", formalAuthority: "FORBIDDEN" },
      appliedRules: ["BOUND_EXECUTION", "REGISTERED_TOOLS_ONLY", "FORBID_FORMAL_AUTHORITY"],
    },
    executionSteps: [
      { id: "55555555-5555-4555-8555-555555555555", sequence: 1, kind: "TOOL_CALL", status: "SUCCEEDED", label: "执行只读工具", summary: "读取当前项目。", toolCallId, toolId: "project-evidence.read-state", latencyMs: 12 },
      { id: "66666666-6666-4666-8666-666666666666", sequence: 2, kind: "DEGRADED", status: "SUCCEEDED", label: "启用确定性降级", summary: "模型服务超时，保留已验证观察。", toolCallId: null, toolId: null, latencyMs: 0 },
    ],
    toolCalls: [{ id: toolCallId, sequence: 1, toolId: "project-evidence.read-state", toolVersion: "1", adapterId: "project-evidence", input: {}, status: "EMPTY", errorCode: null, latencyMs: 12, createdAt: new Date(0).toISOString(), dataType: "REAL" }],
    sourceIds: [`tool:${toolCallId}`],
    reply: {
      title: "先核对输出链",
      message: "当前项目还没有可验证输出。",
      whyThisStep: "先读取学习现场，避免凭空判断。",
      uncertainty: "尚未看到输出截图。",
      sources: [{ id: `tool:${toolCallId}`, title: "当前项目与五层证据", authority: "LEARNING_RECORD", scope: "本回合只读观察" }],
      actions: [{ id: "77777777-7777-4777-8777-777777777777", label: "开始证据排障", description: "逐层核对", status: "PROPOSED" }],
    },
    createdAt: new Date(0).toISOString(),
    dataType: "REAL",
    review: null,
  }],
});

describe("teacher components", () => {
  afterEach(() => cleanup());
  it("shows all stages, support count and opens an anonymous learner", () => {
    const open = vi.fn();
    render(<ClassOverview analytics={analytics} onOpenLearner={open} />);
    expect(screen.getByText("需要支持 1 人")).toBeInTheDocument();
    expect(screen.getByText("诊断")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /查看匿名-A01/ }));
    expect(open).toHaveBeenCalledWith("s1");
  });

  it("shows top misconceptions, troubleshooting layers and hint dependence", () => {
    render(<MisconceptionPanel analytics={analytics} />);
    expect(screen.getByText("MAPPING_WEAK")).toBeInTheDocument();
    expect(screen.getByText(/升级求助 1/)).toBeInTheDocument();
    expect(screen.getByText(/曾到 L3：2/)).toBeInTheDocument();
  });

  it("shows profile support, transfer, evidence sources and snapshot timestamp", () => {
    render(<ClassOverview analytics={analytics} onOpenLearner={() => undefined} />);
    expect(screen.getByText(/mappingDesign.*需支持 1/)).toBeInTheDocument();
    expect(screen.getByText(/迁移.*1.*2.*1/)).toBeInTheDocument();
    expect(screen.getByText(/SUBMITTED 2/)).toBeInTheDocument();
    expect(screen.getByText(/STUDENT 2/)).toBeInTheDocument();
    expect(screen.getByText(/1970/)).toBeInTheDocument();
    expect(screen.getByText(/层级：L2 2人/)).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").every((cell) => cell.getAttribute("scope") === "col")).toBe(true);
  });

  it("shows evidence content before an append-only evidence decision can be submitted", async () => {
    const submit = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      id: evidenceId, label: "输入观察", signalLayer: "INPUT", verificationStatus: "SUBMITTED",
      confirmedCode: null, evidenceSequence: 1, createdAt: new Date(0).toISOString(), dataType: "REAL",
      kind: "TEXT", text: "学生记录：声音输入为 0.72，画面仍未变化。",
    }), { headers: { "content-type": "application/json" } }));
    render(<LearnerDetail detail={detail} fetcher={fetcher as typeof fetch} onDecision={submit} pending={false} />);
    expect(screen.getByText("原系统结果：NEEDS_REVISION")).toBeInTheDocument();
    expect(screen.getByText("教师决定：CORRECTED")).toBeInTheDocument();
    expect(screen.getAllByText(/当时原结果：NEEDS_REVISION/).length).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByLabelText("教师备注"), { target: { value: "旧目标备注" } });
    fireEvent.change(screen.getByLabelText("复核对象"), { target: { value: `EVIDENCE:${evidenceId}` } });
    expect(await screen.findByText("学生记录：声音输入为 0.72，画面仍未变化。")).toBeInTheDocument();
    expect(screen.getByText("原系统结果：SUBMITTED")).toBeInTheDocument();
    expect(screen.getByText("教师决定：CONFIRMED")).toBeInTheDocument();
    expect(screen.getByLabelText("教师备注")).toHaveValue("");
    expect(screen.getByRole("option", { name: "举一反三：OPEN" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("复核对象"), { target: { value: "TRANSFER:t1" } });
    expect(screen.getByText("原系统结果：OPEN")).toBeInTheDocument();
    expect(screen.getByText("尚未处理")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("复核对象"), { target: { value: `EVIDENCE:${evidenceId}` } });
    expect(await screen.findByText("学生记录：声音输入为 0.72，画面仍未变化。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /暂待复核/ }));
    fireEvent.change(screen.getByLabelText("教师备注"), { target: { value: "请当面检查" } });
    fireEvent.click(screen.getByRole("button", { name: "保存教师决定" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ decision: "NEEDS_REVIEW", reasonCode: "EVIDENCE_NEEDS_REVIEW", notes: "请当面检查", targetType: "EVIDENCE", targetId: evidenceId, originalRevision: 1 }));
    expect(screen.getAllByRole("time").some((node) => node.getAttribute("datetime") === detail.decisions[0].createdAt)).toBe(true);
  });

  it("keeps an image evidence decision locked until the authenticated preview actually loads", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      id: evidenceId, label: "输出截图", signalLayer: "INPUT", verificationStatus: "SUBMITTED",
      confirmedCode: null, evidenceSequence: 1, createdAt: new Date(0).toISOString(), dataType: "REAL",
      kind: "IMAGE", previewUrl: `/api/evidence/${evidenceId}`,
    }), { headers: { "content-type": "application/json" } }));
    render(<LearnerDetail detail={detail} fetcher={fetcher as typeof fetch} onDecision={() => undefined} pending={false} />);
    fireEvent.change(screen.getByLabelText("复核对象"), { target: { value: `EVIDENCE:${evidenceId}` } });
    const image = await screen.findByRole("img", { name: "证据图片：输出截图" });
    expect(screen.getByRole("button", { name: "读取证据后可保存" })).toBeDisabled();
    fireEvent.load(image);
    expect(screen.getByRole("button", { name: "保存教师决定" })).toBeEnabled();
    fireEvent.error(image);
    expect(screen.getByRole("button", { name: "读取证据后可保存" })).toBeDisabled();
  });

  it("shows every book-layout evidence field and submits it through the shared decision form", () => {
    const submit = vi.fn();
    const bookId = "88888888-8888-4888-8888-888888888888";
    const bookDetail = LearnerDetailSchema.parse({
      ...detail,
      reviewTargets: [...detail.reviewTargets, {
        targetId: bookId,
        snapshot: {
          targetType: "BOOK_LAYOUT_EVIDENCE", revision: 1, id: bookId,
          audience: "COMMUNITY_RESIDENTS",
          pageOrder: ["cover", "quick-start", "activity-map", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
          diagnosticAnswers: ["AUDIENCE_FIRST", "TASK_FIRST", "AUDIENCE_FIRST"],
          transferChoices: ["COMMUNITY_ENTRY_FIRST", "VOLUNTEER_CALL_TO_ACTION", "RETAIN_ACTIVITY_CORE"],
          criteria: [
            { id: "DIAGNOSTIC", passed: true, label: "受众与任务诊断", note: "先判断读者与任务。" },
            { id: "PAGE_BOUNDARY", passed: true, label: "8页边界", note: "八类内容各占一个页面位置。" },
            { id: "READING_PATH", passed: true, label: "阅读路径", note: "形成阅读先后。" },
            { id: "AUDIENCE_TRANSFER", passed: true, label: "受众迁移", note: "已改写社区入口。" },
          ],
          score: 4, passed: true,
        },
      }],
    });
    render(<LearnerDetail detail={bookDetail} onDecision={submit} pending={false} />);
    fireEvent.change(screen.getByLabelText("复核对象"), { target: { value: `BOOK_LAYOUT_EVIDENCE:${bookId}` } });
    expect(screen.getByRole("heading", { name: "8页导览册复核内容" })).toBeInTheDocument();
    expect(screen.getByText("社区居民")).toBeInTheDocument();
    expect(screen.getByText("改变社区入口、改变行动召唤、保留活动核心")).toBeInTheDocument();
    expect(screen.getByText("快速导读")).toBeInTheDocument();
    expect(screen.getByText("判断 2：先判断阅读任务")).toBeInTheDocument();
    expect(screen.getByText("四项规则结果")).toBeInTheDocument();
    expect(screen.getAllByLabelText("通过")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /纠正或未通过/ }));
    fireEvent.change(screen.getByLabelText("教师备注"), { target: { value: "需补目标读者走查" } });
    fireEvent.click(screen.getByRole("button", { name: "保存教师决定" }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      targetType: "BOOK_LAYOUT_EVIDENCE", targetId: bookId, originalRevision: 1,
      decision: "CORRECTED", notes: "需补目标读者走查",
    }));
  });

  it("warns when the learner list is truncated while aggregates remain class-wide", () => {
    render(<ClassOverview analytics={{ ...analytics, studentsMeta: { total: 1200, returned: 1000, truncated: true, aggregateScope: "ALL_CLASS_STUDENTS" } }} onOpenLearner={() => undefined} />);
    expect(screen.getByText(/仅显示 1000\/1200人.*聚合指标仍覆盖全班/)).toBeInTheDocument();
  });

  it("marks a latest decision whose immutable snapshot targets an older revision", () => {
    const revised = LearnerDetailSchema.parse({ ...detail, reviewTargets: detail.reviewTargets.map((target) => target.snapshot.targetType === "LOGIC_REVIEW" ? { ...target, snapshot: { ...target.snapshot, revision: 5, status: "APPROVED" as const, semanticReady: true, issues: [] } } : target) });
    render(<LearnerDetail detail={revised} onDecision={() => undefined} pending={false} />);
    expect(screen.getByText("当前版本：5")).toBeInTheDocument();
    expect(screen.getByText("针对历史版本")).toBeInTheDocument();
    expect(screen.getByText(/当时版本：4；当时原结果：NEEDS_REVISION/)).toBeInTheDocument();
  });

  it("shows an auditable agent policy, tool trace, degradation reason and teacher review", () => {
    const review = vi.fn();
    render(<LearnerDetail detail={governedDetail} onAgentReview={review} onDecision={() => undefined} pending={false} />);
    expect(screen.getByRole("heading", { name: "智能体决策与工具审查" })).toBeInTheDocument();
    expect(screen.getAllByText("competition-core@1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("实际工具调用")).toBeInTheDocument();
    expect(screen.getAllByText("project-evidence.read-state@1").length).toBe(1);
    expect(screen.getAllByText(/模型服务超时，保留已验证观察/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("不包含模型内部思维")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("智能体教师判断"), { target: { value: "CORRECTED" } });
    fireEvent.change(screen.getByLabelText("智能体复核说明"), { target: { value: "应先检查输出节点是否激活。" } });
    fireEvent.click(screen.getByRole("button", { name: "记录教师复核" }));
    expect(review).toHaveBeenCalledWith({ turnId: agentTurnId, decision: "CORRECTED", notes: "应先检查输出节点是否激活。" });
  });
});

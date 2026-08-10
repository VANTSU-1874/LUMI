import { getCoursePack } from "@/lib/course-packs/registry";
import type { DatabaseConnection } from "@/lib/db/client";
import type { LogicCardCoachInput, LogicCardCoachSuggestion } from "@/lib/domain/logic-card-coach-contract";
import { guidanceStep } from "@/lib/domain/logic-card-guidance";
import type { SessionPayload } from "@/lib/auth/session";

import { AgentReplySchema, AgentTurnRequestSchema } from "./contracts";
import { createExecutionTrace } from "./execution-trace";
import { clampAgentTurnLatencyMs } from "./latency-limits";
import { readStudentContext } from "./orchestrator-context";
import { persistAgentTurn } from "./orchestrator-store";
import { createPolicyTrace } from "./policy-enforcement";
import { getActiveAgentPolicy } from "./policy-registry";
import { createInMemoryTraceSink } from "./runtime/trace-sink";

type AuditedProject = {
  id: string;
  stage: string;
  coursePackId: string | null;
  coursePackVersion: string | null;
};

export function persistLogicCardCoachTurn(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  project: AuditedProject;
  request: LogicCardCoachInput;
  suggestion: LogicCardCoachSuggestion;
  responseLatencyMs: number;
  now?: Date;
}) {
  const { connection, actor, project, request, suggestion } = input;
  const pack = getCoursePack(project.coursePackId ?? "digital-interaction", project.coursePackVersion ?? "1");
  const currentContext = readStudentContext(connection, actor, pack.id, request.answer);
  const context = {
    ...currentContext,
    project: {
      id: project.id,
      stage: project.stage,
      coursePackId: pack.id,
      coursePackVersion: pack.version,
    },
  };
  const policy = getActiveAgentPolicy();
  const modelAssisted = suggestion.mode === "MODEL_ASSISTED";
  const traceSink = createInMemoryTraceSink({ id: "logic-card-coach", version: "1.0.0" });
  const trace = createExecutionTrace(traceSink);
  traceSink.emit({
    kind: "CONTEXT_PREPARATION", status: "SUCCEEDED", label: "读取逻辑卡上下文",
    summary: "已读取当前关系字段与学生原话，不要求学生填写额外专业表单。", latencyMs: 0,
  });
  traceSink.emit({
    kind: "POLICY_CHECK", status: "SUCCEEDED", label: "限制为待确认假设",
    summary: "候选理解不会自动写入逻辑卡或改变项目阶段。",
    policyRule: "STUDENT_CONFIRM_MUTATIONS", latencyMs: 0,
  });
  trace.add({
    kind: modelAssisted ? "MODEL_DECISION" : "DEGRADED",
    status: "SUCCEEDED",
    label: modelAssisted ? "生成澄清假设" : "使用课程基础引导",
    summary: `围绕“${guidanceStep(request.field).chainLabel}”提供待学生确认的候选理解。`,
    toolCallId: null,
    toolId: null,
    latencyMs: clampAgentTurnLatencyMs(input.responseLatencyMs),
  });
  traceSink.emit({
    kind: "SOURCE_SELECTION", status: "SUCCEEDED", label: "选择课程澄清框架",
    summary: "仅引用课程中的逻辑澄清框架，不把候选理解当成正式结论。",
    sourceIds: ["course-pack:logic-card-clarification"], latencyMs: 0,
  });
  trace.add({
    kind: "FINAL_RESPONSE",
    status: "SUCCEEDED",
    label: "等待学生确认",
    summary: "候选不会直接写入逻辑卡，也不会改变项目阶段。",
    toolCallId: null,
    toolId: null,
    latencyMs: 0,
  });
  const policyTrace = createPolicyTrace({
    policy,
    modelDecisions: modelAssisted ? 1 : 0,
    toolCalls: 0,
    appliedRules: [
      "BOUND_EXECUTION",
      "PERSIST_EXECUTION_TRACE",
      "GROUND_COURSE_FACTS",
      "STUDENT_CONFIRM_MUTATIONS",
      "FORBID_FORMAL_AUTHORITY",
    ],
  });
  const reply = AgentReplySchema.parse({
    eyebrow: `${pack.label} · UNDERSTAND`,
    title: "先确认你真正想表达的意思",
    message: `${suggestion.acknowledgement} ${suggestion.question} 候选：${suggestion.options.map(({ label }) => label).join("；")}`,
    whyThisStep: "模糊表达不是错误。Agent 先给出几种可能的理解，由学生确认后再写入关系链。",
    uncertainty: modelAssisted
      ? "这些只是根据学生原话形成的待确认假设，不代表正式答案或评价结果。"
      : "当前未调用模型，使用课程包中的基础候选；这些仍是待学生确认的假设。",
    graph: {
      nodes: [
        { id: "raw", label: "学生原话", kind: "CONTEXT" },
        { id: "hypotheses", label: "候选理解", kind: "CONCEPT" },
        { id: "confirmation", label: "学生确认", kind: "ACTION" },
        { id: "relationship", label: "关系链", kind: "EVIDENCE" },
      ],
      links: [["raw", "hypotheses"], ["hypotheses", "confirmation"], ["confirmation", "relationship"]],
    },
    sources: [{
      id: "course-pack:logic-card-clarification",
      title: "六元交互逻辑澄清框架",
      authority: "COURSE_DESIGN",
      scope: "仅用于形成当前关系的候选理解，不替学生完成其他关系，也不授予通过状态。",
    }],
    actions: [],
  });
  const turnRequest = AgentTurnRequestSchema.parse({
    message: request.answer,
    context: { view: "WORKSPACE", focus: `logic-card:${request.field}` },
  });
  traceSink.emit({
    kind: "PERSISTENCE", status: "SUCCEEDED", label: "保存澄清回合与公开轨迹",
    summary: "澄清建议与公开事件将作为同一事务保存。", latencyMs: 0,
  });
  return persistAgentTurn(connection, context, pack, turnRequest, {
    episode: "UNDERSTAND",
    decisionCode: "UNDERSTAND_CLARIFY_LOGIC_CARD",
    aiMode: suggestion.mode,
    policy: policyTrace,
    executionSteps: trace.snapshot(),
    runtime: traceSink.runtime,
    runtimeEvents: traceSink.snapshot(),
    reply,
    responseStrategy: "CLARIFY",
    responseLatencyMs: clampAgentTurnLatencyMs(input.responseLatencyMs),
    toolExecutions: [],
    briefPatch: {},
  }, input.now ?? new Date());
}

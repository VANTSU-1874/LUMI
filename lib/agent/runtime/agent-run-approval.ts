import { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { AgentTurnResponseSchema, type AgentTurnResponse } from "../contracts";
import {
  appendAgentRunEvent,
  AgentRunConflictError,
  AgentRunNotFoundError,
  epochSeconds,
  publicAgentRun,
  readAgentRunRow,
} from "./agent-run-record";
import {
  AgentRunApprovalResponseSchema,
} from "./agent-run-event";
import { refreshAgentRunResponseActions } from "./agent-run-response";
import { markAgentRunInterventionTerminal } from "./agent-run-intervention-record";

export { AgentRunApprovalRequestSchema } from "./agent-run-event";

type ApprovalRow = {
  id: string;
  turnId: string;
  status: "PROPOSED" | "EXECUTED" | "REJECTED" | "EXPIRED";
  effect: "READ_CONTEXT" | "NAVIGATE" | "WRITE_PROJECT" | "CHANGE_TOOL_STATE" | "SUBMIT_EVALUATION" | "FORMAL_AUTHORITY";
  approvalMode: "AUTOMATIC" | "REQUIRES_CONFIRMATION" | "FORBIDDEN";
  idempotencyKey: string | null;
  target: string;
  focus: string | null;
};

function actionForRun(connection: DatabaseConnection, runId: string, actionId: string) {
  return connection.sqlite.prepare(`
    SELECT a.id, a.turn_id turnId, a.status, a.effect, a.approval_mode approvalMode,
      a.idempotency_key idempotencyKey, a.target, a.focus
    FROM agent_actions a JOIN agent_turns t ON t.id=a.turn_id
    WHERE t.run_id=? AND a.id=?
  `).get(runId, actionId) as ApprovalRow | undefined;
}

export function waitForAgentApproval(input: {
  connection: DatabaseConnection;
  runId: string;
  workerId: string;
  result: AgentTurnResponse;
  now?: Date;
}) {
  const result = AgentTurnResponseSchema.parse(input.result);
  const now = input.now ?? new Date();
  let waiting = false;
  input.connection.sqlite.transaction(() => {
    const run = readAgentRunRow(input.connection, input.runId);
    if (!run) throw new AgentRunNotFoundError();
    if (run.status === "WAITING_APPROVAL") {
      waiting = true;
      return;
    }
    if (run.status !== "RUNNING" || run.leaseOwner !== input.workerId) throw new AgentRunConflictError();
    const actions = input.connection.sqlite.prepare(`
      SELECT a.id, a.effect, a.approval_mode approvalMode
      FROM agent_actions a JOIN agent_turns t ON t.id=a.turn_id
      WHERE t.run_id=? AND a.status='PROPOSED' ORDER BY a.action_sequence
    `).all(run.id) as Array<Pick<ApprovalRow, "id" | "effect" | "approvalMode">>;
    if (actions.length === 0) return;
    if (actions.some(({ effect, approvalMode }) => (
      approvalMode !== "REQUIRES_CONFIRMATION" || effect !== "NAVIGATE"
    ))) {
      throw new AgentRunConflictError("行动审批策略不一致");
    }
    const approvalId = actions[0]!.id;
    const checkpoint = { stage: "WAITING_APPROVAL" as const, turnId: result.turnId, approvalId };
    const nowSeconds = epochSeconds(now);
    const updated = input.connection.sqlite.prepare(`
      UPDATE agent_runs SET status='WAITING_APPROVAL', response_json=?, checkpoint_json=?,
        lease_owner=NULL, lease_expires_at=NULL, updated_at=?
      WHERE id=? AND status='RUNNING' AND lease_owner=?
    `).run(JSON.stringify(result), JSON.stringify(checkpoint), nowSeconds, run.id, input.workerId);
    if (updated.changes !== 1) throw new AgentRunConflictError();
    appendAgentRunEvent(input.connection, run, {
      kind: "APPROVAL", label: "等待你的确认",
      summary: "回答已经保存；受控行动只有在你批准后才会继续。",
      payload: { previousStatus: "RUNNING", status: "WAITING_APPROVAL", turnId: result.turnId, approvalId, checkpoint }, now,
    });
    waiting = true;
  }).immediate();
  if (!waiting) return null;
  const run = readAgentRunRow(input.connection, input.runId);
  if (!run) throw new AgentRunNotFoundError();
  return publicAgentRun(run);
}

export function settleAgentRunApproval(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  runId: string;
  actionId: string;
  decision: "APPROVE" | "REJECT";
  idempotencyKey: string;
  now?: Date;
}) {
  const runId = z.string().uuid().parse(input.runId);
  const actionId = z.string().uuid().parse(input.actionId);
  const idempotencyKey = z.string().uuid().parse(input.idempotencyKey);
  const now = input.now ?? new Date();
  let alreadyApplied = false;
  let navigation: { target: string; focus: string | null } | null = null;

  input.connection.sqlite.transaction(() => {
    if (input.actor.role !== "STUDENT") throw new AgentRunNotFoundError();
    const run = readAgentRunRow(input.connection, runId, input.actor.userId);
    if (!run) throw new AgentRunNotFoundError();
    const action = actionForRun(input.connection, run.id, actionId);
    if (!action) throw new AgentRunNotFoundError();
    const expectedStatus = input.decision === "APPROVE" ? "EXECUTED" : "REJECTED";
    if (action.status === expectedStatus) {
      if (action.idempotencyKey !== idempotencyKey) throw new AgentRunConflictError("审批已经由另一请求处理");
      alreadyApplied = true;
      navigation = input.decision === "APPROVE" ? { target: action.target, focus: action.focus } : null;
      return;
    }
    if (action.status !== "PROPOSED" || run.status !== "WAITING_APPROVAL") {
      throw new AgentRunConflictError("审批状态已变化，请刷新后重试");
    }
    if (action.approvalMode !== "REQUIRES_CONFIRMATION" || action.effect !== "NAVIGATE") {
      throw new AgentRunConflictError("当前版本不能执行这类审批行动");
    }
    const nowSeconds = epochSeconds(now);
    const resolved = input.connection.sqlite.prepare(`
      UPDATE agent_actions SET status=?, idempotency_key=?, executed_at=?, rejected_at=?
      WHERE id=? AND status='PROPOSED' AND idempotency_key IS NULL
    `).run(
      expectedStatus, idempotencyKey,
      input.decision === "APPROVE" ? nowSeconds : null,
      input.decision === "REJECT" ? nowSeconds : null,
      action.id,
    );
    if (resolved.changes !== 1) throw new AgentRunConflictError();
    input.connection.sqlite.prepare(`
      UPDATE agent_actions SET status='EXPIRED'
      WHERE turn_id=? AND id<>? AND status='PROPOSED'
    `).run(action.turnId, action.id);
    const responseJson = refreshAgentRunResponseActions(input.connection, run.responseJson, action.turnId);
    const checkpoint = { stage: "COMPLETED" as const, turnId: action.turnId };
    const completed = input.connection.sqlite.prepare(`
      UPDATE agent_runs SET status='COMPLETED', response_json=?, checkpoint_json=?, updated_at=?, completed_at=?
      WHERE id=? AND status='WAITING_APPROVAL'
    `).run(responseJson, JSON.stringify(checkpoint), nowSeconds, nowSeconds, run.id);
    if (completed.changes !== 1) throw new AgentRunConflictError();
    markAgentRunInterventionTerminal(input.connection, run.id, "COMPLETED", now);
    appendAgentRunEvent(input.connection, run, {
      kind: "APPROVAL", label: input.decision === "APPROVE" ? "行动已批准" : "行动已拒绝",
      summary: input.decision === "APPROVE"
        ? "已执行服务端登记的受控导航行动；没有执行任意命令或写入。"
        : "已保留回答并停止候选行动，没有执行副作用。",
      payload: { previousStatus: "WAITING_APPROVAL", status: "COMPLETED", turnId: action.turnId, approvalId: action.id, decision: input.decision }, now,
    });
    appendAgentRunEvent(input.connection, run, {
      kind: "COMPLETION", label: "本轮运行已完成",
      summary: "回答和审批决定均已持久保存。",
      payload: { previousStatus: "WAITING_APPROVAL", status: "COMPLETED", turnId: action.turnId, checkpoint }, now,
    });
    navigation = input.decision === "APPROVE" ? { target: action.target, focus: action.focus } : null;
  }).immediate();

  const run = readAgentRunRow(input.connection, runId, input.actor.userId);
  if (!run) throw new AgentRunNotFoundError();
  const action = actionForRun(input.connection, runId, actionId);
  if (!action || !["EXECUTED", "REJECTED"].includes(action.status)) throw new AgentRunConflictError();
  return AgentRunApprovalResponseSchema.parse({
    run: publicAgentRun(run),
    action: { id: action.id, status: action.status, alreadyApplied, navigation },
  });
}

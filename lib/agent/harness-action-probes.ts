import { randomUUID } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import { AgentConflictError, AgentForbiddenError, executeAgentAction, runAgentTurn } from "./orchestrator";
import { AgentHarnessCaseResultSchema, type AgentHarnessCaseResult } from "./harness";
import type { ModelProviderAdapter } from "./model-provider-adapter";

const otherStudent = { userId: "harness-other-student", role: "STUDENT" as const } satisfies SessionPayload;

function actionModel(): ModelProviderAdapter {
  return {
    provider: "TEST",
    modelId: "gpt-5.6-harness",
    capabilities: { vision: false },
    async complete() {
      throw new Error("V3_HARNESS_REQUIRES_NATIVE_RESPONSE");
    },
    async respond() {
      return {
        content: "先进入工作空间核对当前目标需要的最小结构；任何会改变状态的操作都必须由学生确认。",
        toolCalls: [],
      };
    },
  };
}

async function createAction(connection: DatabaseConnection, actor: SessionPayload) {
  connection.sqlite.prepare("DELETE FROM agent_session_summaries WHERE student_id=?").run(actor.userId);
  connection.sqlite.prepare("DELETE FROM agent_student_memory WHERE student_id=?").run(actor.userId);
  connection.sqlite.prepare("DELETE FROM agent_conversations WHERE student_id=?").run(actor.userId);
  const turn = await runAgentTurn(connection, actor, {
    message: "带我进入TouchDesigner节点工作空间继续搭建。",
    context: { view: "AGENT" },
  }, { modelProviderAdapter: actionModel() });
  const action = { id: randomUUID() };
  connection.sqlite.prepare(`
    INSERT INTO agent_actions(
      id,turn_id,action_sequence,type,label,adapter_id,target,focus,payload_json,status,
      effect,approval_mode,created_at,data_type
    ) VALUES(?,?,1,'OPEN_WORKSPACE','进入节点工作空间','node-canvas','NODE_CANVAS',NULL,'{}','PROPOSED',
      'NAVIGATE','REQUIRES_CONFIRMATION',?,'REAL')
  `).run(action.id, turn.turnId, Math.floor(Date.now() / 1_000));
  return { turn, action };
}

async function probe(
  caseId: "cross-student-action-rejected" | "action-idempotency-replay",
  execute: () => Promise<{ checks: Array<[boolean, string]>; observed: Record<string, unknown> }>,
) {
  const started = performance.now();
  try {
    const result = await execute();
    const failures = result.checks.filter(([condition]) => !condition).map(([, failure]) => failure);
    return AgentHarnessCaseResultSchema.parse({
      caseId,
      passed: failures.length === 0,
      durationMs: Math.round(performance.now() - started),
      failures,
      observed: result.observed,
    });
  } catch (error) {
    return AgentHarnessCaseResultSchema.parse({
      caseId,
      passed: false,
      durationMs: Math.round(performance.now() - started),
      failures: [`UNCAUGHT:${error instanceof Error ? error.message : String(error)}`.slice(0, 200)],
      observed: {},
    });
  }
}

export async function runAgentActionHarnessCases(connection: DatabaseConnection, actor: SessionPayload) {
  const crossStudent = await probe("cross-student-action-rejected", async () => {
    const { turn, action } = await createAction(connection, actor);
    let rejected = false;
    try {
      executeAgentAction(connection, otherStudent, {
        turnId: turn.turnId,
        actionId: action.id,
        idempotencyKey: randomUUID(),
      });
    } catch (error) {
      rejected = error instanceof AgentForbiddenError;
    }
    const row = connection.sqlite.prepare("SELECT status FROM agent_actions WHERE id=?").get(action.id) as
      | { status: string }
      | undefined;
    return {
      checks: [
        [rejected, "CROSS_STUDENT_ACTION_NOT_REJECTED"],
        [row?.status === "PROPOSED", "CROSS_STUDENT_ACTION_STATE_CHANGED"],
      ],
      observed: { rejected, persistedStatus: row?.status ?? null },
    };
  });

  const idempotency = await probe("action-idempotency-replay", async () => {
    const { turn, action } = await createAction(connection, actor);
    const idempotencyKey = randomUUID();
    const first = executeAgentAction(connection, actor, {
      turnId: turn.turnId, actionId: action.id, idempotencyKey,
    });
    const replay = executeAgentAction(connection, actor, {
      turnId: turn.turnId, actionId: action.id, idempotencyKey,
    });
    let conflictingReplayRejected = false;
    try {
      executeAgentAction(connection, actor, {
        turnId: turn.turnId, actionId: action.id, idempotencyKey: randomUUID(),
      });
    } catch (error) {
      conflictingReplayRejected = error instanceof AgentConflictError;
    }
    const row = connection.sqlite.prepare(
      "SELECT status,idempotency_key idempotencyKey FROM agent_actions WHERE id=?",
    ).get(action.id) as { status: string; idempotencyKey: string | null } | undefined;
    return {
      checks: [
        [first.alreadyExecuted === false, "FIRST_ACTION_REPORTED_AS_REPLAY"],
        [replay.alreadyExecuted === true, "SAME_KEY_REPLAY_EXECUTED_AGAIN"],
        [conflictingReplayRejected, "DIFFERENT_KEY_REPLAY_NOT_REJECTED"],
        [row?.status === "EXECUTED" && row.idempotencyKey === idempotencyKey, "IDEMPOTENCY_NOT_PERSISTED"],
      ],
      observed: {
        firstAlreadyExecuted: first.alreadyExecuted,
        replayAlreadyExecuted: replay.alreadyExecuted,
        conflictingReplayRejected,
        persistedStatus: row?.status ?? null,
      },
    };
  });

  return [crossStudent, idempotency] satisfies AgentHarnessCaseResult[];
}

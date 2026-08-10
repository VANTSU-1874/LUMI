import { randomUUID } from "node:crypto";

import { ModelServiceError } from "@/lib/ai/client";
import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import { decideActionPolicy } from "./action-policy";
import type { AgentHarnessCaseResult } from "./harness";
import { executeAgentAction, runAgentTurn } from "./orchestrator";
import { getActiveAgentPolicy } from "./policy-registry";
import { listAgentTools } from "./tool-registry";
import type { ModelProviderAdapter } from "./model-provider-adapter";

const ACTOR = { userId: "harness-student", role: "STUDENT" as const } satisfies SessionPayload;

function nativeModel(respond: NonNullable<ModelProviderAdapter["respond"]>): ModelProviderAdapter {
  return {
    provider: "TEST",
    modelId: "gpt-5.6-harness",
    capabilities: { vision: false },
    async complete() {
      throw new Error("V3_HARNESS_REQUIRES_NATIVE_RESPONSE");
    },
    respond,
  };
}

function confirmationActionModel() {
  return nativeModel(async () => ({
    content: "我只提出下一步，不会直接改动你的项目或软件状态；任何改变都必须先由学生确认。",
    toolCalls: [],
  }));
}

async function probe(
  caseId: "model-provider-offline" | "write-effect-requires-confirmation",
  execute: () => Promise<{ checks: Array<[boolean, string]>; observed: Record<string, string | boolean | string[]> }>,
): Promise<AgentHarnessCaseResult> {
  const started = performance.now();
  try {
    const { checks, observed } = await execute();
    const failures = checks.filter(([condition]) => !condition).map(([, failure]) => failure);
    return {
      caseId,
      passed: failures.length === 0,
      durationMs: Math.round(performance.now() - started),
      failures,
      observed,
    };
  } catch (error) {
    return {
      caseId,
      passed: false,
      durationMs: Math.round(performance.now() - started),
      failures: [`UNCAUGHT:${error instanceof Error ? error.message : String(error)}`.slice(0, 200)],
      observed: {},
    };
  }
}

export async function runRuntimeBoundaryHarnessCases(connection: DatabaseConnection) {
  connection.sqlite.prepare("DELETE FROM agent_session_summaries WHERE student_id=?").run(ACTOR.userId);
  connection.sqlite.prepare("DELETE FROM agent_student_memory WHERE student_id=?").run(ACTOR.userId);
  connection.sqlite.prepare("DELETE FROM agent_conversations WHERE student_id=?").run(ACTOR.userId);
  const offline = await probe("model-provider-offline", async () => {
    const model = nativeModel(async () => { throw new ModelServiceError("PROVIDER_STATUS"); });
    const response = await runAgentTurn(connection, ACTOR, {
      message: "我想为社区农场做一套包装，但还不知道从哪里开始。",
      context: { view: "AGENT" },
    }, { modelProviderAdapter: model });
    const rejected = /(超出课程|无法回答|不能回答)/.test(response.reply.message);
    return {
      checks: [
        [response.aiMode === "DETERMINISTIC_FALLBACK", "OFFLINE_MODEL_NOT_DEGRADED"],
        [response.coursePack.id === "general-design", "OFFLINE_MODEL_CHANGED_SCOPE"],
        [response.executionSteps.at(-1)?.kind === "DEGRADED", "OFFLINE_DEGRADE_STEP_MISSING"],
        [!rejected, "OFFLINE_DESIGN_QUESTION_REJECTED"],
      ],
      observed: {
        aiMode: response.aiMode,
        coursePackId: response.coursePack.id,
        finalStep: response.executionSteps.at(-1)?.kind ?? "NONE",
        rejected,
      },
    };
  });

  const confirmation = await probe("write-effect-requires-confirmation", async () => {
    const policy = getActiveAgentPolicy();
    const decisions = {
      writeProject: decideActionPolicy("WRITE_PROJECT", policy).mode,
      changeToolState: decideActionPolicy("CHANGE_TOOL_STATE", policy).mode,
      externalCall: decideActionPolicy("EXTERNAL_CALL", policy).mode,
      submitEvaluation: decideActionPolicy("SUBMIT_EVALUATION", policy).mode,
      formalAuthority: decideActionPolicy("FORMAL_AUTHORITY", policy).mode,
    };
    const turn = await runAgentTurn(connection, ACTOR, {
      message: "带我进入 TouchDesigner 节点工作空间继续搭建，但不要直接修改网络。",
      context: { view: "AGENT" },
    }, { modelProviderAdapter: confirmationActionModel() });
    const action = { id: randomUUID() };
    connection.sqlite.prepare(`
      INSERT INTO agent_actions(
        id,turn_id,action_sequence,type,label,adapter_id,target,focus,payload_json,status,
        effect,approval_mode,created_at,data_type
      ) VALUES(?,?,1,'OPEN_WORKSPACE','进入节点工作空间','node-canvas','NODE_CANVAS',NULL,'{}','PROPOSED',
        'NAVIGATE','REQUIRES_CONFIRMATION',?,'REAL')
    `).run(action.id, turn.turnId, Math.floor(Date.now() / 1_000));
    const before = connection.sqlite.prepare("SELECT status FROM agent_actions WHERE id=?")
      .get(action.id) as { status: string } | undefined;
    const execution = executeAgentAction(connection, ACTOR, {
      turnId: turn.turnId,
      actionId: action.id,
      idempotencyKey: randomUUID(),
    });
    const after = connection.sqlite.prepare("SELECT status FROM agent_actions WHERE id=?")
      .get(action.id) as { status: string } | undefined;
    const registeredToolPermissionsValid = listAgentTools().every(({ effect, access }) => {
      const mode = decideActionPolicy(effect, policy).mode;
      return mode === "AUTOMATIC"
        ? access === "READ_ONLY"
        : mode === "REQUIRES_CONFIRMATION"
          ? access === "STUDENT_CONFIRMATION"
          : access === "FORBIDDEN";
    });
    return {
      checks: [
        [decisions.writeProject === "REQUIRES_CONFIRMATION", "WRITE_PROJECT_NOT_WAITING_CONFIRMATION"],
        [decisions.changeToolState === "REQUIRES_CONFIRMATION", "TOOL_MUTATION_NOT_WAITING_CONFIRMATION"],
        [decisions.externalCall === "REQUIRES_CONFIRMATION", "EXTERNAL_CALL_NOT_WAITING_CONFIRMATION"],
        [decisions.submitEvaluation === "FORBIDDEN", "EVALUATION_SUBMISSION_NOT_FORBIDDEN"],
        [decisions.formalAuthority === "FORBIDDEN", "FORMAL_AUTHORITY_NOT_FORBIDDEN"],
        [registeredToolPermissionsValid, "REGISTERED_TOOL_PERMISSION_MISMATCH"],
        [before?.status === "PROPOSED", "ACTION_DID_NOT_WAIT_FOR_CONFIRMATION"],
        [execution.status === "EXECUTED" && after?.status === "EXECUTED", "CONFIRMED_ACTION_NOT_EXECUTED"],
      ],
      observed: {
        ...decisions,
        registeredToolPermissionsValid,
        beforeConfirmation: before?.status ?? "MISSING",
        afterConfirmation: after?.status ?? "MISSING",
      },
    };
  });
  return [offline, confirmation];
}

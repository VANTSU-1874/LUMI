// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ModelClient } from "@/lib/ai/client";
import { DesignAgentKernel } from "@/lib/agent/design-agent-kernel";
import { executeAgentAction } from "@/lib/agent/orchestrator-store";
import { AgentConflictError as LegacyActionConflictError } from "@/lib/agent/orchestrator-errors";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { abortActiveAgentRun, registerActiveAgentRun, unregisterActiveAgentRun } from "@/lib/agent/runtime/agent-run-abort-registry";
import { settleAgentRunApproval } from "@/lib/agent/runtime/agent-run-approval";
import {
  finalizeAgentRunCancellation,
  isAgentRunCancellationRequested,
  requestAgentRunCancellation,
  retryAgentRun,
} from "@/lib/agent/runtime/agent-run-control";
import { executeAgentRun } from "@/lib/agent/runtime/agent-run-executor";
import { recoverPendingAgentRuns } from "@/lib/agent/runtime/agent-run-recovery";
import { currentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { appendAgentRunEvent } from "@/lib/agent/runtime/agent-run-record";
import {
  AgentRunConflictError,
  AgentRunNotFoundError,
  claimAgentRun,
  completeAgentRun,
  continueAgentRun,
  createAgentRun,
  failAgentRun,
  markAgentRunTurnPersisted,
  readAgentRun,
  readAgentRunEvents,
} from "@/lib/agent/runtime/run-state-store";

const roots: string[] = [];
const actor = { userId: "student-1", role: "STUDENT" as const };
const otherActor = { userId: "student-2", role: "STUDENT" as const };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup(withKnowledge = false) {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-control-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('class-1','测试班级','RUN-CONTROL');
    INSERT INTO users(id,class_id,role,alias,created_at) VALUES
      ('student-1','class-1','STUDENT','学生一',1700000000),
      ('student-2','class-1','STUDENT','学生二',1700000000);
  `);
  if (withKnowledge) await ingestCoursePackKnowledge(connection);
  return { root, databasePath, connection };
}

function environment(databasePath: string, evidenceRoot: string) {
  return {
    NODE_ENV: "development",
    SESSION_SECRET: "agent-control-session-secret-at-least-32-characters",
    DATABASE_PATH: databasePath,
    EVIDENCE_ROOT: evidenceRoot,
    AGENT_V2_ENABLED: "true",
  };
}

function newRun(connection: ReturnType<typeof createDb>, idempotencyKey: string) {
  return createAgentRun({
    connection,
    actor,
    request: { message: "我想做一张海报", context: { view: "AGENT" } },
    idempotencyKey,
    runtime: currentAgentRuntime.descriptor,
  });
}

describe("durable agent run control", () => {
  it("cancels a queued run idempotently and retries it only once per failure generation", async () => {
    const { connection } = await setup();
    try {
      const created = newRun(connection, "queued-cancel-1");
      const cancelKey = "11111111-1111-4111-8111-111111111111";
      const cancelled = requestAgentRunCancellation({ connection, actor, runId: created.run.id, idempotencyKey: cancelKey });
      expect(cancelled).toMatchObject({ alreadyApplied: false, abortRequested: false, run: { status: "CANCELLED" } });
      expect(requestAgentRunCancellation({ connection, actor, runId: created.run.id, idempotencyKey: cancelKey }))
        .toMatchObject({ alreadyApplied: true, run: { status: "CANCELLED" } });
      expect(() => requestAgentRunCancellation({
        connection, actor, runId: created.run.id, idempotencyKey: "22222222-2222-4222-8222-222222222222",
      })).toThrow(AgentRunConflictError);
      expect(() => requestAgentRunCancellation({
        connection, actor: otherActor, runId: created.run.id, idempotencyKey: cancelKey,
      })).toThrow(AgentRunNotFoundError);

      const retryKey = "33333333-3333-4333-8333-333333333333";
      expect(retryAgentRun({ connection, actor, runId: created.run.id, idempotencyKey: retryKey }))
        .toMatchObject({ alreadyApplied: false, run: { status: "QUEUED" } });
      expect(retryAgentRun({ connection, actor, runId: created.run.id, idempotencyKey: retryKey }))
        .toMatchObject({ alreadyApplied: true, run: { status: "QUEUED" } });
      expect(connection.sqlite.prepare("SELECT kind,generation FROM agent_run_controls ORDER BY created_at,rowid").all())
        .toEqual([{ kind: "CANCEL", generation: 0 }, { kind: "RETRY", generation: 0 }]);
    } finally { connection.sqlite.close(); }
  });

  it("continues only durable learner-visible text and keeps the source run auditable", async () => {
    const { connection } = await setup();
    try {
      const source = newRun(connection, "continue-visible-text-source");
      appendAgentRunEvent(connection, { id: source.run.id, dataType: "REAL" }, {
        kind: "STEP",
        label: "理解你的问题",
        summary: "这段运行摘要不能进入续写上下文。",
        payload: { stepKind: "MODEL" },
        now: new Date("2026-07-26T12:00:00.000Z"),
      });
      appendAgentRunEvent(connection, { id: source.run.id, dataType: "REAL" }, {
        kind: "TOKEN",
        label: "组织回答",
        summary: "已收到新的回答片段。",
        payload: { text: "先把主标题放大，再补足副标题的对比度。" },
        now: new Date("2026-07-26T12:00:01.000Z"),
      });
      requestAgentRunCancellation({
        connection,
        actor,
        runId: source.run.id,
        idempotencyKey: "d1111111-1111-4111-8111-111111111111",
      });

      const continuation = continueAgentRun({
        connection,
        actor,
        runId: source.run.id,
        idempotencyKey: "d2222222-2222-4222-8222-222222222222",
        runtime: currentAgentRuntime.descriptor,
      });

      expect(continuation).toMatchObject({
        created: true,
        run: {
          status: "QUEUED",
          request: {
            continuation: {
              sourceRunId: source.run.id,
              attempt: 1,
              previousText: "先把主标题放大，再补足副标题的对比度。",
            },
          },
        },
      });
      expect(continuation.run.request?.continuation?.previousText).not.toContain("运行摘要");
      expect(continueAgentRun({
        connection,
        actor,
        runId: source.run.id,
        idempotencyKey: "d2222222-2222-4222-8222-222222222222",
        runtime: currentAgentRuntime.descriptor,
      })).toMatchObject({ created: false, run: { id: continuation.run.id } });
      expect(continueAgentRun({
        connection,
        actor,
        runId: source.run.id,
        idempotencyKey: "d3333333-3333-4333-8333-333333333333",
        runtime: currentAgentRuntime.descriptor,
      })).toMatchObject({ created: false, run: { id: continuation.run.id } });
      expect(readAgentRun(connection, actor, source.run.id)).toMatchObject({ status: "CANCELLED" });
    } finally {
      connection.sqlite.close();
    }
  });

  it("propagates an active cancellation signal and leaves no half-written turn", async () => {
    const { connection } = await setup();
    const created = newRun(connection, "running-cancel-1");
    const claim = claimAgentRun({ connection, runId: created.run.id, workerId: "worker-cancel" });
    if (claim.kind !== "CLAIMED") throw new Error("expected claim");
    const controller = registerActiveAgentRun(created.run.id, "worker-cancel");
    let modelStarted!: () => void;
    const started = new Promise<void>((resolve) => { modelStarted = resolve; });
    const slowModel: ModelClient = {
      complete(_messages, options) {
        modelStarted();
        return new Promise((_resolve, reject) => {
          const abort = () => reject(options?.signal?.reason);
          options?.signal?.addEventListener("abort", abort, { once: true });
          if (options?.signal?.aborted) abort();
        });
      },
    };
    const running = new DesignAgentKernel(connection, claim.actor, {
      modelClient: slowModel,
      signal: controller.signal,
      cancellationRequested: () => isAgentRunCancellationRequested(connection, created.run.id),
    }).run(claim.request, undefined, created.run.id);
    await started;
    const cancelKey = "44444444-4444-4444-8444-444444444444";
    expect(requestAgentRunCancellation({ connection, actor, runId: created.run.id, idempotencyKey: cancelKey }))
      .toMatchObject({ abortRequested: true, run: { status: "RUNNING" } });
    expect(abortActiveAgentRun(created.run.id)).toBe(true);
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    finalizeAgentRunCancellation({ connection, runId: created.run.id, workerId: "worker-cancel" });
    unregisterActiveAgentRun(created.run.id, "worker-cancel");
    expect(readAgentRun(connection, actor, created.run.id)).toMatchObject({ status: "CANCELLED", result: null });
    expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_turns WHERE run_id=?").get(created.run.id))
      .toEqual({ count: 0 });
    connection.sqlite.close();
  });

  it("lets only the persisted cancellation or persisted turn win the database race", async () => {
    const { connection } = await setup();
    try {
      const cancellationWins = newRun(connection, "cancel-race-wins");
      const firstClaim = claimAgentRun({ connection, runId: cancellationWins.run.id, workerId: "worker-cancel-wins" });
      if (firstClaim.kind !== "CLAIMED") throw new Error("expected claim");
      requestAgentRunCancellation({
        connection,
        actor,
        runId: cancellationWins.run.id,
        idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      });
      await expect(new DesignAgentKernel(connection, firstClaim.actor, {
        cancellationRequested: () => false,
      }).run(firstClaim.request, undefined, cancellationWins.run.id)).rejects.toBeInstanceOf(LegacyActionConflictError);
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_turns WHERE run_id=?")
        .get(cancellationWins.run.id)).toEqual({ count: 0 });
      finalizeAgentRunCancellation({
        connection,
        runId: cancellationWins.run.id,
        workerId: "worker-cancel-wins",
      });

      const persistenceWins = newRun(connection, "persist-race-wins");
      const secondClaim = claimAgentRun({ connection, runId: persistenceWins.run.id, workerId: "worker-persist-wins" });
      if (secondClaim.kind !== "CLAIMED") throw new Error("expected claim");
      const persisted = await new DesignAgentKernel(connection, secondClaim.actor)
        .run(secondClaim.request, undefined, persistenceWins.run.id);
      expect(() => requestAgentRunCancellation({
        connection,
        actor,
        runId: persistenceWins.run.id,
        idempotencyKey: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      })).toThrow(/回答已经安全保存/);
      markAgentRunTurnPersisted({
        connection,
        runId: persistenceWins.run.id,
        workerId: "worker-persist-wins",
        turnId: persisted.turnId,
      });
      expect(completeAgentRun({
        connection,
        runId: persistenceWins.run.id,
        workerId: "worker-persist-wins",
        result: persisted,
      }).status).toBe("COMPLETED");
    } finally {
      connection.sqlite.close();
    }
  });

  it("bounds retries to three total attempts and preserves each control generation", async () => {
    const { connection } = await setup();
    try {
      const created = newRun(connection, "retry-limit-1");
      const keys = [
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
        "77777777-7777-4777-8777-777777777777",
      ];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const claim = claimAgentRun({ connection, runId: created.run.id, workerId: `worker-${attempt}` });
        if (claim.kind !== "CLAIMED") throw new Error("expected claim");
        failAgentRun({ connection, runId: created.run.id, workerId: `worker-${attempt}`, errorCode: "MODEL_SERVICE_FAILED" });
        if (attempt < 3) {
          expect(retryAgentRun({ connection, actor, runId: created.run.id, idempotencyKey: keys[attempt - 1]! }).run.status)
            .toBe("QUEUED");
        }
      }
      expect(() => retryAgentRun({ connection, actor, runId: created.run.id, idempotencyKey: keys[2]! }))
        .toThrow(/最大尝试次数/);
      expect(readAgentRun(connection, actor, created.run.id)).toMatchObject({ status: "FAILED", attempt: 3 });
      expect(connection.sqlite.prepare("SELECT generation FROM agent_run_controls WHERE kind='RETRY' ORDER BY generation").all())
        .toEqual([{ generation: 1 }, { generation: 2 }]);
    } finally { connection.sqlite.close(); }
  });

  it("does not start a fourth execution after repeated lease expiry", async () => {
    const { connection } = await setup();
    try {
      const created = newRun(connection, "lease-attempt-limit-1");
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const claim = claimAgentRun({ connection, runId: created.run.id, workerId: `expired-worker-${attempt}` });
        expect(claim).toMatchObject({ kind: "CLAIMED", attempt });
        connection.sqlite.prepare("UPDATE agent_runs SET lease_expires_at=0 WHERE id=?").run(created.run.id);
      }
      const limited = claimAgentRun({ connection, runId: created.run.id, workerId: "must-not-run-fourth" });
      expect(limited).toMatchObject({
        kind: "TERMINAL",
        run: { status: "FAILED", attempt: 3, lastErrorCode: "AGENT_ATTEMPT_LIMIT" },
      });
      expect(readAgentRunEvents({ connection, actor, runId: created.run.id }).events.at(-1))
        .toMatchObject({ kind: "ERROR", payload: { errorCode: "AGENT_ATTEMPT_LIMIT", attempt: 3 } });
    } finally {
      connection.sqlite.close();
    }
  });

  it("recovers a persisted cancellation after the original worker is gone", async () => {
    const { root, databasePath, connection } = await setup();
    const created = newRun(connection, "restart-cancel-1");
    const claim = claimAgentRun({ connection, runId: created.run.id, workerId: "worker-before-restart" });
    if (claim.kind !== "CLAIMED") throw new Error("expected claim");
    requestAgentRunCancellation({
      connection,
      actor,
      runId: created.run.id,
      idempotencyKey: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    });
    connection.sqlite.prepare("UPDATE agent_runs SET lease_expires_at=0 WHERE id=?").run(created.run.id);
    connection.sqlite.close();

    expect(await recoverPendingAgentRuns(environment(databasePath, path.join(root, "evidence"))))
      .toEqual({ found: 1, recovered: 1, failed: 0 });
    const restored = createDb(databasePath);
    try {
      expect(readAgentRun(restored, actor, created.run.id))
        .toMatchObject({ status: "CANCELLED", result: null, cancelRequestedAt: expect.any(String) });
      expect(restored.sqlite.prepare("SELECT count(*) count FROM agent_turns WHERE run_id=?")
        .get(created.run.id)).toEqual({ count: 0 });
    } finally {
      restored.sqlite.close();
    }
  });

  it("completes formal-authority requests without creating an approval", async () => {
    const { root, databasePath, connection } = await setup();
    const created = createAgentRun({
      connection,
      actor,
      request: { message: "请替我正式评分并提交教师评价", context: { view: "AGENT" } },
      idempotencyKey: "formal-authority-run-1",
      runtime: currentAgentRuntime.descriptor,
    });
    connection.sqlite.close();
    expect(await executeAgentRun(created.run.id, environment(databasePath, path.join(root, "evidence"))))
      .toMatchObject({ status: "COMPLETED", result: { reply: { actions: [] } } });
  });

  it("waits durably for a registered action and settles approve or reject idempotently", async () => {
    const { root, databasePath, connection } = await setup(true);
    const first = createAgentRun({
      connection,
      actor,
      request: { message: "声音有数值了，但画面为什么还是不动？", context: { view: "NODE_CANVAS" } },
      idempotencyKey: "approval-run-1",
      runtime: currentAgentRuntime.descriptor,
    });
    connection.sqlite.close();
    const waiting = await executeAgentRun(first.run.id, environment(databasePath, path.join(root, "evidence")));
    expect(waiting).toMatchObject({ status: "WAITING_APPROVAL", result: { reply: { actions: [{ status: "PROPOSED" }] } } });
    const actionId = waiting.result!.reply.actions[0]!.id;
    const turnId = waiting.result!.turnId;
    const restored = createDb(databasePath);
    try {
      expect(() => executeAgentAction(restored, actor, {
        turnId,
        actionId,
        idempotencyKey: "legacy-action-route-must-not-bypass-durable-run",
      })).toThrow(LegacyActionConflictError);
      const approvalKey = "88888888-8888-4888-8888-888888888888";
      const approved = settleAgentRunApproval({
        connection: restored, actor, runId: first.run.id, actionId, decision: "APPROVE", idempotencyKey: approvalKey,
      });
      expect(approved).toMatchObject({
        run: { status: "COMPLETED", result: { reply: { actions: [{ id: actionId, status: "EXECUTED" }] } } },
        action: { id: actionId, status: "EXECUTED", alreadyApplied: false, navigation: { target: "PROJECT" } },
      });
      expect(settleAgentRunApproval({
        connection: restored, actor, runId: first.run.id, actionId, decision: "APPROVE", idempotencyKey: approvalKey,
      })).toMatchObject({ action: { alreadyApplied: true } });
      expect(() => settleAgentRunApproval({
        connection: restored, actor, runId: first.run.id, actionId, decision: "APPROVE",
        idempotencyKey: "99999999-9999-4999-8999-999999999999",
      })).toThrow(AgentRunConflictError);
      expect(() => settleAgentRunApproval({
        connection: restored, actor: otherActor, runId: first.run.id, actionId, decision: "APPROVE", idempotencyKey: approvalKey,
      })).toThrow(AgentRunNotFoundError);
      expect(readAgentRunEvents({ connection: restored, actor, runId: first.run.id }).events.map(({ kind }) => kind))
        .toContain("APPROVAL");
    } finally { restored.sqlite.close(); }

    const secondConnection = createDb(databasePath);
    const second = createAgentRun({
      connection: secondConnection,
      actor,
      request: { message: "声音有数值了，但画面为什么还是不动？", context: { view: "NODE_CANVAS" } },
      idempotencyKey: "approval-run-2",
      runtime: currentAgentRuntime.descriptor,
    });
    secondConnection.sqlite.close();
    const secondWaiting = await executeAgentRun(second.run.id, environment(databasePath, path.join(root, "evidence")));
    const secondActionId = secondWaiting.result!.reply.actions[0]!.id;
    const rejectConnection = createDb(databasePath);
    try {
      expect(settleAgentRunApproval({
        connection: rejectConnection,
        actor,
        runId: second.run.id,
        actionId: secondActionId,
        decision: "REJECT",
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      })).toMatchObject({
        run: { status: "COMPLETED", result: { reply: { actions: [{ status: "REJECTED" }] } } },
        action: { status: "REJECTED", navigation: null },
      });
    } finally { rejectConnection.sqlite.close(); }
  });

  it("stops a waiting approval while preserving the completed answer", async () => {
    const { root, databasePath, connection } = await setup(true);
    const created = createAgentRun({
      connection,
      actor,
      request: { message: "声音有数值了，但画面为什么还是不动？", context: { view: "NODE_CANVAS" } },
      idempotencyKey: "approval-cancel-1",
      runtime: currentAgentRuntime.descriptor,
    });
    connection.sqlite.close();
    expect((await executeAgentRun(created.run.id, environment(databasePath, path.join(root, "evidence")))).status)
      .toBe("WAITING_APPROVAL");
    const restored = createDb(databasePath);
    try {
      const cancelled = requestAgentRunCancellation({
        connection: restored,
        actor,
        runId: created.run.id,
        idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      });
      expect(cancelled).toMatchObject({
        run: { status: "COMPLETED", result: { reply: { actions: [{ status: "EXPIRED" }] } } },
        abortRequested: false,
      });
      expect(restored.sqlite.prepare("SELECT status,executed_at executedAt FROM agent_actions").get())
        .toEqual({ status: "EXPIRED", executedAt: null });
      expect(() => retryAgentRun({
        connection: restored,
        actor,
        runId: created.run.id,
        idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      })).toThrow(/只有失败或安全取消/);
    } finally { restored.sqlite.close(); }
  });
});

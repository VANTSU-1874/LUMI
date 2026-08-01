// @vitest-environment node

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DesignAgentKernel } from "@/lib/agent/design-agent-kernel";
import { executeAgentRun } from "@/lib/agent/runtime/agent-run-executor";
import { currentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import {
  AgentRunConflictError,
  AgentRunNotFoundError,
  claimAgentRun,
  completeAgentRun,
  createAgentRun,
  failAgentRun,
  markAgentRunTurnPersisted,
  readAgentRun,
  readAgentRunEvents,
} from "@/lib/agent/runtime/run-state-store";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];
const actor = { userId: "student-1", role: "STUDENT" as const };
const otherActor = { userId: "student-2", role: "STUDENT" as const };
const request = { message: "我想做一张酷一点的海报", context: { view: "AGENT" as const } };

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-run-"));
  roots.push(root);
  const databasePath = path.join(root, "agent.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('class-1','测试班级','RUN-TEST');
    INSERT INTO users(id,class_id,role,alias,created_at) VALUES
      ('student-1','class-1','STUDENT','学生一',1700000000),
      ('student-2','class-1','STUDENT','学生二',1700000000);
  `);
  return { root, databasePath, connection };
}

function environment(databasePath: string, evidenceRoot: string) {
  return {
    NODE_ENV: "development",
    SESSION_SECRET: "agent-run-test-session-secret-at-least-32-characters",
    DATABASE_PATH: databasePath,
    EVIDENCE_ROOT: evidenceRoot,
    AGENT_V2_ENABLED: "true",
  };
}

describe("durable agent run state", () => {
  it("creates an owned run idempotently and exposes append-only events", async () => {
    const { connection } = await setup();
    try {
      const first = createAgentRun({
        connection,
        actor,
        request,
        idempotencyKey: "client-request-1",
        runtime: currentAgentRuntime.descriptor,
      });
      const repeated = createAgentRun({
        connection,
        actor,
        request,
        idempotencyKey: "client-request-1",
        runtime: currentAgentRuntime.descriptor,
      });
      expect(first).toMatchObject({ created: true, run: { status: "QUEUED", attempt: 0 } });
      expect(repeated).toMatchObject({ created: false, run: { id: first.run.id } });
      expect(() => createAgentRun({
        connection,
        actor,
        request: { ...request, message: "这是另一个请求" },
        idempotencyKey: "client-request-1",
        runtime: currentAgentRuntime.descriptor,
      })).toThrow(AgentRunConflictError);
      expect(() => readAgentRun(connection, otherActor, first.run.id)).toThrow(AgentRunNotFoundError);

      const initial = readAgentRunEvents({ connection, actor, runId: first.run.id });
      expect(initial.events).toHaveLength(1);
      expect(initial.events[0]).toMatchObject({ sequence: 1, kind: "RUN_CREATED", payload: { status: "QUEUED" } });
      const claim = claimAgentRun({ connection, runId: first.run.id, workerId: "worker-1" });
      expect(claim).toMatchObject({ kind: "CLAIMED", attempt: 1 });
      const continued = readAgentRunEvents({ connection, actor, runId: first.run.id, afterSequence: 1 });
      expect(continued.events).toHaveLength(1);
      expect(continued.events[0]).toMatchObject({ sequence: 2, kind: "RUN_CLAIMED" });
    } finally {
      connection.sqlite.close();
    }
  });

  it("executes with a fresh database connection and restores the final result", async () => {
    const { root, databasePath, connection } = await setup();
    const created = createAgentRun({
      connection,
      actor,
      request,
      idempotencyKey: "background-run-1",
      runtime: currentAgentRuntime.descriptor,
    });
    connection.sqlite.close();

    const completed = await executeAgentRun(created.run.id, environment(databasePath, path.join(root, "evidence")));
    expect(completed).toMatchObject({ status: "COMPLETED", attempt: 1, result: { studentMessage: request.message } });

    const restoredConnection = createDb(databasePath);
    try {
      const restored = readAgentRun(restoredConnection, actor, created.run.id);
      expect(restored.result?.turnId).toBeTruthy();
      expect(restored.checkpoint).toEqual({ stage: "COMPLETED", turnId: restored.result?.turnId });
      expect(restoredConnection.sqlite.prepare("SELECT count(*) count FROM agent_turns WHERE run_id=?")
        .get(created.run.id)).toEqual({ count: 1 });
      expect(readAgentRunEvents({ connection: restoredConnection, actor, runId: created.run.id }).events.map(({ kind }) => kind))
        .toEqual(["RUN_CREATED", "RUN_CLAIMED", "STATUS_CHANGED", "COMPLETION"]);
    } finally {
      restoredConnection.sqlite.close();
    }
  });

  it("persists redacted protocol diagnostics for a degraded live model run", async () => {
    const { root, databasePath, connection } = await setup();
    const created = createAgentRun({
      connection,
      actor,
      request,
      idempotencyKey: "runtime-diagnostics-1",
      runtime: currentAgentRuntime.descriptor,
    });
    connection.sqlite.close();
    const privateProviderFragment = "PRIVATE_PROVIDER_FRAGMENT_MUST_NOT_PERSIST";
    vi.stubGlobal("fetch", vi.fn(async () => new Response([
      "event: response.unexpected",
      `data: {"type":"response.unexpected","private":"${privateProviderFragment}"}`,
      "",
      "event: done",
      "data: [DONE]",
      "",
      "",
    ].join("\n"), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })));
    const apiKey = "sk-runtime-diagnostics-secret-0123456789";
    const completed = await executeAgentRun(created.run.id, {
      ...environment(databasePath, path.join(root, "evidence")),
      LOCALAPPDATA: root,
      AGENT_V3_ENABLED: "true",
      LLM_BASE_URL: "https://model-runtime.invalid/v1",
      LLM_API_KEY: apiKey,
      LLM_MODEL: "gpt-5.6-sol",
      LLM_VISION_ENABLED: "true",
    });

    expect(completed).toMatchObject({
      status: "COMPLETED",
      result: { aiMode: "DETERMINISTIC_FALLBACK" },
    });
    const diagnosticRoot = path.join(root, "ChuyingAI", "diagnostics");
    const files = await readdir(diagnosticRoot);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^agent-runtime-/);
    const log = await readFile(path.join(diagnosticRoot, files[0]!), "utf8");
    const entry = JSON.parse(log) as {
      runner: string;
      caseId: string;
      outcome: string;
      errorCode: string;
      diagnostics: { modelProtocolErrorCodes: string[] };
    };
    expect(entry).toMatchObject({
      runner: "AGENT_RUNTIME",
      caseId: created.run.id,
      outcome: "DEGRADED_CONTINUED",
      errorCode: "INVALID_RESPONSE",
      diagnostics: { modelProtocolErrorCodes: ["JSON_INVALID"] },
    });
    expect(log).not.toContain(apiKey);
    expect(log).not.toContain(privateProviderFragment);
  });

  it("reuses a persisted turn after an expired lease instead of duplicating it", async () => {
    const { root, databasePath, connection } = await setup();
    const created = createAgentRun({
      connection,
      actor,
      request,
      idempotencyKey: "crash-window-1",
      runtime: currentAgentRuntime.descriptor,
    });
    const claim = claimAgentRun({ connection, runId: created.run.id, workerId: "crashed-worker" });
    expect(claim.kind).toBe("CLAIMED");
    if (claim.kind !== "CLAIMED") throw new Error("expected claim");
    const turn = await new DesignAgentKernel(connection, claim.actor).run(claim.request, undefined, created.run.id);
    expect(turn.turnId).toBeTruthy();
    connection.sqlite.prepare("UPDATE agent_runs SET lease_expires_at=0 WHERE id=?").run(created.run.id);
    connection.sqlite.close();

    const recovered = await executeAgentRun(created.run.id, environment(databasePath, path.join(root, "evidence")));
    expect(recovered).toMatchObject({ status: "COMPLETED", attempt: 1, result: { turnId: turn.turnId } });
    const restoredConnection = createDb(databasePath);
    try {
      expect(restoredConnection.sqlite.prepare("SELECT count(*) count FROM agent_turns WHERE run_id=?")
        .get(created.run.id)).toEqual({ count: 1 });
    } finally {
      restoredConnection.sqlite.close();
    }
  });

  it("finishes a claimed run only for the current lease owner", async () => {
    const { connection } = await setup();
    try {
      const created = createAgentRun({
        connection,
        actor,
        request,
        idempotencyKey: "lease-owner-1",
        runtime: currentAgentRuntime.descriptor,
      });
      const claim = claimAgentRun({ connection, runId: created.run.id, workerId: "worker-owner" });
      if (claim.kind !== "CLAIMED") throw new Error("expected claim");
      const result = await new DesignAgentKernel(connection, claim.actor).run(claim.request, undefined, created.run.id);
      expect(() => markAgentRunTurnPersisted({
        connection,
        runId: created.run.id,
        workerId: "worker-owner",
        turnId: "00000000-0000-4000-8000-000000000000",
      })).toThrow(AgentRunConflictError);
      expect(() => markAgentRunTurnPersisted({
        connection, runId: created.run.id, workerId: "other-worker", turnId: result.turnId,
      })).toThrow(AgentRunConflictError);
      markAgentRunTurnPersisted({ connection, runId: created.run.id, workerId: "worker-owner", turnId: result.turnId });
      expect(() => completeAgentRun({
        connection, runId: created.run.id, workerId: "other-worker", result,
      })).toThrow(AgentRunConflictError);
      expect(completeAgentRun({ connection, runId: created.run.id, workerId: "worker-owner", result }).status)
        .toBe("COMPLETED");
    } finally {
      connection.sqlite.close();
    }
  });

  it("fails honestly when the recorded runtime version is unavailable", async () => {
    const { root, databasePath, connection } = await setup();
    const created = createAgentRun({
      connection,
      actor,
      request,
      idempotencyKey: "unknown-runtime-1",
      runtime: { id: "future-agent-runtime", version: "9.0.0" },
    });
    connection.sqlite.close();
    const failed = await executeAgentRun(created.run.id, environment(databasePath, path.join(root, "evidence")));
    expect(failed).toMatchObject({ status: "FAILED", lastErrorCode: "AGENT_RUNTIME_UNAVAILABLE", result: null });
    const restored = createDb(databasePath);
    try {
      expect(restored.sqlite.prepare("SELECT count(*) count FROM agent_turns WHERE run_id=?")
        .get(created.run.id)).toEqual({ count: 0 });
    } finally {
      restored.sqlite.close();
    }
  });

  it("persists only a safe failure code and clears the worker lease", async () => {
    const { connection } = await setup();
    try {
      const created = createAgentRun({
        connection,
        actor,
        request,
        idempotencyKey: "safe-error-1",
        runtime: currentAgentRuntime.descriptor,
      });
      const claim = claimAgentRun({ connection, runId: created.run.id, workerId: "failed-worker" });
      if (claim.kind !== "CLAIMED") throw new Error("expected claim");
      failAgentRun({
        connection,
        runId: created.run.id,
        workerId: "failed-worker",
        errorCode: "upstream said api-key=secret",
      });
      expect(readAgentRun(connection, actor, created.run.id)).toMatchObject({
        status: "FAILED",
        lastErrorCode: "AGENT_RUN_FAILED",
        checkpoint: { stage: "FAILED" },
      });
      expect(connection.sqlite.prepare(`
        SELECT lease_owner leaseOwner, lease_expires_at leaseExpiresAt FROM agent_runs WHERE id=?
      `).get(created.run.id)).toEqual({ leaseOwner: null, leaseExpiresAt: null });
      const errorEvent = readAgentRunEvents({ connection, actor, runId: created.run.id }).events.at(-1);
      expect(errorEvent).toMatchObject({ kind: "ERROR", payload: { errorCode: "AGENT_RUN_FAILED" } });
      expect(JSON.stringify(errorEvent)).not.toContain("secret");
      expect(() => connection.sqlite.prepare(
        "UPDATE agent_runs SET last_error_code='BAD CODE' WHERE id=?",
      ).run(created.run.id)).toThrow();
    } finally {
      connection.sqlite.close();
    }
  });
});

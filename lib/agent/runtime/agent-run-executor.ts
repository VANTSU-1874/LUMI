import { randomUUID } from "node:crypto";

import { ModelServiceError } from "@/lib/ai/client";
import {
  createLocalModelErrorDiagnosticLog,
  createModelErrorDiagnostics,
  type ModelErrorDiagnosticLogEntry,
} from "@/lib/agent/model-error-diagnostics";
import {
  discardStagedAgentRunArtwork,
  loadStagedAgentRunArtwork,
} from "../artwork-attachment";
import { DesignAgentKernel } from "../design-agent-kernel";
import { generateFirstTurnDesignTaskTitle } from "../design-task-title";
import { readEnv } from "@/lib/config/env";
import { createDb } from "@/lib/db/client";
import { getActiveAgentPolicy, resolveAgentPolicyTimeouts } from "../policy-registry";
import { currentAgentRuntime } from "./current-agent-runtime";
import { registerActiveAgentRun, unregisterActiveAgentRun } from "./agent-run-abort-registry";
import { readAgentRunRow } from "./agent-run-record";
import { createAgentRunStreamReporter } from "./agent-run-stream-reporter";
import {
  finalizeAgentRunCancellation,
  isAgentRunCancellationRequested,
} from "./agent-run-control";
import { waitForAgentApproval } from "./agent-run-approval";
import {
  AgentRunConflictError,
  claimAgentRun,
  completeAgentRun,
  deleteAgentRunArtworkInput,
  failAgentRun,
  markAgentRunTurnPersisted,
  readAgentRun,
  readAgentRunArtworkInput,
  readPersistedTurnForRun,
} from "./run-state-store";

type RuntimeEnvironment = Record<string, string | undefined>;

function safeExecutionErrorCode(error: unknown) {
  if (error instanceof AgentRunConflictError) return "AGENT_RUN_LEASE_CONFLICT";
  const name = error instanceof Error ? error.name : "UnknownError";
  if (name === "AbortError") return "MODEL_REQUEST_ABORTED";
  if (name === "ModelServiceError") return "MODEL_SERVICE_FAILED";
  if (name === "AgentConflictError") return "AGENT_STATE_CONFLICT";
  if (name === "DesignTaskArchivedError") return "DESIGN_TASK_ARCHIVED";
  if (name === "DesignTaskNotFoundError") return "DESIGN_TASK_NOT_FOUND";
  if (name === "AgentRuntimeUnavailableError") return "AGENT_RUNTIME_UNAVAILABLE";
  return "AGENT_RUN_EXECUTION_FAILED";
}

async function clearPersistedRunArtwork(
  connection: ReturnType<typeof createDb>,
  artworkRoot: string,
  runId: string,
) {
  const artwork = readAgentRunArtworkInput(connection, runId);
  if (!artwork) return;
  await discardStagedAgentRunArtwork(artworkRoot, artwork);
  deleteAgentRunArtworkInput(connection, runId);
}

export async function executeAgentRun(
  runId: string,
  environment: RuntimeEnvironment = process.env,
) {
  const config = readEnv(environment);
  const connection = createDb(config.databasePath);
  const workerId = `worker:${randomUUID()}`;
  const modelDiagnostics = createModelErrorDiagnostics({
    redactValues: [config.ai.apiKey, config.ai.baseUrl],
  });
  const modelDiagnosticLog = createLocalModelErrorDiagnosticLog({
    runner: "agent-runtime",
    environment,
  });
  let claimed = false;
  let actor: { userId: string; role: "STUDENT" } | undefined;
  let firstMessage: string | undefined;
  let controller: AbortController | undefined;
  let streamReporter: ReturnType<typeof createAgentRunStreamReporter> | undefined;
  let diagnosticOutcome: ModelErrorDiagnosticLogEntry["outcome"] = "INTERRUPTED";
  let diagnosticErrorCode: string | null = null;
  const generateTitle = async (taskId: string | undefined) => {
    if (!taskId || !firstMessage) return;
    await generateFirstTurnDesignTaskTitle({
      connection,
      taskId,
      firstMessage,
      ai: config.ai,
      timeouts: config.agentTimeouts.online,
    });
  };
  try {
    const claim = claimAgentRun({ connection, runId, workerId });
    if (claim.kind !== "CLAIMED") return claim.run;
    claimed = true;
    actor = claim.actor;
    firstMessage = claim.request.message;
    const runRow = readAgentRunRow(connection, runId);
    if (!runRow) throw new AgentRunConflictError("运行记录在执行前消失");
    streamReporter = createAgentRunStreamReporter({ connection, row: runRow });
    controller = registerActiveAgentRun(runId, workerId);
    if (isAgentRunCancellationRequested(connection, runId)) {
      controller.abort(new DOMException("Agent run cancelled", "AbortError"));
    }
    if (
      claim.runtime.id !== currentAgentRuntime.descriptor.id
      || claim.runtime.version !== currentAgentRuntime.descriptor.version
    ) {
      const error = new Error("Recorded agent runtime is unavailable");
      error.name = "AgentRuntimeUnavailableError";
      throw error;
    }

    const persisted = readPersistedTurnForRun(connection, runId);
    if (persisted) {
      markAgentRunTurnPersisted({ connection, runId, workerId, turnId: persisted.turnId });
      await clearPersistedRunArtwork(connection, config.evidenceRoot, runId);
      const waiting = waitForAgentApproval({ connection, runId, workerId, result: persisted });
      if (waiting) {
        await generateTitle(persisted.taskId);
        return waiting;
      }
      const completed = completeAgentRun({ connection, runId, workerId, result: persisted });
      await generateTitle(persisted.taskId);
      return completed;
    }

    const stagedArtwork = readAgentRunArtworkInput(connection, runId);
    const artwork = stagedArtwork
      ? await loadStagedAgentRunArtwork(config.evidenceRoot, stagedArtwork)
      : undefined;
    const result = await new DesignAgentKernel(connection, claim.actor, {
      ai: config.ai,
      artworkRoot: config.evidenceRoot,
      policy: resolveAgentPolicyTimeouts(
        getActiveAgentPolicy(),
        config.agentTimeouts.online,
      ),
      signal: controller.signal,
      cancellationRequested: () => isAgentRunCancellationRequested(connection, runId),
      onTextDelta: streamReporter.onTextDelta,
      onModelActivity: streamReporter.onModelActivity,
      onToolProgress: streamReporter.onToolProgress,
      onModelError(error) {
        modelDiagnostics.record(error);
        if (error instanceof ModelServiceError) diagnosticErrorCode = error.code;
      },
    }).run(claim.request, artwork, runId);
    diagnosticOutcome = result.aiMode === "MODEL_ASSISTED"
      ? "RECOVERED"
      : "DEGRADED_CONTINUED";
    streamReporter.flush();
    markAgentRunTurnPersisted({ connection, runId, workerId, turnId: result.turnId });
    await clearPersistedRunArtwork(connection, config.evidenceRoot, runId);
    const waiting = waitForAgentApproval({ connection, runId, workerId, result });
    if (waiting) {
      await generateTitle(result.taskId);
      return waiting;
    }
    const completed = completeAgentRun({ connection, runId, workerId, result });
    await generateTitle(result.taskId);
    return completed;
  } catch (error) {
    if (!diagnosticErrorCode && error instanceof ModelServiceError) {
      diagnosticErrorCode = error.code;
    }
    streamReporter?.flush();
    if (claimed) {
      const persisted = readPersistedTurnForRun(connection, runId);
      if (persisted) {
        try {
          markAgentRunTurnPersisted({ connection, runId, workerId, turnId: persisted.turnId });
          await clearPersistedRunArtwork(connection, config.evidenceRoot, runId);
          const waiting = waitForAgentApproval({ connection, runId, workerId, result: persisted });
          if (waiting) {
            await generateTitle(persisted.taskId);
            return waiting;
          }
          const completed = completeAgentRun({ connection, runId, workerId, result: persisted });
          await generateTitle(persisted.taskId);
          return completed;
        } catch {
          // Another lease owner may already have recovered the same durable turn.
        }
      }
      try {
        if (isAgentRunCancellationRequested(connection, runId)) {
          finalizeAgentRunCancellation({ connection, runId, workerId });
          if (actor) return readAgentRun(connection, actor, runId);
        }
        failAgentRun({ connection, runId, workerId, errorCode: safeExecutionErrorCode(error) });
        if (actor) return readAgentRun(connection, actor, runId);
      } catch {
        // A lost lease or terminal transition must not be overwritten by this worker.
      }
    }
    throw error;
  } finally {
    streamReporter?.flush();
    unregisterActiveAgentRun(runId, workerId);
    connection.sqlite.close();
    await modelDiagnosticLog.append({
      recordedAt: new Date().toISOString(),
      runner: "AGENT_RUNTIME",
      stage: "RUN_AGENT_TURN",
      caseId: runId,
      outcome: diagnosticOutcome,
      errorCode: diagnosticErrorCode,
      requestMode: "AGENT_STREAMING",
      diagnostics: modelDiagnostics.snapshot(),
    });
  }
}

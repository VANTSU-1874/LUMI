import { createHash, randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, studentAwareForbiddenPayload, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { parseAgentTurnRequest } from "@/lib/agent/artwork-request";
import {
  discardStagedAgentRunArtwork,
  stageAgentRunArtwork,
  type StagedAgentRunArtwork,
} from "@/lib/agent/artwork-attachment";
import {
  DesignTaskArchivedError,
  DesignTaskForbiddenError,
  DesignTaskNotFoundError,
  resolveActiveDesignTask,
} from "@/lib/agent/design-project-task";
import {
  AgentMessageConflictError,
  appendStudentAgentMessage,
} from "@/lib/agent/agent-message-store";
import { currentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { AgentRunConflictError, createAgentRun } from "@/lib/agent/runtime/run-state-store";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { ImageTooLargeError, InvalidImageError } from "@/lib/security/uploads";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function normalMessageId(studentId: string, idempotencyKey: string) {
  const digest = createHash("sha256")
    .update(`${studentId}:${idempotencyKey}`, "utf8")
    .digest("hex");
  return `normal:${digest}`;
}

export type ScheduleAgentRun = (runId: string) => void;

export async function createAgentRunResponse(
  request: NextRequest,
  schedule: ScheduleAgentRun,
) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  let stagedArtwork: StagedAgentRunArtwork | undefined;
  let evidenceRoot: string | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    evidenceRoot = config.evidenceRoot;
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const session = await requireStudentSession(request, config.sessionSecret);
    const { input, artwork } = await parseAgentTurnRequest(request);
    if (artwork) stagedArtwork = await stageAgentRunArtwork(config.evidenceRoot, artwork);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || randomUUID();
    const clientMessageId = input.clientMessageId
      ?? normalMessageId(session.userId, idempotencyKey);
    connection = createDb(config.databasePath);
    const result = connection.sqlite.transaction(() => {
      const active = resolveActiveDesignTask(connection!, session, input.taskId);
      const inputWithMessageId = {
        ...input,
        taskId: active.task.id,
        clientMessageId,
      };
      appendStudentAgentMessage({
        connection: connection!,
        actor: session,
        taskId: active.task.id,
        message: {
          id: inputWithMessageId.clientMessageId,
          content: inputWithMessageId.message,
          ...(inputWithMessageId.capability
            ? { capability: inputWithMessageId.capability }
            : {}),
        },
      });
      return createAgentRun({
        connection: connection!,
        actor: session,
        request: inputWithMessageId,
        idempotencyKey,
        runtime: currentAgentRuntime.descriptor,
        artwork: stagedArtwork,
      });
    }).immediate();
    if (!result.created && stagedArtwork) {
      await discardStagedAgentRunArtwork(config.evidenceRoot, stagedArtwork);
    }
    stagedArtwork = undefined;
    if (["QUEUED", "RUNNING"].includes(result.run.status)) {
      schedule(result.run.id);
    }
    return NextResponse.json({
      ...result,
      interventionsEnabled: config.agentInterventionsEnabled,
    }, {
      status: result.run.status === "COMPLETED" ? 200 : 202,
      headers: { ...HEADERS, Location: `/api/agent/runs/${result.run.id}` },
    });
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof z.ZodError) return NextResponse.json({ error: "运行请求无效" }, { status: 400, headers: HEADERS });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
    if (error instanceof ImageTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
    if (error instanceof InvalidImageError) return NextResponse.json({ error: error.message }, { status: 400, headers: HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof DesignTaskForbiddenError) {
      return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
    }
    if (error instanceof DesignTaskNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    if (
      error instanceof DesignTaskArchivedError
      || error instanceof AgentRunConflictError
      || error instanceof AgentMessageConflictError
    ) {
      return NextResponse.json({ error: error.message }, { status: 409, headers: HEADERS });
    }
    console.error({ requestId, route: "agent-runs-create", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法启动智能体运行" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
    if (stagedArtwork && evidenceRoot) await discardStagedAgentRunArtwork(evidenceRoot, stagedArtwork);
  }
}

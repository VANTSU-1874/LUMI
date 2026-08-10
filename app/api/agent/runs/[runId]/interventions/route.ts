import { randomUUID } from "node:crypto";

import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  BadRequestError,
  ForbiddenRequestError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import {
  requireStudentSession,
  studentAwareForbiddenPayload,
  StudentRoleForbiddenError,
  StudentSessionRequiredError,
} from "@/lib/auth/project-session";
import {
  parseLimitedRequestBody,
  validateRequestProtocol,
  validateRequestSource,
} from "@/lib/auth/route-handler";
import { abortActiveAgentRun } from "@/lib/agent/runtime/agent-run-abort-registry";
import {
  isAgentRunCancellationRequested,
  requestAgentRunCancellation,
} from "@/lib/agent/runtime/agent-run-control";
import { executeAgentRun } from "@/lib/agent/runtime/agent-run-executor";
import {
  AgentRunInterventionConflictError,
  AgentRunInterventionCreateResponseSchema,
  AgentRunInterventionNotFoundError,
  AgentRunInterventionRequestSchema,
  createAgentRunIntervention,
  downgradeLateAgentRunSteer,
  listAgentRunInterventionsForSourceRun,
} from "@/lib/agent/runtime/agent-run-intervention";
import { readReadyAgentRunSuccessor } from "@/lib/agent/runtime/agent-run-intervention-record";
import {
  AgentRunConflictError,
  AgentRunNotFoundError,
} from "@/lib/agent/runtime/run-state-store";
import { currentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const ParamsSchema = z.object({ runId: z.string().uuid() }).strict();

function featureUnavailable() {
  return NextResponse.json(
    { error: "运行中补充暂未启用" },
    { status: 404, headers: HEADERS },
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled || !config.agentInterventionsEnabled) {
      return featureUnavailable();
    }
    const actor = await requireStudentSession(request, config.sessionSecret);
    const { runId } = ParamsSchema.parse(await context.params);
    connection = createDb(config.databasePath);
    return NextResponse.json(
      listAgentRunInterventionsForSourceRun(connection, actor, runId),
      { headers: HEADERS },
    );
  } catch (error) {
    return interventionErrorResponse(error, "agent-run-interventions-list");
  } finally {
    connection?.sqlite.close();
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled || !config.agentInterventionsEnabled) {
      return featureUnavailable();
    }
    const actor = await requireStudentSession(request, config.sessionSecret);
    const { runId } = ParamsSchema.parse(await context.params);
    const body = await parseLimitedRequestBody(
      request,
      AgentRunInterventionRequestSchema,
      8 * 1024,
    );
    const idempotencyKey = request.headers.get("idempotency-key")?.trim()
      || randomUUID();
    connection = createDb(config.databasePath);
    const created = createAgentRunIntervention({
      connection,
      actor,
      sourceRunId: runId,
      request: body,
      idempotencyKey,
      runtime: currentAgentRuntime.descriptor,
    });
    let intervention = created.intervention;
    if (created.steerShouldCancel) {
      try {
        const cancellation = requestAgentRunCancellation({
          connection,
          actor,
          runId,
          idempotencyKey,
        });
        if (cancellation.abortRequested) abortActiveAgentRun(runId);
      } catch (error) {
        if (
          !(error instanceof AgentRunConflictError)
          || isAgentRunCancellationRequested(connection, runId)
        ) {
          if (error instanceof AgentRunConflictError) {
            abortActiveAgentRun(runId);
          } else {
            throw error;
          }
        } else {
          intervention = downgradeLateAgentRunSteer({
            connection,
            actor,
            interventionId: created.intervention.id,
          });
        }
      }
    }
    const readyRunId = readReadyAgentRunSuccessor(connection, runId);
    if (readyRunId) after(() => executeAgentRun(readyRunId));
    const response = AgentRunInterventionCreateResponseSchema.parse({
      ...created,
      intervention,
      steerShouldCancel: intervention.actualMode === "STEER",
    });
    return NextResponse.json(response, {
      status: 202,
      headers: {
        ...HEADERS,
        Location: `/api/agent/runs/${response.nextRun.id}`,
      },
    });
  } catch (error) {
    return interventionErrorResponse(error, "agent-run-interventions-create");
  } finally {
    connection?.sqlite.close();
  }
}

function interventionErrorResponse(error: unknown, route: string) {
  if (error instanceof BadRequestError || error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "补充消息请求无效" },
      { status: 400, headers: HEADERS },
    );
  }
  if (error instanceof PayloadTooLargeError) {
    return NextResponse.json(
      { error: error.message },
      { status: 413, headers: HEADERS },
    );
  }
  if (error instanceof UnsupportedMediaTypeError) {
    return NextResponse.json(
      { error: error.message },
      { status: 415, headers: HEADERS },
    );
  }
  if (error instanceof StudentSessionRequiredError) {
    return NextResponse.json(
      { error: error.message },
      { status: 401, headers: HEADERS },
    );
  }
  if (
    error instanceof StudentRoleForbiddenError
    || error instanceof ForbiddenRequestError
  ) {
    return NextResponse.json(
      studentAwareForbiddenPayload(error),
      { status: 403, headers: HEADERS },
    );
  }
  if (
    error instanceof AgentRunNotFoundError
    || error instanceof AgentRunInterventionNotFoundError
  ) {
    return NextResponse.json(
      { error: error.message },
      { status: 404, headers: HEADERS },
    );
  }
  if (
    error instanceof AgentRunConflictError
    || error instanceof AgentRunInterventionConflictError
  ) {
    return NextResponse.json(
      { error: error.message },
      { status: 409, headers: HEADERS },
    );
  }
  console.error({
    requestId: randomUUID(),
    route,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    { error: "暂时无法保存补充消息" },
    { status: 500, headers: HEADERS },
  );
}

import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  BadRequestError,
  ForbiddenRequestError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import {
  requireStudentSession,
  StudentRoleForbiddenError,
  StudentSessionRequiredError,
} from "@/lib/auth/project-session";
import {
  parseLimitedRequestBody,
  validateRequestProtocol,
  validateRequestSource,
} from "@/lib/auth/route-handler";
import { AgentMessageAppendRequestSchema } from "@/lib/agent/agent-message-contract";
import {
  AgentMessageConflictError,
  appendStudentAgentMessage,
  listStudentAgentMessages,
} from "@/lib/agent/agent-message-store";
import {
  DesignTaskForbiddenError,
  DesignTaskNotFoundError,
} from "@/lib/agent/design-project-task";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";

type RouteContext = { params: Promise<{ taskId: string }> };
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function messageRouteError(error: unknown, requestId: string, route: string) {
  if (error instanceof BadRequestError || error instanceof z.ZodError) {
    return NextResponse.json({ error: "消息信息无效" }, { status: 400, headers: HEADERS });
  }
  if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
  if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
  if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
  if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof DesignTaskForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403, headers: HEADERS });
  }
  if (error instanceof DesignTaskNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
  if (error instanceof AgentMessageConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers: HEADERS });
  console.error({ requestId, route, errorName: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "消息暂时不可用" }, { status: 500, headers: HEADERS });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const actor = await requireStudentSession(request, config.sessionSecret);
    const taskId = z.string().uuid().parse((await context.params).taskId);
    connection = createDb(config.databasePath);
    return NextResponse.json(listStudentAgentMessages(connection, actor, taskId), { headers: HEADERS });
  } catch (error) {
    return messageRouteError(error, requestId, "agent-messages-list");
  } finally { connection?.sqlite.close(); }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const actor = await requireStudentSession(request, config.sessionSecret);
    const taskId = z.string().uuid().parse((await context.params).taskId);
    const message = await parseLimitedRequestBody(request, AgentMessageAppendRequestSchema, 8 * 1024);
    connection = createDb(config.databasePath);
    const result = appendStudentAgentMessage({
      connection,
      actor,
      taskId,
      message,
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200, headers: HEADERS });
  } catch (error) {
    return messageRouteError(error, requestId, "agent-messages-append");
  } finally { connection?.sqlite.close(); }
}

import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, studentAwareForbiddenPayload, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { parseLimitedRequestBody, validateRequestProtocol, validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import {
  DesignTaskForbiddenError,
  DesignTaskNotFoundError,
  DesignTaskUpdateRequestSchema,
  deleteDesignTask,
  readDesignTask,
  updateDesignTask,
} from "@/lib/agent/design-project-task";

type RouteContext = { params: Promise<{ taskId: string }> };
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function taskRouteError(error: unknown, requestId: string, route: string) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: "任务信息无效" }, { status: 400, headers: HEADERS });
  if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
  if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof DesignTaskForbiddenError) {
    return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
  }
  if (error instanceof DesignTaskNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
  console.error({ requestId, route, errorName: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "设计任务暂时不可用" }, { status: 500, headers: HEADERS });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const session = await requireStudentSession(request, config.sessionSecret);
    const taskId = z.string().uuid().parse((await context.params).taskId);
    connection = createDb(config.databasePath);
    return NextResponse.json(readDesignTask(connection, session, taskId).task, { headers: HEADERS });
  } catch (error) {
    return taskRouteError(error, requestId, "agent-task-read");
  } finally { connection?.sqlite.close(); }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const session = await requireStudentSession(request, config.sessionSecret);
    const taskId = z.string().uuid().parse((await context.params).taskId);
    connection = createDb(config.databasePath);
    return NextResponse.json({ deleted: deleteDesignTask(connection, session, taskId) }, { headers: HEADERS });
  } catch (error) {
    return taskRouteError(error, requestId, "agent-task-delete");
  } finally { connection?.sqlite.close(); }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const session = await requireStudentSession(request, config.sessionSecret);
    const input = await parseLimitedRequestBody(request, DesignTaskUpdateRequestSchema, 4 * 1024);
    const taskId = z.string().uuid().parse((await context.params).taskId);
    connection = createDb(config.databasePath);
    return NextResponse.json(updateDesignTask(connection, session, taskId, input), { headers: HEADERS });
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof z.ZodError) return NextResponse.json({ error: "任务信息无效" }, { status: 400, headers: HEADERS });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof DesignTaskForbiddenError) {
      return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
    }
    if (error instanceof DesignTaskNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    console.error({ requestId, route: "agent-task-update", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法更新设计任务" }, { status: 500, headers: HEADERS });
  } finally { connection?.sqlite.close(); }
}

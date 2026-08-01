import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, studentAwareForbiddenPayload, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { parseLimitedRequestBody, validateRequestProtocol, validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import {
  createDesignTask,
  DesignTaskCreateRequestSchema,
  DesignTaskForbiddenError,
  DesignTaskNotFoundError,
  listDesignTasks,
} from "@/lib/agent/design-project-task";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const session = await requireStudentSession(request, config.sessionSecret);
    connection = createDb(config.databasePath);
    return NextResponse.json(listDesignTasks(connection, session), { headers: HEADERS });
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof DesignTaskForbiddenError) {
      return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
    }
    if (error instanceof DesignTaskNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    console.error({ requestId, route: "agent-tasks-list", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "设计任务暂时不可用" }, { status: 500, headers: HEADERS });
  } finally { connection?.sqlite.close(); }
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const session = await requireStudentSession(request, config.sessionSecret);
    const input = await parseLimitedRequestBody(request, DesignTaskCreateRequestSchema, 4 * 1024);
    connection = createDb(config.databasePath);
    return NextResponse.json(createDesignTask(connection, session, input), { status: 201, headers: HEADERS });
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof z.ZodError) return NextResponse.json({ error: "任务信息无效" }, { status: 400, headers: HEADERS });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof DesignTaskForbiddenError) {
      return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
    }
    if (error instanceof DesignTaskNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    console.error({ requestId, route: "agent-tasks-create", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法新建设计任务" }, { status: 500, headers: HEADERS });
  } finally { connection?.sqlite.close(); }
}

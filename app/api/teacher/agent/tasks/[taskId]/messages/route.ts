import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { validateRequestSource } from "@/lib/auth/route-handler";
import {
  requireTeacherSession,
  TeacherRoleForbiddenError,
  TeacherSessionRequiredError,
} from "@/lib/auth/teacher-session";
import {
  AgentMessageConflictError,
  listTeacherAgentMessages,
} from "@/lib/agent/agent-message-store";
import {
  DesignTaskForbiddenError,
  DesignTaskNotFoundError,
} from "@/lib/agent/design-project-task";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";

type RouteContext = { params: Promise<{ taskId: string }> };
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const actor = await requireTeacherSession(request, config.sessionSecret);
    const taskId = z.string().uuid().parse((await context.params).taskId);
    connection = createDb(config.databasePath);
    return NextResponse.json(listTeacherAgentMessages(connection, actor, taskId), { headers: HEADERS });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "任务信息无效" }, { status: 400, headers: HEADERS });
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof DesignTaskForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403, headers: HEADERS });
    }
    if (error instanceof DesignTaskNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    if (error instanceof AgentMessageConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers: HEADERS });
    console.error({ requestId, route: "teacher-agent-messages-list", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "消息暂时不可用" }, { status: 500, headers: HEADERS });
  } finally { connection?.sqlite.close(); }
}

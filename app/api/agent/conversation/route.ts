import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { requireStudentSession, studentAwareForbiddenPayload, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { AgentTurnRequestSchema, AgentViewSchema } from "@/lib/agent/contracts";
import { DesignTaskArchivedError, DesignTaskForbiddenError, DesignTaskNotFoundError } from "@/lib/agent/design-project-task";
import { AgentForbiddenError, AgentNotFoundError, readAgentConversation } from "@/lib/agent/orchestrator";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const session = await requireStudentSession(request, config.sessionSecret);
    const view = AgentViewSchema.catch("AGENT").parse(request.nextUrl.searchParams.get("view") ?? "AGENT");
    const rawTaskId = request.nextUrl.searchParams.get("taskId") ?? undefined;
    const parsedTaskId = AgentTurnRequestSchema.shape.taskId.safeParse(rawTaskId);
    if (!parsedTaskId.success) return NextResponse.json({ error: "设计任务参数无效" }, { status: 400, headers: HEADERS });
    connection = createDb(config.databasePath);
    const conversation = readAgentConversation(connection, session, view, parsedTaskId.data);
    return NextResponse.json({
      ...conversation,
      features: { externalSearch: config.agentV3Enabled },
    }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof AgentForbiddenError) return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
    if (error instanceof AgentNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    if (error instanceof DesignTaskForbiddenError) return NextResponse.json({ error: error.message }, { status: 403, headers: HEADERS });
    if (error instanceof DesignTaskNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    if (error instanceof DesignTaskArchivedError) return NextResponse.json({ error: error.message }, { status: 409, headers: HEADERS });
    console.error({ requestId, route: "agent-conversation", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "智能体会话暂时不可用" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

import { randomUUID } from "node:crypto";

import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { requireStudentSession, studentAwareForbiddenPayload, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { DesignTaskArchivedError, DesignTaskForbiddenError, DesignTaskNotFoundError } from "@/lib/agent/design-project-task";
import { createAgentRunResponse, type ScheduleAgentRun } from "@/lib/agent/runtime/create-agent-run-response";
import { executeAgentRun } from "@/lib/agent/runtime/agent-run-executor";
import { readCurrentAgentRun } from "@/lib/agent/runtime/run-state-store";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const QuerySchema = z.object({ taskId: z.string().uuid().optional() }).strict();

const scheduleAfterResponse: ScheduleAgentRun = (runId) => {
  after(() => executeAgentRun(runId));
};

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const session = await requireStudentSession(request, config.sessionSecret);
    const query = QuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    connection = createDb(config.databasePath);
    return NextResponse.json({
      ...readCurrentAgentRun(connection, session, query.taskId),
      interventionsEnabled: config.agentInterventionsEnabled,
    }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "运行参数无效" }, { status: 400, headers: HEADERS });
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof DesignTaskForbiddenError) {
      return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
    }
    if (error instanceof DesignTaskNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    if (error instanceof DesignTaskArchivedError) return NextResponse.json({ error: error.message }, { status: 409, headers: HEADERS });
    console.error({ requestId, route: "agent-runs-current", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法恢复当前运行" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

export function POST(request: NextRequest) {
  return createAgentRunResponse(request, scheduleAfterResponse);
}

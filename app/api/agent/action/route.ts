import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, studentAwareForbiddenPayload, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { AgentActionRequestSchema } from "@/lib/agent/contracts";
import { AgentConflictError, AgentForbiddenError, AgentNotFoundError, executeAgentAction } from "@/lib/agent/orchestrator";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const session = await requireStudentSession(request, config.sessionSecret);
    const input = await parseLimitedRequestBody(request, AgentActionRequestSchema, 8 * 1024);
    connection = createDb(config.databasePath);
    return NextResponse.json(executeAgentAction(connection, session, input), { headers: HEADERS });
  } catch (error) {
    if (error instanceof BadRequestError) return NextResponse.json({ error: error.message }, { status: 400, headers: HEADERS });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof AgentForbiddenError) return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
    if (error instanceof AgentNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    if (error instanceof AgentConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers: HEADERS });
    console.error({ requestId, route: "agent-action", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "行动暂时无法执行" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

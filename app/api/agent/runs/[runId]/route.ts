import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { requireStudentSession, studentAwareForbiddenPayload, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { AgentRunNotFoundError, readAgentRun } from "@/lib/agent/runtime/run-state-store";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const ParamsSchema = z.object({ runId: z.string().uuid() }).strict();

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const session = await requireStudentSession(request, config.sessionSecret);
    const { runId } = ParamsSchema.parse(await context.params);
    connection = createDb(config.databasePath);
    return NextResponse.json({ run: readAgentRun(connection, session, runId) }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "运行参数无效" }, { status: 400, headers: HEADERS });
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError) {
      return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
    }
    if (error instanceof AgentRunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    console.error({ requestId, route: "agent-run-read", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法读取运行状态" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

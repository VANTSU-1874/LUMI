import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import {
  requireStudentSession,
  studentAwareForbiddenPayload,
  StudentRoleForbiddenError,
  StudentSessionRequiredError,
} from "@/lib/auth/project-session";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import {
  AgentCritiqueNotFoundError,
  readOwnedAgentCritique,
} from "@/lib/agent/critique-store";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const TurnIdSchema = z.string().uuid();
type RouteContext = { params: Promise<{ turnId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) {
      return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    }
    const actor = await requireStudentSession(request, config.sessionSecret);
    const parsedTurnId = TurnIdSchema.safeParse((await context.params).turnId);
    if (!parsedTurnId.success) {
      return NextResponse.json({ error: "会诊记录不存在" }, { status: 404, headers: HEADERS });
    }
    connection = createDb(config.databasePath);
    const critique = readOwnedAgentCritique(connection, actor, parsedTurnId.data);
    return NextResponse.json({ critique }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    }
    if (
      error instanceof StudentRoleForbiddenError
      || error instanceof ForbiddenRequestError
    ) {
      return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
    }
    if (error instanceof AgentCritiqueNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    }
    console.error({
      requestId,
      route: "agent-critique-get",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "会诊记录暂时不可用" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

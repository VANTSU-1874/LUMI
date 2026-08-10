import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { retryAgentRun } from "@/lib/agent/runtime/agent-run-control";
import { AgentRunConflictError, AgentRunNotFoundError } from "@/lib/agent/runtime/run-state-store";
import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, studentAwareForbiddenPayload, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const ParamsSchema = z.object({ runId: z.string().uuid() }).strict();
const BodySchema = z.object({ idempotencyKey: z.string().uuid() }).strict();

export type ScheduleAgentRun = (runId: string) => void;

export async function createAgentRunRetryResponse(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
  schedule: ScheduleAgentRun,
) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const actor = await requireStudentSession(request, config.sessionSecret);
    const { runId } = ParamsSchema.parse(await context.params);
    const input = await parseLimitedRequestBody(request, BodySchema, 4 * 1024);
    connection = createDb(config.databasePath);
    const result = retryAgentRun({ connection, actor, runId, ...input });
    if (!result.alreadyApplied && result.run.status === "QUEUED") schedule(runId);
    return NextResponse.json(result, { status: 202, headers: { ...HEADERS, Location: `/api/agent/runs/${runId}` } });
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof z.ZodError) return NextResponse.json({ error: "重试请求无效" }, { status: 400, headers: HEADERS });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
    if (error instanceof AgentRunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    if (error instanceof AgentRunConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers: HEADERS });
    console.error({ requestId, route: "agent-run-retry", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法重试运行" }, { status: 500, headers: HEADERS });
  } finally { connection?.sqlite.close(); }
}

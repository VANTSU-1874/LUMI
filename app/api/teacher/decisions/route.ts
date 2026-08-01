import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, RateLimitedError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { resolveTrustedSource } from "@/lib/auth/trusted-source";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { TeacherDecisionInputSchema } from "@/lib/domain/teacher";
import { consumeActionRateLimit, createActionRateLimitKey } from "@/lib/services/action-rate-limit";
import { appendTeacherDecision, TeacherDecisionForbiddenError, TeacherDecisionNotFoundError, TeacherDecisionRequestConflictError, TeacherDecisionRevisionConflictError } from "@/lib/services/teacher-decisions";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    connection = createDb(config.databasePath);
    const source = resolveTrustedSource(request.headers, { nodeEnv: process.env.NODE_ENV, secret: config.authProxySecret });
    consumeActionRateLimit(connection.db, createActionRateLimitKey(source.id, session.userId, "teacher", "teacher-decision"), { maxRequests: 30, windowSeconds: 60 });
    const input = await parseLimitedRequestBody(request, TeacherDecisionInputSchema, 16 * 1024);
    return NextResponse.json(appendTeacherDecision(connection.db, session, input), { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherDecisionForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherDecisionNotFoundError) return NextResponse.json({ error: "对象不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherDecisionRevisionConflictError) return NextResponse.json({ error: "原结果已更新，请刷新后再决定" }, { status: 409, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherDecisionRequestConflictError) return NextResponse.json({ error: "请求标识已用于其他决定" }, { status: 409, headers: PRIVATE_HEADERS });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: PRIVATE_HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: PRIVATE_HEADERS });
    if (error instanceof RateLimitedError) return NextResponse.json({ error: error.message }, { status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof BadRequestError || error instanceof z.ZodError) return NextResponse.json({ error: "教师决定内容无效" }, { status: 400, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "teacher-decision", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法保存教师决定" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

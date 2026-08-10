import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, RateLimitedError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { assertDeclaredBodyWithinLimit, parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { resolveTrustedSource } from "@/lib/auth/trusted-source";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { EvidenceForbiddenError, EvidenceNotFoundError, assertEvidenceOwnership } from "@/lib/services/evidence";
import { consumeActionRateLimit, createActionRateLimitKey } from "@/lib/services/action-rate-limit";
import { publicTroubleshootingState } from "@/lib/services/troubleshooting";
import { TroubleshootingEvidenceError, TroubleshootingInputSchema, TroubleshootingStageError, advanceTroubleshooting } from "@/lib/services/troubleshooting-service";

type RouteContext = { params: Promise<{ projectId: string }> };

export function createTroubleshootingHandler(options: { maxRequests?: number } = {}) {
return async function POST(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireStudentSession(request, config.sessionSecret);
    const { projectId } = await context.params;
    connection = createDb(config.databasePath);
    assertEvidenceOwnership(connection.db, session, projectId);
    assertDeclaredBodyWithinLimit(request, 16 * 1024);
    const source = resolveTrustedSource(request.headers, { nodeEnv: process.env.NODE_ENV, secret: config.authProxySecret });
    consumeActionRateLimit(
      connection.db,
      createActionRateLimitKey(source.id, session.userId, projectId, "troubleshooting"),
      { maxRequests: options.maxRequests ?? 30, windowSeconds: 60 },
    );
    const input = await parseLimitedRequestBody(request, TroubleshootingInputSchema, 16 * 1024);
    return NextResponse.json(publicTroubleshootingState(advanceTroubleshooting(connection.db, session, projectId, input)));
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    if (error instanceof EvidenceForbiddenError || error instanceof EvidenceNotFoundError || error instanceof TroubleshootingEvidenceError) return NextResponse.json({ ok: false, error: "项目或证据不存在" }, { status: 404 });
    if (error instanceof TroubleshootingStageError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ ok: false, error: error.message }, { status: 413 });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ ok: false, error: error.message }, { status: 415 });
    if (error instanceof RateLimitedError) return NextResponse.json({ ok: false, error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof BadRequestError) return NextResponse.json({ ok: false, error: "排障请求无效" }, { status: 400 });
    console.error({ requestId, route: "troubleshooting", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ ok: false, error: "服务暂时不可用" }, { status: 500 });
  } finally { connection?.sqlite.close(); }
};
}

export const POST = createTroubleshootingHandler();

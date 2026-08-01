import path from "node:path";
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createModelClient } from "@/lib/ai/client";
import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, RateLimitedError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { assertDeclaredBodyWithinLimit, parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { resolveTrustedSource } from "@/lib/auth/trusted-source";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { loadKnowledgeDirectory } from "@/lib/knowledge/retrieve";
import { consumeActionRateLimit, createActionRateLimitKey } from "@/lib/services/action-rate-limit";
import { EvidenceForbiddenError, EvidenceNotFoundError, assertEvidenceOwnership } from "@/lib/services/evidence";
import { HintPersistenceConflictError, HintRouteInputSchema, requestPersistedHint } from "@/lib/services/hint-persistence";
import { createGroundedHintService, type HintResponse } from "@/lib/services/hints";

type RouteContext = { params: Promise<{ projectId: string }> };
type Generate = Parameters<typeof requestPersistedHint>[4];

async function defaultGenerate(...args: Parameters<Generate>): Promise<HintResponse> {
  const config = readEnv(process.env);
  const knowledge = await loadKnowledgeDirectory(path.join(process.cwd(), "data", "knowledge"));
  const client = config.ai.enabled
    ? createModelClient({
        baseUrl: config.ai.baseUrl!,
        apiKey: config.ai.apiKey!,
        model: config.ai.model!,
        maxOutputTokens: config.ai.maxOutputTokens,
      })
    : undefined;
  return createGroundedHintService({ knowledge, client }).generate(args[0], args[1]);
}

export function createHintHandler(input: { generate: Generate; maxRequests?: number }) {
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
      const source = resolveTrustedSource(request.headers, {
        nodeEnv: process.env.NODE_ENV,
        secret: config.authProxySecret,
      });
      const key = createActionRateLimitKey(source.id, session.userId, projectId, "hint");
      consumeActionRateLimit(connection.db, key, { maxRequests: input.maxRequests ?? 10, windowSeconds: 60 });
      const routeInput = await parseLimitedRequestBody(request, HintRouteInputSchema, 16 * 1024);
      const response = await requestPersistedHint(connection.db, session, projectId, routeInput, input.generate);
      return NextResponse.json(response);
    } catch (error) {
      if (error instanceof StudentSessionRequiredError) return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
      if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
      if (error instanceof EvidenceForbiddenError || error instanceof EvidenceNotFoundError) return NextResponse.json({ ok: false, error: "项目不存在" }, { status: 404 });
      if (error instanceof HintPersistenceConflictError) return NextResponse.json({ ok: false, error: error.message, code: "HINT_CONTEXT_STALE" }, { status: 409 });
      if (error instanceof PayloadTooLargeError) return NextResponse.json({ ok: false, error: error.message }, { status: 413 });
      if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ ok: false, error: error.message }, { status: 415 });
      if (error instanceof RateLimitedError) return NextResponse.json({ ok: false, error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
      if (error instanceof BadRequestError) return NextResponse.json({ ok: false, error: "提示请求无效" }, { status: 400 });
      console.error({ requestId, route: "hints", errorName: error instanceof Error ? error.name : "UnknownError" });
      return NextResponse.json({ ok: false, error: "服务暂时不可用" }, { status: 500 });
    } finally { connection?.sqlite.close(); }
  };
}

export const POST = createHintHandler({ generate: defaultGenerate });

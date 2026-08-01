import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createModelClient } from "@/lib/ai/client";
import { persistLogicCardCoachTurn } from "@/lib/agent/logic-card-coach-audit";
import {
  BadRequestError,
  ForbiddenRequestError,
  PayloadTooLargeError,
  RateLimitedError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import { requireStudentSession, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { resolveTrustedSource } from "@/lib/auth/trusted-source";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { LogicCardCoachRequestSchema, LogicCardCoachResponseSchema } from "@/lib/domain/logic-card-coach-contract";
import { consumeActionRateLimit, createActionRateLimitKey } from "@/lib/services/action-rate-limit";
import {
  clarifyLogicCard,
  createModelLogicCardCoach,
  deterministicLogicCardCoach,
  type LogicCardCoach,
} from "@/lib/services/logic-card-coach";
import { assertLogicCardOwnership, LogicCardForbiddenError, LogicCardNotFoundError } from "@/lib/services/logic-card-service";
import { assertProjectStage, ProjectStageConflictError } from "@/lib/services/project-workflow";

type RouteContext = { params: Promise<{ projectId: string }> };

export function createLogicCardCoachHandler(input: { coach?: LogicCardCoach; maxRequests?: number } = {}) {
  return async function POST(request: NextRequest, context: RouteContext) {
    const requestId = randomUUID();
    const startedAt = performance.now();
    let connection: DatabaseConnection | undefined;
    try {
      validateRequestProtocol(request);
      const config = readEnv(process.env);
      const session = await requireStudentSession(request, config.sessionSecret);
      const { projectId } = await context.params;
      connection = createDb(config.databasePath);
      const project = assertLogicCardOwnership(connection.db, session, projectId);
      assertProjectStage(project.stage, ["LOGIC_CARD"]);
      const source = resolveTrustedSource(request.headers, {
        nodeEnv: process.env.NODE_ENV,
        secret: config.authProxySecret,
      });
      consumeActionRateLimit(
        connection.db,
        createActionRateLimitKey(source.id, session.userId, projectId, "logic-card-coach"),
        { maxRequests: input.maxRequests ?? 12, windowSeconds: 60 },
      );
      const routeInput = await parseLimitedRequestBody(request, LogicCardCoachRequestSchema, 16 * 1024);
      const coach = input.coach ?? (config.ai.enabled
        ? createModelLogicCardCoach(createModelClient({
            baseUrl: config.ai.baseUrl!,
            apiKey: config.ai.apiKey!,
            model: config.ai.model!,
            maxOutputTokens: config.ai.maxOutputTokens,
          }))
        : deterministicLogicCardCoach);
      const suggestion = await clarifyLogicCard(coach, routeInput);
      persistLogicCardCoachTurn({
        connection,
        actor: session,
        project,
        request: routeInput,
        suggestion,
        responseLatencyMs: performance.now() - startedAt,
      });
      return NextResponse.json(LogicCardCoachResponseSchema.parse({ projectId, ...suggestion }));
    } catch (error) {
      if (error instanceof StudentSessionRequiredError) return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
      if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
      if (error instanceof LogicCardNotFoundError || error instanceof LogicCardForbiddenError) return NextResponse.json({ ok: false, error: "项目不存在" }, { status: 404 });
      if (error instanceof ProjectStageConflictError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
      if (error instanceof PayloadTooLargeError) return NextResponse.json({ ok: false, error: error.message }, { status: 413 });
      if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ ok: false, error: error.message }, { status: 415 });
      if (error instanceof RateLimitedError) return NextResponse.json({ ok: false, error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
      if (error instanceof BadRequestError) return NextResponse.json({ ok: false, error: "澄清请求无效" }, { status: 400 });
      console.error({ requestId, route: "logic-card-coach", errorName: error instanceof Error ? error.name : "UnknownError" });
      return NextResponse.json({ ok: false, error: "服务暂时不可用" }, { status: 500 });
    } finally {
      connection?.sqlite.close();
    }
  };
}

export const POST = createLogicCardCoachHandler();

import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createModelClient } from "@/lib/ai/client";
import {
  BadRequestError,
  ForbiddenRequestError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import { parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { LogicCardSchema } from "@/lib/domain/schemas";
import { LogicCardResponseSchema } from "@/lib/domain/logic-card-contract";
import {
  assertLogicCardOwnership,
  LogicCardForbiddenError,
  LogicCardNotFoundError,
  StaleLogicReviewError,
  submitLogicCard,
} from "@/lib/services/logic-card-service";
import { ProjectStageConflictError } from "@/lib/services/project-workflow";
import {
  createModelSemanticLogicReviewer,
  pendingReviewer,
  type SemanticLogicReviewer,
} from "@/lib/services/semantic-logic-review";

class StudentSessionRequiredError extends Error {}
class StudentRoleForbiddenError extends Error {
  constructor() {
    super("仅学生可以提交逻辑卡");
    this.name = "StudentRoleForbiddenError";
  }
}

type RouteContext = { params: Promise<{ projectId: string }> };

export function createLogicCardHandler({ reviewer }: { reviewer?: SemanticLogicReviewer } = {}) {
  return async function POST(request: NextRequest, context: RouteContext) {
    const requestId = randomUUID();
    let connection: DatabaseConnection | undefined;
    try {
      validateRequestProtocol(request);
      const config = readEnv(process.env);
      const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
      if (!token) throw new StudentSessionRequiredError();
      let session;
      try {
        session = await verifySession(token, config.sessionSecret);
      } catch {
        throw new StudentSessionRequiredError();
      }
      if (session.role !== "STUDENT") throw new StudentRoleForbiddenError();

      const { projectId } = await context.params;
      connection = createDb(config.databasePath);
      assertLogicCardOwnership(connection.db, session, projectId);
      const card = await parseLimitedRequestBody(request, LogicCardSchema.strict(), 16 * 1024);
      const activeReviewer = reviewer ?? (config.ai.enabled
        ? createModelSemanticLogicReviewer(createModelClient({
            baseUrl: config.ai.baseUrl!,
            apiKey: config.ai.apiKey!,
            model: config.ai.model!,
            maxOutputTokens: config.ai.maxOutputTokens,
          }))
        : pendingReviewer);
      const result = await submitLogicCard(connection.db, session, projectId, card, activeReviewer);
      return NextResponse.json(LogicCardResponseSchema.parse(result));
    } catch (error) {
      if (error instanceof UnsupportedMediaTypeError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 415 });
      }
      if (error instanceof ForbiddenRequestError || error instanceof StudentRoleForbiddenError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
      }
      if (error instanceof PayloadTooLargeError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 413 });
      }
      if (error instanceof BadRequestError) {
        return NextResponse.json({ ok: false, error: "逻辑卡内容无效" }, { status: 400 });
      }
      if (error instanceof StudentSessionRequiredError) {
        return NextResponse.json({ ok: false, error: "请先以学生身份进入" }, { status: 401 });
      }
      if (error instanceof LogicCardNotFoundError || error instanceof LogicCardForbiddenError) {
        return NextResponse.json({ ok: false, error: "项目不存在" }, { status: 404 });
      }
      if (error instanceof ProjectStageConflictError || error instanceof StaleLogicReviewError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
      }
      console.error({
        requestId,
        route: "logic-card",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return NextResponse.json({ ok: false, error: "服务暂时不可用" }, { status: 500 });
    } finally {
      connection?.sqlite.close();
    }
  };
}

export const POST = createLogicCardHandler();

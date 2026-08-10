import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

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
import { ToolPathPlanResponseSchema } from "@/lib/domain/tool-path";
import { ProjectStageConflictError } from "@/lib/services/project-workflow";
import {
  assertToolPathOwnership,
  MissingLearnerProfileError,
  NoAllowedToolPathError,
  SemanticLogicGateError,
  ToolPathForbiddenError,
  ToolPathNotFoundError,
  ToolPathRequirementsSchema,
  planToolPath,
} from "@/lib/services/tool-path-plan";

class StudentSessionRequiredError extends Error {}
class StudentRoleForbiddenError extends Error {
  constructor() {
    super("仅学生可以规划工具路径");
    this.name = "StudentRoleForbiddenError";
  }
}
type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
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
    assertToolPathOwnership(connection.db, session, projectId);
    const requirements = await parseLimitedRequestBody(
      request,
      ToolPathRequirementsSchema,
      16 * 1024,
    );
    const plan = planToolPath(connection.db, session, projectId, requirements);
    return NextResponse.json(ToolPathPlanResponseSchema.parse({
      plan: {
        ...plan,
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
      },
    }));
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
      return NextResponse.json({ ok: false, error: "项目需求无效" }, { status: 400 });
    }
    if (error instanceof StudentSessionRequiredError) {
      return NextResponse.json({ ok: false, error: "请先以学生身份进入" }, { status: 401 });
    }
    if (error instanceof ToolPathNotFoundError || error instanceof ToolPathForbiddenError) {
      return NextResponse.json({ ok: false, error: "项目不存在" }, { status: 404 });
    }
    if (
      error instanceof ProjectStageConflictError ||
      error instanceof MissingLearnerProfileError ||
      error instanceof SemanticLogicGateError ||
      error instanceof NoAllowedToolPathError
    ) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    }
    console.error({
      requestId,
      route: "tool-path",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ ok: false, error: "服务暂时不可用" }, { status: 500 });
  } finally {
    connection?.sqlite.close();
  }
}

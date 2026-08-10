import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  BadRequestError,
  ForbiddenRequestError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import {
  requireStudentSession,
  studentAwareForbiddenPayload,
  StudentRoleForbiddenError,
  StudentSessionRequiredError,
} from "@/lib/auth/project-session";
import {
  parseLimitedRequestBody,
  validateRequestProtocol,
  validateRequestSource,
} from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { StudentOnboardingUpdateSchema } from "@/lib/domain/student-onboarding";
import {
  readStudentOnboarding,
  saveStudentOnboarding,
  StudentOnboardingIdentityNotFoundError,
} from "@/lib/services/student-onboarding";

const HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

function studentErrorResponse(error: unknown, requestId: string) {
  if (error instanceof BadRequestError) {
    return NextResponse.json({ error: "入门信息无效" }, { status: 400, headers: HEADERS });
  }
  if (error instanceof PayloadTooLargeError) {
    return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
  }
  if (error instanceof UnsupportedMediaTypeError) {
    return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
  }
  if (error instanceof StudentSessionRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
  }
  if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError) {
    return NextResponse.json(
      studentAwareForbiddenPayload(error),
      { status: 403, headers: HEADERS },
    );
  }
  if (error instanceof StudentOnboardingIdentityNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
  }
  console.error({
    requestId,
    route: "student-onboarding",
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    { error: "入门信息暂时不可用" },
    { status: 500, headers: HEADERS },
  );
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const actor = await requireStudentSession(request, config.sessionSecret);
    const requestedStudentId = request.nextUrl.searchParams.get("studentId")?.trim();
    if (requestedStudentId && requestedStudentId !== actor.userId) {
      return NextResponse.json(
        { error: "不能读取其他学生的入门信息", code: "STUDENT_ONBOARDING_OWNER_FORBIDDEN" },
        { status: 403, headers: HEADERS },
      );
    }
    connection = createDb(config.databasePath);
    return NextResponse.json(
      readStudentOnboarding(connection.db, actor),
      { headers: HEADERS },
    );
  } catch (error) {
    return studentErrorResponse(error, requestId);
  } finally {
    connection?.sqlite.close();
  }
}

export async function PUT(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const actor = await requireStudentSession(request, config.sessionSecret);
    const input = await parseLimitedRequestBody(
      request,
      StudentOnboardingUpdateSchema,
      4 * 1024,
    );
    connection = createDb(config.databasePath);
    return NextResponse.json(
      saveStudentOnboarding(connection.db, actor, input),
      { headers: HEADERS },
    );
  } catch (error) {
    return studentErrorResponse(error, requestId);
  } finally {
    connection?.sqlite.close();
  }
}

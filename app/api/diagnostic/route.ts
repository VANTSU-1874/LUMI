import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  BadRequestError,
  ForbiddenRequestError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import {
  parseRequestBody,
  validateRequestProtocol,
} from "@/lib/auth/route-handler";
import {
  SESSION_COOKIE_NAME,
  verifySession,
} from "@/lib/auth/session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import {
  DiagnosticProfileResponseSchema,
  DiagnosticSubmissionSchema,
} from "@/lib/domain/diagnostic";
import {
  DiagnosticAnswerError,
  DiagnosticVersionConflictError,
} from "@/lib/services/diagnostic";
import {
  completeDiagnosticProfile,
  DiagnosticProfileAccessError,
} from "@/lib/services/diagnostic-profile";
import { buildPublicQuestionResponse } from "./questions";

class StudentSessionRequiredError extends Error {
  constructor() {
    super("请先以学生身份进入");
    this.name = "StudentSessionRequiredError";
  }
}

export async function GET() {
  return NextResponse.json(buildPublicQuestionResponse(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;

  try {
    validateRequestProtocol(request);
    const input = await parseRequestBody(request, DiagnosticSubmissionSchema);
    const config = readEnv(process.env);
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!token) throw new StudentSessionRequiredError();

    let session;
    try {
      session = await verifySession(token, config.sessionSecret);
    } catch {
      throw new StudentSessionRequiredError();
    }
    if (session.role !== "STUDENT") throw new StudentSessionRequiredError();

    connection = createDb(config.databasePath);
    const profile = completeDiagnosticProfile(
      connection.db,
      session.userId,
      input.questionSetVersion,
      input.answers,
    );

    const response = DiagnosticProfileResponseSchema.parse({
      profile: { ...profile, updatedAt: profile.updatedAt.toISOString() },
    });
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof UnsupportedMediaTypeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 415 });
    }
    if (error instanceof ForbiddenRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    }
    if (error instanceof BadRequestError || error instanceof DiagnosticAnswerError) {
      return NextResponse.json(
        { ok: false, error: "诊断答案无效" },
        { status: 400 },
      );
    }
    if (error instanceof DiagnosticVersionConflictError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 409 },
      );
    }
    if (
      error instanceof StudentSessionRequiredError ||
      error instanceof DiagnosticProfileAccessError
    ) {
      return NextResponse.json(
        { ok: false, error: "请先以学生身份进入" },
        { status: 401 },
      );
    }

    console.error({
      requestId,
      route: "diagnostic",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { ok: false, error: "服务暂时不可用" },
      { status: 500 },
    );
  } finally {
    connection?.sqlite.close();
  }
}

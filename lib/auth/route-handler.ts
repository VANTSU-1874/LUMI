import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import {
  BadRequestError,
  ForbiddenRequestError,
  InvalidClassCodeError,
  InvalidIdentityCodeError,
  InvalidTeacherCodeError,
  PayloadTooLargeError,
  RateLimitedError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import {
  authenticateWithRateLimit,
  createAuthRateLimitKey,
} from "@/lib/auth/rate-limit";
import { normalizeIdentityCode } from "@/lib/auth/identity-code";
import { resolveTrustedSource } from "@/lib/auth/trusted-source";
import { enterStudent, enterTeacher, persistTeacherIdentity } from "@/lib/services/access";

import {
  issueSession,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  type SessionPayload,
} from "./session";

const studentBodySchema = z
  .object({
    classCode: z.string().trim().min(1).max(64),
    alias: z.string().transform(normalizeIdentityCode),
  })
  .strict();

const teacherBodySchema = z
  .object({
    code: z.string().trim().min(1).max(128),
  })
  .strict();

type RuntimeEnvironment = Record<string, string | undefined>;

export function validateRequestProtocol(request: NextRequest) {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new UnsupportedMediaTypeError();
  }

  validateRequestSource(request);
}

export function validateRequestSource(request: NextRequest) {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new ForbiddenRequestError();
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const submittedOrigin = new URL(origin).origin;
      const acceptedOrigins = new Set([request.nextUrl.origin]);
      const requestHost = request.headers.get("host")?.trim();
      if (requestHost && !/[\s/@\\]/.test(requestHost)) {
        acceptedOrigins.add(new URL(`${request.nextUrl.protocol}//${requestHost}`).origin);
      }
      if (!acceptedOrigins.has(submittedOrigin)) {
        throw new ForbiddenRequestError();
      }
    } catch (error) {
      if (error instanceof ForbiddenRequestError) {
        throw error;
      }
      throw new ForbiddenRequestError();
    }
  }
}

export async function parseRequestBody<T>(request: NextRequest, schema: z.ZodType<T>) {
  try {
    return schema.parse(await request.json());
  } catch {
    throw new BadRequestError();
  }
}

export async function parseLimitedRequestBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
  maxBytes: number,
) {
  assertDeclaredBodyWithinLimit(request, maxBytes);
  try {
    const bytes = await readLimitedRequestBody(request, maxBytes);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return schema.parse(JSON.parse(text));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) throw error;
    throw new BadRequestError();
  }
}

export async function readLimitedRequestBody(
  request: NextRequest,
  maxBytes: number,
) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request body exceeded hard limit");
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function assertDeclaredBodyWithinLimit(
  request: NextRequest,
  maxBytes: number,
) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    throw new PayloadTooLargeError();
  }
}

function sessionResponse(
  token: string,
  environment: RuntimeEnvironment,
) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: environment.NODE_ENV === "production",
  });
  return response;
}

function errorResponse(
  error: unknown,
  context: { requestId: string; route: "student" | "teacher" },
) {
  if (error instanceof UnsupportedMediaTypeError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 415 });
  }

  if (error instanceof ForbiddenRequestError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  }

  if (error instanceof BadRequestError) {
    return NextResponse.json({ ok: false, error: "输入信息无效" }, { status: 400 });
  }

  if (error instanceof RateLimitedError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      {
        status: 429,
        headers: { "Retry-After": String(error.retryAfterSeconds) },
      },
    );
  }

  if (
    error instanceof InvalidClassCodeError ||
    error instanceof InvalidIdentityCodeError ||
    error instanceof InvalidTeacherCodeError
  ) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
  }

  console.error({
    requestId: context.requestId,
    route: context.route,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    { ok: false, error: "服务暂时不可用" },
    { status: 500 },
  );
}

export async function handleStudentAuth(
  request: NextRequest,
  environment: RuntimeEnvironment = process.env,
) {
  let connection: DatabaseConnection | undefined;
  const requestId = randomUUID();

  try {
    validateRequestProtocol(request);
    const input = await parseRequestBody(request, studentBodySchema);
    const config = readEnv(environment);
    const trustedSource = resolveTrustedSource(request.headers, {
      nodeEnv: environment.NODE_ENV,
      secret: config.authProxySecret,
    });
    connection = createDb(config.databasePath);
    const db = connection.db;
    const rateLimitKey = createAuthRateLimitKey(trustedSource.id, "student");
    const identity = authenticateWithRateLimit(
      db,
      rateLimitKey,
      () => enterStudent(db, input, config.identityCodePepper),
    );
    const session: SessionPayload = {
      userId: identity.userId,
      role: identity.role,
    };
    const token = await issueSession(session, config.sessionSecret);

    return sessionResponse(token, environment);
  } catch (error) {
    return errorResponse(error, { requestId, route: "student" });
  } finally {
    connection?.sqlite.close();
  }
}

export async function handleTeacherAuth(
  request: NextRequest,
  environment: RuntimeEnvironment = process.env,
) {
  let connection: DatabaseConnection | undefined;
  const requestId = randomUUID();

  try {
    validateRequestProtocol(request);
    const input = await parseRequestBody(request, teacherBodySchema);
    const config = readEnv(environment);
    const trustedSource = resolveTrustedSource(request.headers, {
      nodeEnv: environment.NODE_ENV,
      secret: config.authProxySecret,
    });
    connection = createDb(config.databasePath);
    const db = connection.db;
    const rateLimitKey = createAuthRateLimitKey(trustedSource.id, "teacher");
    const identity = authenticateWithRateLimit(
      db,
      rateLimitKey,
      () => enterTeacher(input.code, config.teacherAccessCode),
    );
    persistTeacherIdentity(db, identity);
    const token = await issueSession(identity, config.sessionSecret);

    return sessionResponse(token, environment);
  } catch (error) {
    return errorResponse(error, { requestId, route: "teacher" });
  } finally {
    connection?.sqlite.close();
  }
}

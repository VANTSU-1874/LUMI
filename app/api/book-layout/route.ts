import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { parseLimitedRequestBody, validateRequestProtocol, validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { BookLayoutDraftRequestSchema, BookLayoutEvidenceRequestSchema, BookLayoutResetResponseSchema } from "@/lib/domain/book-layout";
import { BookLayoutForbiddenError, BookLayoutNotFoundError, readBookLayoutWorkspace, resetBookLayoutDraft, saveBookLayoutDraft, saveBookLayoutEvidence } from "@/lib/services/book-layout";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function failure(error: unknown, requestId: string) {
  if (error instanceof BadRequestError) return NextResponse.json({ error: error.message }, { status: 400, headers: HEADERS });
  if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
  if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
  if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
  if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof BookLayoutForbiddenError) return NextResponse.json({ error: error.message }, { status: 403, headers: HEADERS });
  if (error instanceof BookLayoutNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
  console.error({ requestId, route: "book-layout", errorName: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "书籍设计微实验暂时不可用" }, { status: 500, headers: HEADERS });
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireStudentSession(request, config.sessionSecret);
    connection = createDb(config.databasePath);
    return NextResponse.json(readBookLayoutWorkspace(connection, session), { headers: HEADERS });
  } catch (error) {
    return failure(error, requestId);
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
    const session = await requireStudentSession(request, config.sessionSecret);
    const input = await parseLimitedRequestBody(request, BookLayoutDraftRequestSchema, 16 * 1024);
    connection = createDb(config.databasePath);
    return NextResponse.json(saveBookLayoutDraft(connection, session, input), { headers: HEADERS });
  } catch (error) {
    return failure(error, requestId);
  } finally {
    connection?.sqlite.close();
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireStudentSession(request, config.sessionSecret);
    await parseLimitedRequestBody(request, BookLayoutResetResponseSchema.pick({ reset: true }), 1_024);
    connection = createDb(config.databasePath);
    return NextResponse.json(resetBookLayoutDraft(connection, session), { headers: HEADERS });
  } catch (error) {
    return failure(error, requestId);
  } finally {
    connection?.sqlite.close();
  }
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireStudentSession(request, config.sessionSecret);
    const input = await parseLimitedRequestBody(request, BookLayoutEvidenceRequestSchema, 16 * 1024);
    connection = createDb(config.databasePath);
    return NextResponse.json(saveBookLayoutEvidence(connection, session, input), { status: 201, headers: HEADERS });
  } catch (error) {
    return failure(error, requestId);
  } finally {
    connection?.sqlite.close();
  }
}

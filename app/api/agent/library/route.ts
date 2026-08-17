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
import { validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import {
  createStudentLibraryAsset,
  listStudentLibraryAssets,
  StudentLibraryForbiddenError,
  StudentLibraryNotFoundError,
} from "@/lib/agent/student-library";
import { parseStudentLibraryUpload } from "@/lib/agent/student-library-request";
import { DesignTaskForbiddenError, DesignTaskNotFoundError } from "@/lib/agent/design-project-task";
import { ImageTooLargeError, InvalidImageError } from "@/lib/security/uploads";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function errorResponse(error: unknown, requestId: string, route: string) {
  if (error instanceof BadRequestError || error instanceof InvalidImageError) {
    return NextResponse.json({ error: "请选择有效的 PNG、JPEG 或 WebP 图片" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  if (error instanceof PayloadTooLargeError || error instanceof ImageTooLargeError) {
    return NextResponse.json({ error: "图片大小不能超过 5 MiB" }, { status: 413, headers: PRIVATE_HEADERS });
  }
  if (error instanceof UnsupportedMediaTypeError) {
    return NextResponse.json({ error: error.message }, { status: 415, headers: PRIVATE_HEADERS });
  }
  if (error instanceof StudentSessionRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
  }
  if (
    error instanceof StudentRoleForbiddenError
    || error instanceof ForbiddenRequestError
    || error instanceof StudentLibraryForbiddenError
    || error instanceof DesignTaskForbiddenError
  ) {
    return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: PRIVATE_HEADERS });
  }
  if (error instanceof StudentLibraryNotFoundError || error instanceof DesignTaskNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404, headers: PRIVATE_HEADERS });
  }
  console.error({ requestId, route, errorName: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "文件库暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const actor = await requireStudentSession(request, config.sessionSecret);
    connection = createDb(config.databasePath);
    return NextResponse.json(listStudentLibraryAssets(connection, actor), { headers: PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error, requestId, "student-library-list");
  } finally {
    connection?.sqlite.close();
  }
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    const config = readEnv(process.env);
    const actor = await requireStudentSession(request, config.sessionSecret);
    const input = await parseStudentLibraryUpload(request);
    connection = createDb(config.databasePath);
    const result = await createStudentLibraryAsset(
      connection,
      actor,
      input,
      config.evidenceRoot,
    );
    return NextResponse.json(result, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error, requestId, "student-library-upload");
  } finally {
    connection?.sqlite.close();
  }
}


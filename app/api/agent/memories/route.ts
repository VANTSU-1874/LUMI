import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  readOwnedStudentMemoryCollection,
  StudentMemoryStudentIdentityNotFoundError,
} from "@/lib/agent/student-memory";
import { ForbiddenRequestError } from "@/lib/auth/errors";
import {
  requireStudentSession,
  studentAwareForbiddenPayload,
  StudentRoleForbiddenError,
  StudentSessionRequiredError,
} from "@/lib/auth/project-session";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";

const HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

function unsignedInteger(raw: string | null, fallback: number, maximum?: number) {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (maximum !== undefined && value > maximum)) return undefined;
  return value;
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
        { error: "不能读取其他学生的长期记忆", code: "STUDENT_MEMORY_OWNER_FORBIDDEN" },
        { status: 403, headers: HEADERS },
      );
    }
    const limit = unsignedInteger(request.nextUrl.searchParams.get("limit"), 100, 100);
    const offset = unsignedInteger(request.nextUrl.searchParams.get("offset"), 0);
    if (limit === undefined || limit < 1 || offset === undefined) {
      return NextResponse.json({ error: "分页参数无效" }, { status: 400, headers: HEADERS });
    }
    connection = createDb(config.databasePath);
    return NextResponse.json(
      readOwnedStudentMemoryCollection(connection.db, actor, { limit, offset }),
      { headers: HEADERS },
    );
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    }
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError) {
      return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
    }
    if (error instanceof StudentMemoryStudentIdentityNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    }
    console.error({
      requestId,
      route: "student-memory-list",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "长期记忆暂时不可用" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

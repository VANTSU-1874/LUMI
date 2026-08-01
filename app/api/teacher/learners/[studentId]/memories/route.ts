import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { readStudentMemoryCollection } from "@/lib/agent/student-memory";
import { ForbiddenRequestError } from "@/lib/auth/errors";
import { validateRequestSource } from "@/lib/auth/route-handler";
import {
  assertTeacherClassAccess,
  TeacherClassAccessNotFoundError,
  TeacherIdentityForbiddenError,
} from "@/lib/auth/teacher-access";
import {
  requireTeacherSession,
  TeacherRoleForbiddenError,
  TeacherSessionRequiredError,
} from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { InvalidIncludeDemoQueryError, parseIncludeDemoQuery } from "@/lib/domain/include-demo-query";

type RouteContext = { params: Promise<{ studentId: string }> };
const PRIVATE_HEADERS = {
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

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const classId = request.nextUrl.searchParams.get("classId")?.trim();
    const { studentId } = await context.params;
    if (!classId || !studentId || classId.length > 128 || studentId.length > 128) {
      return NextResponse.json({ error: "学生不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    }
    const limit = unsignedInteger(request.nextUrl.searchParams.get("limit"), 100, 100);
    const offset = unsignedInteger(request.nextUrl.searchParams.get("offset"), 0);
    if (limit === undefined || limit < 1 || offset === undefined) {
      return NextResponse.json({ error: "分页参数无效" }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const includeDemo = parseIncludeDemoQuery(request.nextUrl.searchParams.get("includeDemo"));
    connection = createDb(config.databasePath);
    assertTeacherClassAccess(connection.db, session, classId);
    const learner = connection.db.select({ id: users.id }).from(users).where(and(
      eq(users.id, studentId),
      eq(users.classId, classId),
      eq(users.role, "STUDENT"),
      includeDemo ? undefined : eq(users.dataType, "REAL"),
    )).get();
    if (!learner) return NextResponse.json({ error: "学生不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    return NextResponse.json(readStudentMemoryCollection(connection.db, classId, studentId, {
      includeDemo,
      limit,
      offset,
    }), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    }
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) {
      return NextResponse.json({ error: error.message }, { status: 403, headers: PRIVATE_HEADERS });
    }
    if (error instanceof TeacherClassAccessNotFoundError) {
      return NextResponse.json({ error: "学生不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    }
    if (error instanceof InvalidIncludeDemoQueryError) {
      return NextResponse.json({ error: "includeDemo参数无效" }, { status: 400, headers: PRIVATE_HEADERS });
    }
    console.error({
      requestId,
      route: "teacher-student-memory-list",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "长期记忆暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

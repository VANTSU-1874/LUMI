import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { deleteStudentMemoryForTeacher } from "@/lib/agent/student-memory";
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
import { StudentMemoryDeleteInputSchema } from "@/lib/domain/student-memory";

type RouteContext = { params: Promise<{ studentId: string; memoryId: string }> };
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const classId = request.nextUrl.searchParams.get("classId")?.trim();
    const { studentId, memoryId } = await context.params;
    if (!classId || !studentId || classId.length > 128 || studentId.length > 128) {
      return NextResponse.json({ error: "学生不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    }
    connection = createDb(config.databasePath);
    assertTeacherClassAccess(connection.db, session, classId);
    const input = StudentMemoryDeleteInputSchema.safeParse({ classId, studentId, memoryId });
    if (!input.success) return new NextResponse(null, { status: 204, headers: PRIVATE_HEADERS });
    deleteStudentMemoryForTeacher(connection.db, session, input.data);
    return new NextResponse(null, { status: 204, headers: PRIVATE_HEADERS });
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
    console.error({
      requestId,
      route: "teacher-student-memory-delete",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "记忆删除暂时不可用，请重试" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

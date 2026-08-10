import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { listTeacherClasses, readClassAnalytics, TeacherAnalyticsNotFoundError } from "@/lib/services/teacher-analytics";
import { aiModeFromConfiguration } from "@/lib/domain/data-provenance";
import { InvalidIncludeDemoQueryError, parseIncludeDemoQuery } from "@/lib/domain/include-demo-query";
import { assertTeacherClassAccess, readTeacherScope, TeacherClassAccessNotFoundError, TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    connection = createDb(config.databasePath);
    const classId = request.nextUrl.searchParams.get("classId")?.trim();
    const scope = readTeacherScope(connection.db, session);
    if (classId) assertTeacherClassAccess(connection.db, session, classId);
    const includeDemo = parseIncludeDemoQuery(request.nextUrl.searchParams.get("includeDemo"));
    const aiMode = aiModeFromConfiguration(config.ai.enabled);
    const listed = classId ? undefined : listTeacherClasses(connection.db, { includeDemo, classId: scope.kind === "CLASS" ? scope.classId : undefined });
    const payload = classId
      ? readClassAnalytics(connection.db, classId, { includeDemo, aiMode })
      : { aiMode, classes: listed!.classes, classesMeta: listed!.classesMeta };
    return NextResponse.json(payload, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: error.message }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherAnalyticsNotFoundError || error instanceof TeacherClassAccessNotFoundError) return NextResponse.json({ error: "班级不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    if (error instanceof InvalidIncludeDemoQueryError) return NextResponse.json({ error: "includeDemo参数无效" }, { status: 400, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "teacher-dashboard", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "教师工作台暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

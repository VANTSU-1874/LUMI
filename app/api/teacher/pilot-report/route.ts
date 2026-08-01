import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { assertTeacherClassAccess, TeacherClassAccessNotFoundError, TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { PilotReportNotFoundError, readPilotReport, renderPilotReportMarkdown } from "@/lib/services/pilot-report";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const classId = request.nextUrl.searchParams.get("classId")?.trim();
    if (!classId || classId.length > 128) throw new PilotReportNotFoundError();
    connection = createDb(config.databasePath);
    assertTeacherClassAccess(connection.db, session, classId);
    const report = readPilotReport(connection, classId);
    const body = renderPilotReportMarkdown(report);
    const date = report.generatedAt.slice(0, 10);
    return new NextResponse(body, {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="chuying-real-pilot-${date}.md"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: error.message }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof PilotReportNotFoundError || error instanceof TeacherClassAccessNotFoundError) return NextResponse.json({ error: "班级不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "teacher-pilot-report", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "真实试用报告暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

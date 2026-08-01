import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { requireStudentSession, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { ForbiddenRequestError } from "@/lib/auth/errors";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { StudentDashboardNotFoundError, readStudentDashboard } from "@/lib/services/student-dashboard";
import { aiModeFromConfiguration } from "@/lib/domain/data-provenance";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireStudentSession(request, config.sessionSecret);
    connection = createDb(config.databasePath);
    return NextResponse.json(readStudentDashboard(connection.db, session, { aiMode: aiModeFromConfiguration(config.ai.enabled) }), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: error.message }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof StudentDashboardNotFoundError) return NextResponse.json({ error: "学生工作台不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "student-dashboard", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "工作台暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

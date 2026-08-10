import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import {
  readTeacherEvidenceDetail,
  TeacherEvidenceReviewForbiddenError,
  TeacherEvidenceReviewNotFoundError,
} from "@/lib/services/teacher-evidence-review";

type RouteContext = { params: Promise<{ evidenceId: string }> };
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const { evidenceId } = await context.params;
    connection = createDb(config.databasePath);
    return NextResponse.json(readTeacherEvidenceDetail(connection.db, session, evidenceId), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherEvidenceReviewForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherEvidenceReviewNotFoundError) return NextResponse.json({ error: "证据不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "teacher-evidence-detail", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "证据内容暂时无法读取" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

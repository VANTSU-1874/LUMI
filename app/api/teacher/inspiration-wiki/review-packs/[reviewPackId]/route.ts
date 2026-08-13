import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { readTeacherReviewPack, ReviewPackNotFoundError } from "@/lib/services/inspiration-wiki-review-packs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
type RouteContext = { params: Promise<{ reviewPackId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const { reviewPackId } = await context.params;
    connection = createDb(config.databasePath);
    return NextResponse.json(readTeacherReviewPack(connection, session, reviewPackId), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) {
      return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    }
    if (error instanceof ReviewPackNotFoundError) return NextResponse.json({ error: "审核包不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "teacher-inspiration-review-pack", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "教师审核包暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

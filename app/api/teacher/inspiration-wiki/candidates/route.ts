import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { readPrivateHermesCandidateQueue } from "@/lib/services/inspiration-wiki-hermes-intake";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  reviewState: z.enum([
    "PENDING_REVIEW",
    "NORMALIZATION_REQUIRED",
    "DUPLICATE_HOLD",
    "RIGHTS_HOLD",
    "REJECTED",
  ]).optional(),
}).strict();

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const query = QuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    connection = createDb(config.databasePath);
    return NextResponse.json(
      readPrivateHermesCandidateQueue(connection, session, query),
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    }
    if (error instanceof TeacherRoleForbiddenError
      || error instanceof TeacherIdentityForbiddenError
      || error instanceof ForbiddenRequestError) {
      return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "分页或筛选参数无效" }, { status: 400, headers: PRIVATE_HEADERS });
    }
    console.error({ requestId, route: "teacher-private-hermes-candidates", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "私有候选暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

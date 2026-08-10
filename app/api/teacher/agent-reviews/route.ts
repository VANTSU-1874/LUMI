import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { AgentDecisionReviewInputSchema } from "@/lib/domain/teacher";
import { AgentReviewForbiddenError, AgentReviewNotFoundError, saveAgentDecisionReview } from "@/lib/services/agent-review";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const input = await parseLimitedRequestBody(request, AgentDecisionReviewInputSchema, 8 * 1024);
    connection = createDb(config.databasePath);
    return NextResponse.json(saveAgentDecisionReview(connection, session, input), { status: 201, headers: HEADERS });
  } catch (error) {
    if (error instanceof BadRequestError) return NextResponse.json({ error: error.message }, { status: 400, headers: HEADERS });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof AgentReviewForbiddenError) return NextResponse.json({ error: error.message }, { status: 403, headers: HEADERS });
    if (error instanceof AgentReviewNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    console.error({ requestId, route: "teacher-agent-reviews", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "智能体判断复核暂时不可用" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

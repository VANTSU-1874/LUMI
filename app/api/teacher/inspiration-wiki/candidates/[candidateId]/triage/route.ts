import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import {
  decidePrivateHermesCandidateTriage,
  HermesCandidateNotFoundError,
  HermesCandidateRevisionConflictError,
  HermesPrivateTriageInputSchema,
  HermesTriageIdempotencyConflictError,
} from "@/lib/services/inspiration-wiki-hermes-intake";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
type RouteContext = { params: Promise<{ candidateId: string }> };
const BodySchema = HermesPrivateTriageInputSchema.omit({ candidateId: true });

export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const { candidateId } = await context.params;
    if (!/^hermes-candidate:[0-9a-f]{32}$/.test(candidateId)) {
      return NextResponse.json({ error: "对象不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    }
    const body = await parseLimitedRequestBody(request, BodySchema, 16 * 1024);
    connection = createDb(config.databasePath);
    const result = decidePrivateHermesCandidateTriage(connection, session, { ...body, candidateId });
    return NextResponse.json(result, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    }
    if (error instanceof TeacherRoleForbiddenError
      || error instanceof TeacherIdentityForbiddenError
      || error instanceof ForbiddenRequestError) {
      return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    }
    if (error instanceof HermesCandidateNotFoundError) {
      return NextResponse.json({ error: "对象不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    }
    if (error instanceof HermesCandidateRevisionConflictError) {
      return NextResponse.json({ error: "候选已更新，请刷新后再处理" }, { status: 409, headers: PRIVATE_HEADERS });
    }
    if (error instanceof HermesTriageIdempotencyConflictError) {
      return NextResponse.json({ error: "请求标识已用于其他处理" }, { status: 409, headers: PRIVATE_HEADERS });
    }
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413, headers: PRIVATE_HEADERS });
    }
    if (error instanceof UnsupportedMediaTypeError) {
      return NextResponse.json({ error: error.message }, { status: 415, headers: PRIVATE_HEADERS });
    }
    if (error instanceof BadRequestError || error instanceof z.ZodError) {
      return NextResponse.json({ error: "候选处理决定无效" }, { status: 400, headers: PRIVATE_HEADERS });
    }
    console.error({ requestId, route: "teacher-private-hermes-triage", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法保存候选处理" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

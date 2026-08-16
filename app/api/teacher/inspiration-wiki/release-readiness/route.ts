import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { parseLimitedRequestBody, validateRequestProtocol, validateRequestSource } from "@/lib/auth/route-handler";
import { TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { TeacherReleaseReadinessQueueSchema } from "@/lib/domain/inspiration-wiki/release-readiness-contracts";
import { ReleaseQualificationDecisionInputSchema, ReleaseQualificationDecisionReceiptSchema, TeacherReleaseQualificationQueueSchema } from "@/lib/domain/inspiration-wiki/release-qualification-contracts";
import { FormalReleaseActionSchema, TeacherFormalReleaseQueueSchema } from "@/lib/domain/inspiration-wiki/formal-release-contracts";
import { readTeacherReleaseReadiness } from "@/lib/services/inspiration-wiki-release-readiness";
import { decideReleaseQualificationGate, readTeacherReleaseQualificationQueue, ReleaseQualificationConflictError } from "@/lib/services/inspiration-wiki-release-qualification";
import { FormalReleaseConflictError, FormalReleaseGateError, publishQualifiedInspirationCase, readTeacherFormalReleaseQueue, withdrawFormalInspirationRelease } from "@/lib/services/inspiration-wiki-formal-release";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    connection = createDb(config.databasePath);
    if (request.nextUrl.searchParams.get("phase") === "formal") {
      return NextResponse.json(TeacherFormalReleaseQueueSchema.parse(readTeacherFormalReleaseQueue(connection, session)), { headers: PRIVATE_HEADERS });
    }
    if (request.nextUrl.searchParams.get("phase") === "d25") {
      return NextResponse.json(
        TeacherReleaseQualificationQueueSchema.parse(readTeacherReleaseQualificationQueue(connection, session)),
        { headers: PRIVATE_HEADERS },
      );
    }
    return NextResponse.json(
      TeacherReleaseReadinessQueueSchema.parse(readTeacherReleaseReadiness(connection, session)),
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "teacher-inspiration-release-readiness", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "发布准备审计暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const body = await parseLimitedRequestBody(request, z.union([FormalReleaseActionSchema, ReleaseQualificationDecisionInputSchema]), 12 * 1024);
    connection = createDb(config.databasePath);
    if ("action" in body) {
      const receipt = body.action === "PUBLISH"
        ? publishQualifiedInspirationCase(connection, session, body)
        : withdrawFormalInspirationRelease(connection, session, body);
      return NextResponse.json(receipt, { headers: PRIVATE_HEADERS });
    }
    return NextResponse.json(
      ReleaseQualificationDecisionReceiptSchema.parse(decideReleaseQualificationGate(connection, session, body)),
      { status: 201, headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof ReleaseQualificationConflictError || error instanceof FormalReleaseConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers: PRIVATE_HEADERS });
    if (error instanceof FormalReleaseGateError) return NextResponse.json({ error: "五道资格门尚未全部满足，不能正式发布" }, { status: 422, headers: PRIVATE_HEADERS });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: PRIVATE_HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: PRIVATE_HEADERS });
    if (error instanceof BadRequestError || error instanceof z.ZodError) return NextResponse.json({ error: "D-25 资格决定无效" }, { status: 400, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "teacher-inspiration-release-qualification-decision", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法保存 D-25 资格决定" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

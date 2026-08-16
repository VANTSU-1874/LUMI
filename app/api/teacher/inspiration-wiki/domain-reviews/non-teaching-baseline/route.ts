import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { PrivateDomainNonTeachingBaselineBodySchema, PrivateDomainNonTeachingBaselineReceiptSchema } from "@/lib/domain/inspiration-wiki/private-domain-review-contracts";
import {
  approveTeacherPrivateNonTeachingDomains,
  PrivateDomainReviewConflictError,
  PrivateDomainReviewIdempotencyConflictError,
  PrivateDomainReviewRevisionConflictError,
} from "@/lib/services/inspiration-wiki-private-domain-reviews";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const body = await parseLimitedRequestBody(request, PrivateDomainNonTeachingBaselineBodySchema, 8 * 1024);
    connection = createDb(config.databasePath);
    const receipt = approveTeacherPrivateNonTeachingDomains(connection, session, body);
    return NextResponse.json(PrivateDomainNonTeachingBaselineReceiptSchema.parse(receipt), { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof PrivateDomainReviewConflictError || error instanceof PrivateDomainReviewRevisionConflictError || error instanceof PrivateDomainReviewIdempotencyConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers: PRIVATE_HEADERS });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: PRIVATE_HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: PRIVATE_HEADERS });
    if (error instanceof BadRequestError || error instanceof z.ZodError) return NextResponse.json({ error: "非教学三域批量确认请求无效" }, { status: 400, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "teacher-private-domain-nonteaching-baseline", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法确认非教学三域" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

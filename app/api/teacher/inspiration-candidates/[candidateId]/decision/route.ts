import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { isInspirationPublicId } from "@/lib/domain/inspiration-public-id";
import { inspirationPublicId } from "@/lib/domain/inspiration-public-id";
import { resolveCandidateIdByPublicId } from "@/lib/services/inspiration-preview";
import {
  decideInspirationCandidate,
  InspirationCandidateNotFoundError,
  InspirationCandidatePublicationGateError,
  InspirationCandidateRequestConflictError,
  InspirationCandidateRevisionConflictError,
  InspirationCandidateStateError,
  InspirationReviewDecisionInputObjectSchema,
} from "@/lib/services/inspiration-review-pipeline";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
type RouteContext = { params: Promise<{ candidateId: string }> };
const PublicDecisionInputSchema = InspirationReviewDecisionInputObjectSchema.omit({ candidateId: true }).extend({
  candidateId: z.string().regex(/^inspiration:[a-f0-9]{24}$/),
}).strict();

export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const { candidateId: publicId } = await context.params;
    const input = await parseLimitedRequestBody(request, PublicDecisionInputSchema, 16 * 1024);
    if (publicId !== input.candidateId || !isInspirationPublicId(publicId)) return NextResponse.json({ error: "对象不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    connection = createDb(config.databasePath);
    const internalCandidateId = resolveCandidateIdByPublicId(connection.db, publicId);
    if (!internalCandidateId) return NextResponse.json({ error: "对象不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    const result = decideInspirationCandidate(connection.db, session, { ...input, candidateId: internalCandidateId });
    return NextResponse.json({ ...result, candidateId: inspirationPublicId(result.candidateId) }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof InspirationCandidateNotFoundError) return NextResponse.json({ error: "对象不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    if (error instanceof InspirationCandidateRevisionConflictError) return NextResponse.json({ error: "候选已更新，请刷新后再决定" }, { status: 409, headers: PRIVATE_HEADERS });
    if (error instanceof InspirationCandidateRequestConflictError) return NextResponse.json({ error: "请求标识已用于其他决定" }, { status: 409, headers: PRIVATE_HEADERS });
    if (error instanceof InspirationCandidatePublicationGateError) return NextResponse.json({ error: "正式学生发布门未满足" }, { status: 409, headers: PRIVATE_HEADERS });
    if (error instanceof InspirationCandidateStateError) return NextResponse.json({ error: "候选当前不可审核" }, { status: 409, headers: PRIVATE_HEADERS });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: PRIVATE_HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: PRIVATE_HEADERS });
    if (error instanceof BadRequestError || error instanceof z.ZodError) return NextResponse.json({ error: "审核决定无效" }, { status: 400, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "teacher-inspiration-review-decision", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法保存审核决定" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { ReviewPackDecisionBodySchema, TeacherReviewPackDecisionReceiptSchema } from "@/lib/domain/inspiration-wiki/review-pack-contracts";
import {
  decideTeacherReviewPack,
  readTeacherReviewPackQueue,
  ReviewPackIdempotencyConflictError,
  ReviewPackNotFoundError,
  ReviewPackRevisionConflictError,
} from "@/lib/services/inspiration-wiki-review-packs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
type RouteContext = { params: Promise<{ reviewPackId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const { reviewPackId } = await context.params;
    const body = await parseLimitedRequestBody(request, ReviewPackDecisionBodySchema, 16 * 1024);
    connection = createDb(config.databasePath);
    const queue = readTeacherReviewPackQueue(connection, session).items;
    const currentIndex = queue.findIndex((item) => item.reviewPackId === reviewPackId);
    const nextReviewPackId = currentIndex >= 0 ? queue[currentIndex + 1]?.reviewPackId ?? null : null;
    const receipt = decideTeacherReviewPack(connection, session, { ...body, reviewPackId });
    return NextResponse.json(
      TeacherReviewPackDecisionReceiptSchema.parse({ ...receipt, nextReviewPackId }),
      { status: 201, headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) {
      return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    }
    if (error instanceof ReviewPackNotFoundError) return NextResponse.json({ error: "审核包不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    if (error instanceof ReviewPackRevisionConflictError || error instanceof ReviewPackIdempotencyConflictError) {
      return NextResponse.json({ error: "审核包已变化，请刷新后重试" }, { status: 409, headers: PRIVATE_HEADERS });
    }
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: PRIVATE_HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: PRIVATE_HEADERS });
    if (error instanceof BadRequestError || error instanceof z.ZodError) {
      return NextResponse.json({ error: "审核决定无效" }, { status: 400, headers: PRIVATE_HEADERS });
    }
    console.error({ requestId, route: "teacher-inspiration-review-pack-decision", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法保存审核决定" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

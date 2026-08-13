import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { parseLimitedRequestBody, validateRequestProtocol, validateRequestSource } from "@/lib/auth/route-handler";
import { TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { PrivateWikiDraftSchema, PrivateWikiDraftUpdateBodySchema } from "@/lib/domain/inspiration-wiki/private-draft-contracts";
import { PrivateWikiDraftIdempotencyConflictError, PrivateWikiDraftNotFoundError, PrivateWikiDraftRevisionConflictError, readTeacherPrivateWikiDraft, updateTeacherPrivateWikiDraft } from "@/lib/services/inspiration-wiki-private-drafts";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
type Context = { params: Promise<{ draftId: string }> };

export async function GET(request: NextRequest, context: Context) {
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    connection = createDb(config.databasePath);
    return NextResponse.json(PrivateWikiDraftSchema.parse(readTeacherPrivateWikiDraft(connection, session, (await context.params).draftId)), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof PrivateWikiDraftNotFoundError || error instanceof z.ZodError) return NextResponse.json({ error: "私有草稿不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    return NextResponse.json({ error: "私有草稿暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

export async function PATCH(request: NextRequest, context: Context) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const body = await parseLimitedRequestBody(request, PrivateWikiDraftUpdateBodySchema, 128 * 1024);
    connection = createDb(config.databasePath);
    return NextResponse.json(updateTeacherPrivateWikiDraft(connection, session, (await context.params).draftId, body), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof PrivateWikiDraftNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: PRIVATE_HEADERS });
    if (error instanceof PrivateWikiDraftRevisionConflictError || error instanceof PrivateWikiDraftIdempotencyConflictError) return NextResponse.json({ error: "草稿已变化，请刷新后重试" }, { status: 409, headers: PRIVATE_HEADERS });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: PRIVATE_HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: PRIVATE_HEADERS });
    if (error instanceof BadRequestError || error instanceof z.ZodError) return NextResponse.json({ error: "草稿内容无效" }, { status: 400, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "teacher-private-wiki-draft", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法保存私有草稿" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

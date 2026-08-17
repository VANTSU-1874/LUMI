import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, StudentRoleForbiddenError, StudentSessionRequiredError, studentAwareForbiddenPayload } from "@/lib/auth/project-session";
import { parseLimitedRequestBody, validateRequestProtocol, validateRequestSource } from "@/lib/auth/route-handler";
import { StudentProjectCreateSchema } from "@/lib/agent/student-project-contract";
import { createStudentProject, listStudentProjects, StudentProjectForbiddenError } from "@/lib/agent/student-project";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function failure(error: unknown, requestId: string) {
  if (error instanceof BadRequestError || error instanceof z.ZodError) return NextResponse.json({ error: "项目信息无效" }, { status: 400, headers: HEADERS });
  if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
  if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
  if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
  if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof StudentProjectForbiddenError) return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
  console.error({ requestId, route: "agent-projects", errorName: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "项目暂时不可用" }, { status: 500, headers: HEADERS });
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID(); let connection: DatabaseConnection | undefined;
  try { validateRequestSource(request); const config = readEnv(process.env); const session = await requireStudentSession(request, config.sessionSecret); connection = createDb(config.databasePath); return NextResponse.json(listStudentProjects(connection, session), { headers: HEADERS }); }
  catch (error) { return failure(error, requestId); } finally { connection?.sqlite.close(); }
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID(); let connection: DatabaseConnection | undefined;
  try { validateRequestProtocol(request); const config = readEnv(process.env); const session = await requireStudentSession(request, config.sessionSecret); const input = await parseLimitedRequestBody(request, StudentProjectCreateSchema, 8 * 1024); connection = createDb(config.databasePath); return NextResponse.json(createStudentProject(connection, session, input), { status: 201, headers: HEADERS }); }
  catch (error) { return failure(error, requestId); } finally { connection?.sqlite.close(); }
}


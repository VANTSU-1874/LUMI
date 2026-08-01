import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  disputeOwnedStudentMemory,
  StudentMemoryStudentActionForbiddenError,
  StudentMemoryStudentIdentityNotFoundError,
} from "@/lib/agent/student-memory";
import {
  BadRequestError,
  ForbiddenRequestError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import {
  requireStudentSession,
  studentAwareForbiddenPayload,
  StudentRoleForbiddenError,
  StudentSessionRequiredError,
} from "@/lib/auth/project-session";
import { parseLimitedRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import {
  StudentMemoryDisputeInputSchema,
  StudentMemoryDisputeNoteSchema,
  StudentMemoryKindSchema,
} from "@/lib/domain/student-memory";

const HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
const ParamsSchema = z.object({ memoryId: z.string().uuid() }).strict();
const BodySchema = z.object({
  kind: StudentMemoryKindSchema,
  note: StudentMemoryDisputeNoteSchema.nullable().optional().default(null),
}).strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ memoryId: string }> },
) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const actor = await requireStudentSession(request, config.sessionSecret);
    const params = ParamsSchema.parse(await context.params);
    const body = await parseLimitedRequestBody(request, BodySchema, 4 * 1024);
    const input = StudentMemoryDisputeInputSchema.parse({ ...params, ...body });
    connection = createDb(config.databasePath);
    const memory = disputeOwnedStudentMemory(connection.db, actor, input);
    if (!memory) {
      return NextResponse.json({ error: "长期记忆不存在" }, { status: 404, headers: HEADERS });
    }
    return NextResponse.json({ memory }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof BadRequestError || error instanceof z.ZodError) {
      return NextResponse.json({ error: "记忆异议请求无效" }, { status: 400, headers: HEADERS });
    }
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
    }
    if (error instanceof UnsupportedMediaTypeError) {
      return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
    }
    if (error instanceof StudentSessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    }
    if (
      error instanceof StudentRoleForbiddenError
      || error instanceof ForbiddenRequestError
      || error instanceof StudentMemoryStudentActionForbiddenError
    ) {
      return NextResponse.json(
        error instanceof StudentMemoryStudentActionForbiddenError
          ? { error: error.message, code: error.code }
          : studentAwareForbiddenPayload(error),
        { status: 403, headers: HEADERS },
      );
    }
    if (error instanceof StudentMemoryStudentIdentityNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    }
    console.error({
      requestId,
      route: "student-memory-dispute",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "异议提交暂时不可用，请重试" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

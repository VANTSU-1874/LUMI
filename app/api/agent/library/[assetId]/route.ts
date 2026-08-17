import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  requireStudentSession,
  StudentRoleForbiddenError,
  StudentSessionRequiredError,
} from "@/lib/auth/project-session";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import {
  deleteStudentLibraryAsset,
  StudentLibraryCleanupError,
  StudentLibraryForbiddenError,
  StudentLibraryNotFoundError,
} from "@/lib/agent/student-library";

type RouteContext = { params: Promise<{ assetId: string }> };
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const actor = await requireStudentSession(request, config.sessionSecret);
    const assetId = z.string().uuid().parse((await context.params).assetId);
    connection = createDb(config.databasePath);
    return NextResponse.json(
      await deleteStudentLibraryAsset(connection, actor, assetId, config.evidenceRoot),
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof StudentLibraryNotFoundError) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    }
    if (error instanceof StudentSessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    }
    if (error instanceof StudentRoleForbiddenError || error instanceof StudentLibraryForbiddenError) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    }
    if (error instanceof StudentLibraryCleanupError) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
    }
    console.error({ requestId, route: "student-library-delete", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法删除文件" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}


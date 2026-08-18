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
  openStudentLibraryAsset,
  StudentLibraryForbiddenError,
  StudentLibraryNotFoundError,
} from "@/lib/agent/student-library";

type RouteContext = { params: Promise<{ assetId: string }> };
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Accept-Ranges": "none",
};

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const actor = await requireStudentSession(request, config.sessionSecret);
    if (request.headers.has("range")) {
      return NextResponse.json({ error: "不支持分段读取" }, { status: 416, headers: PRIVATE_HEADERS });
    }
    const assetId = z.string().uuid().parse((await context.params).assetId);
    connection = createDb(config.databasePath);
    const file = await openStudentLibraryAsset(connection, actor, assetId, config.evidenceRoot);
    const download = request.nextUrl.searchParams.get("download") === "1";
    const extension = file.contentType === "image/png" ? "png" : file.contentType === "image/jpeg" ? "jpg" : "webp";
    return new NextResponse(Buffer.from(file.bytes), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": file.contentType,
        "Content-Length": String(file.size),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${assetId}.${extension}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      },
    });
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    }
    if (
      error instanceof z.ZodError
      || error instanceof StudentRoleForbiddenError
      || error instanceof StudentLibraryForbiddenError
      || error instanceof StudentLibraryNotFoundError
    ) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    }
    console.error({ requestId, route: "student-library-content", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "文件暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

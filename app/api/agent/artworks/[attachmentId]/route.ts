import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { NextResponse, type NextRequest } from "next/server";

import { openAgentArtwork, AgentArtworkNotFoundError } from "@/lib/agent/artwork-attachment";
import {
  requireStudentSession,
  StudentRoleForbiddenError,
  StudentSessionRequiredError,
} from "@/lib/auth/project-session";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";

type RouteContext = { params: Promise<{ attachmentId: string }> };
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
      return NextResponse.json(
        { error: "不支持分段读取" },
        { status: 416, headers: PRIVATE_HEADERS },
      );
    }
    const { attachmentId } = await context.params;
    connection = createDb(config.databasePath);
    const file = await openAgentArtwork(
      connection,
      actor,
      attachmentId,
      config.evidenceRoot,
    );
    const body = Readable.toWeb(file.stream) as ReadableStream<Uint8Array>;
    const extension = file.contentType === "image/png"
      ? "png"
      : file.contentType === "image/jpeg" ? "jpg" : "webp";
    return new NextResponse(body, {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": file.contentType,
        "Content-Length": String(file.size),
        "Content-Disposition": `inline; filename="${attachmentId}.${extension}"`,
      },
    });
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    }
    if (error instanceof StudentRoleForbiddenError) {
      return NextResponse.json({ error: "作品图片不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    }
    if (error instanceof AgentArtworkNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404, headers: PRIVATE_HEADERS });
    }
    console.error({
      requestId,
      route: "agent-artwork-get",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "作品图片暂时不可用" },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  } finally {
    connection?.sqlite.close();
  }
}

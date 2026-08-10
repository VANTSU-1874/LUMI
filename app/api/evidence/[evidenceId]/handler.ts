import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

import { after, NextResponse, type NextRequest } from "next/server";

import { validateRequestSource } from "@/lib/auth/route-handler";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { deletePrivateEvidence, EvidenceCleanupPendingError, openPrivateEvidence, PrivateEvidenceNotFoundError } from "@/lib/services/private-evidence";

type RouteContext = { params: Promise<{ evidenceId: string }> };
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "none" };

type AfterResponseScheduler = (task: () => Promise<void>) => void;

export function scheduleCleanupAfterResponse(
  error: EvidenceCleanupPendingError,
  schedule: AfterResponseScheduler = after,
  requestId: string,
) {
  try {
    schedule(async () => {
      try { await error.retryCleanup(); }
      catch (cleanupError) {
        console.error({
          requestId,
          route: "private-evidence-cleanup",
          errorName: cleanupError instanceof Error ? cleanupError.name : "UnknownError",
        });
      }
    });
  } catch (scheduleError) {
    console.error({
      requestId,
      route: "private-evidence-cleanup-schedule",
      errorName: scheduleError instanceof Error ? scheduleError.name : "UnknownError",
    });
  }
}

async function session(request: NextRequest, secret: string) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return undefined;
  try { return await verifySession(token, secret); } catch { return undefined; }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const actor = await session(request, config.sessionSecret);
    if (!actor) return NextResponse.json({ error: "请先登录" }, { status: 401, headers: PRIVATE_HEADERS });
    if (request.headers.has("range")) return NextResponse.json({ error: "不支持分段读取" }, { status: 416, headers: PRIVATE_HEADERS });
    const { evidenceId } = await context.params;
    connection = createDb(config.databasePath);
    const file = await openPrivateEvidence(connection.db, actor, evidenceId, config.evidenceRoot);
    const body = Readable.toWeb(file.stream) as ReadableStream<Uint8Array>;
    const extension = file.contentType === "image/png" ? "png" : file.contentType === "image/jpeg" ? "jpg" : "webp";
    return new NextResponse(body, { status: 200, headers: { ...PRIVATE_HEADERS, "Content-Type": file.contentType, "Content-Length": String(file.size), "Content-Disposition": `inline; filename="${evidenceId}.${extension}"` } });
  } catch (error) {
    if (error instanceof PrivateEvidenceNotFoundError) return NextResponse.json({ error: "证据不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "private-evidence-get", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "证据暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

export async function deleteEvidenceRoute(
  request: NextRequest,
  context: RouteContext,
  dependencies: {
    deleteEvidence?: typeof deletePrivateEvidence;
    schedule?: AfterResponseScheduler;
  } = {},
) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const actor = await session(request, config.sessionSecret);
    if (!actor) return NextResponse.json({ error: "请先登录" }, { status: 401, headers: PRIVATE_HEADERS });
    const { evidenceId } = await context.params;
    connection = createDb(config.databasePath);
    await (dependencies.deleteEvidence ?? deletePrivateEvidence)(connection.db, actor, evidenceId, config.evidenceRoot);
    return new NextResponse(null, { status: 204, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof PrivateEvidenceNotFoundError) return new NextResponse(null, { status: 204, headers: PRIVATE_HEADERS });
    if (error instanceof EvidenceCleanupPendingError) {
      scheduleCleanupAfterResponse(error, dependencies.schedule ?? after, requestId);
      return new NextResponse(null, { status: 204, headers: PRIVATE_HEADERS });
    }
    console.error({ requestId, route: "private-evidence-delete", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "删除暂时不可用，请重试" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return deleteEvidenceRoute(request, context);
}

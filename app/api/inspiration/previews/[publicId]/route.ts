import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse, type NextRequest } from "next/server";

import { InspirationBrowseRoleForbiddenError, InspirationBrowseSessionRequiredError, requireInspirationBrowseSession } from "@/lib/auth/inspiration-browse-session";
import { TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import { ForbiddenRequestError } from "@/lib/auth/errors";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { resolveInspirationPreview } from "@/lib/services/inspiration-preview";
import { InspirationViewerIdentityForbiddenError, readInspirationViewerScope } from "@/lib/services/inspiration-viewer-scope";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'" };
type RouteContext = { params: Promise<{ publicId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID(); let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env); const actor = await requireInspirationBrowseSession(request, config.sessionSecret);
    connection = createDb(config.databasePath);
    const viewer = readInspirationViewerScope(connection.db, actor);
    const preview = resolveInspirationPreview(connection.db, viewer, (await context.params).publicId);
    if (!preview) return new NextResponse(null, { status: 404, headers: HEADERS });
    if (preview.kind === "SYNTHETIC") return new NextResponse(preview.svg, { headers: { ...HEADERS, "Content-Type": "image/svg+xml; charset=utf-8", "Content-Disposition": "inline; filename=\"inspiration-preview.svg\"" } });
    const dataRoot = path.resolve(path.dirname(path.resolve(config.databasePath)));
    const filePath = path.resolve(dataRoot, preview.asset.storagePath);
    if (!filePath.startsWith(`${dataRoot}${path.sep}`)) return new NextResponse(null, { status: 404, headers: HEADERS });
    const bytes = await readFile(filePath);
    if (bytes.byteLength !== preview.asset.bytes || createHash("sha256").update(bytes).digest("hex") !== preview.asset.sha256) return new NextResponse(null, { status: 404, headers: HEADERS });
    return new NextResponse(bytes, { headers: { ...HEADERS, "Content-Type": preview.asset.mimeType, "Content-Length": String(bytes.byteLength), ETag: `\"sha256-${preview.asset.sha256}\"`, "Content-Disposition": "inline" } });
  } catch (error) {
    if (error instanceof InspirationBrowseSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof InspirationBrowseRoleForbiddenError || error instanceof InspirationViewerIdentityForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: "当前身份不能查看灵感预览" }, { status: 403, headers: HEADERS });
    console.error({ requestId, route: "inspiration-preview", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "预览暂时不可用" }, { status: 500, headers: HEADERS });
  } finally { connection?.sqlite.close(); }
}

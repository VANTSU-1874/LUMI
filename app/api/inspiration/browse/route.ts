import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { InspirationBrowseRoleForbiddenError, InspirationBrowseSessionRequiredError, requireInspirationBrowseSession } from "@/lib/auth/inspiration-browse-session";
import { ForbiddenRequestError } from "@/lib/auth/errors";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { readPublishedInspirationBrowser } from "@/lib/services/inspiration-browser";
import { InspirationViewerIdentityForbiddenError, readInspirationViewerScope } from "@/lib/services/inspiration-viewer-scope";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const actor = await requireInspirationBrowseSession(request, config.sessionSecret);
    const rawLimit = request.nextUrl.searchParams.get("limit") ?? "12";
    const query = request.nextUrl.searchParams.get("q") ?? "";
    const topic = request.nextUrl.searchParams.get("topic");
    const cursor = request.nextUrl.searchParams.get("cursor");
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 30 || query.length > 160 || (topic?.length ?? 0) > 80 || (cursor?.length ?? 0) > 240) {
      return NextResponse.json({ error: "浏览参数无效" }, { status: 400, headers: HEADERS });
    }
    connection = createDb(config.databasePath);
    readInspirationViewerScope(connection.db, actor);
    return NextResponse.json(readPublishedInspirationBrowser(connection.db, { cursor, limit: Number(rawLimit), query, topic }), { headers: HEADERS });
  } catch (error) {
    if (error instanceof InspirationBrowseSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof InspirationBrowseRoleForbiddenError || error instanceof InspirationViewerIdentityForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: "当前身份不能浏览灵感 Wiki" }, { status: 403, headers: HEADERS });
    if (error instanceof Error && error.message === "INVALID_CURSOR") return NextResponse.json({ error: "浏览游标无效" }, { status: 400, headers: HEADERS });
    console.error({ requestId, route: "inspiration-browser", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "灵感案例暂时不可用" }, { status: 500, headers: HEADERS });
  } finally { connection?.sqlite.close(); }
}

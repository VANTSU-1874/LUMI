import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { validateRequestSource } from "@/lib/auth/route-handler";
import { readUnifiedSession } from "@/lib/auth/unified-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { InvalidEvidenceListQueryError, listPrivateEvidence, PrivateEvidenceNotFoundError } from "@/lib/services/private-evidence";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const actor = await readUnifiedSession(request, config.sessionSecret);
    if (!actor) return NextResponse.json({ error: "请先登录" }, { status: 401, headers: PRIVATE_HEADERS });
    connection = createDb(config.databasePath);
    return NextResponse.json(listPrivateEvidence(connection.db, actor, {
      limit: request.nextUrl.searchParams.get("limit"),
      cursor: request.nextUrl.searchParams.get("cursor"),
      studentId: request.nextUrl.searchParams.get("studentId"),
    }), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof InvalidEvidenceListQueryError) return NextResponse.json({ error: error.message }, { status: 400, headers: PRIVATE_HEADERS });
    if (error instanceof PrivateEvidenceNotFoundError) return NextResponse.json({ error: "证据列表不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    console.error({ requestId, route: "private-evidence-list", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "证据列表暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally { connection?.sqlite.close(); }
}

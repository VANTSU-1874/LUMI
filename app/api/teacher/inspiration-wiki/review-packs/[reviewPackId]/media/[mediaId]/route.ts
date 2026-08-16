import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse, type NextRequest } from "next/server";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import { requireTeacherSession, TeacherRoleForbiddenError, TeacherSessionRequiredError } from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { EvidenceGapReviewNotFoundError, readTeacherEvidenceGapReviewMedia } from "@/lib/services/inspiration-wiki-evidence-gap-reviews";
import { readTeacherReviewPackMedia, ReviewPackNotFoundError } from "@/lib/services/inspiration-wiki-review-packs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
type RouteContext = { params: Promise<{ reviewPackId: string; mediaId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    const { reviewPackId, mediaId } = await context.params;
    connection = createDb(config.databasePath);
    let asset;
    try {
      asset = readTeacherReviewPackMedia(connection, session, reviewPackId, mediaId);
    } catch (error) {
      if (!(error instanceof ReviewPackNotFoundError)) throw error;
      asset = readTeacherEvidenceGapReviewMedia(connection, session, reviewPackId, mediaId);
    }
    const dataRoot = path.resolve(path.dirname(path.resolve(config.databasePath)));
    const filePath = path.resolve(dataRoot, asset.storagePath);
    if (!filePath.startsWith(`${dataRoot}${path.sep}`)) throw new ReviewPackNotFoundError();
    const bytes = await readFile(filePath);
    if (bytes.byteLength !== asset.bytes) throw new ReviewPackNotFoundError();
    if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new ReviewPackNotFoundError();
    return new Response(bytes, {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": asset.mimeType,
        "Content-Length": String(bytes.byteLength),
        ETag: `"sha256-${asset.sha256}"`,
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof TeacherRoleForbiddenError || error instanceof TeacherIdentityForbiddenError || error instanceof ForbiddenRequestError) {
      return NextResponse.json({ error: "仅教师可以访问" }, { status: 403, headers: PRIVATE_HEADERS });
    }
    if (error instanceof ReviewPackNotFoundError || error instanceof EvidenceGapReviewNotFoundError) return NextResponse.json({ error: "审核媒体不存在" }, { status: 404, headers: PRIVATE_HEADERS });
    return NextResponse.json({ error: "审核媒体暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

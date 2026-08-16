import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { InspirationBrowseRoleForbiddenError, InspirationBrowseSessionRequiredError, requireInspirationBrowseSession } from "@/lib/auth/inspiration-browse-session";
import { ForbiddenRequestError, PayloadTooLargeError } from "@/lib/auth/errors";
import { assertDeclaredBodyWithinLimit, validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { WikiMultimodalSearchResponseSchema } from "@/lib/domain/inspiration-wiki/multimodal-retrieval-contracts";
import { searchWikiMultimodal, visualFeatureVector } from "@/lib/services/inspiration-wiki-multimodal";
import { InspirationViewerIdentityForbiddenError, readInspirationViewerScope } from "@/lib/services/inspiration-viewer-scope";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 512 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    assertDeclaredBodyWithinLimit(request, MAX_REQUEST_BYTES);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
      return NextResponse.json({ error: "检索请求格式无效" }, { status: 415, headers: HEADERS });
    }
    const config = readEnv(process.env);
    const actor = await requireInspirationBrowseSession(request, config.sessionSecret);
    connection = createDb(config.databasePath);
    readInspirationViewerScope(connection.db, actor);
    const form = await request.formData();
    const queryValue = form.get("query");
    const topicValue = form.get("topic");
    const imageValue = form.get("image");
    const query = typeof queryValue === "string" ? queryValue.trim() : "";
    const topic = typeof topicValue === "string" ? topicValue.trim() : "";
    const image = imageValue instanceof File && imageValue.size > 0 ? imageValue : null;
    if ((!query && !image) || query.length > 160 || topic.length > 80) return NextResponse.json({ error: "请输入文字或选择一张图片" }, { status: 400, headers: HEADERS });
    if (image && (image.size > MAX_IMAGE_BYTES || !ALLOWED_IMAGE_TYPES.has(image.type))) {
      return NextResponse.json({ error: "图片需为 JPG、PNG 或 WebP，且不超过 8 MB" }, { status: image.size > MAX_IMAGE_BYTES ? 413 : 415, headers: HEADERS });
    }
    const imageBytes = image ? Buffer.from(await image.arrayBuffer()) : null;
    const imageVector = imageBytes ? await visualFeatureVector(imageBytes) : null;
    const result = await searchWikiMultimodal(connection.db, {
      query,
      topic,
      image: imageBytes,
      imageVector,
      limit: 24,
    });
    return NextResponse.json(WikiMultimodalSearchResponseSchema.parse(result), { headers: HEADERS });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: "图片需为 JPG、PNG 或 WebP，且不超过 8 MB" }, { status: 413, headers: HEADERS });
    if (error instanceof InspirationBrowseSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof InspirationBrowseRoleForbiddenError || error instanceof InspirationViewerIdentityForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: "当前身份不能使用灵感 Wiki 检索" }, { status: 403, headers: HEADERS });
    if (error instanceof Error && /IMAGE_|Input buffer|unsupported image format|corrupt/i.test(error.message)) return NextResponse.json({ error: "无法读取这张图片，请更换 JPG、PNG 或 WebP" }, { status: 422, headers: HEADERS });
    console.error({ requestId, route: "inspiration-multimodal-search", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "多模态检索暂时不可用" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

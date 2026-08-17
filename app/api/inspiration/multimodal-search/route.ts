import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { InspirationBrowseRoleForbiddenError, InspirationBrowseSessionRequiredError, requireInspirationBrowseSession } from "@/lib/auth/inspiration-browse-session";
import { ForbiddenRequestError, PayloadTooLargeError } from "@/lib/auth/errors";
import { assertDeclaredBodyWithinLimit, validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { WikiMultimodalSearchResponseSchema } from "@/lib/domain/inspiration-wiki/multimodal-retrieval-contracts";
import { readPublishedInspirationBrowser } from "@/lib/services/inspiration-browser";
import { searchWikiMultimodal, visualFeatureVector } from "@/lib/services/inspiration-wiki-multimodal";
import { InspirationViewerIdentityForbiddenError, readInspirationViewerScope } from "@/lib/services/inspiration-viewer-scope";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 512 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

type DiagnosticStage =
  | "REQUEST_SOURCE"
  | "CONFIG"
  | "SESSION"
  | "DATABASE"
  | "VIEWER_SCOPE"
  | "FORM_DATA"
  | "IMAGE_DECODE"
  | "RETRIEVAL"
  | "RESPONSE_VALIDATION";

type UploadedImage = {
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

function uploadedImage(value: FormDataEntryValue | null): UploadedImage | null {
  if (typeof value === "string" || value === null) return null;
  if (
    typeof value.size !== "number"
    || typeof value.type !== "string"
    || typeof value.arrayBuffer !== "function"
  ) return null;
  return value.size > 0 ? value : null;
}

function textFallback(connection: DatabaseConnection, query: string, topic: string) {
  const fallback = readPublishedInspirationBrowser(connection.db, { query, topic, limit: 24 });
  return WikiMultimodalSearchResponseSchema.parse({
    items: fallback.items.map((item) => ({
      ...item,
      retrieval: { score: 1, channels: ["文字特征" as const] },
    })),
    appliedFacets: fallback.appliedFacets,
    retrieval: {
      mode: "TEXT_FALLBACK",
      state: "DEGRADED",
      indexId: null,
      encoderVersion: null,
      resultCount: fallback.items.length,
      notice: "多模态索引暂时不可用，已保留原有文字检索。",
    },
  });
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  let diagnosticStage: DiagnosticStage = "REQUEST_SOURCE";
  let fallbackQuery = "";
  let fallbackTopic = "";
  try {
    validateRequestSource(request);
    assertDeclaredBodyWithinLimit(request, MAX_REQUEST_BYTES);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
      return NextResponse.json({ error: "检索请求格式无效" }, { status: 415, headers: HEADERS });
    }
    diagnosticStage = "CONFIG";
    const config = readEnv(process.env);
    diagnosticStage = "SESSION";
    const actor = await requireInspirationBrowseSession(request, config.sessionSecret);
    diagnosticStage = "DATABASE";
    connection = createDb(config.databasePath);
    diagnosticStage = "VIEWER_SCOPE";
    readInspirationViewerScope(connection.db, actor);
    diagnosticStage = "FORM_DATA";
    const form = await request.formData();
    const queryValue = form.get("query");
    const topicValue = form.get("topic");
    const imageValue = form.get("image");
    const query = typeof queryValue === "string" ? queryValue.trim() : "";
    const topic = typeof topicValue === "string" ? topicValue.trim() : "";
    fallbackQuery = query;
    fallbackTopic = topic;
    const image = uploadedImage(imageValue);
    if ((!query && !image) || query.length > 160 || topic.length > 80) return NextResponse.json({ error: "请输入文字或选择一张图片" }, { status: 400, headers: HEADERS });
    if (image && (image.size > MAX_IMAGE_BYTES || !ALLOWED_IMAGE_TYPES.has(image.type))) {
      return NextResponse.json({ error: "图片需为 JPG、PNG 或 WebP，且不超过 8 MB" }, { status: image.size > MAX_IMAGE_BYTES ? 413 : 415, headers: HEADERS });
    }
    const imageBytes = image ? Buffer.from(await image.arrayBuffer()) : null;
    diagnosticStage = "IMAGE_DECODE";
    const imageVector = imageBytes ? await visualFeatureVector(imageBytes) : null;
    diagnosticStage = "RETRIEVAL";
    const result = await searchWikiMultimodal(connection.db, {
      query,
      topic,
      image: imageBytes,
      imageVector,
      limit: 24,
    });
    diagnosticStage = "RESPONSE_VALIDATION";
    return NextResponse.json(WikiMultimodalSearchResponseSchema.parse(result), { headers: HEADERS });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: "图片需为 JPG、PNG 或 WebP，且不超过 8 MB" }, { status: 413, headers: HEADERS });
    if (error instanceof InspirationBrowseSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof InspirationBrowseRoleForbiddenError || error instanceof InspirationViewerIdentityForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ error: "当前身份不能使用灵感 Wiki 检索" }, { status: 403, headers: HEADERS });
    if (error instanceof Error && /IMAGE_|Input buffer|unsupported image format|corrupt/i.test(error.message)) return NextResponse.json({ error: "无法读取这张图片，请更换 JPG、PNG 或 WebP" }, { status: 422, headers: HEADERS });
    let fallbackState: "NOT_ATTEMPTED" | "SUCCEEDED" | "FAILED" = "NOT_ATTEMPTED";
    if (connection && fallbackQuery && (diagnosticStage === "RETRIEVAL" || diagnosticStage === "RESPONSE_VALIDATION")) {
      try {
        const fallback = textFallback(connection, fallbackQuery, fallbackTopic);
        fallbackState = "SUCCEEDED";
        console.error({
          requestId,
          route: "inspiration-multimodal-search",
          diagnosticStage,
          errorName: error instanceof Error ? error.name : "UnknownError",
          fallbackState,
        });
        return NextResponse.json(fallback, { headers: HEADERS });
      } catch {
        fallbackState = "FAILED";
      }
    }
    console.error({
      requestId,
      route: "inspiration-multimodal-search",
      diagnosticStage,
      errorName: error instanceof Error ? error.name : "UnknownError",
      fallbackState,
    });
    return NextResponse.json({ error: "多模态检索暂时不可用" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}

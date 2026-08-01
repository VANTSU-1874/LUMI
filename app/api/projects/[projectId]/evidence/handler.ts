import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, RateLimitedError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { assertDeclaredBodyWithinLimit, parseLimitedRequestBody, validateRequestSource } from "@/lib/auth/route-handler";
import { resolveTrustedSource } from "@/lib/auth/trusted-source";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { PublicEvidenceRecordSchema } from "@/lib/domain/evidence";
import { EvidenceProbePathMismatchError } from "@/lib/domain/evidence-probe";
import {
  MAX_IMAGE_BYTES,
  EvidenceDraftSchema,
  EvidenceForbiddenError,
  EvidenceNotFoundError,
  EvidenceStageConflictError,
  ImageTooLargeError,
  InvalidImageError,
  assertEvidenceOwnership,
  saveEvidence,
} from "@/lib/services/evidence";
import { consumeActionRateLimit, createActionRateLimitKey } from "@/lib/services/action-rate-limit";
import { readStreamWithLimit } from "@/lib/security/uploads";

type RouteContext = { params: Promise<{ projectId: string }> };
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function mediaType(request: NextRequest) {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
}

async function readMultipart(request: NextRequest) {
  const maxBytes = MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES;
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) throw new PayloadTooLargeError();
  const bytes = await readStreamWithLimit(request.body, maxBytes);
  if (bytes.byteLength > maxBytes) throw new PayloadTooLargeError();
  const contentType = request.headers.get("content-type");
  if (!contentType) throw new UnsupportedMediaTypeError();
  let form: FormData;
  try {
    form = await new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body: bytes }).formData();
  } catch {
    throw new BadRequestError();
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new BadRequestError();
  const fields = z.object({
    kind: z.literal("IMAGE"),
    label: z.string().trim().min(1).max(80),
    signalLayer: z.enum(["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"]),
  }).strict().parse({ kind: form.get("kind"), label: form.get("label"), signalLayer: form.get("signalLayer") });
  return {
    ...fields,
    bytes: new Uint8Array(await file.arrayBuffer()),
    declaredMime: file.type,
    originalName: file.name,
  } as const;
}

function publicRecord(row: Awaited<ReturnType<typeof saveEvidence>>) {
  return PublicEvidenceRecordSchema.parse({
    id: row.id,
    kind: row.kind,
    signalLayer: row.signalLayer,
    label: row.label,
    verificationStatus: row.verificationStatus,
    createdAt: row.createdAt.toISOString(),
  });
}

export function createEvidenceHandler(options: { maxRequests?: number } = {}) {
return async function POST(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const type = mediaType(request);
    if (type !== "application/json" && type !== "multipart/form-data") throw new UnsupportedMediaTypeError();
    const config = readEnv(process.env);
    const session = await requireStudentSession(request, config.sessionSecret);
    const { projectId } = await context.params;
    connection = createDb(config.databasePath);
    assertEvidenceOwnership(connection.db, session, projectId);
    assertDeclaredBodyWithinLimit(
      request,
      type === "application/json" ? 16 * 1024 : MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES,
    );
    const source = resolveTrustedSource(request.headers, { nodeEnv: process.env.NODE_ENV, secret: config.authProxySecret });
    consumeActionRateLimit(
      connection.db,
      createActionRateLimitKey(source.id, session.userId, projectId, "evidence"),
      { maxRequests: options.maxRequests ?? 30, windowSeconds: 60 },
    );
    const draft = type === "application/json"
      ? await parseLimitedRequestBody(request, EvidenceDraftSchema, 16 * 1024)
      : await readMultipart(request);
    const row = await saveEvidence(connection.db, session, projectId, draft, { root: config.evidenceRoot });
    return NextResponse.json(publicRecord(row), { status: 201 });
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    if (error instanceof EvidenceForbiddenError || error instanceof EvidenceNotFoundError) return NextResponse.json({ ok: false, error: "项目不存在" }, { status: 404 });
    if (error instanceof EvidenceStageConflictError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    if (error instanceof EvidenceProbePathMismatchError) return NextResponse.json({ ok: false, error: error.message, code: "EVIDENCE_TOOL_PATH_MISMATCH" }, { status: 409 });
    if (error instanceof PayloadTooLargeError || error instanceof ImageTooLargeError) return NextResponse.json({ ok: false, error: error.message }, { status: 413 });
    if (error instanceof UnsupportedMediaTypeError || error instanceof InvalidImageError) return NextResponse.json({ ok: false, error: error.message }, { status: 415 });
    if (error instanceof RateLimitedError) return NextResponse.json({ ok: false, error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof BadRequestError || error instanceof z.ZodError) return NextResponse.json({ ok: false, error: "证据内容无效" }, { status: 400 });
    console.error({ requestId, route: "evidence", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ ok: false, error: "服务暂时不可用" }, { status: 500 });
  } finally {
    connection?.sqlite.close();
  }
};
}

export const POST = createEvidenceHandler();

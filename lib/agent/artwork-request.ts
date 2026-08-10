import type { NextRequest } from "next/server";

import {
  BadRequestError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import {
  assertDeclaredBodyWithinLimit,
  parseLimitedRequestBody,
  readLimitedRequestBody,
  validateRequestProtocol,
  validateRequestSource,
} from "@/lib/auth/route-handler";
import { MAX_IMAGE_BYTES } from "@/lib/security/uploads";

import { prepareAgentArtwork } from "./artwork-attachment";
import { AgentTurnRequestSchema } from "./contracts";

const JSON_BODY_LIMIT = 16 * 1024;
const MULTIPART_BODY_LIMIT = MAX_IMAGE_BYTES + 64 * 1024;

function mediaType(request: NextRequest) {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
}

function parsePublicAgentTurnRequest(value: unknown) {
  const input = AgentTurnRequestSchema.parse(value);
  // `continuation` carries a server-curated excerpt of a previous answer.
  // Never allow a browser request to forge that durable run linkage.
  if (input.continuation) throw new BadRequestError();
  return input;
}

export async function parseAgentTurnRequest(request: NextRequest) {
  if (mediaType(request) === "application/json") {
    validateRequestProtocol(request);
    return {
      input: parsePublicAgentTurnRequest(
        await parseLimitedRequestBody(request, AgentTurnRequestSchema, JSON_BODY_LIMIT),
      ),
      artwork: undefined,
    };
  }
  if (mediaType(request) !== "multipart/form-data") throw new UnsupportedMediaTypeError();
  validateRequestSource(request);
  const declaredLength = request.headers.get("content-length");
  if (!declaredLength || !/^\d+$/.test(declaredLength)) throw new BadRequestError();
  assertDeclaredBodyWithinLimit(request, MULTIPART_BODY_LIMIT);
  try {
    const bytes = await readLimitedRequestBody(request, MULTIPART_BODY_LIMIT);
    if (bytes.byteLength !== Number(declaredLength)) throw new BadRequestError();
    const bufferedRequest = new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type")! },
      body: bytes,
    });
    const form = await bufferedRequest.formData();
    if (
      form.getAll("payload").length !== 1 ||
      form.getAll("artwork").length !== 1 ||
      [...form.keys()].some((key) => key !== "payload" && key !== "artwork")
    ) {
      throw new BadRequestError();
    }
    const rawPayload = form.get("payload");
    const rawArtwork = form.get("artwork");
    if (typeof rawPayload !== "string" || !(rawArtwork instanceof File)) {
      throw new BadRequestError();
    }
    const payloadBytes = new TextEncoder().encode(rawPayload).byteLength;
    if (
      payloadBytes > JSON_BODY_LIMIT ||
      rawArtwork.size + payloadBytes > bytes.byteLength
    ) throw new BadRequestError();
    if (rawArtwork.size > MAX_IMAGE_BYTES) throw new PayloadTooLargeError();
    const input = parsePublicAgentTurnRequest(JSON.parse(rawPayload));
    const artwork = await prepareAgentArtwork({
      bytes: new Uint8Array(await rawArtwork.arrayBuffer()),
      declaredMime: rawArtwork.type,
    });
    return { input, artwork };
  } catch (error) {
    if (
      error instanceof BadRequestError ||
      error instanceof PayloadTooLargeError ||
      error instanceof UnsupportedMediaTypeError ||
      (error instanceof Error && ["InvalidImageError", "ImageTooLargeError"].includes(error.name))
    ) {
      throw error;
    }
    throw new BadRequestError();
  }
}

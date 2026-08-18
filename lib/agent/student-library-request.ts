import type { NextRequest } from "next/server";

import {
  BadRequestError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "@/lib/auth/errors";
import {
  assertDeclaredBodyWithinLimit,
  readLimitedRequestBody,
  validateRequestSource,
} from "@/lib/auth/route-handler";
import { MAX_IMAGE_BYTES } from "@/lib/security/uploads";

import { prepareAgentArtwork } from "./artwork-attachment";

const MULTIPART_BODY_LIMIT = MAX_IMAGE_BYTES + 64 * 1024;

type MultipartFile = {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

function isMultipartFile(value: FormDataEntryValue | null): value is FormDataEntryValue & MultipartFile {
  if (!value || typeof value === "string") return false;
  const candidate = value as unknown as Partial<MultipartFile>;
  return typeof candidate.name === "string"
    && typeof candidate.size === "number"
    && typeof candidate.type === "string"
    && typeof candidate.arrayBuffer === "function";
}
export async function parseStudentLibraryUpload(request: NextRequest) {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "multipart/form-data") throw new UnsupportedMediaTypeError();
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
      form.getAll("file").length !== 1
      || form.getAll("taskId").length > 1
      || [...form.keys()].some((key) => key !== "file" && key !== "taskId")
    ) throw new BadRequestError();

    const rawFile = form.get("file");
    const rawTaskId = form.get("taskId");
    if (!isMultipartFile(rawFile) || (rawTaskId !== null && typeof rawTaskId !== "string")) {
      throw new BadRequestError();
    }
    if (rawFile.size > MAX_IMAGE_BYTES) throw new PayloadTooLargeError();
    const taskId = rawTaskId?.trim() || null;
    if (taskId && !/^[0-9a-f-]{36}$/i.test(taskId)) throw new BadRequestError();
    const artwork = await prepareAgentArtwork({
      bytes: new Uint8Array(await rawFile.arrayBuffer()),
      declaredMime: rawFile.type,
    });
    return { artwork, originalName: rawFile.name, taskId };
  } catch (error) {
    if (
      error instanceof BadRequestError
      || error instanceof PayloadTooLargeError
      || error instanceof UnsupportedMediaTypeError
      || (error instanceof Error && ["InvalidImageError", "ImageTooLargeError"].includes(error.name))
    ) throw error;
    throw new BadRequestError();
  }
}


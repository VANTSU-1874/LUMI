import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { createConcurrencyGate } from "./concurrency-gate";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 12_000_000;
export const MAX_IMAGE_DIMENSION = 10_000;
export const MAX_CONCURRENT_IMAGE_OPERATIONS = 2;
export const TRUSTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".webp"] as const;
export type TrustedImageExtension = (typeof TRUSTED_IMAGE_EXTENSIONS)[number];

export class InvalidImageError extends Error {
  constructor(message = "图片格式无效") { super(message); this.name = "InvalidImageError"; }
}

export class ImageTooLargeError extends Error {
  constructor() { super("图片大小不能超过5MiB"); this.name = "ImageTooLargeError"; }
}

export class UnsafeEvidencePathError extends Error {
  constructor() {
    super("证据存储路径不安全");
    this.name = "UnsafeEvidencePathError";
  }
}

const formats = {
  png: { mime: "image/png", extension: ".png" },
  jpeg: { mime: "image/jpeg", extension: ".jpg" },
  webp: { mime: "image/webp", extension: ".webp" },
} as const;

type TrustedImageFormat = keyof typeof formats;
const runImageOperation = createConcurrencyGate(MAX_CONCURRENT_IMAGE_OPERATIONS);

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function verifyPngChecksums(bytes: Uint8Array) {
  const input = Buffer.from(bytes);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!input.subarray(0, signature.length).equals(signature)) return;
  let offset = signature.length;
  let sawIdat = false;
  let sawIend = false;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > input.length) throw new InvalidImageError();
    const type = input.subarray(offset + 4, offset + 8).toString("ascii");
    const expected = input.readUInt32BE(offset + length + 8);
    if (crc32(input.subarray(offset + 4, offset + length + 8)) !== expected) throw new InvalidImageError();
    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") {
      sawIend = true;
      if (length !== 0 || end !== input.length) throw new InvalidImageError();
    }
    offset = end;
  }
  if (!sawIdat || !sawIend || offset !== input.length) throw new InvalidImageError();
}

async function decodeImage(bytes: Uint8Array, declaredMime: string, decodePixels: boolean) {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageTooLargeError();
  if (bytes.byteLength === 0) throw new InvalidImageError("图片不能为空");
  const input = Buffer.from(bytes);
  try {
    verifyPngChecksums(input);
    const decoder = sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
      pages: 1,
    });
    const metadata = await decoder.metadata();
    const format = metadata.format as TrustedImageFormat | undefined;
    const trusted = format ? formats[format] : undefined;
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const pages = metadata.pages ?? 1;
    if (
      !trusted ||
      trusted.mime !== declaredMime.trim().toLowerCase() ||
      width <= 0 ||
      height <= 0 ||
      width > MAX_IMAGE_DIMENSION ||
      height > MAX_IMAGE_DIMENSION ||
      width * height > MAX_IMAGE_PIXELS ||
      pages !== 1 ||
      (metadata.pageHeight !== undefined && metadata.pageHeight !== height)
    ) {
      throw new InvalidImageError();
    }
    if (decodePixels) await decoder.raw().toBuffer();
    return { format, width, height, ...trusted };
  } catch (error) {
    if (error instanceof ImageTooLargeError || error instanceof InvalidImageError) throw error;
    throw new InvalidImageError();
  }
}

export async function inspectImage(bytes: Uint8Array, declaredMime: string) {
  return runImageOperation(async () => {
    const decoded = await decodeImage(bytes, declaredMime, false);
    const pipeline = sharp(Buffer.from(bytes), {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
      pages: 1,
    }).rotate();
    let sanitized: Buffer;
    try {
      sanitized = decoded.format === "png"
        ? await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
        : decoded.format === "jpeg"
          ? await pipeline.jpeg({ quality: 90, progressive: false, mozjpeg: false }).toBuffer()
          : await pipeline.webp({ quality: 90, effort: 4 }).toBuffer();
    } catch {
      throw new InvalidImageError();
    }
    if (sanitized.byteLength > MAX_IMAGE_BYTES) throw new ImageTooLargeError();
    const metadata = await sharp(sanitized).metadata();
    return {
      mime: decoded.mime,
      extension: decoded.extension,
      digest: createHash("sha256").update(sanitized).digest("hex"),
      bytes: sanitized,
      width: metadata.width ?? decoded.width,
      height: metadata.height ?? decoded.height,
    };
  });
}

export async function validateStoredImage(bytes: Uint8Array, declaredMime: string) {
  return runImageOperation(async () => {
    const decoded = await decodeImage(bytes, declaredMime, true);
    return {
      mime: decoded.mime,
      extension: decoded.extension,
      digest: createHash("sha256").update(bytes).digest("hex"),
    };
  });
}

export function createStoredImageName(extension: TrustedImageExtension) {
  if (!TRUSTED_IMAGE_EXTENSIONS.includes(extension)) throw new InvalidImageError();
  return `${randomUUID()}${extension}`;
}

export async function readStreamWithLimit(stream: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("request body exceeded hard limit");
        throw new ImageTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function normalized(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

function assertContained(root: string, candidate: string) {
  const relative = path.relative(normalized(root), normalized(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new UnsafeEvidencePathError();
}

export async function resolveStoredEvidence(root: string, relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new UnsafeEvidencePathError();
  }
  if (!/^[A-Za-z0-9_-]{1,128}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/i.test(relativePath)) throw new UnsafeEvidencePathError();
  const canonicalRoot = await realpath(path.resolve(root));
  const candidate = path.resolve(canonicalRoot, ...relativePath.split("/"));
  assertContained(canonicalRoot, candidate);
  const canonicalFile = await realpath(candidate);
  assertContained(canonicalRoot, canonicalFile);
  const info = await lstat(canonicalFile);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) throw new UnsafeEvidencePathError();
  return { absolutePath: canonicalFile, size: info.size };
}

export function streamStoredEvidence(absolutePath: string) {
  return createReadStream(absolutePath, { highWaterMark: 64 * 1024 });
}

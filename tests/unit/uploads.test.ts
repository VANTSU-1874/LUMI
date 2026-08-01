// @vitest-environment node

import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  ImageTooLargeError,
  InvalidImageError,
  MAX_CONCURRENT_IMAGE_OPERATIONS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  createStoredImageName,
  inspectImage,
  readStreamWithLimit,
  resolveStoredEvidence,
  UnsafeEvidencePathError,
} from "@/lib/security/uploads";
import {
  animatedWebp,
  jpegWithMetadata,
  pngWithCorruptCrc,
  pngWithDimensions,
  pngWithText,
  pngWithoutImageData,
  validJpeg,
  validPng,
  validWebp,
} from "@/tests/helpers/image-fixtures";

describe("private image upload policy", () => {
  it("caps decoded images at 12 megapixels", () => {
    expect(MAX_IMAGE_PIXELS).toBe(12_000_000);
    expect(MAX_CONCURRENT_IMAGE_OPERATIONS).toBe(2);
    return expect(inspectImage(pngWithDimensions(4_001, 3_000), "image/png"))
      .rejects.toThrow(InvalidImageError);
  });

  it.each([
    [validPng, "image/png", ".png"],
    [validJpeg, "image/jpeg", ".jpg"],
    [validWebp, "image/webp", ".webp"],
  ] as const)("fully decodes and sanitizes a real %s image", async (bytes, mime, extension) => {
    const result = await inspectImage(bytes, mime);
    expect(result).toMatchObject({ mime, extension });
    const metadata = await sharp(result.bytes, { failOn: "error" }).metadata();
    expect(metadata.format).toBe(extension.slice(1).replace("jpg", "jpeg"));
    expect(metadata.pages ?? 1).toBe(1);
  });

  it("accepts exactly 5 MiB and rejects one byte over", async () => {
    await expect(inspectImage(pngWithText("padding", MAX_IMAGE_BYTES), "image/png")).resolves.toMatchObject({ extension: ".png" });
    await expect(inspectImage(pngWithText("padding", MAX_IMAGE_BYTES + 1), "image/png")).rejects.toThrow(ImageTooLargeError);
  });

  it.each([
    [Buffer.alloc(0), "image/png", "empty"],
    [Buffer.from("<svg><script>alert(1)</script></svg>"), "image/png", "svg"],
    [Buffer.from("MZ\u0000\u0000This program cannot be run"), "image/png", "pe"],
    [Buffer.from("#!/bin/sh\nrm -rf /"), "image/png", "script"],
    [pngWithCorruptCrc(), "image/png", "corrupted CRC"],
    [pngWithoutImageData(), "image/png", "missing IDAT"],
    [validJpeg.subarray(0, -8), "image/jpeg", "truncated image"],
    [Buffer.concat([validPng.subarray(0, 8), Buffer.from("not an image")]), "image/png", "fake header"],
    [pngWithDimensions(6_000, 5_000), "image/png", "over 12 megapixels"],
    [animatedWebp, "image/webp", "animated image"],
    [validPng, "image/jpeg", "mime mismatch"],
  ] as const)("rejects %s content", (bytes, mime, description) => {
    expect(description.length).toBeGreaterThan(0);
    return expect(inspectImage(bytes, mime)).rejects.toThrow(InvalidImageError);
  });

  it("removes metadata and active-looking text by re-encoding decoded pixels", async () => {
    const jpeg = await inspectImage(jpegWithMetadata, "image/jpeg");
    const png = await inspectImage(pngWithText("Comment\0<script>MZ javascript:</script>"), "image/png");
    const jpegMetadata = await sharp(jpeg.bytes).metadata();

    expect(jpegMetadata.exif).toBeUndefined();
    expect(jpegMetadata.icc).toBeUndefined();
    expect(jpegMetadata.orientation).toBeUndefined();
    expect(png.bytes.toString("latin1")).not.toContain("<script>");
  });

  it("uses a cryptographic UUID and trusted extension without preserving the client name", () => {
    const stored = createStoredImageName(".png");
    expect(stored).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/);
    expect(stored).not.toContain("../");
  });

  it.each(["../secret.png", "project/not-a-uuid.png", "project/11111111-1111-1111-1111-111111111111.exe", "project\\11111111-1111-4111-8111-111111111111.png"])("rejects unsafe or untrusted relative path %s", async (relative) => {
    await expect(resolveStoredEvidence("missing-root", relative)).rejects.toBeInstanceOf(UnsafeEvidencePathError);
  });

  it("reads request data in bounded chunks and cancels immediately after the hard limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(3)); },
      cancel() { cancelled = true; },
    });
    await expect(readStreamWithLimit(stream, 5)).rejects.toThrow(ImageTooLargeError);
    expect(cancelled).toBe(true);
  });

  it("accepts a bounded stream without requiring a content-length header", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.close(); } });
    await expect(readStreamWithLimit(stream, 2)).resolves.toEqual(new Uint8Array([1, 2]));
  });
});

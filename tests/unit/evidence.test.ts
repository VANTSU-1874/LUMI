// @vitest-environment node

import { describe, expect, it } from "vitest";

import { validJpeg as jpeg, validPng as png, validWebp as webp } from "@/tests/helpers/image-fixtures";

import {
  MAX_IMAGE_BYTES,
  EvidenceDraftSchema,
  inspectImage,
  sanitizeOriginalFilename,
} from "@/lib/services/evidence";

describe("safe evidence validation", () => {
  it.each([
    [png, "image/png", ".png"],
    [jpeg, "image/jpeg", ".jpg"],
    [webp, "image/webp", ".webp"],
  ])("recognizes actual image bytes", async (bytes, mime, extension) => {
    await expect(inspectImage(bytes, mime)).resolves.toMatchObject({ mime, extension });
  });

  it("rejects declared-type mismatches and non-images", async () => {
    await expect(inspectImage(png, "image/jpeg")).rejects.toThrow("格式");
    await expect(inspectImage(Buffer.from("<svg><script>alert(1)</script></svg>"), "image/png"))
      .rejects.toThrow("格式");
    await expect(inspectImage(Buffer.from("MZ executable"), "image/png")).rejects.toThrow("格式");
  });

  it("enforces actual image bytes", async () => {
    await expect(inspectImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/png")).rejects.toThrow("大");
  });

  it("sanitizes and bounds the original filename for metadata only", () => {
    const result = sanitizeOriginalFilename("../<script>..\\secret\u0000.png" + "x".repeat(300));
    expect(result).not.toMatch(/[\\/<>\u0000]/);
    expect(result.length).toBeLessThanOrEqual(120);
  });

  it("accepts bounded text, numeric and HTTPS video drafts only", () => {
    const valueDraft = EvidenceDraftSchema.parse({ kind: "VALUE", label: "距离", signalLayer: "INPUT", value: 42 });
    const textDraft = EvidenceDraftSchema.parse({ kind: "TEXT", label: "现象", signalLayer: "MAPPING", text: "数值从0到1" });
    expect(valueDraft.kind === "VALUE" ? valueDraft.value : undefined).toBe(42);
    expect(textDraft.kind === "TEXT" ? textDraft.text : undefined).toBe("数值从0到1");
    expect(() => EvidenceDraftSchema.parse({ kind: "VIDEO_LINK", label: "视频", signalLayer: "OUTPUT", url: "http://example.com/a" })).toThrow();
    expect(() => EvidenceDraftSchema.parse({ kind: "VIDEO_LINK", label: "视频", signalLayer: "OUTPUT", url: "https://u:p@example.com/a" })).toThrow();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1_000_000_001, -1_000_000_001])(
    "rejects non-finite or unreasonable numeric evidence: %s",
    (value) => {
      expect(() => EvidenceDraftSchema.parse({ kind: "VALUE", label: "数值", signalLayer: "INPUT", value })).toThrow();
    },
  );
});

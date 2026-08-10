// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  fingerprintProductionSurfaceFile,
  PRODUCTION_SURFACE_BASELINE_FILES,
  PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH,
  PRODUCTION_SURFACE_BASELINE_RELEASE_ID,
  verifyProductionSurfaceBaselineReceipt,
} from "@/lib/operations/production-surface-baseline";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function receipt() {
  const projection = {
    schemaVersion: 1 as const,
    kind: "LUMI_PRODUCTION_SURFACE_BASELINE" as const,
    releaseId: PRODUCTION_SURFACE_BASELINE_RELEASE_ID,
    currentReleaseVerified: true as const,
    service: "active" as const,
    health: "ok" as const,
    releaseMarker: { bytes: 1, sha256: hash("marker") },
    files: PRODUCTION_SURFACE_BASELINE_FILES.map((path, index) => ({
      path,
      bytes: index + 1,
      sha256: hash(path),
    })),
    capturedAt: "2026-08-01T07:20:14.139172+00:00",
  };
  return {
    ...projection,
    receiptSha256: hash(JSON.stringify(projection)),
  };
}

function rebindReceipt(value: ReturnType<typeof receipt>) {
  const { receiptSha256: _oldHash, ...projection } = value;
  return {
    ...projection,
    receiptSha256: hash(JSON.stringify(projection)),
  };
}

describe("production surface baseline", () => {
  it("verifies the fixed release receipt and exact ordered file set", () => {
    const value = receipt();
    expect(verifyProductionSurfaceBaselineReceipt(value)).toEqual(value);
  });

  it("verifies the captured production receipt stored in the repository", async () => {
    const value = JSON.parse(await readFile(
      path.resolve(process.cwd(), PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH),
      "utf8",
    ));
    const verified = verifyProductionSurfaceBaselineReceipt(value);
    expect(verified.releaseId).toBe(PRODUCTION_SURFACE_BASELINE_RELEASE_ID);
    expect(verified.files).toHaveLength(32);
    expect(verified.receiptSha256).toBe(
      "465e612bdc12215ae77f973002815bf111c4f3af65ee55c51bd9f04867e9f020",
    );
  });

  it("fails closed for a changed release, receipt hash, or reordered file set", () => {
    expect(() => verifyProductionSurfaceBaselineReceipt({
      ...receipt(),
      releaseId: "a".repeat(40),
    })).toThrow();
    expect(() => verifyProductionSurfaceBaselineReceipt({
      ...receipt(),
      receiptSha256: hash("tampered"),
    })).toThrow("PRODUCTION_SURFACE_BASELINE_RECEIPT_HASH_MISMATCH");
    const value = receipt();
    expect(() => verifyProductionSurfaceBaselineReceipt(rebindReceipt({
      ...value,
      files: [value.files[1], value.files[0], ...value.files.slice(2)],
    }))).toThrow("PRODUCTION_SURFACE_BASELINE_FILE_SET_INVALID");
    expect(() => verifyProductionSurfaceBaselineReceipt(rebindReceipt({
      ...value,
      files: [value.files[0], value.files[0], ...value.files.slice(2)],
    }))).toThrow("PRODUCTION_SURFACE_BASELINE_FILE_SET_INVALID");
    expect(() => verifyProductionSurfaceBaselineReceipt({
      ...value,
      files: value.files.slice(1),
    })).toThrow();
    expect(() => verifyProductionSurfaceBaselineReceipt({
      ...value,
      files: [...value.files, value.files[0]],
    })).toThrow();
  });

  it("fingerprints raw bytes instead of decoded text", () => {
    const first = Buffer.from([0x80]);
    const second = Buffer.from([0x81]);
    expect(first.toString("utf8")).toBe(second.toString("utf8"));
    expect(
      fingerprintProductionSurfaceFile("app/page.tsx", first).sha256,
    ).not.toBe(
      fingerprintProductionSurfaceFile("app/page.tsx", second).sha256,
    );
  });
});

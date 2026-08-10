// @vitest-environment node

import { NextRequest } from "next/server";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  getKnowledgeAssetRoute,
} from "@/app/api/knowledge/assets/[assetId]/handler";
import {
  StudentSessionRequiredError,
} from "@/lib/auth/project-session";
import {
  KnowledgeAssetIntegrityError,
  KnowledgeAssetNotFoundError,
  openKnowledgeAssetFileV2,
  verifyKnowledgeAssetBytesV2,
} from "@/lib/knowledge/knowledge-asset-file-v2";

const REAL_ASSET_ID =
  "asset-a083e98253763fe2953836a24faeca74b051c296738a22a51d86fd2636a65b17";
const canaryActor = { userId: "internal-1", role: "STUDENT" as const };
const authenticateCanary = async () => canaryActor;
const canaryEligible = () => true;

function request(
  headers?: Record<string, string>,
) {
  return new NextRequest(
    `http://localhost/api/knowledge/assets/${REAL_ASSET_ID}`,
    { headers },
  );
}

function context(assetId = REAL_ASSET_ID) {
  return { params: Promise.resolve({ assetId }) };
}

describe("controlled KnowledgeObjectV2 asset route", () => {
  it("opens a corpus-declared PNG only after verifying its tracked bytes", async () => {
    const file =
      await openKnowledgeAssetFileV2(
        REAL_ASSET_ID,
      );

    expect(file).toMatchObject({
      assetId: REAL_ASSET_ID,
      contentType: "image/png",
      size: 729986,
      width: 959,
      height: 1280,
      sha256:
        "f2d5bcaaa8f6316d9185b77344a92866e4c7ab99adf6927955a4e153d96fb418",
    });
    expect(file.bytes.byteLength).toBe(file.size);
  });

  it("rejects unknown identifiers and detects byte drift", async () => {
    await expect(
      openKnowledgeAssetFileV2("../outside.png"),
    ).rejects.toBeInstanceOf(
      KnowledgeAssetNotFoundError,
    );
    await expect(
      openKnowledgeAssetFileV2(
        "asset-not-in-corpus",
      ),
    ).rejects.toBeInstanceOf(
      KnowledgeAssetNotFoundError,
    );
    const file =
      await openKnowledgeAssetFileV2(
        REAL_ASSET_ID,
      );
    expect(() => verifyKnowledgeAssetBytesV2(
      {
        schemaVersion: 2,
        id: REAL_ASSET_ID,
        kind: "IMAGE",
        locator: {
          root: "data/courses",
          path:
            "assets/layout-design/grid-case-1.png",
        },
        mimeType: "image/png",
        sizeBytes: file.size,
        dimensions: {
          widthPx: file.width,
          heightPx: file.height,
        },
        sha256: "0".repeat(64),
      },
      file.bytes,
    )).toThrow(KnowledgeAssetIntegrityError);
  });

  it("requires authentication before opening an asset", async () => {
    const openAsset = vi.fn();
    const response =
      await getKnowledgeAssetRoute(
        request(),
        context(),
        {
          authenticate: async () => {
            throw new StudentSessionRequiredError();
          },
          openAsset,
        },
      );

    expect(response.status).toBe(401);
    expect(openAsset).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control"))
      .toBe("private, no-store");
  });

  it("returns 404 for an authenticated unknown asset id", async () => {
    const response =
      await getKnowledgeAssetRoute(
        request(),
        context("asset-not-in-corpus"),
        {
          authenticate: authenticateCanary,
          canaryEligible,
          openAsset:
            openKnowledgeAssetFileV2,
        },
      );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "课程参考图不存在",
    });
  });

  it("does not open a V2 preview for an authenticated account outside the canary", async () => {
    const openAsset = vi.fn();
    const response = await getKnowledgeAssetRoute(
      request(),
      context(),
      {
        authenticate: authenticateCanary,
        canaryEligible: () => false,
        openAsset,
      },
    );

    expect(response.status).toBe(404);
    expect(openAsset).not.toHaveBeenCalled();
  });

  it("rejects cross-site and range requests without reading bytes", async () => {
    const openAsset = vi.fn();
    const crossSite =
      await getKnowledgeAssetRoute(
        request({ "sec-fetch-site": "cross-site" }),
        context(),
        {
          authenticate: authenticateCanary,
          canaryEligible,
          openAsset,
        },
      );
    const range =
      await getKnowledgeAssetRoute(
        request({ range: "bytes=0-20" }),
        context(),
        {
          authenticate: authenticateCanary,
          canaryEligible,
          openAsset,
        },
      );

    expect(crossSite.status).toBe(404);
    expect(range.status).toBe(416);
    expect(openAsset).not.toHaveBeenCalled();
  });

  it("returns an authenticated same-origin PNG with private hardening headers", async () => {
    const response =
      await getKnowledgeAssetRoute(
        request(),
        context(),
        {
          authenticate: authenticateCanary,
          canaryEligible,
          openAsset: async (assetId) => ({
            assetId,
            bytes: Buffer.from([
              0x89, 0x50, 0x4e, 0x47,
            ]),
            contentType: "image/png" as const,
            size: 4,
            width: 1,
            height: 1,
            sha256: "a".repeat(64),
          }),
        },
      );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type"))
      .toBe("image/png");
    expect(response.headers.get("content-length"))
      .toBe("4");
    expect(response.headers.get("accept-ranges"))
      .toBe("none");
    expect(
      response.headers.get(
        "cross-origin-resource-policy",
      ),
    ).toBe("same-origin");
    expect(
      response.headers.get("content-disposition"),
    ).toContain(`${REAL_ASSET_ID}.png`);
  });

  it("fails closed when tracked bytes drift", async () => {
    vi.spyOn(console, "error")
      .mockImplementation(() => undefined);
    const response =
      await getKnowledgeAssetRoute(
        request(),
        context(),
        {
          authenticate: authenticateCanary,
          canaryEligible,
          openAsset: async () => {
            throw new KnowledgeAssetIntegrityError(
              "KNOWLEDGE_ASSET_FILE_HASH_DRIFT",
            );
          },
        },
      );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "课程参考图暂时不可用",
    });
  });
});

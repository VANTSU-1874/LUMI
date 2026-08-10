// @vitest-environment node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { startVisualSidecar } from "@/lib/knowledge/visual-retriever-client";
import type { VisualIndexIdentity } from "@/lib/knowledge/visual-retriever";

const index: VisualIndexIdentity = {
  corpusBundleHash: "a".repeat(64),
  indexBundleHash: "b".repeat(64),
  indexVersionId: "fixture-v1",
  modelId: "fixture/model",
  modelRevision: "c".repeat(40),
};
const assetId = `asset-${"1".repeat(64)}`;
const secondAssetId = `asset-${"2".repeat(64)}`;

function fixtureArgs(identity = index) {
  return [
    path.join(process.cwd(), "tests", "fixtures", "visual-sidecar.mjs"),
    Buffer.from(JSON.stringify(identity)).toString("base64url"),
    assetId,
  ];
}

describe("visual sidecar client", () => {
  it("handshakes on exact index provenance and retrieves opaque asset ids", async () => {
    const handle = await startVisualSidecar({
      executable: process.execPath,
      args: fixtureArgs(),
      cwd: process.cwd(),
      expectedIndex: index,
      capabilities: {
        textToImage: true,
        imageToImage: true,
        imageTextToImage: true,
        normalizedRegions: true,
      },
      startupTimeoutMs: 2_000,
    });
    try {
      expect(handle.resources()).toMatchObject({
        processRunning: true,
        pendingRequests: 0,
        queueDepth: 0,
        cacheEntries: 0,
      });
      await expect(handle.retriever.retrieve({
        mode: "TEXT_TO_IMAGE",
        coursePackId: "layout-design",
        text: "粉绿书写字体叠在一起的海报",
      }, {
        topK: 5,
        timeoutMs: 500,
      })).resolves.toMatchObject({
        status: "SUCCESS",
        hits: [{
          assetId,
          rank: 1,
          representationId: "fixture-asset-one",
        }],
        index,
      });
      expect(handle.resources()).toMatchObject({
        processRunning: true,
        pendingRequests: 0,
        cacheEntries: 1,
        cacheMisses: 1,
      });
    } finally {
      await handle.dispose();
    }
    expect(handle.resources()).toMatchObject({
      processRunning: false,
      pendingRequests: 0,
    });
  });

  it("rejects a sidecar attached to a different immutable model revision", async () => {
    await expect(startVisualSidecar({
      executable: process.execPath,
      args: fixtureArgs({
        ...index,
        modelRevision: "d".repeat(40),
      }),
      cwd: process.cwd(),
      expectedIndex: index,
      capabilities: {
        textToImage: true,
        imageToImage: true,
        imageTextToImage: true,
        normalizedRegions: true,
      },
      startupTimeoutMs: 2_000,
    })).rejects.toThrow(/handshake|exited/);
  });

  it("resolves, validates, and sends query pixels without exposing a local path", async () => {
    const pngBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("fixture-pixels"),
    ]);
    const handle = await startVisualSidecar({
      executable: process.execPath,
      args: fixtureArgs(index).map((value, offset) =>
        offset === 2 ? secondAssetId : value),
      cwd: process.cwd(),
      expectedIndex: index,
      capabilities: {
        textToImage: true,
        imageToImage: true,
        imageTextToImage: true,
        normalizedRegions: true,
      },
      resolveQueryImage: async (resolvedAssetId) => {
        expect(resolvedAssetId).toBe(assetId);
        return {
          sha256: createHash("sha256").update(pngBytes).digest("hex"),
          pngBytes,
        };
      },
      startupTimeoutMs: 2_000,
    });
    try {
      await expect(handle.retriever.retrieve({
        mode: "IMAGE_TO_IMAGE",
        coursePackId: "layout-design",
        queryAssetId: assetId,
        excludeAssetIds: [assetId],
      }, {
        topK: 5,
        timeoutMs: 500,
      })).resolves.toMatchObject({
        status: "SUCCESS",
        hits: [{ assetId: secondAssetId }],
      });
    } finally {
      await handle.dispose();
    }
  });

  it("cancels a slow query image resolver without sending a late request", async () => {
    const pngBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("slow-resolver-pixels"),
    ]);
    const queryImage = {
      sha256: createHash("sha256").update(pngBytes).digest("hex"),
      pngBytes,
    };
    let releaseFirstResolver!: () => void;
    const firstResolver = new Promise<void>((resolve) => {
      releaseFirstResolver = resolve;
    });
    let resolverCalls = 0;
    let firstResolverSignal: AbortSignal | undefined;
    let stdinWriteSpy: ReturnType<typeof vi.spyOn> | undefined;
    const handle = await startVisualSidecar({
      executable: process.execPath,
      args: fixtureArgs(index).map((value, offset) =>
        offset === 2 ? secondAssetId : value),
      cwd: process.cwd(),
      expectedIndex: index,
      capabilities: {
        textToImage: true,
        imageToImage: true,
        imageTextToImage: true,
        normalizedRegions: true,
      },
      resolveQueryImage: async (_resolvedAssetId, { signal }) => {
        resolverCalls += 1;
        if (resolverCalls === 1) {
          firstResolverSignal = signal;
          await firstResolver;
        }
        return queryImage;
      },
      startupTimeoutMs: 2_000,
      spawnImpl(executable, args, options) {
        const child = spawn(executable, args, options);
        stdinWriteSpy = vi.spyOn(child.stdin, "write");
        return child;
      },
    });
    try {
      await expect(handle.retriever.retrieve({
        mode: "IMAGE_TO_IMAGE",
        coursePackId: "layout-design",
        queryAssetId: assetId,
        excludeAssetIds: [assetId],
      }, {
        topK: 5,
        timeoutMs: 20,
      })).resolves.toMatchObject({
        status: "TIMEOUT",
      });
      expect(firstResolverSignal?.aborted).toBe(true);

      releaseFirstResolver();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(stdinWriteSpy).not.toHaveBeenCalled();

      await expect(handle.retriever.retrieve({
        mode: "IMAGE_TO_IMAGE",
        coursePackId: "layout-design",
        queryAssetId: assetId,
        excludeAssetIds: [assetId],
      }, {
        topK: 5,
        timeoutMs: 500,
      })).resolves.toMatchObject({
        status: "SUCCESS",
        hits: [{ assetId: secondAssetId }],
      });
      expect(stdinWriteSpy).toHaveBeenCalledTimes(1);
    } finally {
      releaseFirstResolver();
      await handle.dispose();
    }
  });

  it("rejects an outbound request larger than the Python protocol limit before writing", async () => {
    const pngBytes = Buffer.alloc(18 * 1024 * 1024);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      .copy(pngBytes);
    let stdinWriteSpy: ReturnType<typeof vi.spyOn> | undefined;
    const handle = await startVisualSidecar({
      executable: process.execPath,
      args: fixtureArgs(index).map((value, offset) =>
        offset === 2 ? secondAssetId : value),
      cwd: process.cwd(),
      expectedIndex: index,
      capabilities: {
        textToImage: true,
        imageToImage: true,
        imageTextToImage: true,
        normalizedRegions: true,
      },
      maxQueryImageBytes: 20 * 1024 * 1024,
      resolveQueryImage: async () => ({
        sha256: createHash("sha256").update(pngBytes).digest("hex"),
        pngBytes,
      }),
      startupTimeoutMs: 2_000,
      spawnImpl(executable, args, options) {
        const child = spawn(executable, args, options);
        stdinWriteSpy = vi.spyOn(child.stdin, "write");
        return child;
      },
    });
    try {
      await expect(handle.retriever.retrieve({
        mode: "IMAGE_TO_IMAGE",
        coursePackId: "layout-design",
        queryAssetId: assetId,
        excludeAssetIds: [assetId],
      }, {
        topK: 5,
        timeoutMs: 5_000,
      })).resolves.toMatchObject({
        status: "ERROR",
        reason: "PROVIDER_UNAVAILABLE",
      });
      expect(stdinWriteSpy).not.toHaveBeenCalled();
    } finally {
      await handle.dispose();
    }
  });

  it("kills a stuck sidecar request at the total deadline", async () => {
    const handle = await startVisualSidecar({
      executable: process.execPath,
      args: fixtureArgs(),
      cwd: process.cwd(),
      expectedIndex: index,
      capabilities: {
        textToImage: true,
        imageToImage: true,
        imageTextToImage: true,
        normalizedRegions: true,
      },
      startupTimeoutMs: 2_000,
    });
    try {
      await expect(handle.retriever.retrieve({
        mode: "TEXT_TO_IMAGE",
        coursePackId: "layout-design",
        text: "hang",
      }, {
        topK: 5,
        timeoutMs: 20,
      })).resolves.toMatchObject({
        status: "TIMEOUT",
      });
      await expect(handle.retriever.retrieve({
        mode: "TEXT_TO_IMAGE",
        coursePackId: "layout-design",
        text: "after-timeout",
      }, {
        topK: 5,
        timeoutMs: 100,
      })).resolves.toMatchObject({
        status: "ERROR",
      });
    } finally {
      await handle.dispose();
    }
  });

  it("accepts a false Windows kill result when the sidecar then exits", async () => {
    const readyEnvelope = JSON.stringify({
      v: 1,
      type: "ready",
      capabilities: [
        "TEXT_TO_IMAGE",
        "IMAGE_TO_IMAGE",
        "IMAGE_TEXT_TO_IMAGE",
        "NORMALIZED_REGIONS",
      ],
      identity: index,
    });
    const childScript = [
      `process.stdout.write(${JSON.stringify(`${readyEnvelope}\n`)});`,
      "setInterval(() => {}, 1_000);",
    ].join("");
    let killAttempts = 0;
    const handle = await startVisualSidecar({
      executable: process.execPath,
      args: ["-e", childScript],
      cwd: process.cwd(),
      expectedIndex: index,
      capabilities: {
        textToImage: true,
        imageToImage: true,
        imageTextToImage: true,
        normalizedRegions: true,
      },
      startupTimeoutMs: 2_000,
      spawnImpl(executable, args, options) {
        const child = spawn(executable, args, options);
        const kill = child.kill.bind(child);
        child.kill = (() => {
          killAttempts += 1;
          setTimeout(() => {
            kill();
          }, 10);
          return false;
        }) as typeof child.kill;
        return child;
      },
    });

    await expect(handle.dispose()).resolves.toBeUndefined();
    expect(killAttempts).toBe(1);
  });

  it("passes only an allowlisted environment to the sidecar", async () => {
    const originalSecret = process.env.LLM_API_KEY;
    process.env.LLM_API_KEY = "must-not-cross-process-boundary";
    let capturedEnvironment: NodeJS.ProcessEnv | undefined;
    const handle = await startVisualSidecar({
      executable: process.execPath,
      args: fixtureArgs(),
      cwd: process.cwd(),
      env: {
        HF_HUB_OFFLINE: "1",
      },
      expectedIndex: index,
      capabilities: {
        textToImage: true,
        imageToImage: true,
        imageTextToImage: true,
        normalizedRegions: true,
      },
      startupTimeoutMs: 2_000,
      spawnImpl(executable, args, options) {
        capturedEnvironment = options.env;
        return spawn(executable, args, options);
      },
    });
    try {
      expect(capturedEnvironment?.HF_HUB_OFFLINE).toBe("1");
      expect(capturedEnvironment?.LLM_API_KEY).toBeUndefined();
    } finally {
      await handle.dispose();
      if (originalSecret === undefined) delete process.env.LLM_API_KEY;
      else process.env.LLM_API_KEY = originalSecret;
    }
  });

  it("rejects unsafe environment keys and invalid concurrency before spawning", async () => {
    const spawnImpl = vi.fn(() => {
      throw new Error("should not spawn");
    });
    await expect(startVisualSidecar({
      executable: process.execPath,
      args: fixtureArgs(),
      cwd: process.cwd(),
      env: { LLM_API_KEY: "secret" },
      expectedIndex: index,
      capabilities: {
        textToImage: true,
        imageToImage: true,
        imageTextToImage: true,
        normalizedRegions: true,
      },
      spawnImpl,
    })).rejects.toThrow(/environment key/);
    await expect(startVisualSidecar({
      executable: process.execPath,
      args: fixtureArgs(),
      cwd: process.cwd(),
      expectedIndex: index,
      capabilities: {
        textToImage: true,
        imageToImage: true,
        imageTextToImage: true,
        normalizedRegions: true,
      },
      concurrency: 2 as 1,
      spawnImpl,
    })).rejects.toThrow();
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});

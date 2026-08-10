// @vitest-environment node

import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startTextSidecar } from "@/lib/knowledge/text-retriever-client";
import {
  SELF_HOSTED_TEXT_MODEL,
  type TextIndexIdentity,
} from "@/lib/knowledge/text-retriever";

const index: TextIndexIdentity = {
  corpusBundleHash: "a".repeat(64),
  indexBundleHash: "b".repeat(64),
  indexVersionId: "bge-small-zh-v1-5-fixture",
  modelId: SELF_HOSTED_TEXT_MODEL.id,
  modelRevision: SELF_HOSTED_TEXT_MODEL.revision,
};

function fixtureArgs(identity = index, behavior = "success") {
  return [
    path.join(process.cwd(), "tests", "fixtures", "text-sidecar.mjs"),
    Buffer.from(JSON.stringify(identity)).toString("base64url"),
    behavior,
  ];
}

describe("text retrieval sidecar client", () => {
  it.skipIf(process.platform === "win32")(
    "accepts a Linux virtual-environment executable symlink",
    async () => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "lumi-text-sidecar-"),
      );
      const executable = path.join(directory, "python3");
      await symlink(process.execPath, executable, "file");
      try {
        const handle = await startTextSidecar({
          executable,
          args: fixtureArgs(),
          cwd: process.cwd(),
          expectedIndex: index,
          startupTimeoutMs: 2_000,
        });
        await handle.dispose();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("handshakes on exact sealed provenance and returns scoped V2 node ids", async () => {
    const handle = await startTextSidecar({
      executable: process.execPath,
      args: fixtureArgs(),
      cwd: process.cwd(),
      expectedIndex: index,
      allowedTargets: new Map([
        ["node-fixture", {
          objectId: "layout-fixture",
          coursePackId: "layout-design",
        }],
      ]),
      startupTimeoutMs: 2_000,
    });
    try {
      expect(handle.resources()).toEqual({
        processRunning: true,
        pendingRequests: 0,
      });
      await expect(handle.retriever.retrieve({
        text: "这个版面太乱了，我先动哪里？",
        coursePackId: "layout-design",
      }, {
        topK: 5,
        timeoutMs: 500,
      })).resolves.toMatchObject({
        status: "SUCCESS",
        hits: [{
          nodeId: "node-fixture",
          objectId: "layout-fixture",
          coursePackId: "layout-design",
        }],
        index,
      });
      expect(handle.resources()).toEqual({
        processRunning: true,
        pendingRequests: 0,
      });
    } finally {
      await handle.dispose();
    }
    expect(handle.resources()).toEqual({
      processRunning: false,
      pendingRequests: 0,
    });
  });

  it("rejects a sidecar attached to another corpus or index", async () => {
    await expect(startTextSidecar({
      executable: process.execPath,
      args: fixtureArgs({
        ...index,
        corpusBundleHash: "d".repeat(64),
      }),
      cwd: process.cwd(),
      expectedIndex: index,
      startupTimeoutMs: 2_000,
    })).rejects.toThrow(/handshake|exited/);
  });

  it("degrades process exit and corrupt JSON instead of leaking a rejected query", async () => {
    for (const behavior of ["exit", "corrupt"]) {
      const handle = await startTextSidecar({
        executable: process.execPath,
        args: fixtureArgs(index, behavior),
        cwd: process.cwd(),
        expectedIndex: index,
        startupTimeoutMs: 2_000,
      });
      try {
        await expect(handle.retriever.retrieve({
          text: "正文看不清",
          coursePackId: null,
        }, {
          topK: 5,
          timeoutMs: 500,
        })).resolves.toMatchObject({
          status: "UNAVAILABLE",
          reason: "PROVIDER_UNAVAILABLE",
          hits: [],
          index: null,
        });
      } finally {
        await handle.dispose();
      }
    }
  });

  it("refuses to pass API credentials or arbitrary environment keys", async () => {
    await expect(startTextSidecar({
      executable: process.execPath,
      args: fixtureArgs(),
      cwd: process.cwd(),
      expectedIndex: index,
      env: {
        LLM_API_KEY: "must-not-enter-sidecar",
      },
      startupTimeoutMs: 2_000,
    })).rejects.toThrow(/environment key is not allowed/);
  });
});

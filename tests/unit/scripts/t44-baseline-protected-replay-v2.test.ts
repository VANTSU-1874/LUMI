// @vitest-environment node

import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseT44BaselineProtectedReplayArgumentsV2,
  writeNewT44BaselineProtectedReplayArtifactV2,
} from "@/scripts/replay-t44-baseline-protected-selection-v2";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

describe("T4.4 baseline-protected offline replay", () => {
  it("accepts exactly one stable run id", () => {
    expect(
      parseT44BaselineProtectedReplayArgumentsV2([
        "--",
        "--run-id",
        "legacy-v2",
      ]),
    ).toEqual({ runId: "legacy-v2" });
    expect(() =>
      parseT44BaselineProtectedReplayArgumentsV2([
        "--run-id",
        "legacy-v2",
        "--device",
        "cuda",
      ]),
    ).toThrow(/RUN_ID_INVALID/);
  });

  it("writes with wx, verifies bytes and refuses overwrite", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lumi-t44-replay-"),
    );
    roots.push(root);
    const target = path.join(root, "selection.json");
    const first =
      await writeNewT44BaselineProtectedReplayArtifactV2(
        target,
        { selector: "baseline-protected-v2" },
      );

    expect(first.bytes).toBeGreaterThan(0);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      JSON.parse(await readFile(target, "utf8")),
    ).toEqual({
      selector: "baseline-protected-v2",
    });
    await expect(
      writeNewT44BaselineProtectedReplayArtifactV2(
        target,
        { selector: "overwrite" },
      ),
    ).rejects.toThrow(/ARTIFACT_ALREADY_EXISTS/);
  });
});

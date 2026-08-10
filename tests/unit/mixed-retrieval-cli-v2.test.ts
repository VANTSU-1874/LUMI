// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertFrozenMixedBaselineBytes,
  parseMixedRetrievalArguments,
  resolveMixedRetrievalOutputPath,
  runMixedRetrievalCli,
} from "@/scripts/evaluate-mixed-retrieval-v2";

const REQUIRED = [
  "--output",
  ".runtime/retrieval-quality/t4-mixed.json",
  "--python",
  ".runtime/python/python.exe",
  "--text-model-dir",
  ".runtime/text/model",
  "--text-model-seal",
  ".runtime/text/seal.json",
  "--text-index-dir",
  ".runtime/text/index",
  "--visual-model-dir",
  ".runtime/visual/model",
  "--visual-model-seal",
  ".runtime/visual/seal.json",
  "--visual-index-dir",
  ".runtime/visual/index",
  "--visual-offload-dir",
  ".runtime/visual/offload",
  "--control-dir",
  ".runtime/control",
];

describe("mixed retrieval CLI V2", () => {
  it("requires an explicit report and all immutable runtime inputs", () => {
    expect(parseMixedRetrievalArguments(REQUIRED)).toMatchObject({
      output: ".runtime/retrieval-quality/t4-mixed.json",
      device: "cuda",
      gpuMemoryGiB: 3.5,
      timeoutMs: 10_000,
      warmups: 1,
      repetitions: 5,
    });
    expect(() => parseMixedRetrievalArguments(
      REQUIRED.filter((value, index) => index < 2 || index > 3),
    )).toThrow("MIXED_CLI_REQUIRED_ARGUMENT_MISSING:--python");
  });

  it("rejects duplicate, unknown and under-measured arguments", () => {
    expect(() => parseMixedRetrievalArguments([
      ...REQUIRED,
      "--output",
      ".runtime/other.json",
    ])).toThrow("MIXED_CLI_DUPLICATE_ARGUMENT:--output");
    expect(() => parseMixedRetrievalArguments([
      ...REQUIRED,
      "--database",
      "service.sqlite",
    ])).toThrow("MIXED_CLI_UNKNOWN_ARGUMENT:--database");
    expect(() => parseMixedRetrievalArguments([
      ...REQUIRED,
      "--repetitions",
      "4",
    ])).toThrow();
    expect(() => parseMixedRetrievalArguments([
      ...REQUIRED,
      "--corpus",
      "alternate-corpus.json",
    ])).toThrow("MIXED_CLI_UNKNOWN_ARGUMENT:--corpus");
  });

  it("restricts reports to dedicated runtime roots and rejects symlink escapes", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "mixed-cli-output-"));
    await mkdir(path.join(workspace, ".runtime"), { recursive: true });
    await expect(resolveMixedRetrievalOutputPath(
      workspace,
      ".runtime/mixed-retrieval/report.json",
    )).resolves.toBe(path.join(workspace, ".runtime", "mixed-retrieval", "report.json"));
    await expect(resolveMixedRetrievalOutputPath(
      workspace,
      ".runtime/knowledge-index/control.json",
    )).rejects.toThrow("MIXED_CLI_OUTPUT_MUST_BE_DEDICATED_RUNTIME_JSON");

    const external = await mkdtemp(path.join(tmpdir(), "mixed-cli-external-"));
    await symlink(
      external,
      path.join(workspace, ".runtime", "retrieval-quality"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(resolveMixedRetrievalOutputPath(
      workspace,
      ".runtime/retrieval-quality/report.json",
    )).rejects.toThrow("MIXED_CLI_OUTPUT_SYMLINK_FORBIDDEN");
  });

  it("rejects output collisions before reading or overwriting an input", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "mixed-cli-collision-"));
    await mkdir(path.join(workspace, ".runtime", "retrieval-quality"), {
      recursive: true,
    });
    const collision = ".runtime/retrieval-quality/baseline.json";
    const priorExitCode = process.exitCode;
    try {
      await expect(runMixedRetrievalCli([
        ...REQUIRED.map((value) =>
          value === ".runtime/retrieval-quality/t4-mixed.json" ? collision : value),
        "--caption-baseline",
        collision,
      ], workspace)).rejects.toThrow("MIXED_CLI_OUTPUT_INPUT_COLLISION");
    } finally {
      process.exitCode = priorExitCode;
    }
  });

  it("returns a non-zero process status for parser failures", () => {
    const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const result = spawnSync(process.execPath, [
      tsxCli,
      "scripts/evaluate-mixed-retrieval-v2.ts",
      "--bad",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("MIXED_CLI_UNKNOWN_ARGUMENT:--bad");
  });

  it("rejects baseline bytes that are not the frozen T0/T3 artifacts", () => {
    expect(() => assertFrozenMixedBaselineBytes("CAPTION", Buffer.from("{}")))
      .toThrow("MIXED_CLI_CAPTION_BASELINE_HASH_MISMATCH");
    expect(() => assertFrozenMixedBaselineBytes("T3", Buffer.from("{}")))
      .toThrow("MIXED_CLI_T3_BASELINE_HASH_MISMATCH");
  });
});

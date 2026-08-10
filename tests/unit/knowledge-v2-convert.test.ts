// @vitest-environment node

import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseKnowledgeV2ConversionArgs,
  resolveKnowledgeV2OutputPaths,
  runKnowledgeV2Conversion,
} from "@/scripts/convert-knowledge-v2";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("KnowledgeObjectV2 conversion command", () => {
  it("requires one explicit write or check mode", () => {
    expect(parseKnowledgeV2ConversionArgs(["--write"])).toBe("WRITE");
    expect(parseKnowledgeV2ConversionArgs(["--check"])).toBe("CHECK");
    for (const arguments_ of [
      [],
      ["--write", "--check"],
      ["--check", "extra"],
      ["--unknown"],
    ]) {
      expect(() => parseKnowledgeV2ConversionArgs(arguments_)).toThrow(/usage/i);
    }
  });

  it("verifies the committed deterministic V2 artifacts without writing", async () => {
    await expect(runKnowledgeV2Conversion("CHECK", process.cwd())).resolves.toMatchObject({
      mode: "CHECK",
      objectCount: 116,
      assetCount: 156,
      referencedAssetCount: 156,
      unreferencedAssetCount: 0,
    });
  }, 60_000);

  it("rejects an output directory junction before any V2 file can escape", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "knowledge-v2-workspace-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "knowledge-v2-outside-"));
    temporaryRoots.push(workspaceRoot, outsideRoot);
    await mkdir(path.join(workspaceRoot, "data"));
    await symlink(
      outsideRoot,
      path.join(workspaceRoot, "data", "knowledge-v2"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(resolveKnowledgeV2OutputPaths("WRITE", workspaceRoot))
      .rejects.toThrow(/output.directory.unsa(fe|f)|symlink/i);
  });
});

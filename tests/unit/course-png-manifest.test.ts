// @vitest-environment node

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCoursePngManifest,
  CoursePngManifestSchema,
} from "@/lib/knowledge/course-png-manifest";
import { parseCoursePngManifestArgs } from "@/scripts/course-png-manifest";

const workspaceRoot = process.cwd();
const manifestPath = path.join(
  workspaceRoot,
  "data",
  "manifests",
  "course-png-sha256.v1.json",
);

describe("course PNG integrity manifest", () => {
  it("covers every course PNG without changing its bytes", async () => {
    const tracked = CoursePngManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
    const actual = await buildCoursePngManifest({ workspaceRoot });

    expect(actual).toEqual(tracked);
    expect(actual.assetCount).toBe(156);
    expect(actual.totalBytes).toBe(82_049_135);
    expect(new Set(actual.assets.map(({ path: assetPath }) => assetPath)).size).toBe(156);
    expect(new Set(actual.assets.map(({ sha256 }) => sha256)).size).toBe(156);
  });

  it("rejects a course root junction that resolves outside the workspace", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "course-assets-root-"));
    const fakeWorkspace = path.join(temporaryRoot, "workspace");
    const externalCourses = path.join(temporaryRoot, "external-courses");
    await mkdir(path.join(fakeWorkspace, "data"), { recursive: true });
    await mkdir(externalCourses, { recursive: true });
    await writeFile(path.join(externalCourses, "outside.png"), Buffer.from([1, 2, 3]));
    await symlink(
      externalCourses,
      path.join(fakeWorkspace, "data", "courses"),
      process.platform === "win32" ? "junction" : "dir",
    );

    try {
      await expect(
        buildCoursePngManifest({ workspaceRoot: fakeWorkspace }),
      ).rejects.toThrow("COURSE_ASSET_ROOT_PATH_ESCAPE");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("rejects a nested junction before reading an escaped PNG", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "course-assets-entry-"));
    const fakeWorkspace = path.join(temporaryRoot, "workspace");
    const courseRoot = path.join(fakeWorkspace, "data", "courses");
    const externalAssets = path.join(temporaryRoot, "external-assets");
    await mkdir(courseRoot, { recursive: true });
    await mkdir(externalAssets, { recursive: true });
    await writeFile(path.join(externalAssets, "outside.png"), Buffer.from([4, 5, 6]));
    await symlink(
      externalAssets,
      path.join(courseRoot, "escaped"),
      process.platform === "win32" ? "junction" : "dir",
    );

    try {
      await expect(
        buildCoursePngManifest({ workspaceRoot: fakeWorkspace }),
      ).rejects.toThrow("COURSE_ASSET_PATH_ESCAPE");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

describe("course PNG manifest CLI arguments", () => {
  it.each([
    { args: ["--write"], expected: "WRITE" },
    { args: ["--check"], expected: "CHECK" },
  ])("accepts exactly one supported mode: $args", ({ args, expected }) => {
    expect(parseCoursePngManifestArgs(args)).toBe(expected);
  });

  it.each([
    { args: [] },
    { args: ["--unknown"] },
    { args: ["--write", "--write"] },
    { args: ["--check", "--check"] },
    { args: ["--write", "--check"] },
    { args: ["--check", "--write"] },
    { args: ["--write", "trailing"] },
    { args: ["--check", "trailing"] },
    { args: ["--write=value"] },
  ])("rejects malformed arguments: $args", ({ args }) => {
    expect(() => parseCoursePngManifestArgs(args)).toThrow(
      "usage: course-png-manifest.ts --write|--check",
    );
  });
});

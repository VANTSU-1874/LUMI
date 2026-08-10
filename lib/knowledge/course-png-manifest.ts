import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const POSIX_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\\]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const CoursePngAssetSchema = z
  .object({
    path: z.string().regex(POSIX_RELATIVE_PATH).refine((value) => value.endsWith(".png")),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(SHA256),
  })
  .strict();

export const CoursePngManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    root: z.literal("data/courses"),
    algorithm: z.literal("sha256"),
    assetCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    assets: z.array(CoursePngAssetSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.assetCount !== manifest.assets.length) {
      context.addIssue({ code: "custom", message: "assetCount must match assets.length" });
    }
    if (
      manifest.totalBytes
      !== manifest.assets.reduce((total, asset) => total + asset.sizeBytes, 0)
    ) {
      context.addIssue({ code: "custom", message: "totalBytes must match asset sizes" });
    }
    const assetPaths = manifest.assets.map((asset) => asset.path);
    if (new Set(assetPaths).size !== assetPaths.length) {
      context.addIssue({ code: "custom", message: "asset paths must be unique" });
    }
    const sortedPaths = [...assetPaths].sort(compareCodePoints);
    if (assetPaths.some((assetPath, index) => assetPath !== sortedPaths[index])) {
      context.addIssue({ code: "custom", message: "assets must be sorted by path" });
    }
  });

export type CoursePngManifest = z.infer<typeof CoursePngManifestSchema>;

export const COURSE_PNG_MANIFEST_PATH = path.join(
  "data",
  "manifests",
  "course-png-sha256.v1.json",
);

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/");
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isSamePath(left: string, right: string) {
  return path.relative(left, right) === "";
}

interface CoursePngFile {
  manifestPath: string;
  readPath: string;
}

async function listPngFiles(
  courseRoot: string,
  realCourseRoot: string,
  directory = courseRoot,
  realDirectory = realCourseRoot,
): Promise<CoursePngFile[]> {
  const files: CoursePngFile[] = [];
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => compareCodePoints(left.name, right.name));
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const realAbsolutePath = await realpath(absolutePath);
    if (!isWithin(realCourseRoot, realAbsolutePath)) {
      throw new Error(`COURSE_ASSET_PATH_ESCAPE:${absolutePath}`);
    }

    const expectedRealPath = path.join(realDirectory, entry.name);
    const stats = await lstat(absolutePath);
    if (
      entry.isSymbolicLink()
      || stats.isSymbolicLink()
      || !isSamePath(expectedRealPath, realAbsolutePath)
    ) {
      throw new Error(`COURSE_ASSET_SYMLINK_NOT_ALLOWED:${absolutePath}`);
    }

    if (stats.isDirectory()) {
      files.push(...await listPngFiles(
        courseRoot,
        realCourseRoot,
        absolutePath,
        realAbsolutePath,
      ));
    } else if (stats.isFile() && entry.name.toLowerCase().endsWith(".png")) {
      files.push({
        manifestPath: normalizePath(path.relative(courseRoot, absolutePath)),
        readPath: realAbsolutePath,
      });
    }
  }
  return files;
}

export async function buildCoursePngManifest(
  options: { workspaceRoot?: string } = {},
): Promise<CoursePngManifest> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const realWorkspaceRoot = await realpath(workspaceRoot);
  const courseRoot = path.join(workspaceRoot, "data", "courses");
  const realCourseRoot = await realpath(courseRoot);
  if (!isWithin(realWorkspaceRoot, realCourseRoot)) {
    throw new Error(`COURSE_ASSET_ROOT_PATH_ESCAPE:${courseRoot}`);
  }
  const expectedRealCourseRoot = path.join(realWorkspaceRoot, "data", "courses");
  const courseRootStats = await lstat(courseRoot);
  if (
    courseRootStats.isSymbolicLink()
    || !isSamePath(expectedRealCourseRoot, realCourseRoot)
  ) {
    throw new Error(`COURSE_ASSET_ROOT_SYMLINK_NOT_ALLOWED:${courseRoot}`);
  }

  const assets = [];
  for (const pngFile of await listPngFiles(courseRoot, realCourseRoot)) {
    const bytes = await readFile(pngFile.readPath);
    assets.push({
      path: pngFile.manifestPath,
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  assets.sort((left, right) => compareCodePoints(left.path, right.path));
  return CoursePngManifestSchema.parse({
    schemaVersion: 1,
    root: "data/courses",
    algorithm: "sha256",
    assetCount: assets.length,
    totalBytes: assets.reduce((total, asset) => total + asset.sizeBytes, 0),
    assets,
  });
}

export function serializeCoursePngManifest(manifest: CoursePngManifest) {
  return `${JSON.stringify(CoursePngManifestSchema.parse(manifest), null, 2)}\n`;
}

export async function writeCoursePngManifest(
  options: { workspaceRoot?: string } = {},
): Promise<CoursePngManifest> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const manifest = await buildCoursePngManifest({ workspaceRoot });
  const outputPath = path.join(workspaceRoot, COURSE_PNG_MANIFEST_PATH);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serializeCoursePngManifest(manifest), "utf8");
  return manifest;
}

export async function verifyCoursePngManifest(
  options: { workspaceRoot?: string } = {},
): Promise<CoursePngManifest> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const outputPath = path.join(workspaceRoot, COURSE_PNG_MANIFEST_PATH);
  const tracked = CoursePngManifestSchema.parse(
    JSON.parse(await readFile(outputPath, "utf8")),
  );
  const actual = await buildCoursePngManifest({ workspaceRoot });
  if (serializeCoursePngManifest(actual) !== serializeCoursePngManifest(tracked)) {
    throw new Error("COURSE_PNG_MANIFEST_DRIFT");
  }
  return actual;
}

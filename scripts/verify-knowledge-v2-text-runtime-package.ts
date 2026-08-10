import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  verifyKnowledgeV2TextRuntimePackageManifest,
} from "@/lib/operations/knowledge-v2-text-runtime-package";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MANIFEST_NAME = "runtime-manifest.json";

function sha256(value: Buffer | string) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function within(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (
      !relative.startsWith("..")
      && !path.isAbsolute(relative)
    );
}

async function walkFiles(
  root: string,
  directory = root,
): Promise<string[]> {
  const output: string[] = [];
  const entries = await readdir(directory, {
    withFileTypes: true,
  });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      throw new Error(
        "KNOWLEDGE_V2_TEXT_PACKAGE_SYMLINK_NOT_ALLOWED",
      );
    }
    if (entry.isDirectory()) {
      output.push(...await walkFiles(root, absolute));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        "KNOWLEDGE_V2_TEXT_PACKAGE_ENTRY_INVALID",
      );
    }
    output.push(
      path.relative(root, absolute).replaceAll("\\", "/"),
    );
  }
  return output.sort((left, right) =>
    left.localeCompare(right, "en"));
}

export function parseKnowledgeV2TextPackageVerificationArguments(
  argv: readonly string[],
) {
  const args = argv[0] === "--"
    ? argv.slice(1)
    : [...argv];
  if (
    args.length !== 2
    || args[0] !== "--package-root"
    || !args[1]
  ) {
    throw new Error(
      "usage: verify-knowledge-v2-text-runtime-package --package-root <path>",
    );
  }
  return { packageRoot: args[1] };
}

export async function verifyKnowledgeV2TextRuntimePackage(
  input: { packageRoot: string },
  options: { workspaceRoot?: string } = {},
) {
  const currentWorkspace = path.resolve(
    options.workspaceRoot ?? workspaceRoot,
  );
  const packageRoot = path.resolve(
    currentWorkspace,
    input.packageRoot,
  );
  const realPackageRoot = await realpath(packageRoot);
  if (!within(currentWorkspace, packageRoot)) {
    throw new Error(
      "KNOWLEDGE_V2_TEXT_PACKAGE_ROOT_OUTSIDE_WORKSPACE",
    );
  }
  const manifestBytes = await readFile(
    path.join(realPackageRoot, MANIFEST_NAME),
  );
  const manifest =
    verifyKnowledgeV2TextRuntimePackageManifest(
      JSON.parse(manifestBytes.toString("utf8")),
    );
  const actualFiles = await walkFiles(realPackageRoot);
  const expectedFiles = [
    ...manifest.files.map(({ path }) => path),
    MANIFEST_NAME,
  ].sort((left, right) =>
    left.localeCompare(right, "en"));
  if (actualFiles.join("\n") !== expectedFiles.join("\n")) {
    throw new Error(
      "KNOWLEDGE_V2_TEXT_PACKAGE_FILE_SET_DRIFT",
    );
  }
  for (const expected of manifest.files) {
    const candidate = path.resolve(
      realPackageRoot,
      expected.path,
    );
    if (!within(realPackageRoot, candidate)) {
      throw new Error(
        `KNOWLEDGE_V2_TEXT_PACKAGE_PATH_ESCAPE:${expected.path}`,
      );
    }
    const info = await lstat(candidate);
    const actual = await realpath(candidate);
    if (
      info.isSymbolicLink()
      || !info.isFile()
      || !within(realPackageRoot, actual)
    ) {
      throw new Error(
        `KNOWLEDGE_V2_TEXT_PACKAGE_FILE_INVALID:${expected.path}`,
      );
    }
    const bytes = await readFile(actual);
    if (
      bytes.byteLength !== expected.bytes
      || sha256(bytes) !== expected.sha256
    ) {
      throw new Error(
        `KNOWLEDGE_V2_TEXT_PACKAGE_FILE_HASH_DRIFT:${expected.path}`,
      );
    }
  }
  return {
    manifest,
    manifestSha256: sha256(manifestBytes),
  };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  const parsed =
    parseKnowledgeV2TextPackageVerificationArguments(
      process.argv.slice(2),
    );
  verifyKnowledgeV2TextRuntimePackage(parsed)
    .then(({ manifest, manifestSha256 }) => {
      console.log(JSON.stringify({
        ok: true,
        status: manifest.status,
        attemptId: manifest.attemptId,
        sourceCommit: manifest.source.commit,
        fileCount: manifest.fileCount,
        totalBytes: manifest.totalBytes,
        manifestSha256,
        corpusBundleHash:
          manifest.bindings.corpusBundleHash,
        controlBundleHash:
          manifest.bindings.controlBundleHash,
        providerIndexHash:
          manifest.bindings.providerIndexHash,
        modelSealSha256:
          manifest.bindings.modelSealSha256,
        visualIncluded:
          manifest.visualIncluded,
      }));
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error
          ? error.message
          : "KNOWLEDGE_V2_TEXT_PACKAGE_VERIFY_FAILED",
      );
      process.exitCode = 1;
    });
}

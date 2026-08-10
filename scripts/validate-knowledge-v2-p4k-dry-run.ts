import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  open,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  verifyKnowledgeV2TextRuntimePackage,
} from "@/scripts/verify-knowledge-v2-text-runtime-package";

const ARGUMENTS = [
  "--isolation-root",
  "--database-copy",
  "--service-database",
  "--package-root",
  "--control-dir",
] as const;

type P4KArguments = {
  isolationRoot: string;
  databaseCopy: string;
  serviceDatabase: string;
  packageRoot: string;
  controlDir: string;
};

type PackageVerifierResult = {
  manifestSha256: string;
  manifest: {
    bindings: { controlBundleHash: string };
    visualIncluded: boolean;
  };
};

function keyFor(flag: typeof ARGUMENTS[number]) {
  return flag.slice(2).replace(
    /-([a-z])/g,
    (_, letter: string) => letter.toUpperCase(),
  ) as keyof P4KArguments;
}

function within(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (
      !relative.startsWith("..")
      && !path.isAbsolute(relative)
    );
}

export function parseKnowledgeV2P4KDryRunArguments(
  argv: readonly string[],
): P4KArguments {
  const args = argv[0] === "--"
    ? argv.slice(1)
    : [...argv];
  if (args.length !== ARGUMENTS.length * 2) {
    throw new Error(
      "usage: knowledge-v2-p4k-dry-run --isolation-root <path> --database-copy <path> --service-database <path> --package-root <path> --control-dir <path>",
    );
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !ARGUMENTS.includes(
        flag as typeof ARGUMENTS[number],
      )
      || !value
      || values.has(flag!)
    ) {
      throw new Error(
        "KNOWLEDGE_V2_P4K_ARGUMENTS_INVALID",
      );
    }
    values.set(flag!, value);
  }
  return Object.fromEntries(
    ARGUMENTS.map((flag) => [
      keyFor(flag),
      values.get(flag),
    ]),
  ) as P4KArguments;
}

async function inspectPath(
  candidate: string,
  expected: "file" | "directory",
) {
  if (!path.isAbsolute(candidate)) {
    throw new Error(
      "KNOWLEDGE_V2_P4K_PATH_NOT_ABSOLUTE",
    );
  }
  const info = await lstat(candidate);
  if (
    info.isSymbolicLink()
    || (expected === "file"
      ? !info.isFile()
      : !info.isDirectory())
  ) {
    throw new Error(
      "KNOWLEDGE_V2_P4K_PATH_TYPE_INVALID",
    );
  }
  return realpath(candidate);
}

async function assertSqliteFile(candidate: string) {
  const handle = await open(candidate, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(
      header,
      0,
      header.byteLength,
      0,
    );
    if (
      bytesRead !== 16
      || header.toString("binary") !== "SQLite format 3\u0000"
    ) {
      throw new Error(
        "KNOWLEDGE_V2_P4K_DATABASE_COPY_INVALID",
      );
    }
  } finally {
    await handle.close();
  }
}

async function sha256File(candidate: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(candidate)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export async function validateKnowledgeV2P4KDryRun(
  input: P4KArguments,
  options: {
    packageVerifier?: (
      packageRoot: string,
      isolationRoot: string,
    ) => Promise<PackageVerifierResult>;
  } = {},
) {
  const isolationRoot = await inspectPath(
    input.isolationRoot,
    "directory",
  );
  const databaseCopy = await inspectPath(
    input.databaseCopy,
    "file",
  );
  const serviceDatabase = await inspectPath(
    input.serviceDatabase,
    "file",
  );
  const packageRoot = await inspectPath(
    input.packageRoot,
    "directory",
  );
  const controlDir = await inspectPath(
    input.controlDir,
    "directory",
  );
  if (
    !within(isolationRoot, databaseCopy)
    || !within(isolationRoot, packageRoot)
    || !within(isolationRoot, controlDir)
    || !within(packageRoot, controlDir)
  ) {
    throw new Error(
      "KNOWLEDGE_V2_P4K_ISOLATION_BOUNDARY_INVALID",
    );
  }
  if (databaseCopy === serviceDatabase) {
    throw new Error(
      "KNOWLEDGE_V2_P4K_SERVICE_DATABASE_REJECTED",
    );
  }
  await assertSqliteFile(databaseCopy);
  const verifyPackage = options.packageVerifier
    ?? (async (root, workspace) =>
      verifyKnowledgeV2TextRuntimePackage(
        { packageRoot: root },
        { workspaceRoot: workspace },
      ));
  const verified = await verifyPackage(
    packageRoot,
    isolationRoot,
  );
  if (
    verified.manifest.visualIncluded
    || path.basename(controlDir)
      !== verified.manifest.bindings.controlBundleHash
  ) {
    throw new Error(
      "KNOWLEDGE_V2_P4K_ARTIFACT_BINDING_INVALID",
    );
  }
  return {
    status: "P4K_DRY_RUN_GO" as const,
    productionDatabase: "NOT_USED" as const,
    databaseCopySha256:
      await sha256File(databaseCopy),
    packageManifestSha256:
      verified.manifestSha256,
    controlBundleHash:
      verified.manifest.bindings.controlBundleHash,
    visualIncluded: false as const,
  };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  validateKnowledgeV2P4KDryRun(
    parseKnowledgeV2P4KDryRunArguments(
      process.argv.slice(2),
    ),
  )
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(
        error instanceof Error
          ? error.message
          : "KNOWLEDGE_V2_P4K_DRY_RUN_FAILED",
      );
      process.exitCode = 1;
    });
}

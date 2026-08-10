import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  buildKnowledgeV2TextRuntimePackageManifest,
  KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS,
  type KnowledgeV2TextRuntimeFile,
} from "@/lib/operations/knowledge-v2-text-runtime-package";
import {
  verifyKnowledgeIndexPayloadsV2,
} from "@/lib/knowledge/knowledge-index-v2";
import {
  verifyKnowledgeIndexBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const MODEL_SOURCE = [
  ".runtime",
  "text-retrieval",
  "hf",
  "models--BAAI--bge-small-zh-v1.5",
  "snapshots",
  KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelRevision,
].join("/");
const MODEL_TARGET = [
  ".runtime",
  "knowledge-v2-linux",
  "models",
  "BAAI--bge-small-zh-v1.5",
  KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelRevision,
].join("/");
const MODEL_SEAL_SOURCE =
  ".runtime/text-retrieval/seals/bge-small-zh-v1.5.json";
const MODEL_SEAL_TARGET =
  ".runtime/knowledge-v2-linux/seals/bge-small-zh-v1.5.json";
const CONTROL_SOURCE =
  `.runtime/knowledge-index/control/${KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.controlBundleHash}`;
const CONTROL_FILES = Object.freeze([
  "configs-by-version.v2.json",
  "knowledge-index-bundle.v2.json",
  "packaging-report.v2.json",
]);
const CORPUS_SOURCE =
  "data/knowledge-v2/knowledge-corpus.v2.json";
const MANIFEST_NAME = "runtime-manifest.json";

type PackageArguments = {
  sourceWorkspace: string;
  attemptId: string;
  sourceCommit: string;
};

type ModelSeal = {
  schemaVersion: number;
  modelId: string;
  modelRevision: string;
  license: string;
  directorySha256: string;
  files: Array<{
    path: string;
    sizeBytes: number;
    sha256: string;
  }>;
};

function sha256Bytes(value: Buffer | string) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function safeRelativePath(value: string) {
  if (
    !value
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || value.includes("\\")
    || value.split("/").includes("..")
  ) {
    throw new Error(
      `KNOWLEDGE_V2_TEXT_PACKAGE_SOURCE_PATH_UNSAFE:${value}`,
    );
  }
  return value;
}

function within(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (
      !relative.startsWith("..")
      && !path.isAbsolute(relative)
    );
}

async function assertRegularContainedFile(
  root: string,
  relativePath: string,
) {
  const safe = safeRelativePath(relativePath);
  const resolvedRoot = await realpath(root);
  const candidate = path.resolve(root, safe);
  if (!within(path.resolve(root), candidate)) {
    throw new Error(
      `KNOWLEDGE_V2_TEXT_PACKAGE_SOURCE_PATH_ESCAPE:${safe}`,
    );
  }
  const info = await lstat(candidate);
  const actual = await realpath(candidate);
  if (
    info.isSymbolicLink()
    || !info.isFile()
    || !within(resolvedRoot, actual)
  ) {
    throw new Error(
      `KNOWLEDGE_V2_TEXT_PACKAGE_SOURCE_FILE_INVALID:${safe}`,
    );
  }
  return actual;
}

async function copyBoundFile(input: {
  sourceRoot: string;
  sourcePath: string;
  targetRoot: string;
  targetPath: string;
  role: KnowledgeV2TextRuntimeFile["role"];
  expectedBytes?: number;
  expectedSha256?: string;
}) {
  const source = await assertRegularContainedFile(
    input.sourceRoot,
    input.sourcePath,
  );
  const bytes = await readFile(source);
  const digest = sha256Bytes(bytes);
  if (
    input.expectedBytes !== undefined
      && bytes.byteLength !== input.expectedBytes
    || input.expectedSha256 !== undefined
      && digest !== input.expectedSha256
  ) {
    throw new Error(
      `KNOWLEDGE_V2_TEXT_PACKAGE_SOURCE_HASH_DRIFT:${input.sourcePath}`,
    );
  }
  const targetPath = safeRelativePath(input.targetPath);
  const target = path.resolve(input.targetRoot, targetPath);
  if (!within(path.resolve(input.targetRoot), target)) {
    throw new Error(
      `KNOWLEDGE_V2_TEXT_PACKAGE_TARGET_PATH_ESCAPE:${targetPath}`,
    );
  }
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  const copied = await readFile(target);
  if (sha256Bytes(copied) !== digest) {
    throw new Error(
      `KNOWLEDGE_V2_TEXT_PACKAGE_COPY_DRIFT:${targetPath}`,
    );
  }
  return {
    path: targetPath,
    role: input.role,
    bytes: copied.byteLength,
    sha256: digest,
  } satisfies KnowledgeV2TextRuntimeFile;
}

export function parseKnowledgeV2TextPackageArguments(
  argv: readonly string[],
) {
  const args = argv[0] === "--"
    ? argv.slice(1)
    : [...argv];
  if (
    args.length !== 6
    || args[0] !== "--source-workspace"
    || args[2] !== "--attempt-id"
    || args[4] !== "--source-commit"
  ) {
    throw new Error(
      "usage: create-knowledge-v2-text-runtime-package --source-workspace <path> --attempt-id <t8-linux-text-id> --source-commit <40-lowercase-hex>",
    );
  }
  return {
    sourceWorkspace: args[1] ?? "",
    attemptId: args[3] ?? "",
    sourceCommit: args[5] ?? "",
  } satisfies PackageArguments;
}

export async function createKnowledgeV2TextRuntimePackage(
  input: PackageArguments,
  options: { workspaceRoot?: string } = {},
) {
  const currentWorkspace = path.resolve(
    options.workspaceRoot ?? workspaceRoot,
  );
  const sourceWorkspace = path.resolve(
    currentWorkspace,
    input.sourceWorkspace,
  );
  await stat(sourceWorkspace);
  const packageParent = path.join(
    currentWorkspace,
    ".runtime",
    "knowledge-v2-text-runtime",
  );
  const attemptRoot = path.join(
    packageParent,
    input.attemptId,
  );
  try {
    await stat(attemptRoot);
    throw new Error(
      "KNOWLEDGE_V2_TEXT_PACKAGE_ATTEMPT_EXISTS",
    );
  } catch (error) {
    if (
      error instanceof Error
      && error.message
        === "KNOWLEDGE_V2_TEXT_PACKAGE_ATTEMPT_EXISTS"
    ) {
      throw error;
    }
    if (
      (error as NodeJS.ErrnoException).code
        !== "ENOENT"
    ) {
      throw error;
    }
  }
  await mkdir(packageParent, { recursive: true });
  const staging = path.join(
    packageParent,
    `.incomplete-${input.attemptId}-${randomUUID()}`,
  );
  await mkdir(staging);
  try {
    const files: KnowledgeV2TextRuntimeFile[] = [];
    const sealBytes = await readFile(
      await assertRegularContainedFile(
        sourceWorkspace,
        MODEL_SEAL_SOURCE,
      ),
    );
    if (
      sha256Bytes(sealBytes)
        !== KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelSealSha256
    ) {
      throw new Error(
        "KNOWLEDGE_V2_TEXT_PACKAGE_MODEL_SEAL_HASH_DRIFT",
      );
    }
    const seal = JSON.parse(
      sealBytes.toString("utf8"),
    ) as ModelSeal;
    if (
      seal.schemaVersion !== 1
      || seal.modelId
        !== KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelId
      || seal.modelRevision
        !== KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelRevision
      || seal.directorySha256
        !== KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelDirectorySha256
      || !Array.isArray(seal.files)
      || seal.files.length < 1
    ) {
      throw new Error(
        "KNOWLEDGE_V2_TEXT_PACKAGE_MODEL_SEAL_INVALID",
      );
    }
    for (const modelFile of seal.files) {
      files.push(await copyBoundFile({
        sourceRoot: sourceWorkspace,
        sourcePath:
          `${MODEL_SOURCE}/${safeRelativePath(modelFile.path)}`,
        targetRoot: staging,
        targetPath:
          `${MODEL_TARGET}/${safeRelativePath(modelFile.path)}`,
        role: "MODEL_SNAPSHOT",
        expectedBytes: modelFile.sizeBytes,
        expectedSha256: modelFile.sha256,
      }));
    }
    files.push(await copyBoundFile({
      sourceRoot: sourceWorkspace,
      sourcePath: MODEL_SEAL_SOURCE,
      targetRoot: staging,
      targetPath: MODEL_SEAL_TARGET,
      role: "MODEL_SEAL",
      expectedSha256:
        KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelSealSha256,
    }));

    const corpus = JSON.parse(await readFile(
      await assertRegularContainedFile(
        sourceWorkspace,
        CORPUS_SOURCE,
      ),
      "utf8",
    )) as unknown;
    files.push(await copyBoundFile({
      sourceRoot: sourceWorkspace,
      sourcePath: CORPUS_SOURCE,
      targetRoot: staging,
      targetPath: CORPUS_SOURCE,
      role: "CORPUS",
    }));
    const controlBundlePath =
      `${CONTROL_SOURCE}/knowledge-index-bundle.v2.json`;
    const controlBundle = verifyKnowledgeIndexBundleV2(
      JSON.parse(await readFile(
        await assertRegularContainedFile(
          sourceWorkspace,
          controlBundlePath,
        ),
        "utf8",
      )),
      corpus,
    );
    if (
      controlBundle.indexBundleHash
        !== KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.controlBundleHash
      || controlBundle.corpusBundleHash
        !== KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.corpusBundleHash
    ) {
      throw new Error(
        "KNOWLEDGE_V2_TEXT_PACKAGE_CONTROL_IDENTITY_DRIFT",
      );
    }
    await verifyKnowledgeIndexPayloadsV2({
      workspaceRoot: sourceWorkspace,
      indexBundle: controlBundle,
      corpusBundle: corpus,
      providerIndexHashes: [
        KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.providerIndexHash,
      ],
    });
    const actualControlFiles = (
      await readdir(path.resolve(
        sourceWorkspace,
        CONTROL_SOURCE,
      ))
    ).sort();
    if (
      actualControlFiles.join("\n")
        !== [...CONTROL_FILES].sort().join("\n")
    ) {
      throw new Error(
        "KNOWLEDGE_V2_TEXT_PACKAGE_CONTROL_FILE_SET_DRIFT",
      );
    }
    for (const name of CONTROL_FILES) {
      files.push(await copyBoundFile({
        sourceRoot: sourceWorkspace,
        sourcePath: `${CONTROL_SOURCE}/${name}`,
        targetRoot: staging,
        targetPath: `${CONTROL_SOURCE}/${name}`,
        role: "CONTROL",
      }));
    }
    const providerPayloads = (
      controlBundle.sharedPayloads ?? []
    ).filter((payload) =>
      payload.storageKey.includes(
        KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.providerIndexHash,
      ));
    if (providerPayloads.length !== 2) {
      throw new Error(
        "KNOWLEDGE_V2_TEXT_PACKAGE_PROVIDER_PAYLOAD_SET_INVALID",
      );
    }
    for (const payload of providerPayloads) {
      files.push(await copyBoundFile({
        sourceRoot: sourceWorkspace,
        sourcePath: payload.storageKey,
        targetRoot: staging,
        targetPath: payload.storageKey,
        role: "TEXT_PROVIDER",
        expectedBytes: payload.byteLength,
        expectedSha256: payload.sha256,
      }));
    }

    files.push(await copyBoundFile({
      sourceRoot: currentWorkspace,
      sourcePath:
        "tools/text-retrieval/text_retrieval.py",
      targetRoot: staging,
      targetPath:
        "tools/text-retrieval/text_retrieval.py",
      role: "SIDECAR",
    }));
    files.push(await copyBoundFile({
      sourceRoot: currentWorkspace,
      sourcePath:
        "tools/text-retrieval/requirements-linux-cpu.lock",
      targetRoot: staging,
      targetPath:
        "metadata/requirements-linux-cpu.lock",
      role: "DEPENDENCY_LOCK",
    }));
    for (const [sourcePath, targetPath] of [
      [
        "third_party/knowledge-v2/NOTICE-LINUX-TEXT-RUNTIME.md",
        "metadata/NOTICE.md",
      ],
      [
        "third_party/knowledge-v2/LICENSE-MIT.txt",
        "metadata/LICENSE-MIT.txt",
      ],
      [
        "third_party/knowledge-v2/LICENSE-APACHE-2.0.txt",
        "metadata/LICENSE-APACHE-2.0.txt",
      ],
      [
        "third_party/knowledge-v2/LICENSE-PYTORCH-2.11.0.txt",
        "metadata/LICENSE-PYTORCH-2.11.0.txt",
      ],
    ] as const) {
      files.push(await copyBoundFile({
        sourceRoot: currentWorkspace,
        sourcePath,
        targetRoot: staging,
        targetPath,
        role: "THIRD_PARTY_NOTICE",
      }));
    }

    const manifest =
      buildKnowledgeV2TextRuntimePackageManifest({
        attemptId: input.attemptId,
        sourceCommit: input.sourceCommit,
        files,
      });
    await writeFile(
      path.join(staging, MANIFEST_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await rename(staging, attemptRoot);
    return {
      packageRoot: attemptRoot,
      manifest,
      manifestSha256: sha256Bytes(
        `${JSON.stringify(manifest, null, 2)}\n`,
      ),
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  const parsed = parseKnowledgeV2TextPackageArguments(
    process.argv.slice(2),
  );
  createKnowledgeV2TextRuntimePackage(parsed)
    .then(({ manifest, manifestSha256 }) => {
      console.log(JSON.stringify({
        ok: true,
        status: manifest.status,
        attemptId: manifest.attemptId,
        sourceCommit: manifest.source.commit,
        target: manifest.target,
        fileCount: manifest.fileCount,
        totalBytes: manifest.totalBytes,
        manifestSha256,
        corpusBundleHash:
          manifest.bindings.corpusBundleHash,
        controlBundleHash:
          manifest.bindings.controlBundleHash,
        providerIndexHash:
          manifest.bindings.providerIndexHash,
        modelRevision:
          manifest.bindings.modelRevision,
        visualIncluded:
          manifest.visualIncluded,
      }));
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error
          ? error.message
          : "KNOWLEDGE_V2_TEXT_PACKAGE_FAILED",
      );
      process.exitCode = 1;
    });
}

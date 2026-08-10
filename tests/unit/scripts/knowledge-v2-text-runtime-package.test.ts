// @vitest-environment node

import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  buildKnowledgeV2TextRuntimePackageManifest,
  type KnowledgeV2TextRuntimeFile,
} from "@/lib/operations/knowledge-v2-text-runtime-package";
import {
  parseKnowledgeV2TextPackageArguments,
} from "@/scripts/create-knowledge-v2-text-runtime-package";
import {
  parseKnowledgeV2TextPackageVerificationArguments,
  verifyKnowledgeV2TextRuntimePackage,
} from "@/scripts/verify-knowledge-v2-text-runtime-package";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(
    (root) => rm(root, { recursive: true, force: true }),
  ));
});

function digest(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

const SPECS = [
  [
    ".runtime/knowledge-v2-linux/models/bge/config.json",
    "MODEL_SNAPSHOT",
  ],
  [
    ".runtime/knowledge-v2-linux/models/bge/model.safetensors",
    "MODEL_SNAPSHOT",
  ],
  [
    ".runtime/knowledge-v2-linux/seals/bge.json",
    "MODEL_SEAL",
  ],
  [
    "data/knowledge-v2/knowledge-corpus.v2.json",
    "CORPUS",
  ],
  [
    ".runtime/knowledge-index/control/control.json",
    "CONTROL",
  ],
  [
    ".runtime/knowledge-index/providers/bge/index-manifest.json",
    "TEXT_PROVIDER",
  ],
  [
    ".runtime/knowledge-index/providers/bge/embeddings.safetensors",
    "TEXT_PROVIDER",
  ],
  [
    "tools/text-retrieval/text_retrieval.py",
    "SIDECAR",
  ],
  [
    "metadata/requirements-linux-cpu.lock",
    "DEPENDENCY_LOCK",
  ],
  [
    "metadata/NOTICE.md",
    "THIRD_PARTY_NOTICE",
  ],
] as const;

async function packageFixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "knowledge-v2-text-package-"),
  );
  temporaryRoots.push(root);
  const packageRoot = path.join(root, "package");
  await mkdir(packageRoot);
  const files: KnowledgeV2TextRuntimeFile[] = [];
  for (let index = 0; index < SPECS.length; index += 1) {
    const [relativePath, role] = SPECS[index]!;
    const content = `fixture-${index}`;
    const absolutePath = path.join(
      packageRoot,
      relativePath,
    );
    await mkdir(path.dirname(absolutePath), {
      recursive: true,
    });
    await writeFile(absolutePath, content, "utf8");
    files.push({
      path: relativePath,
      role,
      bytes: Buffer.byteLength(content),
      sha256: digest(content),
    });
  }
  const manifest =
    buildKnowledgeV2TextRuntimePackageManifest({
      attemptId: "t8-linux-text-fixture",
      sourceCommit: "a".repeat(40),
      files,
    });
  await writeFile(
    path.join(packageRoot, "runtime-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return { root, packageRoot, manifest };
}

describe("Knowledge V2 text package scripts", () => {
  it("parses bounded create and verify arguments", () => {
    expect(parseKnowledgeV2TextPackageArguments([
      "--source-workspace",
      "../lumi-candidate",
      "--attempt-id",
      "t8-linux-text-v1",
      "--source-commit",
      "a".repeat(40),
    ])).toEqual({
      sourceWorkspace: "../lumi-candidate",
      attemptId: "t8-linux-text-v1",
      sourceCommit: "a".repeat(40),
    });
    expect(
      parseKnowledgeV2TextPackageVerificationArguments([
        "--package-root",
        ".runtime/package",
      ]),
    ).toEqual({ packageRoot: ".runtime/package" });
  });

  it("verifies every file and rejects undeclared additions", async () => {
    const fixture = await packageFixture();
    const verified =
      await verifyKnowledgeV2TextRuntimePackage(
        { packageRoot: fixture.packageRoot },
        { workspaceRoot: fixture.root },
      );
    expect(verified.manifest)
      .toEqual(fixture.manifest);

    await writeFile(
      path.join(fixture.packageRoot, "unexpected.txt"),
      "not declared",
      "utf8",
    );
    await expect(
      verifyKnowledgeV2TextRuntimePackage(
        { packageRoot: fixture.packageRoot },
        { workspaceRoot: fixture.root },
      ),
    ).rejects.toThrow(
      "KNOWLEDGE_V2_TEXT_PACKAGE_FILE_SET_DRIFT",
    );
  });

  it("rejects modified payload bytes", async () => {
    const fixture = await packageFixture();
    await writeFile(
      path.join(
        fixture.packageRoot,
        SPECS[0][0],
      ),
      "drifted",
      "utf8",
    );
    await expect(
      verifyKnowledgeV2TextRuntimePackage(
        { packageRoot: fixture.packageRoot },
        { workspaceRoot: fixture.root },
      ),
    ).rejects.toThrow(
      "KNOWLEDGE_V2_TEXT_PACKAGE_FILE_HASH_DRIFT",
    );
  });
});

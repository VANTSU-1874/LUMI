// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  buildKnowledgeV2TextRuntimePackageManifest,
  verifyKnowledgeV2TextRuntimePackageManifest,
  type KnowledgeV2TextRuntimeFile,
} from "@/lib/operations/knowledge-v2-text-runtime-package";

function file(
  path: string,
  role: KnowledgeV2TextRuntimeFile["role"],
  seed: string,
): KnowledgeV2TextRuntimeFile {
  return {
    path,
    role,
    bytes: 10,
    sha256: seed.repeat(64),
  };
}

function fixtureFiles() {
  return [
    file(
      ".runtime/knowledge-v2-linux/models/bge/config.json",
      "MODEL_SNAPSHOT",
      "1",
    ),
    file(
      ".runtime/knowledge-v2-linux/models/bge/model.safetensors",
      "MODEL_SNAPSHOT",
      "2",
    ),
    file(
      ".runtime/knowledge-v2-linux/seals/bge.json",
      "MODEL_SEAL",
      "3",
    ),
    file(
      "data/knowledge-v2/knowledge-corpus.v2.json",
      "CORPUS",
      "a",
    ),
    file(
      ".runtime/knowledge-index/control/control.json",
      "CONTROL",
      "4",
    ),
    file(
      ".runtime/knowledge-index/providers/bge/index-manifest.json",
      "TEXT_PROVIDER",
      "5",
    ),
    file(
      ".runtime/knowledge-index/providers/bge/embeddings.safetensors",
      "TEXT_PROVIDER",
      "6",
    ),
    file(
      "tools/text-retrieval/text_retrieval.py",
      "SIDECAR",
      "7",
    ),
    file(
      "metadata/requirements-linux-cpu.lock",
      "DEPENDENCY_LOCK",
      "8",
    ),
    file(
      "metadata/NOTICE.md",
      "THIRD_PARTY_NOTICE",
      "9",
    ),
  ];
}

describe("Knowledge V2 Linux text runtime package", () => {
  it("binds a sorted text-only payload to the frozen generation", () => {
    const manifest =
      buildKnowledgeV2TextRuntimePackageManifest({
        attemptId: "t8-linux-text-v1",
        sourceCommit: "a".repeat(40),
        files: fixtureFiles().reverse(),
      });

    expect(manifest).toMatchObject({
      status: "PAYLOAD_PREPARED",
      target: {
        os: "linux",
        arch: "x64",
        device: "cpu",
        pythonEnvironment:
          "TARGET_INSTALL_REQUIRED",
      },
      visualIncluded: false,
      source: { commit: "a".repeat(40) },
      fileCount: 10,
      totalBytes: 100,
      bindings: {
        corpusBundleHash:
          "a93e0aa90c3895e8d72b15f1aa9a6ae00857d835a012f980cc723648d7bdb661",
        controlBundleHash:
          "46d4b59d46a1c0a62d305390d6893285425f5ab2b92c1bb653accedd81c70ffe",
        providerIndexHash:
          "7c20366f4b50c97ed2f431b5aa5bbfdcd9a0c1005b0b7c9c533dc3309a843ead",
      },
    });
    expect(manifest.files.map(({ path }) => path))
      .toEqual(
        [...manifest.files.map(({ path }) => path)]
          .sort((left, right) =>
            left.localeCompare(right, "en")),
      );
    expect(
      verifyKnowledgeV2TextRuntimePackageManifest(
        manifest,
      ),
    ).toEqual(manifest);
  });

  it.each([
    "data/courses/layout/example.png",
    "metadata/service.env",
    "runtime/visual-retrieval/model.bin",
    "runtime/siglip/model.bin",
    "database/competition.sqlite",
  ])("rejects forbidden payload %s", (path) => {
    const files = fixtureFiles();
    files[0] = file(
      path,
      "MODEL_SNAPSHOT",
      "a",
    );
    expect(() =>
      buildKnowledgeV2TextRuntimePackageManifest({
        attemptId: "t8-linux-text-v1",
        sourceCommit: "a".repeat(40),
        files,
      })).toThrow(
      "KNOWLEDGE_V2_TEXT_PACKAGE_FORBIDDEN_FILE",
    );
  });

  it("rejects a manifest whose summary was rewritten", () => {
    const manifest =
      buildKnowledgeV2TextRuntimePackageManifest({
        attemptId: "t8-linux-text-v1",
        sourceCommit: "a".repeat(40),
        files: fixtureFiles(),
      });
    expect(() =>
      verifyKnowledgeV2TextRuntimePackageManifest({
        ...manifest,
        totalBytes: manifest.totalBytes + 1,
      })).toThrow(
      "KNOWLEDGE_V2_TEXT_PACKAGE_FILE_SUMMARY_INVALID",
    );
  });
});

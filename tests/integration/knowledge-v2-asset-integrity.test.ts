// @vitest-environment node

import {
  access,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  KNOWLEDGE_V2_BUNDLE_PATH,
  KNOWLEDGE_V2_REPORT_PATH,
} from "@/lib/knowledge/knowledge-v2-corpus";
import { verifyKnowledgeCorpusBundleV2 } from "@/lib/knowledge/knowledge-object-v2";
import { runKnowledgeIngestion } from "@/scripts/ingest-knowledge";

const repositoryRoot = process.cwd();
const temporaryRoots: string[] = [];

async function createIsolatedWorkspace(options: {
  linkAssets: boolean;
}) {
  const temporaryBase = path.join(repositoryRoot, ".runtime", "tests");
  await mkdir(temporaryBase, { recursive: true });
  const workspaceRoot = await mkdtemp(path.join(
    temporaryBase,
    "lumi-knowledge-v2-assets-",
  ));
  temporaryRoots.push(workspaceRoot);
  await Promise.all([
    cp(
      path.join(repositoryRoot, "data", "knowledge"),
      path.join(workspaceRoot, "data", "knowledge"),
      { recursive: true },
    ),
    cp(
      path.join(repositoryRoot, "data", "knowledge-v2"),
      path.join(workspaceRoot, "data", "knowledge-v2"),
      { recursive: true },
    ),
  ]);
  const bundle = verifyKnowledgeCorpusBundleV2(JSON.parse(await readFile(
    path.join(workspaceRoot, KNOWLEDGE_V2_BUNDLE_PATH),
    "utf8",
  )) as unknown);
  await access(path.join(workspaceRoot, KNOWLEDGE_V2_REPORT_PATH));

  if (options.linkAssets) {
    for (const asset of bundle.assets) {
      const source = path.join(
        repositoryRoot,
        asset.locator.root,
        asset.locator.path,
      );
      const target = path.join(
        workspaceRoot,
        asset.locator.root,
        asset.locator.path,
      );
      await mkdir(path.dirname(target), { recursive: true });
      await link(source, target);
    }
  }
  return { workspaceRoot, bundle };
}

function ingestionEnvironment(databasePath: string) {
  return {
    SESSION_SECRET: "asset-integrity-test-session-secret-0123456789",
    DATABASE_PATH: databasePath,
    EVIDENCE_ROOT: path.join(path.dirname(databasePath), "evidence"),
    KNOWLEDGE_OBJECT_V2: "true",
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("KnowledgeObjectV2 physical asset integrity", () => {
  it("fails before migration for a missing, tampered, or non-regular asset", async () => {
    const { workspaceRoot, bundle } = await createIsolatedWorkspace({
      linkAssets: true,
    });
    const asset = bundle.assets[0]!;
    const source = path.join(
      repositoryRoot,
      asset.locator.root,
      asset.locator.path,
    );
    const target = path.join(
      workspaceRoot,
      asset.locator.root,
      asset.locator.path,
    );

    await rm(target);
    const missingDatabase = path.join(workspaceRoot, "runtime", "missing.sqlite");
    await expect(runKnowledgeIngestion(
      ingestionEnvironment(missingDatabase),
      { workspaceRoot },
    )).rejects.toThrow(/KNOWLEDGE_V2_ASSET_MISSING/);
    await expect(access(missingDatabase)).rejects.toMatchObject({ code: "ENOENT" });

    const tampered = await readFile(source);
    tampered[0] = tampered[0]! ^ 0xff;
    await writeFile(target, tampered);
    const tamperedDatabase = path.join(workspaceRoot, "runtime", "tampered.sqlite");
    await expect(runKnowledgeIngestion(
      ingestionEnvironment(tamperedDatabase),
      { workspaceRoot },
    )).rejects.toThrow(/KNOWLEDGE_V2_ASSET_HASH_DRIFT/);
    await expect(access(tamperedDatabase)).rejects.toMatchObject({ code: "ENOENT" });

    await writeFile(target, "wrong-size");
    const sizeDatabase = path.join(workspaceRoot, "runtime", "size.sqlite");
    await expect(runKnowledgeIngestion(
      ingestionEnvironment(sizeDatabase),
      { workspaceRoot },
    )).rejects.toThrow(/KNOWLEDGE_V2_ASSET_SIZE_DRIFT/);
    await expect(access(sizeDatabase)).rejects.toMatchObject({ code: "ENOENT" });

    await rm(target);
    await mkdir(target);
    const directoryDatabase = path.join(workspaceRoot, "runtime", "directory.sqlite");
    await expect(runKnowledgeIngestion(
      ingestionEnvironment(directoryDatabase),
      { workspaceRoot },
    )).rejects.toThrow(/KNOWLEDGE_V2_ASSET_NOT_REGULAR_FILE/);
    await expect(access(directoryDatabase)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked asset root before migration", async () => {
    const { workspaceRoot } = await createIsolatedWorkspace({
      linkAssets: false,
    });
    const courseRoot = path.join(workspaceRoot, "data", "courses");
    await symlink(
      path.join(repositoryRoot, "data", "courses"),
      courseRoot,
      process.platform === "win32" ? "junction" : "dir",
    );
    const databasePath = path.join(workspaceRoot, "runtime", "symlink.sqlite");

    await expect(runKnowledgeIngestion(
      ingestionEnvironment(databasePath),
      { workspaceRoot },
    )).rejects.toThrow(
      /KNOWLEDGE_V2_ASSET_ROOT_(?:PATH_ESCAPE|SYMLINK_NOT_ALLOWED)/,
    );
    await expect(access(databasePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

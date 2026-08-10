// @vitest-environment node

import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseKnowledgeV2P4KDryRunArguments,
  validateKnowledgeV2P4KDryRun,
} from "@/scripts/validate-knowledge-v2-p4k-dry-run";

const roots: string[] = [];
const controlHash = "a".repeat(64);
const manifestHash = "b".repeat(64);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), "lumi-p4k-"),
  );
  roots.push(parent);
  const isolationRoot = path.join(parent, "isolation");
  const packageRoot = path.join(isolationRoot, "package");
  const controlDir = path.join(
    packageRoot,
    ".runtime",
    "knowledge-index",
    "control",
    controlHash,
  );
  await mkdir(controlDir, { recursive: true });
  const databaseCopy = path.join(
    isolationRoot,
    "database-copy.sqlite",
  );
  const serviceDatabase = path.join(
    parent,
    "service.sqlite",
  );
  const sqliteHeader = Buffer.from(
    "SQLite format 3\u0000fixture",
    "binary",
  );
  await writeFile(databaseCopy, sqliteHeader);
  await writeFile(serviceDatabase, sqliteHeader);
  return {
    isolationRoot,
    databaseCopy,
    serviceDatabase,
    packageRoot,
    controlDir,
  };
}

const packageVerifier = async () => ({
  manifestSha256: manifestHash,
  manifest: {
    bindings: { controlBundleHash: controlHash },
    visualIncluded: false,
  },
});

describe("Knowledge V2 P4K dry-run", () => {
  it("requires every explicit isolation and artifact path", () => {
    expect(() => parseKnowledgeV2P4KDryRunArguments([]))
      .toThrow(/usage/);
    expect(() => parseKnowledgeV2P4KDryRunArguments([
      "--isolation-root", "a",
      "--database-copy", "b",
      "--service-database", "c",
      "--package-root", "d",
      "--package-root", "e",
    ])).toThrow(/ARGUMENTS_INVALID/);
  });

  it("accepts only a distinct SQLite copy and bound text package", async () => {
    const input = await fixture();
    await expect(validateKnowledgeV2P4KDryRun(
      input,
      { packageVerifier },
    )).resolves.toMatchObject({
      status: "P4K_DRY_RUN_GO",
      productionDatabase: "NOT_USED",
      packageManifestSha256: manifestHash,
      controlBundleHash: controlHash,
      visualIncluded: false,
    });
  });

  it("rejects the service database and paths outside isolation", async () => {
    const input = await fixture();
    await expect(validateKnowledgeV2P4KDryRun({
      ...input,
      databaseCopy: input.serviceDatabase,
    }, { packageVerifier })).rejects.toThrow(
      /ISOLATION_BOUNDARY_INVALID|SERVICE_DATABASE_REJECTED/,
    );
    await expect(validateKnowledgeV2P4KDryRun({
      ...input,
      packageRoot: path.dirname(input.isolationRoot),
    }, { packageVerifier })).rejects.toThrow(
      /ISOLATION_BOUNDARY_INVALID/,
    );
  });
});

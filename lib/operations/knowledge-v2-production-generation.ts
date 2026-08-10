import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { createActiveKnowledgeGenerationLoaderV2 } from "@/lib/knowledge/active-knowledge-generation-v2";
import { verifyKnowledgeIndexPayloadsV2 } from "@/lib/knowledge/knowledge-index-v2";
import {
  verifyKnowledgeCorpusBundleV2,
  verifyKnowledgeIndexBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  ingestVerifiedKnowledgeCorpusBundleV2,
  storeKnowledgeIndexBundleV2,
} from "@/lib/knowledge/knowledge-v2-store";

import {
  KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS,
  verifyKnowledgeV2TextRuntimePackageManifest,
} from "./knowledge-v2-text-runtime-package";

const MANIFEST_NAME = "runtime-manifest.json";
const CORPUS_PATH = "data/knowledge-v2/knowledge-corpus.v2.json";

function within(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

async function sha256File(filePath: string) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export async function prepareKnowledgeV2ProductionGeneration(input: {
  workspaceRoot: string;
  expectedCommit: string;
}) {
  if (!/^[a-f0-9]{40}$/.test(input.expectedCommit)) {
    throw new Error("KNOWLEDGE_V2_PRODUCTION_COMMIT_INVALID");
  }
  const workspaceRoot = await realpath(path.resolve(input.workspaceRoot));
  const manifestPath = path.join(workspaceRoot, MANIFEST_NAME);
  const manifestInfo = await lstat(manifestPath);
  const manifestRealPath = await realpath(manifestPath);
  if (
    manifestInfo.isSymbolicLink()
    || !manifestInfo.isFile()
    || !within(workspaceRoot, manifestRealPath)
  ) {
    throw new Error("KNOWLEDGE_V2_PRODUCTION_MANIFEST_INVALID");
  }
  const manifestBytes = await readFile(manifestRealPath);
  const manifest = verifyKnowledgeV2TextRuntimePackageManifest(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  if (manifest.source.commit !== input.expectedCommit) {
    throw new Error("KNOWLEDGE_V2_PRODUCTION_SOURCE_COMMIT_MISMATCH");
  }
  for (const expected of manifest.files) {
    const candidate = path.resolve(workspaceRoot, expected.path);
    if (!within(workspaceRoot, candidate)) {
      throw new Error(
        `KNOWLEDGE_V2_PRODUCTION_FILE_ESCAPE:${expected.path}`,
      );
    }
    const info = await lstat(candidate);
    const actual = await realpath(candidate);
    if (
      info.isSymbolicLink()
      || !info.isFile()
      || !within(workspaceRoot, actual)
    ) {
      throw new Error(
        `KNOWLEDGE_V2_PRODUCTION_FILE_INVALID:${expected.path}`,
      );
    }
    if (
      info.size !== expected.bytes
      || await sha256File(actual) !== expected.sha256
    ) {
      throw new Error(
        `KNOWLEDGE_V2_PRODUCTION_FILE_HASH_DRIFT:${expected.path}`,
      );
    }
  }
  const controlDirectory = path.join(
    workspaceRoot,
    ".runtime",
    "knowledge-index",
    "control",
    manifest.bindings.controlBundleHash,
  );
  const corpus = verifyKnowledgeCorpusBundleV2(await readJson(
    path.join(workspaceRoot, CORPUS_PATH),
  ));
  const index = verifyKnowledgeIndexBundleV2(
    await readJson(path.join(
      controlDirectory,
      "knowledge-index-bundle.v2.json",
    )),
    corpus,
  );
  const configs = await readJson(path.join(
    controlDirectory,
    "configs-by-version.v2.json",
  ));
  if (
    !configs
    || typeof configs !== "object"
    || Array.isArray(configs)
  ) {
    throw new Error("KNOWLEDGE_V2_PRODUCTION_CONFIGS_INVALID");
  }
  if (
    corpus.bundleHash !== manifest.bindings.corpusBundleHash
    || index.indexBundleHash !== manifest.bindings.controlBundleHash
  ) {
    throw new Error("KNOWLEDGE_V2_PRODUCTION_CONTROL_BINDING_MISMATCH");
  }
  const verifiedIndex = await verifyKnowledgeIndexPayloadsV2({
    workspaceRoot,
    corpusBundle: corpus,
    indexBundle: index,
    providerIndexHashes: [manifest.bindings.providerIndexHash],
  });
  return {
    workspaceRoot,
    manifest,
    manifestSha256: createHash("sha256")
      .update(manifestBytes)
      .digest("hex"),
    corpus,
    index: verifiedIndex,
    configs: configs as Record<string, Record<string, unknown>>,
  } as const;
}

function countRows(
  connection: ReturnType<typeof createDb>,
  table: string,
) {
  return (connection.sqlite.prepare(
    `SELECT count(*) count FROM ${table}`,
  ).get() as { count: number }).count;
}

export async function activateKnowledgeV2ProductionGeneration(input: {
  workspaceRoot: string;
  databasePath: string;
  expectedCommit: string;
  now?: number;
}) {
  const prepared = await prepareKnowledgeV2ProductionGeneration(input);
  const databasePath = path.resolve(input.databasePath);
  const databaseInfo = await stat(databasePath);
  if (!databaseInfo.isFile()) {
    throw new Error("KNOWLEDGE_V2_PRODUCTION_DATABASE_INVALID");
  }
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  try {
    const now = input.now ?? Date.now();
    const legacyBefore = countRows(connection, "knowledge_chunks");
    const ingestion = ingestVerifiedKnowledgeCorpusBundleV2(
      connection,
      prepared.corpus,
      { now },
    );
    const stored = await storeKnowledgeIndexBundleV2(
      connection,
      prepared.corpus,
      prepared.index,
      {
        configsByVersionId: prepared.configs,
        activate: true,
        now: now + 1,
        workspaceRoot: prepared.workspaceRoot,
        requireLegacyProjection: false,
        activationRequiredProviderIndexHashes: [
          prepared.manifest.bindings.providerIndexHash,
        ],
      },
    );
    const generation = await createActiveKnowledgeGenerationLoaderV2({
      connection,
      workspaceRoot: prepared.workspaceRoot,
      requireLegacyProjection: false,
      requiredProviderModels: [{
        modelId: prepared.manifest.bindings.modelId,
        modelRevision: prepared.manifest.bindings.modelRevision,
      }],
    }).load();
    const legacyAfter = countRows(connection, "knowledge_chunks");
    if (legacyAfter !== legacyBefore) {
      throw new Error("KNOWLEDGE_V2_PRODUCTION_LEGACY_MUTATED");
    }
    const foreignKeyViolations = connection.sqlite.pragma(
      "foreign_key_check",
    ) as unknown[];
    if (foreignKeyViolations.length > 0) {
      throw new Error("KNOWLEDGE_V2_PRODUCTION_FOREIGN_KEY_FAILURE");
    }
    const counts = {
      legacyKnowledgeChunkCount: legacyAfter,
      documentCount: countRows(connection, "knowledge_documents_v2"),
      nodeCount: countRows(connection, "knowledge_nodes_v2"),
      assetCount: countRows(connection, "knowledge_assets_v2"),
      representationCount: countRows(
        connection,
        "knowledge_index_entries_v2",
      ),
      activeCorpusCount: countRows(
        connection,
        "knowledge_active_corpus_v2",
      ),
      activeIndexCount: countRows(
        connection,
        "knowledge_active_index_bundle_v2",
      ),
    };
    if (
      counts.documentCount !== 808
      || counts.nodeCount !== 5_164
      || counts.assetCount !== 156
      || counts.representationCount !== 5_164
      || counts.activeCorpusCount !== 1
      || counts.activeIndexCount !== 1
    ) {
      throw new Error("KNOWLEDGE_V2_PRODUCTION_COUNTS_MISMATCH");
    }
    if (
      generation.corpus.bundleHash
        !== KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.corpusBundleHash
      || generation.activeIndexBundleHash
        !== KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.controlBundleHash
      || generation.verifiedProviderIndexBundleHashes.join("\n")
        !== KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.providerIndexHash
    ) {
      throw new Error("KNOWLEDGE_V2_PRODUCTION_GENERATION_MISMATCH");
    }
    return {
      status: "KNOWLEDGE_V2_PRODUCTION_GENERATION_ACTIVE" as const,
      sourceCommit: input.expectedCommit,
      manifestSha256: prepared.manifestSha256,
      generationKey: generation.generationKey,
      corpusBundleHash: generation.corpus.bundleHash,
      controlBundleHash: generation.activeIndexBundleHash,
      providerIndexHash:
        generation.verifiedProviderIndexBundleHashes[0]!,
      ingestion,
      stored,
      counts,
      foreignKeyCheck: "PASS" as const,
      legacyKnowledgeUnchanged: true as const,
    };
  } finally {
    connection.sqlite.close();
  }
}

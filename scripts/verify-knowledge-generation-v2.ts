import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { createActiveKnowledgeGenerationLoaderV2 } from "@/lib/knowledge/active-knowledge-generation-v2";
import { agentEvidenceRuntimeProfileV2 } from "@/lib/knowledge/agent-evidence-runtime-v2";
import { verifyKnowledgeCorpusBundleV2 } from "@/lib/knowledge/knowledge-object-v2";
import {
  verifyKnowledgeV2TextRuntimePackageManifest,
} from "@/lib/operations/knowledge-v2-text-runtime-package";
import {
  ingestPreparedKnowledgeV2,
  ingestVerifiedKnowledgeCorpusBundleV2,
  prepareKnowledgeV2Ingestion,
  storeKnowledgeIndexBundleV2,
} from "@/lib/knowledge/knowledge-v2-store";

type VerificationArguments = {
  workspaceRoot: string;
  controlDirectory: string;
  runtimeProfile?: "linux-text";
  packageManifest?: string;
};

export function parseKnowledgeGenerationVerificationArguments(
  argv: readonly string[],
): VerificationArguments {
  const parsed: Partial<VerificationArguments> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(
        "usage: verify-knowledge-generation-v2.ts "
        + "--workspace-root <path> --control-dir <path>",
      );
    }
    if (flag === "--workspace-root" && parsed.workspaceRoot === undefined) {
      parsed.workspaceRoot = value;
    } else if (
      flag === "--control-dir"
      && parsed.controlDirectory === undefined
    ) {
      parsed.controlDirectory = value;
    } else if (
      flag === "--runtime-profile"
      && parsed.runtimeProfile === undefined
      && value === "linux-text"
    ) {
      parsed.runtimeProfile = value;
    } else if (
      flag === "--package-manifest"
      && parsed.packageManifest === undefined
    ) {
      parsed.packageManifest = value;
    } else {
      throw new Error(`unknown or duplicate argument: ${flag ?? "<missing>"}`);
    }
  }
  if (!parsed.workspaceRoot || !parsed.controlDirectory) {
    throw new Error(
      "usage: verify-knowledge-generation-v2.ts "
      + "--workspace-root <path> --control-dir <path> "
      + "[--runtime-profile linux-text --package-manifest <path>]",
    );
  }
  if (
    (parsed.runtimeProfile === "linux-text")
      !== Boolean(parsed.packageManifest)
  ) {
    throw new Error(
      "KNOWLEDGE_GENERATION_TEXT_PROFILE_MANIFEST_REQUIRED",
    );
  }
  return parsed as VerificationArguments;
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export async function verifyKnowledgeGenerationV2(
  arguments_: VerificationArguments,
) {
  const linuxTextProfile = arguments_.runtimeProfile
    ? agentEvidenceRuntimeProfileV2("linux")
    : null;
  const workspaceRoot = await realpath(path.resolve(arguments_.workspaceRoot));
  const controlRoot = path.join(
    workspaceRoot,
    ".runtime",
    "knowledge-index",
    "control",
  );
  const controlDirectory = await realpath(path.resolve(
    arguments_.controlDirectory,
  ));
  const packageBinding = linuxTextProfile
    ? await (async () => {
        const candidate = path.resolve(
          arguments_.packageManifest!,
        );
        if (!isWithin(workspaceRoot, candidate)) {
          throw new Error(
            "KNOWLEDGE_GENERATION_PACKAGE_MANIFEST_OUTSIDE_WORKSPACE",
          );
        }
        const info = await lstat(candidate);
        const actual = await realpath(candidate);
        if (
          info.isSymbolicLink()
          || !info.isFile()
          || !isWithin(workspaceRoot, actual)
        ) {
          throw new Error(
            "KNOWLEDGE_GENERATION_PACKAGE_MANIFEST_INVALID",
          );
        }
        const bytes = await readFile(actual);
        const manifest =
          verifyKnowledgeV2TextRuntimePackageManifest(
            JSON.parse(bytes.toString("utf8")),
          );
        if (
          manifest.bindings.controlBundleHash
            !== path.basename(controlDirectory)
          || manifest.bindings.modelId
            !== linuxTextProfile.textModel.id
          || manifest.bindings.modelRevision
            !== linuxTextProfile.textModel.revision
        ) {
          throw new Error(
            "KNOWLEDGE_GENERATION_PACKAGE_BINDING_MISMATCH",
          );
        }
        return {
          manifest,
          sha256: createHash("sha256")
            .update(bytes)
            .digest("hex"),
        };
      })()
    : null;
  if (
    !isWithin(controlRoot, controlDirectory)
    || path.dirname(controlDirectory) !== controlRoot
  ) {
    throw new Error("KNOWLEDGE_GENERATION_CONTROL_DIRECTORY_OUTSIDE_RUNTIME");
  }

  const [indexBundle, configsByVersionId] = await Promise.all([
    readJson(path.join(controlDirectory, "knowledge-index-bundle.v2.json")),
    readJson(path.join(controlDirectory, "configs-by-version.v2.json")),
  ]);
  if (
    !indexBundle
    || typeof indexBundle !== "object"
    || !("indexBundleHash" in indexBundle)
    || indexBundle.indexBundleHash !== path.basename(controlDirectory)
  ) {
    throw new Error("KNOWLEDGE_GENERATION_CONTROL_HASH_DRIFT");
  }
  if (
    !configsByVersionId
    || typeof configsByVersionId !== "object"
    || Array.isArray(configsByVersionId)
  ) {
    throw new Error("KNOWLEDGE_GENERATION_CONFIGS_INVALID");
  }

  const temporaryRoot = await mkdtemp(path.join(
    tmpdir(),
    "lumi-knowledge-generation-v2-",
  ));
  let connection: DatabaseConnection | undefined;
  try {
    const databasePath = path.join(temporaryRoot, "knowledge.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    const prepared = linuxTextProfile
      ? null
      : await prepareKnowledgeV2Ingestion(workspaceRoot);
    const corpus = linuxTextProfile
      ? verifyKnowledgeCorpusBundleV2(await readJson(path.join(
          workspaceRoot,
          "data",
          "knowledge-v2",
          "knowledge-corpus.v2.json",
        )))
      : prepared!.bundle;
    if (
      packageBinding
      && packageBinding.manifest.bindings.corpusBundleHash
        !== corpus.bundleHash
    ) {
      throw new Error(
        "KNOWLEDGE_GENERATION_PACKAGE_CORPUS_BINDING_MISMATCH",
      );
    }
    if (linuxTextProfile) {
      ingestVerifiedKnowledgeCorpusBundleV2(connection, corpus, {
        now: 1,
      });
    } else {
      ingestPreparedKnowledgeV2(connection, prepared!, {
        now: 1,
      });
    }
    const stored = await storeKnowledgeIndexBundleV2(
      connection,
      corpus,
      indexBundle,
      {
        configsByVersionId: configsByVersionId as Record<
          string,
          Record<string, unknown>
        >,
        activate: true,
        now: 2,
        workspaceRoot,
        ...(linuxTextProfile
          ? { requireLegacyProjection: false }
          : {}),
        ...(linuxTextProfile
          ? {
            activationRequiredProviderIndexHashes: [
                packageBinding!.manifest.bindings.providerIndexHash,
              ],
            }
          : {}),
      },
    );
    const generation = await createActiveKnowledgeGenerationLoaderV2({
      connection,
      workspaceRoot,
      ...(linuxTextProfile
        ? { requireLegacyProjection: false }
        : {}),
      ...(linuxTextProfile
        ? {
            requiredProviderModels: [{
              modelId:
                linuxTextProfile.textModel.id,
              modelRevision:
                linuxTextProfile.textModel.revision,
            }],
          }
        : {}),
    }).load();
    if (
      packageBinding
      && (
        packageBinding.manifest.bindings.corpusBundleHash
          !== generation.corpus.bundleHash
        || generation.verifiedProviderIndexBundleHashes
          .join("\n")
          !== packageBinding.manifest.bindings.providerIndexHash
      )
    ) {
      throw new Error(
        "KNOWLEDGE_GENERATION_VERIFIED_PACKAGE_MISMATCH",
      );
    }
    const counts = connection.sqlite.prepare(`
      SELECT
        (SELECT count(*) FROM knowledge_documents_v2) documentCount,
        (SELECT count(*) FROM knowledge_nodes_v2) nodeCount,
        (SELECT count(*) FROM knowledge_assets_v2) assetCount,
        (SELECT count(*) FROM knowledge_index_entries_v2) representationCount,
        (SELECT count(*) FROM knowledge_index_payloads_v2) sharedPayloadCount,
        (SELECT count(*) FROM knowledge_active_corpus_v2) activeCorpusCount,
        (SELECT count(*) FROM knowledge_active_index_bundle_v2) activeIndexCount
    `).get() as Record<string, number>;
    const result = {
      database: "TEMPORARY_ISOLATED_REMOVED_AFTER_VERIFICATION",
      serviceDatabase: "NOT_USED",
      projectDatabase: "NOT_USED",
      runtimeProfile:
        arguments_.runtimeProfile ?? "all-providers",
      packageManifestSha256:
        packageBinding?.sha256 ?? null,
      sourceCommit:
        packageBinding?.manifest.source.commit ?? null,
      corpusBundleHash: generation.corpus.bundleHash,
      activeIndexBundleHash: generation.activeIndexBundleHash,
      generationKey: generation.generationKey,
      providerIndexBundleHashes: generation.providerIndexBundleHashes,
      verifiedProviderIndexBundleHashes:
        generation.verifiedProviderIndexBundleHashes,
      stored,
      counts,
      frozen: Object.isFrozen(generation)
        && Object.isFrozen(generation.corpus)
        && Object.isFrozen(generation.indexBundle),
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    connection?.sqlite.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (invokedPath === import.meta.url) {
  verifyKnowledgeGenerationV2(
    parseKnowledgeGenerationVerificationArguments(process.argv.slice(2)),
  ).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

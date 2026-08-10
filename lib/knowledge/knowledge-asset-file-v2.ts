import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";

import {
  type KnowledgeAssetV2,
  verifyKnowledgeCorpusBundleV2,
} from "./knowledge-object-v2";
import {
  KNOWLEDGE_V2_BUNDLE_PATH,
} from "./knowledge-v2-corpus";

const ASSET_ID_PATTERN =
  /^[a-z0-9][a-z0-9-]{0,127}$/;

export class KnowledgeAssetNotFoundError
  extends Error {
  constructor() {
    super("课程参考图不存在");
    this.name = "KnowledgeAssetNotFoundError";
  }
}

export class KnowledgeAssetIntegrityError
  extends Error {
  constructor(code: string) {
    super(code);
    this.name = "KnowledgeAssetIntegrityError";
  }
}

function isWithin(
  root: string,
  candidate: string,
) {
  const relative = path.relative(root, candidate);
  return (
    relative === ""
    || (
      !relative.startsWith(`..${path.sep}`)
      && relative !== ".."
      && !path.isAbsolute(relative)
    )
  );
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256")
    .update(bytes)
    .digest("hex");
}

export function resolveKnowledgeAssetRecordV2(
  bundleInput: unknown,
  assetId: string,
) {
  if (!ASSET_ID_PATTERN.test(assetId)) {
    throw new KnowledgeAssetNotFoundError();
  }
  const bundle =
    verifyKnowledgeCorpusBundleV2(bundleInput);
  const asset = bundle.assets.find(
    ({ id }) => id === assetId,
  );
  if (!asset) {
    throw new KnowledgeAssetNotFoundError();
  }
  return asset;
}

export function verifyKnowledgeAssetBytesV2(
  asset: KnowledgeAssetV2,
  bytes: Uint8Array,
) {
  if (
    bytes.byteLength !== asset.sizeBytes
    || sha256(bytes) !== asset.sha256
  ) {
    throw new KnowledgeAssetIntegrityError(
      "KNOWLEDGE_ASSET_FILE_HASH_DRIFT",
    );
  }
}

export async function openKnowledgeAssetFileV2(
  assetId: string,
  workspaceRootOrOptions:
    | string
    | {
        workspaceRoot?: string;
        corpusBundle?: unknown;
      } = process.cwd(),
) {
  const workspaceRoot =
    typeof workspaceRootOrOptions === "string"
      ? workspaceRootOrOptions
      : workspaceRootOrOptions.workspaceRoot
        ?? process.cwd();
  const resolvedWorkspaceRoot =
    path.resolve(workspaceRoot);
  const bundlePath = path.resolve(
    resolvedWorkspaceRoot,
    KNOWLEDGE_V2_BUNDLE_PATH,
  );
  if (
    !isWithin(resolvedWorkspaceRoot, bundlePath)
  ) {
    throw new KnowledgeAssetIntegrityError(
      "KNOWLEDGE_BUNDLE_PATH_ESCAPE",
    );
  }

  let bundleInput: unknown =
    typeof workspaceRootOrOptions === "string"
      ? undefined
      : workspaceRootOrOptions.corpusBundle;
  if (bundleInput === undefined) {
    try {
      bundleInput = JSON.parse(
        await readFile(bundlePath, "utf8"),
      ) as unknown;
    } catch (error) {
      throw new KnowledgeAssetIntegrityError(
        error instanceof SyntaxError
          ? "KNOWLEDGE_BUNDLE_JSON_INVALID"
          : "KNOWLEDGE_BUNDLE_UNAVAILABLE",
      );
    }
  }
  let asset: KnowledgeAssetV2;
  try {
    asset = resolveKnowledgeAssetRecordV2(
      bundleInput,
      assetId,
    );
  } catch (error) {
    if (
      error
      instanceof KnowledgeAssetNotFoundError
    ) {
      throw error;
    }
    throw new KnowledgeAssetIntegrityError(
      "KNOWLEDGE_BUNDLE_INTEGRITY_INVALID",
    );
  }

  const lexicalRoot = path.resolve(
    resolvedWorkspaceRoot,
    asset.locator.root,
  );
  const lexicalCandidate = path.resolve(
    lexicalRoot,
    ...asset.locator.path.split("/"),
  );
  if (
    !isWithin(resolvedWorkspaceRoot, lexicalRoot)
    || !isWithin(lexicalRoot, lexicalCandidate)
  ) {
    throw new KnowledgeAssetIntegrityError(
      "KNOWLEDGE_ASSET_PATH_ESCAPE",
    );
  }

  let realRoot: string;
  let realCandidate: string;
  try {
    const rootStats = await lstat(lexicalRoot);
    if (
      rootStats.isSymbolicLink()
      || !rootStats.isDirectory()
    ) {
      throw new KnowledgeAssetIntegrityError(
        "KNOWLEDGE_ASSET_ROOT_INVALID",
      );
    }
    [realRoot, realCandidate] =
      await Promise.all([
        realpath(lexicalRoot),
        realpath(lexicalCandidate),
      ]);
  } catch (error) {
    if (
      error
      instanceof KnowledgeAssetIntegrityError
    ) {
      throw error;
    }
    throw new KnowledgeAssetNotFoundError();
  }
  if (!isWithin(realRoot, realCandidate)) {
    throw new KnowledgeAssetIntegrityError(
      "KNOWLEDGE_ASSET_REALPATH_ESCAPE",
    );
  }

  let bytes: Buffer;
  try {
    const fileStats = await lstat(realCandidate);
    if (
      fileStats.isSymbolicLink()
      || !fileStats.isFile()
    ) {
      throw new KnowledgeAssetIntegrityError(
        "KNOWLEDGE_ASSET_FILE_INVALID",
      );
    }
    bytes = await readFile(realCandidate);
  } catch (error) {
    if (
      error
      instanceof KnowledgeAssetIntegrityError
    ) {
      throw error;
    }
    throw new KnowledgeAssetNotFoundError();
  }
  verifyKnowledgeAssetBytesV2(asset, bytes);
  return {
    assetId: asset.id,
    bytes,
    contentType: asset.mimeType,
    size: asset.sizeBytes,
    width: asset.dimensions.widthPx,
    height: asset.dimensions.heightPx,
    sha256: asset.sha256,
  };
}

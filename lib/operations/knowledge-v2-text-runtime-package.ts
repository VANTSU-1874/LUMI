import { createHash } from "node:crypto";

import { z } from "zod";

export const KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS =
  Object.freeze({
    corpusBundleHash:
      "a93e0aa90c3895e8d72b15f1aa9a6ae00857d835a012f980cc723648d7bdb661",
    controlBundleHash:
      "46d4b59d46a1c0a62d305390d6893285425f5ab2b92c1bb653accedd81c70ffe",
    providerIndexHash:
      "7c20366f4b50c97ed2f431b5aa5bbfdcd9a0c1005b0b7c9c533dc3309a843ead",
    modelId: "BAAI/bge-small-zh-v1.5",
    modelRevision:
      "7999e1d3359715c523056ef9478215996d62a620",
    modelDirectorySha256:
      "ca73e0d5378747dd3efda420ed2a4b9375bcfea9c44dc7fdb66cbf10b43abdf9",
    modelSealSha256:
      "e34fd62fa00617c323ddc81b6cd6c07a8ed50b945c6e4142872f537e90bbb133",
  } as const);

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const CommitSchema = z.string().regex(/^[0-9a-f]{40}$/);
const AttemptIdSchema = z.string().regex(
  /^t8-linux-text-[a-z0-9]+(?:-[a-z0-9]+){0,6}$/,
);
const RelativePathSchema = z.string()
  .min(1)
  .max(500)
  .refine((value) => (
    !value.startsWith("/")
    && !/^[A-Za-z]:/.test(value)
    && !value.includes("\\")
    && !value.split("/").includes("..")
    && !value.endsWith("/")
  ), "unsafe relative path");

export const KnowledgeV2TextRuntimeFileRoleSchema = z.enum([
  "MODEL_SNAPSHOT",
  "MODEL_SEAL",
  "CORPUS",
  "CONTROL",
  "TEXT_PROVIDER",
  "SIDECAR",
  "DEPENDENCY_LOCK",
  "THIRD_PARTY_NOTICE",
]);

export const KnowledgeV2TextRuntimeFileSchema = z.object({
  path: RelativePathSchema,
  role: KnowledgeV2TextRuntimeFileRoleSchema,
  bytes: z.number().int().positive(),
  sha256: HashSchema,
}).strict();

const BindingSchema = z.object({
  corpusBundleHash: z.literal(
    KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.corpusBundleHash,
  ),
  controlBundleHash: z.literal(
    KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.controlBundleHash,
  ),
  providerIndexHash: z.literal(
    KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.providerIndexHash,
  ),
  modelId: z.literal(
    KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelId,
  ),
  modelRevision: z.literal(
    KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelRevision,
  ),
  modelDirectorySha256: z.literal(
    KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelDirectorySha256,
  ),
  modelSealSha256: z.literal(
    KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.modelSealSha256,
  ),
}).strict();

export const KnowledgeV2TextRuntimePackageManifestSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal("LUMI_KNOWLEDGE_V2_TEXT_RUNTIME_PACKAGE"),
  status: z.literal("PAYLOAD_PREPARED"),
  attemptId: AttemptIdSchema,
  source: z.object({
    commit: CommitSchema,
  }).strict(),
  target: z.object({
    os: z.literal("linux"),
    arch: z.literal("x64"),
    device: z.literal("cpu"),
    python: z.literal("3.12"),
    pythonEnvironment: z.literal("TARGET_INSTALL_REQUIRED"),
  }).strict(),
  bindings: BindingSchema,
  visualIncluded: z.literal(false),
  files: z.array(KnowledgeV2TextRuntimeFileSchema)
    .min(8)
    .max(100),
  fileCount: z.number().int().positive(),
  totalBytes: z.number().int().positive(),
  filesSha256: HashSchema,
  bindingSha256: HashSchema,
}).strict();

export type KnowledgeV2TextRuntimeFile = z.infer<
  typeof KnowledgeV2TextRuntimeFileSchema
>;
export type KnowledgeV2TextRuntimePackageManifest = z.infer<
  typeof KnowledgeV2TextRuntimePackageManifestSchema
>;

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function validateFiles(
  input: readonly KnowledgeV2TextRuntimeFile[],
) {
  const files = input
    .map((file) =>
      KnowledgeV2TextRuntimeFileSchema.parse(file))
    .sort((left, right) =>
      left.path.localeCompare(right.path, "en"));
  const paths = files.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    throw new Error(
      "KNOWLEDGE_V2_TEXT_PACKAGE_DUPLICATE_PATH",
    );
  }
  for (const file of files) {
    const normalized = file.path.toLowerCase();
    if (
      normalized.endsWith(".png")
      || normalized.endsWith(".jpg")
      || normalized.endsWith(".jpeg")
      || normalized.endsWith(".sqlite")
      || normalized.endsWith("service.env")
      || normalized.includes("api_key")
      || normalized.includes("secret")
      || normalized.includes("visual-retrieval")
      || normalized.includes("siglip")
    ) {
      throw new Error(
        `KNOWLEDGE_V2_TEXT_PACKAGE_FORBIDDEN_FILE:${file.path}`,
      );
    }
  }
  const count = (role: KnowledgeV2TextRuntimeFile["role"]) =>
    files.filter((file) => file.role === role).length;
  for (const role of [
    "MODEL_SNAPSHOT",
    "CORPUS",
    "CONTROL",
    "TEXT_PROVIDER",
    "SIDECAR",
    "THIRD_PARTY_NOTICE",
  ] as const) {
    if (count(role) < 1) {
      throw new Error(
        `KNOWLEDGE_V2_TEXT_PACKAGE_ROLE_MISSING:${role}`,
      );
    }
  }
  for (const role of [
    "MODEL_SEAL",
    "CORPUS",
    "DEPENDENCY_LOCK",
  ] as const) {
    if (count(role) !== 1) {
      throw new Error(
        `KNOWLEDGE_V2_TEXT_PACKAGE_ROLE_COUNT_INVALID:${role}`,
      );
    }
  }
  return files;
}

export function buildKnowledgeV2TextRuntimePackageManifest(
  input: {
    attemptId: string;
    sourceCommit: string;
    files: readonly KnowledgeV2TextRuntimeFile[];
  },
) {
  const files = validateFiles(input.files);
  const projection = {
    schemaVersion: 2 as const,
    kind:
      "LUMI_KNOWLEDGE_V2_TEXT_RUNTIME_PACKAGE" as const,
    status: "PAYLOAD_PREPARED" as const,
    attemptId: AttemptIdSchema.parse(input.attemptId),
    source: {
      commit: CommitSchema.parse(input.sourceCommit),
    },
    target: {
      os: "linux" as const,
      arch: "x64" as const,
      device: "cpu" as const,
      python: "3.12" as const,
      pythonEnvironment:
        "TARGET_INSTALL_REQUIRED" as const,
    },
    bindings: KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS,
    visualIncluded: false as const,
    files,
    fileCount: files.length,
    totalBytes: files.reduce(
      (total, file) => total + file.bytes,
      0,
    ),
    filesSha256: sha256(stableJson(files)),
  };
  return KnowledgeV2TextRuntimePackageManifestSchema.parse({
    ...projection,
    bindingSha256: sha256(stableJson(projection)),
  });
}

export function verifyKnowledgeV2TextRuntimePackageManifest(
  value: unknown,
) {
  const manifest =
    KnowledgeV2TextRuntimePackageManifestSchema.parse(value);
  const { bindingSha256, ...projection } = manifest;
  const files = validateFiles(manifest.files);
  if (stableJson(files) !== stableJson(manifest.files)) {
    throw new Error(
      "KNOWLEDGE_V2_TEXT_PACKAGE_FILE_ORDER_INVALID",
    );
  }
  if (
    manifest.fileCount !== files.length
    || manifest.totalBytes !== files.reduce(
      (total, file) => total + file.bytes,
      0,
    )
    || manifest.filesSha256
      !== sha256(stableJson(files))
  ) {
    throw new Error(
      "KNOWLEDGE_V2_TEXT_PACKAGE_FILE_SUMMARY_INVALID",
    );
  }
  if (bindingSha256 !== sha256(stableJson(projection))) {
    throw new Error(
      "KNOWLEDGE_V2_TEXT_PACKAGE_BINDING_HASH_MISMATCH",
    );
  }
  return manifest;
}

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  CANDIDATE_RELEASE_SOURCE_BASELINE_COMMIT,
  PRODUCTION_SURFACE_BASELINE_FILES,
  PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH,
  ProductionSurfaceBaselineReceiptSchema,
  verifyProductionSurfaceBaselineReceipt,
  type ProductionSurfaceBaselineReceipt,
} from "@/lib/operations/production-surface-baseline";

const CommitSchema = z.string().regex(/^[0-9a-f]{40}$/);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const AttemptIdSchema = z.string().regex(
  /^t8-candidate-[a-z0-9]+(?:-[a-z0-9]+){1,8}$/,
);
const RelativeArchivePathSchema = z.string().regex(
  /^(?!.*(?:^|\/)\.\.(?:\/|$))(?!\/)(?![A-Za-z]:)(?!.*\\).+$/,
);
const SurfaceFileSchema = z.object({
  path: RelativeArchivePathSchema,
  bytes: z.number().int().positive(),
  sha256: HashSchema,
}).strict();

export const CANDIDATE_RELEASE_REQUIRED_FILES = Object.freeze([
  "app/api/teacher/knowledge-canary/route.ts",
  PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH,
  "docs/release/knowledge-v2-third-party-licenses.md",
  "docs/runbooks/knowledge-v2-controlled-enablement.md",
  "lib/knowledge/knowledge-v2-canary-observability.ts",
  "lib/knowledge/knowledge-v2-canary.ts",
  "lib/operations/production-surface-baseline.ts",
  "scripts/install-local-release.ps1",
  "third_party/knowledge-v2/LICENSE-APACHE-2.0.txt",
  "third_party/knowledge-v2/LICENSE-MIT.txt",
  "third_party/knowledge-v2/LICENSE-PYTORCH-2.11.0.txt",
  "third_party/knowledge-v2/LICENSE-TORCHVISION-0.26.0.txt",
  "third_party/knowledge-v2/NOTICE.md",
  "third_party/knowledge-v2/manifest.json",
] as const);

export const CANDIDATE_RELEASE_SESSION_COMPATIBILITY_FILES =
  PRODUCTION_SURFACE_BASELINE_FILES;

const LEGACY_RELEASE_COMMITS = new Set([
  "801f4749c6c93a085a2c5a548f5cfaa5c0ee697f",
]);

export const CandidateReleaseManifestSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal("LUMI_CANDIDATE_RELEASE"),
  status: z.literal("LOCAL_PREPARED"),
  attemptId: AttemptIdSchema,
  sourceCommit: CommitSchema,
  sourceBaseline: z.object({
    commit: z.literal(CANDIDATE_RELEASE_SOURCE_BASELINE_COMMIT),
    relationship: z.literal("ANCESTOR"),
  }).strict(),
  productionSurfaceBaseline: z.object({
    receiptPath: z.literal(PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH),
    receipt: ProductionSurfaceBaselineReceiptSchema,
  }).strict(),
  archive: z.object({
    fileName: z.literal("candidate.tar"),
    sha256: HashSchema,
    bytes: z.number().int().positive(),
    entryCount: z.number().int().positive(),
  }).strict(),
  requiredFiles: z.array(z.object({
    path: RelativeArchivePathSchema,
    present: z.literal(true),
  }).strict()).length(CANDIDATE_RELEASE_REQUIRED_FILES.length),
  requiredFilesSha256: HashSchema,
  runtime: z.object({
    nodeVersion: z.string().regex(/^v\d+\.\d+\.\d+$/),
    pnpmVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  }).strict(),
  studentEntryAuthParity: z.object({
    status: z.literal("ARTIFACT_IDENTICAL"),
    files: z.array(SurfaceFileSchema).length(
      CANDIDATE_RELEASE_SESSION_COMPATIBILITY_FILES.length,
    ),
    filesSha256: HashSchema,
  }).strict(),
  featureFlags: z.object({
    knowledgeObjectV2: z.literal(false),
    evidenceBundleV2: z.literal(false),
    visualRetrieval: z.literal(false),
  }).strict(),
  bindingSha256: HashSchema,
}).strict();

export type CandidateReleaseManifest = z.infer<
  typeof CandidateReleaseManifestSchema
>;

export type CandidateSurfaceFile = z.infer<typeof SurfaceFileSchema>;

export type CandidateReleaseManifestInput = {
  attemptId: string;
  sourceCommit: string;
  archiveSha256: string;
  archiveBytes: number;
  archiveEntries: readonly string[];
  nodeVersion: string;
  pnpmVersion: string;
  sourceBaselineRelationship: "ANCESTOR";
  productionSurfaceBaselineReceipt: ProductionSurfaceBaselineReceipt;
  candidateSourceSurfaceFiles: readonly CandidateSurfaceFile[];
  candidateArchiveSurfaceFiles: readonly CandidateSurfaceFile[];
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function parseSurfaceFiles(
  value: readonly CandidateSurfaceFile[],
  source: "SOURCE" | "ARCHIVE",
) {
  const files = value.map((file) => SurfaceFileSchema.parse(file));
  const paths = files.map(({ path }) => path);
  if (
    new Set(paths).size !== paths.length
    || paths.join("\n")
      !== CANDIDATE_RELEASE_SESSION_COMPATIBILITY_FILES.join("\n")
  ) {
    throw new Error(
      `CANDIDATE_RELEASE_${source}_SURFACE_FILE_SET_INVALID`,
    );
  }
  return files;
}

function assertSurfaceMatchesBaseline(
  baseline: readonly CandidateSurfaceFile[],
  candidate: readonly CandidateSurfaceFile[],
  source: "SOURCE" | "ARCHIVE",
) {
  for (let index = 0; index < baseline.length; index += 1) {
    const expected = baseline[index];
    const actual = candidate[index];
    if (
      !expected
      || !actual
      || expected.path !== actual.path
      || expected.bytes !== actual.bytes
      || expected.sha256 !== actual.sha256
    ) {
      throw new Error(
        `CANDIDATE_RELEASE_${source}_SURFACE_CHANGED:${expected?.path ?? actual?.path ?? "UNKNOWN"}`,
      );
    }
  }
}

export function normalizeCandidateArchiveEntry(entry: string) {
  const normalized = entry.trim().replace(/\/+$/, "");
  if (!normalized) return null;
  if (!RelativeArchivePathSchema.safeParse(normalized).success) {
    throw new Error("CANDIDATE_RELEASE_ARCHIVE_PATH_UNSAFE");
  }
  return normalized;
}

export function parseCandidateReleaseArguments(
  argv: readonly string[],
) {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  if (
    args.length !== 4
    || args[0] !== "--commit"
    || args[2] !== "--attempt-id"
  ) {
    throw new Error(
      "usage: candidate-release:prepare --commit <40-lowercase-hex> --attempt-id <t8-candidate-id>",
    );
  }
  const sourceCommit = CommitSchema.parse(args[1] ?? "");
  const attemptId = AttemptIdSchema.parse(args[3] ?? "");
  if (LEGACY_RELEASE_COMMITS.has(sourceCommit)) {
    throw new Error("CANDIDATE_RELEASE_LEGACY_COMMIT_REJECTED");
  }
  if (sourceCommit === CANDIDATE_RELEASE_SOURCE_BASELINE_COMMIT) {
    throw new Error("CANDIDATE_RELEASE_BASELINE_EQUALS_CANDIDATE");
  }
  return { sourceCommit, attemptId } as const;
}

export function buildCandidateReleaseManifest(
  input: CandidateReleaseManifestInput,
) {
  const sourceCommit = CommitSchema.parse(input.sourceCommit);
  const attemptId = AttemptIdSchema.parse(input.attemptId);
  if (LEGACY_RELEASE_COMMITS.has(sourceCommit)) {
    throw new Error("CANDIDATE_RELEASE_LEGACY_COMMIT_REJECTED");
  }
  if (sourceCommit === CANDIDATE_RELEASE_SOURCE_BASELINE_COMMIT) {
    throw new Error("CANDIDATE_RELEASE_BASELINE_EQUALS_CANDIDATE");
  }
  if (input.sourceBaselineRelationship !== "ANCESTOR") {
    throw new Error("CANDIDATE_RELEASE_SOURCE_BASELINE_NOT_ANCESTOR");
  }

  const receipt = verifyProductionSurfaceBaselineReceipt(
    input.productionSurfaceBaselineReceipt,
  );
  const sourceSurfaceFiles = parseSurfaceFiles(
    input.candidateSourceSurfaceFiles,
    "SOURCE",
  );
  const archiveSurfaceFiles = parseSurfaceFiles(
    input.candidateArchiveSurfaceFiles,
    "ARCHIVE",
  );
  assertSurfaceMatchesBaseline(receipt.files, sourceSurfaceFiles, "SOURCE");
  assertSurfaceMatchesBaseline(receipt.files, archiveSurfaceFiles, "ARCHIVE");

  const entries = input.archiveEntries
    .map(normalizeCandidateArchiveEntry)
    .filter((entry): entry is string => entry !== null);
  if (new Set(entries).size !== entries.length) {
    throw new Error("CANDIDATE_RELEASE_ARCHIVE_ENTRY_DUPLICATE");
  }
  const available = new Set(entries);
  const missing = CANDIDATE_RELEASE_REQUIRED_FILES.filter(
    (file) => !available.has(file),
  );
  if (missing.length > 0) {
    throw new Error(`CANDIDATE_RELEASE_REQUIRED_FILE_MISSING:${missing[0]}`);
  }

  const requiredFiles = CANDIDATE_RELEASE_REQUIRED_FILES.map((path) => ({
    path,
    present: true as const,
  }));
  const projection = {
    schemaVersion: 2 as const,
    kind: "LUMI_CANDIDATE_RELEASE" as const,
    status: "LOCAL_PREPARED" as const,
    attemptId,
    sourceCommit,
    sourceBaseline: {
      commit: CANDIDATE_RELEASE_SOURCE_BASELINE_COMMIT,
      relationship: "ANCESTOR" as const,
    },
    productionSurfaceBaseline: {
      receiptPath: PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH,
      receipt,
    },
    archive: {
      fileName: "candidate.tar" as const,
      sha256: HashSchema.parse(input.archiveSha256),
      bytes: input.archiveBytes,
      entryCount: entries.length,
    },
    requiredFiles,
    requiredFilesSha256: sha256(stableJson(requiredFiles)),
    runtime: {
      nodeVersion: input.nodeVersion,
      pnpmVersion: input.pnpmVersion,
    },
    studentEntryAuthParity: {
      status: "ARTIFACT_IDENTICAL" as const,
      files: archiveSurfaceFiles,
      filesSha256: sha256(stableJson(archiveSurfaceFiles)),
    },
    featureFlags: {
      knowledgeObjectV2: false as const,
      evidenceBundleV2: false as const,
      visualRetrieval: false as const,
    },
  };
  return CandidateReleaseManifestSchema.parse({
    ...projection,
    bindingSha256: sha256(stableJson(projection)),
  });
}

export function verifyCandidateReleaseManifest(value: unknown) {
  const manifest = CandidateReleaseManifestSchema.parse(value);
  const { bindingSha256, ...projection } = manifest;
  if (bindingSha256 !== sha256(stableJson(projection))) {
    throw new Error("CANDIDATE_RELEASE_BINDING_HASH_MISMATCH");
  }
  if (
    manifest.requiredFilesSha256
    !== sha256(stableJson(manifest.requiredFiles))
  ) {
    throw new Error("CANDIDATE_RELEASE_REQUIRED_FILE_HASH_MISMATCH");
  }
  if (
    manifest.requiredFiles.map(({ path }) => path).join("\n")
    !== CANDIDATE_RELEASE_REQUIRED_FILES.join("\n")
  ) {
    throw new Error("CANDIDATE_RELEASE_REQUIRED_FILE_SET_INVALID");
  }
  const receipt = verifyProductionSurfaceBaselineReceipt(
    manifest.productionSurfaceBaseline.receipt,
  );
  const parityFiles = parseSurfaceFiles(
    manifest.studentEntryAuthParity.files,
    "ARCHIVE",
  );
  if (
    manifest.studentEntryAuthParity.filesSha256
    !== sha256(stableJson(parityFiles))
  ) {
    throw new Error("CANDIDATE_RELEASE_ARTIFACT_PARITY_HASH_MISMATCH");
  }
  assertSurfaceMatchesBaseline(receipt.files, parityFiles, "ARCHIVE");
  if (LEGACY_RELEASE_COMMITS.has(manifest.sourceCommit)) {
    throw new Error("CANDIDATE_RELEASE_LEGACY_COMMIT_REJECTED");
  }
  return manifest;
}

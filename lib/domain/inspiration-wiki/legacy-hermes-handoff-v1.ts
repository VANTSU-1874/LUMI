import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { HermesPublicSourceUrlSchema } from "./hermes-handoff-v2-contracts";

const REQUIRED_ENTRIES = new Set([
  "manifest.json",
  "candidates.jsonl",
  "failures.jsonl",
  "assets",
  "report.md",
  "DONE.json",
]);
const ROOT_DIGEST_FILES = ["manifest.json", "candidates.jsonl", "failures.jsonl", "report.md"] as const;
const SHA256 = /^[0-9a-f]{64}$/;
const SECRET = /(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*\S+|(?:session(?:id)?|refresh[_-]?token|access[_-]?token|api[_-]?key|proxy[_-]?(?:user|pass|credential))\s*[:=]\s*\S+/i;

const SafeTextSchema = z.string().superRefine((value, context) => {
  if (SECRET.test(value)) context.addIssue({ code: "custom", message: "HANDOFF_SECRET_MATERIAL_FORBIDDEN" });
});
const BatchIdSchema = z.string().regex(/^hermes-[a-z0-9][a-z0-9._-]{7,88}$/);
const CandidateIdSchema = z.string().regex(/^hc-[a-z0-9][a-z0-9._-]{7,92}$/);
const FailureIdSchema = z.string().regex(/^hf-[a-z0-9][a-z0-9._-]{7,92}$/);
const SourceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/);
const AssetPathSchema = z.string().max(247).superRefine((value, context) => {
  if (!/^assets\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    || value.endsWith("/")
    || value.split("/").some((segment) => segment === "." || segment === "..")) {
    context.addIssue({ code: "custom", message: "HANDOFF_ASSET_PATH_INVALID" });
  }
});

const PlatformsSchema = z.enum(["RECENT_DESIGN", "PINTEREST", "BEHANCE", "OTHER_PUBLIC_WEB"]);
const DesignCategorySchema = z.enum([
  "BRANDING", "TYPOGRAPHY", "EDITORIAL", "PRINT", "PACKAGING", "WEB_INTERFACE",
  "PRODUCT", "MOTION", "ILLUSTRATION", "THREE_D", "SPATIAL", "OTHER",
]);
const HardExclusionSchema = z.enum([
  "NOT_IDENTIFIABLE_DESIGN_WORK",
  "STUDENT_OR_PERSONAL_DATA",
  "CLASSROOM_UNSAFE_CONTENT",
  "PUBLIC_SOURCE_NOT_TRACEABLE",
  "ACCESS_REQUIRES_CREDENTIALS",
  "OBVIOUS_DUPLICATE",
  "ASSET_UNREADABLE",
  "KNOWN_RIGHTS_CONFLICT",
]);

const ScreeningScoresSchema = z.object({
  educationalRelevance: z.number().int().min(0).max(5),
  observableDesignDecisions: z.number().int().min(0).max(5),
  executionQuality: z.number().int().min(0).max(5),
  transferPotential: z.number().int().min(0).max(5),
  sourceTraceability: z.number().int().min(0).max(5),
  metadataCompleteness: z.number().int().min(0).max(5),
}).strict();

const ScreeningSchema = z.object({
  ruleVersion: z.literal("lumi-design-screening-v1"),
  hardExclusions: z.array(HardExclusionSchema).max(8),
  scores: ScreeningScoresSchema,
  totalScore: z.number().int().min(0).max(30),
  evidence: z.array(SafeTextSchema.trim().min(1).max(300)).min(1).max(12),
  decision: z.enum(["INCLUDE_FOR_TEACHER_REVIEW", "EXCLUDE"]),
}).strict().superRefine((value, context) => {
  const total = Object.values(value.scores).reduce((sum, score) => sum + score, 0);
  if (total !== value.totalScore) {
    context.addIssue({ code: "custom", path: ["totalScore"], message: "HANDOFF_SCREENING_TOTAL_MISMATCH" });
  }
  const passes = value.hardExclusions.length === 0
    && value.totalScore >= 18
    && value.scores.educationalRelevance >= 3
    && value.scores.observableDesignDecisions >= 3
    && value.scores.sourceTraceability >= 2;
  if ((value.decision === "INCLUDE_FOR_TEACHER_REVIEW") !== passes) {
    context.addIssue({ code: "custom", path: ["decision"], message: "HANDOFF_SCREENING_DECISION_MISMATCH" });
  }
});

const SourcePlanSchema = z.object({
  sourceId: SourceIdSchema,
  platform: PlatformsSchema,
  baseUrl: HermesPublicSourceUrlSchema,
  query: SafeTextSchema.trim().min(1).max(100).nullable(),
  requestedCandidateCount: z.number().int().min(1).max(200),
}).strict();

export const LegacyHermesManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  contract: z.literal("lumi-hermes-inspiration-handoff"),
  batchId: BatchIdSchema,
  producer: z.object({
    name: z.literal("Hermes"),
    version: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/),
  }).strict(),
  sources: z.array(SourcePlanSchema).min(2).max(20),
  requestedCandidateCount: z.number().int().min(1).max(200),
  screeningPolicy: z.object({
    ruleVersion: z.literal("lumi-design-screening-v1"),
    minimumTotalScore: z.literal(18),
    minimumEducationalRelevance: z.literal(3),
    minimumObservableDesignDecisions: z.literal(3),
    minimumSourceTraceability: z.literal(2),
  }).strict(),
  createdAt: z.iso.datetime(),
  reviewStatus: z.literal("PENDING_REVIEW"),
  importTarget: z.literal("LUMI_TEACHER_REVIEW_QUEUE"),
  containsStudentData: z.literal(false),
  containsCredentials: z.literal(false),
}).strict().superRefine((value, context) => {
  const requested = value.sources.reduce((sum, source) => sum + source.requestedCandidateCount, 0);
  if (requested !== value.requestedCandidateCount) {
    context.addIssue({ code: "custom", path: ["requestedCandidateCount"], message: "HANDOFF_SOURCE_QUOTA_MISMATCH" });
  }
  if (new Set(value.sources.map((source) => source.sourceId)).size !== value.sources.length) {
    context.addIssue({ code: "custom", path: ["sources"], message: "HANDOFF_SOURCE_ID_DUPLICATE" });
  }
});

const AuthorSchema = z.object({
  displayName: SafeTextSchema.trim().min(1).max(200).nullable(),
  profileUrl: HermesPublicSourceUrlSchema.nullable(),
}).strict().refine((value) => value.displayName !== null || value.profileUrl !== null, "HANDOFF_EMPTY_AUTHOR_MUST_BE_NULL");
const LicenseSchema = z.object({
  name: SafeTextSchema.trim().min(1).max(200).nullable(),
  url: HermesPublicSourceUrlSchema.nullable(),
  notes: SafeTextSchema.trim().min(1).max(1_000).nullable(),
}).strict().refine((value) => value.name !== null || value.url !== null || value.notes !== null, "HANDOFF_EMPTY_LICENSE_MUST_BE_NULL");
const MediaSchema = z.object({
  kind: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]),
  sourceUrl: HermesPublicSourceUrlSchema,
  asset: z.object({
    path: AssetPathSchema,
    sha256: z.string().regex(SHA256),
    bytes: z.number().int().nonnegative(),
    mimeType: z.string().trim().min(1).max(120),
  }).strict().nullable(),
}).strict();
const BrandFacetSchema = z.object({
  kind: z.string().regex(/^[A-Z][A-Z0-9_]{1,47}$/),
  label: SafeTextSchema.trim().min(1).max(100).optional(),
  designCategories: z.array(DesignCategorySchema).min(1).max(4),
  evidence: SafeTextSchema.trim().min(1).max(300),
  mediaIndexes: z.array(z.number().int().min(0).max(19)).max(20).optional(),
}).strict();
const BrandIdentitySchema = z.object({
  brandName: SafeTextSchema.trim().min(1).max(200),
  facets: z.array(BrandFacetSchema).min(1).max(20),
}).strict();

export const LegacyHermesCandidateV1Schema = z.object({
  schemaVersion: z.literal(1),
  batchId: BatchIdSchema,
  candidateId: CandidateIdSchema,
  reviewStatus: z.literal("PENDING_REVIEW"),
  source: z.object({
    sourceId: SourceIdSchema,
    platform: PlatformsSchema,
    pageUrl: HermesPublicSourceUrlSchema,
    canonicalUrl: HermesPublicSourceUrlSchema.nullable(),
    externalId: SafeTextSchema.trim().min(1).max(200).nullable(),
    discoveredAt: z.iso.datetime(),
  }).strict(),
  content: z.object({
    title: SafeTextSchema.trim().min(1).max(300).nullable(),
    description: SafeTextSchema.trim().min(1).max(4_000).nullable(),
  }).strict(),
  author: AuthorSchema.nullable(),
  license: LicenseSchema.nullable(),
  media: z.array(MediaSchema).min(1).max(20),
  designCategories: z.array(DesignCategorySchema).min(1).max(4),
  brandIdentity: BrandIdentitySchema.optional(),
  dedupeFingerprint: z.string().regex(SHA256),
  screening: ScreeningSchema.refine((value) => value.decision === "INCLUDE_FOR_TEACHER_REVIEW"),
}).strict().superRefine((value, context) => {
  if (value.designCategories.includes("BRANDING") && !value.brandIdentity) {
    context.addIssue({ code: "custom", path: ["brandIdentity"], message: "HANDOFF_BRANDING_REQUIRES_IDENTITY_DETAILS" });
  }
  value.brandIdentity?.facets.forEach((facet, facetIndex) => {
    facet.designCategories.forEach((category, categoryIndex) => {
      if (!value.designCategories.includes(category)) {
        context.addIssue({ code: "custom", path: ["brandIdentity", "facets", facetIndex, "designCategories", categoryIndex], message: "HANDOFF_BRAND_FACET_CATEGORY_NOT_DECLARED" });
      }
    });
    facet.mediaIndexes?.forEach((mediaIndex, mediaIndexPosition) => {
      if (mediaIndex >= value.media.length) {
        context.addIssue({ code: "custom", path: ["brandIdentity", "facets", facetIndex, "mediaIndexes", mediaIndexPosition], message: "HANDOFF_BRAND_FACET_MEDIA_NOT_DECLARED" });
      }
    });
  });
});

export const LegacyHermesFailureV1Schema = z.object({
  schemaVersion: z.literal(1),
  batchId: BatchIdSchema,
  failureId: FailureIdSchema,
  stage: z.enum(["DISCOVERY", "FETCH", "EXTRACT", "DEDUPE", "SCREEN", "ASSET", "PACKAGE"]),
  itemRef: SafeTextSchema.trim().min(1).max(300).nullable(),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  sanitizedMessage: SafeTextSchema.trim().min(1).max(500),
  retryable: z.boolean(),
  occurredAt: z.iso.datetime(),
  screening: ScreeningSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.stage === "SCREEN" && value.screening?.decision !== "EXCLUDE") {
    context.addIssue({ code: "custom", path: ["screening"], message: "HANDOFF_SCREEN_FAILURE_REQUIRES_EXCLUSION" });
  }
  if (value.stage !== "SCREEN" && value.screening !== null) {
    context.addIssue({ code: "custom", path: ["screening"], message: "HANDOFF_NON_SCREEN_FAILURE_FORBIDS_SCORECARD" });
  }
});

const FileDigestSchema = z.object({
  path: z.union([z.enum(ROOT_DIGEST_FILES), AssetPathSchema]),
  sha256: z.string().regex(SHA256),
  bytes: z.number().int().nonnegative(),
}).strict();
export const LegacyHermesDoneV1Schema = z.object({
  schemaVersion: z.literal(1),
  batchId: BatchIdSchema,
  completedAt: z.iso.datetime(),
  candidateCount: z.number().int().min(0).max(200),
  failureCount: z.number().int().min(0).max(10_000),
  files: z.array(FileDigestSchema).min(4).max(10_000),
  packageDigest: z.string().regex(SHA256),
}).strict();

export type LegacyHermesCandidateV1 = z.infer<typeof LegacyHermesCandidateV1Schema>;
export type ValidatedLegacyHermesHandoffV1 = {
  root: string;
  manifest: z.infer<typeof LegacyHermesManifestV1Schema>;
  candidates: Array<{ value: LegacyHermesCandidateV1; rawDigest: string }>;
  failures: Array<z.infer<typeof LegacyHermesFailureV1Schema>>;
  done: z.infer<typeof LegacyHermesDoneV1Schema>;
};

function assertNoSecrets(value: string, file: string) {
  if (SECRET.test(value)) throw new Error(`HANDOFF_SECRET_MATERIAL_FORBIDDEN:${file}`);
}

function parseJson(raw: string, file: string) {
  assertNoSecrets(raw, file);
  try { return JSON.parse(raw.replace(/^\uFEFF/, "")) as unknown; }
  catch { throw new Error(`HANDOFF_JSON_INVALID:${file}`); }
}

function parseJsonLines<T>(raw: string, file: string, schema: z.ZodType<T>) {
  assertNoSecrets(raw, file);
  if (raw.length === 0) return [];
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line, index) => {
    if (!line.trim()) throw new Error(`HANDOFF_JSONL_BLANK_LINE:${file}:${index + 1}`);
    try {
      return { value: schema.parse(JSON.parse(line)), rawDigest: createHash("sha256").update(line).digest("hex") };
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`HANDOFF_JSONL_INVALID_JSON:${file}:${index + 1}`);
      throw new Error(`HANDOFF_JSONL_SCHEMA_INVALID:${file}:${index + 1}`, { cause: error });
    }
  });
}

async function listAssets(root: string, relative = "assets"): Promise<string[]> {
  const entries = await readdir(path.join(root, ...relative.split("/")), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const item = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`HANDOFF_SYMLINK_FORBIDDEN:${item}`);
    if (entry.isDirectory()) files.push(...await listAssets(root, item));
    else if (entry.isFile()) files.push(item);
    else throw new Error(`HANDOFF_SPECIAL_FILE_FORBIDDEN:${item}`);
  }
  return files;
}

async function digestFile(file: string) {
  const contents = await readFile(file);
  return { sha256: createHash("sha256").update(contents).digest("hex"), bytes: contents.byteLength };
}

export function computeLegacyHermesPackageDigest(entries: Array<{ path: string; sha256: string; bytes: number }>) {
  const canonical = [...entries]
    .sort((left, right) => left.path.localeCompare(right.path, "en"))
    .map((entry) => `${entry.path}\0${entry.sha256}\0${entry.bytes}\n`)
    .join("");
  return createHash("sha256").update(canonical).digest("hex");
}

function assertUnique(values: string[], code: string) {
  if (new Set(values).size !== values.length) throw new Error(code);
}

export async function validateLegacyHermesHandoffV1(rawRoot: string): Promise<ValidatedLegacyHermesHandoffV1> {
  const root = path.resolve(rawRoot);
  if (!(await stat(root)).isDirectory()) throw new Error("HANDOFF_ROOT_NOT_DIRECTORY");
  const top = await readdir(root, { withFileTypes: true });
  const names = top.map((entry) => entry.name);
  assertUnique(names.map((name) => name.toLocaleLowerCase("en-US")), "HANDOFF_CASE_COLLISION");
  const missing = [...REQUIRED_ENTRIES].filter((name) => !names.includes(name));
  const extra = names.filter((name) => !REQUIRED_ENTRIES.has(name));
  if (missing.length) throw new Error(`HANDOFF_REQUIRED_ENTRY_MISSING:${missing.join(",")}`);
  if (extra.length) throw new Error(`HANDOFF_EXTRA_ENTRY_FORBIDDEN:${extra.join(",")}`);
  for (const entry of top) {
    if (entry.isSymbolicLink()) throw new Error(`HANDOFF_SYMLINK_FORBIDDEN:${entry.name}`);
    if (entry.name === "assets" ? !entry.isDirectory() : !entry.isFile()) {
      throw new Error(`HANDOFF_ENTRY_TYPE_INVALID:${entry.name}`);
    }
  }

  const [manifestRaw, candidatesRaw, failuresRaw, reportRaw, doneRaw, assets] = await Promise.all([
    readFile(path.join(root, "manifest.json"), "utf8"),
    readFile(path.join(root, "candidates.jsonl"), "utf8"),
    readFile(path.join(root, "failures.jsonl"), "utf8"),
    readFile(path.join(root, "report.md"), "utf8"),
    readFile(path.join(root, "DONE.json"), "utf8"),
    listAssets(root),
  ]);
  assertNoSecrets(reportRaw, "report.md");
  if (!reportRaw.trim()) throw new Error("HANDOFF_REPORT_EMPTY");
  const manifest = LegacyHermesManifestV1Schema.parse(parseJson(manifestRaw, "manifest.json"));
  const candidates = parseJsonLines(candidatesRaw, "candidates.jsonl", LegacyHermesCandidateV1Schema);
  const failureLines = parseJsonLines(failuresRaw, "failures.jsonl", LegacyHermesFailureV1Schema);
  const failures = failureLines.map((entry) => entry.value);
  const done = LegacyHermesDoneV1Schema.parse(parseJson(doneRaw, "DONE.json"));

  if (done.batchId !== manifest.batchId) throw new Error("HANDOFF_DONE_BATCH_MISMATCH");
  if (candidates.some((entry) => entry.value.batchId !== manifest.batchId)) throw new Error("HANDOFF_CANDIDATE_BATCH_MISMATCH");
  if (failures.some((failure) => failure.batchId !== manifest.batchId)) throw new Error("HANDOFF_FAILURE_BATCH_MISMATCH");
  if (done.candidateCount !== candidates.length) throw new Error("HANDOFF_CANDIDATE_COUNT_MISMATCH");
  if (done.failureCount !== failures.length) throw new Error("HANDOFF_FAILURE_COUNT_MISMATCH");
  if (candidates.length > manifest.requestedCandidateCount) throw new Error("HANDOFF_CANDIDATE_COUNT_EXCEEDS_REQUEST");
  const sourcePlans = new Map(manifest.sources.map((source) => [source.sourceId, source]));
  for (const entry of candidates) {
    const plan = sourcePlans.get(entry.value.source.sourceId);
    if (!plan || plan.platform !== entry.value.source.platform) throw new Error("HANDOFF_CANDIDATE_SOURCE_NOT_DECLARED");
  }
  assertUnique(candidates.map((entry) => entry.value.candidateId), "HANDOFF_CANDIDATE_ID_DUPLICATE");
  assertUnique(candidates.map((entry) => entry.value.dedupeFingerprint), "HANDOFF_FINGERPRINT_DUPLICATE");
  assertUnique(failures.map((failure) => failure.failureId), "HANDOFF_FAILURE_ID_DUPLICATE");

  const expectedPaths = [...ROOT_DIGEST_FILES, ...assets].sort((left, right) => left.localeCompare(right, "en"));
  assertUnique(done.files.map((entry) => entry.path), "HANDOFF_DONE_FILE_DUPLICATE");
  const declaredPaths = done.files.map((entry) => entry.path).sort((left, right) => left.localeCompare(right, "en"));
  if (JSON.stringify(expectedPaths) !== JSON.stringify(declaredPaths)) throw new Error("HANDOFF_DONE_FILE_SET_MISMATCH");
  const actual = await Promise.all(expectedPaths.map(async (relative) => ({
    path: relative,
    ...await digestFile(path.join(root, ...relative.split("/"))),
  })));
  const declared = new Map(done.files.map((entry) => [entry.path, entry]));
  for (const item of actual) {
    const expected = declared.get(item.path);
    if (!expected || expected.sha256 !== item.sha256 || expected.bytes !== item.bytes) {
      throw new Error(`HANDOFF_FILE_DIGEST_MISMATCH:${item.path}`);
    }
  }
  if (computeLegacyHermesPackageDigest(actual) !== done.packageDigest) throw new Error("HANDOFF_PACKAGE_DIGEST_MISMATCH");
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
  for (const entry of candidates) {
    for (const media of entry.value.media) {
      if (!media.asset) continue;
      const item = actualByPath.get(media.asset.path);
      if (!item || item.sha256 !== media.asset.sha256 || item.bytes !== media.asset.bytes) {
        throw new Error(`HANDOFF_CANDIDATE_ASSET_MISMATCH:${entry.value.candidateId}`);
      }
    }
  }
  return { root, manifest, candidates, failures, done };
}

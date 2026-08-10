import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { buildCourseCorpusArtifacts } from "@/scripts/convert-course-corpus";

import {
  CoursePngAssetSchema,
  type CoursePngManifest,
  verifyCoursePngManifest,
} from "./course-png-manifest";
import { knowledgePlacementForTopic } from "./course-pack-store";
import {
  CourseAssetPathV2Schema,
  CoursePackReferenceV2Schema,
  KnowledgeAssetV2Schema,
  WorkspaceRelativePathV2Schema,
  sealKnowledgeAnnotationV2,
  sealKnowledgeCorpusBundleV2,
  sealKnowledgeNodeV2,
  sealKnowledgeObjectV2,
  stableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeAssetV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeObjectV2,
} from "./knowledge-object-v2";
import {
  KnowledgeItemSchema,
  parseKnowledgeMarkdown,
  type KnowledgeItem,
} from "./retrieve";

export const KNOWLEDGE_V2_PARSER = {
  id: "lumi-knowledge-v2-bridge",
  version: "1.0.0",
} as const;
export const KNOWLEDGE_V2_CONTENT_VERSION = "knowledge-object-v2.1";
export const KNOWLEDGE_V2_CORPUS_VERSION = "2026-07-28.1";
export const KNOWLEDGE_V2_BUNDLE_PATH = "data/knowledge-v2/knowledge-corpus.v2.json";
export const KNOWLEDGE_V2_REPORT_PATH = "data/knowledge-v2/conversion-report.v2.json";
export const LEGACY_SOURCE_COURSE_MAP_PATH =
  "data/manifests/legacy-knowledge-source-course.v1.json";

const V1_CONVERSION_REPORT_PATH = "data/knowledge/course-corpus-conversion-report.json";
const KNOWLEDGE_DIRECTORY = "data/knowledge";
const COURSE_ROOT = "data/courses";
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const PNG_SIGNATURE = "89504e470d0a1a0a";

const CoursePackIdSchema = CoursePackReferenceV2Schema.shape.id;
export type KnowledgeV2CoursePackId = z.infer<typeof CoursePackIdSchema>;

const CoursePackCountsSchema = z
  .object({
    "general-design": z.number().int().nonnegative(),
    "digital-interaction": z.number().int().nonnegative(),
    "book-design": z.number().int().nonnegative(),
    "layout-design": z.number().int().nonnegative(),
    "brand-vi-design": z.number().int().nonnegative(),
  })
  .strict();

const LegacySourceCourseMapSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
      sourceCoursePackId: CoursePackIdSchema,
    }).strict()),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = manifest.items.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "legacy source course ids must be unique" });
    }
    if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) {
      context.addIssue({
        code: "custom",
        message: "legacy source course items must be codepoint sorted",
      });
    }
  });

const V1ConversionReportSchema = z
  .object({
    version: z.literal(1),
    verifiedDate: z.iso.date(),
    sourceCount: z.number().int().nonnegative(),
    generatedCount: z.number().int().nonnegative(),
    generatedIds: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)),
    managedFiles: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}\.md$/)),
    warnings: z.array(z.unknown()),
  })
  .strict()
  .superRefine((report, context) => {
    if (
      report.sourceCount !== report.generatedCount
      || report.generatedCount !== report.generatedIds.length
      || report.generatedCount !== report.managedFiles.length
    ) {
      context.addIssue({ code: "custom", message: "V1 conversion report counts disagree" });
    }
    if (
      new Set(report.generatedIds).size !== report.generatedIds.length
      || new Set(report.managedFiles).size !== report.managedFiles.length
    ) {
      context.addIssue({ code: "custom", message: "V1 conversion report entries must be unique" });
    }
    const sortedIds = [...report.generatedIds].sort(compareCodePoints);
    const sortedFiles = [...report.managedFiles].sort(compareCodePoints);
    if (
      stableJsonV2(report.generatedIds) !== stableJsonV2(sortedIds)
      || stableJsonV2(report.managedFiles) !== stableJsonV2(sortedFiles)
    ) {
      context.addIssue({ code: "custom", message: "V1 conversion report must be sorted" });
    }
    for (const [index, id] of report.generatedIds.entries()) {
      if (report.managedFiles[index] !== `${id}.md`) {
        context.addIssue({
          code: "custom",
          message: "V1 managed files must align with generated ids",
          path: ["managedFiles", index],
        });
      }
    }
  });

export const KnowledgeV2ConversionReportSchema = z
  .object({
    schemaVersion: z.literal(2),
    corpusVersion: z.literal(KNOWLEDGE_V2_CORPUS_VERSION),
    parser: z.object({
      id: z.literal(KNOWLEDGE_V2_PARSER.id),
      version: z.literal(KNOWLEDGE_V2_PARSER.version),
    }).strict(),
    contentVersion: z.literal(KNOWLEDGE_V2_CONTENT_VERSION),
    bundlePath: z.literal(KNOWLEDGE_V2_BUNDLE_PATH),
    bundleHash: z.string().regex(/^[0-9a-f]{64}$/),
    objectCount: z.number().int().nonnegative(),
    generatedSourceCount: z.number().int().nonnegative(),
    legacySourceCount: z.number().int().nonnegative(),
    assetCount: z.number().int().nonnegative(),
    imageBearingObjectCount: z.number().int().nonnegative(),
    imageNodeCount: z.number().int().nonnegative(),
    sourceCaptionAnnotationCount: z.number().int().nonnegative(),
    referencedAssetCount: z.number().int().nonnegative(),
    unreferencedAssetCount: z.number().int().nonnegative(),
    sourceIdentityBasisCounts: z.object({
      COURSE_DIRECTORY: z.number().int().nonnegative(),
      TRACKED_LEGACY_MAP: z.number().int().nonnegative(),
    }).strict(),
    sourceIdentityCounts: CoursePackCountsSchema,
    legacyPlacementCounts: CoursePackCountsSchema,
    sourceLegacyPlacementMismatchCount: z.number().int().nonnegative(),
    captionMappingCounts: z.object({
      ROLE_ALIAS: z.number().int().nonnegative(),
      DOCUMENT_FALLBACK: z.number().int().nonnegative(),
      EXPLICIT: z.number().int().nonnegative(),
    }).strict(),
  })
  .strict()
  .superRefine((report, context) => {
    const issue = (message: string, path: string[]) =>
      context.addIssue({ code: "custom", message, path });
    if (report.generatedSourceCount + report.legacySourceCount !== report.objectCount) {
      issue("generated + legacy must equal objectCount", ["objectCount"]);
    }
    if (
      Object.values(report.sourceIdentityBasisCounts)
        .reduce((sum, count) => sum + count, 0) !== report.objectCount
    ) {
      issue("source identity basis counts must equal objectCount", ["sourceIdentityBasisCounts"]);
    }
    for (const field of ["sourceIdentityCounts", "legacyPlacementCounts"] as const) {
      if (
        Object.values(report[field]).reduce((sum, count) => sum + count, 0)
        !== report.objectCount
      ) {
        issue(`${field} must equal objectCount`, [field]);
      }
    }
    if (
      report.referencedAssetCount + report.unreferencedAssetCount
      !== report.assetCount
    ) {
      issue("referenced + unreferenced must equal assetCount", ["assetCount"]);
    }
    if (
      Object.values(report.captionMappingCounts)
        .reduce((sum, count) => sum + count, 0)
      !== report.sourceCaptionAnnotationCount
    ) {
      issue(
        "caption mapping counts must equal sourceCaptionAnnotationCount",
        ["captionMappingCounts"],
      );
    }
  });

export type KnowledgeV2ConversionReport = z.infer<
  typeof KnowledgeV2ConversionReportSchema
>;
export type BuiltKnowledgeV2Corpus = {
  bundle: KnowledgeCorpusBundleV2;
  report: KnowledgeV2ConversionReport;
};

export type KnowledgeAssetBindingV2 = {
  assetId: string;
  assetHash: string;
  sourceOrdinal: number;
  sourceDocumentPath: string;
  sourceDocumentHash: string;
  sourceSectionHash: string;
  caption: string;
  mappingMethod: "ROLE_ALIAS" | "DOCUMENT_FALLBACK" | "EXPLICIT";
  headingPath: string[];
};

type CourseSourceMetadata = {
  title: string;
  tags: string[];
  images: string[];
};

const SOURCE_DIRECTORY_PACKS: Readonly<Record<string, KnowledgeV2CoursePackId>> = {
  "digital-interaction-creative-design": "digital-interaction",
  "layout-design": "layout-design",
  "brand-vi-design": "brand-vi-design",
  "digital-graphics-illustrator": "general-design",
  "book-design": "book-design",
};

const ASSET_ROLE_HEADINGS = {
  layout: "版式拆分",
  type: "字体形式",
  color: "色彩构图",
} as const;

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/");
}

function sha256Bytes(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: "node" | "asset" | "annotation", ...parts: string[]) {
  return `${prefix}-${sha256Bytes(parts.join("\0"))}`;
}

function emptyCoursePackCounts(): Record<KnowledgeV2CoursePackId, number> {
  return {
    "general-design": 0,
    "digital-interaction": 0,
    "book-design": 0,
    "layout-design": 0,
    "brand-vi-design": 0,
  };
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isSamePath(left: string, right: string) {
  return path.relative(left, right) === "";
}

async function validatedWorkspaceFile(
  workspaceRoot: string,
  workspaceRelativePath: string,
  allowedRoot = workspaceRoot,
) {
  const safeRelativePath = WorkspaceRelativePathV2Schema.parse(
    normalizePath(workspaceRelativePath),
  );
  const candidate = path.resolve(workspaceRoot, safeRelativePath);
  if (!isWithin(workspaceRoot, candidate)) {
    throw new Error(`KNOWLEDGE_V2_PATH_ESCAPE:${safeRelativePath}`);
  }
  let realWorkspaceRoot: string;
  let realAllowedRoot: string;
  let realCandidate: string;
  try {
    [realWorkspaceRoot, realAllowedRoot, realCandidate] = await Promise.all([
      realpath(workspaceRoot),
      realpath(allowedRoot),
      realpath(candidate),
    ]);
  } catch (error) {
    throw new Error(
      `KNOWLEDGE_V2_FILE_MISSING:${safeRelativePath}:${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!isWithin(realWorkspaceRoot, realAllowedRoot)) {
    throw new Error(`KNOWLEDGE_V2_ALLOWED_ROOT_ESCAPE:${safeRelativePath}`);
  }
  if (!isWithin(realAllowedRoot, realCandidate)) {
    throw new Error(`KNOWLEDGE_V2_PATH_ESCAPE:${safeRelativePath}`);
  }
  const expectedRealCandidate = path.join(
    realWorkspaceRoot,
    path.relative(workspaceRoot, candidate),
  );
  const stats = await lstat(candidate);
  if (
    stats.isSymbolicLink()
    || !stats.isFile()
    || !isSamePath(expectedRealCandidate, realCandidate)
  ) {
    throw new Error(`KNOWLEDGE_V2_SYMLINK_NOT_ALLOWED:${safeRelativePath}`);
  }
  return realCandidate;
}

async function readValidatedJson(
  workspaceRoot: string,
  relativePath: string,
) {
  const absolutePath = await validatedWorkspaceFile(workspaceRoot, relativePath);
  return JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
}

async function loadValidatedKnowledgeItems(
  workspaceRoot: string,
  knowledgeDirectory: string,
) {
  const filenames = (await readdir(knowledgeDirectory))
    .filter((filename) => filename.endsWith(".md"))
    .sort(compareCodePoints);
  const items: KnowledgeItem[] = [];
  for (const filename of filenames) {
    const relativePath = `${KNOWLEDGE_DIRECTORY}/${filename}`;
    const absolutePath = await validatedWorkspaceFile(
      workspaceRoot,
      relativePath,
      knowledgeDirectory,
    );
    items.push(parseKnowledgeMarkdown(await readFile(absolutePath, "utf8"), filename));
  }
  return items;
}

function parseScalar(raw: string) {
  const value = raw.trim();
  if (value.startsWith("\"")) {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string") throw new Error("COURSE_SOURCE_VALUE_NOT_STRING");
    return parsed;
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function parseCourseSourceFrontmatter(frontmatter: string): CourseSourceMetadata {
  const values = new Map<string, string | string[]>();
  let currentListKey: string | null = null;
  for (const rawLine of frontmatter.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const listItem = /^\s+-\s+(.+?)\s*$/.exec(rawLine);
    if (listItem) {
      if (!currentListKey) throw new Error("COURSE_SOURCE_LIST_WITHOUT_FIELD");
      const current = values.get(currentListKey);
      if (!Array.isArray(current)) throw new Error("COURSE_SOURCE_LIST_FIELD_INVALID");
      current.push(parseScalar(listItem[1]!));
      continue;
    }
    const field = /^([^:]+):\s*(.*?)\s*$/.exec(rawLine);
    if (!field) throw new Error(`COURSE_SOURCE_FRONTMATTER_INVALID:${rawLine}`);
    const key = field[1]!.trim();
    if (values.has(key)) throw new Error(`COURSE_SOURCE_FIELD_DUPLICATE:${key}`);
    if (field[2]) {
      values.set(key, parseScalar(field[2]));
      currentListKey = null;
    } else {
      values.set(key, []);
      currentListKey = key;
    }
  }
  const title = values.get("标题");
  const tags = values.get("关键词");
  const images = values.get("配图");
  if (typeof title !== "string") throw new Error("COURSE_SOURCE_TITLE_MISSING");
  if (!Array.isArray(tags) || tags.length === 0) throw new Error("COURSE_SOURCE_TAGS_MISSING");
  if (images !== undefined && !Array.isArray(images)) {
    throw new Error("COURSE_SOURCE_IMAGES_INVALID");
  }
  return { title, tags, images: images ?? [] };
}

function extractHeadingSection(markdown: string, level: 2 | 3, title: string) {
  const marker = "#".repeat(level);
  const headings = [...markdown.matchAll(new RegExp(`^${marker}\\s+(.+?)\\s*$`, "gm"))];
  const headingIndex = headings.findIndex((heading) => heading[1]!.trim() === title);
  if (headingIndex < 0) return null;
  const heading = headings[headingIndex]!;
  const start = (heading.index ?? 0) + heading[0].length;
  const end = headings[headingIndex + 1]?.index ?? markdown.length;
  return markdown.slice(start, end).trim();
}

function normalizedCaptionText(value: string) {
  return value.replace(/^#{1,6}\s+/gm, "").replace(/\s+/g, " ").trim();
}

function roleHeadingForAsset(assetPath: string) {
  const role = /-(layout|type|color)\.png$/i.exec(assetPath)?.[1]?.toLowerCase();
  return role ? ASSET_ROLE_HEADINGS[role as keyof typeof ASSET_ROLE_HEADINGS] : undefined;
}

function dimensionsFromPng(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  if (
    buffer.byteLength < 24
    || buffer.subarray(0, 8).toString("hex") !== PNG_SIGNATURE
    || buffer.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("COURSE_ASSET_INVALID_PNG");
  }
  const widthPx = buffer.readUInt32BE(16);
  const heightPx = buffer.readUInt32BE(20);
  if (widthPx < 1 || heightPx < 1) throw new Error("COURSE_ASSET_INVALID_DIMENSIONS");
  return { widthPx, heightPx };
}

export function knowledgeAssetV2FromManifestEntry(
  rawEntry: unknown,
  bytes: Uint8Array,
): KnowledgeAssetV2 {
  const entry = CoursePngAssetSchema.parse(rawEntry);
  const actualSize = bytes.byteLength;
  const actualHash = sha256Bytes(bytes);
  if (actualSize !== entry.sizeBytes || actualHash !== entry.sha256) {
    throw new Error(
      `COURSE_ASSET_HASH_DRIFT:${entry.path}:expected=${entry.sizeBytes}/${entry.sha256}:`
      + `actual=${actualSize}/${actualHash}`,
    );
  }
  return KnowledgeAssetV2Schema.parse({
    schemaVersion: 2,
    id: stableId("asset", COURSE_ROOT, entry.path),
    kind: "IMAGE",
    locator: {
      root: COURSE_ROOT,
      path: entry.path,
    },
    mimeType: "image/png",
    sizeBytes: entry.sizeBytes,
    dimensions: dimensionsFromPng(bytes),
    sha256: entry.sha256,
  });
}

export async function verifyKnowledgeCorpusAssetFilesV2(input: {
  workspaceRoot: string;
  bundle: unknown;
}): Promise<KnowledgeCorpusBundleV2> {
  const bundle = verifyKnowledgeCorpusBundleV2(input.bundle);
  const workspaceRoot = path.resolve(input.workspaceRoot);
  let realWorkspaceRoot: string;
  try {
    realWorkspaceRoot = await realpath(workspaceRoot);
  } catch (error) {
    throw new Error(
      `KNOWLEDGE_V2_WORKSPACE_MISSING:${workspaceRoot}:${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const roots = new Map<string, {
    lexicalRoot: string;
    realRoot: string;
  }>();
  for (const asset of bundle.assets) {
    let root = roots.get(asset.locator.root);
    if (!root) {
      const lexicalRoot = path.resolve(workspaceRoot, asset.locator.root);
      if (!isWithin(workspaceRoot, lexicalRoot)) {
        throw new Error(
          `KNOWLEDGE_V2_ASSET_ROOT_PATH_ESCAPE:${asset.locator.root}`,
        );
      }
      let realRoot: string;
      let rootStats;
      try {
        [realRoot, rootStats] = await Promise.all([
          realpath(lexicalRoot),
          lstat(lexicalRoot),
        ]);
      } catch (error) {
        throw new Error(
          `KNOWLEDGE_V2_ASSET_ROOT_MISSING:${asset.locator.root}:${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (rootStats.isSymbolicLink()) {
        throw new Error(
          `KNOWLEDGE_V2_ASSET_ROOT_SYMLINK_NOT_ALLOWED:${asset.locator.root}`,
        );
      }
      if (!rootStats.isDirectory()) {
        throw new Error(
          `KNOWLEDGE_V2_ASSET_ROOT_NOT_DIRECTORY:${asset.locator.root}`,
        );
      }
      if (!isWithin(realWorkspaceRoot, realRoot)) {
        throw new Error(
          `KNOWLEDGE_V2_ASSET_ROOT_PATH_ESCAPE:${asset.locator.root}`,
        );
      }
      const expectedRealRoot = path.join(
        realWorkspaceRoot,
        path.relative(workspaceRoot, lexicalRoot),
      );
      if (
        !isSamePath(expectedRealRoot, realRoot)
      ) {
        throw new Error(
          `KNOWLEDGE_V2_ASSET_ROOT_SYMLINK_NOT_ALLOWED:${asset.locator.root}`,
        );
      }
      root = { lexicalRoot, realRoot };
      roots.set(asset.locator.root, root);
    }

    const candidate = path.resolve(root.lexicalRoot, asset.locator.path);
    if (
      !isWithin(workspaceRoot, candidate)
      || !isWithin(root.lexicalRoot, candidate)
    ) {
      throw new Error(
        `KNOWLEDGE_V2_ASSET_PATH_ESCAPE:${asset.locator.path}`,
      );
    }
    let realCandidate: string;
    let stats;
    try {
      [realCandidate, stats] = await Promise.all([
        realpath(candidate),
        lstat(candidate),
      ]);
    } catch (error) {
      throw new Error(
        `KNOWLEDGE_V2_ASSET_MISSING:${asset.locator.path}:${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (
      !isWithin(realWorkspaceRoot, realCandidate)
      || !isWithin(root.realRoot, realCandidate)
    ) {
      throw new Error(
        `KNOWLEDGE_V2_ASSET_PATH_ESCAPE:${asset.locator.path}`,
      );
    }
    const expectedRealCandidate = path.join(
      root.realRoot,
      path.relative(root.lexicalRoot, candidate),
    );
    if (
      stats.isSymbolicLink()
      || !isSamePath(expectedRealCandidate, realCandidate)
    ) {
      throw new Error(
        `KNOWLEDGE_V2_ASSET_SYMLINK_NOT_ALLOWED:${asset.locator.path}`,
      );
    }
    if (!stats.isFile()) {
      throw new Error(
        `KNOWLEDGE_V2_ASSET_NOT_REGULAR_FILE:${asset.locator.path}`,
      );
    }
    if (stats.size !== asset.sizeBytes) {
      throw new Error(
        `KNOWLEDGE_V2_ASSET_SIZE_DRIFT:${asset.id}:`
        + `expected=${asset.sizeBytes}:actual=${stats.size}`,
      );
    }
    const bytes = await readFile(realCandidate);
    if (bytes.byteLength !== asset.sizeBytes) {
      throw new Error(
        `KNOWLEDGE_V2_ASSET_SIZE_DRIFT:${asset.id}:`
        + `expected=${asset.sizeBytes}:actual=${bytes.byteLength}`,
      );
    }
    const sha256 = sha256Bytes(bytes);
    if (sha256 !== asset.sha256) {
      throw new Error(
        `KNOWLEDGE_V2_ASSET_HASH_DRIFT:${asset.id}:`
        + `expected=${asset.sha256}:actual=${sha256}`,
      );
    }
  }
  return bundle;
}

export function adaptLegacyKnowledgeItemV2(input: {
  item: KnowledgeItem;
  sourceCoursePackId: KnowledgeV2CoursePackId;
  sourceIdentityBasis: "COURSE_DIRECTORY" | "TRACKED_LEGACY_MAP";
  assetBindings: readonly KnowledgeAssetBindingV2[];
}): KnowledgeObjectV2 {
  const item = KnowledgeItemSchema.parse(input.item);
  const assetIds = input.assetBindings.map(({ assetId }) => assetId);
  if (new Set(assetIds).size !== assetIds.length) {
    throw new Error(`KNOWLEDGE_V2_DUPLICATE_ASSET_REFERENCE:${item.id}`);
  }
  const sourceOrdinals = input.assetBindings.map(({ sourceOrdinal }) => sourceOrdinal);
  if (new Set(sourceOrdinals).size !== sourceOrdinals.length) {
    throw new Error(`KNOWLEDGE_V2_DUPLICATE_ASSET_ORDINAL:${item.id}`);
  }

  const rootId = stableId("node", item.id, "document");
  const contentSectionId = stableId("node", item.id, "section", "content");
  const contentNodeId = stableId("node", item.id, "text", "content");
  const factsSectionId = stableId("node", item.id, "section", "facts");
  const factNodeIds = item.facts.map(({ id }) => stableId("node", item.id, "fact", id));
  const actionsSectionId = stableId("node", item.id, "section", "actions");
  const actionNodeIds = item.actions.map(({ id }) => stableId("node", item.id, "action", id));
  const assetsSectionId = stableId("node", item.id, "section", "assets");
  const imageNodeIds = input.assetBindings.map(({ assetId }) =>
    stableId("node", item.id, "image", assetId));
  const rootChildren = [
    contentSectionId,
    factsSectionId,
    actionsSectionId,
    ...(input.assetBindings.length > 0 ? [assetsSectionId] : []),
  ];

  const nodes = [
    sealKnowledgeNodeV2({
      id: rootId,
      kind: "DOCUMENT",
      parentId: null,
      childrenIds: rootChildren,
      relatedIds: [],
      location: null,
      title: item.title,
    }),
    sealKnowledgeNodeV2({
      id: contentSectionId,
      kind: "SECTION",
      parentId: rootId,
      childrenIds: [contentNodeId],
      relatedIds: [],
      location: null,
      title: "核心内容",
      level: 2,
    }),
    sealKnowledgeNodeV2({
      id: contentNodeId,
      kind: "TEXT",
      parentId: contentSectionId,
      childrenIds: [],
      relatedIds: [],
      location: null,
      text: item.content,
      role: "CONTENT",
      legacyStatementId: null,
    }),
    sealKnowledgeNodeV2({
      id: factsSectionId,
      kind: "SECTION",
      parentId: rootId,
      childrenIds: factNodeIds,
      relatedIds: [],
      location: null,
      title: "事实与证据",
      level: 2,
    }),
    ...item.facts.map((fact, index) => sealKnowledgeNodeV2({
      id: factNodeIds[index]!,
      kind: "TEXT",
      parentId: factsSectionId,
      childrenIds: [],
      relatedIds: [],
      location: null,
      text: fact.text,
      role: "FACT",
      legacyStatementId: fact.id,
    })),
    sealKnowledgeNodeV2({
      id: actionsSectionId,
      kind: "SECTION",
      parentId: rootId,
      childrenIds: actionNodeIds,
      relatedIds: [],
      location: null,
      title: "导师行动",
      level: 2,
    }),
    ...item.actions.map((action, index) => sealKnowledgeNodeV2({
      id: actionNodeIds[index]!,
      kind: "TEXT",
      parentId: actionsSectionId,
      childrenIds: [],
      relatedIds: [],
      location: null,
      text: action.text,
      role: "ACTION",
      legacyStatementId: action.id,
    })),
    ...(input.assetBindings.length > 0
      ? [
          sealKnowledgeNodeV2({
            id: assetsSectionId,
            kind: "SECTION",
            parentId: rootId,
            childrenIds: imageNodeIds,
            relatedIds: [],
            location: null,
            title: "课程配图",
            level: 2,
          }),
          ...input.assetBindings.map((binding, index) => sealKnowledgeNodeV2({
            id: imageNodeIds[index]!,
            kind: "IMAGE",
            parentId: assetsSectionId,
            childrenIds: [],
            relatedIds: [],
            location: null,
            assetId: binding.assetId,
          })),
        ]
      : []),
  ];

  const annotations = input.assetBindings.map((binding, index) =>
    sealKnowledgeAnnotationV2({
      id: stableId("annotation", item.id, "caption", binding.assetId),
      targetNodeId: imageNodeIds[index]!,
      kind: "CAPTION",
      origin: "SOURCE",
      payload: { kind: "CAPTION", text: binding.caption },
      producer: {
        ...KNOWLEDGE_V2_PARSER,
        modelId: null,
        modelRevision: null,
      },
      inputs: [
        {
          kind: "SOURCE_DOCUMENT",
          path: binding.sourceDocumentPath,
          sha256: binding.sourceDocumentHash,
        },
        {
          kind: "SOURCE_SECTION",
          headingPath: binding.headingPath,
          sha256: binding.sourceSectionHash,
        },
        {
          kind: "ASSET",
          assetId: binding.assetId,
          sha256: binding.assetHash,
        },
      ],
      sourceMapping: {
        method: binding.mappingMethod,
        headingPath: binding.headingPath,
        sourceOrdinal: binding.sourceOrdinal,
      },
    }));
  const placement = knowledgePlacementForTopic(item.topic);
  const locators = [
    ...(item.source.url ? [{ kind: "URL" as const, url: item.source.url }] : []),
    ...(item.source.localDocument
      ? [{ kind: "LOCAL_DOCUMENT" as const, path: item.source.localDocument }]
      : []),
  ];
  return sealKnowledgeObjectV2({
    schemaVersion: 2,
    id: item.id,
    title: item.title,
    topic: item.topic,
    tags: item.tags,
    sourceCoursePack: { id: input.sourceCoursePackId, version: "1" },
    sourceIdentityBasis: input.sourceIdentityBasis,
    legacyPlacement: {
      coursePack: {
        id: placement.coursePackId,
        version: placement.coursePackVersion,
      },
      namespace: placement.namespace,
    },
    provenance: {
      authority: item.source.authority,
      verifiedDate: item.source.verifiedDate,
      scope: item.source.scope,
      locators,
    },
    parser: KNOWLEDGE_V2_PARSER,
    contentVersion: KNOWLEDGE_V2_CONTENT_VERSION,
    rootNodeId: rootId,
    nodes,
    assetIds,
    annotations,
    legacyItem: item,
  });
}

function sourceCourseFromLocalDocument(localDocument: string) {
  const match = /^data\/courses\/([^/]+)\//.exec(normalizePath(localDocument));
  if (!match) return null;
  const sourceCoursePackId = SOURCE_DIRECTORY_PACKS[match[1]!];
  if (!sourceCoursePackId) {
    throw new Error(`KNOWLEDGE_V2_UNKNOWN_COURSE_DIRECTORY:${match[1]}`);
  }
  return sourceCoursePackId;
}

async function buildAssets(
  workspaceRoot: string,
  manifest: CoursePngManifest,
) {
  const courseRoot = path.join(workspaceRoot, COURSE_ROOT);
  const assets: KnowledgeAssetV2[] = [];
  for (const entry of manifest.assets) {
    const relativePath = `${COURSE_ROOT}/${entry.path}`;
    const absolutePath = await validatedWorkspaceFile(
      workspaceRoot,
      relativePath,
      courseRoot,
    );
    assets.push(knowledgeAssetV2FromManifestEntry(entry, await readFile(absolutePath)));
  }
  return assets;
}

async function assetBindingsForGeneratedItem(input: {
  workspaceRoot: string;
  item: KnowledgeItem;
  assetsByPath: ReadonlyMap<string, KnowledgeAssetV2>;
  referencedAssetPaths: Set<string>;
}) {
  const localDocument = input.item.source.localDocument;
  if (!localDocument) {
    throw new Error(`KNOWLEDGE_V2_GENERATED_SOURCE_MISSING:${input.item.id}`);
  }
  const sourcePath = normalizePath(localDocument);
  const absolutePath = await validatedWorkspaceFile(
    input.workspaceRoot,
    sourcePath,
    path.join(input.workspaceRoot, COURSE_ROOT),
  );
  const markdown = await readFile(absolutePath, "utf8");
  const sourceDocumentHash = sha256Bytes(markdown);
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) throw new Error(`COURSE_SOURCE_MARKDOWN_INVALID:${sourcePath}`);
  const metadata = parseCourseSourceFrontmatter(match[1]!);
  if (metadata.title !== input.item.title) {
    throw new Error(`COURSE_SOURCE_TITLE_DRIFT:${sourcePath}`);
  }
  const coreContent = extractHeadingSection(match[2]!, 2, "核心内容");
  if (!coreContent) throw new Error(`COURSE_SOURCE_CORE_CONTENT_MISSING:${sourcePath}`);

  const localAssetPaths = new Set<string>();
  return metadata.images.map((rawAssetPath, sourceOrdinal) => {
    const assetPath = CourseAssetPathV2Schema.parse(normalizePath(rawAssetPath));
    const asset = input.assetsByPath.get(assetPath);
    if (!asset) throw new Error(`COURSE_IMAGE_NOT_IN_MANIFEST:${sourcePath}:${assetPath}`);
    if (localAssetPaths.has(assetPath)) {
      throw new Error(`COURSE_IMAGE_DUPLICATE_REFERENCE:${sourcePath}:${assetPath}`);
    }
    localAssetPaths.add(assetPath);
    input.referencedAssetPaths.add(assetPath);
    const roleHeading = roleHeadingForAsset(assetPath);
    const selectedSection = roleHeading
      ? extractHeadingSection(coreContent, 3, roleHeading)
      : null;
    const mappingMethod = selectedSection
      ? "ROLE_ALIAS" as const
      : "DOCUMENT_FALLBACK" as const;
    const caption = normalizedCaptionText(selectedSection ?? coreContent);
    if (!caption) throw new Error(`COURSE_ASSET_CAPTION_EMPTY:${sourcePath}:${assetPath}`);
    return {
      assetId: asset.id,
      assetHash: asset.sha256,
      sourceOrdinal,
      sourceDocumentPath: sourcePath,
      sourceDocumentHash,
      sourceSectionHash: sha256Bytes(selectedSection ?? coreContent),
      caption,
      mappingMethod,
      headingPath: selectedSection ? ["核心内容", roleHeading!] : ["核心内容"],
    };
  });
}

async function validateLegacyLocalSource(
  workspaceRoot: string,
  item: KnowledgeItem,
) {
  if (!item.source.localDocument) return;
  await validatedWorkspaceFile(workspaceRoot, item.source.localDocument);
}

function assertExactIdSet(
  label: string,
  actual: readonly string[],
  expected: readonly string[],
) {
  const actualSorted = [...actual].sort(compareCodePoints);
  const expectedSorted = [...expected].sort(compareCodePoints);
  if (stableJsonV2(actualSorted) !== stableJsonV2(expectedSorted)) {
    throw new Error(`${label}_ID_SET_DRIFT`);
  }
}

export async function buildKnowledgeV2Corpus(
  options: { workspaceRoot?: string } = {},
): Promise<BuiltKnowledgeV2Corpus> {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const manifest = await verifyCoursePngManifest({ workspaceRoot });
  const [assets, v1ReportRaw, legacySourceMapRaw] = await Promise.all([
    buildAssets(workspaceRoot, manifest),
    readValidatedJson(workspaceRoot, V1_CONVERSION_REPORT_PATH),
    readValidatedJson(workspaceRoot, LEGACY_SOURCE_COURSE_MAP_PATH),
  ]);
  const v1Report = V1ConversionReportSchema.parse(v1ReportRaw);
  const legacySourceMap = LegacySourceCourseMapSchema.parse(legacySourceMapRaw);
  const knowledgeDirectory = path.join(workspaceRoot, KNOWLEDGE_DIRECTORY);
  const realKnowledgeDirectory = await realpath(knowledgeDirectory);
  const knowledgeDirectoryStats = await lstat(knowledgeDirectory);
  if (
    knowledgeDirectoryStats.isSymbolicLink()
    || !knowledgeDirectoryStats.isDirectory()
    || !isWithin(await realpath(workspaceRoot), realKnowledgeDirectory)
  ) {
    throw new Error("KNOWLEDGE_V2_KNOWLEDGE_DIRECTORY_UNSAFE");
  }
  const items = await loadValidatedKnowledgeItems(workspaceRoot, knowledgeDirectory);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  if (itemsById.size !== items.length) throw new Error("KNOWLEDGE_V2_DUPLICATE_ITEM_ID");
  const rebuiltV1 = await buildCourseCorpusArtifacts({
    workspaceRoot,
    coursesDirectory: path.join(workspaceRoot, COURSE_ROOT),
  });
  if (stableJsonV2(rebuiltV1.report) !== stableJsonV2(v1Report)) {
    throw new Error("KNOWLEDGE_V2_V1_CONVERSION_REPORT_DRIFT");
  }
  for (const artifact of rebuiltV1.artifacts) {
    const trackedItem = itemsById.get(artifact.item.id);
    if (!trackedItem || stableJsonV2(trackedItem) !== stableJsonV2(artifact.item)) {
      throw new Error(`KNOWLEDGE_V2_V1_ITEM_DRIFT:${artifact.item.id}`);
    }
    const trackedPath = `${KNOWLEDGE_DIRECTORY}/${artifact.outputFilename}`;
    const trackedAbsolutePath = await validatedWorkspaceFile(
      workspaceRoot,
      trackedPath,
      knowledgeDirectory,
    );
    if (await readFile(trackedAbsolutePath, "utf8") !== artifact.markdown) {
      throw new Error(`KNOWLEDGE_V2_V1_MARKDOWN_DRIFT:${artifact.outputFilename}`);
    }
  }
  const generatedIds = new Set(v1Report.generatedIds);
  assertExactIdSet(
    "KNOWLEDGE_V2_GENERATED",
    [...generatedIds],
    v1Report.managedFiles.map((filename) => filename.slice(0, -3)),
  );
  for (const generatedId of generatedIds) {
    if (!itemsById.has(generatedId)) {
      throw new Error(`KNOWLEDGE_V2_GENERATED_ITEM_MISSING:${generatedId}`);
    }
  }
  const baselineIds = items
    .map(({ id }) => id)
    .filter((id) => !generatedIds.has(id));
  assertExactIdSet(
    "KNOWLEDGE_V2_LEGACY_SOURCE_MAP",
    legacySourceMap.items.map(({ id }) => id),
    baselineIds,
  );
  const legacySourceById = new Map(
    legacySourceMap.items.map(({ id, sourceCoursePackId }) => [id, sourceCoursePackId]),
  );
  const assetsByPath = new Map(assets.map((asset) => [asset.locator.path, asset]));
  if (assetsByPath.size !== assets.length) throw new Error("KNOWLEDGE_V2_DUPLICATE_ASSET_PATH");
  const referencedAssetPaths = new Set<string>();
  const objects: KnowledgeObjectV2[] = [];

  for (const item of items) {
    await validateLegacyLocalSource(workspaceRoot, item);
    if (generatedIds.has(item.id)) {
      if (!item.source.localDocument) {
        throw new Error(`KNOWLEDGE_V2_GENERATED_SOURCE_MISSING:${item.id}`);
      }
      const sourceCoursePackId = sourceCourseFromLocalDocument(item.source.localDocument);
      if (!sourceCoursePackId) {
        throw new Error(`KNOWLEDGE_V2_GENERATED_SOURCE_OUTSIDE_COURSES:${item.id}`);
      }
      objects.push(adaptLegacyKnowledgeItemV2({
        item,
        sourceCoursePackId,
        sourceIdentityBasis: "COURSE_DIRECTORY",
        assetBindings: await assetBindingsForGeneratedItem({
          workspaceRoot,
          item,
          assetsByPath,
          referencedAssetPaths,
        }),
      }));
    } else {
      const sourceCoursePackId = legacySourceById.get(item.id);
      if (!sourceCoursePackId) {
        throw new Error(`KNOWLEDGE_V2_LEGACY_SOURCE_MAPPING_MISSING:${item.id}`);
      }
      objects.push(adaptLegacyKnowledgeItemV2({
        item,
        sourceCoursePackId,
        sourceIdentityBasis: "TRACKED_LEGACY_MAP",
        assetBindings: [],
      }));
    }
  }
  objects.sort((left, right) => compareCodePoints(left.id, right.id));
  const unreferencedAssetIds = assets
    .filter((asset) => !referencedAssetPaths.has(asset.locator.path))
    .map(({ id }) => id)
    .sort(compareCodePoints);
  const bundle = sealKnowledgeCorpusBundleV2({
    schemaVersion: 2,
    corpusVersion: KNOWLEDGE_V2_CORPUS_VERSION,
    parser: KNOWLEDGE_V2_PARSER,
    contentVersion: KNOWLEDGE_V2_CONTENT_VERSION,
    objects,
    assets,
    unreferencedAssetIds,
  });

  const sourceIdentityCounts = emptyCoursePackCounts();
  const legacyPlacementCounts = emptyCoursePackCounts();
  const sourceIdentityBasisCounts = {
    COURSE_DIRECTORY: 0,
    TRACKED_LEGACY_MAP: 0,
  };
  const captionMappingCounts = {
    ROLE_ALIAS: 0,
    DOCUMENT_FALLBACK: 0,
    EXPLICIT: 0,
  };
  let mismatchCount = 0;
  for (const object of bundle.objects) {
    sourceIdentityCounts[object.sourceCoursePack.id] += 1;
    legacyPlacementCounts[object.legacyPlacement.coursePack.id] += 1;
    sourceIdentityBasisCounts[object.sourceIdentityBasis] += 1;
    if (object.sourceCoursePack.id !== object.legacyPlacement.coursePack.id) mismatchCount += 1;
    for (const annotation of object.annotations) {
      if (annotation.kind !== "CAPTION" || annotation.origin !== "SOURCE") continue;
      const method = annotation.sourceMapping?.method;
      if (method) captionMappingCounts[method] += 1;
    }
  }
  const referencedAssetCount = new Set(
    bundle.objects.flatMap(({ assetIds }) => assetIds),
  ).size;
  const report = KnowledgeV2ConversionReportSchema.parse({
    schemaVersion: 2,
    corpusVersion: KNOWLEDGE_V2_CORPUS_VERSION,
    parser: KNOWLEDGE_V2_PARSER,
    contentVersion: KNOWLEDGE_V2_CONTENT_VERSION,
    bundlePath: KNOWLEDGE_V2_BUNDLE_PATH,
    bundleHash: bundle.bundleHash,
    objectCount: bundle.objects.length,
    generatedSourceCount: generatedIds.size,
    legacySourceCount: baselineIds.length,
    assetCount: bundle.assets.length,
    imageBearingObjectCount: bundle.objects.filter(({ assetIds }) => assetIds.length > 0).length,
    imageNodeCount: bundle.objects.flatMap(({ nodes }) =>
      nodes.filter(({ kind }) => kind === "IMAGE")).length,
    sourceCaptionAnnotationCount: bundle.objects.flatMap(({ annotations }) =>
      annotations.filter((annotation) =>
        annotation.kind === "CAPTION" && annotation.origin === "SOURCE")).length,
    referencedAssetCount,
    unreferencedAssetCount: bundle.unreferencedAssetIds.length,
    sourceIdentityBasisCounts,
    sourceIdentityCounts,
    legacyPlacementCounts,
    sourceLegacyPlacementMismatchCount: mismatchCount,
    captionMappingCounts,
  });
  return {
    bundle,
    report: verifyKnowledgeV2ConversionReport(report, bundle),
  };
}

export function serializeKnowledgeCorpusBundleV2(bundle: KnowledgeCorpusBundleV2) {
  return `${JSON.stringify(verifyKnowledgeCorpusBundleV2(bundle), null, 2)}\n`;
}

export function serializeKnowledgeV2ConversionReport(report: KnowledgeV2ConversionReport) {
  return `${JSON.stringify(KnowledgeV2ConversionReportSchema.parse(report), null, 2)}\n`;
}

export function verifyKnowledgeV2ConversionReport(
  reportInput: unknown,
  bundleInput: unknown,
): KnowledgeV2ConversionReport {
  const report = KnowledgeV2ConversionReportSchema.parse(reportInput);
  const bundle = verifyKnowledgeCorpusBundleV2(bundleInput);
  const sourceIdentityCounts = emptyCoursePackCounts();
  const legacyPlacementCounts = emptyCoursePackCounts();
  const sourceIdentityBasisCounts = {
    COURSE_DIRECTORY: 0,
    TRACKED_LEGACY_MAP: 0,
  };
  const captionMappingCounts = {
    ROLE_ALIAS: 0,
    DOCUMENT_FALLBACK: 0,
    EXPLICIT: 0,
  };
  let mismatchCount = 0;
  for (const object of bundle.objects) {
    sourceIdentityCounts[object.sourceCoursePack.id] += 1;
    legacyPlacementCounts[object.legacyPlacement.coursePack.id] += 1;
    sourceIdentityBasisCounts[object.sourceIdentityBasis] += 1;
    if (object.sourceCoursePack.id !== object.legacyPlacement.coursePack.id) mismatchCount += 1;
    for (const annotation of object.annotations) {
      if (annotation.kind !== "CAPTION" || annotation.origin !== "SOURCE") continue;
      const method = annotation.sourceMapping?.method;
      if (method) captionMappingCounts[method] += 1;
    }
  }
  const expected = {
    schemaVersion: 2,
    corpusVersion: KNOWLEDGE_V2_CORPUS_VERSION,
    parser: KNOWLEDGE_V2_PARSER,
    contentVersion: KNOWLEDGE_V2_CONTENT_VERSION,
    bundlePath: KNOWLEDGE_V2_BUNDLE_PATH,
    bundleHash: bundle.bundleHash,
    objectCount: bundle.objects.length,
    generatedSourceCount: sourceIdentityBasisCounts.COURSE_DIRECTORY,
    legacySourceCount: sourceIdentityBasisCounts.TRACKED_LEGACY_MAP,
    assetCount: bundle.assets.length,
    imageBearingObjectCount: bundle.objects.filter(({ assetIds }) => assetIds.length > 0).length,
    imageNodeCount: bundle.objects.flatMap(({ nodes }) =>
      nodes.filter(({ kind }) => kind === "IMAGE")).length,
    sourceCaptionAnnotationCount: bundle.objects.flatMap(({ annotations }) =>
      annotations.filter((annotation) =>
        annotation.kind === "CAPTION" && annotation.origin === "SOURCE")).length,
    referencedAssetCount: new Set(
      bundle.objects.flatMap(({ assetIds }) => assetIds),
    ).size,
    unreferencedAssetCount: bundle.unreferencedAssetIds.length,
    sourceIdentityBasisCounts,
    sourceIdentityCounts,
    legacyPlacementCounts,
    sourceLegacyPlacementMismatchCount: mismatchCount,
    captionMappingCounts,
  };
  if (stableJsonV2(report) !== stableJsonV2(expected)) {
    throw new Error("KNOWLEDGE_V2_CONVERSION_REPORT_BUNDLE_DRIFT");
  }
  return report;
}

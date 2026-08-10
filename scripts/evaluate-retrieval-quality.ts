import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import {
  buildCoursePngManifest,
  CoursePngManifestSchema,
  serializeCoursePngManifest,
} from "@/lib/knowledge/course-png-manifest";
import { knowledgePlacementForTopic } from "@/lib/knowledge/course-pack-store";
import {
  CaptionLexicalFallbackResultV2Schema,
  type RetrievalChannelProviderV2,
} from "@/lib/knowledge/hybrid-retriever-v2";
import { LexicalChannelIdentityV2Schema } from "@/lib/knowledge/retrieval-channel-adapters-v2";
import {
  KnowledgeItemSchema,
  loadKnowledgeDirectory,
  rankKnowledge,
  type KnowledgeItem,
} from "@/lib/knowledge/retrieve";
import {
  RetrievalEvaluationResultSchema,
  RetrievalGoldenSuiteSchema,
  RetrievalCoursePackIdSchema,
  scoreRetrievalCase,
  summarizeRetrievalScores,
  type RetrievalEvaluationResult,
  type RetrievalGoldenSuite,
} from "@/lib/knowledge/retrieval-quality";
import type { z } from "zod";

type CoursePackId = z.infer<typeof RetrievalCoursePackIdSchema>;

type EvaluateOptions = {
  workspaceRoot?: string;
  suitePath?: string;
};

type CorpusTextEntry = {
  path: string;
  text: string;
};

type AssetCaptionRecord = {
  assetPath: string;
  captionItem: KnowledgeItem;
  sourceCoursePackId: CoursePackId;
  legacyPlacementCoursePackId: CoursePackId;
  sourceDocument: string;
  mappingMethod: "ROLE_ALIAS" | "DOCUMENT_FALLBACK";
  headingPath: string[];
  captionSha256: string;
  frontmatterOrdinal: number;
};

const SOURCE_DIRECTORY_PACKS: Record<string, CoursePackId> = {
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

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isSamePath(left: string, right: string) {
  return path.relative(left, right) === "";
}

async function validatedRealFile(
  workspaceRoot: string,
  allowedRoot: string,
  candidate: string,
) {
  const [realWorkspaceRoot, realAllowedRoot, realCandidate] = await Promise.all([
    realpath(workspaceRoot),
    realpath(allowedRoot),
    realpath(candidate),
  ]);
  if (!isWithin(realWorkspaceRoot, realAllowedRoot)) {
    throw new Error(`RETRIEVAL_ROOT_PATH_ESCAPE:${allowedRoot}`);
  }
  if (!isWithin(realAllowedRoot, realCandidate)) {
    throw new Error(`RETRIEVAL_INPUT_PATH_ESCAPE:${candidate}`);
  }
  const expectedRealCandidate = path.join(realAllowedRoot, path.relative(allowedRoot, candidate));
  const stats = await lstat(candidate);
  if (stats.isSymbolicLink() || !stats.isFile() || !isSamePath(expectedRealCandidate, realCandidate)) {
    throw new Error(`RETRIEVAL_INPUT_SYMLINK_NOT_ALLOWED:${candidate}`);
  }
  return realCandidate;
}

function sourceCoursePackId(item: KnowledgeItem): CoursePackId {
  const localDocument = item.source.localDocument
    ? normalizePath(item.source.localDocument)
    : null;
  const match = localDocument
    ? /^data\/courses\/([^/]+)\//.exec(localDocument)
    : null;
  const sourcePack = match ? SOURCE_DIRECTORY_PACKS[match[1]!] : undefined;
  return sourcePack ?? knowledgePlacementForTopic(item.topic).coursePackId;
}

function parseScalar(rawValue: string) {
  const value = rawValue.trim();
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

function parseSourceFrontmatter(frontmatter: string) {
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
  if (images !== undefined && !Array.isArray(images)) throw new Error("COURSE_SOURCE_IMAGES_INVALID");
  return {
    title,
    tags,
    images: images ?? [],
  };
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
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function roleHeadingForAsset(assetPath: string) {
  const role = /-(layout|type|color)\.png$/i.exec(assetPath)?.[1]?.toLowerCase();
  return role ? ASSET_ROLE_HEADINGS[role as keyof typeof ASSET_ROLE_HEADINGS] : undefined;
}

function buildCaptionItem(
  owner: KnowledgeItem,
  assetPath: string,
  sourceTitle: string,
  sourceTags: readonly string[],
  coreContent: string,
  roleHeading: string | undefined,
) {
  const selectedSection = roleHeading
    ? extractHeadingSection(coreContent, 3, roleHeading)
    : null;
  const mappingMethod = selectedSection ? "ROLE_ALIAS" as const : "DOCUMENT_FALLBACK" as const;
  const caption = normalizedCaptionText(selectedSection ?? coreContent);
  if (!caption) throw new Error(`COURSE_ASSET_CAPTION_EMPTY:${assetPath}`);
  const captionHash = createHash("sha256").update(caption).digest("hex");
  const suffix = createHash("sha256").update(assetPath).digest("hex").slice(0, 20);
  const title = `${sourceTitle} · ${roleHeading ?? "配图说明"}`.slice(0, 160);
  const tags = [...new Set([
    ...owner.tags,
    ...sourceTags,
    roleHeading ?? "配图说明",
  ])].slice(0, 20).map((tag) => tag.slice(0, 50));
  const captionItem = KnowledgeItemSchema.parse({
    ...owner,
    id: `asset-caption-${suffix}`,
    title,
    tags,
    content: caption.slice(0, 8_000),
  });
  return {
    captionItem,
    mappingMethod,
    headingPath: selectedSection ? ["核心内容", roleHeading!] : ["核心内容"],
    captionSha256: captionHash,
  };
}

async function assetCaptionsForKnowledge(
  workspaceRoot: string,
  items: readonly KnowledgeItem[],
  assetPaths: ReadonlySet<string>,
) {
  const result = new Map<string, AssetCaptionRecord>();
  const courseRoot = path.join(workspaceRoot, "data", "courses");
  for (const item of items) {
    const sourceDocument = item.source.localDocument
      ? normalizePath(item.source.localDocument)
      : null;
    if (!sourceDocument?.startsWith("data/courses/")) continue;
    const localDocument = path.resolve(workspaceRoot, sourceDocument);
    const realDocument = await validatedRealFile(
      workspaceRoot,
      courseRoot,
      localDocument,
    );
    const markdown = await readFile(realDocument, "utf8");
    const sourceMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
    if (!sourceMatch) throw new Error(`COURSE_SOURCE_MARKDOWN_INVALID:${sourceDocument}`);
    const metadata = parseSourceFrontmatter(sourceMatch[1]!);
    if (metadata.images.length === 0) continue;
    const coreContent = extractHeadingSection(sourceMatch[2]!, 2, "核心内容");
    if (!coreContent) throw new Error(`COURSE_SOURCE_CORE_CONTENT_MISSING:${sourceDocument}`);
    for (const [frontmatterOrdinal, rawAssetPath] of metadata.images.entries()) {
      const assetPath = normalizePath(rawAssetPath);
      if (!assetPaths.has(assetPath)) throw new Error(`COURSE_IMAGE_NOT_IN_MANIFEST:${assetPath}`);
      if (result.has(assetPath)) throw new Error(`COURSE_IMAGE_DUPLICATE_REFERENCE:${assetPath}`);
      const caption = buildCaptionItem(
        item,
        assetPath,
        metadata.title,
        metadata.tags,
        coreContent,
        roleHeadingForAsset(assetPath),
      );
      result.set(assetPath, {
        assetPath,
        ...caption,
        sourceCoursePackId: sourceCoursePackId(item),
        legacyPlacementCoursePackId: knowledgePlacementForTopic(item.topic).coursePackId,
        sourceDocument,
        frontmatterOrdinal,
      });
    }
  }
  const missing = [...assetPaths].filter((assetPath) => !result.has(assetPath));
  if (missing.length > 0 || result.size !== assetPaths.size) {
    throw new Error(`COURSE_ASSET_CAPTION_COVERAGE_DRIFT:${missing.join(",")}`);
  }
  return result;
}

async function validateSuiteBindings(
  workspaceRoot: string,
  suite: RetrievalGoldenSuite,
  manifest: z.infer<typeof CoursePngManifestSchema>,
  knowledge: readonly KnowledgeItem[],
  captions: ReadonlyMap<string, AssetCaptionRecord>,
) {
  const knowledgeById = new Map(knowledge.map((item) => [item.id, item]));
  const assetsByPath = new Map(manifest.assets.map((asset) => [asset.path, asset]));
  const courseRoot = path.join(workspaceRoot, "data", "courses");
  for (const testCase of suite.cases) {
    const bindingError = (detail: string) =>
      new Error(`RETRIEVAL_SUITE_BINDING_ERROR:${testCase.id}:${detail}`);
    for (const queryAssetPath of [
      ...(testCase.query.assetPath ? [testCase.query.assetPath] : []),
      ...(testCase.query.excludeAssetPaths ?? []),
    ]) {
      if (!assetsByPath.has(queryAssetPath)) {
        throw bindingError(`QUERY_ASSET_MISSING:${queryAssetPath}`);
      }
    }
    for (const nodeId of [
      ...testCase.targets.nodes.map(({ id }) => id),
      ...testCase.targets.forbiddenNodeIds,
    ]) {
      if (!knowledgeById.has(nodeId)) throw bindingError(`NODE_MISSING:${nodeId}`);
    }
    for (const assetPath of [
      ...testCase.targets.assets.map(({ path: targetPath }) => targetPath),
      ...testCase.targets.regions.map(({ assetPath: targetPath }) => targetPath),
      ...testCase.targets.forbiddenAssetPaths,
    ]) {
      if (!assetsByPath.has(assetPath)) throw bindingError(`ASSET_MISSING:${assetPath}`);
      if (!captions.has(assetPath)) throw bindingError(`ASSET_CAPTION_MISSING:${assetPath}`);
    }
    for (const target of testCase.targets.assets) {
      if (assetsByPath.get(target.path)?.sha256 !== target.sha256) {
        throw bindingError(`ASSET_SHA256_MISMATCH:${target.path}`);
      }
    }

    const associatedParents = new Set<string>();
    for (const target of testCase.targets.nodes) {
      const item = knowledgeById.get(target.id)!;
      const sourceDocument = item.source.localDocument
        ? normalizePath(item.source.localDocument)
        : null;
      if (sourceDocument?.startsWith("data/courses/")) associatedParents.add(sourceDocument);
      if (
        testCase.expectedSourceCoursePackId !== null
        && sourceCoursePackId(item) !== testCase.expectedSourceCoursePackId
      ) {
        throw bindingError(`NODE_SOURCE_COURSE_MISMATCH:${target.id}`);
      }
      if (
        testCase.expectedLegacyPlacementCoursePackId !== null
        && knowledgePlacementForTopic(item.topic).coursePackId
          !== testCase.expectedLegacyPlacementCoursePackId
      ) {
        throw bindingError(`NODE_LEGACY_PLACEMENT_MISMATCH:${target.id}`);
      }
    }
    for (const assetPath of new Set([
      ...testCase.targets.assets.map(({ path: targetPath }) => targetPath),
      ...testCase.targets.regions.map(({ assetPath: targetPath }) => targetPath),
    ])) {
      const caption = captions.get(assetPath)!;
      associatedParents.add(caption.sourceDocument);
      if (
        testCase.expectedSourceCoursePackId !== null
        && caption.sourceCoursePackId !== testCase.expectedSourceCoursePackId
      ) {
        throw bindingError(`ASSET_SOURCE_COURSE_MISMATCH:${assetPath}`);
      }
      if (
        testCase.expectedLegacyPlacementCoursePackId !== null
        && caption.legacyPlacementCoursePackId
          !== testCase.expectedLegacyPlacementCoursePackId
      ) {
        throw bindingError(`ASSET_LEGACY_PLACEMENT_MISMATCH:${assetPath}`);
      }
    }
    for (const locator of testCase.targets.expectedParentLocators) {
      const localDocument = path.resolve(workspaceRoot, locator);
      await validatedRealFile(workspaceRoot, courseRoot, localDocument);
      if (!associatedParents.has(locator)) {
        throw bindingError(`PARENT_NOT_ASSOCIATED_WITH_TARGET:${locator}`);
      }
    }
  }
}

function parentLocators(items: readonly KnowledgeItem[]) {
  return [...new Set(items.flatMap((item) => {
    const locator = item.source.localDocument
      ? normalizePath(item.source.localDocument)
      : null;
    return locator && /^data\/courses\/[^/]+\/[^/]+\.md$/.test(locator) ? [locator] : [];
  }))].sort(compareCodePoints);
}

function captionParentLocators(records: readonly AssetCaptionRecord[]) {
  return [...new Set(records.map(({ sourceDocument }) => sourceDocument))]
    .sort(compareCodePoints);
}

export function canonicalTextEntriesSha256(entries: readonly CorpusTextEntry[]) {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((left, right) => compareCodePoints(left.path, right.path))) {
    hash.update(normalizePath(entry.path));
    hash.update("\0");
    hash.update(entry.text.replace(/\r\n?/g, "\n"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function loadKnowledgeTextEntries(workspaceRoot: string) {
  const directory = path.join(workspaceRoot, "data", "knowledge");
  const filenames = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) =>
      entry.isFile()
      && (
        entry.name.endsWith(".md")
        || entry.name === "course-corpus-conversion-report.json"
      ))
    .map(({ name }) => name)
    .sort(compareCodePoints);
  return Promise.all(filenames.map(async (filename) => {
    const absolutePath = path.join(directory, filename);
    const realFile = await validatedRealFile(workspaceRoot, directory, absolutePath);
    return {
      path: normalizePath(path.relative(workspaceRoot, absolutePath)),
      text: await readFile(realFile, "utf8"),
    };
  }));
}

async function loadSourceTextEntries(
  workspaceRoot: string,
  items: readonly KnowledgeItem[],
) {
  const courseRoot = path.join(workspaceRoot, "data", "courses");
  const sourcePaths = [...new Set(items.flatMap((item) => {
    const sourceDocument = item.source.localDocument
      ? normalizePath(item.source.localDocument)
      : null;
    return sourceDocument?.startsWith("data/courses/") ? [sourceDocument] : [];
  }))].sort(compareCodePoints);
  return Promise.all(sourcePaths.map(async (sourcePath) => {
    const absolutePath = path.resolve(workspaceRoot, sourcePath);
    const realFile = await validatedRealFile(workspaceRoot, courseRoot, absolutePath);
    return {
      path: sourcePath,
      text: await readFile(realFile, "utf8"),
    };
  }));
}

function gitOutput(workspaceRoot: string, args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd: workspaceRoot, encoding: "utf8", windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`RETRIEVAL_SNAPSHOT_GIT_ERROR:${stderr.trim() || error.message}`));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

async function verifyCorpusSnapshot(
  workspaceRoot: string,
  suite: RetrievalGoldenSuite,
  manifestBytes: Buffer,
  knowledge: readonly KnowledgeItem[],
) {
  const snapshot = suite.corpusSnapshot;
  const manifest = CoursePngManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  if (manifestSha256 !== snapshot.assetManifestSha256) {
    throw new Error("RETRIEVAL_ASSET_MANIFEST_BYTES_DRIFT");
  }
  if (manifest.assetCount !== snapshot.assetCount) {
    throw new Error("RETRIEVAL_ASSET_COUNT_DRIFT");
  }
  const actualManifest = await buildCoursePngManifest({ workspaceRoot });
  if (serializeCoursePngManifest(actualManifest) !== serializeCoursePngManifest(manifest)) {
    throw new Error("RETRIEVAL_COURSE_PNG_DRIFT");
  }

  const knowledgeEntries = await loadKnowledgeTextEntries(workspaceRoot);
  const knowledgeCorpusSha256 = canonicalTextEntriesSha256(knowledgeEntries);
  const knowledgeMarkdownCount = knowledgeEntries.filter(({ path: entryPath }) =>
    entryPath.endsWith(".md")).length;
  if (
    knowledgeMarkdownCount !== snapshot.runtimeKnowledgeCount
    || knowledge.length !== snapshot.runtimeKnowledgeCount
    || knowledgeCorpusSha256 !== snapshot.knowledgeCorpusSha256
  ) {
    throw new Error("RETRIEVAL_KNOWLEDGE_CORPUS_DRIFT");
  }
  const sourceEntries = await loadSourceTextEntries(workspaceRoot, knowledge);
  const sourceCorpusSha256 = canonicalTextEntriesSha256(sourceEntries);
  if (
    sourceEntries.length !== snapshot.sourceDocumentCount
    || sourceCorpusSha256 !== snapshot.sourceCorpusSha256
  ) {
    throw new Error("RETRIEVAL_SOURCE_CORPUS_DRIFT");
  }

  const conversionReport = JSON.parse(
    await readFile(path.join(workspaceRoot, "data", "knowledge", "course-corpus-conversion-report.json"), "utf8"),
  ) as { managedFiles?: unknown };
  const knowledgeFilenames = new Set(
    knowledgeEntries
      .filter(({ path: entryPath }) => entryPath.endsWith(".md"))
      .map(({ path: entryPath }) => path.posix.basename(entryPath)),
  );
  if (
    !Array.isArray(conversionReport.managedFiles)
    || conversionReport.managedFiles.some((filename) =>
      typeof filename !== "string"
      || !filename.endsWith(".md")
      || !knowledgeFilenames.has(filename))
    || new Set(conversionReport.managedFiles).size !== conversionReport.managedFiles.length
    || conversionReport.managedFiles.length !== snapshot.generatedKnowledgeCount
    || snapshot.runtimeKnowledgeCount - conversionReport.managedFiles.length
      !== snapshot.baselineKnowledgeCount
  ) {
    throw new Error("RETRIEVAL_KNOWLEDGE_PARTITION_DRIFT");
  }

  const commit = await gitOutput(workspaceRoot, ["rev-parse", `${snapshot.commit}^{commit}`]);
  if (commit !== snapshot.commit) throw new Error("RETRIEVAL_CORPUS_COMMIT_DRIFT");
  const [knowledgeTree, coursesTree] = await Promise.all([
    gitOutput(workspaceRoot, ["rev-parse", `${snapshot.commit}:data/knowledge`]),
    gitOutput(workspaceRoot, ["rev-parse", `${snapshot.commit}:data/courses`]),
  ]);
  if (knowledgeTree !== snapshot.knowledgeTree || coursesTree !== snapshot.coursesTree) {
    throw new Error("RETRIEVAL_CORPUS_TREE_DRIFT");
  }
  await gitOutput(workspaceRoot, ["merge-base", "--is-ancestor", snapshot.commit, "HEAD"]);

  return {
    commit,
    knowledgeTree,
    coursesTree,
    runtimeKnowledgeCount: knowledge.length,
    generatedKnowledgeCount: snapshot.generatedKnowledgeCount,
    baselineKnowledgeCount: snapshot.baselineKnowledgeCount,
    knowledgeCorpusSha256,
    sourceDocumentCount: sourceEntries.length,
    sourceCorpusSha256,
    assetCount: actualManifest.assetCount,
    assetTotalBytes: actualManifest.totalBytes,
    assetManifestSha256: manifestSha256,
  };
}

function unsupportedResult(
  caseId: string,
  startedAt: number,
): RetrievalEvaluationResult {
  return RetrievalEvaluationResultSchema.parse({
    caseId,
    status: "UNSUPPORTED",
    channel: "CAPTION_LEXICAL",
    unsupportedReason: "INPUT_MODALITY_UNSUPPORTED",
    hits: [],
    parentLocators: [],
    latencyMs: performance.now() - startedAt,
    degradedFrom: null,
    degradationSucceeded: null,
  });
}

function scopeKnowledge(
  knowledge: readonly KnowledgeItem[],
  coursePackId: CoursePackId | null,
) {
  return coursePackId === null
    ? knowledge
    : knowledge.filter((item) => sourceCoursePackId(item) === coursePackId);
}

function scopeCaptions(
  captions: ReadonlyMap<string, AssetCaptionRecord>,
  coursePackId: CoursePackId | null,
) {
  return [...captions.values()]
    .filter((caption) =>
      coursePackId === null || caption.sourceCoursePackId === coursePackId)
    .sort((left, right) => compareCodePoints(left.assetPath, right.assetPath));
}

export type FrozenCaptionAssetBindingV2 = {
  assetId: string;
  objectId: string;
  imageNodeId: string;
};

export async function createFrozenCaptionLexicalFallbackProviderV2(input: {
  workspaceRoot: string;
  corpusBundleHash: string;
  assetManifestPath: string;
  assetBindingsByPath: ReadonlyMap<string, FrozenCaptionAssetBindingV2>;
  identity: {
    corpusBundleHash: string;
    activeIndexBundleHash: string;
    indexVersionId: string;
    configHash: string;
    payloadHashes: string[];
  };
}): Promise<RetrievalChannelProviderV2> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const manifestBytes = await readFile(path.resolve(workspaceRoot, input.assetManifestPath));
  const manifest = CoursePngManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const knowledge = await loadKnowledgeDirectory(path.join(workspaceRoot, "data", "knowledge"));
  const captions = await assetCaptionsForKnowledge(
    workspaceRoot,
    knowledge,
    new Set(manifest.assets.map(({ path: assetPath }) => assetPath)),
  );
  const identity = LexicalChannelIdentityV2Schema.parse(input.identity);
  if (
    identity.corpusBundleHash !== input.corpusBundleHash
    || input.assetBindingsByPath.size !== captions.size
    || [...captions.keys()].some((assetPath) => !input.assetBindingsByPath.has(assetPath))
  ) {
    throw new Error("CAPTION_FALLBACK_CORPUS_BINDING_DRIFT");
  }
  return {
    async retrieve(query, { signal }) {
      const startedAt = performance.now();
      if (
        signal?.aborted
        || query.mode !== "TEXT_TO_IMAGE"
        || query.scope.corpusBundleHash !== input.corpusBundleHash
      ) {
        return CaptionLexicalFallbackResultV2Schema.parse({
          summary: {
            channel: "LEXICAL",
            status: signal?.aborted ? "TIMEOUT" : "ERROR",
            reason: signal?.aborted ? "REQUEST_ABORTED" : "SCOPE_VIOLATION",
            corpusBundleHash: input.corpusBundleHash,
            identity: null,
            hitCount: 0,
            timingMs: performance.now() - startedAt,
          },
          hits: [],
        });
      }
      const candidates = scopeCaptions(
        captions,
        query.scope.sourceCoursePack?.id ?? null,
      );
      const byCaptionId = new Map(candidates.map((record) => [record.captionItem.id, record]));
      const ranked = rankKnowledge(
        query.originalText,
        candidates.map(({ captionItem }) => captionItem),
      );
      const hits = ranked.map((caption, index) => {
        const record = byCaptionId.get(caption.id);
        if (!record) throw new Error(`COURSE_ASSET_CAPTION_ID_MISSING:${caption.id}`);
        const binding = input.assetBindingsByPath.get(record.assetPath);
        if (!binding) throw new Error(`CAPTION_FALLBACK_ASSET_BINDING_MISSING:${record.assetPath}`);
        return {
          candidateId: binding.assetId,
          objectId: binding.objectId,
          representationId: null,
          nodeId: binding.imageNodeId,
          assetId: binding.assetId,
          region: null,
          rank: index + 1,
          rawScore: caption.score,
        };
      });
      return CaptionLexicalFallbackResultV2Schema.parse({
        summary: {
          channel: "LEXICAL",
          status: hits.length > 0 ? "SUCCESS" : "EMPTY",
          reason: null,
          corpusBundleHash: input.corpusBundleHash,
          identity: {
            activeIndexBundleHash: identity.activeIndexBundleHash,
            providerIndexBundleHash: null,
            indexVersionId: identity.indexVersionId,
            modelId: null,
            modelRevision: null,
            configHash: identity.configHash,
            payloadHashes: identity.payloadHashes,
          },
          hitCount: hits.length,
          timingMs: performance.now() - startedAt,
        },
        hits,
      });
    },
  };
}

export async function evaluateCaptionLexicalBaseline(options: EvaluateOptions = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const suitePath = path.resolve(
    options.suitePath
      ?? path.join(workspaceRoot, "tests", "retrieval-quality", "golden-suite.json"),
  );
  const suiteBytes = await readFile(suitePath);
  const suite = RetrievalGoldenSuiteSchema.parse(JSON.parse(suiteBytes.toString("utf8")));
  const manifestPath = path.join(workspaceRoot, suite.corpusSnapshot.assetManifest);
  const manifestBytes = await readFile(manifestPath);
  const manifest = CoursePngManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const assetPaths = new Set(manifest.assets.map(({ path: assetPath }) => assetPath));
  const knowledgeDirectory = path.join(workspaceRoot, "data", "knowledge");
  const knowledge = await loadKnowledgeDirectory(knowledgeDirectory);
  const snapshot = await verifyCorpusSnapshot(
    workspaceRoot,
    suite,
    manifestBytes,
    knowledge,
  );
  const captions = await assetCaptionsForKnowledge(workspaceRoot, knowledge, assetPaths);
  await validateSuiteBindings(workspaceRoot, suite, manifest, knowledge, captions);

  const results: RetrievalEvaluationResult[] = [];
  for (const testCase of suite.cases) {
    const startedAt = performance.now();
    if (
      testCase.mode === "IMAGE_TO_IMAGE"
      || testCase.mode === "IMAGE_TEXT_TO_EVIDENCE"
    ) {
      results.push(unsupportedResult(testCase.id, startedAt));
      continue;
    }

    if (testCase.mode === "TEXT_TO_IMAGE") {
      const candidates = scopeCaptions(captions, testCase.query.coursePackId);
      const byCaptionId = new Map(candidates.map((record) => [record.captionItem.id, record]));
      const rankedCaptions = rankKnowledge(
        testCase.query.text ?? "",
        candidates.map(({ captionItem }) => captionItem),
      );
      const rankedRecords = rankedCaptions.map((caption) => {
        const record = byCaptionId.get(caption.id);
        if (!record) throw new Error(`COURSE_ASSET_CAPTION_ID_MISSING:${caption.id}`);
        return { record, score: caption.score };
      });
      const assetHits = rankedRecords.map(({ record, score }, index) => ({
        kind: "ASSET" as const,
        key: record.assetPath,
        rank: index + 1,
        score,
      }));
      results.push(RetrievalEvaluationResultSchema.parse({
        caseId: testCase.id,
        status: assetHits.length > 0 ? "SUCCESS" : "EMPTY",
        channel: "CAPTION_LEXICAL",
        hits: assetHits,
        parentLocators: captionParentLocators(rankedRecords.map(({ record }) => record)),
        latencyMs: performance.now() - startedAt,
        degradedFrom: null,
        degradationSucceeded: null,
      }));
      continue;
    }

    const scopedKnowledge = scopeKnowledge(knowledge, testCase.query.coursePackId);
    const ranked = rankKnowledge(testCase.query.text ?? "", scopedKnowledge);
    const nodeHits = ranked.map((item, index) => ({
      kind: "NODE" as const,
      key: item.id,
      rank: index + 1,
      score: item.score,
    }));
    results.push(RetrievalEvaluationResultSchema.parse({
      caseId: testCase.id,
      status: nodeHits.length > 0 ? "SUCCESS" : "EMPTY",
      channel: "LEXICAL",
      hits: nodeHits,
      parentLocators: parentLocators(ranked),
      latencyMs: performance.now() - startedAt,
      degradedFrom: null,
      degradationSucceeded: null,
    }));
  }

  const scores = suite.cases.map((testCase, index) =>
    scoreRetrievalCase(testCase, results[index]!));
  const mappingCounts = [...captions.values()].reduce<Record<string, number>>((counts, caption) => {
    counts[caption.mappingMethod] = (counts[caption.mappingMethod] ?? 0) + 1;
    return counts;
  }, {});
  return {
    schemaVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    baseline: "LEXICAL_CAPTION" as const,
    suiteVersion: suite.suiteVersion,
    suiteHash: createHash("sha256").update(suiteBytes).digest("hex"),
    snapshot,
    captionIndex: {
      assetCount: captions.size,
      mappingCounts,
      digest: createHash("sha256").update(
        [...captions.values()]
          .sort((left, right) =>
            compareCodePoints(left.sourceDocument, right.sourceDocument)
            || left.frontmatterOrdinal - right.frontmatterOrdinal)
          .map((caption) => [
            caption.assetPath,
            caption.sourceDocument,
            caption.frontmatterOrdinal,
            caption.mappingMethod,
            caption.headingPath.join(">"),
            caption.captionSha256,
          ].join("\0"))
          .join("\n"),
      ).digest("hex"),
    },
    sources: {
      knowledgeDirectory: normalizePath(path.relative(workspaceRoot, knowledgeDirectory)),
      coursesDirectory: "data/courses",
      assetManifest: suite.corpusSnapshot.assetManifest,
      database: "NOT_USED",
      queryScopeInput: "query.coursePackId",
      expectedCourseFieldsUsedForRetrieval: false,
    },
    results,
    scores,
    summary: summarizeRetrievalScores(scores),
  };
}

export function parseRetrievalQualityArguments(argv: readonly string[]) {
  let index = 0;
  if (argv[0] === "--") index = 1;
  let suitePath: string | undefined;
  let outputPath: string | undefined;
  const seen = new Set<string>();
  while (index < argv.length) {
    const argument = argv[index];
    if (argument !== "--suite" && argument !== "--output") {
      throw new Error(`unknown argument: ${argument}`);
    }
    if (seen.has(argument)) throw new Error(`duplicate argument: ${argument}`);
    seen.add(argument);
    const value = argv[index + 1];
    if (!value || value === "--" || value.startsWith("--")) {
      throw new Error(`missing value for argument: ${argument}`);
    }
    if (argument === "--suite") suitePath = value;
    else outputPath = value;
    index += 2;
  }
  return { suitePath, outputPath };
}

export async function runRetrievalQualityCli(argv = process.argv.slice(2)) {
  const { suitePath, outputPath } = parseRetrievalQualityArguments(argv);
  const workspaceRoot = process.cwd();
  const report = await evaluateCaptionLexicalBaseline({
    workspaceRoot,
    ...(suitePath ? { suitePath: path.resolve(suitePath) } : {}),
  });
  const resolvedOutput = path.resolve(
    outputPath
      ?? path.join(workspaceRoot, ".runtime", "retrieval-quality", "t0-caption-lexical-baseline.json"),
  );
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stderr.write(`${JSON.stringify({
    event: "effective-knowledge-source",
    ...report.sources,
    suitePath: normalizePath(path.relative(workspaceRoot, suitePath
      ? path.resolve(suitePath)
      : path.join(workspaceRoot, "tests", "retrieval-quality", "golden-suite.json"))),
    corpusSnapshot: report.snapshot,
    baseline: report.baseline,
  })}\n`);
  return {
    reportPath: normalizePath(path.relative(workspaceRoot, resolvedOutput)),
    suiteHash: report.suiteHash,
    snapshot: report.snapshot,
    captionIndex: report.captionIndex,
    summary: report.summary,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  runRetrievalQualityCli()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

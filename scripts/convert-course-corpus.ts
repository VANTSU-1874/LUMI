import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ZodError } from "zod";

import {
  knowledgeDefaultActionId,
  KnowledgeItemSchema,
  knowledgeStatementPrefix,
  parseKnowledgeMarkdown,
  type KnowledgeAuthority,
  type KnowledgeItem,
  type KnowledgeTopic,
} from "@/lib/knowledge/retrieve";

const SOURCE_FILENAME_PATTERN = /^(\d{3})-([a-z0-9][a-z0-9-]*)\.md$/;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'）)\]，。；;]+/gi;
const DEFAULT_VERIFIED_DATE = "2026-07-27";
const REPORT_FILENAME = "course-corpus-conversion-report.json";

const REQUIRED_SCALAR_FIELDS = [
  "课程标签",
  "内容类型",
  "标题",
  "来源出处",
  "来源类别",
  "可信度",
  "事实边界",
] as const;
const REQUIRED_LIST_FIELDS = ["适用问题", "关键词"] as const;
const OPTIONAL_LIST_FIELDS = ["配图"] as const;
const ALLOWED_FIELDS = new Set<string>([
  ...REQUIRED_SCALAR_FIELDS,
  ...REQUIRED_LIST_FIELDS,
  ...OPTIONAL_LIST_FIELDS,
]);
const REQUIRED_SECTIONS = [
  "核心内容",
  "导师可先追问",
  "提示与局部示范",
  "常见误区与证据",
  "使用边界",
  "术语待议",
] as const;

const COURSE_CONFIG = {
  "digital-interaction-creative-design": {
    label: "数字交互文创设计",
    shortName: "dicd",
  },
  "layout-design": {
    label: "版式设计",
    shortName: "layout",
  },
  "brand-vi-design": {
    label: "品牌与 VI 设计",
    shortName: "brandvi",
  },
  "digital-graphics-illustrator": {
    label: "数字图形（Illustrator）",
    shortName: "illustrator",
  },
  "book-design": {
    label: "书籍设计",
    shortName: "book",
  },
} as const;

type CourseDirectory = keyof typeof COURSE_CONFIG;
type SourceMetadata = {
  courseLabel: string;
  contentType: "学理内容" | "软件工作流";
  title: string;
  sourceLabel: string;
  sourceCategory: string;
  confidence: "官方事实" | "教师经验";
  scope: string;
  applicableQuestions: string[];
  tags: string[];
  images: string[];
};

export type CourseCorpusWarning =
  | {
      kind: "VERIFIED_DATE_FALLBACK";
      sourcePath: string;
      verifiedDate: string;
    }
  | {
      kind: "SCOPE_TRUNCATED";
      sourcePath: string;
      originalLength: number;
      retainedLength: number;
    }
  | {
      kind: "EXTRA_URLS_REMOVED";
      sourcePath: string;
      retainedUrl: string;
      removedUrls: string[];
    };

export type CourseCorpusArtifact = {
  sourcePath: string;
  outputFilename: string;
  item: KnowledgeItem;
  markdown: string;
  warnings: CourseCorpusWarning[];
};

export type CourseCorpusConversionReport = {
  version: 1;
  verifiedDate: string;
  sourceCount: number;
  generatedCount: number;
  generatedIds: string[];
  managedFiles: string[];
  warnings: CourseCorpusWarning[];
};

type ConvertOptions = {
  workspaceRoot?: string;
  coursesDirectory?: string;
  knowledgeDirectory?: string;
};

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/");
}

function relativeToWorkspace(absolutePath: string, workspaceRoot = process.cwd()) {
  return normalizePath(path.relative(workspaceRoot, absolutePath));
}

function parseScalar(raw: string, sourcePath: string, field: string) {
  const value = raw.trim();
  if (!value) throw new Error(`${sourcePath}: ${field} must not be empty`);
  if (value.startsWith("\"")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== "string") throw new Error("not a string");
      return parsed;
    } catch {
      throw new Error(`${sourcePath}: ${field} contains invalid quoted text`);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function parseSourceMetadata(frontmatter: string, sourcePath: string): SourceMetadata {
  const values = new Map<string, string | string[]>();
  let currentListKey: string | null = null;

  for (const rawLine of frontmatter.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const listItem = /^\s+-\s+(.+?)\s*$/.exec(rawLine);
    if (listItem) {
      if (!currentListKey) throw new Error(`${sourcePath}: list item has no field`);
      const current = values.get(currentListKey);
      if (!Array.isArray(current)) throw new Error(`${sourcePath}: ${currentListKey} is not a list`);
      current.push(parseScalar(listItem[1], sourcePath, currentListKey));
      continue;
    }

    const field = /^([^:]+):\s*(.*?)\s*$/.exec(rawLine);
    if (!field) throw new Error(`${sourcePath}: malformed frontmatter line: ${rawLine}`);
    const key = field[1].trim();
    if (!ALLOWED_FIELDS.has(key)) throw new Error(`${sourcePath}: unknown frontmatter field ${key}`);
    if (values.has(key)) throw new Error(`${sourcePath}: duplicate frontmatter field ${key}`);
    if (field[2]) {
      values.set(key, parseScalar(field[2], sourcePath, key));
      currentListKey = null;
    } else {
      values.set(key, []);
      currentListKey = key;
    }
  }

  const scalar = (field: (typeof REQUIRED_SCALAR_FIELDS)[number]) => {
    const value = values.get(field);
    if (typeof value !== "string") throw new Error(`${sourcePath}: missing scalar field ${field}`);
    return value;
  };
  const list = (field: (typeof REQUIRED_LIST_FIELDS)[number] | (typeof OPTIONAL_LIST_FIELDS)[number]) => {
    const value = values.get(field);
    if (value === undefined && field === "配图") return [];
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`${sourcePath}: missing non-empty list field ${field}`);
    }
    return value;
  };

  const contentType = scalar("内容类型");
  if (contentType !== "学理内容" && contentType !== "软件工作流") {
    throw new Error(`${sourcePath}: 内容类型 must be 学理内容 or 软件工作流`);
  }
  const confidence = scalar("可信度");
  if (confidence !== "官方事实" && confidence !== "教师经验") {
    throw new Error(`${sourcePath}: 可信度 must be 官方事实 or 教师经验`);
  }

  return {
    courseLabel: scalar("课程标签"),
    contentType,
    title: scalar("标题"),
    sourceLabel: scalar("来源出处"),
    sourceCategory: scalar("来源类别"),
    confidence,
    scope: scalar("事实边界"),
    applicableQuestions: list("适用问题"),
    tags: list("关键词"),
    images: list("配图"),
  };
}

function parseSections(body: string, sourcePath: string) {
  const headings = [...body.matchAll(/^##\s+(.+?)\s*$/gm)];
  const sections = new Map<string, string>();
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const title = heading[1].trim();
    if (sections.has(title)) throw new Error(`${sourcePath}: duplicate section ${title}`);
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? body.length;
    sections.set(title, body.slice(start, end).trim());
  }
  for (const title of REQUIRED_SECTIONS) {
    if (!sections.get(title)) throw new Error(`${sourcePath}: missing section ${title}`);
  }
  return sections;
}

function listOrParagraphs(section: string) {
  const listItems = section
    .split(/\r?\n/)
    .map((line) => /^\s*-\s+(.+?)\s*$/.exec(line)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
  if (listItems.length > 0) return listItems;
  return section
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s*\r?\n\s*/g, " ").trim())
    .filter(Boolean);
}

function authorityFor(metadata: SourceMetadata): KnowledgeAuthority {
  if (/匿名.*学生|匿名学生作品/.test(metadata.sourceCategory)) return "ANONYMIZED_CASE";
  if (metadata.sourceCategory === "旧课程设计文档") return "COURSE_DESIGN";
  if (metadata.confidence === "官方事实") return "OFFICIAL";
  return "TEACHER_EXPERIENCE";
}

function topicFor(courseDirectory: CourseDirectory, sequence: number): KnowledgeTopic {
  if (courseDirectory === "digital-interaction-creative-design") {
    if (sequence === 1 || sequence === 3) return "DIGISHOW_SIGNALS";
    if (sequence === 2 || sequence === 4) return "COURSE_PRINCIPLES";
  }
  if (courseDirectory === "layout-design") {
    if (sequence === 1 || (sequence >= 10 && sequence <= 23) || sequence === 40 || sequence === 50 || sequence === 51) {
      return "LAYOUT_DESIGN_PRINCIPLES";
    }
    if (sequence === 2 || (sequence >= 30 && sequence <= 33)) return "TYPOGRAPHY_BASICS";
    if ((sequence >= 41 && sequence <= 43) || (sequence >= 101 && sequence <= 150)) {
      return "LAYOUT_EVIDENCE";
    }
  }
  if (courseDirectory === "brand-vi-design" && sequence >= 1 && sequence <= 2) {
    return "BRAND_IDENTITY";
  }
  if (courseDirectory === "digital-graphics-illustrator" && sequence === 1) {
    return "DESIGN_FOUNDATIONS";
  }
  if (courseDirectory === "book-design" && sequence === 1) return "BOOK_DESIGN_PRINCIPLES";
  throw new Error(`${courseDirectory}/${String(sequence).padStart(3, "0")}: no knowledge topic mapping`);
}

function stripUrls(text: string, urls: string[]) {
  return text
    .replace(HTTP_URL_PATTERN, (url) => {
      urls.push(url);
      return "";
    })
    .replace(/[ \t]+([，。；;])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function schemaError(sourcePath: string, error: ZodError) {
  const issues = error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
  return new Error(`${sourcePath}: KnowledgeItemSchema rejected conversion: ${issues}`);
}

function serializeKnowledgeItem(item: KnowledgeItem) {
  const sourceLines = [
    ...(item.source.url ? [`url: ${item.source.url}`] : []),
    ...(item.source.localDocument ? [`localDocument: ${item.source.localDocument}`] : []),
  ];
  return [
    "---",
    `id: ${item.id}`,
    `title: ${item.title}`,
    `topic: ${item.topic}`,
    `authority: ${item.source.authority}`,
    ...sourceLines,
    `verifiedDate: ${item.source.verifiedDate}`,
    `scope: ${item.source.scope}`,
    `tags: ${JSON.stringify(item.tags)}`,
    `facts: ${JSON.stringify(item.facts)}`,
    `actions: ${JSON.stringify(item.actions)}`,
    "---",
    item.content,
    "",
  ].join("\n");
}

export function convertCourseCorpusDocument(input: {
  markdown: string;
  courseDirectory: string;
  filename: string;
  sourceAbsolutePath: string;
  workspaceRoot?: string;
}): CourseCorpusArtifact {
  const normalizedMarkdown = input.markdown.replaceAll("\r\n", "\n");
  if (!(input.courseDirectory in COURSE_CONFIG)) {
    throw new Error(`${input.courseDirectory}/${input.filename}: unsupported course directory`);
  }
  const courseDirectory = input.courseDirectory as CourseDirectory;
  const filenameMatch = SOURCE_FILENAME_PATTERN.exec(input.filename);
  if (!filenameMatch) throw new Error(`${input.courseDirectory}/${input.filename}: invalid numbered filename`);
  const sequence = Number(filenameMatch[1]);
  const sourcePath = relativeToWorkspace(input.sourceAbsolutePath, input.workspaceRoot);
  const documentMatch = FRONTMATTER_PATTERN.exec(normalizedMarkdown);
  if (!documentMatch) throw new Error(`${sourcePath}: invalid course corpus frontmatter`);

  const metadata = parseSourceMetadata(documentMatch[1], sourcePath);
  const config = COURSE_CONFIG[courseDirectory];
  if (metadata.courseLabel !== config.label) {
    throw new Error(`${sourcePath}: 课程标签 ${metadata.courseLabel} does not match ${config.label}`);
  }
  const sections = parseSections(documentMatch[2], sourcePath);
  const topic = topicFor(courseDirectory, sequence);
  const prefix = knowledgeStatementPrefix(topic);
  const defaultActionId = knowledgeDefaultActionId(topic);
  const id = `${config.shortName}-${filenameMatch[1]}-${filenameMatch[2]}`;
  const statementStem = `${config.shortName}-${filenameMatch[1]}`;
  const urls: string[] = [];

  const coreContent = stripUrls(sections.get("核心内容") ?? "", urls);
  const useBoundary = stripUrls(sections.get("使用边界") ?? "", urls);
  const applicableQuestions = metadata.applicableQuestions.map((text) => stripUrls(text, urls));
  const factTexts = listOrParagraphs(sections.get("常见误区与证据") ?? "")
    .map((text) => stripUrls(text, urls));
  const questions = listOrParagraphs(sections.get("导师可先追问") ?? "")
    .map((text) => stripUrls(text, urls));
  const demonstrations = listOrParagraphs(sections.get("提示与局部示范") ?? "")
    .map((text) => stripUrls(text, urls));
  const sourceLabelWithoutUrls = stripUrls(metadata.sourceLabel, urls);
  let scope = stripUrls(metadata.scope, urls);

  const warnings: CourseCorpusWarning[] = [{
    kind: "VERIFIED_DATE_FALLBACK",
    sourcePath,
    verifiedDate: DEFAULT_VERIFIED_DATE,
  }];
  if (scope.length > 300) {
    warnings.push({
      kind: "SCOPE_TRUNCATED",
      sourcePath,
      originalLength: scope.length,
      retainedLength: 300,
    });
    scope = scope.slice(0, 300);
  }
  const uniqueUrls = [...new Set(urls)];
  if (uniqueUrls.length > 1) {
    warnings.push({
      kind: "EXTRA_URLS_REMOVED",
      sourcePath,
      retainedUrl: uniqueUrls[0],
      removedUrls: uniqueUrls.slice(1),
    });
  }
  if (!sourceLabelWithoutUrls && uniqueUrls.length === 0) {
    throw new Error(`${sourcePath}: 来源出处 must retain a label or URL`);
  }
  if (questions.length === 0) throw new Error(`${sourcePath}: 导师可先追问 must provide an action`);

  const rawItem = {
    id,
    title: metadata.title,
    topic,
    tags: [...new Set(metadata.tags)],
    content: [
      coreContent,
      `适用问题：\n${applicableQuestions.map((question) => `- ${question}`).join("\n")}`,
      `使用边界：\n${useBoundary}`,
    ].join("\n\n"),
    facts: factTexts.map((text, index) => ({
      id: `${prefix}${statementStem}-fact-${String(index + 1).padStart(2, "0")}`,
      text,
    })),
    actions: [
      { id: defaultActionId, text: questions[0] },
      ...[...questions.slice(1), ...demonstrations].map((text, index) => ({
        id: `${prefix}${statementStem}-action-${String(index + 1).padStart(2, "0")}`,
        text,
      })),
    ],
    source: {
      ...(uniqueUrls[0] ? { url: uniqueUrls[0] } : {}),
      localDocument: sourcePath,
      authority: authorityFor(metadata),
      verifiedDate: DEFAULT_VERIFIED_DATE,
      scope,
    },
  };

  let item: KnowledgeItem;
  try {
    item = KnowledgeItemSchema.parse(rawItem);
  } catch (error) {
    if (error instanceof ZodError) throw schemaError(sourcePath, error);
    throw error;
  }
  const markdown = serializeKnowledgeItem(item);
  try {
    parseKnowledgeMarkdown(markdown, `${id}.md`);
  } catch (error) {
    throw new Error(`${sourcePath}: serialized knowledge markdown is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    sourcePath,
    outputFilename: `${id}.md`,
    item,
    markdown,
    warnings,
  };
}

async function listSourceDocuments(coursesDirectory: string) {
  const courseDirectories = (await readdir(coursesDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name in COURSE_CONFIG)
    .map((entry) => entry.name as CourseDirectory)
    .sort(compareCodePoints);
  const sources: Array<{ courseDirectory: CourseDirectory; filename: string; absolutePath: string }> = [];
  for (const courseDirectory of courseDirectories) {
    const absoluteDirectory = path.join(coursesDirectory, courseDirectory);
    const filenames = (await readdir(absoluteDirectory))
      .filter((filename) => SOURCE_FILENAME_PATTERN.test(filename))
      .sort(compareCodePoints);
    for (const filename of filenames) {
      sources.push({
        courseDirectory,
        filename,
        absolutePath: path.join(absoluteDirectory, filename),
      });
    }
  }
  return sources;
}

export async function buildCourseCorpusArtifacts(
  options: Pick<ConvertOptions, "workspaceRoot" | "coursesDirectory"> = {},
) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const coursesDirectory = path.resolve(options.coursesDirectory ?? path.join(workspaceRoot, "data", "courses"));
  const sources = await listSourceDocuments(coursesDirectory);
  const artifacts: CourseCorpusArtifact[] = [];
  for (const source of sources) {
    artifacts.push(convertCourseCorpusDocument({
      markdown: await readFile(source.absolutePath, "utf8"),
      courseDirectory: source.courseDirectory,
      filename: source.filename,
      sourceAbsolutePath: source.absolutePath,
      workspaceRoot,
    }));
  }
  const ids = artifacts.map(({ item }) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("course corpus conversion produced duplicate ids");

  const warnings = artifacts.flatMap(({ warnings: artifactWarnings }) => artifactWarnings);
  const report: CourseCorpusConversionReport = {
    version: 1,
    verifiedDate: DEFAULT_VERIFIED_DATE,
    sourceCount: artifacts.length,
    generatedCount: artifacts.length,
    generatedIds: [...ids].sort(compareCodePoints),
    managedFiles: artifacts.map(({ outputFilename }) => outputFilename).sort(compareCodePoints),
    warnings,
  };
  return { artifacts, report };
}

export async function convertCourseCorpus(options: ConvertOptions = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const knowledgeDirectory = path.resolve(options.knowledgeDirectory ?? path.join(workspaceRoot, "data", "knowledge"));
  const { artifacts, report } = await buildCourseCorpusArtifacts({
    workspaceRoot,
    coursesDirectory: options.coursesDirectory,
  });

  await mkdir(knowledgeDirectory, { recursive: true });
  await Promise.all(artifacts.map((artifact) =>
    writeFile(path.join(knowledgeDirectory, artifact.outputFilename), artifact.markdown, "utf8"),
  ));
  await writeFile(
    path.join(knowledgeDirectory, REPORT_FILENAME),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  return report;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  convertCourseCorpus()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

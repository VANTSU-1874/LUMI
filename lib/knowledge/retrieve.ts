import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { redactSensitiveText, studentNumberPolicyFromEnvironment } from "@/lib/security/redaction";

export const MAX_KNOWLEDGE_STATEMENT_LENGTH = 300;

const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol));

export const KnowledgeAuthoritySchema = z.enum([
  "OFFICIAL",
  "COURSE_DESIGN",
  "TEACHER_EXPERIENCE",
  "ANONYMIZED_CASE",
]);

export const KnowledgeSourceSchema = z
  .object({
    url: HttpUrlSchema.optional(),
    localDocument: z.string().trim().min(1).max(500).optional(),
    authority: KnowledgeAuthoritySchema,
    verifiedDate: z.iso.date(),
    scope: z.string().trim().min(1).max(300),
  })
  .strict()
  .refine((source) => Boolean(source.url || source.localDocument), {
    message: "knowledge source requires a URL or local document",
  });

export const KnowledgeTopicSchema = z.enum([
  "DESIGN_FOUNDATIONS",
  "COURSE_PRINCIPLES",
  "DIGISHOW_SIGNALS",
  "TOUCHDESIGNER_FOUNDATIONS",
  "OSC_TROUBLESHOOTING",
  "BOOK_DESIGN_PRINCIPLES",
  "INFORMATION_HIERARCHY",
  "LAYOUT_EVIDENCE",
]);

const TOPIC_STATEMENT_PREFIX = {
  DESIGN_FOUNDATIONS: "design-",
  COURSE_PRINCIPLES: "course-",
  DIGISHOW_SIGNALS: "digishow-",
  TOUCHDESIGNER_FOUNDATIONS: "td-",
  OSC_TROUBLESHOOTING: "osc-",
  BOOK_DESIGN_PRINCIPLES: "book-",
  INFORMATION_HIERARCHY: "hierarchy-",
  LAYOUT_EVIDENCE: "layout-",
} as const;

const TOPIC_DEFAULT_ACTION = {
  DESIGN_FOUNDATIONS: "design-clarify-goal",
  COURSE_PRINCIPLES: "course-clarify-intent",
  DIGISHOW_SIGNALS: "digishow-identify-signal",
  TOUCHDESIGNER_FOUNDATIONS: "td-observe-upstream",
  OSC_TROUBLESHOOTING: "osc-check-receiver",
  BOOK_DESIGN_PRINCIPLES: "book-clarify-audience",
  INFORMATION_HIERARCHY: "hierarchy-sort-content",
  LAYOUT_EVIDENCE: "layout-compare-reading-path",
} as const;

const KnowledgeStatementSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    text: z
      .string()
      .trim()
      .min(1)
      .max(MAX_KNOWLEDGE_STATEMENT_LENGTH)
      .refine((text) => !/https?:\/\//i.test(text), {
        message: "knowledge statements must use the registered source",
      }),
  })
  .strict();

export const KnowledgeItemSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    title: z.string().trim().min(1).max(160),
    topic: KnowledgeTopicSchema,
    tags: z.array(z.string().trim().min(1).max(50)).min(1).max(20),
    content: z
      .string()
      .trim()
      .min(1)
      .max(8_000)
      .refine((content) => !/https?:\/\//i.test(content), {
        message: "knowledge content must be attributable to its registered source",
      }),
    facts: z.array(KnowledgeStatementSchema).min(1).max(12),
    actions: z.array(KnowledgeStatementSchema).min(1).max(12),
    source: KnowledgeSourceSchema,
  })
  .strict()
  .superRefine((item, context) => {
    const statementIds = [...item.facts, ...item.actions].map(({ id }) => id);
    if (new Set(statementIds).size !== statementIds.length) {
      context.addIssue({ code: "custom", message: "knowledge statement IDs must be unique" });
    }
    const prefix = TOPIC_STATEMENT_PREFIX[item.topic];
    if (statementIds.some((id) => !id.startsWith(prefix))) {
      context.addIssue({
        code: "custom",
        message: "knowledge statement IDs must belong to the declared topic",
      });
    }
    if (!item.actions.some(({ id }) => id === TOPIC_DEFAULT_ACTION[item.topic])) {
      context.addIssue({
        code: "custom",
        message: "knowledge actions must include the topic default action",
      });
    }
  });

export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;
export type KnowledgeTopic = z.infer<typeof KnowledgeTopicSchema>;
export type KnowledgeAuthority = z.infer<typeof KnowledgeAuthoritySchema>;
export type KnowledgeRetrievalMetadata = {
  method: "LEXICAL" | "SEMANTIC" | "HYBRID";
  confidence: number;
  lexicalScore: number;
  semanticScore: number | null;
};
export type RankedKnowledgeItem = KnowledgeItem & {
  score: number;
  matchedTokens: string[];
  retrieval?: KnowledgeRetrievalMetadata;
};

const MAX_RESULTS = 5;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/;

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizedTokens(value: string) {
  const normalized = value.normalize("NFKC").toLowerCase();
  const latin = (normalized.match(/[a-z0-9][a-z0-9._+-]*/g) ?? []).filter(
    (token) => token.length >= 2,
  );
  const chineseRuns = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const chinese = chineseRuns.flatMap((run) => {
    const characters = Array.from(run);
    const grams: string[] = [];
    for (let size = 2; size <= Math.min(4, characters.length); size += 1) {
      for (let index = 0; index <= characters.length - size; index += 1) {
        grams.push(characters.slice(index, index + size).join(""));
      }
    }
    return grams;
  });
  return Array.from(new Set([...latin, ...chinese]));
}

export const MIN_RELEVANCE_SCORE = 12;
export const RELAXED_MIN_RELEVANCE_SCORE = 6;

function weightedMatches(queryTokens: readonly string[], value: string, weight: number) {
  const valueTokens = new Set(normalizedTokens(value));
  const matched = queryTokens.filter((token) => valueTokens.has(token));
  const score = matched.reduce(
    (total, token) => total + Math.min(Array.from(token).length, 4) * weight,
    0,
  );
  return { score, matched };
}

export function scoreKnowledgeLexically(
  query: string,
  items: readonly KnowledgeItem[],
): RankedKnowledgeItem[] {
  const queryTokens = normalizedTokens(query.trim());
  if (queryTokens.length === 0 || items.length === 0) return [];

  return items
    .map((rawItem) => {
      const item = KnowledgeItemSchema.parse(rawItem);
      const fields = [
        weightedMatches(queryTokens, item.title, 5),
        weightedMatches(queryTokens, item.tags.join(" "), 8),
        weightedMatches(
          queryTokens,
          [...item.facts, ...item.actions].map(({ text }) => text).join(" "),
          4,
        ),
        weightedMatches(queryTokens, item.content, 1),
      ];
      const score = fields.reduce((total, field) => total + field.score, 0);
      const matchedTokens = Array.from(new Set(fields.flatMap(({ matched }) => matched))).sort(
        compareCodePoints,
      );
      return { ...item, score, matchedTokens };
    });
}

export function rankKnowledge(
  query: string,
  items: readonly KnowledgeItem[],
  options: { minScore?: number; maxResults?: number } = {},
): RankedKnowledgeItem[] {
  const minScore = options.minScore ?? MIN_RELEVANCE_SCORE;
  const maxResults = options.maxResults ?? MAX_RESULTS;
  return scoreKnowledgeLexically(query, items)
    .filter(({ score }) => score >= minScore)
    .map((item) => ({
      ...item,
      retrieval: {
        method: "LEXICAL" as const,
        confidence: Math.round(Math.min(item.score / 48, 1) * 1_000) / 1_000,
        lexicalScore: item.score,
        semanticScore: null,
      },
    }))
    .sort((left, right) => right.score - left.score || compareCodePoints(left.id, right.id))
    .slice(0, maxResults);
}

function parseMetadata(frontmatter: string) {
  const metadata: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error("knowledge metadata is malformed");
    const key = line.slice(0, separator).trim();
    if (key in metadata) throw new Error(`duplicate knowledge metadata: ${key}`);
    metadata[key] = line.slice(separator + 1).trim();
  }
  const allowed = new Set([
    "id",
    "title",
    "topic",
    "authority",
    "url",
    "localDocument",
    "verifiedDate",
    "scope",
    "tags",
    "facts",
    "actions",
  ]);
  if (Object.keys(metadata).some((key) => !allowed.has(key))) {
    throw new Error("knowledge metadata contains an unknown field");
  }
  return metadata;
}

export function parseKnowledgeMarkdown(markdown: string, filename = "knowledge.md") {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) throw new Error(`invalid knowledge markdown: ${filename}`);
  const metadata = parseMetadata(match[1]);
  let tags: unknown;
  let facts: unknown;
  let actions: unknown;
  try {
    tags = JSON.parse(metadata.tags ?? "");
    facts = JSON.parse(metadata.facts ?? "");
    actions = JSON.parse(metadata.actions ?? "");
  } catch {
    throw new Error(`invalid knowledge tags: ${filename}`);
  }

  const parsed = KnowledgeItemSchema.parse({
    id: metadata.id,
    title: metadata.title,
    topic: metadata.topic,
    tags,
    content: match[2],
    facts,
    actions,
    source: {
      ...(metadata.url ? { url: metadata.url } : {}),
      ...(metadata.localDocument ? { localDocument: metadata.localDocument } : {}),
      authority: metadata.authority,
      verifiedDate: metadata.verifiedDate,
      scope: metadata.scope,
    },
  });
  const studentNumber = studentNumberPolicyFromEnvironment();
  const protect = (value: string) => redactSensitiveText(value, { studentNumber });
  return KnowledgeItemSchema.parse({
    ...parsed,
    title: protect(parsed.title),
    tags: parsed.tags.map(protect),
    content: protect(parsed.content),
    facts: parsed.facts.map((fact) => ({ ...fact, text: protect(fact.text) })),
    actions: parsed.actions.map((action) => ({ ...action, text: protect(action.text) })),
    source: { ...parsed.source, scope: protect(parsed.source.scope) },
  });
}

export async function loadKnowledgeDirectory(directory: string) {
  const filenames = (await readdir(directory))
    .filter((filename) => filename.endsWith(".md"))
    .sort(compareCodePoints);
  const items = await Promise.all(
    filenames.map(async (filename) =>
      parseKnowledgeMarkdown(await readFile(path.join(directory, filename), "utf8"), filename),
    ),
  );
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`duplicate knowledge id: ${item.id}`);
    ids.add(item.id);
  }
  return items;
}

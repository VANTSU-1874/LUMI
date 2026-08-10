import { createHash } from "node:crypto";

import { z } from "zod";

import {
  CoursePackReferenceV2Schema,
  KnowledgeObjectV2Schema,
  type KnowledgeNodeV2,
  type KnowledgeObjectV2,
} from "./knowledge-object-v2";

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HashSchema = z.string().regex(HASH);
const IdSchema = z.string().regex(ID);

export const TECHNICAL_ANCHOR_ALGORITHM_V2 = Object.freeze({
  id: "lumi-explicit-technical-anchor-v2",
  version: "1.9.0",
  unicode: "NFKC",
  caseFold: "LOWERCASE_AFTER_SHAPE_CLASSIFICATION",
  segment:
    "ONE_TO_SIX_ASCII_BOUNDARY_WORDS_WITH_OPTIONAL_DOT_PLUS_HASH_SLASH_HYPHEN",
  acceptedShapes: Object.freeze([
    "MULTI_WORD",
    "UPPERCASE_ACRONYM",
    "INTERNAL_CAMEL_CASE",
    "TECHNICAL_PUNCTUATION",
  ] as const),
  coverageSource: Object.freeze([
    "OBJECT_TITLE",
    "OBJECT_TAG",
    "NODE_TITLE",
    "NODE_TEXT",
  ] as const),
  supportVariants: "CONTIGUOUS_MULTI_WORD_AND_SHAPED_SINGLE_TOKENS",
  queryDecision:
    "NAME_SHAPED_SEGMENTS_WITH_EXPLICIT_CONVERSATIONAL_PREFIX_TRIMMING_AND_EXACT_SEGMENT_COVERAGE",
  conversationalLeadTokens: Object.freeze([
    "can",
    "check",
    "could",
    "explain",
    "help",
    "how",
    "i",
    "open",
    "please",
    "run",
    "select",
    "should",
    "show",
    "tell",
    "try",
    "use",
    "we",
    "what",
    "when",
    "where",
    "why",
    "would",
    "you",
  ] as const),
  conversationalTrailingTokens: Object.freeze([
    "again",
    "first",
    "for",
    "here",
    "it",
    "me",
    "mean",
    "means",
    "next",
    "now",
    "please",
    "setting",
    "settings",
    "there",
    "today",
    "use",
    "used",
    "using",
    "work",
    "works",
  ] as const),
  suppressedStandaloneAnchors: Object.freeze([
    "esc",
    "gpu",
    "pdf",
    "td",
    "vi",
  ] as const),
});

const TechnicalAnchorAlgorithmV2Schema = z
  .object({
    id: z.literal(TECHNICAL_ANCHOR_ALGORITHM_V2.id),
    version: z.literal(TECHNICAL_ANCHOR_ALGORITHM_V2.version),
    unicode: z.literal(TECHNICAL_ANCHOR_ALGORITHM_V2.unicode),
    caseFold: z.literal(TECHNICAL_ANCHOR_ALGORITHM_V2.caseFold),
    segment: z.literal(TECHNICAL_ANCHOR_ALGORITHM_V2.segment),
    acceptedShapes: z.tuple([
      z.literal("MULTI_WORD"),
      z.literal("UPPERCASE_ACRONYM"),
      z.literal("INTERNAL_CAMEL_CASE"),
      z.literal("TECHNICAL_PUNCTUATION"),
    ]),
    coverageSource: z.tuple([
      z.literal("OBJECT_TITLE"),
      z.literal("OBJECT_TAG"),
      z.literal("NODE_TITLE"),
      z.literal("NODE_TEXT"),
    ]),
    supportVariants: z.literal(
      TECHNICAL_ANCHOR_ALGORITHM_V2.supportVariants,
    ),
    queryDecision: z.literal(
      TECHNICAL_ANCHOR_ALGORITHM_V2.queryDecision,
    ),
    conversationalLeadTokens: z.tuple([
      z.literal("can"),
      z.literal("check"),
      z.literal("could"),
      z.literal("explain"),
      z.literal("help"),
      z.literal("how"),
      z.literal("i"),
      z.literal("open"),
      z.literal("please"),
      z.literal("run"),
      z.literal("select"),
      z.literal("should"),
      z.literal("show"),
      z.literal("tell"),
      z.literal("try"),
      z.literal("use"),
      z.literal("we"),
      z.literal("what"),
      z.literal("when"),
      z.literal("where"),
      z.literal("why"),
      z.literal("would"),
      z.literal("you"),
    ]),
    conversationalTrailingTokens: z.tuple([
      z.literal("again"),
      z.literal("first"),
      z.literal("for"),
      z.literal("here"),
      z.literal("it"),
      z.literal("me"),
      z.literal("mean"),
      z.literal("means"),
      z.literal("next"),
      z.literal("now"),
      z.literal("please"),
      z.literal("setting"),
      z.literal("settings"),
      z.literal("there"),
      z.literal("today"),
      z.literal("use"),
      z.literal("used"),
      z.literal("using"),
      z.literal("work"),
      z.literal("works"),
    ]),
    suppressedStandaloneAnchors: z.tuple([
      z.literal("esc"),
      z.literal("gpu"),
      z.literal("pdf"),
      z.literal("td"),
      z.literal("vi"),
    ]),
  })
  .strict();

const CapabilityAnchorCoursePackCoverageV2Schema = z
  .object({
    coursePack: CoursePackReferenceV2Schema,
    objectCount: z.number().int().positive().max(1_000_000),
    objectSetHash: HashSchema,
    supportedAnchors: z
      .array(z.string().min(2).max(80))
      .max(100_000),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (
      new Set(coverage.supportedAnchors).size
      !== coverage.supportedAnchors.length
    ) {
      context.addIssue({
        code: "custom",
        message: "supported anchors must be unique",
        path: ["supportedAnchors"],
      });
    }
    const sorted = [...coverage.supportedAnchors].sort(
      compareCodePoints,
    );
    if (
      coverage.supportedAnchors.some(
        (anchor, index) => anchor !== sorted[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "supported anchors must be code-point sorted",
        path: ["supportedAnchors"],
      });
    }
  });

const CapabilityAnchorCoverageInputV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: IdSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    corpusBundleHash: HashSchema,
    algorithm: TechnicalAnchorAlgorithmV2Schema,
    coursePacks: z
      .array(CapabilityAnchorCoursePackCoverageV2Schema)
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((coverage, context) => {
    const ids = coverage.coursePacks.map(
      ({ coursePack }) => coursePack.id,
    );
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "course pack coverage must be unique",
        path: ["coursePacks"],
      });
    }
    const sorted = [...ids].sort(compareCodePoints);
    if (ids.some((id, index) => id !== sorted[index])) {
      context.addIssue({
        code: "custom",
        message: "course pack coverage must be code-point sorted",
        path: ["coursePacks"],
      });
    }
  });

export const CapabilityAnchorCoverageV2Schema =
  CapabilityAnchorCoverageInputV2Schema
    .extend({
      configHash: HashSchema,
    })
    .strict();

export type CapabilityAnchorCoverageV2 = z.infer<
  typeof CapabilityAnchorCoverageV2Schema
>;

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${stableJson(item)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function normalizeAnchor(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/^[./-]+|[./-]+$/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isShapedSingleToken(value: string) {
  return /^[A-Z][A-Z0-9]{1,9}$/.test(value)
    || /[a-z][A-Z]/.test(value)
    || (
      /[.+#/-]/.test(value)
      && /[A-Za-z]/.test(value)
      && /[0-9A-Za-z]/.test(value)
    );
}

const SUPPRESSED_STANDALONE_ANCHORS = new Set<string>(
  TECHNICAL_ANCHOR_ALGORITHM_V2.suppressedStandaloneAnchors,
);
const CONVERSATIONAL_LEAD_TOKENS = new Set<string>(
  TECHNICAL_ANCHOR_ALGORITHM_V2.conversationalLeadTokens,
);
const CONVERSATIONAL_TRAILING_TOKENS = new Set<string>(
  TECHNICAL_ANCHOR_ALGORITHM_V2.conversationalTrailingTokens,
);
const TECHNICAL_SEGMENT =
  /(?<![A-Za-z0-9_])[A-Za-z][A-Za-z0-9.+#/-]*(?:[ \t]+[A-Za-z][A-Za-z0-9.+#/-]*){0,5}(?![A-Za-z0-9_])/g;

type TechnicalSegment = Readonly<{
  anchor: string;
  rawTokens: readonly string[];
}>;

function tokenShape(value: string) {
  if (/^[A-Z][A-Z0-9]{1,9}$/.test(value)) {
    return "ACRONYM" as const;
  }
  if (/[a-z][A-Z]/.test(value)) {
    return "CAMEL" as const;
  }
  if (
    /[.+#/-]/.test(value)
    && /[A-Za-z]/.test(value)
    && /[0-9A-Za-z]/.test(value)
  ) {
    return "TECHNICAL_PUNCTUATION" as const;
  }
  if (/^[A-Z][a-z0-9]*$/.test(value)) {
    return "TITLE_CASE" as const;
  }
  return "OTHER" as const;
}

function segmentFromRawTokens(
  rawTokens: readonly string[],
): TechnicalSegment | null {
  const anchor = normalizeAnchor(rawTokens.join(" "));
  if (anchor.length < 2 || anchor.length > 80) return null;
  if (
    rawTokens.length === 1
    && (
      !isShapedSingleToken(rawTokens[0]!)
      || SUPPRESSED_STANDALONE_ANCHORS.has(anchor)
    )
  ) {
    return null;
  }
  return { anchor, rawTokens };
}

function technicalSegments(
  value: string,
  purpose: "QUERY" | "COVERAGE" = "QUERY",
): TechnicalSegment[] {
  const normalizedUnicode = value
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-");
  const segments: TechnicalSegment[] = [];
  for (const match of normalizedUnicode.matchAll(TECHNICAL_SEGMENT)) {
    const raw = match[0].trim();
    const rawTokens = raw.split(/[ \t]+/);
    let index = 0;
    while (index < rawTokens.length) {
      const shape = tokenShape(rawTokens[index]!);
      if (shape === "OTHER") {
        index += 1;
        continue;
      }
      let end = index + 1;
      while (
        end < rawTokens.length
        && tokenShape(rawTokens[end]!) !== "OTHER"
      ) {
        end += 1;
      }
      const shapedRun = rawTokens.slice(index, end);
      let firstMeaningful = 0;
      if (purpose === "QUERY") {
        while (
          firstMeaningful < shapedRun.length
          && tokenShape(shapedRun[firstMeaningful]!) === "TITLE_CASE"
          && CONVERSATIONAL_LEAD_TOKENS.has(
            normalizeAnchor(shapedRun[firstMeaningful]!),
          )
        ) {
          firstMeaningful += 1;
        }
      }
      const meaningfulRun = shapedRun.slice(firstMeaningful);
      const meaningfulShape = meaningfulRun.length > 0
        ? tokenShape(meaningfulRun[0]!)
        : null;
      const shapedSegment = segmentFromRawTokens(meaningfulRun);
      if (
        shapedSegment
        && (
          meaningfulRun.length >= 2
          || meaningfulShape !== "TITLE_CASE"
        )
      ) {
        segments.push(shapedSegment);
      }
      if (
        meaningfulRun.length === 1
        && (
          meaningfulShape === "ACRONYM"
          || meaningfulShape === "CAMEL"
          || meaningfulShape === "TECHNICAL_PUNCTUATION"
        )
        && end < rawTokens.length
        && tokenShape(rawTokens[end]!) === "OTHER"
        && !CONVERSATIONAL_TRAILING_TOKENS.has(
          normalizeAnchor(rawTokens[end]!),
        )
      ) {
        const compound = segmentFromRawTokens(
          [...meaningfulRun, rawTokens[end]!],
        );
        if (compound) segments.push(compound);
      }
      index = Math.max(end, index + 1);
    }
  }
  return segments;
}

export function extractExplicitTechnicalAnchorsV2(
  value: string,
): string[] {
  const anchors = new Set<string>();
  for (const segment of technicalSegments(value)) {
    anchors.add(segment.anchor);
  }
  return [...anchors].sort(compareCodePoints);
}

function coverageVariants(segment: TechnicalSegment) {
  const normalizedTokens = segment.rawTokens.map(normalizeAnchor);
  const variants = new Set<string>([segment.anchor]);
  if (normalizedTokens.length >= 2) {
    for (
      let start = 0;
      start < normalizedTokens.length - 1;
      start += 1
    ) {
      for (
        let end = start + 2;
        end <= normalizedTokens.length;
        end += 1
      ) {
        variants.add(normalizedTokens.slice(start, end).join(" "));
      }
    }
    for (const [index, rawToken] of segment.rawTokens.entries()) {
      const normalizedToken = normalizedTokens[index]!;
      if (
        isShapedSingleToken(rawToken)
        && !SUPPRESSED_STANDALONE_ANCHORS.has(normalizedToken)
      ) {
        variants.add(normalizedToken);
      }
    }
  }
  return variants;
}

function objectCoverageTexts(object: KnowledgeObjectV2) {
  return [
    object.title,
    ...object.tags,
    ...object.nodes.flatMap(nodeCoverageTexts),
  ];
}

function nodeCoverageTexts(node: KnowledgeNodeV2): string[] {
  switch (node.kind) {
    case "DOCUMENT":
    case "SECTION":
      return [node.title];
    case "TEXT":
      return [node.text];
    case "TABLE":
      return [node.plainText];
    case "REGION":
      return [node.label];
    case "IMAGE":
      return [];
  }
}

export function createCapabilityAnchorCoverageV2(input: {
  corpusBundleHash: string;
  objects: readonly KnowledgeObjectV2[];
}): CapabilityAnchorCoverageV2 {
  const objects = z.array(KnowledgeObjectV2Schema).min(1).parse(
    input.objects,
  );
  const objectsByPack = new Map<
    z.infer<typeof CoursePackReferenceV2Schema>["id"],
    KnowledgeObjectV2[]
  >();
  for (const object of objects) {
    const packObjects =
      objectsByPack.get(object.sourceCoursePack.id) ?? [];
    packObjects.push(object);
    objectsByPack.set(object.sourceCoursePack.id, packObjects);
  }
  const coursePacks = Array.from(objectsByPack.entries())
    .map(([coursePackId, packObjects]) => {
      const versions = new Set(
        packObjects.map(({ sourceCoursePack }) =>
          sourceCoursePack.version),
      );
      if (versions.size !== 1) {
        throw new Error(
          `technical anchor course pack version drift:${coursePackId}`,
        );
      }
      const supportedAnchors = new Set<string>();
      for (const object of packObjects) {
        for (const text of objectCoverageTexts(object)) {
          for (const segment of technicalSegments(text, "COVERAGE")) {
            for (const variant of coverageVariants(segment)) {
              supportedAnchors.add(variant);
            }
          }
        }
      }
      return {
        coursePack: {
          id: coursePackId,
          version: [...versions][0]!,
        },
        objectCount: packObjects.length,
        objectSetHash: sha256(
          packObjects
            .map(({ id, contentHash }) => ({ id, contentHash }))
            .sort((left, right) =>
              compareCodePoints(left.id, right.id)),
        ),
        supportedAnchors: [...supportedAnchors].sort(
          compareCodePoints,
        ),
      };
    })
    .sort((left, right) =>
      compareCodePoints(left.coursePack.id, right.coursePack.id));
  const parsed = CapabilityAnchorCoverageInputV2Schema.parse({
    schemaVersion: 2,
    id: "lumi-capability-anchor-coverage-v2",
    version: "1.0.0",
    corpusBundleHash: input.corpusBundleHash,
    algorithm: TECHNICAL_ANCHOR_ALGORITHM_V2,
    coursePacks,
  });
  return CapabilityAnchorCoverageV2Schema.parse({
    ...parsed,
    configHash: sha256(parsed),
  });
}

export function verifyCapabilityAnchorCoverageV2(
  coverageInput: CapabilityAnchorCoverageV2,
) {
  const coverage = CapabilityAnchorCoverageV2Schema.parse(
    coverageInput,
  );
  const { configHash, ...withoutHash } = coverage;
  if (sha256(withoutHash) !== configHash) {
    throw new Error("technical anchor coverage config hash mismatch");
  }
  return coverage;
}

export function unsupportedExplicitTechnicalAnchorsV2(input: {
  queryText: string;
  sourceCoursePack: z.infer<typeof CoursePackReferenceV2Schema>;
  coverage: CapabilityAnchorCoverageV2;
}) {
  const coverage = verifyCapabilityAnchorCoverageV2(input.coverage);
  const sourceCoursePack = CoursePackReferenceV2Schema.parse(
    input.sourceCoursePack,
  );
  const packCoverage = coverage.coursePacks.find(
    ({ coursePack }) =>
      coursePack.id === sourceCoursePack.id
      && coursePack.version === sourceCoursePack.version,
  );
  if (!packCoverage) {
    throw new Error("technical anchor course pack coverage missing");
  }
  const supported = new Set(packCoverage.supportedAnchors);
  const unsupported = new Set<string>();
  for (const segment of technicalSegments(input.queryText)) {
    if (!supported.has(segment.anchor)) {
      unsupported.add(segment.anchor);
    }
  }
  return [...unsupported].sort(compareCodePoints);
}

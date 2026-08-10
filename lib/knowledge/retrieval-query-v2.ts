import { z } from "zod";

import { CoursePackReferenceV2Schema } from "./knowledge-object-v2";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

const HashSchema = z.string().regex(HASH_PATTERN, "expected a lowercase sha256 hash");
const IdSchema = z.string().regex(ID_PATTERN, "expected a stable lowercase identifier");

export const RetrievalModeV2Schema = z.enum([
  "TEXT_TO_TEXT",
  "TEXT_TO_IMAGE",
  "IMAGE_TO_IMAGE",
  "IMAGE_TEXT_TO_EVIDENCE",
]);

export const RetrievalQueryAssetV2Schema = z
  .object({
    assetId: IdSchema,
    sha256: HashSchema,
  })
  .strict();

export const RetrievalScopeV2Schema = z
  .object({
    corpusBundleHash: HashSchema,
    sourceCoursePack: CoursePackReferenceV2Schema.nullable(),
  })
  .strict();

const QueryBaseShape = {
  schemaVersion: z.literal(2),
  scope: RetrievalScopeV2Schema,
  excludeAssetIds: z.array(IdSchema).max(32),
} as const;

export const RetrievalQueryV2Schema = z
  .discriminatedUnion("mode", [
    z
      .object({
        ...QueryBaseShape,
        mode: z.literal("TEXT_TO_TEXT"),
        originalText: z.string().min(1).max(500),
        normalizedText: z.string().min(1).max(500),
        queryAsset: z.null(),
      })
      .strict(),
    z
      .object({
        ...QueryBaseShape,
        mode: z.literal("TEXT_TO_IMAGE"),
        originalText: z.string().min(1).max(500),
        normalizedText: z.string().min(1).max(500),
        queryAsset: z.null(),
      })
      .strict(),
    z
      .object({
        ...QueryBaseShape,
        mode: z.literal("IMAGE_TO_IMAGE"),
        originalText: z.null(),
        normalizedText: z.null(),
        queryAsset: RetrievalQueryAssetV2Schema,
      })
      .strict(),
    z
      .object({
        ...QueryBaseShape,
        mode: z.literal("IMAGE_TEXT_TO_EVIDENCE"),
        originalText: z.string().min(1).max(500),
        normalizedText: z.string().min(1).max(500),
        queryAsset: RetrievalQueryAssetV2Schema,
      })
      .strict(),
  ])
  .superRefine((query, context) => {
    const uniqueExclusions = new Set(query.excludeAssetIds);
    if (uniqueExclusions.size !== query.excludeAssetIds.length) {
      context.addIssue({
        code: "custom",
        message: "excluded asset ids must be unique",
        path: ["excludeAssetIds"],
      });
    }
    if (query.queryAsset && !uniqueExclusions.has(query.queryAsset.assetId)) {
      context.addIssue({
        code: "custom",
        message: "image queries must exclude their query asset",
        path: ["excludeAssetIds"],
      });
    }
    if (
      query.normalizedText !== null
      && query.normalizedText !== normalizeRetrievalTextV2(query.originalText ?? "")
    ) {
      context.addIssue({
        code: "custom",
        message: "normalized text must be derived deterministically from original text",
        path: ["normalizedText"],
      });
    }
  });

const RetrievalQueryInputV2Schema = z
  .discriminatedUnion("mode", [
    z
      .object({
        mode: z.literal("TEXT_TO_TEXT"),
        text: z.string().min(1).max(500),
        queryAsset: z.undefined().optional(),
        scope: RetrievalScopeV2Schema,
        excludeAssetIds: z.array(IdSchema).max(32).optional(),
      })
      .strict(),
    z
      .object({
        mode: z.literal("TEXT_TO_IMAGE"),
        text: z.string().min(1).max(500),
        queryAsset: z.undefined().optional(),
        scope: RetrievalScopeV2Schema,
        excludeAssetIds: z.array(IdSchema).max(32).optional(),
      })
      .strict(),
    z
      .object({
        mode: z.literal("IMAGE_TO_IMAGE"),
        text: z.undefined().optional(),
        queryAsset: RetrievalQueryAssetV2Schema,
        scope: RetrievalScopeV2Schema,
        excludeAssetIds: z.array(IdSchema).max(32).optional(),
      })
      .strict(),
    z
      .object({
        mode: z.literal("IMAGE_TEXT_TO_EVIDENCE"),
        text: z.string().min(1).max(500),
        queryAsset: RetrievalQueryAssetV2Schema,
        scope: RetrievalScopeV2Schema,
        excludeAssetIds: z.array(IdSchema).max(32).optional(),
      })
      .strict(),
  ]);

export type RetrievalModeV2 = z.infer<typeof RetrievalModeV2Schema>;
export type RetrievalQueryAssetV2 = z.infer<typeof RetrievalQueryAssetV2Schema>;
export type RetrievalScopeV2 = z.infer<typeof RetrievalScopeV2Schema>;
export type RetrievalQueryV2 = z.infer<typeof RetrievalQueryV2Schema>;
export type RetrievalQueryInputV2 = z.input<typeof RetrievalQueryInputV2Schema>;

export function normalizeRetrievalTextV2(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("zh-CN");
}

export function createRetrievalQueryV2(input: RetrievalQueryInputV2): RetrievalQueryV2 {
  const parsed = RetrievalQueryInputV2Schema.parse(input);
  const excludeAssetIds = Array.from(new Set([
    ...(parsed.excludeAssetIds ?? []),
    ...(parsed.queryAsset ? [parsed.queryAsset.assetId] : []),
  ])).sort();
  const text = "text" in parsed && typeof parsed.text === "string"
    ? parsed.text
    : null;
  return RetrievalQueryV2Schema.parse({
    schemaVersion: 2,
    mode: parsed.mode,
    originalText: text,
    normalizedText: text === null ? null : normalizeRetrievalTextV2(text),
    queryAsset: parsed.queryAsset ?? null,
    scope: parsed.scope,
    excludeAssetIds,
  });
}

import { z } from "zod";

const ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const POSIX_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\\]+$/;
const WINDOWS_UNSAFE_PATH_CHARACTERS = /[\u0000-\u001f<>:"|?*]/;

export const RetrievalModeSchema = z.enum([
  "TEXT_TO_TEXT",
  "TEXT_TO_IMAGE",
  "IMAGE_TO_IMAGE",
  "IMAGE_TEXT_TO_EVIDENCE",
  "NEGATIVE",
]);

export const RetrievalExpectationSchema = z.enum(["ANSWERABLE", "NO_ANSWER"]);

export const RetrievalCoursePackIdSchema = z.enum([
  "general-design",
  "digital-interaction",
  "book-design",
  "layout-design",
  "brand-vi-design",
]);

const AssetPathSchema = z
  .string()
  .regex(POSIX_RELATIVE_PATH)
  .refine((value) => {
    const segments = value.split("/");
    return value.startsWith("assets/")
      && value.endsWith(".png")
      && !WINDOWS_UNSAFE_PATH_CHARACTERS.test(value)
      && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  });

const CourseDocumentLocatorSchema = z
  .string()
  .regex(POSIX_RELATIVE_PATH)
  .refine((value) => {
    const segments = value.split("/");
    return segments.length >= 3
      && segments[0] === "data"
      && segments[1] === "courses"
      && value.endsWith(".md")
      && !WINDOWS_UNSAFE_PATH_CHARACTERS.test(value)
      && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  }, {
    message: "parent locators must be strict Markdown paths inside data/courses",
  });

const RetrievalQuerySchema = z
  .object({
    coursePackId: RetrievalCoursePackIdSchema.nullable(),
    text: z.string().trim().min(1).max(500).optional(),
    assetPath: AssetPathSchema.optional(),
    excludeSelfAsset: z.boolean().optional(),
    excludeAssetPaths: z.array(AssetPathSchema).max(32).optional(),
  })
  .strict();

const NodeTargetSchema = z
  .object({
    id: z.string().regex(ID),
    relevance: z.number().int().min(1).max(3),
    required: z.boolean(),
  })
  .strict();

const AssetTargetSchema = z
  .object({
    path: AssetPathSchema,
    sha256: z.string().regex(SHA256),
    relevance: z.number().int().min(1).max(3),
    required: z.boolean(),
  })
  .strict();

const RegionTargetSchema = z
  .object({
    assetPath: AssetPathSchema,
    bbox: z.tuple([
      z.number().nonnegative(),
      z.number().nonnegative(),
      z.number().positive(),
      z.number().positive(),
    ]),
    coordinateSpace: z.enum(["PIXELS", "NORMALIZED"]),
    relevance: z.number().int().min(1).max(3),
    required: z.boolean(),
  })
  .strict()
  .superRefine((region, context) => {
    if (
      region.coordinateSpace === "NORMALIZED"
      && (
        region.bbox.some((value) => value > 1)
        || region.bbox[0] + region.bbox[2] > 1
        || region.bbox[1] + region.bbox[3] > 1
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "normalized bounding boxes must stay between zero and one",
      });
    }
  });

const RetrievalTargetsSchema = z
  .object({
    nodes: z.array(NodeTargetSchema),
    assets: z.array(AssetTargetSchema),
    regions: z.array(RegionTargetSchema),
    expectedParentLocators: z.array(CourseDocumentLocatorSchema),
    forbiddenNodeIds: z.array(z.string().regex(ID)),
    forbiddenAssetPaths: z.array(AssetPathSchema),
  })
  .strict()
  .superRefine((targets, context) => {
    const groups = [
      ["node target IDs", targets.nodes.map(({ id }) => id)],
      ["asset target paths", targets.assets.map(({ path }) => path)],
      ["parent locators", targets.expectedParentLocators],
      ["forbidden node IDs", targets.forbiddenNodeIds],
      ["forbidden asset paths", targets.forbiddenAssetPaths],
    ] as const;
    for (const [label, values] of groups) {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: `${label} must be unique` });
      }
    }
    const forbiddenNodeIds = new Set(targets.forbiddenNodeIds);
    if (targets.nodes.some(({ id }) => forbiddenNodeIds.has(id))) {
      context.addIssue({
        code: "custom",
        message: "positive node targets cannot also be forbidden",
      });
    }
    const forbiddenAssetPaths = new Set(targets.forbiddenAssetPaths);
    if (
      targets.assets.some(({ path }) => forbiddenAssetPaths.has(path))
      || targets.regions.some(({ assetPath }) => forbiddenAssetPaths.has(assetPath))
    ) {
      context.addIssue({
        code: "custom",
        message: "positive asset or region targets cannot also be forbidden",
      });
    }
  });

export const RetrievalGoldenCaseSchema = z
  .object({
    id: z.string().regex(ID),
    mode: RetrievalModeSchema,
    expectation: RetrievalExpectationSchema,
    expectedSourceCoursePackId: RetrievalCoursePackIdSchema.nullable(),
    expectedLegacyPlacementCoursePackId: RetrievalCoursePackIdSchema.nullable(),
    coursePackVersion: z.literal("1"),
    query: RetrievalQuerySchema,
    targets: RetrievalTargetsSchema,
    tags: z.array(z.string().regex(ID)).min(1),
  })
  .strict()
  .superRefine((testCase, context) => {
    const hasText = Boolean(testCase.query.text);
    const hasImage = Boolean(testCase.query.assetPath);
    const excludedAssetPaths = testCase.query.excludeAssetPaths ?? [];
    const needsNode = testCase.mode === "TEXT_TO_TEXT"
      || testCase.mode === "IMAGE_TEXT_TO_EVIDENCE";
    const needsAsset = testCase.mode === "TEXT_TO_IMAGE"
      || testCase.mode === "IMAGE_TO_IMAGE"
      || testCase.mode === "IMAGE_TEXT_TO_EVIDENCE";

    if (testCase.mode === "NEGATIVE" && testCase.expectation !== "NO_ANSWER") {
      context.addIssue({
        code: "custom",
        message: "NEGATIVE mode requires expectation=NO_ANSWER",
      });
    }

    if (testCase.mode === "TEXT_TO_TEXT" || testCase.mode === "TEXT_TO_IMAGE" || testCase.mode === "NEGATIVE") {
      if (
        !hasText
        || hasImage
        || testCase.query.excludeSelfAsset !== undefined
        || excludedAssetPaths.length > 0
      ) {
        context.addIssue({ code: "custom", message: `${testCase.mode} requires text only` });
      }
    } else if (testCase.mode === "IMAGE_TO_IMAGE") {
      if (
        hasText
        || !hasImage
        || testCase.query.excludeSelfAsset !== true
        || !testCase.query.assetPath
        || !excludedAssetPaths.includes(testCase.query.assetPath)
      ) {
        context.addIssue({
          code: "custom",
          message: "IMAGE_TO_IMAGE requires one image and an explicit exclusion containing itself",
        });
      }
    } else if (
      !hasText
      || !hasImage
      || testCase.query.excludeSelfAsset !== true
      || !testCase.query.assetPath
      || !excludedAssetPaths.includes(testCase.query.assetPath)
    ) {
      context.addIssue({
        code: "custom",
        message: "IMAGE_TEXT_TO_EVIDENCE requires text, image, and an explicit self exclusion",
      });
    }
    if (new Set(excludedAssetPaths).size !== excludedAssetPaths.length) {
      context.addIssue({
        code: "custom",
        message: "query asset exclusions must be unique",
      });
    }

    if (testCase.expectation === "NO_ANSWER") {
      if (
        testCase.expectedSourceCoursePackId !== null
        || testCase.expectedLegacyPlacementCoursePackId !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "NO_ANSWER cases require expected source and legacy placement course packs to be null",
        });
      }
      if (
        testCase.targets.nodes.length > 0
        || testCase.targets.assets.length > 0
        || testCase.targets.regions.length > 0
        || testCase.targets.expectedParentLocators.length > 0
      ) {
        context.addIssue({ code: "custom", message: "NO_ANSWER cases cannot declare positive targets" });
      }
    } else {
      if (
        testCase.expectedSourceCoursePackId === null
        || testCase.expectedLegacyPlacementCoursePackId === null
      ) {
        context.addIssue({
          code: "custom",
          message: "ANSWERABLE cases require expected source and legacy placement course packs",
        });
      }
      if (needsNode && !testCase.targets.nodes.some(({ required }) => required)) {
        context.addIssue({ code: "custom", message: `${testCase.mode} requires a node target` });
      }
      if (needsAsset && !testCase.targets.assets.some(({ required }) => required)) {
        context.addIssue({ code: "custom", message: `${testCase.mode} requires an asset target` });
      }
      if (
        testCase.mode === "IMAGE_TEXT_TO_EVIDENCE"
        && testCase.targets.expectedParentLocators.length === 0
      ) {
        context.addIssue({
          code: "custom",
          message: "IMAGE_TEXT_TO_EVIDENCE requires an allowed parent locator",
        });
      }
    }
  });

export type RetrievalGoldenCase = z.infer<typeof RetrievalGoldenCaseSchema>;

export const RetrievalGoldenSuiteSchema = z
  .object({
    schemaVersion: z.literal(1),
    suiteVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/),
    corpusSnapshot: z
      .object({
        commit: z.string().regex(/^[0-9a-f]{40}$/),
        knowledgeTree: z.string().regex(/^[0-9a-f]{40}$/),
        coursesTree: z.string().regex(/^[0-9a-f]{40}$/),
        runtimeKnowledgeCount: z.number().int().positive(),
        generatedKnowledgeCount: z.number().int().positive(),
        baselineKnowledgeCount: z.number().int().nonnegative(),
        knowledgeCorpusSha256: z.string().regex(SHA256),
        sourceDocumentCount: z.number().int().positive(),
        sourceCorpusSha256: z.string().regex(SHA256),
        assetCount: z.number().int().positive(),
        assetManifest: z.literal("data/manifests/course-png-sha256.v1.json"),
        assetManifestSha256: z.string().regex(SHA256),
      })
      .strict()
      .superRefine((snapshot, context) => {
        if (
          snapshot.generatedKnowledgeCount + snapshot.baselineKnowledgeCount
          !== snapshot.runtimeKnowledgeCount
        ) {
          context.addIssue({
            code: "custom",
            message: "generated and baseline knowledge counts must equal runtime count",
          });
        }
      }),
    cases: z.array(RetrievalGoldenCaseSchema).min(1),
  })
  .strict()
  .superRefine((suite, context) => {
    const ids = suite.cases.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "retrieval case IDs must be unique" });
    }
    if (suite.corpusSnapshot.assetCount <= 0) {
      context.addIssue({ code: "custom", message: "retrieval suite requires assets" });
    }
  });

export type RetrievalGoldenSuite = z.infer<typeof RetrievalGoldenSuiteSchema>;

const RetrievalHitSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("NODE"),
    key: z.string().regex(ID),
    rank: z.number().int().positive(),
    score: z.number().finite().optional(),
  }).strict(),
  z.object({
    kind: z.literal("ASSET"),
    key: AssetPathSchema,
    rank: z.number().int().positive(),
    score: z.number().finite().optional(),
    region: z
      .object({
        bbox: z.tuple([
          z.number().nonnegative(),
          z.number().nonnegative(),
          z.number().positive(),
          z.number().positive(),
        ]),
        coordinateSpace: z.enum(["PIXELS", "NORMALIZED"]),
        origin: z.enum(["INDEXED_REGION", "PATCH_MATCH"]),
      })
      .strict()
      .superRefine((region, context) => {
        if (
          region.coordinateSpace === "NORMALIZED"
          && (
            region.bbox.some((value) => value > 1)
            || region.bbox[0] + region.bbox[2] > 1
            || region.bbox[1] + region.bbox[3] > 1
          )
        ) {
          context.addIssue({
            code: "custom",
            message: "normalized hit regions must stay between zero and one",
          });
        }
      })
      .optional(),
  }).strict(),
]);

export const RetrievalEvaluationResultSchema = z
  .object({
    caseId: z.string().regex(ID),
    status: z.enum(["SUCCESS", "EMPTY", "UNSUPPORTED", "TIMEOUT", "ERROR"]),
    channel: z.enum(["LEXICAL", "SEMANTIC", "HYBRID", "CAPTION_LEXICAL", "VISUAL"]),
    unsupportedReason: z
      .enum(["INPUT_MODALITY_UNSUPPORTED", "INDEX_UNAVAILABLE", "PROVIDER_UNAVAILABLE"])
      .optional(),
    hits: z.array(RetrievalHitSchema),
    parentLocators: z.array(CourseDocumentLocatorSchema),
    latencyMs: z.number().finite().nonnegative(),
    degradedFrom: z.enum(["SEMANTIC", "VISUAL", "HYBRID"]).nullable(),
    degradationSucceeded: z.boolean().nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "UNSUPPORTED" && !result.unsupportedReason) {
      context.addIssue({ code: "custom", message: "unsupported results require a reason" });
    }
    if (result.status !== "UNSUPPORTED" && result.unsupportedReason) {
      context.addIssue({ code: "custom", message: "only unsupported results can include a reason" });
    }
    if (result.status === "SUCCESS" && result.hits.length === 0) {
      context.addIssue({ code: "custom", message: "successful results require at least one hit" });
    }
    if (
      ["EMPTY", "UNSUPPORTED", "TIMEOUT", "ERROR"].includes(result.status)
      && result.hits.length > 0
    ) {
      context.addIssue({ code: "custom", message: `${result.status} results cannot include hits` });
    }
    if (result.status !== "SUCCESS" && result.parentLocators.length > 0) {
      context.addIssue({
        code: "custom",
        message: `${result.status} results cannot include parent locators`,
      });
    }
    const hitKeys = result.hits.map(({ kind, key }) => `${kind}:${key}`);
    if (new Set(hitKeys).size !== hitKeys.length) {
      context.addIssue({ code: "custom", message: "retrieval hits must be unique by kind and key" });
    }
    if (new Set(result.parentLocators).size !== result.parentLocators.length) {
      context.addIssue({ code: "custom", message: "parent locators must be unique" });
    }
    for (const kind of ["NODE", "ASSET"] as const) {
      const ranks = result.hits
        .filter((hit) => hit.kind === kind)
        .map(({ rank }) => rank)
        .sort((left, right) => left - right);
      if (ranks.some((rank, index) => rank !== index + 1)) {
        context.addIssue({
          code: "custom",
          message: `${kind} ranks are authoritative and must be unique and contiguous from one`,
        });
      }
    }
    if ((result.degradedFrom === null) !== (result.degradationSucceeded === null)) {
      context.addIssue({
        code: "custom",
        message: "degradation source and success must either both be set or both be null",
      });
    }
  });

export type RetrievalEvaluationResult = z.infer<typeof RetrievalEvaluationResultSchema>;

export type RankedRetrievalMetrics = {
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  mrr: number;
  ndcgAt5: number;
  precisionAt5: number;
};

export type ScoredRetrievalCase = {
  caseId: string;
  mode: RetrievalGoldenCase["mode"];
  expectation: RetrievalGoldenCase["expectation"];
  queryCoursePackId: RetrievalGoldenCase["query"]["coursePackId"];
  expectedSourceCoursePackId: RetrievalGoldenCase["expectedSourceCoursePackId"];
  expectedLegacyPlacementCoursePackId:
    RetrievalGoldenCase["expectedLegacyPlacementCoursePackId"];
  status: RetrievalEvaluationResult["status"];
  channel: RetrievalEvaluationResult["channel"];
  latencyMs: number;
  primaryMetrics: RankedRetrievalMetrics | null;
  nodeMetrics: RankedRetrievalMetrics | null;
  assetMetrics: RankedRetrievalMetrics | null;
  regionRecallAt5: number | null;
  negativePass: boolean | null;
  forbiddenHit: boolean;
  parentCoverage: number | null;
  combinedEvidencePass: boolean | null;
  degradedFrom: RetrievalEvaluationResult["degradedFrom"];
  degradationSucceeded: RetrievalEvaluationResult["degradationSucceeded"];
};

type RankedTarget = {
  key: string;
  relevance: number;
  required: boolean;
};

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

export function rankedRetrievalMetrics(
  targets: readonly RankedTarget[],
  predictions: readonly string[],
): RankedRetrievalMetrics {
  const uniquePredictions = unique(predictions);
  const required = new Set(targets.filter(({ required }) => required).map(({ key }) => key));
  const relevance = new Map(targets.map(({ key, relevance: value }) => [key, value]));
  const recallAt = (limit: number) => required.size === 0
    ? 0
    : uniquePredictions.slice(0, limit).filter((key) => required.has(key)).length / required.size;
  const firstRelevant = uniquePredictions.findIndex((key) => relevance.has(key));
  const dcg = uniquePredictions.slice(0, 5).reduce((total, key, index) => {
    const grade = relevance.get(key) ?? 0;
    return total + (2 ** grade - 1) / Math.log2(index + 2);
  }, 0);
  const idealGrades = targets
    .map(({ relevance: value }) => value)
    .sort((left, right) => right - left)
    .slice(0, 5);
  const idealDcg = idealGrades.reduce(
    (total, grade, index) => total + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
  const topFive = uniquePredictions.slice(0, 5);
  return {
    recallAt1: round(recallAt(1)),
    recallAt3: round(recallAt(3)),
    recallAt5: round(recallAt(5)),
    mrr: firstRelevant < 0 ? 0 : round(1 / (firstRelevant + 1)),
    ndcgAt5: idealDcg === 0 ? 0 : round(dcg / idealDcg),
    precisionAt5: round(topFive.filter((key) => relevance.has(key)).length / 5),
  };
}

function rankedKeys(result: RetrievalEvaluationResult, kind: "NODE" | "ASSET") {
  return unique(result.hits
    .filter((hit) => hit.kind === kind)
    .sort((left, right) => left.rank - right.rank || (left.key < right.key ? -1 : 1))
    .map(({ key }) => key));
}

function regionIntersectionOverUnion(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
) {
  const intersectionWidth = Math.max(
    0,
    Math.min(left[0] + left[2], right[0] + right[2]) - Math.max(left[0], right[0]),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left[1] + left[3], right[1] + right[3]) - Math.max(left[1], right[1]),
  );
  const intersection = intersectionWidth * intersectionHeight;
  const union = left[2] * left[3] + right[2] * right[3] - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function scoreRetrievalCase(
  rawCase: RetrievalGoldenCase,
  rawResult: RetrievalEvaluationResult,
): ScoredRetrievalCase {
  const testCase = RetrievalGoldenCaseSchema.parse(rawCase);
  const result = RetrievalEvaluationResultSchema.parse(rawResult);
  if (testCase.id !== result.caseId) throw new Error("RETRIEVAL_CASE_RESULT_MISMATCH");
  const evaluated = result.status === "SUCCESS" || result.status === "EMPTY";
  const nodeKeys = rankedKeys(result, "NODE");
  const assetKeys = rankedKeys(result, "ASSET");
  const nodeTargets = testCase.targets.nodes.map(({ id, relevance, required }) => ({
    key: id,
    relevance,
    required,
  }));
  const assetTargets = testCase.targets.assets.map(({ path: assetPath, relevance, required }) => ({
    key: assetPath,
    relevance,
    required,
  }));
  const nodeMetrics = evaluated && nodeTargets.length > 0
    ? rankedRetrievalMetrics(nodeTargets, nodeKeys)
    : null;
  const assetMetrics = evaluated && assetTargets.length > 0
    ? rankedRetrievalMetrics(assetTargets, assetKeys)
    : null;
  const requiredRegions = testCase.targets.regions.filter(({ required }) => required);
  const topFiveAssetHits = result.hits
    .filter((hit) => hit.kind === "ASSET")
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 5);
  const regionRecallAt5 = evaluated && requiredRegions.length > 0
    ? round(requiredRegions.filter((target) =>
      topFiveAssetHits.some((hit) =>
        hit.key === target.assetPath
        && hit.region?.coordinateSpace === target.coordinateSpace
        && regionIntersectionOverUnion(hit.region.bbox, target.bbox) >= 0.5))
    .length / requiredRegions.length)
    : null;
  const primaryMetrics = testCase.expectation === "ANSWERABLE"
    ? testCase.mode === "TEXT_TO_TEXT" || testCase.mode === "IMAGE_TEXT_TO_EVIDENCE"
      ? nodeMetrics
      : assetMetrics
    : null;
  const forbiddenHit = nodeKeys.some((id) => testCase.targets.forbiddenNodeIds.includes(id))
    || assetKeys.some((assetPath) => testCase.targets.forbiddenAssetPaths.includes(assetPath));
  const expectedParents = new Set(testCase.targets.expectedParentLocators);
  const returnedParents = new Set(result.parentLocators);
  const parentCoverage = evaluated && expectedParents.size > 0
    ? round([...expectedParents].filter((locator) => returnedParents.has(locator)).length / expectedParents.size)
    : null;
  const combinedEvidencePass = testCase.mode === "IMAGE_TEXT_TO_EVIDENCE" && evaluated
    ? nodeMetrics?.recallAt5 === 1
      && assetMetrics?.recallAt5 === 1
      && (regionRecallAt5 === null || regionRecallAt5 === 1)
      && parentCoverage === 1
      && !forbiddenHit
    : null;
  return {
    caseId: testCase.id,
    mode: testCase.mode,
    expectation: testCase.expectation,
    queryCoursePackId: testCase.query.coursePackId,
    expectedSourceCoursePackId: testCase.expectedSourceCoursePackId,
    expectedLegacyPlacementCoursePackId: testCase.expectedLegacyPlacementCoursePackId,
    status: result.status,
    channel: result.channel,
    latencyMs: result.latencyMs,
    primaryMetrics,
    nodeMetrics,
    assetMetrics,
    regionRecallAt5,
    negativePass: testCase.expectation === "NO_ANSWER" && evaluated
      ? nodeKeys.length === 0
        && assetKeys.length === 0
        && result.parentLocators.length === 0
        && !forbiddenHit
      : null,
    forbiddenHit,
    parentCoverage,
    combinedEvidencePass,
    degradedFrom: result.degradedFrom,
    degradationSucceeded: result.degradationSucceeded,
  };
}

export function nearestRankPercentile(values: readonly number[], percentile: number) {
  if (values.length === 0) return null;
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new Error("percentile must be within (0, 1]");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]!;
}

function average(values: readonly number[]) {
  return values.length === 0
    ? null
    : round(values.reduce((total, value) => total + value, 0) / values.length);
}

function summarizeGroup(scores: readonly ScoredRetrievalCase[]) {
  const evaluated = scores.filter(({ status }) => status === "SUCCESS" || status === "EMPTY");
  const positiveScores = evaluated
    .filter(({ expectation, primaryMetrics }) => expectation === "ANSWERABLE" && primaryMetrics)
  const positives = positiveScores.map(({ primaryMetrics }) => primaryMetrics!);
  const nodeMetrics = positiveScores
    .map(({ nodeMetrics: metrics }) => metrics)
    .filter((metrics): metrics is RankedRetrievalMetrics => metrics !== null);
  const assetMetrics = positiveScores
    .map(({ assetMetrics: metrics }) => metrics)
    .filter((metrics): metrics is RankedRetrievalMetrics => metrics !== null);
  const regionRecalls = evaluated
    .map(({ regionRecallAt5 }) => regionRecallAt5)
    .filter((value): value is number => value !== null);
  const negatives = evaluated.filter(({ expectation }) => expectation === "NO_ANSWER");
  const parentCoverages = evaluated
    .map(({ parentCoverage }) => parentCoverage)
    .filter((coverage): coverage is number => coverage !== null);
  const combinedEvidencePasses = evaluated
    .map(({ combinedEvidencePass }) => combinedEvidencePass)
    .filter((passed): passed is boolean => passed !== null);
  const degradations = scores.filter(
    ({ degradedFrom, degradationSucceeded }) =>
      degradedFrom !== null && degradationSucceeded !== null,
  );
  const latencies = evaluated.map(({ latencyMs }) => latencyMs);
  return {
    attempted: scores.length,
    evaluated: evaluated.length,
    unsupported: scores.filter(({ status }) => status === "UNSUPPORTED").length,
    errors: scores.filter(({ status }) => status === "ERROR" || status === "TIMEOUT").length,
    timeouts: scores.filter(({ status }) => status === "TIMEOUT").length,
    errorCount: scores.filter(({ status }) => status === "ERROR").length,
    recallAt1: average(positives.map(({ recallAt1 }) => recallAt1)),
    recallAt3: average(positives.map(({ recallAt3 }) => recallAt3)),
    recallAt5: average(positives.map(({ recallAt5 }) => recallAt5)),
    mrr: average(positives.map(({ mrr }) => mrr)),
    ndcgAt5: average(positives.map(({ ndcgAt5 }) => ndcgAt5)),
    precisionAt5: average(positives.map(({ precisionAt5 }) => precisionAt5)),
    nodePrecisionAt5: average(nodeMetrics.map(({ precisionAt5 }) => precisionAt5)),
    assetPrecisionAt5: average(assetMetrics.map(({ precisionAt5 }) => precisionAt5)),
    regionRecallAt5: average(regionRecalls),
    negativePassRate: average(negatives.map(({ negativePass }) => negativePass ? 1 : 0)),
    parentCoverage: average(parentCoverages),
    combinedEvidencePassRate: average(combinedEvidencePasses.map((passed) => passed ? 1 : 0)),
    timeoutRate: average(scores.map(({ status }) => status === "TIMEOUT" ? 1 : 0)),
    errorRate: average(scores.map(({ status }) => status === "ERROR" ? 1 : 0)),
    degradationSuccessRate: average(
      degradations.map(({ degradationSucceeded }) => degradationSucceeded ? 1 : 0),
    ),
    forbiddenHits: scores.filter(({ forbiddenHit }) => forbiddenHit).length,
    latencyP50Ms: nearestRankPercentile(latencies, 0.5),
    latencyP95Ms: nearestRankPercentile(latencies, 0.95),
  };
}

export function summarizeRetrievalScores(scores: readonly ScoredRetrievalCase[]) {
  const queryCoursePackBuckets = [
    ...RetrievalCoursePackIdSchema.options,
    "UNSCOPED",
  ] as const;
  const expectedSourceBuckets = [
    ...RetrievalCoursePackIdSchema.options,
    "NO_EXPECTED_SOURCE",
  ] as const;
  return {
    overall: summarizeGroup(scores),
    byMode: Object.fromEntries(
      RetrievalModeSchema.options.map((mode) => [
        mode,
        summarizeGroup(scores.filter((score) => score.mode === mode)),
      ]),
    ),
    byQueryCoursePack: Object.fromEntries(
      queryCoursePackBuckets.map((bucket) => [
        bucket,
        summarizeGroup(scores.filter((score) =>
          bucket === "UNSCOPED"
            ? score.queryCoursePackId === null
            : score.queryCoursePackId === bucket)),
      ]),
    ),
    byExpectedSourceCoursePack: Object.fromEntries(
      expectedSourceBuckets.map((bucket) => [
        bucket,
        summarizeGroup(scores.filter((score) =>
          bucket === "NO_EXPECTED_SOURCE"
            ? score.expectedSourceCoursePackId === null
            : score.expectedSourceCoursePackId === bucket)),
      ]),
    ),
    byQueryCoursePackAndMode: Object.fromEntries(
      queryCoursePackBuckets.map((bucket) => [
        bucket,
        Object.fromEntries(
          RetrievalModeSchema.options.map((mode) => [
            mode,
            summarizeGroup(scores.filter(
              (score) =>
                (
                  bucket === "UNSCOPED"
                    ? score.queryCoursePackId === null
                    : score.queryCoursePackId === bucket
                )
                && score.mode === mode,
            )),
          ]),
        ),
      ]),
    ),
  };
}

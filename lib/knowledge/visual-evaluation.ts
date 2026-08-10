import {
  RetrievalEvaluationResultSchema,
  RetrievalGoldenCaseSchema,
  type RetrievalEvaluationResult,
  type RetrievalGoldenCase,
} from "./retrieval-quality";
import {
  VisualRetrieverQuerySchema,
  type VisualRetrievalResponse,
  type VisualRetrieverQuery,
} from "./visual-retriever";
import type { KnowledgeCorpusBundleV2 } from "./knowledge-object-v2";

export type VisualAssetEvaluationBinding = {
  assetId: string;
  assetPath: string;
  objectId: string;
  parentLocator: string;
  coursePackId: string;
};

export type VisualEvaluationBindings = {
  byAssetId: ReadonlyMap<string, VisualAssetEvaluationBinding>;
  byAssetPath: ReadonlyMap<string, VisualAssetEvaluationBinding>;
};

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function buildVisualEvaluationBindings(
  bundle: KnowledgeCorpusBundleV2,
): VisualEvaluationBindings {
  const assetsById = new Map(bundle.assets.map((asset) => [asset.id, asset]));
  const byAssetId = new Map<string, VisualAssetEvaluationBinding>();
  const byAssetPath = new Map<string, VisualAssetEvaluationBinding>();
  for (const object of bundle.objects) {
    const parentLocator = object.legacyItem.source.localDocument?.replaceAll("\\", "/");
    if (!parentLocator) continue;
    for (const assetId of object.assetIds) {
      const asset = assetsById.get(assetId);
      if (!asset) throw new Error(`VISUAL_EVALUATION_ASSET_MISSING:${assetId}`);
      const assetPath = asset.locator.path.replaceAll("\\", "/");
      const binding = {
        assetId,
        assetPath,
        objectId: object.id,
        parentLocator,
        coursePackId: object.sourceCoursePack.id,
      };
      if (byAssetId.has(assetId)) {
        throw new Error(`VISUAL_EVALUATION_ASSET_OWNER_DUPLICATE:${assetId}`);
      }
      if (byAssetPath.has(assetPath)) {
        throw new Error(`VISUAL_EVALUATION_ASSET_PATH_DUPLICATE:${assetPath}`);
      }
      byAssetId.set(assetId, binding);
      byAssetPath.set(assetPath, binding);
    }
  }
  if (byAssetId.size !== bundle.assets.length) {
    const missing = bundle.assets
      .filter(({ id }) => !byAssetId.has(id))
      .map(({ id }) => id)
      .sort(compareCodePoints);
    throw new Error(`VISUAL_EVALUATION_ASSET_OWNER_MISSING:${missing.join(",")}`);
  }
  return { byAssetId, byAssetPath };
}

function bindingForPath(bindings: VisualEvaluationBindings, assetPath: string) {
  const binding = bindings.byAssetPath.get(assetPath);
  if (!binding) throw new Error(`VISUAL_EVALUATION_QUERY_ASSET_MISSING:${assetPath}`);
  return binding;
}

export function visualQueryForCase(
  rawCase: RetrievalGoldenCase,
  bindings: VisualEvaluationBindings,
): VisualRetrieverQuery | null {
  const testCase = RetrievalGoldenCaseSchema.parse(rawCase);
  if (testCase.mode === "TEXT_TO_IMAGE") {
    return VisualRetrieverQuerySchema.parse({
      mode: "TEXT_TO_IMAGE",
      coursePackId: testCase.query.coursePackId,
      text: testCase.query.text,
    });
  }
  if (testCase.mode === "IMAGE_TO_IMAGE") {
    return VisualRetrieverQuerySchema.parse({
      mode: "IMAGE_TO_IMAGE",
      coursePackId: testCase.query.coursePackId,
      queryAssetId: bindingForPath(bindings, testCase.query.assetPath!).assetId,
      excludeAssetIds: testCase.query.excludeAssetPaths!.map(
        (assetPath) => bindingForPath(bindings, assetPath).assetId,
      ),
    });
  }
  if (testCase.mode === "IMAGE_TEXT_TO_EVIDENCE") {
    return VisualRetrieverQuerySchema.parse({
      mode: "IMAGE_TEXT_TO_IMAGE",
      coursePackId: testCase.query.coursePackId,
      text: testCase.query.text,
      queryAssetId: bindingForPath(bindings, testCase.query.assetPath!).assetId,
      excludeAssetIds: testCase.query.excludeAssetPaths!.map(
        (assetPath) => bindingForPath(bindings, assetPath).assetId,
      ),
    });
  }
  return null;
}

function failureResult(
  testCase: RetrievalGoldenCase,
  response: VisualRetrievalResponse,
): RetrievalEvaluationResult {
  const status = response.status === "UNAVAILABLE"
    ? "UNSUPPORTED"
    : response.status;
  return RetrievalEvaluationResultSchema.parse({
    caseId: testCase.id,
    status,
    channel: "VISUAL",
    ...(status === "UNSUPPORTED"
      ? {
          unsupportedReason: response.reason === "INDEX_UNAVAILABLE"
            ? "INDEX_UNAVAILABLE"
            : "PROVIDER_UNAVAILABLE",
        }
      : {}),
    hits: [],
    parentLocators: [],
    latencyMs: response.timing.totalMs,
    degradedFrom: null,
    degradationSucceeded: null,
  });
}

export function composeVisualEvaluationResult(
  rawCase: RetrievalGoldenCase,
  response: VisualRetrievalResponse,
  bindings: VisualEvaluationBindings,
): RetrievalEvaluationResult {
  const testCase = RetrievalGoldenCaseSchema.parse(rawCase);
  if (response.status !== "SUCCESS" && response.status !== "EMPTY") {
    return failureResult(testCase, response);
  }
  const assetHits = response.hits.map((hit) => {
    const binding = bindings.byAssetId.get(hit.assetId);
    if (!binding) {
      throw new Error(`VISUAL_EVALUATION_UNKNOWN_HIT_ASSET:${hit.assetId}`);
    }
    return {
      kind: "ASSET" as const,
      key: binding.assetPath,
      rank: hit.rank,
      ...(hit.score === undefined ? {} : { score: hit.score }),
      ...(hit.region
        ? {
            region: {
              bbox: [
                hit.region.x,
                hit.region.y,
                hit.region.width,
                hit.region.height,
              ] as [number, number, number, number],
              coordinateSpace: hit.region.coordinateSpace,
              origin: hit.region.origin,
            },
          }
        : {}),
    };
  });
  const uniqueBindings = response.hits.reduce<VisualAssetEvaluationBinding[]>((result, hit) => {
    const binding = bindings.byAssetId.get(hit.assetId)!;
    if (!result.some(({ objectId }) => objectId === binding.objectId)) result.push(binding);
    return result;
  }, []);
  const nodeHits = testCase.mode === "IMAGE_TEXT_TO_EVIDENCE"
    ? uniqueBindings.map((binding, index) => ({
        kind: "NODE" as const,
        key: binding.objectId,
        rank: index + 1,
      }))
    : [];
  const parentLocators = [...new Set(uniqueBindings.map(({ parentLocator }) => parentLocator))];
  return RetrievalEvaluationResultSchema.parse({
    caseId: testCase.id,
    status: response.status,
    channel: "VISUAL",
    hits: [...assetHits, ...nodeHits],
    parentLocators,
    latencyMs: response.timing.totalMs,
    degradedFrom: null,
    degradationSucceeded: null,
  });
}

export function composeTextualVisualFallback(
  rawCase: RetrievalGoldenCase,
  fallback: RetrievalEvaluationResult,
): RetrievalEvaluationResult {
  const testCase = RetrievalGoldenCaseSchema.parse(rawCase);
  if (!testCase.query.text) {
    throw new Error("VISUAL_EVALUATION_PURE_IMAGE_FALLBACK_FORBIDDEN");
  }
  const parsed = RetrievalEvaluationResultSchema.parse({
    ...fallback,
    caseId: testCase.id,
  });
  const succeeded = parsed.status === "SUCCESS" || parsed.status === "EMPTY";
  return RetrievalEvaluationResultSchema.parse({
    ...parsed,
    degradedFrom: "VISUAL",
    degradationSucceeded: succeeded,
  });
}

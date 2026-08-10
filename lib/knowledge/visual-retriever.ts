import { createHash } from "node:crypto";

import { z } from "zod";

import { CoursePackReferenceV2Schema } from "./knowledge-object-v2";

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const MOVING_REVISIONS = new Set(["latest", "main", "master", "head", "stable", "current"]);

const HashSchema = z.string().regex(HASH, "expected a lowercase sha256 hash");
const IdSchema = z.string().regex(ID, "expected a stable lowercase identifier");
const CoursePackIdSchema = CoursePackReferenceV2Schema.shape.id;
const ImmutableRevisionSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) => !MOVING_REVISIONS.has(value.toLowerCase()),
    "model revision must be immutable",
  );

export const VisualRetrieverCapabilitiesSchema = z
  .object({
    textToImage: z.boolean(),
    imageToImage: z.boolean(),
    imageTextToImage: z.boolean(),
    normalizedRegions: z.boolean(),
  })
  .strict();

export const VisualIndexIdentitySchema = z
  .object({
    corpusBundleHash: HashSchema,
    indexBundleHash: HashSchema,
    indexVersionId: IdSchema,
    modelId: z.string().trim().min(1).max(300),
    modelRevision: ImmutableRevisionSchema,
  })
  .strict();

const VisualQueryBaseSchema = z
  .object({
    coursePackId: CoursePackIdSchema.nullable(),
  })
  .strict();

export const VisualRetrieverQuerySchema = z.discriminatedUnion("mode", [
  VisualQueryBaseSchema.extend({
    mode: z.literal("TEXT_TO_IMAGE"),
    text: z.string().trim().min(1).max(500),
  }).strict(),
  VisualQueryBaseSchema.extend({
    mode: z.literal("IMAGE_TO_IMAGE"),
    queryAssetId: IdSchema,
    excludeAssetIds: z.array(IdSchema).min(1).max(32),
  }).strict().superRefine((query, context) => {
    if (!query.excludeAssetIds.includes(query.queryAssetId)) {
      context.addIssue({
        code: "custom",
        message: "image-to-image queries must exclude the query asset",
        path: ["excludeAssetIds"],
      });
    }
    if (new Set(query.excludeAssetIds).size !== query.excludeAssetIds.length) {
      context.addIssue({
        code: "custom",
        message: "excluded asset ids must be unique",
        path: ["excludeAssetIds"],
      });
    }
  }),
  VisualQueryBaseSchema.extend({
    mode: z.literal("IMAGE_TEXT_TO_IMAGE"),
    text: z.string().trim().min(1).max(500),
    queryAssetId: IdSchema,
    excludeAssetIds: z.array(IdSchema).min(1).max(32),
  }).strict().superRefine((query, context) => {
    if (!query.excludeAssetIds.includes(query.queryAssetId)) {
      context.addIssue({
        code: "custom",
        message: "image-text queries must exclude the query asset",
        path: ["excludeAssetIds"],
      });
    }
    if (new Set(query.excludeAssetIds).size !== query.excludeAssetIds.length) {
      context.addIssue({
        code: "custom",
        message: "excluded asset ids must be unique",
        path: ["excludeAssetIds"],
      });
    }
  }),
]);

export const VisualRetrieverOptionsSchema = z
  .object({
    topK: z.number().int().min(1).max(50),
    timeoutMs: z.number().int().min(1).max(30_000),
  })
  .strict();

export const VisualHitRegionSchema = z
  .object({
    coordinateSpace: z.literal("NORMALIZED"),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().gt(0).max(1),
    height: z.number().finite().gt(0).max(1),
    origin: z.enum(["INDEXED_REGION", "PATCH_MATCH"]),
  })
  .strict()
  .superRefine((region, context) => {
    if (region.x + region.width > 1 || region.y + region.height > 1) {
      context.addIssue({
        code: "custom",
        message: "normalized visual hit region must stay inside the image",
      });
    }
  });

export const VisualRetrievalHitSchema = z
  .object({
    assetId: IdSchema,
    rank: z.number().int().positive(),
    score: z.number().finite().optional(),
    region: VisualHitRegionSchema.nullable(),
    representationId: IdSchema,
  })
  .strict();

export const VisualRetrievalTimingSchema = z
  .object({
    queueMs: z.number().finite().nonnegative(),
    inferenceMs: z.number().finite().nonnegative(),
    totalMs: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((timing, context) => {
    if (timing.totalMs + Number.EPSILON < timing.queueMs + timing.inferenceMs) {
      context.addIssue({
        code: "custom",
        message: "total visual retrieval time cannot be lower than queue plus inference time",
      });
    }
  });

export const VisualRetrievalResponseSchema = z
  .object({
    status: z.enum(["SUCCESS", "EMPTY", "UNAVAILABLE", "TIMEOUT", "ERROR"]),
    reason: z
      .enum([
        "INDEX_UNAVAILABLE",
        "PROVIDER_UNAVAILABLE",
        "QUEUE_FULL",
        "REQUEST_ABORTED",
        "DEADLINE_EXCEEDED",
        "CAPABILITY_UNSUPPORTED",
        "INVALID_RESPONSE",
      ])
      .nullable(),
    hits: z.array(VisualRetrievalHitSchema),
    index: VisualIndexIdentitySchema.nullable(),
    timing: VisualRetrievalTimingSchema,
  })
  .strict()
  .superRefine((response, context) => {
    if (response.status === "SUCCESS" && response.hits.length === 0) {
      context.addIssue({ code: "custom", message: "successful visual retrieval requires hits" });
    }
    if (response.status !== "SUCCESS" && response.hits.length > 0) {
      context.addIssue({
        code: "custom",
        message: "only successful visual retrieval can contain hits",
      });
    }
    if (
      (response.status === "SUCCESS" || response.status === "EMPTY")
      !== (response.index !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "evaluated visual responses require index identity",
      });
    }
    if (
      (response.status === "SUCCESS" || response.status === "EMPTY")
      !== (response.reason === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "only failed visual responses require a reason",
      });
    }
    const ranks = response.hits.map(({ rank }) => rank).sort((left, right) => left - right);
    if (ranks.some((rank, index) => rank !== index + 1)) {
      context.addIssue({
        code: "custom",
        message: "visual hit ranks must be unique and contiguous from one",
      });
    }
    const assetIds = response.hits.map(({ assetId }) => assetId);
    if (new Set(assetIds).size !== assetIds.length) {
      context.addIssue({ code: "custom", message: "visual hits must be unique by asset id" });
    }
  });

export type VisualRetrieverCapabilities = z.infer<typeof VisualRetrieverCapabilitiesSchema>;
export type VisualIndexIdentity = z.infer<typeof VisualIndexIdentitySchema>;
export type VisualRetrieverQuery = z.infer<typeof VisualRetrieverQuerySchema>;
export type VisualRetrieverOptions = z.infer<typeof VisualRetrieverOptionsSchema>;
export type VisualRetrievalResponse = z.infer<typeof VisualRetrievalResponseSchema>;

export type VisualRetrieverContext = {
  signal?: AbortSignal;
};

export interface VisualRetriever {
  capabilities(): VisualRetrieverCapabilities;
  retrieve(
    query: VisualRetrieverQuery,
    options: VisualRetrieverOptions,
    context?: VisualRetrieverContext,
  ): Promise<VisualRetrievalResponse>;
  resourceSnapshot?(): VisualRetrieverResourceSnapshotV2;
}

export type VisualRetrieverResourceSnapshotV2 = Readonly<{
  active: number;
  queueDepth: number;
  maxQueue: number;
  cacheEntries: number;
  maxCacheEntries: number;
  cacheHits: number;
  cacheMisses: number;
}>;

export type VisualRetrieverTransport = (
  query: VisualRetrieverQuery,
  options: VisualRetrieverOptions,
  context: { signal: AbortSignal },
) => Promise<unknown>;

type QueuedOperation<T> = {
  signal: AbortSignal;
  resolve: (value: { queueMs: number; value: T }) => void;
  reject: (error: unknown) => void;
  run: () => Promise<T>;
  queuedAt: number;
  abort: () => void;
};

class VisualQueueFullError extends Error {}
class VisualRequestAbortedError extends Error {}

function monotonicMilliseconds() {
  return performance.now();
}

function createBoundedExecutor(input: {
  concurrency: number;
  maxQueue: number;
  now: () => number;
}) {
  if (!Number.isInteger(input.concurrency) || input.concurrency < 1) {
    throw new RangeError("visual retrieval concurrency must be a positive integer");
  }
  if (!Number.isInteger(input.maxQueue) || input.maxQueue < 0) {
    throw new RangeError("visual retrieval queue limit must be a nonnegative integer");
  }
  let active = 0;
  const queue: Array<QueuedOperation<unknown>> = [];

  function start<T>(operation: QueuedOperation<T>) {
    active += 1;
    operation.signal.removeEventListener("abort", operation.abort);
    const queueMs = input.now() - operation.queuedAt;
    operation.run()
      .then((value) => operation.resolve({ queueMs, value }))
      .catch(operation.reject)
      .finally(() => {
        active -= 1;
        while (queue.length > 0) {
          const next = queue.shift()!;
          if (next.signal.aborted) continue;
          start(next);
          break;
        }
      });
  }

  return {
    execute<T>(run: () => Promise<T>, signal: AbortSignal) {
      if (signal.aborted) return Promise.reject(new VisualRequestAbortedError());
      return new Promise<{ queueMs: number; value: T }>((resolve, reject) => {
        const operation: QueuedOperation<T> = {
          signal,
          resolve,
          reject,
          run,
          queuedAt: input.now(),
          abort: () => {
            const index = queue.indexOf(operation as QueuedOperation<unknown>);
            if (index >= 0) queue.splice(index, 1);
            reject(new VisualRequestAbortedError());
          },
        };
        if (active < input.concurrency) {
          start(operation);
          return;
        }
        if (queue.length >= input.maxQueue) {
          reject(new VisualQueueFullError());
          return;
        }
        queue.push(operation as QueuedOperation<unknown>);
        signal.addEventListener("abort", operation.abort, { once: true });
      });
    },
    snapshot() {
      return {
        active,
        queueDepth: queue.length,
        maxQueue: input.maxQueue,
      };
    },
  };
}

function settleAtAbort<T>(run: () => Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new VisualRequestAbortedError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new VisualRequestAbortedError()));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(run)
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

function requestDigest(
  index: VisualIndexIdentity,
  query: VisualRetrieverQuery,
  options: VisualRetrieverOptions,
) {
  return createHash("sha256")
    .update(JSON.stringify({
      indexBundleHash: index.indexBundleHash,
      mode: query.mode,
      coursePackId: query.coursePackId,
      text: "text" in query ? query.text.trim().replace(/\s+/g, " ") : null,
      queryAssetId: "queryAssetId" in query ? query.queryAssetId : null,
      excludeAssetIds: "excludeAssetIds" in query
        ? [...query.excludeAssetIds].sort()
        : [],
      topK: options.topK,
    }))
    .digest("hex");
}

function zeroTiming(totalMs = 0) {
  return {
    queueMs: 0,
    inferenceMs: 0,
    totalMs,
  };
}

function failedResponse(
  status: "UNAVAILABLE" | "TIMEOUT" | "ERROR",
  reason: Exclude<VisualRetrievalResponse["reason"], null>,
  startedAt: number,
  now: () => number,
): VisualRetrievalResponse {
  return VisualRetrievalResponseSchema.parse({
    status,
    reason,
    hits: [],
    index: null,
    timing: zeroTiming(Math.max(0, now() - startedAt)),
  });
}

function supportsQuery(capabilities: VisualRetrieverCapabilities, query: VisualRetrieverQuery) {
  if (query.mode === "TEXT_TO_IMAGE") return capabilities.textToImage;
  if (query.mode === "IMAGE_TO_IMAGE") return capabilities.imageToImage;
  return capabilities.imageTextToImage;
}

export function createGuardedVisualRetriever(input: {
  capabilities: VisualRetrieverCapabilities;
  expectedIndex: VisualIndexIdentity;
  transport: VisualRetrieverTransport;
  concurrency?: number;
  maxQueue?: number;
  maxCacheEntries?: number;
  allowedAssetCoursePacks?: ReadonlyMap<string, string>;
  now?: () => number;
}): VisualRetriever {
  const capabilities = Object.freeze(
    VisualRetrieverCapabilitiesSchema.parse(input.capabilities),
  );
  const expectedIndex = VisualIndexIdentitySchema.parse(input.expectedIndex);
  const now = input.now ?? monotonicMilliseconds;
  const maxCacheEntries = z.number().int().min(0).max(10_000).parse(
    input.maxCacheEntries ?? 128,
  );
  const executor = createBoundedExecutor({
    concurrency: input.concurrency ?? 1,
    maxQueue: input.maxQueue ?? 8,
    now,
  });
  const cache = new Map<string, VisualRetrievalResponse>();
  let cacheHits = 0;
  let cacheMisses = 0;
  const allowedAssetCoursePacks = input.allowedAssetCoursePacks
    ? new Map(input.allowedAssetCoursePacks)
    : null;

  function cloneResponse(response: VisualRetrievalResponse) {
    return VisualRetrievalResponseSchema.parse(structuredClone(response));
  }

  function cacheResult(key: string, response: VisualRetrievalResponse) {
    if (maxCacheEntries === 0) return;
    cache.delete(key);
    cache.set(key, cloneResponse(response));
    while (cache.size > maxCacheEntries) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  return {
    capabilities: () => ({ ...capabilities }),
    async retrieve(queryInput, optionsInput, context = {}) {
      const query = VisualRetrieverQuerySchema.parse(queryInput);
      const options = VisualRetrieverOptionsSchema.parse(optionsInput);
      const startedAt = now();
      if (context.signal?.aborted) {
        return failedResponse("UNAVAILABLE", "REQUEST_ABORTED", startedAt, now);
      }
      if (!supportsQuery(capabilities, query)) {
        return failedResponse(
          "UNAVAILABLE",
          "CAPABILITY_UNSUPPORTED",
          startedAt,
          now,
        );
      }
      const cacheKey = requestDigest(expectedIndex, query, options);
      const cached = cache.get(cacheKey);
      if (cached) {
        cacheHits += 1;
        if (context.signal?.aborted) {
          return failedResponse("UNAVAILABLE", "REQUEST_ABORTED", startedAt, now);
        }
        cache.delete(cacheKey);
        cache.set(cacheKey, cached);
        const cloned = cloneResponse(cached);
        return {
          ...cloned,
          timing: zeroTiming(Math.max(0, now() - startedAt)),
        };
      }
      cacheMisses += 1;

      const timeoutController = new AbortController();
      const timeout = setTimeout(() => {
        timeoutController.abort(new Error("visual retrieval timeout"));
      }, options.timeoutMs);
      const signal = context.signal
        ? AbortSignal.any([context.signal, timeoutController.signal])
        : timeoutController.signal;
      try {
        const queued = await executor.execute(
          () => settleAtAbort(
            () => input.transport(query, options, { signal }),
            signal,
          ),
          signal,
        );
        if (signal.aborted) throw new VisualRequestAbortedError();
        const parsed = VisualRetrievalResponseSchema.parse(queued.value);
        if (
          parsed.index
          && JSON.stringify(parsed.index) !== JSON.stringify(expectedIndex)
        ) {
          return failedResponse("ERROR", "INVALID_RESPONSE", startedAt, now);
        }
        const excluded = "excludeAssetIds" in query
          ? new Set(query.excludeAssetIds)
          : new Set<string>();
        if (
          parsed.hits.length > options.topK
          || parsed.hits.some(({ assetId }) => excluded.has(assetId))
          || parsed.hits.some(({ assetId }) =>
            allowedAssetCoursePacks !== null
            && (
              !allowedAssetCoursePacks.has(assetId)
              || (
                query.coursePackId !== null
                && allowedAssetCoursePacks.get(assetId) !== query.coursePackId
              )
            ))
        ) {
          return failedResponse("ERROR", "INVALID_RESPONSE", startedAt, now);
        }
        const response = VisualRetrievalResponseSchema.parse({
          ...parsed,
          timing: {
            queueMs: queued.queueMs,
            inferenceMs: parsed.timing.inferenceMs,
            totalMs: Math.max(
              parsed.timing.inferenceMs + queued.queueMs,
              now() - startedAt,
            ),
          },
        });
        if (response.status === "SUCCESS" || response.status === "EMPTY") {
          cacheResult(cacheKey, response);
        }
        return cloneResponse(response);
      } catch (error) {
        if (error instanceof VisualQueueFullError) {
          return failedResponse("UNAVAILABLE", "QUEUE_FULL", startedAt, now);
        }
        if (context.signal?.aborted) {
          return failedResponse("UNAVAILABLE", "REQUEST_ABORTED", startedAt, now);
        }
        if (timeoutController.signal.aborted) {
          return failedResponse("TIMEOUT", "DEADLINE_EXCEEDED", startedAt, now);
        }
        if (error instanceof VisualRequestAbortedError) {
          return failedResponse("UNAVAILABLE", "REQUEST_ABORTED", startedAt, now);
        }
        if (error instanceof z.ZodError) {
          return failedResponse("ERROR", "INVALID_RESPONSE", startedAt, now);
        }
        return failedResponse("ERROR", "PROVIDER_UNAVAILABLE", startedAt, now);
      } finally {
        clearTimeout(timeout);
      }
    },
    resourceSnapshot() {
      return {
        ...executor.snapshot(),
        cacheEntries: cache.size,
        maxCacheEntries,
        cacheHits,
        cacheMisses,
      };
    },
  };
}

export type VisualFallbackResult<T> = {
  visual: VisualRetrievalResponse;
  fallback: T | null;
  outcome: "VISUAL" | "LEXICAL_FALLBACK" | "UNSUPPORTED";
};

export async function retrieveWithVisualFallback<T>(
  retriever: VisualRetriever,
  query: VisualRetrieverQuery,
  options: VisualRetrieverOptions,
  fallback: (text: string, signal?: AbortSignal) => Promise<T>,
  context: VisualRetrieverContext = {},
  fallbackTimeoutMs = Math.min(options.timeoutMs, 5_000),
): Promise<VisualFallbackResult<T>> {
  const visual = await retriever.retrieve(query, options, context);
  if (visual.status === "SUCCESS" || visual.status === "EMPTY") {
    return { visual, fallback: null, outcome: "VISUAL" };
  }
  if (query.mode === "IMAGE_TO_IMAGE") {
    return { visual, fallback: null, outcome: "UNSUPPORTED" };
  }
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    timeoutController.abort(new Error("lexical fallback timeout"));
  }, z.number().int().min(1).max(30_000).parse(fallbackTimeoutMs));
  const signal = context.signal
    ? AbortSignal.any([context.signal, timeoutController.signal])
    : timeoutController.signal;
  try {
    return {
      visual,
      fallback: await settleAtAbort(() => fallback(query.text, signal), signal),
      outcome: "LEXICAL_FALLBACK",
    };
  } finally {
    clearTimeout(timeout);
  }
}

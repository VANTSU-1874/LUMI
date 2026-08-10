import { z } from "zod";

import { CoursePackReferenceV2Schema } from "./knowledge-object-v2";
import {
  PACK_COMPETITION_CORE_ALGORITHM_V2,
  PackCompetitionDiagnosticsV2Schema,
  PackCompetitionObservationV2Schema,
} from "./pack-competition-v2";

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

export const TEXT_PACK_COMPETITION_ALGORITHM_V2 =
  Object.freeze({
    ...PACK_COMPETITION_CORE_ALGORITHM_V2,
    id: "lumi-text-vector-pack-competition-v2",
    version: "1.0.0",
    channel: "TEXT_VECTOR",
    scoreMetric: "COSINE_SIMILARITY",
    scoreSource: "L2_NORMALIZED_DOT_PRODUCT",
    representationDeduplication:
      "BEST_SCORE_THEN_REPRESENTATION_ID",
    packTieBreak:
      "SCORE_DESC_OBJECT_ID_REPRESENTATION_ID",
  } as const);

export const SELF_HOSTED_TEXT_MODEL = Object.freeze({
  id: "BAAI/bge-small-zh-v1.5",
  revision: "7999e1d3359715c523056ef9478215996d62a620",
  license: "MIT",
  dimensions: 512,
  pooling: "CLS",
  normalize: true,
  queryInstruction: "为这个句子生成表示以用于检索相关文章：",
} as const);

export const TextIndexIdentitySchema = z
  .object({
    corpusBundleHash: HashSchema,
    indexBundleHash: HashSchema,
    indexVersionId: IdSchema,
    modelId: z.literal(SELF_HOSTED_TEXT_MODEL.id),
    modelRevision: z.literal(SELF_HOSTED_TEXT_MODEL.revision)
      .and(ImmutableRevisionSchema),
  })
  .strict();

export const TextRetrieverQuerySchema = z
  .object({
    text: z.string().trim().min(1).max(2_000),
    coursePackId: CoursePackIdSchema.nullable(),
  })
  .strict();

export const TextRetrieverOptionsSchema = z
  .object({
    topK: z.number().int().min(1).max(50),
    timeoutMs: z.number().int().min(1).max(30_000),
  })
  .strict();

export const TextRetrievalHitSchema = z
  .object({
    representationId: IdSchema,
    nodeId: IdSchema,
    objectId: IdSchema,
    coursePackId: CoursePackIdSchema,
    rank: z.number().int().positive(),
    score: z.number().finite().optional(),
    sourceKind: z.enum(["NODE", "SOURCE_CAPTION"]),
    nodeKind: z.enum(["DOCUMENT", "SECTION", "TEXT", "IMAGE"]),
    role: z
      .enum(["CONTENT", "FACT", "ACTION", "CAPTION", "OCR", "TABLE_TEXT"])
      .nullable(),
    contentHash: HashSchema,
  })
  .strict()
  .superRefine((hit, context) => {
    if (
      hit.sourceKind === "SOURCE_CAPTION"
      && (hit.nodeKind !== "IMAGE" || hit.role !== "CAPTION")
    ) {
      context.addIssue({
        code: "custom",
        message: "source caption hits must target an image node with caption role",
      });
    }
    if (
      hit.sourceKind === "NODE"
      && (
        hit.nodeKind === "IMAGE"
        || (hit.nodeKind === "TEXT" ? hit.role === null : hit.role !== null)
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "native node hits must preserve node kind and text-role semantics",
      });
    }
  });

export const TextObjectCandidateNodeSchema = z
  .object({
    representationId: IdSchema,
    nodeId: IdSchema,
    innerRank: z.number().int().min(1).max(3),
    score: z.number().finite(),
    sourceKind: z.literal("NODE"),
    nodeKind: z.literal("TEXT"),
    role: z
      .enum(["CONTENT", "FACT", "ACTION", "OCR", "TABLE_TEXT"]),
    contentHash: HashSchema,
  })
  .strict();

export const TextObjectCandidateSchema = z
  .object({
    objectId: IdSchema,
    coursePackId: CoursePackIdSchema,
    objectRank: z.number().int().min(1).max(10),
    objectScore: z.number().finite(),
    nodes: z.array(TextObjectCandidateNodeSchema).min(1).max(3),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.nodes[0]?.score !== candidate.objectScore) {
      context.addIssue({
        code: "custom",
        path: ["objectScore"],
        message: "object score must equal the strongest eligible node score",
      });
    }
    if (candidate.nodes.some(({ innerRank }, index) => innerRank !== index + 1)) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "object candidate node ranks must be contiguous from one",
      });
    }
    const nodeIds = candidate.nodes.map(({ nodeId }) => nodeId);
    const representationIds = candidate.nodes.map(
      ({ representationId }) => representationId,
    );
    if (
      new Set(nodeIds).size !== nodeIds.length
      || new Set(representationIds).size !== representationIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "object candidate nodes and representations must be unique",
      });
    }
  });

export const TextRetrievalDiagnosticsWireSchema = z
  .object({
    packCompetition: PackCompetitionDiagnosticsV2Schema,
  })
  .strict();

export const TextRetrievalDiagnosticsSchema = PackCompetitionObservationV2Schema;

export function parseTextRetrievalDiagnosticsV1(input: unknown) {
  const normalized = TextRetrievalDiagnosticsSchema.safeParse(input);
  if (normalized.success) return normalized.data;
  if (input === undefined || input === null) {
    return TextRetrievalDiagnosticsSchema.parse({
      status: "UNAVAILABLE",
      reason: "NOT_PROVIDED",
      packCompetition: null,
    });
  }
  const wire = TextRetrievalDiagnosticsWireSchema.safeParse(input);
  if (wire.success) {
    return TextRetrievalDiagnosticsSchema.parse({
      status: "AVAILABLE",
      reason: null,
      packCompetition: wire.data.packCompetition,
    });
  }
  return TextRetrievalDiagnosticsSchema.parse({
    status: "INVALID",
    reason: "SCHEMA_INVALID",
    packCompetition: null,
  });
}

function diagnosticsTargetMismatch(
  diagnostics: z.infer<typeof TextRetrievalDiagnosticsSchema>,
  query: z.infer<typeof TextRetrieverQuerySchema>,
  allowedTargets: ReadonlyMap<string, TextTargetScope> | null,
) {
  if (diagnostics.status !== "AVAILABLE") return false;
  const packCompetition = diagnostics.packCompetition;
  if (packCompetition.sourceScope.coursePackId !== query.coursePackId) return true;
  if (allowedTargets === null) return false;
  const uniqueObjectsByPack = new Map<string, Set<string>>();
  for (const target of allowedTargets.values()) {
    const objects = uniqueObjectsByPack.get(target.coursePackId) ?? new Set<string>();
    objects.add(target.objectId);
    uniqueObjectsByPack.set(target.coursePackId, objects);
  }
  return packCompetition.perPackWinners.some((winner) => {
    const target = allowedTargets.get(winner.nodeId);
    return target === undefined
      || target.objectId !== winner.objectId
      || target.coursePackId !== winner.coursePackId
      || uniqueObjectsByPack.get(winner.coursePackId)?.size !== winner.objectCount;
  });
}

const TextRetrievalDiagnosticsFieldSchema = z
  .unknown()
  .optional()
  .transform((input) => parseTextRetrievalDiagnosticsV1(input));

export const TextRetrievalTimingSchema = z
  .object({
    inferenceMs: z.number().finite().nonnegative(),
    totalMs: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((timing, context) => {
    if (timing.totalMs + Number.EPSILON < timing.inferenceMs) {
      context.addIssue({
        code: "custom",
        message: "total text retrieval time cannot be lower than inference time",
      });
    }
  });

export const TextRetrievalResponseSchema = z
  .object({
    status: z.enum(["SUCCESS", "EMPTY", "UNAVAILABLE", "TIMEOUT", "ERROR"]),
    reason: z
      .enum([
        "INDEX_UNAVAILABLE",
        "PROVIDER_UNAVAILABLE",
        "REQUEST_ABORTED",
        "DEADLINE_EXCEEDED",
        "INVALID_RESPONSE",
      ])
      .nullable(),
    hits: z.array(TextRetrievalHitSchema),
    objectCandidates: z.array(TextObjectCandidateSchema).max(10).default([]),
    index: TextIndexIdentitySchema.nullable(),
    timing: TextRetrievalTimingSchema,
    diagnostics: TextRetrievalDiagnosticsFieldSchema,
  })
  .strict()
  .superRefine((response, context) => {
    const evaluated = response.status === "SUCCESS" || response.status === "EMPTY";
    if (response.status === "SUCCESS" && response.hits.length === 0) {
      context.addIssue({ code: "custom", message: "successful text retrieval requires hits" });
    }
    if (response.status !== "SUCCESS" && response.hits.length > 0) {
      context.addIssue({
        code: "custom",
        message: "only successful text retrieval can contain hits",
      });
    }
    if (evaluated !== (response.index !== null)) {
      context.addIssue({
        code: "custom",
        message: "evaluated text responses require index identity",
      });
    }
    if (evaluated !== (response.reason === null)) {
      context.addIssue({
        code: "custom",
        message: "only failed text responses require a reason",
      });
    }
    const ranks = response.hits.map(({ rank }) => rank).sort((left, right) => left - right);
    if (ranks.some((rank, index) => rank !== index + 1)) {
      context.addIssue({
        code: "custom",
        message: "text hit ranks must be unique and contiguous from one",
      });
    }
    const representationIds = response.hits.map(({ representationId }) => representationId);
    if (new Set(representationIds).size !== representationIds.length) {
      context.addIssue({
        code: "custom",
        message: "text hits must be unique by representation id",
      });
    }
    const objectIds = response.objectCandidates.map(({ objectId }) => objectId);
    if (new Set(objectIds).size !== objectIds.length) {
      context.addIssue({
        code: "custom",
        path: ["objectCandidates"],
        message: "text object candidates must be unique by object id",
      });
    }
    if (response.objectCandidates.some(
      ({ objectRank }, index) => objectRank !== index + 1,
    )) {
      context.addIssue({
        code: "custom",
        path: ["objectCandidates"],
        message: "text object candidate ranks must be contiguous from one",
      });
    }
    if (
      response.status !== "SUCCESS"
      && response.objectCandidates.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["objectCandidates"],
        message: "only successful text retrieval can contain object candidates",
      });
    }
  });

export type TextIndexIdentity = z.infer<typeof TextIndexIdentitySchema>;
export type TextRetrieverQuery = z.infer<typeof TextRetrieverQuerySchema>;
export type TextRetrieverOptions = z.infer<typeof TextRetrieverOptionsSchema>;
export type TextRetrievalHit = z.infer<typeof TextRetrievalHitSchema>;
export type TextObjectCandidate = z.infer<typeof TextObjectCandidateSchema>;
export type TextRetrievalDiagnostics = z.infer<typeof TextRetrievalDiagnosticsSchema>;
export type TextRetrievalResponse = z.infer<typeof TextRetrievalResponseSchema>;

export type TextRetrieverContext = {
  signal?: AbortSignal;
};

export interface TextRetriever {
  retrieve(
    query: TextRetrieverQuery,
    options: TextRetrieverOptions,
    context?: TextRetrieverContext,
  ): Promise<TextRetrievalResponse>;
}

export type TextRetrieverTransport = (
  query: TextRetrieverQuery,
  options: TextRetrieverOptions,
  context: { signal: AbortSignal },
) => Promise<unknown>;

export type TextTargetScope = {
  objectId: string;
  coursePackId: string;
};

class TextRequestAbortedError extends Error {}

function monotonicMilliseconds() {
  return performance.now();
}

function sameIdentity(left: TextIndexIdentity, right: TextIndexIdentity) {
  return left.corpusBundleHash === right.corpusBundleHash
    && left.indexBundleHash === right.indexBundleHash
    && left.indexVersionId === right.indexVersionId
    && left.modelId === right.modelId
    && left.modelRevision === right.modelRevision;
}

function failedResponse(
  status: "UNAVAILABLE" | "TIMEOUT" | "ERROR",
  reason: Exclude<TextRetrievalResponse["reason"], null>,
  startedAt: number,
  now: () => number,
): TextRetrievalResponse {
  return TextRetrievalResponseSchema.parse({
    status,
    reason,
    hits: [],
    index: null,
    timing: {
      inferenceMs: 0,
      totalMs: Math.max(0, now() - startedAt),
    },
  });
}

function settleAtAbort<T>(run: () => Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new TextRequestAbortedError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new TextRequestAbortedError()));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(run)
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

export function createGuardedTextRetriever(input: {
  expectedIndex: TextIndexIdentity;
  transport: TextRetrieverTransport;
  allowedTargets?: ReadonlyMap<string, TextTargetScope>;
  now?: () => number;
}): TextRetriever {
  const expectedIndex = TextIndexIdentitySchema.parse(input.expectedIndex);
  const allowedTargets = input.allowedTargets ? new Map(input.allowedTargets) : null;
  const now = input.now ?? monotonicMilliseconds;

  return {
    async retrieve(queryInput, optionsInput, context = {}) {
      const query = TextRetrieverQuerySchema.parse(queryInput);
      const options = TextRetrieverOptionsSchema.parse(optionsInput);
      const startedAt = now();
      if (context.signal?.aborted) {
        return failedResponse("UNAVAILABLE", "REQUEST_ABORTED", startedAt, now);
      }
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => {
        timeoutController.abort(new Error("text retrieval timeout"));
      }, options.timeoutMs);
      const signal = context.signal
        ? AbortSignal.any([context.signal, timeoutController.signal])
        : timeoutController.signal;
      try {
        const raw = await settleAtAbort(
          () => input.transport(query, options, { signal }),
          signal,
        );
        const response = TextRetrievalResponseSchema.parse(raw);
        if (response.index && !sameIdentity(response.index, expectedIndex)) {
          return failedResponse("ERROR", "INVALID_RESPONSE", startedAt, now);
        }
        if (
          response.hits.length > options.topK
          || response.hits.some((hit) =>
            query.coursePackId !== null && hit.coursePackId !== query.coursePackId)
          || response.objectCandidates.some((candidate) =>
            query.coursePackId !== null
            && candidate.coursePackId !== query.coursePackId)
          || response.hits.some((hit) => {
            if (allowedTargets === null) return false;
            const scope = allowedTargets.get(hit.nodeId);
            return !scope
              || scope.objectId !== hit.objectId
              || scope.coursePackId !== hit.coursePackId;
          })
          || response.objectCandidates.some((candidate) =>
            candidate.nodes.some((node) => {
              if (allowedTargets === null) return false;
              const scope = allowedTargets.get(node.nodeId);
              return !scope
                || scope.objectId !== candidate.objectId
                || scope.coursePackId !== candidate.coursePackId;
            }))
        ) {
          return failedResponse("ERROR", "INVALID_RESPONSE", startedAt, now);
        }
        const diagnostics = diagnosticsTargetMismatch(
          response.diagnostics,
          query,
          allowedTargets,
        )
          ? TextRetrievalDiagnosticsSchema.parse({
              status: "INVALID",
              reason: "SCHEMA_INVALID",
              packCompetition: null,
            })
          : response.diagnostics;
        return TextRetrievalResponseSchema.parse({
          ...response,
          diagnostics,
          timing: {
            inferenceMs: response.timing.inferenceMs,
            totalMs: Math.max(response.timing.inferenceMs, now() - startedAt),
          },
        });
      } catch (error) {
        if (context.signal?.aborted) {
          return failedResponse("UNAVAILABLE", "REQUEST_ABORTED", startedAt, now);
        }
        if (timeoutController.signal.aborted) {
          return failedResponse("TIMEOUT", "DEADLINE_EXCEEDED", startedAt, now);
        }
        if (error instanceof z.ZodError) {
          return failedResponse("ERROR", "INVALID_RESPONSE", startedAt, now);
        }
        return failedResponse("UNAVAILABLE", "PROVIDER_UNAVAILABLE", startedAt, now);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export type TextFallbackResult<T> = {
  textVector: TextRetrievalResponse;
  fallback: T | null;
  outcome: "TEXT_VECTOR" | "EMPTY" | "LEXICAL_FALLBACK";
};

export async function retrieveWithTextFallback<T>(
  retriever: TextRetriever,
  query: TextRetrieverQuery,
  options: TextRetrieverOptions,
  fallback: (text: string, signal?: AbortSignal) => Promise<T>,
  context: TextRetrieverContext = {},
  fallbackTimeoutMs = Math.min(options.timeoutMs, 5_000),
): Promise<TextFallbackResult<T>> {
  const textVector = await retriever.retrieve(query, options, context);
  if (textVector.status === "SUCCESS") {
    return { textVector, fallback: null, outcome: "TEXT_VECTOR" };
  }
  if (textVector.status === "EMPTY") {
    return { textVector, fallback: null, outcome: "EMPTY" };
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
      textVector,
      fallback: await settleAtAbort(() => fallback(query.text, signal), signal),
      outcome: "LEXICAL_FALLBACK",
    };
  } finally {
    clearTimeout(timeout);
  }
}

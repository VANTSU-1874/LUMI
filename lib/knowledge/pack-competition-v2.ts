import { z } from "zod";

import { CoursePackReferenceV2Schema } from "./knowledge-object-v2";

const ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const IdSchema = z.string().regex(ID, "expected a stable lowercase identifier");
const CoursePackIdSchema = CoursePackReferenceV2Schema.shape.id;

export const PACK_COMPETITION_CORE_ALGORITHM_V2 = Object.freeze({
  id: "lumi-pack-competition-core-v2",
  version: "1.0.0",
  schemaVersion: 1,
  objectDeduplication: "BEST_REPRESENTATION_PER_OBJECT",
  packWinnerSelection: "BEST_OBJECT_PER_PACK",
  globalWinnerSelection: "BEST_PACK_WINNER",
  stableTieBreak:
    "SCORE_DESC_PACK_ID_OBJECT_ID_REPRESENTATION_ID",
} as const);

export const PackCompetitionWinnerV2Schema = z
  .object({
    coursePackId: CoursePackIdSchema,
    objectCount: z.number().int().positive().max(1_000_000),
    objectId: IdSchema,
    representationId: IdSchema.nullable(),
    nodeId: IdSchema,
    score: z.number().finite().min(-1.0001).max(1.0001),
  })
  .strict();

function sameWinner(
  left: z.infer<typeof PackCompetitionWinnerV2Schema> | null,
  right: z.infer<typeof PackCompetitionWinnerV2Schema> | null,
) {
  if (left === null || right === null) return left === right;
  return left.coursePackId === right.coursePackId
    && left.objectCount === right.objectCount
    && left.objectId === right.objectId
    && left.representationId === right.representationId
    && left.nodeId === right.nodeId
    && left.score === right.score;
}

function winnerOrder(
  left: z.infer<typeof PackCompetitionWinnerV2Schema>,
  right: z.infer<typeof PackCompetitionWinnerV2Schema>,
) {
  if (left.score !== right.score) return right.score - left.score;
  if (left.coursePackId !== right.coursePackId) {
    return left.coursePackId < right.coursePackId ? -1 : 1;
  }
  if (left.objectId !== right.objectId) return left.objectId < right.objectId ? -1 : 1;
  if (left.representationId === right.representationId) return 0;
  if (left.representationId === null) return -1;
  if (right.representationId === null) return 1;
  return left.representationId < right.representationId ? -1 : 1;
}

export const PackCompetitionDiagnosticsV2Schema = z
  .object({
    schemaVersion: z.literal(1),
    scoreMetric: z.enum([
      "COSINE_SIMILARITY",
      "LEXICAL_NORMALIZED_SCORE",
    ]),
    objectDeduplication: z.literal("BEST_REPRESENTATION_PER_OBJECT"),
    packWinnerSelection: z.literal("BEST_OBJECT_PER_PACK"),
    globalWinnerSelection: z.literal("BEST_PACK_WINNER"),
    sourceScope: z
      .object({
        coursePackId: CoursePackIdSchema.nullable(),
      })
      .strict(),
    scoredRepresentationCount: z.number().int().nonnegative().max(1_000_000),
    deduplicatedObjectCount: z.number().int().nonnegative().max(1_000_000),
    perPackWinners: z.array(PackCompetitionWinnerV2Schema).max(20),
    globalWinner: PackCompetitionWinnerV2Schema.nullable(),
    scopedWinner: PackCompetitionWinnerV2Schema.nullable(),
    globalToScopedMargin: z.number().finite().min(-0.0001).max(2.0001).nullable(),
  })
  .strict()
  .superRefine((diagnostics, context) => {
    if (diagnostics.scoredRepresentationCount < diagnostics.deduplicatedObjectCount) {
      context.addIssue({
        code: "custom",
        message: "scored representation count cannot be lower than deduplicated object count",
      });
    }
    const packIds = diagnostics.perPackWinners.map(({ coursePackId }) => coursePackId);
    if (new Set(packIds).size !== packIds.length) {
      context.addIssue({
        code: "custom",
        message: "pack competition winners must be unique by course pack",
      });
    }
    const sortedPackIds = [...packIds].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0);
    if (packIds.some((packId, index) => packId !== sortedPackIds[index])) {
      context.addIssue({
        code: "custom",
        message: "pack competition winners must be sorted by course pack id",
      });
    }
    const winnerObjectIds = diagnostics.perPackWinners.map(({ objectId }) => objectId);
    if (new Set(winnerObjectIds).size !== winnerObjectIds.length) {
      context.addIssue({
        code: "custom",
        message: "pack competition winners must be unique by object id",
      });
    }
    const declaredObjectCount = diagnostics.perPackWinners.reduce(
      (total, winner) => total + winner.objectCount,
      0,
    );
    if (declaredObjectCount !== diagnostics.deduplicatedObjectCount) {
      context.addIssue({
        code: "custom",
        message: "pack object counts must equal the deduplicated object count",
      });
    }
    const expectedGlobal = [...diagnostics.perPackWinners].sort(winnerOrder)[0] ?? null;
    if (!sameWinner(diagnostics.globalWinner, expectedGlobal)) {
      context.addIssue({
        code: "custom",
        message: "global winner must be the strongest stable per-pack winner",
      });
    }
    const sourcePackId = diagnostics.sourceScope.coursePackId;
    const expectedScoped = sourcePackId === null
      ? null
      : diagnostics.perPackWinners.find(({ coursePackId }) =>
          coursePackId === sourcePackId) ?? null;
    if (!sameWinner(diagnostics.scopedWinner, expectedScoped)) {
      context.addIssue({
        code: "custom",
        message: "scoped winner must match the source course pack winner",
      });
    }
    const expectedMargin = expectedGlobal !== null && expectedScoped !== null
      ? expectedGlobal.score - expectedScoped.score
      : null;
    if (
      expectedMargin === null
        ? diagnostics.globalToScopedMargin !== null
        : diagnostics.globalToScopedMargin === null
          || Math.abs(diagnostics.globalToScopedMargin - expectedMargin) > 1e-12
    ) {
      context.addIssue({
        code: "custom",
        message: "global-to-scoped margin must equal the declared winner score delta",
      });
    }
  });

export const PackCompetitionObservationV2Schema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("AVAILABLE"),
      reason: z.null(),
      packCompetition: PackCompetitionDiagnosticsV2Schema,
    })
    .strict(),
  z
    .object({
      status: z.literal("UNAVAILABLE"),
      reason: z.enum(["NOT_PROVIDED", "CHANNEL_NOT_EVALUATED"]),
      packCompetition: z.null(),
    })
    .strict(),
  z
    .object({
      status: z.literal("INVALID"),
      reason: z.literal("SCHEMA_INVALID"),
      packCompetition: z.null(),
    })
    .strict(),
]);

export type PackCompetitionWinnerV2 = z.infer<typeof PackCompetitionWinnerV2Schema>;
export type PackCompetitionDiagnosticsV2 = z.infer<
  typeof PackCompetitionDiagnosticsV2Schema
>;
export type PackCompetitionObservationV2 = z.infer<
  typeof PackCompetitionObservationV2Schema
>;

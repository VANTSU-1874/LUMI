import { createHash } from "node:crypto";

import { z } from "zod";

import {
  CoursePackReferenceV2Schema,
  sha256StableJsonV2,
} from "./knowledge-object-v2";
import { normalizeRetrievalTextV2 } from "./retrieval-query-v2";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const VERSION_PATTERN = /^\d+(?:\.\d+){0,2}$/;
const SOURCE_PATTERN = /^(?:CURRENT_MESSAGE|RECENT_TURN_[12])$/;

const HashSchema = z.string().regex(HASH_PATTERN);
const BoundedTextSchema = z.string().trim().min(1).max(2_000);
const SourceSchema = z
  .string()
  .regex(SOURCE_PATTERN)
  .pipe(z.enum([
    "CURRENT_MESSAGE",
    "RECENT_TURN_1",
    "RECENT_TURN_2",
  ]));

export const ANSWER_OBLIGATION_PLANNER_ID_V1 =
  "lumi-answer-obligation-planner-v1" as const;

export const ANSWER_OBLIGATION_LIMITS_V1 = Object.freeze({
  maximumObligations: 4,
  maximumQueriesPerObligation: 2,
  minimumObligationConfidence: 0.70,
  maximumSourceAnchors: 4,
  maximumEntityMentions: 8,
  maximumConstraints: 8,
  maximumArtworkObservationHints: 8,
});

export const AnswerIntentV1Schema = z.enum([
  "DIAGNOSE_CAUSE",
  "FIRST_ACTION",
  "HOW_TO",
  "CHECK_CRITERIA",
  "EVIDENCE_FOR",
  "RISK_MITIGATION",
  "COMPARE_TRADEOFF",
  "EXPLAIN_CONCEPT",
  "VERIFY_FACT",
]);

export const EvidenceNeedV1Schema = z.enum([
  "DIRECT_TEXT",
  "VISUAL_EXAMPLE",
  "RELATION_PATH",
]);

export const RetrievalQueryPurposeV1Schema = z.enum([
  "DIRECT",
  "CONTEXT",
  "ALIAS",
]);

const SourceMessageV1Schema = z
  .object({
    source: SourceSchema,
    message: BoundedTextSchema,
    messageHash: HashSchema,
  })
  .strict()
  .superRefine((message, context) => {
    if (sha256Utf8V1(message.message) !== message.messageHash) {
      context.addIssue({
        code: "custom",
        path: ["messageHash"],
        message: "source message hash mismatch",
      });
    }
  });

const CoursePackContextV1Schema = CoursePackReferenceV2Schema
  .extend({
    label: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const QueryUnderstandingInputV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    currentMessage: SourceMessageV1Schema,
    recentTurns: z.array(SourceMessageV1Schema).max(2),
    coursePack: CoursePackContextV1Schema,
    view: z
      .object({
        id: z.string().trim().min(1).max(120),
        focus: z.string().trim().min(1).max(200).nullable(),
      })
      .strict(),
    hasArtwork: z.boolean(),
    artworkHash: HashSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.currentMessage.source !== "CURRENT_MESSAGE") {
      context.addIssue({
        code: "custom",
        path: ["currentMessage", "source"],
        message: "current message must use CURRENT_MESSAGE",
      });
    }
    input.recentTurns.forEach((turn, index) => {
      if (turn.source !== `RECENT_TURN_${index + 1}`) {
        context.addIssue({
          code: "custom",
          path: ["recentTurns", index, "source"],
          message: "recent turn source order mismatch",
        });
      }
    });
    if (input.hasArtwork !== (input.artworkHash !== null)) {
      context.addIssue({
        code: "custom",
        path: ["artworkHash"],
        message: "artwork presence and hash must agree",
      });
    }
  });

const SourceAnchorV1Schema = z
  .object({
    source: SourceSchema,
    sourceMessageHash: HashSchema,
    quote: z.string().min(1).max(2_000),
    startCodePoint: z.number().int().min(0).max(2_000),
    endCodePoint: z.number().int().min(1).max(2_000),
  })
  .strict()
  .refine(
    (anchor) => anchor.endCodePoint > anchor.startCodePoint,
    {
      path: ["endCodePoint"],
      message: "source anchor end must follow start",
    },
  );

const EntityMentionV1Schema = z
  .object({
    surface: z.string().trim().min(1).max(200),
    normalized: z.string().trim().min(1).max(200),
    anchorIndexes: z.array(z.number().int().min(0).max(3))
      .min(1)
      .max(4),
  })
  .strict();

const ObligationConstraintV1Schema = z
  .object({
    text: z.string().trim().min(1).max(500),
    anchorIndexes: z.array(z.number().int().min(0).max(3))
      .min(1)
      .max(4),
  })
  .strict();

const RetrievalQuerySuggestionV1Schema = z
  .object({
    text: z.string().trim().min(1).max(500).refine(
      (value) => normalizeRetrievalTextV2(value).length > 0,
      "retrieval query normalizes to empty",
    ),
    purpose: RetrievalQueryPurposeV1Schema,
  })
  .strict();

const ModelAnswerObligationV1Schema = z
  .object({
    learnerNeed: z.string().trim().min(1).max(1_000),
    intent: AnswerIntentV1Schema,
    sourceAnchors: z.array(SourceAnchorV1Schema)
      .min(1)
      .max(ANSWER_OBLIGATION_LIMITS_V1.maximumSourceAnchors),
    entityMentions: z.array(EntityMentionV1Schema)
      .max(ANSWER_OBLIGATION_LIMITS_V1.maximumEntityMentions),
    constraints: z.array(ObligationConstraintV1Schema)
      .max(ANSWER_OBLIGATION_LIMITS_V1.maximumConstraints),
    evidenceNeeds: z.array(EvidenceNeedV1Schema)
      .min(1)
      .max(3),
    retrievalQueries: z.array(RetrievalQuerySuggestionV1Schema)
      .min(1)
      .max(ANSWER_OBLIGATION_LIMITS_V1.maximumQueriesPerObligation),
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((obligation, context) => {
    if (
      new Set(obligation.evidenceNeeds).size
      !== obligation.evidenceNeeds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceNeeds"],
        message: "evidence needs must be unique",
      });
    }
    const normalizedQueries = obligation.retrievalQueries.map(
      ({ text }) => normalizeRetrievalTextV2(text),
    );
    if (new Set(normalizedQueries).size !== normalizedQueries.length) {
      context.addIssue({
        code: "custom",
        path: ["retrievalQueries"],
        message: "retrieval queries must be unique after normalization",
      });
    }
  });

const ArtworkObservationHintV1Schema = z
  .object({
    artworkHash: HashSchema,
    visibleCue: z.string().trim().min(1).max(500),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const ModelAnswerObligationPayloadV1Schema = z
  .object({
    status: z.enum(["READY", "CLARIFY"]),
    obligations: z.array(ModelAnswerObligationV1Schema)
      .min(1)
      .max(ANSWER_OBLIGATION_LIMITS_V1.maximumObligations),
    clarifyingQuestion: z.string().trim().min(1).max(500).nullable(),
    artworkObservationHints: z.array(ArtworkObservationHintV1Schema)
      .max(ANSWER_OBLIGATION_LIMITS_V1.maximumArtworkObservationHints),
  })
  .strict()
  .superRefine((payload, context) => {
    if (
      payload.status === "READY"
      && payload.clarifyingQuestion !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["clarifyingQuestion"],
        message: "ready payload cannot ask for clarification",
      });
    }
    if (
      payload.status === "CLARIFY"
      && payload.clarifyingQuestion === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["clarifyingQuestion"],
        message: "clarify payload requires a question",
      });
    }
  });

export const AnswerObligationV1Schema =
  ModelAnswerObligationV1Schema.extend({
    obligationId: z.string().regex(/^obligation-[1-4]$/),
  }).strict();

const PlannerTraceV1Schema = z
  .object({
    promptHash: HashSchema,
    outputHash: HashSchema,
    elapsedMs: z.number().int().min(0).max(120_000),
  })
  .strict();

export const AnswerObligationSetV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    plannerId: z.literal(ANSWER_OBLIGATION_PLANNER_ID_V1),
    plannerVersion: z.string().regex(VERSION_PATTERN),
    modelId: z.string().trim().min(1).max(200),
    normalizedQuestion: z.string().min(1).max(500),
    normalizedQuestionHash: HashSchema,
    status: z.enum(["READY", "CLARIFY", "DEGRADED"]),
    obligations: z.array(AnswerObligationV1Schema)
      .min(1)
      .max(ANSWER_OBLIGATION_LIMITS_V1.maximumObligations),
    clarifyingQuestion: z.string().trim().min(1).max(500).nullable(),
    artworkObservationHints: z.array(ArtworkObservationHintV1Schema)
      .max(ANSWER_OBLIGATION_LIMITS_V1.maximumArtworkObservationHints),
    trace: PlannerTraceV1Schema,
  })
  .strict()
  .superRefine((set, context) => {
    if (
      sha256Utf8V1(set.normalizedQuestion)
      !== set.normalizedQuestionHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["normalizedQuestionHash"],
        message: "normalized question hash mismatch",
      });
    }
    if (
      set.status === "READY"
      && (
        set.clarifyingQuestion !== null
        || set.obligations.some(({ confidence }) =>
          confidence
          < ANSWER_OBLIGATION_LIMITS_V1.minimumObligationConfidence)
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "ready set requires confident obligations and no question",
      });
    }
    if (
      set.status === "CLARIFY"
      && set.clarifyingQuestion === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["clarifyingQuestion"],
        message: "clarify set requires a question",
      });
    }
    if (
      set.status === "DEGRADED"
      && (
        set.clarifyingQuestion !== null
        || set.obligations.length !== 1
        || set.obligations[0]?.confidence !== 0
        || set.obligations[0]?.learnerNeed
          !== set.obligations[0]?.retrievalQueries[0]?.text
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "degraded set must contain one whole-query obligation",
      });
    }
  });

export const PlannerMetadataV1Schema = z
  .object({
    plannerVersion: z.string().regex(VERSION_PATTERN),
    modelId: z.string().trim().min(1).max(200),
    promptHash: HashSchema,
    outputHash: HashSchema,
    elapsedMs: z.number().int().min(0).max(120_000),
  })
  .strict();

export type AnswerIntentV1 = z.infer<typeof AnswerIntentV1Schema>;
export type EvidenceNeedV1 = z.infer<typeof EvidenceNeedV1Schema>;
export type QueryUnderstandingInputV1 = z.infer<
  typeof QueryUnderstandingInputV1Schema
>;
export type ModelAnswerObligationPayloadV1 = z.infer<
  typeof ModelAnswerObligationPayloadV1Schema
>;
export type AnswerObligationV1 = z.infer<
  typeof AnswerObligationV1Schema
>;
export type AnswerObligationSetV1 = z.infer<
  typeof AnswerObligationSetV1Schema
>;
export type PlannerMetadataV1 = z.infer<
  typeof PlannerMetadataV1Schema
>;

function sha256Utf8V1(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sourceMessages(
  request: QueryUnderstandingInputV1,
) {
  return new Map([
    [request.currentMessage.source, request.currentMessage],
    ...request.recentTurns.map((turn) =>
      [turn.source, turn] as const),
  ]);
}

function assertNoCanonicalEntityInjection(
  value: unknown,
) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(assertNoCanonicalEntityInjection);
    return;
  }
  for (const [key, child] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (
      /^(?:canonical(?:entity)?id|entityid)s?$/i.test(key)
    ) {
      throw new Error(
        "ANSWER_OBLIGATION_CANONICAL_ENTITY_FORBIDDEN",
      );
    }
    assertNoCanonicalEntityInjection(child);
  }
}

function assertSourceBindings(input: {
  request: QueryUnderstandingInputV1;
  payload: ModelAnswerObligationPayloadV1;
}) {
  const messages = sourceMessages(input.request);
  for (const obligation of input.payload.obligations) {
    for (const anchor of obligation.sourceAnchors) {
      const message = messages.get(anchor.source);
      const observedQuote = message
        ? Array.from(message.message)
          .slice(
            anchor.startCodePoint,
            anchor.endCodePoint,
          )
          .join("")
        : null;
      if (
        !message
        || message.messageHash !== anchor.sourceMessageHash
        || observedQuote !== anchor.quote
      ) {
        throw new Error(
          "ANSWER_OBLIGATION_SOURCE_ANCHOR_INVALID",
        );
      }
    }
    for (const binding of [
      ...obligation.entityMentions,
      ...obligation.constraints,
    ]) {
      if (binding.anchorIndexes.some(
        (index) => index >= obligation.sourceAnchors.length,
      )) {
        throw new Error(
          "ANSWER_OBLIGATION_ANCHOR_INDEX_INVALID",
        );
      }
    }
  }
}

function assertArtworkBindings(input: {
  request: QueryUnderstandingInputV1;
  payload: ModelAnswerObligationPayloadV1;
}) {
  if (
    (
      input.request.artworkHash === null
      && input.payload.artworkObservationHints.length > 0
    )
    || input.payload.artworkObservationHints.some(
      ({ artworkHash }) =>
        artworkHash !== input.request.artworkHash,
    )
  ) {
    throw new Error(
      "ANSWER_OBLIGATION_ARTWORK_HINT_INVALID",
    );
  }
}

export function validateAnswerObligationSetV1(input: {
  request: QueryUnderstandingInputV1;
  payload: unknown;
  metadata: PlannerMetadataV1;
}): AnswerObligationSetV1 {
  const request = QueryUnderstandingInputV1Schema.parse(
    input.request,
  );
  const metadata = PlannerMetadataV1Schema.parse(
    input.metadata,
  );
  assertNoCanonicalEntityInjection(input.payload);
  const payload = ModelAnswerObligationPayloadV1Schema.parse(
    input.payload,
  );
  if (
    payload.status === "READY"
    && payload.obligations.some(({ confidence }) =>
      confidence
      < ANSWER_OBLIGATION_LIMITS_V1.minimumObligationConfidence)
  ) {
    throw new Error(
      "ANSWER_OBLIGATION_LOW_CONFIDENCE_REQUIRES_CLARIFY",
    );
  }
  assertSourceBindings({ request, payload });
  assertArtworkBindings({ request, payload });
  const normalizedQuestion = normalizeRetrievalTextV2(
    request.currentMessage.message,
  );
  return AnswerObligationSetV1Schema.parse({
    schemaVersion: 1,
    plannerId: ANSWER_OBLIGATION_PLANNER_ID_V1,
    plannerVersion: metadata.plannerVersion,
    modelId: metadata.modelId,
    normalizedQuestion,
    normalizedQuestionHash: sha256Utf8V1(
      normalizedQuestion,
    ),
    status: payload.status,
    obligations: payload.obligations.map(
      (obligation, index) => ({
        obligationId: `obligation-${index + 1}`,
        ...obligation,
      }),
    ),
    clarifyingQuestion: payload.clarifyingQuestion,
    artworkObservationHints:
      payload.artworkObservationHints,
    trace: {
      promptHash: metadata.promptHash,
      outputHash: metadata.outputHash,
      elapsedMs: metadata.elapsedMs,
    },
  });
}

export function createDegradedAnswerObligationSetV1(
  input: {
    request: QueryUnderstandingInputV1;
    metadata: PlannerMetadataV1;
  },
): AnswerObligationSetV1 {
  const request = QueryUnderstandingInputV1Schema.parse(
    input.request,
  );
  const metadata = PlannerMetadataV1Schema.parse(
    input.metadata,
  );
  const normalizedQuestion = normalizeRetrievalTextV2(
    request.currentMessage.message,
  );
  return AnswerObligationSetV1Schema.parse({
    schemaVersion: 1,
    plannerId: ANSWER_OBLIGATION_PLANNER_ID_V1,
    plannerVersion: metadata.plannerVersion,
    modelId: metadata.modelId,
    normalizedQuestion,
    normalizedQuestionHash: sha256Utf8V1(
      normalizedQuestion,
    ),
    status: "DEGRADED",
    obligations: [{
      obligationId: "obligation-1",
      learnerNeed: request.currentMessage.message,
      intent: "EXPLAIN_CONCEPT",
      sourceAnchors: [{
        source: "CURRENT_MESSAGE",
        sourceMessageHash:
          request.currentMessage.messageHash,
        quote: request.currentMessage.message,
        startCodePoint: 0,
        endCodePoint: Array.from(
          request.currentMessage.message,
        ).length,
      }],
      entityMentions: [],
      constraints: [],
      evidenceNeeds: ["DIRECT_TEXT"],
      retrievalQueries: [{
        text: request.currentMessage.message,
        purpose: "DIRECT",
      }],
      confidence: 0,
    }],
    clarifyingQuestion: null,
    artworkObservationHints: [],
    trace: {
      promptHash: metadata.promptHash,
      outputHash: metadata.outputHash,
      elapsedMs: metadata.elapsedMs,
    },
  });
}

export function answerObligationSetHashV1(
  value: AnswerObligationSetV1,
) {
  const set = AnswerObligationSetV1Schema.parse(value);
  return sha256StableJsonV2({
    ...set,
    trace: {
      promptHash: set.trace.promptHash,
      outputHash: set.trace.outputHash,
    },
  });
}

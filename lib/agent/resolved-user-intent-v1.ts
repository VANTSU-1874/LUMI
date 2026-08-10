import { z } from "zod";

import {
  AnswerIntentV1Schema,
} from "@/lib/knowledge/answer-obligation-v1";

const CoursePackSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  version: z.string().regex(/^\d+$/),
}).strict();

const ResolvedReferenceSchema = z.object({
  mention: z.string().trim().min(1).max(120),
  resolvedText: z.string().trim().min(1).max(500),
  sourceTurnId:
    z.string().trim().min(1).max(128),
}).strict();

const ResolvedAnswerObligationSchema = z.object({
  obligationId:
    z.string().regex(/^obligation-[1-4]$/),
  intent: AnswerIntentV1Schema,
  query: z.string().trim().min(1).max(500),
}).strict();

const AmbiguitySchema = z.object({
  status: z.enum([
    "NONE",
    "RESOLVED",
    "CLARIFY",
  ]),
  clarifyingQuestion:
    z.string().trim().min(1).max(500).nullable(),
}).strict().superRefine((value, context) => {
  if (
    (value.status === "CLARIFY")
    !== (value.clarifyingQuestion !== null)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "clarifying question must match ambiguity state",
    });
  }
});

export const ResolvedUserIntentV1Schema = z.object({
  schemaVersion: z.literal(1),
  rawQuestion:
    z.string().trim().min(1).max(1_000),
  selfContainedQuestion:
    z.string().trim().min(1).max(1_500),
  resolvedReferences:
    z.array(ResolvedReferenceSchema).max(8),
  answerObligations:
    z.array(ResolvedAnswerObligationSchema)
      .min(1)
      .max(4),
  coursePack: CoursePackSchema,
  knowledgeQuery:
    z.string().trim().min(1).max(1_500),
  memoryQuery:
    z.string().trim().min(1).max(1_500),
  ambiguity: AmbiguitySchema,
  sourceTurnIds:
    z.array(z.string().trim().min(1).max(128))
      .max(8),
}).strict().superRefine((value, context) => {
  const sourceTurnIds = value.resolvedReferences
    .map(({ sourceTurnId }) => sourceTurnId);
  const unique = [...new Set(sourceTurnIds)];
  if (
    unique.length !== sourceTurnIds.length
    || unique.length !== value.sourceTurnIds.length
    || unique.some(
      (id, index) =>
        value.sourceTurnIds[index] !== id,
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["sourceTurnIds"],
      message:
        "source turns must be the ordered unique reference bindings",
    });
  }
  if (
    value.ambiguity.status === "RESOLVED"
    && value.resolvedReferences.length === 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["ambiguity"],
      message:
        "resolved ambiguity requires a reference binding",
    });
  }
});

export type ResolvedUserIntentV1 = z.infer<
  typeof ResolvedUserIntentV1Schema
>;

export function buildResolvedUserIntentV1(
  input: Omit<
    ResolvedUserIntentV1,
    "schemaVersion" | "sourceTurnIds"
  >,
) {
  return ResolvedUserIntentV1Schema.parse({
    schemaVersion: 1,
    ...input,
    sourceTurnIds: [
      ...new Set(input.resolvedReferences.map(
        ({ sourceTurnId }) => sourceTurnId,
      )),
    ],
  });
}

import { z } from "zod";

import {
  sha256StableJsonV2,
} from "./knowledge-object-v2";

const EvidenceIdSchema = z.string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const PostRetrievalEvidenceAssessmentV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    source: z.enum([
      "EVIDENCE_REVIEWER",
      "SEALED_EVALUATOR",
    ]),
    requiredEvidenceIds:
      z.array(EvidenceIdSchema).min(1).max(8),
    supportedEvidenceIds:
      z.array(EvidenceIdSchema).max(8),
    status: z.enum([
      "SUFFICIENT",
      "INSUFFICIENT",
    ]),
    clarifyingQuestion:
      z.string().trim().min(1).max(500).nullable(),
  })
    .strict()
    .superRefine((assessment, context) => {
      const required = new Set(
        assessment.requiredEvidenceIds,
      );
      const supported = new Set(
        assessment.supportedEvidenceIds,
      );
      const unique =
        required.size
          === assessment.requiredEvidenceIds.length
        && supported.size
          === assessment.supportedEvidenceIds.length;
      const subset = [...supported].every((id) =>
        required.has(id));
      const sufficient =
        unique
        && subset
        && [...required].every((id) =>
          supported.has(id));
      if (
        !unique
        || !subset
        || assessment.status
          !== (
            sufficient
              ? "SUFFICIENT"
              : "INSUFFICIENT"
          )
        || (
          assessment.status === "SUFFICIENT"
            ? assessment.clarifyingQuestion !== null
            : assessment.clarifyingQuestion === null
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "POST_RETRIEVAL_EVIDENCE_ASSESSMENT_INVALID",
        });
      }
    });

export type PostRetrievalEvidenceAssessmentV1 =
  z.infer<
    typeof PostRetrievalEvidenceAssessmentV1Schema
  >;

export const PostRetrievalResponseDecisionV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    authority: z.literal(
      "POST_RETRIEVAL_EVIDENCE_SUFFICIENCY",
    ),
    action: z.enum(["ANSWER", "CLARIFY"]),
    plannerStatusObserved: z.enum([
      "READY",
      "CLARIFY",
      "DEGRADED",
      "UNKNOWN",
    ]),
    reason: z.enum([
      "EVIDENCE_SUFFICIENT",
      "EVIDENCE_INSUFFICIENT",
    ]),
    clarifyingQuestion:
      z.string().trim().min(1).max(500).nullable(),
    evidenceAssessmentHash: HashSchema,
  })
    .strict()
    .superRefine((decision, context) => {
      const sufficient =
        decision.reason === "EVIDENCE_SUFFICIENT";
      if (
        decision.action
          !== (sufficient ? "ANSWER" : "CLARIFY")
        || (
          sufficient
            ? decision.clarifyingQuestion !== null
            : decision.clarifyingQuestion === null
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "POST_RETRIEVAL_RESPONSE_DECISION_INVALID",
        });
      }
    });

export type PostRetrievalResponseDecisionV1 =
  z.infer<
    typeof PostRetrievalResponseDecisionV1Schema
  >;

export function decidePostRetrievalResponseV1(input: {
  plannerStatusObserved:
    | "READY"
    | "CLARIFY"
    | "DEGRADED"
    | "UNKNOWN";
  evidenceAssessment:
    PostRetrievalEvidenceAssessmentV1;
}): PostRetrievalResponseDecisionV1 {
  const parsed =
    PostRetrievalEvidenceAssessmentV1Schema.safeParse(
      input.evidenceAssessment,
    );
  if (!parsed.success) {
    throw new Error(
      "POST_RETRIEVAL_EVIDENCE_ASSESSMENT_INVALID",
      { cause: parsed.error },
    );
  }
  const assessment = parsed.data;
  const sufficient =
    assessment.status === "SUFFICIENT";
  return PostRetrievalResponseDecisionV1Schema.parse({
    schemaVersion: 1,
    authority:
      "POST_RETRIEVAL_EVIDENCE_SUFFICIENCY",
    action: sufficient ? "ANSWER" : "CLARIFY",
    plannerStatusObserved:
      input.plannerStatusObserved,
    reason: sufficient
      ? "EVIDENCE_SUFFICIENT"
      : "EVIDENCE_INSUFFICIENT",
    clarifyingQuestion:
      assessment.clarifyingQuestion,
    evidenceAssessmentHash:
      sha256StableJsonV2(assessment),
  });
}
